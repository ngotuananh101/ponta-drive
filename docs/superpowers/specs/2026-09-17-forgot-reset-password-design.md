# Thiết kế Tính năng: Quên & Đặt lại mật khẩu (Forgot & Reset Password Flow)

## 1. Mục tiêu (Goal)
Cung cấp luồng khôi phục và đặt lại mật khẩu an toàn thông qua email cho người dùng của Ponta Drive, đồng thời tối ưu hóa kiến trúc giao diện Authentication trên Frontend thông qua layout chung `AuthLayout.vue`.

## 2. Kiến trúc & Luồng hoạt động (Architecture & Flow)

```
[User tại LoginView]
       │ Click "Quên mật khẩu?"
       ▼
[Giao diện /forgot-password]
       │ Nhập email ──> POST /api/auth/forgot-password
       ▼
[Backend]
       │ 1. Validate email qua ForgotPasswordRequest
       │ 2. Kiểm tra email có trong bảng users hay không (nếu không có, vẫn trả về thông báo thành công để bảo mật chống quét email)
       │ 3. Tạo raw token 64 ký tự hex ngẫu nhiên an toàn (crypto/rand)
       │ 4. Lưu SHA256(rawToken) và email vào bảng `password_reset_tokens` kèm timestamp
       │ 5. Gửi email HTML chứa link: {FRONTEND_URL}/reset-password?token={rawToken}&email={email} (hạn dùng 60 phút)
       ▼
[User mở Email]
       │ Nhấp vào liên kết "Đặt lại mật khẩu"
       ▼
[Giao diện /reset-password]
       │ Tự động đọc token & email từ URL query parameters
       │ Nhập mật khẩu mới & xác nhận mật khẩu ──> POST /api/auth/reset-password
       ▼
[Backend]
       │ 1. Validate dữ liệu qua ResetPasswordRequest (token, email, password min 6, password_confirmation)
       │ 2. Tìm bản ghi trong `password_reset_tokens` với email và SHA256(token)
       │ 3. Kiểm tra tính hợp lệ và thời hạn token (trong vòng 60 phút)
       │ 4. Cập nhật mật khẩu mới đã hash cho user trong bảng `users`
       │ 5. Xóa bỏ token đã sử dụng trong `password_reset_tokens`
       ▼
[Giao diện /reset-password]
       │ Hiển thị thông báo thành công qua toast (Sonner)
       │ Tự động chuyển hướng về trang /login
```

## 3. Đặc tả Backend (Goravel)

### 3.1. Cơ sở dữ liệu: Migration & Model
- **Migration**: `database/migrations/YYYYMMDDHHMMSS_create_password_reset_tokens_table.go`
  - Bảng: `password_reset_tokens`
  - Trường:
    - `email` (string 255, index)
    - `token` (string 255) — lưu giá trị băm `SHA256(rawToken)`
    - `created_at` (timestamp, nullable)
- **Model**: `app/models/password_reset_token.go`
  - Quản lý tương tác ORM với bảng `password_reset_tokens`.

### 3.2. Form Requests (`app/http/requests/`)
1. **`ForgotPasswordRequest`**:
   - `email`: `required|email`
2. **`ResetPasswordRequest`**:
   - `token`: `required`
   - `email`: `required|email`
   - `password`: `required|min_len:6`
   - `password_confirmation`: `required`

### 3.3. View Layout & Template Email (`resources/views/mail/`)
- **Layout email dùng chung (`resources/views/mail/layout.html`)**:
  - Khung HTML responsive đạt chuẩn email client (Outlook, Apple Mail, Gmail...), max-width 600px, nền `#f4f4f7`, card trắng `#ffffff` bo tròn viền mềm.
  - Header: Logo biểu tượng Đám mây Ponta Drive kết hợp tên thương hiệu đồng bộ.
  - Phần thân (Body): Vùng placeholder slot (`{{ template "content" . }}`) để render linh hoạt nội dung của từng mẫu email.
  - Footer: Thông tin bản quyền thương hiệu Ponta Drive (`© {{ .Year }} Ponta Drive. All rights reserved.`) và cảnh báo email tự động.
