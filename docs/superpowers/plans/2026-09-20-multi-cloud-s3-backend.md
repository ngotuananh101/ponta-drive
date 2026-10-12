# Multi-Cloud S3 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a secure, multi-cloud storage backend supporting S3/S3-Compatible (AWS, R2, MinIO) with user-managed credentials, supporting two upload mechanisms (Presigned URL direct-to-storage and Server Chunked/Multipart Upload), and full drive item CRUD with bucket sync.

**Architecture:** A layered Go/Goravel backend where (1) Models & Migrations define the data schema, (2) a Storage Abstraction Layer with a dynamic `DriverFactory` resolves the correct `CloudDriver` (S3, etc.) per user account at runtime, (3) Controllers expose RESTful APIs orchestrated by Services, and (4) a background scan/sync job keeps the virtual hierarchy in sync with the actual bucket.

**Tech Stack:** Go 1.25, Goravel Framework v1.18.0, AWS SDK for Go v2 (`s3`), GORM/ORM, PostgreSQL, JWT Auth (existing), Stretchr/testify (existing), go.uber.org/mock (for mocking).

**Spec:** docs/superpowers/specs/2026-09-20-multi-cloud-s3-backend-design.md

## Global Constraints

- Go module path: `ponta_drive`
- Framework: Goravel v1.18.0 (use `facades.*` pattern, not raw injection)
- Database: PostgreSQL, migrations via `bootstrap/migrations.go`
- Auth: Existing `middleware.JwtAuth` exposes `user` in context via `ctx.WithValue("user", user)`
- Encryption: Use `facades.Crypt()` for AES-256 symmetric encryption of credentials
- Testing: Follow existing `tests/feature/` Suite pattern using `tests.TestCase` and `facades.Orm()`
- Naming: kebab-case for JSON keys, snake_case for DB column tags

---

### Task 1: Environment Setup & S3 SDK Integration

**Files:**
- Modify: `go.mod`, `go.sum`

**Interfaces:**
- Produces: AWS SDK v2 S3 client available in the project.

- [ ] **Step 1: Write the failing test (smoke check for SDK import)**
- Run: `go build ./...` and expect failure if SDK not yet imported.

- [ ] **Step 2: Add AWS SDK v2 S3 dependency**

```bash
go get github.com/aws/aws-sdk-go-v2/service/s3@v1.79.0
go get github.com/aws/aws-sdk-go-v2/config@v1.29.7
go get github.com/aws/aws-sdk-go-v2/credentials@v1.17.7
go get github.com/aws/aws-sdk-go-v2/feature/s3/manager@v1.17.7
go get github.com/aws/aws-sdk-go-v2/feature/s3/presign@v1.17.7
go get github.com/aws/aws-sdk-go-v2/types@v1.30.2
```

- [ ] **Step 3: Update `bootstrap/migrations.go` to register an empty placeholder (no changes yet, ready for next tasks)**
- [ ] **Step 4: Run `go build ./...` to verify SDK loads**
- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: add AWS SDK v2 S3 dependencies"
```

---

### Task 2: Define Cloud Storage Interfaces (Contracts)

**Files:**
- Create:  `app/contracts/storage.go`
- Test:    `tests/unit/storage_contract_test.go`

**Interfaces:**
- Produces: `contracts.CloudDriver`, `contracts.ObjectMetadata`, etc.

- [ ] **Step 1: Write the failing unit test** checking that the interface types exist and have correct method signatures.

```go
// tests/unit/storage_contract_test.go
package unit

import (
	"io"
	"testing"
	"time"
	"reflect"

	"github.com/stretchr/testify/assert"
)

func TestCloudDriverInterface(t *testing.T) {
	assert.Implements(t, (*contracts.CloudDriver)(nil), &s3DriverStub{})
}

