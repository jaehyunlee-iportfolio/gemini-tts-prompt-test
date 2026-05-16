/**
 * 청크 경로(`finishFromChunks`)로 받은 TTS 오디오 Blob을 브라우저 IndexedDB에 보관.
 *
 * Spindle SSE가 audioUrl 대신 base64 청크만 보내면 `URL.createObjectURL` 결과 blob: URL은
 * 같은 문서 세션에서만 유효하다. Firestore에도 영구 URL이 없으므로 새로고침 후 오디오가
 * 사라지는 문제가 발생한다. 청크 완료 시 Blob을 IndexedDB에 저장하고, history 로드 시
 * 다시 객체 URL을 만들어 붙여 영속성을 확보한다.
 *
 * 같은 브라우저 한정. 다른 기기 동기화는 별도 인프라(예: Firebase Storage)가 필요하다.
 */

const DB_NAME = "gemini-tts-audio-cache";
const DB_VERSION = 1;
const STORE = "audio";

type CachedAudio = { blob: Blob; mimeType: string; createdAt: number };

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export function audioCacheKey(runId: string, slotIndex: number | null): string {
  return slotIndex == null ? runId : `${runId}:${slotIndex}`;
}

export async function putAudio(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const payload: CachedAudio = {
        blob,
        mimeType: blob.type || "audio/mp3",
        createdAt: Date.now(),
      };
      tx.objectStore(STORE).put(payload, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function getAudio(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as CachedAudio | undefined;
        resolve(v?.blob ?? null);
      };
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function deleteAudiosForRun(runId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const key = String(cursor.key);
        if (key === runId || key.startsWith(`${runId}:`)) {
          store.delete(cursor.key);
        }
        cursor.continue();
      };
      req.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function clearAllAudios(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
