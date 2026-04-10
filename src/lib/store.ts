import { dispatchInterviewEvent } from "./event-bus";

/**
 * In-memory data store for MVP.
 * Replaces database — all state lives in memory.
 */

export interface Interview {
  id: string;
  candidateName: string;
  meetingUrl: string;
  botId: string | null;
  botStatus: string;
  currentStage: string;
  currentQuestionIndex: number;
  status: "pending" | "active" | "completed" | "failed";
  stages: InterviewStage[];
  responses: InterviewResponse[];
  transcriptEntries: TranscriptEntry[];
  report: InterviewReport | null;
  createdAt: string;
}

export interface InterviewStage {
  stageName: string;
  questions: string[];
  status: "pending" | "active" | "completed";
  order: number;
}

export interface InterviewResponse {
  id: string;
  stageName: string;
  questionIndex: number;
  question: string;
  candidateAnswer: string;
  score: number;
  feedback: string;
  createdAt: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isProcessed: boolean;
}

export interface InterviewReport {
  totalScore: number;
  maxScore: number;
  stageScores: Record<string, { score: number; max: number; percentage: number }>;
  summary: string;
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  createdAt: string;
}

// ---- In-memory storage ----
const interviews = new Map<string, Interview>();

let idCounter = 0;
export function genId(): string {
  return `iv_${Date.now()}_${++idCounter}`;
}

export function createInterview(data: Omit<Interview, "id" | "responses" | "transcriptEntries" | "report" | "createdAt">): Interview {
  const interview: Interview = {
    ...data,
    id: genId(),
    responses: [],
    transcriptEntries: [],
    report: null,
    createdAt: new Date().toISOString(),
  };
  interviews.set(interview.id, interview);
  return interview;
}

export function getInterview(id: string): Interview | undefined {
  return interviews.get(id);
}

export function getInterviewByBotId(botId: string): Interview | undefined {
  for (const iv of interviews.values()) {
    if (iv.botId === botId) return iv;
  }
  return undefined;
}

export function updateInterview(id: string, updates: Partial<Interview>): Interview | undefined {
  const iv = interviews.get(id);
  if (!iv) return undefined;
  Object.assign(iv, updates);
  dispatchInterviewEvent(id, "interview.update", { interview: iv });
  return iv;
}

export function addResponse(interviewId: string, resp: Omit<InterviewResponse, "id" | "createdAt">): void {
  const iv = interviews.get(interviewId);
  if (!iv) return;
  iv.responses.push({ ...resp, id: genId(), createdAt: new Date().toISOString() });
  dispatchInterviewEvent(interviewId, "interview.update", { interview: iv });
}

export function addTranscriptEntry(interviewId: string, entry: Omit<TranscriptEntry, "id">): void {
  const iv = interviews.get(interviewId);
  if (!iv) return;
  iv.transcriptEntries.push({ ...entry, id: genId() });
  dispatchInterviewEvent(interviewId, "interview.update", { interview: iv });
}

export function listInterviews(): Interview[] {
  return Array.from(interviews.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
