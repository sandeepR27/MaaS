import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createInterview } from "@/lib/store";
import { createBot } from "@/lib/recall";
import { getEnv } from "@/lib/env";
import { getStageConfig, DEFAULT_STAGES } from "@/lib/pipeline";
import {
  setInterviewState,
  type InterviewState,
} from "@/lib/interview-state";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

const createBotSchema = z.object({
  meetingUrl: z.string().url("Invalid meeting URL"),
  candidateName: z.string().min(1, "Candidate name is required"),
  stages: z.array(z.string()).optional(),
});

export const POST = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (request: NextRequest) => {
      const body = await request.json();
      const parsed = createBotSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { meetingUrl, candidateName, stages: requestedStages } = parsed.data;
      const stages = requestedStages?.length ? requestedStages : DEFAULT_STAGES;

      // Validate all requested stages exist
      for (const stage of stages) {
        try {
          getStageConfig(stage);
        } catch {
          return NextResponse.json(
            { error: `Unknown stage: ${stage}` },
            { status: 400 }
          );
        }
      }

      const env = getEnv();
      const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhook/recall`;
      const statusWebhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhook/status`;

      // Create interview record
      const interview = createInterview({
        candidateName,
        meetingUrl,
        botId: null,
        botStatus: "pending",
        currentStage: stages[0],
        currentQuestionIndex: 0,
        status: "pending",
        stages: stages.map((stageName, index) => ({
          stageName,
          questions: getStageConfig(stageName).questions,
          status: "pending" as const,
          order: index,
        })),
      });

      // Create bot via Recall AI
      const bot = await createBot({
        meetingUrl,
        botName: "AI Interviewer",
        webhookUrl,
        statusWebhookUrl,
      });

      // Update interview with bot ID
      interview.botId = bot.id;
      interview.botStatus = "joining";

      // Initialize in-memory state
      const stageConfig = getStageConfig(stages[0]);
      const state: InterviewState = {
        interviewId: interview.id,
        botId: bot.id,
        candidateName,
        enabledStages: stages,
        currentStage: stages[0],
        currentQuestionIndex: 0,
        currentQuestion: stageConfig.questions[0],
        scores: [],
        isProcessing: false,
        isBotSpeaking: false,
        conversationHistory: [],
        accumulatedTranscript: "",
        lastSpeechTimestamp: 0,
      };
      setInterviewState(interview.id, state);

      return NextResponse.json({
        interviewId: interview.id,
        botId: bot.id,
        stages,
        status: "Bot is joining the meeting...",
      });
    })
  )
);
