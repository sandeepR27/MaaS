import {
  getInterview,
  updateInterview,
  addResponse,
  addTranscriptEntry,
} from "./store";
import { dispatchInterviewEvent } from "./event-bus";
import { evaluateAndRespond } from "./gemini";
import { synthesizeSpeech } from "./tts";
import { outputAudio, removeBot } from "./recall";
import {
  getStageConfig,
  getNextStage,
  getStageTransitionMessage,
  getInterviewIntroMessage,
  getInterviewEndMessage,
} from "./pipeline";

function publishInterviewLiveState(interviewId: string) {
  const state = getInterviewState(interviewId);
  if (!state) return;
  dispatchInterviewEvent(interviewId, "interview.live", {
    liveState: state,
  });
}
import {
  getInterviewState,
  acquireLock,
  releaseLock,
  consumeTranscript,
  removeInterviewState,
  type InterviewState,
} from "./interview-state";
import { generateInterviewReport } from "./report";

/**
 * Start an interview: send intro + first question via TTS through the bot.
 */
export async function startInterview(interviewId: string): Promise<void> {
  const state = getInterviewState(interviewId);
  if (!state) throw new Error(`No active state for interview ${interviewId}`);

  const stageConfig = getStageConfig(state.currentStage);
  const firstQuestion = stageConfig.questions[0];
  state.currentQuestion = firstQuestion;
  state.currentQuestionIndex = 0;

  // Update stage status
  const iv = getInterview(interviewId);
  if (iv) {
    const stage = iv.stages.find((s) => s.stageName === state.currentStage);
    if (stage) stage.status = "active";
    iv.status = "active";
    iv.currentStage = state.currentStage;
    dispatchInterviewEvent(interviewId, "interview.update", { interview: iv });
  }

  publishInterviewLiveState(interviewId);

  // Generate and play intro + first question
  const introText = getInterviewIntroMessage(
    state.candidateName,
    state.currentStage
  );
  const fullText = `${introText} ${firstQuestion}`;

  console.log(`startInterview(${interviewId}) fullText='${fullText}'`);

  state.conversationHistory.push({ role: "interviewer", text: fullText });
  publishInterviewLiveState(interviewId);

  try {
    const audio = await synthesizeSpeech(fullText);
    state.isBotSpeaking = true;
    publishInterviewLiveState(interviewId);
    await outputAudio(state.botId, audio);
    // Give time for audio to play (rough estimate: 1s per 15 words)
    const wordCount = fullText.split(/\s+/).length;
    const playTime = Math.max(3000, (wordCount / 15) * 1000);
    setTimeout(() => {
      const s = getInterviewState(interviewId);
      if (s) s.isBotSpeaking = false;
    }, playTime);
  } catch (error) {
    console.error("Failed to play intro audio:", error);
    state.isBotSpeaking = false;
  }
}

/**
 * Process accumulated candidate transcript.
 * Called when speech_off is detected for a non-bot participant.
 */
export async function processTranscript(
  interviewId: string
): Promise<void> {
  const state = getInterviewState(interviewId);
  if (!state) return;

  // If bot was "speaking", but we actually have transcript, it might be 
  // because the candidate interrupted or the bot-speak-timeout hasn't fired yet.
  // We'll trust the transcript and allow processing if it's been a few seconds.
  if (state.isBotSpeaking) {
    console.log(`[Engine] Bot was marked as speaking, but participant spoke. Resetting isBotSpeaking.`);
    state.isBotSpeaking = false;
  }

  // Try to acquire lock (prevent concurrent processing)
  if (!acquireLock(interviewId)) {
    console.log(`[Engine] Lock acquisition failed for ${interviewId} (already processing)`);
    return;
  }

  console.log(`[Engine] Lock acquired for ${interviewId}. Starting processing.`);

  try {
    const candidateText = consumeTranscript(interviewId);
    console.log(`[Engine] Processing transcript for ${interviewId}: "${candidateText}"`);
    
    if (!candidateText || candidateText.trim().length < 3) {
      console.log(`[Engine] Transcript too short, ignoring.`);
      return;
    }

    state.isProcessing = true;

    // Add candidate response to conversation history
    state.conversationHistory.push({ role: "candidate", text: candidateText });

    // Store transcript entry
    addTranscriptEntry(interviewId, {
      speaker: "candidate",
      text: candidateText,
      timestamp: Date.now() / 1000,
      isProcessed: true,
    });
    publishInterviewLiveState(interviewId);

    // Get stage config for current stage
    const stageConfig = getStageConfig(state.currentStage);

    console.log(`[Engine] Calling Gemini for evaluation (Stage: ${state.currentStage}, QIdx: ${state.currentQuestionIndex})...`);
    // Call Gemini to evaluate and get next question
    const evaluation = await evaluateAndRespond({
      stage: state.currentStage,
      questionIndex: state.currentQuestionIndex,
      currentQuestion: state.currentQuestion,
      candidateAnswer: candidateText,
      conversationHistory: state.conversationHistory,
      stageQuestions: stageConfig.questions,
    });

    console.log(`[Engine] Gemini response for ${interviewId}:`, JSON.stringify(evaluation, null, 2));

    // Save response
    addResponse(interviewId, {
      stageName: state.currentStage,
      questionIndex: state.currentQuestionIndex,
      question: state.currentQuestion,
      candidateAnswer: candidateText,
      score: Math.min(10, Math.max(1, Math.round(evaluation.score))),
      feedback: evaluation.feedback,
    });

    state.scores.push(evaluation.score);
    state.currentQuestionIndex++;
    publishInterviewLiveState(interviewId);

    // Check if we should advance stage
    const shouldAdvance =
      evaluation.should_advance_stage ||
      state.currentQuestionIndex >= stageConfig.maxQuestions;

    console.log(`[Engine] Decision for ${interviewId}: shouldAdvance=${shouldAdvance}, currentQuestionIndex=${state.currentQuestionIndex}/${stageConfig.maxQuestions}`);

    if (shouldAdvance) {
      console.log(`[Engine] Advancing stage from ${state.currentStage}`);
      await advanceStage(interviewId, state, evaluation.next_question);
    } else {
      // Ask next question
      state.currentQuestion = evaluation.next_question;
      state.conversationHistory.push({
        role: "interviewer",
        text: evaluation.next_question,
      });
      publishInterviewLiveState(interviewId);

      console.log(`[Engine] Bot asking next question: "${evaluation.next_question}"`);
      await speakText(state, evaluation.next_question);
    }

    state.isProcessing = false;
    publishInterviewLiveState(interviewId);
  } catch (error) {
    console.error("Error processing transcript:", error);
    state.isProcessing = false;
    publishInterviewLiveState(interviewId);
  } finally {
    releaseLock(interviewId);
  }
}

