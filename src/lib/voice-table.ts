/**
 * Spindle Speech Voice Table — 활성 Voice Profile(번들) 전체 목록.
 * baseSpm/gender/ageGroup/accent는 백엔드가 제공한 서버 VoiceTable.json
 * (2026-07-14, docs/spm-sweep/server-voicetable.json)을 그대로 반영한 authoritative 값.
 * rate = 요청 spm / baseSpm 이므로, spm=baseSpm이면 해당 VP의 기본(자연) 속도(rate 1.0).
 * Typecast 3종은 서버 v2에 없어(profile not found) baseSpm이 없다.
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
  // ── 서버 VoiceTable.json (2026-07-14 백엔드 제공) 기준 — baseSpm은 authoritative ──
  // Male · Child · en-US
  { bundleName: "GCP-Jeremy-Default", voiceName: "en-US-Neural2-I", gender: "Male", ageGroup: "Child", accent: "en-US", isDefault: true, baseSpm: 239.8 },
  { bundleName: "AWS-Kevin-Default", voiceName: "Kevin", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 227.8 },
  { bundleName: "AWS-Justin-Default", voiceName: "Justin", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 215.1 },
  { bundleName: "AZ-TuningAna-Default", voiceName: "en-US-AnaNeural", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 149.3 },
  { bundleName: "GEMINI-Rasalgethi-Default", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 160.1 },
  { bundleName: "GEMINI-Rasalgethi-Cheerful", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 170.3 },
  { bundleName: "GEMINI-Rasalgethi-Gentle", voiceName: "Rasalgethi", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 160.7 },
  { bundleName: "GEMINI-Puck-Default", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 153.1 },
  { bundleName: "GEMINI-Puck-Cheerful", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 160.7 },
  { bundleName: "GEMINI-Puck-Gentle", voiceName: "Puck", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 146.7 },
  { bundleName: "GEMINI-Fenrir-Default", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 160.3 },
  { bundleName: "GEMINI-Fenrir-Cheerful", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 159.0 },
  { bundleName: "GEMINI-Fenrir-Gentle", voiceName: "Fenrir", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 147.3 },
  { bundleName: "AZ-TuningEvelyn-Default", voiceName: "en-US-EvelynMultilingualNeural", gender: "Male", ageGroup: "Child", accent: "en-US", baseSpm: 162.7 },
  // Male · Child · en-UK
  { bundleName: "GCP-Rey-Default", voiceName: "en-GB-Neural2-B", gender: "Male", ageGroup: "Child", accent: "en-UK", isDefault: true, baseSpm: 223.8 },
  { bundleName: "AZ-TuningMaisie-Default", voiceName: "en-GB-MaisieNeural", gender: "Male", ageGroup: "Child", accent: "en-UK", baseSpm: 155.8 },
  // Male · Adult · en-US
  { bundleName: "AZ-Guy-Friendly", voiceName: "en-US-GuyNeural", gender: "Male", ageGroup: "Adult", accent: "en-US", isDefault: true, baseSpm: 163.3 },
  // Male · Adult · en-UK
  { bundleName: "AZ-Oliver-Default", voiceName: "en-GB-OliverNeural", gender: "Male", ageGroup: "Adult", accent: "en-UK", isDefault: true, baseSpm: 161.4 },
  // Male · Senior · en-US
  { bundleName: "AZ-Tony-Default", voiceName: "en-US-TonyNeural", gender: "Male", ageGroup: "Senior", accent: "en-US", isDefault: true, baseSpm: 168.9 },
  // Male · Senior · en-UK
  { bundleName: "AZ-Alfie-Default", voiceName: "en-GB-AlfieNeural", gender: "Male", ageGroup: "Senior", accent: "en-UK", isDefault: true, baseSpm: 162.5 },
  // Female · Child · en-US
  { bundleName: "AZ-Ana-Default", voiceName: "en-US-AnaNeural", gender: "Female", ageGroup: "Child", accent: "en-US", isDefault: true, baseSpm: 149.3 },
  { bundleName: "AZ-Xiaoyou-Default", voiceName: "zh-CN-XiaoyouMultilingualNeural", gender: "Female", ageGroup: "Child", accent: "en-US", isDefault: true, baseSpm: 197.7 },
  // Female · Child · en-UK
  { bundleName: "AZ-Maisie-Default", voiceName: "en-GB-MaisieNeural", gender: "Female", ageGroup: "Child", accent: "en-UK", isDefault: true, baseSpm: 155.8 },
  // Female · Adult · en-US
  { bundleName: "AZ-Sara-Friendly", voiceName: "en-US-SaraNeural", gender: "Female", ageGroup: "Adult", accent: "en-US", isDefault: true, baseSpm: 151.8 },
  { bundleName: "AZ-Jenny-Cheerful", voiceName: "en-US-JennyNeural", gender: "Female", ageGroup: "Adult", accent: "en-US", baseSpm: 154.9 },
  { bundleName: "GEMINI-Sulafat-Default", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US", baseSpm: 157.8 },
  { bundleName: "GEMINI-Sulafat-Cheerful", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US", baseSpm: 162.9 },
  { bundleName: "GEMINI-Sulafat-Gentle", voiceName: "Sulafat", gender: "Female", ageGroup: "Adult", accent: "en-US", baseSpm: 153.9 },
  { bundleName: "CHIRP-Zephyr-Default", voiceName: "en-US-Chirp3-HD-Zephyr", gender: "Female", ageGroup: "Adult", accent: "en-US", baseSpm: 219.2 },
  // Female · Adult · en-UK
  { bundleName: "AZ-Sonia-Cheerful", voiceName: "en-GB-SoniaNeural", gender: "Female", ageGroup: "Adult", accent: "en-UK", isDefault: true, baseSpm: 190.3 },
  // Female · Senior · en-US
  { bundleName: "AZ-Nancy-Default", voiceName: "en-US-NancyNeural", gender: "Female", ageGroup: "Senior", accent: "en-US", isDefault: true, baseSpm: 148.0 },
  // Female · Senior · en-UK
  { bundleName: "AZ-Hollie-Default", voiceName: "en-GB-HollieNeural", gender: "Female", ageGroup: "Senior", accent: "en-UK", isDefault: true, baseSpm: 157.2 },
  // ── Typecast: 서버 v2 미지원(profile not found) — baseSpm 없음, 참고용 ──
  { bundleName: "TC-Tim-Default", voiceName: "팀v6", gender: "Male", ageGroup: "Adult", accent: "en-US" },
  { bundleName: "TC-Sindarin-Default", voiceName: "Sindarin-v5", gender: "Male", ageGroup: "Senior", accent: "en-US" },
  { bundleName: "TC-Harper-Default", voiceName: "Harper-v2", gender: "Female", ageGroup: "Adult", accent: "en-US" },
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
