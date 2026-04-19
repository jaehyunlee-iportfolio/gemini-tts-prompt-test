import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | null = null;

/** Vercel 등에서 project_id를 실수로 두 번 붙여 넣은 경우(abcabc) 한 번만 사용 */
export function normalizeFirebaseProjectId(raw: string | undefined): string {
  const id = (raw ?? "").trim();
  if (id.length >= 4 && id.length % 2 === 0) {
    const half = id.length / 2;
    const a = id.slice(0, half);
    const b = id.slice(half);
    if (a === b) return a;
  }
  return id;
}

function resolvePrivateKey(): string | undefined {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return undefined;
  return raw.replace(/\\n/g, "\n");
}

/** Firebase Admin이 설정되어 있으면 초기화된 앱, 아니면 null */
export function getFirebaseApp(): App | null {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  const projectId = normalizeFirebaseProjectId(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = resolvePrivateKey();
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }
  try {
    app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    return app;
  } catch (e) {
    console.error("[firebase-admin] init failed:", e);
    return null;
  }
}

export function getFirestoreDb(): Firestore | null {
  const a = getFirebaseApp();
  if (!a) return null;
  return getFirestore(a);
}

export function isFirebaseHistoryConfigured(): boolean {
  return Boolean(
    normalizeFirebaseProjectId(process.env.FIREBASE_PROJECT_ID) &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      resolvePrivateKey(),
  );
}
