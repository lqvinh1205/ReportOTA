#!/bin/bash

# Quick deployment script for ReportOTA

set -e

echo "🚀 Starting ReportOTA Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo "Visit: https://docs.docker.com/engine/install/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker and Docker Compose are installed${NC}"

# Create logs directory
mkdir -p logs

# Stop and remove existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker compose down 2>/dev/null || true

# Build and start containers
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
docker compose build

echo -e "${YELLOW}🚀 Starting containers...${NC}"
docker compose up -d

# Wait for container to be healthy
echo -e "${YELLOW}⏳ Waiting for container to be healthy...${NC}"
sleep 5

# Check container status
if docker compose ps --format "table" | grep -q "Up"; then
    echo -e "${GREEN}✅ Container is running!${NC}"
    
    # Test health endpoint
    echo -e "${YELLOW}🔍 Testing health endpoint...${NC}"
    if curl -sf http://localhost:3001/health > /dev/null; then
        echo -e "${GREEN}✅ Health check passed!${NC}"
        echo ""
        echo -e "${GREEN}🎉 Deployment successful!${NC}"
        echo ""
        echo "📋 Container Info:"
        docker compose ps
        echo ""
        echo "🌐 Access the application at: http://localhost:3001"
        echo "📊 View logs: docker compose logs -f"
        echo "🛑 Stop: docker compose down"
    else
        echo -e "${RED}❌ Health check failed!${NC}"
        echo "View logs: docker compose logs"
        exit 1
    fi
else
    echo -e "${RED}❌ Container failed to start!${NC}"
    echo "View logs: docker compose logs"
    exit 1
fi
