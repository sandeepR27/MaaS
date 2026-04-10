import { NextRequest, NextResponse } from "next/server";
import { addTranscriptEntry } from "@/lib/store";
import {
  findInterviewByBotId,
  appendTranscript,
  getInterviewState,
} from "@/lib/interview-state";
import { processTranscript, startInterview } from "@/lib/conversation-engine";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

/**
 * Real-time webhook endpoint for Recall AI.
 * Receives transcript.data and participant events.
 * Must return 200 immediately; processing happens async.
 */
export const POST = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (request: NextRequest) => {
      const rawBody = await request.text();
      const payload = JSON.parse(rawBody);

      // Note: For production, verify the webhook signature here.
      // Recall real-time webhooks use a query parameter token or workspace secret.
      // const signature = request.headers.get("x-recall-signature");
      // if (!verifyRecallWebhook(rawBody, signature)) {
      //   return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      // }

      const event = payload.event || payload.type as string;
      const botId = payload.data?.bot?.id as string;

      console.log(`[Webhook] Received event: ${event} for bot: ${botId}`);

      if (!botId) {
        return NextResponse.json({ status: "ok" });
      }

      // Find interview by bot ID
      const state = findInterviewByBotId(botId);
      if (!state) {
        console.warn(`[Webhook] No active interview state found for bot: ${botId}`);
        return NextResponse.json({ status: "ok" });
      }

      // Process event asynchronously (don't block the response)
      handleEventAsync(event, payload, state.interviewId).catch((e) =>
        console.error("Async event handling error:", e)
      );

      return NextResponse.json({ status: "ok" });
    })
  )
);

async function handleEventAsync(
  event: string,
  payload: Record<string, unknown>,
  interviewId: string
): Promise<void> {
  const data = payload.data as Record<string, unknown>;
  const innerData = data?.data as Record<string, unknown>;

  switch (event) {
    case "transcript.data": {
      const words = (innerData?.words as Array<{ text: string }>) || [];
      const text = words.map((w) => w.text).join(" ");
      const participant = innerData?.participant as {
        name?: string;
        id?: number;
      };

      if (!text.trim()) break;

      const state = getInterviewState(interviewId);

      // Skip if this is the bot speaking (check by name)
      const participantName = participant?.name?.toLowerCase() || "";
      if (
        participantName.includes("ai interviewer") ||
        participantName.includes("notetaker")
      ) {
        break;
      }

      // Store raw transcript
      addTranscriptEntry(interviewId, {
        speaker: participant?.name || "Unknown",
        text,
        timestamp: Date.now() / 1000,
        isProcessed: false,
      });

      // Accumulate transcript for processing
      appendTranscript(interviewId, text);

      // Silence Fallback: If no more transcript arrives for 3 seconds, and we have content, trigger processing.
      if (state) {
        if (state._silenceTimeout) {
          clearTimeout(state._silenceTimeout);
        }
        state._silenceTimeout = setTimeout(async () => {
          try {
            const currentState = getInterviewState(interviewId);
            if (
              currentState &&
              currentState.accumulatedTranscript.trim().length > 3 &&
              !currentState.isProcessing &&
              !currentState.isBotSpeaking
            ) {
              console.log(`[Webhook] Silence fallback triggered for ${interviewId} after 3s of inactivity`);
              await processTranscript(interviewId);
            }
          } catch (e) {
            console.error("Silence fallback error:", e);
          }
        }, 3000);
      }
      break;
    }

    case "participant_events.speech_off": {
      const participant = (
        data?.data as { participant?: { name?: string } }
      )?.participant;

      console.log(`[Webhook] speech_off for ${interviewId} from ${participant?.name}`);

      // Only trigger processing when a non-bot participant stops speaking
      const pName = participant?.name?.toLowerCase() || "";
      if (
        pName.includes("ai interviewer") ||
        pName.includes("notetaker")
      ) {
        break;
      }

      const state = getInterviewState(interviewId);
      if (!state) break;

      // Clear silence fallback if speech_off arrived
      if (state._silenceTimeout) {
        clearTimeout(state._silenceTimeout);
        state._silenceTimeout = null;
      }

      // Small delay to let final transcript arrive
      setTimeout(async () => {
        try {
          console.log(`[Webhook] Executing deferred processTranscript for ${interviewId}`);
          await processTranscript(interviewId);
        } catch (e) {
          console.error("Error processing transcript after speech_off:", e);
        }
      }, 2000);
      break;
    }

    case "participant_events.join": {
      const participant = (
        data?.data as { participant?: { name?: string } }
      )?.participant;

      const eventBotId = (payload as { data?: { bot?: { id?: string } } }).data?.bot?.id;
      console.log(
        `participant_events.join event for interview ${interviewId}, bot ${eventBotId}, participant: ${participant?.name}`
      );

      const pName = participant?.name?.toLowerCase() || "";
      // When a non-bot participant joins, start the interview if not yet started
      if (
        pName.includes("ai interviewer") ||
        pName.includes("notetaker")
      ) {
        console.log("Joined participant is bot/notetaker; no interview start.");
        break;
      }

      const state = getInterviewState(interviewId);
      console.log(
        `Interview state for ${interviewId}:`,
        JSON.stringify(state, null, 2)
      );

      if (state && state.conversationHistory.length === 0) {
        console.log("Scheduling startInterview in 3s for", interviewId);
        // Delay start slightly to ensure bot is fully in call
        setTimeout(async () => {
          try {
            const currentState = getInterviewState(interviewId);
            if (currentState && currentState.conversationHistory.length === 0) {
              console.log("Calling startInterview for", interviewId);
              await startInterview(interviewId);
            } else {
              console.log("Skipping startInterview: already started.");
            }
          } catch (e) {
            console.error("Error starting interview:", e);
          }
        }, 3000);
      } else {
        console.log("Not starting interview; conversation already started or missing state.");
      }
      break;
    }

    default:
      // Ignore other events
      break;
  }
}
