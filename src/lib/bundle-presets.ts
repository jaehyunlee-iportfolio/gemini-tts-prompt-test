import { FALLBACK_PRESETS } from "@/lib/presets";
import { sortRevisionsDesc } from "@/lib/registry-utils";
import type { PromptRegistryJson } from "@/types/registry";
import {
  bundleNameFromVoiceStyle,
  type StyleTone,
  type VoiceId,
} from "@/types/tts";

/** Known registry group ids (docs/prompt-registry.json) */
const VOICE_REGISTRY_GROUP_ID: Record<VoiceId, string> = {
  Rasalgethi: "male-child",
  Puck: "male-child",
  Fenrir: "male-child",
  Sulafat: "female-adult-sulafat",
};

/** Fallback preset map keys in presets.ts */
const VOICE_FALLBACK_GROUP: Record<VoiceId, keyof typeof FALLBACK_PRESETS> = {
  Rasalgethi: "Male Child",
  Puck: "Male Child",
  Fenrir: "Male Child",
  Sulafat: "Female Adult (Sulafat)",
};

export type BundlePresetItem = {
  id: string;
  /** Chip에만 표시 (예: v1.3). 전체 bundle은 tooltip `detail` 참고 */
  chipLabel: string;
  long: string;
  /** 툴팁: bundle·그룹 등 */
  detail?: string;
};

function promptIdForStyle(style: StyleTone): string {
  return style.toLowerCase();
}

function resolveRegistryGroup(
  reg: PromptRegistryJson,
  voice: VoiceId,
): { id: string; title: string } | undefined {
  const preferred = VOICE_REGISTRY_GROUP_ID[voice];
  const byId = reg.groups?.find((g) => g.id === preferred);
  if (byId) return { id: byId.id, title: byId.title };

  if (voice === "Sulafat") {
    const g = reg.groups?.find((x) => /sulafat/i.test(x.id) || /sulafat/i.test(x.title));
    if (g) return { id: g.id, title: g.title };
  } else {
    const g = reg.groups?.find(
      (x) =>
        x.id === "male-child" ||
        /rasalgethi|puck|fenrir|male child|남아/i.test(x.title) ||
        /rasalgethi|puck|fenrir/i.test(x.id),
    );
    if (g) return { id: g.id, title: g.title };
  }
  return reg.groups?.[0] ? { id: reg.groups[0].id, title: reg.groups[0].title } : undefined;
}

function listFromRegistry(
  reg: PromptRegistryJson,
  voice: VoiceId,
  style: StyleTone,
): BundlePresetItem[] {
  const groupMeta = resolveRegistryGroup(reg, voice);
  if (!groupMeta) return [];
  const group = reg.groups?.find((g) => g.id === groupMeta.id);
  if (!group) return [];

  const pid = promptIdForStyle(style);
  const prompt = group.prompts?.find((p) => p.id === pid);
  if (!prompt) return [];

  const bundle = bundleNameFromVoiceStyle(voice, style);
  return sortRevisionsDesc(prompt.revisions).map((r) => ({
    id: `reg:${group.id}:${prompt.id}:${r.version}`,
    chipLabel: r.version,
    long: r.long,
    detail: `${bundle} · ${r.version} — ${group.title} / ${prompt.title}`,
  }));
}

function listFromFallback(voice: VoiceId, style: StyleTone): BundlePresetItem[] {
  const groupTitle = VOICE_FALLBACK_GROUP[voice];
  const presets = FALLBACK_PRESETS[groupTitle];
  if (!presets) return [];

  const prefix = `${style} `;
  const bundle = bundleNameFromVoiceStyle(voice, style);

  return Object.entries(presets)
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, long]) => {
      const versionPart = name.slice(prefix.length).trim();
      return {
        id: `fb:${groupTitle}:${name}`,
        chipLabel: versionPart || name,
        long,
        detail: `${bundle} — ${groupTitle} · ${name}`,
      };
    });
}

/** Prompt revisions for the current bundle only (voice + style → one prompt track). */
export function listBundlePresets(
  registry: PromptRegistryJson | null,
  voice: VoiceId,
  style: StyleTone,
): BundlePresetItem[] {
  if (registry?.groups?.length) {
    const fromReg = listFromRegistry(registry, voice, style);
    if (fromReg.length) return fromReg;
  }
  return listFromFallback(voice, style);
}
