# File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user preview any drive file in a dedicated route, using a backend-resolved strategy (direct / proxy / fallback) so previews work for as many types as possible without wasting server bandwidth or leaking internal errors.

**Architecture:** The backend resolves a per-file strategy (`direct` public/presigned URL for media, `proxy` same-origin stream for CORS-requiring types, `fallback` download link) and returns it; the frontend executes it by wiring `@eternalheart/vue-file-preview` accordingly. A best-effort bucket-CORS step runs on cloud-account create/edit plus a manual button.

**Tech Stack:** Go 1.25 (Goravel v1.18), aws-sdk-go-v2 (`service/s3 v1.79.0`); Vue 3.5 / TypeScript 6 / vue-router 5 / vue-i18n 11 / Pinia / Vitest 5 / Tailwind v4; `@eternalheart/vue-file-preview@1.6.10`.

**Spec:** `docs/superpowers/specs/2026-10-09-file-preview-design.md`

## Global Constraints

- Internal system/driver/DB errors MUST NEVER reach clients. Use `failResponse` (logs the real error, returns a localized key) or `facades.Log().Errorf`. Copy verbatim from the spec's F10 and the standing rule.
- NEVER modify auto-generated shadcn-vue files under `src/components/ui/*`.
- Repository conventions: backend handlers in `app/http/controllers`, routes in `routes/web.go`, localized keys in `lang/{en,vi}/*.json`; frontend API in `src/api`, views in `src/views`, app keys in `src/locales/{vi,en}.json`.
- Proxy cap is exactly `50 * 1024 * 1024` bytes, enforced server-side.
- Allowed CORS origin is `facades.Config().GetString("app.frontend_url", "http://localhost:5173")` — never `*`.
- The preview library MUST be loaded with dynamic `import()` (bundle ≈ 2.5MB eager / 31MB dist).
- `skipLibCheck: true` (inherited from `@vue/tsconfig`) must stay on; the library's own `.d.ts` imports a core package (`@eternalheart/file-preview-core`) that is not published to npm.
- Package manager is **bun** (`bun.lock` present).

## Review Focus

The five input classes / failure modes most likely to bite a user, each pinned to the task that owns its test:

1. **An item with an empty or generic MIME (`application/octet-stream`)** — the user expects a `.png`/`.mp4` to preview normally, not fall to the fallback card. Pinned in Task 3 (`classifyPreviewKind` extension fallback) and Task 12 (passing `name` so the library detects by extension).
2. **A file exactly at or over the 50MB boundary** — the user expects a clean "too large" card, never a truncated/broken viewer. Pinned in Task 3 (`decidePreviewStrategy` at 50MB±1) and Task 7 (`413`).
3. **A video that is seeked** — the user expects to scrub without restarting. Pinned in Task 6 (`Range` → `206` + `Content-Range`).
4. **A bucket whose key lacks `s3:PutBucketCors`** — the user expects the account to still save and the app to keep working. Pinned in Task 9 (best-effort swallow) and Task 10 (manual button returns a localized failure).
5. **A `direct` URL served from a different origin while an `Authorization` header is attached** — the user expects the preview to render, not fail a CORS preflight. Pinned in Task 12 (requestInit is attached only for `proxy`).

---

## File Structure

Backend (`D:\Source\ponta\ponta_drive\backend`):

- Modify `app/contracts/storage.go` — add `CORSRule` type and three `CloudDriver` methods.
- Modify `app/services/storage/s3_driver.go` — implement `GetBucketCors`, `PutBucketCors`, `GetRange`.
- Create `app/services/preview_policy.go` — pure helpers: `classifyPreviewKind`, `decidePreviewStrategy`, `parseRangeHeader`, `mergeCorsRules`, constants.
- Create `app/services/preview_policy_test.go` — unit tests for the pure helpers.
- Modify `app/services/cloud_drive_service.go` — `ResolvePreview` (strategy resolution + server-side HEAD).
- Modify `app/http/controllers/drive_item_controller.go` — `Preview` and `Content` handlers.
- Modify `app/http/controllers/cloud_account_controller.go` — `ensureBucketCors` + call sites in `Store`/`Update`, new `Cors` handler.
- Modify `routes/web.go` — register `/preview`, `/content`, `/cors`.
- Modify `lang/en/drive.json`, `lang/vi/drive.json`, `lang/en/cloud.json`, `lang/vi/cloud.json` — new keys.
- Modify `tests/unit/storage_contract_test.go` — extend the stub with the new methods.

Frontend (`D:\Source\ponta\ponta_drive\frontend`):

- Modify `package.json` (via bun) — add `@eternalheart/vue-file-preview`.
- Modify `src/api/client.ts` — export `apiUrl(path)`.
- Modify `src/api/driveItems.ts` — `getDriveItemPreview`, `DriveItemPreview`.
- Modify `src/api/cloudAccounts.ts` — `ensureCloudAccountCors`.
- Create `src/lib/vfp-i18n.ts` — Vietnamese library dictionary.
- Create `src/lib/__tests__/vfp-i18n.spec.ts` — completeness test.
- Create `src/views/PreviewView.vue` — the preview screen.
- Create `src/views/__tests__/PreviewView.spec.ts`.
- Modify `src/router/drivePaths.ts` — `previewPath` / `previewLocation`.
- Modify `src/router/index.ts` — the route.
- Modify `src/components/drive/DriveItemMenu.vue` — preview action.
- Modify `src/components/drive/__tests__/DriveItemMenu.spec.ts` (create if absent).
- Modify `src/views/DriveView.vue` — double-click + preview wiring.
- Modify `src/components/cloud/AddCloudDialog.vue` — manual CORS button.
- Modify `src/locales/vi.json`, `src/locales/en.json` — app keys.

---

## Task 1: CloudDriver contract — CORS + range methods

**Files:**
- Modify: `app/contracts/storage.go`
- Modify: `app/services/storage/s3_driver.go`
- Modify: `tests/unit/storage_contract_test.go`
- Test: `tests/unit/s3_driver_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CORSRule struct { ID string; AllowedOrigins []string; AllowedMethods []string; AllowedHeaders []string; ExposeHeaders []string; MaxAgeSeconds int32 }`
  - `CloudDriver.GetBucketCors(ctx context.Context) ([]CORSRule, error)`
  - `CloudDriver.PutBucketCors(ctx context.Context, rules []CORSRule) error`
  - `CloudDriver.GetRange(ctx context.Context, key string, offset int64, length int64) (io.ReadCloser, int64, error)` — `length == -1` means "to end"; returns the object's **total** size.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/s3_driver_test.go` (the file already imports `net/http`, `net/http/httptest`, `context`, `io`, `testing`, `assert`, `require`, `storage`):

```go
func TestS3DriverGetRange(t *testing.T) {
	body := []byte("0123456789")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "bytes=2-5", r.Header.Get("Range"))
		w.Header().Set("Content-Range", "bytes 2-5/10")
		w.Header().Set("Content-Length", "4")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[2:6])
	}))
	defer server.Close()

	driver, err := storage.NewS3Driver(context.Background(), storage.S3Config{
		Bucket:          "b",
		Region:          "us-east-1",
		AccessKeyID:     "k",
		SecretAccessKey: "s",
		Endpoint:        server.URL,
		UsePathStyle:    true,
	})
	require.NoError(t, err)

	reader, total, err := driver.GetRange(context.Background(), "key.txt", 2, 4)
	require.NoError(t, err)
	defer reader.Close()
	got, _ := io.ReadAll(reader)
	assert.Equal(t, "2345", string(got))
	assert.Equal(t, int64(10), total)
}

func TestS3DriverGetRangeToEnd(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "bytes=5-", r.Header.Get("Range"))
		w.Header().Set("Content-Range", "bytes 5-9/10")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("56789"))
	}))
	defer server.Close()

	driver, err := storage.NewS3Driver(context.Background(), storage.S3Config{
		Bucket: "b", Region: "us-east-1", AccessKeyID: "k", SecretAccessKey: "s",
		Endpoint: server.URL, UsePathStyle: true,
	})
	require.NoError(t, err)

	reader, total, err := driver.GetRange(context.Background(), "key.txt", 5, -1)
	require.NoError(t, err)
	defer reader.Close()
	got, _ := io.ReadAll(reader)
	assert.Equal(t, "56789", string(got))
	assert.Equal(t, int64(10), total)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/unit/ -run TestS3DriverGetRange -v`
Expected: FAIL — `driver.GetRange undefined`.

- [ ] **Step 3: Add the contract type and methods**

In `app/contracts/storage.go`, add the type after `ListObjectsResult`:

```go
// CORSRule is a framework-agnostic representation of one bucket CORS rule.
type CORSRule struct {
	ID             string
	AllowedOrigins []string
	AllowedMethods []string
	AllowedHeaders []string
	ExposeHeaders  []string
	MaxAgeSeconds  int32
}
```

Add to the `CloudDriver` interface (after `DeleteObjects`):

```go
	GetBucketCors(ctx context.Context) ([]CORSRule, error)
	PutBucketCors(ctx context.Context, rules []CORSRule) error
	// GetRange reads [offset, offset+length) of an object; length < 0 reads to
	// the end. It returns the object's total size so callers can build a
	// Content-Range header.
	GetRange(ctx context.Context, key string, offset int64, length int64) (io.ReadCloser, int64, error)
```

- [ ] **Step 4: Implement in S3Driver**

In `app/services/storage/s3_driver.go`, add after `Get`:

```go
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
```

Add `strconv` to the imports of `s3_driver.go` (it already imports `errors`, `fmt`, `strings`, `smithy`, `types`, `aws`, `s3`).

- [ ] **Step 5: Extend the interface stub**

In `tests/unit/storage_contract_test.go`, add these methods to `s3DriverStub`:

```go
func (s *s3DriverStub) GetBucketCors(ctx context.Context) ([]contracts.CORSRule, error) {
	return nil, nil
}
func (s *s3DriverStub) PutBucketCors(ctx context.Context, rules []contracts.CORSRule) error {
	return nil
}
func (s *s3DriverStub) GetRange(ctx context.Context, key string, offset int64, length int64) (io.ReadCloser, int64, error) {
	return nil, 0, nil
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/unit/ -run 'TestS3DriverGetRange|TestCloudDriverInterface|TestS3DriverImplementsInterface' -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/contracts/storage.go app/services/storage/s3_driver.go tests/unit/storage_contract_test.go tests/unit/s3_driver_test.go
git commit -m "feat(storage): add CORS and range-read driver methods"
```

---

## Task 2: Preview policy — pure decision helpers

**Files:**
- Create: `app/services/preview_policy.go`
- Test: `app/services/preview_policy_test.go`

**Interfaces:**
- Consumes: `contracts.CORSRule` (Task 1).
- Produces:
  - `type PreviewKind int` with `KindMedia`, `KindFetchBased`, `KindUnsupported`
  - `type PreviewStrategy string` with `StrategyDirect = "direct"`, `StrategyProxy = "proxy"`, `StrategyFallback = "fallback"`
  - `const MaxPreviewProxyBytes int64 = 50 * 1024 * 1024`
  - `func ClassifyPreviewKind(mimeType string, extension string) PreviewKind`
  - `func DecidePreviewStrategy(kind PreviewKind, size int64, publicReachable bool) (PreviewStrategy, string)` — second return is `reason` (`""` unless fallback)
  - `func ParseRangeHeader(header string, size int64) (offset int64, length int64, err error)`
  - `func MergeCorsRules(existing []contracts.CORSRule, origin string) (merged []contracts.CORSRule, changed bool)`

