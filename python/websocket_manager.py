"""
WebSocket Manager - Handles real-time communication with frontend
"""

import asyncio
import json
from typing import Dict, Set, Optional, Any
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from interview_manager import InterviewManager
from models import WebSocketMessage


class WebSocketManager:
    """Manages WebSocket connections for real-time updates"""

    def __init__(self, interview_manager: InterviewManager):
        self.interview_manager = interview_manager
        self.active_connections: Dict[str, Set[WebSocket]] = {}  # interview_id -> connections
        self.connection_interviews: Dict[WebSocket, str] = {}  # connection -> interview_id
        self.ping_task: Optional[asyncio.Task] = None

    async def start(self):
        """Start the WebSocket manager"""
        logger.info("Starting WebSocket Manager")
        self.ping_task = asyncio.create_task(self._ping_connections())

    async def stop(self):
        """Stop the WebSocket manager"""
        logger.info("Stopping WebSocket Manager")

        if self.ping_task:
            self.ping_task.cancel()
            try:
                await self.ping_task
            except asyncio.CancelledError:
                pass

        # Close all connections
        close_tasks = []
        for connections in self.active_connections.values():
            for websocket in connections:
                close_tasks.append(self._close_connection(websocket))

        if close_tasks:
            await asyncio.gather(*close_tasks, return_exceptions=True)

        self.active_connections.clear()
        self.connection_interviews.clear()

    async def connect(self, websocket: WebSocket, interview_id: str, auth_token: str) -> bool:
        """Connect a new WebSocket client"""
        try:
            # Verify interview exists and auth token
            interview_state = self.interview_manager.get_interview_state(interview_id)
            if not interview_state:
                logger.warning(f"WebSocket connection rejected: invalid interview {interview_id}")
                await websocket.close(code=4001, reason="Invalid interview")
                return False

            # Accept connection
            await websocket.accept()

            # Store connection
            if interview_id not in self.active_connections:
                self.active_connections[interview_id] = set()

            self.active_connections[interview_id].add(websocket)
            self.connection_interviews[websocket] = interview_id

            logger.info(f"WebSocket connected for interview {interview_id}")

            # Send initial state
            await self.send_to_interview(interview_id, {
                "type": "interview_state",
                "data": interview_state.dict()
            })

            return True

        except Exception as e:
            logger.error(f"WebSocket connection error: {e}")
            return False

    async def disconnect(self, websocket: WebSocket):
        """Disconnect a WebSocket client"""
        interview_id = self.connection_interviews.get(websocket)

        if interview_id and interview_id in self.active_connections:
            self.active_connections[interview_id].discard(websocket)

            if not self.active_connections[interview_id]:
                del self.active_connections[interview_id]

        if websocket in self.connection_interviews:
            del self.connection_interviews[websocket]

        logger.info(f"WebSocket disconnected from interview {interview_id}")

    async def handle_message(self, websocket: WebSocket, message: str):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            interview_id = self.connection_interviews.get(websocket)

            if not interview_id:
                return

            message_type = data.get('type')

            if message_type == 'ping':
                await websocket.send_json({"type": "pong"})
            elif message_type == 'start_interview':
                await self._handle_start_interview(interview_id, data)
            elif message_type == 'end_interview':
                await self._handle_end_interview(interview_id)
            else:
                logger.warning(f"Unknown message type: {message_type}")

        except json.JSONDecodeError:
            logger.warning("Invalid JSON in WebSocket message")
        except Exception as e:
            logger.error(f"Error handling WebSocket message: {e}")

    async def send_to_interview(self, interview_id: str, message: Dict[str, Any]):
        """Send message to all connections for an interview"""
        if interview_id not in self.active_connections:
            return

        message_json = json.dumps(message)
        send_tasks = []

        for websocket in self.active_connections[interview_id]:
            send_tasks.append(self._send_to_connection(websocket, message_json))

        if send_tasks:
            await asyncio.gather(*send_tasks, return_exceptions=True)

    async def broadcast_to_all(self, message: Dict[str, Any]):
        """Send message to all connected clients"""
        message_json = json.dumps(message)
        send_tasks = []

        for connections in self.active_connections.values():
            for websocket in connections:
                send_tasks.append(self._send_to_connection(websocket, message_json))

        if send_tasks:
            await asyncio.gather(*send_tasks, return_exceptions=True)

    async def _handle_start_interview(self, interview_id: str, data: Dict[str, Any]):
        """Handle start interview request"""
        bot_id = data.get('bot_id')
        if not bot_id:
            await self.send_to_interview(interview_id, {
                "type": "error",
                "message": "Bot ID required to start interview"
            })
            return

        success = await self.interview_manager.start_interview(interview_id, bot_id)

        if success:
            await self.send_to_interview(interview_id, {
                "type": "interview_started",
                "bot_id": bot_id
            })
        else:
            await self.send_to_interview(interview_id, {
                "type": "error",
                "message": "Failed to start interview"
            })

    async def _handle_end_interview(self, interview_id: str):
        """Handle end interview request"""
        success = await self.interview_manager.end_interview(interview_id)

        if success:
            await self.send_to_interview(interview_id, {
                "type": "interview_ended"
            })

    async def _send_to_connection(self, websocket: WebSocket, message: str):
        """Send message to a specific connection"""
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.error(f"Failed to send to WebSocket: {e}")
            # Connection might be dead, remove it
            await self.disconnect(websocket)

    async def _close_connection(self, websocket: WebSocket):
        """Close a WebSocket connection"""
        try:
            await websocket.close()
        except Exception:
            pass

    async def _ping_connections(self):
        """Periodically ping all connections to keep them alive"""
        while True:
            try:
                await asyncio.sleep(30)  # Ping every 30 seconds

                ping_message = json.dumps({"type": "ping"})

                for connections in self.active_connections.values():
                    for websocket in connections:
                        try:
                            await websocket.send_text(ping_message)
                        except Exception:
                            # Connection dead, will be cleaned up on next send
                            pass

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in ping task: {e}")
                await asyncio.sleep(5)

# Global singleton instance (uses the shared interview_manager)
from interview_manager import interview_manager as _im
websocket_manager = WebSocketManager(_im)
