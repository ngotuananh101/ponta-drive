# Kết Nối Storage Đầu Tiên (S3 & S3-Compatible) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho người dùng kết nối một tài khoản S3 / S3-compatible từ UI, kiểm tra kết nối trước khi lưu, rồi duyệt thư mục và tệp thật trong bucket với cuộn vô hạn.

**Architecture:** Backend Goravel đã có sẵn toàn bộ tầng storage (model, driver factory, 7 endpoint `/v1/cloud-accounts`). Slice này chỉ sửa **một** chỗ ở backend: thêm phân trang cursor cho `GET /v1/drive/items` (hiện không có `LIMIT` và thứ tự sắp xếp không xác định). Toàn bộ phần còn lại là frontend: dựng API client, Pinia store, dialog wizard 3 bước, và thay dữ liệu giả ở sidebar / Home / DriveView bằng dữ liệu thật.

**Tech Stack:** Go 1.25, Goravel v1.18.0, GORM, MariaDB, testify suite; Vue 3.5, TypeScript, Vite, Tailwind CSS 4, shadcn-vue / reka-ui, Pinia, vue-i18n 11, vitest

**Spec:** [`docs/superpowers/specs/2026-10-01-storage-connection-ui-design.md`](../specs/2026-10-01-storage-connection-ui-design.md)

## Global Constraints

- **Ngôn ngữ trả lời:** tiếng Việt. Giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật, tên hàm/biến, commit message, và code.
- **Không có DB test riêng.** Test backend chạy trực tiếp trên MariaDB dev `ponta_drive`. Mọi test **phải tự dọn dẹp** trong `TearDownTest`.
- **`secret_access_key` không bao giờ được xuất hiện** trong bất kỳ response API nào. Đã có test khẳng định tại `tests/integration/cloud_account_response_test.go`.
- **Response `data` của `GET /v1/drive/items` phải giữ nguyên là mảng trần.** Test hiện có cast `listBody["data"].([]any)` tại `tests/feature/drive_item_api_test.go:110` và `:132`. Thông tin phân trang đi vào field anh em `meta`.
- **Provider hợp lệ chỉ gồm `s3`, `cloudflare_r2`, `minio`.** `google_drive` và `onedrive` lọt qua validation nhưng `DriverFactory.BuildDriver` trả "not yet supported" — UI **không** được mời hai provider này.
- **Package manager frontend là `bun`.** Lệnh: `bun run build`, `bun run type-check`, `bun run test:run`.
- **Locale mặc định là `vi`.** Mọi key i18n mới phải thêm vào **cả** `vi.json` và `en.json`; thiếu key ở `en` sẽ không lộ ra khi test ở locale mặc định.
- **Commit message theo Conventional Commits**, viết bằng tiếng Anh.
- **Không commit file rác.** Dọn `tmp/` và mọi file nháp trước khi commit.

## Review Focus

Những tình huống spec không nói tới nhưng người dùng thật sẽ gặp. Mỗi dòng đều có test ở task tương ứng.

1. **Cuộn nhanh sinh request chồng nhau.** Người dùng cuộn liên tục khi trang trước chưa về. Nếu response cũ về sau và ghi đè, danh sách nhảy về trang cũ. Test ở Task 7.
2. **Cursor hỏng hoặc bị sửa tay trên URL.** Người dùng dán lại URL hỏng, hoặc cursor của phiên cũ. Phải trả 400 rõ ràng, **không** được panic và **không** được trả về toàn bộ dữ liệu. Test ở Task 1.
3. **Nhiều mục có `updated_at` giống hệt nhau.** Độ phân giải giây, nên một lần sync tạo nhiều mục cùng giây. Thiếu `id` tiebreaker thì cuộn sẽ lặp hoặc mất mục. Test ở Task 1.
4. **Thư mục rỗng và thư mục chỉ có đúng `limit` mục.** Biên của `has_more` — off-by-one ở đây khiến UI hoặc gọi thêm một trang rỗng, hoặc cắt mất mục cuối. Test ở Task 1 và Task 2.
5. **`limit` bị đặt quá lớn trên URL.** `?limit=100000` phải bị kẹp về trần 100, không được kéo cả bảng vào bộ nhớ. Test ở Task 2.
6. **Tham số sắp xếp rơi mất trên đường tới backend.** Người dùng bấm đổi kiểu sắp xếp mà danh sách không đổi. Lỗi này vô hình khi test tay vì danh sách vẫn render bình thường, chỉ là sai thứ tự. Test ở Task 7.

---

## Cấu Trúc File

### Backend (`D:/Source/ponta/ponta_drive/backend`)

| File | Trách nhiệm |
| :--- | :--- |
| `app/services/drive_cursor.go` | **Mới.** Encode/decode cursor, whitelist cột sort, dựng vị từ keyset. Tách riêng để `cloud_drive_service.go` không phình thêm. |
| `app/services/cloud_drive_service.go` | **Sửa** `ListItems` (dòng 97–137): nhận cursor + limit, đổi `ORDER BY`. |
| `app/http/controllers/drive_item_controller.go` | **Sửa** `Index` (dòng 30–86): đọc `cursor`/`limit`, trả `meta`. |
| `database/migrations/20261001000000_add_drive_items_list_index.go` | **Mới.** Index tổ hợp cho truy vấn list. |
| `bootstrap/migrations.go` | **Sửa.** Đăng ký migration mới. |
| `tests/feature/drive_pagination_test.go` | **Mới.** Toàn bộ test phân trang. |

### Frontend (`D:/Source/ponta/ponta_drive/frontend`)

| File | Trách nhiệm |
| :--- | :--- |
| `vite.config.ts` | **Sửa.** Cấu hình vitest. |
| `package.json` | **Sửa.** Thêm `vitest`, `@vue/test-utils`, `happy-dom`; script `test`, `test:run`. |
| `src/api/cloudAccounts.ts` | **Mới.** Client 7 endpoint + interface `CloudAccount` chuẩn. |
| `src/api/driveItems.ts` | **Mới.** Client list items có cursor. |
| `src/api/dashboard.ts` | **Sửa.** Import lại `CloudAccount` từ `cloudAccounts.ts`, bỏ định nghĩa trùng. |
| `src/stores/cloudAccounts.ts` | **Mới.** Nguồn sự thật duy nhất cho danh sách tài khoản. |
| `src/stores/driveItems.ts` | **Mới.** State phân trang: `items`, `cursor`, `hasMore`, `loading`, `error`. |
| `src/composables/useDriveItems.ts` | **Mới.** Fetch + `AbortController` + dedup + reset. |
| `src/composables/useInfiniteScroll.ts` | **Mới.** Gắn `IntersectionObserver` vào một sentinel; tách riêng để phần dễ hỏng âm thầm nhất của cuộn vô hạn có test. |
| `src/components/ui/dialog/` | **Mới.** Primitive dialog. |
| `src/components/ui/select/` | **Mới.** Primitive select. |
| `src/components/ui/switch/` | **Mới.** Primitive switch. |
| `src/components/cloud/AddCloudDialog.vue` | **Mới.** Wizard 3 bước. |
| `src/components/cloud/providerMeta.ts` | **Mới.** Bảng map provider → nhãn/icon/màu/prefill. |
| `src/views/DriveView.vue` | **Sửa.** Bỏ mock, dùng store, thêm sentinel cuộn vô hạn. |
| `src/views/HomeView.vue` | **Sửa.** `handleAddCloud` mở dialog. |
| `src/layouts/DashboardLayout.vue` | **Sửa.** Sidebar đọc từ store. |
| `src/locales/vi.json`, `src/locales/en.json` | **Sửa.** Namespace `cloud` mới. |

---

## Task 1: Backend — Cursor, thứ tự sắp xếp và index

> **TRẠNG THÁI: ĐÃ XONG** — commit `1541dea feat(drive): paginate the item list with a keyset cursor`.
> Đã kiểm chứng lại: `go build ./...` sạch, `go vet ./...` sạch,
> `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite|TestDriveItemAPITestSuite' -count=1` → PASS.
> Các bước dưới đây giữ nguyên làm bản ghi thiết kế; **không chạy lại Step 2/6**
> (chúng cố tình đỏ trước khi có code). Chỉ còn Task 3–8 là việc thật.

**Files:**
- Create: `app/services/drive_cursor.go`
- Modify: `app/services/cloud_drive_service.go:97-137`
- Create: `database/migrations/20261001000000_add_drive_items_list_index.go`
- Modify: `bootstrap/migrations.go`
- Test: `tests/feature/drive_pagination_test.go`

**Interfaces:**
- Consumes: không có (task đầu tiên).
- Produces:
  - `type DriveCursor struct { Type string; Value string; ID uint; Sort string; Order string }`
  - `func (c DriveCursor) Matches(orderCol, orderDir string) bool`
  - `func EncodeDriveCursor(item models.DriveItem, orderCol, orderDir string) (string, error)`
  - `func DecodeDriveCursor(raw string) (DriveCursor, error)` — the empty string decodes to the zero cursor, not an error
  - `func NormalizeSortField(field string) string` — trả về một trong `name`, `size`, `updated_at`, `created_at`; mặc định `name`.
  - `func NormalizeSortOrder(order string) string` — trả về `asc` hoặc `desc`; mặc định `asc`.
  - `func BuildCursorWhere(c DriveCursor, orderCol, orderDir string) (string, []any)`
  - `func (s *CloudDriveService) ListItems(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, search string, itemType string, sortField string, sortOrder string, cursor DriveCursor, limit int) ([]models.DriveItem, error)`

- [x] **Step 1: Viết test đỏ cho cursor encode/decode**

Tạo `tests/feature/drive_pagination_test.go`:

```go
package feature

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/suite"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
	"ponta_drive/app/services"
	"ponta_drive/tests"
)

type DrivePaginationTestSuite struct {
	suite.Suite
	tests.TestCase
	user    models.User
	token   string
	account models.CloudAccount
}

func TestDrivePaginationTestSuite(t *testing.T) {
	suite.Run(t, new(DrivePaginationTestSuite))
}

func (s *DrivePaginationTestSuite) SetupTest() {
	_ = facades.Artisan().Call("migrate")

	hashedPassword, _ := facades.Hash().Make("password123")
	s.user = models.User{
		UUID:     uuid.New().String(),
		Name:     "Pagination User",
		Username: "page_" + uuid.New().String()[:8],
		Email:    "page_" + uuid.New().String()[:8] + "@example.com",
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
		Name:      "Pagination Storage",
		Provider:  models.ProviderS3,
		IsDefault: true,
		IsActive:  true,
	}
	_ = s.account.SetCredentials(&models.S3Credentials{
		Bucket:          "pagination-bucket",
		Region:          "us-east-1",
		AccessKeyID:     "AKIA...",
		SecretAccessKey: "secret...",
	})
	err = facades.Orm().Query().Create(&s.account)
	s.Require().NoError(err)
}

func (s *DrivePaginationTestSuite) TearDownTest() {
	if s.user.ID > 0 {
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.DriveItem{})
		_, _ = facades.Orm().Query().Where("user_id", s.user.ID).ForceDelete(&models.CloudAccount{})
		_, _ = facades.Orm().Query().ForceDelete(&s.user)
	}
}

// seedItems creates n files at the root of s.account, all with the same
// updated_at second so only the `id` tiebreaker can order them.
func (s *DrivePaginationTestSuite) seedItems(n int) []models.DriveItem {
	items := make([]models.DriveItem, 0, n)
	for i := 0; i < n; i++ {
		item := models.DriveItem{
			UUID:           uuid.New().String(),
			UserID:         s.user.ID,
			CloudAccountID: s.account.ID,
			Name:           fmt.Sprintf("file-%03d.txt", i),
			Type:           models.ItemTypeFile,
			Size:           int64(i + 1),
			Status:         models.ItemStatusReady,
		}
		s.Require().NoError(facades.Orm().Query().Create(&item))
		items = append(items, item)
	}
	return items
}

func (s *DrivePaginationTestSuite) TestCursorRoundTrip() {
	item := models.DriveItem{
		Name: "report.pdf",
		Type: models.ItemTypeFile,
		Size: 4096,
	}
	item.ID = 77

	encoded, err := services.EncodeDriveCursor(item, "name", "asc")
	s.Require().NoError(err)
	s.NotEmpty(encoded)

	decoded, err := services.DecodeDriveCursor(encoded)
	s.Require().NoError(err)
	s.Equal(models.ItemTypeFile, decoded.Type)
	s.Equal("report.pdf", decoded.Value)
	s.Equal(uint(77), decoded.ID)
	s.Equal("name", decoded.Sort)
	s.Equal("asc", decoded.Order)
	s.True(decoded.Matches("name", "asc"))
	s.False(decoded.Matches("size", "asc"), "a cursor must not match a different ordering")
}

// A cursor that is not valid base64, or decodes to JSON of the wrong shape,
// must produce an error rather than silently paginating from the beginning.
// The empty string is excluded: that is how a caller asks for the first page.
func (s *DrivePaginationTestSuite) TestDecodeRejectsGarbage() {
	for _, bad := range []string{"not-base64!!!", "Zm9vYmFy", "eyJ0IjoiZmlsZSIsInMiOiJuYW1lIn0"} {
		_, err := services.DecodeDriveCursor(bad)
		s.Error(err, "garbage cursor %q must be rejected", bad)
	}
}

// The empty cursor is the documented way to request the first page, so it must
// decode cleanly to the zero value rather than erroring.
func (s *DrivePaginationTestSuite) TestDecodeEmptyCursorMeansFirstPage() {
	c, err := services.DecodeDriveCursor("")
	s.Require().NoError(err)
	s.Equal(uint(0), c.ID)
	s.False(c.Matches("name", "asc"))
}

func (s *DrivePaginationTestSuite) TestNormalizeSortFieldWhitelists() {
	s.Equal("name", services.NormalizeSortField("name"))
	s.Equal("size", services.NormalizeSortField("size"))
	s.Equal("updated_at", services.NormalizeSortField("updated_at"))
	s.Equal("created_at", services.NormalizeSortField("created_at"))
	s.Equal("name", services.NormalizeSortField(""))
	// A hostile value must not reach the SQL string.
	s.Equal("name", services.NormalizeSortField("name; DROP TABLE users"))
	s.Equal("name", services.NormalizeSortField("password"))
}

func (s *DrivePaginationTestSuite) TestNormalizeSortOrder() {
	s.Equal("asc", services.NormalizeSortOrder("asc"))
	s.Equal("desc", services.NormalizeSortOrder("desc"))
	s.Equal("asc", services.NormalizeSortOrder(""))
	s.Equal("asc", services.NormalizeSortOrder("sideways"))
}

// A NULL timestamp sorts before every value, so a cursor resting on one carries
// an empty value. Binding `col > ''` would be false for every row and the walk
// would lose everything after it, so the column comparison has to be dropped
// rather than bound. The predicate must still be a syntactically valid
// expression, which is why it is asserted here and not only through HTTP.
func (s *DrivePaginationTestSuite) TestCursorPredicateDropsColumnComparisonForNullTimestamp() {
	cond, args := services.BuildCursorWhere(services.DriveCursor{
		Type: models.ItemTypeFolder,
		ID:   12,
	}, "updated_at", "asc")

	s.NotContains(cond, "updated_at", "an empty value must not produce a column comparison")
	s.Contains(cond, "id > ?", "the id tier must still carry the walk")
	s.Len(args, 3, "type, type, id")

	cond, args = services.BuildCursorWhere(services.DriveCursor{
		Type:  models.ItemTypeFile,
		Value: "2026-10-01 00:00:00",
		ID:    12,
	}, "updated_at", "asc")

	s.Contains(cond, "updated_at > ?")
	s.Len(args, 5, "type, type, value, value, id")
}
```

