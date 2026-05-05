import { arrayBufferToBase64 } from "@/lib/base64";
import {
  stringSimilarity,
  verdictFromScore,
  type QaVerdict,
} from "@/lib/text-similarity";

const API_BASE = "/api";

export const STT_PASS_MIN = 0.88;
export const STT_REVIEW_MIN = 0.72;

export type SttQaResult = {
  transcript: string;
  score: number;
  verdict: QaVerdict;
};

/** 오디오 src(proxy `/api/tts-audio?...` 또는 blob: URL)로부터 STT 검증을 수행 */
export async function verifyAudioFromSrc(args: {
  src: string;
  originalText: string;
  signal?: AbortSignal;
}): Promise<SttQaResult> {
  const { src, originalText, signal } = args;
  const audioResp = await fetch(src, { signal });
  if (!audioResp.ok) throw new Error(`오디오 fetch 실패 (${audioResp.status})`);
  const blob = await audioResp.blob();
  const mimeType = blob.type || "audio/mpeg";
  const b64 = arrayBufferToBase64(await blob.arrayBuffer());

  const sttRes = await fetch(`${API_BASE}/stt-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ audioBase64: b64, mimeType }),
  });
  const raw = await sttRes.text();
  let json: { transcript?: string; error?: string } = {};
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    json = {};
  }
  if (!sttRes.ok) {
    throw new Error(json.error || raw || sttRes.statusText);
  }
  const transcript = (json.transcript ?? "").trim();
  const score = stringSimilarity(originalText, transcript);
  const verdict = verdictFromScore(score, STT_PASS_MIN, STT_REVIEW_MIN);
  return { transcript, score, verdict };
}

export function computeWpm(originalText: string, durationMs: number): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const words = originalText.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;
  const minutes = durationMs / 60000;
  return Math.round(words / minutes);
}
