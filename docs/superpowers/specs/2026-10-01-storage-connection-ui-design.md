# Thiết Kế: Kết Nối Storage Đầu Tiên (S3 & S3-Compatible) — Giao Diện & Duyệt Tệp

- **Ngày tạo:** 2026-10-01
- **Trạng thái:** Chờ phê duyệt (Draft)
- **Phạm vi:** Slice A — Kết nối + Duyệt tệp
- **Công nghệ nền tảng:** Vue 3.5, TypeScript, Vite, Tailwind CSS 4, shadcn-vue / reka-ui, Pinia, vue-i18n 11, vue-router; Go 1.25, Goravel v1.18.0, MariaDB
- **Spec liên quan:** [`2026-09-20-multi-cloud-s3-backend-design.md`](./2026-09-20-multi-cloud-s3-backend-design.md) (tầng backend đã hiện thực xong)

---

## 1. Tổng Quan & Mục Tiêu

Spec nền `2026-09-20-multi-cloud-s3-backend-design.md` đã hoàn tất **toàn bộ tầng backend**: model `CloudAccount`, `DriverFactory`, `S3Driver`, mã hoá AES-256 credentials, và 7 endpoint `/v1/cloud-accounts` (Index, Test, Store, Show, Update, Destroy, Sync).

Tuy nhiên **người dùng chưa thể chạm tới bất kỳ phần nào trong đó**. Toàn bộ giao diện hiện là dữ liệu giả:

| Vị trí | Hiện trạng |
| :--- | :--- |
| `src/api/` | Chỉ có `client.ts` và `dashboard.ts`. **Không có client nào cho cloud account.** |
| `DashboardLayout.vue` | Mảng `cloudAccounts` **hardcode 4 tài khoản giả** (Google Drive, OneDrive, Cloudflare R2, Ponta Storage). |
| `DriveView.vue` | Mảng `items` **hardcode 6 mục giả**. Không gọi API nào. |
| `HomeView.vue` | Gọi `/v1/dashboard/summary` thật, nhưng nút "Thêm Cloud" chỉ hiện toast "tính năng đang phát triển". |
| `src/components/ui/` | Có Button, Card, DropdownMenu, Input, Label, Sonner. **Thiếu Dialog, Select, Switch.** |

### Mục tiêu của slice này

Người dùng hoàn thành được **trọn vòng** sau, không cần thao tác API thủ công:

> Thêm tài khoản S3 → bấm *Test connection* thấy xanh → lưu → thấy tài khoản xuất hiện ở sidebar → bấm vào → duyệt được thư mục và tệp thật trong bucket.

### Tiêu chí thành công

1. Thêm được một tài khoản S3 / Cloudflare R2 / MinIO từ UI, có kiểm tra kết nối trước khi lưu.
2. Sidebar và trang chủ hiển thị **danh sách tài khoản thật** từ `GET /v1/cloud-accounts`, không còn dữ liệu giả.
3. `DriveView` duyệt được thư mục thật, đi vào/ra thư mục con, cuộn vô hạn khi thư mục đông.
4. Không có `secret_access_key` nào xuất hiện trong bất kỳ response hay state phía client.

### Ngoài phạm vi (thuộc Slice B)

- **Đồng bộ (Sync) và realtime.** Slice này **không có nút Sync**. Backend hiện chạy sync đồng bộ (queue driver `sync` gọi thẳng `job.Handle()` trong request), nên không có khoảng thời gian "đang sync" để quan sát. Slice B sẽ đổi queue driver sang `database`, thêm worker, Redis pub/sub và kênh realtime.
- Upload, tải xuống, chia sẻ, đổi tên, xoá từ UI.
- Google Drive / Microsoft OneDrive (backend `DriverFactory` chưa hỗ trợ).
- Mục "Recent" / "Starred" ở sidebar.

---

## 2. Ràng Buộc Đã Kiểm Chứng