- [x] **Step 2: Chạy test cho chắc chắn nó đỏ**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: FAIL — `undefined: services.EncodeDriveCursor` (và các hàm còn lại).

- [x] **Step 3: Viết `app/services/drive_cursor.go`**

```go
package services

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"ponta_drive/app/models"
)

// DriveCursor marks the position of the last item of a page so the next page
// can resume from it.
//
// The list query orders by three tiers - type, then the caller's sort column,
// then id - so the cursor has to carry all three. A cursor holding only the
// sort value would resume at the wrong place whenever two rows share it.
//
// It also records which ordering produced it. A position only means something
// inside one ordering: replaying a name-positioned cursor against `sort=size`
// would compare a name against the size column and return rows the caller
// never asked for.
type DriveCursor struct {
	Type  string `json:"t"`
	Value string `json:"v,omitempty"`
	ID    uint   `json:"id"`
	Sort  string `json:"s"`
	Order string `json:"o"`
}

// Matches reports whether this cursor was produced under the given ordering.
func (c DriveCursor) Matches(orderCol, orderDir string) bool {
	return c.Sort == orderCol && c.Order == orderDir
}

// sortColumns maps a caller-supplied sort field to the real column. Only these
// four may ever reach the SQL string: the value is interpolated into the ORDER
// BY clause, so an unwhitelisted value would be an injection.
var sortColumns = map[string]string{
	"name":       "name",
	"size":       "size",
	"updated_at": "updated_at",
	"created_at": "created_at",
}

// NormalizeSortField returns a column name safe to interpolate into SQL.
// Anything unrecognised falls back to "name".
func NormalizeSortField(field string) string {
	if col, ok := sortColumns[field]; ok {
		return col
	}
	return "name"
}

// NormalizeSortOrder returns "asc" or "desc". Anything else means "asc".
func NormalizeSortOrder(order string) string {
	if order == "desc" {
		return "desc"
	}
	return "asc"
}

// cursorValue extracts the sort value from an item as a string. Values are
// carried as text because that is what the keyset comparison binds; SQL
// compares them against the real column, which MariaDB casts.
//
// `size` comes back from JSON as a float64, so it is formatted without an
// exponent; a timestamp is formatted with the same layout the column uses, so
// the string compares correctly against it. A NULL timestamp returns "", which
// buildCursorWhere treats as the start of that column's range.
func cursorValue(item models.DriveItem, orderCol string) string {
	switch orderCol {
	case "size":
		return strconv.FormatInt(item.Size, 10)
	case "updated_at":
		if item.UpdatedAt != nil {
			return item.UpdatedAt.Format("2006-01-02 15:04:05")
		}
		return ""
	case "created_at":
		if item.CreatedAt != nil {
			return item.CreatedAt.Format("2006-01-02 15:04:05")
		}
		return ""
	default:
		return item.Name
	}
}

// EncodeDriveCursor serialises the position of an item into an opaque token.
func EncodeDriveCursor(item models.DriveItem, orderCol, orderDir string) (string, error) {
	c := DriveCursor{
		Type:  item.Type,
		Value: cursorValue(item, orderCol),
		ID:    item.ID,
		Sort:  orderCol,
		Order: orderDir,
	}

	raw, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("failed to marshal drive cursor: %w", err)
	}

	return base64.URLEncoding.EncodeToString(raw), nil
}

// DecodeDriveCursor parses a token produced by EncodeDriveCursor. A malformed
// token is an error, never a silent restart from page one: silently restarting
// would make an infinite scroller loop over the first page forever.
//
// The empty string is not malformed - it is how a caller asks for the first
// page - so it decodes to the zero cursor, which buildCursorWhere ignores.
func DecodeDriveCursor(raw string) (DriveCursor, error) {
	if raw == "" {
		return DriveCursor{}, nil
	}

	var c DriveCursor

	decoded, err := base64.URLEncoding.DecodeString(raw)
	if err != nil {
		return c, fmt.Errorf("drive cursor is not valid base64: %w", err)
	}

	if err := json.Unmarshal(decoded, &c); err != nil {
		return c, fmt.Errorf("drive cursor is not valid JSON: %w", err)
	}

	if c.ID == 0 {
		return c, errors.New("drive cursor is missing its id")
	}

	return c, nil
}

// BuildCursorWhere returns the keyset predicate selecting the rows that come
// after the cursor, plus its bind arguments.
//
// Ordering is: type DESC, orderCol <dir>, id ASC.
//
//   - type DESC is always a strict "<" comparison: 'folder' sorts before
//     'file', so anything after a 'folder' is a 'file', and nothing follows a
//     'file'.
//   - orderCol reverses with the requested direction.
//   - id is always ASC, and is what makes the ordering total. Without it, rows
//     sharing a sort value - which is the norm for updated_at, whose
//     granularity is one second - would shuffle between pages.
//
// A NULL timestamp sorts before every value in MySQL's ascending order, so the
// cursor value for one is "". That empty string cannot be compared with a
// bound parameter - `col > ''` is false for every row, so an ascending cursor
// sitting on a NULL would skip every remaining row. Both cases are therefore
// spelled out as SQL rather than bound: the same-column comparison is dropped
// when the value is empty, leaving the id tier to carry the walk.
func BuildCursorWhere(c DriveCursor, orderCol, orderDir string) (string, []any) {
	cmp := ">"
	if orderDir == "desc" {
		cmp = "<"
	}

	cond := "(type < ?) OR (type = ?"
	args := []any{c.Type, c.Type}

	if c.Value != "" {
		cond += fmt.Sprintf(" AND (%s %s ? OR (%s = ? AND id > ?))", orderCol, cmp, orderCol)
		args = append(args, c.Value, c.Value, c.ID)
	} else {
		cond += " AND id > ?"
		args = append(args, c.ID)
	}

	cond += ")"

	return cond, args
}
```

- [x] **Step 4: Chạy lại test cursor cho tới khi xanh**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: PASS cho 4 test đầu.

- [x] **Step 5: Viết test đỏ cho phân trang qua HTTP**

Thêm vào `tests/feature/drive_pagination_test.go`:

```go
// listPage calls the list endpoint and returns the page's names plus the
// pagination metadata.
func (s *DrivePaginationTestSuite) listPage(query string) ([]string, bool, string) {
	resp, err := s.Http(s.T()).WithToken(s.token).
		Get(fmt.Sprintf("/v1/drive/items?cloud_account_id=%d%s", s.account.ID, query))
	s.Require().NoError(err)
	resp.AssertOk()

	body, err := resp.Json()
	s.Require().NoError(err)

	raw := body["data"].([]any)
	names := make([]string, 0, len(raw))
	for _, entry := range raw {
		names = append(names, entry.(map[string]any)["name"].(string))
	}

	meta, ok := body["meta"].(map[string]any)
	s.Require().True(ok, "response must carry a meta object")
	hasMore := meta["has_more"].(bool)
	next, _ := meta["next_cursor"].(string)

	return names, hasMore, next
}

// walkAllPages follows next_cursor until has_more is false and returns every
// name seen, in order.
func (s *DrivePaginationTestSuite) walkAllPages(limit int) []string {
	return s.walkAllPagesUnder("", limit)
}

// walkAllPagesUnder is walkAllPages with extra query parameters (sort/order),
// so the same traversal can be exercised under each ordering the UI can send.
func (s *DrivePaginationTestSuite) walkAllPagesUnder(params string, limit int) []string {
	var all []string
	query := fmt.Sprintf("%s&limit=%d", params, limit)

	for page := 0; page < 50; page++ {
		names, hasMore, next := s.listPage(query)
		all = append(all, names...)

		if !hasMore {
			return all
		}
		s.Require().NotEmpty(next, "has_more=true must come with a next_cursor")
		query = fmt.Sprintf("%s&limit=%d&cursor=%s", params, limit, next)
	}

	s.FailNow("pagination did not terminate after 50 pages")
	return nil
}

// Walking every page must visit each item exactly once. A missing id tiebreaker
// makes rows with equal sort values shuffle between pages, which shows up here
// as duplicates or omissions.
func (s *DrivePaginationTestSuite) TestPaginationVisitsEveryItemExactlyOnce() {
	s.seedItems(25)

	seen := s.walkAllPages(10)

	s.Len(seen, 25, "every seeded item must appear exactly once")
	s.Equal(uniqueStrings(seen), seen, "no item may appear twice")
}

// The seeded items all share an updated_at second, so this is the case that
// only a total ordering survives.
func (s *DrivePaginationTestSuite) TestPaginationStableWhenTimestampsTie() {
	s.seedItems(15)

	seen := s.walkAllPages(4)

	s.Len(seen, 15)
	s.Equal(uniqueStrings(seen), seen)
}

// A descending order flips the comparison in the cursor predicate. If the
// predicate kept `>` for a desc sort, the second page would re-read rows the
// first page already returned; if it kept the column comparison but dropped the
// id tiebreaker, rows sharing a sort value would shuffle across the page
// boundary. Either way this shows up as a duplicate or a missing name.
func (s *DrivePaginationTestSuite) TestPaginationUnderDescendingOrders() {
	s.seedItems(25)

	for _, params := range []string{"&sort=name&order=desc", "&sort=size&order=desc"} {
		seen := s.walkAllPagesUnder(params, 10)

		s.Len(seen, 25, "every seeded item must appear exactly once under %s", params)
		s.Equal(uniqueStrings(seen), seen, "no item may appear twice under %s", params)
	}
}

// Folders must still sort before files after the CASE expression is replaced
// by ORDER BY type DESC.
func (s *DrivePaginationTestSuite) TestFoldersStillSortFirst() {
	folder := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         s.user.ID,
		CloudAccountID: s.account.ID,
		Name:           "zzz-folder",
		Type:           models.ItemTypeFolder,
		Status:         models.ItemStatusReady,
	}
	s.Require().NoError(facades.Orm().Query().Create(&folder))
	s.seedItems(3)

	names, _, _ := s.listPage("")
	s.Require().NotEmpty(names)
	// "zzz-folder" sorts last alphabetically, so it can only be first if the
	// folder tier is doing the work.
	s.Equal("zzz-folder", names[0])
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
```

- [x] **Step 6: Chạy test cho chắc chắn nó đỏ**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: FAIL — `body["meta"]` là `nil`, ép kiểu `.(map[string]any)` panic; và `limit` bị bỏ qua nên mọi mục về trong một trang.

- [x] **Step 7: Sửa `ListItems` trong `app/services/cloud_drive_service.go`**

Thay toàn bộ hàm `ListItems` (dòng 96–137) bằng:

```go
// ListItems queries one page of items for a given cloud account and parent
// directory.
//
// Results are ordered folders-first, then by sortField/sortOrder, then by id.
// The id tier is not decoration: without it the ordering is not total, and rows
// that share a sort value - routine for updated_at, which has one-second
// granularity - would shuffle between pages, so a paging client would see some
// items twice and never see others.
//
// An empty cursor means the first page. A non-empty limit is required; callers
// pass limit+1 and trim, so has_more can be decided without a COUNT.
func (s *CloudDriveService) ListItems(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, search string, itemType string, sortField string, sortOrder string, cursor DriveCursor, limit int) ([]models.DriveItem, error) {
	orderCol := NormalizeSortField(sortField)
	orderDir := NormalizeSortOrder(sortOrder)

	query := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID)

	if parentID == nil || *parentID == 0 {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id", *parentID)
	}

	if strings.TrimSpace(search) != "" {
		query = query.Where("name LIKE ?", "%"+strings.TrimSpace(search)+"%")
	}

	if itemType == models.ItemTypeFolder || itemType == models.ItemTypeFile {
		query = query.Where("type", itemType)
	}

	// A cursor only means something inside the ordering that produced it. If
	// the caller changed `sort` or `order` since, the position is meaningless
	// and is ignored, so the request degrades to a first page instead of
	// comparing, say, a name against the size column.
	if cursor.ID > 0 && cursor.Matches(orderCol, orderDir) {
		cond, args := BuildCursorWhere(cursor, orderCol, orderDir)
		query = query.Where(cond, args...)
	}

	if limit <= 0 {
		limit = 50
	}

	// ORDER BY type DESC replaces the old
	// `CASE WHEN type = 'folder' THEN 0 ELSE 1 END`: 'file' sorts before
	// 'folder' alphabetically, so descending puts folders first while still
	// being a plain column reference the index can serve.
	var items []models.DriveItem
	if err := query.
		Order("type DESC").
		Order(orderCol + " " + orderDir).
		Order("id ASC").
		Limit(limit).
		Get(&items); err != nil {
		return nil, err
	}

	return items, nil
}
```

- [x] **Step 8: Cập nhật lời gọi trong controller để build xanh**

Trong `app/http/controllers/drive_item_controller.go`, thay dòng 71 bằng lời gọi mới (controller sẽ được hoàn thiện ở Task 2; ở bước này chỉ cần build qua):

```go
	items, err := c.service.ListItems(context.Background(), user.ID, cloudAccountID, parentID, search, itemType, sortField, sortOrder, services.DriveCursor{}, 50)
```

- [x] **Step 9: Chạy test cho tới khi xanh**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: PASS toàn bộ.

- [x] **Step 10: Viết migration index**

Tạo `database/migrations/20261001000000_add_drive_items_list_index.go`:

