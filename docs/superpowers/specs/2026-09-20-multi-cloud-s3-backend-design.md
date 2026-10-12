# Thiết Kế Kiến Trúc Backend: Hệ Thống Lưu Trữ Đa Đám Mây & Tích Hợp S3 / S3-Compatible

- **Ngày tạo:** 2026-09-20
- **Trạng thái:** Đã phê duyệt (Approved)
- **Công nghệ nền tảng:** Go 1.25, Goravel Framework v1.18.0, AWS SDK for Go v2, PostgreSQL

---

## 1. Tổng Quan & Mục Tiêu

Hệ thống Ponta Drive hướng đến việc trở thành một nền tảng quản lý lưu trữ tệp tin tập trung đa đám mây (Multi-Cloud Storage Hub). Dự án cho phép người dùng tự kết nối các tài khoản lưu trữ đám mây của riêng mình (Bring Your Own Storage - BYOS), bắt đầu với các dịch vụ tương thích chuẩn S3 (AWS S3, Cloudflare R2, MinIO, Wasabi, v.v.) và mở rộng cho Google Drive, Microsoft OneDrive trong tương lai.

### Mục tiêu kỹ thuật cốt lõi:
1. **Dynamic Multi-Cloud Driver Pattern**: Tách biệt tầng logic nghiệp vụ với các giao thức lưu trữ cụ thể thông qua interface `CloudDriver`. Khởi tạo driver động theo từng tài khoản của người dùng thay vì cấu hình tĩnh cấp hệ thống.
2. **Bảo mật Credentials (AES-256)**: Thông tin nhạy cảm của tài khoản Cloud (Access Key, Secret Key, Tokens) được mã hóa đối xứng an toàn trước khi lưu vào cơ sở dữ liệu bằng `facades.Crypt()`.
3. **Cơ chế tải tệp Hybrid linh hoạt**:
   - *Presigned URL*: Tải trực tiếp giữa Client và S3 để tối ưu băng thông máy chủ và đạt tốc độ tối đa.
   - *Server Stream & Chunked / Multipart Upload*: Tải qua máy chủ Backend theo từng phân mảnh (chunk/part) cho các tệp dung lượng lớn hoặc khi không muốn để lộ endpoint bucket trực tiếp.
4. **Cây thư mục ảo (Virtual Hierarchy)**: Quản lý thư mục ảo lồng nhau linh hoạt trong cơ sở dữ liệu quan hệ, kết hợp tính năng quét và đồng bộ hóa (Scan & Sync) siêu dữ liệu từ bucket S3 có sẵn.

---

## 2. Mô Hình Dữ Liệu (Database Schema & Models)

### 2.1. Bảng `cloud_accounts` (Tài khoản Cloud của người dùng)
Quản lý các kết nối lưu trữ cá nhân của từng người dùng.

| Tên trường | Kiểu dữ liệu | Thuộc tính | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `BIGSERIAL` | Primary Key | Khóa chính tự tăng |
| `user_id` | `BIGINT` | Foreign Key -> `users.id`, Index | Chủ sở hữu tài khoản |
| `name` | `VARCHAR(100)` | NOT NULL | Tên gợi nhớ (VD: "Cloudflare R2", "MinIO Local") |
| `provider` | `VARCHAR(50)` | NOT NULL, Index | Loại cloud: `s3`, `cloudflare_r2`, `minio`, `google_drive`, `onedrive` |
| `credentials` | `TEXT` | NOT NULL | Chuỗi JSON chứa thông tin kết nối, **được mã hóa AES-256** |
| `is_default` | `BOOLEAN` | DEFAULT FALSE | Đánh dấu Cloud lưu trữ mặc định của user |
| `is_active` | `BOOLEAN` | DEFAULT TRUE | Trạng thái hoạt động |
| `total_storage` | `BIGINT` | DEFAULT 0 | Tổng dung lượng khả dụng (bytes, 0 nếu không giới hạn) |
| `used_storage` | `BIGINT` | DEFAULT 0 | Dung lượng đã sử dụng (bytes) |
| `created_at` | `TIMESTAMP` | NOT NULL | Thời gian tạo |
| `updated_at` | `TIMESTAMP` | NOT NULL | Thời gian cập nhật |
| `deleted_at` | `TIMESTAMP` | Nullable, Index | Hỗ trợ Soft Delete |

