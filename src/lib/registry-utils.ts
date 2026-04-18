import type { PromptRegistryJson, PromptRevision } from "@/types/registry";

export function sortRevisionsDesc(revisions: PromptRevision[] | undefined) {
  return [...(revisions || [])].sort((a, b) => {
    const pa = String(a.version).match(/^v?(\d+)\.(\d+)$/i);
    const pb = String(b.version).match(/^v?(\d+)\.(\d+)$/i);
    if (!pa) return 1;
    if (!pb) return -1;
    const ma = parseInt(pa[1], 10) * 100 + parseInt(pa[2], 10);
    const mb = parseInt(pb[1], 10) * 100 + parseInt(pb[2], 10);
    return mb - ma;
  });
}

export function buildPresetsFromRegistry(reg: PromptRegistryJson) {
  const out: Record<string, Record<string, string>> = {};
  for (const g of reg.groups || []) {
    out[g.title] = {};
    for (const p of g.prompts || []) {
      for (const r of sortRevisionsDesc(p.revisions)) {
        const key = `${p.title} ${r.version}`;
        out[g.title][key] = r.long;
      }
    }
  }
  return out;
}
