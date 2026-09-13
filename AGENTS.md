# Agent System Documentation

## Overview

The system consists of two independent agents that can run on separate ports:

- **Primary Agent** (Port 3001): User interaction layer - understands intent and generates instructions
- **Secondary Agent** (Port 3002): Action execution layer - executes instructions using browser automation

## Quick Start

### Start Both Agents

```bash
./start-agents.sh
```

This will:
1. Install dependencies for both agents (if needed)
2. Start Primary Agent on port 3001
3. Start Secondary Agent on port 3002

### Start Agents Individually

**Primary Agent:**
```bash
cd primary_agent
npm install
npm run dev  # Development mode with auto-reload
# OR
npm start    # Production mode
```

**Secondary Agent:**
```bash
cd secondary_agent
npm install
npm run dev  # Development mode with auto-reload
# OR
npm start    # Production mode
```

## Architecture

### Primary Agent (Port 3001)

**Purpose:** Understands user input and converts it to actionable instructions

**Endpoints:**
- `GET /health` - Health check
- `GET /models` - List the models available in LM Studio (`{success, models[], defaultModel}`)
- `POST /process` - Process user input and generate instructions
- `POST /process/stream` - Process user input with live SSE streaming + ETA
- `GET /activity` - Live SSE stream of server console output (feeds the portal's **Live Server Activity** panel; relays the secondary agent's logs too)
- `POST /clear-history` - Clear conversation history
- `GET /history` - Get conversation history

**Model selection:** both agents accept a per-request `config: { model, temperature, maxInstructions? }`.
The primary applies it to itself and forwards `secondaryConfig` to the secondary as its `config`.
The portal's Configuration card has a **Model** dropdown populated from `GET /models`
(choice persisted in `localStorage`); it sends the selected model as both `config.model`
and `secondaryConfig.model`. Config updates go through `PrimaryAgent.updateConfig()` /
`SecondaryAgent.updateConfig()` — never `Object.assign(agent, new Agent(config))`, which
would replace `conversationHistory` with a fresh empty array on every request.

**Example Request (Generate Instructions Only):**
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "Navigate to google.com",
    "currentContext": {
      "url": "https://example.com",
      "pageTitle": "Example Page"
    }
  }'
```

**Example Request (Auto-Execute):**
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "Navigate to google.com",
    "autoExecute": true,
    "secondaryConfig": {
      "model": "google/gemma-4-12b-qat",
      "temperature": 0.2
    }
  }'
```

When `autoExecute: true`, the Primary Agent will:
1. Generate instructions from user input
2. Automatically fetch current context from Secondary Agent (if available)
3. Call Secondary Agent to execute the instructions
4. Return both the generated instructions AND the execution results

### Secondary Agent (Port 3002)

**Purpose:** Executes instructions using browser automation and database operations

**Dependencies:**
- Accesses `../extraction-script/lib/db.ts` for database operations
- Accesses `../extraction-script/lib/browser.ts` for browser automation
- Requires MySQL database running
- Requires LM Studio or OpenAI-compatible API

**Endpoints:**
- `GET /health` - Health check
- `GET /models` - List the models available in LM Studio
- `GET /context` - Get current page context (URL, elements, etc.)
- `POST /execute` - Execute a sequence of instructions
- `POST /execute/stream` - Execute instructions with live SSE streaming
- `GET /activity` - Live SSE stream of server console output (browser actions etc.)

**Example Request:**
```bash
curl -X POST http://localhost:3002/execute \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": [
      {
        "id": "inst_1",
        "action": "navigate",
        "target": "https://google.com",
        "reasoning": "Navigate to Google as requested",
        "priority": "high"
      }
    ]
  }'
```

## Live Streaming (SSE)

Both agents expose streaming variants (`/process/stream` on the primary,
`/execute/stream` on the secondary) that emit the model's raw token output as it
is generated, along with an estimated time to completion (ETA). This powers the
**Live Model Output** panel in the Agent Portal (`http://localhost:3000/agents`).

**Example Request:**
```bash
curl -N -X POST http://localhost:3001/process/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "Navigate to example.com",
    "autoExecute": true
  }'
```

**Event format:** each event is a `data:` line with a JSON payload:

```json
{ "type": "phase", "phase": "intent_recognition", "status": "started", "etaMs": 14000, "overallEtaMs": 36000 }
{ "type": "token",  "phase": "intent_recognition", "text": "...", "tokens": 42, "tokensPerSec": 18.4, "etaMs": 3100, "progress": 0.5 }
{ "type": "phase",  "phase": "intent_recognition", "status": "done", "durationMs": 1810, "tokens": 52 }
{ "type": "done",   "data": { "...": "final response payload" } }
{ "type": "error",  "error": "..." }
```

**Phases:**
- `intent_recognition` — primary agent classifies the user's intent
- `instruction_generation` — primary agent produces executable instructions
- `execution` — secondary agent runs the browser actions
- `selector_resolution` — secondary agent uses the LLM to resolve a target element

