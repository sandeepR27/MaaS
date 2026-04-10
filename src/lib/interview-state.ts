/**
 * In-memory interview state manager.
 * Provides hot state for active interviews with per-interview locking.
 */

export interface ConversationEntry {
  role: string; // "interviewer" | "candidate"
  text: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  createdAt: Date;
}

export interface InterviewState {
  interviewId: string;
  botId: string;
  candidateName: string;
  enabledStages: string[];
  currentStage: string;
  currentQuestionIndex: number;
  currentQuestion: string;
  scores: number[];
  isProcessing: boolean;
  isBotSpeaking: boolean;
  conversationHistory: ConversationEntry[];
  accumulatedTranscript: string;
  lastSpeechTimestamp: number;
  meetingUrl?: string;
  scoresMap?: Record<string, number>;
  feedbackMap?: Record<string, string>;
  _silenceTimeout?: any;
}

const activeInterviews = new Map<string, InterviewState>();
const processingLocks = new Map<string, boolean>();

export function getInterviewState(
  interviewId: string
): InterviewState | undefined {
  return activeInterviews.get(interviewId);
}

export function setInterviewState(
  interviewId: string,
  state: InterviewState
): void {
  activeInterviews.set(interviewId, state);
}

export function removeInterviewState(interviewId: string): void {
  activeInterviews.delete(interviewId);
  processingLocks.delete(interviewId);
}

export function acquireLock(interviewId: string): boolean {
  if (processingLocks.get(interviewId)) return false;
  processingLocks.set(interviewId, true);
  return true;
}

export function releaseLock(interviewId: string): void {
  processingLocks.set(interviewId, false);
}

export function appendTranscript(
  interviewId: string,
  text: string
): void {
  const state = activeInterviews.get(interviewId);
  if (!state) return;
  state.accumulatedTranscript = state.accumulatedTranscript
    ? `${state.accumulatedTranscript} ${text}`
    : text;
  state.lastSpeechTimestamp = Date.now();
}

export function consumeTranscript(interviewId: string): string {
  const state = activeInterviews.get(interviewId);
  if (!state) return "";
  const transcript = state.accumulatedTranscript;
  state.accumulatedTranscript = "";
  return transcript;
}

export function findInterviewByBotId(
  botId: string
): InterviewState | undefined {
  for (const state of activeInterviews.values()) {
    if (state.botId === botId) return state;
  }
  return undefined;
}

export function getAllActiveInterviews(): InterviewState[] {
  return Array.from(activeInterviews.values());
}
