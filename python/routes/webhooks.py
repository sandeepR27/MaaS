"""
Webhook API routes for Recall AI
"""

from fastapi import APIRouter, Request, HTTPException

from webhook_handler import webhook_handler

router = APIRouter()


@router.post("/webhooks/recall")
async def recall_webhook(request: Request) -> dict:
    """Handle webhooks from Recall AI"""
    return await webhook_handler.process_webhook(request)


@router.post("/webhooks/recall/status")
async def recall_status_webhook(request: Request) -> dict:
    """Handle status webhooks from Recall AI"""
    return await webhook_handler.process_webhook(request)