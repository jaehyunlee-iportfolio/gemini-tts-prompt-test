import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set([
  "speech-tts-contents-stage.spindlebooks.com",
  "speech-tts-contents.spindlebooks.com",
]);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw || typeof raw !== "string") {
    return NextResponse.json(
      { error: "url query parameter is required" },
      { status: 400 },
    );
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(raw);
  } catch {
    targetUrl = raw;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (!ALLOWED.has(parsed.hostname)) {
    return NextResponse.json({ error: "url host not allowed" }, { status: 400 });
  }

  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: "TTS_AUTH_TOKEN is not configured" },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "X-SS-Authorization": AUTH_TOKEN,
        "User-Agent": "gemin-tts-prompt-test/1.0",
        Accept: "audio/mpeg,audio/*,*/*",
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    const ct = upstream.headers.get("content-type") || "audio/mpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