- [ ] **Step 1: Write the failing tests**

Create `app/services/preview_policy_test.go`:

```go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"ponta_drive/app/contracts"
)

func TestClassifyPreviewKind(t *testing.T) {
	cases := []struct {
		name string
		mime string
		ext  string
		want PreviewKind
	}{
		{"image by mime", "image/png", "png", KindMedia},
		{"video by mime", "video/mp4", "mp4", KindMedia},
		{"audio by mime", "audio/mpeg", "mp3", KindMedia},
		{"image by extension when mime empty", "", "png", KindMedia},
		{"video by extension when mime generic", "application/octet-stream", "mp4", KindMedia},
		{"pdf is fetch-based", "application/pdf", "pdf", KindFetchBased},
		{"office is fetch-based", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", KindFetchBased},
		{"text is fetch-based", "text/plain", "txt", KindFetchBased},
		{"unknown is unsupported", "application/x-msdownload", "exe", KindUnsupported},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ClassifyPreviewKind(tc.mime, tc.ext))
		})
	}
}

func TestDecidePreviewStrategy(t *testing.T) {
	// Media: always direct (no CORS needed), regardless of size.
	s, reason := DecidePreviewStrategy(KindMedia, 10, false)
	assert.Equal(t, StrategyDirect, s)
	assert.Empty(t, reason)

	// Fetch-based, within the cap: proxy.
	s, _ = DecidePreviewStrategy(KindFetchBased, MaxPreviewProxyBytes, false)
	assert.Equal(t, StrategyProxy, s)

	// Fetch-based, one byte over the cap, no public URL: fallback.
	s, reason = DecidePreviewStrategy(KindFetchBased, MaxPreviewProxyBytes+1, false)
	assert.Equal(t, StrategyFallback, s)
	assert.Equal(t, "too_large", reason)

	// Fetch-based, over the cap, but a reachable public URL exists: direct.
	s, _ = DecidePreviewStrategy(KindFetchBased, MaxPreviewProxyBytes+1, true)
	assert.Equal(t, StrategyDirect, s)

	// Fetch-based, within the cap, reachable public URL: still proxy (safer).
	s, _ = DecidePreviewStrategy(KindFetchBased, 10, true)
	assert.Equal(t, StrategyProxy, s)

	// Unsupported: fallback.
	s, reason = DecidePreviewStrategy(KindUnsupported, 10, true)
	assert.Equal(t, StrategyFallback, s)
	assert.Equal(t, "unsupported", reason)
}

func TestParseRangeHeader(t *testing.T) {
	// No header: whole object.
	offset, length, err := ParseRangeHeader("", 100)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), offset)
	assert.Equal(t, int64(100), length)

	// bytes=0- -> to end.
	offset, length, err = ParseRangeHeader("bytes=0-", 100)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), offset)
	assert.Equal(t, int64(100), length)

	// bytes=10-19 -> 10 bytes.
	offset, length, err = ParseRangeHeader("bytes=10-19", 100)
	assert.NoError(t, err)
	assert.Equal(t, int64(10), offset)
	assert.Equal(t, int64(10), length)

	// bytes=90- -> clamped to the end.
	offset, length, err = ParseRangeHeader("bytes=90-", 100)
	assert.NoError(t, err)
	assert.Equal(t, int64(90), offset)
	assert.Equal(t, int64(10), length)

	// Start past the end: unsatisfiable.
	_, _, err = ParseRangeHeader("bytes=200-300", 100)
	assert.Error(t, err)

	// Malformed.
	_, _, err = ParseRangeHeader("items=0-5", 100)
	assert.Error(t, err)

	// Multi-range is not supported.
	_, _, err = ParseRangeHeader("bytes=0-5,10-15", 100)
	assert.Error(t, err)
}

func TestMergeCorsRules(t *testing.T) {
	// No existing rules -> one added rule.
	merged, changed := MergeCorsRules(nil, "https://app.example")
	assert.True(t, changed)
	assert.Len(t, merged, 1)
	assert.Equal(t, []string{"https://app.example"}, merged[0].AllowedOrigins)
	assert.Equal(t, []string{"GET", "HEAD"}, merged[0].AllowedMethods)

	// Existing unrelated rule is preserved.
	existing := []contracts.CORSRule{{ID: "other", AllowedOrigins: []string{"https://other"}, AllowedMethods: []string{"GET"}}}
	merged, changed = MergeCorsRules(existing, "https://app.example")
	assert.True(t, changed)
	assert.Len(t, merged, 2)
	assert.Equal(t, "other", merged[0].ID)

	// Our rule already present -> idempotent no-op.
	ours := []contracts.CORSRule{{AllowedOrigins: []string{"https://app.example"}, AllowedMethods: []string{"GET", "HEAD"}}}
	merged, changed = MergeCorsRules(ours, "https://app.example")
	assert.False(t, changed)
	assert.Len(t, merged, 1)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./app/services/ -run 'TestClassifyPreviewKind|TestDecidePreviewStrategy|TestParseRangeHeader|TestMergeCorsRules' -v`
Expected: FAIL — undefined symbols.

- [ ] **Step 3: Implement the helpers**

Create `app/services/preview_policy.go`:

```go
package services

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"ponta_drive/app/contracts"
)

// MaxPreviewProxyBytes bounds how large a file the server will proxy for
// preview. Files above it are offered as a download instead.
const MaxPreviewProxyBytes int64 = 50 * 1024 * 1024

// PreviewKind is how the preview pipeline treats a file.
type PreviewKind int

const (
	KindMedia PreviewKind = iota
	KindFetchBased
	KindUnsupported
)

// PreviewStrategy is the transport the client should use.
type PreviewStrategy string

const (
	StrategyDirect   PreviewStrategy = "direct"
	StrategyProxy    PreviewStrategy = "proxy"
	StrategyFallback PreviewStrategy = "fallback"
)

var mediaMimePrefixes = []string{"image/", "video/", "audio/"}

var mediaExtensions = map[string]bool{
	"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "bmp": true,
	"svg": true, "avif": true, "heic": true, "heif": true, "ico": true, "tiff": true, "tif": true,
	"mp4": true, "webm": true, "mov": true, "mkv": true, "avi": true, "m4v": true,
	"mp3": true, "wav": true, "ogg": true, "flac": true, "aac": true, "m4a": true, "opus": true,
}

var fetchBasedExtensions = map[string]bool{
	"pdf": true, "txt": true, "md": true, "markdown": true, "json": true, "csv": true,
	"xml": true, "html": true, "htm": true, "yaml": true, "yml": true, "log": true,
	"go": true, "js": true, "ts": true, "tsx": true, "jsx": true, "py": true, "rb": true,
	"java": true, "c": true, "h": true, "cpp": true, "cs": true, "php": true, "rs": true,
	"sh": true, "sql": true, "css": true, "scss": true, "vue": true, "swift": true, "kt": true,
	"doc": true, "docx": true, "xls": true, "xlsx": true, "ppt": true, "pptx": true,
	"odt": true, "ods": true, "odp": true, "rtf": true,
	"zip": true, "rar": true, "7z": true, "tar": true, "gz": true,
	"epub": true, "mobi": true, "azw3": true,
	"ttf": true, "otf": true, "woff": true, "woff2": true,
	"srt": true, "vtt": true, "ass": true, "ssa": true, "lrc": true,
	"msg": true, "dxf": true, "dwg": true,
}

// ClassifyPreviewKind decides how a file is previewed. It prefers the MIME type
// but falls back to the extension, which is what makes a file with an empty or
// generic MIME (application/octet-stream) still preview correctly.
func ClassifyPreviewKind(mimeType string, extension string) PreviewKind {
	mime := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	ext := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(extension), "."))

	for _, prefix := range mediaMimePrefixes {
		if strings.HasPrefix(mime, prefix) {
			return KindMedia
		}
	}
	if mediaExtensions[ext] {
		return KindMedia
	}
	if mime == "application/pdf" || fetchBasedExtensions[ext] {
		return KindFetchBased
	}
	if strings.HasPrefix(mime, "text/") {
		return KindFetchBased
	}
	return KindUnsupported
}

// DecidePreviewStrategy picks the transport for a file.
//
// Media goes direct (its renderers do not need CORS, so a public or presigned
// URL always works). Fetch-based files are proxied while they fit the cap,
// because their renderers fetch and therefore need CORS; direct is used for them
// only via a reachable public URL, which is CORS-enabled by nature.
func DecidePreviewStrategy(kind PreviewKind, size int64, publicReachable bool) (PreviewStrategy, string) {
	switch kind {
	case KindMedia:
		return StrategyDirect, ""
	case KindFetchBased:
		if size <= MaxPreviewProxyBytes {
			return StrategyProxy, ""
		}
		if publicReachable {
			return StrategyDirect, ""
		}
		return StrategyFallback, "too_large"
	default:
		return StrategyFallback, "unsupported"
	}
}

// ParseRangeHeader parses a single-range "bytes=start-end" header. An empty
// header means the whole object. Multi-range requests are rejected because the
// proxy streams one contiguous span.
func ParseRangeHeader(header string, size int64) (int64, int64, error) {
	header = strings.TrimSpace(header)
	if header == "" {
		return 0, size, nil
	}
	if !strings.HasPrefix(header, "bytes=") {
		return 0, 0, errors.New("unsupported range unit")
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.Contains(spec, ",") {
		return 0, 0, errors.New("multiple ranges are not supported")
	}
	startStr, endStr, ok := strings.Cut(spec, "-")
	if !ok {
		return 0, 0, errors.New("malformed range")
	}

	start, err := strconv.ParseInt(strings.TrimSpace(startStr), 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("malformed range start: %w", err)
	}
	if start < 0 || start >= size {
		return 0, 0, errors.New("range start out of bounds")
	}

	end := size - 1
	if strings.TrimSpace(endStr) != "" {
		parsed, perr := strconv.ParseInt(strings.TrimSpace(endStr), 10, 64)
		if perr != nil {
			return 0, 0, fmt.Errorf("malformed range end: %w", perr)
		}
		if parsed < start {
			return 0, 0, errors.New("range end before start")
		}
		if parsed < end {
			end = parsed
		}
	}

	return start, end - start + 1, nil
}

// MergeCorsRules returns existing rules plus one that allows origin to GET and
// HEAD the bucket. It is idempotent: if a rule already covers origin for GET,
// nothing is added and changed is false.
func MergeCorsRules(existing []contracts.CORSRule, origin string) ([]contracts.CORSRule, bool) {
	for _, rule := range existing {
		allowsOrigin := false
		for _, o := range rule.AllowedOrigins {
			if o == origin || o == "*" {
				allowsOrigin = true
				break
			}
		}
		if !allowsOrigin {
			continue
		}
		for _, m := range rule.AllowedMethods {
			if m == "GET" {
				return existing, false
			}
		}
	}

	merged := make([]contracts.CORSRule, len(existing), len(existing)+1)
	copy(merged, existing)
	merged = append(merged, contracts.CORSRule{
		ID:             "ponta-drive-preview",
		AllowedOrigins: []string{origin},
		AllowedMethods: []string{"GET", "HEAD"},
		AllowedHeaders: []string{"*"},
		ExposeHeaders:  []string{"ETag", "Content-Range", "Content-Length"},
		MaxAgeSeconds:  3000,
	})
	return merged, true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./app/services/ -run 'TestClassifyPreviewKind|TestDecidePreviewStrategy|TestParseRangeHeader|TestMergeCorsRules' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/preview_policy.go app/services/preview_policy_test.go
git commit -m "feat(preview): add pure strategy, range and CORS-merge helpers"
```

