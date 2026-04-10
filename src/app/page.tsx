"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Interview {
  id: string;
  candidateName: string;
  meetingUrl: string;
  botId: string | null;
  botStatus: string;
  currentStage: string;
  status: string;
  createdAt: string;
  stages: Array<{ stageName: string; status: string }>;
  responses: Array<unknown>;
  report: {
    recommendation: string;
    totalScore: number;
    maxScore: number;
  } | null;
}

const AVAILABLE_STAGES = [
  { key: "screening", label: "Screening" },
  { key: "technical", label: "Technical" },
  { key: "hr", label: "HR" },
];

export default function DashboardPage() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([
    "screening",
    "technical",
    "hr",
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const fetchInterviews = useCallback(async () => {
    try {
      const res = await fetch("/api/interview");
      if (res.ok) {
        const data = await res.json();
        setInterviews(data);
      }
    } catch {
      // silently fail on polling
    }
  }, []);

  useEffect(() => {
    fetchInterviews();
    const interval = setInterval(fetchInterviews, 5000);
    return () => clearInterval(interval);
  }, [fetchInterviews]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsCreating(true);

    try {
      const res = await fetch("/api/bot/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl,
          candidateName,
          stages: selectedStages,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create interview");
        return;
      }

      setMeetingUrl("");
      setCandidateName("");
      fetchInterviews();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const toggleStage = (stage: string) => {
    setSelectedStages((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-blue-100 text-blue-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-gray-900">
            AI Interviewer Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Recall AI + Google Gemini powered interview bot
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Create Interview Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Start New Interview</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Meeting URL
                </label>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Candidate Name
                </label>
                <input
                  type="text"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Interview Stages
              </label>
              <div className="flex gap-3">
                {AVAILABLE_STAGES.map((stage) => (
                  <label
                    key={stage.key}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStages.includes(stage.key)}
                      onChange={() => toggleStage(stage.key)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{stage.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isCreating || selectedStages.length === 0}
              className="bg-blue-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? "Creating Bot..." : "Start Interview"}
            </button>
          </form>
        </div>

        {/* Interviews List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Interviews</h2>
          </div>
          {interviews.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No interviews yet. Create one above to get started.
            </div>
          ) : (
            <div className="divide-y">
              {interviews.map((interview) => (
                <Link
                  key={interview.id}
                  href={`/interview/${interview.id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {interview.candidateName}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Stage: {interview.currentStage} &middot;{" "}
                        {interview.responses.length} responses &middot;{" "}
                        {new Date(interview.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {interview.report && (
                        <span className="text-sm text-gray-600">
                          {interview.report.totalScore}/
                          {interview.report.maxScore}
                        </span>
                      )}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(interview.status)}`}
                      >
                        {interview.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {interview.stages.map((stage) => (
                      <span
                        key={stage.stageName}
                        className={`text-xs px-2 py-0.5 rounded ${
                          stage.status === "completed"
                            ? "bg-green-50 text-green-700"
                            : stage.status === "active"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {stage.stageName}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
