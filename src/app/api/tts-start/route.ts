import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = "https://speech-stage.spindlebooks.com/api/v1/text-to-speech";

export async function POST(req: Request) {
  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;

  try {
    const body = await req.json();
    const resp = await fetch(`${API_BASE}/stream/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SS-Authorization": AUTH_TOKEN || "",
      },
      body: JSON.stringify(body),
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
