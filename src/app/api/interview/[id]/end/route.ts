import { NextRequest, NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/store";
import { removeBot } from "@/lib/recall";
import { removeInterviewState } from "@/lib/interview-state";
import { generateInterviewReport } from "@/lib/report";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const POST = withErrorHandler(
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

      // Remove bot from call
      if (interview.botId) {
        try {
          await removeBot(interview.botId);
        } catch (e) {
          console.error("Error removing bot:", e);
        }
      }

      // Generate report if responses exist
      if (!interview.report && interview.responses.length > 0) {
        try {
          await generateInterviewReport(id);
        } catch (e) {
          console.error("Error generating report:", e);
        }
      }

      updateInterview(id, { status: "completed" });
      removeInterviewState(id);

      return NextResponse.json({ status: "Interview ended successfully" });
    })
  )
);
