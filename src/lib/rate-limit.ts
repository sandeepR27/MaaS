// Simple in-memory rate limiter
const requestCounts = new Map<string, { count: number; resetTime: number }>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute

export function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const windowKey = Math.floor(now / WINDOW_MS);
  const key = `${identifier}:${windowKey}`;

  const current = requestCounts.get(key) || { count: 0, resetTime: now + WINDOW_MS };

  if (now > current.resetTime) {
    // Reset window
    current.count = 0;
    current.resetTime = now + WINDOW_MS;
  }

  const allowed = current.count < MAX_REQUESTS;
  const remaining = Math.max(0, MAX_REQUESTS - current.count);

  if (allowed) {
    current.count++;
    requestCounts.set(key, current);
  }

  return {
    allowed,
    remaining,
    resetTime: current.resetTime,
  };
}

import { NextResponse } from "next/server";

export function rateLimitMiddleware(handler: (...args: any[]) => Promise<NextResponse | Response>) {
  return async (...args: any[]) => {
    // Use IP address as identifier (in production, you'd get this from headers)
    const identifier = "anonymous"; // For demo purposes

    const rateLimit = checkRateLimit(identifier);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    return handler(...args);
  };
}