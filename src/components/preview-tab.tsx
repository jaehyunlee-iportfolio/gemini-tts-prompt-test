"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { listBundlePresets } from "@/lib/bundle-presets";
import { PREVIEW_EXAMPLE_PROMPTS, PREVIEW_EXAMPLE_TEXTS } from "@/lib/preview-examples";
import { proxyPlayUrl, streamTtsSse } from "@/lib/tts-sse";
import { cn } from "@/lib/utils";
import { bundleNameFromVoiceStyle, type StyleTone, type VoiceId } from "@/types/tts";
import type { PromptRegistryJson } from "@/types/registry";
import { Loader2, Volume2 } from "lucide-react";

const API_BASE = "/api";
const MAX_RESULTS = 5;
const DEFAULT_TEXT = "Hello! My name is Erin. What's your name?";

type PreviewVoice = {
  id: Exclude<VoiceId, "ZephyrDefault">;
  label: string;
  caption: string;
  legacyName: string;
};

const PREVIEW_VOICES: ReadonlyArray<PreviewVoice> = [
  { id: "Rasalgethi", label: "Rasalgethi", caption: "남자 아이 · Voice 1", legacyName: "Jeremy" },
  { id: "Puck", label: "Puck", caption: "남자 아이 · Voice 2", legacyName: "Kevin" },
  { id: "Fenrir", label: "Fenrir", caption: "남자 아이 · Voice 3", legacyName: "Justin" },
  { id: "Sulafat", label: "Sulafat", caption: "여자 성인 · LAURA 기본", legacyName: "Jenny" },
];

const PREVIEW_STYLES: ReadonlyArray<{ id: StyleTone; label: string; korean: string }> = [
  { id: "Default", label: "Default", korean: "평소" },
  { id: "Cheerful", label: "Cheerful", korean: "밝게" },
  { id: "Gentle", label: "Gentle", korean: "부드럽게" },
];

type PreviewStatus = "loading" | "success" | "error";

type PreviewResult = {
  id: string;
  createdAt: number;
  voice: VoiceId;
  style: StyleTone;
  text: string;
  prompt: string;
  status: PreviewStatus;
  message?: string;
  playUrl?: string;
  blobUrl?: string;
};

function revokeBlob(r: PreviewResult) {
  if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
}

