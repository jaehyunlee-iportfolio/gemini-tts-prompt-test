function escapeTableCell(s: string | null | undefined) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function parseSemver(v: string) {
  const m = /^v?(\d+)\.(\d+)$/i.exec(String(v).trim());
  if (!m) return { major: 0, minor: 0 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function compareSemver(a: string, b: string) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  return pa.minor - pb.minor;
}

export function sortRevisionsDesc<T extends { version: string }>(revisions: T[] | undefined) {
  return [...(revisions || [])].sort((a, b) => compareSemver(b.version, a.version));
}

function bumpPatch(version: string) {
  const m = /^v?(\d+)\.(\d+)$/i.exec(String(version).trim());
  if (!m) return "v1.0";
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10) + 1;
  return `v${major}.${minor}`;
}

function getLatestRevision(prompt: { revisions?: { version: string }[] }) {
  const sorted = sortRevisionsDesc(prompt.revisions || []);
  return sorted[0] || null;
}

export function nextRevisionVersion(prompt: { revisions?: { version: string }[] }) {
  const latest = getLatestRevision(prompt);
  if (!latest) return "v1.0";
  return bumpPatch(latest.version);
}

export function registryToMarkdown(registry: {
  groups?: {
    title: string;
    prompts?: {
      title: string;
      revisions?: { version: string; long?: string; short?: string; changelog?: string }[];
    }[];
  }[];
}) {
  const frontmatter = `---
title: LAURA TTS 프롬프트 버전 가이드
sync_to_confluence: true
confluence_page_id: "4077617176"
---

`;

  let body = "# LAURA TTS 프롬프트 버전 가이드\n\n";

  for (const group of registry.groups || []) {
    body += `## ${group.title}\n\n`;
    for (const prompt of group.prompts || []) {
      body += `### ${prompt.title}\n\n`;
      body +=
        "| 버전 | LONG - 일반 버전 프롬프트 | SHORT - 키워드 버전 프롬프트 | 변경사항 |\n";
      body +=
        "|------|--------------------------|---------------------------|---------|\n";
      const rows = sortRevisionsDesc(prompt.revisions || []);
      for (const rev of rows) {
        body += `| ${escapeTableCell(rev.version)} | ${escapeTableCell(rev.long)} | ${escapeTableCell(rev.short)} | ${escapeTableCell(rev.changelog)} |\n`;
      }
      body += "\n";
    }
    body += "---\n\n";
  }

  return frontmatter + body.trimEnd() + "\n";
}

export function bumpRegistryMeta(registry: {
  registryVersion?: number;
  updatedAt?: string;
}) {
  registry.registryVersion = (registry.registryVersion || 0) + 1;
  registry.updatedAt = new Date().toISOString();
}
