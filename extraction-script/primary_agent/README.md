# Primary Agent

User interaction layer that understands user intent and generates instructions.

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

- **Health Check**: `GET http://localhost:3001/health`
- **Process Input**: `POST http://localhost:3001/process`
  ```json
  {
    "userInput": "Navigate to google.com",
    "currentContext": {
      "url": "https://example.com",
      "pageTitle": "Example"
    },
    "config": {
      "model": "google/gemma-4-12b-qat",
      "temperature": 0.3
    }
  }
  ```
- **Process Input (Streaming)**: `POST http://localhost:3001/process/stream`
  Same body as `/process`, but responds with `text/event-stream`. Streams the
  model's raw token output (intent recognition + instruction generation) plus
  an estimated time to completion (ETA) per phase, then a final `done` event.
  When `autoExecute: true`, the secondary agent's execution events are relayed
  through the same stream.
- **Clear History**: `POST http://localhost:3001/clear-history`
- **Get History**: `GET http://localhost:3001/history`

## Port

Default: **3001** (configurable via `PORT` environment variable)

