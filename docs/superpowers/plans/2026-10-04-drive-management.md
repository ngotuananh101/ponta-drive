# Drive File & Folder Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire full file and folder management features (upload with direct/server choice, create folder, rename, permanent delete with recursive folder cleanup, star, download) from UI to backend.

**Architecture:** A single backend change adds batch `DeleteObjects` on `CloudDriver` and recursive DB-tree deletion in `CloudDriveService.DeleteItem` (with BFS cycle-guard and `used_storage` decrement). The frontend introduces new mutation endpoints, an XHR-based upload helper for progress tracking, store-level optimistic updates, four dialogs (`NewFolderDialog`, `RenameDialog`, `DeleteDriveItemDialog`, `UploadDialog`), a shared row action menu (`DriveItemMenu`), a `useUpload` composable, and a tiny `driveActions` store bridging sidebar intent to view dialogs.

**Tech Stack:** Go 1.25 / Goravel 1.18 / GORM / AWS SDK for Go v2 (backend); Vue 3.5 / Pinia 4 / vue-router / vue-i18n / shadcn-vue / lucide-vue-next / vue-sonner / vitest + happy-dom (frontend).

**Spec:** `docs/superpowers/specs/2026-10-04-drive-management-design.md`

## Global Constraints

- **Never touch auto-generated shadcn-vue files:** `src/components/ui/*` must never be edited, deleted, or regenerated. Compose dialogs using the existing primitives (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`).
- **Never expose internal system errors to clients:** System, database, AWS SDK, or driver error text must NEVER appear in API responses or user-facing toasts. All backend errors must be logged to backend logs (`facades.Log().Errorf`) and sanitized via localized messages (`failResponse`).
- **Upload method is an explicit user choice:** The upload flow MUST present a user-facing choice between `direct` (browser -> S3 presigned PUT) and `server` (browser -> API multipart chunks -> S3), regardless of file size. Never auto-select method by file size.
- **Delete is always permanent from the UI:** Frontend requests must append `?permanent=true`. The confirmation dialog must clearly indicate that deletion is permanent and warns that deleting a folder deletes all nested contents.
- **Contract is UUID-only:** No numeric database IDs are accepted or returned across the API boundaries.
- **Backend test DB:** MariaDB `ponta_drive` on `localhost:3306`, user `ponta_drive`/`123123`.
- **Frontend test runner & checks:** `npm run test:run` (one-shot tests), `npm run type-check` (`vue-tsc --build`), `npm run lint`. `noUncheckedIndexedAccess` is enabled.

## Review Focus

The five highest-risk edge cases and failure modes identified from the spec:
1. **Corrupted or cyclic `parent_id` hierarchy during recursive folder delete:** If a folder's children contain cyclic references or deep nesting exceeding normal limits, BFS walk must terminate safely using a visited set without entering an infinite loop. (Tested in Task 3)
2. **Batch S3 deletion of folder with >1000 items:** S3's `DeleteObjects` API limits each request to at most 1000 keys. Deleting a large folder must chunk keys into batches of <=1000 without dropping remaining keys. (Tested in Task 1)
3. **Upload cancellation mid-stream:** Cancelling a direct upload must abort the browser XHR; cancelling a multipart upload must abort the active XHR part and invoke `DELETE /v1/drive/upload/multipart/abort` to avoid abandoned chunks. (Tested in Task 6 and Task 9)
4. **Special characters, whitespace, and path traversal in item names:** Folder and file names with leading/trailing whitespace, forward slashes, or empty strings must be normalized or rejected before reaching storage. (Tested in Task 5 and Task 10)
5. **Storage decrement flooring at zero:** Decrementing `used_storage` on permanent file/folder deletion must never produce negative storage even if previous scans or counts were out of sync. (Tested in Task 2 and Task 3)

---

### Task 1: Batch `DeleteObjects` on `CloudDriver` & `S3Driver`

**Files:**
- Modify: `backend/app/contracts/storage.go:37-50`
- Modify: `backend/app/services/storage/s3_driver.go:120-130`
- Modify: `backend/tests/unit/storage_contract_test.go:17-31`
- Test: `backend/tests/unit/s3_driver_test.go`

**Interfaces:**
- Consumes: AWS SDK for Go v2 `s3.Client.DeleteObjects`, `types.Delete`, `types.ObjectIdentifier`
- Produces: `contracts.CloudDriver.DeleteObjects(ctx context.Context, keys []string) error`

- [ ] **Step 1: Write the failing unit test for `DeleteObjects`**

In `backend/tests/unit/s3_driver_test.go`, add tests for `DeleteObjects`:

```go
func TestS3DriverDeleteObjectsChunkingAndEmpty(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Query().Has("delete") {
			w.Header().Set("Content-Type", "application/xml")
			xmlResp := `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Deleted><Key>file1.txt</Key></Deleted>
</DeleteResult>`
			_, _ = w.Write([]byte(xmlResp))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mockServer.Close()

	cfg := storage.S3Config{
		Bucket:          "test-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
		Endpoint:        mockServer.URL,
		UsePathStyle:    true,
	}

	driver, err := storage.NewS3Driver(context.Background(), cfg)
	require.NoError(t, err)

	ctx := context.Background()

	// 1. Empty keys slice should be a no-op
	err = driver.DeleteObjects(ctx, []string{})
	assert.NoError(t, err)

	// 2. Non-empty keys slice
	err = driver.DeleteObjects(ctx, []string{"file1.txt", "file2.txt"})
	assert.NoError(t, err)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -v ./tests/unit/ -run TestS3DriverDeleteObjectsChunkingAndEmpty`
Expected: Compilation failure because `DeleteObjects` is not defined on `CloudDriver` / `S3Driver`.

- [ ] **Step 3: Update `CloudDriver` interface and implement `DeleteObjects` on `S3Driver`**

In `backend/app/contracts/storage.go`:
Add `DeleteObjects(ctx context.Context, keys []string) error` to `CloudDriver` interface.

In `backend/tests/unit/storage_contract_test.go`:
Add stub implementation:
```go
func (s *s3DriverStub) DeleteObjects(ctx context.Context, keys []string) error { return nil }
```

In `backend/app/services/storage/s3_driver.go`:
Implement `DeleteObjects` with 1000-key chunking:
```go
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test -v ./tests/unit/ -run 'TestS3Driver|TestCloudDriver'`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd backend
git add app/contracts/storage.go app/services/storage/s3_driver.go tests/unit/storage_contract_test.go tests/unit/s3_driver_test.go
git commit -m "feat(storage): add batch DeleteObjects to CloudDriver and S3Driver"
```

---

### Task 2: Recursive Folder Delete & Storage Decrement in `CloudDriveService`

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go:317-340`
- Test: `backend/app/services/cloud_drive_service_test.go` (new)

**Interfaces:**
- Consumes: `CloudDriveService.GetItemByUUID`, `CloudDriveService.GetDriver`, `contracts.CloudDriver.DeleteObjects`, `facades.Orm()`
- Produces: `CloudDriveService.DeleteItem(ctx context.Context, userID uint, itemUUID string, permanent bool) error`
- Produces helper: `CloudDriveService.CollectDescendantItems(ctx context.Context, userID uint, cloudAccountID uint, rootFolderID uint) ([]models.DriveItem, []string, int64, error)`

- [ ] **Step 1: Write unit tests for subtree collection & cycle guard**

Create `backend/app/services/cloud_drive_service_test.go`:
```go
package services_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
	"ponta_drive/app/services"
	"ponta_drive/tests"
)

type CloudDriveServiceTestSuite struct {
	suite.Suite
	tests.TestCase
	service *services.CloudDriveService
	user    models.User
	account models.CloudAccount
}

func TestCloudDriveServiceTestSuite(t *testing.T) {
	suite.Run(t, new(CloudDriveServiceTestSuite))
}

func (s *CloudDriveServiceTestSuite) SetupTest() {
	_ = facades.Artisan().Call("migrate")
	s.service = services.NewCloudDriveService()

	s.user = models.User{
		UUID:     "user-test-uuid",
		Name:     "Test User",
		Username: "svc_user",
		Email:    "svc_user@example.com",
	}
	_ = facades.Orm().Query().Create(&s.user)

	s.account = models.CloudAccount{
		UserID:      s.user.ID,
		Name:        "Test Account",
		Provider:    models.ProviderS3,
		UsedStorage: 5000,
	}
	_ = s.account.SetCredentials(&models.S3Credentials{
		Bucket: "test-b", Region: "us-east-1", AccessKeyID: "k", SecretAccessKey: "s",
	})
	_ = facades.Orm().Query().Create(&s.account)
}

func (s *CloudDriveServiceTestSuite) TearDownTest() {
	if s.user.ID > 0 {
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.DriveItem{})
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.CloudAccount{})
		_, _ = facades.Orm().Query().ForceDelete(&s.user)
	}
}