**Cấu trúc JSON trong `credentials` (sau khi giải mã):**
```json
{
  "endpoint": "https://<account_id>.r2.cloudflarestorage.com",
  "bucket": "ponta-drive-bucket",
  "region": "auto",
  "access_key_id": "AKIA...",
  "secret_access_key": "secret...",
  "use_path_style": false,
  "public_url": "https://cdn.ponta.lc"
}
```

---

### 2.2. Bảng `drive_items` (Tệp & Thư mục ảo - Virtual Hierarchy)
Quản lý cấu trúc cây thư mục và siêu dữ liệu tệp tin.

| Tên trường | Kiểu dữ liệu | Thuộc tính | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `BIGSERIAL` | Primary Key | Khóa chính tự tăng |
| `uuid` | `VARCHAR(36)` | UNIQUE, Index | Mã UUID v4 công khai dùng cho API |
| `user_id` | `BIGINT` | Foreign Key -> `users.id`, Index | Người sở hữu |
| `cloud_account_id`| `BIGINT` | Foreign Key -> `cloud_accounts.id`, Index| Cloud lưu trữ tệp này |
| `parent_id` | `BIGINT` | Nullable, Foreign Key -> `drive_items.id`, Index | Thư mục cha (`NULL` = Thư mục gốc Root) |
| `name` | `VARCHAR(255)` | NOT NULL | Tên tệp hoặc thư mục |
| `type` | `VARCHAR(20)` | NOT NULL, Index | Loại mục: `folder` hoặc `file` |
| `mime_type` | `VARCHAR(100)` | Nullable | Định dạng MIME (VD: `image/png`, `application/pdf`) |
| `size` | `BIGINT` | DEFAULT 0 | Kích thước tính theo byte (thư mục là `0`) |
| `extension` | `VARCHAR(50)` | Nullable | Đuôi mở rộng của tệp (VD: `png`, `zip`) |
| `storage_path`| `TEXT` | Nullable | Key / Object path thực tế trên Cloud (VD: `users/1/items/...`) |
| `etag` | `VARCHAR(100)` | Nullable | ETag/MD5 hash đối soát toàn vẹn |
| `is_starred` | `BOOLEAN` | DEFAULT FALSE, Index | Đánh dấu sao yêu thích |
| `status` | `VARCHAR(20)` | DEFAULT 'ready', Index | Trạng thái: `uploading`, `ready`, `syncing`, `failed` |
| `created_at` | `TIMESTAMP` | NOT NULL | Thời gian tạo |
| `updated_at` | `TIMESTAMP` | NOT NULL | Thời gian cập nhật |
| `deleted_at` | `TIMESTAMP` | Nullable, Index | Hỗ trợ Soft Delete (Thùng rác) |

---

### 2.3. Bảng `upload_sessions` (Quản lý phiên Multipart / Chunk Upload)
Theo dõi tiến trình tải lên nhiều phân mảnh cho các tệp dung lượng lớn.

