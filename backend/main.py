"""
Ghost Pilot Backend - Main FastAPI Server
WebSocket endpoint for real-time browser automation
"""
import os
import asyncio
import json
import base64
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from ghost_pilot import GhostPilot

load_dotenv()

app = FastAPI(title="Ghost Pilot API")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Ghost Pilot API - Ready for autonomous browsing"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    pilot: Optional[GhostPilot] = None
    
    try:
        print("✅ Client connected via WebSocket")
        
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "start_mission":
                objective = message.get("objective", "")
                start_url = message.get("url", "https://www.google.com")
                
                print(f"🚀 Starting mission: {objective}")
                print(f"🌐 Starting URL: {start_url}")
                
                # Send status
                await websocket.send_json({
                    "type": "status",
                    "message": f"Initializing browser..."
                })
                
                # Initialize Ghost Pilot
                provider = os.getenv("LLM_PROVIDER", "lmstudio").lower()
                
                if provider == "lmstudio":
                    pilot = GhostPilot(
                        provider="lmstudio",
                        base_url=os.getenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1"),
                        model=os.getenv("LM_STUDIO_MODEL", "llava-v1.6-34b")
                    )
                elif provider == "openai":
                    pilot = GhostPilot(
                        provider="openai",
                        api_key=os.getenv("OPENAI_API_KEY"),
                        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                        model=os.getenv("OPENAI_MODEL", "gpt-4o")
                    )
                elif provider == "custom":
                    pilot = GhostPilot(
                        provider="custom",
                        api_key=os.getenv("OPENAI_API_KEY"),
                        base_url=os.getenv("OPENAI_BASE_URL"),
                        model=os.getenv("OPENAI_MODEL", "gpt-4o")
                    )
                else:
                    raise ValueError(f"Invalid LLM_PROVIDER: {provider}")
                
                try:
                    # Run the mission
                    await pilot.run_mission(
                        objective=objective,
                        start_url=start_url,
                        websocket=websocket
                    )
                    
                    # Mission complete
                    await websocket.send_json({
                        "type": "complete",
                        "message": "Mission accomplished! 🎉"
                    })
                    
                except Exception as e:
                    print(f"❌ Mission failed: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "error": str(e)
                    })
                
                finally:
                    # Cleanup
                    if pilot:
                        await pilot.cleanup()
                        pilot = None
    
    except WebSocketDisconnect:
        print("🔌 Client disconnected")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
        except:
            pass
    finally:
        if pilot:
            await pilot.cleanup()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
