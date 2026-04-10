"""
Configuration settings for the AI Interview Orchestrator
"""

import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Server settings
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")

    # API Keys
    gemini_api_key: str = Field(..., env="GEMINI_API_KEY")
    recall_api_key: str = Field(..., env="RECALL_API_KEY")
    recall_region: str = Field(default="us-west-2", env="RECALL_REGION")
    recall_workspace_verification_secret: str = Field(..., validation_alias="RECALL_WORKSPACE_VERIFICATION_SECRET")

    # TTS Settings
    tts_provider: str = Field(default="google", env="TTS_PROVIDER")  # google, elevenlabs, cartesia
    google_tts_api_key: Optional[str] = Field(default=None, env="GOOGLE_TTS_API_KEY")
    elevenlabs_api_key: Optional[str] = Field(default=None, env="ELEVENLABS_API_KEY")
    elevenlabs_voice_id: str = Field(default="21m00Tcm4TlvDq8ikWAM", env="ELEVENLABS_VOICE_ID")
    cartesia_api_key: Optional[str] = Field(default=None, env="CARTESIA_API_KEY")

    # STT Settings
    stt_provider: str = Field(default="google", env="STT_PROVIDER")  # google, deepgram
    deepgram_api_key: Optional[str] = Field(default=None, env="DEEPGRAM_API_KEY")

    # Firebase settings (for state persistence)
    firebase_project_id: Optional[str] = Field(default=None, env="FIREBASE_PROJECT_ID")
    firebase_private_key: Optional[str] = Field(default=None, env="FIREBASE_PRIVATE_KEY")
    firebase_client_email: Optional[str] = Field(default=None, env="FIREBASE_CLIENT_EMAIL")

    # Interview settings
    max_concurrent_interviews: int = Field(default=10, env="MAX_CONCURRENT_INTERVIEWS")
    interview_timeout_minutes: int = Field(default=60, env="INTERVIEW_TIMEOUT_MINUTES")

    # WebSocket settings
    websocket_ping_interval: int = Field(default=30, env="WEBSOCKET_PING_INTERVAL")
    websocket_ping_timeout: int = Field(default=10, env="WEBSOCKET_PING_TIMEOUT")

    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


# Global settings instance
settings = Settings()