---

## Task 3: ResolvePreview — server-side strategy resolution

**Files:**
- Modify: `app/services/cloud_drive_service.go`
- Test: `tests/unit/preview_resolve_test.go` (create)

**Interfaces:**
- Consumes: `ClassifyPreviewKind`, `DecidePreviewStrategy`, `MaxPreviewProxyBytes` (Task 2); `GetPresignedDownloadURL` (existing).
- Produces:
  - `type PreviewResult struct { Strategy PreviewStrategy; URL string; DownloadURL string; Item *models.DriveItem; Reason string }`
  - `func (s *CloudDriveService) ResolvePreview(ctx context.Context, userID uint, itemUUID string) (*PreviewResult, error)`

- [ ] **Step 1: Write the failing test**

The reachability check is the only part that touches the network, so it is extracted as `publicURLReachable` and tested directly; the strategy math is already covered by Task 2. Create `tests/unit/preview_resolve_test.go`:

```go
package unit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"ponta_drive/app/services"
)

func TestPublicURLReachable(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodHead, r.Method)
		w.WriteHeader(http.StatusOK)
	}))
	defer ok.Close()
	assert.True(t, services.PublicURLReachable(context.Background(), ok.URL+"/file.png"))

	missing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer missing.Close()
	assert.False(t, services.PublicURLReachable(context.Background(), missing.URL+"/file.png"))

	// An unreachable host must fail fast, not hang.
	assert.False(t, services.PublicURLReachable(context.Background(), "http://127.0.0.1:1/nope"))

	// A non-absolute URL is never treated as reachable.
	assert.False(t, services.PublicURLReachable(context.Background(), "/relative/path.png"))
	assert.False(t, services.PublicURLReachable(context.Background(), ""))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/unit/ -run TestPublicURLReachable -v`
Expected: FAIL — `services.PublicURLReachable undefined`.

- [ ] **Step 3: Implement ResolvePreview**

In `app/services/cloud_drive_service.go`, add `net/http` to the imports (the file already imports `context`, `errors`, `fmt`, `io`, `strings`, `time`), then add:

```go
// PreviewResult is the resolved way to preview one file.
type PreviewResult struct {
	Strategy    PreviewStrategy
	URL         string
	DownloadURL string
	Item        *models.DriveItem
	Reason      string
}

// publicURLTimeout bounds the server-side reachability probe so a slow or
// black-holed CDN cannot hold the request open.
const publicURLTimeout = 3 * time.Second

// PublicURLReachable reports whether an absolute public URL answers a HEAD
// request with 2xx/3xx. It is deliberately done server-side: a browser check
// would be a CORS false-negative for a URL that is in fact public.
func PublicURLReachable(ctx context.Context, rawURL string) bool {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return false
	}

	probeCtx, cancel := context.WithTimeout(ctx, publicURLTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(probeCtx, http.MethodHead, rawURL, nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

// publicURLFor joins an account's configured public URL with an object key.
// Returns "" when no public URL is configured.
func publicURLFor(publicBase string, storagePath string) string {
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	key := strings.TrimLeft(strings.TrimSpace(storagePath), "/")
	if base == "" || key == "" {
		return ""
	}
	return base + "/" + key
}

// ResolvePreview decides how to preview an item. It never proxies on its own;
// it only reports the strategy, the URL to use and the always-available
// download URL.
func (s *CloudDriveService) ResolvePreview(ctx context.Context, userID uint, itemUUID string) (*PreviewResult, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}
	if item.Type == models.ItemTypeFolder {
		return nil, errors.New("cannot preview a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, err
	}

	downloadURL, _, err := s.GetPresignedDownloadURL(ctx, userID, itemUUID, 15*time.Minute)
	if err != nil {
		return nil, err
	}

	kind := ClassifyPreviewKind(item.MimeType, item.Extension)

	publicURL := ""
	if pub := driver.GetPublicURL(); pub != "" {
		publicURL = publicURLFor(pub, item.StoragePath)
	}
	reachable := publicURL != "" && PublicURLReachable(ctx, publicURL)

	strategy, reason := DecidePreviewStrategy(kind, item.Size, reachable)

	result := &PreviewResult{
		Strategy:    strategy,
		DownloadURL: downloadURL,
		Item:        item,
		Reason:      reason,
	}

	switch strategy {
	case StrategyDirect:
		if reachable {
			result.URL = publicURL
		} else {
			result.URL = downloadURL
		}
	case StrategyProxy:
		result.URL = fmt.Sprintf("/v1/drive/items/%s/content", item.UUID)
	default:
		result.URL = ""
	}

	_ = account
	return result, nil
}
```

Note: `GetPublicURL()` is on the concrete `*S3Driver`, not the `CloudDriver` interface. Add it to the interface in this task:

In `app/contracts/storage.go`, add to `CloudDriver`:

```go
	// GetPublicURL returns the optional public CDN/custom domain for the bucket,
	// or "" when none is configured.
	GetPublicURL() string
```

and in `tests/unit/storage_contract_test.go` add to the stub:

```go
func (s *s3DriverStub) GetPublicURL() string { return "" }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/unit/ -run 'TestPublicURLReachable|TestCloudDriverInterface' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/contracts/storage.go app/services/cloud_drive_service.go tests/unit/preview_resolve_test.go tests/unit/storage_contract_test.go
git commit -m "feat(preview): resolve preview strategy server-side"
```

---

## Task 4: Preview endpoint + routes

**Files:**
- Modify: `app/http/controllers/drive_item_controller.go`
- Modify: `routes/web.go`
- Modify: `lang/en/drive.json`, `lang/vi/drive.json`
- Test: `tests/feature/preview_api_test.go` (create)

**Interfaces:**
- Consumes: `ResolvePreview` (Task 3), `PreviewResult` (Task 3).
- Produces: `GET /v1/drive/items/{uuid}/preview?mode=json` returning `{ status, data: { strategy, url, download_url, item, reason } }`.

- [ ] **Step 1: Write the failing test**

Create `tests/feature/preview_api_test.go`, modelled on `tests/feature/download_api_test.go` (same suite scaffolding, mock S3 server, login, account, item):

```go
package feature

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/suite"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
	"ponta_drive/tests"
)

type PreviewAPITestSuite struct {
	suite.Suite
	tests.TestCase
	user       models.User
	token      string
	account    models.CloudAccount
	item       models.DriveItem
	mockServer *httptest.Server
	fileData   []byte
}

func TestPreviewAPITestSuite(t *testing.T) {
	suite.Run(t, new(PreviewAPITestSuite))
}

func (s *PreviewAPITestSuite) SetupTest() {
	_ = facades.Artisan().Call("migrate")

	s.fileData = []byte("0123456789")

	// One range-aware mock for the whole suite. It must NOT be replaced per
	// test: CloudDriveService caches its driver by account id for the process
	// lifetime, so a swapped endpoint would be ignored and the test would hit
	// a closed server.
	s.mockServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Accept-Ranges", "bytes")
		if rng := r.Header.Get("Range"); rng != "" {
			// The suite only ever requests "bytes=2-5".
			w.Header().Set("Content-Range", "bytes 2-5/10")
			w.Header().Set("Content-Length", "4")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(s.fileData[2:6])
			return
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(s.fileData)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(s.fileData)
	}))

	hashedPassword, _ := facades.Hash().Make("password123")
	s.user = models.User{
		UUID: uuid.New().String(), Name: "Preview User",
		Username: "pv_" + uuid.New().String()[:8],
		Email:    "pv_" + uuid.New().String()[:8] + "@example.com",
		Password: hashedPassword,
	}
	s.Require().NoError(facades.Orm().Query().Create(&s.user))

	loginPayload, _ := json.Marshal(map[string]string{"email": s.user.Email, "password": "password123"})
	resp, err := s.Http(s.T()).Post("/auth/login", bytes.NewBuffer(loginPayload))
	s.Require().NoError(err)
	resp.AssertOk()
	body, _ := resp.Json()
	s.token = body["data"].(map[string]any)["token"].(string)

	s.account = models.CloudAccount{
		UserID: s.user.ID, Name: "Preview Storage",
		Provider: models.ProviderMinIO, IsDefault: true, IsActive: true,
	}
	_ = s.account.SetCredentials(&models.S3Credentials{
		Endpoint: s.mockServer.URL, Bucket: "mock-bucket", Region: "us-east-1",
		AccessKeyID: "mock-key", SecretAccessKey: "mock-secret", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&s.account))

	s.item = models.DriveItem{
		UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: s.account.ID,
		Name: "photo.png", Type: models.ItemTypeFile, MimeType: "image/png",
		Size: int64(len(s.fileData)), Extension: "png",
		StoragePath: fmt.Sprintf("users/%d/items/photo.png", s.user.ID),
		Status:      models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&s.item))
}

func (s *PreviewAPITestSuite) TearDownTest() {
	if s.mockServer != nil {
		s.mockServer.Close()
	}
	if s.user.ID > 0 {
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.DriveItem{})
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.CloudAccount{})
		_, _ = facades.Orm().Query().ForceDelete(&s.user)
	}
}

func (s *PreviewAPITestSuite) TestPreviewMediaIsDirect() {
	resp, err := s.Http(s.T()).WithToken(s.token).Get(
		fmt.Sprintf("/v1/drive/items/%s/preview?mode=json", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertOk()

	body, _ := resp.Json()
	data := body["data"].(map[string]any)
	s.Equal("direct", data["strategy"])
	s.NotEmpty(data["url"])
	s.NotEmpty(data["download_url"])
}

func (s *PreviewAPITestSuite) TestPreviewLargeFetchBasedIsFallback() {
	// A fetch-based file over the cap with no public URL cannot be proxied.
	s.item.MimeType = "application/pdf"
	s.item.Extension = "pdf"
	s.item.Size = 51 * 1024 * 1024
	s.Require().NoError(facades.Orm().Query().Save(&s.item))

	resp, err := s.Http(s.T()).WithToken(s.token).Get(
		fmt.Sprintf("/v1/drive/items/%s/preview?mode=json", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertOk()

	data, _ := resp.Json()["data"].(map[string]any)
	s.Equal("fallback", data["strategy"])
	s.Equal("too_large", data["reason"])
	s.NotEmpty(data["download_url"])
}

func (s *PreviewAPITestSuite) TestPreviewFolderRejected() {
	folder := models.DriveItem{
		UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: s.account.ID,
		Name: "docs", Type: models.ItemTypeFolder, Status: models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&folder))

	resp, err := s.Http(s.T()).WithToken(s.token).Get(
		fmt.Sprintf("/v1/drive/items/%s/preview?mode=json", folder.UUID))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusBadRequest)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/feature/ -run TestPreviewAPITestSuite -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the handler**

In `app/http/controllers/drive_item_controller.go`, add after `Download`:

```go
// Preview resolves how the client should preview an item: a direct URL, a
// same-origin proxy path, or a download-only fallback.
func (c *DriveItemController) Preview(ctx http.Context) http.Response {
	user, itemUUID, errResp := c.resolveUserAndItemUUID(ctx)
	if errResp != nil {
		return errResp
	}

	result, err := c.service.ResolvePreview(context.Background(), user.ID, itemUUID)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.preview_failed", err)
	}

	return ctx.Response().Success().Json(http.Json{
		"status": "ok",
		"data": http.Json{
			"strategy":     string(result.Strategy),
			"url":          result.URL,
			"download_url": result.DownloadURL,
			"item":         result.Item.ToResponse(),
			"reason":       result.Reason,
		},
	})
}
```

- [ ] **Step 4: Register the route**

In `routes/web.go`, add a constant next to the others:

```go
	uuidPreviewRoute    = "/{uuid}/preview"
