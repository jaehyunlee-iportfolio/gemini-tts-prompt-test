import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | null = null;

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
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
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
    process.env.FIREBASE_PROJECT_ID?.trim() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      resolvePrivateKey(),
  );
}
