"""
Interview Pipeline — Recall AI + Pipecat TTS orchestration.

Flow:
  1. Recall AI bot joins meeting via Recall cloud.
  2. Recall streams transcript.data webhooks to this server.
  3. We run text through LangGraph + Gemini Agent for a response.
  4. We use Pipecat TTS (GeminiTTSService / CartesiaTTSService) to synthesize audio.
  5. We collect PCM frames, convert to MP3 (pydub), and push via Recall send_audio API.
"""

import asyncio
import base64
import io
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger
from pydub import AudioSegment

from config import settings
from models import InterviewState, TranscriptEntry
from services.recall_api import send_audio


# ---------------------------------------------------------------------------
# Pipecat TTS  — standalone helper (no full Pipeline needed)
# ---------------------------------------------------------------------------

async def _pipecat_tts_to_mp3_b64(text: str) -> Optional[str]:
    """
    Synthesize `text` with the configured Pipecat TTS service.
    Returns a base64-encoded MP3 string ready for Recall's send_audio API,
    or None on failure.

    PCM frames from Pipecat are 16-bit signed little-endian mono.
    pydub converts them to MP3 in-memory.
    """
    try:
        from pipecat.frames.frames import TTSAudioRawFrame

        tts_service = _build_tts_service()
        if tts_service is None:
            return None

        pcm_chunks: List[bytes] = []
        sample_rate: int = getattr(tts_service, "sample_rate", 24000)
        context_id = str(uuid.uuid4())

        # Call run_tts() standalone — yields TTSAudioRawFrame objects
        async for frame in tts_service.run_tts(text, context_id=context_id):
            if isinstance(frame, TTSAudioRawFrame):
                pcm_chunks.append(frame.audio)
                # Update sample_rate from the actual frame if available
                if hasattr(frame, "sample_rate") and frame.sample_rate:
                    sample_rate = frame.sample_rate

        if not pcm_chunks:
            logger.error("Pipecat TTS returned no audio frames")
            return None

        raw_pcm = b"".join(pcm_chunks)

        # Convert raw PCM (16-bit signed, mono) → MP3 in-memory
        segment = AudioSegment(
            data=raw_pcm,
            sample_width=2,        # 16-bit = 2 bytes
            frame_rate=sample_rate,
            channels=1,            # mono
        )
        mp3_buffer = io.BytesIO()
        segment.export(mp3_buffer, format="mp3")
        mp3_bytes = mp3_buffer.getvalue()

        return base64.b64encode(mp3_bytes).decode("utf-8")

    except Exception as e:
        logger.error(f"Pipecat TTS error: {e}")
        return None


def _build_tts_service():
    """Instantiate the correct Pipecat TTS service based on TTS_PROVIDER config."""
    provider = (settings.tts_provider or "gemini").lower()

    try:
        if provider in ("gemini", "google"):
            return _build_gemini_tts()

        elif provider == "cartesia":
            from pipecat.services.cartesia.tts import CartesiaTTSService
            if not settings.cartesia_api_key:
                logger.error("CARTESIA_API_KEY not set in environment")
                return None
            return CartesiaTTSService(
                api_key=settings.cartesia_api_key,
                voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",  # British English (default)
            )

        elif provider == "deepgram":
            from pipecat.services.deepgram.tts import DeepgramTTSService
            if not settings.deepgram_api_key:
                logger.error("DEEPGRAM_API_KEY not set in environment")
                return None
            return DeepgramTTSService(api_key=settings.deepgram_api_key)

        else:
            logger.error(f"Unknown TTS_PROVIDER: '{provider}'. Use gemini, cartesia, or deepgram.")
            return None

    except Exception as e:
        logger.error(f"Failed to build TTS service ({provider}): {e}")
        return None


def _build_gemini_tts():
    """
    Build a GeminiTTSService that authenticates with a plain Google AI Studio
    API key (AIzaSy…) via ClientOptions instead of requiring a service account.

    GeminiTTSService._create_client() normally only accepts service account JSON.
    We subclass it to intercept client creation and use api_key instead.
    """
    try:
        from google.api_core.client_options import ClientOptions
        from google.cloud import texttospeech_v1
        from pipecat.services.google.tts import GeminiTTSService

        api_key = settings.gemini_api_key
        if not api_key:
            logger.error("GEMINI_API_KEY not set in environment")
            return None

        class ApiKeyGeminiTTS(GeminiTTSService):
            """GeminiTTSService subclass that uses a plain API key for auth."""

            def _create_client(self, credentials, credentials_path):
                opts = ClientOptions(api_key=api_key)
                return texttospeech_v1.TextToSpeechAsyncClient(client_options=opts)

        return ApiKeyGeminiTTS(
            settings=GeminiTTSService.Settings(
                model="gemini-2.5-flash-tts",
                voice="Kore",
            )
        )

    except Exception as e:
        logger.error(f"Failed to build Gemini TTS service: {e}")
        return None



# ---------------------------------------------------------------------------
# InterviewPipeline
# ---------------------------------------------------------------------------

