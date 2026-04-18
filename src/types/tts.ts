export const VOICE_IDS = ["Rasalgethi", "Puck", "Fenrir", "Sulafat"] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export const STYLE_TONES = ["Default", "Cheerful", "Gentle"] as const;
export type StyleTone = (typeof STYLE_TONES)[number];

export type TtsRunStatus = "loading" | "success" | "error";

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
  meta?: {
    firstChunkLatencyMs?: number;
    audioDurationMs?: number;
  };
};

export function bundleNameFromVoiceStyle(voice: VoiceId, style: StyleTone) {
  return `GEMINI-${voice}-${style}`;
}
