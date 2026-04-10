import { NextRequest, NextResponse } from "next/server";

export function loggingMiddleware(handler: (...args: any[]) => Promise<NextResponse | Response>) {
  return async (...args: any[]) => {
    const req = args[0] as NextRequest;
    const start = Date.now();
    const method = req.method;
    const url = req.url;

    console.log(`[${new Date().toISOString()}] ${method} ${url} - Start`);

    try {
      const response = await handler(...args);
      const duration = Date.now() - start;

      console.log(`[${new Date().toISOString()}] ${method} ${url} - ${response.status} (${duration}ms)`);

      return response;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`[${new Date().toISOString()}] ${method} ${url} - Error (${duration}ms):`, error);
      throw error;
    }
  };
}