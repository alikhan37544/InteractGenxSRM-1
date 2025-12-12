#!/bin/bash
# Script to start both agents on separate ports

echo "Starting Primary and Secondary Agents..."
echo ""

# Start Primary Agent (port 3001)
echo "🚀 Starting Primary Agent on port 3001..."
cd primary_agent
npm install 2>/dev/null || true
PORT=3001 npm run dev &
PRIMARY_PID=$!
cd ..

# Wait a bit
sleep 2

# Start Secondary Agent (port 3002)
echo "🚀 Starting Secondary Agent on port 3002..."
cd secondary_agent
npm install 2>/dev/null || true
PORT=3002 npm run dev &
SECONDARY_PID=$!
cd ..

echo ""
echo "✅ Both agents started!"
echo "   Primary Agent:   http://localhost:3001"
echo "   Secondary Agent: http://localhost:3002"
echo ""
echo "Press Ctrl+C to stop both agents"

# Wait for user interrupt
trap "kill $PRIMARY_PID $SECONDARY_PID 2>/dev/null; exit" INT TERM

# Wait for processes
wait