type s3DriverStub struct{}
// Implement stub methods returning nil/zero values for compile-check
func (s *s3DriverStub) Put(ctx context.Context, key string, reader io.Reader, size int64, mimeType string) error { return nil }
func (s *s3DriverStub) Get(ctx context.Context, key string) (io.ReadCloser, error) { return nil, nil }
func (s *s3DriverStub) Delete(ctx context.Context, key string) error { return nil }
func (s *s3DriverStub) Exists(ctx context.Context, key string) (bool, error) { return false, nil }
func (s *s3DriverStub) GetMetadata(ctx context.Context, key string) (*contracts.ObjectMetadata, error) { return nil, nil }
func (s *s3DriverStub) GetPresignedUploadURL(ctx context.Context, key string, mimeType string, expire time.Duration) (*contracts.PresignedURLResponse, error) { return nil, nil }
func (s *s3DriverStub) GetPresignedDownloadURL(ctx context.Context, key string, fileName string, expire time.Duration) (string, error) { return "", nil }
func (s *s3DriverStub) InitiateMultipart(ctx context.Context, key string, mimeType string) (string, error) { return "", nil }
func (s *s3DriverStub) UploadPart(ctx context.Context, key string, uploadID string, partNumber int32, reader io.Reader, size int64) (string, error) { return "", nil }
func (s *s3DriverStub) CompleteMultipart(ctx context.Context, key string, uploadID string, parts []contracts.CompletedPart) error { return nil }
func (s *s3DriverStub) AbortMultipart(ctx context.Context, key string, uploadID string) error { return nil }
func (s *s3DriverStub) ListObjects(ctx context.Context, prefix string, continuationToken string, maxKeys int32) (*contracts.ListObjectsResult, error) { return nil, nil }
```

- [ ] **Step 2: Run test to verify it fails** (`go test ./tests/unit/...` expecting undefined `contracts`)
- [ ] **Step 3: Write minimal `app/contracts/storage.go`**

```go
// Package contracts defines interfaces for cloud storage drivers.
package contracts

import (
	"context"
	"io"
	"time"
)

type ObjectMetadata struct {
	Key          string
	Size         int64
	MimeType     string
	ETag         string
	LastModified time.Time
}

type PresignedURLResponse struct {
	URL     string
	Method  string
	Headers map[string]string
	Expires time.Time
}

type CompletedPart struct {
	PartNumber int32
	ETag       string
}

type ListObjectsResult struct {
	Objects          []ObjectMetadata
	CommonPrefixes   []string
	NextContinuation string
	IsTruncated      bool
}

