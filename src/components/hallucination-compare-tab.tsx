"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { verifyAudioFromSrc } from "@/lib/stt-qa";
import { verdictLabelKo, type QaVerdict } from "@/lib/text-similarity";
import {
  COMPARE_EMOTIONS,
  MODEL_LABEL,
  bundleFor,
  downloadText,
  isCompareVoice,
  loadJson,
  parseCsv,
  pct,
  saveJson,
  synthesizeV2,
  toCsv,
  voiceGroup,
  wilsonUpper,
  type CompareEmotion,
  type CompareVoice,
  type ModelKey,
  type VoiceGroup,
} from "@/lib/model-compare";
import { Loader2 } from "lucide-react";

const STORE_KEY = "model-compare-halluc-v1";
const MODELS: ModelKey[] = ["g25", "g38"];

type SampleRow = { no: string; voice: CompareVoice; text: string; june12: string };

/** 사람이 들어 보고 붙이는 판정 */
type Label = "tts" | "stt" | "hold";
const LABEL_TEXT: Record<Label, string> = {
  tts: "TTS 오류",
  stt: "STT 오인식",
  hold: "보류",
};

type JobResult = {
  status: "done" | "error";
  url?: string;
  score?: number;
  verdict?: QaVerdict;
  transcript?: string;
  error?: string;
  label?: Label;
};

type RunConfig = {
  emotion: CompareEmotion;
  styleFemale: string;
  styleMale: string;
  cacheBust: boolean;
};

type Stored = {
  sourceName: string;
  rows: SampleRow[];
  config: RunConfig;
  results: Record<string, JobResult>;
};

const jobKey = (rowIdx: number, m: ModelKey) => `${rowIdx}|${m}`;
const playUrlOf = (url: string) => `/api/tts-audio?url=${encodeURIComponent(url)}`;

function parseSample(raw: string): SampleRow[] {
  const table = parseCsv(raw);
  if (table.length < 2) throw new Error("CSV에 데이터 행이 없음");
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const iText = header.indexOf("text");
  if (iText < 0) throw new Error("CSV 헤더에 text 열이 필요함 (선택: no, voice, june12)");
  const iNo = header.indexOf("no");
  const iVoice = header.indexOf("voice");
  const iJune = header.indexOf("june12");
  const out: SampleRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const text = (cells[iText] ?? "").trim();
    if (!text) return;
    const v = iVoice >= 0 ? (cells[iVoice] ?? "").trim() : "Sulafat";
    out.push({
      no: iNo >= 0 ? (cells[iNo] ?? "").trim() : String(i + 1),
      voice: isCompareVoice(v) ? v : "Sulafat",
      text,
      june12: iJune >= 0 ? (cells[iJune] ?? "").trim() : "",
    });
  });
  return out;
}

