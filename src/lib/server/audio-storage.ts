import { Buffer } from "node:buffer";
import { getStorage } from "firebase-admin/storage";
import { getFirebaseApp } from "./firebase-admin";

const BUCKET_ENV = "FIREBASE_STORAGE_BUCKET";

export function getAudioBucketName(): string | null {
  const v = process.env[BUCKET_ENV]?.trim();
  return v && v.length > 0 ? v : null;
}

export function isAudioStorageConfigured(): boolean {
  return Boolean(getAudioBucketName() && getFirebaseApp());
}

function emailToSegment(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
}

function extensionForContentType(ct: string): string {
  const v = ct.toLowerCase();
  if (v.includes("wav")) return "wav";
  if (v.includes("mpeg") || v.includes("mp3")) return "mp3";
  if (v.includes("ogg")) return "ogg";
  if (v.includes("webm")) return "webm";
  if (v.includes("aac")) return "aac";
  return "bin";
}

export type AudioUploadInput = {
  bytes: Buffer | Uint8Array;
  contentType: string;
  ownerEmail: string;
  runId: string;
  slotIndex?: number | null;
};

export type AudioUploadResult = {
  /** Stable proxy URL playable from the browser (`/api/audio/...`). */
  url: string;
  /** Object path inside the bucket. */
  path: string;
  contentType: string;
};

/**
 * Persist a TTS audio blob to Firebase Cloud Storage and return a stable proxy
 * URL the client can put into a `<audio src>` (and Firestore).
 */
export async function uploadAudioToStorage(
  input: AudioUploadInput,
): Promise<AudioUploadResult> {
  const app = getFirebaseApp();
  const bucketName = getAudioBucketName();
  if (!app || !bucketName) {
    throw new Error("Audio storage is not configured");
  }
  if (!input.ownerEmail || !input.runId) {
    throw new Error("ownerEmail and runId are required");
  }

  const ext = extensionForContentType(input.contentType);
  const slotPart =
    input.slotIndex == null || !Number.isFinite(input.slotIndex)
      ? "single"
      : String(input.slotIndex);
  const path = `users/${emailToSegment(input.ownerEmail)}/runs/${input.runId}/${slotPart}.${ext}`;

  const bucket = getStorage(app).bucket(bucketName);
  await bucket.file(path).save(Buffer.from(input.bytes), {
    contentType: input.contentType,
    resumable: false,
    metadata: { cacheControl: "private, max-age=86400" },
  });

  return {
    url: `/api/audio/${path.split("/").map(encodeURIComponent).join("/")}`,
    path,
    contentType: input.contentType,
  };
}

/**
 * Verify that a given object path belongs to the given user email.
 * Used by the `/api/audio` proxy before streaming bytes back.
 */
export function pathBelongsToEmail(path: string, email: string): boolean {
  const expected = `users/${emailToSegment(email)}/`;
  return path.startsWith(expected);
}

export async function downloadAudioFromStorage(path: string): Promise<{
  bytes: Buffer;
  contentType: string;
} | null> {
  const app = getFirebaseApp();
  const bucketName = getAudioBucketName();
  if (!app || !bucketName) return null;
  const file = getStorage(app).bucket(bucketName).file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  const [buf] = await file.download();
  const ct =
    (typeof meta.contentType === "string" && meta.contentType) || "audio/mpeg";
  return { bytes: buf, contentType: ct };
}