async function advanceStage(
  interviewId: string,
  state: InterviewState,
  _lastQuestion: string // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<void> {
  // Mark current stage as completed
  const iv = getInterview(interviewId);
  if (iv) {
    const stage = iv.stages.find((s) => s.stageName === state.currentStage);
    if (stage) stage.status = "completed";
  }

  const nextStage = getNextStage(state.currentStage, state.enabledStages);

  if (nextStage) {
    const transitionMsg = getStageTransitionMessage(
      state.currentStage,
      nextStage
    );
    state.currentStage = nextStage;
    state.currentQuestionIndex = 0;
    state.scores = [];

    const nextStageConfig = getStageConfig(nextStage);
    const firstQuestion = nextStageConfig.questions[0];
    state.currentQuestion = firstQuestion;
    publishInterviewLiveState(interviewId);

    // Update store
    if (iv) {
      const nStage = iv.stages.find((s) => s.stageName === nextStage);
      if (nStage) nStage.status = "active";
      iv.currentStage = nextStage;
      iv.currentQuestionIndex = 0;
    }

    const fullText = `${transitionMsg} ${firstQuestion}`;
    state.conversationHistory.push({ role: "interviewer", text: fullText });
    publishInterviewLiveState(interviewId);
    await speakText(state, fullText);
  } else {
    // Interview complete
    await endInterview(interviewId, state);
  }
}

async function endInterview(
  interviewId: string,
  state: InterviewState
): Promise<void> {
  const endMsg = getInterviewEndMessage();
  state.conversationHistory.push({ role: "interviewer", text: endMsg });
  publishInterviewLiveState(interviewId);
  await speakText(state, endMsg);

  // Wait for audio to finish, then leave
  setTimeout(async () => {
    try {
      await removeBot(state.botId);
    } catch (e) {
      console.error("Error removing bot:", e);
    }

    updateInterview(interviewId, { status: "completed" });

    // Generate report
    try {
      await generateInterviewReport(interviewId);
    } catch (e) {
      console.error("Error generating report:", e);
    }

    removeInterviewState(interviewId);
  }, 10000);
}

async function speakText(
  state: InterviewState,
  text: string
): Promise<void> {
  try {
    console.log(`[TTS] synthesizeSpeech start for interview ${state.interviewId} text='${text.substring(0, 30)}...'`);
    const audio = await synthesizeSpeech(text);
    console.log(`[TTS] synthesizeSpeech end, got audio length ${audio?.b64_data?.length}`);
    
    state.isBotSpeaking = true;
    publishInterviewLiveState(state.interviewId);

    console.log(`[Recall] outputAudio start for bot ${state.botId}`);
    await outputAudio(state.botId, audio);
    console.log(`[Recall] outputAudio end for bot ${state.botId}`);

    const wordCount = text.split(/\s+/).length;
    const playTime = Math.max(2000, (wordCount / 15) * 1000);
    setTimeout(() => {
      state.isBotSpeaking = false;
      publishInterviewLiveState(state.interviewId);
    }, playTime);
  } catch (error) {
    console.error("Failed to speak:", error);
    state.isBotSpeaking = false;
  }
}
