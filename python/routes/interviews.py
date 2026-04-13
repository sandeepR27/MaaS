from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Request

from interview_manager import interview_manager
from models import InterviewState
from services.recall_api import create_bot

router = APIRouter()


@router.post("/interviews")
async def create_interview(request: Request) -> Dict[str, Any]:
    """Create a new interview session and spawn Recall AI Bot"""
    data = await request.json()
    candidate_name = data.get("candidate_name")
    meeting_url = data.get("meeting_url")
    resume_text = data.get("resume_text", "")
    app_url = data.get("app_url", "")

    if not candidate_name or not meeting_url:
        raise HTTPException(status_code=400, detail="candidate_name and meeting_url required")

    # Register the internal state first so we have the interview_id
    interview_id = await interview_manager.create_interview(candidate_name, meeting_url)
    state = interview_manager.get_interview_state(interview_id)
    if state:
        state.resume_text = resume_text

    # Construct the Webhook URL pointing strictly to this Python backend
    # E.g. https://<ngrok_or_domain>/api/v1/webhooks/recall
    base_url_str = app_url.rstrip('/') if app_url else str(request.base_url.replace(path='/').rstrip('/'))
    webhook_url = f"{base_url_str}/api/v1/webhooks/recall"
    
    # We must use WS or WSS depending on whether app_url is HTTPS
    ws_protocol = "wss" if base_url_str.startswith("https") else "ws"
    # Remove http(s):// to build proper ws(s)://
    domain_part = base_url_str.replace("https://", "").replace("http://", "")
    ws_url = f"{ws_protocol}://{domain_part}/api/v1/ws/recall-audio/{interview_id}"

    # Spawn the bot via Recall
    try:
        bot_response = await create_bot(meeting_url=meeting_url, webhook_url=webhook_url, ws_url=ws_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    bot_id = bot_response.get("id")

    # Immediately register the bot ID so webhook lookups work when bot joins
    if bot_id:
        interview_manager.bot_to_interview[bot_id] = interview_id
        state = interview_manager.get_interview_state(interview_id)
        if state:
            state.bot_id = bot_id

    return {
        "interview_id": interview_id,
        "bot_id": bot_id,
        "status": "Bot is joining the meeting..."
    }


@router.get("/interviews/{interview_id}")
async def get_interview(interview_id: str) -> InterviewState:
    """Get interview state"""
    interview_state = interview_manager.get_interview_state(interview_id)

    if not interview_state:
        raise HTTPException(status_code=404, detail="Interview not found")

    return interview_state


@router.post("/interviews/{interview_id}/start")
async def start_interview(interview_id: str, request: Dict[str, Any]) -> Dict[str, str]:
    """Start an interview"""
    bot_id = request.get("bot_id")

    if not bot_id:
        raise HTTPException(status_code=400, detail="bot_id required")

    success = await interview_manager.start_interview(interview_id, bot_id)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to start interview")

    return {"status": "started"}


@router.post("/interviews/{interview_id}/end")
async def end_interview(interview_id: str) -> Dict[str, str]:
    """End an interview"""
    success = await interview_manager.end_interview(interview_id)

    if not success:
        raise HTTPException(status_code=404, detail="Interview not found or not active")

    return {"status": "ended"}


@router.get("/interviews")
async def list_interviews() -> Dict[str, Any]:
    """List all active interviews"""
    active_ids = interview_manager.get_active_interviews()
    interviews = []

    for interview_id in active_ids:
        state = interview_manager.get_interview_state(interview_id)
        if state:
            interviews.append(state)

    return {"interviews": interviews}