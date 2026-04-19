export const REGISTRY_PATH = "docs/prompt-registry.json";
export const MARKDOWN_PATH = "docs/LAURA-TTS-프롬프트-버전-가이드.md";
/** 위임 레지스트리 관리자(슈퍼 외 추가 계정). GitHub PAT 없으면 로컬 docs만 사용 */
export const REGISTRY_ADMINS_PATH = "docs/registry-admins.json";

/** PAT for GitHub Contents API (Vercel / local). `GH_TOKEN` is a common alias (e.g. GitHub CLI). */
export function resolveGithubPat(): string | undefined {
  const t = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return t || undefined;
}

function getRepoConfig() {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  const token = resolveGithubPat();
  const branch = process.env.GITHUB_BRANCH?.trim() || "main";
  if (!owner || !repo || !token) {
    throw new Error(
      "Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN (or GH_TOKEN) environment variables",
    );
  }
  return { owner, repo, token, branch };
}

async function githubApi(path: string, options: RequestInit = {}) {
  const { token } = getRepoConfig();
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" && json !== null && "message" in json
        ? String((json as { message?: string }).message)
        : text || res.statusText;
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }
  return json as Record<string, unknown>;
}

export async function getFileContent(path: string) {
  const { owner, repo, branch } = getRepoConfig();
  const data = (await githubApi(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  )) as { content?: string; sha?: string };
  if (!data.content) {
    throw new Error(`No content for ${path}`);
  }
  const buf = Buffer.from(data.content, "base64");
  return { text: buf.toString("utf8"), sha: data.sha as string };
}

export async function putFile(
  path: string,
  content: string,
  message: string,
  sha: string | undefined,
) {
  const { owner, repo, branch } = getRepoConfig();
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;

  return githubApi(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}
