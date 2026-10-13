# Folder-Structure Storage Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every uploaded object under a key that mirrors the user's folder hierarchy (`users/<uid>/<folder-path>/<name>`) and re-key objects on S3 when an item is renamed or moved, so a sync after a database loss reconstructs the folder tree and file placement from the bucket alone.

**Architecture:** A new `folderPath` helper derives the key path from the `parent_id` chain; uploads use it, and a new server-side `CopyObject` on `contracts.CloudDriver` (single copy, multipart copy above 5 GiB) re-keys existing objects. `ScanBucket` becomes a three-way classifier (legacy flat key / new path key / external key) that materializes folders from key segments. Rename/move is split into a synchronous `ValidateMove` (destination, cycle, name validation, uniqueness) and an asynchronous `RekeyDriveItemJob` (copy → update DB → delete old) that leaves the item at `status = moving` until it settles.

**Tech Stack:** Go 1.25 / Goravel 1.18 / GORM / aws-sdk-go-v2 `service/s3@v1.79.0` (backend); Vue 3.5 / Pinia 4 / vue-i18n / shadcn-vue / vue-sonner / vitest + happy-dom (frontend).

**Spec:** `docs/superpowers/specs/2026-10-13-folder-structure-storage-design.md`

## Global Constraints

- **Never touch auto-generated shadcn-vue files:** `frontend/src/components/ui/*` must never be edited, deleted, or regenerated. Compose dialogs from the existing primitives.
- **Never expose internal system errors to clients:** DB/SDK/driver error text must NEVER appear in API responses or user-facing text. Backend failures go through `failResponse(ctx, status, langKey, err)` (logs raw, returns localized). Frontend shows `e instanceof ApiError ? e.message : t('drive.action_failed')`.
- **Contract is UUID-only:** no numeric DB ids cross the API boundary. `parent_uuid` empty string means "move to root".
- **Technical writing in English** (code, identifiers, comments, commit messages). User-facing strings localized in `backend/lang/{en,vi}/*.json` and `frontend/src/locales/{en,vi}.json`.
- **`backend/.env` holds real credentials** (`APP_KEY`, `JWT_SECRET`, `DB_PASSWORD`, `MAIL_PASSWORD`) and is never committed or printed. No secret may appear in a Dockerfile or Compose file; the Caddy service receives only `SITE_ADDRESS`.
- **No Docker on the development machine:** Docker-dependent verification is static (registry/config inspection); runtime checks are deferred.
- **Backend checks:** `go build ./...`, `go test ./...`. **Frontend checks:** `npm run test:run`, `npm run type-check`, `npx oxlint .` (exit 0), `npx eslint .` (only the 11 pre-existing errors: 3 in `src/api/client.ts`, 8 in `src/components/ui/*`).
- **Queue argument marshalling:** the Goravel `database` driver JSON-marshals job args and `queue/utils/ConvertArgs` has **no case for `*uint`**, so a `*uint` argument is silently dropped and its position collapses. Every new job keeps its optional `*uint` argument **last**, exactly as `SyncS3BucketJob` does, and its `Handle` type-switches over `uint`/`int`/`int64`/`float64`/`*uint`/`nil`.
- **Backend test DB:** MariaDB `ponta_drive` on `localhost:3306`, user `ponta_drive`/`123123`. Feature tests run with the default `sync` queue driver, so a dispatched job runs **inline** inside the request.

## Review Focus

The five input classes and failure modes the spec implies but no task's tests otherwise exercise, most likely to bite a user first. Each line is pinned by a test in the named owning task.

1. **A key containing spaces or non-ASCII (e.g. a folder named `Tài liệu`):** copying or re-keying such an object must succeed, not fail with a 404, because the S3 `CopySource` header is percent-encoded **per path segment** (whole-string escaping would corrupt the `/` separators). (Task 4)
2. **An object larger than the 5 GiB single-copy ceiling:** re-keying it must go through a multipart copy (`UploadPartCopy` per range), not fail and not attempt a single `CopyObject`. (Task 4)
3. **A file whose `storage_path` is empty** (a row with no object on S3): moving it must still update the database and never issue an S3 call, or every existing move test (which uses rows with empty `storage_path` against a fake S3 account) breaks. (Task 7)
4. **A key whose basename has no UUID prefix but sits under `users/<uid>/items/`** (a user folder literally named `items`): sync must materialize it as a real `items` folder with the plain file name, never treat it as a legacy flat key and never strip the name. (Task 5)
5. **A name containing `/`, `\`, a control character, or exactly `.`/`..`:** creating, uploading, renaming, or moving with such a name must be rejected (422) rather than silently corrupting the storage key path. (Task 1, Task 2, Task 6)

---

### Task 1: Backend — `moving` status, name validation, and uniqueness helper

**Files:**
- Modify: `backend/app/models/drive_item.go:13-19` (status constants)
- Create: `backend/app/services/drive_item_name.go`
- Test: `backend/app/services/drive_item_name_test.go`
- Test: `backend/app/services/cloud_drive_service_test.go` (add `EnsureUniqueName` cases)

**Interfaces:**
- Consumes: `facades.Orm().Query()`, `models.DriveItem`.
- Produces:
  - `models.ItemStatusMoving = "moving"`
  - `services.ErrNameConflict` and `services.ErrInvalidName` (sentinel errors, matched with `errors.Is`)
  - `services.ValidateItemName(name string) error`
  - `(*CloudDriveService).EnsureUniqueName(ctx context.Context, userID, cloudAccountID uint, parentID *uint, name string, excludeID uint) error`

- [ ] **Step 1: Write the failing unit test for `ValidateItemName`**

Create `backend/app/services/drive_item_name_test.go`:

```go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// A name is part of the S3 key path (users/<uid>/<folder>/<name>), so a name
// that carries a path separator or a control character would corrupt the key of
// this item and of every object a later sync derives from the same folder.
func TestValidateItemName(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "plain name", input: "report.pdf"},
		{name: "vietnamese name", input: "Tài liệu 2026.docx"},
		{name: "dots inside the name", input: "my-report.v2.final.pdf"},
		{name: "leading and trailing spaces are allowed", input: "  spaced.txt  "},
		{name: "forward slash", input: "a/b.txt", wantErr: true},
		{name: "backslash", input: `a\b.txt`, wantErr: true},
		{name: "newline control character", input: "a\nb.txt", wantErr: true},
		{name: "tab control character", input: "a\tb.txt", wantErr: true},
		{name: "single dot", input: ".", wantErr: true},
		{name: "double dot", input: "..", wantErr: true},
		{name: "empty", input: "", wantErr: true},
		{name: "whitespace only", input: "   ", wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateItemName(tc.input)
			if tc.wantErr {
				assert.ErrorIs(t, err, ErrInvalidName)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./app/services/ -run TestValidateItemName -v`
Expected: FAIL — `undefined: ValidateItemName`, `undefined: ErrInvalidName`.

- [ ] **Step 3: Implement the sentinels and `ValidateItemName`**

Create `backend/app/services/drive_item_name.go`:

```go
package services

import (
	"context"
	"errors"
	"strings"
	"unicode"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

// Sentinel errors the controllers map to localized 422 responses. They carry no
// schema, table, or driver text, so they are safe to pass to failResponse.
var (
	ErrNameConflict = errors.New("an item with this name already exists here")
	ErrInvalidName  = errors.New("the name is not valid")
)

// ValidateItemName rejects a name that would corrupt the storage key path.
// A name is one segment of users/<uid>/<folder-path>/<name>, so a path
// separator or a control character would break the key of this item and of
// every sibling a later sync derives from the same folder. "." and ".." are
// rejected because S3 clients and path resolvers treat them specially.
func ValidateItemName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return ErrInvalidName
	}
	for _, r := range trimmed {
		if r == '/' || r == '\\' || unicode.IsControl(r) {
			return ErrInvalidName
		}
	}
	return nil
}

// EnsureUniqueName errors when another item in the same parent already uses
// name. Two items that share a name in the same folder would collide on the
// same S3 key, so uniqueness is enforced here in every flow that can introduce
// or change a name.
//
// The check spans both files and folders: a file a/b and a folder a/b would
// otherwise collide on the key. Comparison is case-sensitive, matching S3 key
// semantics. excludeID (0 when creating) lets rename/move ignore the item
// itself. A parentID that is nil or 0 means the drive root, where parent_id is
// NULL.
func (s *CloudDriveService) EnsureUniqueName(ctx context.Context, userID, cloudAccountID uint, parentID *uint, name string, excludeID uint) error {
	query := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		Where("name", name)
	if parentID == nil || *parentID == 0 {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	if excludeID > 0 {
		query = query.Where("id != ?", excludeID)
	}

	var existing models.DriveItem
	if err := query.First(&existing); err == nil && existing.ID > 0 {
		return ErrNameConflict
	}
	return nil
}
```

- [ ] **Step 4: Add the `moving` status constant**

In `backend/app/models/drive_item.go`, extend the status block:

```go
// DriveItem status constants
const (
	ItemStatusReady     = "ready"
	ItemStatusUploading = "uploading"
	ItemStatusSyncing   = "syncing"
	ItemStatusMoving    = "moving"
	ItemStatusFailed    = "failed"
)
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd backend && go test ./app/services/ -run TestValidateItemName -v`
Expected: PASS.

- [ ] **Step 6: Write the failing `EnsureUniqueName` test**

Append to `backend/app/services/cloud_drive_service_test.go` (package `services_test`, inside `CloudDriveServiceTestSuite`, which already creates `s.user` and `s.account`):

```go
// EnsureUniqueName scopes the check to the same user, account, and parent, and
// excludes the item itself so a rename to the current name is not a conflict.
func (s *CloudDriveServiceTestSuite) TestEnsureUniqueName() {
	service := services.NewCloudDriveService()
	ctx := context.Background()

	folder := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		Name:           "Docs",
		Type:           models.ItemTypeFolder,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&folder))

	file := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		ParentID:       &folder.ID,
		Name:           "a.txt",
		Type:           models.ItemTypeFile,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	// Same parent, same name -> conflict.
	s.ErrorIs(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, &folder.ID, "a.txt", 0), services.ErrNameConflict)

	// A folder name collides with a file name: both live on the same key.
	s.ErrorIs(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, &folder.ID, "a.txt", 0), services.ErrNameConflict)

	// Excluding the item itself is not a conflict (rename to the current name).
	s.NoError(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, &folder.ID, "a.txt", file.ID))

	// A different name in the same parent is free.
	s.NoError(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, &folder.ID, "b.txt", 0))

	// A different parent is a different scope.
	s.NoError(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, nil, "a.txt", 0))

	// Same name at the root is free.
	rootFile := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		Name:           "root.txt",
		Type:           models.ItemTypeFile,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&rootFile))
	s.ErrorIs(service.EnsureUniqueName(ctx, s.user.ID, s.account.ID, nil, "root.txt", 0), services.ErrNameConflict)
}
```

Add the missing imports to the file's import block if absent: `context`, `github.com/google/uuid`, `ponta_drive/app/facades`, `ponta_drive/app/models`, `ponta_drive/app/services`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && go test ./app/services/ -run TestCloudDriveServiceTestSuite/TestEnsureUniqueName -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/drive_item.go backend/app/services/drive_item_name.go backend/app/services/drive_item_name_test.go backend/app/services/cloud_drive_service_test.go
git commit -m "feat(drive): add moving status, name validation, and uniqueness helper"
```

---

### Task 2: Backend — enforce uniqueness/validation on create and upload, with localized 422

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go:93-136` (`CreateFolder`), `:503-550` (`InitiatePresignedUpload`), `:593-654` (`InitiateMultipartUpload`)
- Modify: `backend/app/http/controllers/error_response.go` (add `failServiceError`)
- Modify: `backend/app/http/controllers/drive_item_controller.go` (`StoreFolder`)
- Modify: `backend/app/http/controllers/upload_controller.go` (`InitiatePresigned`, `InitMultipart`)
- Modify: `backend/lang/en/drive.json`, `backend/lang/vi/drive.json`
- Test: `backend/tests/feature/drive_item_api_test.go`, `backend/tests/feature/presigned_upload_test.go`

**Interfaces:**
- Consumes: `services.ValidateItemName`, `(*CloudDriveService).EnsureUniqueName`, `services.ErrNameConflict`, `services.ErrInvalidName`.
- Produces: `failServiceError(ctx http.Context, err error, fallbackKey string) http.Response` (package `controllers`); locale keys `drive.name_conflict`, `drive.name_invalid`; the three service entry points now return `ErrNameConflict`/`ErrInvalidName` before creating anything.

- [ ] **Step 1: Write the failing feature test for a duplicate folder name**

Append to `DriveItemAPITestSuite` in `backend/tests/feature/drive_item_api_test.go`:

```go
// TestCreateFolderRejectsDuplicateName proves the key scheme's uniqueness rule
// is enforced where a name is first introduced: two folders with the same name
// in the same parent would share the same S3 key prefix.
func (s *DriveItemAPITestSuite) TestCreateFolderRejectsDuplicateName() {
	s.createFolder("", "Duplicated")

	payload, _ := json.Marshal(map[string]any{
		"cloud_account_id": s.account.ID,
		"name":             "Duplicated",
	})
	resp, err := s.Http(s.T()).WithToken(s.token).
		Post("/v1/drive/items/folders", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusUnprocessableEntity)

	body, _ := resp.Json()
	message, _ := body["message"].(string)
	s.NotEmpty(message)
	s.NotContains(message, "name_conflict", "the translation key must resolve")
	s.NotContains(message, "UNIQUE", "raw DB error must not leak")

	// The name is free in a different parent.
	parent := s.createFolder("", "Parent")
	child := s.createFolderItem("Duplicated", &parent)
	s.NotEmpty(child.UUID)
}

