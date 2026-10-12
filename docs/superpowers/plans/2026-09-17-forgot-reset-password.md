# Kế hoạch triển khai: Tính năng Quên & Đặt lại mật khẩu (Forgot & Reset Password Flow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai toàn diện luồng khôi phục và đặt lại mật khẩu an toàn qua email, xây dựng layout email dùng chung cho Backend và layout xác thực dùng chung cho Frontend.

**Architecture:**
- **Backend (Goravel / Go)**: Bảng `password_reset_tokens` lưu hash SHA256 của token, token hết hạn sau 60 phút. Hệ thống template mail có layout chung `layout.html` kế thừa qua Go `html/template`. Endpoint `/api/auth/forgot-password` và `/api/auth/reset-password` validate bằng FormRequest Tiếng Việt.
- **Frontend (Vue 3 / Vite / Tailwind v4 / shadcn-vue)**: Khung layout `AuthLayout.vue` tái sử dụng cho Login, Forgot Password và Reset Password. Router guard ngăn user đã đăng nhập vào các trang này.

**Tech Stack:** Go 1.25+, Goravel Framework v1.18.0, PostgreSQL/SQLite, Vue 3, TypeScript, Pinia, Vue Router, Tailwind CSS, shadcn-vue, Lucide Icons, Sonner.

**Spec:** `docs/superpowers/specs/2026-09-17-forgot-reset-password-design.md`

## Global Constraints

- Không lưu raw token vào cơ sở dữ liệu; chỉ lưu giá trị băm `SHA256(rawToken)`.
- Luôn phản hồi thành công `200 OK` tại endpoint quên mật khẩu kể cả khi email không tồn tại trong hệ thống (chống enumeration/quét email).
- Token hết hạn sau 60 phút tính từ `created_at`.
- Token bị xóa ngay lập tức khỏi database sau khi đặt lại mật khẩu thành công.
- Tất cả thông báo lỗi validation phải sử dụng tiếng Việt thông qua `backend/lang/vi/validation.json`.
- Mọi email gửi đi từ backend phải dùng chung cấu trúc layout `resources/views/mail/layout.html`.
- Mọi màn hình Auth ở frontend phải dùng chung component layout `frontend/src/layouts/AuthLayout.vue`.

---

### Task 1: Migration & Model cho Password Reset Tokens

**Files:**
- Create: `backend/database/migrations/20260917150000_create_password_reset_tokens_table.go`
- Modify: `backend/bootstrap/migrations.go:9-15`
- Create: `backend/app/models/password_reset_token.go`
- Test: `backend/tests/feature/password_reset_test.go`

**Interfaces:**
- Produces:
  - Table: `password_reset_tokens` (`email` varchar 255 index, `token` varchar 255, `created_at` timestamp nullable)
  - Struct: `models.PasswordResetToken` (`Email string`, `Token string`, `CreatedAt *carbon.DateTime`)

- [ ] **Step 1: Viết migration tạo bảng `password_reset_tokens`**

Tạo file `backend/database/migrations/20260917150000_create_password_reset_tokens_table.go`:
```go
package migrations

import (
	"github.com/goravel/framework/contracts/database/schema"

	"ponta_drive/app/facades"
)

type M20260917150000CreatePasswordResetTokensTable struct{}

func (r *M20260917150000CreatePasswordResetTokensTable) Signature() string {
	return "20260917150000_create_password_reset_tokens_table"
}

func (r *M20260917150000CreatePasswordResetTokensTable) Up() error {
	if !facades.Schema().HasTable("password_reset_tokens") {
		return facades.Schema().Create("password_reset_tokens", func(table schema.Blueprint) {
			table.String("email", 255)
			table.String("token", 255)
			table.Timestamp("created_at").Nullable()

			table.Index("email")
		})
	}

	return nil
}

func (r *M20260917150000CreatePasswordResetTokensTable) Down() error {
	return facades.Schema().DropIfExists("password_reset_tokens")
}
```

- [ ] **Step 2: Đăng ký migration trong `backend/bootstrap/migrations.go`**

