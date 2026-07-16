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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { computeSpm, countTextSyllables } from "@/lib/syllables";
import { spmRecommendationFor } from "@/lib/spm-recommendations";
import { verifyAudioFromSrc } from "@/lib/stt-qa";
import { proxyPlayUrl } from "@/lib/tts-sse";
import { cn } from "@/lib/utils";
import {
  groupProfilesByProvider,
  findVoiceProfile,
  voiceProfileLabel,
  TTS_PROVIDER_LABELS,
} from "@/lib/voice-table";
import type { QaVerdict } from "@/lib/text-similarity";
import { verdictLabelKo } from "@/lib/text-similarity";
import { Loader2, Play } from "lucide-react";

const API_BASE = "/api";

const DEFAULT_TEXT =
  "The little bird flew over the tall trees and landed on the old wooden fence near the river.";

/** 기준 SPM × 배수 그리드 — 저속·고속 붕괴 지점 탐색용 */
const GRID_MULTIPLIERS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5] as const;

/** 동기 API 부하 배려 — 동시 요청 상한 */
const SWEEP_CONCURRENCY = 2;

type RowStatus = "pending" | "loading" | "success" | "error";

type SweepRow = {
  id: string;
  /** null이면 baseline(spm 미지정, rate 1.0) */
  spm: number | null;
  status: RowStatus;
  error?: string;
  playUrl?: string;
  elapsedMs?: number;
  durationMs?: number;
  measuredSpm?: number | null;
  qaStatus?: "running" | "done" | "error";
  transcript?: string;
  qaScore?: number;
  qaVerdict?: QaVerdict;
};