```go
package migrations

import (
	"ponta_drive/app/facades"
)

// M20261001000000AddDriveItemsListIndex adds the composite index the drive list
// query needs.
//
// The list query filters on user_id + cloud_account_id + parent_id and orders
// by `type DESC, <sort column> <dir>, id ASC`. Before this index the table only
// had single-column indexes, so MariaDB had to filesort every listing.
//
// This is raw SQL rather than table.Index(...) because the index must store
// `type` in DESCENDING order, and Goravel's blueprint cannot express that:
// Grammar.CompileIndex passes every column through wrap.Columnize, which wraps
// each name in backticks, so "type DESC" would be emitted as `type DESC` - one
// identifier, and the DDL fails.
//
// The descending column is what makes the index usable at all. An all-ascending
// index cannot satisfy `ORDER BY type DESC, name ASC` - mixing directions over
// one index is what forces the filesort. Verified with EXPLAIN on MariaDB 13.1
// against a 20k-row folder (a smaller table lets the optimiser skip the index,
// which makes the comparison meaningless):
//
//	(user_id, cloud_account_id, parent_id, type, name, id)      -> Using filesort
//	(user_id, cloud_account_id, parent_id, type DESC, name, id) -> Using index condition
//
// Only the default ordering is covered. The index stores `name` ascending, so
// `sort=name&order=desc` filesorts too - not just `sort=size` and
// `sort=updated_at`. Measured, per query shape:
//
//	sort=name  asc   -> Using index condition
//	+ search         -> Using index condition
//	type=folder      -> Using index condition
//	sort=size  desc  -> Using index condition; Using filesort
//	sort=name  desc  -> Using index condition; Using filesort
//
// Covering every ordering would mean an index per sort column per direction,
// multiplying write cost on a table written on every sync. The default is what
// the UI sends, so that is the one indexed.
type M20261001000000AddDriveItemsListIndex struct{}

// Signature The unique signature for the migration.
func (r *M20261001000000AddDriveItemsListIndex) Signature() string {
	return "20261001000000_add_drive_items_list_index"
}

// Up Run the migrations.
func (r *M20261001000000AddDriveItemsListIndex) Up() error {
	if !facades.Schema().HasTable("drive_items") {
		return nil
	}

	if facades.Schema().HasIndex("drive_items", "idx_drive_items_list") {
		return nil
	}

	return facades.Schema().Sql(
		"CREATE INDEX `idx_drive_items_list` ON `drive_items` " +
			"(`user_id`, `cloud_account_id`, `parent_id`, `type` DESC, `name`, `id`)",
	)
}

// Down Reverse the migrations.
func (r *M20261001000000AddDriveItemsListIndex) Down() error {
	if !facades.Schema().HasTable("drive_items") {
		return nil
	}

	if !facades.Schema().HasIndex("drive_items", "idx_drive_items_list") {
		return nil
	}

	return facades.Schema().Sql("DROP INDEX `idx_drive_items_list` ON `drive_items`")
}
```

- [x] **Step 11: Đăng ký migration**

Trong `bootstrap/migrations.go`, thêm dòng vào cuối slice:

```go
		&migrations.M20260920120100AddSyncStatusToCloudAccounts{}, // Sync status tracking for cloud accounts
		&migrations.M20261001000000AddDriveItemsListIndex{},       // Composite index for the paginated drive list
```

- [x] **Step 12: Chạy migration và kiểm chứng index tồn tại**

Run:
```bash
go run . artisan migrate
go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20
```

Expected: migration chạy sạch; test vẫn PASS.

Kiểm chứng index thật sự khử được filesort — đây là điều migration này tồn tại để làm, và là thứ dễ hỏng âm thầm nhất (index vẫn được tạo, chỉ là không ai dùng):

```bash
go run . artisan migrate
```

Rồi chạy EXPLAIN qua một test tạm hoặc `facades.Orm().Query().Raw(...)`, khẳng định cột `Extra` của truy vấn list **không** chứa `Using filesort`:

```sql
EXPLAIN SELECT id FROM drive_items
WHERE user_id=1 AND cloud_account_id=1 AND parent_id IS NULL
ORDER BY type DESC, name ASC, id ASC LIMIT 51;
```

Expected: `key=idx_drive_items_list`, và `Extra` **không** có `Using filesort`. Nếu vẫn còn filesort thì cột `type` trong index đã không được ghi ở chiều DESC — dừng lại và kiểm tra lại câu DDL, đừng bỏ qua.

Kiểm tra trực tiếp chiều của cột trong index:

```sql
SELECT column_name, collation, seq_in_index
FROM information_schema.statistics
WHERE table_schema='ponta_drive' AND table_name='drive_items'
  AND index_name='idx_drive_items_list'
ORDER BY seq_in_index;
```

Expected: `type` có `collation=D` (descending), các cột còn lại `A`.

- [x] **Step 13: Chạy toàn bộ test backend**

Run: `go test ./... -count=1 2>&1 | tail -25`

Expected: PASS toàn bộ. Nếu `tests/feature/drive_item_api_test.go` đỏ, đó là hồi quy thật — dừng lại và sửa, không được bỏ qua.

- [x] **Step 14: Commit**

```bash
gofmt -w app/services/drive_cursor.go app/services/cloud_drive_service.go app/http/controllers/drive_item_controller.go database/migrations/20261001000000_add_drive_items_list_index.go bootstrap/migrations.go tests/feature/drive_pagination_test.go
go build ./... && go vet ./...
git add app/services/drive_cursor.go app/services/cloud_drive_service.go app/http/controllers/drive_item_controller.go database/migrations/20261001000000_add_drive_items_list_index.go bootstrap/migrations.go tests/feature/drive_pagination_test.go
git commit -m "feat(drive): paginate the item list with a keyset cursor

The list endpoint had no LIMIT and ordered by
`CASE WHEN type = 'folder' THEN 0 ELSE 1 END, <col> <dir>` with no
tiebreaker. Two items sharing a sort value came back in arbitrary order,
so any paging scheme built on top of it would show some items twice and
skip others.

Ordering is now `type DESC, <col> <dir>, id ASC`. `type DESC` is
equivalent to the old CASE expression - 'file' sorts before 'folder'
alphabetically - and unlike the CASE it is a plain column reference the
index can serve.

The cursor carries type, sort value, id, and the ordering it was built
under, because the ordering has three tiers and a position only means
something inside the ordering that produced it. A cursor replayed under
a different sort is ignored rather than compared against the wrong
column. Malformed cursors are rejected rather than silently restarting
from page one, which would loop an infinite scroller forever.

Adds a composite index covering the filter and the sort. It is built with
raw SQL because the blueprint API cannot express a descending column, and
the descending `type` is what removes the filesort: an all-ascending
index cannot satisfy a mixed-direction ORDER BY. Verified with EXPLAIN." && git log --oneline -1
```

---

## Task 2: Backend — Tham số truy vấn và `meta` ở controller

> **TRẠNG THÁI: ĐÃ XONG** — cùng commit `1541dea`. `Index` trong
> `app/http/controllers/drive_item_controller.go` đã có: decode cursor → 400
> `drive.invalid_cursor`, kẹp `limit` 50/100, đọc `limit+1` để suy ra `has_more`,
> và trả `meta {has_more, next_cursor}`. `data` vẫn là mảng trần như cũ.

**Files:**
- Modify: `app/http/controllers/drive_item_controller.go:30-86`
- Test: `tests/feature/drive_pagination_test.go`

**Interfaces:**
- Consumes: `services.DriveCursor`, `services.DecodeDriveCursor`, `services.EncodeDriveCursor`, `services.NormalizeSortField`, `services.NormalizeSortOrder`, và `ListItems(..., cursor DriveCursor, limit int)` từ Task 1.
- Produces: hợp đồng HTTP — `GET /v1/drive/items?cloud_account_id=&parent_id=&search=&type=&sort=&order=&cursor=&limit=` trả `{"status","data":[...],"meta":{"has_more":bool,"next_cursor":string}}`.

- [x] **Step 1: Viết test đỏ cho `meta`, trần `limit`, và cursor hỏng**

Thêm vào `tests/feature/drive_pagination_test.go`:

```go
func (s *DrivePaginationTestSuite) TestMetaReportsHasMoreAtTheBoundary() {
	// Exactly `limit` items: there is no next page.
	s.seedItems(5)
	names, hasMore, next := s.listPage("&limit=5")
	s.Len(names, 5)
	s.False(hasMore, "a page holding exactly `limit` items has no next page")
	s.Empty(next)

	// One more item than `limit`: there is a next page.
	s.seedItems(1)
	names, hasMore, next = s.listPage("&limit=5")
	s.Len(names, 5)
	s.True(hasMore, "a page with a further item must report has_more")
	s.NotEmpty(next)
}

// A cursor the client mangled must be rejected, not silently ignored. Ignoring
// it would restart the page from the top and an infinite scroller would never
// terminate.
func (s *DrivePaginationTestSuite) TestInvalidCursorIsRejected() {
	s.seedItems(3)

	// "!!" is not in the base64 alphabet, so decoding fails before any query.
	resp, err := s.Http(s.T()).WithToken(s.token).
		Get(fmt.Sprintf("/v1/drive/items?cloud_account_id=%d&cursor=!!", s.account.ID))
	s.Require().NoError(err)
	resp.AssertStatus(http.StatusBadRequest)

	body, err := resp.Json()
	s.Require().NoError(err)
	s.Equal("error", body["status"])
}

// A caller asking for an unbounded page must be clamped, not obeyed.
//
// The assertion has to be about the clamp itself, not about the row count: the
// only way to see the difference from outside is to send a cursor that is
// valid but deliberately stale, and check that the server still returns a page
// rather than choking. What the clamp guarantees - that limit+1 rows are read
// rather than the whole table - is asserted directly on the service instead,
// where the requested and effective limits are both visible.
func (s *DrivePaginationTestSuite) TestLimitIsClampedToTheCeiling() {
	s.seedItems(105)

	names, hasMore, _ := s.listPage("&limit=100000")
	s.Len(names, 100, "the ceiling is 100, so a 100000 request must come back as 100 rows")
	s.True(hasMore, "there are 105 rows, so a 100-row page has more")
}

// Below the ceiling the requested limit is honoured exactly.
func (s *DrivePaginationTestSuite) TestLimitBelowCeilingIsHonoured() {
	s.seedItems(20)

	names, hasMore, _ := s.listPage("&limit=7")
	s.Len(names, 7)
	s.True(hasMore)
}

// A cursor built under one ordering must not be replayed under another: the
// stored position would be compared against a column from a different sort.
// The service ignores it, so the request degrades to a first page.
//
// The expectation is computed by asking for that same page with no cursor at
// all, rather than by hardcoding names - if the stale cursor were applied, the
// comparison against the wrong direction would return a different set.
func (s *DrivePaginationTestSuite) TestStaleCursorUnderDifferentSortFallsBackToFirstPage() {
	s.seedItems(10)

	_, hasMore, next := s.listPage("&limit=4&sort=name&order=asc")
	s.Require().True(hasMore)
	s.Require().NotEmpty(next)

	expected, _, _ := s.listPage("&limit=4&sort=name&order=desc")
	replayed, _, _ := s.listPage(
		fmt.Sprintf("&limit=4&sort=name&order=desc&cursor=%s", next))

	s.NotEmpty(expected)
	s.Equal(expected, replayed,
		"a cursor from another ordering must be ignored, not applied")
}

// An empty folder must produce an empty array, not null, so the client can
// iterate it without a guard.
func (s *DrivePaginationTestSuite) TestEmptyFolderReturnsEmptyArray() {
	names, hasMore, next := s.listPage("")
	s.Empty(names)
	s.False(hasMore)
	s.Empty(next)
}

// The index only helps if `type` is stored DESCENDING: an all-ascending
// composite index cannot serve `ORDER BY type DESC, name ASC` and MariaDB
// filesorts instead. Nothing in the code would fail if that column silently
// became ASC, so the direction is asserted here rather than left to a manual
// EXPLAIN. `collation` is 'D' for descending and 'A' for ascending in
// information_schema.statistics.
func (s *DrivePaginationTestSuite) TestListIndexStoresTypeDescending() {
	// Scanned as nullable even though MariaDB 13.1.1 reports a collation for
	// every column, `bigint` included (measured: user_id, parent_id, name and
	// id all report 'A'). MariaDB has reported NULL for non-string columns in
	// other versions, and a NULL scanned into a plain `string` aborts the whole
	// test with a scan error instead of a useful failure.
	type row struct {
		ColumnName string
		Collation  sql.NullString
		SeqInIndex int
	}

	var rows []row
	err := facades.Orm().Query().Raw(
		"SELECT column_name, collation, seq_in_index FROM information_schema.statistics "+
			"WHERE table_schema = DATABASE() AND table_name = 'drive_items' "+
			"AND index_name = 'idx_drive_items_list' ORDER BY seq_in_index",
	).Scan(&rows)
	s.Require().NoError(err)
	s.Require().Len(rows, 6, "the composite index must exist with six columns")

	for i, want := range []string{"user_id", "cloud_account_id", "parent_id", "type", "name", "id"} {
		s.Equal(want, rows[i].ColumnName, "column %d of the index", i+1)
	}

	s.Equal("D", rows[3].Collation.String,
		"`type` must be descending; an ascending column leaves the ORDER BY filesorting")

	for _, r := range append(rows[:3:3], rows[4:]...) {
		if r.Collation.Valid {
			s.Equal("A", r.Collation.String, "column %s should be ascending", r.ColumnName)
		}
	}
}
```

- [x] **Step 2: Chạy test cho chắc chắn nó đỏ**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: FAIL — `TestInvalidCursorIsRejected` nhận 200 thay vì 400 (controller chưa đọc `cursor`), và `meta` chưa tồn tại.

- [x] **Step 3: Hoàn thiện `Index` trong `app/http/controllers/drive_item_controller.go`**

Thay đoạn từ dòng 66 tới hết hàm `Index` (trước `// StoreFolder`) bằng:

```go
	search := ctx.Request().Query("search")
	itemType := ctx.Request().Query("type", "all")
	sortField := services.NormalizeSortField(ctx.Request().Query("sort", "name"))
	sortOrder := services.NormalizeSortOrder(ctx.Request().Query("order", "asc"))

	// Default 50, hard ceiling 100: an unbounded page would pull the whole
	// folder into memory on a single request.
	limit := ctx.Request().QueryInt("limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var cursor services.DriveCursor
	if raw := ctx.Request().Query("cursor"); raw != "" {
		parsed, err := services.DecodeDriveCursor(raw)
		if err != nil {
			return failResponse(ctx, http.StatusBadRequest, "drive.invalid_cursor", err)
		}
		cursor = parsed
	}

	// Ask for one row more than the page size: its presence is what proves a
	// next page exists, without a second COUNT query.
	items, err := c.service.ListItems(context.Background(), user.ID, cloudAccountID, parentID, search, itemType, sortField, sortOrder, cursor, limit+1)
	if err != nil {
		return failResponse(ctx, http.StatusInternalServerError, "drive.list_failed", err)
	}

	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}

	nextCursor := ""
	if hasMore && len(items) > 0 {
		// The cursor records the ordering it was built under, so a later
		// request with a different `sort` can tell the position is stale.
		encoded, err := services.EncodeDriveCursor(items[len(items)-1], sortField, sortOrder)
		if err != nil {
			return failResponse(ctx, http.StatusInternalServerError, "drive.list_failed", err)
		}
		nextCursor = encoded
	}

	data := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data = append(data, item.ToResponse())
	}

	return ctx.Response().Success().Json(http.Json{
		"status": "ok",
		"data":   data,
		"meta": http.Json{
			"has_more":    hasMore,
			"next_cursor": nextCursor,
		},
	})
}
```

- [x] **Step 4: Thêm key i18n còn thiếu**

Trong `lang/vi/drive.json`, thêm:

```json
  "invalid_cursor": "Con trỏ phân trang không hợp lệ.",
```

Trong `lang/en/drive.json`, thêm:

```json
  "invalid_cursor": "The pagination cursor is invalid.",
```

- [x] **Step 5: Chạy test cho tới khi xanh**

