import { NextRequest, NextResponse } from "next/server";
import { getInterview } from "@/lib/store";
import { getInterviewState } from "@/lib/interview-state";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const GET = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (
      _request: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) => {
      const { id } = await params;
      const interview = getInterview(id);

      if (!interview) {
        return NextResponse.json({ error: "Interview not found" }, { status: 404 });
      }

      // Merge in-memory live state if available
      const liveState = getInterviewState(id);
      const liveData = liveState
        ? {
            currentStage: liveState.currentStage,
            currentQuestionIndex: liveState.currentQuestionIndex,
            currentQuestion: liveState.currentQuestion,
            isProcessing: liveState.isProcessing,
            isBotSpeaking: liveState.isBotSpeaking,
            conversationHistory: liveState.conversationHistory,
          }
        : null;

      return NextResponse.json({ ...interview, liveState: liveData });
    })
  )
);