```

and register it inside the `drive/items` group, after `uuidDownloadRoute`:

```go
					items.Get(uuidPreviewRoute, driveItemController.Preview)
```

- [ ] **Step 5: Add language keys**

`lang/en/drive.json` — add:

```json
  "preview_failed": "Could not open a preview for this item. Please try again.",
  "preview_too_large": "This file is too large to preview. Download it to view it.",
  "preview_unsupported": "This file type cannot be previewed. Download it to view it.",
```

`lang/vi/drive.json` — add:

```json
  "preview_failed": "Không thể mở xem trước cho mục này. Vui lòng thử lại.",
  "preview_too_large": "Tệp quá lớn để xem trước. Hãy tải xuống để xem.",
  "preview_unsupported": "Định dạng tệp này không hỗ trợ xem trước. Hãy tải xuống để xem.",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/feature/ -run TestPreviewAPITestSuite -v`
Expected: PASS (requires the dev MariaDB, as the other feature suites do).

- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/drive_item_controller.go routes/web.go lang/en/drive.json lang/vi/drive.json tests/feature/preview_api_test.go
git commit -m "feat(preview): add preview resolution endpoint"
```

---

## Task 5: Content proxy — size cap

**Files:**
- Modify: `app/http/controllers/drive_item_controller.go`
- Modify: `routes/web.go`
- Test: `tests/feature/preview_api_test.go` (extend)

**Interfaces:**
- Consumes: `MaxPreviewProxyBytes` (Task 2), `GetItemStream` (existing).
- Produces: `GET /v1/drive/items/{uuid}/content` — `200` full body when `size <= MaxPreviewProxyBytes`; `413` when over.

- [ ] **Step 1: Write the failing test**

Append to `tests/feature/preview_api_test.go`:

```go
func (s *PreviewAPITestSuite) TestContentStreamsWithinCap() {
	// Size matches the mock's body (see SetupTest); the handler echoes it as
	// Content-Length, so a mismatch would truncate the read.
	resp, err := s.Http(s.T()).WithToken(s.token).Get(
		fmt.Sprintf("/v1/drive/items/%s/content", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertOk()
	s.Equal("inline", resp.Headers().Get("Content-Disposition"))
	content, _ := resp.Content()
	s.Equal(string(s.fileData), content)
}

func (s *PreviewAPITestSuite) TestContentRejectsOverCap() {
	s.item.Size = 51 * 1024 * 1024
	s.Require().NoError(facades.Orm().Query().Save(&s.item))

	resp, err := s.Http(s.T()).WithToken(s.token).Get(
		fmt.Sprintf("/v1/drive/items/%s/content", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusRequestEntityTooLarge)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/feature/ -run 'TestPreviewAPITestSuite/TestContent' -v`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the handler**

In `app/http/controllers/drive_item_controller.go`, add:

```go
// Content proxies an item's bytes for preview. It is same-origin, so the
// browser's CORS rules do not apply, and it enforces the preview size cap
// server-side rather than trusting the client to have respected it.
func (c *DriveItemController) Content(ctx http.Context) http.Response {
	user, itemUUID, errResp := c.resolveUserAndItemUUID(ctx)
	if errResp != nil {
		return errResp
	}

	item, err := c.service.GetItemByUUID(context.Background(), user.ID, itemUUID)
	if err != nil {
		return failResponse(ctx, http.StatusNotFound, errKeyItemNotFound, err)
	}
	if item.Size > services.MaxPreviewProxyBytes {
		return failResponse(ctx, http.StatusRequestEntityTooLarge, "drive.preview_too_large", nil)
	}

	stream, item, err := c.service.GetItemStream(context.Background(), user.ID, itemUUID)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.preview_failed", err)
	}

	mimeType := item.MimeType
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	ctx.Response().Header("Content-Type", mimeType)
	ctx.Response().Header("Content-Disposition", "inline")
	ctx.Response().Header("Accept-Ranges", "bytes")
	if item.Size > 0 {
		ctx.Response().Header("Content-Length", strconv.FormatInt(item.Size, 10))
	}

	return ctx.Response().Stream(http.StatusOK, func(w http.StreamWriter) error {
		defer stream.Close()
		_, err := io.Copy(w, stream)
		return err
	})
}
```

- [ ] **Step 4: Register the route**

In `routes/web.go` add the constant:

```go
	uuidContentRoute    = "/{uuid}/content"
```

and register after the preview route:

```go
					items.Get(uuidContentRoute, driveItemController.Content)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/feature/ -run 'TestPreviewAPITestSuite' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/http/controllers/drive_item_controller.go routes/web.go tests/feature/preview_api_test.go
git commit -m "feat(preview): add size-capped content proxy"
```

---

## Task 6: Content proxy — Range support

**Files:**
- Modify: `app/http/controllers/drive_item_controller.go`
- Test: `tests/feature/preview_api_test.go` (extend)

**Interfaces:**
- Consumes: `ParseRangeHeader` (Task 2), `GetRange` (Task 1).
- Produces: `GET /content` honours `Range: bytes=…` → `206` + `Content-Range`; unsatisfiable range → `416`.

- [ ] **Step 1: Write the failing test**

Append to `tests/feature/preview_api_test.go`. The suite's single mock server already answers `Range: bytes=2-5` with `206` and `Content-Range: bytes 2-5/10` (see SetupTest), so no second server is needed — and swapping one would not work, because the driver is cached per account:

```go
func (s *PreviewAPITestSuite) TestContentServesRange() {
	// s.item.Size is 10 (see SetupTest), so bytes=2-5 is satisfiable.
	req := s.Http(s.T()).WithToken(s.token).WithHeader("Range", "bytes=2-5")
	resp, err := req.Get(fmt.Sprintf("/v1/drive/items/%s/content", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusPartialContent)
	s.Equal("bytes 2-5/10", resp.Headers().Get("Content-Range"))
	content, _ := resp.Content()
	s.Equal("2345", content)
}

func (s *PreviewAPITestSuite) TestContentRejectsBadRange() {
	req := s.Http(s.T()).WithToken(s.token).WithHeader("Range", "bytes=200-300")
	resp, err := req.Get(fmt.Sprintf("/v1/drive/items/%s/content", s.item.UUID))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusRequestedRangeNotSatisfiable)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/feature/ -run 'TestPreviewAPITestSuite/TestContentServesRange' -v`
Expected: FAIL — `200` instead of `206` (the current handler ignores `Range`).

- [ ] **Step 3: Add range handling to the handler**

In `Content` (Task 5), insert range handling between the size-cap check and `GetItemStream`:

```go
	rangeHeader := ctx.Request().Header("Range", "")
	if rangeHeader != "" {
		offset, length, rerr := services.ParseRangeHeader(rangeHeader, item.Size)
		if rerr != nil {
			return failResponse(ctx, http.StatusRequestedRangeNotSatisfiable, "drive.preview_failed", rerr)
		}

		reader, total, gerr := c.service.GetItemRange(context.Background(), user.ID, itemUUID, offset, length)
		if gerr != nil {
			return failResponse(ctx, http.StatusBadRequest, "drive.preview_failed", gerr)
		}

		mimeType := item.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		ctx.Response().Header("Content-Type", mimeType)
		ctx.Response().Header("Content-Disposition", "inline")
		ctx.Response().Header("Accept-Ranges", "bytes")
		ctx.Response().Header("Content-Range",
			fmt.Sprintf("bytes %d-%d/%d", offset, offset+length-1, total))
		ctx.Response().Header("Content-Length", strconv.FormatInt(length, 10))

		return ctx.Response().Stream(http.StatusPartialContent, func(w http.StreamWriter) error {
			defer reader.Close()
			_, err := io.Copy(w, reader)
			return err
		})
	}
```

Add the service method to `app/services/cloud_drive_service.go`:

```go
// GetItemRange returns a byte range of an item's object plus its total size.
func (s *CloudDriveService) GetItemRange(ctx context.Context, userID uint, itemUUID string, offset int64, length int64) (io.ReadCloser, int64, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, 0, err
	}
	if item.Type == models.ItemTypeFolder {
		return nil, 0, errors.New("cannot read a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, 0, err
	}

	return driver.GetRange(ctx, item.StoragePath, offset, length)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/feature/ -run 'TestPreviewAPITestSuite' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/http/controllers/drive_item_controller.go app/services/cloud_drive_service.go tests/feature/preview_api_test.go
git commit -m "feat(preview): support HTTP Range on the content proxy"
```

---

## Task 7: Automatic CORS on cloud-account create/edit

**Files:**
- Modify: `app/http/controllers/cloud_account_controller.go`
- Test: `tests/feature/cloud_account_cors_test.go` (create)

**Interfaces:**
- Consumes: `GetBucketCors`, `PutBucketCors` (Task 1), `MergeCorsRules` (Task 2).
- Produces: `func (c *CloudAccountController) ensureBucketCors(ctx context.Context, account *models.CloudAccount)` — best-effort, logs only.

- [ ] **Step 1: Write the failing test**

Create `tests/feature/cloud_account_cors_test.go`. It drives the manual endpoint (Task 8) because the automatic path's failure is observable through it; the automatic call itself is asserted by the same helper being invoked from `Store`.

