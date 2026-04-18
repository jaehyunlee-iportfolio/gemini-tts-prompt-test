import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getFileContent, REGISTRY_PATH } from "@/lib/server/github-repo";

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
  let registry: unknown = null;
  let lastErr: Error | null = null;

  if (process.env.GITHUB_TOKEN) {
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
