# 🚀 Hướng Dẫn Deploy ReportOTA Lên Production Server

## 📋 Mục Lục
1. [Yêu Cầu Hệ Thống](#yêu-cầu-hệ-thống)
2. [Cài Đặt Docker](#cài-đặt-docker)
3. [Deploy Với Docker](#deploy-với-docker)
4. [Deploy Với Docker Compose](#deploy-với-docker-compose)
5. [Cấu Hình Nginx Reverse Proxy](#cấu-hình-nginx-reverse-proxy)
6. [Quản Lý Container](#quản-lý-container)
7. [Monitoring & Logs](#monitoring--logs)
8. [Troubleshooting](#troubleshooting)

---

## 🖥️ Yêu Cầu Hệ Thống

### Tối Thiểu:
- **OS**: Ubuntu 20.04+ / Debian 10+ / CentOS 8+
- **RAM**: 512MB
- **CPU**: 1 Core
- **Disk**: 2GB trống
- **Docker**: 20.10+ 
- **Docker Compose**: 2.0+

### Khuyến Nghị Production:
- **RAM**: 2GB+
- **CPU**: 2 Cores+
- **Disk**: 10GB+
- **SSL Certificate**: Có (Let's Encrypt miễn phí)

---

## 📦 Cài Đặt Docker

### Ubuntu/Debian:
```bash
# Update package index
sudo apt update

# Install dependencies
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group (không cần sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

### CentOS/RHEL:
```bash
# Install dependencies
sudo yum install -y yum-utils

# Add Docker repository
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

---

## 🐳 Deploy Với Docker (Cách 1)

### Bước 1: Upload source code lên server
```bash
# Clone từ Git
git clone https://github.com/lqvinh1205/ReportOTA.git /opt/ReportOTA
cd /opt/ReportOTA

# Hoặc upload bằng SCP
scp -r /path/to/ReportOTA user@server-ip:/opt/ReportOTA
```

### Bước 2: Build Docker Image
```bash
cd /opt/ReportOTA

# Build image
docker build -t report-ota:latest .

# Verify image
docker images | grep report-ota
```

### Bước 3: Chạy Container
```bash
# Chạy container
docker run -d \
  --name report-ota-prod \
  --restart unless-stopped \
  -p 3001:3001 \
  -e NODE_ENV=production \
  report-ota:latest

# Kiểm tra container đang chạy
docker ps | grep report-ota

# Xem logs
docker logs -f report-ota-prod
```

### Bước 4: Kiểm Tra
```bash
# Test health endpoint
curl http://localhost:3001/health

# Test API
curl http://localhost:3001/api/facilities
```

---

## 🎼 Deploy Với Docker Compose (Cách 2 - Khuyến Nghị)

### Bước 1: Chuẩn bị
```bash
cd /opt/ReportOTA

# Tạo thư mục logs (nếu chưa có)
mkdir -p logs

# Copy file môi trường (nếu cần)
cp .env.example .env
```

### Bước 2: Deploy
```bash
# Build và start services
docker compose up -d --build

# Hoặc pull từ registry (nếu đã push image lên Docker Hub)
# docker compose pull
# docker compose up -d
```

### Bước 3: Verify
```bash
# Kiểm tra services
docker compose ps

# Xem logs
docker compose logs -f

# Test application
curl http://localhost:3001/health
```

---

## 🌐 Cấu Hình Nginx Reverse Proxy

### Bước 1: Cài đặt Nginx
```bash
# Ubuntu/Debian
sudo apt install -y nginx

# CentOS/RHEL
sudo yum install -y nginx

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Bước 2: Tạo cấu hình Nginx
```bash
sudo nano /etc/nginx/sites-available/report-ota
```

**Nội dung file:**
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Redirect to HTTPS (sau khi có SSL)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static files cache
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg)$ {
        proxy_pass http://localhost:3001;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;
}
```

### Bước 3: Enable site và restart Nginx
```bash
# Enable site (Ubuntu/Debian)
sudo ln -s /etc/nginx/sites-available/report-ota /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Bước 4: Cài đặt SSL với Let's Encrypt (Khuyến nghị)
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo certbot renew --dry-run
```

---

## 🔧 Quản Lý Container

### Docker Commands:
```bash
# Start container
docker start report-ota-prod

# Stop container
docker stop report-ota-prod

# Restart container
docker restart report-ota-prod

# Remove container
docker rm -f report-ota-prod

# View logs
docker logs -f report-ota-prod
docker logs --tail 100 report-ota-prod

# Execute command inside container
docker exec -it report-ota-prod sh

# View resource usage
docker stats report-ota-prod
```

### Docker Compose Commands:
```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Restart services
docker compose restart

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f report-ota-app

# Rebuild and restart
docker compose up -d --build

# Scale service (if needed)
docker compose up -d --scale report-ota-app=3

# Remove all containers, networks, volumes
docker compose down -v
```

---

## 📊 Monitoring & Logs

### Xem Logs Real-time:
```bash
# Docker
docker logs -f report-ota-prod

# Docker Compose
docker compose logs -f

# Logs với timestamp
docker logs -f --timestamps report-ota-prod
```

### Kiểm tra Resource Usage:
```bash
# CPU, Memory usage
docker stats report-ota-prod

# Disk usage
docker system df
```

### Health Check:
```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' report-ota-prod

# Manual health check
curl http://localhost:3001/health
```

### Log Rotation (Khuyến nghị):
Tạo file `/etc/docker/daemon.json`:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Restart Docker:
```bash
sudo systemctl restart docker
```

---

## 🆘 Troubleshooting

### Container không start được:
```bash
# Xem logs chi tiết
docker logs report-ota-prod

# Kiểm tra port đã bị chiếm chưa
sudo lsof -i :3001
sudo netstat -tulpn | grep 3001

# Rebuild image
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Không truy cập được từ bên ngoài:
```bash
# Kiểm tra firewall
sudo ufw status
sudo ufw allow 3001/tcp

# Hoặc với firewalld
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload

# Kiểm tra Nginx
sudo nginx -t
sudo systemctl status nginx
sudo systemctl restart nginx
```

### Memory/CPU cao:
```bash
# Giới hạn resource trong docker-compose.yml
# (đã có sẵn trong file)

# Hoặc giới hạn qua command line
docker update --memory="512m" --cpus="1.0" report-ota-prod
```

### Update ứng dụng:
```bash
# Pull code mới
cd /opt/ReportOTA
git pull origin main

# Rebuild và restart
docker compose down
docker compose up -d --build

# Hoặc với Docker
docker stop report-ota-prod
docker rm report-ota-prod
docker build -t report-ota:latest .
docker run -d --name report-ota-prod --restart unless-stopped -p 3001:3001 report-ota:latest
```

---

## 🔐 Security Best Practices

1. **Chạy container với non-root user** ✅ (Đã config trong Dockerfile)
2. **Giới hạn resource** ✅ (Đã config trong docker-compose.yml)
3. **Enable firewall:**
   ```bash
   sudo ufw enable
   sudo ufw allow ssh
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```
4. **Cài đặt SSL certificate** (Let's Encrypt)
5. **Regular updates:**
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Update Docker images
   docker compose pull
   docker compose up -d
   ```
6. **Backup định kỳ**
7. **Monitor logs thường xuyên**

---

## 📝 Checklist Deploy

- [ ] Cài đặt Docker và Docker Compose
- [ ] Upload source code lên server
- [ ] Build Docker image thành công
- [ ] Container chạy được (`docker ps`)
- [ ] Health check OK (`curl http://localhost:3001/health`)
- [ ] Cài đặt Nginx
- [ ] Cấu hình reverse proxy
- [ ] Test từ domain/IP bên ngoài
- [ ] Cài đặt SSL certificate
- [ ] Cấu hình firewall
- [ ] Setup log rotation
- [ ] Test backup & restore
- [ ] Document credentials và configs

---

## 📞 Support

Nếu gặp vấn đề, kiểm tra:
1. Logs: `docker compose logs -f`
2. Container status: `docker compose ps`
3. Network: `docker network ls`
4. Nginx error log: `sudo tail -f /var/log/nginx/error.log`

---

**Chúc bạn deploy thành công! 🎉**