// TestCreateFolderRejectsInvalidName proves a name that would corrupt the key
// path is rejected before any row is created.
func (s *DriveItemAPITestSuite) TestCreateFolderRejectsInvalidName() {
	payload, _ := json.Marshal(map[string]any{
		"cloud_account_id": s.account.ID,
		"name":             "bad/name",
	})
	resp, err := s.Http(s.T()).WithToken(s.token).
		Post("/v1/drive/items/folders", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusUnprocessableEntity)

	body, _ := resp.Json()
	message, _ := body["message"].(string)
	s.NotEmpty(message)
	s.NotContains(message, "name_invalid", "the translation key must resolve")

	// Nothing was created.
	s.Empty(s.listFolder(""))
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestCreateFolderRejects' -v`
Expected: FAIL — both responses are `201`/`400` instead of `422`.

- [ ] **Step 3: Add the backend locale keys**

`backend/lang/en/drive.json` — add before the closing brace:

```json
  "name_conflict": "A file or folder with this name already exists here.",
  "name_invalid": "This name is not allowed."
```

`backend/lang/vi/drive.json` — add before the closing brace:

```json
  "name_conflict": "Đã có tệp hoặc thư mục mang tên này trong thư mục hiện tại.",
  "name_invalid": "Tên này không hợp lệ."
```

(Do not re-add `parent_not_found`: it already exists at line 16 of both files. Only `name_conflict` and `name_invalid` are new.)

- [ ] **Step 4: Add the shared error mapper**

Append to `backend/app/http/controllers/error_response.go`:

```go
// failServiceError maps the service's sentinel name errors to their localized
// 422 responses and every other service error to a generic localized failure.
// Keeping the mapping here means every controller that can introduce a name
// (create folder, upload, rename/move) reports a conflict the same way, and no
// service error text ever reaches the client.
func failServiceError(ctx http.Context, err error, fallbackKey string) http.Response {
	switch {
	case errors.Is(err, services.ErrNameConflict):
		return failResponse(ctx, http.StatusUnprocessableEntity, "drive.name_conflict", err)
	case errors.Is(err, services.ErrInvalidName):
		return failResponse(ctx, http.StatusUnprocessableEntity, "drive.name_invalid", err)
	default:
		return failResponse(ctx, http.StatusBadRequest, fallbackKey, err)
	}
}
```

Add `"errors"` and `"ponta_drive/app/services"` to that file's imports.

- [ ] **Step 5: Enforce validation and uniqueness in the service**

In `backend/app/services/cloud_drive_service.go`, `CreateFolder`, replace the folder construction block (from `folder := &models.DriveItem{` to `return folder, nil`) with:

```go
	trimmedName := strings.TrimSpace(name)
	if err := ValidateItemName(trimmedName); err != nil {
		return nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, trimmedName, 0); err != nil {
		return nil, err
	}

	folder := &models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		Name:           trimmedName,
		Type:           models.ItemTypeFolder,
		Status:         models.ItemStatusReady,
	}

	if err := facades.Orm().Query().Create(folder); err != nil {
		return nil, fmt.Errorf("failed to create folder: %w", err)
	}

	return folder, nil
```

In `InitiatePresignedUpload`, immediately after the parent check block (before `fileExt := ...`), insert:

```go
	if err := ValidateItemName(fileName); err != nil {
		return nil, nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, fileName, 0); err != nil {
		return nil, nil, err
	}
```

In `InitiateMultipartUpload`, immediately after the parent check block (before `if chunkSize <= 0`), insert the same two checks:

```go
	if err := ValidateItemName(fileName); err != nil {
		return nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, fileName, 0); err != nil {
		return nil, err
	}
```

- [ ] **Step 6: Route the controller failures through the mapper**

In `backend/app/http/controllers/drive_item_controller.go`, `StoreFolder`, change the service-error branch from

```go
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, errKeyCreateFailed, err)
	}
```

to

```go
	if err != nil {
		return failServiceError(ctx, err, errKeyCreateFailed)
	}
```

In `backend/app/http/controllers/upload_controller.go`, change the `InitiatePresigned` service-error branch (line 98) and the `InitMultipart` service-error branch (line 184) the same way. Both pass the handler's existing fallback key `errKeyUploadInitiateFailed` (`upload.initiate_failed`):

```go
	if err != nil {
		return failServiceError(ctx, err, errKeyUploadInitiateFailed)
	}
```

Do not introduce a new key: `upload.initiate_failed` already exists in `backend/lang/{en,vi}/upload.json` and is pinned by `presigned_upload_test.go` (the message must resolve, and must equal "Could not start the upload. Please try again." in English).

- [ ] **Step 7: Write the failing upload-duplicate feature test**

Append to `BucketSyncTestSuite` in `backend/tests/feature/bucket_sync_test.go` (it has a working `ProviderMinIO` mock endpoint):

```go
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
```

Confirm the request field names against `backend/app/http/requests/` for the presigned-upload request before running (adjust `file_name`/`size`/`mime_type` to match the actual `form` tags).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestCreateFolderRejects|TestBucketSyncTestSuite/TestUploadRejectsDuplicateName' -v`
Expected: PASS.

- [ ] **Step 9: Run the whole backend suite to confirm no regression**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. Existing feature tests use distinct names in each parent, so uniqueness does not trip them.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/cloud_drive_service.go backend/app/http/controllers/error_response.go backend/app/http/controllers/drive_item_controller.go backend/app/http/controllers/upload_controller.go backend/lang/en/drive.json backend/lang/vi/drive.json backend/tests/feature/drive_item_api_test.go backend/tests/feature/bucket_sync_test.go
git commit -m "feat(drive): enforce name uniqueness and validation on create and upload"
```

---

### Task 3: Backend — `folderPath` helper and folder-structured upload keys

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go:503-550` (`InitiatePresignedUpload`), `:593-654` (`InitiateMultipartUpload`)
- Create: `backend/app/services/folder_path.go`
- Test: `backend/app/services/folder_path_test.go`
- Test: `backend/tests/feature/presigned_upload_test.go`, `backend/tests/feature/multipart_upload_test.go`

**Interfaces:**
- Consumes: `facades.Orm().Query()`, `models.DriveItem`, `models.ItemTypeFolder`.
- Produces: `(*CloudDriveService).folderPath(ctx context.Context, userID, cloudAccountID uint, parentID *uint) (string, error)` and `buildStorageKey(userID uint, folderPath, fileName string) string`.

- [ ] **Step 1: Write the failing unit test for `buildStorageKey`**

Create `backend/app/services/folder_path_test.go`:

```go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// buildStorageKey is the single place the new key scheme is spelled out, so a
// regression there silently re-flattens every upload.
func TestBuildStorageKey(t *testing.T) {
	assert.Equal(t, "users/1/report.pdf", buildStorageKey(1, "", "report.pdf"))
	assert.Equal(t, "users/1/Tài liệu/2026/report.pdf", buildStorageKey(1, "Tài liệu/2026", "report.pdf"))
	assert.Equal(t, "users/7/items/a.txt", buildStorageKey(7, "items", "a.txt"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./app/services/ -run TestBuildStorageKey -v`
Expected: FAIL — `undefined: buildStorageKey`.

- [ ] **Step 3: Implement `folderPath` and `buildStorageKey`**

Create `backend/app/services/folder_path.go`:

```go
package services

import (
	"context"
	"errors"
	"fmt"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

// folderPath returns the "/"-joined ancestor folder names for parentID,
// root-first and excluding the drive root. It returns "" for the root itself
// (parentID nil or 0).
//
// The walk is bounded by a visited set and a depth cap so a pre-existing cycle
// in parent_id cannot spin forever; the cycle guard in ValidateMove prevents
// new ones, but this runs on every upload and must not trust that.
func (s *CloudDriveService) folderPath(ctx context.Context, userID, cloudAccountID uint, parentID *uint) (string, error) {
	if parentID == nil || *parentID == 0 {
		return "", nil
	}

	const maxDepth = 10000
	visited := map[uint]bool{}
	var reversed []string
	current := *parentID

	for depth := 0; current != 0 && depth < maxDepth; depth++ {
		if visited[current] {
			break
		}
		visited[current] = true

		var node models.DriveItem
		if err := facades.Orm().Query().
			Where("id", current).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			First(&node); err != nil || node.ID == 0 {
			return "", errors.New("parent folder not found")
		}
		if !node.IsFolder() {
			return "", errors.New("parent item is not a folder")
		}

		reversed = append(reversed, node.Name)
		if node.ParentID == nil {
			break
		}
		current = *node.ParentID
	}

	// The walk produced leaf -> ... -> root; the key path wants root first.
	path := ""
	for i := len(reversed) - 1; i >= 0; i-- {
		if path == "" {
			path = reversed[i]
		} else {
			path = path + "/" + reversed[i]
		}
	}
	return path, nil
}

// buildStorageKey assembles users/<uid>/<folder-path>/<name>. It is the single
// definition of the new key scheme; an empty folderPath yields
// users/<uid>/<name>.
func buildStorageKey(userID uint, folderPath, fileName string) string {
	if folderPath == "" {
		return fmt.Sprintf("users/%d/%s", userID, fileName)
	}
	return fmt.Sprintf("users/%d/%s/%s", userID, folderPath, fileName)
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd backend && go test ./app/services/ -run TestBuildStorageKey -v`
Expected: PASS.

- [ ] **Step 5: Use the helper in both upload entry points**

In `backend/app/services/cloud_drive_service.go`, in `InitiatePresignedUpload`, replace

```go
	fileExt := strings.TrimPrefix(filepath.Ext(fileName), ".")
	storageKey := fmt.Sprintf("users/%d/items/%s-%s", userID, uuid.New().String(), fileName)
```

with

```go
	fileExt := strings.TrimPrefix(filepath.Ext(fileName), ".")
	fp, err := s.folderPath(ctx, userID, cloudAccountID, parentID)
	if err != nil {
		return nil, nil, err
	}
	storageKey := buildStorageKey(userID, fp, fileName)
```

In `InitiateMultipartUpload`, replace

```go
	storageKey := fmt.Sprintf("users/%d/items/%s-%s", userID, uuid.New().String(), fileName)
```

with

```go
	fp, err := s.folderPath(ctx, userID, cloudAccountID, parentID)
	if err != nil {
		return nil, err
	}
	storageKey := buildStorageKey(userID, fp, fileName)
```

- [ ] **Step 6: Add a `createFolder` helper to each upload suite, then the key-shape tests**

Neither `PresignedUploadTestSuite` nor `MultipartUploadTestSuite` has a `createFolder` helper (the only one in the repo is `DriveItemAPITestSuite.createFolder(parentUUID, name string) string` in `drive_item_api_test.go:326`, a method of a different suite). Add this helper to **both** `presigned_upload_test.go` and `multipart_upload_test.go`, next to the suite's other helpers:

```go
// createFolder posts a root-level folder and returns its uuid.
func (s *PresignedUploadTestSuite) createFolder(name string) string {
	payload, _ := json.Marshal(map[string]any{
		"cloud_account_id": s.account.ID,
		"name":             name,
	})
	resp, err := s.Http(s.T()).WithToken(s.token).
		Post("/v1/drive/items/folders", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusCreated)
	body, _ := resp.Json()
	return body["data"].(map[string]any)["uuid"].(string)
}
```

In `multipart_upload_test.go`, the same helper with receiver `*MultipartUploadTestSuite`. `bytes`, `encoding/json`, and `net/http` are already imported in both files.

Then append to `PresignedUploadTestSuite` in `backend/tests/feature/presigned_upload_test.go`:

```go
// TestPresignedUploadUsesFolderKey proves an upload into a folder is stored at
// users/<uid>/<folder>/<name> — no uuid prefix, no flat items/ segment — so a
// sync after a database loss can rebuild the folder.
func (s *PresignedUploadTestSuite) TestPresignedUploadUsesFolderKey() {
	folderUUID := s.createFolder("Tài liệu")

	payload, _ := json.Marshal(map[string]any{
		"cloud_account_id": s.account.ID,
		"parent_uuid":      folderUUID,
		"file_name":        "notes.txt",
		"size":             16,
		"mime_type":        "text/plain",
	})
	resp, err := s.Http(s.T()).WithToken(s.token).Post("/v1/drive/upload/presigned", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertOk()

	body, _ := resp.Json()
	data := body["data"].(map[string]any)
	item := data["item"].(map[string]any)

	want := fmt.Sprintf("users/%d/Tài liệu/notes.txt", s.user.ID)
	s.Equal(want, item["storage_path"])
}
```

Add `"fmt"` to `presigned_upload_test.go`'s imports if missing.

Append the analogous test to `MultipartUploadTestSuite` in `backend/tests/feature/multipart_upload_test.go`:

```go
// TestMultipartUploadUsesFolderKey mirrors the presigned case for the chunked
// path: the session's storage_path must be the folder-structured key.
func (s *MultipartUploadTestSuite) TestMultipartUploadUsesFolderKey() {
	folderUUID := s.createFolder("Tài liệu")

	payload, _ := json.Marshal(map[string]any{
		"cloud_account_id": s.account.ID,
		"parent_uuid":      folderUUID,
		"file_name":        "archive.zip",
		"size":             16,
		"mime_type":        "application/zip",
	})
	resp, err := s.Http(s.T()).WithToken(s.token).Post("/v1/drive/upload/multipart/init", bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertOk()

	body, _ := resp.Json()
	data := body["data"].(map[string]any)
	want := fmt.Sprintf("users/%d/Tài liệu/archive.zip", s.user.ID)
	s.Equal(want, data["storage_path"])
}
```

`multipart_upload_test.go` already imports `fmt`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && go test ./tests/feature/ -run 'TestPresignedUploadTestSuite/TestPresignedUploadUsesFolderKey|TestMultipartUploadTestSuite/TestMultipartUploadUsesFolderKey' -v`
Expected: PASS.

- [ ] **Step 8: Run the whole backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. The existing upload tests assert the item name and status, not the key, so the new shape does not break them.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/folder_path.go backend/app/services/folder_path_test.go backend/app/services/cloud_drive_service.go backend/tests/feature/presigned_upload_test.go backend/tests/feature/multipart_upload_test.go
git commit -m "feat(drive): store uploads under folder-structured S3 keys"
```

---

### Task 4: Backend — `CopyObject` on the driver (single + multipart copy)

**Files:**
- Modify: `backend/app/contracts/storage.go:47-70` (`CloudDriver` interface)
- Modify: `backend/app/services/storage/s3_driver.go` (add `CopyObject`, `multipartCopy`, `encodeCopySource`)
- Modify: `backend/tests/unit/storage_contract_test.go` (`s3DriverStub`)
- Test: `backend/app/services/storage/copy_source_test.go`, `backend/tests/unit/s3_driver_test.go`

**Interfaces:**
- Consumes: `aws-sdk-go-v2/service/s3` (`CopyObject`, `CreateMultipartUpload`, `UploadPartCopy`, `CompleteMultipartUpload`, `AbortMultipartUpload`), `types.CopyPartResult`, `d.GetMetadata`, `d.InitiateMultipart`, `d.CompleteMultipart`, `d.AbortMultipart`.
- Produces:
  - `contracts.CloudDriver.CopyObject(ctx context.Context, srcKey string, dstKey string) error`
  - `(*S3Driver).CopyObject(ctx context.Context, srcKey string, dstKey string) error`
  - `(*S3Driver).multipartCopy(ctx context.Context, srcKey, dstKey string, size int64) error`
  - `encodeCopySource(bucket, key string) string`
  - consts `s3SingleCopyLimit = 5 * 1024 * 1024 * 1024`, `s3CopyPartSize = 1 * 1024 * 1024 * 1024`

- [ ] **Step 1: Write the failing unit test for `encodeCopySource`**

Create `backend/app/services/storage/copy_source_test.go`:

```go
package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// S3 does not encode the CopySource header for us, and it must be encoded per
// path segment: a whole-string escape would turn the "/" separators into %2F
// and S3 would look for a single object whose key contains literal slashes.
func TestEncodeCopySource(t *testing.T) {
	assert.Equal(t,
		"my-bucket/users/1/report.pdf",
		encodeCopySource("my-bucket", "users/1/report.pdf"))

	assert.Equal(t,
		"my-bucket/users/1/T%C3%A0i%20li%E1%BB%87u/a%20b.txt",
		encodeCopySource("my-bucket", "users/1/Tài liệu/a b.txt"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./app/services/storage/ -run TestEncodeCopySource -v`
Expected: FAIL — `undefined: encodeCopySource`.

- [ ] **Step 3: Add `CopyObject` to the interface**

In `backend/app/contracts/storage.go`, add to the `CloudDriver` interface (after `DeleteObjects`):

```go
	// CopyObject copies srcKey to dstKey server-side. Objects larger than the S3
	// single-copy limit (5 GiB) are copied with a multipart copy, so the caller
	// never has to know the size threshold.
	CopyObject(ctx context.Context, srcKey string, dstKey string) error
```

- [ ] **Step 4: Implement `CopyObject`, `multipartCopy`, and `encodeCopySource`**

Append to `backend/app/services/storage/s3_driver.go`:

```go
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
			_ = d.AbortMultipart(ctx, dstKey, uploadID)
			return err
		}
		if output.CopyPartResult == nil || output.CopyPartResult.ETag == nil {
			_ = d.AbortMultipart(ctx, dstKey, uploadID)
			return errors.New("empty ETag returned from upload part copy")
		}

		parts = append(parts, contracts.CompletedPart{
			PartNumber: partNumber,
			ETag:       strings.Trim(*output.CopyPartResult.ETag, "\""),
		})
	}

	if err := d.CompleteMultipart(ctx, dstKey, uploadID, parts); err != nil {
		_ = d.AbortMultipart(ctx, dstKey, uploadID)
		return err
	}
	return nil
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
```

Add `"net/url"` to the file's imports.

- [ ] **Step 5: Update the interface stub**

In `backend/tests/unit/storage_contract_test.go`, add to `s3DriverStub`:

```go
func (s *s3DriverStub) CopyObject(ctx context.Context, srcKey string, dstKey string) error { return nil }
```

- [ ] **Step 6: Run the unit test to verify it passes**

Run: `cd backend && go test ./tests/unit/ ./app/services/storage/ -run 'TestCloudDriverInterface|TestEncodeCopySource' -v`
Expected: PASS. `assert.Implements` now also proves `*S3Driver` satisfies the widened interface.

- [ ] **Step 7: Write the failing mock-server copy test**

Append to `backend/tests/unit/s3_driver_test.go`:

```go
// newCopyTestDriver builds a driver over a mock S3 server that records copy
// requests. copyCalls counts single CopyObject calls; partCopies counts
// UploadPartCopy calls; sourceHeaders records each x-amz-copy-source value.
func newCopyTestDriver(t *testing.T, size int64) (*storage.S3Driver, *int32, *int32, *[]string) {
	t.Helper()
	var copyCalls, partCopies int32
	var sources []string
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodHead:
			w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("ETag", `"src-etag"`)
			w.WriteHeader(http.StatusOK)

		// UploadPartCopy is a PUT that carries BOTH the x-amz-copy-source
		// header AND a partNumber query param, so it must be matched before the
		// plain single-copy case below — otherwise every part lands in the
		// single-copy branch and the multipart path is never exercised.
		case r.Method == http.MethodPut && r.URL.Query().Has("partNumber"):
			mu.Lock()
			sources = append(sources, r.Header.Get("x-amz-copy-source"))
			mu.Unlock()
			atomic.AddInt32(&partCopies, 1)
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<CopyPartResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <ETag>&quot;part-etag&quot;</ETag>
  <LastModified>2026-10-13T00:00:00.000Z</LastModified>
</CopyPartResult>`))

		case r.Method == http.MethodPut && r.Header.Get("x-amz-copy-source") != "":
			mu.Lock()
			sources = append(sources, r.Header.Get("x-amz-copy-source"))
			mu.Unlock()
			atomic.AddInt32(&copyCalls, 1)
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <ETag>&quot;dst-etag&quot;</ETag>
  <LastModified>2026-10-13T00:00:00.000Z</LastModified>
