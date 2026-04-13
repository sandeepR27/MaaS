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
import json
import base64
import io

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger
from pydub import AudioSegment
from google import genai
from google.genai import types

from config import settings
from models import InterviewState, TranscriptEntry
from services.recall_api import send_audio, stop_audio


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
        self._gemini_session = None

        # Lazy import to avoid circular deps
        from agent_factory import create_specialized_agent
        self.agent = create_specialized_agent("hr_screener")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        """Mark the pipeline active."""
        logger.info(f"[{self.interview_id}] Interview pipeline starting.")
        self.is_running = True
        # Intro is now triggered inside handle_recall_audio_websocket once bridge is up

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
        
        # We wait for Gemini Live to be ready. 
        # If it doesn't connect in 10 seconds, we fallback to offline TTS.
        retries = 0
        while not self._gemini_session and retries < 10:
            await asyncio.sleep(1)
            retries += 1

        if self._gemini_session:
            logger.info(f"[{self.interview_id}] Sending intro turn via Gemini Live")
            await self._gemini_session.send({"client_content": {"turns": [{"role": "user", "parts": [{"text": greeting}]}], "turn_complete": True}})
        else:
            logger.warning(f"[{self.interview_id}] Gemini Live not connected, falling back to offline TTS for intro")
            await self._speak(greeting)

    # ------------------------------------------------------------------
    # Gemini Multimodal Live Bridge (Real-Time Audio)
    # ------------------------------------------------------------------

    async def handle_recall_audio_websocket(self, websocket: WebSocket):
        """Establish direct bridge between Recall Audio WS and Gemini Multimodal Live"""
        logger.info(f"[{self.interview_id}] Initializing Gemini Live Realtime Audio Bridge")
        
        client = genai.Client(api_key=settings.gemini_api_key, http_options={'api_version': 'v1alpha'})
        
        system_prompt = getattr(self.agent, "system_prompt", "You are an AI interviewer.")
        system_prompt += (
            "\n\nIMPORTANT IDENTITY RULES:"
            "\n1. You are a SINGLE person. Never use multiple voices or simulate multiple people."
            "\n2. Use a professional, calm, and natural tone."
            "\n3. Keep your questions concise (1-2 sentences)."
        )
        resume_attr = getattr(self.interview_state, "resume_text", "")
        if resume_attr and len(resume_attr) > 10:
            system_prompt += f"\n\nYou must strictly tailor your interview questions and dialogue to adapt to this candidate's resume:\n{resume_attr}"

        config = types.LiveConnectConfig(
            response_modalities=[types.LiveResponseModality.AUDIO],
            speech_config=types.LiveSpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Aoede"  # Aoede is natural female, Charon is male. 
                    )
                )
            ),
            system_instruction=types.Content(parts=[types.Part.from_text(text=system_prompt)])
        )

        try:
            async with client.aio.live.connect("models/gemini-2.0-flash-exp", config=config) as session:
                self._gemini_session = session
                logger.info(f"[{self.interview_id}] Connected to Gemini Live!")

                # Send opening greeting immediately via Gemini Live Turn
                candidate = self.interview_state.candidate_name
                greeting = (
                    f"Hello {candidate}, welcome to your interview! "
                    "I'm your AI interviewer today. "
                    "Could you please start by introducing yourself and telling me about your background?"
                )
                logger.info(f"[{self.interview_id}] Sending intro turn via Gemini Live bridge")
                await session.send({"client_content": {"turns": [{"role": "user", "parts": [{"text": greeting}]}], "turn_complete": True}})

                async def receive_from_recall():
                    try:
                        while self.is_running:
                            msg = await websocket.receive_text()
                            data = json.loads(msg)
                            if data.get("event") == "audio_mixed_raw.data":
                                b64_aud = data.get("data", {}).get("b64_data")
                                if b64_aud:
                                    # Forward PCM into Gemini
                                    pcm_bytes = base64.b64decode(b64_aud)
                                    await session.send({
                                        "realtime_input": {
                                            "media_chunks": [{
                                                "mime_type": "audio/pcm;rate=16000",
                                                "data": pcm_bytes
                                            }]
                                        }
                                    })
                    except WebSocketDisconnect:
                        logger.info(f"[{self.interview_id}] Recall WS Disconnected")
                    except Exception as e:
                        logger.error(f"[{self.interview_id}] Error reading from Recall WS: {e}")

                async def receive_from_gemini():
                    try:
                        pcm_buffer = bytearray()
                        async for response in session.receive():
                            server_content = response.server_content
                            if server_content is not None:
                                model_turn = server_content.model_turn
                                if model_turn:
                                    for part in model_turn.parts:
                                        if part.inline_data:
                                            # Keep buffering the 24kHz PCM from Gemini
                                            pcm_buffer.extend(part.inline_data.data)
                                            
                                # When Gemini states the turn is finished, we encode and push to Recall
                                if server_content.turn_complete:
                                    if pcm_buffer:
                                        await self._flush_audio_to_recall(bytes(pcm_buffer))
                                        pcm_buffer.clear()

                                # Handle Interruption: If Gemini detects user is speaking, stop the current bot audio
                                if server_content.interrupted:
                                    logger.info(f"[{self.interview_id}] Gemini detected interruption — stopping bot audio")
                                    pcm_buffer.clear()
                                    if self.interview_state.bot_id:
                                        await stop_audio(self.interview_state.bot_id)

                    except Exception as e:
                        logger.error(f"[{self.interview_id}] Error receiving from Gemini Live: {e}")

                await asyncio.gather(receive_from_recall(), receive_from_gemini())

        except Exception as e:
            logger.error(f"[{self.interview_id}] Failed to start Gemini Live Bridge: {e}")
        finally:
            self._gemini_session = None

    async def _flush_audio_to_recall(self, pcm_data: bytes):
        """Convert Gemini 24kHz PCM back into MP3 and push to Recall send_audio"""
        bot_id = self.interview_state.bot_id
        if not bot_id:
            return

        try:
            segment = AudioSegment(
                data=pcm_data,
                sample_width=2,
                frame_rate=24000,
                channels=1,
            )
            mp3_buffer = io.BytesIO()
            segment.export(mp3_buffer, format="mp3")
            b64_mp3 = base64.b64encode(mp3_buffer.getvalue()).decode("utf-8")
            
            logger.info(f"[{self.interview_id}] → Sending Voice Response to Meeting ({len(b64_mp3)} bytes)")
            await send_audio(bot_id, b64_mp3)
        except Exception as e:
            logger.error(f"[{self.interview_id}] Audio conversion error: {e}")

    # ------------------------------------------------------------------
    # Webhook Transcript processing (Legacy Fallback)
    # ------------------------------------------------------------------

    async def process_transcript(self, transcript_data: Dict[str, Any]):
        """Handle a transcript.data webhook payload from Recall AI."""
        if not self.is_running:
            return

        if self._gemini_session:
            # Ignore text transcripts if the Real-Time Audio stream is active
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
        if not self.is_running or self._gemini_session:
            logger.warning(f"[{self.interview_id}] Pipeline not running or Gemini Live active, skipping offline speech.")
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
