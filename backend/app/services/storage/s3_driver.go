package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"ponta_drive/app/contracts"
)

// S3Driver implements contracts.CloudDriver for AWS S3 and S3-compatible storage.
type S3Driver struct {
	client        *s3.Client
	presignClient *s3.PresignClient
	cfg           S3Config
	bucket        string
	region        string
}

// NewS3Driver creates an initialized S3Driver instance.
func NewS3Driver(ctx context.Context, cfg S3Config) (*S3Driver, error) {
	region := strings.TrimSpace(cfg.Region)
	if region == "" {
		region = "us-east-1"
	}
	cfg.Region = region

	credProvider := credentials.NewStaticCredentialsProvider(
		cfg.AccessKeyID,
		cfg.SecretAccessKey,
		"",
	)

	awsCfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credProvider),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if strings.TrimSpace(cfg.Endpoint) != "" {
			o.BaseEndpoint = aws.String(strings.TrimSpace(cfg.Endpoint))
		}
		o.UsePathStyle = cfg.UsePathStyle
	})

	presignClient := s3.NewPresignClient(client)

	return &S3Driver{
		client:        client,
		presignClient: presignClient,
		cfg:           cfg,
		bucket:        cfg.Bucket,
		region:        region,
	}, nil
}

// GetBucket returns the configured bucket name.
func (d *S3Driver) GetBucket() string {
	return d.bucket
}

// GetRegion returns the configured region.
func (d *S3Driver) GetRegion() string {
	return d.region
}

// GetPublicURL returns the optional public CDN/custom domain URL.
func (d *S3Driver) GetPublicURL() string {
	return d.cfg.PublicURL
}

// GetClient returns the underlying s3.Client.
func (d *S3Driver) GetClient() *s3.Client {
	return d.client
}

// Put uploads an object stream directly to S3.
func (d *S3Driver) Put(ctx context.Context, key string, reader io.Reader, size int64, mimeType string) error {
	input := &s3.PutObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
		Body:   reader,
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	if mimeType != "" {
		input.ContentType = aws.String(mimeType)
	}

	_, err := d.client.PutObject(ctx, input)
	return err
}

// Get retrieves an object from S3 as an io.ReadCloser.
func (d *S3Driver) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := d.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	return output.Body, nil
}

// GetRange reads a byte range of an object. length < 0 reads to the end.
func (d *S3Driver) GetRange(ctx context.Context, key string, offset int64, length int64) (io.ReadCloser, int64, error) {
	var rangeHeader string
	if length < 0 {
		rangeHeader = fmt.Sprintf("bytes=%d-", offset)
	} else {
		rangeHeader = fmt.Sprintf("bytes=%d-%d", offset, offset+length-1)
	}

	output, err := d.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
		Range:  aws.String(rangeHeader),
	})
	if err != nil {
		return nil, 0, err
	}

	var total int64
	if output.ContentRange != nil {
		// Format: "bytes 2-5/10"; the part after "/" is the total size.
		if _, after, ok := strings.Cut(*output.ContentRange, "/"); ok {
			if parsed, perr := strconv.ParseInt(strings.TrimSpace(after), 10, 64); perr == nil {
				total = parsed
			}
		}
	}
	if total == 0 && output.ContentLength != nil {
		total = *output.ContentLength
	}

	return output.Body, total, nil
}

