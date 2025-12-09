# 🔐 HƯỚNG DẪN TẠO VÀ QUẢN LÝ TÀI KHOẢN

## 📋 CÁC TÀI KHOẢN MẪU ĐÃ TẠO

### 1. Admin Account (Toàn quyền)
```
Username: admin
Password: admin123
Role: admin
Access: Tất cả 4 facilities
```
- ✅ Xem tất cả facilities
- ✅ Tạo báo cáo cho mọi facility
- ✅ Không bị giới hạn

### 2. Manager Era Cát Linh
```
Username: manager1
Password: manager123
Role: manager
Access: Chỉ era_apartment_1
```
- ✅ Xem và tạo báo cáo cho Era Cát Linh
- ❌ Không thể truy cập các facility khác

### 3. Manager Era 158 Nguyễn Khánh Toàn
```
Username: manager2
Password: manager456
Role: manager
Access: Chỉ era_apartment_2
```
- ✅ Xem và tạo báo cáo cho Era 158 Nguyễn Khánh Toàn
- ❌ Không thể truy cập các facility khác

---

## 🎯 PHÂN QUYỀN THEO ROLE

### 🔴 ADMIN (Quản trị viên)
**Đặc điểm:**
- Full access toàn bộ hệ thống
- Xem tất cả facilities
- Tạo báo cáo cho mọi facility
- Không cần khai báo facilities (tự động có tất cả)

**Khi nào dùng:**
- Tài khoản IT/technical
- Tài khoản chủ/giám đốc
- Tài khoản testing

**Ví dụ:**
```json
{
  "role": "admin",
  "facilities": ["era_apartment_1", "era_apartment_2", "era_apartment_3", "era_apartment_4"]
}
```

### 🟡 MANAGER (Quản lý)
**Đặc điểm:**
- Access chỉ các facilities được assign
- Có thể xem và tạo báo cáo
- Bị giới hạn theo facilities list

**Khi nào dùng:**
- Quản lý từng cơ sở
- Nhân viên phụ trách 1-2 facilities
- Cần phân quyền rõ ràng

**Ví dụ:**
```json
{
  "role": "manager",
  "facilities": ["era_apartment_1", "era_apartment_3"]
}
```

### 🟢 VIEWER (Xem)
**Đặc điểm:**
- Chỉ xem, không được tạo/sửa
- Access theo facilities được assign
- Read-only mode

**Khi nào dùng:**
- Nhân viên báo cáo
- Kế toán chỉ cần xem
- External auditor

**Ví dụ:**
```json
{
  "role": "viewer",
  "facilities": ["era_apartment_2"]
}
```

---

## 🆕 CÁCH TẠO TÀI KHOẢN MỚI

### Cách 1: Dùng Script (Khuyến nghị) ⭐

```bash
npm run create-user
```

**Làm theo hướng dẫn:**
1. Nhập username (ví dụ: manager3)
2. Nhập password (ví dụ: mypassword123)
3. Nhập tên đầy đủ (ví dụ: Nguyễn Văn A)
4. Nhập email (ví dụ: nguyenvana@example.com)
5. Chọn role (admin/manager/viewer)
6. Nhập facilities (ví dụ: era_apartment_3,era_apartment_4)

Script sẽ tự động:
- Hash password
- Tạo unique ID
- Thêm vào users.json
- Set createdAt timestamp

### Cách 2: Thủ công

**Bước 1: Tạo password hash**
```bash
node -e "console.log(require('bcrypt').hashSync('your_password_here', 10))"
```

Copy kết quả hash (dạng: `$2b$10$...`)

**Bước 2: Thêm vào config/users.json**
```json
{
  "id": "user004",
  "username": "newuser",
  "password": "$2b$10$...paste_hash_here...",
  "name": "New User Name",
  "email": "newuser@example.com",
  "role": "manager",
  "facilities": ["era_apartment_3"],
  "active": true,
  "createdAt": "2025-12-09T10:00:00.000Z"
}
```

---

## 📝 VÍ DỤ THỰC TẾ

