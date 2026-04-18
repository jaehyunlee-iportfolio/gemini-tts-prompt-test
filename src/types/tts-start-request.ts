/** POST /api/tts-start JSON body (client → Next route). */
export type TtsStartRequestBody = {
  text: string;
  /** When true, route handler appends invisible cache-bust token before upstream. */
  cacheBust?: boolean;
  bundleName: string;
  viseme?: boolean;
  prompt?: string;
  platform?: string;
  userId?: number;
};