type CloudDriver interface {
	Put(ctx context.Context, key string, reader io.Reader, size int64, mimeType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	GetMetadata(ctx context.Context, key string) (*ObjectMetadata, error)
	GetPresignedUploadURL(ctx context.Context, key string, mimeType string, expire time.Duration) (*PresignedURLResponse, error)
	GetPresignedDownloadURL(ctx context.Context, key string, fileName string, expire time.Duration) (string, error)
	InitiateMultipart(ctx context.Context, key string, mimeType string) (uploadID string, error)
	UploadPart(ctx context.Context, key string, uploadID string, partNumber int32, reader io.Reader, size int64) (etag string, error)
	CompleteMultipart(ctx context.Context, key string, uploadID string, parts []CompletedPart) error
	AbortMultipart(ctx context.Context, key string, uploadID string) error
	ListObjects(ctx context.Context, prefix string, continuationToken string, maxKeys int32) (*ListObjectsResult, error)
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add app/contracts/storage.go tests/unit/storage_contract_test.go
git commit -m "feat: define CloudDriver interface and supporting types"
```

---

### Task 3: Create CloudAccount Model, Migration & Request DTOs

**Files:**
- Create:  `database/migrations/20260920010000_create_cloud_accounts_table.go`
- Create:  `app/models/cloud_account.go`
- Create:  `app/http/requests/cloud_account_request.go`
- Modify:  `bootstrap/migrations.go` (register new migration)
- Test:    `tests/feature/cloud_account_test.go`

- [ ] **Step 1: Write the failing feature test** (`tests/feature/cloud_account_test.go`) testing `POST /api/v1/cloud-accounts/test` returns `{"status":"ok"}` for valid S3-like config, and that `POST /api/v1/cloud-accounts` stores encrypted credentials.

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Create migration file** `20260920010000_create_cloud_accounts_table.go` matching the spec schema.
- [ ] **Step 4: Register migration** in `bootstrap/migrations.go`.
- [ ] **Step 5: Create model** `app/models/cloud_account.go` embedding `orm.Model`, `orm.SoftDeletes`, gorm tags matching spec (e.g. `gorm:"uniqueIndex"` on `provider`, default `total_storage=0`).
- [ ] **Step 6: Create request DTOs** `app/http/requests/cloud_account_request.go` with validation rules for `test-connection`, `store`, and `update` using Goravel's `validation` facade.
- [ ] **Step 7: Run test to verify it passes** (use in-memory SQLite if possible).
- [ ] **Step 8: Commit**

```bash
git add database/migrations/20260920010000_create_cloud_accounts_table.go app/models/cloud_account.go app/http/requests/cloud_account_request.go bootstrap/migrations.go tests/feature/cloud_account_test.go
git commit -m "feat: add CloudAccount model, migration, and request DTOs"
```

---

### Task 4: Implement S3Driver

**Files:**
- Create:  `app/services/storage/s3_driver.go`
- Test:    `tests/unit/s3_driver_test.go` (mock AWS calls or use localstack-like setup)

- [ ] **Step 1: Write failing unit test** asserting that `S3Driver` correctly maps credentials to an AWS client config (region auto-detection, path-style toggle).
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Write `s3_driver.go`** implementing `contracts.CloudDriver` using `s3.Client`.
  - Constructor `NewS3Driver(cfg S3Config)` accepting `AccessKey`, `SecretKey`, `Endpoint`, `Region`, `Bucket`, `UsePathStyle`.
  - Each method wraps the corresponding `s3.*` call.
  - `GetPresignedDownloadURL` sets `ResponseContentDisposition` param for forced download.
  - `ListObjectsV2Paginator` used for `ListObjects`.
- [ ] **Step 4: Run test → pass**
- [ ] **Step 5: Commit**

```bash
git add app/services/storage/s3_driver.go tests/unit/s3_driver_test.go
git commit -m "feat: implement S3Driver for AWS S3, R2, and MinIO"
```

---

### Task 5: Implement DriverFactory

**Files:**
- Create:  `app/services/storage/factory.go`
- Create:  `app/services/storage/config.go` (struct for S3Config / decrypted credentials)
- Test:    `tests/unit/factory_test.go`

- [ ] **Step 1: Write failing test** asserting that given a decrypted `credentialsJSON`, `BuildDriver("s3", creds)` returns an `S3Driver` and non-s3 providers raise an error.
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Write `factory.go`**:
  - Parses encrypted JSON → decrypt via `facades.Crypt().DecryptString`.
  - Switches on `provider` string to return concrete `*S3Driver` (for s3, cloudflare_r2, minio).
  - Includes a short LRU-style in-memory cache keyed by `accountID_provider` to reuse AWS clients.
- [ ] **Step 4: Run test → pass**
- [ ] **Step 5: Commit**

```bash
git add app/services/storage/factory.go app/services/storage/config.go tests/unit/factory_test.go
git commit -m "feat: implement dynamic DriverFactory with credential decryption"
```

---

### Task 6: Create DriveItem & UploadSession Models & Migrations

**Files:**
- Create:  `database/migrations/20260920020000_create_drive_items_table.go`
- Create:  `database/migrations/20260920030000_create_upload_sessions_table.go`
- Create:  `app/models/drive_item.go`
- Create:  `app/models/upload_session.go`
- Modify:  `bootstrap/migrations.go`

- [ ] **Step 1: Write failing feature test** asserting `drive_items` and `upload_sessions` tables created correctly via `facades.Orm().Query().Create(...)`.

- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Create the two migration files** matching the spec schema (with FK references to `users` and `cloud_accounts`).
- [ ] **Step 4: Register both migrations** in `bootstrap/migrations.go`.
- [ ] **Step 5: Write models** `drive_item.go` and `upload_session.go` with gorm tags.
  - `drive_items.uuid` uses `uuid.NewString()` default or manual UUID in service layer.
  - `upload_sessions` includes `UploadedParts` as `[]CompletedPart` serialized as JSON.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add database/migrations/20260920020000_create_drive_items_table.go database/migrations/20260920030000_create_upload_sessions_table.go app/models/drive_item.go app/models/upload_session.go
git commit -m "feat: add DriveItem and UploadSession models with migrations"
```

---

### Task 7: Cloud Account Management API (Controller + Routes)

**Files:**
- Create:  `app/http/controllers/cloud_account_controller.go`
- Modify:  `app/services/storage/credential_service.go` (utility for encryption/decryption)
- Modify:  `routes/web.go`

- [ ] **Step 1: Write failing feature test** asserting full lifecycle: create account → list → update → delete (soft).
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Write `credential_service.go`** with helpers `EncryptCredentials`, `DecryptCredentials`.
- [ ] **Step 4: Implement `CloudAccountController`** with methods `Index`, `Test`, `Store`, `Show`, `Update`, `Destroy`.
  - All scoped to `user_id` extracted from context.
- [ ] **Step 5: Register routes** under `api/v1/cloud-accounts` with `jwtAuth` middleware.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/cloud_account_controller.go app/services/storage/credential_service.go routes/web.go
git commit -m "feat: implement Cloud Account management API with encryption"
```

---

### Task 8: DriveItem CRUD & Listing API

**Files:**
- Create:  `app/http/controllers/drive_item_controller.go`
- Modify:  `app/services/cloud_drive_service.go` (orchestrator calling `DriverFactory`)
- Modify:  `routes/web.go`

- [ ] **Step 1: Write failing feature test** asserting: create folder → list items in folder → rename item → move item → delete item (soft).
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Write `cloud_drive_service.go`** orchestrating:
  - Resolving driver by account ID.
  - Creating virtual folders locally without hitting S3.
- [ ] **Step 4: Implement `DriveItemController`** with: `Index` (list children), `StoreFolder`, `Show`, `Update` (rename/move), `Star`, `Destroy`.
- [ ] **Step 5: Register routes** under `api/v1/drive/items`.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/drive_item_controller.go app/services/cloud_drive_service.go routes/web.go
git commit -m "feat: implement DriveItem CRUD API and listing"
```

---

### Task 9: Presigned Upload API (Direct-to-S3)

**Files:**
- Modify:  `app/http/controllers/upload_controller.go`
- Modify:  `app/services/cloud_drive_service.go`
- Modify:  `routes/web.go`

- [ ] **Step 1: Write failing feature test** asserting: initiate presigned upload → receive URL → confirm completes item entry.
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Add `InitiatePresignedUpload`, `CompletePresignedUpload` methods** to `cloud_drive_service.go`.
- [ ] **Step 4: Implement endpoints** `POST /upload/presigned`, `POST /upload/presigned/complete`.
  - Validates ownership by `cloud_account_id` and `parent_id`.
  - Generates unique key using UUID + user/account prefix.
- [ ] **Step 5: Register routes**.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/upload_controller.go app/services/cloud_drive_service.go routes/web.go
git commit -m "feat: add presigned upload endpoints for fast direct-to-S3 uploads"
```

---

### Task 10: Chunked/Multipart Server Upload API

**Files:**
- Modify:  `app/http/controllers/upload_controller.go`
- Modify:  `app/services/cloud_drive_service.go`
- Modify:  `app/models/upload_session.go`

- [ ] **Step 1: Write failing feature test** simulating multi-part upload: init → send 3 parts → complete → verify file metadata exists.
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Add multipart orchestration methods** to service.
- [ ] **Step 4: Implement endpoints** `POST /upload/multipart/init`, `POST /upload/multipart/part`, `POST /upload/multipart/complete`, `POST /upload/multipart/abort`.
  - Part handler streams `io.Reader` directly from request body to S3 `UploadPart`.
  - Track `uploaded_parts` in DB after each successful upload.
- [ ] **Step 5: Register routes**.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add app/http/controllers/upload_controller.go app/services/cloud_drive_service.go app/models/upload_session.go
git commit -m "feat: implement chunked/multipart upload API with server-side streaming"
```

---

### Task 11: Download API

**Files:**
- Modify:  `app/http/controllers/upload_controller.go`
- Modify:  `app/services/cloud_drive_service.go`

- [ ] **Step 1: Write failing feature test** asserting: download returns 302 redirect or stream content with correct headers.
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Add `DownloadItem` method** to service handling both `presigned` and `stream` modes.
- [ ] **Step 4: Implement endpoint** `GET /drive/items/{uuid}/download`.
- [ ] **Step 5: Run test → pass**
- [ ] **Step 6: Commit**

```bash
git add app/http/controllers/upload_controller.go app/services/cloud_drive_service.go
git commit -m "feat: implement download endpoint with presigned and streaming modes"
```

---

### Task 12: Bucket Scan/Sync Background Job

**Files:**
- Create:  `app/queue/cloud_sync_job.go`
- Modify:  `bootstrap/queue.go` (if needed)
- Modify:  `app/services/cloud_drive_service.go` (add `ScanBucket` method)
- Modify:  `app/http/controllers/cloud_account_controller.go` (add sync trigger)

- [ ] **Step 1: Write failing feature test** asserting: dispatch sync job → verify new `DriveItem` entries match scanned bucket objects.
- [ ] **Step 2: Run test → fail**
- [ ] **Step 3: Add `ScanBucket(accountID, parentID)` logic** to service. For each paginated batch:
  - Parse object key into virtual folder hierarchy.
  - Upsert `drive_items` records with correct sizes/ETags.
- [ ] **Step 4: Create Queued Job** `CloudSyncJob` wrapping scan logic.
- [ ] **Step 5: Trigger scan** via `POST /cloud-accounts/{id}/sync`.
- [ ] **Step 6: Run test → pass**
- [ ] **Step 7: Commit**

```bash
git add app/queue/cloud_sync_job.go app/services/cloud_drive_service.go app/http/controllers/cloud_account_controller.go
git commit -m "feat: implement bucket scan and sync background job"
```

---

## Summary

This plan breaks down the full backend implementation into 12 tasks, each independently testable and following TDD. Every task delivers working, verified functionality upon completion and builds incrementally atop prior tasks. The order respects architectural dependencies: foundational contracts (Task 1–2) → models/migrations (Task 3, 6) → driver implementation (Task 4, 5) → API surface (Tasks 7–12).
