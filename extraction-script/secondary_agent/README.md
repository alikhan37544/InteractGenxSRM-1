# Secondary Agent

Action execution layer that executes instructions using browser automation and database.

## Running

```bash
# Install dependencies
npm install

# Development mode (auto-reload)
npm run dev

# Production mode
npm start
```

## API Endpoints

- **Health Check**: `GET http://localhost:3002/health`
- **Get Context**: `GET http://localhost:3002/context`
- **Execute Instructions**: `POST http://localhost:3002/execute`
  ```json
  {
    "instructions": [
      {
        "id": "inst_1",
        "action": "navigate",
        "target": "https://google.com",
        "priority": "high"
      }
    ],
    "config": {
      "model": "google/gemma-4-12b-qat",
      "temperature": 0.2,
      "maxRetries": 2
    }
  }
  ```
- **Execute Instructions (Streaming)**: `POST http://localhost:3002/execute/stream`
  Same body as `/execute`, but responds with `text/event-stream`. Streams
  execution phase events and the LLM selector-resolution token output, then a
  final `done` event with the full `SecondaryAgentResponse`.

## Port

Default: **3002** (configurable via `PORT` environment variable)

## Dependencies

This agent requires access to:
- `../extraction-script/lib/db.ts` - Database functions
- `../extraction-script/lib/browser.ts` - Browser automation
- MySQL database running on localhost
- LM Studio or OpenAI-compatible API on `http://localhost:1234/v1`

