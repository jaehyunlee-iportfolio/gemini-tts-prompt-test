import { readFile } from "fs/promises";
import path from "path";
import { getFileContent, REGISTRY_ADMINS_PATH, resolveGithubPat } from "@/lib/server/github-repo";
import {
  isAllowedGoogleEmailDomain,
  SUPER_REGISTRY_ADMIN_EMAIL,
} from "@/lib/registry-access";

type AdminsFile = { emails?: string[] };

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function isIportfolioEmail(email: string): boolean {
  return isAllowedGoogleEmailDomain(email);
}

async function readAdminsFromDisk(): Promise<string[]> {
  const candidates = [
    path.join(process.cwd(), "docs", "registry-admins.json"),
    path.join(process.cwd(), "..", "docs", "registry-admins.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      const j = JSON.parse(raw) as AdminsFile;
      return (j.emails ?? []).filter((x): x is string => typeof x === "string").map(normEmail);
    } catch {
      /* try next */
    }
  }
  return [];
}

/** GitHub에서 위임 관리자 목록만 읽음(슈퍼 관리자는 포함하지 않음). sha는 업데이트용. */
export async function loadDelegatedAdminsFromGithub(): Promise<{
  emails: string[];
  sha: string | undefined;
}> {
  if (!resolveGithubPat()) {
    const disk = await readAdminsFromDisk();
    return { emails: disk.filter(isIportfolioEmail), sha: undefined };
  }
  try {
    const { text, sha } = await getFileContent(REGISTRY_ADMINS_PATH);
    const j = JSON.parse(text) as AdminsFile;
    const emails = (j.emails ?? [])
      .filter((x): x is string => typeof x === "string")
      .map(normEmail)
      .filter(isIportfolioEmail);
    return { emails, sha };
  } catch {
    return { emails: [], sha: undefined };
  }
}

export function getEnvRegistryAdminEmails(): string[] {
  return (process.env.REGISTRY_ADMIN_EMAILS ?? "")
    .split(",")
    .map(normEmail)
    .filter(Boolean)
    .filter(isIportfolioEmail);
}

/**
 * 레지스트리 API 허용 이메일 = 슈퍼 관리자(항상) + REGISTRY_ADMIN_EMAILS(env) + docs/registry-admins.json
 */
export async function resolveRegistryAdminEmails(): Promise<string[]> {
  const set = new Set<string>();
  set.add(normEmail(SUPER_REGISTRY_ADMIN_EMAIL));

  const envExtra = getEnvRegistryAdminEmails();
  for (const e of envExtra) set.add(e);

  const { emails } = await loadDelegatedAdminsFromGithub();
  for (const e of emails) set.add(e);

  return [...set].sort();
}

export async function isSessionRegistryAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = normEmail(email);
  const list = await resolveRegistryAdminEmails();
  return list.includes(e);
}

export function formatAdminsJson(emails: string[]): string {
  const unique = [...new Set(emails.map(normEmail).filter(isIportfolioEmail))].sort();
  return `${JSON.stringify({ emails: unique }, null, 2)}\n`;
}
