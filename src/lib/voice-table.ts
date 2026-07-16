/**
 * Spindle Speech Voice Table — 활성 Voice Profile(번들) 전체 목록.
 * 출처: Confluence SS/Voice Table (2026-05-08 수정본). Typecast 취소선 번들은 제외.
 * baseSpm은 서버(Voice Profile attributes) 값이며, 미확인 번들은 undefined —
 * 이 경우 spm 파라미터 지정 시 서버가 400/500(baseSpm is required)을 반환할 수 있다.
 */

export const TTS_PROVIDERS = ["GEMINI", "AZ", "GCP", "AWS", "TC", "CHIRP"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  GEMINI: "Gemini TTS",
  AZ: "Azure",
  GCP: "GCP Neural2",
  AWS: "AWS Polly",
  TC: "Typecast",
  CHIRP: "GCP Chirp3HD",
};

export type VoiceGender = "Male" | "Female";
export type VoiceAgeGroup = "Child" | "Adult" | "Senior";
export type VoiceAccent = "en-US" | "en-UK";

export type VoiceProfile = {
  bundleName: string;
  provider: TtsProvider;
  voiceName: string;
  gender: VoiceGender;
  ageGroup: VoiceAgeGroup;
  accent: VoiceAccent;
  /** Bundle Name 생략 시 적용되는 기본 번들 */
  isDefault?: boolean;
  /** 서버 Voice Profile의 기본 발화 속도(syllables per minute). rate = spm / baseSpm */
  baseSpm?: number;
};

function providerFromBundleName(bundleName: string): TtsProvider {
  const prefix = bundleName.split("-")[0];
  return (TTS_PROVIDERS as readonly string[]).includes(prefix)
    ? (prefix as TtsProvider)
    : "AZ";
}

type ProfileSeed = Omit<VoiceProfile, "provider">;

const SEEDS: ProfileSeed[] = [
  // ── Male · Child · en-US ──
  { bundleName: "GCP-Jeremy-Default", voiceName: "en-US-Neural2-I", gender: "Male", ageGroup: "Child", accent: "en-US", isDefault: true },
  { bundleName: "AWS-Kevin-Default", voiceName: "Kevin", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "AWS-Justin-Default", voiceName: "Justin", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "AZ-TuningAna-Default", voiceName: "en-US-AnaNeural", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "AZ-TuningEvelyn-Default", voiceName: "en-US-EvelynMultilingualNeural", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Rasalgethi-Default", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Rasalgethi-Cheerful", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Rasalgethi-Gentle", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Puck-Default", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Puck-Cheerful", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Puck-Gentle", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Fenrir-Default", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Fenrir-Cheerful", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US" },
  { bundleName: "GEMINI-Fenrir-Gentle", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US" },
  // ── Male · Child · en-UK ──
  { bundleName: "GCP-Rey-Default", voiceName: "en-GB-Neural2-B", gender: "Male", ageGroup: "Child", accent: "en-UK", isDefault: true },
  { bundleName: "AZ-TuningMaisie-Default", voiceName: "en-GB-MaisieNeural", gender: "Male", ageGroup: "Child", accent: "en-UK" },
  // ── Male · Adult ──
  { bundleName: "AZ-Guy-Friendly", voiceName: "en-US-GuyNeural", gender: "Male", ageGroup: "Adult", accent: "en-US", isDefault: true },
  { bundleName: "TC-Tim-Default", voiceName: "팀v6", gender: "Male", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "AZ-Oliver-Default", voiceName: "en-GB-OliverNeural", gender: "Male", ageGroup: "Adult", accent: "en-UK", isDefault: true },
  // ── Male · Senior ──
  { bundleName: "AZ-Tony-Default", voiceName: "en-US-TonyNeural", gender: "Male", ageGroup: "Senior", accent: "en-US", isDefault: true },
  { bundleName: "TC-Sindarin-Default", voiceName: "Sindarin-v5", gender: "Male", ageGroup: "Senior", accent: "en-US" },
  { bundleName: "AZ-Alfie-Default", voiceName: "en-GB-AlfieNeural", gender: "Male", ageGroup: "Senior", accent: "en-UK", isDefault: true },
  // ── Female · Child ──
  { bundleName: "AZ-Ana-Default", voiceName: "en-US-AnaNeural", gender: "Female", ageGroup: "Child", accent: "en-US", isDefault: true },
  { bundleName: "AZ-Maisie-Default", voiceName: "en-GB-MaisieNeural", gender: "Female", ageGroup: "Child", accent: "en-UK", isDefault: true },
  // ── Female · Adult · en-US ──
  { bundleName: "AZ-Sara-Friendly", voiceName: "en-US-SaraNeural", gender: "Female", ageGroup: "Adult", accent: "en-US", isDefault: true },
  { bundleName: "AZ-Jenny-Cheerful", voiceName: "en-US-JennyNeural", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "TC-Harper-Default", voiceName: "Harper-v2", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "GEMINI-Sulafat-Default", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "GEMINI-Sulafat-Cheerful", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "GEMINI-Sulafat-Gentle", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "CHIRP-Zephyr-Default", voiceName: "Zephyr", gender: "Female", ageGroup: "Adult", accent: "en-US" },
  // ── Female · Adult · en-UK ──
  { bundleName: "AZ-Sonia-Cheerful", voiceName: "en-GB-SoniaNeural", gender: "Female", ageGroup: "Adult", accent: "en-UK", isDefault: true },
  // ── Female · Senior ──
  { bundleName: "AZ-Nancy-Default", voiceName: "en-US-NancyNeural", gender: "Female", ageGroup: "Senior", accent: "en-US", isDefault: true },
  { bundleName: "AZ-Hollie-Default", voiceName: "en-GB-HollieNeural", gender: "Female", ageGroup: "Senior", accent: "en-UK", isDefault: true },
];

export const VOICE_PROFILES: VoiceProfile[] = SEEDS.map((s) => ({
  ...s,
  provider: providerFromBundleName(s.bundleName),
}));

export function findVoiceProfile(bundleName: string): VoiceProfile | undefined {
  return VOICE_PROFILES.find((p) => p.bundleName === bundleName);
}

export function voiceProfileLabel(p: VoiceProfile): string {
  return `${p.gender} ${p.ageGroup} · ${p.accent}`;
}

/** provider → profiles (VOICE_PROFILES 순서 유지) — Select 그룹핑용 */
export function groupProfilesByProvider(): Array<{
  provider: TtsProvider;
  profiles: VoiceProfile[];
}> {
  return TTS_PROVIDERS.map((provider) => ({
    provider,
    profiles: VOICE_PROFILES.filter((p) => p.provider === provider),
  })).filter((g) => g.profiles.length > 0);
}