**ETA behavior:** ETAs are estimates that self-calibrate. Each phase starts with
a default expected token budget; as tokens stream in, the server measures the
real generation rate and re-computes the ETA on every token. Earlier phases may
look rough; later estimates converge. The frontend renders a live countdown and
a progress bar from the last `etaMs` / `progress` values.

## Complete Flow Examples

### Manual Flow (Two-Step)

1. **User sends input to Primary Agent:**
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{"userInput": "Click on the search button"}'
```

2. **Primary Agent responds with instructions:**
```json
{
  "success": true,
  "data": {
    "recognizedIntent": {
      "intent": "click_element",
      "confidence": 0.9,
      "entities": [{"type": "button_text", "value": "search"}]
    },
    "generatedInstructions": [
      {
        "id": "inst_1",
        "action": "click",
        "target": "search",
        "priority": "high"
      }
    ],
    "executed": false
  }
}
```

3. **Send instructions to Secondary Agent:**
```bash
curl -X POST http://localhost:3002/execute \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": [...instructions from primary agent...]
  }'
```

4. **Secondary Agent executes and returns results**

### Automatic Flow (One-Step)

**Single request with auto-execution:**
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "Click on the search button",
    "autoExecute": true
  }'
```

**Response includes both instructions AND execution results:**
```json
{
  "success": true,
  "data": {
    "recognizedIntent": {...},
    "generatedInstructions": [...],
    "executed": true,
    "executionResult": {
      "executionResults": [...],
      "finalContext": {...},
      "success": true,
      "message": "Successfully executed 1 instruction(s)"
    },
    "finalResponse": "A direct, natural-language answer composed from the extracted data."
  }
}
```

The Primary Agent automatically:
- Generates instructions
- Fetches current context from Secondary Agent (if available)
- Executes instructions via Secondary Agent
- Composes a direct answer (`finalResponse`) from the execution results
- Returns complete results

### Answer synthesis

After execution, the Primary Agent runs a `response_synthesis` phase: the
execution results (final page, deduplicated visible element texts) are fed back
to the model, which writes a short user-facing answer grounded only in that
data. It is streamed live (`phase: "response_synthesis"`) and returned as
`data.finalResponse` on both `/process` and `/process/stream`. The portal renders
it in an **Answer** card at the top of the Response panel. If the action failed
(e.g. a bot-check page), the answer says so instead of inventing facts.

### Navigation memory

- Every `navigate` action upserts the visited page into `scraped_pages`
  (`url` + `title` + `full_url`) and appends a `scraping_history` row.
- `/context` returns `recentPages` (latest 5) and the Primary Agent includes
  them in the instruction-generation prompt as "Recently visited pages".
- Extracted pages/elements persist in MySQL, so the agent can answer follow-up
  questions about pages it already visited.

## Integration with Extraction Script

The Secondary Agent dynamically imports and uses:
- `extraction-script/lib/db.ts` - Database query functions
- `extraction-script/lib/browser.ts` - Browser automation (Playwright)

This allows the agent to:
- Query the database for page elements and context
- Navigate pages
- Click elements
- Fill forms
- Extract page content
- Scroll pages

## Configuration

### Environment Variables

