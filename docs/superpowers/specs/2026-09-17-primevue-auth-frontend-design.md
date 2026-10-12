# Thiết kế Kiến trúc Giao diện PrimeVue & Trang Đăng nhập (Ponta Drive Frontend)

## 1. Tổng quan
Tài liệu này đặc tả thiết kế kiến trúc và triển khai thư viện UI PrimeVue (bản mới nhất, theme Aura) kết hợp Tailwind CSS v4, Pinia Auth Store và trang Đăng nhập (Login) cho giao diện người dùng `ponta_drive_web`.

## 2. Mục tiêu kỹ thuật
- Cài đặt và tích hợp PrimeVue phiên bản mới nhất cùng theme preset Aura (`@primevue/themes/aura`).
- Tích hợp Tailwind CSS v4 (`@tailwindcss/vite`) phục vụ layout và các utility styles linh hoạt.
- Tích hợp thư viện biểu tượng `primeicons`.
- Xây dựng API Client (`src/api/client.ts`) hỗ trợ tự động đính kèm JWT Bearer Token và xử lý mã lỗi 401.
- Xây dựng Pinia Store (`src/stores/auth.ts`) quản lý trạng thái đăng nhập, token, user profile và hành động login/logout.
- Cấu hình Vue Router (`src/router/index.ts`) với Navigation Guards (`requiresAuth`, `requiresGuest`) bảo vệ các trang.
- Xây dựng trang Đăng nhập (`src/views/LoginView.vue`) với bố cục Centered Card hiện đại, hiệu ứng tải, phản hồi Toast thông báo.

## 3. Chi tiết kiến trúc & Các thành phần

### 3.1. Cài đặt thư viện & Nền tảng UI (`frontend/`)
- **Dependencies**:
  - `primevue`: Thư viện giao diện chính.
  - `@primevue/themes`: Bộ theme preset, sử dụng `Aura`.
  - `primeicons`: Bộ biểu tượng cho PrimeVue.
  - `tailwindcss`: Bộ công cụ Tailwind CSS v4.
  - `@tailwindcss/vite`: Plugin tích hợp Tailwind CSS v4 vào Vite.

- **Cấu hình `frontend/vite.config.ts`**:
  - Bổ sung `@tailwindcss/vite` vào mảng plugins:
    ```typescript
    import tailwindcss from '@tailwindcss/vite'
    // ...
    plugins: [vue(), vueJsx(), tailwindcss(), vueDevTools()]
    ```
  - Duy trì proxy `/api` sang backend `http://127.0.0.1:3000`.

- **Cấu hình CSS `frontend/src/assets/main.css`**:
  - Nhập Tailwind v4 và PrimeIcons:
    ```css
    @import "tailwindcss";
    @import "primeicons/primeicons.css";
    ```

- **Khởi tạo PrimeVue `frontend/src/main.ts`**:
  - Đăng ký PrimeVue plugin với preset Aura:
    ```typescript
    import PrimeVue from 'primevue/config'
    import Aura from '@primevue/themes/aura'
    import ToastService from 'primevue/toastservice'

    app.use(PrimeVue, {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.p-dark',
        },
      },
    })
    app.use(ToastService)
    ```

### 3.2. Quản lý trạng thái & Giao tiếp API
- **API Client (`frontend/src/api/client.ts`)**:
  - Kiểm tra `localStorage.getItem('token')`.
  - Nếu có token, tự động bổ sung `Authorization: Bearer <token>` vào request headers.
  - Xử lý mã phản hồi: nếu `status === 401`, xóa token khỏi `localStorage` và chuyển hướng trình duyệt về `/login`.

- **Pinia Auth Store (`frontend/src/stores/auth.ts`)**:
  - `State`:
    - `token`: Chuỗi token JWT hoặc `null` (khởi tạo từ `localStorage`).
    - `user`: Thông tin User (`id`, `uuid`, `name`, `username`, `email`, `avatar`) hoặc `null`.
    - `loading`: Trạng thái boolean khi đang xử lý API request.
  - `Getters`:
    - `isAuthenticated`: `boolean` (kiểm tra `!!token`).
  - `Actions`:
    - `login(login, password)`: Gửi `POST /api/auth/login`. Lưu token vào `localStorage`, cập nhật state `user` và `token`.
    - `fetchUser()`: Gửi `GET /api/auth/me`. Cập nhật state `user`.
    - `logout()`: Gửi `POST /api/auth/logout`. Xóa token khỏi `localStorage` và reset state.

### 3.3. Định tuyến & Bảo vệ trang (`frontend/src/router/index.ts`)
- **Định tuyến**:
  - `/login`: Component `LoginView.vue`, meta `{ requiresGuest: true }`.
  - `/`: Component `HomeView.vue`, meta `{ requiresAuth: true }`.
- **Navigation Guard (`router.beforeEach`)**:
  - Nếu route yêu cầu `requiresAuth` mà `!authStore.isAuthenticated`, chuyển hướng về `/login`.
  - Nếu route có `requiresGuest` mà `authStore.isAuthenticated`, chuyển hướng về `/`.

### 3.4. Giao diện trang Đăng nhập (`frontend/src/views/LoginView.vue`)
- **Bố cục**: Căn giữa màn hình (`min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-4`).
- **Thẻ Đăng nhập (Card)**:
  - Header: Logo / Icon Ponta Drive, tiêu đề "Ponta Drive", khẩu hiệu hệ thống.
  - Form Fields:
    - Username/Email: Sử dụng component `InputText` kèm icon `pi-user`.
    - Password: Sử dụng component `Password` kèm toggle mask (hiện/ẩn mật khẩu).
  - Submit Button: Component `Button`, nhãn "Đăng nhập", trạng thái `loading` tương ứng `authStore.loading`.
  - Toast: Thông báo tức thời khi đăng nhập thành công hoặc báo lỗi nếu sai thông tin xác thực.

## 4. Kiểm thử & Xác nhận
1. Build kiểm tra kiểu dữ liệu TypeScript (`bun run type-check`).
2. Build ứng dụng sản xuất (`bun run build`).
3. Khởi động môi trường dev qua `run.bat` và thực hiện kiểm thử thực tế trên trình duyệt:
   - Truy cập `/` khi chưa đăng nhập -> kiểm tra tự động chuyển hướng về `/login`.
   - Nhập thông tin sai -> kiểm tra hiển thị lỗi trên Toast.
   - Nhập thông tin tài khoản admin hợp lệ -> kiểm tra đăng nhập thành công, lưu token, và chuyển hướng vào `/`.