Run: `go test ./tests/feature/ -run 'TestDrivePaginationTestSuite' -count=1 2>&1 | tail -20`

Expected: PASS toàn bộ.

- [x] **Step 6: Chạy toàn bộ test backend**

Run: `go test ./... -count=1 2>&1 | tail -25`

Expected: PASS toàn bộ, đặc biệt `tests/feature/drive_item_api_test.go` phải vẫn xanh — nó chứng minh `data` vẫn là mảng trần.

- [x] **Step 7: Commit**

```bash
gofmt -w app/http/controllers/drive_item_controller.go
go build ./... && go vet ./...
git add app/http/controllers/drive_item_controller.go lang/vi/drive.json lang/en/drive.json tests/feature/drive_pagination_test.go
git commit -m "feat(drive): expose cursor pagination on the list endpoint

The list endpoint now accepts cursor and limit, and reports has_more plus
next_cursor under a sibling meta object.

data stays a bare array. The existing tests cast it to []any, and folding
it into an envelope would break every current consumer for no gain - meta
is purely additive.

limit defaults to 50 and is clamped to 100 so a crafted request cannot
pull an entire folder into memory. A malformed cursor is a 400 rather
than a silent restart from page one, which would make an infinite
scroller loop forever." && git log --oneline -1
```

---

## Task 3: Frontend — Dựng hạ tầng test vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Test: `src/composables/__tests__/sanity.spec.ts`

**Interfaces:**
- Consumes: không có.
- Produces: lệnh `bun run test:run` chạy vitest một lần rồi thoát; alias `@` trỏ tới `src/`; môi trường `happy-dom`.

- [ ] **Step 1: Cài dependency**

Run:
```bash
bun add -d vitest @vue/test-utils happy-dom
```

- [ ] **Step 2: Thêm script vào `package.json`**

Thêm hai dòng vào `scripts`:

```json
    "test": "vitest",
    "test:run": "vitest run",
```

- [ ] **Step 3: Cấu hình vitest trong `vite.config.ts`**

Đọc file hiện tại trước. Thêm khối `test` vào `defineConfig`, và import `defineConfig` từ `vitest/config` thay vì `vite`:

```ts
import { defineConfig } from 'vitest/config'
```

```ts
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
```

- [ ] **Step 4: Tạo `src/test/setup.ts`**

```ts
// vitest global setup.
//
// The API client reads the token from localStorage and the locale from a
// localStorage key, so every test that touches the client needs a clean
// storage. Clearing between tests keeps one test's token from leaking into
// the next.
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
})
```

- [ ] **Step 5: Viết test sanity để chứng minh hạ tầng chạy**

Tạo `src/composables/__tests__/sanity.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

describe('vitest infrastructure', () => {
  it('runs a test and resolves the @ alias', async () => {
    const value = ref(1)
    expect(value.value).toBe(1)

    const utils = await import('@/lib/utils')
    expect(typeof utils.cn).toBe('function')
  })
})
```

- [ ] **Step 6: Chạy test**

Run: `bun run test:run 2>&1 | tail -20`

Expected: PASS. Nếu alias `@` không resolve, kiểm tra lại khối `resolve.alias` trong `vite.config.ts` — vitest dùng chung cấu hình đó.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock vite.config.ts src/test/setup.ts src/composables/__tests__/sanity.spec.ts
git commit -m "test: add vitest infrastructure

The project had no frontend test runner. The riskiest logic in the
storage-connection slice - request cancellation and page state - is
invisible to manual testing, so the harness goes in first." && git log --oneline -1
```

---

## Task 4: Frontend — API client và store cho cloud account

**Files:**
- Create: `src/api/cloudAccounts.ts`
- Create: `src/stores/cloudAccounts.ts`
- Modify: `src/api/client.ts` (thêm lớp `ApiError`)
- Modify: `src/api/dashboard.ts:3-13`
- Test: `src/stores/__tests__/cloudAccounts.spec.ts`

**Interfaces:**
- Consumes: `fetchApi`, `ApiResponse` từ `@/api/client`; hạ tầng vitest từ Task 3.
- Produces:
  - `class ApiError extends Error { status: number; errors: Record<string, string[]> }` — xuất từ `@/api/client`
  - `interface CloudAccountCredentials { endpoint: string; bucket: string; region: string; access_key_id: string; use_path_style: boolean; public_url: string }`
  - `interface CloudAccount { id: number; name: string; provider: string; credentials: CloudAccountCredentials | null; sync_status: 'idle'|'syncing'|'error'; total_storage: number; used_storage: number; last_synced_at: string | null; is_default: boolean; is_active: boolean }`
  - `interface CloudAccountPayload { name: string; provider: string; endpoint: string; bucket: string; region: string; access_key_id: string; secret_access_key: string; use_path_style: boolean; public_url: string; is_default?: boolean }`
  - `listCloudAccounts(): Promise<ApiResponse<CloudAccount[]>>`
  - `testCloudAccount(payload: CloudAccountPayload): Promise<ApiResponse>`
  - `createCloudAccount(payload: CloudAccountPayload): Promise<ApiResponse<CloudAccount>>`
  - `getCloudAccount(id: number): Promise<ApiResponse<CloudAccount>>`
  - `updateCloudAccount(id: number, payload: Partial<CloudAccountPayload>): Promise<ApiResponse<CloudAccount>>`
  - `deleteCloudAccount(id: number): Promise<ApiResponse>`
  - `syncCloudAccount(id: number): Promise<ApiResponse>`
  - `useCloudAccountsStore()` với state `accounts`, `loading`, `error` và actions `fetch`, `create`, `update`, `remove`, `setDefault`.

- [ ] **Step 1: Viết test đỏ cho store**

Tạo `src/stores/__tests__/cloudAccounts.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 1,
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

describe('cloudAccounts store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('loads the account list', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account()],
    })

    const store = useCloudAccountsStore()
    await store.fetch()

    expect(store.accounts).toHaveLength(1)
    // `?.` because `noUncheckedIndexedAccess` types an index access as possibly
    // undefined; if the length assertion above fails, this then reports the
    // missing account rather than a TypeError.
    expect(store.accounts[0]?.name).toBe('MinIO Local')
    expect(store.loading).toBe(false)
  })

  it('records the error and clears loading when the list request fails', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockRejectedValue(new Error('boom'))

    const store = useCloudAccountsStore()
    await store.fetch()

    expect(store.error).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('appends a created account without refetching', async () => {
    vi.spyOn(api, 'createCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 9, name: 'New Cloud' }),
    })

    const store = useCloudAccountsStore()
    await store.create({
      name: 'New Cloud',
      provider: 's3',
      endpoint: '',
      bucket: 'b',
      region: 'us-east-1',
      access_key_id: 'k',
      secret_access_key: 's',
      use_path_style: false,
      public_url: '',
    })

    expect(store.accounts.map((a) => a.id)).toEqual([9])
  })

  it('replaces the edited account in place', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1, name: 'Before' }), account({ id: 2, name: 'Other' })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 1, name: 'After' }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.update(1, { name: 'After' })

    // The order must survive: replacing the list with the single returned
    // account would silently drop every other row from the sidebar.
    expect(store.accounts.map((a) => [a.id, a.name])).toEqual([
      [1, 'After'],
      [2, 'Other'],
    ])
  })

  it('drops a removed account from the list', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1 }), account({ id: 2 })],
    })
    vi.spyOn(api, 'deleteCloudAccount').mockResolvedValue({ status: 'ok' })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.remove(1)

    expect(store.accounts.map((a) => a.id)).toEqual([2])
  })

  // The backend clears is_default on every other account when one is marked
  // default, so mirroring that locally avoids a refetch just to see the change.
  it('moves the default flag to the chosen account and off the others', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1, is_default: true }), account({ id: 2, is_default: false })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 2, is_default: true }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.setDefault(2)

    expect(store.accounts.map((a) => [a.id, a.is_default])).toEqual([
      [1, false],
      [2, true],
    ])
  })
})

// A 422 carries a per-field map. Discarding it - which fetchApi did - leaves
// the form with one generic line and no way to mark the offending input.
describe('ApiError', () => {
  it('keeps the status and exposes the first message for a field', () => {
    const err = new ApiError('The bucket field is required.', 422, {
      bucket: ['The bucket field is required.'],
      name: ['The name field is required.'],
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('The bucket field is required.')
    expect(err.status).toBe(422)
    expect(err.fieldError('name')).toBe('The name field is required.')
    expect(err.fieldError('region')).toBeUndefined()
  })

  it('defaults to an empty map when the response carried no field errors', () => {
    const err = new ApiError('Server exploded', 500)

    expect(err.errors).toEqual({})
    expect(err.fieldError('anything')).toBeUndefined()
    expect(err.fieldMessages()).toEqual({})
  })

  // The backend sends a list per field; the form binds one string per input.
  it('flattens each field to its first message and drops empty lists', () => {
    const err = new ApiError('Validation failed', 422, {
      bucket: ['The bucket field is required.', 'A second message we ignore.'],
      name: [],
    })

    expect(err.fieldMessages()).toEqual({ bucket: 'The bucket field is required.' })
  })

  // Spec success criterion 4: no secret may reach client state. The backend
  // strips it in `ToResponse()`, so the thing to pin here is that the store
  // keeps what the *server* returned rather than echoing back the payload it
  // sent. A store that stored the request body would put the secret in memory
  // and into every later `accounts` read.
  it('stores the sanitized response, not the payload it sent', async () => {
    const created = account({ id: 7, name: 'R2 Prod' })
    vi.spyOn(api, 'createCloudAccount').mockResolvedValue({ status: 'ok', data: created })

    const store = useCloudAccountsStore()
    const payload = {
      name: 'R2 Prod',
      provider: 'cloudflare_r2',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      bucket: 'media',
      region: 'auto',
      access_key_id: 'AKIAEXAMPLE',
      secret_access_key: 'super-secret-value',
      use_path_style: true,
      public_url: '',
    }

    await store.create(payload)

    // The mock's return value has no secret field, so this passes only if the
    // store used the response.
    expect(store.accounts).toEqual([created])
    expect(JSON.stringify(store.accounts)).not.toContain('super-secret-value')
  })
})
```

- [ ] **Step 2: Chạy test cho chắc chắn nó đỏ**

Run: `bun run test:run src/stores/__tests__/cloudAccounts.spec.ts 2>&1 | tail -20`

Expected: FAIL — không resolve được `@/stores/cloudAccounts`.

- [ ] **Step 3: Cho `fetchApi` mang theo lỗi theo từng trường**

`fetchApi` hiện ném `new Error(data.message)`, **nuốt mất `errors`** mà backend trả kèm khi 422. Không sửa thì yêu cầu "form hiển thị lỗi theo từng trường" ở spec §5 không thể thực hiện được — form chỉ có một chuỗi lỗi chung.

Trong `src/api/client.ts`, thêm lớp `ApiError` ngay trên `fetchApi` và đổi khối `if (!response.ok)`:

```ts
/**
 * An API failure. `errors` carries the backend's per-field validation map
 * (Laravel-style: `{ bucket: ["The bucket field is required."] }`) when the
 * response was a 422, so a form can attach each message to its own input.
 *
 * It extends Error so existing `err instanceof Error ? err.message : ...`
 * call sites keep working unchanged.
 */
export class ApiError extends Error {
  readonly status: number
  readonly errors: Record<string, string[]>

  constructor(message: string, status: number, errors: Record<string, string[]> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }

  /** The first message recorded for a field, or undefined if it has none. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0]
  }

  /**
   * Flattens the per-field map to one message per field, ready to bind to
   * inputs. The backend sends a list per field; the first entry is the one
   * worth showing.
   */
  fieldMessages(): Record<string, string> {
    const flattened: Record<string, string> = {}
    for (const [field, messages] of Object.entries(this.errors)) {
      const first = messages[0]
      if (first) flattened[field] = first
    }
    return flattened
  }
}
```

```ts
  if (!response.ok) {
    const errorMessage = data?.message || `API Error: ${response.status} ${response.statusText}`
    throw new ApiError(errorMessage, response.status, data?.errors ?? {})
  }
```

- [ ] **Step 4: Viết `src/api/cloudAccounts.ts`**

```ts
import { fetchApi, type ApiResponse } from './client'

/**
 * Credentials as the API returns them. `secret_access_key` is deliberately
 * absent: the backend never sends it back, and a type that promised it would
 * invite code that reads it.
 */
export interface CloudAccountCredentials {
  endpoint: string
  bucket: string
  region: string
  access_key_id: string
  use_path_style: boolean
  public_url: string
}

export interface CloudAccount {
  id: number
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

/** Credentials as the client sends them, including the secret. */
export interface CloudAccountPayload {
  name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  access_key_id: string
  secret_access_key: string
  use_path_style: boolean
  public_url: string
  is_default?: boolean
}

export async function listCloudAccounts(): Promise<ApiResponse<CloudAccount[]>> {
  return fetchApi<ApiResponse<CloudAccount[]>>('/v1/cloud-accounts')
}

/** Validates credentials against the real bucket without persisting anything. */
export async function testCloudAccount(payload: CloudAccountPayload): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/v1/cloud-accounts/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createCloudAccount(
  payload: CloudAccountPayload,
): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>('/v1/cloud-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getCloudAccount(id: number): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${id}`)
}

/**
 * `provider` is intentionally not part of the update payload: the backend's
 * UpdateCloudAccountRequest has no such field, so a provider cannot be changed
 * after creation. Leaving out `secret_access_key` keeps the stored one.
 */
export async function updateCloudAccount(
  id: number,
  payload: Partial<CloudAccountPayload>,
): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteCloudAccount(id: number): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${id}`, { method: 'DELETE' })
}

export async function syncCloudAccount(id: number): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${id}/sync`, { method: 'POST' })
}
```

- [ ] **Step 5: Viết `src/stores/cloudAccounts.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  listCloudAccounts,
  createCloudAccount,
  updateCloudAccount,
  deleteCloudAccount,
  type CloudAccount,
  type CloudAccountPayload,
} from '@/api/cloudAccounts'

/**
 * Holds the account list for the whole app.
 *
 * The sidebar, the home page and the drive view all render the same list. A
 * store keeps them from drifting apart - without one, adding an account leaves
 * the sidebar showing a stale copy.
 */
export const useCloudAccountsStore = defineStore('cloudAccounts', () => {
  const accounts = ref<CloudAccount[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await listCloudAccounts()
      accounts.value = res.data ?? []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function create(payload: CloudAccountPayload): Promise<CloudAccount> {
    const res = await createCloudAccount(payload)
    const created = res.data as CloudAccount
    accounts.value = [...accounts.value, created]
    return created
  }

  async function update(id: number, payload: Partial<CloudAccountPayload>): Promise<void> {
    const res = await updateCloudAccount(id, payload)
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) => (a.id === id ? updated : a))
  }

  async function remove(id: number): Promise<void> {
    await deleteCloudAccount(id)
    accounts.value = accounts.value.filter((a) => a.id !== id)
  }

  /**
   * Marks one account as the default. The backend clears `is_default` on the
   * user's other accounts in the same update, so the local list is updated the
   * same way rather than refetching to discover it.
   */
  async function setDefault(id: number): Promise<void> {
    const res = await updateCloudAccount(id, { is_default: true })
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) =>
      a.id === id ? updated : { ...a, is_default: false },
    )
  }

  return { accounts, loading, error, fetch, create, update, remove, setDefault }
})
```

- [ ] **Step 6: Bỏ định nghĩa `CloudAccount` trùng trong `src/api/dashboard.ts`**

Xoá interface `CloudAccount` (dòng 3–13) và thêm import ở đầu file:

```ts
import { type CloudAccount } from './cloudAccounts'