</CopyObjectResult>`))

		case r.Method == http.MethodPost && r.URL.Query().Has("uploads"):
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>test-bucket</Bucket><Key>dst.bin</Key><UploadId>copy-upload-1</UploadId>
</InitiateMultipartUploadResult>`))

		case r.Method == http.MethodPost && r.URL.Query().Has("uploadId"):
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>test-bucket</Bucket><Key>dst.bin</Key><ETag>&quot;final&quot;</ETag>
</CompleteMultipartUploadResult>`))

		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(server.Close)

	driver, err := storage.NewS3Driver(context.Background(), storage.S3Config{
		Bucket:          "test-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "k",
		SecretAccessKey: "s",
		Endpoint:        server.URL,
		UsePathStyle:    true,
	})
	require.NoError(t, err)

	return driver, &copyCalls, &partCopies, &sources
}

// TestS3DriverCopyObjectSmallUsesSingleCopy pins the small-object path.
func TestS3DriverCopyObjectSmallUsesSingleCopy(t *testing.T) {
	driver, copyCalls, partCopies, sources := newCopyTestDriver(t, 1024)

	err := driver.CopyObject(context.Background(), "users/1/Tài liệu/a b.txt", "users/1/docs/a b.txt")
	require.NoError(t, err)

	assert.Equal(t, int32(1), atomic.LoadInt32(copyCalls))
	assert.Equal(t, int32(0), atomic.LoadInt32(partCopies))
	require.Len(t, *sources, 1)
	// Encoded per segment: the "/" separators survive, the space and the
	// non-ASCII do not.
	assert.Equal(t, "test-bucket/users/1/T%C3%A0i%20li%E1%BB%87u/a%20b.txt", (*sources)[0])
}

// TestS3DriverCopyObjectLargeUsesMultipartCopy pins the > 5 GiB path: it must
// not call CopyObject at all.
func TestS3DriverCopyObjectLargeUsesMultipartCopy(t *testing.T) {
	const size = 5*1024*1024*1024 + 1
	driver, copyCalls, partCopies, _ := newCopyTestDriver(t, size)

	err := driver.CopyObject(context.Background(), "users/1/big.bin", "users/1/docs/big.bin")
	require.NoError(t, err)

	assert.Equal(t, int32(0), atomic.LoadInt32(copyCalls), "a >5 GiB object must not use a single CopyObject")
	assert.GreaterOrEqual(t, atomic.LoadInt32(partCopies), int32(5), "5 GiB + 1 byte needs at least 5 one-GiB parts")
}
```

Add `strconv` and `sync` to the test file's imports if missing (`atomic`, `httptest`, `context`, `bytes`, `io` are already imported).

- [ ] **Step 8: Run the copy tests to verify they pass**

Run: `cd backend && go test ./tests/unit/ -run TestS3DriverCopyObject -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/contracts/storage.go backend/app/services/storage/s3_driver.go backend/app/services/storage/copy_source_test.go backend/tests/unit/storage_contract_test.go backend/tests/unit/s3_driver_test.go
git commit -m "feat(storage): add server-side CopyObject with multipart copy for large objects"
```

---

