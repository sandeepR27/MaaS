#!/usr/bin/env python3
"""
Test script for the AI Interview Orchestrator
"""

import asyncio
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def test_basic_setup():
    """Test basic setup and imports"""
    try:
        from config import settings
        from interview_manager import InterviewManager
        from webhook_handler import WebhookHandler
        from websocket_manager import WebSocketManager

        print("✓ All imports successful")

        # Test configuration loading
        print(f"✓ Gemini API Key configured: {bool(settings.gemini_api_key)}")
        print(f"✓ Recall API Key configured: {bool(settings.recall_api_key)}")

        # Test interview manager
        manager = InterviewManager()
        await manager.start()
        print("✓ Interview manager started")

        # Create test interview
        interview_id = await manager.create_interview("Test Candidate", "https://meet.google.com/test")
        print(f"✓ Created test interview: {interview_id}")

        # Clean up
        await manager.stop()
        print("✓ Interview manager stopped")

        print("\n🎉 Basic setup test passed!")

    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

    return True

if __name__ == "__main__":
    asyncio.run(test_basic_setup())