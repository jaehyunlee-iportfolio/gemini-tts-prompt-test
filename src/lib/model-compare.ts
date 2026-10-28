/**
 * Gemini 2.5 Pro(운영) vs Gemini 3.8(…38 번들) 비교 테스트 공통 모듈.
 *
 * - 2.5 번들: `GEMINI-<Voice>-<Emotion>` — Spindle VoiceTable의 기존 프롬프트로 발화
 * - 3.8 번들: `GEMINI-<Voice>-<Emotion>38` — 프롬프트 대신 요청의 `style`(speechMetadata.style)만 받음
 *   (spindle-speech SS-505, 2026-10-28 Stage 반영)
 */

const API_BASE = "/api";

export const COMPARE_VOICES = ["Sulafat", "Puck", "Rasalgethi", "Fenrir"] as const;
export type CompareVoice = (typeof COMPARE_VOICES)[number];

export const COMPARE_EMOTIONS = ["Default", "Cheerful", "Gentle"] as const;
export type CompareEmotion = (typeof COMPARE_EMOTIONS)[number];

export type ModelKey = "g25" | "g38";
export const MODEL_LABEL: Record<ModelKey, string> = {
  g25: "2.5 Pro (운영)",
  g38: "3.8",
};

export type VoiceGroup = "female" | "male";

export function voiceGroup(voice: CompareVoice): VoiceGroup {
  return voice === "Sulafat" ? "female" : "male";
}

/** 목표 목소리 — 청취 평가에서 "목표에 맞는가"의 기준 */
export const TARGET_VOICE_LABEL: Record<VoiceGroup, string> = {
  female: "LAURA: 따뜻하고 또렷한 성인 여성",
  male: "Leo: 8살 남자 아이",
};

/**
 * 3.8은 Stage에 `…-Default38` 번들만 있음 (2026-10-28 확인, Cheerful38/Gentle38은 "Voice profile not found").
 * 3.8의 감정은 번들이 아니라 style 문구로 표현하므로 감정과 관계없이 Default38을 쓴다.
 */
export function bundleFor(model: ModelKey, voice: CompareVoice, emotion: CompareEmotion) {
  return model === "g38" ? `GEMINI-${voice}-Default38` : `GEMINI-${voice}-${emotion}`;
}

export function isCompareVoice(v: string): v is CompareVoice {
  return (COMPARE_VOICES as readonly string[]).includes(v);
}

/** 기존 프롬프트 Style 줄에서 출발한 3.8 style 후보 (0단계 = 빈 값, Google 권장 시작점) */
export const STYLE_CANDIDATES: Record<VoiceGroup, Record<CompareEmotion, string[]>> = {
  male: {
    Default: ["", "warm", "warm and clear", "warm, clear, and engaging",
      "warm, clear, and engaging, with crisp articulation"],
    Cheerful: ["", "cheerful", "upbeat and excited", "upbeat, excited, and engaging",
      "upbeat, excited, and engaging, with crisp articulation"],
    Gentle: ["", "gentle", "soft and thoughtful", "soft, thoughtful, empathetic",
      "soft, thoughtful, empathetic, with crisp articulation"],
  },
  female: {
    Default: ["", "warm", "warm and encouraging", "warm, clear, and encouraging",
      "warm, clear, and encouraging, with clean articulation"],
    Cheerful: ["", "bright", "bright and energetic", "bright, energetic, motivating, but not hyper",
      "bright, energetic, and motivating, with clean articulation"],
    Gentle: ["", "soft", "soft and nurturing", "soft, nurturing, and warm",
      "soft, nurturing, and warm, with clean articulation"],
  },
};

/** 학습자용 또박또박 발화 — 2026-10-27 #spindle-speech 이장록 프로 테스트 문구 */
export const ANNOUNCER_STYLE =
  "Speak like a news announcer, pronouncing every word clearly and distinctly for English learners.";

export type SynthResult = { url: string; playUrl: string; elapsedMs?: number };

/** Spindle v2 synthesize/save 호출 (Lab 프록시 경유). style은 3.8 번들에만 의미가 있음 */
export async function synthesizeV2(args: {
  text: string;
  bundleName: string;
  style?: string;
  cacheBust: boolean;
  signal?: AbortSignal;
}): Promise<SynthResult> {
  const res = await fetch(`${API_BASE}/spm-synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      text: args.text,
      bundleName: args.bundleName,
      style: args.style?.trim() || undefined,
      platform: "PLAYGROUND",
      cacheBust: args.cacheBust,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; elapsedMs?: number };
  if (!res.ok || !j.url) throw new Error(j.error || `요청 실패 (${res.status})`);
  return {
    url: j.url,
    playUrl: `${API_BASE}/tts-audio?url=${encodeURIComponent(j.url)}`,
    elapsedMs: j.elapsedMs,
  };
}

/**
 * 비율의 95% 신뢰 상한 (Wilson score). k=0이면 약 3/n과 비슷함.
 * "오류 0건"이어도 표본 크기만큼만 말할 수 있다는 것을 같이 보여 주기 위함.
 */
export function wilsonUpper(k: number, n: number, z = 1.96): number | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (center + margin) / denom);
}

export function pct(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 따옴표, 줄바꿈이 든 칸까지 읽는 CSV 파서 */
export function parseCsv(raw: string): string[][] {
  const s = raw.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 용량 초과 등 — 화면 상태는 유지 */
  }
}
