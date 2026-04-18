import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  getFileContent,
  putFile,
  REGISTRY_PATH,
  MARKDOWN_PATH,
} = require('./_lib/github-repo.js');
const {
  nextRevisionVersion,
  registryToMarkdown,
  bumpRegistryMeta,
} = require('./_lib/registry-md.js');

function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    return b;
  }
  if (typeof b === 'string') {
    try {
      return JSON.parse(b || '{}');
    } catch {
      return null;
    }
  }
  return null;
}

function slugifyId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findGroup(registry, groupId) {
  const g = registry.groups.find((x) => x.id === groupId);
  if (!g) {
    throw new Error(`group not found: ${groupId}`);
  }
  return g;
}

function findPrompt(group, promptId) {
  const p = group.prompts.find((x) => x.id === promptId);
  if (!p) {
    throw new Error(`prompt not found: ${promptId}`);
  }
  return p;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = req.headers['x-prompt-admin-secret'];
  if (!process.env.PROMPT_ADMIN_SECRET || admin !== process.env.PROMPT_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.GITHUB_TOKEN) {
    return res.status(503).json({ error: 'GITHUB_TOKEN is not configured on the server' });
  }

  const body = parseBody(req);
  if (!body) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { action, groupId, promptId, revision, newPrompt, newGroup } = body;

  try {
    const regFile = await getFileContent(REGISTRY_PATH);
    const mdFile = await getFileContent(MARKDOWN_PATH);
    const registry = JSON.parse(regFile.text);

    if (!registry.groups) {
      registry.groups = [];
    }

    if (action === 'createRevision') {
      if (!groupId || !promptId) {
        return res.status(400).json({ error: 'groupId and promptId are required' });
      }
      if (!revision?.long?.trim()) {
        return res.status(400).json({ error: 'revision.long is required' });
      }
      const g = findGroup(registry, groupId);
      const p = findPrompt(g, promptId);
      if (!p.revisions) {
        p.revisions = [];
      }
      const version = nextRevisionVersion(p);
      p.revisions.unshift({
        version,
        long: revision.long.trim(),
        short: (revision.short || '').trim(),
        changelog: (revision.changelog || '').trim(),
        createdAt: new Date().toISOString(),
      });
    } else if (action === 'createPrompt') {
      if (!groupId || !newPrompt?.id || !newPrompt?.title) {
        return res
          .status(400)
          .json({ error: 'groupId, newPrompt.id, and newPrompt.title are required' });
      }
      if (!revision?.long?.trim()) {
        return res.status(400).json({ error: 'revision.long is required' });
      }
      const slug = slugifyId(newPrompt.id);
      if (!slug) {
        return res.status(400).json({ error: 'newPrompt.id must contain letters or numbers' });
      }
      const g = findGroup(registry, groupId);
      if (g.prompts.some((x) => x.id === slug)) {
        return res.status(409).json({ error: `prompt id already exists: ${slug}` });
      }
      g.prompts.push({
        id: slug,
        title: String(newPrompt.title).trim(),
        revisions: [
          {
            version: 'v1.0',
            long: revision.long.trim(),
            short: (revision.short || '').trim(),
            changelog: (revision.changelog || '').trim() || '초기 리비전',
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } else if (action === 'createGroup') {
      if (!newGroup?.id || !newGroup?.title) {
        return res.status(400).json({ error: 'newGroup.id and newGroup.title are required' });
      }
      const gid = slugifyId(newGroup.id);
      if (!gid) {
        return res.status(400).json({ error: 'newGroup.id must contain letters or numbers' });
      }
      if (registry.groups.some((x) => x.id === gid)) {
        return res.status(409).json({ error: `group id already exists: ${gid}` });
      }
      registry.groups.push({
        id: gid,
        title: String(newGroup.title).trim(),
        prompts: [],
      });
    } else {
      return res.status(400).json({
        error: 'Unknown action. Use createRevision, createPrompt, or createGroup.',
      });
    }

    bumpRegistryMeta(registry);
    const md = registryToMarkdown(registry);
    const outReg = `${JSON.stringify(registry, null, 2)}\n`;

    const msgReg = `docs(prompts): ${action} ${groupId || newGroup?.id || ''} (registry v${registry.registryVersion})`;
    const msgMd = `docs: sync LAURA TTS guide (registry v${registry.registryVersion})`;

    const putReg = await putFile(REGISTRY_PATH, outReg, msgReg, regFile.sha);
    const putMd = await putFile(MARKDOWN_PATH, md, msgMd, mdFile.sha);

    return res.status(200).json({
      ok: true,
      registryVersion: registry.registryVersion,
      commits: [putReg.commit?.html_url, putMd.commit?.html_url].filter(Boolean),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
