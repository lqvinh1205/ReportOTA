# User Authentication Setup Guide

## 📋 Tổng quan

Hệ thống ReportOTA giờ đã có authentication và authorization để bảo mật dữ liệu.

## 🔐 Tính năng

- ✅ JWT-based authentication
- ✅ Role-based access control (Admin, Manager, Viewer)
- ✅ Facility-level permissions
- ✅ Secure password hashing with bcrypt
- ✅ Protected API endpoints
- ✅ User management tools

## 🚀 Setup

### 1. Cài đặt dependencies

```bash
npm install
# hoặc
npm run install-deps
```

### 2. Cấu hình môi trường

Copy `.env.example` sang `.env` và cập nhật:

```bash
cp .env.example .env
```

Chỉnh sửa `.env`:
```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h
```

### 3. Tạo user đầu tiên

#### Cách 1: Sử dụng script tự động

```bash
npm run create-user
```

Làm theo hướng dẫn để tạo user mới.

#### Cách 2: Hash password thủ công

```bash
node -e "console.log(require('bcrypt').hashSync('your_password', 10))"
```

Copy hash và thêm vào `config/users.json`:

```json
{
  "users": [
    {
      "id": "user001",
      "username": "admin",
      "password": "$2b$10$...your_hashed_password...",
      "name": "Administrator",
      "email": "admin@example.com",
      "role": "admin",
      "facilities": ["era_apartment_1", "era_apartment_2", "era_apartment_3", "era_apartment_4"],
      "active": true,
      "createdAt": "2025-12-09T00:00:00.000Z"
    }
  ]
}
```

### 4. Khởi chạy server

```bash
npm run server
# hoặc với auto-reload
npm run server:dev
```

### 5. Đăng nhập

Truy cập `http://localhost:3001/login.html` và đăng nhập với credentials đã tạo.

## 👥 Quản lý Users

### Roles

- **admin**: Full access tất cả facilities
- **manager**: Access các facilities được assign
- **viewer**: Read-only access các facilities được assign

### Thêm user mới

Sử dụng script:
```bash
npm run create-user
```

Hoặc edit trực tiếp `config/users.json` (nhớ hash password trước).

### Xem danh sách users

```bash
npm run create-user
# Chọn option 2
```

## 🏢 Quản lý Facilities

Edit file `config/facilities.json` để thêm/sửa/xóa facilities:

```json
{
  "facilities": {
    "era_apartment_1": {
      "name": "Era Cát Linh",
      "email": "ota.eraapartment4@gmail.com",
      "password": "123456",
      "roomTypes": [11246, 11247],
      "address": "Cát Linh, Hà Nội",
      "active": true
    }
  }
}
```

## 🔒 Bảo mật

### Files cần bảo vệ (đã thêm vào .gitignore):

- `.env` - Environment variables
- `config/users.json` - User credentials
- `config/facilities.json` - Facility credentials

### Khuyến nghị:

1. ✅ Thay đổi `JWT_SECRET` trong production
2. ✅ Sử dụng HTTPS trong production
3. ✅ Thay đổi default passwords
4. ✅ Backup `config/` directory thường xuyên
5. ✅ Không commit sensitive files lên Git

## 📝 API Endpoints

### Public Endpoints
- `POST /api/auth/login` - Login

### Protected Endpoints (require JWT token)
- `GET /api/auth/verify` - Verify token
- `GET /api/auth/profile` - Get user profile
- `GET /api/facilities` - Get accessible facilities
- `POST /api/login-and-fetch-facility` - Fetch booking data
- `POST /api/list-rooms` - Get room list
- `POST /api/revenue-report` - Generate revenue report

### Sử dụng token

Thêm header vào mọi request:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

## 🐛 Troubleshooting

### "No authentication token"
- Đăng nhập lại tại `/login.html`

### "Invalid credentials"
- Kiểm tra username/password
- Kiểm tra user có `active: true` trong config

### "Facility access denied"
- Kiểm tra user có quyền truy cập facility đó không
- Admin có access tất cả facilities

## 📚 Cấu trúc Files

```
ReportOTA/
├── config/
│   ├── users.json          # User database (not in git)
│   ├── users.example.json  # User template
│   └── facilities.json     # Facilities config (not in git)
├── middleware/
│   └── auth.js            # Authentication middleware
├── scripts/
│   └── manage-users.js    # User management tool
├── login.html             # Login page
├── index.html             # Main app (requires auth)
└── script.js              # Frontend with auth
```

## 💡 Tips

- Dùng `admin` role cho testing
- Assign facilities cụ thể cho production users
- Thay đổi password thường xuyên
- Monitor access logs

## 🆘 Support

Liên hệ admin nếu cần:
- Reset password
- Unlock account
- Thêm facilities access
