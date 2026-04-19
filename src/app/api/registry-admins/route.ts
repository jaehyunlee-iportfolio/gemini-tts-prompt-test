import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { registryForbiddenBody, SUPER_REGISTRY_ADMIN_EMAIL } from "@/lib/registry-access";
import {
  formatAdminsJson,
  getEnvRegistryAdminEmails,
  isSessionRegistryAdmin,
  loadDelegatedAdminsFromGithub,
  resolveRegistryAdminEmails,
} from "@/lib/server/registry-admins";
import { putFile, REGISTRY_ADMINS_PATH, resolveGithubPat } from "@/lib/server/github-repo";

export const runtime = "nodejs";
export const maxDuration = 30;

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

export async function GET() {
  const session = await auth();
  if (!(await isSessionRegistryAdmin(session?.user?.email))) {
    return NextResponse.json(registryForbiddenBody(), { status: 403 });
  }

  const emails = await resolveRegistryAdminEmails();
  const delegated = await loadDelegatedAdminsFromGithub();
  const superN = normEmail(SUPER_REGISTRY_ADMIN_EMAIL);
  const envList = getEnvRegistryAdminEmails();
  const envOnly = envList.filter((e) => e !== superN && !delegated.emails.includes(e));
  return NextResponse.json({
    emails,
    superEmail: SUPER_REGISTRY_ADMIN_EMAIL,
    delegatedEmails: delegated.emails,
    envAdminEmails: envOnly,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!(await isSessionRegistryAdmin(session?.user?.email))) {
    return NextResponse.json(registryForbiddenBody(), { status: 403 });
  }

  if (!resolveGithubPat()) {
    return NextResponse.json(
      {
        error:
          "GitHub PAT가 없어 관리자 목록을 저장할 수 없습니다. GITHUB_TOKEN(또는 GH_TOKEN)과 GITHUB_OWNER·GITHUB_REPO를 설정하세요.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = (body as { action?: string }).action;
  const emailRaw = (body as { email?: string }).email;
  if (action !== "add" && action !== "remove") {
    return NextResponse.json({ error: "action must be add or remove" }, { status: 400 });
  }
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const email = normEmail(emailRaw);
  if (!email.endsWith("@iportfolio.co.kr")) {
    return NextResponse.json(
      { error: "iportfolio.co.kr 도메인 이메일만 등록할 수 있습니다." },
      { status: 400 },
    );
  }

  if (action === "remove" && email === normEmail(SUPER_REGISTRY_ADMIN_EMAIL)) {
    return NextResponse.json(
      { error: "기본 슈퍼 관리자 계정은 목록에서 제거할 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const { emails: delegated, sha } = await loadDelegatedAdminsFromGithub();
    const superN = normEmail(SUPER_REGISTRY_ADMIN_EMAIL);
    const set = new Set(
      delegated.map(normEmail).filter((e) => e && e !== superN),
    );

    if (action === "add") {
      if (email === superN) {
        return NextResponse.json(
          { error: "기본 슈퍼 관리자는 파일에 다시 넣을 필요가 없습니다." },
          { status: 400 },
        );
      }
      set.add(email);
    } else {
      set.delete(email);
    }

    const nextList = [...set].sort();
    const out = formatAdminsJson(nextList);
    const msg = `chore(registry): ${action} admin ${email}`;
    await putFile(REGISTRY_ADMINS_PATH, out, msg, sha);

    const emails = await resolveRegistryAdminEmails();
    return NextResponse.json({
      ok: true,
      emails,
      delegatedEmails: nextList,
    });
  } catch (err) {
    console.error("[registry-admins]", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
