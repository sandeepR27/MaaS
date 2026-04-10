"""
Webhook Handler - Processes events from Recall AI
"""

import hmac
import hashlib
import json
from datetime import datetime
from typing import Dict, Any, Optional
import asyncio

from fastapi import HTTPException, Request
from loguru import logger

from config import settings
from interview_manager import InterviewManager


class WebhookHandler:
    """Handles webhook events from Recall AI"""

    def __init__(self, interview_manager: InterviewManager):
        self.interview_manager = interview_manager

    async def process_webhook(self, request: Request) -> Dict[str, str]:
        """Process incoming webhook from Recall AI"""
        try:
            # Get raw body for signature verification
            raw_body = await request.body()
            body_str = raw_body.decode('utf-8')

            # Verify webhook signature if configured
            if settings.recall_workspace_verification_secret:
                signature = request.headers.get('x-recall-signature')
                if not self._verify_signature(body_str, signature):
                    logger.warning("Invalid webhook signature")
                    raise HTTPException(status_code=401, detail="Invalid signature")

            # Parse payload
            payload = json.loads(body_str)

            # Extract event data
            event = payload.get('event')
            data = payload.get('data', {})

            if not event:
                logger.warning("Webhook missing event field")
                return {"status": "ok"}

            # Process event asynchronously
            asyncio.create_task(self._handle_event_async(event, data))

            # Return immediately (webhooks should be fast)
            return {"status": "ok"}

        except json.JSONDecodeError:
            logger.error("Invalid JSON in webhook payload")
            raise HTTPException(status_code=400, detail="Invalid JSON")
        except Exception as e:
            logger.error(f"Webhook processing error: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

    def _verify_signature(self, payload: str, signature: Optional[str]) -> bool:
        """Verify webhook signature using workspace secret"""
        if not signature or not settings.recall_workspace_verification_secret:
            return False

        expected_signature = hmac.new(
            settings.recall_workspace_verification_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, expected_signature)

    async def _handle_event_async(self, event: str, data: Dict[str, Any]):
        """Handle webhook event asynchronously"""
        try:
            logger.info(f"Processing webhook event: {event}")

            if event == "bot.created":
                await self._handle_bot_created(data)
            elif event == "bot.updated":
                await self._handle_bot_updated(data)
            elif event == "transcript.data":
                await self._handle_transcript_data(data)
            elif event == "participant.joined":
                await self._handle_participant_joined(data)
            elif event == "participant.left":
                await self._handle_participant_left(data)
            elif event == "meeting.ended":
                await self._handle_meeting_ended(data)
            else:
                logger.info(f"Ignored event: {event}")

        except Exception as e:
            logger.error(f"Error handling webhook event {event}: {e}")

    async def _handle_bot_created(self, data: Dict[str, Any]):
        """Handle bot creation event"""
        bot_id = data.get('bot', {}).get('id')
        if bot_id:
            logger.info(f"Bot created: {bot_id}")

    async def _handle_bot_updated(self, data: Dict[str, Any]):
        """Handle bot update event — auto-start pipeline when bot joins the call"""
        bot_data = data.get('bot', {})
        bot_id = bot_data.get('id')

        # Recall sends status in two places depending on webhook type:
        # 1. data.bot.status_changes[-1].code  (real-time streaming)
        # 2. data.bot.status_changes[-1].code  OR  data.status  (status webhooks)
        status_changes = bot_data.get('status_changes', [])
        if status_changes:
            status = status_changes[-1].get('code', '')
        else:
            status = bot_data.get('status', '')

        if not bot_id or not status:
            logger.warning(f"bot.updated missing bot_id or status: {data}")
            return

        logger.info(f"Bot {bot_id} status update → {status}")

        IN_CALL_STATUSES = {
            "in_call_recording",
            "in_call_not_recording",
            "in_call",
            "joining_call",
        }

        if status in IN_CALL_STATUSES:
            interview_state = self.interview_manager.find_interview_by_bot_id(bot_id)

            if interview_state and interview_state.status == "pending":
                logger.info(f"Bot {bot_id} joined call — starting pipeline for {interview_state.id}")
                await self.interview_manager.start_interview(interview_state.id, bot_id)
            elif interview_state:
                logger.info(f"Bot {bot_id} already active (status={interview_state.status}), skipping start")
            else:
                logger.warning(f"Bot {bot_id} in call but no matching interview found")
        else:
            interview_state = self.interview_manager.find_interview_by_bot_id(bot_id)
            if interview_state:
                interview_state.last_activity = datetime.utcnow()

    async def _handle_transcript_data(self, data: Dict[str, Any]):
        """Handle transcript data event"""
        bot_id = data.get('bot', {}).get('id')
        transcript = data.get('transcript', {})

        if not bot_id or not transcript:
            return

        # Find interview by bot ID
        interview_state = self.interview_manager.find_interview_by_bot_id(bot_id)

        if interview_state:
            await self.interview_manager.process_transcript(
                interview_state.id, data
            )
        else:
            logger.warning(f"Received transcript for unknown bot {bot_id}")

    async def _handle_participant_joined(self, data: Dict[str, Any]):
        """Handle participant joined event"""
        bot_id = data.get('bot', {}).get('id')
        participant = data.get('participant', {})

        if bot_id and participant:
            logger.info(f"Participant joined: {participant.get('name', 'Unknown')}")

    async def _handle_participant_left(self, data: Dict[str, Any]):
        """Handle participant left event"""
        bot_id = data.get('bot', {}).get('id')
        participant = data.get('participant', {})

        if bot_id and participant:
            logger.info(f"Participant left: {participant.get('name', 'Unknown')}")

    async def _handle_meeting_ended(self, data: Dict[str, Any]):
        """Handle meeting ended event"""
        bot_id = data.get('bot', {}).get('id')

        if bot_id:
            logger.info(f"Meeting ended for bot {bot_id}")
            # Find and end interview
            # This would need to be implemented in interview manager

# Global singleton instance (uses the shared interview_manager)
from interview_manager import interview_manager as _im
webhook_handler = WebhookHandler(_im)
