"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildClipBaseName } from "@/lib/clip-filename";
import { arrayBufferToBase64 } from "@/lib/base64";
import { listBundlePresets } from "@/lib/bundle-presets";
import { parseQueryResultCsv, spokenTextFromCsvCell, type QueryCsvRow } from "@/lib/csv-query-rows";
import { DEFAULT_PROMPT } from "@/lib/presets";
import type { PromptRegistryJson } from "@/types/registry";
import { fetchCompleteTts } from "@/lib/tts-sse";
import {
  stringSimilarity,
  verdictFromScore,
  verdictLabelKo,
  type QaVerdict,
} from "@/lib/text-similarity";
import {
  bundleNameFromVoiceStyle,
  type StyleTone,
  type VoiceId,
  VOICE_IDS,
  STYLE_TONES,
} from "@/types/tts";
import { Loader2, Upload } from "lucide-react";

const API_BASE = "/api";

/** 음성 생성 탭과 동일 — 레지스트리 프리셋과 겹치지 않는 가상 id */
const TRYOUT_PRESET_ID = "__tryout__";

type Phase = "idle" | "tts" | "stt" | "done" | "error";

export type BatchRowState = {
  key: string;
  csv: QueryCsvRow;
  spokenText: string;
  baseName: string;
  phase: Phase;
  error?: string;
  /** blob: 재생·다운로드용 */
  objectUrl?: string;
  transcript?: string;
  score?: number;
  verdict?: QaVerdict;
};

function rowKey(r: QueryCsvRow) {
  return `${r.content_id}:${r.image_id}:${r.rowIndex}`;
}

function badgeForVerdict(v: QaVerdict | undefined) {
  if (!v) return null;
  if (v === "pass") {
    return (
      <Badge variant="outline" className="border-green-600/60 text-green-600 dark:text-green-400">
        {verdictLabelKo(v)}
      </Badge>
    );
  }
  if (v === "review") {
    return (
      <Badge variant="outline" className="border-amber-600/60 text-amber-800 dark:text-amber-400">
        {verdictLabelKo(v)}
      </Badge>
    );
  }
  return <Badge variant="destructive">{verdictLabelKo(v)}</Badge>;
}