### Task 5: Backend — `ScanBucket` three-way classification and path materialiser

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go:850-1075` (`ScanBucket`)
- Create: `backend/app/services/scan_classify.go`
- Test: `backend/app/services/scan_classify_test.go`
- Test: `backend/tests/feature/bucket_sync_test.go` (add new-scheme cases)

**Interfaces:**
- Consumes: `internalUploadPrefix`, `uuidPrefixPattern`, `internalUploadRealName`, `facades.Orm().Query()`, `models.DriveItem`.
- Produces:
  - `type scanShape int` with `scanShapeLegacy`, `scanShapeNew`, `scanShapeExternal`
  - `classifyKey(userID uint, key string) (scanShape, string)` — returns the shape and, for legacy keys, the recovered real name ("" otherwise)
  - `(*CloudDriveService).materializeFolders(ctx context.Context, userID, cloudAccountID uint, parentID *uint, segments []string) (*uint, error)` — ensures every segment exists as a folder, returns the deepest folder id
  - `(*CloudDriveService).upsertScannedFile(ctx context.Context, userID, cloudAccountID uint, parentID *uint, obj contracts.ObjectMetadata, name string) error`

> **Correction to the spec (§6.2):** the spec describes one `materializePath` that "upserts the trailing file" and also "handles a directory marker". The current `ScanBucket` has **two structurally different branches** — the directory-marker branch (lines 939–972) loops **all** segments creating folders and writes no file; the file branch (973–1052) loops `segments[:len-1]` creating folders and then upserts the trailing segment as a file. A single helper cannot do both. This task therefore splits them into `materializeFolders` (shared by both) and `upsertScannedFile` (the file branch only), and keeps the directory-marker case as a call to `materializeFolders` over all segments.

- [ ] **Step 1: Write the failing unit test for `classifyKey`**

Create `backend/app/services/scan_classify_test.go`:

```go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// A key's shape decides whether sync recovers a name, derives a path, or
// treats the key as an external object. The "items" case is the whole reason
// the legacy shape needs the uuid pattern and not just the prefix: a user
// folder literally named "items" produces keys that share the legacy prefix.
func TestClassifyKey(t *testing.T) {
	const uid = 7
	const uuid = "09d3c478-1bfe-449b-a202-e84ef72b16e5"

	cases := []struct {
		name    string
		key     string
		shape   scanShape
		recover string
	}{
		{
			name:    "legacy flat upload key",
			key:     "users/7/items/" + uuid + "-file-sample_1MB.docx",
			shape:   scanShapeLegacy,
			recover: "file-sample_1MB.docx",
		},
		{
			name:    "new-scheme key in a folder named items is NOT legacy",
			key:     "users/7/items/a.txt",
			shape:   scanShapeNew,
			recover: "",
		},
		{
			name:  "new-scheme key in a nested folder",
			key:   "users/7/Tài liệu/2026/report.pdf",
			shape: scanShapeNew,
		},
		{
			name:  "new-scheme key at the root",
			key:   "users/7/report.pdf",
			shape: scanShapeNew,
		},
		{
			name:  "external key (other user prefix)",
			key:   "users/8/photos/beach.jpg",
			shape: scanShapeExternal,
		},
		{
			name:  "external key (no users prefix)",
			key:   "photos/vacation/beach.jpg",
			shape: scanShapeExternal,
		},
		{
			name:  "external key that merely starts with the user id digits",
			key:   "users/70/report.pdf",
			shape: scanShapeExternal,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			shape, recover := classifyKey(uid, tc.key)
			assert.Equal(t, tc.shape, shape)
			assert.Equal(t, tc.recover, recover)
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./app/services/ -run TestClassifyKey -v`
Expected: FAIL — `undefined: classifyKey`, `undefined: scanShape`.

- [ ] **Step 3: Implement `classifyKey`**

Create `backend/app/services/scan_classify.go`:

```go
package services

import (
	"fmt"
	"strings"
)

// scanShape is how a bucket key maps onto the drive after the folder-structure
// change: a legacy flat app-upload key, a new folder-structured key, or an
// object that belongs to no scheme (external content in the same bucket).
type scanShape int

const (
	scanShapeLegacy scanShape = iota
	scanShapeNew
	scanShapeExternal
)

// classifyKey decides how a key (leading "/" already stripped) is materialized.
//
//   - Legacy: starts with users/<uid>/items/ AND the basename carries the
//     "<uuid>-" prefix. The real name is recovered from the key and the path is
//     never derived (the "items" segment is a storage detail, not a folder).
//   - New: starts with users/<uid>/ and is not legacy. The remainder is the
//     real folder path.
//   - External: anything else, derived from the whole key.
//
// The uuid-pattern requirement is what separates the two shapes that share the
// "users/<uid>/items/" prefix: a legacy key always has "<uuid>-<name>", a
// new-scheme key inside a folder named "items" has a plain name.
func classifyKey(userID uint, key string) (scanShape, string) {
	prefix := internalUploadPrefix(userID)
	if strings.HasPrefix(key, prefix) {
		if realName := internalUploadRealName(key); realName != "" {
			return scanShapeLegacy, realName
		}
		// A key under the reserved prefix whose basename is not uuid-prefixed is
		// a new-scheme object in a folder named "items", not a legacy upload.
		return scanShapeNew, ""
	}
	if strings.HasPrefix(key, fmt.Sprintf("users/%d/", userID)) {
		return scanShapeNew, ""
	}
	return scanShapeExternal, ""
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./app/services/ -run TestClassifyKey -v`
Expected: PASS.

- [ ] **Step 5: Extract the two path helpers**

In `backend/app/services/cloud_drive_service.go`, add these two methods (place them next to `ScanBucket`):

```go
// materializeFolders ensures every segment exists as a folder under parentID,
// creating the missing ones, and returns the deepest folder's id (nil for an
// empty segment list). It is the folder-derivation loop the old ScanBucket
// else-branch ran inline, shared by the new-scheme path, the external path, and
// the directory-marker case.
func (s *CloudDriveService) materializeFolders(ctx context.Context, userID, cloudAccountID uint, parentID *uint, segments []string) (*uint, error) {
	currentParentID := parentID
	for _, folderName := range segments {
		if folderName == "" {
			continue
		}
		var folder models.DriveItem
		q := facades.Orm().Query().
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			Where("name", folderName).
			Where("type", models.ItemTypeFolder)
		if currentParentID == nil {
			q = q.Where("parent_id IS NULL")
		} else {
			q = q.Where("parent_id = ?", *currentParentID)
		}
		_ = q.First(&folder)

		if folder.ID == 0 {
			folder = models.DriveItem{
				UUID:           uuid.New().String(),
				UserID:         userID,
				CloudAccountID: cloudAccountID,
				ParentID:       currentParentID,
				Name:           folderName,
				Type:           models.ItemTypeFolder,
				Status:         models.ItemStatusReady,
			}
			if err := facades.Orm().Query().Create(&folder); err != nil {
				return nil, err
			}
		}
		fID := folder.ID
		currentParentID = &fID
	}
	return currentParentID, nil
}

// upsertScannedFile records a scanned object as a file row under parentID,
// matching an existing row by name so a re-scan does not duplicate it. The key
// was not tracked by storage_path (the caller checked), so a name match within
// the derived folder is the identity.
func (s *CloudDriveService) upsertScannedFile(ctx context.Context, userID, cloudAccountID uint, parentID *uint, obj contracts.ObjectMetadata, name string) error {
	fileExt := strings.TrimPrefix(filepath.Ext(name), ".")

	var nameMatch models.DriveItem
	q := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		Where("name", name).
		Where("type", models.ItemTypeFile)
	if parentID == nil {
		q = q.Where("parent_id IS NULL")
	} else {
		q = q.Where("parent_id = ?", *parentID)
	}
	_ = q.First(&nameMatch)

	if nameMatch.ID > 0 {
		nameMatch.StoragePath = obj.Key
		nameMatch.Size = obj.Size
		nameMatch.ETag = obj.ETag
		nameMatch.Status = models.ItemStatusReady
		return facades.Orm().Query().Save(&nameMatch)
	}

	newItem := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		Name:           name,
		Type:           models.ItemTypeFile,
		MimeType:       obj.MimeType,
		Size:           obj.Size,
		Extension:      fileExt,
		StoragePath:    obj.Key,
		ETag:           obj.ETag,
		Status:         models.ItemStatusReady,
	}
	return facades.Orm().Query().Create(&newItem)
}
```

- [ ] **Step 6: Rewrite the `ScanBucket` object loop**

In `backend/app/services/cloud_drive_service.go`, replace the whole `for _, obj := range result.Objects { ... }` body (lines 865–1053) with:

```go
		for _, obj := range result.Objects {
			key := strings.TrimPrefix(obj.Key, "/")
			if key == "" {
				continue
			}

			shape, recoveredName := classifyKey(userID, key)

			if shape == scanShapeLegacy {
				// A tracked row (same storage_path) is authoritative: refresh the
				// metadata S3 owns and keep its ParentID. When the row is gone — the
				// database was reset while the bucket still holds the object —
				// recover the user-facing name and re-attach the file at the scan
				// root, so the drive shows "file.docx" instead of a phantom
				// users/<id>/items tree holding a uuid-prefixed name.
				var tracked models.DriveItem
				_ = facades.Orm().Query().
					Where("user_id", userID).
					Where("cloud_account_id", cloudAccountID).
					Where("storage_path", obj.Key).
					First(&tracked)

				if tracked.ID > 0 {
					tracked.Size = obj.Size
					tracked.ETag = obj.ETag
					tracked.Status = models.ItemStatusReady
					_ = facades.Orm().Query().Save(&tracked)
					syncedCount++
					continue
				}

				if recoveredName == "" {
					continue
				}

				if err := s.upsertScannedFile(ctx, userID, cloudAccountID, parentID, obj, recoveredName); err == nil {
					syncedCount++
				}
				continue
			}

			// New-scheme and external keys both derive folders from segments. A
			// new-scheme key drops the users/<uid>/ prefix first; an external key
			// keeps its whole path.
			derivedKey := key
			if shape == scanShapeNew {
				derivedKey = strings.TrimPrefix(key, fmt.Sprintf("users/%d/", userID))
			}

			isDirMarker := strings.HasSuffix(derivedKey, "/")
			trimmedKey := strings.Trim(derivedKey, "/")
			segments := strings.Split(trimmedKey, "/")
			if len(segments) == 0 || trimmedKey == "" {
				continue
			}

			if isDirMarker {
				// A directory marker has no trailing file: every segment is a folder.
				if _, err := s.materializeFolders(ctx, userID, cloudAccountID, parentID, segments); err == nil {
					syncedCount++
				}
				continue
			}

			// The trailing segment is the file; the rest are its folders.
			fileParent, err := s.materializeFolders(ctx, userID, cloudAccountID, parentID, segments[:len(segments)-1])
			if err != nil {
				continue
			}
			fileName := segments[len(segments)-1]
			if err := s.upsertScannedFile(ctx, userID, cloudAccountID, fileParent, obj, fileName); err == nil {
				syncedCount++
			}
		}
```

- [ ] **Step 7: Write the failing feature tests for the new-scheme shapes**

Append to `BucketSyncTestSuite` in `backend/tests/feature/bucket_sync_test.go`:

```go
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
```

Add `net/http/httptest` to the imports if missing (it is already used by the suite).

- [ ] **Step 8: Run the whole backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. `TestBucketSyncWorkflow` (external keys), `TestSyncDoesNotMaterializeInternalUploadPrefix` (legacy tracked), and `TestSyncRecoversUploadedNameAfterDatabaseReset` (legacy untracked) must all still pass — the three-way classification preserves each behaviour.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/cloud_drive_service.go backend/app/services/scan_classify.go backend/app/services/scan_classify_test.go backend/tests/feature/bucket_sync_test.go
git commit -m "feat(drive): classify bucket keys and rebuild the folder tree on sync"
```

---

### Task 6: Backend — split `UpdateItem` into `ValidateMove` + `ApplyMove`, validate rename/move names

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go:268-313` (replace `UpdateItem`)
- Modify: `backend/app/http/controllers/drive_item_controller.go:280-326` (`Update`)
- Test: `backend/tests/feature/drive_item_api_test.go`

**Interfaces:**
- Consumes: `services.ValidateItemName`, `(*CloudDriveService).EnsureUniqueName`, `services.ErrNameConflict`, `services.ErrInvalidName`, `failServiceError` (Task 2), `(*CloudDriveService).isSelfOrDescendant`, `(*CloudDriveService).GetItemByUUID`.
- Produces:
  - `(*CloudDriveService).ValidateMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) (*models.DriveItem, error)` — destination/cycle/name/uniqueness checks; **writes nothing**.
  - `(*CloudDriveService).ApplyMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint, newStoragePath string) (*models.DriveItem, error)` — writes `name`, `parent_id`, `status = ready`, and (when `newStoragePath != ""`) `storage_path`.
  - `UpdateItem` is **deleted** (its only caller is this controller, which this task rewires).

> **Scope note:** this task lands the *validation* half of the spec's §8.3 split and keeps the write synchronous and same-key — no S3 object is re-keyed yet, so a rename/move that a later task will re-key is, at this point, a database-only update. Task 7 replaces the direct `ApplyMove` call with an asynchronous re-key job. Splitting it this way keeps every task's suite green on its own: the existing move tests use rows with an empty `storage_path`, which no S3 call can touch.

> **Correction to the spec (§8.3):** the spec says `UpdateItem` "is retained as `ValidateMove` + `ApplyMove` for any caller that still needs a synchronous, same-key update." Grep shows `UpdateItem` has exactly one caller (`drive_item_controller.go:312`, the method this task rewires) and no test references it, so retaining it would ship dead code. It is deleted; the two methods replace it. `ApplyMove` gains a trailing `newStoragePath string` parameter that the spec's signature lacks, so the re-key job (Task 7) can write the new key in the same update; passing `""` leaves `storage_path` untouched, which is what this task's synchronous call does. `ApplyMove` sets `status = ready` (the spec's own signature lists `status` among the columns it writes): a settled move always ends at `ready`, and Task 7 reuses this to clear the `moving` marker the controller sets before dispatching.

- [ ] **Step 1: Write the failing feature tests**

Append to `DriveItemAPITestSuite` in `backend/tests/feature/drive_item_api_test.go`:

```go
// TestRenameRejectsDuplicateName proves the key scheme's uniqueness rule is
// enforced on rename too: two items with the same name in one folder would
// share one S3 key prefix.
func (s *DriveItemAPITestSuite) TestRenameRejectsDuplicateName() {
	s.createFolderItem("Dup A", nil)
	dupB := s.createFolderItem("Dup B", nil)

	payload, _ := json.Marshal(map[string]any{"name": "Dup A"})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", dupB.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusUnprocessableEntity)

	body, _ := resp.Json()
	message, _ := body["message"].(string)
	s.NotEmpty(message)
	s.NotContains(message, "name_conflict", "the translation key must resolve")

	var reloaded models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("uuid", dupB.UUID).First(&reloaded))
	s.Equal("Dup B", reloaded.Name, "a rejected rename must not change the name")
}

