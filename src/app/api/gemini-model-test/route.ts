import { auth } from "@/auth";
import { generateCacheBustToken } from "@/lib/cache-bust";
import {
  isAudioStorageConfigured,
  uploadAudioToStorage,
} from "@/lib/server/audio-storage";
import {
  GEMINI_TEST_MODELS,
  type GeminiTestModel,
} from "@/types/tts";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const UPSTREAM_URL =
  "https://speech-stage.spindlebooks.com/api/v1/support/gemini-model-test/synthesize";

/**
 * Spindle의 동기 Gemini 모델 테스트 엔드포인트 프록시.
 * 응답이 곧 audio 바이너리이므로 SSE/tts-audio 프록시를 거치지 않습니다.
 *
 * 요청 body:
 * - `text`, `bundleName` (필수)
 * - `modelName` (`gemini-3.1-flash-tts-preview` 또는 `gemini-2.5-pro-tts`)
 * - `rate` (선택, 기본 1.0)
 * - `cacheBust` (선택) — 보이지 않는 토큰을 텍스트 끝에 추가
 *
 * 업스트림 스펙에 prompt 필드가 없어 전송하지 않습니다.
 */

function isGeminiTestModel(v: unknown): v is GeminiTestModel {
  return typeof v === "string" && (GEMINI_TEST_MODELS as readonly string[]).includes(v);
}

type Body = {
  text: string;
  bundleName: string;
  modelName: GeminiTestModel;
  rate?: number;
  cacheBust?: boolean;
  /** Required to associate the uploaded audio with a history entry. */
  runId?: string;
  slotIndex?: number | null;
};

function parseBody(raw: unknown): Body | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid JSON body" };
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string" || o.text.trim().length === 0) {
    return { error: "text is required" };
  }
  if (typeof o.bundleName !== "string" || o.bundleName.trim().length === 0) {
    return { error: "bundleName is required" };
  }
  if (!isGeminiTestModel(o.modelName)) {
    return {
      error: `modelName must be one of: ${GEMINI_TEST_MODELS.join(", ")}`,
    };
  }
  const rate =
    typeof o.rate === "number" && Number.isFinite(o.rate) && o.rate > 0 ? o.rate : 1.0;
  return {
    text: o.text,
    bundleName: o.bundleName,
    modelName: o.modelName,
    rate,
    cacheBust: typeof o.cacheBust === "boolean" ? o.cacheBust : false,
    runId: typeof o.runId === "string" && o.runId.length > 0 ? o.runId : undefined,
    slotIndex:
      typeof o.slotIndex === "number" && Number.isFinite(o.slotIndex)
        ? o.slotIndex
        : null,
  };
}

export async function POST(req: Request) {
  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: "TTS_AUTH_TOKEN이 설정되어 있지 않습니다." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const trimmed = parsed.text.trim();
  const textForUpstream =
    parsed.cacheBust === true ? trimmed + generateCacheBustToken() : trimmed;

  const upstreamBody = {
    rate: parsed.rate ?? 1.0,
    modelName: parsed.modelName,
    text: textForUpstream,
    bundleName: parsed.bundleName,
  };

  let resp: Response;
  try {
    resp = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SS-Authorization": AUTH_TOKEN,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Upstream fetch failed: ${message}` }, { status: 502 });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    let payload: unknown;
    try {
      payload = JSON.parse(errText);
    } catch {
      payload = { error: errText || resp.statusText };
    }
    return NextResponse.json(payload, { status: resp.status });
  }

  const contentType = resp.headers.get("content-type") ?? "audio/mpeg";
  const buf = await resp.arrayBuffer();

  // Persist to durable storage when possible so the result survives Firestore
  // round-trip. Falls back to streaming the bytes inline if storage isn't
  // configured or the request is unauthenticated.
  if (parsed.runId && isAudioStorageConfigured()) {
    const session = await auth();
    const email = session?.user?.email?.trim().toLowerCase();
    if (email) {
      try {
        const stored = await uploadAudioToStorage({
          bytes: Buffer.from(buf),
          contentType,
          ownerEmail: email,
          runId: parsed.runId,
          slotIndex: parsed.slotIndex,
        });
        return NextResponse.json(stored, { status: 200 });
      } catch (err) {
        console.error("[gemini-model-test] storage upload failed", err);
        // fall through to binary response so the user still hears the audio
      }
    }
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