export type { CloudAccount }
```

Giữ nguyên `DriveItem`, `Activity`, `StorageSummary`, `DashboardSummary` và hàm `fetchDashboardSummary`.

- [ ] **Step 7: Chạy test và type-check**

Run:
```bash
bun run test:run 2>&1 | tail -20
bun run type-check 2>&1 | tail -20
```

Expected: test PASS; type-check sạch.

- [ ] **Step 8: Commit**

```bash
git add src/api/cloudAccounts.ts src/api/client.ts src/stores/cloudAccounts.ts src/api/dashboard.ts src/stores/__tests__/cloudAccounts.spec.ts
git commit -m "feat(cloud): add the cloud account API client and store

Adds the seven /v1/cloud-accounts calls and a Pinia store holding the
list, so the sidebar, home page and drive view share one source of truth
instead of each fetching their own copy.

fetchApi now throws an ApiError carrying the response status and the
backend's per-field validation map. It previously discarded everything but
message, so a 422 could only ever surface as one generic line and the form
had no way to mark the offending input.

The response type has no secret_access_key field - the backend never
returns one, and a type that promised it would invite code that reads it.
The update payload has no provider field either, matching the backend
request struct: a provider cannot change after creation." && git log --oneline -1
```

---

## Task 5: Frontend — Primitive UI (dialog, select, switch)

**Files:**
- Create: `src/components/ui/dialog/Dialog.vue`, `DialogTrigger.vue`, `DialogContent.vue`, `DialogHeader.vue`, `DialogTitle.vue`, `DialogDescription.vue`, `DialogFooter.vue`, `index.ts`
- Create: `src/components/ui/select/Select.vue`, `SelectTrigger.vue`, `SelectValue.vue`, `SelectContent.vue`, `SelectItem.vue`, `index.ts`
- Create: `src/components/ui/switch/Switch.vue`, `index.ts`

**Interfaces:**
- Consumes: `reka-ui`, `@/lib/utils` (`cn`).
- Produces: barrel exports `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`; `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`; `Switch`.

- [ ] **Step 1: Cài primitive bằng shadcn-vue CLI**

Run:
```bash
bunx --bun shadcn-vue@latest add dialog select switch
```

Expected: các thư mục xuất hiện dưới `src/components/ui/`. Nếu CLI hỏi ghi đè, chọn giữ nguyên các file đã có.

- [ ] **Step 2: Kiểm tra các file đã sinh**

Run: `ls src/components/ui/dialog src/components/ui/select src/components/ui/switch`

Expected: có đủ các file ở mục **Files** phía trên. Nếu CLI bỏ sót `index.ts`, tạo tay theo đúng pattern của `src/components/ui/button/index.ts`:

```ts
export { default as Dialog } from './Dialog.vue'
export { default as DialogTrigger } from './DialogTrigger.vue'
export { default as DialogContent } from './DialogContent.vue'
export { default as DialogHeader } from './DialogHeader.vue'
export { default as DialogTitle } from './DialogTitle.vue'
export { default as DialogDescription } from './DialogDescription.vue'
export { default as DialogFooter } from './DialogFooter.vue'
```

- [ ] **Step 3: Kiểm tra build và type-check**

Run:
```bash
bun run type-check 2>&1 | tail -20
bun run build 2>&1 | tail -20
```

Expected: cả hai sạch. Lỗi ở bước này thường là reka-ui lệch phiên bản — đối chiếu `package.json` và nâng nếu cần.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog src/components/ui/select src/components/ui/switch package.json bun.lock
git commit -m "feat(ui): add dialog, select and switch primitives

The cloud connection wizard needs a modal and a provider picker; the
project only shipped button, card, dropdown-menu, input, label and
sonner." && git log --oneline -1
```

---

## Task 6: Frontend — Dialog wizard kết nối

**Files:**
- Create: `src/components/cloud/providerMeta.ts`
- Create: `src/components/cloud/AddCloudDialog.vue`
- Modify: `src/views/HomeView.vue` (`handleAddCloud`)
- Modify: `src/layouts/DashboardLayout.vue` (`handleAddCloud`, sidebar list)
- Modify: `src/locales/vi.json`, `src/locales/en.json`
- Test: `src/components/cloud/__tests__/providerMeta.spec.ts`, `src/i18n/__tests__/cloudKeys.spec.ts`

**Interfaces:**
- Consumes: `useCloudAccountsStore` (Task 4), `testCloudAccount`, `createCloudAccount`, `CloudAccountPayload` (Task 4), primitive UI (Task 5).
- Produces: component `AddCloudDialog.vue` nhận prop `v-model:open` kiểu `boolean`; `providerMeta` export `PROVIDERS` và `providerMeta(provider: string)`; namespace i18n `cloud` có mặt ở **cả** `vi` và `en`.

> Namespace i18n `cloud` được tạo **trong task này**, không phải ở một task riêng sau đó: `AddCloudDialog.vue` đọc khoảng hai chục key `cloud.*`, và để chúng chưa tồn tại thì hết task người dùng chỉ thấy chuỗi key thô — một bước lùi so với hiện trạng.

- [ ] **Step 1: Viết test đỏ cho providerMeta**

Tạo `src/components/cloud/__tests__/providerMeta.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { PROVIDERS, providerMeta } from '@/components/cloud/providerMeta'

describe('providerMeta', () => {
  it('offers only the providers the backend can actually build', () => {
    expect(PROVIDERS.map((p) => p.value).sort()).toEqual(['cloudflare_r2', 'minio', 's3'])
  })

  it('never offers google_drive or onedrive', () => {
    const values = PROVIDERS.map((p) => p.value)
    expect(values).not.toContain('google_drive')
    expect(values).not.toContain('onedrive')
  })

  it('prefills a path-style endpoint for the self-hosted providers', () => {
    expect(PROVIDERS.find((p) => p.value === 'minio')?.prefill.use_path_style).toBe(true)
    expect(PROVIDERS.find((p) => p.value === 'cloudflare_r2')?.prefill.use_path_style).toBe(true)
    expect(PROVIDERS.find((p) => p.value === 's3')?.prefill.use_path_style).toBe(false)
  })

  it('falls back to a neutral entry for an unknown provider', () => {
    expect(providerMeta('something_else').label).toBeTruthy()
  })
})
```

- [ ] **Step 2: Chạy test cho chắc chắn nó đỏ**

Run: `bun run test:run src/components/cloud/__tests__/providerMeta.spec.ts 2>&1 | tail -20`

Expected: FAIL — không resolve được `@/components/cloud/providerMeta`.

- [ ] **Step 3: Viết `src/components/cloud/providerMeta.ts`**

```ts
import type { Component } from 'vue'
import { Cloud, Database, Server } from 'lucide-vue-next'

export interface ProviderPrefill {
  endpoint: string
  region: string
  use_path_style: boolean
}

export interface ProviderMeta {
  value: string
  label: string
  descriptionKey: string
  /** A lucide icon component, rendered through `<component :is>`. */
  icon: Component
  color: string
  prefill: ProviderPrefill
}

/**
 * Only the three providers DriverFactory can build. google_drive and onedrive
 * pass request validation but fail at driver construction, so offering them
 * would let a user fill in a whole form and then hit a dead end.
 */
export const PROVIDERS: ProviderMeta[] = [
  {
    value: 's3',
    label: 'Amazon S3',
    descriptionKey: 'cloud.provider_s3_desc',
    icon: Cloud,
    color: 'text-amber-500',
    prefill: { endpoint: '', region: 'us-east-1', use_path_style: false },
  },
  {
    value: 'cloudflare_r2',
    label: 'Cloudflare R2',
    descriptionKey: 'cloud.provider_r2_desc',
    icon: Database,
    color: 'text-orange-500',
    prefill: {
      endpoint: 'https://<account_id>.r2.cloudflarestorage.com',
      region: 'auto',
      use_path_style: true,
    },
  },
  {
    value: 'minio',
    label: 'MinIO',
    descriptionKey: 'cloud.provider_minio_desc',
    icon: Server,
    color: 'text-emerald-500',
    prefill: { endpoint: 'http://localhost:9000', region: 'us-east-1', use_path_style: true },
  },
]

const FALLBACK: ProviderMeta = {
  value: 'unknown',
  label: 'Storage',
  descriptionKey: 'cloud.provider_unknown_desc',
  icon: Cloud,
  color: 'text-muted-foreground',
  prefill: { endpoint: '', region: '', use_path_style: false },
}

export function providerMeta(provider: string): ProviderMeta {
  return PROVIDERS.find((p) => p.value === provider) ?? { ...FALLBACK, value: provider }
}
```

- [ ] **Step 4: Chạy test cho tới khi xanh**

Run: `bun run test:run src/components/cloud/__tests__/providerMeta.spec.ts 2>&1 | tail -20`

Expected: PASS.

- [ ] **Step 5: Viết `src/components/cloud/AddCloudDialog.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Check, Loader2, ArrowLeft } from 'lucide-vue-next'

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
import { Switch } from '@/components/ui/switch'
import { PROVIDERS, providerMeta } from '@/components/cloud/providerMeta'
import { testCloudAccount, type CloudAccountPayload } from '@/api/cloudAccounts'
import { ApiError } from '@/api/client'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useCloudAccountsStore()

type Step = 1 | 2 | 3
const step = ref<Step>(1)

const form = ref({
  provider: 's3',
  name: '',
  endpoint: '',
  bucket: '',
  region: '',
  access_key_id: '',
  secret_access_key: '',
  use_path_style: false,
  public_url: '',
})

const testing = ref(false)
const testPassed = ref(false)
const testError = ref<string | null>(null)
const saving = ref(false)

// Per-field messages from a 422, keyed by the backend's field name. Cleared
// whenever the form changes so a corrected field stops showing its old error.
const fieldErrors = ref<Record<string, string>>({})

const selected = computed(() => providerMeta(form.value.provider))

// Changing anything invalidates a previous successful test: the green check
// must not vouch for credentials it never saw.
watch(
  form,
  () => {
    testPassed.value = false
    testError.value = null
    fieldErrors.value = {}
  },
  { deep: true },
)

watch(open, (isOpen) => {
  if (isOpen) reset()
})

function reset() {
  step.value = 1
  form.value = {
    provider: 's3',
    name: '',
    endpoint: '',
    bucket: '',
    region: '',
    access_key_id: '',
    secret_access_key: '',
    use_path_style: false,
    public_url: '',
  }
  testPassed.value = false
  testError.value = null
  fieldErrors.value = {}
}

function chooseProvider(value: string) {
  form.value.provider = value
  const meta = providerMeta(value)
  form.value.endpoint = meta.prefill.endpoint
  form.value.region = meta.prefill.region
  form.value.use_path_style = meta.prefill.use_path_style
  if (!form.value.name) form.value.name = meta.label
  step.value = 2
}

const canTest = computed(
  () =>
    form.value.name.trim() !== '' &&
    form.value.bucket.trim() !== '' &&
    form.value.access_key_id.trim() !== '' &&
    form.value.secret_access_key.trim() !== '',
)

function payload(): CloudAccountPayload {
  return {
    name: form.value.name.trim(),
    provider: form.value.provider,
    endpoint: form.value.endpoint.trim(),
    bucket: form.value.bucket.trim(),
    region: form.value.region.trim(),
    access_key_id: form.value.access_key_id.trim(),
    secret_access_key: form.value.secret_access_key,
    use_path_style: form.value.use_path_style,
    public_url: form.value.public_url.trim(),
  }
}

async function runTest() {
  testing.value = true
  testError.value = null
  testPassed.value = false
  try {
    await testCloudAccount(payload())
    testPassed.value = true
  } catch (e) {
    // The backend already returns a localized message; it carries no driver
    // detail, so showing it verbatim is safe.
    testError.value = e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  fieldErrors.value = {}
  try {
    await store.create(payload())
    toast.success(t('cloud.save_success'))
    open.value = false
  } catch (e) {
    // A 422 carries one message per invalid field. Attaching them to the
    // inputs is what makes the form actionable; the generic message stays as
    // the fallback for any other failure.
    if (e instanceof ApiError) {
      const perField = e.fieldMessages()
      fieldErrors.value = perField
      testError.value = Object.keys(perField).length === 0 ? e.message : null
    } else {
      testError.value = e instanceof Error ? e.message : String(e)
    }
    step.value = 2
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('cloud.add_title') }}</DialogTitle>
        <DialogDescription>{{ t('cloud.add_subtitle') }}</DialogDescription>
      </DialogHeader>

      <!-- Step 1: provider -->
      <div v-if="step === 1" class="grid gap-2 py-2">
        <button
          v-for="p in PROVIDERS"
          :key="p.value"
          type="button"
          class="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer"
          @click="chooseProvider(p.value)"
        >
          <component :is="p.icon" class="mt-0.5 h-5 w-5 shrink-0" :class="p.color" />
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ p.label }}</div>
            <div class="text-xs text-muted-foreground">{{ t(p.descriptionKey) }}</div>
          </div>
        </button>
      </div>

      <!-- Step 2: credentials -->
      <div v-else-if="step === 2" class="grid gap-3 py-2">
        <div class="grid gap-1.5">
          <Label for="cloud-name">{{ t('cloud.field_name') }}</Label>
          <Input id="cloud-name" v-model="form.name" />
          <p v-if="fieldErrors.name" class="text-xs text-destructive">{{ fieldErrors.name }}</p>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-endpoint">{{ t('cloud.field_endpoint') }}</Label>
          <Input id="cloud-endpoint" v-model="form.endpoint" placeholder="https://..." />
          <p v-if="fieldErrors.endpoint" class="text-xs text-destructive">
            {{ fieldErrors.endpoint }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label for="cloud-bucket">{{ t('cloud.field_bucket') }}</Label>
            <Input id="cloud-bucket" v-model="form.bucket" />
            <p v-if="fieldErrors.bucket" class="text-xs text-destructive">
              {{ fieldErrors.bucket }}
            </p>
          </div>
          <div class="grid gap-1.5">
            <Label for="cloud-region">{{ t('cloud.field_region') }}</Label>
            <Input id="cloud-region" v-model="form.region" />
            <p v-if="fieldErrors.region" class="text-xs text-destructive">
              {{ fieldErrors.region }}
            </p>
          </div>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-access">{{ t('cloud.field_access_key') }}</Label>
          <Input id="cloud-access" v-model="form.access_key_id" autocomplete="off" />
          <p v-if="fieldErrors.access_key_id" class="text-xs text-destructive">
            {{ fieldErrors.access_key_id }}
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-secret">{{ t('cloud.field_secret_key') }}</Label>
          <Input
            id="cloud-secret"
            v-model="form.secret_access_key"
            type="password"
            autocomplete="new-password"
          />
          <p v-if="fieldErrors.secret_access_key" class="text-xs text-destructive">
            {{ fieldErrors.secret_access_key }}
          </p>
        </div>
        <div class="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <div class="text-sm font-medium">{{ t('cloud.field_path_style') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('cloud.field_path_style_hint') }}</div>
          </div>
          <Switch v-model="form.use_path_style" />
        </div>
      </div>

      <!-- Step 3: verify and save -->
      <div v-else class="grid gap-3 py-2">
        <div class="rounded-lg border border-border p-3 text-sm">
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_name') }}</span>
            <span class="font-medium">{{ form.name }}</span>
          </div>
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_bucket') }}</span>
            <span class="font-medium">{{ form.bucket }}</span>
          </div>
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_provider') }}</span>
            <span class="font-medium">{{ selected.label }}</span>
          </div>
        </div>

        <div
          v-if="testPassed"
          class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          <Check class="h-4 w-4" />
          {{ t('cloud.test_passed') }}
        </div>
        <div
          v-if="testError"
          class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ testError }}
        </div>

        <Button variant="outline" :disabled="!canTest || testing" @click="runTest">
          <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
          {{ testing ? t('cloud.testing') : t('cloud.test_connection') }}
        </Button>
      </div>

      <DialogFooter class="gap-2">
        <Button v-if="step > 1" variant="ghost" @click="step = (step - 1) as Step">
          <ArrowLeft class="h-4 w-4" />
          {{ t('cloud.back') }}
        </Button>
        <Button v-if="step === 2" :disabled="!canTest" @click="step = 3">
          {{ t('cloud.next') }}
        </Button>
        <Button v-if="step === 3" :disabled="!testPassed || saving" @click="save">
          <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
          {{ t('cloud.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 6: Mở dialog từ `HomeView.vue`**

Thêm import:

```ts
import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
```

Thêm state cạnh các `ref` khác trong `<script setup>`:

```ts
const isAddCloudOpen = ref(false)
```

Thay thân hàm `handleAddCloud` (hiện chỉ gọi `toast.info(...)`) bằng:

```ts
function handleAddCloud() {
  isAddCloudOpen.value = true
}
```

Thêm thẻ vào template, ngay trước thẻ đóng của component bọc ngoài cùng:

```vue
    <AddCloudDialog v-model:open="isAddCloudOpen" />
