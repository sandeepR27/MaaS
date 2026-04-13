import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // Get the raw body as an ArrayBuffer to preserve exact formatting for signature verification
    const rawBody = await req.arrayBuffer();
    
    // Copy essential headers
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Forward to the Python backend on Port 8000
    // We target 127.0.0.1 directly for speed
    const pyResponse = await fetch("http://127.0.0.1:8000/api/v1/webhooks/recall", {
      method: "POST",
      headers,
      body: rawBody,
    });

    // Mirror the response from Python
    const contentType = pyResponse.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await pyResponse.json();
      return NextResponse.json(data, { status: pyResponse.status });
    } else {
      const text = await pyResponse.text();
      return new NextResponse(text, { status: pyResponse.status });
    }
  } catch (error) {
    console.error("Webhook Proxy Error:", error);
    return NextResponse.json({ error: "Failed to proxy webhook" }, { status: 500 });
  }
}
