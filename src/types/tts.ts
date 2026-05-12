import type { QaVerdict } from "@/lib/text-similarity";

export const VOICE_IDS = ["Rasalgethi", "Puck", "Fenrir", "Sulafat", "ZephyrDefault"] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

/** Spindle CHIRP Zephyr — 프롬프트 TTS 아님, bundleName 고정 */
export const CHIRP_ZEPHYR_BUNDLE_NAME = "CHIRP-Zephyr-Default";

export function isChirpZephyrVoice(voice: VoiceId): boolean {
  return voice === "ZephyrDefault";
}

export const STYLE_TONES = ["Default", "Cheerful", "Gentle"] as const;
export type StyleTone = (typeof STYLE_TONES)[number];

/**
 * 사용자가 선택 가능한 TTS 모델.
 * - `spindle-laura`: 기존 Spindle LAURA SSE 스트림 (기본)
 * - `gemini-3.1-flash-tts-preview` · `gemini-2.5-pro-tts`:
 *   Spindle의 `/api/v1/support/gemini-model-test/synthesize` 동기 엔드포인트.
 *   bundle 4종(Rasalgethi/Puck/Fenrir/Sulafat)만 지원, Zephyr 미지원.
 */
export const TTS_MODELS = [
  "spindle-laura",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-tts",
] as const;
export type TtsModel = (typeof TTS_MODELS)[number];

export const GEMINI_TEST_MODELS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-tts",
] as const;
export type GeminiTestModel = (typeof GEMINI_TEST_MODELS)[number];

export function isGeminiTestModel(m: TtsModel): m is GeminiTestModel {
  return (GEMINI_TEST_MODELS as readonly string[]).includes(m);
}

export const TTS_MODEL_LABELS: Record<TtsModel, string> = {
  "spindle-laura": "Spindle LAURA (SSE)",
  "gemini-3.1-flash-tts-preview": "Gemini 3.1 Flash TTS (preview)",
  "gemini-2.5-pro-tts": "Gemini 2.5 Pro TTS",
};

export type TtsRunStatus = "loading" | "success" | "error";

export type TtsRunAudioMeta = {
  firstChunkLatencyMs?: number;
  audioDurationMs?: number;
};

export type TtsRunQaStatus = "running" | "done" | "error";

/** STT 검증 결과 — 슬롯/단일 run 양쪽이 공유 */
export type TtsRunQa = {
  qaStatus?: TtsRunQaStatus;
  transcript?: string;
  qaScore?: number;
  qaVerdict?: QaVerdict;
  qaError?: string;
};

/** One slot inside a 벌크(연속 N회) run — 상세에서 플레이어 1개에 대응 */
export type TtsBulkSlot = TtsRunQa & {
  status: TtsRunStatus;
  statusMessage?: string;
  playUrl?: string;
  blobUrl?: string;
  meta?: TtsRunAudioMeta;
};

export type TtsRun = TtsRunQa & {
  id: string;
  createdAt: number;
  bundleName: string;
  voice: VoiceId;
  style: StyleTone;
  /** 선택한 TTS 모델. 과거 히스토리는 없을 수 있으므로 optional. */
  model?: TtsModel;
  originalText: string;
  prompt: string;
  status: TtsRunStatus;
  statusMessage?: string;
  /** Proxied playback URL (`/api/tts-audio?...`) */
  playUrl?: string;
  /** Blob URL for legacy chunked MP3 */
  blobUrl?: string;
  meta?: TtsRunAudioMeta;
  /** >1 이면 목록에는 한 줄, 상세에 `bulkSlots.length`개 플레이어 */
  bulkCount?: number;
  bulkSlots?: TtsBulkSlot[];
};

export function bundleNameFromVoiceStyle(voice: VoiceId, style: StyleTone) {
  if (voice === "ZephyrDefault") return CHIRP_ZEPHYR_BUNDLE_NAME;
  return `GEMINI-${voice}-${style}`;
}