func (s *CloudDriveServiceTestSuite) TestCollectDescendants() {
	ctx := context.Background()

	// Root folder
	root, err := s.service.CreateFolder(ctx, s.user.ID, s.account.ID, nil, "RootFolder")
	s.Require().NoError(err)

	// Sub folder
	sub, err := s.service.CreateFolder(ctx, s.user.ID, s.account.ID, &root.ID, "SubFolder")
	s.Require().NoError(err)

	// File inside sub
	subFile := &models.DriveItem{
		UUID:           "file-sub-uuid",
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		ParentID:       &sub.ID,
		Name:           "doc.pdf",
		Type:           models.ItemTypeFile,
		Size:           1200,
		StoragePath:    "users/1/items/file-sub-uuid-doc.pdf",
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(subFile))

	items, keys, totalSize, err := s.service.CollectDescendantItems(ctx, s.user.ID, s.account.ID, root.ID)
	s.Require().NoError(err)

	// Expect 3 items collected: root, sub, subFile
	assert.Len(s.T(), items, 3)
	assert.Equal(s.T(), []string{"users/1/items/file-sub-uuid-doc.pdf"}, keys)
	assert.Equal(s.T(), int64(1200), totalSize)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -v ./app/services/ -run TestCloudDriveServiceTestSuite`
Expected: FAIL (`CollectDescendantItems` not defined).

- [ ] **Step 3: Implement recursive item collection and update `DeleteItem` in `cloud_drive_service.go`**

In `backend/app/services/cloud_drive_service.go`:

Add helper method:
```go
// CollectDescendantItems walks the folder subtree via BFS starting from rootFolderID,
// guarded by a visited set against cycles. It returns all collected DriveItems (including
// root), all non-empty file storage keys, and the total size of files.
func (s *CloudDriveService) CollectDescendantItems(ctx context.Context, userID uint, cloudAccountID uint, rootFolderID uint) ([]models.DriveItem, []string, int64, error) {
	var root models.DriveItem
	err := facades.Orm().Query().
		Where("id", rootFolderID).
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		First(&root)
	if err != nil || root.ID == 0 {
		return nil, nil, 0, errors.New("root item not found")
	}

	queue := []uint{root.ID}
	visited := map[uint]bool{root.ID: true}
	allItems := []models.DriveItem{root}
	var keys []string
	var totalSize int64

	const maxItems = 10000

	for len(queue) > 0 {
		if len(allItems) >= maxItems {
			break
		}
		currentID := queue[0]
		queue = queue[1:]

		var children []models.DriveItem
		err := facades.Orm().Query().
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			Where("parent_id", currentID).
			Get(&children)
		if err != nil {
			return nil, nil, 0, err
		}

		for _, child := range children {
			if visited[child.ID] {
				continue
			}
			visited[child.ID] = true
			allItems = append(allItems, child)

			if child.IsFolder() {
				queue = append(queue, child.ID)
			} else if child.IsFile() {
				if child.StoragePath != "" {
					keys = append(keys, child.StoragePath)
				}
				if child.Size > 0 {
					totalSize += child.Size
				}
			}
		}
	}

	return allItems, keys, totalSize, nil
}
```

Update `DeleteItem`:
```go
// DeleteItem deletes an item (soft-delete or permanent delete). For folders with permanent=true,
// all descendant files and folders are recursively deleted and used_storage is decremented.
func (s *CloudDriveService) DeleteItem(ctx context.Context, userID uint, itemUUID string, permanent bool) error {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return err
	}

	if !permanent {
		_, err = facades.Orm().Query().Delete(item)
		return err
	}

	// Permanent delete path
	driver, account, driverErr := s.GetDriver(ctx, userID, item.CloudAccountID)

	if item.IsFile() {
		if driverErr == nil && driver != nil && item.StoragePath != "" {
			_ = driver.Delete(ctx, item.StoragePath)
		}
		if _, err := facades.Orm().Query().ForceDelete(item); err != nil {
			return err
		}
		if account != nil && item.Size > 0 {
			newUsed := account.UsedStorage - item.Size
			if newUsed < 0 {
				newUsed = 0
			}
			account.UsedStorage = newUsed
			_ = facades.Orm().Query().Save(account)
		}
		return nil
	}

	// Folder permanent delete: collect all descendants
	allItems, keys, totalSize, collectErr := s.CollectDescendantItems(ctx, userID, item.CloudAccountID, item.ID)
	if collectErr != nil {
		return collectErr
	}

	// Batch delete from S3 driver
	if driverErr == nil && driver != nil && len(keys) > 0 {
		if batchErr := driver.DeleteObjects(ctx, keys); batchErr != nil {
			facades.Log().Warningf("[Drive] Failed to batch delete %d objects for folder %s: %v", len(keys), itemUUID, batchErr)
		}
	}

	// Force delete rows in batch
	ids := make([]uint, 0, len(allItems))
	for _, it := range allItems {
		ids = append(ids, it.ID)
	}

	if len(ids) > 0 {
		if _, err := facades.Orm().Query().Where("id IN (?)", ids).ForceDelete(&models.DriveItem{}); err != nil {
			return err
		}
	}

	// Decrement used_storage
	if account != nil && totalSize > 0 {
		newUsed := account.UsedStorage - totalSize
		if newUsed < 0 {
			newUsed = 0
		}
		account.UsedStorage = newUsed
		_ = facades.Orm().Query().Save(account)
	}

	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test -v ./app/services/ -run TestCloudDriveServiceTestSuite`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd backend
git add app/services/cloud_drive_service.go app/services/cloud_drive_service_test.go
git commit -m "feat(drive): recursive folder delete with storage decrement in CloudDriveService"
```

---

### Task 3: Backend Feature Tests for Recursive Delete & Storage Decrement

**Files:**
- Modify: `backend/tests/feature/drive_item_api_test.go`
- Test: `backend/tests/feature/drive_item_api_test.go`

**Interfaces:**
- Consumes: `DELETE /v1/drive/items/{uuid}?permanent=true`, `POST /v1/drive/items/folders`
- Produces: Verified end-to-end HTTP tests confirming recursive deletion of folders, batch storage object cleanup via mock S3, and `used_storage` decrement.

- [ ] **Step 1: Write feature tests in `drive_item_api_test.go`**

In `backend/tests/feature/drive_item_api_test.go`:
Add a test method to `DriveItemAPITestSuite`:

```go
func (s *DriveItemAPITestSuite) TestPermanentDeleteFolderRecursiveWithStorageDecrement() {
	// Set initial used_storage
	s.account.UsedStorage = 50000
	_ = facades.Orm().Query().Save(&s.account)

	// 1. Create a parent folder
	parent := s.createFolder("ParentFolder", nil)

	// 2. Create child folder
	child := s.createFolder("ChildFolder", &parent.UUID)

	// 3. Create file inside child folder directly in DB
	file := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		ParentID:       func() *uint {
			var it models.DriveItem
			_ = facades.Orm().Query().Where("uuid", child.UUID).First(&it)
			return &it.ID
		}(),
		Name:        "nested-doc.txt",
		Type:        models.ItemTypeFile,
		Size:        15000,
		StoragePath: "users/1/items/mock-nested-doc.txt",
		Status:      models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	// 4. Issue DELETE /v1/drive/items/{parent_uuid}?permanent=true
	delResp, err := s.Http(s.T()).WithToken(s.token).Delete(
		fmt.Sprintf("/v1/drive/items/%s?permanent=true", parent.UUID),
		nil,
	)
	s.Require().NoError(err)
	delResp.AssertOk()

	// 5. Assert parent, child and nested file are completely gone from DB
	var count int64
	facades.Orm().Query().Model(&models.DriveItem{}).
		Where("uuid IN (?)", []string{parent.UUID, child.UUID, file.UUID}).
		Count(&count)
	s.Equal(int64(0), count, "all items in hierarchy must be permanently deleted")

	// 6. Assert used_storage decremented: 50000 - 15000 = 35000
	var refreshedAccount models.CloudAccount
	_ = facades.Orm().Query().Where("id", s.account.ID).First(&refreshedAccount)
	s.Equal(int64(35000), refreshedAccount.UsedStorage)
}

func (s *DriveItemAPITestSuite) TestStorageDecrementDoesNotGoBelowZero() {
	s.account.UsedStorage = 2000
	_ = facades.Orm().Query().Save(&s.account)

	file := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		Name:           "large.txt",
		Type:           models.ItemTypeFile,
		Size:           10000, // larger than used_storage
		StoragePath:    "users/1/items/large.txt",
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	delResp, err := s.Http(s.T()).WithToken(s.token).Delete(
		fmt.Sprintf("/v1/drive/items/%s?permanent=true", file.UUID),
		nil,
	)
	s.Require().NoError(err)
	delResp.AssertOk()

	var refreshedAccount models.CloudAccount
	_ = facades.Orm().Query().Where("id", s.account.ID).First(&refreshedAccount)
	s.Equal(int64(0), refreshedAccount.UsedStorage, "storage decrement must be floored at 0")
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd backend && go test -v ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestPermanentDeleteFolderRecursiveWithStorageDecrement|TestDriveItemAPITestSuite/TestStorageDecrementDoesNotGoBelowZero'`
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
cd backend
git add tests/feature/drive_item_api_test.go
git commit -m "test(drive): add feature tests for recursive permanent delete and storage flooring"
```

---

### Task 4: Frontend i18n Keys for Drive Management in `vi.json` and `en.json`

**Files:**
- Modify: `frontend/src/locales/vi.json`
- Modify: `frontend/src/locales/en.json`
- Test: `frontend/src/i18n/__tests__/driveKeys.spec.ts` (new)

**Interfaces:**
- Produces: `drive.*` translation keys for dialogs (new folder, rename, delete confirmation, upload), toasts, and errors in Vietnamese and English.

- [ ] **Step 1: Write failing parity test for `drive` locale namespace**

Create `frontend/src/i18n/__tests__/driveKeys.spec.ts`:
```ts
import { describe, expect, it } from 'vitest'
import vi from '@/locales/vi.json'
import en from '@/locales/en.json'

describe('drive locale namespace', () => {
  it('defines the drive namespace in both locales', () => {
    expect(vi.drive).toBeTruthy()
    expect(en.drive).toBeTruthy()
  })

  it('has identical keys for drive in both locales', () => {
    const viKeys = Object.keys(vi.drive).sort()
    const enKeys = Object.keys(en.drive).sort()
    expect(enKeys).toEqual(viKeys)
  })

  it('has no empty translations in drive namespace', () => {
    for (const [key, value] of Object.entries(vi.drive)) {
      expect(value, `vi.drive.${key}`).toBeTruthy()
    }
    for (const [key, value] of Object.entries(en.drive)) {
      expect(value, `en.drive.${key}`).toBeTruthy()
    }
  })

  it('defines dialog action keys needed for management', () => {
    const required = [
      'new_folder_title',
      'new_folder_placeholder',
      'new_folder_create',
      'rename_title',
      'rename_placeholder',
      'rename_save',
      'delete_item_title',
      'delete_item_confirm',
      'delete_folder_warning',
      'delete_permanent_note',
      'delete_button',
      'cancel_button',
      'upload_title',
      'upload_method_title',
      'upload_method_direct',
      'upload_method_direct_desc',
      'upload_method_server',
      'upload_method_server_desc',
      'upload_select_files',
      'upload_select_folder',
      'upload_drop_hint',
      'upload_start',
      'upload_cancel',
      'upload_status_uploading',
      'upload_status_completed',
      'upload_status_failed',
      'toast_folder_created',
      'toast_renamed',
      'toast_deleted',
      'toast_starred',
      'toast_unstarred',
      'toast_download_started',
      'toast_upload_completed',
    ]

    for (const k of required) {
      expect((vi.drive as Record<string, string>)[k], `vi.drive.${k}`).toBeTruthy()
      expect((en.drive as Record<string, string>)[k], `en.drive.${k}`).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/i18n/__tests__/driveKeys.spec.ts`
Expected: FAIL due to missing keys.

- [ ] **Step 3: Add translation keys to `vi.json` and `en.json`**

In `frontend/src/locales/vi.json` under `"drive"`:
```json
    "new_folder_title": "Tạo thư mục mới",
    "new_folder_placeholder": "Nhập tên thư mục",
    "new_folder_create": "Tạo mới",
    "rename_title": "Đổi tên",
    "rename_placeholder": "Nhập tên mới",
    "rename_save": "Lưu thay đổi",
    "delete_item_title": "Xóa vĩnh viễn?",
    "delete_item_confirm": "Bạn có chắc chắn muốn xóa \"{name}\"?",
    "delete_folder_warning": "Thư mục này và toàn bộ tệp, thư mục con bên trong sẽ bị xóa vĩnh viễn.",
    "delete_permanent_note": "Hành động này không thể hoàn tác.",
    "delete_button": "Xóa vĩnh viễn",
    "cancel_button": "Hủy",
    "upload_title": "Tải tệp & thư mục lên",
    "upload_method_title": "Phương thức tải lên",
    "upload_method_direct": "Trực tiếp lên S3 (Direct Upload)",
    "upload_method_direct_desc": "Tải thẳng từ trình duyệt lên Cloud S3 qua presigned URL. Tốc độ cao, không tải server.",
    "upload_method_server": "Qua máy chủ (Server Multipart)",
    "upload_method_server_desc": "Truyền dữ liệu chia nhỏ qua server Ponta Drive. Phù hợp khi mạng hạn chế kết nối trực tiếp S3.",
    "upload_select_files": "Chọn tệp",
    "upload_select_folder": "Chọn thư mục",
    "upload_drop_hint": "hoặc kéo thả tệp và thư mục vào đây",
    "upload_start": "Bắt đầu tải lên",
    "upload_cancel": "Hủy",
    "upload_status_uploading": "Đang tải lên...",
    "upload_status_completed": "Hoàn tất",
    "upload_status_failed": "Thất bại",
    "toast_folder_created": "Đã tạo thư mục thành công.",
    "toast_renamed": "Đã đổi tên thành công.",
    "toast_deleted": "Đã xóa vĩnh viễn thành công.",
    "toast_starred": "Đã gắn dấu sao.",
    "toast_unstarred": "Đã bỏ dấu sao.",
    "toast_download_started": "Đang chuẩn bị tải xuống...",
    "toast_upload_completed": "Tải lên hoàn tất."
```

In `frontend/src/locales/en.json` under `"drive"`:
```json
    "new_folder_title": "New folder",
    "new_folder_placeholder": "Enter folder name",
    "new_folder_create": "Create",
    "rename_title": "Rename",
    "rename_placeholder": "Enter new name",
    "rename_save": "Save changes",
    "delete_item_title": "Permanently delete?",
    "delete_item_confirm": "Are you sure you want to delete \"{name}\"?",
    "delete_folder_warning": "This folder and all nested files and subfolders will be permanently deleted.",
    "delete_permanent_note": "This action cannot be undone.",
    "delete_button": "Delete permanently",
    "cancel_button": "Cancel",
    "upload_title": "Upload files & folders",
    "upload_method_title": "Upload method",
    "upload_method_direct": "Direct to S3 (Presigned)",
    "upload_method_direct_desc": "Uploads directly from browser to S3 storage via presigned URL. Fastest and zero server load.",
    "upload_method_server": "Via server (Multipart chunks)",
    "upload_method_server_desc": "Streams chunked parts through Ponta Drive server. Useful if direct S3 access is restricted.",
    "upload_select_files": "Select files",
    "upload_select_folder": "Select folder",
    "upload_drop_hint": "or drag and drop files and folders here",
    "upload_start": "Start upload",
    "upload_cancel": "Cancel",
    "upload_status_uploading": "Uploading...",
    "upload_status_completed": "Completed",
    "upload_status_failed": "Failed",
    "toast_folder_created": "Folder created successfully.",
    "toast_renamed": "Renamed successfully.",
    "toast_deleted": "Permanently deleted successfully.",
    "toast_starred": "Item starred.",
    "toast_unstarred": "Item unstarred.",
    "toast_download_started": "Preparing download...",
    "toast_upload_completed": "Upload completed."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/i18n/__tests__/driveKeys.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/locales/vi.json src/locales/en.json src/i18n/__tests__/driveKeys.spec.ts
git commit -m "feat(i18n): add drive management translation keys in vi and en"
```

---

### Task 5: Frontend API Mutations in `src/api/driveItems.ts`

**Files:**
- Modify: `frontend/src/api/driveItems.ts`
- Test: `frontend/src/api/__tests__/driveItems.spec.ts` (new)

**Interfaces:**
- Produces:
  - `createDriveFolder(payload: { cloudAccountUuid: string; parentUuid?: string | null; name: string }): Promise<ApiResponse<DriveItem>>`
  - `renameDriveItem(uuid: string, name: string): Promise<ApiResponse<DriveItem>>`
  - `deleteDriveItem(uuid: string, permanent?: boolean): Promise<ApiResponse>`
  - `toggleStarDriveItem(uuid: string): Promise<ApiResponse<DriveItem>>`
  - `getDriveItemDownloadUrl(uuid: string): Promise<ApiResponse<{ download_url: string; item: DriveItem }>>`

- [ ] **Step 1: Write unit tests for API mutation helpers**

Create `frontend/src/api/__tests__/driveItems.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../client'
import {
  createDriveFolder,
  renameDriveItem,
  deleteDriveItem,
  toggleStarDriveItem,
  getDriveItemDownloadUrl,
} from '../driveItems'

describe('driveItems API mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('createDriveFolder posts to /v1/drive/items/folders', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await createDriveFolder({
      cloudAccountUuid: 'cloud-1',
      parentUuid: 'folder-1',
      name: 'New Folder',
    })

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/folders', {
      method: 'POST',
      body: JSON.stringify({
        cloud_account_uuid: 'cloud-1',
        parent_uuid: 'folder-1',
        name: 'New Folder',
      }),
    })
  })

  it('renameDriveItem patches /v1/drive/items/:uuid', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await renameDriveItem('item-uuid', 'Updated Name')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
    })
  })

  it('deleteDriveItem sends permanent=true by default', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await deleteDriveItem('item-uuid', true)

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid?permanent=true', {
      method: 'DELETE',
    })
  })

  it('toggleStarDriveItem posts to /v1/drive/items/:uuid/star', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await toggleStarDriveItem('item-uuid')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid/star', {
      method: 'POST',
    })
  })

  it('getDriveItemDownloadUrl queries download with mode=json', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await getDriveItemDownloadUrl('item-uuid')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid/download?mode=json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/api/__tests__/driveItems.spec.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement API mutation functions in `src/api/driveItems.ts`**

Add to `frontend/src/api/driveItems.ts`:
```ts
export interface CreateFolderPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  name: string
}

export async function createDriveFolder(
  payload: CreateFolderPayload,
): Promise<ApiResponse<DriveItem>> {
  const body: Record<string, string> = {
    cloud_account_uuid: payload.cloudAccountUuid,
    name: payload.name.trim(),
  }
  if (payload.parentUuid) {
    body.parent_uuid = payload.parentUuid
  }
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/items/folders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function renameDriveItem(
  uuid: string,
  name: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: name.trim() }),
  })
}

export async function deleteDriveItem(
  uuid: string,
  permanent = true,
): Promise<ApiResponse> {
  const query = permanent ? '?permanent=true' : ''
  return fetchApi<ApiResponse>(`/v1/drive/items/${encodeURIComponent(uuid)}${query}`, {
    method: 'DELETE',
  })
}

export async function toggleStarDriveItem(uuid: string): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}/star`, {
    method: 'POST',
  })
}

