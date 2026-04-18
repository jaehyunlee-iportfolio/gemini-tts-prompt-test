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
import { listBundlePresets } from "@/lib/bundle-presets";
import { DEFAULT_PROMPT } from "@/lib/presets";
import { sortRevisionsDesc } from "@/lib/registry-utils";
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
  const [registryJson, setRegistryJson] = useState<PromptRegistryJson | null>(null);
  const [activePresetKey, setActivePresetKey] = useState<string | null>(null);
  const [registryLoadError, setRegistryLoadError] = useState<string | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const handleRegistryLoaded = useCallback((reg: PromptRegistryJson) => {
    setRegistryJson(reg);
    setRegistryLoadError(null);
  }, []);

  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch(`${API_BASE}/prompt-registry`);
        if (!res.ok) throw new Error(await res.text());
        const reg = (await res.json()) as PromptRegistryJson;
        setRegistryJson(reg);
        setRegistryLoadError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRegistryJson(null);
        setRegistryLoadError(
          `레지스트리를 불러오지 못했습니다. 기본 프리셋을 사용합니다. (${msg})`,
        );
      }
    }
    void loadPresets();
  }, []);

  const bundleName = useMemo(() => bundleNameFromVoiceStyle(voice, style), [voice, style]);

  const bundlePresets = useMemo(
    () => listBundlePresets(registryJson, voice, style),
    [registryJson, voice, style],
  );

  useEffect(() => {
    const ids = new Set(bundlePresets.map((p) => p.id));
    if (activePresetKey && !ids.has(activePresetKey)) {
      setActivePresetKey(null);
    }
  }, [bundlePresets, activePresetKey]);

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  const updateRun = useCallback((id: string, patch: Partial<TtsRun>) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const anyLoading = runs.some((r) => r.status === "loading");

  const startGeneration = useCallback(async () => {
    if (anyLoading) return;

    const originalText = text.trim();
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
          text: originalText,
          cacheBust,
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
    cacheBust,
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
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto min-h-0 w-full min-w-0 max-w-[min(100%,1920px)] overflow-x-hidden px-3 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-5 sm:py-8 lg:px-8 xl:px-10">
        <header className="mb-6 flex min-w-0 flex-col gap-3 border-b border-border pb-5 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:pb-6">
          <h1 className="min-w-0 bg-gradient-to-r from-primary to-violet-300 bg-clip-text text-xl font-bold leading-tight text-transparent sm:text-2xl lg:text-3xl">
            Gemini TTS Prompt Tester
          </h1>
          <Badge variant="secondary" className="w-fit shrink-0 self-start sm:self-center">
            LAURA TTS Stage
          </Badge>
        </header>

        <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4 sm:space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:w-auto sm:max-w-none">
            <TabsTrigger
              value="generate"
              className="touch-manipulation px-2 py-2.5 text-xs sm:flex-initial sm:px-3 sm:py-2 sm:text-sm"
            >
              음성 생성
            </TabsTrigger>
            <TabsTrigger
              value="registry"
              className="touch-manipulation px-2 py-2.5 text-xs sm:flex-initial sm:px-3 sm:py-2 sm:text-sm"
            >
              프롬프트 레지스트리
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="mt-0 space-y-3 sm:space-y-4">
            <Alert className="text-sm">
              <AlertTitle className="text-sm sm:text-base">Cache 주의</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed sm:text-sm [&_a]:break-all">
                동일한 bundleName + text 조합은 서버에서 캐싱된 음성을 반환합니다. 프롬프트만
                변경하면 동일 음성이 나올 수 있습니다. &quot;캐시 우회&quot;를 켜면 텍스트 끝에
                보이지 않는 토큰이 추가됩니다.
              </AlertDescription>
            </Alert>

            {registryLoadError ? (
              <Alert variant="destructive" className="text-sm">
                <AlertTitle className="text-sm sm:text-base">레지스트리 로드 실패</AlertTitle>
                <AlertDescription className="break-words text-xs sm:text-sm">
                  {registryLoadError}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(280px,34rem)_minmax(0,1fr)] lg:gap-8 2xl:grid-cols-[minmax(300px,36rem)_minmax(0,1fr)]">
              <Card className="w-full min-w-0 max-w-full lg:max-w-[34rem] 2xl:max-w-[36rem]">
                <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                  <CardTitle className="text-lg sm:text-xl">요청</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Voice·Style을 고르면 bundleName이 조합됩니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-4 sm:space-y-4 sm:px-6">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Voice</Label>
                      <Select value={voice} onValueChange={(v) => setVoice(v as VoiceId)}>
                        <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
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
                      <Label className="text-sm">Style</Label>
                      <Select value={style} onValueChange={(s) => setStyle(s as StyleTone)}>
                        <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
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
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="shrink-0 text-xs text-muted-foreground sm:text-sm">
                      API bundleName
                    </span>
                    <Badge
                      variant="outline"
                      className="w-fit max-w-full break-all font-mono text-[10px] leading-snug sm:text-xs"
                    >
                      {bundleName}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tts-text" className="text-sm">
                      Text (발화 텍스트)
                    </Label>
                    <Textarea
                      id="tts-text"
                      rows={3}
                      className="min-h-[5.5rem] resize-y text-sm sm:min-h-[6rem] sm:text-base"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
                      <Label className="text-sm">프리셋</Label>
                      <span className="text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                        {bundleName} · {style} 리비전만
                      </span>
                    </div>
                    <ScrollArea className="h-[min(28svh,140px)] rounded-md border border-border p-2 sm:h-[120px] sm:max-h-[160px]">
                      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                        {bundlePresets.map((preset) => {
                          const active = activePresetKey === preset.id;
                          return (
                            <Tooltip key={preset.id}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActivePresetKey(preset.id);
                                    setPrompt(preset.long);
                                  }}
                                  className={cn(
                                    "touch-manipulation min-h-10 w-full max-w-full rounded-lg border px-3 py-2 text-left text-[11px] font-medium transition-colors active:scale-[0.99] sm:w-auto sm:max-w-[calc(100%-0.5rem)] sm:rounded-full sm:py-1.5 sm:text-xs",
                                    active
                                      ? "border-primary bg-primary/15 text-primary"
                                      : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/50",
                                  )}
                                >
                                  <span className="line-clamp-3 font-mono sm:line-clamp-2">
                                    {preset.chipLabel}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-[min(90vw,20rem)] sm:max-w-xs"
                              >
                                <p className="text-xs">{preset.detail ?? preset.chipLabel}</p>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tts-prompt" className="text-sm">
                      Prompt (음성 스타일 지시)
                    </Label>
                    <Textarea
                      id="tts-prompt"
                      className="min-h-[10rem] resize-y font-mono text-xs leading-relaxed sm:min-h-[11rem] sm:text-sm md:min-h-[12rem]"
                      value={prompt}
                      onChange={(e) => {
                        setActivePresetKey(null);
                        setPrompt(e.target.value);
                      }}
                    />
                  </div>

                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 touch-manipulation gap-1 px-0 text-sm sm:h-9"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform",
                            advancedOpen && "rotate-180",
                          )}
                        />
                        고급 (Platform, User ID)
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-2">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Platform</Label>
                          <Select value={platform} onValueChange={setPlatform}>
                            <SelectTrigger className="h-11 touch-manipulation sm:h-10">
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
                            className="h-11 text-base sm:h-10 sm:text-sm"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:min-h-0 sm:py-2">
                    <Label htmlFor="cache-bust" className="cursor-pointer text-sm leading-snug">
                      캐시 우회
                    </Label>
                    <Switch
                      id="cache-bust"
                      className="shrink-0 scale-110 sm:scale-100"
                      checked={cacheBust}
                      onCheckedChange={setCacheBust}
                    />
                  </div>
                  {cacheBust ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                      활성: 텍스트 끝에 보이지 않는 유니코드 문자가 자동 추가됩니다.
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                  <Button
                    className="h-12 w-full touch-manipulation text-base sm:h-11 sm:text-sm"
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

              <Card className="flex min-h-0 w-full min-w-0 flex-col lg:min-h-[min(72dvh,800px)] xl:min-h-[min(78dvh,880px)]">
                <CardHeader className="flex flex-col gap-3 space-y-0 px-4 pb-3 pt-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4 sm:px-6 sm:pb-4 sm:pt-6">
                  <div className="min-w-0">
                    <CardTitle className="text-lg sm:text-xl">결과</CardTitle>
                    <CardDescription className="mt-1 text-xs sm:text-sm">
                      <span className="hidden lg:inline">
                        목록에서 항목을 선택하면 오른쪽에 상세가 표시됩니다.
                      </span>
                      <span className="lg:hidden">
                        아래 탭에서 목록·상세를 전환합니다.
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <Select
                      value={String(maxHistory)}
                      onValueChange={(v) =>
                        setMaxHistory(parseInt(v, 10) as (typeof HISTORY_OPTIONS)[number])
                      }
                    >
                      <SelectTrigger className="h-11 w-full min-w-[7.5rem] touch-manipulation sm:h-10 sm:w-[112px]">
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-full touch-manipulation sm:h-9 sm:w-auto"
                      onClick={clearResults}
                    >
                      전체 비우기
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col p-0 pt-0">
                  <div className="hidden min-h-0 flex-1 flex-col lg:flex lg:h-[min(72dvh,780px)] lg:min-h-[280px] xl:h-[min(78dvh,880px)]">
                    {runs.length === 0 ? (
                      <EmptyDetail className="min-h-0 flex-1 border-t border-border" />
                    ) : (
                      <ResizablePanelGroup
                        direction="horizontal"
                        className="h-full min-h-0 flex-1 rounded-none"
                      >
                        <ResizablePanel
                          defaultSize={22}
                          minSize={34}
                          maxSize={40}
                          className="max-w-[380px]"
                        >
                          <RunList
                            runs={runs}
                            selectedId={selectedId}
                            onSelect={(rid) => setSelectedId(rid)}
                            className="h-full border-t border-border"
                          />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={78} minSize={48} className="min-w-0 flex-1">
                          <RunDetail run={selectedRun} className="h-full" />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    )}
                  </div>

                  <div className="flex h-[min(52dvh,520px)] min-h-[260px] flex-col sm:min-h-[300px] lg:hidden">
                    <Tabs
                      value={mobileResultTab}
                      onValueChange={(v) => setMobileResultTab(v as "list" | "detail")}
                      className="flex h-full min-h-0 flex-col"
                    >
                      <TabsList className="mx-3 mt-2 grid h-auto w-auto grid-cols-2 gap-1 p-1 sm:mx-4">
                        <TabsTrigger
                          value="list"
                          className="touch-manipulation py-2.5 text-xs sm:text-sm"
                        >
                          목록
                        </TabsTrigger>
                        <TabsTrigger
                          value="detail"
                          className="touch-manipulation py-2.5 text-xs sm:text-sm"
                        >
                          상세
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent
                        value="list"
                        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-0"
                      >
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
                        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-0"
                      >
                        <RunDetail
                          run={selectedRun}
                          className="h-full min-h-0 flex-1"
                          emptyClassName="min-h-0 flex-1"
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

        <p className="mt-8 px-1 text-center text-[11px] leading-relaxed text-muted-foreground sm:mt-10 sm:text-xs">
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
        "flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 text-muted-foreground",
        className,
      )}
    >
      <Volume2 className="h-9 w-9 opacity-40 sm:h-10 sm:w-10" />
      <p className="max-w-[20rem] px-4 text-center text-xs sm:text-sm">
        생성 결과를 선택하면 여기에 재생됩니다.
      </p>
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
      <div className="space-y-1.5 p-2 pr-3 sm:p-3 sm:pr-4">
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex w-full min-w-0 touch-manipulation flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors active:bg-secondary/80 sm:py-2",
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
            <p className="line-clamp-3 break-words text-xs text-muted-foreground sm:line-clamp-2">
              {r.originalText}
            </p>
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
    <ScrollArea className={cn("h-full min-h-0", className)}>
      <div className="space-y-3 p-3 sm:space-y-4 sm:p-4 md:p-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Bundle</p>
          <p className="break-all font-mono text-xs leading-snug sm:text-sm">{run.bundleName}</p>
        </div>
        <Separator />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Text</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {run.originalText}
          </p>
        </div>
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
            <audio
              controls
              className="h-12 w-full min-h-[44px] max-w-full sm:h-11"
              src={audioSrc}
            />
            {run.meta &&
            (run.meta.firstChunkLatencyMs != null || run.meta.audioDurationMs != null) ? (
              <p className="break-words text-[11px] text-muted-foreground sm:text-xs">
                {run.meta.firstChunkLatencyMs != null
                  ? `첫 청크 지연: ${run.meta.firstChunkLatencyMs} ms`
                  : ""}
                {run.meta.firstChunkLatencyMs != null && run.meta.audioDurationMs != null
                  ? " · "
                  : ""}
                {run.meta.audioDurationMs != null ? `길이: ${run.meta.audioDurationMs} ms` : ""}
              </p>
            ) : null}
            <Button variant="outline" size="sm" className="h-10 touch-manipulation sm:h-9" asChild>
              <a href={audioSrc} download={`tts-${run.id.slice(0, 8)}.mp3`}>
                다운로드
              </a>
            </Button>
          </div>
        ) : null}
        <Separator />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Prompt</p>
          <div className="h-[4.9rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-foreground sm:h-[5.75rem] sm:p-3 sm:text-sm sm:leading-relaxed">
            {run.prompt}
          </div>
        </div>
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
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="space-y-2 px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
        <CardTitle className="text-lg leading-snug sm:text-xl">
          프롬프트 레지스트리 &amp; GitHub docs 동기화
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed sm:text-sm">
          저장 시 docs/prompt-registry.json과 docs/LAURA-TTS-프롬프트-버전-가이드.md가 함께
          갱신됩니다. 새 리비전 버전은 자동 증가합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        {panelLoadError ? (
          <Alert variant="destructive">
            <AlertDescription className="break-words text-xs sm:text-sm">
              레지스트리를 불러오지 못했습니다: {panelLoadError}
            </AlertDescription>
          </Alert>
        ) : null}
        {data ? (
          <p className="break-words text-xs text-green-400/90 sm:text-sm">
            registry v{data.registryVersion ?? 0} · 마지막 갱신 {data.updatedAt ?? "(unknown)"}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="admin-secret" className="text-sm">
              Admin secret (PROMPT_ADMIN_SECRET)
            </Label>
            <Input
              id="admin-secret"
              type="password"
              autoComplete="off"
              className="h-11 text-base sm:h-10 sm:text-sm"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="GitHub 반영 시 필요"
            />
          </div>
          <div className="flex items-stretch sm:items-end">
            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full touch-manipulation sm:h-10"
              onClick={reloadRegistry}
            >
              레지스트리 다시 로드
            </Button>
          </div>
        </div>

        {!data ? (
          <p className="text-sm text-muted-foreground">레지스트리를 불러오는 중…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0 space-y-2">
              <Label className="text-sm">그룹</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
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
            <div className="min-w-0 space-y-2">
              <Label className="text-sm">프롬프트</Label>
              <Select value={promptId} onValueChange={setPromptId}>
                <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
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
            <div className="min-w-0 space-y-2">
              <Label className="text-sm">리비전 (참고)</Label>
              <Select value={revisionVer} onValueChange={setRevisionVer}>
                <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 w-full touch-manipulation sm:w-auto"
          onClick={loadRegSelection}
        >
          선택 리비전 불러오기
        </Button>

        <div className="min-w-0 space-y-2">
          <Label className="text-sm">LONG</Label>
          <Textarea
            rows={5}
            className="min-h-[8rem] resize-y text-sm sm:min-h-[9rem]"
            value={regLong}
            onChange={(e) => setRegLong(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label className="text-sm">SHORT</Label>
          <Textarea
            rows={3}
            className="min-h-[5rem] resize-y text-sm"
            value={regShort}
            onChange={(e) => setRegShort(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label className="text-sm">변경사항 요약</Label>
          <Input
            className="h-11 text-base sm:h-10 sm:text-sm"
            value={regChangelog}
            onChange={(e) => setRegChangelog(e.target.value)}
            placeholder="예: 애드리브 금지 문구 강화"
          />
        </div>

        <Button
          type="button"
          className="h-12 w-full touch-manipulation text-base sm:h-11 sm:w-auto sm:text-sm"
          onClick={() => void saveNewRevision()}
        >
          새 리비전으로 저장 → GitHub
        </Button>

        {saveMsg ? (
          <p
            className={cn(
              "break-words text-xs sm:text-sm",
              saveMsg.ok ? "text-green-400" : "text-destructive",
            )}
          >
            {saveMsg.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
