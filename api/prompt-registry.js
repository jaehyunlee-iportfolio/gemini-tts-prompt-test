import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { getFileContent, REGISTRY_PATH } = require('./_lib/github-repo.js');

function readRegistryFromDisk() {
  const p = path.join(__dirname, '..', 'docs', 'prompt-registry.json');
  const text = fs.readFileSync(p, 'utf8');
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let registry;
    try {
      if (!process.env.GITHUB_TOKEN) {
        registry = readRegistryFromDisk();
      } else {
        const { text } = await getFileContent(REGISTRY_PATH);
        registry = JSON.parse(text);
      }
    } catch (e) {
      if (process.env.GITHUB_TOKEN) {
        throw e;
      }
      registry = readRegistryFromDisk();
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(registry));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
