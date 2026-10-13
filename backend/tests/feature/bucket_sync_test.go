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

type BucketSyncTestSuite struct {
	suite.Suite
	tests.TestCase
	user       models.User
	token      string
	account    models.CloudAccount
	mockServer *httptest.Server
}

func TestBucketSyncTestSuite(t *testing.T) {
	suite.Run(t, new(BucketSyncTestSuite))
}

func (s *BucketSyncTestSuite) SetupTest() {
	_ = facades.Artisan().Call("migrate")

	// Start mock S3 server returning ListObjectsV2 XML response
	s.mockServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if query.Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mock-bucket</Name>
  <Prefix></Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>photos/vacation/beach.jpg</Key>
    <LastModified>2026-09-20T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-beach"</ETag>
    <Size>2048576</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <Contents>
    <Key>readme.txt</Key>
    <LastModified>2026-09-20T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-readme"</ETag>
    <Size>1024</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`))
			return
		}

		w.WriteHeader(http.StatusOK)
	}))

	hashedPassword, _ := facades.Hash().Make("password123")
	s.user = models.User{
		UUID:     uuid.New().String(),
		Name:     "Sync Test User",
		Username: "sync_" + uuid.New().String()[:8],
		Email:    "sync_" + uuid.New().String()[:8] + "@example.com",
		Password: hashedPassword,
	}
	err := facades.Orm().Query().Create(&s.user)
	s.Require().NoError(err)

	loginPayload, _ := json.Marshal(map[string]string{
		"email":    s.user.Email,
		"password": "password123",
	})
	resp, err := s.Http(s.T()).Post("/auth/login", bytes.NewBuffer(loginPayload))
	s.Require().NoError(err)
	resp.AssertOk()

	jsonBody, err := resp.Json()
	s.Require().NoError(err)
	s.token = jsonBody["data"].(map[string]any)["token"].(string)

	s.account = models.CloudAccount{
		UserID:    s.user.ID,
		Name:      "Mock Sync Storage",
		Provider:  models.ProviderMinIO,
		IsDefault: true,
		IsActive:  true,
	}
	_ = s.account.SetCredentials(&models.S3Credentials{
		Endpoint:        s.mockServer.URL,
		Bucket:          "mock-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "mock-key",
		SecretAccessKey: "mock-secret",
		UsePathStyle:    true,
	})
	err = facades.Orm().Query().Create(&s.account)
	s.Require().NoError(err)
}

func (s *BucketSyncTestSuite) TearDownTest() {
	if s.mockServer != nil {
		s.mockServer.Close()
	}
	if s.user.ID > 0 {
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.DriveItem{})
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.CloudAccount{})
		_, _ = facades.Orm().Query().ForceDelete(&s.user)
	}
}

func (s *BucketSyncTestSuite) TestBucketSyncWorkflow() {
	// 1. Trigger sync via POST /v1/cloud-accounts/{id}/sync
	syncResp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", s.account.ID), nil)
	s.Require().NoError(err)
	syncResp.AssertOk()

	syncBody, err := syncResp.Json()
	s.Require().NoError(err)
	s.Equal("ok", syncBody["status"])

	// 2. Verify root folder contains 'readme.txt' and 'photos'
	var rootItems []models.DriveItem
	err = facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", s.account.ID).
		Where("parent_id IS NULL").
		Find(&rootItems)
	s.Require().NoError(err)
	s.Len(rootItems, 2)

	var photosFolder *models.DriveItem
	var readmeFile *models.DriveItem
	for i := range rootItems {
		if rootItems[i].Name == "photos" {
			photosFolder = &rootItems[i]
		} else if rootItems[i].Name == "readme.txt" {
			readmeFile = &rootItems[i]
		}
	}

	s.Require().NotNil(photosFolder)
	s.Equal(models.ItemTypeFolder, photosFolder.Type)

	s.Require().NotNil(readmeFile)
	s.Equal(models.ItemTypeFile, readmeFile.Type)
	s.Equal(int64(1024), readmeFile.Size)
	s.Equal("mock-etag-readme", readmeFile.ETag)

	// 3. Verify 'photos' contains 'vacation'
	var photosChildren []models.DriveItem
	err = facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("parent_id", photosFolder.ID).
		Find(&photosChildren)
	s.Require().NoError(err)
	s.Len(photosChildren, 1)
	s.Equal("vacation", photosChildren[0].Name)
	s.Equal(models.ItemTypeFolder, photosChildren[0].Type)

	// 4. Verify 'vacation' contains 'beach.jpg'
	var vacationChildren []models.DriveItem
	err = facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("parent_id", photosChildren[0].ID).
		Find(&vacationChildren)
	s.Require().NoError(err)
	s.Len(vacationChildren, 1)
	s.Equal("beach.jpg", vacationChildren[0].Name)
	s.Equal(models.ItemTypeFile, vacationChildren[0].Type)
	s.Equal(int64(2048576), vacationChildren[0].Size)
	s.Equal("mock-etag-beach", vacationChildren[0].ETag)
	s.Equal("jpg", vacationChildren[0].Extension)

	// 5. Test idempotency: re-running sync should not create duplicate items
	syncResp2, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", s.account.ID), nil)
	s.Require().NoError(err)
	syncResp2.AssertOk()

	totalItems, err := facades.Orm().Query().Model(&models.DriveItem{}).
		Where("user_id", s.user.ID).
		Where("cloud_account_id", s.account.ID).
		Count()
	s.Require().NoError(err)
	s.Equal(int64(4), totalItems) // photos, vacation, beach.jpg, readme.txt
}

// TestSyncDoesNotMaterializeInternalUploadPrefix reproduces the bug where a
// synced bucket materialized the internal upload namespace `users/<id>/items/`
// as user-visible folders and re-parented an uploaded file into them, losing
// the folder the user actually put it in.
//
// An uploaded file is stored flat at `users/<id>/items/<uuid>-<name>` and is
// already tracked by its own DriveItem row (with the user's real ParentID). The
// key path is an internal storage detail, so a scan must not derive folders
// from it nor move the file.
func (s *BucketSyncTestSuite) TestSyncDoesNotMaterializeInternalUploadPrefix() {
	internalKey := fmt.Sprintf("users/%d/items/%s-UniKeyNT.exe", s.user.ID, uuid.New().String())

	// A bucket that lists that very object under the reserved internal prefix.
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mock-bucket</Name>
  <Prefix></Prefix>
  <KeyCount>1</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>%s</Key>
    <LastModified>2026-09-20T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-unikey"</ETag>
    <Size>123</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`, internalKey)))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mock.Close()

	account := models.CloudAccount{
		UserID:   s.user.ID,
		Name:     "Internal Prefix Storage",
		Provider: models.ProviderMinIO,
		IsActive: true,
	}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint:        mock.URL,
		Bucket:          "mock-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "mock-key",
		SecretAccessKey: "mock-secret",
		UsePathStyle:    true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	// The folder the file really belongs to ("test 2"), and the uploaded file
	// itself — same account that will be synced.
	realParent := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: account.ID,
		Name:           "test 2",
		Type:           models.ItemTypeFolder,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&realParent))

	file := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: account.ID,
		ParentID:       &realParent.ID,
		Name:           "UniKeyNT.exe",
		Type:           models.ItemTypeFile,
		StoragePath:    internalKey,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	resp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", account.ID), nil)
	s.Require().NoError(err)
	resp.AssertOk()

	// The file must still live in "test 2" — sync must not re-parent it.
	var reloaded models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("id", file.ID).First(&reloaded))
	s.Require().NotNil(reloaded.ParentID)
	s.Equal(realParent.ID, *reloaded.ParentID, "sync must not move an uploaded file out of its folder")

	// And no phantom "users" tree may appear at the root.
	var phantom []models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Where("name", "users").
		Find(&phantom))
	s.Empty(phantom, "the internal upload prefix must never become a folder")

	// The object was already tracked, so sync must not duplicate it.
	totalFiles, err := facades.Orm().Query().Model(&models.DriveItem{}).
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Where("type", models.ItemTypeFile).
		Count()
	s.Require().NoError(err)
	s.Equal(int64(1), totalFiles)
}