- **Mẫu email đặt lại mật khẩu (`resources/views/mail/reset_password.html`)**:
  - Kế thừa từ layout chung qua block `content`.
  - Lời chào người dùng theo tên (`{{ .Name }}`).
  - Nội dung thông báo yêu cầu khôi phục mật khẩu.
  - Nút Call to Action (CTA) nổi bật trỏ tới `{FRONTEND_URL}/reset-password?token={rawToken}&email={email}`.
  - Link dự phòng text thuần phòng trường hợp email client chặn nút bấm.
  - Ghi chú thời hạn liên kết là **60 phút** và cảnh báo an toàn nếu không phải chính chủ thao tác.
- **Tích hợp Mail Template Engine hỗ trợ Layout**:
  - Cấu hình template engine trong `config/mail.go` hoặc triển khai render engine (`app/mail/template.go`) cho phép tự động lồng các view email vào layout chung `layout.html`.

### 3.4. Controller & Routes (`app/http/controllers/auth_controller.go`)
- Thêm 2 action trong `AuthController`:
  - `ForgotPassword(ctx http.Context) http.Response`: Xử lý sinh token và gửi email.
  - `ResetPassword(ctx http.Context) http.Response`: Xác thực token và cập nhật mật khẩu mới.
- Đăng ký routes tại `routes/api.go`:
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`

### 3.5. Kiểm thử Backend (`tests/feature/password_reset_test.go`)
- Test trường hợp yêu cầu gửi mail thành công với email tồn tại.
- Test trường hợp email không tồn tại (trả về 200 an toàn, không gửi mail).
- Test validate dữ liệu đầu vào (thiếu trường, email sai định dạng, mật khẩu ngắn).
- Test đặt lại mật khẩu thành công với token hợp lệ.
- Test từ chối đặt lại mật khẩu khi token sai, email sai hoặc token đã hết hạn (> 60 phút).

---

## 4. Đặc tả Frontend (Vue 3 + Tailwind CSS + shadcn-vue)

### 4.1. Layout chung: `AuthLayout.vue` (`frontend/src/layouts/AuthLayout.vue`)
- Tái cấu trúc khung đăng nhập thành component layout tái sử dụng:
  - Nền toàn trang: `min-h-screen flex items-center justify-center bg-muted/40 p-4`.
  - Khung `Card` shadcn-vue với bóng đổ mềm và viền: `w-full max-w-md shadow-xl border-border`.
  - Header thương hiệu Ponta Drive đồng bộ (Icon Cloud trong hộp `bg-primary/10`, `CardTitle`, `CardDescription`).
  - Slots:
    - Slot mặc định: Nội dung form của từng trang.
    - Slot `footer`: Vùng liên kết điều hướng chân trang (ví dụ: "Quay lại đăng nhập", "Quên mật khẩu?").

### 4.2. Refactor `LoginView.vue`
- Chuyển sang sử dụng `AuthLayout`.
- Bổ sung liên kết *"Quên mật khẩu?"* dẫn sang route `/forgot-password`.

### 4.3. Màn hình Quên mật khẩu: `ForgotPasswordView.vue`
- Route: `/forgot-password` (meta: `requiresGuest: true`).
- Giao diện: Sử dụng `AuthLayout` với tiêu đề "Quên mật khẩu" và mô tả "Nhập email tài khoản của bạn để nhận liên kết khôi phục".
- Form:
  - Input Email (có icon Mail).
  - Nút Submit: "Gửi liên kết đặt lại mật khẩu" (có trạng thái loading spinner).
  - Thông báo trạng thái gửi thành công qua Sonner toast hoặc card thông báo.
  - Footer slot: Nút quay lại trang Đăng nhập.

### 4.4. Màn hình Đặt lại mật khẩu: `ResetPasswordView.vue`
- Route: `/reset-password` (meta: `requiresGuest: true`).
- Query params: Tự động trích xuất `token` và `email` từ URL. Nếu thiếu `token`, hiển thị thông báo lỗi và nút quay về đăng nhập.
- Giao diện: Sử dụng `AuthLayout` với tiêu đề "Đặt lại mật khẩu".
- Form:
  - Email (readonly/disabled input).
  - Input Mật khẩu mới (có icon Lock, nút xem/ẩn mật khẩu).
  - Input Xác nhận mật khẩu mới.
  - Nút Submit: "Cập nhật mật khẩu".
- Xử lý khi thành công: Toast thông báo thành công và chuyển hướng về `/login`.

### 4.5. Định tuyến Router (`frontend/src/router/index.ts`)
- Đăng ký 2 routes `/forgot-password` và `/reset-password` với `meta: { requiresGuest: true }`.