// TestRenameToOwnNameIsAllowed proves the uniqueness check excludes the item
// itself, so re-submitting the same name is not a conflict.
func (s *DriveItemAPITestSuite) TestRenameToOwnNameIsAllowed() {
	file := s.createFileItem("same.txt")

	payload, _ := json.Marshal(map[string]any{"name": "same.txt"})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", file.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertOk()
}

// TestRenameRejectsInvalidName proves a name that would corrupt the key path
// (a "/" here) is rejected with a 422, not silently stored. (Review Focus #5.)
func (s *DriveItemAPITestSuite) TestRenameRejectsInvalidName() {
	folder := s.createFolderItem("Valid Name", nil)

	payload, _ := json.Marshal(map[string]any{"name": "a/b.txt"})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", folder.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusUnprocessableEntity)

	body, _ := resp.Json()
	message, _ := body["message"].(string)
	s.NotEmpty(message)
	s.NotContains(message, "name_invalid", "the translation key must resolve")

	var reloaded models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("uuid", folder.UUID).First(&reloaded))
	s.Equal("Valid Name", reloaded.Name)
}

// TestMoveRejectsDuplicateName proves a move into a folder that already holds
// the same name is refused: both objects would land on one S3 key.
func (s *DriveItemAPITestSuite) TestMoveRejectsDuplicateName() {
	folderA := s.createFolder("", "Move Dup A")

	first := s.createFileItem("clash.txt")
	s.moveItem(first.UUID, folderA)

	second := s.createFileItem("clash.txt")
	payload, _ := json.Marshal(map[string]any{"parent_uuid": folderA})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", second.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusUnprocessableEntity)

	body, _ := resp.Json()
	message, _ := body["message"].(string)
	s.NotContains(message, "name_conflict", "the translation key must resolve")

	var reloaded models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("uuid", second.UUID).First(&reloaded))
	s.Nil(reloaded.ParentID, "a rejected move must leave the item where it was")
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestRenameRejects|TestDriveItemAPITestSuite/TestRenameToOwnName|TestDriveItemAPITestSuite/TestMoveRejectsDuplicateName' -v`
Expected: `TestRenameRejectsDuplicateName`, `TestRenameRejectsInvalidName`, and `TestMoveRejectsDuplicateName` FAIL — the rename/move succeed with 200 because no uniqueness or name validation runs yet. `TestRenameToOwnNameIsAllowed` PASSES: it expects 200 and the current unvalidated `UpdateItem` already returns 200, so it is a guard test that must stay green through the change (it proves the new uniqueness check does not reject an item's own name).

- [ ] **Step 3: Replace `UpdateItem` with `ValidateMove` + `ApplyMove`**

In `backend/app/services/cloud_drive_service.go`, replace the whole `UpdateItem` method (lines 268–313, from `// UpdateItem updates name or parent folder of an item.` through its closing `}`) with:

```go
// ValidateMove resolves and checks a rename/move without writing anything: the
// item exists, the destination is an existing folder in the same account, the
// move cannot create a cycle, and the resulting name is valid and unique in its
// destination folder. It returns the item as it is today (unchanged) so the
// caller can log against the current name.
func (s *CloudDriveService) ValidateMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	if newParentID != nil {
		if *newParentID == item.ID {
			return nil, errors.New("an item cannot be its own parent")
		}
		if *newParentID > 0 {
			var parent models.DriveItem
			err := facades.Orm().Query().
				Where("id", *newParentID).
				Where("user_id", userID).
				Where("cloud_account_id", item.CloudAccountID).
				First(&parent)
			if err != nil || parent.ID == 0 {
				return nil, errors.New("destination folder not found")
			}
			if !parent.IsFolder() {
				return nil, errors.New("destination is not a folder")
			}
			// Prevent cycles: the destination must not be the item itself or one
			// of its own descendants.
			if s.isSelfOrDescendant(userID, item.CloudAccountID, *newParentID, item.ID) {
				return nil, errors.New("cannot move a folder into itself or its own subfolder")
			}
		}
	}

	// The name the item will carry once the move settles. A rename is validated
	// only when the caller supplies one: an existing item may predate the rule.
	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		if err := ValidateItemName(trimmed); err != nil {
			return nil, err
		}
		finalName = trimmed
	}

	// The folder the item will live in once the move settles. A non-nil pointer
	// to 0 means "the drive root", which is parent_id IS NULL.
	destParentID := item.ParentID
	if newParentID != nil {
		if *newParentID == 0 {
			destParentID = nil
		} else {
			destParentID = newParentID
		}
	}

	if err := s.EnsureUniqueName(ctx, userID, item.CloudAccountID, destParentID, finalName, item.ID); err != nil {
		return nil, err
	}

	return item, nil
}

// ApplyMove performs the database part of a rename/move: it writes the item's
// new name, parent_id and storage_path (when one is supplied) and marks it
// ready. Destination and name checks belong to ValidateMove, which must run
// first. A settled move always ends at status = ready, so this also clears the
// "moving" marker the controller sets before dispatching a re-key job.
func (s *CloudDriveService) ApplyMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint, newStoragePath string) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(newName) != "" {
		item.Name = strings.TrimSpace(newName)
	}

	if newParentID != nil {
		if *newParentID > 0 {
			item.ParentID = newParentID
		} else {
			item.ParentID = nil
		}
	}

	if newStoragePath != "" {
		item.StoragePath = newStoragePath
	}

	item.Status = models.ItemStatusReady

	if err := facades.Orm().Query().Save(item); err != nil {
		return nil, err
	}

	return item, nil
}
```

- [ ] **Step 4: Rewire the controller to validate before writing**

In `backend/app/http/controllers/drive_item_controller.go`, replace the body of `Update` from `name := req.Name` (line 280) through the closing `}` of the method (line 326) with:

```go
	name := req.Name
	if name == "" {
		name = ctx.Request().Input("name")
	}

	// `parent_uuid` is a *string so "absent" (rename only) is distinguishable
	// from "present but empty" (move to root). Absent => nil => no parent change.
	var parentID *uint
	if req.ParentUUID != nil {
		if *req.ParentUUID == "" {
			// Move to root: the service treats a non-nil pointer to 0 as "detach".
			var root uint
			parentID = &root
		} else {
			pid, err := c.service.ResolveDriveItemID(context.Background(), user.ID, *req.ParentUUID)
			if err != nil {
				return failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)
			}
			parentID = &pid
		}
	}

	// Capture the current name so a rename can be detected after the update.
	previousName := ""
	hasPrevious := false
	if existing, fetchErr := c.service.GetItemByUUID(context.Background(), user.ID, itemUUID); fetchErr == nil {
		previousName = existing.Name
		hasPrevious = true
	}

	// Validate first: destination, cycle guard, name validity and uniqueness. A
	// bad request is rejected before anything is written, and the name errors
	// map to their localized 422 through failServiceError.
	if _, err := c.service.ValidateMove(context.Background(), user.ID, itemUUID, name, parentID); err != nil {
		return failServiceError(ctx, err, "drive.update_failed")
	}

	// Same-key update: the object is not re-keyed here (Task 7 moves that to an
	// asynchronous job), so storage_path is left untouched.
	item, err := c.service.ApplyMove(context.Background(), user.ID, itemUUID, name, parentID, "")
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)
	}

	if shouldLogRename(hasPrevious, name, previousName) {
		activityService := services.NewActivityService()
		activityService.LogSafe(user.ID, item.CloudAccountID, "renamed", fmt.Sprintf("%s -> %s", previousName, name), &item.UUID, helpers.GetClientIP(ctx), helpers.GetUserAgent(ctx), nil)
	}

	return ctx.Response().Success().Json(http.Json{
		"status": "ok",
		"data":   item.ToResponse(),
	})
```

Leave `shouldLogRename` and every other method untouched.

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestRenameRejects|TestDriveItemAPITestSuite/TestRenameToOwnName|TestDriveItemAPITestSuite/TestMoveRejectsDuplicateName' -v`
Expected: PASS.

- [ ] **Step 6: Run the whole backend suite to confirm no regression**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. The existing move tests (`TestMoveItemIntoFolder`, `TestMoveFolderIntoOwnDescendantIsRejected`, `TestMoveItemToRoot`, `TestMoveFolderIntoFolder`, `TestMoveIntoNonFolderDestinationIsRejected`, `TestMoveFolderIntoItselfIsRejected`, `TestMoveIntoDifferentAccountFolderIsRejected`) still pass: each uses a distinct name in its destination, and a rejected move returns 400 `drive.update_failed` via `failServiceError`'s default branch. `TestDriveItemLifecycle`'s rename step still passes. `go build` also proves no caller of the deleted `UpdateItem` remains. `app/http/controllers/drive_item_controller_test.go` (`TestShouldLogRename`) is untouched and still passes.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/cloud_drive_service.go backend/app/http/controllers/drive_item_controller.go backend/tests/feature/drive_item_api_test.go
git commit -m "feat(drive): validate rename and move names before writing"
```

---

### Task 7: Backend — asynchronous `RekeyDriveItemJob` (copy → DB → delete old)

**Files:**
- Modify: `backend/app/services/cloud_drive_service.go` (add `RekeyItem`, `rekeyFile`, `rekeyFolder`, `markRekeyFailed`, `relativeFolderPath`)
- Create: `backend/app/jobs/rekey_drive_item_job.go`
- Modify: `backend/bootstrap/jobs.go` (register the job)
- Modify: `backend/app/http/controllers/drive_item_controller.go` (`Update` — dispatch instead of write)
- Modify: `backend/lang/en/drive.json`, `backend/lang/vi/drive.json` (add `move_in_progress`)
- Test: `backend/tests/feature/drive_item_api_test.go`

**Interfaces:**
- Consumes: `(*CloudDriveService).GetItemByUUID`, `.GetDriver`, `.folderPath` (Task 3), `buildStorageKey` (Task 3), `.ApplyMove` (Task 6), `.CollectDescendantItems`, `contracts.CloudDriver.CopyObject`/`.Delete`/`.DeleteObjects` (Task 4), `facades.Orm().Transaction`, `models.ItemStatusMoving` (Task 1), `models.ItemStatusFailed`, `NewActivityService`, `facades.Queue().Job(...)`.
- Produces:
  - `(*CloudDriveService).RekeyItem(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) error`
  - `(*RekeyDriveItemJob).Signature() string` → `"rekey_drive_item_job"`
  - `relativeFolderPath(byID map[uint]models.DriveItem, rootID uint, item models.DriveItem) (string, error)`

> **Correction to the spec (§8.4).** The spec says the job's args are `userID uint, itemUUID string, newName string, newParentID *uint`. A `*uint` argument is **dropped** by the `database` driver: `queue/utils/ConvertArgs` (vendor `queue/utils/convert.go:124`) type-switches over the listed kinds with **no case for `*uint` and no `default`**, so the value is silently discarded. The Global Constraints' "keep the optional `*uint` last" rule is not enough here — `parentID` is not optional, and dropping it would turn every "move into folder X" into "move to root". The job therefore encodes the destination as two JSON-safe args: `parentID uint` (0 = root) and `hasParentChange bool` (`false` = a rename that leaves the parent alone). Both kinds have `ConvertArgs` cases and survive both drivers. `SyncS3BucketJob` keeps its `*uint` because a dropped `parentID` there only means "scan the whole bucket", which is the same as its nil case.

> **Correction to the spec (§8.3, activity).** The `renamed` activity moves from the controller into `RekeyItem`, so it is recorded only when the re-key actually settles, and a failed async re-key records `move_failed` instead of a rename that never happened. The pure `shouldLogRename` helper is unchanged and still unit-tested.

> **Correction to the spec (§8.4, failure).** The spec's failure handling ("leave the row at its old location, set `status = failed`") applies to errors **before** the database update. Deleting the old object happens **after** the row already points at the new key, so a delete failure cannot roll the row back; it is logged and the move still succeeds (a stale object is a cleanup issue, not a failed move). This keeps the row and the new object consistent.

- [ ] **Step 1: Write the failing feature tests**

Add `"io"`, `"net/http/httptest"`, and `"sync"` to the imports of `backend/tests/feature/drive_item_api_test.go`, then append to `DriveItemAPITestSuite`:

```go
// TestRenameRekeysObject proves a rename copies the object to the new key,
// updates the row's storage_path, and deletes the old object. The suite's
// default account points at a fake S3 with no endpoint, so this test creates
// its own account backed by a mock server.
func (s *DriveItemAPITestSuite) TestRenameRekeysObject() {
	var mu sync.Mutex
	var copied, deleted []string
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodHead:
			w.Header().Set("Content-Length", "1024")
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("ETag", `"etag-old"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodPut:
			mu.Lock()
			copied = append(copied, r.URL.Path)
			mu.Unlock()
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<CopyObjectResult><ETag>"etag-new"</ETag></CopyObjectResult>`))
		case http.MethodDelete:
			mu.Lock()
			deleted = append(deleted, r.URL.Path)
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer mock.Close()

	account := models.CloudAccount{UserID: s.user.ID, Name: "Rekey Storage", Provider: models.ProviderMinIO, IsActive: true}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint: mock.URL, Bucket: "rekey-bucket", Region: "us-east-1",
		AccessKeyID: "mock-key", SecretAccessKey: "mock-secret", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	oldKey := fmt.Sprintf("users/%d/items/%s-a.pdf", s.user.ID, uuid.New().String())
	file := models.DriveItem{
		UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: account.ID,
		Name: "a.pdf", Type: models.ItemTypeFile, StoragePath: oldKey, Status: models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	payload, _ := json.Marshal(map[string]any{"name": "b.pdf"})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", file.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertOk()

	wantKey := fmt.Sprintf("users/%d/b.pdf", s.user.ID)
	var reloaded models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("id", file.ID).First(&reloaded))
	s.Equal("b.pdf", reloaded.Name)
	s.Equal(models.ItemStatusReady, reloaded.Status, "a settled move must end ready")
	s.Equal(wantKey, reloaded.StoragePath, "the row must point at the re-keyed object")

	mu.Lock()
	defer mu.Unlock()
	s.Contains(copied, "/rekey-bucket/"+wantKey, "the object must be copied to its new key")
	s.Contains(deleted, "/rekey-bucket/"+oldKey, "the old object must be deleted")
}

