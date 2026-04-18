"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FALLBACK_PRESETS, DEFAULT_PROMPT } from "@/lib/presets";
import { buildPresetsFromRegistry, sortRevisionsDesc } from "@/lib/registry-utils";
import { proxyPlayUrl, streamTtsSse } from "@/lib/tts-sse";
import { cn } from "@/lib/utils";
import type { PromptRegistryJson, RegistryGroup, RegistryPrompt } from "@/types/registry";
import {
  bundleNameFromVoiceStyle,
  type StyleTone,
  type TtsRun,
  type VoiceId,
  VOICE_IDS,
  STYLE_TONES,
} from "@/types/tts";
import { ChevronDown, Loader2, Volume2 } from "lucide-react";

const API_BASE = "/api";

const HISTORY_OPTIONS = [10, 30, 50] as const;

function generateCacheBustToken() {
  const chars = "\u200B\u200C\u200D\uFEFF";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  const id = ts + rand;
  let token = "";
  for (const c of id) {
    token += chars[c.charCodeAt(0) % chars.length];
  }
  return ` ${token}`;
}

function trimRuns(runs: TtsRun[], max: number): TtsRun[] {
  if (runs.length <= max) return runs;
  const dropped = runs.slice(max);
  for (const r of dropped) {
    if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
  }
  return runs.slice(0, max);
}

