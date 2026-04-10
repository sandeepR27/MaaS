import { NextRequest } from "next/server";
import { getInterview } from "@/lib/store";
import { getInterviewState } from "@/lib/interview-state";
import {
  subscribeToInterview,
  unsubscribeFromInterview,
  type EventBusMessage,
} from "@/lib/event-bus";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function formatSseEvent(event: string, data: string) {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export const GET = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (
      _request: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) => {
      const { id: interviewId } = await params;
      const encoder = new TextEncoder();

      let closed = false;
      let listener: ((message: EventBusMessage) => void) | null = null;

      const stream = new ReadableStream({
        start(controller) {
          const send = (payload: string) => {
            if (closed) return;
            controller.enqueue(encoder.encode(payload));
          };

          listener = (message: EventBusMessage) => {
            send(formatSseEvent("update", JSON.stringify(message)));
          };

          subscribeToInterview(interviewId, listener);

          const interview = getInterview(interviewId);
          const liveState = getInterviewState(interviewId);
          const initialPayload = {
            type: "initial",
            interviewId,
            data: {
              interview,
              liveState: liveState || null,
            },
            timestamp: Date.now(),
          };

          send(formatSseEvent("update", JSON.stringify(initialPayload)));
        },
        cancel() {
          closed = true;
          if (listener) {
            unsubscribeFromInterview(interviewId, listener);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    })
  )
);
