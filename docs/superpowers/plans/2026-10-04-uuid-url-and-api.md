# UUID URLs and UUID-only API Implementation Plan

> **SUPERSEDED (2026-10-07) for the cloud-account segment.** A later decision
> replaced the account uuid in the external contract with the numeric **id**:
> the drive URL is `/d/<cloudId>`, requests send `cloud_account_id`, and the
> backend accepts only the id. The drive item uuid is unchanged. The steps below
> describe the original uuid design and are kept as a historical record; see the
> supersede note in `docs/superpowers/specs/2026-10-04-uuid-url-and-api-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a hard reload stay on the current drive folder by putting the folder in the URL, and move the external API contract from numeric ids to uuids while keeping numeric ids as internal DB keys.

**Architecture:** Cloud accounts gain a `uuid` (GORM `BeforeCreate` hook + migration backfill). The HTTP boundary translates uuid↔id: controllers resolve incoming uuids to the numeric ids the service layer keeps using, and response builders emit uuids (and `cloud_account_uuid` on items) instead of numeric ids. The frontend's drive URL becomes `/c/<cloudUuid>/f/<folderUuid>`, the URL is the single source of truth for the open folder, and the already-built breadcrumb endpoint rebuilds the ancestor bar on load.

**Tech Stack:** Go 1.25 / Goravel 1.18 (GORM), MariaDB, Vue 3 + Pinia + vue-router 5 + vue-i18n, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-04-uuid-url-and-api-design.md`

## Global Constraints

- External contract uses uuids only; internal DB keys (`cloud_accounts.id`, `drive_items.id`, all foreign keys and joins) stay numeric.
- Service-layer signatures keep `uint` / `*uint`. Translation happens only at the controller boundary.
- `ActivityLog.ToResponse()` is the one exception: it keeps `id` and `cloud_id`; `DashboardService` adds `cloud_account_uuid` to each activity map.
- No `parent_uuid` response field on items (YAGNI — no consumer).
- Old `/drive?cloud=<id>` route is removed, no redirect.
- Internal/driver/DB errors are written only to `storage/logs/goravel-*.log`; clients receive localized messages only (`failResponse`). A uuid that does not resolve is a normal localized 404.
- Log timestamps are UTC. `noUncheckedIndexedAccess` is on in the frontend.
- Backend module `-lang go1.25`: a promoted `Model.ID` cannot appear in a composite struct literal; assign it on its own line.
- Backend and frontend are separate git repos; commit in each.

## Review Focus

- **A request carrying an unknown/foreign uuid** must return the localized not-found error, never a 500 or a raw error string. Every uuid-accepting endpoint gets a test.
- **A cloud account with no uuid** (a row inserted by raw SQL, or read before the hook existed) must not emit a blank `uuid`. `ensureAccountUUID` covers the read path; a test pins it.
- **A reload of a deep folder** (`/c/<cloud>/f/<deep>`) must list that folder's children and render the full ancestor bar — the whole point of the change.
- **Account switching in the sidebar** must change the URL and clear the folder, never carry a stale `parent_uuid` from another account into the list query.
- **Every response** must be free of numeric ids (`id`, `user_id`, `cloud_account_id`, `parent_id`) except the documented activity fields. Response tests assert the absence explicitly.

---

### Task 1: CloudAccount uuid column, model field, and BeforeCreate hook

**Files:**
- Create: `backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go`
- Modify: `backend/app/models/cloud_account.go`
- Test: `backend/tests/feature/cloud_account_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `models.CloudAccount.UUID string` (populated on every `Query().Create(&CloudAccount{...})`); migration signature `20261004000000_add_uuid_to_cloud_accounts`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/feature/cloud_account_test.go` (inside `CloudAccountTestSuite`):

```go
func (s *CloudAccountTestSuite) TestCreateAssignsUUID() {
	account := models.CloudAccount{
		UserID:   s.user.ID,
		Name:     "UUID Account",
		Provider: models.ProviderS3,
		IsActive: true,
	}
	s.Require().NoError(facades.Orm().Query().Create(&account))
	s.NotEmpty(account.UUID, "the BeforeCreate hook must assign a uuid")
	s.Len(account.UUID, 36)

	// A caller-supplied uuid must be preserved, not overwritten.
	explicit := models.CloudAccount{
		UUID:     uuid.New().String(),
		UserID:   s.user.ID,
		Name:     "Explicit UUID",
		Provider: models.ProviderS3,
		IsActive: true,
	}
	want := explicit.UUID
	s.Require().NoError(facades.Orm().Query().Create(&explicit))
	s.Equal(want, explicit.UUID)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/feature/ -run 'TestCloudAccountTestSuite/TestCreateAssignsUUID' -v`
Expected: FAIL — `account.UUID` empty (`""` has length 0).

- [ ] **Step 3: Create the migration**

Create `backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go`:

```go
package migrations

import (
	"github.com/google/uuid"

	"ponta_drive/app/facades"
)

// M20261004000000AddUUIDToCloudAccounts adds the public uuid column to
// `cloud_accounts`. Numeric `id` stays the internal key; `uuid` is what the API
// and the drive URL expose.
//
// Existing rows are backfilled here so no account is served with a blank uuid.
type M20261004000000AddUUIDToCloudAccounts struct{}

// Signature The unique signature for the migration.
func (r *M20261004000000AddUUIDToCloudAccounts) Signature() string {
	return "20261004000000_add_uuid_to_cloud_accounts"
}

// Up Run the migrations.
func (r *M20261004000000AddUUIDToCloudAccounts) Up() error {
	if !facades.Schema().HasTable("cloud_accounts") {
		return nil
	}

	if !facades.Schema().HasColumn("cloud_accounts", "uuid") {
		if err := facades.Schema().Table("cloud_accounts", func(table schema.Blueprint) {
			table.String("uuid", 36).Nullable().After("id")
		}); err != nil {
			return err
		}
	}

	// Backfill: one uuid per existing row.
	var ids []uint
	if err := facades.Orm().Query().Table("cloud_accounts").
		Where("uuid IS NULL OR uuid = ''").
		Pluck("id", &ids); err != nil {
		return err
	}
	for _, id := range ids {
		_, _ = facades.Orm().Query().Table("cloud_accounts").
			Where("id", id).
			Update("uuid", uuid.New().String())
	}

	if !facades.Schema().HasIndex("cloud_accounts", "cloud_accounts_uuid_unique") {
		if err := facades.Schema().Table("cloud_accounts", func(table schema.Blueprint) {
			table.Unique("uuid")
		}); err != nil {
			return err
		}
	}

	return nil
}

// Down Reverse the migrations.
func (r *M20261004000000AddUUIDToCloudAccounts) Down() error {
	return facades.Schema().Table("cloud_accounts", func(table schema.Blueprint) {
		table.DropColumn("uuid")
	})
}
```

Note: the migration imports `github.com/goravel/framework/contracts/database/schema` for the `schema.Blueprint` type — add it to the import block (the code above shows only the two needed for brevity; the real file needs all three). Final import block:

```go
import (
	"github.com/google/uuid"
	"github.com/goravel/framework/contracts/database/schema"

	"ponta_drive/app/facades"
)
```

- [ ] **Step 4: Add the model field and hook**

In `backend/app/models/cloud_account.go`, add to the struct after `orm.Model`:

```go
	// UUID is the public identifier exposed by the API and used in drive URLs.
	// Numeric ID remains the internal key.
	UUID string `gorm:"column:uuid;size:36;uniqueIndex" json:"uuid"`
```

Add the hook and imports (`github.com/google/uuid`, `gorm.io/gorm`) at the end of the file:

```go
// BeforeCreate assigns a uuid when none was supplied. GORM fires this on every
// create through Goravel's Query().Create(), so the controller, future code and
// test fixtures all get a uuid without repeating the assignment.
func (c *CloudAccount) BeforeCreate(tx *gorm.DB) error {
	if c.UUID == "" {
		c.UUID = uuid.New().String()
	}
	return nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go mod tidy && go test ./tests/feature/ -run 'TestCloudAccountTestSuite/TestCreateAssignsUUID' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add database/migrations/20261004000000_add_uuid_to_cloud_accounts.go app/models/cloud_account.go tests/feature/cloud_account_test.go go.mod go.sum
git commit -m "feat(cloud): add uuid to cloud accounts with a BeforeCreate hook"
```

---

### Task 2: CloudAccount.ToResponse emits uuid, drops numeric id

**Files:**
- Modify: `backend/app/models/cloud_account.go` (`ToResponse`)
- Modify: `backend/tests/integration/cloud_account_response_test.go`
- Modify: `backend/tests/feature/cloud_account_test.go` (assertion at line ~104)

