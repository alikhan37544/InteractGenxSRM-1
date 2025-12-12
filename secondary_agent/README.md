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
      "model": "google/gemma-3-1b-it",
      "temperature": 0.2,
      "maxRetries": 2
    }
  }
  ```

## Port

Default: **3002** (configurable via `PORT` environment variable)

## Dependencies

This agent requires access to:
- `../extraction-script/lib/db.ts` - Database functions
- `../extraction-script/lib/browser.ts` - Browser automation
- MySQL database running on localhost
- LM Studio or OpenAI-compatible API on `http://localhost:1234/v1`

