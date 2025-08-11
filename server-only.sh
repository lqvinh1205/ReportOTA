#!/bin/bash

echo "🖥️ Starting Node.js OTA Server..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "🚀 Starting server on http://localhost:3001"
echo "📋 Available endpoints:"
echo "   GET  /api/health          - Health check"
echo "   POST /api/login           - Login to OTA system"
echo "   GET  /api/report          - Fetch report data"
echo "   POST /api/login-and-fetch - Combined login + fetch"
echo ""
echo "💡 Test with curl:"
echo "   curl http://localhost:3001/api/health"
echo "   curl -X POST http://localhost:3001/api/login-and-fetch"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

node server.js