| Tên trường | Kiểu dữ liệu | Thuộc tính | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `BIGSERIAL` | Primary Key | Khóa chính tự tăng |
| `session_id` | `VARCHAR(36)` | UNIQUE, Index | UUID đại diện cho phiên upload |
| `upload_id` | `VARCHAR(255)`| NOT NULL | Multipart Upload ID do S3 cấp phát |
| `user_id` | `BIGINT` | Foreign Key -> `users.id`, Index | Người tải lên |
| `cloud_account_id`| `BIGINT` | Foreign Key -> `cloud_accounts.id`, Index| Cloud đích |
| `parent_id` | `BIGINT` | Nullable | Thư mục cha dự kiến |
| `file_name` | `VARCHAR(255)` | NOT NULL | Tên tệp dự kiến |
| `mime_type` | `VARCHAR(100)` | Nullable | Định dạng tệp dự kiến |
| `total_size` | `BIGINT` | NOT NULL | Tổng kích thước tệp (bytes) |
| `chunk_size` | `BIGINT` | NOT NULL | Kích thước mỗi part (VD: 5MB = 5242880 bytes) |
| `total_parts` | `INT` | NOT NULL | Tổng số parts dự kiến |
| `uploaded_parts`| `JSONB/TEXT` | NOT NULL, DEFAULT '[]' | Danh sách các part đã nhận `[{part_number, etag}]` |
| `storage_path`| `TEXT` | NOT NULL | Key đối tượng trên S3 |
| `expires_at` | `TIMESTAMP` | NOT NULL, Index | Thời gian hết hạn (dùng để dọn session rác) |
| `created_at` | `TIMESTAMP` | NOT NULL | Thời gian tạo |
| `updated_at` | `TIMESTAMP` | NOT NULL | Thời gian cập nhật |

---

## 3. Tầng Trừu Tượng Hóa Lưu Trữ (Storage Abstraction Layer)

### 3.1. Interface `CloudDriver` (`app/contracts/storage.go`)
Định nghĩa giao ước chung mà mọi driver (S3, Cloudflare R2, MinIO, Google Drive, OneDrive) phải tuân thủ:

```go
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
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Expires time.Time         `json:"expires"`
}

type CompletedPart struct {
	PartNumber int32  `json:"part_number"`
	ETag       string `json:"etag"`
}

type ListObjectsResult struct {
	Objects           []ObjectMetadata
	CommonPrefixes    []string
	NextContinuation  string
	IsTruncated       bool
}

type CloudDriver interface {
	// Basic Object Operations
	Put(ctx context.Context, key string, reader io.Reader, size int64, mimeType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	GetMetadata(ctx context.Context, key string) (*ObjectMetadata, error)

	// Presigned URLs (Direct Client-to-Storage)
	GetPresignedUploadURL(ctx context.Context, key string, mimeType string, expire time.Duration) (*PresignedURLResponse, error)
	GetPresignedDownloadURL(ctx context.Context, key string, fileName string, expire time.Duration) (string, error)

	// Chunked / Multipart Uploads
	InitiateMultipart(ctx context.Context, key string, mimeType string) (uploadID string, error)
	UploadPart(ctx context.Context, key string, uploadID string, partNumber int32, reader io.Reader, size int64) (etag string, error)
	CompleteMultipart(ctx context.Context, key string, uploadID string, parts []CompletedPart) error
	AbortMultipart(ctx context.Context, key string, uploadID string) error

	// Bucket Scanning & Synchronization
	ListObjects(ctx context.Context, prefix string, continuationToken string, maxKeys int32) (*ListObjectsResult, error)
}
```

---

### 3.2. Triển khai `S3Driver` (`app/services/storage/s3_driver.go`)
- Sử dụng trực tiếp bộ thư viện chuẩn của AWS: `github.com/aws/aws-sdk-go-v2/service/s3`.
- Tương thích 100% với:
  - **AWS S3**: Tiêu chuẩn.
  - **Cloudflare R2**: Endpoint `https://<account_id>.r2.cloudflarestorage.com`, Region `auto`.
  - **MinIO & Self-hosted S3**: Cấu hình `UsePathStyle: true`, hỗ trợ HTTP/HTTPS tùy biến.
- **Tối ưu hóa Multipart Stream**: `UploadPart` đọc trực tiếp từ HTTP Request Body Stream (`io.Reader`) và pipe sang AWS S3 Client mà không ghi ra tệp tạm trên đĩa cứng server, giúp tiết kiệm IOPS và RAM.