Các điểm dưới đây đã được đọc trực tiếp từ source, không phải giả định:

1. **Backend không cần đổi API** cho luồng kết nối. `POST /v1/cloud-accounts/test` thực hiện gọi S3 thật (`driver.ListObjects(ctx, "", "", 1)`) và **không ghi DB**.
2. **`UpdateCloudAccountRequest` không có trường `provider`** — provider là bất biến sau khi tạo. `Update` cũng bỏ qua `secret_access_key` rỗng, nên sửa tài khoản mà không nhập lại secret vẫn giữ nguyên secret cũ.
3. **`CloudAccount.ToResponse()` không bao giờ trả `secret_access_key`** — đã có test khẳng định (`tests/integration/cloud_account_response_test.go`).
4. **`GET /v1/drive/items` hiện không có `LIMIT`** — trả về toàn bộ mục trong thư mục.
5. **Thứ tự sắp xếp hiện tại không xác định (non-deterministic):** `ORDER BY CASE WHEN type='folder' THEN 0 ELSE 1 END, <cột> <chiều>` không có tiebreaker. Hai mục bằng nhau sẽ trả về thứ tự tuỳ ý giữa các lần gọi.
6. **`drive_items` chỉ có index đơn cột** (`user_id`, `cloud_account_id`, `parent_id`, `type`, `is_starred`, `status`, `uuid`). Không có index tổ hợp nào.
7. **Response `data` của endpoint list là mảng trần**, và test hiện có assert trực tiếp `listBody["data"].([]any)` tại `tests/feature/drive_item_api_test.go:110` và `:132`.
8. **`updated_at` chỉ có độ phân giải giây** — đã được ghi nhận trong `dashboard_service.go:106`.
9. **`ctx.Response().Stream(func(w http.StreamWriter) error)`** tồn tại trong goravel, nhưng **không dùng ở slice này** (thuộc Slice B).
10. **Frontend `DriveItem` type thật chỉ có `file` / `folder`**, trong khi mock hiện dùng `folder` / `doc` / `image` — phải map lại.

---

## 3. Kiến Trúc

Tám đơn vị, mỗi đơn vị một nhiệm vụ rõ ràng:

### 3.1. `src/api/cloudAccounts.ts` (mới)
Client cho 7 endpoint. Định nghĩa **một** interface `CloudAccount` chuẩn tại đây.

> `src/api/dashboard.ts` hiện tự định nghĩa một `CloudAccount` riêng (dòng 3–13). Sau slice này nó **import lại** từ `cloudAccounts.ts` để tránh hai định nghĩa trôi dạt nhau.

### 3.2. `src/stores/cloudAccounts.ts` (mới)
Pinia store giữ **một nguồn sự thật duy nhất** cho danh sách tài khoản.

Lý do bắt buộc: `DashboardLayout` (sidebar), `HomeView` và `DriveView` đều cần cùng danh sách. Không có store thì mỗi nơi tự fetch và lệch nhau — thêm tài khoản xong sidebar vẫn hiển thị danh sách cũ.

State: `accounts`, `loading`, `error`. Actions: `fetch()`, `create(payload)`, `update(id, payload)`, `remove(id)`, `setDefault(id)`.

### 3.3. `src/components/cloud/AddCloudDialog.vue` (mới)
Wizard 3 bước, mở từ nút "Thêm Cloud" sẵn có:

- **Bước 1 — Chọn provider:** 3 thẻ lớn (AWS S3 / Cloudflare R2 / MinIO). Dùng thẻ chứ không dùng `Select` vì chỉ có 3 lựa chọn và mỗi provider cần mô tả ngắn. Chọn R2 hoặc MinIO sẽ **prefill** `endpoint` và bật sẵn `use_path_style`.
- **Bước 2 — Form:** `name`, `endpoint`, `bucket`, `region`, `access_key_id`, `secret_access_key`, `use_path_style`, `public_url`.
- **Bước 3 — Xác nhận & lưu:** gọi `POST /test` trước. **Chỉ khi test xanh mới cho bấm Save** (`POST /`).