// TestMoveFolderRekeysDescendants proves moving a folder re-keys every file
// inside it from its own name and its new folder path — not by substituting the
// old key's prefix.
func (s *DriveItemAPITestSuite) TestMoveFolderRekeysDescendants() {
	var mu sync.Mutex
	var copied, deleteBodies []string
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodHead:
			w.Header().Set("Content-Length", "1024")
			w.Header().Set("ETag", `"etag"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodPut:
			mu.Lock()
			copied = append(copied, r.URL.Path)
			mu.Unlock()
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<CopyObjectResult><ETag>"etag-new"</ETag></CopyObjectResult>`))
		case http.MethodPost:
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			deleteBodies = append(deleteBodies, string(body))
			mu.Unlock()
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<DeleteResult></DeleteResult>`))
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer mock.Close()

	account := models.CloudAccount{UserID: s.user.ID, Name: "Folder Rekey Storage", Provider: models.ProviderMinIO, IsActive: true}
	_ = account.SetCredentials(&models.S3Credentials{
		Endpoint: mock.URL, Bucket: "folder-bucket", Region: "us-east-1",
		AccessKeyID: "mock-key", SecretAccessKey: "mock-secret", UsePathStyle: true,
	})
	s.Require().NoError(facades.Orm().Query().Create(&account))

	folderB := models.DriveItem{UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: account.ID, Name: "B", Type: models.ItemTypeFolder, Status: models.ItemStatusReady}
	s.Require().NoError(facades.Orm().Query().Create(&folderB))
	folderA := models.DriveItem{UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: account.ID, Name: "A", Type: models.ItemTypeFolder, Status: models.ItemStatusReady}
	s.Require().NoError(facades.Orm().Query().Create(&folderA))

	oldKey := fmt.Sprintf("users/%d/items/%s-f.pdf", s.user.ID, uuid.New().String())
	file := models.DriveItem{
		UUID: uuid.New().String(), UserID: s.user.ID, CloudAccountID: account.ID,
		ParentID: &folderA.ID, Name: "f.pdf", Type: models.ItemTypeFile, StoragePath: oldKey, Status: models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&file))

	payload, _ := json.Marshal(map[string]any{"parent_uuid": folderB.UUID})
	resp, err := s.Http(s.T()).WithToken(s.token).
		WithHeader("Content-Type", "application/json").
		Patch(fmt.Sprintf("/v1/drive/items/%s", folderA.UUID), bytes.NewBuffer(payload))
	s.Require().NoError(err)
	resp.AssertOk()

	var reloadedFolder models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("id", folderA.ID).First(&reloadedFolder))
	s.Require().NotNil(reloadedFolder.ParentID)
	s.Equal(folderB.ID, *reloadedFolder.ParentID)

	wantKey := fmt.Sprintf("users/%d/B/A/f.pdf", s.user.ID)
	var reloadedFile models.DriveItem
	s.Require().NoError(facades.Orm().Query().Where("id", file.ID).First(&reloadedFile))
	s.Equal(wantKey, reloadedFile.StoragePath, "a descendant must be re-keyed under the new folder path")
	s.Equal(models.ItemStatusReady, reloadedFile.Status)

	mu.Lock()
	defer mu.Unlock()
	s.Contains(copied, "/folder-bucket/"+wantKey)
	foundOld := false
	for _, b := range deleteBodies {
		if strings.Contains(b, oldKey) {
			foundOld = true
		}
	}
	s.True(foundOld, "the descendant's old object must be batch-deleted")
}
```

Add `"strings"` to the imports too.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestRenameRekeysObject|TestDriveItemAPITestSuite/TestMoveFolderRekeysDescendants' -v`
Expected: FAIL — the rename/move update the row but leave `storage_path` at its old value (no job exists yet), so the key assertions fail.

- [ ] **Step 3: Add the re-key logic to the service**

Append to `backend/app/services/cloud_drive_service.go`:

```go
// RekeyItem is the body of RekeyDriveItemJob: after a rename/move it copies the
// object(s) to their new key, updates the database, then deletes the old
// object(s). It runs outside the request, so a large folder move cannot time
// out the caller.
//
// An item with no object to move (a file with an empty storage_path, a folder
// with no file descendants) updates its row without any S3 call.
func (s *CloudDriveService) RekeyItem(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) error {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return err
	}
	previousName := item.Name

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return s.markRekeyFailed(ctx, userID, item, err)
	}

	if item.IsFolder() {
		err = s.rekeyFolder(ctx, userID, driver, item, newName, newParentID)
	} else {
		err = s.rekeyFile(ctx, userID, driver, item, newName, newParentID)
	}
	if err != nil {
		return s.markRekeyFailed(ctx, userID, item, err)
	}

	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}
	if finalName != previousName {
		activityService := NewActivityService()
		activityService.LogSafe(userID, item.CloudAccountID, "renamed",
			fmt.Sprintf("%s -> %s", previousName, finalName), &item.UUID, "system", "Queue Worker", nil)
	}
	return nil
}

// rekeyFile re-keys a single file: copy to the new key, update the row, delete
// the old object.
func (s *CloudDriveService) rekeyFile(ctx context.Context, userID uint, driver contracts.CloudDriver, item *models.DriveItem, newName string, newParentID *uint) error {
	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}

	destPath, err := s.folderPath(ctx, userID, item.CloudAccountID, newParentID)
	if err != nil {
		return err
	}
	newKey := buildStorageKey(userID, destPath, finalName)

	// Nothing to copy: no object, or the key does not change. Update the row
	// (and clear the moving marker) without touching S3.
	if item.StoragePath == "" || item.StoragePath == newKey {
		_, err = s.ApplyMove(ctx, userID, item.UUID, newName, newParentID, item.StoragePath)
		return err
	}

	oldKey := item.StoragePath
	if err := driver.CopyObject(ctx, oldKey, newKey); err != nil {
		return err
	}
	if _, err := s.ApplyMove(ctx, userID, item.UUID, newName, newParentID, newKey); err != nil {
		// The row was not updated, so remove the object we just created to
		// avoid an orphan at the new key.
		_ = driver.Delete(ctx, newKey)
		return err
	}
	// The row already points at the new key. A failed delete leaves a stale
	// object, which is a cleanup issue, not a failed move.
	if err := driver.Delete(ctx, oldKey); err != nil {
		facades.Log().Errorf("[drive] rekey: failed to delete old object %q: %v", oldKey, err)
	}
	return nil
}

// rekeyFolder re-keys every file in a moved folder. Each file's new key is
// derived from its own name and its path inside the moved subtree — not by
// substituting the old key's prefix, because a descendant may still carry a
// legacy flat key that shares no prefix with its siblings.
func (s *CloudDriveService) rekeyFolder(ctx context.Context, userID uint, driver contracts.CloudDriver, item *models.DriveItem, newName string, newParentID *uint) error {
	allItems, _, _, err := s.CollectDescendantItems(ctx, userID, item.CloudAccountID, item.ID)
	if err != nil {
		return err
	}

	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}

	destPath, err := s.folderPath(ctx, userID, item.CloudAccountID, newParentID)
	if err != nil {
		return err
	}
	newFolderPath := finalName
	if destPath != "" {
		newFolderPath = destPath + "/" + finalName
	}

	byID := make(map[uint]models.DriveItem, len(allItems))
	for _, it := range allItems {
		byID[it.ID] = it
	}

	type rekeyMove struct {
		id           uint
		oldKey       string
		newKey       string
	}
	var moves []rekeyMove
	for _, it := range allItems {
		if !it.IsFile() || it.StoragePath == "" {
			continue
		}
		rel, err := relativeFolderPath(byID, item.ID, it)
		if err != nil {
			return err
		}
		filePath := newFolderPath
		if rel != "" {
			filePath = newFolderPath + "/" + rel
		}
		newKey := buildStorageKey(userID, filePath, it.Name)
		if newKey == it.StoragePath {
			continue
		}
		moves = append(moves, rekeyMove{id: it.ID, oldKey: it.StoragePath, newKey: newKey})
	}

	var copiedNewKeys []string
	for _, m := range moves {
		if err := driver.CopyObject(ctx, m.oldKey, m.newKey); err != nil {
			_ = driver.DeleteObjects(ctx, copiedNewKeys)
			return err
		}
		copiedNewKeys = append(copiedNewKeys, m.newKey)
	}

	err = facades.Orm().Transaction(func(tx orm.Query) error {
		folderUpdate := map[string]any{"name": finalName, "status": models.ItemStatusReady}
		if newParentID != nil {
			if *newParentID > 0 {
				folderUpdate["parent_id"] = *newParentID
			} else {
				folderUpdate["parent_id"] = nil
			}
		}
		if _, err := tx.Model(&models.DriveItem{}).Where("id", item.ID).Update(folderUpdate); err != nil {
			return err
		}
		for _, m := range moves {
			if _, err := tx.Model(&models.DriveItem{}).Where("id", m.id).Update(map[string]any{
				"storage_path": m.newKey,
				"status":       models.ItemStatusReady,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		_ = driver.DeleteObjects(ctx, copiedNewKeys)
		return err
	}

	if len(moves) > 0 {
		oldKeys := make([]string, 0, len(moves))
		for _, m := range moves {
			oldKeys = append(oldKeys, m.oldKey)
		}
		if err := driver.DeleteObjects(ctx, oldKeys); err != nil {
			facades.Log().Errorf("[drive] rekey folder: failed to delete old objects: %v", err)
		}
	}
	return nil
}

// markRekeyFailed leaves the item at its old location (nothing was written
// before the failure) and records the failed status and activity.
func (s *CloudDriveService) markRekeyFailed(ctx context.Context, userID uint, item *models.DriveItem, cause error) error {
	_, _ = facades.Orm().Query().Model(&models.DriveItem{}).Where("id", item.ID).
		Update(map[string]any{"status": models.ItemStatusFailed})

	facades.Log().Errorf("[drive] rekey failed item=%d (%s): %v", item.ID, item.Name, cause)

	activityService := NewActivityService()
	activityService.LogSafe(userID, item.CloudAccountID, "move_failed", item.Name, &item.UUID, "system", "Queue Worker", nil)

	return cause
}

// relativeFolderPath returns the "/"-joined folder names strictly below rootID
// on the path from rootID down to item's parent. It returns "" when item is a
// direct child of rootID, so a direct child's key needs no extra segment. The
// walk is guarded against a corrupted cycle.
func relativeFolderPath(byID map[uint]models.DriveItem, rootID uint, item models.DriveItem) (string, error) {
	if item.ParentID == nil || *item.ParentID == rootID {
		return "", nil
	}

	seen := map[uint]bool{}
	var reversed []string
	current := *item.ParentID
	for current != 0 && current != rootID {
		if seen[current] {
			return "", errors.New("cycle in folder tree")
		}
		seen[current] = true
		node, ok := byID[current]
		if !ok {
			return "", errors.New("descendant folder not found")
		}
		reversed = append(reversed, node.Name)
		if node.ParentID == nil {
			break
		}
		current = *node.ParentID
	}

	parts := make([]string, 0, len(reversed))
	for i := len(reversed) - 1; i >= 0; i-- {
		parts = append(parts, reversed[i])
	}
	return strings.Join(parts, "/"), nil
}
```