export function TtsApp() {
  const [mainTab, setMainTab] = useState("generate");
  const [voice, setVoice] = useState<VoiceId>("Rasalgethi");
  const [style, setStyle] = useState<StyleTone>("Default");
  const [text, setText] = useState("Hello My name is Erin.");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [platform, setPlatform] = useState("PLAYGROUND");
  const [userId, setUserId] = useState("2");
  const [cacheBust, setCacheBust] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxHistory, setMaxHistory] = useState<(typeof HISTORY_OPTIONS)[number]>(30);
  const [runs, setRuns] = useState<TtsRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileResultTab, setMobileResultTab] = useState<"list" | "detail">("list");
  const [presetMap, setPresetMap] = useState(FALLBACK_PRESETS);
  const [activePresetKey, setActivePresetKey] = useState<string | null>(null);
  const [registryLoadError, setRegistryLoadError] = useState<string | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const handleRegistryLoaded = useCallback((reg: PromptRegistryJson) => {
    setPresetMap(buildPresetsFromRegistry(reg));
    setRegistryLoadError(null);
  }, []);

  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch(`${API_BASE}/prompt-registry`);
        if (!res.ok) throw new Error(await res.text());
        const reg = (await res.json()) as PromptRegistryJson;
        setPresetMap(buildPresetsFromRegistry(reg));
        setRegistryLoadError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPresetMap(FALLBACK_PRESETS);
        setRegistryLoadError(
          `레지스트리를 불러오지 못했습니다. 기본 프리셋을 사용합니다. (${msg})`,
        );
      }
    }
    void loadPresets();
  }, []);

  const bundleName = useMemo(() => bundleNameFromVoiceStyle(voice, style), [voice, style]);

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  const updateRun = useCallback((id: string, patch: Partial<TtsRun>) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const anyLoading = runs.some((r) => r.status === "loading");

  const getActualText = useCallback(() => {
    const t = text.trim();
    if (cacheBust) return t + generateCacheBustToken();
    return t;
  }, [text, cacheBust]);

  const startGeneration = useCallback(async () => {
    if (anyLoading) return;

    const originalText = text.trim();
    const actualText = getActualText();
    const promptVal = prompt;
    const uid = parseInt(userId, 10);
    if (!originalText) return;

    const id = crypto.randomUUID();
    const now = Date.now();
    const newRun: TtsRun = {
      id,
      createdAt: now,
      bundleName,
      voice,
      style,
      originalText,
      prompt: promptVal,
      status: "loading",
      statusMessage: "SSE 연결 대기 중...",
    };

    setRuns((prev) => trimRuns([newRun, ...prev], maxHistory));
    setSelectedId(id);
    setMobileResultTab("detail");

    try {
      const startResp = await fetch(`${API_BASE}/tts-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: actualText,
          bundleName,
          viseme: false,
          prompt: promptVal,
          platform,
          userId: Number.isFinite(uid) ? uid : 2,
        }),
      });

      if (!startResp.ok) {
        const errText = await startResp.text();
        throw new Error(`Start API failed (${startResp.status}): ${errText}`);
      }

      const startData = (await startResp.json()) as Record<string, unknown>;
      const sseId = (startData.sseId || startData.id || startData.streamId) as
        | string
        | undefined;

      if (!sseId) {
        throw new Error("SSE ID not found in response: " + JSON.stringify(startData));
      }

      updateRun(id, { statusMessage: `SSE 스트림 수신 중 (ID: ${sseId})...` });

      await streamTtsSse(sseId, {
        onLoading: (message) => updateRun(id, { status: "loading", statusMessage: message }),
        finishFromUrl: (upstreamUrl, meta) => {
          const playUrl = proxyPlayUrl(upstreamUrl);
          const m = meta as { firstChunkLatencyMs?: number; audioDurationMs?: number } | null;
          updateRun(id, {
            status: "success",
            statusMessage: undefined,
            playUrl,
            blobUrl: undefined,
            meta: m
              ? {
                  firstChunkLatencyMs: m.firstChunkLatencyMs,
                  audioDurationMs: m.audioDurationMs,
                }
              : undefined,
          });
        },
        finishFromChunks: (chunks) => {
          if (chunks.length === 0) {
            updateRun(id, {
              status: "error",
              statusMessage: "오디오 데이터가 비어있습니다.",
            });
            return;
          }
          const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
          const merged = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const blob = new Blob([merged], { type: "audio/mp3" });
          const blobUrl = URL.createObjectURL(blob);
          updateRun(id, {
            status: "success",
            statusMessage: undefined,
            blobUrl,
            playUrl: undefined,
          });
        },
        onError: (message) => {
          updateRun(id, { status: "error", statusMessage: message });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateRun(id, { status: "error", statusMessage: `오류: ${message}` });
    }
  }, [
    anyLoading,
    text,
    getActualText,
    prompt,
    userId,
    bundleName,
    voice,
    style,
    platform,
    maxHistory,
    updateRun,
  ]);

  const clearResults = useCallback(() => {
    setRuns((prev) => {
      for (const r of prev) {
        if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
      }
      return [];
    });
    setSelectedId(null);
  }, []);

  useEffect(() => {
    return () => {
      for (const r of runsRef.current) {
        if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
      }
    };
  }, []);

  useEffect(() => {
    setRuns((prev) => trimRuns(prev, maxHistory));
  }, [maxHistory]);

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 flex flex-wrap items-center gap-4 border-b border-border pb-6">
          <h1 className="bg-gradient-to-r from-primary to-violet-300 bg-clip-text text-2xl font-bold text-transparent">
            Gemini TTS Prompt Tester
          </h1>
          <Badge variant="secondary">LAURA TTS Stage</Badge>
        </header>

        <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="generate">음성 생성</TabsTrigger>
            <TabsTrigger value="registry">프롬프트 레지스트리</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <Alert>
              <AlertTitle>Cache 주의</AlertTitle>
              <AlertDescription>
                동일한 bundleName + text 조합은 서버에서 캐싱된 음성을 반환합니다. 프롬프트만
                변경하면 동일 음성이 나올 수 있습니다. &quot;캐시 우회&quot;를 켜면 텍스트 끝에
                보이지 않는 토큰이 추가됩니다.
              </AlertDescription>
            </Alert>

            {registryLoadError ? (
              <Alert variant="destructive">
                <AlertTitle>레지스트리 로드 실패</AlertTitle>
                <AlertDescription>{registryLoadError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>요청</CardTitle>
                  <CardDescription>Voice·Style을 고르면 bundleName이 조합됩니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Voice</Label>
                      <Select value={voice} onValueChange={(v) => setVoice(v as VoiceId)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VOICE_IDS.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Style</Label>
                      <Select value={style} onValueChange={(s) => setStyle(s as StyleTone)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STYLE_TONES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">API bundleName</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {bundleName}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tts-text">Text (발화 텍스트)</Label>
                    <Textarea
                      id="tts-text"
                      rows={3}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>프리셋</Label>
                    <ScrollArea className="h-[120px] rounded-md border border-border p-2">
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(presetMap).flatMap(([group, presets]) =>
                          Object.keys(presets).map((name) => {
                            const key = `${group}::${name}`;
                            const active = activePresetKey === key;
                            return (
                              <Tooltip key={key}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActivePresetKey(key);
                                      setPrompt(presetMap[group][name] ?? "");
                                    }}
                                    className={cn(
                                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                      active
                                        ? "border-primary bg-primary/15 text-primary"
                                        : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/50",
                                    )}
                                  >
                                    {name}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-xs text-xs">{group}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          }),
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tts-prompt">Prompt (음성 스타일 지시)</Label>
                    <Textarea
                      id="tts-prompt"
                      className="min-h-[160px] font-mono text-sm"
                      value={prompt}
                      onChange={(e) => {
                        setActivePresetKey(null);
                        setPrompt(e.target.value);
                      }}
                    />
                  </div>

                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1 px-0">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            advancedOpen && "rotate-180",
                          )}
                        />
                        고급 (Platform, User ID)
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-2">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Platform</Label>
                          <Select value={platform} onValueChange={setPlatform}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PLAYGROUND">PLAYGROUND</SelectItem>
                              <SelectItem value="PRODUCTION">PRODUCTION</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="user-id">User ID</Label>
                          <Input
                            id="user-id"
                            type="number"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <Label htmlFor="cache-bust" className="cursor-pointer">
                      캐시 우회
                    </Label>
                    <Switch id="cache-bust" checked={cacheBust} onCheckedChange={setCacheBust} />
                  </div>
                  {cacheBust ? (
                    <p className="text-xs text-muted-foreground">
                      활성: 텍스트 끝에 보이지 않는 유니코드 문자가 자동 추가됩니다.
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => void startGeneration()}
                    disabled={anyLoading || !text.trim()}
                  >
                    {anyLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        생성 중...
                      </>
                    ) : (
                      "음성 생성"
                    )}
                  </Button>
                </CardFooter>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle>결과</CardTitle>
                    <CardDescription className="mt-1">
                      목록에서 항목을 선택하면 오른쪽(또는 아래)에만 상세가 표시됩니다.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={String(maxHistory)}
                      onValueChange={(v) =>
                        setMaxHistory(parseInt(v, 10) as (typeof HISTORY_OPTIONS)[number])
                      }
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HISTORY_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            최대 {n}건
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={clearResults}>
                      전체 비우기
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col p-0 pt-0">
                  <div className="hidden h-[min(70vh,720px)] min-h-[360px] flex-1 md:block">
                    {runs.length === 0 ? (
                      <EmptyDetail className="h-full border-t border-border" />
                    ) : (
                      <ResizablePanelGroup direction="horizontal" className="h-full rounded-none">
                        <ResizablePanel defaultSize={32} minSize={22} className="min-w-0">
                          <RunList
                            runs={runs}
                            selectedId={selectedId}
                            onSelect={(rid) => setSelectedId(rid)}
                            className="h-full border-t border-border"
                          />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={68} minSize={35} className="min-w-0">
                          <RunDetail run={selectedRun} className="h-full border-t border-border" />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    )}
                  </div>

                  <div className="flex h-[min(70vh,720px)] min-h-[360px] flex-col md:hidden">
                    <Tabs
                      value={mobileResultTab}
                      onValueChange={(v) => setMobileResultTab(v as "list" | "detail")}
                      className="flex h-full flex-col"
                    >
                      <TabsList className="mx-4 mt-2 grid w-auto grid-cols-2">
                        <TabsTrigger value="list">목록</TabsTrigger>
                        <TabsTrigger value="detail">상세</TabsTrigger>
                      </TabsList>
                      <TabsContent value="list" className="mt-0 flex-1 overflow-hidden px-0 pb-0">
                        <RunList
                          runs={runs}
                          selectedId={selectedId}
                          onSelect={(rid) => {
                            setSelectedId(rid);
                            setMobileResultTab("detail");
                          }}
                          className="h-full border-t border-border"
                        />
                      </TabsContent>
                      <TabsContent
                        value="detail"
                        className="mt-0 flex-1 overflow-hidden px-0 pb-0"
                      >
                        <RunDetail
                          run={selectedRun}
                          className="h-full border-t border-border"
                          emptyClassName="h-full"
                        />
                      </TabsContent>
                    </Tabs>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="registry">
            <RegistryPanel onRegistryLoaded={handleRegistryLoaded} />
          </TabsContent>
        </Tabs>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          LAURA TTS Prompt Stability Tester · Stage Environment
        </p>
      </div>
    </TooltipProvider>
  );
}

function EmptyDetail({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-muted-foreground",
        className,
      )}
    >
      <Volume2 className="h-10 w-10 opacity-40" />
      <p className="text-sm">생성 결과를 선택하면 여기에 재생됩니다.</p>
    </div>
  );
}

function RunList({
  runs,
  selectedId,
  onSelect,
  className,
}: {
  runs: TtsRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="space-y-1 p-3 pr-4">
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              selectedId === r.id
                ? "border-primary bg-primary/10"
                : "border-transparent bg-secondary/30 hover:bg-secondary/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {r.voice} · {r.style}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {new Date(r.createdAt).toLocaleTimeString("ko-KR")}
              </span>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{r.originalText}</p>
            <div className="flex items-center gap-2">
              {r.status === "loading" ? (
                <Skeleton className="h-5 w-16" />
              ) : r.status === "success" ? (
                <Badge variant="outline" className="text-[10px] text-green-400">
                  완료
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  오류
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

function RunDetail({
  run,
  className,
  emptyClassName,
}: {
  run: TtsRun | null;
  className?: string;
  emptyClassName?: string;
}) {
  if (!run) {
    return <EmptyDetail className={cn(className, emptyClassName)} />;
  }

  const audioSrc = run.playUrl ?? run.blobUrl;

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Bundle</p>
          <p className="font-mono text-sm">{run.bundleName}</p>
        </div>
        <Separator />
        <div>
          <p className="text-xs text-muted-foreground">Text</p>
          <p className="whitespace-pre-wrap text-sm">{run.originalText}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Prompt</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-xs">
            {run.prompt}
          </pre>
        </div>
        <Separator />
        {run.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {run.statusMessage ?? "처리 중..."}
          </div>
        ) : null}
        {run.status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{run.statusMessage ?? "오류"}</AlertDescription>
          </Alert>
        ) : null}
        {run.status === "success" && audioSrc ? (
          <div className="space-y-3">
            <Badge variant="secondary" className="text-xs">
              재생
            </Badge>
            <audio controls className="w-full" src={audioSrc} />
            {run.meta &&
            (run.meta.firstChunkLatencyMs != null || run.meta.audioDurationMs != null) ? (
              <p className="text-xs text-muted-foreground">
                {run.meta.firstChunkLatencyMs != null
                  ? `첫 청크 지연: ${run.meta.firstChunkLatencyMs} ms`
                  : ""}
                {run.meta.firstChunkLatencyMs != null && run.meta.audioDurationMs != null
                  ? " · "
                  : ""}
                {run.meta.audioDurationMs != null ? `길이: ${run.meta.audioDurationMs} ms` : ""}
              </p>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <a href={audioSrc} download={`tts-${run.id.slice(0, 8)}.mp3`}>
                다운로드
              </a>
            </Button>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function RegistryPanel({
  onRegistryLoaded,
}: {
  onRegistryLoaded: (reg: PromptRegistryJson) => void;
}) {
  const [data, setData] = useState<PromptRegistryJson | null>(null);
  const [panelLoadError, setPanelLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [promptId, setPromptId] = useState("");
  const [revisionVer, setRevisionVer] = useState("");
  const [regLong, setRegLong] = useState("");
  const [regShort, setRegShort] = useState("");
  const [regChangelog, setRegChangelog] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const group = useMemo(
    () => data?.groups?.find((g) => g.id === groupId) ?? null,
    [data, groupId],
  );
  const prompt = useMemo(
    () => group?.prompts.find((p) => p.id === promptId) ?? null,
    [group, promptId],
  );

  const reloadRegistry = useCallback(async () => {
    setPanelLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/prompt-registry`);
      if (!res.ok) throw new Error(await res.text());
      const reg = (await res.json()) as PromptRegistryJson;
      setData(reg);
      const firstG = reg.groups?.[0];
      setGroupId(firstG?.id ?? "");
      const firstP = firstG?.prompts?.[0];
      setPromptId(firstP?.id ?? "");
      const revs = sortRevisionsDesc(firstP?.revisions);
      setRevisionVer(revs[0]?.version ?? "");
      onRegistryLoaded(reg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setData(null);
      setPanelLoadError(msg);
    }
  }, [onRegistryLoaded]);

  useEffect(() => {
    const saved = sessionStorage.getItem("prompt_admin_secret");
    if (saved) setAdminSecret(saved);
  }, []);

  useEffect(() => {
    void reloadRegistry();
  }, [reloadRegistry]);

  useEffect(() => {
    if (!data?.groups?.length) return;
    const g = data.groups.find((x) => x.id === groupId) ?? data.groups[0];
    if (g && g.id !== groupId) setGroupId(g.id);
  }, [data, groupId]);

  useEffect(() => {
    if (!group?.prompts?.length) {
      setPromptId("");
      return;
    }
    const p = group.prompts.find((x) => x.id === promptId) ?? group.prompts[0];
    if (p && p.id !== promptId) setPromptId(p.id);
  }, [group, promptId]);

  useEffect(() => {
    if (!prompt?.revisions?.length) {
      setRevisionVer("");
      return;
    }
    const sorted = sortRevisionsDesc(prompt.revisions);
    const has = sorted.some((r) => r.version === revisionVer);
    if (!has && sorted[0]) setRevisionVer(sorted[0].version);
  }, [prompt, revisionVer]);

  const loadRegSelection = useCallback(() => {
    if (!prompt) return;
    const r = prompt.revisions?.find((x) => x.version === revisionVer);
    if (!r) return;
    setRegLong(r.long || "");
    setRegShort(r.short || "");
    setRegChangelog("");
  }, [prompt, revisionVer]);

  useEffect(() => {
    loadRegSelection();
  }, [promptId, groupId, revisionVer, loadRegSelection]);

  const saveNewRevision = useCallback(async () => {
    setSaveMsg(null);
    try {
      const g = data?.groups?.find((x) => x.id === groupId);
      const p = g?.prompts.find((x) => x.id === promptId);
      if (!g || !p) throw new Error("그룹/프롬프트를 선택하세요.");
      const long = regLong.trim();
      if (!long) throw new Error("LONG 내용이 비어 있습니다.");
      const secret = adminSecret.trim();
      if (!secret) throw new Error("Admin secret를 입력하세요.");
      sessionStorage.setItem("prompt_admin_secret", secret);

      const res = await fetch(`${API_BASE}/prompt-save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Prompt-Admin-Secret": secret,
        },
        body: JSON.stringify({
          action: "createRevision",
          groupId: g.id,
          promptId: p.id,
          revision: {
            long,
            short: regShort,
            changelog: regChangelog,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || res.statusText);

      setSaveMsg({ ok: true, text: "저장 완료. 레지스트리를 다시 로드합니다…" });
      await reloadRegistry();
      setSaveMsg({
        ok: true,
        text: "반영 완료. GitHub main에 커밋되었고, Actions가 Confluence 동기화를 실행합니다.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveMsg({ ok: false, text: msg });
    }
  }, [
    data,
    groupId,
    promptId,
    regLong,
    regShort,
    regChangelog,
    adminSecret,
    reloadRegistry,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>프롬프트 레지스트리 &amp; GitHub docs 동기화</CardTitle>
        <CardDescription>
          저장 시 docs/prompt-registry.json과 docs/LAURA-TTS-프롬프트-버전-가이드.md가 함께
          갱신됩니다. 새 리비전 버전은 자동 증가합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {panelLoadError ? (
          <Alert variant="destructive">
            <AlertDescription>레지스트리를 불러오지 못했습니다: {panelLoadError}</AlertDescription>
          </Alert>
        ) : null}
        {data ? (
          <p className="text-sm text-green-400/90">
            registry v{data.registryVersion ?? 0} · 마지막 갱신 {data.updatedAt ?? "(unknown)"}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admin-secret">Admin secret (PROMPT_ADMIN_SECRET)</Label>
            <Input
              id="admin-secret"
              type="password"
              autoComplete="off"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="GitHub 반영 시 필요"
            />
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" className="w-full" onClick={reloadRegistry}>
              레지스트리 다시 로드
            </Button>
          </div>
        </div>

        {!data ? (
          <p className="text-sm text-muted-foreground">레지스트리를 불러오는 중…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>그룹</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="그룹" />
                </SelectTrigger>
                <SelectContent>
                  {(data.groups ?? []).map((g: RegistryGroup) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>프롬프트</Label>
              <Select value={promptId} onValueChange={setPromptId}>
                <SelectTrigger>
                  <SelectValue placeholder="프롬프트" />
                </SelectTrigger>
                <SelectContent>
                  {(group?.prompts ?? []).map((p: RegistryPrompt) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>리비전 (참고)</Label>
              <Select value={revisionVer} onValueChange={setRevisionVer}>
                <SelectTrigger>
                  <SelectValue placeholder="리비전" />
                </SelectTrigger>
                <SelectContent>
                  {sortRevisionsDesc(prompt?.revisions).map((r) => (
                    <SelectItem key={r.version} value={r.version}>
                      {r.version} ({r.createdAt ?? ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <Button type="button" variant="outline" size="sm" onClick={loadRegSelection}>
          선택 리비전 불러오기
        </Button>

        <div className="space-y-2">
          <Label>LONG</Label>
          <Textarea rows={5} value={regLong} onChange={(e) => setRegLong(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>SHORT</Label>
          <Textarea rows={3} value={regShort} onChange={(e) => setRegShort(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>변경사항 요약</Label>
          <Input
            value={regChangelog}
            onChange={(e) => setRegChangelog(e.target.value)}
            placeholder="예: 애드리브 금지 문구 강화"
          />
        </div>

        <Button type="button" onClick={() => void saveNewRevision()}>
          새 리비전으로 저장 → GitHub
        </Button>

        <Alert>
          <AlertTitle>새 프롬프트 / 새 그룹</AlertTitle>
          <AlertDescription>
            웹에서 생성은 중단되었습니다. GitHub에서 docs/prompt-registry.json을 직접 수정한 뒤
            커밋하세요.
          </AlertDescription>
        </Alert>

        {saveMsg ? (
          <p className={cn("text-sm", saveMsg.ok ? "text-green-400" : "text-destructive")}>
            {saveMsg.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
