"""
WebSocket API routes
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from loguru import logger

from websocket_manager import websocket_manager
from interview_manager import interview_manager

router = APIRouter()


@router.websocket("/ws/interview/{interview_id}")
async def interview_websocket(
    websocket: WebSocket,
    interview_id: str,
    token: str = Query(..., alias="auth_token")
):
    """WebSocket endpoint for real-time interview updates"""
    connected = await websocket_manager.connect(websocket, interview_id, token)

    if not connected:
        return

    try:
        while True:
            message = await websocket.receive_text()
            await websocket_manager.handle_message(websocket, message)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket_manager.disconnect(websocket)


@router.websocket("/ws/recall-audio/{interview_id}")
async def recall_audio_websocket(websocket: WebSocket, interview_id: str):
    """WebSocket endpoint for real-time audio from Recall AI"""
    await websocket.accept()
    logger.info(f"Recall audio websocket connected for interview {interview_id}")

    pipeline = interview_manager.active_interviews.get(interview_id)
    if not pipeline:
        # Give it a second to start if it hasn't
        import asyncio
        await asyncio.sleep(2)
        pipeline = interview_manager.active_interviews.get(interview_id)
        if not pipeline:
            logger.warning(f"No active pipeline for interview {interview_id}")
            await websocket.close(code=1008)
            return

    try:
        # Pass the raw websocket to the pipeline to manage Gemini Live connection
        await pipeline.handle_recall_audio_websocket(websocket)
    except WebSocketDisconnect:
        logger.info(f"Recall audio websocket disconnected for interview {interview_id}")
    except Exception as e:
        logger.error(f"Error in recall audio websocket: {e}")
        try:
            await websocket.close()
        except:
            pass