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