// TestSyncRecoversUploadedNameAfterDatabaseReset reproduces the bug where, after
// the database was reset while the bucket still held an app-uploaded object, a
// sync materialized the internal prefix `users/<id>/items/` as user-visible
// folders and named the file with its uuid prefix
// (`<uuid>-file-sample_1MB.docx`) instead of `file-sample_1MB.docx`.
//
// With no DriveItem row left, sync must recover the real name from the key and
// re-attach the file, and must never create the phantom `users`/`items` folders.
func (s *BucketSyncTestSuite) TestSyncRecoversUploadedNameAfterDatabaseReset() {
	realName := "file-sample_1MB.docx"
	internalKey := fmt.Sprintf("users/%d/items/%s-%s", s.user.ID, uuid.New().String(), realName)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mock-bucket</Name>
  <Prefix></Prefix>
  <KeyCount>1</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>%s</Key>
    <LastModified>2026-09-20T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-sample"</ETag>
    <Size>1048576</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`, internalKey)))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mock.Close()

	account := models.CloudAccount{
		UserID:   s.user.ID,
		Name:     "Reset DB Storage",
		Provider: models.ProviderMinIO,
		IsActive: true,
	}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint:        mock.URL,
		Bucket:          "mock-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "mock-key",
		SecretAccessKey: "mock-secret",
		UsePathStyle:    true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	// No DriveItem row exists — the database was reset. Sync must still recover
	// the file under its real name.
	resp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", account.ID), nil)
	s.Require().NoError(err)
	resp.AssertOk()

	var files []models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Where("type", models.ItemTypeFile).
		Find(&files))
	s.Require().Len(files, 1, "the object must be re-attached, not dropped")
	s.Equal(realName, files[0].Name, "the uuid prefix must not leak into the file name")
	s.Equal(internalKey, files[0].StoragePath)
	s.Equal("docx", files[0].Extension)

	// And no phantom `users`/`items` tree may appear.
	var phantom []models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Where("name", "users").
		Find(&phantom))
	s.Empty(phantom, "the internal upload prefix must never become a folder")

	var itemsFolder []models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Where("name", "items").
		Find(&itemsFolder))
	s.Empty(itemsFolder, "the internal upload prefix must never become a folder")
}

// TestCreateAccountAutoSyncs pins the "save a connection and it starts syncing"
// behaviour. Previously a new account stayed empty until someone found the sync
// endpoint, so the drive view showed nothing. Store now dispatches the same job
// the Sync endpoint does; with the default "sync" queue driver that job runs
// inline, so the created account's files are already present when the response
// returns.
func (s *BucketSyncTestSuite) TestCreateAccountAutoSyncs() {
	createPayload, _ := json.Marshal(map[string]any{
		"name":              "Auto Sync Storage",
		"provider":          models.ProviderMinIO,
		"endpoint":          s.mockServer.URL,
		"bucket":            "mock-bucket",
		"region":            "us-east-1",
		"access_key_id":     "mock-key",
		"secret_access_key": "mock-secret",
		"use_path_style":    true,
	})

	resp, err := s.Http(s.T()).WithToken(s.token).Post("/v1/cloud-accounts", bytes.NewBuffer(createPayload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusCreated)

	body, err := resp.Json()
	s.Require().NoError(err)
	accountData := body["data"].(map[string]any)
	accountID := uint(accountData["id"].(float64))
	s.NotZero(accountID)

	// Fetch the account by its public numeric id.
	var account models.CloudAccount
	err = facades.Orm().Query().Where("id", accountID).First(&account)
	s.Require().NoError(err)

	// The inline job must have populated the bucket's items.
	var items []models.DriveItem
	err = facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Find(&items)
	s.Require().NoError(err)
	s.Len(items, 4, "creating an account must trigger a sync so the drive view is not empty")

	// And the account must not be left stuck at "syncing".
	s.Equal("idle", account.SyncStatus)
	s.NotNil(account.LastSyncedAt)
}

// TestUploadRejectsDuplicateName proves the presigned-upload flow refuses a
// name already used in the same folder, because both objects would share one
// S3 key.
func (s *BucketSyncTestSuite) TestUploadRejectsDuplicateName() {
	body := map[string]any{
		"cloud_account_id": s.account.ID,
		"file_name":        "duplicate.txt",
		"size":             10,
		"mime_type":        "text/plain",
	}
	raw, _ := json.Marshal(body)

	first, err := s.Http(s.T()).WithToken(s.token).Post("/v1/drive/upload/presigned", bytes.NewBuffer(raw))
	s.Require().NoError(err)
	first.AssertStatus(http.StatusOK)

	second, err := s.Http(s.T()).WithToken(s.token).Post("/v1/drive/upload/presigned", bytes.NewBuffer(raw))
	s.Require().NoError(err)
	second.AssertStatus(http.StatusUnprocessableEntity)

	secondBody, _ := second.Json()
	message, _ := secondBody["message"].(string)
	s.NotContains(message, "name_conflict", "the translation key must resolve")
}

// TestSyncRebuildsFolderTreeFromNewSchemeKeys proves the feature's whole point:
// with no DriveItem rows left, a sync reconstructs the folder tree AND places
// each file in the folder its key encodes.
func (s *BucketSyncTestSuite) TestSyncRebuildsFolderTreeFromNewSchemeKeys() {
	key := fmt.Sprintf("users/%d/Docs/2026/report.pdf", s.user.ID)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mock-bucket</Name><Prefix></Prefix><KeyCount>1</KeyCount>
  <MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents>
    <Key>%s</Key>
    <LastModified>2026-10-13T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-report"</ETag>
    <Size>2048</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`, key)))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mock.Close()

	account := models.CloudAccount{UserID: s.user.ID, Name: "New Scheme Storage", Provider: models.ProviderMinIO, IsActive: true}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint: mock.URL, Bucket: "mock-bucket", Region: "us-east-1",
		AccessKeyID: "mock-key", SecretAccessKey: "mock-secret", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	resp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", account.ID), nil)
	s.Require().NoError(err)
	resp.AssertOk()

	// Docs (root) -> 2026 -> report.pdf
	var docs models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).Where("cloud_account_id", account.ID).
		Where("name", "Docs").Where("type", models.ItemTypeFolder).First(&docs))
	s.Nil(docs.ParentID)

	var y2026 models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("name", "2026").Where("parent_id", docs.ID).First(&y2026))

	var report models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("name", "report.pdf").Where("parent_id", y2026.ID).First(&report))
	s.Equal(models.ItemTypeFile, report.Type)
	s.Equal(key, report.StoragePath)

	// No phantom "users" folder at the root.
	var phantom []models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).Where("cloud_account_id", account.ID).
		Where("name", "users").Find(&phantom))
	s.Empty(phantom)
}

