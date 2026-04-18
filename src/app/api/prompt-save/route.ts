import { NextResponse } from "next/server";
import {
  getFileContent,
  putFile,
  REGISTRY_PATH,
  MARKDOWN_PATH,
  resolveGithubPat,
} from "@/lib/server/github-repo";
import {
  nextRevisionVersion,
  registryToMarkdown,
  bumpRegistryMeta,
} from "@/lib/server/registry-md";

export const runtime = "nodejs";
export const maxDuration = 60;

type RegistryGroup = {
  id: string;
  title: string;
  prompts: RegistryPrompt[];
};

type RegistryPrompt = {
  id: string;
  title: string;
  revisions?: RegistryRevision[];
};

type RegistryRevision = {
  version: string;
  long: string;
  short?: string;
  changelog?: string;
  createdAt?: string;
};

type RegistryJson = {
  groups?: RegistryGroup[];
  registryVersion?: number;
  updatedAt?: string;
};

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return body as Record<string, unknown>;
  }
  return null;
}

function findGroup(registry: RegistryJson, groupId: string) {
  const g = registry.groups?.find((x) => x.id === groupId);
  if (!g) {
    throw new Error(`group not found: ${groupId}`);
  }
  return g;
}

function findPrompt(group: RegistryGroup, promptId: string) {
  const p = group.prompts.find((x) => x.id === promptId);
  if (!p) {
    throw new Error(`prompt not found: ${promptId}`);
  }
  return p;
}

export async function POST(req: Request) {
  const admin = req.headers.get("x-prompt-admin-secret");
  if (!process.env.PROMPT_ADMIN_SECRET || admin !== process.env.PROMPT_ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!resolveGithubPat()) {
    return NextResponse.json(
      {
        error:
          "GitHub PAT가 서버에 없습니다. Vercel(또는 호스팅) 프로젝트 Settings → Environment Variables에 GITHUB_TOKEN 또는 GH_TOKEN, 그리고 GITHUB_OWNER·GITHUB_REPO를 추가한 뒤 재배포하세요.",
      },
      { status: 503 },
    );
  }

  let jsonBody: unknown;
  try {
    jsonBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = parseBody(jsonBody);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as string | undefined;
  const groupId = body.groupId as string | undefined;
  const promptId = body.promptId as string | undefined;
  const revision = body.revision as
    | { long?: string; short?: string; changelog?: string }
    | undefined;

  if (action === "createPrompt" || action === "createGroup") {
    return NextResponse.json(
      {
        error:
          "createPrompt/createGroup는 사용 중단되었습니다. GitHub에서 docs/prompt-registry.json을 직접 수정한 뒤 커밋하세요.",
      },
      { status: 410 },
    );
  }

  try {
    const regFile = await getFileContent(REGISTRY_PATH);
    const mdFile = await getFileContent(MARKDOWN_PATH);
    const registry = JSON.parse(regFile.text) as RegistryJson;

    if (!registry.groups) {
      registry.groups = [];
    }

    if (action === "createRevision") {
      if (!groupId || !promptId) {
        return NextResponse.json(
          { error: "groupId and promptId are required" },
          { status: 400 },
        );
      }
      if (!revision?.long?.trim()) {
        return NextResponse.json({ error: "revision.long is required" }, { status: 400 });
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
        short: (revision.short || "").trim(),
        changelog: (revision.changelog || "").trim(),
        createdAt: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        { error: "Unknown action. Use createRevision." },
        { status: 400 },
      );
    }

    bumpRegistryMeta(registry);
    const md = registryToMarkdown(registry);
    const outReg = `${JSON.stringify(registry, null, 2)}\n`;

    const msgReg = `docs(prompts): ${action} ${groupId || ""} (registry v${registry.registryVersion})`;
    const msgMd = `docs: sync LAURA TTS guide (registry v${registry.registryVersion})`;

    const putReg = (await putFile(REGISTRY_PATH, outReg, msgReg, regFile.sha)) as {
      commit?: { html_url?: string };
    };
    const putMd = (await putFile(MARKDOWN_PATH, md, msgMd, mdFile.sha)) as {
      commit?: { html_url?: string };
    };

    return NextResponse.json({
      ok: true,
      registryVersion: registry.registryVersion,
      commits: [putReg.commit?.html_url, putMd.commit?.html_url].filter(Boolean),
    });
  } catch (err) {
    console.error("[prompt-save]", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
