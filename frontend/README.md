# 👻 Ghost Pilot

**An Autonomous Browser Agent powered by GPT-4o Vision + Set-of-Marks**

Ghost Pilot is a hackathon POC that brings the future of autonomous browsing to life. Speak a command, and watch as AI navigates the web for you with buttery-smooth animations and real-time visual feedback.

## ✨ Features

- 🎤 **Voice Control**: Speak your commands using the Web Speech API
- 👁️ **Vision-Powered**: GPT-4o analyzes screenshots to make intelligent decisions
- 🏷️ **Set-of-Marks**: Interactive elements are tagged with numbered yellow overlays for precise targeting
- 👻 **Ghost Cursor**: Smooth spring animations that feel like a human hand
- 🎨 **Stunning UI**: Dark mode glassmorphism with cyberpunk aesthetics
- ⚡ **Real-time Streaming**: WebSocket-based live browser feed
- 🎭 **Visual Feedback**: Radar animations, ripple effects, and thinking overlays

## 🚀 Quick Start

### Prerequisites

- **Python 3.10+**
- **Node.js 16+**
- **OpenAI API Key** with GPT-4o access

### 1. Backend Setup

The backend Python files are located in the artifacts directory. Copy them to a `backend/` folder:

```bash
# Create backend directory
mkdir -p backend
cd backend

# Copy the backend files from artifacts
# (You'll need to manually copy these files from the artifacts directory)
# - main.py
# - ghost_pilot.py
# - set_of_marks.js
# - requirements.txt
# - .env.backend (rename to .env)

# Install Python dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium

# Configure environment
cp .env.backend .env
# Edit .env and add your OPENAI_API_KEY and OPENAI_BASE_URL
```

**Edit `.env`:**
```bash
OPENAI_API_KEY=your_actual_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1  # Or your custom endpoint
```

### 2. Frontend Setup

```bash
cd frontend

# Dependencies are already installed!
# If needed, run: npm install

# Start the dev server
npm run dev
```

The frontend will be available at `http://localhost:3000`

### 3. Run Ghost Pilot

**Terminal 1 - Backend:**
```bash
cd backend
python main.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

## 🎯 How to Use

1. **Open the frontend** at `http://localhost:3000`
2. **Wait for connection** - The green indicator shows when the WebSocket is connected
3. **Speak or type** your command:
   - "Search for chocolate cake recipes"
   - "Go to Amazon and find wireless headphones"
   - "Navigate to GitHub and search for React"
4. **Watch the magic** - Ghost Pilot will:
   - Tag interactive elements with yellow overlays
   - Analyze the page with GPT-4o Vision
   - Autonomously click, type, and navigate
   - Show smooth cursor movements and visual feedback

## 🏗️ Architecture

```
Ghost Pilot
├── backend/                    # Python FastAPI server
│   ├── main.py                # WebSocket server
│   ├── ghost_pilot.py         # Core autonomous engine
│   ├── set_of_marks.js        # Element tagging script
│   └── requirements.txt       # Python dependencies
│
└── frontend/                   # React Vite app
    ├── src/
    │   ├── App.tsx            # Main command center
    │   ├── components/
    │   │   ├── GhostCursor.tsx      # Animated cursor
    │   │   ├── ClickRipple.tsx      # Click feedback
    │   │   ├── ThinkingOverlay.tsx  # Radar animation
    │   │   ├── VideoStream.tsx      # Live screenshot feed
    │   │   └── VoiceInput.tsx       # Speech recognition
    │   └── hooks/
    │       └── useWebSocket.ts      # WebSocket client
    └── package.json
```

## 🧠 How It Works

1. **Set-of-Marks Tagging**: JavaScript is injected to overlay numbered yellow tags on all interactive elements (buttons, links, inputs, etc.)

2. **Screenshot Capture**: Playwright captures the current viewport with overlays visible

3. **GPT-4o Vision Analysis**: The screenshot is sent to GPT-4o with the user's objective. The AI returns a JSON decision about what action to take

4. **Action Execution**: Playwright executes the action (click, type, scroll, etc.)

5. **Real-time Streaming**: Every step is streamed to the frontend via WebSocket:
   - Screenshots update the live feed
   - Cursor coordinates trigger smooth animations
   - Status messages keep the user informed

6. **Loop**: Steps 1-5 repeat until the objective is complete (max 20 steps)

## 🎨 Tech Stack

**Backend:**
- FastAPI (WebSocket server)
- Playwright (browser automation)
- OpenAI SDK (GPT-4o Vision)
- Python 3.10+

**Frontend:**
- React 18
- Vite 5
- TailwindCSS 3
- Framer Motion (animations)
- Web Speech API (voice input)

## ⚠️ Important Notes

- **OPENAI_BASE_URL**: This implementation requires custom endpoint configuration. Make sure your `.env` is properly configured.

- **Browser Visibility**: The backend runs with `headless=False` so you can see the automation happening in real-time.

- **Max Steps**: Limited to 20 steps to prevent infinite loops during the hackathon demo.

- **Voice Support**: Web Speech API works in Chrome/Edge. Safari and Firefox have limited support.

## 🐛 Troubleshooting

**"WebSocket disconnected"**
- Make sure the backend is running on port 8000
- Check that CORS is properly configured

**"Executable doesn't exist" (Playwright)**
- Run `playwright install chromium`

**"Invalid API Key"**
- Verify `OPENAI_API_KEY` in your `.env` file
- Ensure you have GPT-4o access

**Elements not being tagged**
- Some pages have complex visibility rules
- Try scrolling to bring elements into view

## 🚧 Future Enhancements

- [ ] Multi-step planning with memory
- [ ] Support for file uploads and downloads
- [ ] Mobile viewport emulation
- [ ] Session recording and playback
- [ ] Collaborative mode (multiple users)
- [ ] Custom action plugins

## 📜 License

Built for the InteractGen Hackathon December 2025

---

**Built with 🔥 by a 10x Principal Architect**

*"Making the impossible feel inevitable."*