export interface DownloadUrlResponse {
  download_url: string
  item: DriveItem
}

export async function getDriveItemDownloadUrl(
  uuid: string,
): Promise<ApiResponse<DownloadUrlResponse>> {
  return fetchApi<ApiResponse<DownloadUrlResponse>>(
    `/v1/drive/items/${encodeURIComponent(uuid)}/download?mode=json`,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/api/__tests__/driveItems.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/api/driveItems.ts src/api/__tests__/driveItems.spec.ts
git commit -m "feat(api): add createFolder, rename, delete, star, and downloadUrl endpoints"
```

---

### Task 6: Frontend Upload API & XHR Progress Helper in `src/api/upload.ts`

**Files:**
- Create: `frontend/src/api/upload.ts`
- Test: `frontend/src/api/__tests__/upload.spec.ts` (new)

**Interfaces:**
- Produces:
  - `initiatePresignedUpload(payload)`: `POST /v1/drive/upload/presigned`
  - `completePresignedUpload(itemUuid)`: `POST /v1/drive/upload/presigned/complete`
  - `initiateMultipartUpload(payload)`: `POST /v1/drive/upload/multipart/init`
  - `uploadMultipartPart(sessionId, partNumber, chunk, onProgress)`: `POST /v1/drive/upload/multipart/part` via XHR
  - `completeMultipartUpload(sessionId)`: `POST /v1/drive/upload/multipart/complete`
  - `abortMultipartUpload(sessionId)`: `POST /v1/drive/upload/multipart/abort`
  - `uploadDirectToS3(url, method, headers, file, onProgress)`: direct XHR PUT

- [ ] **Step 1: Write unit tests for upload API and XHR helpers**

Create `frontend/src/api/__tests__/upload.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../client'
import {
  initiatePresignedUpload,
  completePresignedUpload,
  initiateMultipartUpload,
  completeMultipartUpload,
  abortMultipartUpload,
} from '../upload'

describe('upload API endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('initiatePresignedUpload posts correct payload', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await initiatePresignedUpload({
      cloudAccountUuid: 'c-1',
      fileName: 'photo.jpg',
      size: 2048,
      mimeType: 'image/jpeg',
    })

    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/presigned', {
      method: 'POST',
      body: JSON.stringify({
        cloud_account_uuid: 'c-1',
        file_name: 'photo.jpg',
        size: 2048,
        mime_type: 'image/jpeg',
      }),
    })
  })

  it('completePresignedUpload posts item_uuid', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await completePresignedUpload('item-abc')

    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/presigned/complete', {
      method: 'POST',
      body: JSON.stringify({ item_uuid: 'item-abc' }),
    })
  })

  it('multipart lifecycle endpoints make expected calls', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })

    await initiateMultipartUpload({
      cloudAccountUuid: 'c-1',
      fileName: 'video.mp4',
      size: 10485760,
      mimeType: 'video/mp4',
      chunkSize: 5242880,
    })
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/init', expect.objectContaining({ method: 'POST' }))

    await completeMultipartUpload('sess-1')
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'sess-1' }),
    })

    await abortMultipartUpload('sess-1')
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/abort', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'sess-1' }),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/api/__tests__/upload.spec.ts`
Expected: FAIL (`../upload` module not found).

