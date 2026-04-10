"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";

interface ConversationEntry {
  role: string;
  text: string;
}

interface InterviewResponse {
  id: string;
  stageName: string;
  questionIndex: number;
  question: string;
  candidateAnswer: string;
  score: number;
  feedback: string;
  createdAt: string;
}

interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  createdAt: string;
}

interface InterviewData {
  id: string;
  candidateName: string;
  meetingUrl: string;
  botId: string | null;
  botStatus: string;
  currentStage: string;
  currentQuestionIndex: number;
  status: string;
  createdAt: string;
  stages: Array<{ stageName: string; status: string; order: number }>;
  responses: InterviewResponse[];
  transcriptEntries: TranscriptEntry[];
  report: { id: string } | null;
  liveState: {
    currentStage: string;
    currentQuestionIndex: number;
    currentQuestion: string;
    isProcessing: boolean;
    isBotSpeaking: boolean;
    conversationHistory: ConversationEntry[];
  } | null;
}

export default function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);

  const fetchInterview = useCallback(async () => {
    try {
      const res = await fetch(`/api/interview/${id}`);
      if (res.ok) {
        const data = await res.json();
        setInterview(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let isMounted = true;
    let eventSource: EventSource | null = null;

    const init = async () => {
      await fetchInterview();
      if (!isMounted) return;

      eventSource = new EventSource(`/api/events/${id}`);

      eventSource.addEventListener("update", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.data?.interview) {
            setInterview((current) => ({
              ...current,
              ...payload.data.interview,
              liveState: payload.data.liveState ?? current?.liveState ?? null,
            }));
          } else if (payload?.data?.liveState) {
            setInterview((current) =>
              current
                ? {
                    ...current,
                    liveState: payload.data.liveState,
                  }
                : current
            );
          }
        } catch (error) {
          console.error("SSE parse error:", error);
        }
      });

      eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) {
          eventSource?.close();
        }
      };
    };

    init();

    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchInterview, id]);

  const handleEnd = async () => {
    if (!confirm("Are you sure you want to end this interview?")) return;
    setEnding(true);
    try {
      await fetch(`/api/interview/${id}/end`, { method: "POST" });
      fetchInterview();
    } catch {
      // handle error
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading interview...</div>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Interview not found</div>
      </div>
    );
  }

  const isActive =
    interview.status === "active" || interview.status === "pending";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                &larr; Back to Dashboard
              </Link>
              <h1 className="text-xl font-bold text-gray-900 mt-1">
                Interview: {interview.candidateName}
              </h1>
              <p className="text-sm text-gray-500">
                Status: {interview.status} &middot; Bot: {interview.botStatus}
              </p>
            </div>
            <div className="flex gap-3">
              {interview.report && (
                <Link
                  href={`/interview/${id}/report`}
                  className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  View Report
                </Link>
              )}
              {isActive && (
                <button
                  onClick={handleEnd}
                  disabled={ending}
                  className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {ending ? "Ending..." : "End Interview"}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Stages + Score */}
          <div className="space-y-6">
            {/* Stage Progress */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Interview Stages</h3>
              <div className="space-y-2">
                {interview.stages.map((stage) => {
                  const isCurrentStage =
                    (interview.liveState?.currentStage ||
                      interview.currentStage) === stage.stageName;
                  return (
                    <div
                      key={stage.stageName}
                      className={`flex items-center gap-3 p-2 rounded ${
                        isCurrentStage
                          ? "bg-blue-50 border border-blue-200"
                          : ""
                      }`}
                    >
                      <div
                        className={`w-3 h-3 rounded-full ${
                          stage.status === "completed"
                            ? "bg-green-500"
                            : stage.status === "active"
                              ? "bg-blue-500 animate-pulse"
                              : "bg-gray-300"
                        }`}
                      />
                      <span className="text-sm capitalize font-medium">
                        {stage.stageName}
                      </span>
                      <span className="text-xs text-gray-500 ml-auto">
                        {stage.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Status */}
            {interview.liveState && (
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-3">Live Status</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Current Question</span>
                    <span>#{interview.liveState.currentQuestionIndex + 1}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Bot Speaking</span>
                    <span>
                      {interview.liveState.isBotSpeaking ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Processing</span>
                    <span>
                      {interview.liveState.isProcessing ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
                {interview.liveState.currentQuestion && (
                  <div className="mt-3 p-2 bg-blue-50 rounded text-sm">
                    <span className="font-medium text-blue-800">
                      Current Q:{" "}
                    </span>
                    {interview.liveState.currentQuestion}
                  </div>
                )}
              </div>
            )}

            {/* Score Summary */}
            {interview.responses.length > 0 && (
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-3">Score Summary</h3>
                <div className="text-center mb-3">
                  <div className="text-3xl font-bold text-blue-600">
                    {interview.responses.reduce((s, r) => s + r.score, 0)}
                  </div>
                  <div className="text-sm text-gray-500">
                    / {interview.responses.length * 10}
                  </div>
                </div>
                {interview.stages.map((stage) => {
                  const stageResponses = interview.responses.filter(
                    (r) => r.stageName === stage.stageName
                  );
                  if (stageResponses.length === 0) return null;
                  const stageScore = stageResponses.reduce(
                    (s, r) => s + r.score,
                    0
                  );
                  const max = stageResponses.length * 10;
                  return (
                    <div key={stage.stageName} className="mb-2">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="capitalize">{stage.stageName}</span>
                        <span>
                          {stageScore}/{max}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{
                            width: `${(stageScore / max) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Center + Right: Conversation & Transcript */}
          <div className="lg:col-span-2 space-y-6">
            {/* Conversation History */}
            {interview.liveState &&
              interview.liveState.conversationHistory.length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">Live Conversation</h3>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {interview.liveState.conversationHistory.map(
                      (entry, index) => (
                        <div
                          key={index}
                          className={`flex ${
                            entry.role === "interviewer"
                              ? "justify-start"
                              : "justify-end"
                          }`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                              entry.role === "interviewer"
                                ? "bg-blue-50 text-blue-900"
                                : "bg-gray-100 text-gray-900"
                            }`}
                          >
                            <div className="text-xs font-medium mb-1 opacity-60">
                              {entry.role === "interviewer"
                                ? "AI Interviewer"
                                : "Candidate"}
                            </div>
                            {entry.text}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

            {/* Responses / Evaluations */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">
                Evaluations ({interview.responses.length})
              </h3>
              {interview.responses.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No responses evaluated yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {interview.responses.map((resp) => (
                    <div
                      key={resp.id}
                      className="border rounded-lg p-3 text-sm"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-gray-500">
                          {resp.stageName} &middot; Q{resp.questionIndex + 1}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded ${
                            resp.score >= 8
                              ? "bg-green-100 text-green-800"
                              : resp.score >= 5
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                          }`}
                        >
                          {resp.score}/10
                        </span>
                      </div>
                      <p className="font-medium text-gray-900 mb-1">
                        Q: {resp.question}
                      </p>
                      <p className="text-gray-600 mb-1">
                        A: {resp.candidateAnswer}
                      </p>
                      <p className="text-gray-500 italic text-xs">
                        {resp.feedback}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Raw Transcript */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Recent Transcript</h3>
              {interview.transcriptEntries.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No transcript entries yet.
                </p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto text-sm">
                  {[...interview.transcriptEntries].reverse().map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="font-medium text-gray-700 whitespace-nowrap">
                        {entry.speaker}:
                      </span>
                      <span className="text-gray-600">{entry.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
