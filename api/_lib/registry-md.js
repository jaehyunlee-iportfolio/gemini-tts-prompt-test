function escapeTableCell(s) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function sortRevisionsDesc(revisions) {
  return [...revisions].sort((a, b) => compareSemver(b.version, a.version));
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  return pa.minor - pb.minor;
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)$/i.exec(String(v).trim());
  if (!m) return { major: 0, minor: 0 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function bumpPatch(version) {
  const m = /^v?(\d+)\.(\d+)$/i.exec(String(version).trim());
  if (!m) return 'v1.0';
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10) + 1;
  return `v${major}.${minor}`;
}

function getLatestRevision(prompt) {
  const sorted = sortRevisionsDesc(prompt.revisions || []);
  return sorted[0] || null;
}

function nextRevisionVersion(prompt) {
  const latest = getLatestRevision(prompt);
  if (!latest) return 'v1.0';
  return bumpPatch(latest.version);
}

function registryToMarkdown(registry) {
  const frontmatter = `---
title: LAURA TTS 프롬프트 버전 가이드
sync_to_confluence: true
confluence_page_id: "4077617176"
---

`;

  let body = '# LAURA TTS 프롬프트 버전 가이드\n\n';

  for (const group of registry.groups || []) {
    body += `## ${group.title}\n\n`;
    for (const prompt of group.prompts || []) {
      body += `### ${prompt.title}\n\n`;
      body +=
        '| 버전 | LONG - 일반 버전 프롬프트 | SHORT - 키워드 버전 프롬프트 | 변경사항 |\n';
      body +=
        '|------|--------------------------|---------------------------|---------|\n';
      const rows = sortRevisionsDesc(prompt.revisions || []);
      for (const rev of rows) {
        body += `| ${escapeTableCell(rev.version)} | ${escapeTableCell(rev.long)} | ${escapeTableCell(rev.short)} | ${escapeTableCell(rev.changelog)} |\n`;
      }
      body += '\n';
    }
    body += '---\n\n';
  }

  return frontmatter + body.trimEnd() + '\n';
}

function bumpRegistryMeta(registry) {
  registry.registryVersion = (registry.registryVersion || 0) + 1;
  registry.updatedAt = new Date().toISOString();
}

module.exports = {
  bumpPatch,
  compareSemver,
  sortRevisionsDesc,
  getLatestRevision,
  nextRevisionVersion,
  registryToMarkdown,
  bumpRegistryMeta,
};
