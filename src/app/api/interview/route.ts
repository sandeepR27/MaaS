import { NextResponse } from "next/server";
import { listInterviews } from "@/lib/store";
import { withErrorHandler } from "@/lib/error-handler";
import { loggingMiddleware } from "@/lib/logging";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const GET = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async () => {
      const interviews = listInterviews();
      return NextResponse.json(interviews);
    })
  )
);