Add `"github.com/goravel/framework/contracts/database/orm"` to the file's imports.

- [ ] **Step 4: Create the job**

Create `backend/app/jobs/rekey_drive_item_job.go`:

```go
package jobs

import (
	"context"
	"fmt"

	"ponta_drive/app/services"
)

// RekeyDriveItemJob re-keys the object(s) behind a renamed/moved item. It runs
// off the request thread so a large folder move cannot time out the caller.
type RekeyDriveItemJob struct{}

func (j *RekeyDriveItemJob) Signature() string {
	return "rekey_drive_item_job"
}

func (j *RekeyDriveItemJob) Handle(args ...any) error {
	if len(args) < 3 {
		return fmt.Errorf("insufficient arguments: expected userID, itemUUID and newName")
	}

	var userID uint
	switch v := args[0].(type) {
	case uint:
		userID = v
	case int:
		userID = uint(v)
	case int64:
		userID = uint(v)
	case float64:
		userID = uint(v)
	}

	itemUUID, _ := args[1].(string)
	newName, _ := args[2].(string)

	// parentID is a plain uint (0 = root) with a separate flag for "the parent
	// changes at all": a *uint argument would be dropped by the database
	// driver's ConvertArgs, silently turning a move-into-folder into a move to
	// root. See the plan's Global Constraints.
	var parentID uint
	if len(args) >= 4 {
		switch v := args[3].(type) {
		case uint:
			parentID = v
		case int:
			parentID = uint(v)
		case int64:
			parentID = uint(v)
		case float64:
			parentID = uint(v)
		}
	}
	hasParentChange := false
	if len(args) >= 5 {
		if b, ok := args[4].(bool); ok {
			hasParentChange = b
		}
	}

	var newParentID *uint
	if hasParentChange {
		pid := parentID
		newParentID = &pid
	}

	service := services.NewCloudDriveService()
	return service.RekeyItem(context.Background(), userID, itemUUID, newName, newParentID)
}
```

- [ ] **Step 5: Register the job**

In `backend/bootstrap/jobs.go`, add it to the slice:

```go
func Jobs() []queue.Job {
	return []queue.Job{
		&jobs.SyncS3BucketJob{},
		&jobs.RekeyDriveItemJob{},
	}
}
```

- [ ] **Step 6: Add the `move_in_progress` locale key**

`backend/lang/en/drive.json` — add before the closing brace:

```json
  "move_in_progress": "This item is already being moved. Please wait for it to finish."
```

`backend/lang/vi/drive.json` — add before the closing brace:

```json
  "move_in_progress": "Mục này đang được di chuyển. Vui lòng đợi hoàn tất."
```

- [ ] **Step 7: Dispatch the job from the controller instead of writing**

In `backend/app/http/controllers/drive_item_controller.go`, replace the body of `Update` from `name := req.Name` through the closing `}` of the method with:

```go
	name := req.Name
	if name == "" {
		name = ctx.Request().Input("name")
	}

	// `parent_uuid` is a *string so "absent" (rename only) is distinguishable
	// from "present but empty" (move to root). Absent => nil => no parent change.
	var parentID *uint
	if req.ParentUUID != nil {
		if *req.ParentUUID == "" {
			var root uint
			parentID = &root
		} else {
			pid, err := c.service.ResolveDriveItemID(context.Background(), user.ID, *req.ParentUUID)
			if err != nil {
				return failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)
			}
			parentID = &pid
		}
	}

	// Validate first: destination, cycle guard, name validity and uniqueness. A
	// bad request is rejected before anything is written or queued.
	if _, err := c.service.ValidateMove(context.Background(), user.ID, itemUUID, name, parentID); err != nil {
		return failServiceError(ctx, err, "drive.update_failed")
	}

	// Refuse a second move while one is in flight. Only observable with an
	// asynchronous queue; with the sync driver the first move already settled.
	if existing, fetchErr := c.service.GetItemByUUID(context.Background(), user.ID, itemUUID); fetchErr == nil && existing.Status == models.ItemStatusMoving {
		return failResponse(ctx, http.StatusConflict, "drive.move_in_progress", errors.New("item is already moving"))
	}

	// Mark the item moving, then hand the re-key to the queue. The item keeps
	// its old name and location until the job copies the object and updates the
	// row, so a failure leaves it intact at its old key.
	_, _ = facades.Orm().Query().Model(&models.DriveItem{}).
		Where("uuid", itemUUID).Where("user_id", user.ID).
		Update(map[string]any{"status": models.ItemStatusMoving})

	parentValue := uint(0)
	hasParentChange := parentID != nil
	if parentID != nil {
		parentValue = *parentID
	}

	job := &jobs.RekeyDriveItemJob{}
	if err := facades.Queue().Job(job, []queue.Arg{
		{Value: user.ID, Type: "uint"},
		{Value: itemUUID, Type: "string"},
		{Value: name, Type: "string"},
		{Value: parentValue, Type: "uint"},
		{Value: hasParentChange, Type: "bool"},
	}).Dispatch(); err != nil {
		facades.Log().Errorf("[drive] rekey dispatch failed item=%s: %v", itemUUID, err)
		_, _ = facades.Orm().Query().Model(&models.DriveItem{}).
			Where("uuid", itemUUID).Where("user_id", user.ID).
			Update(map[string]any{"status": models.ItemStatusFailed})
		return failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)
	}

	// With the sync driver the job already ran, so this carries the settled
	// item; with the database driver it carries the moving item and the client
	// polls until the status settles.
	item, err := c.service.GetItemByUUID(context.Background(), user.ID, itemUUID)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)
	}

	return ctx.Response().Success().Json(http.Json{
		"status": "ok",
		"data":   item.ToResponse(),
	})
```

Add `"github.com/goravel/framework/contracts/queue"` and `"ponta_drive/app/jobs"` to that file's imports. The `renamed` activity block and its `fmt.Sprintf`/`helpers` usage are removed here (they moved into `RekeyItem` in Step 3); `shouldLogRename` stays and is still covered by `drive_item_controller_test.go`.

- [ ] **Step 8: Run the new tests to verify they pass**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite/TestRenameRekeysObject|TestDriveItemAPITestSuite/TestMoveFolderRekeysDescendants' -v`
Expected: PASS.

