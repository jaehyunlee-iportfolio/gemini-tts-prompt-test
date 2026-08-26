"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AudioWithMsTime } from "@/components/audio-with-ms-time";
import { SentencePresetSelect } from "@/components/sentence-preset-select";
import { MeasuredSpmLine } from "@/components/measured-spm-line";
import { spmFromSyllables } from "@/lib/syllables";
import { useSyllableCount } from "@/lib/use-syllable-count";
import { proxyPlayUrl } from "@/lib/tts-sse";
import { cn } from "@/lib/utils";
import {
  groupProfilesByProvider,
  voiceProfileLabel,
  PROVIDER_SPM_BANDS,
  TTS_PROVIDER_LABELS,
  type TtsProvider,
  type VoiceProfile,
} from "@/lib/voice-table";
import { Loader2 } from "lucide-react";

const API_BASE = "/api";
const DEFAULT_TEXT =
  "The little bird flew over the tall trees and landed on the old wooden fence near the river.";
/** 동기 API 부하 배려 — 동시 요청 상한 */
const MATRIX_CONCURRENCY = 3;
/** min/max 탐색용 기본 rate 스윕 */
const RATE_SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6] as const;

type Mode = "spm" | "rate";
type CellStatus = "idle" | "loading" | "success" | "error";
type Cell = {
  status: CellStatus;
  playUrl?: string;
  error?: string;
  elapsedMs?: number;
  /** 생성 시점의 문장과 음절 수 — 이후 입력을 바꿔도 실측이 틀어지지 않게 고정 */
  text?: string;
  syllables?: number;
  durationMs?: number;
  measuredSpm?: number | null;
};

type Job = { key: string; bundleName: string; spm: number };