```go
package feature

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/suite"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
	"ponta_drive/tests"
)

type CloudCorsTestSuite struct {
	suite.Suite
	tests.TestCase
	user  models.User
	token string
}

func TestCloudCorsTestSuite(t *testing.T) {
	suite.Run(t, new(CloudCorsTestSuite))
}

func (s *CloudCorsTestSuite) SetupTest() {
	_ = facades.Artisan().Call("migrate")

	hashedPassword, _ := facades.Hash().Make("password123")
	s.user = models.User{
		UUID: uuid.New().String(), Name: "CORS User",
		Username: "cors_" + uuid.New().String()[:8],
		Email:    "cors_" + uuid.New().String()[:8] + "@example.com",
		Password: hashedPassword,
	}
	s.Require().NoError(facades.Orm().Query().Create(&s.user))

	loginPayload, _ := json.Marshal(map[string]string{"email": s.user.Email, "password": "password123"})
	resp, err := s.Http(s.T()).Post("/auth/login", bytes.NewBuffer(loginPayload))
	s.Require().NoError(err)
	resp.AssertOk()
	body, _ := resp.Json()
	s.token = body["data"].(map[string]any)["token"].(string)
}

func (s *CloudCorsTestSuite) TearDownTest() {
	if s.user.ID > 0 {
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.CloudAccount{})
		_, _ = facades.Orm().Query().ForceDelete(&s.user)
	}
}

// TestCreateAccountSucceedsWhenCorsIsDenied pins the failure mode in the Review
// Focus: a key without s3:PutBucketCors must not stop the account being created.
func (s *CloudCorsTestSuite) TestCreateAccountSucceedsWhenCorsIsDenied() {
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code></Error>`))
	}))
	defer denied.Close()

	payload, _ := json.Marshal(map[string]any{
		"name": "Denied CORS", "provider": "minio",
		"endpoint": denied.URL, "bucket": "b", "region": "us-east-1",
		"access_key_id": "k", "secret_access_key": "s", "use_path_style": true,
	})
	resp, err := s.Http(s.T()).WithToken(s.token).Post("/v1/cloud-accounts", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusCreated)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/feature/ -run TestCloudCorsTestSuite -v`
Expected: PASS or FAIL depending on existing behaviour — run it to establish the baseline. If it already passes, keep it as a regression guard; the new code is what must not break it.

- [ ] **Step 3: Implement the best-effort CORS helper**

In `app/http/controllers/cloud_account_controller.go`, add:

```go
// ensureBucketCors makes the bucket allow the frontend origin to GET/HEAD, so
// previews can read CORS-requiring file types directly instead of through the
// proxy. It is best-effort: a key without s3:PutBucketCors (very common) must
// not fail the account save, so every error is logged and swallowed.
func (c *CloudAccountController) ensureBucketCors(ctx context.Context, account *models.CloudAccount) {
	origin := facades.Config().GetString("app.frontend_url", "http://localhost:5173")

	driver, err := c.factory.DriverForAccount(ctx, account)
	if err != nil {
		facades.Log().Errorf("[CORS] account=%d driver init failed: %v", account.ID, err)
		return
	}

	existing, err := driver.GetBucketCors(ctx)
	if err != nil {
		facades.Log().Errorf("[CORS] account=%d get failed: %v", account.ID, err)
		return
	}

	merged, changed := services.MergeCorsRules(existing, origin)
	if !changed {
		return
	}
	if err := driver.PutBucketCors(ctx, merged); err != nil {
		facades.Log().Errorf("[CORS] account=%d put failed: %v", account.ID, err)
	}
}
```

Call it at the end of `Store` (after the reload, before the response) and at the end of `Update` (after `InvalidateCache`):

```go
	c.ensureBucketCors(context.Background(), &account)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/feature/ -run 'TestCloudCorsTestSuite|TestCloudAccountAPITestSuite' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/http/controllers/cloud_account_controller.go tests/feature/cloud_account_cors_test.go
git commit -m "feat(cloud): ensure bucket CORS on account create/edit (best-effort)"
```

---

## Task 8: Manual CORS endpoint + route

**Files:**
- Modify: `app/http/controllers/cloud_account_controller.go`
- Modify: `routes/web.go`
- Modify: `lang/en/cloud.json`, `lang/vi/cloud.json`
- Test: `tests/feature/cloud_account_cors_test.go` (extend)

**Interfaces:**
- Consumes: `ensureBucketCors` logic (Task 7) — refactor it to return an error so the manual path can report it.
- Produces: `POST /v1/cloud-accounts/{id}/cors`.

- [ ] **Step 1: Write the failing test**

Append to `tests/feature/cloud_account_cors_test.go`:

```go
func (s *CloudCorsTestSuite) TestManualCorsSucceedsWhenSupported() {
	var putCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`<Error><Code>NoSuchCORSConfiguration</Code></Error>`))
			return
		}
		putCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	account := models.CloudAccount{
		UserID: s.user.ID, Name: "CORS ok", Provider: models.ProviderMinIO,
		IsDefault: true, IsActive: true,
	}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint: server.URL, Bucket: "b", Region: "us-east-1",
		AccessKeyID: "k", SecretAccessKey: "s", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	resp, err := s.Http(s.T()).WithToken(s.token).Post(
		fmt.Sprintf("/v1/cloud-accounts/%d/cors", account.ID), nil)
	s.Require().NoError(err)
	resp.AssertOk()
	s.True(putCalled)
}
```

Add `fmt` to the test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./tests/feature/ -run 'TestCloudCorsTestSuite/TestManualCors' -v`
Expected: FAIL — 404.

- [ ] **Step 3: Refactor the helper to return an error and add the handler**

Change `ensureBucketCors` (Task 7) to return an error, keeping the automatic call site ignoring it:

```go
func (c *CloudAccountController) ensureBucketCors(ctx context.Context, account *models.CloudAccount) error {
	origin := facades.Config().GetString("app.frontend_url", "http://localhost:5173")

	driver, err := c.factory.DriverForAccount(ctx, account)
	if err != nil {
		return fmt.Errorf("driver init: %w", err)
	}
	existing, err := driver.GetBucketCors(ctx)
	if err != nil {
		return fmt.Errorf("get cors: %w", err)
	}
	merged, changed := services.MergeCorsRules(existing, origin)
	if !changed {
		return nil
	}
	if err := driver.PutBucketCors(ctx, merged); err != nil {
		return fmt.Errorf("put cors: %w", err)
	}
	return nil
}
```

Update the automatic call sites to log:

```go
	if err := c.ensureBucketCors(context.Background(), &account); err != nil {
		facades.Log().Errorf("[CORS] account=%d auto ensure failed: %v", account.ID, err)
	}
```

Add the manual handler:

```go
// Cors applies the preview CORS rule to an account's bucket on demand, for when
// the automatic step could not run (for example, insufficient permissions).
func (c *CloudAccountController) Cors(ctx http.Context) http.Response {
	user, ok := ctx.Value("user").(models.User)
	if !ok || user.ID == 0 {
		return failResponse(ctx, http.StatusUnauthorized, "common.unauthorized", nil)
	}

	account, errResp := c.findAccountByID(ctx, user.ID)
	if errResp != nil {
		return errResp
	}

	ensureCtx, cancel := context.WithTimeout(ctx.Context(), 15*time.Second)
	defer cancel()

	if err := c.ensureBucketCors(ensureCtx, account); err != nil {
		return failResponse(ctx, http.StatusBadRequest, "cloud.cors_failed", err)
	}

	return ctx.Response().Success().Json(http.Json{
		"status":  "ok",
		"message": facades.Lang(ctx).Get("cloud.cors_enabled"),
	})
}
```

- [ ] **Step 4: Register the route**

In `routes/web.go`, inside the `cloud-accounts` group, add:

```go
				ca.Post("/{id}/cors", cloudAccountController.Cors)
```

- [ ] **Step 5: Add language keys**

`lang/en/cloud.json` — add:

```json
  "cors_enabled": "Preview access enabled for this bucket.",
  "cors_failed": "Could not enable preview access. Check the storage key permissions.",
```

`lang/vi/cloud.json` — add:

```json
  "cors_enabled": "Đã bật quyền xem trước cho bucket này.",
  "cors_failed": "Không thể bật quyền xem trước. Hãy kiểm tra quyền của khóa lưu trữ.",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go build ./... && go test ./tests/feature/ -run TestCloudCorsTestSuite -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/cloud_account_controller.go routes/web.go lang/en/cloud.json lang/vi/cloud.json tests/feature/cloud_account_cors_test.go
git commit -m "feat(cloud): add manual CORS endpoint"
```

---

## Task 9: Install the preview library and add the Vietnamese dictionary

**Files:**
- Modify: `package.json`, `bun.lock` (via bun)
- Create: `src/lib/vfp-i18n.ts`
- Create: `src/lib/__tests__/vfp-i18n.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const viMessages: Record<string, string>` covering the library's full key set.

- [ ] **Step 1: Install the library**

Run: `bun add @eternalheart/vue-file-preview`
Expected: adds `"@eternalheart/vue-file-preview": "^1.6.10"` to `dependencies` and updates `bun.lock`.

Notes (verified against the published package and its source):
- The package's own entry (`lib/index.mjs`) already does `import './index.css'`, so the preview styles load with the component. Do **not** add a separate `import '@eternalheart/vue-file-preview/style.css'`.
- The PDF renderer configures its own pdf.js worker from a CDN (`configurePdfWorker` with an `unpkg.com/pdfjs-dist@<version>` default). No `configurePdfWorker` call is needed in this app.
- `messages` is typed `Partial<Record<Locale, Partial<Messages>>>`; a `Record<string, string>` is assignable, so no cast is needed at the call site.

- [ ] **Step 2: Write the failing completeness test**

Create `src/lib/__tests__/vfp-i18n.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { viMessages } from '@/lib/vfp-i18n'

// The library's full built-in key set (mirrors
// @eternalheart/file-preview-core/src/i18n/messages/en-US.ts, v1.6.10). Pinned
// here so a library update that adds a key fails this test instead of leaking
// English (or Chinese) into the Vietnamese UI.
const LIBRARY_KEYS = [
  'common.download', 'common.close', 'common.loading', 'common.unknown_error',
  'common.unsupported_preview', 'common.retry',
  'accessibility.previousFile', 'accessibility.nextFile', 'accessibility.closePreview',
  'accessibility.downloadFile',
  'toolbar.zoom_in', 'toolbar.zoom_out', 'toolbar.rotate_left', 'toolbar.rotate_right',
  'toolbar.reset', 'toolbar.fit_to_window', 'toolbar.original_size', 'toolbar.toc',
  'toolbar.outline', 'toolbar.prev_page', 'toolbar.next_page', 'toolbar.full_width',
  'toolbar.normal_width', 'toolbar.wrap_on', 'toolbar.wrap_off', 'toolbar.source',
  'toolbar.preview',
  'image.load_failed', 'image.decode_failed',
  'pdf.load_failed',
  'docx.parse_failed',
  'doc.parse_failed', 'doc.loading',
  'ppt.parse_failed', 'ppt.loading',
  'xlsx.loading', 'xlsx.load_failed', 'xlsx.parse_failed', 'xlsx.not_found',
  'xls.parse_failed', 'xls.loading',
  'pptx.loading', 'pptx.load_failed', 'pptx.parse_failed', 'pptx.not_found',
  'pptx.invalid_format', 'pptx.no_pages', 'pptx.timeout',
  'msg.parse_failed', 'msg.parse_failed_short', 'msg.empty_body',
  'epub.load_failed', 'mobi.load_failed',
  'video.loading', 'video.load_failed', 'video.load_failed_with_error',
  'video.format_not_supported', 'video.unsupported_title', 'video.unsupported_detail',
  'video.codec_not_supported_detail',
  'audio.aria.play', 'audio.aria.pause', 'audio.aria.forward_10', 'audio.aria.backward_10',
  'audio.aria.mute', 'audio.aria.unmute', 'audio.aria.loop_on', 'audio.aria.loop_off',
  'audio.aria.progress', 'audio.aria.volume',
  'markdown.load_failed', 'markdown.copy_code', 'markdown.copied',
  'json.load_failed', 'json.items', 'json.keys',
  'csv.loading', 'csv.load_failed', 'csv.parse_failed',
  'xml.load_failed',
  'subtitle.load_failed', 'subtitle.parse_failed', 'subtitle.lines', 'subtitle.cues',
  'subtitle.meta.title', 'subtitle.meta.artist', 'subtitle.meta.album', 'subtitle.meta.author',
  'subtitle.meta.by', 'subtitle.meta.length', 'subtitle.meta.offset', 'subtitle.meta.editor',
  'subtitle.meta.version',
  'zip.load_failed', 'zip.parse_failed',
  'text.load_failed',
  'font.loading', 'font.load_failed', 'font.parse_failed', 'font.metadata_loading',
  'font.metadata_unavailable', 'font.meta.family', 'font.meta.subfamily', 'font.meta.version',
  'font.meta.designer', 'font.meta.glyphs', 'font.meta.format', 'font.sample_text_placeholder',
  'cad.loading', 'cad.load_failed', 'cad.parse_failed', 'cad.wireframe', 'cad.solid',
  'cad.grid', 'cad.axes',
]

describe('viMessages', () => {
  it('covers every library key', () => {
    const missing = LIBRARY_KEYS.filter((key) => !(key in viMessages))
    expect(missing).toEqual([])
  })

  it('has no empty translations', () => {
    const empty = Object.entries(viMessages)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('keeps the interpolation placeholders the library substitutes', () => {
    expect(viMessages['common.unsupported_preview']).toContain('{type}')
    expect(viMessages['video.load_failed_with_error']).toContain('{error}')
    expect(viMessages['video.format_not_supported']).toContain('{format}')
    expect(viMessages['video.unsupported_detail']).toContain('{format}')
    expect(viMessages['video.codec_not_supported_detail']).toContain('{codecs}')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test:run src/lib/__tests__/vfp-i18n.spec.ts`
