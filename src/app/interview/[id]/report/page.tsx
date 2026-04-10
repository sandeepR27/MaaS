"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface StageScore {
  score: number;
  max: number;
  percentage: number;
}

interface Report {
  id: string;
  totalScore: number;
  maxScore: number;
  stageScores: Record<string, StageScore>;
  summary: string;
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  createdAt: string;
}

interface InterviewData {
  id: string;
  candidateName: string;
  status: string;
  stages: Array<{ stageName: string; status: string }>;
  responses: Array<{
    stageName: string;
    question: string;
    candidateAnswer: string;
    score: number;
    feedback: string;
  }>;
  report: Report | null;
}

const RECOMMENDATION_LABELS: Record<string, { label: string; color: string }> =
  {
    strong_hire: { label: "Strong Hire", color: "text-green-700 bg-green-100" },
    hire: { label: "Hire", color: "text-green-600 bg-green-50" },
    maybe: { label: "Maybe", color: "text-yellow-700 bg-yellow-100" },
    no_hire: { label: "No Hire", color: "text-red-600 bg-red-50" },
    strong_no_hire: {
      label: "Strong No Hire",
      color: "text-red-700 bg-red-100",
    },
  };

export default function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/interview/${id}`);
        if (res.ok) {
          const data = await res.json();
          setInterview(data);
        }
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading report...</div>
      </div>
    );
  }

  if (!interview || !interview.report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col gap-4">
        <div className="text-gray-500">
          {interview ? "Report not yet generated." : "Interview not found."}
        </div>
        <Link href={`/interview/${id}`} className="text-blue-600 text-sm">
          &larr; Back to Interview
        </Link>
      </div>
    );
  }

  const report = interview.report;
  const recLabel = RECOMMENDATION_LABELS[report.recommendation] || {
    label: report.recommendation,
    color: "text-gray-700 bg-gray-100",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href={`/interview/${id}`}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            &larr; Back to Interview
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">
            Interview Report: {interview.candidateName}
          </h1>
          <p className="text-sm text-gray-500">
            Generated on{" "}
            {new Date(report.createdAt).toLocaleString()}
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Overview Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Overall Score</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-bold text-blue-600">
                  {report.totalScore}
                </span>
                <span className="text-xl text-gray-400">
                  / {report.maxScore}
                </span>
                <span className="text-lg text-gray-500 ml-2">
                  (
                  {report.maxScore > 0
                    ? Math.round((report.totalScore / report.maxScore) * 100)
                    : 0}
                  %)
                </span>
              </div>
            </div>
            <div
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${recLabel.color}`}
            >
              {recLabel.label}
            </div>
          </div>

          {/* Stage Scores */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(report.stageScores).map(([stageName, scores]) => (
              <div key={stageName} className="border rounded-lg p-3">
                <h4 className="text-sm font-medium capitalize text-gray-700">
                  {stageName}
                </h4>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-bold">{scores.score}</span>
                  <span className="text-sm text-gray-400">/ {scores.max}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div
                    className={`h-2 rounded-full ${
                      scores.percentage >= 70
                        ? "bg-green-500"
                        : scores.percentage >= 50
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${scores.percentage}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {scores.percentage}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-3">Summary</h2>
          <p className="text-gray-700 whitespace-pre-line leading-relaxed">
            {report.summary}
          </p>
        </div>

        {/* Strengths & Weaknesses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-3 text-green-700">
              Strengths
            </h2>
            <ul className="space-y-2">
              {report.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">&#10003;</span>
                  <span className="text-gray-700">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-3 text-red-700">
              Areas for Improvement
            </h2>
            <ul className="space-y-2">
              {report.weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-red-500 mt-0.5">&#10007;</span>
                  <span className="text-gray-700">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Detailed Q&A */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Detailed Responses</h2>
          <div className="space-y-4">
            {interview.responses.map((resp, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    {resp.stageName}
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
                <p className="font-medium text-gray-900 text-sm">
                  Q: {resp.question}
                </p>
                <p className="text-gray-600 text-sm mt-1">
                  A: {resp.candidateAnswer}
                </p>
                <p className="text-gray-500 text-xs italic mt-1">
                  {resp.feedback}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