### 3.4. `src/components/ui/{dialog,select,switch}/` (mới)
Primitive shadcn-vue dựng trên reka-ui, theo đúng style hiện có (`rounded-2xl`, `border`, `shadow-xs`, biến màu oklch). Ba thư mục này hiện chưa tồn tại.

### 3.5. `src/views/DriveView.vue` (sửa)
- Bỏ mảng mock, dùng store `driveItems`.
- Đọc tài khoản đang chọn từ `route.query.cloud` (**id số**, không phải chuỗi provider như hiện tại).
- Map `mime_type` + `extension` → icon, thay vì dựa vào `type: 'doc' | 'image'`.
- `selectItem` đổi khoá từ `id` sang `uuid`.
- Breadcrumb theo `parent_id`; trạng thái loading / rỗng / lỗi riêng biệt.
- Sentinel `IntersectionObserver` ở cuối danh sách (cho cả chế độ list lẫn grid).

### 3.6. `src/stores/driveItems.ts` + `src/composables/useDriveItems.ts` (mới)
Store giữ `items`, `cursor`, `hasMore`, `loading`, `error`. Composable lo phần fetch:
- `AbortController` để huỷ request cũ (cuộn nhanh sinh request chồng nhau; response cũ về sau response mới **phải bị bỏ**).
- Dedup theo `uuid` trước khi append.
- Reset toàn bộ state khi `search` / `sort` / `cloud` / `folder` đổi.

### 3.7. `src/layouts/DashboardLayout.vue` (sửa)
Sidebar đọc từ store thay mảng hardcode. `onSelectCloud` truyền **id số**. Provider → icon/màu qua một bảng map tường minh.

### 3.8. i18n
Thêm namespace `cloud` vào **cả** `src/locales/vi.json` và `src/locales/en.json`. Locale mặc định là `vi`; thiếu key ở `en` sẽ không lộ ra ở test chạy locale mặc định — phải kiểm tra cả hai.

---

## 4. Thay Đổi Backend: Phân Trang Bằng Cursor

Đây là phần duy nhất đụng backend, và nó là điều kiện bắt buộc để có infinite scroll mà không tích nợ kỹ thuật.

### 4.1. Sửa thứ tự sắp xếp

Biểu thức `CASE WHEN type = 'folder' THEN 0 ELSE 1 END` hiện tại **chặn index và ép MariaDB filesort ở mọi truy vấn list**. Nó thay thế được bằng `ORDER BY type DESC` — vì theo thứ tự alphabet `'file' < 'folder'`, nên DESC đưa `folder` lên trước, đúng ngữ nghĩa cũ mà lại dùng được index.

```go
// Thay thế dòng 129 trong app/services/cloud_drive_service.go
query = query.Order("type DESC").
    Order(orderCol + " " + orderDir).
    Order("id ASC")
```

Ba tầng `ORDER BY` dựng được bằng cách gọi `.Order()` liên tiếp: goravel `buildOrder` lặp qua từng phần tử và gọi `db.Order(order)`, GORM nối chúng thành một mệnh đề `ORDER BY a, b, c`. Pattern này đã dùng sẵn trong repo (`activity_service.go`: `.Order("created_at desc").Order("id desc")`).

`id ASC` là **bắt buộc**, không phải tuỳ chọn: `updated_at` chỉ có độ phân giải giây, nên nhiều tệp cùng giây sẽ đổi chỗ tuỳ ý giữa các trang — gây **lặp hoặc mất mục** khi cuộn.

### 4.2. Cursor

Cursor là chuỗi **base64 của JSON** `{"t": type, "v": giá_trị_cột_sort, "i": id}`. Phải encode **cả ba thành phần** vì thứ tự là một tuple ba tầng.

Vị từ cho trang kế tiếp (ví dụ `orderCol = name`, `dir = asc`):