export function PreviewTab() {
  const [voice, setVoice] = useState<VoiceId>("Rasalgethi");
  const [style, setStyle] = useState<StyleTone>("Default");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [prompt, setPrompt] = useState("");
  const [promptMode, setPromptMode] = useState<"default" | "custom">("default");
  const [registry, setRegistry] = useState<PromptRegistryJson | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [results, setResults] = useState<PreviewResult[]>([]);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/prompt-registry`);
        if (!res.ok) {
          const raw = await res.text();
          throw new Error(raw || res.statusText);
        }
        const reg = (await res.json()) as PromptRegistryJson;
        if (!cancelled) setRegistry(reg);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setRegistryError(
          `기본 프롬프트를 불러오지 못했습니다 (${msg}). "직접 작성" 또는 예시 프롬프트로 시도해주세요.`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultPrompt = useMemo(() => {
    if (!registry) return "";
    const presets = listBundlePresets(registry, voice, style);
    return presets[0]?.long ?? "";
  }, [registry, voice, style]);

  useEffect(() => {
    if (promptMode === "default") setPrompt(defaultPrompt);
  }, [defaultPrompt, promptMode]);

  const bundleName = useMemo(() => bundleNameFromVoiceStyle(voice, style), [voice, style]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      for (const r of resultsRef.current) revokeBlob(r);
    };
  }, []);

  const trimResults = useCallback((next: PreviewResult[]) => {
    if (next.length <= MAX_RESULTS) return next;
    const dropped = next.slice(MAX_RESULTS);
    for (const r of dropped) revokeBlob(r);
    return next.slice(0, MAX_RESULTS);
  }, []);

  const onPickExamplePrompt = useCallback((body: string) => {
    setPromptMode("custom");
    setPrompt(body);
  }, []);

  const onPickExampleText = useCallback((value: string) => {
    setText(value);
  }, []);

  const onResetToDefaultPrompt = useCallback(() => {
    setPromptMode("default");
    setPrompt(defaultPrompt);
  }, [defaultPrompt]);

  const onPromptChange = useCallback((value: string) => {
    setPromptMode("custom");
    setPrompt(value);
  }, []);

  const generate = useCallback(async () => {
    if (generating) return;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const abort = new AbortController();
    abortRef.current = abort;

    const id = crypto.randomUUID();
    const now = Date.now();
    const initial: PreviewResult = {
      id,
      createdAt: now,
      voice,
      style,
      text: trimmedText,
      prompt,
      status: "loading",
      message: "SSE 연결 대기 중...",
    };
    setResults((prev) => trimResults([initial, ...prev]));
    setGenerating(true);

    const updateResult = (patch: Partial<PreviewResult>) => {
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    try {
      const startResp = await fetch(`${API_BASE}/tts-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          text: trimmedText,
          cacheBust: true,
          bundleName,
          viseme: false,
          prompt,
          platform: "PLAYGROUND",
          userId: 2,
        }),
      });
      if (!startResp.ok) {
        const t = await startResp.text();
        throw new Error(`tts-start failed (${startResp.status}): ${t}`);
      }
      const startData = (await startResp.json()) as Record<string, unknown>;
      const sseId = (startData.sseId || startData.id || startData.streamId) as
        | string
        | undefined;
      if (!sseId) throw new Error("sseId가 응답에 없습니다.");

      updateResult({ message: `SSE 수신 중 (ID: ${sseId})...` });

      await streamTtsSse(
        sseId,
        {
          onLoading: (msg) => updateResult({ message: msg }),
          finishFromUrl: (upstreamUrl) => {
            updateResult({
              status: "success",
              playUrl: proxyPlayUrl(upstreamUrl),
              blobUrl: undefined,
              message: undefined,
            });
          },
          finishFromChunks: (chunks) => {
            if (chunks.length === 0) {
              updateResult({ status: "error", message: "오디오 데이터가 비어있습니다." });
              return;
            }
            const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            const blobUrl = URL.createObjectURL(
              new Blob([new Uint8Array(merged)], { type: "audio/mp3" }),
            );
            updateResult({ status: "success", blobUrl, playUrl: undefined, message: undefined });
          },
          onError: (msg) => updateResult({ status: "error", message: msg }),
        },
        { signal: abort.signal },
      );
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const message = isAbort
        ? "요청이 중지되었습니다."
        : err instanceof Error
          ? err.message
          : String(err);
      updateResult({ status: "error", message });
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setGenerating(false);
    }
  }, [generating, text, voice, style, prompt, bundleName, trimResults]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const latest = results[0] ?? null;
  const earlier = results.slice(1);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
            <CardTitle className="text-lg sm:text-xl">새 보이스 4종 체험</CardTitle>
            <CardDescription className="text-xs leading-relaxed sm:text-sm">
              보이스와 스타일을 고른 뒤, 예시 프롬프트와 문장을 그대로 쓰거나 직접 작성해서
              음성을 만들어 들어보세요. 결과는 새로고침 시 사라집니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
            {registryError ? (
              <Alert variant="destructive" className="text-sm">
                <AlertDescription className="text-xs sm:text-sm">{registryError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label className="text-sm">보이스</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PREVIEW_VOICES.map((v) => {
                  const active = v.id === voice;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVoice(v.id)}
                      className={cn(
                        "flex min-h-[3.5rem] touch-manipulation flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors active:scale-[0.99]",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      <span className="text-sm font-semibold text-foreground">{v.label}</span>
                      <span className="text-[10px] leading-tight sm:text-[11px]">
                        {v.caption} · 이전 {v.legacyName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">스타일</Label>
              <div className="grid grid-cols-3 gap-2">
                {PREVIEW_STYLES.map((s) => {
                  const active = s.id === style;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyle(s.id)}
                      className={cn(
                        "flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 transition-colors active:scale-[0.99]",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      <span className="text-sm font-semibold text-foreground">{s.label}</span>
                      <span className="text-[10px] leading-tight">{s.korean}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:text-xs">
                <span>API bundleName</span>
                <Badge variant="outline" className="break-all font-mono text-[10px]">
                  {bundleName}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preview-text" className="text-sm">
                발화 문장 (영어)
              </Label>
              <Textarea
                id="preview-text"
                rows={2}
                className="min-h-[4.5rem] resize-y text-sm sm:text-base"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {PREVIEW_EXAMPLE_TEXTS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onPickExampleText(t)}
                    className="touch-manipulation rounded-full border border-dashed border-border bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:text-xs"
                  >
                    {t.length > 36 ? `${t.slice(0, 34)}…` : t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="preview-prompt" className="text-sm">
                  프롬프트 (한국어 가이드)
                </Label>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant={promptMode === "default" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {promptMode === "default" ? "기본 프롬프트" : "직접 작성"}
                  </Badge>
                  {promptMode === "custom" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] sm:text-xs"
                      onClick={onResetToDefaultPrompt}
                      disabled={!defaultPrompt}
                    >
                      기본값으로
                    </Button>
                  ) : null}
                </div>
              </div>
              <Textarea
                id="preview-prompt"
                rows={6}
                className="min-h-[8rem] resize-y font-mono text-xs leading-relaxed sm:text-sm"
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder={
                  defaultPrompt
                    ? "보이스 · 스타일 조합의 기본 프롬프트가 자동으로 채워집니다. 직접 고쳐도 좋아요."
                    : "예시 프롬프트를 골라보거나 자유롭게 적어보세요."
                }
              />
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground sm:text-xs">예시 프롬프트</p>
                <div className="flex flex-wrap gap-1.5">
                  {PREVIEW_EXAMPLE_PROMPTS.map((p) => (
                    <Tooltip key={p.title}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onPickExamplePrompt(p.body)}
                          className="touch-manipulation rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:text-xs"
                        >
                          {p.title}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[min(90vw,22rem)] sm:max-w-md"
                      >
                        <p className="text-xs leading-relaxed">{p.body}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="h-12 w-full touch-manipulation text-base sm:h-11 sm:text-sm"
                size="lg"
                onClick={() => void generate()}
                disabled={generating || !text.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    생성 중...
                  </>
                ) : (
                  "음성 생성"
                )}
              </Button>
              {generating ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="h-12 w-full touch-manipulation sm:h-11 sm:w-auto sm:px-5"
                  onClick={stopGeneration}
                >
                  중지
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
            <CardTitle className="text-lg sm:text-xl">결과</CardTitle>
            <CardDescription className="text-xs leading-relaxed sm:text-sm">
              최근 {MAX_RESULTS}건만 메모리에 보관됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
            {latest ? (
              <ResultCard result={latest} prominent />
            ) : (
              <div className="flex min-h-[10rem] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/15 px-4 py-8 text-center text-muted-foreground">
                <Volume2 className="h-8 w-8 opacity-40" />
                <p className="text-xs sm:text-sm">
                  아직 결과가 없어요. 왼쪽에서 보이스를 골라 음성을 만들어보세요.
                </p>
              </div>
            )}
            {earlier.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
                  이전 결과
                </p>
                <div className="space-y-2">
                  {earlier.map((r) => (
                    <ResultCard key={r.id} result={r} />
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function ResultCard({
  result,
  prominent = false,
}: {
  result: PreviewResult;
  prominent?: boolean;
}) {
  const src = result.playUrl ?? result.blobUrl;
  const downloadName = `preview-${result.voice}-${result.style}-${result.id.slice(0, 8)}.mp3`;
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-background/40 p-3 sm:p-4",
        prominent ? "border-primary/50 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={prominent ? "default" : "outline"} className="text-[10px]">
            {result.voice}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {result.style}
          </Badge>
          {result.status === "loading" ? (
            <Badge variant="secondary" className="text-[10px]">
              생성 중…
            </Badge>
          ) : result.status === "error" ? (
            <Badge variant="destructive" className="text-[10px]">
              오류
            </Badge>
          ) : null}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(result.createdAt).toLocaleTimeString("ko-KR")}
        </span>
      </div>
      <p
        className={cn(
          "break-words text-foreground",
          prominent ? "text-sm leading-relaxed" : "line-clamp-2 text-xs",
        )}
      >
        {result.text}
      </p>
      {result.status === "loading" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {result.message ?? "처리 중..."}
        </div>
      ) : result.status === "error" ? (
        <p className="break-words text-xs text-destructive">{result.message ?? "오류"}</p>
      ) : src ? (
        <div className="flex flex-wrap items-center gap-2">
          <audio
            controls
            src={src}
            className={cn(
              "min-w-0 flex-1",
              prominent ? "h-10 min-h-10" : "h-9 min-h-9",
            )}
          />
          <Button variant="outline" size="sm" className="h-9 shrink-0 px-3" asChild>
            <a href={src} download={downloadName}>
              다운로드
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">오디오 URL 없음</p>
      )}
    </div>
  );
}
