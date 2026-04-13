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
  resumeText: z.string().optional(),
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
      const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/recall`;
      const statusWebhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhook/status`;

      // Check if resume provided to generate custom questions
      let stageConfigurations = stages.map((stageName, index) => ({
        stageName,
        questions: getStageConfig(stageName).questions,
        status: "pending" as const,
        order: index,
      }));

      if (parsed.data.resumeText && parsed.data.resumeText.trim().length > 50) {
        const { generateDynamicStages } = await import("@/lib/gemini");
        try {
          const dynamicConfigs = await generateDynamicStages(parsed.data.resumeText, stages);
          if (dynamicConfigs && dynamicConfigs.length) {
              stageConfigurations = stages.map((stageName, index) => {
                  const dynamicCfg = dynamicConfigs.find(c => c.stageName.toLowerCase() === stageName.toLowerCase());
                  return {
                      stageName,
                      questions: dynamicCfg && dynamicCfg.questions && dynamicCfg.questions.length > 0 
                                  ? dynamicCfg.questions 
                                  : getStageConfig(stageName).questions,
                      status: "pending" as const,
                      order: index,
                  };
              });
          }
        } catch (e) {
            console.error("Failed to generate dynamic questions... falling back to defaults", e);
        }
      }

      // Forward request to Python backend 
      let pythonInterviewId = "";
      let pythonBotId = "";
      
      try {
        const pyRes = await fetch(`${env.PYTHON_API_URL}/api/v1/interviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_name: candidateName,
            meeting_url: meetingUrl,
            resume_text: parsed.data.resumeText || "",
            app_url: env.NEXT_PUBLIC_APP_URL
          }),
        });

        if (!pyRes.ok) {
          throw new Error("Python backend failed");
        }

        const pyData = await pyRes.json();
        pythonInterviewId = pyData.interview_id;
        pythonBotId = pyData.bot_id;
      } catch (e) {
         console.warn("Failed to contact Python backend. Did you run `python main.py`?", e);
         // Generate IDs as fallback so the UI handles the error gracefully
         pythonInterviewId = "iv_" + Date.now();
      }

      // Create interview record using the ID from Python for strict synchronization
      const interview = createInterview({
        candidateName,
        meetingUrl,
        botId: pythonBotId || null,
        botStatus: "joining",
        currentStage: stages[0],
        currentQuestionIndex: 0,
        status: "pending",
        stages: stageConfigurations,
      }, pythonInterviewId);

      // Initialize in-memory state
      const state: InterviewState = {
        interviewId: interview.id,
        botId: pythonBotId,
        candidateName,
        enabledStages: stages,
        currentStage: stages[0],
        currentQuestionIndex: 0,
        currentQuestion: stageConfigurations[0].questions[0],
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
        botId: pythonBotId,
        stages,
        status: "Bot is joining the meeting...",
      });
    })
  )
);