```sql
(type < :t)
OR (type = :t AND (
      name > :v
      OR (name = :v AND id > :i)
   ))
```

Chiều so sánh của `:v` **đảo ngược** theo `dir`: với `dir = desc` thì dùng `<`. `id` luôn `ASC` ở tầng cuối.

Cột sort là **whitelist** (`name`, `size`, `updated_at`, `created_at`) — giá trị đã được kiểm tra trước khi nội suy, và `:v` luôn truyền qua tham số bind.

Cursor **không dùng được để nhảy trang tuỳ ý** — đây là đánh đổi đã biết và chấp nhận được với infinite scroll.

### 4.3. Response

Giữ `data` là **mảng trần**, thêm `meta` là field anh em:

```json
{
  "status": "ok",
  "data": [ /* ... */ ],
  "meta": { "has_more": true, "next_cursor": "eyJ0Ijoi..." }
}
```

**Bắt buộc giữ `data` là mảng.** Test hiện có assert `listBody["data"].([]any)` tại `drive_item_api_test.go:110` và `:132`; bọc `data` vào một object sẽ phá vỡ chúng. `meta` thuần cộng thêm nên không phá client nào.

### 4.4. Query params

| Param | Mặc định | Trần | Ghi chú |
| :--- | :--- | :--- | :--- |
| `cursor` | rỗng | — | Rỗng = trang đầu |
| `limit` | 50 | 100 | Lấy `limit + 1` hàng rồi cắt còn `limit` để suy ra `has_more` mà không cần `COUNT(*)` |

### 4.5. Migration index

Bảng hiện chỉ có index đơn cột. Thêm index tổ hợp:

```sql
CREATE INDEX idx_drive_items_list
  ON drive_items (user_id, cloud_account_id, parent_id, type, name, id);
```

Index này phủ trọn `WHERE` + `ORDER BY` của truy vấn list, loại bỏ filesort. **Chi phí:** mỗi INSERT/UPDATE/DELETE trên `drive_items` phải cập nhật thêm một index 6 cột — chấp nhận được vì bảng này ghi ít (ghi khi sync và khi tạo thư mục), đọc nhiều.

---

## 5. Xử Lý Lỗi

- **Test connection thất bại:** hiển thị thông báo đã bản địa hoá, **không** lộ chi tiết lỗi driver. Backend đã trả `cloud.connection_test_failed`.
- **Lỗi validation:** backend trả 422 kèm `errors`; form hiển thị lỗi theo từng trường.
- **Lỗi tải danh sách tài khoản:** hiện trạng thái lỗi + nút thử lại; không để sidebar trắng im lặng.
- **Lỗi tải danh sách tệp:** hiện trạng thái lỗi trong `DriveView`, giữ nguyên các mục đã tải được.
- **401:** `fetchApi` đã tự xoá token và chuyển hướng `/login` — không cần xử lý thêm.

---

## 6. Kiểm Thử

### Backend (Go, testify suite, chạy trên MariaDB dev `ponta_drive`)

Mọi test **phải tự dọn dẹp** — không có DB test riêng, test chạy trực tiếp trên DB dev.

Các trường hợp bắt buộc:

