# 🔧 Ghost Pilot - Manual Installation Guide

## Current Status

✅ **Frontend**: Fully set up and ready to run
✅ **Backend Files**: Copied to `../backend/`
⚠️ **Python Dependencies**: Need manual installation (pip not found)

---

## Python Dependencies Installation

Your system has Python 3.13 but pip is not installed. Here are your options:

### Option 1: Install pip (Recommended)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3-pip

# Or download and install pip directly
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3 get-pip.py --user
```

Then install the backend dependencies:

```bash
cd ../backend
python3 -m pip install -r requirements.txt --user
python3 -m playwright install chromium
```

### Option 2: Use a Virtual Environment

```bash
cd ../backend

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Now pip should be available
pip install -r requirements.txt
playwright install chromium
```

### Option 3: Use conda/miniconda

```bash
cd ../backend
conda create -n ghostpilot python=3.10
conda activate ghostpilot
pip install -r requirements.txt
playwright install chromium
```

---

## Backend Dependencies List

The backend requires these packages:
- `fastapi>=0.104.0`
- `uvicorn[standard]>=0.24.0`
- `playwright>=1.40.0`
- `openai>=1.3.0`
- `python-dotenv>=1.0.0`
- `websockets>=12.0`
- `pillow>=10.1.0`

---

## Configuration

### 1. OpenAI API Key

Edit `backend/.env`:

```bash
cd ../backend
nano .env
```

Set your API key:
```
OPENAI_API_KEY=sk-your-actual-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
```

**IMPORTANT:** Make sure you have GPT-4o access on your OpenAI account!

---

## Running Ghost Pilot

Once dependencies are installed:

### Terminal 1 - Backend:
```bash
cd backend
python3 main.py

# Or if using venv:
source venv/bin/activate && python main.py
```

You should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Open Browser:
1. Go to `http://localhost:3000`
2. Wait for the green "Connected" indicator
3. Click the microphone button or type a command
4. Watch Ghost Pilot autonomously navigate! 🚀

---

## Testing Frontend Only

You can test the frontend UI even without the backend:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000` - you'll see:
- The beautiful Ghost Pilot command center
- Voice input button (will show "Disconnected" without backend)
- All animations and UI polish

---

## Troubleshooting

### "WebSocket disconnected"
- Backend is not running
- Make sure it's on port 8000: `python3 main.py` (not a different port)

### "Invalid API Key"
- Check `backend/.env` has the correct `OPENAI_API_KEY`
- Verify you have GPT-4o access

### "browserType.launch: Executable doesn't exist"
- Run `playwright install chromium` in the backend directory

### Playwright installation fails
- Try: `python3 -m playwright install --with-deps chromium`

### Voice input not working
- Use Chrome or Edge (best support for Web Speech API)
- Grant microphone permissions when prompted
- Safari/Firefox have limited support - use text input instead

---

## Quick Test Commands

Once running, try these:

1. **"Search for chocolate cake recipes"**
   - Should navigate to Google
   - Type "chocolate cake recipes"
   - Submit search

2. **"Go to GitHub and search for React"**
   - Navigate to github.com
   - Find search bar
   - Type "React"

3. **"Find the login button"**
   - Tests element detection

---

## Architecture Overview

```
Frontend (Port 3000)           Backend (Port 8000)
     |                              |
     |  WebSocket Connection        |
     |<---------------------------->|
     |                              |
     | 1. Voice/Text Command        |
     |----------------------------->|
     |                              |--- Playwright opens browser
     |                              |--- Inject Set-of-Marks tags
     |                              |--- Take screenshot
     |                              |
     |  2. Screenshot (base64)      |
     |<-----------------------------|
     |                              |
     |                              |--- Send to GPT-4o Vision
     |                              |
     |  3. Thinking=true            |
     |<-----------------------------|
     |                              |
     |                              |<-- GPT-4o returns action
     |                              |
     |  4. Cursor coordinates       |
     |<-----------------------------|
     |                              |
     |  5. Action (click/type)      |
     |<-----------------------------|--- Execute in Playwright
     |                              |
     |  6. New screenshot           |
     |<-----------------------------|
     |                              |
     |  Loop until objective done   |
```

---

## Next Steps

1. ✅ Install pip on your system
2. ✅ Install Python dependencies
3. ✅ Configure `.env` with OpenAI API key
4. ✅ Run backend and frontend
5. ✅ Test with voice commands
6. ✅ Blow minds at the hackathon! 🔥

---

**Need help?** Check the main README.md for more details.
