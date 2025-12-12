"""
Ghost Pilot - Core Autonomous Browser Engine
Uses GPT-4o Vision + Set-of-Marks for autonomous navigation
"""
import base64
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.sync_api import sync_playwright, Page, Browser
from openai import OpenAI
import asyncio

class GhostPilot:
    def __init__(self, openai_api_key: str, openai_base_url: Optional[str] = None):
        self.openai_client = OpenAI(
            api_key=openai_api_key,
            base_url=openai_base_url
        )
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        self.element_map: Dict[int, Any] = {}
        
        # Load Set-of-Marks JavaScript
        som_script_path = Path(__file__).parent / "set_of_marks.js"
        if som_script_path.exists():
            with open(som_script_path, 'r') as f:
                self.som_script = f.read()
        else:
            print("⚠️ Warning: set_of_marks.js not found, using inline script")
            self.som_script = self._get_inline_som_script()
    
    def _get_inline_som_script(self) -> str:
        """Fallback if set_of_marks.js is not found"""
        return """
        (function() {
            const existingContainer = document.getElementById('ghost-pilot-tags');
            if (existingContainer) existingContainer.remove();
            
            const SELECTORS = 'a[href], button, input:not([type="hidden"]), textarea, select, [onclick], [role="button"], [role="link"]';
            const elements = Array.from(document.querySelectorAll(SELECTORS))
                .filter(el => el.offsetParent && window.getComputedStyle(el).visibility !== 'hidden');
            
            const container = document.createElement('div');
            container.id = 'ghost-pilot-tags';
            container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483647;';
            
            const map = {};
            elements.forEach((el, i) => {
                const id = i + 1;
                const rect = el.getBoundingClientRect();
                const tag = document.createElement('div');
                tag.style.cssText = `position: absolute; left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px; border: 3px solid #FFD700; background: rgba(255,215,0,0.15); box-shadow: 0 0 10px rgba(255,215,0,0.5);`;
                const label = document.createElement('div');
                label.style.cssText = 'position: absolute; top: -12px; left: -3px; background: #FFD700; color: #000; padding: 2px 8px; font-size: 14px; font-weight: bold; border-radius: 3px;';
                label.textContent = id;
                tag.appendChild(label);
                container.appendChild(tag);
                map[id] = { center: { x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) }};
            });
            
            document.body.appendChild(container);
            return { tagCount: elements.length, elements: map, viewport: { width: window.innerWidth, height: window.innerHeight }};
        })();
        """
    
    def init_browser(self, headless: bool = False):
        """Initialize Playwright browser"""
        print("🌐 Initializing browser...")
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=headless)
        self.page = self.browser.new_page(viewport={"width": 1280, "height": 720})
        print("✅ Browser ready")
    
    def tag_page(self) -> Dict[str, Any]:
        """Inject Set-of-Marks tags on the current page"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        print("🏷️ Tagging interactive elements...")
        result = self.page.evaluate(self.som_script)
        self.element_map = result.get("elements", {})
        print(f"✅ Tagged {result.get('tagCount', 0)} elements")
        return result
    
    def get_screenshot(self) -> str:
        """Take screenshot and return as base64"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        screenshot_bytes = self.page.screenshot(type="png")
        return base64.b64encode(screenshot_bytes).decode('utf-8')
    
    def get_action_from_gpt(self, screenshot_base64: str, objective: str, viewport: Dict) -> Dict[str, Any]:
        """Query GPT-4o Vision for next action"""
        print("🧠 Querying GPT-4o Vision...")
        
        system_prompt = f"""You are Ghost Pilot, an autonomous browser navigation agent.

OBJECTIVE: {objective}

You see a screenshot with yellow numbered tags on interactive elements.
The viewport is {viewport['width']}x{viewport['height']}px.

Respond ONLY with valid JSON (no markdown):
{{
  "thought": "your reasoning",
  "action_type": "click"|"type"|"scroll"|"wait"|"finish",
  "tag_id": number (for click/type),
  "coordinates": [x, y] (fallback),
  "text": "text to type" (for type action),
  "scroll_direction": "down"|"up" (for scroll),
  "confidence": 0.0-1.0
}}

RULES:
1. Look for yellow tags. Use tag_id when possible
2. Use "finish" when objective is complete
3. Use "type" only after clicking input fields
4. If element not visible, use "scroll"
5. Be decisive and confident
"""
        
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": system_prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{screenshot_base64}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=500,
                temperature=0.3
            )
            
            response_text = response.choices[0].message.content.strip()
            
            # Remove markdown code blocks if present
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
            
            action = json.loads(response_text)
            print(f"💭 GPT-4o: {action.get('thought', '')}")
            print(f"⚡ Action: {action.get('action_type', '')} (confidence: {action.get('confidence', 0):.2f})")
            
            return action
            
        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse GPT response: {e}")
            print(f"Raw response: {response_text}")
            raise
        except Exception as e:
            print(f"❌ GPT query failed: {e}")
            raise
    
    def execute_action(self, action: Dict[str, Any]) -> Optional[tuple]:
        """Execute the action and return cursor coordinates if applicable"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        action_type = action.get("action_type")
        
        if action_type == "finish":
            print("🏁 Mission complete!")
            return None
        
        elif action_type == "wait":
            wait_time = action.get("duration", 2)
            print(f"⏳ Waiting {wait_time}s...")
            time.sleep(wait_time)
            return None
        
        elif action_type == "scroll":
            direction = action.get("scroll_direction", "down")
            amount = 500 if direction == "down" else -500
            print(f"📜 Scrolling {direction}...")
            self.page.evaluate(f"window.scrollBy(0, {amount})")
            time.sleep(1)
            return None
        
        elif action_type in ["click", "type"]:
            tag_id = action.get("tag_id")
            coords = action.get("coordinates", [])
            
            # Get coordinates from tag map
            if tag_id and str(tag_id) in self.element_map:
                element_data = self.element_map[str(tag_id)]
                x = element_data["center"]["x"]
                y = element_data["center"]["y"]
            elif coords and len(coords) == 2:
                x, y = coords
            else:
                print("❌ No valid target for action")
                return None
            
            print(f"🖱️ Moving to ({x}, {y})...")
            
            if action_type == "click":
                print(f"👆 Clicking...")
                self.page.mouse.click(x, y)
                time.sleep(0.5)
                return (x, y)
            
            elif action_type == "type":
                text = action.get("text", "")
                print(f"⌨️ Typing: {text}")
                self.page.mouse.click(x, y)
                time.sleep(0.3)
                self.page.keyboard.type(text, delay=50)
                time.sleep(0.3)
                return (x, y)
        
        return None
    
    async def run_mission(self, objective: str, start_url: str, websocket):
        """Main autonomous navigation loop"""
        print(f"🚀 Mission: {objective}")
        print(f"🌐 Starting URL: {start_url}")
        
        # Initialize browser
        self.init_browser(headless=False)
        
        # Navigate to starting URL
        print(f"📍 Navigating to {start_url}...")
        self.page.goto(start_url, wait_until="networkidle")
        await websocket.send_json({"type": "status", "message": "Loaded page"})
        
        max_steps = 20
        step = 0
        
        while step < max_steps:
            step += 1
            print(f"\n{'='*50}")
            print(f"STEP {step}/{max_steps}")
            print(f"{'='*50}")
            
            try:
                # 1. Tag the page
                tag_result = self.tag_page()
                time.sleep(0.5)  # Let tags render
                
                # 2. Take screenshot
                screenshot_b64 = self.get_screenshot()
                
                # Send screenshot to frontend
                await websocket.send_json({
                    "type": "screenshot",
                    "screenshot": screenshot_b64
                })
                
                # 3. Query GPT-4o
                await websocket.send_json({"type": "thinking", "thinking": True})
                
                action = self.get_action_from_gpt(
                    screenshot_base64=screenshot_b64,
                    objective=objective,
                    viewport=tag_result.get("viewport", {"width": 1280, "height": 720})
                )
                
                await websocket.send_json({"type": "thinking", "thinking": False})
                
                # Check if mission complete
                if action.get("action_type") == "finish":
                    print("✅ Objective achieved!")
                    break
                
                # 4. Execute action
                coords = self.execute_action(action)
                
                # Send action to frontend
                action_data = {
                    "type": "action",
                    "action_type": action.get("action_type"),
                    "data": action
                }
                
                if coords:
                    action_data["x"] = coords[0]
                    action_data["y"] = coords[1]
                    # Send cursor move
                    await websocket.send_json({
                        "type": "cursor_move",
                        "x": coords[0],
                        "y": coords[1]
                    })
                
                await websocket.send_json(action_data)
                
                # Wait for page to settle
                time.sleep(2)
                
            except Exception as e:
                print(f"❌ Error in step {step}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "error": f"Step {step} failed: {str(e)}"
                })
                # Retry once
                if step < max_steps:
                    print("🔄 Retrying...")
                    time.sleep(1)
                    continue
                else:
                    raise
        
        if step >= max_steps:
            print("⚠️ Max steps reached")
            await websocket.send_json({
                "type": "status",
                "message": "Max steps reached"
            })
    
    def cleanup(self):
        """Clean up browser resources"""
        print("🧹 Cleaning up...")
        if self.page:
            self.page.close()
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
        print("✅ Cleanup complete")
