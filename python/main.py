"""
AI Interview Orchestration Server
Real-time voice interview system using Pipecat and Gemini Live
"""

import os
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Optional, Any
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from loguru import logger
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger.add("logs/orchestrator.log", rotation="10 MB")

# Import our modules
from config import settings
from interview_manager import InterviewManager
from webhook_handler import WebhookHandler
from websocket_manager import WebSocketManager

# Global managers
interview_manager: Optional[InterviewManager] = None
webhook_handler: Optional[WebhookHandler] = None
websocket_manager: Optional[WebSocketManager] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Import the singletons
    from interview_manager import interview_manager
    from websocket_manager import websocket_manager

    # Startup
    logger.info("Starting AI Interview Orchestrator...")

    # Start background tasks on the singletons
    await interview_manager.start()
    await websocket_manager.start()

    logger.info("AI Interview Orchestrator started successfully")

    yield

    # Shutdown
    logger.info("Shutting down AI Interview Orchestrator...")
    await interview_manager.stop()
    await websocket_manager.stop()
    logger.info("AI Interview Orchestrator shut down")

# Create FastAPI app
app = FastAPI(
    title="AI Interview Orchestrator",
    description="Real-time voice interview system using Pipecat and Gemini Live",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "service": "AI Interview Orchestrator",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "interview_manager": interview_manager is not None,
        "webhook_handler": webhook_handler is not None,
        "websocket_manager": websocket_manager is not None,
    }

# Include routers
from routes import interviews, webhooks, websockets

app.include_router(interviews.router, prefix="/api/v1", tags=["interviews"])
app.include_router(webhooks.router, prefix="/api/v1", tags=["webhooks"])
app.include_router(websockets.router, prefix="/api/v1", tags=["websockets"])

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
        log_level="info"
    )