export function HallucinationCompareTab() {
  const [sourceName, setSourceName] = useState("");
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [results, setResults] = useState<Record<string, JobResult>>({});
  const [config, setConfig] = useState<RunConfig>({
    emotion: "Default",
    styleFemale: "",
    styleMale: "",
    cacheBust: true,
  });
  const [runModels, setRunModels] = useState<Record<ModelKey, boolean>>({ g25: true, g38: true });
  const [concurrency, setConcurrency] = useState("4");
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | "unlabeled" | "tts">("all");
  const [confirmReset, setConfirmReset] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const startedRef = useRef<{ at: number; doneAtStart: number } | null>(null);

  // 새로고침해도 이어서 할 수 있게 이 브라우저에 저장된 실행을 불러온다
  useEffect(() => {
    const s = loadJson<Stored | null>(STORE_KEY, null);
    if (s?.rows?.length) {
      setSourceName(s.sourceName);
      setRows(s.rows);
      setConfig(s.config);
      setResults(s.results ?? {});
    }
  }, []);

  const persist = useCallback(
    (next: Record<string, JobResult>) => {
      saveJson(STORE_KEY, { sourceName, rows, config, results: next } satisfies Stored);
    },
    [sourceName, rows, config],
  );

  const hasResults = Object.keys(results).length > 0;

  const onFile = async (file: File) => {
    setLoadError(null);
    try {
      const parsed = parseSample(await file.text());
      setRows(parsed);
      setSourceName(file.name);
      setResults({});
      saveJson(STORE_KEY, { sourceName: file.name, rows: parsed, config, results: {} } satisfies Stored);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const styleFor = (voice: CompareVoice) =>
    voiceGroup(voice) === "female" ? config.styleFemale : config.styleMale;

  const jobs = useMemo(() => {
    const list: Array<{ idx: number; m: ModelKey }> = [];
    rows.forEach((_, idx) => MODELS.forEach((m) => runModels[m] && list.push({ idx, m })));
    return list;
  }, [rows, runModels]);

  const doneCount = jobs.filter((j) => results[jobKey(j.idx, j.m)]?.status === "done").length;
  const errorCount = jobs.filter((j) => results[jobKey(j.idx, j.m)]?.status === "error").length;

  const start = useCallback(async () => {
    if (running || rows.length === 0) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    const todo = jobs.filter((j) => resultsRef.current[jobKey(j.idx, j.m)]?.status !== "done");
    startedRef.current = { at: Date.now(), doneAtStart: jobs.length - todo.length };
    let sinceSave = 0;
    const setResult = (k: string, r: JobResult) => {
      setResults((prev) => {
        const next = { ...prev, [k]: r };
        if (++sinceSave >= 10) {
          sinceSave = 0;
          persist(next);
        }
        return next;
      });
    };
    let next = 0;
    const n = Math.max(1, Math.min(8, parseInt(concurrency, 10) || 4));
    const worker = async () => {
      while (next < todo.length && !abort.signal.aborted) {
        const { idx, m } = todo[next++]!;
        const row = rows[idx]!;
        const k = jobKey(idx, m);
        try {
          const r = await synthesizeV2({
            text: row.text,
            bundleName: bundleFor(m, row.voice, config.emotion),
            style: m === "g38" ? styleFor(row.voice) : undefined,
            cacheBust: config.cacheBust,
            signal: abort.signal,
          });
          const stt = await verifyAudioFromSrc({ src: r.playUrl, originalText: row.text, signal: abort.signal });
          setResult(k, {
            status: "done",
            url: r.url,
            score: stt.score,
            verdict: stt.verdict,
            transcript: stt.transcript,
            label: resultsRef.current[k]?.label,
          });
        } catch (e) {
          if (abort.signal.aborted) break;
          setResult(k, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: n }, worker));
    } finally {
      setRunning(false);
      abortRef.current = null;
      setResults((prev) => {
        persist(prev);
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, rows, jobs, concurrency, config, persist]);

  const stop = () => abortRef.current?.abort();

  const setLabel = (k: string, label: Label) => {
    setResults((prev) => {
      const cur = prev[k];
      if (!cur) return prev;
      const next = { ...prev, [k]: { ...cur, label: cur.label === label ? undefined : label } };
      persist(next);
      return next;
    });
  };

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    setResults({});
    persist({});
  };

  const eta = useMemo(() => {
    const s = startedRef.current;
    if (!running || !s) return null;
    const doneNow = doneCount - s.doneAtStart;
    if (doneNow < 4) return null;
    const perJob = (Date.now() - s.at) / doneNow;
    const remain = jobs.length - doneCount;
    return Math.round((perJob * remain) / 60000);
  }, [running, doneCount, jobs.length]);

  /** 모델별, 목소리 그룹별 집계 */
  const stats = useMemo(() => {
    const groups: Array<[string, (v: CompareVoice) => boolean]> = [
      ["전체", () => true],
      ["여자 LAURA", (v) => voiceGroup(v) === ("female" as VoiceGroup)],
      ["남자 아이", (v) => voiceGroup(v) === ("male" as VoiceGroup)],
    ];
    return groups.flatMap(([gName, inGroup]) =>
      MODELS.map((m) => {
        let n = 0, pass = 0, flagged = 0, tts = 0, stt = 0, unlabeled = 0;
        rows.forEach((row, idx) => {
          if (!inGroup(row.voice)) return;
          const r = results[jobKey(idx, m)];
          if (r?.status !== "done") return;
          n++;
          // STT를 통과했어도 사람이 TTS 오류로 표시했으면 오류로 센다 (반복 발화가 STT에서 묻히는 경우)
          if (r.label === "tts") tts++;
          if (r.verdict === "pass") pass++;
          else {
            flagged++;
            if (r.label === "stt") stt++;
            else if (!r.label) unlabeled++;
          }
        });
        return { gName, m, n, pass, flagged, tts, stt, unlabeled, upper: wilsonUpper(tts, n) };
      }),
    );
  }, [rows, results]);

  /** STT가 걸러낸 문장 + 6/12에 TTS 오류였던 문장 */
  const reviewRows = useMemo(() => {
    return rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row, idx }) => {
        const rs = MODELS.map((m) => results[jobKey(idx, m)]);
        const flagged = rs.some((r) => r?.status === "done" && r.verdict !== "pass");
        const knownTts = row.june12.startsWith("TTS_");
        if (!flagged && !knownTts) return false;
        if (reviewFilter === "unlabeled")
          return rs.some((r) => r?.status === "done" && r.verdict !== "pass" && !r.label);
        if (reviewFilter === "tts") return rs.some((r) => r?.label === "tts");
        return true;
      });
  }, [rows, results, reviewFilter]);

  const exportCsv = () =>
    downloadText(
      `할루시네이션-2.5-vs-3.8-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        ["no", "보이스", "문장", "6/12 분류", "모델", "번들", "style", "STT 판정", "STT 일치율", "STT 결과", "사람 판정", "오디오", "오류"],
        ...rows.flatMap((row, idx) =>
          MODELS.map((m) => {
            const r = results[jobKey(idx, m)];
            return [
              row.no, row.voice, row.text, row.june12, MODEL_LABEL[m],
              bundleFor(m, row.voice, config.emotion), m === "g38" ? styleFor(row.voice) : "",
              r?.verdict ? verdictLabelKo(r.verdict) : "", r?.score != null ? (r.score * 100).toFixed(0) : "",
              r?.transcript ?? "", r?.label ? LABEL_TEXT[r.label] : "", r?.url ?? "", r?.error ?? "",
            ];
          }),
        ),
      ]),
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-lg">할루시네이션 비교 (2.5 Pro vs 3.8)</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            문장마다 두 모델로 음성을 만들고 STT로 받아 적어 원문과 비교함. STT가 걸러낸 문장은 직접 들어 보고 TTS 오류인지 STT 오인식인지
            표시해야 실제 할루시네이션 비율이 나옴 (6/12 검증의 2.5 기준: 22,553건 중 TTS 오류 6건).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">문장 CSV (헤더: no, voice, text, june12)</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
              className="h-10 text-sm"
            />
            {rows.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {sourceName}: 총 {rows.length}문장 (여자 LAURA {rows.filter((r) => voiceGroup(r.voice) === "female").length}, 남자 아이{" "}
                {rows.filter((r) => voiceGroup(r.voice) === "male").length})
              </p>
            ) : null}
            {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">감정 (두 모델 공통)</Label>
              <Select
                value={config.emotion}
                disabled={running || hasResults}
                onValueChange={(v) => setConfig((c) => ({ ...c, emotion: v as CompareEmotion }))}
              >
                <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPARE_EMOTIONS.map((e) => (
                    <SelectItem key={e} value={e} className="text-sm">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">3.8 style: 여자 LAURA (Sulafat)</Label>
              <Input
                value={config.styleFemale}
                disabled={running || hasResults}
                onChange={(e) => setConfig((c) => ({ ...c, styleFemale: e.target.value }))}
                placeholder="(빈 값: style 없이 보냄)"
                className="h-10 font-mono text-xs"
              />
            </div>
            <div className="hidden sm:block" />
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">3.8 style: 남자 아이 (Puck, Rasalgethi, Fenrir)</Label>
              <Input
                value={config.styleMale}
                disabled={running || hasResults}
                onChange={(e) => setConfig((c) => ({ ...c, styleMale: e.target.value }))}
                placeholder="(빈 값: style 없이 보냄)"
                className="h-10 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {MODELS.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <Switch
                  checked={runModels[m]}
                  disabled={running}
                  onCheckedChange={(v) => setRunModels((p) => ({ ...p, [m]: v }))}
                />
                {MODEL_LABEL[m]}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={config.cacheBust}
                disabled={running || hasResults}
                onCheckedChange={(v) => setConfig((c) => ({ ...c, cacheBust: v }))}
              />
              캐시 우회
            </label>
            <label className="flex items-center gap-2 text-sm">
              동시 요청
              <Input
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                disabled={running}
                inputMode="numeric"
                className="h-8 w-14 text-sm"
              />
            </label>
          </div>
          {hasResults ? (
            <p className="text-xs text-muted-foreground">
              결과가 있는 동안에는 감정, style, 캐시 우회를 바꿀 수 없음. 바꾸려면 결과를 지울 것.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button type="button" variant="destructive" onClick={stop}>중지</Button>
            ) : (
              <Button type="button" onClick={() => void start()} disabled={jobs.length === 0}>
                {doneCount > 0 && doneCount < jobs.length ? "이어서 실행" : "실행"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={exportCsv} disabled={!hasResults}>
              결과 CSV 내려받기
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={running || !hasResults}>
              {confirmReset ? "한 번 더 누르면 결과가 지워짐" : "결과 지우기"}
            </Button>
          </div>

          {jobs.length > 0 ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / jobs.length) * 100}%` }} />
              </div>
              <p className="flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-muted-foreground">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>완료 {doneCount} / {jobs.length}</span>
                {errorCount > 0 ? <span className="text-destructive">오류 {errorCount} (다시 실행하면 재시도)</span> : null}
                {eta != null ? <span>남은 시간 약 {eta}분</span> : null}
              </p>
            </div>
          ) : null}
          <Alert className="text-xs">
            <AlertDescription className="text-xs leading-relaxed">
              실행 중에는 이 탭을 닫지 말 것. 결과는 이 브라우저에 저장되므로 중간에 멈추거나 새로고침해도 &quot;이어서 실행&quot;으로 남은 문장만 처리함.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base">결과</CardTitle>
          <CardDescription className="text-xs">
            할루시네이션 비율 = 사람이 &quot;TTS 오류&quot;로 표시한 수 / 완료 수. 95% 상한은 이 표본으로 말할 수 있는 최대 비율임
            (오류 0건이어도 1,000문장이면 약 0.4%까지만 말할 수 있음).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">목소리</th>
                  <th className="py-2 pr-3 font-medium">모델</th>
                  <th className="py-2 pr-3 font-medium">완료</th>
                  <th className="py-2 pr-3 font-medium">STT 통과</th>
                  <th className="py-2 pr-3 font-medium">들어 볼 문장</th>
                  <th className="py-2 pr-3 font-medium">미분류</th>
                  <th className="py-2 pr-3 font-medium">STT 오인식</th>
                  <th className="py-2 pr-3 font-medium">TTS 오류</th>
                  <th className="py-2 pr-3 font-medium">할루시네이션</th>
                  <th className="py-2 font-medium">95% 상한</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {stats.map((s) => (
                  <tr key={`${s.gName}-${s.m}`} className="border-b last:border-0">
                    <td className="py-2 pr-3">{s.gName}</td>
                    <td className="py-2 pr-3">{MODEL_LABEL[s.m]}</td>
                    <td className="py-2 pr-3">{s.n}</td>
                    <td className="py-2 pr-3">{s.n ? pct(s.pass / s.n, 1) : "—"}</td>
                    <td className="py-2 pr-3">{s.flagged}</td>
                    <td className="py-2 pr-3">{s.unlabeled}</td>
                    <td className="py-2 pr-3">{s.stt}</td>
                    <td className="py-2 pr-3 font-semibold">{s.tts}</td>
                    <td className="py-2 pr-3 font-semibold">{s.n ? pct(s.tts / s.n) : "—"}</td>
                    <td className="py-2">{pct(s.upper)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base">들어 볼 문장 ({reviewRows.length})</CardTitle>
          <CardDescription className="text-xs">
            STT 통과가 아닌 문장과 6/12에 TTS 오류였던 문장. 들어 보고 모델마다 판정을 고를 것.
          </CardDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {([["all", "전체"], ["unlabeled", "미분류만"], ["tts", "TTS 오류만"]] as const).map(([v, l]) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={reviewFilter === v ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setReviewFilter(v)}
              >
                {l}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-6">
          {reviewRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 들어 볼 문장이 없음.</p>
          ) : (
            reviewRows.map(({ row, idx }) => (
              <div key={idx} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">no {row.no}</span>
                  <span>{row.voice}</span>
                  {row.june12 ? (
                    <Badge variant={row.june12.startsWith("TTS_") ? "destructive" : "outline"} className="text-[10px]">
                      6/12: {row.june12}
                    </Badge>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{row.text}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {MODELS.map((m) => {
                    const k = jobKey(idx, m);
                    const r = results[k];
                    return (
                      <div key={m} className="min-w-0 space-y-1.5 rounded bg-muted/40 p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={m === "g38" ? "default" : "secondary"} className="text-[10px]">
                            {MODEL_LABEL[m]}
                          </Badge>
                          {r?.verdict ? (
                            <Badge variant={r.verdict === "pass" ? "secondary" : "destructive"} className="text-[10px]">
                              STT {verdictLabelKo(r.verdict)} {r.score != null ? `${(r.score * 100).toFixed(0)}%` : ""}
                            </Badge>
                          ) : null}
                        </div>
                        {!r ? (
                          <p className="text-xs text-muted-foreground">아직 실행 안 함</p>
                        ) : r.status === "error" ? (
                          <p className="break-words text-xs text-destructive">{r.error}</p>
                        ) : (
                          <>
                            {r.url ? <audio controls preload="none" src={playUrlOf(r.url)} className="h-9 w-full" /> : null}
                            <p className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                              {r.transcript || "(빈 응답)"}
                            </p>
                            {r.verdict !== "pass" || r.label || row.june12.startsWith("TTS_") ? (
                              <div className="flex flex-wrap gap-1.5">
                                {(["tts", "stt", "hold"] as Label[]).map((l) => (
                                  <Button
                                    key={l}
                                    type="button"
                                    size="sm"
                                    variant={r.label === l ? (l === "tts" ? "destructive" : "default") : "outline"}
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => setLabel(k, l)}
                                  >
                                    {LABEL_TEXT[l]}
                                  </Button>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
