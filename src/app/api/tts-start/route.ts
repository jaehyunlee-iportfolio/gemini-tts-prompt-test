import { generateCacheBustToken } from "@/lib/cache-bust";
import type { TtsStartRequestBody } from "@/types/tts-start-request";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = "https://speech-stage.spindlebooks.com/api/v1/text-to-speech";

function parseBody(raw: unknown): TtsStartRequestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string" || typeof o.bundleName !== "string") return null;
  return {
    text: o.text,
    cacheBust: typeof o.cacheBust === "boolean" ? o.cacheBust : false,
    bundleName: o.bundleName,
    viseme: typeof o.viseme === "boolean" ? o.viseme : undefined,
    prompt: typeof o.prompt === "string" ? o.prompt : undefined,
    platform: typeof o.platform === "string" ? o.platform : undefined,
    userId: typeof o.userId === "number" ? o.userId : undefined,
  };
}

export async function POST(req: Request) {
  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = parseBody(raw);
    if (!parsed) {
      return NextResponse.json({ error: "text and bundleName are required" }, { status: 400 });
    }

    const trimmed = parsed.text.trim();
    const textForUpstream =
      parsed.cacheBust === true ? trimmed + generateCacheBustToken() : trimmed;

    const upstreamBody = {
      text: textForUpstream,
      bundleName: parsed.bundleName,
      viseme: parsed.viseme ?? false,
      prompt: parsed.prompt ?? "",
      platform: parsed.platform ?? "PLAYGROUND",
      userId: typeof parsed.userId === "number" && Number.isFinite(parsed.userId) ? parsed.userId : 2,
    };

    const resp = await fetch(`${API_BASE}/stream/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SS-Authorization": AUTH_TOKEN || "",
      },
      body: JSON.stringify(upstreamBody),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