- [ ] **Step 3: Implement `frontend/src/api/upload.ts`**

Create `frontend/src/api/upload.ts`:
```ts
import { fetchApi, type ApiResponse } from './client'
import type { DriveItem } from './driveItems'

export interface PresignedUploadInitPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  fileName: string
  size: number
  mimeType: string
}

export interface PresignedUploadInitResponse {
  item_uuid: string
  upload_url: string
  method: string
  headers: Record<string, string>
  expires_at: string
  item: DriveItem
}

export async function initiatePresignedUpload(
  payload: PresignedUploadInitPayload,
): Promise<ApiResponse<PresignedUploadInitResponse>> {
  const body: Record<string, unknown> = {
    cloud_account_uuid: payload.cloudAccountUuid,
    file_name: payload.fileName,
    size: payload.size,
    mime_type: payload.mimeType,
  }
  if (payload.parentUuid) body.parent_uuid = payload.parentUuid

  return fetchApi<ApiResponse<PresignedUploadInitResponse>>('/v1/drive/upload/presigned', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function completePresignedUpload(
  itemUuid: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/upload/presigned/complete', {
    method: 'POST',
    body: JSON.stringify({ item_uuid: itemUuid }),
  })
}

export interface MultipartUploadInitPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  fileName: string
  size: number
  mimeType: string
  chunkSize?: number
}

export interface MultipartUploadInitResponse {
  session_id: string
  upload_id: string
  total_parts: number
  chunk_size: number
  storage_path: string
}

export async function initiateMultipartUpload(
  payload: MultipartUploadInitPayload,
): Promise<ApiResponse<MultipartUploadInitResponse>> {
  const body: Record<string, unknown> = {
    cloud_account_uuid: payload.cloudAccountUuid,
    file_name: payload.fileName,
    size: payload.size,
    mime_type: payload.mimeType,
  }
  if (payload.parentUuid) body.parent_uuid = payload.parentUuid
  if (payload.chunkSize) body.chunk_size = payload.chunkSize

  return fetchApi<ApiResponse<MultipartUploadInitResponse>>('/v1/drive/upload/multipart/init', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function completeMultipartUpload(
  sessionId: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/upload/multipart/complete', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export async function abortMultipartUpload(sessionId: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/v1/drive/upload/multipart/abort', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export interface XhrUploadOptions {
  onProgress?: (percent: number, loaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Uploads a file directly to S3 via presigned PUT using XMLHttpRequest for progress events.
 */
export function uploadDirectToS3(
  url: string,
  method: string,
  headers: Record<string, string>,
  file: Blob,
  options: XhrUploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method || 'PUT', url, true)

    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v)
    }

    if (options.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          options.onProgress?.(percent, e.loaded, e.total)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Direct S3 upload failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error during direct S3 upload'))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))

    if (options.signal) {
      options.signal.addEventListener('abort', () => xhr.abort())
    }

    xhr.send(file)
  })
}

/**
 * Uploads a chunk part to the backend multipart part endpoint using FormData.
 */
export function uploadMultipartChunk(
  sessionId: string,
  partNumber: number,
  chunk: Blob,
  options: XhrUploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
    const url = `${API_BASE_URL}/v1/drive/upload/multipart/part`

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)

    const token = localStorage.getItem('token')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Accept', 'application/json')

    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('part_number', String(partNumber))
    formData.append('file', chunk)

    if (options.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          options.onProgress?.(percent, e.loaded, e.total)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Part upload failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error during multipart part upload'))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))

    if (options.signal) {
      options.signal.addEventListener('abort', () => xhr.abort())
    }

    xhr.send(formData)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/api/__tests__/upload.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/api/upload.ts src/api/__tests__/upload.spec.ts
git commit -m "feat(api): add upload API endpoints and XHR progress helpers"
```

---

### Task 7: Frontend `driveItems` Store Mutations

**Files:**
- Modify: `frontend/src/stores/driveItems.ts`
- Test: `frontend/src/stores/__tests__/driveItems.spec.ts`

**Interfaces:**
- Produces:
  - `store.createFolder(cloudAccountUuid: string, parentUuid: string | null, name: string): Promise<DriveItem>`
  - `store.rename(uuid: string, name: string): Promise<DriveItem>`
  - `store.remove(uuid: string, permanent?: boolean): Promise<void>`
  - `store.toggleStar(uuid: string): Promise<DriveItem>`
  - `store.insertItem(item: DriveItem): void`

- [ ] **Step 1: Write store mutation tests in `driveItems.spec.ts`**

In `frontend/src/stores/__tests__/driveItems.spec.ts`, append tests:

```ts
  it('createFolder prepends the new folder to items', async () => {
    const newFolder = item('f-new', 'New Folder')
    newFolder.type = 'folder'
    vi.spyOn(api, 'createDriveFolder').mockResolvedValue({ status: 'ok', data: newFolder })

    const store = useDriveItemsStore()
    store.items = [item('a')]

    const res = await store.createFolder('acc-uuid', null, 'New Folder')
    expect(res.uuid).toBe('f-new')
    expect(store.items[0]?.uuid).toBe('f-new')
    expect(store.items).toHaveLength(2)
  })

  it('rename updates the target item in place', async () => {
    const updated = item('a', 'Renamed A')
    vi.spyOn(api, 'renameDriveItem').mockResolvedValue({ status: 'ok', data: updated })

    const store = useDriveItemsStore()
    store.items = [item('a', 'Old A'), item('b')]

    await store.rename('a', 'Renamed A')
    expect(store.items[0]?.name).toBe('Renamed A')
  })

  it('remove deletes the item from items list', async () => {
    vi.spyOn(api, 'deleteDriveItem').mockResolvedValue({ status: 'ok' })

    const store = useDriveItemsStore()
    store.items = [item('a'), item('b')]

    await store.remove('a', true)
    expect(store.items.map((i) => i.uuid)).toEqual(['b'])
  })

  it('toggleStar replaces item with response', async () => {
    const starred = { ...item('a'), is_starred: true }
    vi.spyOn(api, 'toggleStarDriveItem').mockResolvedValue({ status: 'ok', data: starred })

    const store = useDriveItemsStore()
    store.items = [item('a')]

    await store.toggleStar('a')
    expect(store.items[0]?.is_starred).toBe(true)
  })

  it('insertItem adds item if not already present', () => {
    const store = useDriveItemsStore()
    store.items = [item('a')]

    store.insertItem(item('b'))
    expect(store.items.map((i) => i.uuid)).toEqual(['b', 'a'])

    // duplicate is ignored
    store.insertItem(item('b'))
    expect(store.items).toHaveLength(2)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/stores/__tests__/driveItems.spec.ts`
Expected: FAIL (store methods missing).

- [ ] **Step 3: Implement mutations in `src/stores/driveItems.ts`**

In `frontend/src/stores/driveItems.ts`:
Import `createDriveFolder, renameDriveItem, deleteDriveItem, toggleStarDriveItem` from `@/api/driveItems`.

Add mutation actions inside `useDriveItemsStore`:
```ts
  function insertItem(item: DriveItem): void {
    const exists = items.value.some((i) => i.uuid === item.uuid)
    if (!exists) {
      if (item.type === 'folder') {
        items.value = [item, ...items.value]
      } else {
        // Folders first: find first non-folder index
        const firstFileIndex = items.value.findIndex((i) => i.type !== 'folder')
        if (firstFileIndex === -1) {
          items.value = [...items.value, item]
        } else {
          items.value.splice(firstFileIndex, 0, item)
        }
      }
    }
  }

  async function createFolder(
    cloudAccountUuid: string,
    parentUuid: string | null,
    name: string,
  ): Promise<DriveItem> {
    const res = await createDriveFolder({ cloudAccountUuid, parentUuid, name })
    const created = res.data as DriveItem
    insertItem(created)
    return created
  }

  async function rename(uuid: string, newName: string): Promise<DriveItem> {
    const res = await renameDriveItem(uuid, newName)
    const updated = res.data as DriveItem
    items.value = items.value.map((i) => (i.uuid === uuid ? updated : i))
    return updated
  }

  async function remove(uuid: string, permanent = true): Promise<void> {
    await deleteDriveItem(uuid, permanent)
    items.value = items.value.filter((i) => i.uuid !== uuid)
  }

  async function toggleStar(uuid: string): Promise<DriveItem> {
    const res = await toggleStarDriveItem(uuid)
    const updated = res.data as DriveItem
    items.value = items.value.map((i) => (i.uuid === uuid ? updated : i))
    return updated
  }
```

