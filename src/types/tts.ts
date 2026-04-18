export const VOICE_IDS = ["Rasalgethi", "Puck", "Fenrir", "Sulafat"] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export const STYLE_TONES = ["Default", "Cheerful", "Gentle"] as const;
export type StyleTone = (typeof STYLE_TONES)[number];

export type TtsRunStatus = "loading" | "success" | "error";

export type TtsRunAudioMeta = {
  firstChunkLatencyMs?: number;
  audioDurationMs?: number;
};

/** One slot inside a 벌크(연속 N회) run — 상세에서 플레이어 1개에 대응 */
export type TtsBulkSlot = {
  status: TtsRunStatus;
  statusMessage?: string;
  playUrl?: string;
  blobUrl?: string;
  meta?: TtsRunAudioMeta;
};

export type TtsRun = {
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
  return `GEMINI-${voice}-${style}`;
}
