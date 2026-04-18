const REGISTRY_PATH = 'docs/prompt-registry.json';
const MARKDOWN_PATH = 'docs/LAURA-TTS-프롬프트-버전-가이드.md';

function getRepoConfig() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!owner || !repo || !token) {
    throw new Error(
      'Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN environment variables',
    );
  }
  return { owner, repo, token, branch };
}

async function githubApi(path, options = {}) {
  const { token } = getRepoConfig();
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || text || res.statusText;
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }
  return json;
}

async function getFileContent(path) {
  const { owner, repo, branch } = getRepoConfig();
  const data = await githubApi(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (!data.content) {
    throw new Error(`No content for ${path}`);
  }
  const buf = Buffer.from(data.content, 'base64');
  return { text: buf.toString('utf8'), sha: data.sha };
}

async function putFile(path, content, message, sha) {
  const { owner, repo, branch } = getRepoConfig();
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  return githubApi(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  );
}

module.exports = {
  REGISTRY_PATH,
  MARKDOWN_PATH,
  getFileContent,
  putFile,
};
