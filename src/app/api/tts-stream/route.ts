import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_BASE = "https://speech-stage.spindlebooks.com/api/v1/text-to-speech";

export async function GET(req: NextRequest) {
  const sseId = req.nextUrl.searchParams.get("sseId");
  if (!sseId) {
    return NextResponse.json({ error: "sseId is required" }, { status: 400 });
  }

  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;

  try {
    const resp = await fetch(`${API_BASE}/streams/${encodeURIComponent(sseId)}`, {
      headers: {
        Accept: "text/event-stream",
        "X-SS-Authorization": AUTH_TOKEN || "",
        "User-Agent": "gemin-tts-prompt-test/1.0",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new NextResponse(text, { status: resp.status });
    }

    return new NextResponse(resp.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