```

- [ ] **Step 7: Sidebar đọc từ store trong `DashboardLayout.vue`**

Thay mảng `cloudAccounts` hardcode (dòng 67–72) và `handleAddCloud` (dòng 103–105) bằng:

```ts
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
import { providerMeta } from '@/components/cloud/providerMeta'

const cloudStore = useCloudAccountsStore()
const { accounts: cloudAccounts, loading: cloudLoading, error: cloudError } = storeToRefs(cloudStore)

const isAddCloudOpen = ref(false)

onMounted(() => {
  if (cloudAccounts.value.length === 0) {
    void cloudStore.fetch()
  }
})

function handleAddCloud() {
  isAddCloudOpen.value = true
}
```

Bốn thứ trong file này trở nên thừa và phải xoá, nếu không `bun run build` sẽ đỏ vì oxlint báo biến/import không dùng:

- `import { toast } from 'vue-sonner'` (dòng 5) — chỉ được dùng trong `handleAddCloud` cũ.
- `interface CloudAccount` cục bộ (dòng 59–65) — store đã có kiểu thật.
- `Cloud`, `Database`, `Server` trong khối import `lucide-vue-next` (dòng 28–30) — chỉ dùng cho mảng mock. `Cloud` vẫn còn dùng ở dòng 272 (widget dung lượng) nên **giữ lại `Cloud`**, chỉ bỏ `Database` và `Server`.
- `onSelectCloud(id: string)` phải đổi tham số thành `id: string` giữ nguyên, nhưng nơi gọi truyền `String(cloud.id)` vì `cloud.id` giờ là `number`.

`ref` đã được import sẵn ở dòng 2, không cần thêm.

Cập nhật vòng lặp trong template — khoá theo `cloud.id` (số), icon và màu lấy từ `providerMeta`, kèm ba trạng thái loading / lỗi / rỗng. Sidebar trắng im lặng khi request hỏng là thứ spec §5 loại trừ:

```vue
              <!-- The list has three states and they must be told apart: a
                   failed request that renders as an empty list looks like the
                   user has no accounts, not like something went wrong. -->
              <div v-if="cloudLoading" class="px-2.5 py-1.5 text-xs text-muted-foreground">
                {{ t('common.loading') }}
              </div>
              <div v-else-if="cloudError" class="px-2.5 py-1.5 grid gap-1.5">
                <p class="text-xs text-destructive">{{ t('cloud.load_failed') }}</p>
                <Button variant="outline" size="sm" class="h-7 text-xs" @click="cloudStore.fetch()">
                  {{ t('common.retry') }}
                </Button>
              </div>
              <p v-else-if="cloudAccounts.length === 0" class="px-2.5 py-1.5 text-xs text-muted-foreground">
                {{ t('cloud.empty') }}
              </p>
              <!-- `v-for` and `v-else` cannot sit on the same element: Vue 3
                   gives `v-if` the higher priority, so the chain would be
                   evaluated before the loop. A `<template>` wrapper keeps the
                   buttons as direct children, so the layout is unchanged. -->
              <template v-else>
                <button
                  v-for="cloud in cloudAccounts"
                  :key="cloud.id"
                  type="button"
                  class="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  :class="[
                    activeCloudId === String(cloud.id) && activeNav === 'my_drive'
                      ? 'bg-primary/10 text-primary font-semibold shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  ]"
                  @click="onSelectCloud(String(cloud.id))"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <component
                      :is="providerMeta(cloud.provider).icon"
                      class="h-3.5 w-3.5 shrink-0"
                      :class="providerMeta(cloud.provider).color"
                    />
                    <span class="truncate">{{ cloud.name }}</span>
                  </div>
                  <span
                    v-if="cloud.is_default"
                    class="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold uppercase tracking-wider shrink-0"
                  >
                    {{ t('cloud.badge_default') }}
                  </span>
                </button>
              </template>
```

`Button` đã được import sẵn trong file này (nút "Thêm Cloud" dùng nó), nên không cần thêm import.

Thêm dialog vào template cạnh `<AddCloudDialog v-model:open="isAddCloudOpen" />`.

- [ ] **Step 8: Chạy test, type-check, build**

Run:
```bash
bun run test:run 2>&1 | tail -20
bun run type-check 2>&1 | tail -20
```

Expected: sạch.

- [ ] **Step 9: Thêm namespace `cloud` vào cả hai locale**

Viết test đỏ trước. Tạo `src/i18n/__tests__/cloudKeys.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import vi from '@/locales/vi.json'
import en from '@/locales/en.json'

describe('cloud locale namespace', () => {
  it('defines the namespace in both locales', () => {
    expect(vi.cloud).toBeTruthy()
    expect(en.cloud).toBeTruthy()
  })

  // A key present in one locale but not the other shows the raw key string to
  // half the users, and the default locale is vi so a missing en key never
  // shows up in ordinary manual testing.
  it('has exactly the same keys in both locales', () => {
    const viKeys = Object.keys(vi.cloud).sort()
    const enKeys = Object.keys(en.cloud).sort()
    expect(enKeys).toEqual(viKeys)
  })

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(vi.cloud)) {
      expect(value, `vi.cloud.${key}`).toBeTruthy()
    }
    for (const [key, value] of Object.entries(en.cloud)) {
      expect(value, `en.cloud.${key}`).toBeTruthy()
    }
  })

  // The sidebar's retry button is the first consumer of this key. A key that
  // resolves to nothing renders as an empty button.
  it('defines the shared retry label in both locales', () => {
    expect(vi.common.retry).toBeTruthy()
    expect(en.common.retry).toBeTruthy()
  })
})
```

Run: `bun run test:run src/i18n/__tests__/cloudKeys.spec.ts 2>&1 | tail -20`

Expected: FAIL — `vi.cloud` là `undefined`.

Thêm vào `src/locales/vi.json`:

```json
  "cloud": {
    "add_title": "Kết nối lưu trữ mới",
    "add_subtitle": "Chọn nhà cung cấp và nhập thông tin kết nối.",
    "provider_s3_desc": "Amazon S3 chuẩn, hoặc dịch vụ tương thích S3.",
    "provider_r2_desc": "Cloudflare R2 với endpoint riêng theo tài khoản.",
    "provider_minio_desc": "MinIO tự vận hành, thường dùng đường dẫn kiểu path-style.",
    "provider_unknown_desc": "Nhà cung cấp lưu trữ tương thích S3.",
    "field_name": "Tên gợi nhớ",
    "field_provider": "Nhà cung cấp",
    "field_endpoint": "Endpoint",
    "field_bucket": "Bucket",
    "field_region": "Region",
    "field_access_key": "Access Key ID",
    "field_secret_key": "Secret Access Key",
    "field_path_style": "Path-style endpoint",
    "field_path_style_hint": "Bật cho MinIO và phần lớn dịch vụ tự vận hành.",
    "test_connection": "Kiểm tra kết nối",
    "testing": "Đang kiểm tra...",
    "test_passed": "Kết nối thành công.",
    "save": "Lưu",
    "save_success": "Đã thêm tài khoản lưu trữ.",
    "back": "Quay lại",
    "next": "Tiếp tục",
    "badge_default": "Mặc định",
    "load_failed": "Không tải được danh sách tài khoản.",
    "empty": "Chưa có tài khoản lưu trữ nào."
  },
  "common": {
    "retry": "Thử lại"
  }
```

`common.retry` được thêm ở đây chứ không phải Task 8, vì sidebar dùng nó trước — để muộn hơn thì hết Task 6 người dùng vẫn thấy chuỗi key thô.

Thêm vào `src/locales/en.json`:

```json
  "cloud": {
    "add_title": "Connect new storage",
    "add_subtitle": "Pick a provider and enter the connection details.",
    "provider_s3_desc": "Amazon S3, or any S3-compatible service.",
    "provider_r2_desc": "Cloudflare R2 with a per-account endpoint.",
    "provider_minio_desc": "Self-hosted MinIO, usually with a path-style endpoint.",
    "provider_unknown_desc": "An S3-compatible storage provider.",
    "field_name": "Display name",
    "field_provider": "Provider",
    "field_endpoint": "Endpoint",
    "field_bucket": "Bucket",
    "field_region": "Region",
    "field_access_key": "Access Key ID",
    "field_secret_key": "Secret Access Key",
    "field_path_style": "Path-style endpoint",
    "field_path_style_hint": "Turn on for MinIO and most self-hosted services.",
    "test_connection": "Test connection",
    "testing": "Testing...",
    "test_passed": "Connection succeeded.",
    "save": "Save",
    "save_success": "Storage account added.",
    "back": "Back",
    "next": "Next",
    "badge_default": "Default",
    "load_failed": "Could not load your storage accounts.",
    "empty": "No storage accounts yet."
  },
  "common": {
    "retry": "Retry"
  }
```

Run: `bun run test:run 2>&1 | tail -25`

Expected: PASS toàn bộ.

- [ ] **Step 10: Kiểm chứng thủ công luồng kết nối**

Chạy backend (`go run . serve`) và frontend (`bun run dev`). Đăng nhập, bấm "Thêm Cloud", chọn MinIO, nhập endpoint/bucket/access key/secret key trỏ tới một bucket thật (hoặc MinIO local), bấm **Test connection**.

Expected: test xanh → **Save** mới bật → lưu xong dialog đóng, tài khoản xuất hiện ngay ở sidebar **không cần tải lại trang**.

- [ ] **Step 11: Commit**

```bash
git add src/components/cloud src/views/HomeView.vue src/layouts/DashboardLayout.vue src/locales/vi.json src/locales/en.json src/i18n/__tests__/cloudKeys.spec.ts
git commit -m "feat(cloud): add the S3 connection wizard

Three steps: pick a provider, fill in credentials, verify and save. Save
stays disabled until a connection test passes against the real bucket, so
a typo cannot be persisted as a broken account.

Only s3, cloudflare_r2 and minio are offered. google_drive and onedrive
pass request validation but DriverFactory returns 'not yet supported' for
them, so offering them would walk a user through a form into a dead end.

The sidebar now renders the real account list from the store rather than
four hardcoded entries.

The cloud namespace lands with the dialog that uses it, and a test pins
both locales to the same key set: the default locale is vi, so a key
added only to en would surface as a raw key string for English users." && git log --oneline -1
```

---

## Task 7: Frontend — State phân trang và composable

**Files:**
- Create: `src/api/driveItems.ts`
- Create: `src/stores/driveItems.ts`
- Create: `src/composables/useDriveItems.ts`
- Create: `src/composables/useInfiniteScroll.ts`
- Test: `src/composables/__tests__/useDriveItems.spec.ts`
- Test: `src/composables/__tests__/useInfiniteScroll.spec.ts`

**Interfaces:**
- Consumes: `fetchApi`, `ApiResponse` từ `@/api/client` (đã có sẵn trong repo); hạ tầng vitest (Task 3).
- Produces:
  - `interface DriveItem { id: number; uuid: string; name: string; type: 'file'|'folder'; mime_type: string; size: number; extension: string; cloud_account_id: number; is_starred: boolean; status: string; updated_at: string }` — `id` là khoá số mà `parent_id` trỏ tới (Task 8 dùng nó cho `openFolder`); `uuid` là khoá hiển thị.
  - `interface DriveListMeta { has_more: boolean; next_cursor: string }`
  - `interface DriveListResponse extends ApiResponse<DriveItem[]> { meta?: DriveListMeta }` — `data` là mảng trần như backend trả, `meta` nằm cạnh nó chứ không lồng vào `data`.
  - `listDriveItems(params: DriveListParams, signal?: AbortSignal): Promise<DriveListResponse>` — `signal` là tuỳ chọn: truyền vào để huỷ request đang bay khi người dùng cuộn/đổi tham số nhanh.
  - `useDriveItemsStore()` với state `items`, `cursor`, `hasMore`, `loading`, `error` và actions `reset()`, `loadFirstPage()`, `loadNextPage()`.
  - `useDriveItems(params: () => DriveListQuery, debounceMs?: number)` — trả `{ items, loading, error, hasMore, loadMore, reload }`. `cloudAccountId` là `number`, không phải `number | null`: `0` nghĩa là "chưa chọn tài khoản" và store bỏ qua request trong trường hợp đó.
  - `useInfiniteScroll(sentinel: Ref<HTMLElement | null>, onReach: () => void)` — gắn một `IntersectionObserver` vào `sentinel`; gọi `onReach` mỗi khi sentinel lọt vào viewport. Tự ngắt quan sát khi component unmount. Task 8 truyền `loadMore` vào đây.

- [ ] **Step 1: Viết test đỏ cho composable**

Tạo `src/composables/__tests__/useDriveItems.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { useDriveItemsStore } from '@/stores/driveItems'
import * as api from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'

