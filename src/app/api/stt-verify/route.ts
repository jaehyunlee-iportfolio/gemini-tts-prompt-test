import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-2.0-flash";

type Body = {
  audioBase64?: string;
  mimeType?: string;
};

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY가 설정되어 있지 않습니다." },
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

  const modelId = process.env.GEMINI_STT_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelId });
    const prompt =
      "Listen to this audio and write a single line transcript of exactly what was spoken in English. " +
      "Do not add labels, punctuation beyond what was clearly spoken, or commentary. " +
      "If nothing was spoken, reply with an empty string.";

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
    ]);

    const text = result.response.text().trim();
    return NextResponse.json({ transcript: text, model: modelId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
