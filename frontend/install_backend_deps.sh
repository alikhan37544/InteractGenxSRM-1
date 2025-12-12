#!/bin/bash

# Install backend dependencies using python3 -m pip
# This works even when pip3 command is not in PATH

cd ../backend

echo "🐍 Python version:"
python3 --version

echo ""
echo "📦 Installing Python dependencies..."
python3 -m pip install -r requirements.txt --user

echo ""
echo "🎭 Installing Playwright browsers..."
python3 -m playwright install chromium

echo ""
echo "=============================="
echo "✅ Backend installation complete!"
echo "=============================="
echo ""
echo "⚠️  NEXT STEPS:"
echo ""
echo "1. Configure your OpenAI API key:"
echo "   nano backend/.env"
echo "   (Set OPENAI_API_KEY=your_actual_key_here)"
echo ""
echo "2. Start the backend server:"
echo "   cd backend"
echo "   python3 main.py"
echo ""
echo "3. In another terminal, start the frontend:"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "4. Open http://localhost:3000 and start speaking! 🎤"
echo ""
