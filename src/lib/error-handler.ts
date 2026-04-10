import { NextResponse } from "next/server";

export function withErrorHandler(handler: (...args: any[]) => Promise<NextResponse | Response>) {
  return async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("API Error:", error);

      // Don't expose internal errors in production
      const isDevelopment = process.env.NODE_ENV === "development";
      const errorMessage = isDevelopment
        ? error instanceof Error ? error.message : "Unknown error"
        : "Internal server error";

      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }
  };
}