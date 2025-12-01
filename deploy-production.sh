#!/bin/bash

# Production deployment script for ReportOTA
# Run this on your production server

set -e

echo "🚀 Starting ReportOTA Production Deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
DOMAIN="yourdomain.com"  # Replace with your actual domain
PROJECT_DIR="/opt/reportota"  # Adjust path as needed

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root or with sudo${NC}"
   exit 1
fi

echo -e "${GREEN}✅ Running as root${NC}"

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    rm get-docker.sh
fi

# Install Docker Compose if not installed
if ! command -v docker compose &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Docker Compose...${NC}"
    apt-get update
    apt-get install -y docker-compose-plugin
fi

echo -e "${GREEN}✅ Docker and Docker Compose are ready${NC}"

# Install Nginx if not installed
if ! command -v nginx &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Nginx...${NC}"
    apt-get update
    apt-get install -y nginx
    systemctl enable nginx
    systemctl start nginx
fi

echo -e "${GREEN}✅ Nginx is ready${NC}"

# Create project directory
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

echo -e "${YELLOW}📁 Working in: $PROJECT_DIR${NC}"

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker compose down 2>/dev/null || true

# Pull latest code (if using git)
if [ -d ".git" ]; then
    echo -e "${YELLOW}📥 Pulling latest code...${NC}"
    git pull origin main
else
    echo -e "${YELLOW}⚠️  No git repository found. Make sure code is up to date.${NC}"
fi

# Check environment file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating basic environment file...${NC}"
    cat > .env << EOF
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
CORS_ORIGINS=all
EOF
    echo -e "${GREEN}✅ Basic .env file created. Please customize it as needed.${NC}"
fi

# Build and start containers
echo -e "${YELLOW}🔨 Building and starting containers...${NC}"
docker compose build --no-cache
docker compose up -d

# Wait for container to be healthy
echo -e "${YELLOW}⏳ Waiting for container to be healthy...${NC}"
sleep 10

# Test health
if curl -sf http://localhost:3001/health > /dev/null; then
    echo -e "${GREEN}✅ Container health check passed!${NC}"
else
    echo -e "${RED}❌ Container health check failed!${NC}"
    docker compose logs
    exit 1
fi

# Configure Nginx if config doesn't exist
if [ ! -f "/etc/nginx/sites-available/reportota" ]; then
    echo -e "${YELLOW}📝 Configuring Nginx...${NC}"
    
    # Copy nginx config
    if [ -f "nginx-production.conf" ]; then
        cp nginx-production.conf /etc/nginx/sites-available/reportota
        # Replace domain placeholder
        sed -i "s/yourdomain.com/$DOMAIN/g" /etc/nginx/sites-available/reportota
        
        # Enable site
        ln -sf /etc/nginx/sites-available/reportota /etc/nginx/sites-enabled/
        
        # Test nginx config
        nginx -t
        
        # Reload nginx
        systemctl reload nginx
        
        echo -e "${GREEN}✅ Nginx configured and reloaded${NC}"
    else
        echo -e "${YELLOW}⚠️  nginx-production.conf not found. Please configure Nginx manually.${NC}"
    fi
fi

# Configure firewall (if ufw is installed)
if command -v ufw &> /dev/null; then
    echo -e "${YELLOW}🔥 Configuring firewall...${NC}"
    ufw allow 22/tcp  # SSH
    ufw allow 80/tcp  # HTTP
    ufw allow 443/tcp # HTTPS
    ufw --force enable
    echo -e "${GREEN}✅ Firewall configured${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Production deployment completed!${NC}"
echo ""
echo "📋 Summary:"
echo "   🌐 Domain: http://$DOMAIN (configure DNS to point to this server)"
echo "   🐳 Container: $(docker compose ps --format 'table' | grep Up | wc -l) running"
echo "   📊 Logs: docker compose logs -f"
echo "   🔄 Update: Run this script again"
echo ""
echo "🔧 Next steps:"
echo "   1. Point your domain DNS to this server's IP"
echo "   2. Set up SSL certificate (Let's Encrypt recommended)"
echo "   3. Update .env.production with actual domain"
echo "   4. Test the application"
echo ""
echo -e "${YELLOW}⚠️  Remember to:${NC}"
echo "   - Update DOMAIN variable in this script"
echo "   - Configure SSL certificate"
echo "   - Set up monitoring and backups"