function parseSpmList(input: string): number[] {
  const out: number[] = [];
  for (const token of input.split(/[,\s]+/)) {
    if (!token) continue;
    const v = Number(token);
    if (Number.isFinite(v) && v > 0) out.push(Math.round(v * 10) / 10);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function fmtSec(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

export function SpmLabTab() {
  const [bundleName, setBundleName] = useState("GEMINI-Rasalgethi-Default");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [spmInput, setSpmInput] = useState("");
  const [gridBaseInput, setGridBaseInput] = useState("180");
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [cacheBust, setCacheBust] = useState(false);
  const [autoStt, setAutoStt] = useState(false);
  const [rows, setRows] = useState<SweepRow[]>([]);
  /** 현재 rows를 생성한 시점의 텍스트·번들 — 이후 입력을 바꿔도 실측·STT·CSV가 틀어지지 않게 고정 */
  const [sweepText, setSweepText] = useState(DEFAULT_TEXT);
  const [sweepBundle, setSweepBundle] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // 탭 전환 등으로 언마운트되면 진행 중 스윕(워커 풀)을 중단 — 고아 요청 방지
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const profile = useMemo(() => findVoiceProfile(bundleName), [bundleName]);
  const recommendation = useMemo(() => spmRecommendationFor(bundleName), [bundleName]);
  const providerGroups = useMemo(() => groupProfilesByProvider(), []);
  const syllables = useMemo(() => countTextSyllables(text), [text]);

  const spmValues = useMemo(() => parseSpmList(spmInput), [spmInput]);

  const patchRow = useCallback((id: string, patch: Partial<SweepRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const baselineRow = rows.find((r) => r.spm === null && r.status === "success");
  /** 역산 baseSpm ≈ 요청 spm × (해당 row duration / baseline duration) */
  const inferBaseSpm = useCallback(
    (row: SweepRow): number | null => {
      if (row.spm == null || row.durationMs == null) return null;
      if (!baselineRow?.durationMs) return null;
      return Math.round(row.spm * (row.durationMs / baselineRow.durationMs) * 10) / 10;
    },
    [baselineRow],
  );

  const fillGrid = useCallback(() => {
    const base = Number(gridBaseInput);
    if (!Number.isFinite(base) || base <= 0) return;
    const values = GRID_MULTIPLIERS.map((m) => Math.round(base * m));
    setSpmInput(values.join(", "));
  }, [gridBaseInput]);

  const fillLevels = useCallback(() => {
    if (!recommendation) return;
    setSpmInput(
      [recommendation.beginner, recommendation.intermediate, recommendation.advanced].join(", "),
    );
  }, [recommendation]);

  const verifyRow = useCallback(
    async (row: SweepRow, originalText: string) => {
      if (!row.playUrl) return;
      patchRow(row.id, { qaStatus: "running" });
      try {
        const result = await verifyAudioFromSrc({ src: row.playUrl, originalText });
        patchRow(row.id, {
          qaStatus: "done",
          transcript: result.transcript,
          qaScore: result.score,
          qaVerdict: result.verdict,
        });
      } catch (err) {
        patchRow(row.id, {
          qaStatus: "error",
          transcript: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [patchRow],
  );

  const startSweep = useCallback(async () => {
    if (running) return;
    const originalText = text.trim();
    if (!originalText) return;
    const jobs: Array<number | null> = [
      ...(includeBaseline ? [null] : []),
      ...spmValues,
    ];
    if (jobs.length === 0) return;

    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setSweepText(originalText);
    setSweepBundle(bundleName);

    const newRows: SweepRow[] = jobs.map((spm) => ({
      id: crypto.randomUUID(),
      spm,
      status: "pending" as const,
    }));
    setRows(newRows);

    const runJob = async (row: SweepRow) => {
      patchRow(row.id, { status: "loading" });
      try {
        const res = await fetch(`${API_BASE}/spm-synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            text: originalText,
            bundleName,
            spm: row.spm,
            platform: "PLAYGROUND",
            cacheBust,
          }),
        });
        const j = (await res.json()) as { url?: string; error?: string; elapsedMs?: number };
        if (!res.ok || !j.url) {
          throw new Error(j.error || `요청 실패 (${res.status})`);
        }
        const playUrl = proxyPlayUrl(j.url);
        patchRow(row.id, {
          status: "success",
          playUrl,
          elapsedMs: j.elapsedMs,
        });
        if (autoStt) {
          void verifyRow({ ...row, playUrl }, originalText);
        }
      } catch (err) {
        if (abort.signal.aborted) {
          patchRow(row.id, { status: "error", error: "중지됨" });
          return;
        }
        patchRow(row.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    try {
      // 소규모 워커 풀 — 동기 API라 과도한 동시 요청을 피한다
      let next = 0;
      const workers = Array.from(
        { length: Math.min(SWEEP_CONCURRENCY, newRows.length) },
        async () => {
          while (next < newRows.length && !abort.signal.aborted) {
            const row = newRows[next];
            next += 1;
            await runJob(row);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      // 중지 시 아직 시작되지 않은 행이 "대기"로 영원히 남지 않게 정리
      setRows((prev) =>
        prev.map((r) =>
          r.status === "pending" ? { ...r, status: "error" as const, error: "중지됨" } : r,
        ),
      );
      setRunning(false);
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [
    running,
    text,
    includeBaseline,
    spmValues,
    bundleName,
    cacheBust,
    autoStt,
    patchRow,
    verifyRow,
  ]);

  const stopSweep = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const copyCsv = useCallback(() => {
    const header = "bundleName,spm,elapsedMs,durationMs,measuredSpm,inferredBaseSpm,sttScore,transcript";
    const lines = rowsRef.current
      .filter((r) => r.status === "success")
      .map((r) => {
        const inferred = inferBaseSpm(r);
        return [
          sweepBundle ?? bundleName,
          r.spm ?? "base",
          r.elapsedMs ?? "",
          r.durationMs ?? "",
          r.measuredSpm ?? "",
          inferred ?? "",
          r.qaScore != null ? r.qaScore.toFixed(3) : "",
          r.transcript ? `"${r.transcript.replaceAll('"', '""')}"` : "",
        ].join(",");
      });
    void navigator.clipboard.writeText([header, ...lines].join("\n"));
  }, [sweepBundle, bundleName, inferBaseSpm]);

  const successCount = rows.filter((r) => r.status === "success").length;

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(280px,30rem)_minmax(0,1fr)] lg:gap-8">
      <Card className="w-full min-w-0">
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
          <CardTitle className="text-lg sm:text-xl">SPM 스윕 설정</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            TTS v2 <span className="font-mono">spm</span>(Syllables Per Minute) 파라미터로 같은
            문장을 여러 속도로 생성해 비교합니다. 미지정(baseline)은 VP 기본 속도(rate 1.0)입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:space-y-4 sm:px-6">
          <div className="space-y-2">
            <Label className="text-sm">Voice Profile (bundleName)</Label>
            <Select value={bundleName} onValueChange={setBundleName}>
              <SelectTrigger className="h-11 w-full touch-manipulation font-mono text-xs sm:h-10 sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerGroups.map((g) => (
                  <SelectGroup key={g.provider}>
                    <SelectLabel>{TTS_PROVIDER_LABELS[g.provider]}</SelectLabel>
                    {g.profiles.map((p) => (
                      <SelectItem key={p.bundleName} value={p.bundleName} className="font-mono text-xs">
                        {p.bundleName}
                        <span className="ml-2 font-sans text-[10px] text-muted-foreground">
                          {voiceProfileLabel(p)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {profile ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {voiceProfileLabel(profile)} · {TTS_PROVIDER_LABELS[profile.provider]}
                {profile.isDefault ? " · 기본 번들" : ""}
                {profile.provider === "TC"
                  ? " — Typecast는 현 백엔드에서 spm 미지원일 수 있습니다."
                  : ""}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label htmlFor="spm-text" className="text-sm">
                Text (발화 텍스트)
              </Label>
              <span className="text-[10px] text-muted-foreground sm:text-[11px]">
                추정 {syllables}음절 — 실측 SPM 계산에 사용
              </span>
            </div>
            <Textarea
              id="spm-text"
              rows={3}
              className="min-h-[5.5rem] resize-y text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
            <Label htmlFor="spm-list" className="text-sm">
              SPM 목록 (쉼표 구분)
            </Label>
            <Input
              id="spm-list"
              placeholder="예: 110, 130, 150, 170, 190"
              className="h-11 font-mono text-sm sm:h-10"
              value={spmInput}
              onChange={(e) => setSpmInput(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                aria-label="그리드 기준 SPM"
                className="h-9 w-20 font-mono text-xs"
                inputMode="numeric"
                value={gridBaseInput}
                onChange={(e) => setGridBaseInput(e.target.value.replace(/[^\d.]/g, ""))}
              />
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={fillGrid}>
                기준×0.6~1.5 그리드 채우기
              </Button>
              {recommendation ? (
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={fillLevels}>
                  B/I/A 추천값
                </Button>
              ) : null}
            </div>
            {spmValues.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {spmValues.length}개 + {includeBaseline ? "baseline 1개" : "baseline 없음"} ={" "}
                {spmValues.length + (includeBaseline ? 1 : 0)}회 생성
              </p>
            ) : null}
          </div>

          {recommendation ? (
            <Alert className="text-sm">
              <AlertTitle className="text-sm">1차 추천 (실측 스윕 기반)</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                Beginner {recommendation.beginner} · Intermediate {recommendation.intermediate} ·
                Advanced {recommendation.advanced}
                {recommendation.safeMin != null && recommendation.safeMax != null ? (
                  <>
                    {" "}
                    (안전 범위 {recommendation.safeMin}~{recommendation.safeMax})
                  </>
                ) : null}
                {recommendation.note ? <> — {recommendation.note}</> : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <Label htmlFor="spm-baseline" className="cursor-pointer text-xs leading-snug">
                baseline 포함
              </Label>
              <Switch id="spm-baseline" checked={includeBaseline} onCheckedChange={setIncludeBaseline} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <Label htmlFor="spm-cache-bust" className="cursor-pointer text-xs leading-snug">
                캐시 우회
              </Label>
              <Switch id="spm-cache-bust" checked={cacheBust} onCheckedChange={setCacheBust} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <Label htmlFor="spm-auto-stt" className="cursor-pointer text-xs leading-snug">
                자동 STT
              </Label>
              <Switch id="spm-auto-stt" checked={autoStt} onCheckedChange={setAutoStt} />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 px-4 pb-4 pt-0 sm:flex-row sm:px-6 sm:pb-6">
          <Button
            className="h-12 w-full touch-manipulation text-base sm:h-11 sm:text-sm"
            size="lg"
            onClick={() => void startSweep()}
            disabled={running || !text.trim() || (spmValues.length === 0 && !includeBaseline)}
          >
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                스윕 생성 중...
              </>
            ) : (
              "스윕 생성"
            )}
          </Button>
          {running ? (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="h-12 w-full touch-manipulation text-base sm:h-11 sm:w-auto sm:px-5 sm:text-sm"
              onClick={stopSweep}
            >
              중지
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      <Card className="w-full min-w-0">
        <CardHeader className="flex flex-col gap-2 space-y-0 px-4 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pb-4 sm:pt-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg sm:text-xl">스윕 결과</CardTitle>
              {sweepBundle && rows.length > 0 ? (
                <Badge variant="outline" className="max-w-full break-all font-mono text-[10px]">
                  {sweepBundle}
                </Badge>
              ) : null}
            </div>
            <CardDescription className="mt-1 text-xs sm:text-sm">
              실측 SPM = 추정 음절 수 ÷ 오디오 길이. 역산 baseSpm은 baseline 대비 길이 비율로
              계산합니다. 요청 SPM과 실측 SPM이 벌어지기 시작하는 지점이 프로바이더 한계입니다.
            </CardDescription>
          </div>
          {successCount > 0 ? (
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={copyCsv}>
              CSV 복사
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4 sm:px-6 sm:pb-6">
          {rows.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border">
              <p className="px-4 text-center text-sm text-muted-foreground">
                왼쪽에서 SPM 목록을 정하고 스윕을 생성하면 속도별 오디오가 여기 나열됩니다.
              </p>
            </div>
          ) : (
            rows.map((row) => {
              const inferred = inferBaseSpm(row);
              const deltaPct =
                row.spm != null && row.measuredSpm != null && row.spm > 0
                  ? Math.round(((row.measuredSpm - row.spm) / row.spm) * 100)
                  : null;
              return (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-lg border border-border p-3",
                    row.status === "error" && "border-destructive/50 bg-destructive/5",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Badge
                      variant={row.spm == null ? "secondary" : "outline"}
                      className="shrink-0 font-mono text-xs"
                    >
                      {row.spm == null ? "baseline" : `spm ${row.spm}`}
                    </Badge>
                    {row.status === "loading" ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 생성 중...
                      </span>
                    ) : null}
                    {row.status === "pending" ? (
                      <span className="text-xs text-muted-foreground">대기</span>
                    ) : null}
                    {row.status === "error" ? (
                      <span className="break-all text-xs text-destructive">{row.error}</span>
                    ) : null}
                    {row.status === "success" ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          길이 <span className="font-mono">{fmtSec(row.durationMs)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          실측{" "}
                          <span className="font-mono">
                            {row.measuredSpm != null ? `${row.measuredSpm} SPM` : "—"}
                          </span>
                          {deltaPct != null ? (
                            <span
                              className={cn(
                                "ml-1 font-mono",
                                Math.abs(deltaPct) > 10 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              ({deltaPct >= 0 ? "+" : ""}
                              {deltaPct}%)
                            </span>
                          ) : null}
                        </span>
                        {inferred != null ? (
                          <span className="text-xs text-muted-foreground">
                            역산 base <span className="font-mono">{inferred}</span>
                          </span>
                        ) : null}
                        {row.elapsedMs != null ? (
                          <span className="text-[10px] text-muted-foreground">
                            API {fmtSec(row.elapsedMs)}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {row.status === "success" && row.playUrl ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <audio
                        controls
                        preload="metadata"
                        src={row.playUrl}
                        className="h-9 w-full max-w-md"
                        onLoadedMetadata={(e) => {
                          const durationSec = e.currentTarget.duration;
                          if (!Number.isFinite(durationSec) || durationSec <= 0) return;
                          const durationMs = Math.round(durationSec * 1000);
                          patchRow(row.id, {
                            durationMs,
                            measuredSpm: computeSpm(sweepText, durationMs),
                          });
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={row.qaStatus === "running"}
                        onClick={() => void verifyRow(row, sweepText)}
                      >
                        {row.qaStatus === "running" ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="mr-1 h-3.5 w-3.5" />
                        )}
                        STT 검증
                      </Button>
                      {row.qaStatus === "done" && row.qaScore != null && row.qaVerdict ? (
                        <Badge
                          variant={row.qaVerdict === "pass" ? "secondary" : "destructive"}
                          className="text-[10px]"
                        >
                          {verdictLabelKo(row.qaVerdict)} {(row.qaScore * 100).toFixed(0)}%
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {row.qaStatus === "done" && row.transcript ? (
                    <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {row.transcript}
                    </p>
                  ) : null}
                  {row.qaStatus === "error" && row.transcript ? (
                    <p className="mt-1.5 text-[11px] text-destructive">STT 실패: {row.transcript}</p>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