**Interfaces:**
- Consumes: `models.CloudAccount.UUID` (Task 1).
- Produces: `CloudAccount.ToResponse()` returning `uuid` and no `id`/`user_id`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/integration/cloud_account_response_test.go`:

```go
func TestCloudAccountToResponseExposesUUIDNotID(t *testing.T) {
	account := models.CloudAccount{
		UUID:       "11111111-1111-1111-1111-111111111111",
		UserID:     10,
		Name:       "Primary S3",
		Provider:   models.ProviderS3,
		SyncStatus: "idle",
	}

	resp := account.ToResponse()

	assert.Equal(t, "11111111-1111-1111-1111-111111111111", resp["uuid"])
	assert.NotContains(t, resp, "id", "numeric id must not be exposed")
	assert.NotContains(t, resp, "user_id", "user_id must not be exposed")
}

// A row that slipped past the migration/hook (raw SQL insert, or created before
// the column existed) must still serialize a usable uuid rather than a blank
// string, which would break every URL built from it.
func TestCloudAccountToResponseHealsBlankUUID(t *testing.T) {
	account := models.CloudAccount{
		UserID:   10,
		Name:     "Legacy S3",
		Provider: models.ProviderS3,
	}

	resp := account.ToResponse()

	uuid, _ := resp["uuid"].(string)
	assert.Len(t, uuid, 36, "a blank uuid must be replaced on read")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/integration/ -run 'TestCloudAccountToResponse' -v`
Expected: FAIL — `resp["uuid"]` is nil/empty and `id`/`user_id` are present.

- [ ] **Step 3: Update ToResponse and add the read-path guard**

In `backend/app/models/cloud_account.go`, add the guard at the top of `ToResponse()` (before building the map), and add the `uuid` import:

```go
// ToResponse returns a sanitized map representation for API responses, masking SecretAccessKey.
func (c *CloudAccount) ToResponse() map[string]any {
	ensureAccountUUID(c)
	// ... existing body ...
}
```

```go
// ensureAccountUUID assigns a uuid in memory when a row carries none, so a
// response never exposes a blank identifier. It does not write: a GET must not
// mutate the database. The migration backfill and the BeforeCreate hook are the
// real fixes; this only covers rows that predate or bypassed them.
func ensureAccountUUID(c *CloudAccount) {
	if c.UUID == "" {
		c.UUID = uuid.New().String()
	}
}
```

Add `"github.com/google/uuid"` to the model's import block.

Then replace the `id` and `user_id` entries in the returned map:

```go
	return map[string]any{
		"uuid":           c.UUID,
		"name":           c.Name,
		"provider":       c.Provider,
		"credentials":    safeCreds,
		"is_default":     c.IsDefault,
		"is_active":      c.IsActive,
		"sync_status":    c.SyncStatus,
		"last_synced_at": lastSynced,
		"total_storage":  c.TotalStorage,
		"used_storage":   c.UsedStorage,
		"created_at":     c.CreatedAt,
		"updated_at":     c.UpdatedAt,
	}
```

- [ ] **Step 4: Fix the existing assertion**

In `backend/tests/feature/cloud_account_test.go` around line 104, replace:

```go
	s.Equal(fetched.ID, resp["id"])
```

with:

```go
	s.Equal(fetched.UUID, resp["uuid"])
```

- [ ] **Step 5: Run the affected tests**

Run: `cd backend && go test ./tests/integration/ ./tests/feature/ -run 'CloudAccount' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/models/cloud_account.go tests/integration/cloud_account_response_test.go tests/feature/cloud_account_test.go
git commit -m "feat(cloud): expose uuid instead of numeric id in account responses"
```

---

### Task 3: Cloud account routes and lookups by uuid

**Files:**
- Modify: `backend/routes/web.go` (lines 56-64)
- Modify: `backend/app/http/controllers/cloud_account_controller.go`
- Modify: `backend/lang/en/drive.json`, `backend/lang/vi/drive.json`
- Test: `backend/tests/feature/cloud_account_api_test.go`, `backend/tests/feature/bucket_sync_test.go`

**Interfaces:**
- Consumes: `CloudAccount.UUID` (Task 1), `ToResponse()` with uuid (Task 2).
- Produces: `CloudAccountController` route param `{uuid}`; helper `func (c *CloudAccountController) findAccountByUUID(ctx http.Context, userID uint) (*models.CloudAccount, http.Response)` used by Show/Update/Destroy/Sync.

- [ ] **Step 1: Write the failing test**

In `backend/tests/feature/cloud_account_api_test.go`, change the lifecycle test to use the returned uuid instead of the numeric id. Replace line 95:

```go
	accountID := uint(accountData["id"].(float64))
```

with:

```go
	accountUUID := accountData["uuid"].(string)
	s.NotEmpty(accountUUID)
	s.NotContains(accountData, "id", "no numeric id may be exposed")
```

and replace the three route usages (lines 117, 130, 140) to use `accountUUID`:

```go
	showResp, err := s.Http(s.T()).WithToken(s.token).Get(fmt.Sprintf("/v1/cloud-accounts/%s", accountUUID))
```

```go
	updateResp, err := s.Http(s.T()).WithToken(s.token).Put(fmt.Sprintf("/v1/cloud-accounts/%s", accountUUID), bytes.NewBuffer(updatePayload))
```

```go
	deleteResp, err := s.Http(s.T()).WithToken(s.token).Delete(fmt.Sprintf("/v1/cloud-accounts/%s", accountUUID), nil)
```

`backend/tests/feature/bucket_sync_test.go` also hits these routes with the numeric id. Two sync calls (lines 124 and 186) become:

```go
	syncResp, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%s/sync", s.account.UUID), nil)
```

```go
	syncResp2, err := s.Http(s.T()).WithToken(s.token).Post(fmt.Sprintf("/v1/cloud-accounts/%s/sync", s.account.UUID), nil)
```

and `TestCreateAccountAutoSyncs` (line 222) reads the id from the create response; switch it to the uuid, then look the account up by uuid (line 236) since the response no longer carries a numeric id:

```go
	accountUUID := body["data"].(map[string]any)["uuid"].(string)
	s.NotEmpty(accountUUID)
```

```go
	var account models.CloudAccount
	err = facades.Orm().Query().Where("uuid", accountUUID).First(&account)
	s.Require().NoError(err)
	s.Equal("idle", account.SyncStatus)
	s.NotNil(account.LastSyncedAt)
```

and the `items` query below it uses the resolved numeric key from that account:

```go
	var items []models.DriveItem
	err = facades.Orm().Query().
		Where("user_id", s.user.ID).
		Where("cloud_account_id", account.ID).
		Find(&items)
```

Add a new test for the unknown-uuid path:

```go
func (s *CloudAccountAPITestSuite) TestShowUnknownUUIDDoesNotLeak() {
	resp, err := s.Http(s.T()).WithToken(s.token).Get("/v1/cloud-accounts/00000000-0000-0000-0000-000000000000")
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusNotFound)

	body, err := resp.Json()
	s.Require().NoError(err)
	message, _ := body["message"].(string)
	s.NotEmpty(message)
	s.NotContains(message, "not found", "internal text must not be echoed")
	s.NotContains(message, "cloud.not_found", "the translation key must resolve")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/feature/ -run 'TestCloudAccountAPITestSuite' -v`
Expected: FAIL — routes still use `{id}` and `RouteInt`, so a uuid path yields 400/404 mismatch.

- [ ] **Step 3: Update routes**

In `backend/routes/web.go`, change the cloud-accounts group:

```go
			v1.Prefix("cloud-accounts").Group(func(ca route.Router) {
				ca.Get("", cloudAccountController.Index)
				ca.Post("", cloudAccountController.Store)
				ca.Post("/test", cloudAccountController.Test)
				ca.Get("/{uuid}", cloudAccountController.Show)
				ca.Put("/{uuid}", cloudAccountController.Update)
				ca.Delete("/{uuid}", cloudAccountController.Destroy)
				ca.Post("/{uuid}/sync", cloudAccountController.Sync)
			})
```

- [ ] **Step 4: Add the lookup helper and update the four handlers**

In `backend/app/http/controllers/cloud_account_controller.go`, add:

```go
// findAccountByUUID resolves the route's uuid to an account owned by the user.
// On failure it returns the error response the caller must return: the Gin
// adapter only renders the response a handler returns, so building a response
// and returning nil would send an empty 200. The underlying error is never
// surfaced (see failResponse).
func (c *CloudAccountController) findAccountByUUID(ctx http.Context, userID uint) (*models.CloudAccount, http.Response) {
	accountUUID := ctx.Request().Route("uuid")
	if accountUUID == "" {
		return nil, failResponse(ctx, http.StatusBadRequest, "common.invalid_account_id", nil)
	}

	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("uuid", accountUUID).
		Where("user_id", userID).
		First(&account)
	if err != nil || account.ID == 0 {
		return nil, failResponse(ctx, http.StatusNotFound, "cloud.not_found", err)
	}

	return &account, nil
}
```

Replace the lookup block in `Show`, `Update`, `Destroy`, and `Sync`. For each, delete:

```go
	id := ctx.Request().RouteInt("id")
	if id <= 0 {
		return failResponse(ctx, http.StatusBadRequest, "common.invalid_account_id", nil)
	}

	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("id", id).
		Where("user_id", user.ID).
		First(&account)
	if err != nil || account.ID == 0 {
		return failResponse(ctx, http.StatusNotFound, "cloud.not_found", err)
	}
```

and put in its place:

```go
	account, errResp := c.findAccountByUUID(ctx, user.ID)
	if errResp != nil {
		return errResp
	}
```

Then fix the references: `Show`/`Update` use `account.ToResponse()`; `Update` uses `facades.Orm().Query().Save(account)` and `c.factory.InvalidateCache(account.ID)`; `Destroy` uses `facades.Orm().Query().Delete(account)` and `c.factory.InvalidateCache(account.ID)`; `Sync` calls `c.dispatchSync(ctx, user.ID, account, parentID)`.

Note: `Sync` reads `parent_id` from the query and parses it with `strconv`; change that block to read `parent_uuid` and resolve it with a uuid lookup:

```go
	var parentID *uint
	if parentUUID := ctx.Request().Query("parent_uuid"); parentUUID != "" {
		var parent models.DriveItem
		if err := facades.Orm().Query().
			Where("uuid", parentUUID).
			Where("user_id", user.ID).
			First(&parent); err == nil && parent.ID > 0 {
			pid := parent.ID
			parentID = &pid
		}
	}
```

That was `strconv`'s only use in this file: remove the now-unused `"strconv"` import or the package fails to build.

Also update the two lang files so the missing-account message no longer names the numeric key. In `backend/lang/en/drive.json` change `"cloud_account_required": "cloud_account_id is required"` to `"cloud_account_required": "A cloud account is required"`; in `backend/lang/vi/drive.json` change `"cloud_account_required": "cloud_account_id là bắt buộc"` to `"cloud_account_required": "Vui lòng chọn một tài khoản đám mây"`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && go test ./tests/feature/ -run 'TestCloudAccountAPITestSuite' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add routes/web.go app/http/controllers/cloud_account_controller.go lang/en/drive.json lang/vi/drive.json tests/feature/cloud_account_api_test.go tests/feature/bucket_sync_test.go
git commit -m "feat(cloud): address cloud accounts by uuid in routes"
```

---

### Task 4: DriveItem.ToResponse emits uuids, drops numeric ids

**Files:**
- Modify: `backend/app/models/drive_item.go` (`ToResponse`)
- Test: `backend/app/models/` — add `backend/tests/integration/drive_item_response_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DriveItem.ToResponse()` returning `uuid`, `cloud_account_uuid` and no `id`/`user_id`/`cloud_account_id`/`parent_id`. `cloud_account_uuid` is set by the caller (see Task 5) — `ToResponse` itself cannot know it, so it reads an optional field.

Because `ToResponse` has no access to the account, add a transient (non-persisted) field to carry the resolved uuid:

In `backend/app/models/drive_item.go`, add to the struct:

```go
	// CloudAccountUUID is filled by the controller/dashboard before serializing
	// so the response carries the public account uuid instead of the numeric id.
	// Not persisted.
	CloudAccountUUID string `gorm:"-" json:"-"`
```

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/drive_item_response_test.go`:

```go
package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"ponta_drive/app/models"
	_ "ponta_drive/tests"
)