class InterviewPipeline:
    """
    Orchestrates a real-time AI interview session via Recall AI webhooks.

    Transcript arrives via webhook → LangGraph + Gemini Agent → Pipecat TTS
    → base64 MP3 → Recall send_audio API → bot speaks in the meeting.
    """

    def __init__(self, interview_id: str, interview_state: InterviewState):
        self.interview_id = interview_id
        self.interview_state = interview_state
        self.is_running = False

        # Lazy import to avoid circular deps
        from agent_factory import create_specialized_agent
        self.agent = create_specialized_agent("hr_screener")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        """Mark the pipeline active and kick off the opening greeting."""
        logger.info(f"[{self.interview_id}] Interview pipeline starting.")
        self.is_running = True
        asyncio.create_task(self._send_opening_greeting())

    async def stop(self):
        """Shut down the pipeline."""
        self.is_running = False
        logger.info(f"[{self.interview_id}] Interview pipeline stopped.")

    # ------------------------------------------------------------------
    # Opening greeting
    # ------------------------------------------------------------------

    async def _send_opening_greeting(self):
        """Wait for the bot to fully settle, then speak the first line."""
        await asyncio.sleep(3)
        candidate = self.interview_state.candidate_name
        greeting = (
            f"Hello {candidate}, welcome to your interview! "
            "I'm your AI interviewer today. "
            "Could you please start by introducing yourself and telling me about your background?"
        )
        logger.info(f"[{self.interview_id}] Sending opening greeting.")
        await self._speak(greeting)

    # ------------------------------------------------------------------
    # Transcript processing  (called from webhook_handler)
    # ------------------------------------------------------------------

    async def process_transcript(self, transcript_data: Dict[str, Any]):
        """Handle a transcript.data webhook payload from Recall AI."""
        if not self.is_running:
            return

        try:
            # Support both Recall real-time and batch webhook shapes
            transcript_obj = (
                transcript_data.get("transcript")
                or transcript_data.get("data", {}).get("transcript")
                or {}
            )
            transcript_text = transcript_obj.get("text", "").strip()
            speaker        = transcript_data.get("speaker", "unknown")
            timestamp      = transcript_data.get("timestamp", 0)

            if not transcript_text:
                return

            # Ignore the bot's own speech echoed back
            bot_id = self.interview_state.bot_id or ""
            if speaker == bot_id or str(speaker).lower() in ("bot", "ai interviewer"):
                return

            logger.info(f"[{self.interview_id}] ← '{speaker}': {transcript_text[:120]}")

            # Record user turn
            self.interview_state.conversation_history.append({
                "role": "user",
                "text": transcript_text,
                "timestamp": timestamp,
            })

            # Build messages list: system prompt + conversation history + current turn
            from interview_graph import app_graph
            from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

            system_prompt = getattr(self.agent, "system_prompt", "You are an AI interviewer.")
            messages = [SystemMessage(content=system_prompt)]

            # Replay conversation history so the agent has context
            for turn in self.interview_state.conversation_history[-20:]:  # last 20 turns
                if turn["role"] == "user":
                    messages.append(HumanMessage(content=turn["text"]))
                elif turn["role"] == "assistant":
                    messages.append(AIMessage(content=turn["text"]))

            # Run through LangGraph state machine then the agent
            graph_input = {
                "messages": messages,
                "current_stage": getattr(self.interview_state, "current_stage", "introduction"),
                "current_question_index": getattr(self.interview_state, "current_question_index", 0),
                "evaluation_notes": "",
            }
            new_state = await app_graph.ainvoke(graph_input)
            ai_msg    = await self.agent.ainvoke(new_state["messages"])
            response  = ai_msg.content if ai_msg else ""

            if response:
                await self._speak(response)

        except Exception as e:
            logger.error(f"[{self.interview_id}] Error processing transcript: {e}")

    # ------------------------------------------------------------------
    # TTS → Recall send_audio
    # ------------------------------------------------------------------

    async def _speak(self, text: str):
        """Convert text to audio via Pipecat TTS and send to the Recall bot."""
        if not self.is_running:
            logger.warning(f"[{self.interview_id}] Pipeline not running, skipping speech.")
            return

        bot_id = self.interview_state.bot_id
        if not bot_id:
            logger.error(f"[{self.interview_id}] No bot_id set — cannot send audio.")
            return

        logger.info(f"[{self.interview_id}] → Speaking: {text[:120]}…")

        # Record assistant turn
        self.interview_state.conversation_history.append({
            "role": "assistant",
            "text": text,
            "timestamp": datetime.utcnow().timestamp(),
        })

        # Synthesize audio with Pipecat TTS (fully async — no executor needed)
        audio_b64 = await _pipecat_tts_to_mp3_b64(text)

        if not audio_b64:
            logger.error(f"[{self.interview_id}] TTS produced no audio — response not spoken.")
            return

        success = await send_audio(bot_id, audio_b64)
        if success:
            logger.info(f"[{self.interview_id}] Audio delivered to bot {bot_id}.")
        else:
            logger.error(f"[{self.interview_id}] Failed to deliver audio to bot {bot_id}.")
