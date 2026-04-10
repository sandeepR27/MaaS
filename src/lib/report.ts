import { getInterview, updateInterview, type InterviewReport } from "./store";
import { generateReport, type ReportInput } from "./gemini";

export async function generateInterviewReport(
  interviewId: string
): Promise<void> {
  const interview = getInterview(interviewId);
  if (!interview) throw new Error(`Interview ${interviewId} not found`);
  if (interview.responses.length === 0) {
    console.log("No responses to generate report from");
    return;
  }

  const input: ReportInput = {
    candidateName: interview.candidateName,
    responses: interview.responses.map((r) => ({
      stageName: r.stageName,
      question: r.question,
      candidateAnswer: r.candidateAnswer,
      score: r.score,
      feedback: r.feedback,
    })),
    stageNames: interview.stages.map((s) => s.stageName),
  };

  const result = await generateReport(input);

  const totalScore = interview.responses.reduce((s, r) => s + r.score, 0);
  const maxScore = interview.responses.length * 10;

  // Calculate per-stage scores
  const stageScores: InterviewReport["stageScores"] = {};
  for (const stage of interview.stages) {
    const stageResponses = interview.responses.filter(
      (r) => r.stageName === stage.stageName
    );
    const stageTotal = stageResponses.reduce((s, r) => s + r.score, 0);
    const stageMax = stageResponses.length * 10;
    stageScores[stage.stageName] = {
      score: stageTotal,
      max: stageMax,
      percentage: stageMax > 0 ? Math.round((stageTotal / stageMax) * 100) : 0,
    };
  }

  const report: InterviewReport = {
    totalScore,
    maxScore,
    stageScores,
    summary: result.summary,
    recommendation: result.recommendation,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    createdAt: new Date().toISOString(),
  };

  updateInterview(interviewId, { report, status: "completed" });
}
