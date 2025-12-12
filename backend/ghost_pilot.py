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
import re
from datetime import datetime, timedelta
from collections import deque
import os

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
            
        elif self.provider == "gemini":
            # Google Gemini API - BEST FREE TIER!
            try:
                import google.generativeai as genai
                self.genai = genai
                genai.configure(api_key=kwargs.get("api_key"))
                self.model_name = kwargs.get("model", "gemini-2.0-flash-exp")
                self.gemini_model = genai.GenerativeModel(self.model_name)
                print(f"🤖 Using Google Gemini: {self.model_name}")
                self.openai_client = None  # Gemini uses different client
            except ImportError:
                raise ImportError("Please install google-generativeai: pip install google-generativeai")
            
        elif self.provider == "openrouter":
            # OpenRouter - access to multiple providers with free tier
            self.openai_client = OpenAI(
                api_key=kwargs.get("api_key"),
                base_url="https://openrouter.ai/api/v1"
            )
            # Use working free vision models
            self.model_name = kwargs.get("model", "meta-llama/llama-3.2-11b-vision-instruct:free")
            print(f"🤖 Using OpenRouter with model: {self.model_name}")
            
        elif self.provider == "custom":
            # Custom endpoint (like your current setup)
            self.openai_client = OpenAI(
                api_key=kwargs.get("api_key"),
                base_url=kwargs.get("base_url")
            )
            self.model_name = kwargs.get("model", "gpt-4o")
            print(f"🤖 Using custom endpoint: {kwargs.get('base_url')}")
            
        else:
            raise ValueError(f"Unknown provider: {provider}. Use 'lmstudio', 'openai', 'gemini', 'openrouter', or 'custom'")
        
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        self.element_map: Dict[int, Any] = {}
        self.action_history: list = []  # Track recent actions to prevent loops
        
        # Rate limiting infrastructure
        self.request_timestamps = deque(maxlen=20)  # Track last 20 requests for RPM limiting
        self.daily_request_count = 0
        self.daily_reset_time = datetime.now() + timedelta(days=1)
        self.last_retry_after = None  # Store Retry-After from headers
        self.consecutive_rate_limits = 0  # Track consecutive rate limits for progressive delay
        self.captcha_skip_requested = False  # Manual captcha override flag
        
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
    
    def _clean_json_response(self, response_text: str) -> str:
        """Clean JSON response by removing comments and markdown"""
        response_text = response_text.strip()
        
        # Remove markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
            response_text = response_text.strip()
        
        # Remove single-line comments (// ...)
        response_text = re.sub(r'//[^\n]*', '', response_text)
        
        # Remove multi-line comments (/* ... */)
        response_text = re.sub(r'/\*.*?\*/', '', response_text, flags=re.DOTALL)
        
        # Remove trailing commas before closing braces/brackets
        response_text = re.sub(r',\s*([}\]])', r'\1', response_text)
        
        return response_text.strip()
    
    async def _check_rate_limits(self):
        """Check and enforce rate limits for OpenRouter/Gemini free tier"""
        if self.provider not in ["openrouter", "gemini"]:
            return  # Only apply to free tier providers
        
        # Set limits based on provider
        if self.provider == "gemini":
            rpm_limit = 10  # Gemini 2.5 Flash: 10 RPM
            daily_limit = 250  # Gemini 2.5 Flash: 250 RPD
        else:  # openrouter
            rpm_limit = 20  # OpenRouter: 20 RPM
            daily_limit = 50  # OpenRouter: 50 RPD
        
        now = datetime.now()
        
        # Reset daily counter if needed
        if now >= self.daily_reset_time:
            self.daily_request_count = 0
            self.daily_reset_time = now + timedelta(days=1)
            print("📅 Daily rate limit reset")
        
        # Check daily limit
        if self.daily_request_count >= daily_limit:
            wait_seconds = (self.daily_reset_time - now).total_seconds()
            print(f"🚫 Daily limit reached ({daily_limit} requests). Next reset in {wait_seconds/3600:.1f} hours")
            raise Exception(f"Daily rate limit exceeded. Resets in {wait_seconds/3600:.1f} hours")
        
        # Check RPM limit
        if len(self.request_timestamps) >= rpm_limit:
            oldest_request = self.request_timestamps[0]
            time_since_oldest = (now - oldest_request).total_seconds()
            
            if time_since_oldest < 60:
                wait_time = 60 - time_since_oldest + 1  # Add 1 second buffer
                print(f"⏳ Rate limit: {rpm_limit} RPM. Waiting {wait_time:.1f}s...")
                await asyncio.sleep(wait_time)
        
        # Check if we need to honor Retry-After from previous request
        if self.last_retry_after:
            wait_until = self.last_retry_after
            if now < wait_until:
                wait_seconds = (wait_until - now).total_seconds()
                print(f"⏳ Honoring Retry-After header. Waiting {wait_seconds:.1f}s...")
                await asyncio.sleep(wait_seconds)
            self.last_retry_after = None
        
        # Record this request
        self.request_timestamps.append(now)
        self.daily_request_count += 1
        print(f"📊 Requests: {self.daily_request_count}/{daily_limit} daily, {len(self.request_timestamps)}/{rpm_limit} per minute")
    
    async def get_screenshot(self) -> str:
        """Take screenshot and return as base64"""
        if not self.page:
            raise RuntimeError("Browser not initialized")
        
        screenshot_bytes = await self.page.screenshot(type="png")
        return base64.b64encode(screenshot_bytes).decode('utf-8')
    
    async def detect_captcha(self) -> bool:
        """Detect if current page has a captcha - only visible challenges, not just script includes"""
        if not self.page:
            return False
        
        try:
            # Check for VISIBLE captcha iframes (not just scripts in HTML)
            captcha_iframes = await self.page.query_selector_all(
                'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"]'
            )
            
            for iframe in captcha_iframes:
                # Check if iframe is actually visible
                is_visible = await iframe.is_visible()
                if is_visible:
                    print(f"🛡️ Captcha iframe detected and visible")
                    return True
            
            # Check for visible captcha challenge elements
            captcha_selectors = [
                '.g-recaptcha',
                '.h-captcha', 
                '[id*="captcha"]',
                '[class*="captcha-challenge"]',
                '#challenge-form',  # Cloudflare
                '.cf-challenge-running'  # Cloudflare
            ]
            
            for selector in captcha_selectors:
                elements = await self.page.query_selector_all(selector)
                for element in elements:
                    is_visible = await element.is_visible()
                    if is_visible:
                        print(f"🛡️ Captcha element detected: {selector}")
                        return True
            
            # Check for very specific text that indicates an active challenge
            page_text = await self.page.text_content('body') or ''
            active_challenge_phrases = [
                'verify you are human',
                'prove you are human',
                'please complete the security check',
                'checking your browser',
                'one more step'
            ]
            
            page_text_lower = page_text.lower()
            for phrase in active_challenge_phrases:
                if phrase in page_text_lower:
                    print(f"🛡️ Captcha challenge text detected: '{phrase}'")
                    return True
            
            return False
            
        except Exception as e:
            print(f"⚠️ Captcha detection error: {e}")
            return False

    
    async def get_action_from_gpt(self, screenshot_base64: str, objective: str, viewport: Dict) -> Dict[str, Any]:
        """Query vision model for next action with retry logic"""
        print("🧠 Querying vision model...")
        
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
        
        # Get current URL for context
        current_url = self.page.url if self.page else "unknown"
        
        system_prompt = f"""You are Ghost Pilot, an autonomous browser navigation agent.

OBJECTIVE: {objective}
CURRENT URL: {current_url}

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
0. **CHECK THE URL FIRST**: Look at CURRENT URL above. If you're already on the target website (e.g., youtube.com for "go to YouTube"), DO NOT navigate away! The objective may already be complete or you should use the current page.
1. Look for yellow tags. Use tag_id when possible
2. Use "finish" when objective is complete
3. **TYPING WORKFLOW**: To type in an input field:
   - First action: click on the input field
   - NEXT action (after clicking): use "type" with the text to enter
   - If you just clicked an input, your NEXT action MUST be "type", NOT another click
4. **AVOID REPEATING ACTIONS**: Check your recent actions above. Try not to click the same element multiple times unless necessary.
5. If element not visible, use "scroll"
6. After typing in search box, click the search button or press enter
7. Be decisive and make progress toward the objective"""
        
        # Use Gemini's native API if Gemini provider
        if self.provider == "gemini":
            return await self._query_gemini(screenshot_base64, system_prompt)
        else:
            return await self._query_openai_compatible(screenshot_base64, system_prompt)
    
    async def _query_gemini(self, screenshot_base64: str, system_prompt: str) -> Dict[str, Any]:
        """Query Google Gemini API"""
        max_retries = 5
        base_delay = 2
        
        for attempt in range(max_retries):
            try:
                # Check rate limits before making request
                await self._check_rate_limits()
                
                # Convert base64 to PIL Image for Gemini
                import io
                from PIL import Image
                image_data = base64.b64decode(screenshot_base64)
                image = Image.open(io.BytesIO(image_data))
                
                # Query Gemini
                response = self.gemini_model.generate_content([system_prompt, image])
                response_text = response.text.strip()
                
                # Clean and parse JSON
                response_text = self._clean_json_response(response_text)
                action = json.loads(response_text)
                
                print(f"💭 GEMINI: {action.get('thought', '')}")
                print(f"⚡ Action: {action.get('action_type', '')} (confidence: {action.get('confidence', 0):.2f})")
                
                # Loop detection - warn but allow LLM to learn
                if len(self.action_history) >= 2:
                    last_action = self.action_history[-1]
                    
                    # Detect repeated clicks - warn only
                    if (action.get('action_type') == last_action.get('action_type') == 'click' and
                        action.get('tag_id') == last_action.get('tag_id')):
                        print("⚠️ WARNING: LLM chose same click action. Allowing it (may be intentional for input focus).")
                    
                    # Detect repeated typing - warn only
                    elif (action.get('action_type') == last_action.get('action_type') == 'type' and
                          action.get('text', '').lower() == last_action.get('text', '').lower()):
                        print(f"⚠️ WARNING: LLM chose to type '{action.get('text')}' again. Allowing it.")
                
                # Store action in history
                self.action_history.append(action)
                return action
                
            except json.JSONDecodeError as e:
                print(f"❌ Failed to parse Gemini response: {e}")
                print(f"Raw response: {response_text}")
                raise
            except Exception as e:
                error_str = str(e)
                
                # Rate limiting and retry logic (similar to OpenAI)
                if "429" in error_str or "quota" in error_str.lower() or "rate" in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = base_delay * (2 ** attempt)
                        print(f"⏳ Rate limited! Waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        print(f"❌ Rate limit exceeded after {max_retries} retries")
                        raise
                else:
                    print(f"❌ Gemini query failed: {e}")
                    raise
        
        raise Exception("Max retries exceeded")
    
    async def _query_openai_compatible(self, screenshot_base64: str, system_prompt: str) -> Dict[str, Any]:
        """Query OpenAI-compatible APIs (OpenAI, OpenRouter, Custom, LM Studio)"""
        max_retries = 5
        base_delay = 2  # seconds
        
        for attempt in range(max_retries):
            try:
                # Check rate limits before making request
                await self._check_rate_limits()
                
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
                
                # Clean JSON response (removes comments, markdown, etc.)
                response_text = self._clean_json_response(response_text)
                
                action = json.loads(response_text)
                print(f"💭 {self.provider.upper()}: {action.get('thought', '')}")
                print(f"⚡ Action: {action.get('action_type', '')} (confidence: {action.get('confidence', 0):.2f})")
                
                # Loop detection - warn but allow LLM to learn
                if len(self.action_history) >= 2:
                    last_action = self.action_history[-1]
                    
                    # Detect repeated clicks - warn only
                    if (action.get('action_type') == last_action.get('action_type') == 'click' and
                        action.get('tag_id') == last_action.get('tag_id')):
                        print("⚠️ WARNING: LLM chose same click action. Allowing it (may be intentional for input focus).")
                    
                    # Detect repeated typing - warn only
                    elif (action.get('action_type') == last_action.get('action_type') == 'type' and
                          action.get('text', '').lower() == last_action.get('text', '').lower()):
                        print(f"⚠️ WARNING: LLM chose to type '{action.get('text')}' again. Allowing it.")
                
                # Store action in history
                self.action_history.append(action)
                
                # Reset rate limit counter on successful request
                self.consecutive_rate_limits = 0
                
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
                        # Progressive delay: 10s, 20s, 30s based on consecutive rate limits
                        self.consecutive_rate_limits += 1
                        if self.consecutive_rate_limits == 1:
                            wait_time = 10
                        elif self.consecutive_rate_limits == 2:
                            wait_time = 20
                        else:
                            wait_time = 30
                        
                        # Try to parse Retry-After header if available
                        retry_after = None
                        if hasattr(e, 'response') and hasattr(e.response, 'headers'):
                            retry_after_header = e.response.headers.get('Retry-After')
                            if retry_after_header:
                                try:
                                    retry_after = int(retry_after_header)
                                    self.last_retry_after = datetime.now() + timedelta(seconds=retry_after)
                                    wait_time = max(wait_time, retry_after)  # Use the longer delay
                                    print(f"⏳ Rate limited! Server says wait {retry_after}s")
                                except ValueError:
                                    pass
                        
                        print(f"🚨 Rate limit hit (consecutive: {self.consecutive_rate_limits})")
                        print(f"⏳ Waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
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
                
                # 2.5. Check for captcha
                captcha_detected = await self.detect_captcha()
                if captcha_detected:
                    print("🛡️ CAPTCHA DETECTED - Pausing for human intervention")
                    await websocket.send_json({
                        "type": "captcha_detected",
                        "message": "Captcha detected! Please solve it manually in the browser, then the agent will continue."
                    })
                    
                    # Wait for captcha to be solved (check every 5 seconds)
                    captcha_solved = False
                    max_wait_attempts = 60  # Wait up to 5 minutes
                    wait_attempt = 0
                    
                    while not captcha_solved and wait_attempt < max_wait_attempts:
                        # Check FIRST if user manually skipped (this is critical!)
                        if self.captcha_skip_requested:
                            print("⚡ Captcha wait manually skipped by user")
                            self.captcha_skip_requested = False  # Reset flag
                            captcha_solved = True  # Mark as solved to exit loop
                            await websocket.send_json({
                                "type": "captcha_solved",
                                "message": "Captcha wait skipped by user - continuing mission"
                            })
                            break  # Exit immediately
                        
                        await asyncio.sleep(5)
                        wait_attempt += 1
                        captcha_still_present = await self.detect_captcha()
                        
                        if not captcha_still_present:
                            captcha_solved = True
                            print("✅ Captcha appears to be solved! Continuing...")
                            await websocket.send_json({
                                "type": "captcha_solved",
                                "message": "Captcha solved! Continuing mission..."
                            })
                        else:
                            if wait_attempt % 6 == 0:  # Log every 30 seconds
                                print(f"⏳ Still waiting for captcha to be solved... ({wait_attempt * 5}s)")
                    
                    if not captcha_solved:
                        print("⚠️ Captcha wait timeout - continuing anyway")
                        await websocket.send_json({
                            "type": "status",
                            "message": "Captcha wait timeout - attempting to continue"
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
    
    async def cleanup(self, keep_browser_open: bool = True):
        """Clean up browser resources
        
        Args:
            keep_browser_open: If True, keeps browser window open for manual interaction.
                              If False, closes everything (old behavior)
        """
        if keep_browser_open:
            print("🌐 Browser will remain open for manual interaction")
            print("   Close the browser window manually when done")
            return
        
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