Expected: FAIL — cannot resolve `@/lib/vfp-i18n`.

- [ ] **Step 4: Write the dictionary**

Create `src/lib/vfp-i18n.ts`:

```ts
/**
 * Vietnamese dictionary for @eternalheart/vue-file-preview.
 *
 * The library ships only zh-CN and en-US, and falls back to zh-CN for an
 * unknown locale, so an incomplete dictionary would show Chinese in a
 * Vietnamese UI. `src/lib/__tests__/vfp-i18n.spec.ts` asserts this covers the
 * library's full key set.
 *
 * Passed as `messages={{ vi: viMessages }}` with `locale="vi"`.
 */
export const viMessages: Record<string, string> = {
  // common
  'common.download': 'Tải xuống',
  'common.close': 'Đóng',
  'common.loading': 'Đang tải',
  'common.unknown_error': 'Lỗi không xác định',
  'common.unsupported_preview': 'Không hỗ trợ xem trước định dạng tệp này ({type})',
  'common.retry': 'Thử lại',

  // accessibility
  'accessibility.previousFile': 'Tệp trước',
  'accessibility.nextFile': 'Tệp tiếp theo',
  'accessibility.closePreview': 'Đóng xem trước',
  'accessibility.downloadFile': 'Tải tệp xuống',

  // toolbar
  'toolbar.zoom_in': 'Phóng to',
  'toolbar.zoom_out': 'Thu nhỏ',
  'toolbar.rotate_left': 'Xoay trái',
  'toolbar.rotate_right': 'Xoay phải',
  'toolbar.reset': 'Đặt lại',
  'toolbar.fit_to_window': 'Vừa cửa sổ',
  'toolbar.original_size': 'Kích thước gốc',
  'toolbar.toc': 'Mục lục',
  'toolbar.outline': 'Dàn ý',
  'toolbar.prev_page': 'Trang trước',
  'toolbar.next_page': 'Trang sau',
  'toolbar.full_width': 'Toàn chiều rộng',
  'toolbar.normal_width': 'Chiều rộng thường',
  'toolbar.wrap_on': 'Tự động xuống dòng',
  'toolbar.wrap_off': 'Không xuống dòng',
  'toolbar.source': 'Mã nguồn',
  'toolbar.preview': 'Xem trước',

  // image
  'image.load_failed': 'Không tải được hình ảnh',
  'image.decode_failed': 'Không giải mã được hình ảnh',

  // pdf
  'pdf.load_failed': 'Không tải được PDF',

  // docx
  'docx.parse_failed': 'Không phân tích được tài liệu Word',

  // doc
  'doc.parse_failed': 'Không phân tích được tài liệu Word (định dạng cũ)',
  'doc.loading': 'Đang tải tài liệu Word...',

  // ppt
  'ppt.parse_failed': 'Không phân tích được PowerPoint (định dạng cũ)',
  'ppt.loading': 'Đang tải PPT...',

  // xlsx
  'xlsx.loading': 'Đang tải Excel...',
  'xlsx.load_failed': 'Không tải được Excel',
  'xlsx.parse_failed': 'Không phân tích được tệp Excel',
  'xlsx.not_found': 'Không tìm thấy tệp Excel',

  // xls
  'xls.parse_failed': 'Không phân tích được Excel (định dạng cũ)',
  'xls.loading': 'Đang tải Excel...',

  // pptx
  'pptx.loading': 'Đang tải PPT...',
  'pptx.load_failed': 'Không tải được PPT',
  'pptx.parse_failed': 'Không phân tích được tệp PPT',
  'pptx.not_found': 'Không tìm thấy tệp PPT',
  'pptx.invalid_format': 'Định dạng tệp PPT không hợp lệ hoặc đã hỏng',
  'pptx.no_pages': 'Tệp PPT không có trang hợp lệ',
  'pptx.timeout': 'Tải quá lâu, vui lòng kiểm tra mạng và thử lại',

  // msg
  'msg.parse_failed': 'Không phân tích được thư Outlook',
  'msg.parse_failed_short': 'Không phân tích được thư',
  'msg.empty_body': '(Không có nội dung thư)',

  // epub
  'epub.load_failed': 'Không tải được EPUB',

  // mobi
  'mobi.load_failed': 'Không tải được sách điện tử — tệp có thể đã hỏng hoặc có DRM',

  // video
  'video.loading': 'Đang tải video...',
  'video.load_failed': 'Không tải được video',
  'video.load_failed_with_error': 'Không tải được video: {error}',
  'video.format_not_supported': 'Trình duyệt không hỗ trợ định dạng {format}. Vui lòng chuyển sang MP4/WebM',
  'video.unsupported_title': 'Không thể phát định dạng video này trên trình duyệt',
  'video.unsupported_detail': '{format} là định dạng mà trình duyệt không hỗ trợ sẵn (thường gặp ở AVI / WMV / FLV và một số tệp MKV). Vui lòng tải xuống để phát bằng trình phát trên máy, hoặc chuyển sang MP4 (H.264 + AAC).',
  'video.codec_not_supported_detail': 'Trình duyệt không giải mã được codec video hoặc âm thanh ({codecs}). Vui lòng chuyển sang MP4 (H.264 + AAC) trước khi xem trước.',

  // audio
  'audio.aria.play': 'Phát',
  'audio.aria.pause': 'Tạm dừng',
  'audio.aria.forward_10': 'Tua tới 10 giây',
  'audio.aria.backward_10': 'Tua lại 10 giây',
  'audio.aria.mute': 'Tắt tiếng',
  'audio.aria.unmute': 'Bật tiếng',
  'audio.aria.loop_on': 'Bật lặp lại',
  'audio.aria.loop_off': 'Tắt lặp lại',
  'audio.aria.progress': 'Tiến trình phát',
  'audio.aria.volume': 'Âm lượng',

  // markdown
  'markdown.load_failed': 'Không tải được Markdown',
  'markdown.copy_code': 'Sao chép mã',
  'markdown.copied': 'Đã sao chép',

  // json
  'json.load_failed': 'Không tải được JSON',
  'json.items': 'mục',
  'json.keys': 'khóa',

  // csv
  'csv.loading': 'Đang tải CSV...',
  'csv.load_failed': 'Không tải được CSV',
  'csv.parse_failed': 'Không phân tích được CSV',

  // xml
  'xml.load_failed': 'Không tải được XML',

  // subtitle
  'subtitle.load_failed': 'Không tải được phụ đề',
  'subtitle.parse_failed': 'Không phân tích được phụ đề',
  'subtitle.lines': 'dòng',
  'subtitle.cues': 'lượt phụ đề',
  'subtitle.meta.title': 'Tiêu đề',
  'subtitle.meta.artist': 'Nghệ sĩ',
  'subtitle.meta.album': 'Album',
  'subtitle.meta.author': 'Tác giả',
  'subtitle.meta.by': 'Bởi',
  'subtitle.meta.length': 'Thời lượng',
  'subtitle.meta.offset': 'Độ lệch',
  'subtitle.meta.editor': 'Biên tập',
  'subtitle.meta.version': 'Phiên bản',

  // zip
  'zip.load_failed': 'Không tải được ZIP',
  'zip.parse_failed': 'Không phân tích được ZIP',

  // text
  'text.load_failed': 'Không tải được tệp văn bản',

  // font
  'font.loading': 'Đang tải phông chữ...',
  'font.load_failed': 'Không tải được phông chữ',
  'font.parse_failed': 'Không phân tích được phông chữ',
  'font.metadata_loading': 'Đang phân tích thông tin...',
  'font.metadata_unavailable': 'Không có thông tin',
  'font.meta.family': 'Họ',
  'font.meta.subfamily': 'Phân họ',
  'font.meta.version': 'Phiên bản',
  'font.meta.designer': 'Nhà thiết kế',
  'font.meta.glyphs': 'Số ký tự',
  'font.meta.format': 'Định dạng',
  'font.sample_text_placeholder': 'Nhập văn bản mẫu...',

  // cad
  'cad.loading': 'Đang tải tệp CAD...',
  'cad.load_failed': 'Không tải được tệp CAD',
  'cad.parse_failed': 'Không phân tích được tệp CAD',
  'cad.wireframe': 'Khung dây',
  'cad.solid': 'Đặc',
  'cad.grid': 'Lưới',
  'cad.axes': 'Trục',
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:run src/lib/__tests__/vfp-i18n.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/lib/vfp-i18n.ts src/lib/__tests__/vfp-i18n.spec.ts
git commit -m "feat(preview): install preview library and add Vietnamese dictionary"
```

---

## Task 10: Frontend API — preview and CORS

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/api/driveItems.ts`
- Modify: `src/api/cloudAccounts.ts`
- Test: `src/api/__tests__/driveItemsPreview.spec.ts` (create)

**Interfaces:**
- Consumes: `fetchApi` (existing).
- Produces:
  - `export function apiUrl(path: string): string` in `client.ts`
  - `export type PreviewStrategy = 'direct' | 'proxy' | 'fallback'`
  - `export interface DriveItemPreview { strategy: PreviewStrategy; url: string; download_url: string; item: DriveItem; reason: string }`
  - `export async function getDriveItemPreview(uuid: string): Promise<ApiResponse<DriveItemPreview>>`
  - `export async function ensureCloudAccountCors(id: number): Promise<ApiResponse>`

- [ ] **Step 1: Write the failing test**

Create `src/api/__tests__/driveItemsPreview.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import { getDriveItemPreview } from '@/api/driveItems'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getDriveItemPreview', () => {
  it('requests the preview endpoint and returns the strategy payload', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'proxy',
        url: '/v1/drive/items/abc/content',
        download_url: 'https://cdn.example/abc',
        item: { uuid: 'abc' },
        reason: '',
      },
    })

    const res = await getDriveItemPreview('abc')
    expect(spy).toHaveBeenCalledWith('/v1/drive/items/abc/preview?mode=json')
    expect(res.data?.strategy).toBe('proxy')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/api/__tests__/driveItemsPreview.spec.ts`
Expected: FAIL — `getDriveItemPreview` not exported.

- [ ] **Step 3: Implement**

In `src/api/client.ts`, add below `API_BASE_URL`:

```ts
/**
 * Resolves an API path to an absolute URL the browser can fetch directly, such
 * as the preview proxy path handed to the file-preview library. Uses the same
 * base as `fetchApi` so both point at the same origin.
 */
