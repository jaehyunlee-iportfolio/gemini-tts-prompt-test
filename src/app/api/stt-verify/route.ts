import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "gpt-4o-transcribe";

type Body = {
  audioBase64?: string;
  mimeType?: string;
};

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return ".wav";
  if (m.includes("webm")) return ".webm";
  if (m.includes("mp4") || m.includes("m4a")) return ".m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  return ".mp3";
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY가 설정되어 있지 않습니다." },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!audioBase64) {
    return NextResponse.json({ error: "audioBase64 is required" }, { status: 400 });
  }

  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "audio/mpeg";

  const modelId = process.env.OPENAI_STT_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const buffer = Buffer.from(audioBase64, "base64");
    const filename = `audio${extensionForMime(mimeType)}`;
    const blob = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("model", modelId);

    const upstream = await fetch(OPENAI_TRANSCRIPTIONS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const raw = await upstream.text();
    let data: { text?: string; error?: { message?: string } } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      data = {};
    }

    if (!upstream.ok) {
      const msg = data.error?.message || raw || upstream.statusText;
      return NextResponse.json({ error: msg }, { status: upstream.status });
    }

    const transcript = (data.text ?? "").trim();
    return NextResponse.json({ transcript, model: modelId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
