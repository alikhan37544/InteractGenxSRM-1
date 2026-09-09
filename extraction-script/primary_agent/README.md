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
      "model": "google/gemma-3-1b-it",
      "temperature": 0.3
    }
  }
  ```
- **Clear History**: `POST http://localhost:3001/clear-history`
- **Get History**: `GET http://localhost:3001/history`

## Port

Default: **3001** (configurable via `PORT` environment variable)

