import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { Buffer } from "node:buffer";
import type { QaVerdict } from "@/lib/text-similarity";
import {
  STYLE_TONES,
  VOICE_IDS,
  type StyleTone,
  type TtsBulkSlot,
  type TtsRun,
  type TtsRunQa,
  type TtsRunQaStatus,
  type TtsRunStatus,
  type VoiceId,
} from "@/types/tts";

const COLLECTION = "userTtsHistories";
const MAX_RUNS_PER_USER = 80;

export function historyDocIdForEmail(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
}

function stripBlobFields<T extends { blobUrl?: string; playUrl?: string }>(o: T): T {
  const { blobUrl: _omitBlob, ...rest } = o;
  void _omitBlob;
  return rest as T;
}

/** 저장 시점에 검증이 진행 중이던 항목은 새로고침 후 hang되지 않도록 상태만 비움 */
function normalizeQaForPersistence<T extends TtsRunQa>(o: T): T {
  if (o.qaStatus !== "running") return o;
  return { ...o, qaStatus: undefined };
}

/** Firestore는 필드 값으로 `undefined`를 허용하지 않음 */
function stripUndefinedForFirestore(input: unknown): unknown {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => stripUndefinedForFirestore(item));
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedForFirestore(v);
  }
  return out;
}

/** Firestore에는 blob URL을 넣지 않음(재시작 시 무효). playUrl(프록시)만 유지 */
export function serializeRunsForFirestore(runs: TtsRun[]): Record<string, unknown>[] {
  return runs.map((r) => {
    const base = normalizeQaForPersistence(stripBlobFields({ ...r }));
    if (base.bulkSlots?.length) {
      base.bulkSlots = base.bulkSlots.map((s) =>
        normalizeQaForPersistence(stripBlobFields({ ...s })),
      );
    }
    return stripUndefinedForFirestore(base) as Record<string, unknown>;
  });
}

function isVoiceId(v: unknown): v is VoiceId {
  return typeof v === "string" && (VOICE_IDS as readonly string[]).includes(v);
}

function isStyleTone(v: unknown): v is StyleTone {
  return typeof v === "string" && (STYLE_TONES as readonly string[]).includes(v);
}

function isStatus(v: unknown): v is TtsRunStatus {
  return v === "loading" || v === "success" || v === "error";
}

function isQaStatus(v: unknown): v is TtsRunQaStatus {
  return v === "running" || v === "done" || v === "error";
}

function isQaVerdict(v: unknown): v is QaVerdict {
  return v === "pass" || v === "review" || v === "fail";
}

function pickQaFields(s: Record<string, unknown>): TtsRunQa {
  const rawStatus = isQaStatus(s.qaStatus) ? s.qaStatus : undefined;
  // 새로고침 직후 hang 방지: persisted "running"은 미정 상태로 다시 시작
  const qaStatus = rawStatus === "running" ? undefined : rawStatus;
  return {
    qaStatus,
    transcript: typeof s.transcript === "string" ? s.transcript : undefined,
    qaScore: typeof s.qaScore === "number" ? s.qaScore : undefined,
    qaVerdict: isQaVerdict(s.qaVerdict) ? s.qaVerdict : undefined,
    qaError: typeof s.qaError === "string" ? s.qaError : undefined,
  };
}

function parseBulkSlot(o: unknown): TtsBulkSlot | null {
  if (!o || typeof o !== "object") return null;
  const s = o as Record<string, unknown>;
  if (!isStatus(s.status)) return null;
  const slot: TtsBulkSlot = {
    status: s.status,
    statusMessage: typeof s.statusMessage === "string" ? s.statusMessage : undefined,
    playUrl: typeof s.playUrl === "string" ? s.playUrl : undefined,
    meta:
      s.meta && typeof s.meta === "object"
        ? (s.meta as TtsBulkSlot["meta"])
        : undefined,
    ...pickQaFields(s),
  };
  return slot;
}

export function parsePersistedRun(o: unknown): TtsRun | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.createdAt !== "number") return null;
  if (typeof r.bundleName !== "string" || typeof r.originalText !== "string") return null;
  if (typeof r.prompt !== "string") return null;
  if (!isVoiceId(r.voice) || !isStyleTone(r.style)) return null;
  if (!isStatus(r.status)) return null;

  const run: TtsRun = {
    id: r.id,
    createdAt: r.createdAt,
    bundleName: r.bundleName,
    voice: r.voice,
    style: r.style,
    originalText: r.originalText,
    prompt: r.prompt,
    status: r.status,
    statusMessage: typeof r.statusMessage === "string" ? r.statusMessage : undefined,
    playUrl: typeof r.playUrl === "string" ? r.playUrl : undefined,
    meta: r.meta && typeof r.meta === "object" ? (r.meta as TtsRun["meta"]) : undefined,
    bulkCount: typeof r.bulkCount === "number" ? r.bulkCount : undefined,
    ...pickQaFields(r),
  };

  if (Array.isArray(r.bulkSlots)) {
    const slots = r.bulkSlots.map(parseBulkSlot).filter((x): x is TtsBulkSlot => x != null);
    if (slots.length) run.bulkSlots = slots;
  }

  return run;
}

export function parsePersistedRuns(data: unknown): TtsRun[] {
  if (!Array.isArray(data)) return [];
  return data.map(parsePersistedRun).filter((x): x is TtsRun => x != null);
}

export async function loadUserRuns(
  db: Firestore,
  email: string,
): Promise<{ runs: TtsRun[]; updatedAtMs: number | null }> {
  const snap = await db.collection(COLLECTION).doc(historyDocIdForEmail(email)).get();
  if (!snap.exists) return { runs: [], updatedAtMs: null };
  const d = snap.data();
  const runs = parsePersistedRuns(d?.runs);
  const updated = d?.updatedAt;
  let updatedAtMs: number | null = null;
  if (updated && typeof (updated as { toMillis?: () => number }).toMillis === "function") {
    updatedAtMs = (updated as { toMillis: () => number }).toMillis();
  }
  return { runs, updatedAtMs };
}

export async function saveUserRuns(db: Firestore, email: string, runs: TtsRun[]): Promise<void> {
  const trimmed = runs.slice(0, MAX_RUNS_PER_USER);
  const payload = serializeRunsForFirestore(trimmed);
  await db.collection(COLLECTION).doc(historyDocIdForEmail(email)).set(
    {
      ownerEmail: email.trim().toLowerCase(),
      runs: payload,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearUserRuns(db: Firestore, email: string): Promise<void> {
  await db.collection(COLLECTION).doc(historyDocIdForEmail(email)).set(
    {
      ownerEmail: email.trim().toLowerCase(),
      runs: [],
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