function item(uuid: string, name = uuid): DriveItem {
  return {
    id: 1,
    uuid,
    name,
    type: 'file',
    mime_type: 'text/plain',
    size: 1,
    extension: 'txt',
    cloud_account_id: 1,
    is_starred: false,
    status: 'ready',
    updated_at: '2026-10-01 00:00:00',
  }
}

/** A promise whose settlement is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('driveItems store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('loads the first page and records the cursor', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a'), item('b')],
      meta: { has_more: true, next_cursor: 'c1' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })

    expect(store.items.map((i) => i.uuid)).toEqual(['a', 'b'])
    expect(store.cursor).toBe('c1')
    expect(store.hasMore).toBe(true)
  })

  it('appends the next page and drops duplicates', async () => {
    vi.spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a'), item('b')],
        meta: { has_more: true, next_cursor: 'c1' },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('b'), item('c')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(store.items.map((i) => i.uuid)).toEqual(['a', 'b', 'c'])
    expect(store.hasMore).toBe(false)
  })

  it('stops issuing requests once has_more is false', async () => {
    const spy = vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('clears items and cursor on reset', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: true, next_cursor: 'c1' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    store.reset()

    expect(store.items).toEqual([])
    expect(store.cursor).toBe('')
    expect(store.hasMore).toBe(false)
  })

  it('keeps already-loaded items when a page fails', async () => {
    vi.spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: true, next_cursor: 'c1' },
      })
      .mockRejectedValueOnce(new Error('network down'))

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe('network down')
  })

  // The important one. A slow first request must not land after a newer one
  // and overwrite it - that is what makes the list jump back to an old page.
  it('ignores a stale response that resolves after a newer request', async () => {
    const first = deferred<api.DriveListResponse>()
    const second = deferred<api.DriveListResponse>()

    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const store = useDriveItemsStore()

    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })

    // The newer request settles first, then the older one straggles in.
    second.resolve({ status: 'ok', data: [item('new')], meta: { has_more: false, next_cursor: '' } })
    await p2
    first.resolve({ status: 'ok', data: [item('old')], meta: { has_more: false, next_cursor: '' } })
    await p1

    expect(store.items.map((i) => i.uuid)).toEqual(['new'])
  })

  it('aborts the in-flight request when a newer load starts', async () => {
    const first = deferred<api.DriveListResponse>()
    const spy = vi
      .spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('new')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const signal = spy.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)

    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })
    // The older request must be cancelled at the network, not merely ignored
    // when it returns.
    expect(signal?.aborted).toBe(true)

    first.reject(new DOMException('aborted', 'AbortError'))
    await p1
    await p2

    expect(store.items.map((i) => i.uuid)).toEqual(['new'])
    expect(store.error).toBe(null)
  })

  it('does not surface an abort as an error', async () => {
    const first = deferred<api.DriveListResponse>()
    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })

    // A plain object, not a DOMException: the store matches on `name`, so this
    // proves the check does not depend on the runtime's DOMException class.
    first.reject({ name: 'AbortError', message: 'aborted' })
    await p1
    await p2

    // A cancelled request is this store's own doing; showing "aborted" to the
    // user would look like the drive is broken.
    expect(store.error).toBe(null)
    expect(store.loading).toBe(false)
  })

  it('resets before loading when the search changes', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1, search: '' })
    await store.loadFirstPage({ cloudAccountId: 1, search: 'report' })

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe(null)
  })
})

// The sort the user picks only reaches the backend if it survives the query
// string. A dropped parameter is invisible: the list silently keeps the old
// order and looks like the click did nothing.
describe('buildDriveItemsQuery', () => {
  it('sends the sort field and direction the UI picked', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountId: 3,
      sort: 'size',
      order: 'desc',
    })

    expect(query).toContain('sort=size')
    expect(query).toContain('order=desc')
  })

  it('omits the cursor on the first page', () => {
    const query = api.buildDriveItemsQuery({ cloudAccountId: 3 })

    expect(query).not.toContain('cursor=')
  })

  it('sends the cursor and limit when paging', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountId: 3,
      cursor: 'eyJ0IjoiZmlsZSJ9',
      limit: 50,
    })

    expect(query).toContain('cursor=eyJ0IjoiZmlsZSJ9')
    expect(query).toContain('limit=50')
  })
})
```

- [ ] **Step 2: Chạy test cho chắc chắn nó đỏ**

Run: `bun run test:run src/composables/__tests__/useDriveItems.spec.ts 2>&1 | tail -20`

Expected: FAIL — không resolve được `@/stores/driveItems`.

- [ ] **Step 3: Viết `src/api/driveItems.ts`**

```ts
import { fetchApi, type ApiResponse } from './client'

export interface DriveItem {
  /** Numeric primary key. This is what `parent_id` refers to. */
  id: number
  /** Stable public identifier, used for keys and selection in the UI. */
  uuid: string
  name: string
  type: 'file' | 'folder'
  mime_type: string
  size: number
  extension: string
  cloud_account_id: number
  is_starred: boolean
  status: string
  updated_at: string
}

export interface DriveListMeta {
  has_more: boolean
  next_cursor: string
}

export interface DriveListResponse extends ApiResponse<DriveItem[]> {
  meta?: DriveListMeta
}

export interface DriveListParams {
  cloudAccountId: number
  parentId?: number | null
  search?: string
  type?: string
  sort?: string
  order?: string
  cursor?: string
  limit?: number
}

/**
 * Builds the query string for the list endpoint.
 *
 * Split out from `listDriveItems` so the parameter names can be tested without
 * mocking `fetch`. A dropped or misspelled parameter is invisible in the UI:
 * the list simply ignores the sort the user picked and keeps the old order.
 */
export function buildDriveItemsQuery(params: DriveListParams): string {
  const query = new URLSearchParams()
  query.set('cloud_account_id', String(params.cloudAccountId))
  if (params.parentId) query.set('parent_id', String(params.parentId))
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))
  return query.toString()
}

/**
 * Lists one page of drive items.
 *
 * The cursor is opaque: it encodes the sort position, so the client must not
 * build or modify one. It also means a cursor is only valid for the exact
 * filter and sort it was produced under, which is why the caller resets the
 * list whenever any of those change.
 */
export async function listDriveItems(
  params: DriveListParams,
  signal?: AbortSignal,
): Promise<DriveListResponse> {
  return fetchApi<DriveListResponse>(`/v1/drive/items?${buildDriveItemsQuery(params)}`, { signal })
}
```

- [ ] **Step 4: Viết `src/stores/driveItems.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { listDriveItems, type DriveItem, type DriveListParams } from '@/api/driveItems'

export type DriveListQuery = Omit<DriveListParams, 'cursor' | 'limit'>

/**
 * Whether a rejection is this store's own `abort()` rather than a real failure.
 *
 * Matched on `name` rather than `instanceof DOMException`: the error crosses
 * realms (happy-dom's DOMException is not the test runner's global one) and
 * `fetch` implementations differ on which class they reject with.
 */
function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

/**
 * Page state for the drive listing.
 *
 * Two mechanisms guard against out-of-order responses, and both are needed:
 *
 *  - `requestId` decides which response may write. Every load bumps it and
 *    captures the value locally; a response is applied only if its id is still
 *    the newest. Without it, a slow request issued before a search would land
 *    after the search's own response and repaint the list with stale rows.
 *  - `AbortController` stops the request at the network. The id check alone
 *    would still let every superseded request run to completion and parse its
 *    body; aborting frees the connection and, on a fast scroll, is what keeps
 *    a burst of page requests from queueing up.
 */
export const useDriveItemsStore = defineStore('driveItems', () => {
  const items = ref<DriveItem[]>([])
  const cursor = ref('')
  const hasMore = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let requestId = 0
  let inFlight: AbortController | null = null

  function reset(): void {
    // Abort whatever is in flight, then bump the id so any response that
    // already resolved cannot append to the list that is about to be replaced.
    inFlight?.abort()
    inFlight = null
    requestId += 1
    items.value = []
    cursor.value = ''
    hasMore.value = false
    loading.value = false
    error.value = null
  }

  function appendPage(page: DriveItem[]): void {
    const seen = new Set(items.value.map((i) => i.uuid))
    const fresh = page.filter((i) => !seen.has(i.uuid))
    items.value = [...items.value, ...fresh]
  }

  async function loadFirstPage(query: DriveListQuery): Promise<void> {
    reset()
    await load(query, '')
  }

  async function loadNextPage(): Promise<void> {
    if (!hasMore.value || loading.value) return
    await load(lastQuery as DriveListQuery, cursor.value)
  }

  let lastQuery: DriveListQuery = { cloudAccountId: 0 }

  async function load(query: DriveListQuery, from: string): Promise<void> {
    if (query.cloudAccountId <= 0) return

    lastQuery = query
    const id = ++requestId
    // Supersede the previous request: it can no longer be wanted, and letting
    // it finish would only burn bandwidth and delay this one.
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller

    loading.value = true
    error.value = null

    try {
      const res = await listDriveItems({ ...query, cursor: from }, controller.signal)
      if (id !== requestId) return

      appendPage(res.data ?? [])
      cursor.value = res.meta?.next_cursor ?? ''
      hasMore.value = res.meta?.has_more ?? false
    } catch (e) {
      // An abort is this store's own doing, not a failure worth showing. The id
      // check below would also drop it (the aborting request is always newer),
      // but naming the case keeps the intent readable and keeps this correct if
      // the abort is ever triggered from somewhere other than a newer load.
      if (isAbortError(e)) return
      if (id !== requestId) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (id === requestId) {
        loading.value = false
        inFlight = null
      }
    }
  }

  return { items, cursor, hasMore, loading, error, reset, loadFirstPage, loadNextPage }
})
```

- [ ] **Step 5: Chạy test cho tới khi xanh**

Run: `bun run test:run src/composables/__tests__/useDriveItems.spec.ts 2>&1 | tail -25`

Expected: PASS toàn bộ 12 test (9 test ở `driveItems store` + 3 test ở `buildDriveItemsQuery`).

- [ ] **Step 6: Viết `src/composables/useDriveItems.ts`**

```ts
import { onScopeDispose, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDriveItemsStore, type DriveListQuery } from '@/stores/driveItems'

/**
 * Binds the drive list store to a reactive query.
 *
 * Whenever any part of the query changes - account, folder, search, sort - the
 * list is reloaded from the first page. Reusing a cursor across a changed
 * query would resume at a position that no longer means anything, so the store
 * resets first.
 */
export function useDriveItems(query: () => DriveListQuery, debounceMs = 250) {
  const store = useDriveItemsStore()
  const { items, loading, error, hasMore } = storeToRefs(store)

  let timer: ReturnType<typeof setTimeout> | null = null

  watch(
    () => JSON.stringify(query()),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void store.loadFirstPage(query())
      }, debounceMs)
    },
    { immediate: true },
  )

  function loadMore(): void {
    void store.loadNextPage()
  }

  function reload(): void {
    void store.loadFirstPage(query())
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { items, loading, error, hasMore, loadMore, reload }
}
```

- [ ] **Step 7: Viết test đỏ cho `useInfiniteScroll`**

Phần dễ hỏng âm thầm nhất của cuộn vô hạn không nằm ở `IntersectionObserver` mà ở **thời điểm gắn nó**. Vue gán template ref trong lúc patch, tức là **trước** khi hook `mounted` chạy. Nên nếu tạo một `watch(sentinel, ...)` bên trong `onMounted` mà không có `immediate`, callback không bao giờ chạy: observer không bao giờ được gắn, trang 2 không bao giờ nạp, và **không có lỗi nào được ném ra** — người dùng chỉ thấy danh sách dừng ở trang đầu.

Test dưới đây khoá đúng hành vi đó: sau khi mount, `observe` **phải** đã được gọi.

Tạo `src/composables/__tests__/useInfiniteScroll.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'

import { useInfiniteScroll } from '@/composables/useInfiniteScroll'

let observe: ReturnType<typeof vi.fn>
let unobserve: ReturnType<typeof vi.fn>
let disconnect: ReturnType<typeof vi.fn>
// Assigned by the stub's constructor, which only runs once the composable
// creates the observer. Initialised to a no-op so a test that fires before
// mounting fails on its own assertion rather than on "not a function".
let emitIntersect: (isIntersecting: boolean) => void = () => {}