func TestDriveItemToResponseExposesUUIDsNotIDs(t *testing.T) {
	item := models.DriveItem{
		UUID:             "22222222-2222-2222-2222-222222222222",
		UserID:           7,
		CloudAccountID:   3,
		Name:             "report.pdf",
		Type:             models.ItemTypeFile,
		Status:           models.ItemStatusReady,
		CloudAccountUUID: "11111111-1111-1111-1111-111111111111",
	}

	resp := item.ToResponse()

	assert.Equal(t, "22222222-2222-2222-2222-222222222222", resp["uuid"])
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", resp["cloud_account_uuid"])
	assert.NotContains(t, resp, "id")
	assert.NotContains(t, resp, "user_id")
	assert.NotContains(t, resp, "cloud_account_id")
	assert.NotContains(t, resp, "parent_id")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/integration/ -run TestDriveItemToResponseExposesUUIDsNotIDs -v`
Expected: FAIL — `id`, `user_id`, `cloud_account_id`, `parent_id` are present; `cloud_account_uuid` absent.

- [ ] **Step 3: Update ToResponse**

Replace the body of `ToResponse` in `backend/app/models/drive_item.go`:

```go
func (d *DriveItem) ToResponse() map[string]any {
	return map[string]any{
		"uuid":               d.UUID,
		"cloud_account_uuid": d.CloudAccountUUID,
		"name":               d.Name,
		"type":               d.Type,
		"mime_type":          d.MimeType,
		"size":               d.Size,
		"extension":          d.Extension,
		"storage_path":       d.StoragePath,
		"etag":               d.ETag,
		"is_starred":         d.IsStarred,
		"status":             d.Status,
		"created_at":         d.CreatedAt,
		"updated_at":         d.UpdatedAt,
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./tests/integration/ -run TestDriveItemToResponseExposesUUIDsNotIDs -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/models/drive_item.go tests/integration/drive_item_response_test.go
git commit -m "feat(drive): expose uuids instead of numeric ids in item responses"
```

---

### Task 5: Drive requests, controller resolution, and cloud_account_uuid fill

**Files:**
- Modify: `backend/app/http/requests/drive_item_request.go`
- Modify: `backend/app/http/controllers/drive_item_controller.go`
- Modify: `backend/app/services/cloud_drive_service.go` (add `ResolveCloudAccountID`)
- Test: `backend/tests/feature/drive_item_api_test.go`, `backend/tests/feature/drive_pagination_test.go`

**Interfaces:**
- Consumes: `DriveItem.CloudAccountUUID` (Task 4), `CloudAccount.UUID` (Task 1).
- Produces:
  - `CloudDriveService.ResolveCloudAccountID(ctx context.Context, userID uint, accountUUID string) (uint, error)`
  - `CloudDriveService.ResolveDriveItemID(ctx context.Context, userID uint, itemUUID string) (uint, error)`
  - Requests `CreateFolderRequest{CloudAccountUUID string; ParentUUID string; Name string}` and `UpdateDriveItemRequest{Name string; ParentUUID string}`.
  - Controller helper `func fillAccountUUID(accountUUID string, items ...*models.DriveItem)` and `func (c *DriveItemController) accountUUIDFor(ctx context.Context, item *models.DriveItem) string`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/feature/drive_item_api_test.go`, update the lifecycle test to use uuids. Replace the folder-creation payload and the list calls. Change the create payload (line ~86) to:

```go
	createFolderPayload, _ := json.Marshal(map[string]any{
		"cloud_account_uuid": s.account.UUID,
		"name":               "Work Documents",
	})
```

After decoding `folderData`, read the uuid instead of the id:

```go
	folderUUID := folderData["uuid"].(string)
	s.NotEmpty(folderUUID)
	s.NotContains(folderData, "id", "no numeric id may be exposed")
```

The list call (line ~104) becomes:

```go
	listResp, err := s.Http(s.T()).WithToken(s.token).Get(fmt.Sprintf("/v1/drive/items?cloud_account_uuid=%s", s.account.UUID))
```

The child create payload (line ~114) becomes:

```go
	childFolderPayload, _ := json.Marshal(map[string]any{
		"cloud_account_uuid": s.account.UUID,
		"parent_uuid":        folderUUID,
		"name":               "Sub Projects",
	})
```

The nested list call (line ~127) becomes:

```go
	folderItemsResp, err := s.Http(s.T()).WithToken(s.token).Get(fmt.Sprintf("/v1/drive/items?cloud_account_uuid=%s&parent_uuid=%s", s.account.UUID, folderUUID))
```

Update the `createFolder` helper (line ~257) to send uuids:

```go
func (s *DriveItemAPITestSuite) createFolder(name string, parentUUID *string) models.DriveItem {
	payload := map[string]any{
		"cloud_account_uuid": s.account.UUID,
		"name":               name,
	}
	if parentUUID != nil {
		payload["parent_uuid"] = *parentUUID
	}
	raw, _ := json.Marshal(payload)

	resp, err := s.Http(s.T()).WithToken(s.token).Post("/v1/drive/items/folders", bytes.NewBuffer(raw))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusCreated)

	body, err := resp.Json()
	s.Require().NoError(err)
	data := body["data"].(map[string]any)

	var item models.DriveItem
	item.UUID = data["uuid"].(string)
	item.Name = data["name"].(string)
	return item
}
```

Update the breadcrumb test (`TestBreadcrumb`) to use uuids:

```go
	work := s.createFolder("Work", nil)
	sub := s.createFolder("Sub", &work.UUID)
	deep := s.createFolder("Deep", &sub.UUID)
```

and the parent assertion:

```go
	s.NotContains(chain[0].(map[string]any), "parent_id")
```

Also set the account uuid in `SetupTest` after creating the account (the hook fills it, but be explicit for readability):

```go
	s.Require().NotEmpty(s.account.UUID)
```

Add a test asserting items carry the account uuid:

```go
func (s *DriveItemAPITestSuite) TestListItemsCarryCloudAccountUUID() {
	s.createFolder("Work", nil)

	resp, err := s.Http(s.T()).WithToken(s.token).Get(fmt.Sprintf("/v1/drive/items?cloud_account_uuid=%s", s.account.UUID))
	s.Require().NoError(err)
	resp.AssertOk()

	body, err := resp.Json()
	s.Require().NoError(err)
	items := body["data"].([]any)
	s.Require().NotEmpty(items)
	first := items[0].(map[string]any)
	s.Equal(s.account.UUID, first["cloud_account_uuid"])
	s.NotContains(first, "cloud_account_id")
}
```

`backend/tests/feature/drive_pagination_test.go` lists by the numeric key in two places. Change `listPage` (line ~192) and `TestInvalidCursorIsRejected` (line ~326):

```go
		Get(fmt.Sprintf("/v1/drive/items?cloud_account_uuid=%s%s", s.account.UUID, query))
```

```go
		Get(fmt.Sprintf("/v1/drive/items?cloud_account_uuid=%s&cursor=!!", s.account.UUID))
```

The composite-index assertion (line ~405) reads `information_schema` column names (`user_id`, `cloud_account_id`, `parent_id`, ...) and is unaffected: those are internal DB columns, not API fields.

The existing leak test `TestCreateFolderErrorDoesNotLeakInternalDetail` (line ~178) posts `"cloud_account_id": 999999999`. Change the payload to an unknown uuid so it still exercises the failure path:

```go
	payload, _ := json.Marshal(map[string]any{
		"cloud_account_uuid": "00000000-0000-0000-0000-000000000000",
		"name":               "Leaky Folder",
	})
```

The `"invalid cloud account"` assertion in that test still holds: `ResolveCloudAccountID` returns that same error text, which the controller logs but never echoes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite' -v`
Expected: FAIL — the request still validates `cloud_account_id`; the uuid payload fails validation.

- [ ] **Step 3: Add the service resolver**

In `backend/app/services/cloud_drive_service.go`, add after `GetDriver`:

```go
// ResolveCloudAccountID maps a public account uuid to the numeric id the rest of
// the service uses. The API speaks uuid; internal queries keep using id.
func (s *CloudDriveService) ResolveCloudAccountID(ctx context.Context, userID uint, accountUUID string) (uint, error) {
	if accountUUID == "" {
		return 0, errors.New("cloud account uuid is required")
	}

	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("uuid", accountUUID).
		Where("user_id", userID).
		First(&account)
	if err != nil || account.ID == 0 {
		return 0, errors.New("cloud account not found or access denied")
	}

	return account.ID, nil
}

// ResolveDriveItemID maps a public item uuid to its numeric id, scoped to the
// user and (when non-empty) the owning account.
func (s *CloudDriveService) ResolveDriveItemID(ctx context.Context, userID uint, itemUUID string) (uint, error) {
	if itemUUID == "" {
		return 0, errors.New("item uuid is required")
	}

	var item models.DriveItem
	err := facades.Orm().Query().
		Where("uuid", itemUUID).
		Where("user_id", userID).
		First(&item)
	if err != nil || item.ID == 0 {
		return 0, errors.New("item not found")
	}

	return item.ID, nil
}
```

- [ ] **Step 4: Update the request DTOs**

In `backend/app/http/requests/drive_item_request.go`, change:

```go
type CreateFolderRequest struct {
	CloudAccountUUID string `form:"cloud_account_uuid" json:"cloud_account_uuid"`
	ParentUUID       string `form:"parent_uuid" json:"parent_uuid"`
	Name             string `form:"name" json:"name"`
}
```

Rules:

```go
	return map[string]any{
		"cloud_account_uuid": "required",
		"name":               "required|max_len:255",
	}
```

Attributes: `return attributes(ctx, "cloud_account_uuid", "name")`.

And:

```go
type UpdateDriveItemRequest struct {
	Name       string `form:"name" json:"name"`
	ParentUUID string `form:"parent_uuid" json:"parent_uuid"`
}
```

- [ ] **Step 5: Update the controller**

In `backend/app/http/controllers/drive_item_controller.go`:

Add a helper:

```go
// fillAccountUUID sets each item's public account uuid from a resolved value so
// ToResponse emits it instead of the numeric cloud_account_id.
func fillAccountUUID(accountUUID string, items ...*models.DriveItem) {
	for _, item := range items {
		item.CloudAccountUUID = accountUUID
	}
}
```

In `Index`, replace the numeric account parse:

```go
	cloudAccountUUID := ctx.Request().Query("cloud_account_uuid")
	if cloudAccountUUID == "" {
		var defaultAcc models.CloudAccount
		_ = facades.Orm().Query().
			Where("user_id", user.ID).
			Where("is_default", true).
			First(&defaultAcc)
		if defaultAcc.ID > 0 {
			cloudAccountUUID = defaultAcc.UUID
		} else {
			return ctx.Response().Json(http.StatusBadRequest, http.Json{
				"status":  "error",
				"message": facades.Lang(ctx).Get("drive.cloud_account_required"),
			})
		}
	}

	cloudAccountID, err := c.service.ResolveCloudAccountID(context.Background(), user.ID, cloudAccountUUID)
	if err != nil {
		return failResponse(ctx, http.StatusNotFound, "drive.cloud_account_required", err)
	}
```

Replace the parent parse:

```go
	var parentID *uint
	if parentUUID := ctx.Request().Query("parent_uuid"); parentUUID != "" {
		pid, err := c.service.ResolveDriveItemID(context.Background(), user.ID, parentUUID)
		if err != nil {
			return failResponse(ctx, http.StatusNotFound, "drive.item_not_found", err)
		}
		parentID = &pid
	}
```

After building `data`, fill the account uuid on every item:

```go
	data := make([]map[string]any, 0, len(items))
	for i := range items {
		fillAccountUUID(cloudAccountUUID, &items[i])
		data = append(data, items[i].ToResponse())
	}
```

In `StoreFolder`, resolve both uuids before calling the service:

```go
	cloudAccountID, err := c.service.ResolveCloudAccountID(context.Background(), user.ID, req.CloudAccountUUID)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.create_failed", err)
	}

	var parentID *uint
	if req.ParentUUID != "" {
		pid, err := c.service.ResolveDriveItemID(context.Background(), user.ID, req.ParentUUID)
		if err != nil {
			return failResponse(ctx, http.StatusBadRequest, "drive.create_failed", err)
		}
		parentID = &pid
	}

	folder, err := c.service.CreateFolder(context.Background(), user.ID, cloudAccountID, parentID, req.Name)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "drive.create_failed", err)
	}

	fillAccountUUID(req.CloudAccountUUID, folder)
```

In `Show`, `Update`, `Star`, `Destroy`, `Download`, fill the account uuid on the returned item. Add a small resolver that loads the account uuid for one item:

```go
// accountUUIDFor returns the public uuid of the account owning the item. It is
// best-effort: an item whose account cannot be read still serializes (with an
// empty account uuid) rather than failing the whole response.
func (c *DriveItemController) accountUUIDFor(ctx context.Context, item *models.DriveItem) string {
	var account models.CloudAccount
	if err := facades.Orm().Query().Where("id", item.CloudAccountID).First(&account); err != nil {
		return ""
	}
	return account.UUID
}
```

Then, e.g. in `Show`:

```go
	item, err := c.service.GetItemByUUID(context.Background(), user.ID, itemUUID)
	if err != nil {
		return failResponse(ctx, http.StatusNotFound, "drive.item_not_found", err)
	}
	item.CloudAccountUUID = c.accountUUIDFor(context.Background(), item)

	return ctx.Response().Success().Json(http.Json{
		"status": "ok",
		"data":   item.ToResponse(),
	})
```

Apply the same one-line fill before each `ToResponse()` in `Update`, `Star`, `Destroy` (the `item` used for activity logging), `Download` (`item` in both the stream and redirect branches), and in `Breadcrumb` (loop over `chain`).

- [ ] **Step 6: Run the tests**

Run: `cd backend && go test ./tests/feature/ -run 'TestDriveItemAPITestSuite' -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/services/cloud_drive_service.go app/http/requests/drive_item_request.go app/http/controllers/drive_item_controller.go tests/feature/drive_item_api_test.go tests/feature/drive_pagination_test.go
git commit -m "feat(drive): accept and emit uuids for drive item endpoints"
```

---

### Task 6: Upload requests and controller resolve uuids

**Files:**
- Modify: `backend/app/http/requests/upload_request.go`
- Modify: `backend/app/http/controllers/upload_controller.go`
- Test: `backend/tests/feature/presigned_upload_test.go`, `backend/tests/feature/multipart_upload_test.go`

**Interfaces:**
- Consumes: `ResolveCloudAccountID`, `ResolveDriveItemID` (Task 5), `DriveItem.CloudAccountUUID` (Task 4).
- Produces: `PresignedUploadRequest{CloudAccountUUID, ParentUUID, ...}` and `InitMultipartUploadRequest{CloudAccountUUID, ParentUUID, ...}`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/feature/presigned_upload_test.go`, the happy-path payload is `initPayload` (line ~108) in `TestPresignedUploadFlow`. Change it to:

```go
	initPayload, _ := json.Marshal(map[string]any{
		"cloud_account_uuid": s.account.UUID,
		"file_name":          "tutorial.mp4",
		"size":               1048576,
		"mime_type":          "video/mp4",
	})
```

and after `data := initBody["data"].(map[string]any)` assert the nested item carries the account uuid:

```go
	s.Equal(s.account.UUID, data["item"].(map[string]any)["cloud_account_uuid"])
```

The two negative cases `TestInitiatePresignedErrorDoesNotLeakInternalDetail` (line ~165) and `TestInitiatePresignedErrorResolvesEnglishMessage` (line ~194) post `"cloud_account_id": 999999999`; change each key to `"cloud_account_uuid"` with an unknown value:

```go
		"cloud_account_uuid": "00000000-0000-0000-0000-000000000000",
```

In `backend/tests/feature/multipart_upload_test.go`, do the same for `TestMultipartUploadFullCycle` (line ~150) and `TestMultipartUploadAbort` (line ~228): change `"cloud_account_id": s.account.ID` to `"cloud_account_uuid": s.account.UUID`. (Multipart init returns a session payload, not an item, so there is no nested item to assert.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/feature/ -run 'Upload' -v`
Expected: FAIL — the request still validates `cloud_account_id`.

- [ ] **Step 3: Update the request DTOs**

In `backend/app/http/requests/upload_request.go`, change the two structs:

```go
type PresignedUploadRequest struct {
	CloudAccountUUID string `form:"cloud_account_uuid" json:"cloud_account_uuid"`
	ParentUUID       string `form:"parent_uuid" json:"parent_uuid"`
	FileName         string `form:"file_name" json:"file_name"`
	Size             int64  `form:"size" json:"size"`
	MimeType         string `form:"mime_type" json:"mime_type"`
}
```

Rules: replace `"cloud_account_id": "required"` with `"cloud_account_uuid": "required"`; Attributes: `attributes(ctx, "cloud_account_uuid", "file_name", "size")`.

```go
type InitMultipartUploadRequest struct {
	CloudAccountUUID string `form:"cloud_account_uuid" json:"cloud_account_uuid"`
	ParentUUID       string `form:"parent_uuid" json:"parent_uuid"`
	FileName         string `form:"file_name" json:"file_name"`
	Size             int64  `form:"size" json:"size"`
	MimeType         string `form:"mime_type" json:"mime_type"`
	ChunkSize        int64  `form:"chunk_size" json:"chunk_size"`
}
```

Same rules/attributes change.

- [ ] **Step 4: Update the controller**

In `backend/app/http/controllers/upload_controller.go`, in `InitiatePresigned`:

```go
	cloudAccountID, err := c.driveService.ResolveCloudAccountID(context.Background(), user.ID, req.CloudAccountUUID)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "upload.initiate_failed", err)
	}

	var parentID *uint
	if req.ParentUUID != "" {
		pid, err := c.driveService.ResolveDriveItemID(context.Background(), user.ID, req.ParentUUID)
		if err != nil {
			return failResponse(ctx, http.StatusBadRequest, "upload.initiate_failed", err)
		}
		parentID = &pid
	}

	item, presignedResp, err := c.driveService.InitiatePresignedUpload(
		context.Background(), user.ID, cloudAccountID, parentID,
		req.FileName, req.Size, req.MimeType,
	)
	if err != nil {
		return failResponse(ctx, http.StatusBadRequest, "upload.initiate_failed", err)
	}

	item.CloudAccountUUID = req.CloudAccountUUID
```

Do the same resolution in `InitMultipart`, then set `session`'s account uuid is not needed (session response carries no account id). For `CompletePresigned` and `CompleteMultipart`, the returned `item` needs `CloudAccountUUID`; add a helper mirroring the drive controller:

```go
// accountUUIDFor resolves the public account uuid for an item, best-effort.
func (c *UploadController) accountUUIDFor(item *models.DriveItem) string {
	var account models.CloudAccount
	if err := facades.Orm().Query().Where("id", item.CloudAccountID).First(&account); err != nil {
		return ""
	}
	return account.UUID
}
```

and set `item.CloudAccountUUID = c.accountUUIDFor(item)` before each `item.ToResponse()` in `CompletePresigned` and `CompleteMultipart`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && go test ./tests/feature/ -run 'Upload' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/http/requests/upload_request.go app/http/controllers/upload_controller.go tests/feature/presigned_upload_test.go tests/feature/multipart_upload_test.go
git commit -m "feat(upload): accept uuids for cloud account and parent"
```

---

### Task 7: Dashboard payload exposes uuids

**Files:**
- Modify: `backend/app/services/dashboard_service.go`
- Test: `backend/tests/integration/dashboard_service_test.go`

**Interfaces:**
- Consumes: `CloudAccount.ToResponse()` (Task 2), `DriveItem.CloudAccountUUID` (Task 4).
- Produces: `GetSummary` clouds without numeric ids, suggested files with `cloud_account_uuid`, activities with an added `cloud_account_uuid` alongside `cloud_id`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/integration/dashboard_service_test.go`:

```go
func TestDashboardSummaryExposesUUIDs(t *testing.T) {
	f := seedDashboardFixture(t)

	summary, err := services.NewDashboardService().GetSummary(context.Background(), f.user.ID)
	require.NoError(t, err)

	require.NotEmpty(t, summary.Clouds)
	assert.Contains(t, summary.Clouds[0], "uuid")
	assert.NotContains(t, summary.Clouds[0], "id")

	for _, file := range summary.SuggestedFiles {
		assert.Contains(t, file, "cloud_account_uuid")
		assert.NotContains(t, file, "cloud_account_id")
	}

	for _, act := range summary.RecentActivities {
		assert.Contains(t, act, "cloud_account_uuid", "activity keeps cloud_id and gains the uuid")
		assert.Equal(t, f.cloudA.UUID, act["cloud_account_uuid"])
	}
}
```

(`seedDashboardFixture(t)` already exists in this file and creates `f.user` and `f.cloudA`; the account hook from Task 1 fills `f.cloudA.UUID`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/integration/ -run TestDashboardSummaryExposesUUIDs -v`
Expected: FAIL — clouds still carry `id`; items carry `cloud_account_id`; activities lack `cloud_account_uuid`.

- [ ] **Step 3: Update GetSummary**

In `backend/app/services/dashboard_service.go`, build an id→uuid map while iterating accounts and use it for both suggested files and activities:

```go
	clouds := make([]map[string]any, 0, len(accounts))
	accountUUID := make(map[uint]string, len(accounts))
	var totalUsed, totalCapacity int64

	for _, acc := range accounts {
		clouds = append(clouds, acc.ToResponse())
		accountUUID[acc.ID] = acc.UUID
		totalUsed += acc.UsedStorage
		totalCapacity += acc.TotalStorage
	}
```

In `getSuggestedFiles`, accept the map and fill each item:

```go
func (s *DashboardService) getSuggestedFiles(ctx context.Context, userID uint, accountUUID map[uint]string) ([]map[string]any, error) {
```

and at the end:

```go
	result := make([]map[string]any, 0, len(items))
	for i := range items {
		items[i].CloudAccountUUID = accountUUID[items[i].CloudAccountID]
		result = append(result, items[i].ToResponse())
	}
	return result, nil
```

Update the call site: `s.getSuggestedFiles(ctx, userID, accountUUID)`.

For activities, after `a.ToResponse()`, add the uuid:

```go
	actData := make([]map[string]any, 0, len(activities))
	for _, a := range activities {
		row := a.ToResponse()
		if a.CloudAccountID != nil {
			row["cloud_account_uuid"] = accountUUID[*a.CloudAccountID]
		} else {
			row["cloud_account_uuid"] = nil
		}
		actData = append(actData, row)
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./tests/integration/ -run 'Dashboard' -v`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && go vet ./... && go test ./tests/... -v`
Expected: PASS. Fix any fixture that still sends `cloud_account_id` / `parent_id` in a request or asserts a numeric `id` in a response.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/services/dashboard_service.go tests/integration/dashboard_service_test.go
git commit -m "feat(dashboard): expose uuids in the summary payload"
```

---

### Task 8: Frontend API types and clients use uuids

**Files:**
- Modify: `frontend/src/api/cloudAccounts.ts`
- Modify: `frontend/src/api/driveItems.ts`
- Modify: `frontend/src/api/dashboard.ts`
- Test: `frontend/src/stores/__tests__/driveItems.spec.ts` (query builder), `frontend/src/stores/__tests__/cloudAccounts.spec.ts`

**Interfaces:**
- Consumes: backend uuid contract (Tasks 2-7).
- Produces: `CloudAccount.uuid: string` (no `id`); `DriveItem.uuid`, `cloud_account_uuid` (no `id`/`cloud_account_id`/`parent_id`); `DriveListParams{cloudAccountUuid: string; parentUuid?: string | null}`; `Activity.cloud_account_uuid`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/stores/__tests__/driveItems.spec.ts`, replace the `buildDriveItemsQuery` block:

```ts
describe('buildDriveItemsQuery', () => {
  it('sends the account and parent uuids', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountUuid: 'acc-uuid',
      parentUuid: 'folder-uuid',
    })

    expect(query).toContain('cloud_account_uuid=acc-uuid')
    expect(query).toContain('parent_uuid=folder-uuid')
    expect(query).not.toContain('cloud_account_id')
  })

  it('omits the parent at the account root', () => {
    const query = api.buildDriveItemsQuery({ cloudAccountUuid: 'acc-uuid' })
    expect(query).not.toContain('parent_uuid')
  })
})
```

Update the `item()` factory in that file to the new shape:

```ts
function item(uuid: string, name = uuid): DriveItem {
  return {
    uuid,
    name,
    type: 'file',
    mime_type: 'text/plain',
    size: 1,
    extension: 'txt',
    cloud_account_uuid: 'acc-uuid',
    is_starred: false,
    status: 'ready',
    updated_at: '2026-10-01 00:00:00',
  }
}
```

and change every `{ cloudAccountId: 1 }` in that file to `{ cloudAccountUuid: 'acc-uuid' }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stores/__tests__/driveItems.spec.ts`
Expected: FAIL — `buildDriveItemsQuery` still emits `cloud_account_id`.

- [ ] **Step 3: Update driveItems.ts**

In `frontend/src/api/driveItems.ts`:

```ts
export interface DriveItem {
  uuid: string
  name: string
  type: 'file' | 'folder'
  mime_type: string
  size: number
  extension: string
  cloud_account_uuid: string
  is_starred: boolean
  status: string
  updated_at: string
}

export interface DriveListParams {
  cloudAccountUuid: string
  parentUuid?: string | null
  search?: string
  type?: string
  sort?: string
  order?: string
  cursor?: string
  limit?: number
}
```

```ts
export function buildDriveItemsQuery(params: DriveListParams): string {
  const query = new URLSearchParams()
  query.set('cloud_account_uuid', params.cloudAccountUuid)
  if (params.parentUuid) query.set('parent_uuid', params.parentUuid)
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))
  return query.toString()
}
```

- [ ] **Step 4: Update cloudAccounts.ts**

In `frontend/src/api/cloudAccounts.ts`, drop `id` from `CloudAccount` and add `uuid`; change the id-taking functions to uuid:

```ts
export interface CloudAccount {
  uuid: string
  name: string
  provider: string
  credentials: CloudAccountCredentials | null
  sync_status: 'idle' | 'syncing' | 'error'
  total_storage: number
  used_storage: number
  last_synced_at: string | null
  is_default: boolean
  is_active: boolean
}
```

```ts
export async function getCloudAccount(uuid: string): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${uuid}`)
}

export async function updateCloudAccount(
  uuid: string,
  payload: UpdateCloudAccountPayload,
): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${uuid}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteCloudAccount(uuid: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${uuid}`, { method: 'DELETE' })
}

export async function syncCloudAccount(uuid: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${uuid}/sync`, { method: 'POST' })
}
```

- [ ] **Step 5: Update dashboard.ts**

In `frontend/src/api/dashboard.ts`, add to `Activity`:

```ts
  cloud_account_uuid: string | null
```

(keep `cloud_id: number | null`).

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run src/stores/__tests__/driveItems.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/api/cloudAccounts.ts src/api/driveItems.ts src/api/dashboard.ts src/stores/__tests__/driveItems.spec.ts
git commit -m "feat(api): use uuids in frontend API types and clients"
```

---

### Task 9: cloudAccounts store and SyncCloudButton key on uuid

**Files:**
- Modify: `frontend/src/stores/cloudAccounts.ts`
- Modify: `frontend/src/components/cloud/SyncCloudButton.vue`
- Modify: `frontend/src/stores/__tests__/cloudAccounts.spec.ts`
- Modify: `frontend/src/components/cloud/__tests__/SyncCloudButton.spec.ts`

**Interfaces:**
- Consumes: `CloudAccount.uuid` (Task 8).
- Produces: store methods `sync(uuid: string)`, `isSyncing(uuid: string)`, `update(uuid, ...)`, `remove(uuid)`, `setDefault(uuid)`; `SyncCloudButton` prop `accountUuid: string`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/stores/__tests__/cloudAccounts.spec.ts`, update the `account()` factory to drop `id` and add `uuid`:

```ts
function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    uuid: 'acc-1',
    name: 'MinIO Local',
    provider: 'minio',
    credentials: null,
    sync_status: 'idle',
    total_storage: 0,
    used_storage: 0,
    last_synced_at: null,
    is_default: false,
    is_active: true,
    ...overrides,
  }
}
```

Replace every `id: N` override with `uuid: 'acc-N'`, every `.map((a) => a.id)` with `.map((a) => a.uuid)`, and every numeric argument (`store.sync(3)` → `store.sync('acc-3')`, `store.update(1, ...)` → `store.update('acc-1', ...)`, etc.).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stores/__tests__/cloudAccounts.spec.ts`
Expected: FAIL — store signatures still take numbers.

- [ ] **Step 3: Update the store**

In `frontend/src/stores/cloudAccounts.ts`, change `syncingIds` to `Set<string>` and the methods:

```ts
  const syncingIds = ref<Set<string>>(new Set())

  function isSyncing(uuid: string): boolean {
    return syncingIds.value.has(uuid)
  }

  function setSyncing(uuid: string, on: boolean): void {
    const next = new Set(syncingIds.value)
    if (on) next.add(uuid)
    else next.delete(uuid)
    syncingIds.value = next
  }
```

```ts
  async function update(uuid: string, payload: Partial<CloudAccountPayload>): Promise<void> {
    const res = await updateCloudAccount(uuid, payload)
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) => (a.uuid === uuid ? updated : a))
  }

  async function remove(uuid: string): Promise<void> {
    await deleteCloudAccount(uuid)
    accounts.value = accounts.value.filter((a) => a.uuid !== uuid)
  }

  async function setDefault(uuid: string): Promise<void> {
    const res = await updateCloudAccount(uuid, { is_default: true })
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) =>
      a.uuid === uuid ? updated : { ...a, is_default: false },
    )
  }
```

```ts
  async function pollUntilSettled(uuid: string): Promise<void> {
    for (let attempt = 0; attempt < SYNC_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(SYNC_POLL_INTERVAL_MS)
      }
      try {
        await fetch()
      } catch {
        // `fetch` records the error itself; keep polling.
      }
      const current = accounts.value.find((a) => a.uuid === uuid)
      if (current && current.sync_status !== 'syncing') {
        break
      }
    }
    setSyncing(uuid, false)
  }

  async function sync(uuid: string): Promise<void> {
    setSyncing(uuid, true)
    accounts.value = accounts.value.map((a) =>
      a.uuid === uuid ? { ...a, sync_status: 'syncing' as const } : a,
    )
    try {
      await syncCloudAccount(uuid)
    } catch (e) {
      setSyncing(uuid, false)
      throw e
    }
    await pollUntilSettled(uuid)
  }
```

- [ ] **Step 4: Update SyncCloudButton**

In `frontend/src/components/cloud/SyncCloudButton.vue`:

```ts
const props = defineProps<{
  accountUuid: string
  labeled?: boolean
}>()
```

and in `onClick`: `await store.sync(props.accountUuid)`. In the template replace `store.isSyncing(accountId)` with `store.isSyncing(accountUuid)` and `:disabled`/`:title` accordingly.

- [ ] **Step 5: Update the SyncCloudButton test**

In `frontend/src/components/cloud/__tests__/SyncCloudButton.spec.ts`, change the `account()` factory to use `uuid` (drop `id`), change `mountButton` props to `{ accountUuid: string; labeled?: boolean }`, and replace numeric args: `accountId: 12` → `accountUuid: 'acc-12'`, `expect(syncSpy).toHaveBeenCalledWith('acc-12')`, and so on.

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run src/stores/__tests__/cloudAccounts.spec.ts src/components/cloud/__tests__/SyncCloudButton.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/stores/cloudAccounts.ts src/components/cloud/SyncCloudButton.vue src/stores/__tests__/cloudAccounts.spec.ts src/components/cloud/__tests__/SyncCloudButton.spec.ts
git commit -m "feat(cloud): key the accounts store and sync button on uuid"
```

---

### Task 10: Router, navigation helper, and URL-driven DriveView

**Files:**
- Modify: `frontend/src/router/index.ts`
- Create: `frontend/src/router/drivePaths.ts`
- Modify: `frontend/src/stores/driveItems.ts`
- Modify: `frontend/src/composables/useDriveItems.ts`
- Modify: `frontend/src/views/DriveView.vue`
- Test: `frontend/src/router/__tests__/drivePaths.spec.ts`, `frontend/src/stores/__tests__/driveItems.spec.ts`

**Interfaces:**
- Consumes: `DriveListParams` with uuids (Task 8), `getDriveItemBreadcrumb` (already in `api/driveItems.ts`).
- Produces:
  - `drivePath(cloudUuid: string, folderUuid?: string | null): string`
  - `driveLocation(cloudUuid: string, folderUuid?: string | null): RouteLocationRaw`
  - store `breadcrumb: Ref<DriveItem[]>`, `loadBreadcrumb(uuid)`, `clearBreadcrumb()`
  - `DriveView` props `{ cloudUuid: string; folderUuid?: string }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/router/__tests__/drivePaths.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { drivePath, driveLocation } from '@/router/drivePaths'

describe('drivePaths', () => {
  it('builds the account-root path without a folder', () => {
    expect(drivePath('acc-1')).toBe('/c/acc-1')
    expect(driveLocation('acc-1')).toEqual({ name: 'drive', params: { cloudUuid: 'acc-1' } })
  })

  it('builds the folder path when a folder uuid is given', () => {
    expect(drivePath('acc-1', 'fold-1')).toBe('/c/acc-1/f/fold-1')
    expect(driveLocation('acc-1', 'fold-1')).toEqual({
      name: 'drive-folder',
      params: { cloudUuid: 'acc-1', folderUuid: 'fold-1' },
    })
  })

  it('treats null and empty folder as the root', () => {
    expect(drivePath('acc-1', null)).toBe('/c/acc-1')
    expect(drivePath('acc-1', '')).toBe('/c/acc-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/router/__tests__/drivePaths.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `frontend/src/router/drivePaths.ts`:

```ts
import type { RouteLocationRaw } from 'vue-router'

/**
 * Builds the drive URL from uuids only. The URL is the source of truth for the
 * open folder, so every navigation site (sidebar, home cards, breadcrumb) goes
 * through here and produces the same shape.
 */
export function drivePath(cloudUuid: string, folderUuid?: string | null): string {
  return folderUuid ? `/c/${cloudUuid}/f/${folderUuid}` : `/c/${cloudUuid}`
}

export function driveLocation(cloudUuid: string, folderUuid?: string | null): RouteLocationRaw {
  return folderUuid
    ? { name: 'drive-folder', params: { cloudUuid, folderUuid } }
    : { name: 'drive', params: { cloudUuid } }
}
```

- [ ] **Step 4: Update the router**

In `frontend/src/router/index.ts`, replace the `/drive` route with two routes:

```ts
    {
      path: '/c/:cloudUuid',
      name: 'drive',
      component: () => import('@/views/DriveView.vue'),
      props: true,
      meta: { requiresAuth: true, titleKey: 'routes.drive' },
    },
    {
      path: '/c/:cloudUuid/f/:folderUuid',
      name: 'drive-folder',
      component: () => import('@/views/DriveView.vue'),
      props: true,
      meta: { requiresAuth: true, titleKey: 'routes.drive' },
    },
```

- [ ] **Step 5: Add breadcrumb state to the store**

In `frontend/src/stores/driveItems.ts`:

Import: `import { listDriveItems, getDriveItemBreadcrumb, type DriveItem, type DriveListParams } from '@/api/driveItems'`.

Add state and actions:

```ts
  const breadcrumb = ref<DriveItem[]>([])

  async function loadBreadcrumb(uuid: string): Promise<void> {
    if (!uuid) {
      breadcrumb.value = []
      return
    }
    try {
      const res = await getDriveItemBreadcrumb(uuid)
      breadcrumb.value = res.data ?? []
    } catch {
      // The bar is decorative: a failure leaves it empty rather than breaking
      // the listing, which loads independently.
      breadcrumb.value = []
    }
  }

  function clearBreadcrumb(): void {
    breadcrumb.value = []
  }
```

Add `breadcrumb`, `loadBreadcrumb`, `clearBreadcrumb` to the returned object.

Do **not** clear the breadcrumb inside `reset()`. `reset()` runs on every list reload — including a search keystroke or a sort change — and clearing there would blank the ancestor bar while the user types. The breadcrumb's lifecycle is owned by the `folderUuid` watcher in `DriveView`: a root navigation fires it with an empty uuid, which clears the bar.

Change the query type and guard:

```ts
  let lastQuery: DriveListQuery = { cloudAccountUuid: '' }
```

```ts
    if (!query.cloudAccountUuid) return
```

Add a store test in `frontend/src/stores/__tests__/driveItems.spec.ts`:

```ts
it('loads and clears the breadcrumb', async () => {
  vi.spyOn(api, 'getDriveItemBreadcrumb').mockResolvedValue({
    status: 'ok',
    data: [item('root'), item('sub')],
  })

  const store = useDriveItemsStore()
  await store.loadBreadcrumb('sub')
  expect(store.breadcrumb.map((i) => i.uuid)).toEqual(['root', 'sub'])

  store.clearBreadcrumb()
  expect(store.breadcrumb).toEqual([])
})

it('leaves the breadcrumb empty when the request fails', async () => {
  vi.spyOn(api, 'getDriveItemBreadcrumb').mockRejectedValue(new Error('nope'))
  const store = useDriveItemsStore()
  await store.loadBreadcrumb('missing')
  expect(store.breadcrumb).toEqual([])
})
```

- [ ] **Step 6: Update useDriveItems**

In `frontend/src/composables/useDriveItems.ts`, no signature change is needed (it takes the query object). Confirm `DriveListQuery` now carries `cloudAccountUuid`; the debounce/JSON key logic is unchanged.

- [ ] **Step 7: Rewrite DriveView to be URL-driven**

In `frontend/src/views/DriveView.vue`:

- Add props and drop `route.query.cloud`:

```ts
const props = defineProps<{
  cloudUuid: string
  folderUuid?: string
}>()

const cloudAccountUuid = computed(() => props.cloudUuid)
const parentUuid = computed(() => props.folderUuid ?? null)
```

- Remove `folderStack`, the `cloudAccountId` computed, and the `watch(cloudAccountId, ...)`.
- Replace the `useDriveItems` query:

```ts
const { items, loading, error, hasMore, loadMore, reload } = useDriveItems(() => ({
  cloudAccountUuid: cloudAccountUuid.value,
  parentUuid: parentUuid.value,
  search: search.value,
  sort: sort.value,
  order: order.value,
}))
```

- Read the breadcrumb from the store and resolve it when the folder changes:

```ts
const driveStore = useDriveItemsStore()
const { breadcrumb } = storeToRefs(driveStore)

watch(
  () => props.folderUuid,
  (uuid) => {
    void driveStore.loadBreadcrumb(uuid ?? '')
  },
  { immediate: true },
)
```

- Opening a folder pushes the URL:

```ts
function openFolder(uuid: string) {
  selectedItemId.value = null
  void router.push(driveLocation(props.cloudUuid, uuid))
}

function goToCrumb(index: number) {
  // index is the position in the root-first chain; index 0 is the root, which
  // has no folder segment.
  selectedItemId.value = null
  if (index <= 0) {
    void router.push(driveLocation(props.cloudUuid))
    return
  }
  const crumb = breadcrumb.value[index - 1]
  if (!crumb) return
  void router.push(driveLocation(props.cloudUuid, crumb.uuid))
}
```

- `onMounted`: fetch user and, if the accounts list is empty, fetch accounts. No default-account redirect is needed (the URL already names the account); if the uuid is unknown the list simply errors.

```ts
onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
  if (cloudStore.accounts.length === 0) {
    await cloudStore.fetch()
  }
})
```

- Update the breadcrumb template to render the store chain. Replace the `folderStack` nav:

```html
      <nav v-if="breadcrumb.length" class="flex items-center gap-1 text-sm text-muted-foreground">
        <button type="button" class="hover:text-foreground cursor-pointer" @click="goToCrumb(0)">
          {{ t('drive.nav_my_drive') }}
        </button>
        <template v-for="(crumb, index) in breadcrumb" :key="crumb.uuid">
          <span>/</span>
          <button
            type="button"
            class="hover:text-foreground cursor-pointer"
            @click="goToCrumb(index + 1)"
          >
            {{ crumb.name }}
          </button>
        </template>
      </nav>
```

- Update the SyncCloudButton usage to the new prop:

```html
          <SyncCloudButton
            v-if="cloudAccountUuid"
            :account-uuid="cloudAccountUuid"
            labeled
            @synced="handleSynced"
          />
```

- Add imports: `import { useDriveItemsStore } from '@/stores/driveItems'`, `import { storeToRefs } from 'pinia'`, `import { driveLocation } from '@/router/drivePaths'`.

- Remove the now-unused route access: `route` was used only by the old `cloudAccountId` computed, so drop `useRoute` from the import and delete `const route = useRoute()`. Keep `useRouter`/`router`. (`computed`, `ref`, `watch`, `onMounted` all remain in use.) A leftover unused `route` binding fails `npm run lint`.

- [ ] **Step 8: Run the tests and type-check**

Run: `cd frontend && npx vitest run src/router/__tests__/drivePaths.spec.ts src/stores/__tests__/driveItems.spec.ts && npm run type-check`
Expected: PASS and no type errors.

- [ ] **Step 9: Commit**

```bash
cd frontend
git add src/router/index.ts src/router/drivePaths.ts src/router/__tests__/drivePaths.spec.ts src/stores/driveItems.ts src/stores/__tests__/driveItems.spec.ts src/composables/useDriveItems.ts src/views/DriveView.vue
git commit -m "feat(drive): drive the folder view from the URL"
```

---

### Task 11: HomeView and DashboardLayout navigate by uuid

**Files:**
- Modify: `frontend/src/views/HomeView.vue`
- Modify: `frontend/src/layouts/DashboardLayout.vue`
- Modify: `frontend/src/composables/__tests__/useDriveItems.spec.ts` (item factory + query)

**Interfaces:**
- Consumes: `driveLocation` (Task 10), `CloudAccount.uuid` (Task 8), `SyncCloudButton` `accountUuid` (Task 9), `Activity.cloud_account_uuid` (Task 8).
- Produces: no new exports; all navigation and rendering keyed by uuid.

- [ ] **Step 1: Update the useDriveItems test factory**

In `frontend/src/composables/__tests__/useDriveItems.spec.ts`, change the `item()` factory to the new shape (drop `id`/`cloud_account_id`, add `cloud_account_uuid`) and replace every `{ cloudAccountId: 1 }` with `{ cloudAccountUuid: 'acc-uuid' }` and `cloudAccountId.value = 2` cases with a uuid ref (`cloudAccountUuid`), asserting `spy.mock.calls[1][0].cloudAccountUuid`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/composables/__tests__/useDriveItems.spec.ts`
Expected: FAIL — the old `cloudAccountId` query key no longer type-checks/asserts.

- [ ] **Step 3: Update HomeView**

In `frontend/src/views/HomeView.vue`:

- `CloudStorageSummary.id` becomes the uuid; the map uses `account.uuid`:

```ts
    id: account.uuid,
```

- `SuggestedFile.cloudId` uses the account uuid, and the owner lookup (line 221) compares uuid to uuid:

```ts
    const owner = clouds.value.find((cloud) => cloud.id === item.cloud_account_uuid)
```

```ts
      cloudId: item.cloud_account_uuid,
```

- Activity cloud lookup by uuid:

```ts
      cloud: clouds.value.find((cloud) => cloud.id === act.cloud_account_uuid)?.name || '—',
```

- `navigateToDrive` takes a uuid and pushes the path:

```ts
import { driveLocation } from '@/router/drivePaths'

function navigateToDrive(cloudUuid?: string) {
  if (cloudUuid) {
    router.push(driveLocation(cloudUuid))
  } else {
    router.push({ name: 'home' })
  }
}
```

- Card click passes the uuid: `@click="navigateToDrive(cloud.id)"` stays valid because `cloud.id` now holds the uuid; the sync button uses the uuid:

```html
                  <SyncCloudButton :account-uuid="cloud.id" @synced="handleSynced" />
```

- The storage breakdown `id: account.id` → `id: account.uuid`.

- [ ] **Step 4: Update DashboardLayout**

In `frontend/src/layouts/DashboardLayout.vue`:

- Import `driveLocation`:

```ts
import { driveLocation } from '@/router/drivePaths'
```

- The active cloud comes from the route param:

```ts
const activeCloudUuid = computed(() => (route.params.cloudUuid as string) || '')
```

- `activeNav` and `isDriveView` compare `route.name === 'drive'`; there are now two drive route names, so both must match or the sidebar/header chrome disappears inside a folder:

```ts
const activeNav = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'drive' || route.name === 'drive-folder') return 'my_drive'
  return (route.name as string) || 'home'
})

const isDriveView = computed(() => route.name === 'drive' || route.name === 'drive-folder')
```

- `onSelectCloud` takes a uuid and pushes the drive path:

```ts
function onSelectCloud(uuid: string) {
  isMobileMenuOpen.value = false
  router.push(driveLocation(uuid))
}
```

- `onSelectMyDrive` pushes the first account or home:

```ts
function onSelectMyDrive() {
  isMyDriveOpen.value = true
  isMobileMenuOpen.value = false
  const first = cloudAccounts.value[0]
  if (first) {
    router.push(driveLocation(first.uuid))
  } else {
    router.push({ name: 'home' })
  }
}
```

- The account loop keys and comparisons use `cloud.uuid`:

```html
                <div
                  v-for="cloud in cloudAccounts"
                  :key="cloud.uuid"
                  class="group w-full flex items-center gap-1 rounded-lg pr-1 transition-colors"
                  :class="[
                    activeCloudUuid === cloud.uuid && activeNav === 'my_drive'
                      ? 'bg-primary/10 shadow-2xs'
                      : 'hover:bg-accent/50',
                  ]"
                >
```

- The account button:

```html
                    :class="[
                      activeCloudUuid === cloud.uuid && activeNav === 'my_drive'
                        ? 'text-primary font-semibold'
                        : 'text-muted-foreground group-hover:text-foreground',
                    ]"
                    @click="onSelectCloud(cloud.uuid)"
```

- The sync button:

```html
                  <SyncCloudButton :account-uuid="cloud.uuid" />
```

- Any remaining `activeCloudId` references are renamed to `activeCloudUuid`.

- [ ] **Step 5: Run the full frontend suite and type-check**

Run: `cd frontend && npm run test:run && npm run type-check && npm run lint`
Expected: PASS. Fix any lingering `cloud.id`, `cloudAccountId`, or numeric-id references the compiler/linter flags.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/views/HomeView.vue src/layouts/DashboardLayout.vue src/composables/__tests__/useDriveItems.spec.ts
git commit -m "feat(home): navigate and render clouds by uuid"
```

---

### Task 12: Push both repos and verify the reload behavior

**Files:** none (verification only).

- [ ] **Step 1: Run both suites clean**

Run: `cd backend && go vet ./... && go test ./tests/... && cd ../frontend && npm run test:run && npm run type-check`
Expected: all PASS.

- [ ] **Step 2: Manual reload check**

Start both dev servers. Open a deep folder, confirm the URL is `/c/<cloudUuid>/f/<folderUuid>`, press F5, and confirm the same folder's contents and the full breadcrumb render. Confirm the browser Back button returns to the parent folder and re-renders.

- [ ] **Step 3: Push**

```bash
cd backend && git push origin main
cd ../frontend && git push origin main
```

Note: the backend commit `10ceaf7` (breadcrumb endpoint) and this plan's backend commits must all be pushed. The frontend and backend deploy together; a half-deploy breaks the drive page.
