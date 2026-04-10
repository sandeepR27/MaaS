"""
Interview Manager - Core orchestration logic for interviews
"""

import asyncio
import uuid
from typing import Dict, Optional, List, Any
from datetime import datetime, timedelta
import json

from loguru import logger

from config import settings
from models import InterviewState, InterviewStage
from interview_pipeline import InterviewPipeline


class InterviewManager:
    """Manages active interviews and their pipelines"""

    def __init__(self):
        self.active_interviews: Dict[str, InterviewPipeline] = {}
        self.interview_states: Dict[str, InterviewState] = {}
        self.bot_to_interview: Dict[str, str] = {}
        self.cleanup_task: Optional[asyncio.Task] = None

    async def start(self):
        """Start the interview manager"""
        logger.info("Starting Interview Manager")
        self.cleanup_task = asyncio.create_task(self._cleanup_expired_interviews())

    async def stop(self):
        """Stop the interview manager"""
        logger.info("Stopping Interview Manager")

        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass

        # Stop all active interviews
        stop_tasks = []
        for interview_id, pipeline in self.active_interviews.items():
            stop_tasks.append(pipeline.stop())

        if stop_tasks:
            await asyncio.gather(*stop_tasks, return_exceptions=True)

        self.active_interviews.clear()
        self.interview_states.clear()

    async def create_interview(self, candidate_name: str, meeting_url: str) -> str:
        """Create a new interview session"""
        interview_id = str(uuid.uuid4())

        # Create interview state
        interview_state = InterviewState(
            id=interview_id,
            candidate_name=candidate_name,
            meeting_url=meeting_url,
            status="pending",
            current_stage="introduction",
            current_question_index=0,
            created_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(minutes=settings.interview_timeout_minutes)
        )

        self.interview_states[interview_id] = interview_state

        logger.info(f"Created interview {interview_id} for {candidate_name}")
        return interview_id

    async def start_interview(self, interview_id: str, bot_id: str) -> bool:
        """Start an interview with the given bot ID"""
        if interview_id not in self.interview_states:
            logger.error(f"Interview {interview_id} not found")
            return False

        interview_state = self.interview_states[interview_id]
        interview_state.bot_id = bot_id
        interview_state.status = "active"

        # Create and start the interview pipeline
        try:
            pipeline = InterviewPipeline(interview_id, interview_state)
            await pipeline.start()

            self.active_interviews[interview_id] = pipeline
            self.bot_to_interview[bot_id] = interview_id
            logger.info(f"Started interview {interview_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to start interview {interview_id}: {e}")
            interview_state.status = "error"
            return False

    async def end_interview(self, interview_id: str) -> bool:
        """End an interview session"""
        if interview_id not in self.active_interviews:
            logger.warning(f"Interview {interview_id} not active")
            return False

        pipeline = self.active_interviews[interview_id]
        await pipeline.stop()

        del self.active_interviews[interview_id]

        interview_state = self.interview_states.get(interview_id)
        if interview_state:
            if interview_state.bot_id and interview_state.bot_id in self.bot_to_interview:
                del self.bot_to_interview[interview_state.bot_id]
            interview_state.status = "completed"

        logger.info(f"Ended interview {interview_id}")
        return True

    def get_interview_state(self, interview_id: str) -> Optional[InterviewState]:
        """Get the current state of an interview"""
        return self.interview_states.get(interview_id)

    def find_interview_by_bot_id(self, bot_id: str) -> Optional[InterviewState]:
        """Lookup an interview using the associated bot ID"""
        interview_id = self.bot_to_interview.get(bot_id)
        if not interview_id:
            return None
        return self.interview_states.get(interview_id)

    def get_active_interviews(self) -> List[str]:
        """Get list of active interview IDs"""
        return list(self.active_interviews.keys())

    async def process_transcript(self, interview_id: str, transcript_data: Dict[str, Any]):
        """Process incoming transcript data from Recall AI"""
        if interview_id not in self.active_interviews:
            logger.warning(f"Received transcript for inactive interview {interview_id}")
            return

        pipeline = self.active_interviews[interview_id]
        await pipeline.process_transcript(transcript_data)

    async def _cleanup_expired_interviews(self):
        """Periodically clean up expired interviews"""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute

                current_time = datetime.utcnow()
                expired_ids = []

                for interview_id, state in self.interview_states.items():
                    if state.expires_at and current_time > state.expires_at:
                        expired_ids.append(interview_id)

                for interview_id in expired_ids:
                    logger.info(f"Cleaning up expired interview {interview_id}")
                    await self.end_interview(interview_id)
                    del self.interview_states[interview_id]

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")
                await asyncio.sleep(5)
# Global singleton instance
interview_manager = InterviewManager()
