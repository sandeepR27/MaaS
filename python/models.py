"""
Data models for the interview system
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class InterviewStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    ERROR = "error"


class InterviewStage(str, Enum):
    INTRODUCTION = "introduction"
    TECHNICAL_SKILLS = "technical_skills"
    PROBLEM_SOLVING = "problem_solving"
    BEHAVIORAL = "behavioral"
    CLOSING = "closing"


class InterviewState(BaseModel):
    """Current state of an interview"""
    id: str
    candidate_name: str
    meeting_url: str
    bot_id: Optional[str] = None
    status: InterviewStatus = InterviewStatus.PENDING
    current_stage: str = "introduction"
    current_question_index: int = 0
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)
    scores: Dict[str, int] = Field(default_factory=dict)
    feedback: Dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_activity: datetime = Field(default_factory=datetime.utcnow)


class InterviewResponse(BaseModel):
    """Response from an interview question"""
    stage_name: str
    question_index: int
    question: str
    candidate_answer: str
    score: int
    feedback: str
    created_at: datetime


class TranscriptEntry(BaseModel):
    """Transcript entry from speech recognition"""
    id: str
    speaker: str
    text: str
    timestamp: float
    confidence: Optional[float] = None
    created_at: datetime


class InterviewReport(BaseModel):
    """Final interview report"""
    interview_id: str
    candidate_name: str
    overall_score: int
    summary: str
    recommendation: str
    strengths: List[str]
    areas_for_improvement: List[str]
    responses: List[InterviewResponse]
    created_at: datetime


class WebhookEvent(BaseModel):
    """Webhook event from Recall AI"""
    event: str
    data: Dict[str, Any]
    timestamp: Optional[float] = None


class WebSocketMessage(BaseModel):
    """WebSocket message structure"""
    type: str
    interview_id: str
    data: Dict[str, Any]
    timestamp: float = Field(default_factory=lambda: datetime.utcnow().timestamp())