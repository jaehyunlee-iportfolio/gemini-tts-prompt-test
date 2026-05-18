import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  downloadAudioFromStorage,
  isAudioStorageConfigured,
  pathBelongsToEmail,
} from "@/lib/server/audio-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Stream a TTS audio object stored under `users/<emailSeg>/runs/<runId>/<slot>.<ext>`.
 * Auth-gated: only the owner (matched by email segment in the path) can read.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
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

  const { path: parts } = await context.params;
  if (!Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  const path = parts.map((p) => decodeURIComponent(p)).join("/");

  if (!pathBelongsToEmail(path, email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await downloadAudioFromStorage(path);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[audio] GET", e);
    const message = e instanceof Error ? e.message : "download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