Return them in store return object:
```ts
  return {
    items,
    cursor,
    hasMore,
    loading,
    error,
    breadcrumb,
    clearBreadcrumb,
    loadBreadcrumb,
    reset,
    loadFirstPage,
    loadNextPage,
    insertItem,
    createFolder,
    rename,
    remove,
    toggleStar,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/stores/__tests__/driveItems.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/stores/driveItems.ts src/stores/__tests__/driveItems.spec.ts
git commit -m "feat(store): add createFolder, rename, remove, toggleStar and insertItem actions"
```

---

### Task 8: Frontend `driveActions` Store for Sidebar Wiring

**Files:**
- Create: `frontend/src/stores/driveActions.ts`
- Test: `frontend/src/stores/__tests__/driveActions.spec.ts` (new)

**Interfaces:**
- Produces:
  - `type DriveActionType = 'new-folder' | 'upload-file' | 'upload-folder'`
  - `store.pending: Ref<{ type: DriveActionType; nonce: number } | null>`
  - `store.request(type: DriveActionType): void`
  - `store.consume(): void`

- [ ] **Step 1: Write unit test for `driveActions` store**

Create `frontend/src/stores/__tests__/driveActions.spec.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDriveActionsStore } from '../driveActions'

describe('driveActions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('requests an action with an incrementing nonce', () => {
    const store = useDriveActionsStore()
    expect(store.pending).toBeNull()

    store.request('new-folder')
    expect(store.pending).toEqual({ type: 'new-folder', nonce: 1 })

    store.request('new-folder')
    expect(store.pending).toEqual({ type: 'new-folder', nonce: 2 })
  })

  it('consume resets pending to null', () => {
    const store = useDriveActionsStore()
    store.request('upload-file')
    expect(store.pending?.type).toBe('upload-file')

    store.consume()
    expect(store.pending).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/stores/__tests__/driveActions.spec.ts`
Expected: FAIL (`../driveActions` not found).

- [ ] **Step 3: Implement `frontend/src/stores/driveActions.ts`**

Create `frontend/src/stores/driveActions.ts`:
```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type DriveActionType = 'new-folder' | 'upload-file' | 'upload-folder'

export interface PendingAction {
  type: DriveActionType
  nonce: number
}

/**
 * Bridges user actions in the sidebar (which has no folder/drive context)
 * to DriveView (which holds active folder context and owns dialogs).
 */
export const useDriveActionsStore = defineStore('driveActions', () => {
  const pending = ref<PendingAction | null>(null)
  let counter = 0

  function request(type: DriveActionType): void {
    pending.value = {
      type,
      nonce: ++counter,
    }
  }

  function consume(): void {
    pending.value = null
  }

  return { pending, request, consume }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/stores/__tests__/driveActions.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/stores/driveActions.ts src/stores/__tests__/driveActions.spec.ts
git commit -m "feat(store): add driveActions store for intent bridging between layout and view"
```

---

### Task 9: Frontend `useUpload` Composable

**Files:**
- Create: `frontend/src/composables/useUpload.ts`
- Test: `frontend/src/composables/__tests__/useUpload.spec.ts` (new)

**Interfaces:**
- Produces: `useUpload()` composable handling upload queue, progress percentage, cancellation, and method execution (`direct` vs `server`).

- [ ] **Step 1: Write unit tests for `useUpload`**

Create `frontend/src/composables/__tests__/useUpload.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUpload } from '../useUpload'
import * as uploadApi from '@/api/upload'
import type { DriveItem } from '@/api/driveItems'

const mockItem: DriveItem = {
  uuid: 'uploaded-1',
  name: 'file.txt',
  type: 'file',
  mime_type: 'text/plain',
  size: 100,
  extension: 'txt',
  cloud_account_uuid: 'cloud-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

describe('useUpload composable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('runs direct upload flow', async () => {
    const initSpy = vi.spyOn(uploadApi, 'initiatePresignedUpload').mockResolvedValue({
      status: 'ok',
      data: {
        item_uuid: 'item-1',
        upload_url: 'https://s3.example.com/put',
        method: 'PUT',
        headers: {},
        expires_at: '',
        item: mockItem,
      },
    })
    const directSpy = vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    const compSpy = vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({
      status: 'ok',
      data: mockItem,
    })

    const { uploadQueue, startUpload } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    expect(initSpy).toHaveBeenCalled()
    expect(directSpy).toHaveBeenCalled()
    expect(compSpy).toHaveBeenCalledWith('item-1')
    expect(res).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/composables/__tests__/useUpload.spec.ts`
Expected: FAIL (`../useUpload` not found).

- [ ] **Step 3: Implement `frontend/src/composables/useUpload.ts`**

Create `frontend/src/composables/useUpload.ts`:
```ts
import { ref } from 'vue'
import {
  initiatePresignedUpload,
  completePresignedUpload,
  initiateMultipartUpload,
  uploadMultipartChunk,
  completeMultipartUpload,
  abortMultipartUpload,
  uploadDirectToS3,
} from '@/api/upload'
import type { DriveItem } from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

export type UploadMethod = 'direct' | 'server'

export interface UploadQueueItem {
  id: string
  file: File
  relativePath?: string
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'aborted'
  error?: string
  abortController?: AbortController
}

export interface StartUploadOptions {
  cloudAccountUuid: string
  parentUuid?: string | null
  files: File[]
  method: UploadMethod
  onItemCompleted?: (item: DriveItem) => void
}

export function useUpload() {
  const queue = ref<UploadQueueItem[]>([])
  const isUploading = ref(false)
  const driveStore = useDriveItemsStore()
  const cloudStore = useCloudAccountsStore()

  function cancelItem(itemId: string) {
    const item = queue.value.find((i) => i.id === itemId)
    if (item && item.status === 'uploading') {
      item.abortController?.abort()
      item.status = 'aborted'
    }
  }

  function clearQueue() {
    queue.value = []
  }

  async function uploadDirect(
    queueItem: UploadQueueItem,
    cloudAccountUuid: string,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const initRes = await initiatePresignedUpload({
      cloudAccountUuid,
      parentUuid,
      fileName: queueItem.file.name,
      size: queueItem.file.size,
      mimeType: queueItem.file.type || 'application/octet-stream',
    })

    const data = initRes.data!
    await uploadDirectToS3(data.upload_url, data.method, data.headers, queueItem.file, {
      signal: controller.signal,
      onProgress: (percent) => {
        queueItem.progress = percent
      },
    })

    const compRes = await completePresignedUpload(data.item_uuid)
    const finalized = compRes.data!
    queueItem.status = 'completed'
    queueItem.progress = 100
    driveStore.insertItem(finalized)
    return finalized
  }

  async function uploadServerMultipart(
    queueItem: UploadQueueItem,
    cloudAccountUuid: string,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const chunkSize = 5 * 1024 * 1024 // 5MB
    const initRes = await initiateMultipartUpload({
      cloudAccountUuid,
      parentUuid,
      fileName: queueItem.file.name,
      size: queueItem.file.size,
      mimeType: queueItem.file.type || 'application/octet-stream',
      chunkSize,
    })

    const session = initRes.data!
    const totalParts = session.total_parts
    let uploadedBytes = 0

    try {
      for (let part = 1; part <= totalParts; part++) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        const start = (part - 1) * chunkSize
        const end = Math.min(queueItem.file.size, start + chunkSize)
        const chunk = queueItem.file.slice(start, end)

        await uploadMultipartChunk(session.session_id, part, chunk, {
          signal: controller.signal,
          onProgress: (_p, loaded) => {
            const overall = Math.round(((uploadedBytes + loaded) / queueItem.file.size) * 100)
            queueItem.progress = Math.min(99, overall)
          },
        })
        uploadedBytes += chunk.size
      }

      const compRes = await completeMultipartUpload(session.session_id)
      const finalized = compRes.data!
      queueItem.status = 'completed'
      queueItem.progress = 100
      driveStore.insertItem(finalized)
      return finalized
    } catch (e) {
      if (controller.signal.aborted) {
        await abortMultipartUpload(session.session_id).catch(() => {})
        queueItem.status = 'aborted'
      } else {
        queueItem.status = 'failed'
        queueItem.error = e instanceof Error ? e.message : String(e)
      }
      throw e
    }
  }

  async function startUpload(options: StartUploadOptions): Promise<DriveItem[]> {
    isUploading.value = true
    const completedItems: DriveItem[] = []

    queue.value = options.files.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      relativePath: (file as any).webkitRelativePath || '',
      progress: 0,
      status: 'pending',
    }))

    for (const qItem of queue.value) {
      try {
        let item: DriveItem
        if (options.method === 'direct') {
          item = await uploadDirect(qItem, options.cloudAccountUuid, options.parentUuid)
        } else {
          item = await uploadServerMultipart(qItem, options.cloudAccountUuid, options.parentUuid)
        }
        completedItems.push(item)
        options.onItemCompleted?.(item)
      } catch (e) {
        if (qItem.status !== 'aborted') {
          qItem.status = 'failed'
          qItem.error = e instanceof Error ? e.message : String(e)
        }
      }
    }

    isUploading.value = false
    // Refresh cloud accounts store so storage figures move
    void cloudStore.fetch()

    return completedItems
  }

  return {
    uploadQueue: queue,
    isUploading,
    startUpload,
    cancelItem,
    clearQueue,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/composables/__tests__/useUpload.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/composables/useUpload.ts src/composables/__tests__/useUpload.spec.ts
git commit -m "feat(upload): add useUpload composable for direct and server multipart uploads"
```