export function CsvBatchQaTab({ registryJson }: { registryJson: PromptRegistryJson | null }) {
  const [voice, setVoice] = useState<VoiceId>("Rasalgethi");
  const [style, setStyle] = useState<StyleTone>("Default");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [activePresetKey, setActivePresetKey] = useState<string | null>(null);
  const [platform, setPlatform] = useState("PLAYGROUND");
  const [userId, setUserId] = useState("2");
  const [cacheBust, setCacheBust] = useState(true);
  const [passMin, setPassMin] = useState("0.88");
  const [reviewMin, setReviewMin] = useState("0.72");
  const [maxRows, setMaxRows] = useState("500");
  const [concurrency, setConcurrency] = useState("2");

  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<QueryCsvRow[]>([]);
  const [jobRows, setJobRows] = useState<BatchRowState[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const jobRowsRef = useRef(jobRows);
  jobRowsRef.current = jobRows;

  const bundleName = useMemo(() => bundleNameFromVoiceStyle(voice, style), [voice, style]);

  const bundlePresets = useMemo(
    () => listBundlePresets(registryJson, voice, style),
    [registryJson, voice, style],
  );

  const canPickPromptVersion = bundlePresets.length > 0;

  const presetSelectValue = useMemo(() => {
    if (!canPickPromptVersion) return "_empty";
    if (activePresetKey === TRYOUT_PRESET_ID) return TRYOUT_PRESET_ID;
    if (activePresetKey != null && bundlePresets.some((p) => p.id === activePresetKey)) {
      return activePresetKey;
    }
    return bundlePresets[0]!.id;
  }, [canPickPromptVersion, activePresetKey, bundlePresets]);

  useEffect(() => {
    const ids = new Set(bundlePresets.map((p) => p.id));
    const latest = bundlePresets[0];
    if (!latest) {
      if (activePresetKey === TRYOUT_PRESET_ID) return;
      if (activePresetKey != null) setActivePresetKey(null);
      return;
    }
    if (activePresetKey === TRYOUT_PRESET_ID) return;
    if (activePresetKey != null && ids.has(activePresetKey)) return;
    setActivePresetKey(latest.id);
    setPrompt(latest.long);
  }, [bundlePresets, activePresetKey]);

  const parsedThresholds = useMemo(() => {
    const p = parseFloat(passMin);
    const r = parseFloat(reviewMin);
    const pass = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.88;
    let review = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.72;
    if (review > pass) review = pass;
    return { pass, review };
  }, [passMin, reviewMin]);

  const maxRowsN = useMemo(() => {
    const v = parseInt(maxRows, 10);
    return Number.isFinite(v) && v > 0 ? Math.min(5000, v) : 500;
  }, [maxRows]);

  const concurrencyN = useMemo(() => {
    const v = parseInt(concurrency, 10);
    if (!Number.isFinite(v)) return 2;
    return Math.min(6, Math.max(1, Math.floor(v)));
  }, [concurrency]);

  const revokeAllObjectUrls = useCallback((list: BatchRowState[]) => {
    for (const j of list) {
      if (j.objectUrl) URL.revokeObjectURL(j.objectUrl);
    }
  }, []);

  useEffect(() => {
    return () => {
      revokeAllObjectUrls(jobRowsRef.current);
    };
  }, [revokeAllObjectUrls]);

  const onPickFile = useCallback(
    async (file: File | null) => {
      setParseError(null);
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseQueryResultCsv(text);
        const sliced = parsed.slice(0, maxRowsN);
        setRows(sliced);
        setJobRows([]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setParseError(msg);
        setRows([]);
        setJobRows([]);
      }
    },
    [maxRowsN],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runBatch = useCallback(async () => {
    if (rows.length === 0 || runningRef.current) return;
    runningRef.current = true;
    revokeAllObjectUrls(jobRowsRef.current);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const uid = parseInt(userId, 10);
    const userIdNum = Number.isFinite(uid) ? uid : 2;

    const initial: BatchRowState[] = rows.map((csv) => {
      const spokenText = spokenTextFromCsvCell(csv.text);
      const baseName = buildClipBaseName(csv.content_id, csv.image_id, spokenText);
      return {
        key: rowKey(csv),
        csv,
        spokenText,
        baseName,
        phase: "idle" as const,
      };
    });
    setJobRows(initial);
    setRunning(true);
    setProgress({ done: 0, total: initial.length });

    const updateRow = (key: string, patch: Partial<BatchRowState>) => {
      setJobRows((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)));
    };

    let completed = 0;
    const bump = () => {
      completed += 1;
      setProgress({ done: completed, total: initial.length });
    };

    const runOne = async (job: BatchRowState) => {
      const { key, spokenText } = job;
      try {
        if (ac.signal.aborted) {
          updateRow(key, { phase: "error", error: "중지됨" });
          return;
        }
        updateRow(key, { phase: "tts", error: undefined });
        const tts = await fetchCompleteTts({
          text: spokenText,
          bundleName,
          prompt,
          cacheBust,
          platform,
          userId: userIdNum,
          signal: ac.signal,
        });

        let blob: Blob;
        if (tts.kind === "proxyUrl") {
          const resp = await fetch(tts.playUrl, { signal: ac.signal });
          if (!resp.ok) throw new Error(`오디오 fetch 실패 (${resp.status})`);
          blob = await resp.blob();
        } else {
          blob = new Blob([new Uint8Array(tts.bytes)], { type: "audio/mpeg" });
        }
        const objectUrl = URL.createObjectURL(blob);
        updateRow(key, { phase: "stt", objectUrl });

        const b64 = arrayBufferToBase64(await blob.arrayBuffer());
        const sttRes = await fetch(`${API_BASE}/stt-verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({ audioBase64: b64, mimeType: "audio/mpeg" }),
        });
        const sttRaw = await sttRes.text();
        let sttJson: { transcript?: string; error?: string } = {};
        try {
          sttJson = JSON.parse(sttRaw) as typeof sttJson;
        } catch {
          sttJson = {};
        }
        if (!sttRes.ok) {
          throw new Error(sttJson.error || sttRaw || sttRes.statusText);
        }
        const transcript = (sttJson.transcript ?? "").trim();
        const score = stringSimilarity(spokenText, transcript);
        const verdict = verdictFromScore(score, parsedThresholds.pass, parsedThresholds.review);
        updateRow(key, {
          phase: "done",
          transcript,
          score,
          verdict,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateRow(key, { phase: "error", error: "중지됨" });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        updateRow(key, { phase: "error", error: message });
      } finally {
        bump();
      }
    };

    const queue = [...initial];
    const workers = Array.from({ length: concurrencyN }, async () => {
      while (queue.length > 0) {
        if (ac.signal.aborted) break;
        const job = queue.shift();
        if (!job) break;
        await runOne(job);
      }
    });
    try {
      await Promise.all(workers);
    } finally {
      if (ac.signal.aborted) {
        setJobRows((prev) =>
          prev.map((j) =>
            j.phase === "idle" ? { ...j, phase: "error" as const, error: "중지됨" } : j,
          ),
        );
        setProgress((p) => ({ done: p.total, total: p.total }));
      }
      runningRef.current = false;
      setRunning(false);
      abortRef.current = null;
    }
  }, [
    rows,
    bundleName,
    prompt,
    cacheBust,
    platform,
    userId,
    parsedThresholds.pass,
    parsedThresholds.review,
    concurrencyN,
    revokeAllObjectUrls,
  ]);

  const counts = useMemo(() => {
    let pass = 0;
    let review = 0;
    let fail = 0;
    let err = 0;
    for (const j of jobRows) {
      if (j.phase === "error" || (j.phase === "done" && j.verdict === "fail")) {
        if (j.phase === "error") err += 1;
        else fail += 1;
      } else if (j.verdict === "pass") pass += 1;
      else if (j.verdict === "review") review += 1;
    }
    return { pass, review, fail, err };
  }, [jobRows]);

  return (
    <div className="space-y-4">
      <Alert className="text-sm">
        <AlertTitle className="text-sm sm:text-base">CSV 배치 · STT QA</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed sm:text-sm">
          <code className="rounded bg-muted px-1">text, content_id, image_id</code> 형식 CSV를 올리면
          각 행을 Gemini TTS로 생성한 뒤, 같은 음성을 OpenAI 전사로 받아 적고 원문과 유사도를
          비교합니다. 파일명은{" "}
          <span className="font-mono text-[11px] sm:text-xs">
            CID_IMAGEID_문장앞부분.mp3
          </span>{" "}
          규칙입니다. STT에는 서버 환경 변수{" "}
          <code className="rounded bg-muted px-1">OPENAI_API_KEY</code>가 필요합니다(선택:{" "}
          <code className="rounded bg-muted px-1">OPENAI_STT_MODEL</code>, 기본{" "}
          <code className="rounded bg-muted px-1">gpt-4o-transcribe</code>).
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,26rem)_1fr]">
        <Card className="min-w-0">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">업로드·옵션</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              음성 생성 탭과 동일하게 bundleName·프롬프트가 적용됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">CSV 파일</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  className="cursor-pointer text-sm"
                  disabled={running}
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {parseError ? (
                <p className="text-xs text-destructive sm:text-sm">{parseError}</p>
              ) : rows.length > 0 ? (
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {rows.length}행 로드됨 (최대 {maxRowsN}행까지 잘림)
                </p>
              ) : (
                <p className="text-xs text-muted-foreground sm:text-sm">파일을 선택하세요.</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-max">최대 행 수</Label>
                <Input
                  id="batch-max"
                  inputMode="numeric"
                  className="h-11 sm:h-10"
                  value={maxRows}
                  onChange={(e) => setMaxRows(e.target.value.replace(/\D/g, ""))}
                  disabled={running}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-conc">동시 처리 수</Label>
                <Input
                  id="batch-conc"
                  inputMode="numeric"
                  className="h-11 sm:h-10"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value.replace(/\D/g, ""))}
                  disabled={running}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground sm:text-xs">
              최대 행을 바꾼 뒤에는 CSV를 다시 선택해야 적용됩니다.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm">Voice</Label>
                <Select
                  value={voice}
                  onValueChange={(v) => setVoice(v as VoiceId)}
                  disabled={running}
                >
                  <SelectTrigger className="h-11 sm:h-10">
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
                <Select
                  value={style}
                  onValueChange={(s) => setStyle(s as StyleTone)}
                  disabled={running}
                >
                  <SelectTrigger className="h-11 sm:h-10">
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
            <p className="break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
              bundleName: {bundleName}
            </p>

            <div className="space-y-2">
              <Label htmlFor="batch-preset-ver" className="text-sm">
                프롬프트 버전
              </Label>
              {canPickPromptVersion ? (
                <Select
                  value={presetSelectValue}
                  onValueChange={(v) => {
                    if (v === TRYOUT_PRESET_ID) {
                      setActivePresetKey(TRYOUT_PRESET_ID);
                      setPrompt("");
                      return;
                    }
                    const p = bundlePresets.find((x) => x.id === v);
                    if (p) {
                      setActivePresetKey(p.id);
                      setPrompt(p.long);
                    }
                  }}
                  disabled={running}
                >
                  <SelectTrigger id="batch-preset-ver" className="h-11 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TRYOUT_PRESET_ID}>Custom (직접 입력)</SelectItem>
                    {bundlePresets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.chipLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value="_empty" disabled>
                  <SelectTrigger id="batch-preset-ver" className="h-11 sm:h-10">
                    <SelectValue placeholder="프롬프트 버전 없음" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_empty">
                      이 Voice·Style 조합에 등록된 프롬프트가 없습니다
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                {canPickPromptVersion ? (
                  <>
                    레지스트리·로컬 프리셋 중{" "}
                    <span className="font-medium text-foreground/90">
                      {bundleName} · {style}
                    </span>{" "}
                    리비전만 표시됩니다. 버전이 없으면 아래 Prompt에 직접 입력하세요.
                  </>
                ) : (
                  "프롬프트 트랙을 찾지 못했습니다. 아래 Prompt에 직접 입력해 주세요."
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Prompt</Label>
              <Textarea
                rows={6}
                className="min-h-[8rem] resize-y font-mono text-xs sm:text-sm"
                value={prompt}
                onChange={(e) => {
                  setActivePresetKey(TRYOUT_PRESET_ID);
                  setPrompt(e.target.value);
                }}
                disabled={running}
                placeholder={
                  activePresetKey === TRYOUT_PRESET_ID
                    ? "프롬프트를 직접 입력…"
                    : undefined
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-platform">Platform</Label>
                <Select value={platform} onValueChange={setPlatform} disabled={running}>
                  <SelectTrigger id="batch-platform" className="h-11 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLAYGROUND">PLAYGROUND</SelectItem>
                    <SelectItem value="PRODUCTION">PRODUCTION</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-user">User ID</Label>
                <Input
                  id="batch-user"
                  type="number"
                  className="h-11 sm:h-10"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  disabled={running}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <Label htmlFor="batch-cache" className="cursor-pointer text-sm">
                캐시 우회
              </Label>
              <Switch
                id="batch-cache"
                checked={cacheBust}
                onCheckedChange={setCacheBust}
                disabled={running}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-pass">통과 최소 유사도</Label>
                <Input
                  id="batch-pass"
                  inputMode="decimal"
                  className="h-11 sm:h-10"
                  value={passMin}
                  onChange={(e) => setPassMin(e.target.value)}
                  disabled={running}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-review">검토필요 최소 유사도</Label>
                <Input
                  id="batch-review"
                  inputMode="decimal"
                  className="h-11 sm:h-10"
                  value={reviewMin}
                  onChange={(e) => setReviewMin(e.target.value)}
                  disabled={running}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="h-12 w-full touch-manipulation sm:h-11"
              size="lg"
              disabled={rows.length === 0 || running}
              onClick={() => void runBatch()}
            >
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  처리 중 {progress.done}/{progress.total}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  생성 + STT 검증
                </>
              )}
            </Button>
            {running ? (
              <Button type="button" variant="destructive" className="h-12 sm:h-11" onClick={stop}>
                중지
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">결과</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              통과 {counts.pass} · 검토 {counts.review} · 실패 {counts.fail} · 오류 {counts.err}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 p-0">
            {jobRows.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">실행 후 표가 채워집니다.</p>
            ) : (
              <ScrollArea className="h-[min(62dvh,640px)] sm:h-[min(65dvh,720px)]">
                <div className="min-w-[720px] divide-y divide-border">
                  <div className="grid grid-cols-[5rem_1fr_5.5rem_10rem_8rem] gap-2 bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground sm:text-xs">
                    <span>행</span>
                    <span>원문 / STT</span>
                    <span>유사도</span>
                    <span>판정</span>
                    <span>오디오</span>
                  </div>
                  {jobRows.map((j) => (
                    <div
                      key={j.key}
                      className="grid grid-cols-[5rem_1fr_5.5rem_10rem_8rem] items-start gap-2 px-3 py-2 text-xs sm:text-sm"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        #{j.csv.rowIndex}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className="break-words text-[11px] text-muted-foreground sm:text-xs">
                          {j.spokenText}
                        </p>
                        {j.transcript != null ? (
                          <p className="break-words text-[11px] sm:text-xs">{j.transcript}</p>
                        ) : j.phase === "tts" || j.phase === "stt" ? (
                          <p className="text-[11px] text-muted-foreground sm:text-xs">
                            {j.phase === "tts" ? "TTS 생성 중…" : "STT 검증 중…"}
                          </p>
                        ) : null}
                        {j.error ? (
                          <p className="break-words text-[11px] text-destructive sm:text-xs">
                            {j.error}
                          </p>
                        ) : null}
                        <p className="break-all font-mono text-[10px] text-muted-foreground">
                          {j.baseName}.mp3
                        </p>
                      </div>
                      <span className="font-mono text-[11px] sm:text-xs">
                        {j.score != null ? j.score.toFixed(2) : "—"}
                      </span>
                      <div>{badgeForVerdict(j.verdict)}</div>
                      <div className="min-w-0">
                        {j.objectUrl ? (
                          <div className="flex flex-col gap-1">
                            <audio controls className="h-8 w-full min-w-[120px]" src={j.objectUrl} />
                            <Button variant="outline" size="sm" className="h-8 text-[11px]" asChild>
                              <a
                                href={j.objectUrl}
                                download={`${j.baseName}.mp3`}
                                className="truncate"
                              >
                                저장
                              </a>
                            </Button>
                          </div>
                        ) : j.phase === "idle" ? (
                          <span className="text-muted-foreground">대기</span>
                        ) : j.phase === "tts" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
