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
- `POST /process` - Process user input and generate instructions
- `POST /clear-history` - Clear conversation history
- `GET /history` - Get conversation history

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
      "model": "google/gemma-3-1b-it",
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
- `GET /context` - Get current page context (URL, elements, etc.)
- `POST /execute` - Execute a sequence of instructions

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
    }
  }
}
```

The Primary Agent automatically:
- Generates instructions
- Fetches current context from Secondary Agent (if available)
- Executes instructions via Secondary Agent
- Returns complete results

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
  "model": "google/gemma-3-1b-it",
  "temperature": 0.3,
  "maxInstructions": 5
}
```

**Secondary Agent Config:**
```json
{
  "model": "google/gemma-3-1b-it",
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

