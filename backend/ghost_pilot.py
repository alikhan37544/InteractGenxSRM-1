"""
Ghost Pilot - Core Autonomous Browser Engine
Uses GPT-4o Vision + Set-of-Marks for autonomous navigation
"""
import base64
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, Page, Browser
from openai import OpenAI
import asyncio

class GhostPilot:
    def __init__(self, provider: str, **kwargs):
        """
        Initialize Ghost Pilot with specified LLM provider
        
        Args:
            provider: "lmstudio", "openai", or "custom"
            **kwargs: Provider-specific configuration
        """
        self.provider = provider.lower()
        
        # Configure OpenAI client based on provider
        if self.provider == "lmstudio":
            # LM Studio uses OpenAI-compatible API
            self.openai_client = OpenAI(
                api_key="lm-studio",  # LM Studio doesn't require real API key
                base_url=kwargs.get("base_url", "http://localhost:1234/v1")
            )
            self.model_name = kwargs.get("model", "llava-v1.6-34b")
            print(f"🤖 Using LM Studio at {kwargs.get('base_url', 'http://localhost:1234/v1')}")
            
        elif self.provider == "openai":
            # Official OpenAI API
            self.openai_client = OpenAI(
                api_key=kwargs.get("api_key"),
                base_url=kwargs.get("base_url", "https://api.openai.com/v1")
            )
            self.model_name = kwargs.get("model", "gpt-4o")
            print(f"🤖 Using OpenAI API")
            
        elif self.provider == "custom":
            # Custom endpoint (like your current setup)
            self.openai_client = OpenAI(
                api_key=kwargs.get("api_key"),
                base_url=kwargs.get("base_url")
            )
            self.model_name = kwargs.get("model", "gpt-4o")
            print(f"🤖 Using custom endpoint: {kwargs.get('base_url')}")
            
        else:
            raise ValueError(f"Unknown provider: {provider}. Use 'lmstudio', 'openai', or 'custom'")
        
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        self.element_map: Dict[int, Any] = {}
        self.action_history: list = []  # Track recent actions to prevent loops
        
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
    
    async def init_browser(self, headless: bool = False):
        """Initialize Playwright browser"""
        print("🌐 Initializing browser...")
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=headless)
        self.page = await self.browser.new_page(viewport={"width": 1280, "height": 720})
        print("✅ Browser ready")
    
    async def tag_page(self) -> Dict[str, Any]:
        """Inject Set-of-Marks tags on the current page"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        print("🏷️ Tagging interactive elements...")
        result = await self.page.evaluate(self.som_script)
        self.element_map = result.get("elements", {})
        print(f"✅ Tagged {result.get('tagCount', 0)} elements")
        return result
    
    async def get_screenshot(self) -> str:
        """Take screenshot and return as base64"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        screenshot_bytes = await self.page.screenshot(type="png")
        return base64.b64encode(screenshot_bytes).decode('utf-8')
    
    async def get_action_from_gpt(self, screenshot_base64: str, objective: str, viewport: Dict) -> Dict[str, Any]:
        """Query GPT-4o Vision for next action with retry logic"""
        print("🧠 Querying GPT-4o Vision...")
        
        # Build action history context
        history_context = ""
        if self.action_history:
            recent_actions = self.action_history[-3:]  # Last 3 actions
            history_context = "\n\nRECENT ACTIONS YOU JUST TOOK:\n"
            for i, action in enumerate(recent_actions, 1):
                action_type = action.get('action_type', 'unknown')
                tag_id = action.get('tag_id', 'N/A')
                text = action.get('text', '')
                if action_type == 'type':
                    history_context += f"{i}. {action_type} '{text}' (tag {tag_id})\n"
                else:
                    history_context += f"{i}. {action_type} (tag {tag_id})\n"
            
            # Check for repeated actions
            if len(self.action_history) >= 2:
                last_action = self.action_history[-1]
                second_last = self.action_history[-2]
                if (last_action.get('action_type') == second_last.get('action_type') == 'click' and
                    last_action.get('tag_id') == second_last.get('tag_id')):
                    history_context += "\n⚠️ WARNING: You just clicked the same element twice! If you clicked an input field, you MUST type next, not click again!\n"
        
        system_prompt = f"""You are Ghost Pilot, an autonomous browser navigation agent.

OBJECTIVE: {objective}

You see a screenshot with yellow numbered tags on interactive elements.
The viewport is {viewport['width']}x{viewport['height']}px.{history_context}

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

CRITICAL RULES:
1. Look for yellow tags. Use tag_id when possible
2. Use "finish" when objective is complete
3. **TYPING WORKFLOW**: To type in an input field:
   - First action: click on the input field
   - NEXT action (after clicking): use "type" with the text to enter
   - If you just clicked an input, your NEXT action MUST be "type", NOT another click
4. **NEVER REPEAT THE SAME ACTION**: Check your recent actions above. Do NOT click the same element multiple times in a row!
5. If element not visible, use "scroll"
6. After typing in search box, click the search button or press enter
7. Be decisive and make progress toward the objective"""
        
        
        max_retries = 5
        base_delay = 2  # seconds
        
        for attempt in range(max_retries):
            try:
                response = self.openai_client.chat.completions.create(
                    model=self.model_name,
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
                
                # Validate response structure
                if not response or not response.choices:
                    raise Exception(f"Invalid API response: {response}")
                
                if not response.choices[0].message:
                    raise Exception(f"No message in response: {response}")
                
                response_text = response.choices[0].message.content
                
                if not response_text:
                    raise Exception(f"Empty content in response. Full response: {response}")
                
                response_text = response_text.strip()
                
                # Remove markdown code blocks if present
                if response_text.startswith("```"):
                    response_text = response_text.split("```")[1]
                    if response_text.startswith("json"):
                        response_text = response_text[4:]
                
                action = json.loads(response_text)
                print(f"💭 {self.provider.upper()}: {action.get('thought', '')}")
                print(f"⚡ Action: {action.get('action_type', '')} (confidence: {action.get('confidence', 0):.2f})")
                
                # Loop detection: prevent repeating the exact same action
                if len(self.action_history) >= 2:
                    last_action = self.action_history[-1]
                    if (action.get('action_type') == last_action.get('action_type') == 'click' and
                        action.get('tag_id') == last_action.get('tag_id')):
                        print("🚨 LOOP DETECTED! Same click action repeated. Forcing different action...")
                        
                        # If we clicked an input field twice, force a type action
                        action['action_type'] = 'type'
                        action['text'] = objective.split()[-1] if objective else 'amazon'  # Use last word of objective
                        print(f"🔄 Overriding to: type '{action['text']}'")
                
                # Store action in history
                self.action_history.append(action)
                
                return action
                
            except json.JSONDecodeError as e:
                print(f"❌ Failed to parse GPT response: {e}")
                print(f"Raw response: {response_text}")
                raise
            except Exception as e:
                error_str = str(e)
                
                # Check if it's a rate limit error (429)
                if "429" in error_str or "Too Many Requests" in error_str or "rate_limit" in error_str.lower():
                    if attempt < max_retries - 1:
                        # Exponential backoff: 2s, 4s, 8s, 16s, 32s
                        wait_time = base_delay * (2 ** attempt)
                        print(f"⏳ Rate limited! Waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        print(f"❌ Rate limit exceeded after {max_retries} retries")
                        raise
                
                # Check for other retryable errors (5xx, network issues)
                elif any(code in error_str for code in ["500", "502", "503", "504"]) or "connection" in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = base_delay * (attempt + 1)  # Linear backoff for server errors
                        print(f"⏳ Server error! Waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        print(f"❌ Server error persists after {max_retries} retries")
                        raise
                else:
                    # Non-retryable error
                    print(f"❌ GPT query failed: {e}")
                    raise
        
        raise Exception("Max retries exceeded")
    
    async def execute_action(self, action: Dict[str, Any]) -> Optional[tuple]:
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
            await asyncio.sleep(wait_time)
            return None
        
        elif action_type == "scroll":
            direction = action.get("scroll_direction", "down")
            amount = 500 if direction == "down" else -500
            print(f"📜 Scrolling {direction}...")
            await self.page.evaluate(f"window.scrollBy(0, {amount})")
            await asyncio.sleep(1)
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
                await self.page.mouse.click(x, y)
                await asyncio.sleep(0.5)
                return (x, y)
            
            elif action_type == "type":
                text = action.get("text", "")
                print(f"⌨️ Typing: {text}")
                await self.page.mouse.click(x, y)
                await asyncio.sleep(0.3)
                await self.page.keyboard.type(text, delay=50)
                await asyncio.sleep(0.3)
                return (x, y)
        
        return None
    
    async def run_mission(self, objective: str, start_url: str, websocket):
        """Main autonomous navigation loop"""
        print(f"🚀 Mission: {objective}")
        print(f"🌐 Starting URL: {start_url}")
        
        # Initialize browser
        await self.init_browser(headless=False)
        
        # Navigate to starting URL
        print(f"📍 Navigating to {start_url}...")
        await self.page.goto(start_url, wait_until="networkidle")
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
                tag_result = await self.tag_page()
                await asyncio.sleep(0.5)  # Let tags render
                
                # 2. Take screenshot
                screenshot_b64 = await self.get_screenshot()
                
                # Send screenshot to frontend
                await websocket.send_json({
                    "type": "screenshot",
                    "screenshot": screenshot_b64
                })
                
                # 3. Query GPT-4o
                await websocket.send_json({"type": "thinking", "thinking": True})
                
                action = await self.get_action_from_gpt(
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
                coords = await self.execute_action(action)
                
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
                await asyncio.sleep(2)
                
            except Exception as e:
                print(f"❌ Error in step {step}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "error": f"Step {step} failed: {str(e)}"
                })
                # Retry once
                if step < max_steps:
                    print("🔄 Retrying...")
                    await asyncio.sleep(1)
                    continue
                else:
                    raise
        
        if step >= max_steps:
            print("⚠️ Max steps reached")
            await websocket.send_json({
                "type": "status",
                "message": "Max steps reached"
            })
    
    async def cleanup(self):
        """Clean up browser resources"""
        print("🧹 Cleaning up...")
        try:
            if self.page:
                await self.page.close()
        except Exception as e:
            print(f"⚠️ Page cleanup warning: {e}")
        
        try:
            if self.browser:
                await self.browser.close()
        except Exception as e:
            print(f"⚠️ Browser cleanup warning: {e}")
        
        try:
            if self.playwright:
                await self.playwright.stop()
        except Exception as e:
            print(f"⚠️ Playwright cleanup warning: {e}")
        
        print("✅ Cleanup complete")
