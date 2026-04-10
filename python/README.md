# AI Interview Orchestrator - Python Backend

This is the Python backend for the AI Interview system, providing real-time voice orchestration using Pipecat and Gemini Live.

## Features

- **Real-time Voice Orchestration**: Pipecat-powered conversation management
- **WebSocket Communication**: Real-time updates with Next.js frontend
- **Webhook Integration**: Event handling from Recall AI
- **AI Evaluation**: Gemini-powered interview assessment
- **Multi-provider TTS/STT**: Support for Cartesia, ElevenLabs, Google TTS

## Setup

1. **Install dependencies**:
   ```bash
   cd python
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run the server**:
   ```bash
   python main.py
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `RECALL_API_KEY` | Recall AI API key | Yes |
| `RECALL_REGION` | Recall AI region (default: us-west-2) | No |
| `RECALL_WORKSPACE_VERIFICATION_SECRET` | Webhook verification secret | No |
| `TTS_PROVIDER` | TTS provider (google, elevenlabs, cartesia) | No |
| `GOOGLE_TTS_API_KEY` | Google TTS API key | No |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | No |
| `CARTESIA_API_KEY` | Cartesia API key | No |
| `STT_PROVIDER` | STT provider (deepgram, google) | No |
| `DEEPGRAM_API_KEY` | Deepgram API key | No |

## API Endpoints

### REST API
- `POST /api/v1/interviews` - Create interview
- `GET /api/v1/interviews/{id}` - Get interview state
- `POST /api/v1/interviews/{id}/start` - Start interview
- `POST /api/v1/interviews/{id}/end` - End interview

### Webhooks
- `POST /api/v1/webhooks/recall` - Recall AI events
- `POST /api/v1/webhooks/recall/status` - Status updates

### WebSockets
- `WS /api/v1/ws/interview/{id}` - Real-time updates

## Architecture

```
Recall AI Webhooks → Webhook Handler → Interview Pipeline
                                      ↓
Next.js Frontend ← WebSocket ← Interview Manager
                                      ↓
                              Pipecat Pipeline (STT → AI → TTS)
```

## Development

For local development with ngrok:

1. Install ngrok
2. Run: `ngrok http 8000`
3. Use the ngrok URL for webhook endpoints in Recall AI dashboard

## Production Deployment

The server is designed to run on:
- Railway
- Render
- AWS/GCP/Azure
- Any container platform

Use environment variables for configuration and ensure webhook URLs are publicly accessible.