import { getEnv } from "./env";

export interface EvaluationInput {
  stage: string;
  questionIndex: number;
  currentQuestion: string;
  candidateAnswer: string;
  conversationHistory: Array<{ role: string; text: string }>;
  stageQuestions: string[];
}

export interface EvaluationResult {
  next_question: string;
  score: number;
  feedback: string;
  should_advance_stage: boolean;
  is_follow_up: boolean;
}

/**
 * Switch from Gemini to Groq (Llama 3.3 70B) for lightning fast evaluation!
 */
export async function evaluateAndRespond(
  input: EvaluationInput
): Promise<EvaluationResult> {
  const env = getEnv();
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing from environment");

  const historyText = input.conversationHistory
    .map((h) => `${h.role}: ${h.text}`)
    .join("\n");

  const remainingQuestions = input.stageQuestions.slice(
    input.questionIndex + 1
  );
  const remainingStr =
    remainingQuestions.length > 0
      ? `Remaining prepared questions for this stage: ${remainingQuestions.join("; ")}`
      : "No more prepared questions for this stage.";

  const prompt = `You are an expert AI interviewer conducting a professional interview.

CURRENT STAGE: ${input.stage}
QUESTION INDEX: ${input.questionIndex}

RULES:
1. Evaluate the candidate's answer to the current question.
2. Give a fair score from 1-10 (1=terrible, 5=average, 10=exceptional).
3. Provide brief internal feedback (not shared with candidate).
4. Generate the next question - either a follow-up to dive deeper, or move to the next prepared question.
5. Keep questions concise and clear (under 2 sentences).
6. If the candidate's answer is off-topic or unclear, politely redirect.
7. Set should_advance_stage=true only when you've covered enough questions for this stage (at least 3-4 questions asked).
8. Be professional, encouraging but not overly positive.

${remainingStr}

CONVERSATION SO FAR:
${historyText}

CURRENT QUESTION: ${input.currentQuestion}
CANDIDATE'S ANSWER: ${input.candidateAnswer}

Respond with ONLY valid JSON in this exact format:
{"next_question": "...", "score": 7, "feedback": "...", "should_advance_stage": false, "is_follow_up": false}`;

  let retries = 0;
  const maxRetries = 2;

  while (retries <= maxRetries) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      let text = data.choices[0].message.content;

      // Clean up potential markdown blocks
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();

      // Try to find the first { and last } to isolate JSON
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        text = text.substring(start, end + 1);
      }

      return JSON.parse(text) as EvaluationResult;
    } catch (e: any) {
      if (retries < maxRetries) {
        retries++;
        console.warn(`[Groq] error, retrying in 2000ms... (Attempt ${retries}/${maxRetries}): ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[Groq] Fatal error:", e);
      throw e;
    }
  }

  throw new Error("Groq API failed after retries");
}

export interface ReportInput {
  candidateName: string;
  responses: Array<{
    stageName: string;
    question: string;
    candidateAnswer: string;
    score: number;
    feedback: string;
  }>;
  stageNames: string[];
}

export interface ReportResult {
  summary: string;
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  stage_summaries: Record<string, string>;
}

export async function generateReport(
  input: ReportInput
): Promise<ReportResult> {
  const env = getEnv();
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing from environment");

  const responsesText = input.responses
    .map(
      (r) =>
        `[${r.stageName}] Q: ${r.question}\nA: ${r.candidateAnswer}\nScore: ${r.score}/10\nFeedback: ${r.feedback}`
    )
    .join("\n\n");

  const totalScore = input.responses.reduce((sum, r) => sum + r.score, 0);
  const maxScore = input.responses.length * 10;

  const prompt = `Generate a comprehensive interview evaluation report.

CANDIDATE: ${input.candidateName}
STAGES COMPLETED: ${input.stageNames.join(", ")}
TOTAL SCORE: ${totalScore}/${maxScore} (${Math.round((totalScore / maxScore) * 100)}%)

DETAILED RESPONSES:
${responsesText}

Respond with ONLY valid JSON in this exact format:
{"summary": "...", "recommendation": "hire", "strengths": ["..."], "weaknesses": ["..."], "stage_summaries": {"screening": "..."}}

Recommendation must be one of: strong_hire, hire, maybe, no_hire, strong_no_hire`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content;

  return JSON.parse(text) as ReportResult;
}