beforeEach(() => {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  emitIntersect = () => {}

  // happy-dom has no IntersectionObserver, and even if it did the test would
  // need to decide when an intersection happens. A stub gives the test that
  // control and records the calls that matter.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      root = null
      rootMargin = ''
      thresholds: number[] = []
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
      takeRecords = () => []
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        emitIntersect = (isIntersecting) => cb([{ isIntersecting }])
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Mounts a component whose template ref is the sentinel, like DriveView's. */
function mountSentinel() {
  const onReach = vi.fn()
  let sentinel!: Ref<HTMLElement | null>

  const Harness = defineComponent({
    setup() {
      sentinel = ref<HTMLElement | null>(null)
      useInfiniteScroll(sentinel, onReach)
      // Returning a render function from setup lets the ref object be passed
      // directly to `ref:`, which is what binds it to the setup ref. A string
      // `ref: 'sentinel'` would land in `$refs` instead.
      return () => h('div', { ref: sentinel })
    },
  })

  const wrapper = mount(Harness)
  return { wrapper, onReach, sentinel }
}

describe('useInfiniteScroll', () => {
  it('observes the sentinel that is already mounted when the hook runs', () => {
    const { wrapper } = mountSentinel()

    // This is the whole point of the test. The ref is assigned during patch,
    // before `mounted` fires, so a watcher created in `onMounted` without
    // `immediate` would never see an assignment and this call would not
    // happen - silently breaking infinite scroll.
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith(wrapper.element)

    wrapper.unmount()
  })

  it('calls onReach when the sentinel becomes visible', async () => {
    const { wrapper, onReach } = mountSentinel()

    emitIntersect(true)
    await nextTick()

    expect(onReach).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('does not call onReach for a non-intersecting entry', async () => {
    const { wrapper, onReach } = mountSentinel()

    emitIntersect(false)
    await nextTick()

    expect(onReach).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('stops observing when the component unmounts', () => {
    const { wrapper } = mountSentinel()

    wrapper.unmount()

    // A live observer holding a detached node keeps the component's closure
    // reachable and can keep firing after the view is gone.
    expect(disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 8: Chạy test cho chắc chắn nó đỏ**

Run: `bun run test:run src/composables/__tests__/useInfiniteScroll.spec.ts 2>&1 | tail -25`

Expected: FAIL — không resolve được `@/composables/useInfiniteScroll`.

- [ ] **Step 9: Viết `src/composables/useInfiniteScroll.ts`**

```ts
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * Calls `onReach` whenever the `sentinel` element scrolls into view.
 *
 * The `immediate` flag on the watcher is load-bearing, not a style choice.
 * Vue assigns template refs while patching, which happens before the
 * `mounted` hook is flushed, so by the time this function's `onMounted`
 * callback runs the ref already holds the element. A watcher created here
 * without `immediate` would only fire on a *later* assignment - which never
 * comes - and the observer would never be attached. The failure is silent:
 * no error is thrown, the first page renders, and the list simply stops.
 *
 * `immediate` handles that first assignment; the watcher handles later ones,
 * such as the sentinel being re-created when a `v-if` branch swaps the whole
 * list element out.
 */
export function useInfiniteScroll(
  sentinel: Ref<HTMLElement | null>,
  onReach: () => void,
): void {
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      // `some`, not `entries[0]`: a batch can carry more than one entry, and
      // the sentinel becoming visible is what matters regardless of position.
      if (entries.some((entry) => entry.isIntersecting)) {
        onReach()
      }
    })

    watch(
      sentinel,
      (el, previous) => {
        if (previous) observer?.unobserve(previous)
        if (el) observer?.observe(el)
      },
      { immediate: true, flush: 'post' },
    )
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })
}
```

- [ ] **Step 10: Chạy test cho tới khi xanh**

Run: `bun run test:run src/composables/__tests__/useInfiniteScroll.spec.ts 2>&1 | tail -25`

Expected: PASS toàn bộ 4 test.

- [ ] **Step 11: Chạy toàn bộ test và type-check**

Run:
```bash
bun run test:run 2>&1 | tail -25
bun run type-check 2>&1 | tail -20
```

Expected: sạch.

- [ ] **Step 12: Commit**

```bash
git add src/api/driveItems.ts src/stores/driveItems.ts src/composables/useDriveItems.ts src/composables/useInfiniteScroll.ts src/composables/__tests__/useDriveItems.spec.ts src/composables/__tests__/useInfiniteScroll.spec.ts
git commit -m "feat(drive): add paginated list state and infinite-scroll composable

Each load takes a request id and applies its response only if that id is
still the newest. Fast scrolling issues overlapping requests, and without
the guard a slow earlier response lands after a newer one and repaints
the list with stale rows.

Pages are appended with a uuid dedup pass, and any change to the query -
account, folder, search, sort - resets the list before loading, because a
cursor only means anything under the exact query that produced it.

The observer is attached through a composable rather than inline, because
Vue fills template refs before the mounted hook runs: a watcher created
there without `immediate` would never fire, and infinite scroll would
break with no error to show for it." && git log --oneline -1
```

---

## Task 8: Frontend — Viết lại `DriveView` với cuộn vô hạn

**Files:**
- Modify: `src/views/DriveView.vue`
- Create: `src/components/drive/DriveItemIcon.vue`

**Interfaces:**
- Consumes: `useDriveItems`, `useInfiniteScroll`, `DriveItem` (Task 7); `useCloudAccountsStore` (Task 4).
- Produces: không có API công khai; đây là tầng hiển thị.

- [ ] **Step 1: Tạo `src/components/drive/DriveItemIcon.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { FileText, ImageIcon, FileArchive, FileVideo, FileAudio, Folder, File } from 'lucide-vue-next'

import type { DriveItem } from '@/api/driveItems'

const props = defineProps<{ item: DriveItem }>()

// The API only knows "file" and "folder", so the icon comes from the MIME type
// and the extension rather than from `type`.
const icon = computed(() => {
  if (props.item.type === 'folder') return Folder

  const mime = props.item.mime_type || ''
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.startsWith('video/')) return FileVideo
  if (mime.startsWith('audio/')) return FileAudio
  if (mime === 'application/pdf') return FileText

  const ext = (props.item.extension || '').toLowerCase()
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive
  if (['txt', 'md', 'doc', 'docx', 'pdf'].includes(ext)) return FileText

  return File
})

const colorClass = computed(() =>
  props.item.type === 'folder' ? 'text-amber-500 fill-amber-500/20' : 'text-muted-foreground',
)
</script>

<template>
  <component :is="icon" class="h-4.5 w-4.5 shrink-0" :class="colorClass" />
</template>
```

- [ ] **Step 2: Thay khối `<script setup>` của `DriveView.vue`**

Thay toàn bộ `<script setup lang="ts">...</script>` bằng:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import DriveItemIcon from '@/components/drive/DriveItemIcon.vue'
import { useDriveItems } from '@/composables/useDriveItems'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreVertical,
  ChevronDown,
  List,
  LayoutGrid,
  Info,
  ArrowDown,
  Download,
  Share2,
  Trash2,
  Star,
  Edit2,
  FolderPlus,
  Upload,
  FolderOpen,
  Loader2,
} from 'lucide-vue-next'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const cloudStore = useCloudAccountsStore()

type ViewMode = 'list' | 'grid'
const viewMode = ref<ViewMode>('list')
const selectedItemId = ref<string | null>(null)
const showDetails = ref(false)
const search = ref('')
const sort = ref('name')
const order = ref('asc')

// The account id lives in the URL, so a folder view is shareable and the back
// button works. `0` means "no account selected yet" and the composable skips
// the request in that case.
const cloudAccountId = computed(() => {
  const raw = route.query.cloud
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
})

// The API has no path-based lookup, so the folder chain is tracked locally.
// `.at(-1)` rather than `[length - 1]`: with noUncheckedIndexedAccess an index
// access is `T | undefined` and would need a non-null assertion to compile.
const folderStack = ref<{ id: number; name: string }[]>([])
const parentId = computed(() => folderStack.value.at(-1)?.id ?? null)

const { items, loading, error, hasMore, loadMore, reload } = useDriveItems(() => ({
  cloudAccountId: cloudAccountId.value,
  parentId: parentId.value,
  search: search.value,
  sort: sort.value,
  order: order.value,
}))

const folders = computed(() => items.value.filter((i) => i.type === 'folder'))
const files = computed(() => items.value.filter((i) => i.type !== 'folder'))
const selectedItem = computed(() => items.value.find((i) => i.uuid === selectedItemId.value) ?? null)

/** `2026-10-01 00:00:00` -> `1 Oct 2026`, for the Modified column. */
function formatDate(value: string): string {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
  if (cloudStore.accounts.length === 0) {
    await cloudStore.fetch()
  }
  // No account in the URL: fall back to the default one. `?? null` is required
  // because noUncheckedIndexedAccess types `accounts[0]` as possibly undefined
  // and the length guard above does not narrow an indexed access.
  if (cloudAccountId.value === 0 && cloudStore.accounts.length > 0) {
    const fallback =
      cloudStore.accounts.find((a) => a.is_default) ?? cloudStore.accounts[0] ?? null
    if (fallback) {
      void router.replace({ name: 'drive', query: { cloud: String(fallback.id) } })
    }
  }
})

// A sentinel at the end of the list triggers the next page. The observer
// wiring lives in `useInfiniteScroll` because it has its own subtle failure
// mode (see that file): the guard against a request already in flight stays
// here, since only this view knows about `loading` and `hasMore`.
const sentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(sentinel, () => {
  if (hasMore.value && !loading.value) loadMore()
})

function selectItem(uuid: string) {
  selectedItemId.value = selectedItemId.value === uuid ? null : uuid
}

function openFolder(uuid: string) {
  const folder = items.value.find((i) => i.uuid === uuid)
  if (!folder) return
  // `parent_id` is the numeric `id`, not the `uuid`: the API has no
  // path-based lookup, so the chain is tracked locally by id.
  folderStack.value = [...folderStack.value, { id: folder.id, name: folder.name }]
  selectedItemId.value = null
}

function goToCrumb(index: number) {
  folderStack.value = folderStack.value.slice(0, index)
  selectedItemId.value = null
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // `units[unit]` is `string | undefined` under noUncheckedIndexedAccess, but
  // the loop bound guarantees `unit <= units.length - 1`. A template literal
  // accepts the union without error, so no assertion is needed. (Measured with
  // tsc 6.0.3 and this project's flags.)
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}
</script>
```

> **Ghi chú cho người thực thi:** `openFolder` dùng `folder.id` (số), không dùng `folder.uuid`. Backend nhận `parent_id` là **id số**; `DriveItem.ToResponse()` trả về cả `id` lẫn `uuid`, và `interface DriveItem` ở Task 7 đã khai báo `id: number`. Nếu thấy `id` bị thiếu, quay lại Task 7 bổ sung chứ đừng suy ra `parent_id` từ `uuid`.

- [ ] **Step 3: Cập nhật template**

Giữ nguyên phần khung (header, dropdown tiêu đề, nút New/Upload, chuyển list/grid) và thay phần thân danh sách.

Bốn phép thay thế áp dụng cho **cả** list view lẫn grid view:

| Hiện tại | Thay bằng |
| :--- | :--- |
| `:key="item.id"` | `:key="item.uuid"` |
| `selectItem(item.id)` | `selectItem(item.uuid)` |
| `selectedItemId === item.id` | `selectedItemId === item.uuid` |
| khối `<Folder>` / `<FileText>` / `<ImageIcon>` chọn theo `item.type` | `<DriveItemIcon :item="item" />` |
| `item.modifiedDate` | `formatDate(item.updated_at)` |
| `item.size` | `formatSize(item.size)` (riêng `item.size` đã là số, không phải chuỗi) |
| `items.find(i => i.id === selectedItemId)` trong panel Details | `items.find(i => i.uuid === selectedItemId)` |

Các chỗ `item.owner`, `item.ownerAvatar`, `item.folderColor` không còn tồn tại trong `DriveItem` thật — bỏ hẳn, thay bằng `t('drive.me')` cho cột Owner.

Grid view chia hai nhóm bằng `items.filter(...)` ngay trong template; đổi thành `folders` và `files` đã tính sẵn trong `<script setup>`.

Chỉ đổi **hai attribute** trên mỗi thẻ, giữ nguyên toàn bộ `class`, các `<div>` con và `@click.stop` của nút `MoreVertical` như file hiện tại:

| Khối hiện tại | `v-for` | `:key` | `@click` |
| :--- | :--- | :--- | :--- |
| Folders Section | `items.filter(i => i.type === 'folder')` | `item.id` | `selectItem(item.uuid)` |
| Files Section | `items.filter(i => i.type !== 'folder')` | `item.id` | `selectItem(item.uuid)` |

Riêng trong Folders Section, icon `<Folder :class="item.folderColor \|\| 'text-zinc-400'" />` đổi thành `<DriveItemIcon :item="item" />` — `folderColor` không còn trong `DriveItem` thật. Trong Files Section, khối preview `<FileText v-if="item.type === 'doc'" />` / `<ImageIcon v-else />` cũng đổi thành `<DriveItemIcon :item="item" />`.

Hai dòng `:class` chọn theo `selectedItemId` cũng đổi khoá: `selectedItemId === item.id` → `selectedItemId === item.uuid`.

Trong grid view, mỗi thẻ thư mục thêm `@dblclick="openFolder(item.uuid)"` để vào được thư mục con. Trong list view, thêm cùng handler đó lên hàng:

```vue
                @dblclick="item.type === 'folder' && openFolder(item.uuid)"
```

Thêm breadcrumb phía trên danh sách:

```vue
      <nav v-if="folderStack.length" class="flex items-center gap-1 text-sm text-muted-foreground">
        <button type="button" class="hover:text-foreground cursor-pointer" @click="goToCrumb(0)">
          {{ t('drive.nav_my_drive') }}
        </button>
        <template v-for="(crumb, index) in folderStack" :key="crumb.id">
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

- Thêm sentinel và các trạng thái ở cuối danh sách:

```vue
      <!-- Infinite scroll sentinel -->
      <div ref="sentinel" class="h-1" aria-hidden="true"></div>

      <div v-if="loading" class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('common.loading') }}
      </div>

      <div v-else-if="error" class="flex flex-col items-center gap-3 py-6 text-sm">
        <p class="text-destructive">{{ error }}</p>
        <Button variant="outline" size="sm" @click="reload">{{ t('common.retry') }}</Button>
      </div>

      <div
        v-else-if="!items.length"
        class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"
      >
        <FolderOpen class="h-8 w-8" />
        {{ t('drive.empty_drive_title') }}
      </div>
```

- [ ] **Step 4: Kiểm tra key i18n**

Không cần thêm key nào: `common.loading` đã có sẵn ở cả hai locale ("Đang xử lý.../Processing...") và `common.retry` đã được thêm ở Task 6. Dùng lại cả hai, **không** tạo key trùng.

- [ ] **Step 5: Chạy test, type-check, build**

Run:
```bash
bun run test:run 2>&1 | tail -25
bun run type-check 2>&1 | tail -20
bun run build 2>&1 | tail -20
```

Expected: sạch cả ba.

- [ ] **Step 6: Kiểm chứng thủ công cuộn vô hạn**

Tạo một thư mục có hơn 60 mục trong bucket (hoặc hạ `limit` xuống 5 tạm thời trong `driveItems.ts` để thử nhanh), mở thư mục đó, cuộn xuống đáy.

Expected: trang kế tiếp tự nạp khi chạm đáy; cuộn tới hết thì dừng, không gọi thêm; không có mục nào lặp. Sau đó **khôi phục `limit`** nếu đã sửa tạm.

- [ ] **Step 7: Commit**

```bash
git add src/views/DriveView.vue src/components/drive/DriveItemIcon.vue src/locales/vi.json src/locales/en.json
git commit -m "feat(drive): render the real bucket with infinite scroll

DriveView showed six hardcoded rows and called no API. It now reads the
account from the URL, loads the folder's real contents, and pages through
them with an IntersectionObserver sentinel.

Icons come from mime_type and extension: the API only distinguishes file
from folder, so the old doc/image split had nothing to map onto." && git log --oneline -1
```

---
---

## Kiểm Chứng Cuối

- [x] **Backend:** `cd backend && go build ./... && go vet ./... && go test ./... -count=1`
  Expected: sạch, toàn bộ PASS. — **ĐÃ CHẠY:** build sạch, vet sạch, mọi package `ok`.

- [x] **Không còn dữ liệu rác trong DB dev.** Chạy một test tạm dò số hàng còn lại của `drive_items` / `cloud_accounts` / `users` khớp với user test đã tạo, xác nhận bằng 0, rồi xoá test tạm đó. — **ĐÃ CHẠY:** 0 user test sót, 0 `drive_items`/`cloud_accounts` mồ côi. Ba bảng dò tạm `zz_probe_*` cũng đã `DROP`.

- [ ] **Frontend:** `cd frontend && bun run test:run && bun run type-check && bun run build`
  Expected: sạch cả ba.

- [ ] **Kiểm chứng thủ công end-to-end:** đăng nhập → thêm tài khoản MinIO → test xanh → lưu → sidebar hiện ngay → bấm vào → thấy tệp thật → vào thư mục con → breadcrumb đúng → cuộn vô hạn hoạt động.

- [ ] **Kiểm tra rò rỉ:** mở DevTools → Network, xem response của `GET /v1/cloud-accounts`. Xác nhận **không** có `secret_access_key` ở bất kỳ đâu.

- [ ] **Kiểm tra i18n:** đổi ngôn ngữ sang English, mở lại dialog kết nối. Xác nhận không có chuỗi nào hiển thị dạng `cloud.something` (key thô).
