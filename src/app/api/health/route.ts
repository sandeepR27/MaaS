import { NextResponse } from "next/server";
import { listInterviews } from "@/lib/store";
import { getAllActiveInterviews } from "@/lib/interview-state";
import { loggingMiddleware } from "@/lib/logging";

export const GET = loggingMiddleware(async () => {
  const interviews = listInterviews();
  const activeStates = getAllActiveInterviews();

  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    interviews: {
      total: interviews.length,
      active: activeStates.length,
      completed: interviews.filter(i => i.status === "completed").length,
      failed: interviews.filter(i => i.status === "failed").length,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || "development",
    },
  };

  return NextResponse.json(health);
});