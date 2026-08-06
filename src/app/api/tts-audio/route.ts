import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set([
  "speech-tts-contents-stage.spindlebooks.com",
  "speech-tts-contents.spindlebooks.com",
]);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw || typeof raw !== "string") {
    return NextResponse.json(
      { error: "url query parameter is required" },
      { status: 400 },
    );
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(raw);
  } catch {
    targetUrl = raw;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (!ALLOWED.has(parsed.hostname)) {
    return NextResponse.json({ error: "url host not allowed" }, { status: 400 });
  }

  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: "TTS_AUTH_TOKEN is not configured" },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "X-SS-Authorization": AUTH_TOKEN,
        "User-Agent": "gemin-tts-prompt-test/1.0",
        Accept: "audio/mpeg,audio/*,*/*",
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    const ct = upstream.headers.get("content-type") || "audio/mpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    const total = buf.length;

    /**
     * Content-Length와 Range를 반드시 실어 준다.
     * 없으면 응답이 chunked로 나가고, mp3 헤더에 길이 정보(Xing/Info)가 없는 프로바이더
     * (Azure 등)에서 브라우저 audio.duration이 Infinity가 되어 실측 SPM이 표시되지 않는다.
     * Range를 지원하면 탐색(seek)도 정상 동작한다.
     */
    const baseHeaders: Record<string, string> = {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=300",
      "Accept-Ranges": "bytes",
    };

    const rangeHeader = req.headers.get("range");
    const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
    if (match) {
      const startRaw = match[1];
      const endRaw = match[2];
      let start: number;
      let end: number;
      if (startRaw === "") {
        // 마지막 N바이트 요청 (suffix range)
        const suffix = Number(endRaw);
        if (!Number.isFinite(suffix) || suffix <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
          });
        }
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = Number(startRaw);
        end = endRaw === "" ? total - 1 : Number(endRaw);
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
        });
      }
      end = Math.min(end, total - 1);
      const chunk = buf.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunk.length),
        },
      });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