**Primary Agent:**
- `PORT` - Server port (default: 3001)
- `SECONDARY_AGENT_URL` - URL of secondary agent (default: http://localhost:3002)

**Secondary Agent:**
- `PORT` - Server port (default: 3002)

### Agent Configuration (via API)

Both agents accept configuration in their request bodies:

**Primary Agent Config:**
```json
{
  "model": "google/gemma-4-12b-qat",
  "temperature": 0.3,
  "maxInstructions": 5
}
```

**Secondary Agent Config:**
```json
{
  "model": "google/gemma-4-12b-qat",
  "temperature": 0.2,
  "maxRetries": 2
}
```

## Troubleshooting

### Secondary Agent can't access extraction-script modules

Make sure you're running from the project root and the extraction-script directory exists at the correct relative path.

### Port already in use

Change the port using the `PORT` environment variable:
```bash
PORT=3003 npm run dev
```

### Database connection errors

Ensure MySQL is running and the database `interact_gen` exists. Check `extraction-script/lib/db.ts` for connection settings.

### Browser automation errors

Ensure Playwright browsers are installed:
```bash
cd extraction-script
npx playwright install
```

### `page.evaluate: ReferenceError: __name is not defined`

`tsx` runs esbuild with `keepNames`, which wraps named inner functions with an
esbuild-only `__name` helper. When such a function is serialized by Playwright
into the page context, `__name` is undefined. This happens in
`extraction-script/lib/browser.ts` when a `page.evaluate` callback contains
function expressions assigned to variables (`const isVisible = (el) => ...` or
`const add = (v) => ...` — esbuild annotates those too).

**Fix:** inside `page.evaluate` callbacks, use only inline anonymous callbacks
(e.g. `arr.forEach(x => ...)`) and never assign a function to a variable.
See `getPageContent()` for the pattern. This only affects code executed via
`tsx` (the secondary agent); the Next.js build uses SWC and is unaffected.

### Frontend `next dev` keeps restarting every few minutes

Root cause found: the user's **hermes-agent gateway** (`~/.hermes`) had WhatsApp
enabled (`WHATSAPP_ENABLED=true` in `~/.hermes/.env`) and its bridge defaults to
port **3000**. On each retry the adapter health-checks
`http://127.0.0.1:3000/health`, treats the frontend's response as "bridge not
connected", then calls `_kill_port_process(3000)` → SIGTERM to `next dev`
(clean exit code 0) → `start-frontend.sh` restarts it → loop.

**Fix applied:** move the bridge off 3000 in `~/.hermes/config.yaml` (the
top-level `whatsapp:` block is ignored by the loader unless it has bridged keys,
so use the nested `platforms:` section which deep-merges `extra`):

```yaml
platforms:
  whatsapp:
    extra:
      bridge_port: 3100
```

Then `systemctl --user restart hermes-gateway`. If restarts resume, check
`journalctl --user -u hermes-gateway | grep -i whatsapp`.

### `Data too long for column 'url'` / `'title'` during extract

`scraped_pages.url` is the primary key; utf8mb4 `VARCHAR(768)` is the max for an
indexed column (3072 bytes), and search-result URLs can exceed it. The schema
now uses `VARCHAR(2048) CHARACTER SET ascii` for `url`/`page_url` (1 byte per
char) and the agent truncates titles to 512 chars. `db.ts` migrates existing
databases automatically (drops/re-adds the foreign keys around the ALTER).

### Stale compiled `.js` files shadowing `.ts` sources

`extraction-script/lib/browser.js` and `db.js` were old `tsc` output that
shadowed the `.ts` sources in the Next.js build (`.js` wins in webpack
resolution). They were deleted. If agent changes don't take effect, check for
stray `.js` twins: `find lib components app -name '*.js'` and delete any that
have a matching `.ts`/`.tsx`.

### Selector resolution picks the wrong element / "none"

- The resolver now uses **structured output** (`response_format: json_schema`)
  so the model must return `{"selector": "..."}` — no more 1500-token rambles.
- Note `max_tokens` **includes reasoning tokens** in LM Studio; capping it too
  low truncates the answer. Keep it ≥ 2048.
- Returned selectors are validated (`none`/`null`/empty rejected, must match at
  least one element). The prompt also allows a standard selector when the target
  is hidden (e.g. `input[type='search']`).
- Hidden elements (collapsed search overlays) are handled by `tryReveal()`:
  it finds a visible trigger sharing a keyword with the target, clicks it with a
  real Playwright click (marker attribute + trusted click), then retries the
  action. Keyword matching uses word boundaries so "enter" doesn't match
  "align-items-center".

### Google search hits a CAPTCHA ("sorry" page)

Google blocks the automated browser. The instruction translator now prefers
**DuckDuckGo** (`https://duckduckgo.com/`) for general web searches unless the
user names a site. The prompt tells the model to target elements by
**description** ("search box") instead of guessing CSS, and search fields submit
on Enter automatically (`isSearchInput` accepts `input` and `textarea`).

### `fill` / `click` time out on a guessed selector

Symptom: `fill: input[name='q']` + `click: button[type='submit']` on
duckduckgo.com both time out. Root causes and layered fixes:

- DDG's search box is a `<textarea name="q">`, so `input[name='q']` matches
  nothing. `fillElement` now falls back to `findEditableField()` — the best
  visible, enabled, non-credential editable field (search-hinted fields first) —
  and returns the selector it actually used.
- DDG's submit button is disabled until the box has text, so the click that
  follows a failed fill cannot succeed. `clickElement` now retries via
  `clickEnabledMatch()` (first visible + enabled match, waiting up to 3s for a
  disabled one to activate).
- `findBestSelector` validates selector-like targets with
  `countActionableMatches` (visible + enabled, not just present) and includes
  `name` / `tagName` / `disabled` in its heuristics and the LLM resolver prompt.
- `getPageContent` now extracts `attributes.name`, `tagName`, `inputType` and
  `disabled` so resolution has the data it needs.

### Conversation history resets when a model is selected

`Object.assign(agent, new PrimaryAgent(config))` copies the new instance's
`conversationHistory = []` over the singleton's history. Both servers must call
`agent.updateConfig(config)` instead — in **all four** handlers
(`/process`, `/process/stream`, `/execute`, `/execute/stream`). QA covers this
via the streaming path (`I5 history preserved...`).

### Streaming endpoint sends nothing / only the first event

SSE disconnect detection must use `res.on('close')`, not `req.on('close')`.
`req.on('close')` fires once the request body has been parsed (immediately for
these POSTs), which would suppress all subsequent events. See the
`/process/stream` and `/execute/stream` handlers.

### `shared/` named imports fail with "does not provide an export"

The `shared/` folder must stay ESM. It carries a `package.json` with
`"type": "module"` — keep it. Without it, `tsx`/Node load `.ts` files there as
CommonJS and named imports (`import { StreamSession } from '../shared/streaming'`)
fail.

