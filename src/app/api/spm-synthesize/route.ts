import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedGoogleEmailDomain } from "@/lib/registry-access";
import { generateCacheBustToken } from "@/lib/cache-bust";

export const runtime = "nodejs";
/** v2 synthesize/save는 동기 처리 — GEMINI 번들은 수십 초까지 걸릴 수 있음 */
export const maxDuration = 120;

const V2_SAVE_URL =
  "https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save";

type SpmSynthesizeBody = {
  text: string;
  bundleName: string;
  /** 미지정(null) 시 Voice Profile의 baseSpm으로 발화 (rate 1.0) */
  spm?: number | null;
  platform?: string;
  userId?: number;
  cacheBust?: boolean;
};

function parseBody(raw: unknown): SpmSynthesizeBody | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string" || !o.text.trim()) return null;
  if (typeof o.bundleName !== "string" || !o.bundleName.trim()) return null;
  let spm: number | null = null;
  if (typeof o.spm === "number") {
    if (!Number.isFinite(o.spm) || o.spm <= 0) return null;
    spm = o.spm;
  }
  return {
    text: o.text,
    bundleName: o.bundleName.trim(),
    spm,
    platform: typeof o.platform === "string" ? o.platform : undefined,
    userId: typeof o.userId === "number" ? o.userId : undefined,
    cacheBust: typeof o.cacheBust === "boolean" ? o.cacheBust : false,
  };
}

/** 업스트림 500의 detail(예: "baseSpm is required when spm is specified")을 사용자에게 그대로 전달 */
function upstreamErrorMessage(status: number, rawText: string): string {
  try {
    const j = JSON.parse(rawText) as { message?: string; detail?: string; error?: string };
    const detail = j.detail || j.error || j.message;
    if (detail) return detail;
  } catch {
    /* plain text */
  }
  return rawText.slice(0, 300) || `Upstream error (${status})`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!isAllowedGoogleEmailDomain(session?.user?.email)) {
    return NextResponse.json(
      { error: "로그인된 @iportfolio.co.kr 계정에서만 사용할 수 있습니다." },
      { status: 403 },
    );
  }

  const AUTH_TOKEN = process.env.TTS_V2_AUTH_TOKEN || process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: "TTS_V2_AUTH_TOKEN(또는 TTS_AUTH_TOKEN)이 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseBody(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "text와 bundleName이 필요하며 spm은 양수여야 합니다." },
      { status: 400 },
    );
  }

  const trimmed = parsed.text.trim();
  const textForUpstream = parsed.cacheBust ? trimmed + generateCacheBustToken() : trimmed;

  const upstreamBody: Record<string, unknown> = {
    text: textForUpstream,
    bundleName: parsed.bundleName,
    platform: parsed.platform ?? "PLAYGROUND",
    userId:
      typeof parsed.userId === "number" && Number.isFinite(parsed.userId) ? parsed.userId : 2,
  };
  if (parsed.spm != null) upstreamBody.spm = parsed.spm;

  const startedAt = Date.now();
  try {
    const resp = await fetch(V2_SAVE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SS-Authorization": AUTH_TOKEN,
      },
      body: JSON.stringify(upstreamBody),
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      return NextResponse.json(
        { error: upstreamErrorMessage(resp.status, rawText), upstreamStatus: resp.status },
        { status: resp.status === 403 || resp.status === 401 ? 502 : resp.status },
      );
    }

    let data: { url?: string };
    try {
      data = JSON.parse(rawText) as { url?: string };
    } catch {
      return NextResponse.json(
        { error: "업스트림 응답 JSON 파싱 실패: " + rawText.slice(0, 200) },
        { status: 502 },
      );
    }
    if (typeof data.url !== "string" || !data.url) {
      return NextResponse.json(
        { error: "업스트림 응답에 url이 없습니다: " + rawText.slice(0, 200) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      url: data.url,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