Cập nhật `backend/bootstrap/migrations.go`:
```go
package bootstrap

import (
	"github.com/goravel/framework/contracts/database/schema"

	"ponta_drive/database/migrations"
)

func Migrations() []schema.Migration {
	return []schema.Migration{
		&migrations.M20210101000001CreateJobsTable{},
		&migrations.M20260917135741CreateUsersTable{},
		&migrations.M20260917150000CreatePasswordResetTokensTable{},
	}
}
```

- [ ] **Step 3: Tạo Model `PasswordResetToken`**

Tạo file `backend/app/models/password_reset_token.go`:
```go
package models

import (
	"github.com/goravel/framework/support/carbon"
)

type PasswordResetToken struct {
	Email     string           `gorm:"column:email;size:255;index" json:"email"`
	Token     string           `gorm:"column:token;size:255" json:"token"`
	CreatedAt *carbon.DateTime `gorm:"autoCreateTime;column:created_at" json:"created_at"`
}

func (r *PasswordResetToken) TableName() string {
	return "password_reset_tokens"
}
```

- [ ] **Step 4: Chạy migration và kiểm tra bảng được tạo thành công**

Chạy lệnh bash:
`cd backend && go run . artisan migrate`
Kiểm tra kết quả `Migration table created successfully` hoặc không có lỗi.

- [ ] **Step 5: Commit**

```bash
git add backend/database/migrations/20260917150000_create_password_reset_tokens_table.go backend/bootstrap/migrations.go backend/app/models/password_reset_token.go
git commit -m "feat(auth): create password_reset_tokens migration and model"
```

---

### Task 2: Form Requests cho Forgot & Reset Password và i18n Tiếng Việt

**Files:**
- Create: `backend/app/http/requests/forgot_password_request.go`
- Create: `backend/app/http/requests/reset_password_request.go`
- Modify: `backend/lang/vi/validation.json:177-181`

**Interfaces:**
- Produces:
  - `requests.ForgotPasswordRequest`: Validate `email` (`required|email`)
  - `requests.ResetPasswordRequest`: Validate `token` (`required`), `email` (`required|email`), `password` (`required|min_len:6`), `password_confirmation` (`required|eq_field:password`)

- [ ] **Step 1: Tạo `ForgotPasswordRequest`**

Tạo file `backend/app/http/requests/forgot_password_request.go`:
```go
package requests

import (
	"strings"

	"github.com/goravel/framework/contracts/http"
	"github.com/goravel/framework/contracts/validation"
)

type ForgotPasswordRequest struct {
	Email string `form:"email" json:"email"`
}

func (r *ForgotPasswordRequest) Authorize(ctx http.Context) error {
	return nil
}

func (r *ForgotPasswordRequest) Filters(ctx http.Context) map[string]any {
	return map[string]any{}
}

func (r *ForgotPasswordRequest) Rules(ctx http.Context) map[string]any {
	return map[string]any{
		"email": "required|email",
	}
}

func (r *ForgotPasswordRequest) Messages(ctx http.Context) map[string]string {
	return map[string]string{}
}

func (r *ForgotPasswordRequest) Attributes(ctx http.Context) map[string]string {
	return map[string]string{}
}

func (r *ForgotPasswordRequest) PrepareForValidation(ctx http.Context, data validation.Data) error {
	if val, exist := data.Get("email"); exist && val != nil {
		if s, ok := val.(string); ok {
			_ = data.Set("email", strings.ToLower(strings.TrimSpace(s)))
		}
	}
	return nil
}
```

- [ ] **Step 2: Tạo `ResetPasswordRequest`**

Tạo file `backend/app/http/requests/reset_password_request.go`:
```go
package requests

import (
	"strings"

	"github.com/goravel/framework/contracts/http"
	"github.com/goravel/framework/contracts/validation"
)

type ResetPasswordRequest struct {
	Token                string `form:"token" json:"token"`
	Email                string `form:"email" json:"email"`
	Password             string `form:"password" json:"password"`
	PasswordConfirmation string `form:"password_confirmation" json:"password_confirmation"`
}

func (r *ResetPasswordRequest) Authorize(ctx http.Context) error {
	return nil
}

func (r *ResetPasswordRequest) Filters(ctx http.Context) map[string]any {
	return map[string]any{}
}

func (r *ResetPasswordRequest) Rules(ctx http.Context) map[string]any {
	return map[string]any{
		"token":                 "required",
		"email":                 "required|email",
		"password":              "required|min_len:6",
		"password_confirmation": "required|eq_field:password",
	}
}

func (r *ResetPasswordRequest) Messages(ctx http.Context) map[string]string {
	return map[string]string{}
}

func (r *ResetPasswordRequest) Attributes(ctx http.Context) map[string]string {
	return map[string]string{}
}

func (r *ResetPasswordRequest) PrepareForValidation(ctx http.Context, data validation.Data) error {
	if val, exist := data.Get("email"); exist && val != nil {
		if s, ok := val.(string); ok {
			_ = data.Set("email", strings.ToLower(strings.TrimSpace(s)))
		}
	}
	return nil
}
```

