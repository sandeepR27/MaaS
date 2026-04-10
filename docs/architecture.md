# Architecture Overview - AI Interview System (Decoupled)

This document outlines the high-level architecture of the AI Interview pipeline, reflecting the transition from a monolithic Next.js serverless model to a decoupled, real-time orchestration system.

## Core Directives
*   **Decoupled Structure**: Next.js is strictly for the frontend and business logic; a separate Python server handles AI/Voice orchestration.
*   **Real-time Orchestration**: Powered by **Pipecat** and **Gemini Live**.
*   **Communication**: 
    - **WebSockets**: For two-way audio streaming between the client and the orchestrator.
    - **Webhooks**: Recall AI events are handled by the Python backend.
*   **Infrastructure**: Ephemeral, sandboxed environments for interview isolation.

---

## Architecture Diagram (Mermaid)

```mermaid
graph TD
    %% 1. Frontend Layer
    subgraph Frontend [1. Frontend Layer (Next.js)]
        UI[Interview Dashboard]
        Monitoring[Real-time Monitoring]
        Auth[Firebase Auth]
    end

    %% 2. External Services
    subgraph External [External Services]
        Recall[Recall AI Bot]
        Meet[Google Meet / Zoom]
        Meet <-->|WebRTC| Recall
    end

    %% 3. Orchestration Layer (New Pyt  hon Backend)
    subgraph Orchestrator [2. Orchestration Layer (Python/Pipecat)]
        FastAPI[FastAPI Server]
        Pipecat[Pipecat Pipeline]
        WebhookListener[Recall Webhook Handler]
        
        FastAPI <-->|WebSocket: Audio/State| UI
        Recall -- "HTTP POST: Transcripts/Events" --> WebhookListener
        WebhookListener --> Pipecat
    end

    %% 4. AI & Voice Layer
    subgraph AILayer [3. AI & Voice Layer]
        Gemini[Gemini Live API]
        STT[Deepgram / Native STT]
        TTS[Cartesia / Native TTS]
        
        Pipecat <--> Gemini
        Pipecat --> TTS
        STT --> Pipecat
    end

    %% Outbound Actions from Orchestrator
    Pipecat -- "Audio Stream" --> Recall

    %% Persistence
    Frontend <--> Firestore[(Firestore)]
    Orchestrator <--> Firestore
```

---

## Detailed Data Flow

1.  **Handshake**: 
    - The Next.js client initiates an interview and obtains an `invite_id` and `auth_token`.
    - The client establishes a **WebSocket connection** to the **Python Orchestration Server**, passing these credentials.
2.  **Recall AI Integration**:
    - Recall AI joins the meeting and sends **real-time webhooks** (transcripts and participant events) directly to the **Python backend**.
    - The Python backend's `WebhookListener` feeds these events into the **Pipecat pipeline**.
3.  **Real-time AI Processing**:
    - **Pipecat** orchestrates the flow between the user's speech and **Gemini Live**.
    - Gemini Live generates responses which are streamed back as audio via **TTS** (e.g., Cartesia or Gemini's native voice).
4.  **Audio Delivery**:
    - The generated audio is injected back into the Recall AI bot's audio stream for the meeting participants.
    - Simultaneously, audio/state updates are pushed to the Next.js client via the WebSocket for UI updates and local monitoring.
5.  **State Management**:
    - Both the Frontend and Orchestrator sync critical metadata with **Firestore**.
    - Each interview session runs in a **short-lived sandbox** that is destroyed upon interview completion.