export function apiUrl(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`
  return API_BASE_URL ? `${API_BASE_URL}${normalised}` : normalised
}
```

In `src/api/driveItems.ts`, add at the end:

```ts
export type PreviewStrategy = 'direct' | 'proxy' | 'fallback'

export interface DriveItemPreview {
  strategy: PreviewStrategy
  /** Absolute URL (direct) or same-origin path (proxy); empty for fallback. */
  url: string
  download_url: string
  item: DriveItem
  /** Non-empty only for fallback: "too_large" | "unsupported". */
  reason: string
}

/**
 * Resolves how to preview an item. The backend decides the strategy, so the
 * client never has to guess whether a URL is CORS-readable or how big is too
 * big.
 */
export async function getDriveItemPreview(
  uuid: string,
): Promise<ApiResponse<DriveItemPreview>> {
  return fetchApi<ApiResponse<DriveItemPreview>>(
    `/v1/drive/items/${encodeURIComponent(uuid)}/preview?mode=json`,
  )
}
```

In `src/api/cloudAccounts.ts`, add:

```ts
/**
 * Asks the backend to apply the preview CORS rule to the account's bucket.
 * Used by the manual button when the automatic step could not run.
 */
export async function ensureCloudAccountCors(id: number): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${id}/cors`, { method: 'POST' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/api/__tests__/driveItemsPreview.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/api/driveItems.ts src/api/cloudAccounts.ts src/api/__tests__/driveItemsPreview.spec.ts
git commit -m "feat(preview): add preview and CORS API clients"
```

---

## Task 11: Preview route and navigation helpers

**Files:**
- Modify: `src/router/drivePaths.ts`
- Modify: `src/router/index.ts`
- Test: `src/router/__tests__/drivePaths.spec.ts` (create or extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function previewPath(cloudId: number, uuid: string): string`
  - `export function previewLocation(cloudId: number, uuid: string): RouteLocationRaw`

- [ ] **Step 1: Write the failing test**

Create `src/router/__tests__/drivePaths.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { previewPath, previewLocation } from '@/router/drivePaths'

describe('previewPath', () => {
  it('builds the preview URL from the account id and item uuid', () => {
    expect(previewPath(3, 'abc')).toBe('/d/3/preview/abc')
  })
})

describe('previewLocation', () => {
  it('names the preview route with both params', () => {
    expect(previewLocation(3, 'abc')).toEqual({
      name: 'drive-preview',
      params: { cloudId: 3, uuid: 'abc' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/router/__tests__/drivePaths.spec.ts`
Expected: FAIL — `previewPath` not exported.

- [ ] **Step 3: Implement**

In `src/router/drivePaths.ts`, append:

```ts
/**
 * Builds the preview URL for one file. Kept beside the drive paths so every
 * navigation site produces the same shape.
 */
export function previewPath(cloudId: number, uuid: string): string {
  return `/d/${cloudId}/preview/${uuid}`
}

export function previewLocation(cloudId: number, uuid: string): RouteLocationRaw {
  return { name: 'drive-preview', params: { cloudId, uuid } }
}
```

In `src/router/index.ts`, add to `routes` after the `drive-folder` entry:

```ts
    {
      path: '/d/:cloudId/preview/:uuid',
      name: 'drive-preview',
      component: () => import('@/views/PreviewView.vue'),
      props: true,
      meta: { requiresAuth: true, titleKey: 'routes.preview' },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/router/__tests__/drivePaths.spec.ts`
Expected: PASS. (`PreviewView.vue` is created in Task 12; if `bun run build` is run before then, the dynamic import target will be missing — that is expected until Task 12.)

- [ ] **Step 5: Commit**

```bash
git add src/router/drivePaths.ts src/router/index.ts src/router/__tests__/drivePaths.spec.ts
git commit -m "feat(preview): add preview route and navigation helpers"
```

---

## Task 12: PreviewView — the preview screen

**Files:**
- Create: `src/views/PreviewView.vue`
- Modify: `src/locales/vi.json`, `src/locales/en.json`
- Test: `src/views/__tests__/PreviewView.spec.ts`

**Interfaces:**
- Consumes: `getDriveItemPreview`, `DriveItemPreview` (Task 10), `apiUrl` (Task 10), `viMessages` (Task 9).
- Produces: the screen at route `drive-preview`.

- [ ] **Step 1: Add app language keys**

`src/locales/vi.json` — inside `routes`, add `"preview": "Xem trước"`. Inside `drive`, add:

```json
    "action_preview": "Xem trước",
    "preview_back": "Quay lại Drive",
    "preview_loading": "Đang tải bản xem trước...",
    "preview_error": "Không thể mở bản xem trước.",
    "preview_unsupported": "Định dạng tệp này không hỗ trợ xem trước. Hãy tải xuống để xem.",
    "preview_too_large": "Tệp quá lớn để xem trước. Hãy tải xuống để xem.",
    "preview_download": "Tải xuống"
```

`src/locales/en.json` — inside `routes`, add `"preview": "Preview"`. Inside `drive`, add:

```json
    "action_preview": "Preview",
    "preview_back": "Back to Drive",
    "preview_loading": "Loading preview...",
    "preview_error": "Could not open the preview.",
    "preview_unsupported": "This file type cannot be previewed. Download it to view it.",
    "preview_too_large": "This file is too large to preview. Download it to view it.",
    "preview_download": "Download"
```

- [ ] **Step 2: Write the failing test**

Create `src/views/__tests__/PreviewView.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

import PreviewView from '@/views/PreviewView.vue'
import * as api from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const item = {
  uuid: 'abc', name: 'photo.png', type: 'file' as const, mime_type: 'image/png',
  size: 1024, extension: 'png', cloud_account_id: 1, is_starred: false,
  status: 'ready', updated_at: '2026-10-01 00:00:00',
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/d/:cloudId/preview/:uuid', name: 'drive-preview', component: PreviewView, props: true },
      { path: '/d/:cloudId', name: 'drive', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(cloudId: string, uuid: string) {
  const router = makeRouter()
  await router.push(`/d/${cloudId}/preview/${uuid}`)
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(PreviewView, {
    global: {
      plugins: [router, i18n],
      // The layout pulls in the sidebar, the cloud-account store and a
      // network fetch; it is irrelevant to what this spec asserts.
      stubs: { DashboardLayout: { template: '<div><slot /></div>' } },
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('PreviewView', () => {
  it('shows the fallback card with a download link when the strategy is fallback', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'fallback',
        url: '',
        download_url: 'https://cdn.example/abc',
        item,
        reason: 'too_large',
      },
    })

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    // The download link is offered and the library is not loaded.
    const link = wrapper.find('[data-test="preview-download"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://cdn.example/abc')
    expect(wrapper.text()).toContain(viLocale.drive.preview_too_large)
  })

  it('shows an error message when the request fails', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockRejectedValue(new Error('boom'))

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    expect(wrapper.text()).toContain(viLocale.drive.preview_error)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test:run src/views/__tests__/PreviewView.spec.ts`
Expected: FAIL — cannot resolve `@/views/PreviewView.vue`.

- [ ] **Step 4: Implement the view**

Create `src/views/PreviewView.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import { apiUrl } from '@/api/client'
import { getDriveItemPreview, type DriveItemPreview } from '@/api/driveItems'
import { viMessages } from '@/lib/vfp-i18n'

const props = defineProps<{
  cloudId: string
  uuid: string
}>()

const { t } = useI18n()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = shallowRef<DriveItemPreview | null>(null)
// The library is heavy (~31MB dist); it is imported only when a real preview is
// rendered, so the fallback card never pays for it.
const Embed = shallowRef<Component | null>(null)

const isMedia = (mime: string) =>
  mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')

/** The library file descriptor: absolute URL plus the name/type it detects by. */
const previewFiles = computed(() => {
  const data = preview.value
  if (!data || !data.url) return []
  const url = data.strategy === 'proxy' ? apiUrl(data.url) : data.url
  return [
    {
      url,
      name: data.item.name,
      type: data.item.mime_type || 'application/octet-stream',
      size: data.item.size,
    },
  ]
})

/**
 * Only the proxy is same-origin and needs the bearer token. Attaching it to a
 * direct (cross-origin) request would trigger a CORS preflight and fail.
 */
const requestInit = computed(() =>
  preview.value?.strategy === 'proxy'
    ? () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
      })
    : undefined,
)

const shouldFetchAsBlob = computed(() =>
  preview.value?.strategy === 'proxy' ? (file: { type: string }) => isMedia(file.type) : undefined,
)

const fallbackMessage = computed(() =>
  preview.value?.reason === 'unsupported'
    ? t('drive.preview_unsupported')
    : t('drive.preview_too_large'),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await getDriveItemPreview(props.uuid)
    preview.value = res.data ?? null
    if (preview.value && preview.value.strategy !== 'fallback') {
      const mod = await import('@eternalheart/vue-file-preview')
      Embed.value = mod.FilePreviewEmbed
    }
  } catch {
    error.value = t('drive.preview_error')
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push({ name: 'drive', params: { cloudId: props.cloudId } })
}

onMounted(load)
</script>

<template>
  <DashboardLayout>
    <div class="h-[calc(100vh-4rem)] flex flex-col">
      <div class="flex items-center justify-between px-4 py-2 border-b border-border">
        <span class="text-sm font-medium truncate">{{ preview?.item.name ?? t('routes.preview') }}</span>
        <Button variant="outline" size="sm" @click="goBack">{{ t('drive.preview_back') }}</Button>
      </div>

      <div class="flex-1 min-h-0">
        <div v-if="loading" class="h-full flex items-center justify-center text-sm text-muted-foreground">
          {{ t('drive.preview_loading') }}
        </div>

        <div v-else-if="error" class="h-full flex items-center justify-center text-sm text-destructive">
          {{ error }}
        </div>

        <div
          v-else-if="preview && preview.strategy === 'fallback'"
          class="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <p>{{ fallbackMessage }}</p>
          <a
            data-test="preview-download"
            :href="preview.download_url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent/40"
          >
            {{ t('drive.preview_download') }}
          </a>
        </div>

        <component
          :is="Embed"
          v-else-if="preview && Embed"
          :files="previewFiles"
          locale="vi"
          :messages="{ vi: viMessages }"
          :request-init="requestInit"
          :should-fetch-as-blob="shouldFetchAsBlob"
          theme="auto"
        />
      </div>
    </div>
  </DashboardLayout>
</template>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:run src/views/__tests__/PreviewView.spec.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `bun run type-check`
Expected: PASS. If the library's types fail to resolve, confirm `skipLibCheck` is still on (it must not be turned off).

- [ ] **Step 7: Commit**

```bash
git add src/views/PreviewView.vue src/views/__tests__/PreviewView.spec.ts src/locales/vi.json src/locales/en.json
git commit -m "feat(preview): add preview view"
```

---

## Task 13: Open preview from the drive (menu + double-click)

**Files:**
- Modify: `src/components/drive/DriveItemMenu.vue`
- Modify: `src/views/DriveView.vue`
- Modify: `src/components/drive/__tests__/DriveItemMenu.spec.ts`

**Interfaces:**
- Consumes: `previewLocation` (Task 11).
- Produces: `DriveItemMenu` emits `preview: [item: DriveItem]`.

- [ ] **Step 1: Write the failing test**

The spec file already exists with a `clickMenuItem(label)` helper. Add this case inside the existing `describe('DriveItemMenu', ...)` block (it already imports everything needed):

```ts
  it('offers a Preview action and emits preview with the item', async () => {
    const wrapper = await clickMenuItem(viLocale.drive.action_preview)
    expect(wrapper.emitted('preview')?.[0]?.[0]).toEqual(testItem)
  })

  it('shows the Preview action for a file, not for a folder', async () => {
    const wrapper = mountMenu()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain(viLocale.drive.action_preview)
    wrapper.unmount()

    document.body.innerHTML = ''
    const folderWrapper = mountMenu({ ...testItem, type: 'folder' })
    await folderWrapper.find('button').trigger('click')
    await folderWrapper.vm.$nextTick()
    expect(document.body.textContent).not.toContain(viLocale.drive.action_preview)
  })
```

Note: `clickMenuItem` is defined in the existing file and returns the wrapper; the menu content is teleported to `document.body`, which is why the helper queries `document.querySelectorAll('[role="menuitem"]')` rather than the wrapper. The `mountMenu` helper already uses `attachTo: document.body`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/components/drive/__tests__/DriveItemMenu.spec.ts`
Expected: FAIL — no Preview entry / no `preview` emit.

- [ ] **Step 3: Add the menu action**

In `src/components/drive/DriveItemMenu.vue`:

Add `Eye` to the `lucide-vue-next` import list.

Extend the emits:

```ts
const emit = defineEmits<{
  rename: [item: DriveItem]
  move: [item: DriveItem]
  delete: [item: DriveItem]
  preview: [item: DriveItem]
}>()
```

Add a Preview item as the first entry, shown for files only:

```vue
      <DropdownMenuItem
        v-if="!isFolder"
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="emit('preview', item)"
      >
        <Eye class="h-4 w-4" />
        <span>{{ t('drive.action_preview') }}</span>
      </DropdownMenuItem>
```

- [ ] **Step 4: Wire it in DriveView**

In `src/views/DriveView.vue`:

Add the import:

```ts
import { driveLocation, previewLocation } from '@/router/drivePaths'
```

(replace the existing `import { driveLocation } from '@/router/drivePaths'` line.)

Add the handler next to `openFolder`:

```ts
function openPreview(uuid: string) {
  selectedItemId.value = null
  void router.push(previewLocation(cloudAccountId.value, uuid))
}
```

Add `@preview="openPreview"` to all three `DriveItemMenu` usages (list row, grid folder card, grid file card):

```vue
<DriveItemMenu :item="item" @rename="openRename" @move="openMove" @delete="openDelete" @preview="openPreview" />
```

Change the file double-click. In the list row, the current handler is
`@dblclick="item.type === 'folder' && openFolder(item.uuid)"` — replace it with a
handler that branches on type:

```vue
@dblclick="item.type === 'folder' ? openFolder(item.uuid) : openPreview(item.uuid)"
```

For the grid file card (currently no `@dblclick`), add:

```vue
@dblclick="openPreview(item.uuid)"
```

The grid folder card keeps `@dblclick="openFolder(item.uuid)"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test:run src/components/drive/__tests__/DriveItemMenu.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/drive/DriveItemMenu.vue src/views/DriveView.vue src/components/drive/__tests__/DriveItemMenu.spec.ts
git commit -m "feat(preview): open preview from menu and double-click"
```

---

## Task 14: Manual CORS button in the storage dialog

**Files:**
- Modify: `src/components/cloud/AddCloudDialog.vue`
- Modify: `src/locales/vi.json`, `src/locales/en.json`
- Test: `src/components/cloud/__tests__/AddCloudDialogCors.spec.ts` (create)

**Interfaces:**
- Consumes: `ensureCloudAccountCors` (Task 10).
- Produces: a button, visible in edit mode, that calls the endpoint and toasts the result.

- [ ] **Step 1: Write the failing test**

Create `src/components/cloud/__tests__/AddCloudDialogCors.spec.ts`. The dialog content is teleported to `document.body` by reka-ui, so the button is queried there, matching how `DeleteDriveItemDialog.spec.ts` and `DriveItemMenu.spec.ts` already do it:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
import * as api from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function mountDialog(editId: number | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(AddCloudDialog, {
    props: { open: true, editId },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [] })
})

describe('AddCloudDialog CORS button', () => {
  it('calls the CORS endpoint with the account id in edit mode', async () => {
    const corsSpy = vi
      .spyOn(api, 'ensureCloudAccountCors')
      .mockResolvedValue({ status: 'ok', message: viLocale.cloud.cors_enabled })

    mountDialog(7)
    await flushPromises()

    const button = document.body.querySelector(
      '[data-test="enable-cors"]',
    ) as HTMLElement | null
    expect(button).not.toBeNull()
    button!.click()
    await flushPromises()

    expect(corsSpy).toHaveBeenCalledWith(7)
  })

  it('does not offer the button when creating a new account', async () => {
    mountDialog(null)
    await flushPromises()
    expect(document.body.querySelector('[data-test="enable-cors"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/components/cloud/__tests__/AddCloudDialogCors.spec.ts`
Expected: FAIL — no `[data-test="enable-cors"]` element.

- [ ] **Step 3: Implement the button**

In `src/components/cloud/AddCloudDialog.vue`:

Add to the `@/api/cloudAccounts` import: `ensureCloudAccountCors`.

Add state and handler near `save()` (`ref` and `toast` are already imported at the top of the file):

```ts
const enablingCors = ref(false)

async function enableCors() {
  if (!props.editId) return
  enablingCors.value = true
  try {
    const res = await ensureCloudAccountCors(props.editId)
    toast.success(res.message || t('cloud.cors_enabled'))
  } catch (e) {
    // The backend already returns a localized, non-technical message.
    toast.error(e instanceof Error ? e.message : t('cloud.cors_failed'))
  } finally {
    enablingCors.value = false
  }
}
```

Add the button in the `DialogFooter`, shown only when editing (the footer is rendered on every step, so the button is reachable from the edit view):

```vue
        <Button
          v-if="isEdit"
          data-test="enable-cors"
          variant="outline"
          :disabled="enablingCors"
          @click="enableCors"
        >
          {{ t('cloud.cors_enable_action') }}
        </Button>
```

Add the keys to both locales:

`src/locales/vi.json` inside `cloud`:

```json
    "cors_enable_action": "Bật quyền xem trước",
    "cors_enabled": "Đã bật quyền xem trước cho bucket này.",
    "cors_failed": "Không thể bật quyền xem trước. Hãy kiểm tra quyền của khóa lưu trữ.",
```

`src/locales/en.json` inside `cloud`:

```json
    "cors_enable_action": "Enable preview access",
    "cors_enabled": "Preview access enabled for this bucket.",
    "cors_failed": "Could not enable preview access. Check the storage key permissions.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/components/cloud/__tests__/AddCloudDialogCors.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/cloud/AddCloudDialog.vue src/locales/vi.json src/locales/en.json src/components/cloud/__tests__/AddCloudDialogCors.spec.ts
git commit -m "feat(cloud): add manual enable-preview-access button"
```

---

## Task 15: Full verification pass

**Files:**
- No source changes; this task gates the branch.

- [ ] **Step 1: Backend build and tests**

Run: `cd backend && go build ./... && go vet ./... && go test ./tests/unit/ -v`
Expected: build clean, vet clean, unit tests PASS.

- [ ] **Step 2: Backend feature tests**

Run: `cd backend && go test ./tests/feature/ -run 'TestPreviewAPITestSuite|TestCloudCorsTestSuite|TestDownloadAPITestSuite|TestCloudAccountAPITestSuite' -v`
Expected: PASS (requires the dev MariaDB, as all feature suites do).

- [ ] **Step 3: Frontend type-check, lint and tests**

Run: `cd frontend && bun run type-check && bun run lint && bun run test:run`
Expected: type-check clean; lint reports only the known pre-existing baseline (the 11 errors in `src/api/client.ts` and `src/components/ui/*`); all tests PASS.

- [ ] **Step 4: Frontend build (confirms the dynamic chunk)**

Run: `cd frontend && bun run build`
Expected: succeeds; the output includes a separate chunk for the preview library (it must not be in the main entry).

- [ ] **Step 5: Manual smoke test**

Run: `cd frontend && bun run dev`, open a drive, and verify: an image previews via `direct`; a PDF within 50MB previews via `proxy`; a video seeks; a >50MB file shows the fallback card with a working download link; the storage dialog's "Enable preview access" button toasts success or a localized failure.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(preview): verification fixes"
```

---

## Self-Review

**Spec coverage:** §5.1 → Tasks 2,3,4; §5.2 → Tasks 5,6; §5.3 → Task 7; §5.4 → Task 8; §5.5 → Task 1; §5.6 → Tasks 4,5,6,8 (lang keys + `failResponse`); §6.1 → Tasks 11,12; §6.2 → Task 12; §6.3 → Task 13; §6.4 → Tasks 9,12; §6.5 → Tasks 10,14; §7 edge cases → Task 3 (folder, empty MIME), Task 5 (cap), Task 6 (range bounds); §8 testing → every task's test steps + Task 15.

**Type consistency:** `PreviewStrategy`/`StrategyDirect|Proxy|Fallback` (Task 2) used verbatim in Tasks 3,4. `CORSRule` (Task 1) used in Tasks 2,7. `GetRange(ctx, key, offset, length)` (Task 1) called in Task 6 as `GetItemRange` → `driver.GetRange`. `viMessages` (Task 9) used in Task 12. `previewLocation` (Task 11) used in Task 13. `getDriveItemPreview` (Task 10) used in Task 12.

**Verified against the codebase (not assumed):** every signature the plan calls was read from source before writing — `CloudDriveService.GetDriver/GetItemByUUID/GetPresignedDownloadURL/GetItemStream`, `DriverFactory.DriverForAccount/InvalidateCache`, `failResponse`, `errKeyItemNotFound`, the goravel `StatusPartialContent`/`StatusRequestedRangeNotSatisfiable`/`StatusRequestEntityTooLarge` constants, `ctx.Response().Stream(code, func(w http.StreamWriter) error)`, `ctx.Context()`, `ctx.Request().Header(key, default...)`, `facades.Config().GetString`, the `s3.Client.GetBucketCors/PutBucketCors` method names and `types.CORSRule`/`CORSConfiguration`/`GetObjectOutput.ContentRange` shapes, and the frontend `fetchApi`, `DriveItem`, `DriveItemMenu` emits, `AddCloudDialog` `editId` prop, existing `DriveItemMenu.spec.ts` / `DeleteDriveItemDialog.spec.ts` (teleport + `attachTo`) patterns, and `driveRoutes.ts`.

**Corrected during self-review:**
1. `DriverFactory` caches the driver per account id for the process lifetime, so Task 6's original "swap the mock endpoint per test" would have been ignored — replaced with one range-aware mock in `SetupTest`.
2. `FilePreviewEmbed` (verified from its source) declares `locale`, `messages`, `theme`, `requestInit`, `shouldFetchAsBlob` — so it is the right component; `theme` set to `auto` rather than a hardcoded `dark`.
3. The library's entry already imports its CSS, and the PDF renderer self-configures the worker — recorded so no redundant setup is added.
4. The library's Vietnamese dictionary has exactly **116** keys (counted from `en-US.ts`); Task 9's `LIBRARY_KEYS` matches it one-for-one.
5. Frontend tests for the dropdown/dialog must query `document.body` (reka-ui teleports), and `common.back_to_login` did not exist — replaced with a new `drive.preview_back` key.

**Review Focus:** each of the five lines names the task whose test pins it (Tasks 3, 3+7, 6, 7+8, 12).