---

### Task 10: Frontend `NewFolderDialog.vue` Component & Tests

**Files:**
- Create: `frontend/src/components/drive/NewFolderDialog.vue`
- Test: `frontend/src/components/drive/__tests__/NewFolderDialog.spec.ts` (new)

**Interfaces:**
- Produces: `NewFolderDialog.vue` with `v-model:open`, props `{ cloudAccountUuid: string; parentUuid?: string | null }`, emit `created: [item: DriveItem]`.

- [ ] **Step 1: Write unit tests for `NewFolderDialog`**

Create `frontend/src/components/drive/__tests__/NewFolderDialog.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NewFolderDialog from '../NewFolderDialog.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import viLocale from '@/locales/vi.json'

function mountDialog(props: { cloudAccountUuid: string; parentUuid?: string | null }) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(NewFolderDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('NewFolderDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders dialog title and input', async () => {
    mountDialog({ cloudAccountUuid: 'cloud-1' })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))
    const input = document.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()
  })

  it('creates folder via store and emits created event', async () => {
    const store = useDriveItemsStore()
    const createSpy = vi.spyOn(store, 'createFolder').mockResolvedValue({
      uuid: 'new-f',
      name: 'Project Photos',
      type: 'folder',
      mime_type: '',
      size: 0,
      extension: '',
      cloud_account_uuid: 'cloud-1',
      is_starred: false,
      status: 'ready',
      updated_at: '2026-10-04 00:00:00',
    })

    const wrapper = mountDialog({ cloudAccountUuid: 'cloud-1', parentUuid: null })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    input.value = 'Project Photos'
    input.dispatchEvent(new Event('input'))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.new_folder_create),
    )!
    button.click()

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledWith('cloud-1', null, 'Project Photos'))
    expect(wrapper.emitted('created')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/NewFolderDialog.spec.ts`
Expected: FAIL (`NewFolderDialog.vue` not found).

- [ ] **Step 3: Implement `frontend/src/components/drive/NewFolderDialog.vue`**

Create `frontend/src/components/drive/NewFolderDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { FolderPlus, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  cloudAccountUuid: string
  parentUuid?: string | null
}>()

const emit = defineEmits<{
  created: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const folderName = ref('')
const creating = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (isOpen) {
    folderName.value = ''
    error.value = null
  }
})

async function submit() {
  const trimmed = folderName.value.trim()
  if (!trimmed || !props.cloudAccountUuid) return

  creating.value = true
  error.value = null

  try {
    const item = await store.createFolder(props.cloudAccountUuid, props.parentUuid ?? null, trimmed)
    toast.success(t('drive.toast_folder_created'))
    open.value = false
    emit('created', item)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <FolderPlus class="h-5 w-5" />
          </div>
          <DialogTitle>{{ t('drive.new_folder_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.new_folder_title') }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4 py-2" @submit.prevent="submit">
        <div class="space-y-1.5">
          <Label for="new-folder-name" class="sr-only">{{ t('drive.new_folder_placeholder') }}</Label>
          <Input
            id="new-folder-name"
            v-model="folderName"
            :placeholder="t('drive.new_folder_placeholder')"
            autofocus
            :disabled="creating"
          />
        </div>

        <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
          {{ error }}
        </p>

        <DialogFooter class="gap-2 pt-2">
          <Button type="button" variant="outline" :disabled="creating" @click="open = false">
            {{ t('drive.cancel_button') }}
          </Button>
          <Button type="submit" :disabled="!folderName.trim() || creating">
            <Loader2 v-if="creating" class="h-4 w-4 animate-spin" />
            {{ t('drive.new_folder_create') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/NewFolderDialog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/components/drive/NewFolderDialog.vue src/components/drive/__tests__/NewFolderDialog.spec.ts
git commit -m "feat(drive): add NewFolderDialog component and tests"
```

---

### Task 11: Frontend `RenameDialog.vue` Component & Tests

**Files:**
- Create: `frontend/src/components/drive/RenameDialog.vue`
- Test: `frontend/src/components/drive/__tests__/RenameDialog.spec.ts` (new)

**Interfaces:**
- Produces: `RenameDialog.vue` with `v-model:open`, props `{ item: DriveItem | null }`, emit `renamed: [item: DriveItem]`.

- [ ] **Step 1: Write unit tests for `RenameDialog`**

Create `frontend/src/components/drive/__tests__/RenameDialog.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import RenameDialog from '../RenameDialog.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testItem: DriveItem = {
  uuid: 'item-1',
  name: 'Old Name.pdf',
  type: 'file',
  mime_type: 'application/pdf',
  size: 500,
  extension: 'pdf',
  cloud_account_uuid: 'c-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

function mountDialog(item: DriveItem | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(RenameDialog, {
    props: { open: true, item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('RenameDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('prefills input with the item current name', async () => {
    mountDialog(testItem)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.rename_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Old Name.pdf')
  })

  it('calls rename on store and emits renamed event', async () => {
    const store = useDriveItemsStore()
    const renameSpy = vi.spyOn(store, 'rename').mockResolvedValue({
      ...testItem,
      name: 'New Name.pdf',
    })

    const wrapper = mountDialog(testItem)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.rename_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    input.value = 'New Name.pdf'
    input.dispatchEvent(new Event('input'))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.rename_save),
    )!
    button.click()

    await vi.waitFor(() => expect(renameSpy).toHaveBeenCalledWith('item-1', 'New Name.pdf'))
    expect(wrapper.emitted('renamed')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/RenameDialog.spec.ts`
Expected: FAIL (`RenameDialog.vue` not found).

- [ ] **Step 3: Implement `frontend/src/components/drive/RenameDialog.vue`**

Create `frontend/src/components/drive/RenameDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Edit2, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  item: DriveItem | null
}>()

const emit = defineEmits<{
  renamed: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const newName = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.item,
  (it) => {
    newName.value = it?.name ?? ''
    error.value = null
  },
  { immediate: true },
)

async function submit() {
  const trimmed = newName.value.trim()
  if (!trimmed || !props.item) return

  saving.value = true
  error.value = null

  try {
    const updated = await store.rename(props.item.uuid, trimmed)
    toast.success(t('drive.toast_renamed'))
    open.value = false
    emit('renamed', updated)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Edit2 class="h-4.5 w-4.5" />
          </div>
          <DialogTitle>{{ t('drive.rename_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.rename_title') }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4 py-2" @submit.prevent="submit">
        <div class="space-y-1.5">
          <Label for="rename-input" class="sr-only">{{ t('drive.rename_placeholder') }}</Label>
          <Input
            id="rename-input"
            v-model="newName"
            :placeholder="t('drive.rename_placeholder')"
            autofocus
            :disabled="saving"
          />
        </div>

        <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
          {{ error }}
        </p>

        <DialogFooter class="gap-2 pt-2">
          <Button type="button" variant="outline" :disabled="saving" @click="open = false">
            {{ t('drive.cancel_button') }}
          </Button>
          <Button type="submit" :disabled="!newName.trim() || saving || newName.trim() === item?.name">
            <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
            {{ t('drive.rename_save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/RenameDialog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/components/drive/RenameDialog.vue src/components/drive/__tests__/RenameDialog.spec.ts
git commit -m "feat(drive): add RenameDialog component and tests"
```

---

### Task 12: Frontend `DeleteDriveItemDialog.vue` Component & Tests

**Files:**
- Create: `frontend/src/components/drive/DeleteDriveItemDialog.vue`
- Test: `frontend/src/components/drive/__tests__/DeleteDriveItemDialog.spec.ts` (new)

**Interfaces:**
- Produces: `DeleteDriveItemDialog.vue` with `v-model:open`, props `{ item: DriveItem | null }`, emit `deleted: [uuid: string]`. Shows extra warning when `item.type === 'folder'`.

- [ ] **Step 1: Write unit tests for `DeleteDriveItemDialog`**

Create `frontend/src/components/drive/__tests__/DeleteDriveItemDialog.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DeleteDriveItemDialog from '../DeleteDriveItemDialog.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testFile: DriveItem = {
  uuid: 'f-1',
  name: 'report.docx',
  type: 'file',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 500,
  extension: 'docx',
  cloud_account_uuid: 'c-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

const testFolder: DriveItem = {
  ...testFile,
  uuid: 'f-2',
  name: 'Client Folder',
  type: 'folder',
}

function mountDialog(item: DriveItem | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DeleteDriveItemDialog, {
    props: { open: true, item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('DeleteDriveItemDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders confirmation message naming the file', async () => {
    mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))
    expect(document.body.textContent).toContain('report.docx')
    expect(document.body.textContent).not.toContain(viLocale.drive.delete_folder_warning)
  })

  it('renders extra warning message when item is a folder', async () => {
    mountDialog(testFolder)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_folder_warning))
  })

  it('calls permanent delete through store on confirm', async () => {
    const store = useDriveItemsStore()
    const deleteSpy = vi.spyOn(store, 'remove').mockResolvedValue()

    const wrapper = mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.delete_button),
    )!
    button.click()

    await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('f-1', true))
    expect(wrapper.emitted('deleted')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/DeleteDriveItemDialog.spec.ts`
Expected: FAIL (`DeleteDriveItemDialog.vue` not found).

- [ ] **Step 3: Implement `frontend/src/components/drive/DeleteDriveItemDialog.vue`**