1. **Phân trang không lặp, không mất mục.** Tạo một thư mục có nhiều tệp, cuộn qua toàn bộ bằng cursor, gom `uuid` lại; tập hợp phải **bằng đúng** tập hợp khi gọi không phân trang, và không có `uuid` nào lặp. Đây là test bắt lỗi tiebreaker thiếu.
2. **Thứ tự ổn định với `updated_at` cùng giây.** Tạo nhiều mục có `updated_at` giống hệt nhau, phân trang qua chúng, khẳng định không lặp không mất. Không có `id` tiebreaker thì test này đỏ.
3. **`has_more` và `next_cursor` đúng ở biên.** Đúng `limit` mục → `has_more = false`; `limit + 1` mục → `has_more = true`. Trang cuối trả `next_cursor` rỗng.
4. **`data` vẫn là mảng trần.** Giữ nguyên hai assert hiện có ở `drive_item_api_test.go:110` và `:132` để chứng minh không phá vỡ hợp đồng cũ.
5. **Folders-first vẫn đúng sau khi đổi sang `type DESC`.** Thư mục phải đứng trước tệp trong mọi trang.
6. **Cursor hỏng / rác.** Cursor không giải mã được phải trả 400, không được panic hay trả toàn bộ dữ liệu.
7. **`limit` vượt trần bị kẹp.** `limit=1000` phải bị kẹp về 100.
8. **Sắp xếp kết hợp cursor.** Lặp lại test 1 cho `size desc` và `name desc`.

### Frontend (vitest)

Dự án **chưa có hạ tầng test frontend** (không có vitest trong `package.json`). Slice này **dựng mới**, vì phần logic rủi ro nhất nằm ở frontend và lỗi ở đó gần như vô hình khi test tay.

Thêm `vitest` + `@vue/test-utils` + `happy-dom`, cấu hình trong `vite.config.ts`, script `test` và `test:run`.

Phạm vi test — chỉ logic, không test template:

1. **Race condition trong `useDriveItems`.** Request cũ về sau request mới **phải bị bỏ**, không được ghi đè kết quả mới. Đây là test quan trọng nhất của slice.
2. **Dedup theo `uuid`.** Nạp trang 2 trùng mục với trang 1 → không sinh mục trùng trong danh sách.
3. **Reset khi đổi tham số.** Đổi `search` / `sort` / `cloud` / `folder` phải xoá `items`, `cursor`, `hasMore` trước khi nạp trang mới.
4. **Phân trang.** `hasMore = true` → nạp tiếp bằng `next_cursor`; `hasMore = false` → dừng, không gọi thêm.
5. **Lỗi.** Request lỗi → đặt `error`, không xoá các mục đã nạp được.
6. **Store `cloudAccounts`.** `create` / `update` / `remove` cập nhật đúng danh sách cục bộ.

Ngoài ra vẫn giữ `bun run build` + type-check sạch, và chạy thật trên dev server cho luồng end-to-end.

---

## 7. Rủi Ro & Nợ Kỹ Thuật Còn Lại

| Hạng mục | Mức độ | Ghi chú |
| :--- | :--- | :--- |
| Không nhảy trang tuỳ ý | Thấp | Đánh đổi cố hữu của keyset; chấp nhận với infinite scroll |
| Collation `name` | Thấp | Cần test 8 xác nhận keyset so sánh khớp `ORDER BY` dưới collation thực tế của MariaDB |
| Cột timestamp nullable | Thấp | Cần test 2 xác nhận không có hàng `NULL` lọt vào vị từ cursor |
| Sidebar "Recent"/"Starred" vẫn giả | Thấp | Ngoài phạm vi, ghi nhận |
| Hạ tầng test frontend mới | Thấp | vitest lần đầu có trong dự án; nếu cấu hình trục trặc thì đây là chỗ tốn thời gian nhất |

---

## 8. Thứ Tự Hiện Thực Đề Xuất

1. Migration index + sửa `ListItems` (thứ tự, cursor, limit) — kèm test 1–3, 5–8.
2. Cập nhật `DriveItemController.Index` (query params, `meta`) — kèm test 4.
3. Dựng hạ tầng vitest (`vite.config.ts`, script, dependency).
4. `api/cloudAccounts.ts` + `stores/cloudAccounts.ts` — kèm test store.
5. Primitive UI (dialog, select, switch).
6. `AddCloudDialog.vue` + wire vào `HomeView` và `DashboardLayout`.
7. `stores/driveItems.ts` + `useDriveItems.ts` — kèm test race/dedup/reset.
8. Viết lại `DriveView.vue` dùng store + sentinel.
9. i18n cả `vi` và `en`.