// GetBucketCors returns the bucket's CORS rules; a missing configuration is an
// empty list, not an error.
func (d *S3Driver) GetBucketCors(ctx context.Context) ([]contracts.CORSRule, error) {
	output, err := d.client.GetBucketCors(ctx, &s3.GetBucketCorsInput{
		Bucket: aws.String(d.bucket),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && apiErr.ErrorCode() == "NoSuchCORSConfiguration" {
			return nil, nil
		}
		return nil, err
	}

	rules := make([]contracts.CORSRule, 0, len(output.CORSRules))
	for _, r := range output.CORSRules {
		rule := contracts.CORSRule{
			AllowedOrigins: r.AllowedOrigins,
			AllowedMethods: r.AllowedMethods,
			AllowedHeaders: r.AllowedHeaders,
			ExposeHeaders:  r.ExposeHeaders,
		}
		if r.ID != nil {
			rule.ID = *r.ID
		}
		if r.MaxAgeSeconds != nil {
			rule.MaxAgeSeconds = *r.MaxAgeSeconds
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

// PutBucketCors replaces the bucket's entire CORS configuration.
func (d *S3Driver) PutBucketCors(ctx context.Context, rules []contracts.CORSRule) error {
	awsRules := make([]types.CORSRule, 0, len(rules))
	for _, r := range rules {
		awsRule := types.CORSRule{
			AllowedOrigins: r.AllowedOrigins,
			AllowedMethods: r.AllowedMethods,
			AllowedHeaders: r.AllowedHeaders,
			ExposeHeaders:  r.ExposeHeaders,
		}
		if r.ID != "" {
			id := r.ID
			awsRule.ID = &id
		}
		if r.MaxAgeSeconds > 0 {
			age := r.MaxAgeSeconds
			awsRule.MaxAgeSeconds = &age
		}
		awsRules = append(awsRules, awsRule)
	}

	_, err := d.client.PutBucketCors(ctx, &s3.PutBucketCorsInput{
		Bucket: aws.String(d.bucket),
		CORSConfiguration: &types.CORSConfiguration{
			CORSRules: awsRules,
		},
	})
	return err
}

// Delete deletes an object from S3.
func (d *S3Driver) Delete(ctx context.Context, key string) error {
	_, err := d.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	return err
}

// Exists checks if an object exists in S3 without retrieving its contents.
func (d *S3Driver) Exists(ctx context.Context, key string) (bool, error) {
	_, err := d.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var notFound *types.NotFound
		var noSuchKey *types.NoSuchKey
		if errors.As(err, &notFound) || errors.As(err, &noSuchKey) {
			return false, nil
		}
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			code := apiErr.ErrorCode()
			if code == "NotFound" || code == "NoSuchKey" || code == "404" {
				return false, nil
			}
		}
		return false, err
	}
	return true, nil
}

// GetMetadata retrieves metadata of an S3 object.
func (d *S3Driver) GetMetadata(ctx context.Context, key string) (*contracts.ObjectMetadata, error) {
	output, err := d.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}

	meta := &contracts.ObjectMetadata{
		Key: key,
	}
	if output.ContentLength != nil {
		meta.Size = *output.ContentLength
	}
	if output.ContentType != nil {
		meta.MimeType = *output.ContentType
	}
	if output.ETag != nil {
		meta.ETag = strings.Trim(*output.ETag, "\"")
	}
	if output.LastModified != nil {
		meta.LastModified = *output.LastModified
	}

	return meta, nil
}

// GetPresignedUploadURL generates a pre-signed PUT URL for direct client-to-S3 uploads.
func (d *S3Driver) GetPresignedUploadURL(ctx context.Context, key string, mimeType string, expire time.Duration) (*contracts.PresignedURLResponse, error) {
	input := &s3.PutObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	}
	if mimeType != "" {
		input.ContentType = aws.String(mimeType)
	}

	presignedReq, err := d.presignClient.PresignPutObject(ctx, input, func(po *s3.PresignOptions) {
		po.Expires = expire
	})
	if err != nil {
		return nil, err
	}

	headers := make(map[string]string)
	for k, v := range presignedReq.SignedHeader {
		if len(v) > 0 {
			headers[k] = strings.Join(v, ", ")
		}
	}

	return &contracts.PresignedURLResponse{
		URL:     presignedReq.URL,
		Method:  presignedReq.Method,
		Headers: headers,
		Expires: time.Now().Add(expire),
	}, nil
}

// GetPresignedDownloadURL generates a pre-signed GET URL for secure direct downloads.
func (d *S3Driver) GetPresignedDownloadURL(ctx context.Context, key string, fileName string, expire time.Duration) (string, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	}
	if strings.TrimSpace(fileName) != "" {
		input.ResponseContentDisposition = aws.String(fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	}

	presignedReq, err := d.presignClient.PresignGetObject(ctx, input, func(po *s3.PresignOptions) {
		po.Expires = expire
	})
	if err != nil {
		return "", err
	}

	return presignedReq.URL, nil
}