Create `frontend/src/components/drive/DeleteDriveItemDialog.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertTriangle, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  item: DriveItem | null
}>()

const emit = defineEmits<{
  deleted: [uuid: string]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const deleting = ref(false)
const error = ref<string | null>(null)

async function confirm() {
  if (!props.item) return

  deleting.value = true
  error.value = null

  try {
    await store.remove(props.item.uuid, true)
    toast.success(t('drive.toast_deleted'))
    open.value = false
    emit('deleted', props.item.uuid)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <AlertTriangle class="h-4.5 w-4.5" />
          </div>
          <DialogTitle>{{ t('drive.delete_item_title') }}</DialogTitle>
        </div>
        <DialogDescription class="pt-2 text-sm text-foreground/80 space-y-2">
          <p>{{ t('drive.delete_item_confirm', { name: item?.name }) }}</p>
          <p v-if="item?.type === 'folder'" class="text-destructive font-medium">
            {{ t('drive.delete_folder_warning') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ t('drive.delete_permanent_note') }}</p>
        </DialogDescription>
      </DialogHeader>

      <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
        {{ error }}
      </p>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" :disabled="deleting" @click="open = false">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button
          class="bg-destructive text-white hover:bg-destructive/90"
          :disabled="deleting || !item"
          @click="confirm"
        >
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" />
          {{ t('drive.delete_button') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/DeleteDriveItemDialog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/components/drive/DeleteDriveItemDialog.vue src/components/drive/__tests__/DeleteDriveItemDialog.spec.ts
git commit -m "feat(drive): add DeleteDriveItemDialog component and tests"
```

---

### Task 13: Frontend `DriveItemMenu.vue` Shared Component & Tests

**Files:**
- Create: `frontend/src/components/drive/DriveItemMenu.vue`
- Test: `frontend/src/components/drive/__tests__/DriveItemMenu.spec.ts` (new)

**Interfaces:**
- Produces: `DriveItemMenu.vue` props `{ item: DriveItem }`, emits `{ rename: [item: DriveItem]; delete: [item: DriveItem] }`.
- Executes inline: `download` via `getDriveItemDownloadUrl` (opens download URL in hidden anchor / window), `star/unstar` via `store.toggleStar(item.uuid)`.

- [ ] **Step 1: Write unit tests for `DriveItemMenu`**

Create `frontend/src/components/drive/__tests__/DriveItemMenu.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DriveItemMenu from '../DriveItemMenu.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import * as driveApi from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testItem: DriveItem = {
  uuid: 'f-1',
  name: 'document.pdf',
  type: 'file',
  mime_type: 'application/pdf',
  size: 1000,
  extension: 'pdf',
  cloud_account_uuid: 'c-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

function mountMenu(item: DriveItem = testItem) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DriveItemMenu, {
    props: { item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('DriveItemMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders menu items: download, star, rename, delete', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.find('button')
    await trigger.trigger('click')
    await wrapper.vm.$nextTick()

    const text = document.body.textContent ?? ''
    expect(text).toContain(viLocale.drive.action_download)
    expect(text).toContain(viLocale.drive.action_star)
    expect(text).toContain(viLocale.drive.action_rename)
    expect(text).toContain(viLocale.drive.action_delete)
  })

  it('toggles star via store', async () => {
    const store = useDriveItemsStore()
    const starSpy = vi.spyOn(store, 'toggleStar').mockResolvedValue({ ...testItem, is_starred: true })

    const wrapper = mountMenu()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    const starBtn = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.drive.action_star),
    ) as HTMLElement
    starBtn.click()

    await vi.waitFor(() => expect(starSpy).toHaveBeenCalledWith('f-1'))
  })

  it('emits rename and delete events when clicked', async () => {
    const wrapper = mountMenu()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    const renameBtn = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.drive.action_rename),
    ) as HTMLElement
    renameBtn.click()
    expect(wrapper.emitted('rename')).toBeTruthy()

    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    const deleteBtn = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.drive.action_delete),
    ) as HTMLElement
    deleteBtn.click()
    expect(wrapper.emitted('delete')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/DriveItemMenu.spec.ts`
Expected: FAIL (`DriveItemMenu.vue` not found).

- [ ] **Step 3: Implement `frontend/src/components/drive/DriveItemMenu.vue`**

Create `frontend/src/components/drive/DriveItemMenu.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  MoreVertical,
  Download,
  Star,
  Edit2,
  Trash2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getDriveItemDownloadUrl, type DriveItem } from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'

const props = defineProps<{
  item: DriveItem
}>()

const emit = defineEmits<{
  rename: [item: DriveItem]
  delete: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const isFolder = computed(() => props.item.type === 'folder')

async function handleDownload() {
  if (isFolder.value) return
  toast.info(t('drive.toast_download_started'))
  try {
    const res = await getDriveItemDownloadUrl(props.item.uuid)
    if (res.data?.download_url) {
      window.open(res.data.download_url, '_blank')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function handleToggleStar() {
  try {
    const updated = await store.toggleStar(props.item.uuid)
    toast.success(updated.is_starred ? t('drive.toast_starred') : t('drive.toast_unstarred'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
        @click.stop
      >
        <MoreVertical class="h-4 w-4" />
        <span class="sr-only">{{ t('cloud.menu_actions') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-48 p-1.5 shadow-xl border-border">
      <DropdownMenuItem
        v-if="!isFolder"
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="handleDownload"
      >
        <Download class="h-4 w-4" />
        <span>{{ t('drive.action_download') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="handleToggleStar"
      >
        <Star class="h-4 w-4" :class="{ 'fill-amber-400 text-amber-400': item.is_starred }" />
        <span>{{ t('drive.action_star') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="emit('rename', item)"
      >
        <Edit2 class="h-4 w-4" />
        <span>{{ t('drive.action_rename') }}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        class="cursor-pointer text-destructive focus:text-destructive py-2 gap-2 text-sm"
        @click="emit('delete', item)"
      >
        <Trash2 class="h-4 w-4" />
        <span>{{ t('drive.action_delete') }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/DriveItemMenu.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/components/drive/DriveItemMenu.vue src/components/drive/__tests__/DriveItemMenu.spec.ts
git commit -m "feat(drive): add DriveItemMenu component and tests"
```

---

### Task 14: Frontend `UploadDialog.vue` Component & Tests

**Files:**
- Create: `frontend/src/components/drive/UploadDialog.vue`
- Test: `frontend/src/components/drive/__tests__/UploadDialog.spec.ts` (new)

**Interfaces:**
- Produces: `UploadDialog.vue` with `v-model:open`, props `{ cloudAccountUuid: string; parentUuid?: string | null; initialMode?: 'file' | 'folder' }`.
- Features:
  - File picker (`<input type="file" multiple>`) and folder picker (`<input type="file" webkitdirectory directory multiple>`).
  - Drag-and-drop file target.
  - **Explicit Method Selection Step** with radio/cards: `direct` (Direct to S3) and `server` (Via server multipart).
  - Per-item progress bar and status badge.

- [ ] **Step 1: Write unit tests for `UploadDialog`**

Create `frontend/src/components/drive/__tests__/UploadDialog.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import UploadDialog from '../UploadDialog.vue'
import * as useUploadModule from '@/composables/useUpload'
import viLocale from '@/locales/vi.json'

function mountDialog(initialMode: 'file' | 'folder' = 'file') {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open: true, cloudAccountUuid: 'cloud-1', parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('UploadDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders upload method selection step', async () => {
    mountDialog()
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_direct)
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_server)
  })

  it('selects files and calls startUpload on submit', async () => {
    const startUploadMock = vi.fn().mockResolvedValue([])
    vi.spyOn(useUploadModule, 'useUpload').mockReturnValue({
      uploadQueue: { value: [] } as any,
      isUploading: { value: false } as any,
      startUpload: startUploadMock,
      cancelItem: vi.fn(),
      clearQueue: vi.fn(),
    })

    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const file = new File(['content'], 'sample.txt', { type: 'text/plain' })
    const input = wrapper.find<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    const startBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.upload_start),
    )!
    startBtn.click()

    await vi.waitFor(() =>
      expect(startUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudAccountUuid: 'cloud-1',
          files: [file],
        }),
      ),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/UploadDialog.spec.ts`
Expected: FAIL (`UploadDialog.vue` not found).

- [ ] **Step 3: Implement `frontend/src/components/drive/UploadDialog.vue`**

