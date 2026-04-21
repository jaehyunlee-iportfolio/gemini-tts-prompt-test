import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { pcmS16leMonoToWav } from "@/lib/pcm-s16le-to-wav";
import { VOICE_IDS, type VoiceId } from "@/types/tts";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_MODEL = "gemini-3.1-flash-tts-preview";

type Body = {
  text?: string;
  prompt?: string;
  voice?: string;
};

function isVoiceId(v: string): v is VoiceId {
  return (VOICE_IDS as readonly string[]).includes(v);
}

function buildTtsPrompt(styleBlock: string, transcript: string) {
  const style =
    styleBlock.trim() ||
    "Clear, neutral delivery appropriate for language learners reading practice.";
  const line = transcript.trim();
  return [
    "You are a text-to-speech system. Output audio only.",
    "Follow the STYLE block for how to deliver the line.",
    "Then speak the TRANSCRIPT block verbatim: same words, same order, no additions, no narration of these instructions.",
    "",
    "STYLE:",
    style,
    "",
    "TRANSCRIPT:",
    line,
  ].join("\n");
}

function extractInlineAudioBase64(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const r = response as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string } }> };
    }>;
  };
  const parts = r.candidates?.[0]?.content?.parts;
  if (!parts?.length) return null;
  for (const p of parts) {
    const d = p.inlineData?.data;
    if (typeof d === "string" && d.length > 0) return d;
  }
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY가 설정되어 있지 않습니다." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const voiceRaw = typeof body.voice === "string" ? body.voice.trim() : "";
  if (!voiceRaw || !isVoiceId(voiceRaw)) {
    return NextResponse.json(
      { error: `voice must be one of: ${VOICE_IDS.join(", ")}` },
      { status: 400 },
    );
  }

  const stylePrompt = typeof body.prompt === "string" ? body.prompt : "";
  const model = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_MODEL;
  const contents = buildTtsPrompt(stylePrompt, text);

  const ai = new GoogleGenAI({ apiKey });

  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceRaw },
            },
          },
        },
      });

      const b64 = extractInlineAudioBase64(response);
      if (!b64) {
        lastErr = "응답에 오디오(inlineData)가 없습니다.";
        continue;
      }

      const pcm = Buffer.from(b64, "base64");
      const wav = pcmS16leMonoToWav(pcm);
      return new NextResponse(new Uint8Array(wav), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json(
    { error: lastErr ?? "Gemini TTS failed after retries" },
    { status: 502 },
  );
}