function parseValues(input: string, mode: Mode): number[] {
  const out: number[] = [];
  for (const token of input.split(/[,\s]+/)) {
    if (!token) continue;
    const v = Number(token);
    if (!Number.isFinite(v) || v <= 0) continue;
    out.push(mode === "rate" ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function cellKey(bundleName: string, value: number): string {
  return `${bundleName}::${value}`;
}

/** 입력값(mode) + VP baseSpm -> 실제 요청 spm & 표시 rate */
function resolveRequest(
  mode: Mode,
  value: number,
  baseSpm: number,
): { spm: number; rate: number } {
  if (mode === "rate") {
    const spm = Math.round(value * baseSpm);
    return { spm, rate: baseSpm > 0 ? Math.round((spm / baseSpm) * 100) / 100 : value };
  }
  return { spm: value, rate: baseSpm > 0 ? Math.round((value / baseSpm) * 100) / 100 : 0 };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function SpmMatrixTab() {
  const providerGroups = useMemo(() => groupProfilesByProvider(), []);
  const providerOptions = useMemo(
    () => providerGroups.filter((g) => g.profiles.some((p) => p.baseSpm != null)),
    [providerGroups],
  );

  const [provider, setProvider] = useState<TtsProvider>(
    () => providerOptions[0]?.provider ?? "GEMINI",
  );
  const [mode, setMode] = useState<Mode>("rate");
  const [valueInput, setValueInput] = useState(RATE_SWEEP.join(", "));
  const [text, setText] = useState(DEFAULT_TEXT);
  const syl = useSyllableCount(text);
  const [cacheBust, setCacheBust] = useState(false);
  const [cells, setCells] = useState<Record<string, Cell>>({});

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // provider/mode/text가 바뀌면 이전 생성물은 무효 — 초기화
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCells({});
  }, [provider, mode, text]);

  const profiles: VoiceProfile[] = useMemo(
    () =>
      (providerGroups.find((g) => g.provider === provider)?.profiles ?? []).filter(
        (p) => p.baseSpm != null,
      ),
    [providerGroups, provider],
  );

  const values = useMemo(() => parseValues(valueInput, mode), [valueInput, mode]);
  const medianBase = useMemo(
    () => median(profiles.map((p) => p.baseSpm ?? 0).filter((v) => v > 0)),
    [profiles],
  );

  const patchCell = useCallback((key: string, patch: Partial<Cell>) => {
    setCells((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { status: "idle" }), ...patch } }));
  }, []);

  const getAbort = useCallback(() => {
    if (!abortRef.current) abortRef.current = new AbortController();
    return abortRef.current;
  }, []);

  const runJobs = useCallback(
    async (jobs: Job[]) => {
      const originalText = text.trim();
      if (!originalText || jobs.length === 0) return;
      const abort = getAbort();
      setCells((prev) => {
        const next = { ...prev };
        for (const j of jobs) next[j.key] = { status: "loading" };
        return next;
      });

      let idx = 0;
      const worker = async () => {
        while (idx < jobs.length && !abort.signal.aborted) {
          const job = jobs[idx++];
          try {
            const res = await fetch(`${API_BASE}/spm-synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abort.signal,
              body: JSON.stringify({
                text: originalText,
                bundleName: job.bundleName,
                spm: job.spm,
                platform: "PLAYGROUND",
                cacheBust,
              }),
            });
            const j = (await res.json()) as { url?: string; error?: string; elapsedMs?: number };
            if (!res.ok || !j.url) throw new Error(j.error || `요청 실패 (${res.status})`);
            patchCell(job.key, {
              status: "success",
              playUrl: proxyPlayUrl(j.url),
              elapsedMs: j.elapsedMs,
              text: originalText,
              syllables: syl.syllables,
            });
          } catch (err) {
            if (abort.signal.aborted) {
              patchCell(job.key, { status: "error", error: "중지됨" });
            } else {
              patchCell(job.key, {
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MATRIX_CONCURRENCY, jobs.length) }, worker),
      );
    },
    [text, syl.syllables, cacheBust, getAbort, patchCell],
  );

  const jobFor = useCallback(
    (p: VoiceProfile, value: number): Job => {
      const { spm } = resolveRequest(mode, value, p.baseSpm ?? 0);
      return { key: cellKey(p.bundleName, value), bundleName: p.bundleName, spm };
    },
    [mode],
  );

  const runAll = useCallback(() => {
    const jobs = profiles.flatMap((p) => values.map((v) => jobFor(p, v)));
    void runJobs(jobs);
  }, [profiles, values, jobFor, runJobs]);

  const runColumn = useCallback(
    (value: number) => {
      void runJobs(profiles.map((p) => jobFor(p, value)));
    },
    [profiles, jobFor, runJobs],
  );

  const runCell = useCallback(
    (p: VoiceProfile, value: number) => {
      void runJobs([jobFor(p, value)]);
    },
    [jobFor, runJobs],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** 오디오 길이가 확정되면 실측 SPM 계산 — 생성 시점 문장 기준 */
  const handleDuration = useCallback(
    (key: string, durationMs: number) => {
      setCells((prev) => {
        const c = prev[key];
        if (!c) return prev;
        return {
          ...prev,
          [key]: {
            ...c,
            durationMs,
            measuredSpm: spmFromSyllables(c.syllables ?? syl.syllables, durationMs),
          },
        };
      });
    },
    [syl.syllables],
  );

  const band = PROVIDER_SPM_BANDS[provider];

  /** 클램핑 구간 안을 균등하게 훑는다. 구간 밖 요청은 서버가 경계값으로 바꿔서 들어봐야 소용이 없다. */
  const fillBand = useCallback(() => {
    if (!band) return;
    const steps = 7;
    const spms = Array.from({ length: steps }, (_, i) =>
      Math.round(band.min + ((band.max - band.min) * i) / (steps - 1)),
    );
    if (mode === "spm") {
      setValueInput(spms.join(", "));
    } else {
      const base = medianBase > 0 ? medianBase : 160;
      setValueInput(spms.map((v) => (v / base).toFixed(2)).join(", "));
    }
  }, [band, mode, medianBase]);

  const fillSweep = useCallback(() => {
    if (mode === "rate") {
      setValueInput(RATE_SWEEP.join(", "));
    } else {
      const base = medianBase > 0 ? medianBase : 160;
      setValueInput(RATE_SWEEP.map((r) => Math.round(base * r)).join(", "));
    }
  }, [mode, medianBase]);

  // 진행 현황(현재 매트릭스 셀 기준)
  const stats = useMemo(() => {
    let success = 0;
    let loading = 0;
    let error = 0;
    for (const p of profiles) {
      for (const v of values) {
        const c = cells[cellKey(p.bundleName, v)];
        if (!c) continue;
        if (c.status === "success") success++;
        else if (c.status === "loading") loading++;
        else if (c.status === "error") error++;
      }
    }
    return { success, loading, error, total: profiles.length * values.length };
  }, [cells, profiles, values]);

  const busy = stats.loading > 0;
  const gridTemplate = `minmax(150px,190px) repeat(${values.length}, minmax(180px,1fr))`;

  return (
    <div className="space-y-4">
      <Alert className="text-sm">
        <AlertTitle className="text-sm sm:text-base">프로바이더 Min/Max 청취</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed sm:text-sm">
          프로바이더를 고르고 값(쉼표 구분)을 입력하면, 그 프로바이더의 전 VP를 각 값으로 생성해
          한 화면에서 비교 청취합니다. 열 = 입력값, 행 = VP. 기계음(너무 느림)이나 씹힘(너무 빠름)이
          시작되는 지점을 프로바이더 공통으로 잡아 min/max를 정하는 용도입니다. min/max는 rate
          기준이므로 <span className="font-medium">rate 모드</span>면 한 열이 전 VP 동일 rate라
          판단이 빠릅니다.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base sm:text-lg">설정</CardTitle>
          <CardDescription className="text-xs">
            같은 문장 + 같은 요청은 서버 캐시로 즉시 반환됩니다(캐시 우회로 강제 재생성).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Label className="text-sm">프로바이더</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as TtsProvider)}>
                <SelectTrigger className="h-11 w-full sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((g) => (
                    <SelectItem key={g.provider} value={g.provider}>
                      {TTS_PROVIDER_LABELS[g.provider]}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        VP {g.profiles.filter((p) => p.baseSpm != null).length}종
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {band ? (
                  <>
                    클램핑 구간 <span className="font-mono text-foreground">{band.min} ~ {band.max}</span> SPM.
                    구간 밖으로 요청하면 서버가 경계값으로 바꿔 생성합니다.
                  </>
                ) : (
                  <>이 프로바이더는 클램핑 구간이 정해져 있지 않습니다.</>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">입력 단위</Label>
              <div className="flex h-11 items-center rounded-md border border-border p-1 sm:h-10">
                {(["rate", "spm"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "h-full flex-1 rounded px-4 text-sm font-medium transition-colors",
                      mode === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "rate" ? "rate" : "SPM"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label htmlFor="matrix-values" className="text-sm">
                {mode === "rate" ? "rate 목록 (쉼표 구분)" : "SPM 목록 (쉼표 구분)"}
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {profiles.length} VP × {values.length}개 = {profiles.length * values.length}셀
              </span>
            </div>
            <Input
              id="matrix-values"
              className="h-11 font-mono text-sm sm:h-10"
              placeholder={mode === "rate" ? "예: 0.6, 0.8, 1.0, 1.2" : "예: 110, 140, 170, 200"}
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {band ? (
                <Button type="button" variant="default" size="sm" className="h-9" onClick={fillBand}>
                  클램핑 구간 {band.min}~{band.max} 훑기
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={fillSweep}>
                {mode === "rate"
                  ? "rate 0.5~1.6 스윕 채우기"
                  : `이 프로바이더 rate 스윕 -> SPM (base ${medianBase || "?"})`}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="matrix-text" className="text-sm">
              청취 문장
            </Label>
            <SentencePresetSelect value={text} onChange={setText} />
            <Textarea
              id="matrix-text"
              rows={2}
              className="min-h-[4rem] resize-y text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:min-h-0 sm:w-56">
              <Label htmlFor="matrix-cache-bust" className="cursor-pointer text-xs leading-snug">
                캐시 우회
              </Label>
              <Switch id="matrix-cache-bust" checked={cacheBust} onCheckedChange={setCacheBust} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="h-11 w-full touch-manipulation sm:h-10 sm:w-auto sm:px-6"
                onClick={runAll}
                disabled={busy || !text.trim() || profiles.length === 0 || values.length === 0}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    생성 중 ({stats.success}/{stats.total})
                  </>
                ) : (
                  `전체 생성 (${profiles.length * values.length}셀)`
                )}
              </Button>
              {busy ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 w-full touch-manipulation sm:h-10 sm:w-auto sm:px-5"
                  onClick={stop}
                >
                  중지
                </Button>
              ) : null}
            </div>
          </div>
          {stats.total > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              완료 {stats.success} · 진행 {stats.loading} · 실패 {stats.error} · 전체 {stats.total}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-2 pt-4 sm:px-6">
          <CardTitle className="text-base">
            {TTS_PROVIDER_LABELS[provider]} · VP × {mode === "rate" ? "rate" : "SPM"} 매트릭스
          </CardTitle>
          <CardDescription className="text-xs">
            셀을 개별로 눌러 생성하거나, 열 머리글의 &quot;열 생성&quot;으로 한 값의 전 VP를 한 번에
            만듭니다. 회색은 각 VP의 서버 baseSpm(rate 1.0)입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-4 sm:px-4">
          {values.length === 0 || profiles.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-border">
              <p className="px-4 text-center text-sm text-muted-foreground">
                프로바이더와 {mode === "rate" ? "rate" : "SPM"} 값을 입력하면 매트릭스가 여기 나타납니다.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ display: "grid", gridTemplateColumns: gridTemplate }} className="min-w-fit gap-px bg-border">
                {/* header row */}
                <div className="sticky left-0 z-10 bg-background px-2 py-2 text-xs font-medium text-muted-foreground">
                  Voice Profile
                </div>
                {values.map((v) => (
                  <div key={`h-${v}`} className="bg-background px-2 py-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs font-medium">
                        {mode === "rate" ? `rate ${v}` : `spm ${v}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => runColumn(v)}
                        disabled={!text.trim()}
                      >
                        열 생성
                      </Button>
                    </div>
                  </div>
                ))}

                {/* body rows */}
                {profiles.map((p) => (
                  <FragmentRow
                    key={p.bundleName}
                    profile={p}
                    values={values}
                    mode={mode}
                    cells={cells}
                    onCell={runCell}
                    onDuration={handleDuration}
                    hasText={!!text.trim()}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FragmentRow({
  profile,
  values,
  mode,
  cells,
  onCell,
  onDuration,
  hasText,
}: {
  profile: VoiceProfile;
  values: number[];
  mode: Mode;
  cells: Record<string, Cell>;
  onCell: (p: VoiceProfile, value: number) => void;
  onDuration: (key: string, durationMs: number) => void;
  hasText: boolean;
}) {
  const base = profile.baseSpm ?? 0;
  return (
    <>
      <div className="sticky left-0 z-10 flex flex-col justify-center bg-background px-2 py-2">
        <span className="break-all font-mono text-[11px] leading-tight">{profile.bundleName}</span>
        <span className="text-[10px] text-muted-foreground">
          {voiceProfileLabel(profile)} · base {base}
        </span>
      </div>
      {values.map((v) => {
        const { spm, rate } = resolveRequest(mode, v, base);
        const key = cellKey(profile.bundleName, v);
        const c = cells[key] ?? { status: "idle" as const };
        const meta = mode === "rate" ? `spm ${spm}` : `r${rate}`;
        return (
          <div key={key} className="flex min-h-[3.25rem] flex-col justify-center gap-1 bg-background px-2 py-1.5">
            {c.status === "success" && c.playUrl ? (
              <>
                <span className="block text-[10px] text-muted-foreground">{meta}</span>
                <MeasuredSpmLine requestSpm={spm} measuredSpm={c.measuredSpm} />
                <AudioWithMsTime
                  src={c.playUrl}
                  onDurationMs={(durationMs) => onDuration(key, durationMs)}
                />
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 w-full flex-col items-center gap-0 py-1"
                disabled={c.status === "loading" || !hasText}
                onClick={() => onCell(profile, v)}
              >
                <span className="flex items-center gap-1 text-xs font-medium">
                  {c.status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {c.status === "loading" ? "생성 중" : c.status === "error" ? "재시도" : "생성"}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-normal",
                    c.status === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {c.status === "error" ? (c.error ?? "실패") : meta}
                </span>
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
