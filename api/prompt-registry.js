const fs = require('fs');
const path = require('path');
const { getFileContent, REGISTRY_PATH } = require('./_lib/github-repo.js');

function readRegistryFromDisk() {
  const candidates = [
    path.join(process.cwd(), 'docs', 'prompt-registry.json'),
    path.join(__dirname, '..', 'docs', 'prompt-registry.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error('docs/prompt-registry.json not found on server');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let registry = null;
    let lastErr = null;

    if (process.env.GITHUB_TOKEN) {
      try {
        const { text } = await getFileContent(REGISTRY_PATH);
        registry = JSON.parse(text);
      } catch (e) {
        lastErr = e;
        console.error('[prompt-registry] GitHub:', e.message);
      }
    }

    if (!registry) {
      try {
        registry = readRegistryFromDisk();
      } catch (e) {
        lastErr = e;
        console.error('[prompt-registry] disk:', e.message);
      }
    }

    if (!registry) {
      return res.status(503).json({
        error:
          lastErr?.message ||
          'Could not load prompt registry (GitHub and local file both failed)',
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(registry));
  } catch (err) {
    console.error('[prompt-registry]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