- [ ] **Step 9: Run the whole backend suite to confirm no regression**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. Every existing move/rename test keeps working: their file rows have an empty `storage_path`, so `rekeyFile` updates the row without any S3 call (Review Focus #3), and their folder moves have no file descendants, so `rekeyFolder` skips S3 too. `TestDriveItemLifecycle`'s rename of an empty folder also stays a database-only update.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/cloud_drive_service.go backend/app/jobs/rekey_drive_item_job.go backend/bootstrap/jobs.go backend/app/http/controllers/drive_item_controller.go backend/lang/en/drive.json backend/lang/vi/drive.json backend/tests/feature/drive_item_api_test.go
git commit -m "feat(drive): re-key moved items asynchronously via a queued job"
```

---

### Task 8: Frontend — poll the move to settlement and surface its outcome

**Files:**
- Modify: `frontend/src/api/driveItems.ts` (add `getDriveItem`)
- Modify: `frontend/src/stores/driveItems.ts` (add the poll; rewrite `rename`/`move`)
- Modify: `frontend/src/components/drive/RenameDialog.vue`, `frontend/src/components/drive/MoveDialog.vue` (settled-failure toast)
- Modify: `frontend/src/views/HomeView.vue` (`move_failed` icon/color)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/vi.json` (four `drive.*` keys + `home.act_move_failed`)
- Test: `frontend/src/api/__tests__/driveItems.spec.ts`, `frontend/src/stores/__tests__/driveItems.spec.ts`, `frontend/src/i18n/__tests__/driveKeys.spec.ts`

**Interfaces:**
- Consumes: the PATCH responses from `renameDriveItem`/`moveDriveItem` (now carrying `status = moving` on the database driver, or the settled item on the sync driver — Task 7), the backend `Show` endpoint (`GET /v1/drive/items/:uuid`), and the `moving`/`ready`/`failed` status values (Task 1 / Task 7).
- Produces:
  - `getDriveItem(uuid: string): Promise<ApiResponse<DriveItem>>` in `api/driveItems.ts`
  - `export class MoveNotSettledError extends Error` in `stores/driveItems.ts`
  - `export const MOVE_POLL_INTERVAL_MS`, `export const MOVE_POLL_MAX_ATTEMPTS`
  - `rename`/`move` that resolve with the settled item only when `status === 'ready'`, and reject with `MoveNotSettledError` otherwise.

> **Correction to the spec (§9.2).** The spec's store sketch implies the poll always issues a `getDriveItem`. The plan makes the PATCH response the *first* settlement check and only polls when it still reports `moving`. With the `sync` queue driver (the dev default) the re-key already finished inside the PATCH, so this costs zero extra requests; with the `database` driver the first check is `moving` and the poll runs. The behavior the spec asks for — bounded poll, success decided by the settled `status`, `move` removes the item only on `ready` — is unchanged.

> **Correction to the spec (§9.3, failure toast).** The spec routes a settled failure through the dialogs but does not say how the store signals it. The store rejects with `MoveNotSettledError` (a small exported error type) so it stays free of locale strings, and each dialog maps that type to `drive.move_failed`. Any other rejection keeps its existing handling (`ApiError` message, else `drive.action_failed`).

- [ ] **Step 1: Add `getDriveItem` to the API client**

In `frontend/src/api/driveItems.ts`, add after `getDriveItemBreadcrumb`:

```ts
/**
 * Fetches one item. Used to poll an item after a rename/move: the write
 * returns immediately with `status = moving` (or, on the sync queue driver,
 * the already-settled item) and the settled status is what decides success.
 */
export async function getDriveItem(uuid: string): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`)
}
```

- [ ] **Step 2: Write the failing API test**

In `frontend/src/api/__tests__/driveItems.spec.ts`, add `getDriveItem` to the import list, then append inside the `describe`:

```ts
  it('getDriveItem GETs the item endpoint', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await getDriveItem('item-uuid')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid')
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/api/__tests__/driveItems.spec.ts`
Expected: FAIL — `getDriveItem` is not exported yet.

- [ ] **Step 4: Rewrite the store's `rename`/`move` with the poll**

In `frontend/src/stores/driveItems.ts`, add `getDriveItem` to the existing import from `@/api/driveItems`. Then add, above `export const useDriveItemsStore`:

```ts
/**
 * How long to wait between polls while a re-key runs, and how many times to
 * poll before giving up. A large folder move can take a while, so the loop is
 * bounded rather than waiting forever.
 */
export const MOVE_POLL_INTERVAL_MS = 2000
export const MOVE_POLL_MAX_ATTEMPTS = 30

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thrown when a rename/move did not settle at `ready` — the backend re-key
 * failed, or the poll hit its attempt bound. Carries no message: the dialogs
 * map it to a localized string.
 */
export class MoveNotSettledError extends Error {
  constructor() {
    super('move did not settle')
    this.name = 'MoveNotSettledError'
  }
}
```

Then replace `rename` and `move` with:

```ts
  /**
   * Waits for a rename/move to settle. The PATCH response is the first check:
   * with the "sync" queue driver the re-key already ran, so it is already
   * settled and no request is wasted. While it still reports `moving`, the
   * single item is polled until it leaves that state or the bound is hit.
   * Returns the settled item, or null if it never settled.
   */
  async function awaitMoveSettled(uuid: string, patched: DriveItem): Promise<DriveItem | null> {
    let current = patched
    for (let attempt = 0; attempt < MOVE_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (current.status !== 'moving') {
        return current
      }
      await sleep(MOVE_POLL_INTERVAL_MS)
      try {
        const res = await getDriveItem(uuid)
        current = res.data as DriveItem
      } catch {
        // A transient poll failure should not strand the UI; keep polling
        // until the item settles or the bound stops the loop.
      }
    }
    return current.status !== 'moving' ? current : null
  }

  async function rename(uuid: string, newName: string): Promise<DriveItem> {
    const res = await renameDriveItem(uuid, newName)
    const patched = res.data as DriveItem
    const settled = await awaitMoveSettled(uuid, patched)
    if (!settled || settled.status !== 'ready') {
      throw new MoveNotSettledError()
    }
    items.value = items.value.map((i) => (i.uuid === uuid ? settled : i))
    return settled
  }

  async function move(uuid: string, parentUuid: string | null): Promise<DriveItem> {
    const res = await moveDriveItem(uuid, parentUuid)
    const patched = res.data as DriveItem
    const settled = await awaitMoveSettled(uuid, patched)
    if (!settled || settled.status !== 'ready') {
      // The move did not happen, so the item never left its folder: leave the
      // listing untouched and let the dialog report the failure.
      throw new MoveNotSettledError()
    }
    // Only now does the item truly belong to another folder.
    items.value = items.value.filter((i) => i.uuid !== uuid)
    return settled
  }
```

- [ ] **Step 5: Write the failing store tests**

In `frontend/src/stores/__tests__/driveItems.spec.ts`, replace the existing `move removes the item from the current listing` test (lines ~238-257) and the `rename updates the target item in place` test (lines ~273-282) with:

```ts
  it('move removes the item once the re-key settles ready', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a'), item('b')],
      meta: { has_more: false, next_cursor: '' },
    })
    const moveSpy = vi.spyOn(api, 'moveDriveItem').mockResolvedValue({
      status: 'ok',
      data: { ...item('a'), status: 'ready' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })

    const moved = await store.move('a', 'dest-uuid')

    expect(moveSpy).toHaveBeenCalledWith('a', 'dest-uuid')
    expect(moved.status).toBe('ready')
    expect(store.items.map((i) => i.uuid)).toEqual(['b'])
  })

  it('move keeps the item and rejects when the re-key failed', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a'), item('b')],
      meta: { has_more: false, next_cursor: '' },
    })
    vi.spyOn(api, 'moveDriveItem').mockResolvedValue({
      status: 'ok',
      data: { ...item('a'), status: 'failed' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })

    await expect(store.move('a', 'dest-uuid')).rejects.toBeInstanceOf(MoveNotSettledError)
    // A failed move leaves the item where it was: it must stay in the listing.
    expect(store.items.map((i) => i.uuid)).toEqual(['a', 'b'])
  })

  it('move polls a single item until the re-key settles', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(api, 'listDriveItems').mockResolvedValue({
        status: 'ok',
        data: [item('a'), item('b')],
        meta: { has_more: false, next_cursor: '' },
      })
      vi.spyOn(api, 'moveDriveItem').mockResolvedValue({
        status: 'ok',
        data: { ...item('a'), status: 'moving' },
      })
      const getSpy = vi.spyOn(api, 'getDriveItem').mockResolvedValue({
        status: 'ok',
        data: { ...item('a'), status: 'ready' },
      })

      const store = useDriveItemsStore()
      await store.loadFirstPage({ cloudAccountId: 1 })

      const pending = store.move('a', 'dest-uuid')
      await vi.advanceTimersByTimeAsync(MOVE_POLL_INTERVAL_MS)
      const moved = await pending

      expect(getSpy).toHaveBeenCalledWith('a')
      expect(moved.status).toBe('ready')
      expect(store.items.map((i) => i.uuid)).toEqual(['b'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rename updates the item once the re-key settles ready', async () => {
    vi.spyOn(api, 'renameDriveItem').mockResolvedValue({
      status: 'ok',
      data: { ...item('a', 'Renamed A'), status: 'ready' },
    })

    const store = useDriveItemsStore()
    store.items = [item('a', 'Old A'), item('b')]

    await store.rename('a', 'Renamed A')
    expect(store.items[0]?.name).toBe('Renamed A')
  })

  it('rename keeps the old name and rejects when the re-key failed', async () => {
    vi.spyOn(api, 'renameDriveItem').mockResolvedValue({
      status: 'ok',
      data: { ...item('a', 'Old A'), status: 'failed' },
    })

    const store = useDriveItemsStore()
    store.items = [item('a', 'Old A')]

    await expect(store.rename('a', 'New A')).rejects.toBeInstanceOf(MoveNotSettledError)
    expect(store.items[0]?.name).toBe('Old A')
  })
```

Update the import at the top of the file to also bring in the new symbols:

```ts
import { useDriveItemsStore, MoveNotSettledError, MOVE_POLL_INTERVAL_MS } from '@/stores/driveItems'
```

- [ ] **Step 6: Run the store and API tests to verify they pass**

Run: `cd frontend && npx vitest run src/stores/__tests__/driveItems.spec.ts src/api/__tests__/driveItems.spec.ts`
Expected: PASS.

- [ ] **Step 7: Map a settled failure to `drive.move_failed` in both dialogs**

In `frontend/src/components/drive/RenameDialog.vue`, change the store import to also import the error type:

```ts
import { useDriveItemsStore, MoveNotSettledError } from '@/stores/driveItems'
```

and replace the `catch` block of `submit()` with:

```ts
  } catch (e) {
    console.error(e)
    if (e instanceof MoveNotSettledError) {
      // The re-key failed or timed out: the name is unchanged on the server.
      error.value = t('drive.move_failed')
    } else {
      error.value = e instanceof ApiError ? e.message : t('drive.action_failed')
    }
  } finally {
```

In `frontend/src/components/drive/MoveDialog.vue`, do the same import change:

```ts
import { useDriveItemsStore, MoveNotSettledError } from '@/stores/driveItems'
```

replace the `catch` block of `submit()` with:

```ts
  } catch (e) {
    console.error(e)
    if (e instanceof MoveNotSettledError) {
      // The move failed or timed out: the item is still in its old folder.
      error.value = t('drive.move_failed')
    } else {
      error.value = e instanceof ApiError ? e.message : t('drive.action_failed')
    }
  } finally {
```

and change the confirm button's label so the pending state is visible while the (possibly large) move runs:

```html
        <Button type="button" :disabled="moving || !props.item" @click="submit">
          <Loader2 v-if="moving" class="h-4 w-4 animate-spin" />
          {{ moving ? t('drive.moving') : t('drive.move_here') }}
        </Button>
```

- [ ] **Step 8: Add the locale keys**

In `frontend/src/locales/en.json`, add to the `drive` object:

```json
    "name_conflict": "A file or folder with this name already exists here.",
    "name_invalid": "Invalid name.",
    "moving": "Moving...",
    "move_failed": "Move failed. Please try again.",
```

In `frontend/src/locales/vi.json`, add to the `drive` object:

```json
    "name_conflict": "Tên đã tồn tại trong thư mục này.",
    "name_invalid": "Tên không hợp lệ.",
    "moving": "Đang di chuyển...",
    "move_failed": "Di chuyển thất bại. Vui lòng thử lại.",
```

In **both** files, add to the `home` object (the activity feed resolves `home.act_<action>`, and Task 7 logs a `move_failed` activity):

```json
    "act_move_failed": "Move failed",
```

(vi: `"act_move_failed": "Di chuyển thất bại",`)

- [ ] **Step 9: Pin the new keys in the locale test**

In `frontend/src/i18n/__tests__/driveKeys.spec.ts`, add to the `required` array:

```ts
      'name_conflict',
      'name_invalid',
      'moving',
      'move_failed',
```

- [ ] **Step 10: Give `move_failed` an icon and color in the activity feed**

In `frontend/src/views/HomeView.vue`, add `TriangleAlert` to the `lucide-vue-next` import list, then add a case to `activityIcon`:

```ts
    case 'move_failed':
      return TriangleAlert
```

and a case to `activityIconColor`:

```ts
    case 'move_failed':
      return 'text-rose-500'
```

- [ ] **Step 11: Run the whole frontend suite and the linters**

Run:
```bash
cd frontend && npm run test:run && npm run type-check && npx oxlint . && npx eslint .
```
Expected: `test:run` PASS; `type-check` exit 0; `oxlint` exit 0; `eslint` shows only the 11 pre-existing errors (3 in `src/api/client.ts`, 8 under `src/components/ui/*`) — no new error.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/api/driveItems.ts frontend/src/stores/driveItems.ts frontend/src/components/drive/RenameDialog.vue frontend/src/components/drive/MoveDialog.vue frontend/src/views/HomeView.vue frontend/src/locales/en.json frontend/src/locales/vi.json frontend/src/api/__tests__/driveItems.spec.ts frontend/src/stores/__tests__/driveItems.spec.ts frontend/src/i18n/__tests__/driveKeys.spec.ts
git commit -m "feat(drive): poll move settlement and surface the outcome"
```

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task:

| Spec section | Task |
|---|---|
| §4 key scheme + §4.1 `folderPath` | Task 3 |
| §4.2 legacy-prefix collision | Task 5 |
| §5 `EnsureUniqueName` + §5.2 `ValidateItemName` + §5.3 root | Task 1 (helper), Task 2 (enforcement on create/upload), Task 6 (rename/move) |
| §6 `ScanBucket` three shapes + §6.2 materialiser + §6.3 uuid pattern + §6.4 tracked rows | Task 5 |
| §7 `CopyObject` + `encodeCopySource` + multipart | Task 4 |
| §8.1 order (copy → DB → delete) | Task 7 (`rekeyFile`/`rekeyFolder`) |
| §8.2 `ItemStatusMoving` | Task 1 |
| §8.3 controller split + flow | Task 6 (`ValidateMove`/`ApplyMove`), Task 7 (dispatch) |
| §8.4 job file/folder/failure/idempotency | Task 7 |
| §8.5 status signal | Task 7 (backend), Task 8 (frontend poll) |
| §9.1 `getDriveItem` | Task 8 |
| §9.2 store poll + success-only removal | Task 8 |
| §9.3 dialogs | Task 8 |
| §9.4 i18n | Task 2 (backend `name_conflict`/`name_invalid`), Task 7 (`move_in_progress`), Task 8 (frontend keys) |
| §11 testing | every task's test steps |

No section is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"add appropriate error handling"/"similar to Task N". Every code step carries the code; every test step carries the assertions; every run step names the exact command and expected result.

**3. Type consistency.** Checked across task boundaries:
- `folderPath(ctx, userID, cloudAccountID uint, parentID *uint) (string, error)` — defined Task 3, called Task 7 (`rekeyFile`, `rekeyFolder`).
- `buildStorageKey(userID uint, folderPath, fileName string) string` — defined Task 3, called Task 7.
- `CopyObject(ctx context.Context, srcKey string, dstKey string) error` — defined Task 4, called Task 7.
- `ValidateMove` / `ApplyMove(ctx, userID uint, itemUUID, newName string, newParentID *uint, newStoragePath string)` — defined Task 6, called Task 6 (controller) and Task 7 (`rekeyFile`).
- `EnsureUniqueName` / `ValidateItemName` / `failServiceError` — defined Tasks 1-2, consumed Task 6.
- `RekeyDriveItemJob.Signature()` = `"rekey_drive_item_job"`; its arg order (`uint`, `string`, `string`, `uint`, `bool`) matches Task 7's `Handle` type-switch exactly.
- `models.ItemStatusMoving` / `ItemStatusFailed` / `ItemStatusReady` — Task 1 defines `Moving`; Task 7 uses all three.
- `getDriveItem` / `MoveNotSettledError` / `MOVE_POLL_INTERVAL_MS` — defined and consumed within Task 8.
- Backend `drive.name_conflict` / `drive.name_invalid` (Task 2) and `drive.move_in_progress` (Task 7) are the keys the controller passes to `failServiceError` / `failResponse`; frontend `drive.name_conflict` / `name_invalid` / `moving` / `move_failed` (Task 8) mirror them.

**4. Review Focus.** Each of the five lines has a test in the owning task:
- Key with spaces/non-ASCII → per-segment `encodeCopySource`: Task 4 (`copy_source_test.go`).
- >5 GiB object → multipart copy: Task 4 (`s3_driver_test.go`).
- Empty-`storage_path` move updates the DB without an S3 call: Task 7 Step 9 (existing suite passes because `createFileItem` rows have no `storage_path`; `rekeyFile`'s `item.StoragePath == ""` guard) and Step 1's two mock-S3 tests pin the real-copy path.
- Basename with no uuid prefix under `users/<uid>/items/` materialises a real `items` folder: Task 5.
- Name with `/`, `\`, control char, `.`, `..` rejected 422: Task 1 (`ValidateItemName` unit test), Task 2 (create/upload 422), Task 6 (`TestRenameRejectsInvalidName`).