### Ví dụ 1: Tạo Manager cho 2 facilities
```json
{
  "id": "user004",
  "username": "regional_manager",
  "password": "$2b$10$hashed_password_here",
  "name": "Nguyễn Văn Regional",
  "email": "regional@example.com",
  "role": "manager",
  "facilities": ["era_apartment_1", "era_apartment_2"],
  "active": true,
  "createdAt": "2025-12-09T10:00:00.000Z"
}
```

### Ví dụ 2: Tạo Viewer cho kế toán
```json
{
  "id": "user005",
  "username": "accountant",
  "password": "$2b$10$hashed_password_here",
  "name": "Trần Thị Kế Toán",
  "email": "ketoan@example.com",
  "role": "viewer",
  "facilities": ["era_apartment_1", "era_apartment_2", "era_apartment_3", "era_apartment_4"],
  "active": true,
  "createdAt": "2025-12-09T10:00:00.000Z"
}
```

### Ví dụ 3: Tạo Admin thứ 2
```json
{
  "id": "user006",
  "username": "admin2",
  "password": "$2b$10$hashed_password_here",
  "name": "IT Administrator",
  "email": "it@example.com",
  "role": "admin",
  "facilities": ["era_apartment_1", "era_apartment_2", "era_apartment_3", "era_apartment_4"],
  "active": true,
  "createdAt": "2025-12-09T10:00:00.000Z"
}
```

---

## 🔧 QUẢN LÝ TÀI KHOẢN

### Vô hiệu hóa tài khoản
```json
{
  "active": false  // Đổi từ true → false
}
```

### Thay đổi password
```bash
# Tạo hash mới
node -e "console.log(require('bcrypt').hashSync('new_password', 10))"

# Thay thế trong users.json
"password": "$2b$10$new_hash_here"
```

### Thêm/bớt facilities
```json
{
  "facilities": ["era_apartment_1", "era_apartment_2", "era_apartment_3"]
  // Chỉ cần edit array này
}
```

### Nâng cấp role
```json
{
  "role": "admin"  // Đổi từ "manager" → "admin"
}
```

---

## 🚀 KHỞI ĐỘNG VÀ SỬ DỤNG

### 1. Start server
```bash
npm run server
```

### 2. Mở trình duyệt
```
http://localhost:3001/login.html
```

### 3. Đăng nhập
- Thử với: `admin` / `admin123`
- Hoặc: `manager1` / `manager123`
- Hoặc: `manager2` / `manager456`

### 4. Kiểm tra
- Admin sẽ thấy tất cả 4 facilities
- Manager1 chỉ thấy Era Cát Linh
- Manager2 chỉ thấy Era 158 Nguyễn Khánh Toàn

---

## 🛡️ BẢO MẬT

### ⚠️ LƯU Ý QUAN TRỌNG:

1. **KHÔNG commit file `config/users.json` lên Git**
   - File này chứa password hashes
   - Đã được thêm vào .gitignore

2. **THAY ĐỔI mật khẩu mặc định**
   - `admin123`, `manager123` chỉ dùng cho testing
   - Đổi ngay khi deploy production

3. **SỬ DỤNG mật khẩu mạnh**
   - Tối thiểu 8 ký tự
   - Có chữ hoa, chữ thường, số, ký tự đặc biệt

4. **BACKUP file users.json**
   - Copy ra nơi an toàn
   - Không lưu trên public server

5. **KIỂM TRA thường xuyên**
   - Xem ai đang active
   - Vô hiệu hóa accounts không dùng

---

## 🆘 TROUBLESHOOTING

### "Invalid credentials"
✅ Kiểm tra username có đúng không
✅ Kiểm tra password có đúng không
✅ Kiểm tra `active: true` trong users.json

### "Facility access denied"
✅ Kiểm tra user có facility đó trong list không
✅ Admin luôn có access tất cả

### "No authentication token"
✅ Đăng nhập lại
✅ Xóa localStorage và login lại

---

## 📞 LIÊN HỆ

Nếu cần:
- Reset password
- Unlock account
- Thêm facilities
- Nâng cấp role

→ Liên hệ Administrator (admin account)
