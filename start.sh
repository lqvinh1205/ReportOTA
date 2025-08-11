#!/bin/bash

echo "🚀 Starting OTA Report System..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "📦 Installing Node.js dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "✅ Dependencies installed successfully!"
echo ""
echo "🖥️ Starting Node.js server on port 3001..."
echo "📡 Frontend will be available at: http://localhost:3000"
echo "🔧 Backend API will be available at: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start Node.js server in background
node server.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 2

# Start frontend server
echo "🌐 Starting frontend server on port 3000..."
npx live-server --port=3000 --open=index.html &
FRONTEND_PID=$!

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping servers..."
    kill $SERVER_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "✅ Servers stopped successfully"
    exit 0
}

# Set up trap to cleanup on Ctrl+C
trap cleanup SIGINT

# Wait for servers
wait