- [ ] **Step 3: Cập nhật bản địa hóa các thuộc tính trong `backend/lang/vi/validation.json`**

Chỉnh sửa phần `"attributes"` trong `backend/lang/vi/validation.json` để thêm các trường `token`, `password_confirmation`:
```json
  "attributes": {
    "email": "email",
    "password": "mật khẩu",
    "password_confirmation": "xác nhận mật khẩu",
    "token": "mã xác thực"
  }
```

- [ ] **Step 4: Kiểm tra build backend**

Chạy: `cd backend && go test ./... -run TestAuthTestSuite`
Xác nhận backend biên dịch không lỗi và test hiện tại vẫn pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/http/requests/forgot_password_request.go backend/app/http/requests/reset_password_request.go backend/lang/vi/validation.json
git commit -m "feat(auth): add forgot and reset password form requests with vi i18n"
```

---

### Task 3: View Layout chung cho Email & Mail Template Engine

**Files:**
- Create: `backend/resources/views/mail/layout.html`
- Create: `backend/resources/views/mail/reset_password.html`
- Create: `backend/app/mail/layout_engine.go`
- Modify: `backend/config/mail.go:45-67`

**Interfaces:**
- Produces:
  - View layout: `resources/views/mail/layout.html` với header branding Ponta Drive, slot `{{ template "content" . }}`, footer bản quyền.
  - Template con: `resources/views/mail/reset_password.html` với block `content`.
  - Engine: `app/mail.NewLayoutEngine(viewsPath string) *LayoutEngine` implements `contracts/mail.Template`.

- [ ] **Step 1: Tạo email view layout chung `backend/resources/views/mail/layout.html`**

Tạo file `backend/resources/views/mail/layout.html`:
```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ .Subject }}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f6f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f6f9;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .header {
      padding: 32px 32px 24px;
      text-align: center;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
      border-bottom: 1px solid #f1f5f9;
    }
    .brand-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      background-color: #e0f2fe;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .brand-title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #0284c7;
      letter-spacing: -0.5px;
    }
    .content-body {
      padding: 32px;
      font-size: 15px;
      line-height: 1.6;
      color: #334155;
    }
    .footer {
      padding: 24px 32px;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }
    .btn-primary {
      display: inline-block;
      padding: 12px 28px;
      background-color: #0284c7;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
    }
    .warning-box {
      margin-top: 24px;
      padding: 14px 16px;
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      border-radius: 6px;
      font-size: 13px;
      color: #991b1b;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <!-- Header -->
      <div class="header">
        <div class="brand-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
          </svg>
        </div>
        <h1 class="brand-title">Ponta Drive</h1>
      </div>

      <!-- Main Slot Content -->
      <div class="content-body">
        {{ template "content" . }}
      </div>

      <!-- Footer -->
      <div class="footer">
        <p style="margin: 0 0 6px;">Email này được gửi tự động từ hệ thống lưu trữ Ponta Drive.</p>
        <p style="margin: 0;">&copy; {{ .Year }} Ponta Drive. Mọi quyền được bảo lưu.</p>
      </div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Tạo view đặt lại mật khẩu `backend/resources/views/mail/reset_password.html`**

Tạo file `backend/resources/views/mail/reset_password.html`:
```html
{{ define "content" }}
  <p style="margin-top: 0;">Xin chào <strong>{{ .Name }}</strong>,</p>

  <p>Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản Ponta Drive của bạn liên kết với email <strong>{{ .Email }}</strong>.</p>

  <p>Nhấp vào nút bên dưới để tiến hành thiết lập lại mật khẩu mới:</p>

  <div style="text-align: center;">
    <a href="{{ .ResetUrl }}" class="btn-primary" target="_blank">Đặt lại mật khẩu</a>
  </div>

  <p style="font-size: 13px; color: #64748b;">
    Nếu nút bấm trên không hoạt động, bạn vui lòng copy và dán đường dẫn sau vào trình duyệt web:<br>
    <a href="{{ .ResetUrl }}" style="color: #0284c7; word-break: break-all;">{{ .ResetUrl }}</a>
  </p>

  <div class="warning-box">
    <strong>Lưu ý bảo mật:</strong> Liên kết này chỉ có hiệu lực trong vòng <strong>{{ .ExpireMinutes }} phút</strong>. Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email và mật khẩu của bạn vẫn được giữ an toàn tuyệt đối.
  </div>
{{ end }}
```

- [ ] **Step 3: Tạo `LayoutEngine` implements `contracts/mail.Template`**

Tạo file `backend/app/mail/layout_engine.go`:
```go
package mail

import (
	"bytes"
	"html/template"
	"path/filepath"

	"github.com/goravel/framework/errors"
	"github.com/goravel/framework/support"
)

type LayoutEngine struct {
	viewsPath string
}

func NewLayoutEngine(viewsPath string) *LayoutEngine {
	return &LayoutEngine{
		viewsPath: viewsPath,
	}
}

func (e *LayoutEngine) Render(viewFile string, data any) (string, error) {
	layoutPath := filepath.Join(support.RelativePath, e.viewsPath, "layout.html")
	contentPath := filepath.Join(support.RelativePath, e.viewsPath, viewFile)

	tmpl, err := template.ParseFiles(layoutPath, contentPath)
	if err != nil {
		return "", errors.MailTemplateParseFailed.Args(viewFile, err)
	}

	var buf bytes.Buffer
	// layout.html defines the main document which invokes {{ template "content" . }}
	if err := tmpl.ExecuteTemplate(&buf, "layout.html", data); err != nil {
		return "", errors.MailTemplateExecutionFailed.Args(viewFile, err)
	}

	return buf.String(), nil
}
```

- [ ] **Step 4: Cấu hình template engine trong `backend/config/mail.go`**

Cập nhật mục `"template"` trong `backend/config/mail.go`:
```go
		"template": map[string]any{
			"default": config.Env("MAIL_TEMPLATE_ENGINE", "layout"),
			"engines": map[string]any{
				"layout": map[string]any{
					"driver": "custom",
					"via": func() (contractsmail.Template, error) {
						return appmail.NewLayoutEngine(config.GetString("mail.template.engines.html.path", "resources/views/mail")), nil
					},
				},
				"html": map[string]any{
					"driver": "html",
					"path":   config.Env("MAIL_VIEWS_PATH", "resources/views/mail"),
				},
			},
		},
```
(Lưu ý import `contractsmail "github.com/goravel/framework/contracts/mail"` và `appmail "ponta_drive/app/mail"`).

- [ ] **Step 5: Kiểm tra biên dịch backend**

Chạy: `cd backend && go build ./...`
Đảm bảo không phát sinh lỗi biên dịch.

- [ ] **Step 6: Commit**

```bash
git add backend/resources/views/mail/layout.html backend/resources/views/mail/reset_password.html backend/app/mail/layout_engine.go backend/config/mail.go
git commit -m "feat(mail): create shared email layout, reset password template, and custom layout engine"
```

---

### Task 4: AuthController Endpoints & Routes (`ForgotPassword`, `ResetPassword`)

**Files:**
- Modify: `backend/app/http/controllers/auth_controller.go`
- Modify: `backend/routes/web.go:35-43`

**Interfaces:**
- Consumes:
  - `requests.ForgotPasswordRequest`, `requests.ResetPasswordRequest`
  - `models.User`, `models.PasswordResetToken`
  - `facades.Mail()`, `facades.Hash()`, `facades.Orm()`, `facades.Config()`
- Produces:
  - `POST /api/auth/forgot-password` (JSON: `{"status": "success", "message": "Nếu email tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi."}`)
  - `POST /api/auth/reset-password` (JSON: `{"status": "success", "message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới."}`)

- [ ] **Step 1: Viết hàm sinh token ngẫu nhiên và băm SHA256 an toàn trong `auth_controller.go`**

Bổ sung helper tạo random hex 64 ký tự và băm SHA256:
```go
func generateRandomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}
```

- [ ] **Step 2: Viết action `ForgotPassword` trong `AuthController`**

Trong `backend/app/http/controllers/auth_controller.go`:
1. Validate qua `ForgotPasswordRequest`.
2. Kiểm tra `user` theo email. Nếu không tìm thấy, vẫn trả về `200 OK` thông báo thành công (security anti-enumeration).
3. Nếu user tồn tại:
   - Sinh `rawToken, _ := generateRandomToken()`
   - Băm token: `hashedToken := hashToken(rawToken)`
   - Xóa token cũ của email này (nếu có): `facades.Orm().Query().Where("email = ?", req.Email).Delete(&models.PasswordResetToken{})`
   - Lưu bản ghi mới vào `password_reset_tokens`:
     ```go
     resetRecord := models.PasswordResetToken{
         Email: req.Email,
         Token: hashedToken,
     }
     _ = facades.Orm().Query().Create(&resetRecord)
     ```
   - Xây dựng URL: `resetUrl := fmt.Sprintf("%s/reset-password?token=%s&email=%s", frontendUrl, rawToken, url.QueryEscape(req.Email))`
   - Gửi email qua `facades.Mail()`:
     ```go
     _ = facades.Mail().To([]string{user.Email}).
         Subject("Đặt lại mật khẩu - Ponta Drive").
         Content(mail.Content{
             HtmlView: "reset_password.html",
             With: map[string]any{
                 "Subject":       "Đặt lại mật khẩu - Ponta Drive",
                 "Name":          user.Name,
                 "Email":         user.Email,
                 "ResetUrl":      resetUrl,
                 "ExpireMinutes": 60,
                 "Year":          time.Now().Year(),
             },
         }).
         Send()
     ```
   - Trả về thông báo thành công `200 OK`.

- [ ] **Step 3: Viết action `ResetPassword` trong `AuthController`**

Trong `backend/app/http/controllers/auth_controller.go`:
1. Validate qua `ResetPasswordRequest`.
2. Băm token gửi lên: `hashedToken := hashToken(req.Token)`.
3. Tìm bản ghi trong `password_reset_tokens`:
   ```go
   var resetRecord models.PasswordResetToken
   err := facades.Orm().Query().
       Where("email = ? AND token = ?", req.Email, hashedToken).
       First(&resetRecord)
   ```
4. Kiểm tra hợp lệ và thời hạn 60 phút:
   - Nếu không tìm thấy: trả về `400 Bad Request` với message: `"Mã khôi phục không hợp lệ hoặc đã hết hạn."`
   - Nếu `resetRecord.CreatedAt != nil && carbon.Now().SubMinutes(resetRecord.CreatedAt.ToCarbon()) > 60`:
     xóa token hết hạn và trả về `400 Bad Request` với message `"Mã khôi phục đã hết hạn. Vui lòng yêu cầu lại."`
5. Tìm user theo `req.Email`:
   - Nếu không thấy: trả về `404 Not Found`.
6. Hash mật khẩu mới: `newHash, _ := facades.Hash().Make(req.Password)`
7. Cập nhật mật khẩu cho user:
   ```go
   user.Password = newHash
   _ = facades.Orm().Query().Save(&user)
   ```
8. Xóa token đã sử dụng:
   ```go
   facades.Orm().Query().Where("email = ?", req.Email).Delete(&models.PasswordResetToken{})
   ```
9. Trả về `200 OK`:
   ```go
   return ctx.Response().Success().Json(http.Json{
       "status":  "success",
       "message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.",
   })
   ```

- [ ] **Step 4: Đăng ký routes tại `backend/routes/web.go`**

Thêm các endpoint vào group `auth`:
```go
authRouter.Post("/login", authController.Login)
authRouter.Post("/forgot-password", authController.ForgotPassword)
authRouter.Post("/reset-password", authController.ResetPassword)
```

- [ ] **Step 5: Kiểm tra biên dịch**

Chạy: `cd backend && go build ./...`

- [ ] **Step 6: Commit**

```bash
git add backend/app/http/controllers/auth_controller.go backend/routes/web.go
git commit -m "feat(auth): implement forgot-password and reset-password endpoints"
```

---

### Task 5: Backend Feature Tests cho Luồng Quên & Đặt lại mật khẩu

**Files:**
- Create: `backend/tests/feature/password_reset_test.go`

**Interfaces:**
- Consumes: Endpoints `/api/auth/forgot-password`, `/api/auth/reset-password`
- Produces: Bộ test bao phủ tất cả các ca thành công, thất bại, validation và token hết hạn.

- [ ] **Step 1: Viết test suite `PasswordResetTestSuite`**

Tạo file `backend/tests/feature/password_reset_test.go`:
1. `TestForgotPasswordValidation`: Kiểm tra thiếu email, email sai định dạng trả về 422 với thông báo Tiếng Việt.
2. `TestForgotPasswordWithNonExistentEmail`: Email không có trong hệ thống vẫn trả về `200 OK` (bảo mật).
3. `TestForgotPasswordSuccess`: Email tồn tại trong hệ thống, kiểm tra bản ghi được tạo trong bảng `password_reset_tokens` và token được hash sha256.
4. `TestResetPasswordValidation`: Kiểm tra thiếu token, password < 6 ký tự, xác nhận password không khớp.
5. `TestResetPasswordInvalidToken`: Nhập sai token trả về 400.
6. `TestResetPasswordExpiredToken`: Token tạo trước > 60 phút trả về lỗi hết hạn.
7. `TestResetPasswordSuccess`: Đặt lại mật khẩu thành công, xác nhận đăng nhập được bằng mật khẩu mới và token bị xóa khỏi bảng `password_reset_tokens`.

- [ ] **Step 2: Chạy kiểm thử tự động**

Chạy: `cd backend && go test ./tests/feature -run TestPasswordResetTestSuite -v`
Xác nhận tất cả các test cases đều PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/feature/password_reset_test.go
git commit -m "test(auth): add comprehensive feature tests for password reset flow"
```

---

### Task 6: Frontend `AuthLayout.vue` & Refactor `LoginView.vue`

**Files:**
- Create: `frontend/src/layouts/AuthLayout.vue`
- Modify: `frontend/src/views/LoginView.vue`

**Interfaces:**
- Produces:
  - `AuthLayout.vue`: Component layout nhận props `title`, `description`, cung cấp slot mặc định cho form và slot `footer` cho navigation links.
  - Refactored `LoginView.vue`: Dùng `AuthLayout`, bổ sung link "Quên mật khẩu?" dẫn tới `/forgot-password`.

- [ ] **Step 1: Tạo `frontend/src/layouts/AuthLayout.vue`**

Tạo file `frontend/src/layouts/AuthLayout.vue`:
```vue
<script setup lang="ts">
import { Cloud } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-md shadow-xl border-border py-0">
      <CardHeader class="space-y-2 text-center pt-8">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Cloud class="h-8 w-8" />
        </div>
        <CardTitle class="text-2xl font-bold tracking-tight">{{ title }}</CardTitle>
        <CardDescription>{{ description }}</CardDescription>
      </CardHeader>

      <CardContent class="pt-4 pb-6">
        <slot />
      </CardContent>

      <CardFooter v-if="$slots.footer" class="pb-8 pt-0 flex justify-center border-t border-border/50 text-sm text-muted-foreground pt-4">
        <slot name="footer" />
      </CardFooter>
    </Card>
  </div>
</template>
```

- [ ] **Step 2: Refactor `LoginView.vue` dùng `AuthLayout.vue` và thêm link "Quên mật khẩu?"**

Cập nhật `frontend/src/views/LoginView.vue`:
- Import `AuthLayout` từ `@/layouts/AuthLayout.vue`.
- Bọc form trong `<AuthLayout title="Ponta Drive" description="Đăng nhập để quản lý tệp và tài liệu của bạn">`.
- Phía trên input mật khẩu hoặc phía dưới thêm link:
  `<RouterLink to="/forgot-password" class="text-xs text-primary hover:underline font-medium">Quên mật khẩu?</RouterLink>`.

- [ ] **Step 3: Kiểm tra giao diện và build frontend**

Chạy: `cd frontend && bun run build`
Đảm bảo type-check và bundle hoàn toàn thành công.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/AuthLayout.vue frontend/src/views/LoginView.vue
git commit -m "feat(auth): create AuthLayout and refactor LoginView"
```

---

### Task 7: Frontend `ForgotPasswordView.vue` & API Client Methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/views/ForgotPasswordView.vue`

**Interfaces:**
- Produces:
  - API method: `apiClient.post('/api/auth/forgot-password', { email })`
  - View component: `frontend/src/views/ForgotPasswordView.vue`

- [ ] **Step 1: Tạo method gọi API trong `frontend/src/api/client.ts` (nếu cần hoặc dùng directly `apiClient.post`)**

Kiểm tra `frontend/src/api/client.ts` để đảm bảo xử lý lỗi trả về từ response JSON (`message`).

- [ ] **Step 2: Tạo màn hình `frontend/src/views/ForgotPasswordView.vue`**

Tạo file `frontend/src/views/ForgotPasswordView.vue`:
- Sử dụng `AuthLayout` với `title="Quên mật khẩu"` và `description="Nhập email tài khoản của bạn để nhận liên kết khôi phục"`.
- Form nhập email với icon `Mail`, nút bấm "Gửi liên kết khôi phục" (kèm spinner loader khi `loading = true`).
- Trạng thái gửi thành công: Hiển thị hộp thông báo màu xanh/thông báo xác nhận email và nút "Gửi lại" sau 60s.
- Slot `footer`: Nút quay lại trang Đăng nhập `<RouterLink to="/login" class="inline-flex items-center text-sm font-medium text-primary hover:underline">Quay lại đăng nhập</RouterLink>`.

- [ ] **Step 3: Kiểm tra build frontend**

Chạy: `cd frontend && bun run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ForgotPasswordView.vue
git commit -m "feat(auth): implement ForgotPasswordView"
```

---

### Task 8: Frontend `ResetPasswordView.vue` & Router Configuration

**Files:**
- Create: `frontend/src/views/ResetPasswordView.vue`
- Modify: `frontend/src/router/index.ts:6-18`

**Interfaces:**
- Produces:
  - Route `/forgot-password`: Mở `ForgotPasswordView.vue` (meta: `requiresGuest: true`)
  - Route `/reset-password`: Mở `ResetPasswordView.vue` (meta: `requiresGuest: true`)

- [ ] **Step 1: Tạo màn hình `frontend/src/views/ResetPasswordView.vue`**

Tạo file `frontend/src/views/ResetPasswordView.vue`:
- Tự động lấy `token` và `email` từ `useRoute().query`.
- Nếu thiếu `token`, hiển thị thông báo lỗi cảnh báo liên kết không hợp lệ và nút quay về đăng nhập.
- Input Email (hiển thị readonly/disabled giá trị email lấy từ URL).
- Input Mật khẩu mới (icon `Lock`, nút toggle ẩn/hiện mật khẩu).
- Input Xác nhận mật khẩu mới.
- Nút bấm "Cập nhật mật khẩu".
- Khi gửi request `POST /api/auth/reset-password`:
  - Thành công: toast thông báo `"Đặt lại mật khẩu thành công!"`, chuyển hướng về `/login` sau 1.5s.
  - Thất bại: hiển thị toast lỗi (ví dụ: `"Mã khôi phục đã hết hạn"`).

- [ ] **Step 2: Đăng ký router trong `frontend/src/router/index.ts`**

Cập nhật routes:
```ts
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/ForgotPasswordView.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
      meta: { requiresGuest: true },
    },
```

- [ ] **Step 3: Kiểm tra build frontend**

Chạy: `cd frontend && bun run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ResetPasswordView.vue frontend/src/router/index.ts
git commit -m "feat(auth): implement ResetPasswordView and register auth routes"
```

---

### Task 9: Kiểm thử tích hợp toàn diện (E2E Integration & Verification)

**Files:**
- Verification: Toàn bộ hệ thống Backend + Frontend

- [ ] **Step 1: Chạy toàn bộ test suite của Backend**

Chạy: `cd backend && go test ./... -v`
Xác nhận 100% test cases đều pass (bao gồm Auth test, Password Reset test, i18n test).

- [ ] **Step 2: Chạy type-check và build Frontend**

Chạy: `cd frontend && bun run build`
Xác nhận type-check không có lỗi.

- [ ] **Step 3: Commit và hoàn tất**

```bash
git commit --allow-empty -m "chore(auth): verify end-to-end forgot and reset password flow"
```