---

### 3.3. Bộ Khởi Tạo Động `DriverFactory` (`app/services/storage/factory.go`)
- Tiếp nhận thực thể `models.CloudAccount`.
- Giải mã `credentials` qua `facades.Crypt().DecryptString(account.Credentials)`.
- Parse cấu hình JSON và khởi tạo instance `S3Driver`.
- Duy trì cache ngắn hạn trong RAM để tránh tái khởi tạo AWS Client trong cùng một lifecycle request.

---

## 4. Đặc Tả RESTful API Endpoints

Mọi endpoint đều yêu cầu Header: `Authorization: Bearer <JWT_TOKEN>`.

### 4.1. Quản lý Tài khoản Cloud (`/api/v1/cloud-accounts`)

1. **`GET /api/v1/cloud-accounts`**
   - Lấy danh sách tài khoản cloud của user kèm thông tin dung lượng.
2. **`POST /api/v1/cloud-accounts/test`**
   - Kiểm tra kết nối với credentials gửi lên mà **không ghi DB** (gọi `ListObjects` hoặc `HeadBucket` thử nghiệm).
3. **`POST /api/v1/cloud-accounts`**
   - Thêm mới tài khoản cloud (mã hóa credentials trước khi lưu).
4. **`GET /api/v1/cloud-accounts/{id}`**
   - Xem chi tiết tài khoản (che giấu `secret_access_key`).
5. **`PUT /api/v1/cloud-accounts/{id}`**
   - Cập nhật thông tin tài khoản hoặc đặt làm mặc định (`is_default: true`).
6. **`DELETE /api/v1/cloud-accounts/{id}`**
   - Xóa liên kết tài khoản cloud (Query: `?purge_files=true/false`).
7. **`POST /api/v1/cloud-accounts/{id}/sync`**
   - Kích hoạt tiến trình quét và đồng bộ dữ liệu từ bucket S3 vào bảng `drive_items`.

---

### 4.2. Quản lý Cây Thư mục & Tệp (`/api/v1/drive/items`)

1. **`GET /api/v1/drive/items`**
   - Tham số truy vấn:
     - `cloud_account_id` (bắt buộc): ID tài khoản cloud cần duyệt.
     - `parent_id` (tùy chọn): ID thư mục cha (`null` = thư mục gốc).
     - `search` (tùy chọn): Tìm kiếm theo tên tệp/thư mục.
     - `type` (tùy chọn): `folder`, `file` hoặc `all`.
     - `sort` (tùy chọn): `name`, `size`, `updated_at`.
     - `order` (tùy chọn): `asc`, `desc`.
2. **`POST /api/v1/drive/items/folders`**
   - Tạo thư mục ảo mới.
   - Body: `{ "cloud_account_id": 1, "parent_id": 10, "name": "Báo cáo Q3" }`.
3. **`GET /api/v1/drive/items/{uuid}`**
   - Lấy thông tin chi tiết của một tệp/thư mục.
4. **`PATCH /api/v1/drive/items/{uuid}`**
   - Đổi tên hoặc di chuyển tệp sang thư mục cha khác.
   - Body: `{ "name": "Ten_moi.docx", "parent_id": 12 }`.
5. **`POST /api/v1/drive/items/{uuid}/star`**
   - Đánh dấu sao / Hủy đánh dấu sao.
6. **`DELETE /api/v1/drive/items/{uuid}`**
   - Xóa tệp/thư mục (Mặc định Soft Delete vào thùng rác, `?permanent=true` để xóa hẳn trên S3).

---

### 4.3. Quy trình Tải Lên (Upload Flows)

