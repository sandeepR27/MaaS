import { NextRequest, NextResponse } from "next/server";
import { getInterviewByBotId, updateInterview } from "@/lib/store";
import { getInterviewState, removeInterviewState } from "@/lib/interview-state";
import { generateInterviewReport } from "@/lib/report";
import { startInterview } from "@/lib/conversation-engine";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

/**
 * Bot lifecycle status webhook.
 * Register this URL in the Recall dashboard for bot.*, recording.*, transcript.* events.
 */
export const POST = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (request: NextRequest) => {
      const payload = await request.json();

      const event = payload.event as string;
      const botId = (payload.data?.bot?.id as string) ?? null;
      const subCode = (payload.data?.data?.sub_code as string) ?? null;

      if (!botId || !event) {
        return NextResponse.json({ status: "ok" });
      }

      const interview = getInterviewByBotId(botId);
      if (!interview) {
        return NextResponse.json({ status: "ok" });
      }

      // Handle bot lifecycle events
      if (event.startsWith("bot.")) {
        const statusCode = (payload.data?.data?.code as string) ?? null;
        const botStatus = statusCode || event;
        updateInterview(interview.id, { botStatus });
        console.log(`status webhook for interview ${interview.id}: event=${event}, statusCode=${statusCode}`);

        // Bot is fully in the call — these are the two active states Recall sends
        const IN_CALL_EVENTS = new Set([
          "bot.in_call_recording",
          "bot.in_call_not_recording",
        ]);
        const isInCall =
          IN_CALL_EVENTS.has(event) ||
          statusCode === "in_call" ||
          statusCode === "in_call_recording" ||
          statusCode === "in_call_not_recording";

        if (isInCall) {
          const state = getInterviewState(interview.id);
          if (state && state.conversationHistory.length === 0) {
            console.log(`Bot is in-call for ${interview.id} — starting interview in 3s`);
            setTimeout(async () => {
              try {
                await startInterview(interview.id);
              } catch (e) {
                console.error("Error starting interview from status webhook:", e);
              }
            }, 3000);
          }
        }

        if (event === "bot.fatal" || statusCode === "fatal") {
          updateInterview(interview.id, { status: "failed" });
          removeInterviewState(interview.id);
        }

        if (event === "bot.done" || event === "bot.call_ended" || statusCode === "done") {
          if (!interview.report && interview.status !== "completed") {
            try {
              await generateInterviewReport(interview.id);
            } catch (e) {
              console.error("Error generating report on bot.done:", e);
            }
          }
          removeInterviewState(interview.id);
        }
      }

      if (event === "recording.done" || event === "recording.failed") {
        console.log(`Recording ${event} for bot ${botId}, sub_code: ${subCode}`);
      }

      if (event === "transcript.done" || event === "transcript.failed") {
        console.log(`Transcript ${event} for bot ${botId}, sub_code: ${subCode}`);
      }

      return NextResponse.json({ status: "ok" });
    })
  )
);
