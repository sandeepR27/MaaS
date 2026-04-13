import { NextResponse } from "next/server";
import { listInterviews } from "@/lib/store";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";

// Fix aggressive caching in App Router
export const dynamic = "force-dynamic";

export const GET = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async () => {
      const interviews = listInterviews();
      
      // Sync status from Python for each interview
      const syncedInterviews = await Promise.all(interviews.map(async (iv) => {
        try {
          const env = getEnv();
          const pyRes = await fetch(`${env.PYTHON_API_URL}/api/v1/interviews/${iv.id}`, {
            next: { revalidate: 0 } // No caching
          });
          if (pyRes.ok) {
            const pyData = await pyRes.json();
            // Update local store with Python's status
            const updated = {
              ...iv,
              status: pyData.status as any,
              botStatus: pyData.status === "active" ? "in_call_recording" : iv.botStatus,
              currentStage: pyData.current_stage || iv.currentStage,
              currentQuestionIndex: pyData.current_question_index ?? iv.currentQuestionIndex,
            };
            // Side effect: update our in-memory store
            const { updateInterview } = await import("@/lib/store");
            updateInterview(iv.id, updated);
            return updated;
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`Failed to sync interview ${iv.id} with Python:`, message);
        }
        return iv;
      }));

      return NextResponse.json(syncedInterviews);
    })
  )
);
