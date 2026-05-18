import { Buffer } from "node:buffer";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  isAudioStorageConfigured,
  uploadAudioToStorage,
} from "@/lib/server/audio-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_UPSTREAM_HOSTS = new Set([
  "speech-tts-contents-stage.spindlebooks.com",
  "speech-tts-contents.spindlebooks.com",
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MiB safety cap

function parseSlotIndex(raw: string | null): number | null {
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isAcceptableContentType(ct: string): boolean {
  const v = ct.toLowerCase();
  return v.startsWith("audio/") || v === "application/octet-stream";
}

/**
 * Persist TTS audio to durable storage and return a stable proxy URL.
 *
 * Two modes:
 * 1. **Binary upload** — `Content-Type: audio/*` (or `application/octet-stream`)
 *    with query params `runId`, `slotIndex?`, `contentType?` (overrides header).
 *    Used by SSE chunk-fallback (client merges chunks then POSTs the bytes).
 * 2. **From upstream URL** — `Content-Type: application/json` with body
 *    `{ upstreamUrl, runId, slotIndex? }`. Server fetches the audio with the
 *    upstream auth token and uploads. Used by Spindle SSE `finishFromUrl`.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAudioStorageConfigured()) {
    return NextResponse.json(
      { error: "Audio storage is not configured" },
      { status: 503 },
    );
  }

  const headerCt = req.headers.get("content-type") ?? "";

  if (headerCt.toLowerCase().startsWith("application/json")) {
    return handleFromUrl(req, email);
  }
  return handleBinary(req, email, headerCt);
}

async function handleBinary(req: NextRequest, email: string, headerCt: string) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  const slotIndex = parseSlotIndex(req.nextUrl.searchParams.get("slotIndex"));
  const ctOverride = req.nextUrl.searchParams.get("contentType");
  const contentType =
    (ctOverride && ctOverride.length > 0 ? ctOverride : headerCt) || "audio/mpeg";
  if (!isAcceptableContentType(contentType)) {
    return NextResponse.json(
      { error: `Unsupported content type: ${contentType}` },
      { status: 415 },
    );
  }

  let buf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    if (ab.byteLength === 0) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    if (ab.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    buf = Buffer.from(ab);
  } catch (e) {
    const message = e instanceof Error ? e.message : "read failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await uploadAudioToStorage({
      bytes: buf,
      contentType,
      ownerEmail: email,
      runId,
      slotIndex,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[tts-upload] binary", e);
    const message = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type FromUrlBody = {
  upstreamUrl?: unknown;
  runId?: unknown;
  slotIndex?: unknown;
};

async function handleFromUrl(req: NextRequest, email: string) {
  let body: FromUrlBody;
  try {
    body = (await req.json()) as FromUrlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const upstreamUrl = typeof body.upstreamUrl === "string" ? body.upstreamUrl : "";
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!upstreamUrl || !runId) {
    return NextResponse.json(
      { error: "upstreamUrl and runId are required" },
      { status: 400 },
    );
  }
  const slotIndex =
    typeof body.slotIndex === "number" && Number.isFinite(body.slotIndex)
      ? body.slotIndex
      : null;

  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    return NextResponse.json({ error: "invalid upstreamUrl" }, { status: 400 });
  }
  if (!ALLOWED_UPSTREAM_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: "upstream host not allowed" },
      { status: 400 },
    );
  }

  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: "TTS_AUTH_TOKEN is not configured" },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        "X-SS-Authorization": AUTH_TOKEN,
        "User-Agent": "gemin-tts-prompt-test/1.0",
        Accept: "audio/mpeg,audio/*,*/*",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "upstream fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: text || upstream.statusText },
      { status: upstream.status },
    );
  }
  const ab = await upstream.arrayBuffer();
  if (ab.byteLength === 0) {
    return NextResponse.json({ error: "upstream returned empty body" }, { status: 502 });
  }
  if (ab.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "upstream payload too large" }, { status: 413 });
  }
  const contentType = upstream.headers.get("content-type") || "audio/mpeg";

  try {
    const result = await uploadAudioToStorage({
      bytes: Buffer.from(ab),
      contentType,
      ownerEmail: email,
      runId,
      slotIndex,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[tts-upload] from-url", e);
    const message = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
