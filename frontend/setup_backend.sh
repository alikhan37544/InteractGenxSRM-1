#!/bin/bash

# Ghost Pilot Backend Setup Script
# This script copies backend files from artifacts and sets up the Python environment

set -e

echo "🚀 Ghost Pilot Backend Setup"
echo "=============================="
echo ""

# Define paths
ARTIFACTS_DIR="$HOME/.gemini/antigravity/brain/6bfb22e8-b613-4e4e-a992-ab11cb09b215"
BACKEND_DIR="../backend"

# Create backend directory
echo "📁 Creating backend directory..."
mkdir -p "$BACKEND_DIR"

# Copy backend files from artifacts
echo "📋 Copying backend files from artifacts..."
cp "$ARTIFACTS_DIR/main.py" "$BACKEND_DIR/"
cp "$ARTIFACTS_DIR/ghost_pilot.py" "$BACKEND_DIR/"
cp "$ARTIFACTS_DIR/set_of_marks.js" "$BACKEND_DIR/"
cp "$ARTIFACTS_DIR/requirements.txt" "$BACKEND_DIR/"
cp "$ARTIFACTS_DIR/.env.backend" "$BACKEND_DIR/.env"

echo "✅ Files copied successfully!"
echo ""

# Navigate to backend
cd "$BACKEND_DIR"

echo "📦 Installing Python dependencies..."
echo "This may take a few minutes..."
pip install -r requirements.txt

echo ""
echo "🎭 Installing Playwright browsers..."
playwright install chromium

echo ""
echo "=============================="
echo "✅ Backend setup complete!"
echo ""
echo "⚠️  IMPORTANT: Edit backend/.env and add your OpenAI API key:"
echo "   OPENAI_API_KEY=your_actual_api_key_here"
echo ""
echo "To start the backend server:"
echo "   cd backend"
echo "   python main.py"
echo ""
