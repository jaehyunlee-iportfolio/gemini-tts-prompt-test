const API_BASE = "/api";

function createAbortError() {
  return new DOMException("요청이 중지되었습니다.", "AbortError");
}

export function parseSseDataLines(text: string) {
  const audioUrlFromCreated: string[] = [];
  const legacyAudioChunks: Uint8Array[] = [];

  const flushEvent = (eventName: string, dataLines: string[]) => {
    if (!dataLines.length) return;
    const payload = dataLines.join("\n");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }

    if (eventName === "created" || parsed.eventType === "created") {
      if (typeof parsed.audioUrl === "string") audioUrlFromCreated.push(parsed.audioUrl);
      return;
    }

    if (eventName === "chunk" && parsed.eventType === "chunk" && parsed.data) {
      try {
        const binaryStr = atob(String(parsed.data));
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        legacyAudioChunks.push(bytes);
      } catch {
        /* ignore */
      }
      return;
    }

    if (typeof parsed.audioUrl === "string") {
      audioUrlFromCreated.push(parsed.audioUrl);
      return;
    }

    if (parsed.audio) {
      try {
        const binaryStr = atob(String(parsed.audio));
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        legacyAudioChunks.push(bytes);
      } catch {
        /* ignore */
      }
    }
  };

  let currentEvent = "message";
  let dataLines: string[] = [];

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("event:")) {
      if (dataLines.length) flushEvent(currentEvent, dataLines);
      dataLines = [];
      currentEvent = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
    if (line === "") {
      if (dataLines.length) flushEvent(currentEvent, dataLines);
      dataLines = [];
      currentEvent = "message";
    }
  }
  if (dataLines.length) flushEvent(currentEvent, dataLines);

  return {
    audioUrl: audioUrlFromCreated[audioUrlFromCreated.length - 1] || null,
    legacyAudioChunks,
  };
}

function tryParseCreated(payload: string) {
  let audioUrl: string | null = null;
  let meta: Record<string, unknown> | null = null;
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    if (data && typeof data.audioUrl === "string") {
      audioUrl = data.audioUrl;
      meta = data;
    }
  } catch {
    /* ignore */
  }
  return { audioUrl, meta };
}

export async function streamTtsSse(
  sseId: string,
  handlers: {
    onLoading: (message: string) => void;
    finishFromUrl: (upstreamAudioUrl: string, meta: Record<string, unknown> | null) => void;
    finishFromChunks: (chunks: Uint8Array[]) => void;
    onError: (message: string) => void;
  },
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const signal = options?.signal;
  if (signal?.aborted) throw createAbortError();

  const legacyChunks: Uint8Array[] = [];
  let finalized = false;

  const tryFinalizeFromCreated = (payload: string) => {
    const { audioUrl, meta } = tryParseCreated(payload);
    if (!audioUrl) return false;
    finalized = true;
    handlers.finishFromUrl(audioUrl, meta);
    return true;
  };

  await new Promise<void>((resolve, reject) => {
    const url = `${API_BASE}/tts-stream?sseId=${encodeURIComponent(sseId)}`;
    const eventSource = new EventSource(url);
    let closed = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal) signal.removeEventListener("abort", onAbort);
      eventSource.close();
    };

    const safeResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const safeReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      safeReject(createAbortError());
    };

    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    eventSource.onopen = () => {
      handlers.onLoading("스트림 연결됨, 완성 MP3 URL 대기 중...");
    };

    eventSource.addEventListener("session", () => {
      handlers.onLoading("세션 수신, 생성 중...");
    });

    eventSource.addEventListener("created", (event) => {
      if (tryFinalizeFromCreated(event.data)) {
        safeResolve();
      }
    });

    eventSource.addEventListener("chunk", (event) => {
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>;
        if (parsed && parsed.eventType === "chunk" && parsed.data) {
          const binaryStr = atob(String(parsed.data));
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          legacyChunks.push(bytes);
        }
      } catch {
        /* ignore */
      }
    });

    eventSource.addEventListener("audio", (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.audio) {
          const binaryStr = atob(String(data.audio));
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          legacyChunks.push(bytes);
        }
      } catch {
        if (event.data) {
          try {
            const binaryStr = atob(event.data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            legacyChunks.push(bytes);
          } catch {
            /* ignore */
          }
        }
      }
    });

    const onStreamEnd = () => {
      if (settled) return;
      if (finalized) {
        safeResolve();
        return;
      }
      if (legacyChunks.length > 0) {
        finalized = true;
        handlers.finishFromChunks(legacyChunks);
        safeResolve();
        return;
      }
      finalized = true;
      void fallbackFetch(sseId, handlers, signal)
        .then(() => safeResolve())
        .catch((error) => safeReject(error));
    };

    eventSource.addEventListener("complete", onStreamEnd);
    eventSource.addEventListener("done", onStreamEnd);
    eventSource.addEventListener("end", onStreamEnd);

    eventSource.addEventListener("error", () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        if (!finalized) onStreamEnd();
      }
    });

    eventSource.onerror = () => {
      if (!finalized) onStreamEnd();
    };

    timeoutId = setTimeout(() => {
      if (!finalized) {
        onStreamEnd();
      }
    }, 30000);
  });
}

async function fallbackFetch(
  sseId: string,
  handlers: {
    onLoading: (message: string) => void;
    finishFromUrl: (upstreamAudioUrl: string, meta: Record<string, unknown> | null) => void;
    finishFromChunks: (chunks: Uint8Array[]) => void;
    onError: (message: string) => void;
  },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw createAbortError();
  handlers.onLoading("SSE 재수신(fetch)로 파싱 중...");
  try {
    const resp = await fetch(`${API_BASE}/tts-stream?sseId=${encodeURIComponent(sseId)}`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });

    if (!resp.ok) throw new Error(`Stream fetch failed: ${resp.status}`);

    const text = await resp.text();
    const { audioUrl, legacyAudioChunks } = parseSseDataLines(text);

    if (audioUrl) {
      handlers.finishFromUrl(audioUrl, null);
      return;
    }
    if (legacyAudioChunks.length > 0) {
      handlers.finishFromChunks(legacyAudioChunks);
      return;
    }
    handlers.onError("created 이벤트의 audioUrl을 찾지 못했습니다.");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    handlers.onError(`Fallback 실패: ${message}`);
  }
}

export function proxyPlayUrl(upstreamAudioUrl: string) {
  return `${API_BASE}/tts-audio?url=${encodeURIComponent(upstreamAudioUrl)}`;
}