#### Quy trình A: Presigned URL (Khuyên dùng - Client <-> S3)
1. **Khởi tạo**:
   - `POST /api/v1/drive/upload/presigned`
   - Body: `{ "cloud_account_id": 1, "parent_id": 5, "file_name": "video.mp4", "size": 104857600, "mime_type": "video/mp4" }`
   - Hệ thống tạo record `drive_items` với `status: "uploading"` và sinh Presigned PUT URL.
   - Response:
     ```json
     {
       "item_uuid": "550e8400-e29b-41d4-a716-446655440000",
       "upload_url": "https://ponta-bucket.s3.amazonaws.com/users/1/items/...",
       "method": "PUT",
       "headers": { "Content-Type": "video/mp4" }
     }
     ```
2. **Xác nhận hoàn tất**:
   - `POST /api/v1/drive/upload/presigned/complete`
   - Body: `{ "item_uuid": "550e8400-e29b-41d4-a716-446655440000" }`
   - Hệ thống gọi `S3Driver.GetMetadata` kiểm tra tệp thực tế trên S3, cập nhật `drive_items.status = "ready"` kèm `etag`.

---

#### Quy trình B: Server Chunked / Multipart Upload (Qua Backend)
1. **Khởi tạo phiên**:
   - `POST /api/v1/drive/upload/multipart/init`
   - Body: `{ "cloud_account_id": 1, "parent_id": 5, "file_name": "data.tar.gz", "total_size": 209715200, "chunk_size": 5242880 }`
   - Response: `{ "session_id": "...", "chunk_size": 5242880, "total_parts": 40 }`.
2. **Tải lên từng chunk**:
   - `POST /api/v1/drive/upload/multipart/part`
   - Form-data:
     - `session_id`: UUID phiên upload.
     - `part_number`: Số thứ tự part (bắt đầu từ 1).
     - `chunk`: Dữ liệu nhị phân của chunk.
   - Backend stream trực tiếp sang S3 thông qua `UploadPart`, lưu lại ETag của part.
   - Response: `{ "part_number": 1, "etag": "\"c6...\"" }`.
3. **Hoàn tất ghép tệp**:
   - `POST /api/v1/drive/upload/multipart/complete`
   - Body: `{ "session_id": "..." }`
   - Backend gọi `CompleteMultipart` trên S3 -> Tạo record `drive_items` với `status: "ready"`.
4. **Hủy phiên bỏ dở**:
   - `POST /api/v1/drive/upload/multipart/abort`
   - Body: `{ "session_id": "..." }`
   - Gọi `AbortMultipart` trên S3 để giải phóng dung lượng rác và dọn dẹp session.

---

### 4.4. Quy trình Tải Xuống (Download Flow)

- **`GET /api/v1/drive/items/{uuid}/download`**
  - Tham số: `?mode=presigned` (mặc định) hoặc `?mode=stream`.
  - Nếu `mode=presigned`: Trả về HTTP 302 Redirect (hoặc JSON) chứa Presigned GET URL với header `response-content-disposition: attachment; filename="tên_gốc.ext"`.
  - Nếu `mode=stream`: Backend stream dữ liệu trực tiếp từ S3 về Client qua HTTP response body.

---

## 5. Kế Hoạch Kiểm Thử & Xác Minh (Verification Strategy)

1. **Unit Tests**:
   - Kiểm thử mã hóa / giải mã credentials của `CloudAccount`.
   - Kiểm thử `DriverFactory` phân giải đúng driver theo cấu hình.
   - Kiểm thử tính toán chia chunk và kiểm tra tiến trình `UploadSession`.
2. **Integration Tests (với MinIO / Mock S3)**:
   - Thử nghiệm kết nối bucket thực tế.
   - Tải lên tệp qua Presigned URL và qua Chunked Upload.
   - Tải xuống và đối soát tính toàn vẹn (MD5 / SHA256).
   - Kiểm thử quét và đồng bộ hóa thư mục từ bucket (`ScanBucket`).
3. **API Contracts Test**:
   - Kiểm thử phân quyền truy cập: Người dùng không thể xem hoặc thao tác trên tệp/cloud của người dùng khác.
