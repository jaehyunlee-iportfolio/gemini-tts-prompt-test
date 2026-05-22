import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFileContent, REGISTRY_PATH, resolveGithubPat } from "@/lib/server/github-repo";
import { isAllowedGoogleEmailDomain } from "@/lib/registry-access";

export const runtime = "nodejs";
export const maxDuration = 30;

async function readRegistryFromDisk(): Promise<unknown> {
  const candidates = [
    path.join(process.cwd(), "docs", "prompt-registry.json"),
    path.join(process.cwd(), "..", "docs", "prompt-registry.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw);
    } catch {
      /* try next */
    }
  }
  throw new Error("docs/prompt-registry.json not found on server");
}

export async function GET() {
  // 읽기 권한은 로그인된 사내(@iportfolio.co.kr) 계정 누구에게나 허용합니다.
  // 쓰기(createRevision 등)는 /api/prompt-save에서 별도로 admin gate 적용.
  // Preview 탭이 기본 프롬프트(레지스트리 최신 long)를 자동 로드하려면 GET이 필요.
  const session = await auth();
  if (!isAllowedGoogleEmailDomain(session?.user?.email)) {
    return NextResponse.json(
      { error: "로그인된 @iportfolio.co.kr 계정에서만 사용할 수 있습니다." },
      { status: 403 },
    );
  }

  let registry: unknown = null;
  let lastErr: Error | null = null;

  if (resolveGithubPat()) {
    try {
      const { text } = await getFileContent(REGISTRY_PATH);
      registry = JSON.parse(text);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error("[prompt-registry] GitHub:", lastErr.message);
    }
  }

  if (!registry) {
    try {
      registry = await readRegistryFromDisk();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error("[prompt-registry] disk:", lastErr.message);
    }
  }

  if (!registry) {
    return NextResponse.json(
      {
        error:
          lastErr?.message ||
          "Could not load prompt registry (GitHub and local file both failed)",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(registry, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