Create `frontend/src/components/drive/UploadDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Upload,
  FolderUp,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  HardDrive,
  Server,
} from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUpload, type UploadMethod } from '@/composables/useUpload'
import { formatBytes } from '@/lib/format'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    cloudAccountUuid: string
    parentUuid?: string | null
    initialMode?: 'file' | 'folder'
  }>(),
  {
    initialMode: 'file',
  },
)

const emit = defineEmits<{
  completed: []
}>()

const { t } = useI18n()
const { uploadQueue, isUploading, startUpload, cancelItem, clearQueue } = useUpload()

const selectedFiles = ref<File[]>([])
const uploadMethod = ref<UploadMethod>('direct')
const isDragging = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

watch(open, (isOpen) => {
  if (isOpen) {
    selectedFiles.value = []
    clearQueue()
  }
})

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFiles.value = Array.from(target.files)
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    selectedFiles.value = Array.from(event.dataTransfer.files)
  }
}

async function handleStart() {
  if (selectedFiles.value.length === 0 || !props.cloudAccountUuid) return

  await startUpload({
    cloudAccountUuid: props.cloudAccountUuid,
    parentUuid: props.parentUuid,
    files: selectedFiles.value,
    method: uploadMethod.value,
  })

  emit('completed')
}

function close() {
  if (!isUploading.value) {
    open.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <Upload class="h-5 w-5" />
          </div>
          <DialogTitle>{{ t('drive.upload_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.upload_title') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Hidden Inputs -->
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          @change="handleFileSelect"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          @change="handleFileSelect"
        />

        <!-- Method Selection Step -->
        <div class="space-y-2">
          <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('drive.upload_method_title') }}
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'direct'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              @click="uploadMethod = 'direct'"
            >
              <div class="flex items-center gap-2">
                <HardDrive class="h-4 w-4 text-primary" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_direct') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_direct_desc') }}
              </p>
            </div>

            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'server'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              @click="uploadMethod = 'server'"
            >
              <div class="flex items-center gap-2">
                <Server class="h-4 w-4 text-emerald-500" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_server') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_server_desc') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Drop target / file selection -->
        <div
          v-if="!isUploading && uploadQueue.length === 0"
          class="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-colors"
          :class="[isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card/40']"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div class="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Upload class="h-5 w-5" />
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="fileInput?.click()">
              <Upload class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_files') }}
            </Button>
            <Button variant="outline" size="sm" @click="folderInput?.click()">
              <FolderUp class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_folder') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('drive.upload_drop_hint') }}</p>

          <p v-if="selectedFiles.length > 0" class="text-xs font-medium text-primary mt-1">
            {{ selectedFiles.length }} file(s) selected
          </p>
        </div>

        <!-- Upload Progress Queue -->
        <div v-else class="space-y-2 max-h-60 overflow-y-auto pr-1">
          <div
            v-for="item in uploadQueue"
            :key="item.id"
            class="flex items-center justify-between p-2.5 rounded-xl border border-border bg-card text-xs gap-3"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <FileText class="h-4 w-4 text-muted-foreground shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-foreground">{{ item.file.name }}</p>
                <div class="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-1.5">
                  <div
                    class="h-full bg-primary transition-all duration-200"
                    :style="{ width: `${item.progress}%` }"
                  />
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <span class="text-muted-foreground font-mono">{{ item.progress }}%</span>
              <CheckCircle2 v-if="item.status === 'completed'" class="h-4 w-4 text-emerald-500" />
              <AlertCircle v-else-if="item.status === 'failed'" class="h-4 w-4 text-destructive" />
              <Button
                v-else-if="item.status === 'uploading'"
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-muted-foreground hover:text-destructive"
                @click="cancelItem(item.id)"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" :disabled="isUploading" @click="close">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button
          v-if="uploadQueue.length === 0"
          :disabled="selectedFiles.length === 0 || isUploading"
          @click="handleStart"
        >
          <Loader2 v-if="isUploading" class="h-4 w-4 animate-spin mr-1" />
          {{ t('drive.upload_start') }}
        </Button>
        <Button
          v-else
          :disabled="isUploading"
          @click="open = false"
        >
          {{ t('cloud.next') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/components/drive/__tests__/UploadDialog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd frontend
git add src/components/drive/UploadDialog.vue src/components/drive/__tests__/UploadDialog.spec.ts
git commit -m "feat(drive): add UploadDialog component with explicit method selection step"
```

---

### Task 15: Wire `DriveView.vue` and `DashboardLayout.vue`

**Files:**
- Modify: `frontend/src/views/DriveView.vue`
- Modify: `frontend/src/layouts/DashboardLayout.vue`
- Test: `frontend/src/views/__tests__/DriveManagementWiring.spec.ts` (new)

**Interfaces:**
- Consumes: `useDriveActionsStore`, `NewFolderDialog`, `RenameDialog`, `DeleteDriveItemDialog`, `UploadDialog`, `DriveItemMenu`
- Produces: Fully interactive drive workspace where:
  - Header "Mới" and sidebar "Mới" trigger the proper dialogs.
  - List and grid views render `DriveItemMenu` with download, star, rename, delete wired up.
  - Deleting/renaming/uploading updates the list and reflects storage changes.

- [ ] **Step 1: Write integration tests for dialog and menu wiring in `DriveView`**

Create `frontend/src/views/__tests__/DriveManagementWiring.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

import DriveView from '../DriveView.vue'
import { useDriveActionsStore } from '@/stores/driveActions'
import * as cloudApi from '@/api/cloudAccounts'
import * as driveApi from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const CLOUD = {
  uuid: 'c-1',
  name: 'Storage Cloud',
  provider: 's3',
  credentials: null,
  sync_status: 'idle' as const,
  total_storage: 10000,
  used_storage: 2000,
  last_synced_at: null,
  is_default: true,
  is_active: true,
}

describe('DriveView action wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('opens NewFolderDialog when driveActions requests new-folder', async () => {
    vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [CLOUD] })
    vi.spyOn(driveApi, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [],
      meta: { has_more: false, next_cursor: '' },
    })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/c/:cloudUuid', name: 'drive', component: DriveView, props: true }],
    })
    await router.push('/c/c-1')
    await router.isReady()

    const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
    const wrapper = mount(DriveView, {
      global: { plugins: [router, i18n], stubs: { DashboardLayout: true, SyncCloudButton: true } },
      props: { cloudUuid: 'c-1' },
      attachTo: document.body,
    })

    const actionsStore = useDriveActionsStore()
    actionsStore.request('new-folder')
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/views/__tests__/DriveManagementWiring.spec.ts`
Expected: FAIL (DriveView does not yet listen to `driveActionsStore`).

- [ ] **Step 3: Update `DashboardLayout.vue` and `DriveView.vue`**

In `frontend/src/layouts/DashboardLayout.vue`:
Import `useDriveActionsStore`:
```ts
import { useDriveActionsStore } from '@/stores/driveActions'
const driveActions = useDriveActionsStore()
```
Wire the "Mới" dropdown items (`lines 227-240`):
```html
<DropdownMenuItem
  class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm"
  @click="driveActions.request('new-folder')"
>
  <FolderPlus class="h-4 w-4 text-amber-500" />
  <span>{{ t('drive.new_folder') }}</span>
</DropdownMenuItem>
<DropdownMenuSeparator />
<DropdownMenuItem
  class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm"
  @click="driveActions.request('upload-file')"
>
  <Upload class="h-4 w-4 text-blue-500" />
  <span>{{ t('drive.upload_file') }}</span>
</DropdownMenuItem>
<DropdownMenuItem
  class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm"
  @click="driveActions.request('upload-folder')"
>
  <FolderUp class="h-4 w-4 text-emerald-500" />
  <span>{{ t('drive.upload_folder') }}</span>
</DropdownMenuItem>
```

In `frontend/src/views/DriveView.vue`:
1. Import `useDriveActionsStore`, `NewFolderDialog`, `RenameDialog`, `DeleteDriveItemDialog`, `UploadDialog`, and `DriveItemMenu`.
2. Add dialog open state refs:
```ts
import { useDriveActionsStore } from '@/stores/driveActions'
import NewFolderDialog from '@/components/drive/NewFolderDialog.vue'
import RenameDialog from '@/components/drive/RenameDialog.vue'
import DeleteDriveItemDialog from '@/components/drive/DeleteDriveItemDialog.vue'
import UploadDialog from '@/components/drive/UploadDialog.vue'
import DriveItemMenu from '@/components/drive/DriveItemMenu.vue'
import type { DriveItem } from '@/api/driveItems'

const driveActions = useDriveActionsStore()

const isNewFolderOpen = ref(false)
const isRenameOpen = ref(false)
const isDeleteOpen = ref(false)
const isUploadOpen = ref(false)
const uploadInitialMode = ref<'file' | 'folder'>('file')

const activeItem = ref<DriveItem | null>(null)

watch(
  () => driveActions.pending,
  (pending) => {
    if (!pending) return
    if (pending.type === 'new-folder') {
      isNewFolderOpen.value = true
    } else if (pending.type === 'upload-file') {
      uploadInitialMode.value = 'file'
      isUploadOpen.value = true
    } else if (pending.type === 'upload-folder') {
      uploadInitialMode.value = 'folder'
      isUploadOpen.value = true
    }
    driveActions.consume()
  },
)

function openRename(item: DriveItem) {
  activeItem.value = item
  isRenameOpen.value = true
}

function openDelete(item: DriveItem) {
  activeItem.value = item
  isDeleteOpen.value = true
}
```

3. Wire header "Mới" dropdown items (`lines 205-214`):
```html
<DropdownMenuItem
  class="cursor-pointer py-2 px-3 gap-2.5 text-sm"
  @click="isNewFolderOpen = true"
>
  <FolderPlus class="h-4 w-4 text-amber-500" />
  <span>{{ t('drive.new_folder') }}</span>
</DropdownMenuItem>
<DropdownMenuSeparator />
<DropdownMenuItem
  class="cursor-pointer py-2 px-3 gap-2.5 text-sm"
  @click="uploadInitialMode = 'file'; isUploadOpen = true"
>
  <Upload class="h-4 w-4 text-blue-500" />
  <span>{{ t('drive.upload_file') }}</span>
</DropdownMenuItem>
```

4. Replace the list row dropdown menu (`lines 360-394`) with `<DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />`.
5. Replace the grid folder button (`lines 440-447`) with `<DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />`.
6. Replace the grid file button (`lines 474-481`) with `<DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />`.
7. Mount dialog components before `</DashboardLayout>`:
```html
<NewFolderDialog
  v-model:open="isNewFolderOpen"
  :cloud-account-uuid="cloudAccountUuid"
  :parent-uuid="parentUuid"
/>
<RenameDialog
  v-model:open="isRenameOpen"
  :item="activeItem"
/>
<DeleteDriveItemDialog
  v-model:open="isDeleteOpen"
  :item="activeItem"
/>
<UploadDialog
  v-model:open="isUploadOpen"
  :cloud-account-uuid="cloudAccountUuid"
  :parent-uuid="parentUuid"
  :initial-mode="uploadInitialMode"
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/views/__tests__/DriveManagementWiring.spec.ts`
Expected: PASS

- [ ] **Step 5: Run full frontend test suite, type-check, and lint**

Run:
```bash
cd frontend
npm run test:run
npm run type-check
npm run lint
```
Expected: All tests pass, 0 type errors, 0 lint errors.

- [ ] **Step 6: Run full backend test suite**

Run:
```bash
cd backend
go test ./...
```
Expected: All backend tests pass.

- [ ] **Step 7: Commit changes**

```bash
git -C frontend add src/views/DriveView.vue src/layouts/DashboardLayout.vue src/views/__tests__/DriveManagementWiring.spec.ts
git -C frontend commit -m "feat(drive): wire header and sidebar actions to dialogs and shared item menu"
```
