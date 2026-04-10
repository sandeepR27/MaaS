"""
WebSocket API routes
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from websocket_manager import websocket_manager

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