// TestSyncMaterializesFolderNamedItemsAsNewScheme proves the uuid-pattern
// discriminator: a new-scheme file inside a folder literally named "items" is a
// real folder with a plain file name, not a legacy upload.
func (s *BucketSyncTestSuite) TestSyncMaterializesFolderNamedItemsAsNewScheme() {
	key := fmt.Sprintf("users/%d/items/a.txt", s.user.ID)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mock-bucket</Name><Prefix></Prefix><KeyCount>1</KeyCount>
  <MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents>
    <Key>%s</Key>
    <LastModified>2026-10-13T10:00:00.000Z</LastModified>
    <ETag>"mock-etag-a"</ETag>
    <Size>10</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`, key)))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mock.Close()

	account := models.CloudAccount{UserID: s.user.ID, Name: "Items Folder Storage", Provider: models.ProviderMinIO, IsActive: true}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint: mock.URL, Bucket: "mock-bucket", Region: "us-east-1",
		AccessKeyID: "mock-key", SecretAccessKey: "mock-secret", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	resp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%d/sync", account.ID), nil)
	s.Require().NoError(err)
	resp.AssertOk()

	// A real folder named "items" exists, holding a file named "a.txt" (no uuid).
	var itemsFolder models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("user_id", s.user.ID).Where("cloud_account_id", account.ID).
		Where("name", "items").Where("type", models.ItemTypeFolder).First(&itemsFolder))

	var file models.DriveItem
	s.Require().NoError(facades.Orm().Query().
		Where("name", "a.txt").Where("parent_id", itemsFolder.ID).First(&file))
	s.Equal(key, file.StoragePath)
}