// InitiateMultipart starts a multipart upload session and returns an upload ID.
func (d *S3Driver) InitiateMultipart(ctx context.Context, key string, mimeType string) (string, error) {
	input := &s3.CreateMultipartUploadInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	}
	if mimeType != "" {
		input.ContentType = aws.String(mimeType)
	}

	output, err := d.client.CreateMultipartUpload(ctx, input)
	if err != nil {
		return "", err
	}
	if output.UploadId == nil {
		return "", errors.New("empty upload id returned from S3")
	}

	return *output.UploadId, nil
}

// UploadPart uploads a single part of a multipart upload directly from reader without caching to disk.
func (d *S3Driver) UploadPart(ctx context.Context, key string, uploadID string, partNumber int32, reader io.Reader, size int64) (string, error) {
	input := &s3.UploadPartInput{
		Bucket:        aws.String(d.bucket),
		Key:           aws.String(key),
		UploadId:      aws.String(uploadID),
		PartNumber:    aws.Int32(partNumber),
		Body:          reader,
		ContentLength: aws.Int64(size),
	}

	output, err := d.client.UploadPart(ctx, input)
	if err != nil {
		return "", err
	}
	if output.ETag == nil {
		return "", errors.New("empty ETag returned from upload part")
	}

	return strings.Trim(*output.ETag, "\""), nil
}

// CompleteMultipart finalizes a multipart upload with the given completed parts.
func (d *S3Driver) CompleteMultipart(ctx context.Context, key string, uploadID string, parts []contracts.CompletedPart) error {
	completedParts := make([]types.CompletedPart, 0, len(parts))
	for _, p := range parts {
		etag := p.ETag
		if !strings.HasPrefix(etag, "\"") {
			etag = fmt.Sprintf("\"%s\"", etag)
		}
		completedParts = append(completedParts, types.CompletedPart{
			PartNumber: aws.Int32(p.PartNumber),
			ETag:       aws.String(etag),
		})
	}

	_, err := d.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(d.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completedParts,
		},
	})
	return err
}

// AbortMultipart cancels a multipart upload and frees S3 storage chunks.
func (d *S3Driver) AbortMultipart(ctx context.Context, key string, uploadID string) error {
	_, err := d.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(d.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
	})
	return err
}

// DeleteObjects deletes multiple objects from S3 in batches of up to 1000 keys.
func (d *S3Driver) DeleteObjects(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	const batchSize = 1000
	for i := 0; i < len(keys); i += batchSize {
		end := i + batchSize
		if end > len(keys) {
			end = len(keys)
		}
		chunk := keys[i:end]

		objects := make([]types.ObjectIdentifier, 0, len(chunk))
		for _, k := range chunk {
			if strings.TrimSpace(k) == "" {
				continue
			}
			objects = append(objects, types.ObjectIdentifier{
				Key: aws.String(k),
			})
		}

		if len(objects) == 0 {
			continue
		}

		output, err := d.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(d.bucket),
			Delete: &types.Delete{
				Objects: objects,
				Quiet:   aws.Bool(true),
			},
		})
		if err != nil {
			return fmt.Errorf("failed to batch delete objects from S3: %w", err)
		}
		if len(output.Errors) > 0 {
			return fmt.Errorf("failed to delete %d objects from S3", len(output.Errors))
		}
	}

	return nil
}

// ListObjects lists objects under a given prefix, supporting continuation tokens and pagination.
func (d *S3Driver) ListObjects(ctx context.Context, prefix string, continuationToken string, maxKeys int32) (*contracts.ListObjectsResult, error) {
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(d.bucket),
	}
	if prefix != "" {
		input.Prefix = aws.String(prefix)
	}
	if continuationToken != "" {
		input.ContinuationToken = aws.String(continuationToken)
	}
	if maxKeys > 0 {
		input.MaxKeys = aws.Int32(maxKeys)
	}

	output, err := d.client.ListObjectsV2(ctx, input)
	if err != nil {
		return nil, err
	}

	result := &contracts.ListObjectsResult{
		IsTruncated: output.IsTruncated != nil && *output.IsTruncated,
	}
	if output.NextContinuationToken != nil {
		result.NextContinuation = *output.NextContinuationToken
	}

	for _, item := range output.Contents {
		meta := contracts.ObjectMetadata{}
		if item.Key != nil {
			meta.Key = *item.Key
		}
		if item.Size != nil {
			meta.Size = *item.Size
		}
		if item.ETag != nil {
			meta.ETag = strings.Trim(*item.ETag, "\"")
		}
		if item.LastModified != nil {
			meta.LastModified = *item.LastModified
		}
		result.Objects = append(result.Objects, meta)
	}

	for _, cp := range output.CommonPrefixes {
		if cp.Prefix != nil {
			result.CommonPrefixes = append(result.CommonPrefixes, *cp.Prefix)
		}
	}

	return result, nil
}

