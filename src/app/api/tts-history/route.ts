import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFirestoreDb, isFirebaseHistoryConfigured } from "@/lib/server/firebase-admin";
import {
  clearUserRuns,
  loadUserRuns,
  parsePersistedRuns,
  saveUserRuns,
} from "@/lib/server/tts-history";
export const runtime = "nodejs";
export const maxDuration = 30;

function requireEmail(session: Session | null): string | null {
  const email = session?.user?.email?.trim().toLowerCase();
  return email || null;
}

export async function GET() {
  const session = await auth();
  const email = requireEmail(session);
  if (!email) {
    return NextResponse.json({ runs: [], cloudSync: false, reason: "no-session" });
  }
  if (!isFirebaseHistoryConfigured()) {
    return NextResponse.json({ runs: [], cloudSync: false, reason: "not-configured" });
  }
  const db = getFirestoreDb();
  if (!db) {
    return NextResponse.json({ runs: [], cloudSync: false, reason: "init-failed" });
  }
  try {
    const { runs, updatedAtMs } = await loadUserRuns(db, email);
    return NextResponse.json({ runs, cloudSync: true, updatedAtMs });
  } catch (e) {
    console.error("[tts-history] GET", e);
    const message = e instanceof Error ? e.message : "load failed";
    return NextResponse.json({ runs: [], cloudSync: false, reason: message }, { status: 500 });
  }
}

type PutBody = { runs?: unknown };

export async function PUT(req: Request) {
  const session = await auth();
  const email = requireEmail(session);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isFirebaseHistoryConfigured()) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 503 });
  }
  const db = getFirestoreDb();
  if (!db) {
    return NextResponse.json({ error: "Firebase init failed" }, { status: 503 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.runs)) {
    return NextResponse.json({ error: "runs array required" }, { status: 400 });
  }

  const runs = parsePersistedRuns(body.runs);
  try {
    await saveUserRuns(db, email, runs);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[tts-history] PUT", e);
    const message = e instanceof Error ? e.message : "save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await auth();
  const email = requireEmail(session);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isFirebaseHistoryConfigured()) {
    return NextResponse.json({ ok: true, cleared: false });
  }
  const db = getFirestoreDb();
  if (!db) {
    return NextResponse.json({ error: "Firebase init failed" }, { status: 503 });
  }
  try {
    await clearUserRuns(db, email);
    return NextResponse.json({ ok: true, cleared: true });
  } catch (e) {
    console.error("[tts-history] DELETE", e);
    const message = e instanceof Error ? e.message : "clear failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
