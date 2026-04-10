import httpx
import asyncio
from loguru import logger
from config import settings

# Silent MP3 - ~0.5s of silence, base64 encoded
SILENT_MP3_B64 = (
    "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7"
    "//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJA"
    "AAAAAAAAABhkVHpRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAA"
)

def get_recall_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url="https://api.recall.ai/api/v1",
        headers={
            "Authorization": f"Token {settings.recall_api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        timeout=30.0,
    )

async def create_bot(meeting_url: str, webhook_url: str, bot_name: str = "AI Interviewer") -> dict:
    payload = {
        "meeting_url": meeting_url,
        "bot_name": bot_name,
        "recording_config": {
            "transcript": {
                "provider": {
                    "recallai_streaming": {
                        "language_code": "auto",
                        "mode": "prioritize_accuracy",
                    },
                },
                "diarization": {
                    "use_separate_streams_when_available": True,
                },
            },
            "realtime_endpoints": [
                {
                    "type": "webhook",
                    "url": webhook_url,
                    "events": [
                        "transcript.data",
                        "participant_events.speech_on",
                        "participant_events.speech_off",
                        "participant_events.join",
                        "participant_events.leave",
                    ],
                },
            ],
        },
        "automatic_audio_output": {
            "in_call_recording": {
                "data": {
                    "kind": "mp3",
                    "b64_data": SILENT_MP3_B64,
                },
            },
        },
    }

    max_retries = 10
    retry_interval = 30

    async with get_recall_client() as client:
        for attempt in range(1, max_retries + 1):
            try:
                response = await client.post("/bot/", json=payload)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                if status == 507 and attempt < max_retries:
                    logger.warning(f"Bot creation returned 507, retrying in 30s (attempt {attempt}/{max_retries})")
                    await asyncio.sleep(retry_interval)
                    continue
                if status == 429:
                    retry_after = int(e.response.headers.get("retry-after", "5"))
                    logger.warning(f"Rate limited, waiting {retry_after}s")
                    await asyncio.sleep(retry_after)
                    continue
                logger.error(f"Recall API Error: {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"Network error creating bot: {e}")
                raise
        
        raise Exception("Ad-hoc bot capacity was unavailable after 10 retries.")


async def send_audio(bot_id: str, audio_data_b64: str) -> bool:
    """Send MP3 audio to a Recall bot to be played in the call.

    Recall API reference:
      POST /api/v1/bot/{id}/send_audio/
      Body: { "data": { "kind": "mp3", "b64_data": "<base64>" } }
    """
    payload = {
        "data": {
            "kind": "mp3",
            "b64_data": audio_data_b64,
        }
    }

    async with get_recall_client() as client:
        try:
            response = await client.post(f"/bot/{bot_id}/send_audio/", json=payload)
            response.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            logger.error(
                f"Recall send_audio HTTP error for bot {bot_id}: "
                f"{e.response.status_code} — {e.response.text}"
            )
            return False
        except Exception as e:
            logger.error(f"Recall send_audio error for bot {bot_id}: {e}")
            return False