const (
	// s3SingleCopyLimit is S3's ceiling for a single CopyObject call: at or
	// below it one request copies the object; above it the copy must be split.
	s3SingleCopyLimit = 5 * 1024 * 1024 * 1024
	// s3CopyPartSize is the size of each multipart-copy part. 1 GiB keeps an
	// object up to ~10 TiB under the 10 000-part cap and is far above the 5 MiB
	// minimum part size.
	s3CopyPartSize = 1 * 1024 * 1024 * 1024
)

// CopyObject copies srcKey to dstKey on the server, choosing a single copy or a
// multipart copy from the source's size. The size decision lives here so the
// interface stays one call and callers never carry the threshold.
func (d *S3Driver) CopyObject(ctx context.Context, srcKey, dstKey string) error {
	meta, err := d.GetMetadata(ctx, srcKey)
	if err != nil {
		return err
	}

	if meta.Size <= s3SingleCopyLimit {
		_, err = d.client.CopyObject(ctx, &s3.CopyObjectInput{
			Bucket:     aws.String(d.bucket),
			Key:        aws.String(dstKey),
			CopySource: aws.String(encodeCopySource(d.bucket, srcKey)),
		})
		return err
	}

	return d.multipartCopy(ctx, srcKey, dstKey, meta.Size)
}

// multipartCopy copies an object in s3CopyPartSize ranges. Every part but the
// last is copied with a CopySourceRange; the last runs to the end of the
// object. A failure aborts the upload so no half-copied object is left behind.
func (d *S3Driver) multipartCopy(ctx context.Context, srcKey, dstKey string, size int64) error {
	uploadID, err := d.InitiateMultipart(ctx, dstKey, "")
	if err != nil {
		return err
	}

	parts := make([]contracts.CompletedPart, 0)
	for partNumber, offset := int32(1), int64(0); offset < size; partNumber, offset = partNumber+1, offset+s3CopyPartSize {
		end := offset + s3CopyPartSize - 1
		if end >= size {
			end = size - 1
		}
		rangeHeader := fmt.Sprintf("bytes=%d-%d", offset, end)

		output, err := d.client.UploadPartCopy(ctx, &s3.UploadPartCopyInput{
			Bucket:          aws.String(d.bucket),
			Key:             aws.String(dstKey),
			UploadId:        aws.String(uploadID),
			PartNumber:      aws.Int32(partNumber),
			CopySource:      aws.String(encodeCopySource(d.bucket, srcKey)),
			CopySourceRange: aws.String(rangeHeader),
		})
		if err != nil {
			d.abortMultipartSafely(ctx, dstKey, uploadID)
			return err
		}
		if output.CopyPartResult == nil || output.CopyPartResult.ETag == nil {
			d.abortMultipartSafely(ctx, dstKey, uploadID)
			return errors.New("empty ETag returned from upload part copy")
		}

		parts = append(parts, contracts.CompletedPart{
			PartNumber: partNumber,
			ETag:       strings.Trim(*output.CopyPartResult.ETag, "\""),
		})
	}

	if err := d.CompleteMultipart(ctx, dstKey, uploadID, parts); err != nil {
		d.abortMultipartSafely(ctx, dstKey, uploadID)
		return err
	}
	return nil
}

// abortMultipartSafely attempts to cancel the multipart upload on S3 even if the
// original context was cancelled (e.g. client disconnected or timeout expired).
func (d *S3Driver) abortMultipartSafely(ctx context.Context, key, uploadID string) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	_ = d.AbortMultipart(cleanupCtx, key, uploadID)
}

// encodeCopySource builds the x-amz-copy-source header value. The SDK does not
// encode it, so each path segment is escaped on its own and the "/" separators
// are left intact; escaping the whole string would turn them into %2F and S3
// would look for an object whose key literally contains slashes.
func encodeCopySource(bucket, key string) string {
	segments := strings.Split(key, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return bucket + "/" + strings.Join(segments, "/")
}
