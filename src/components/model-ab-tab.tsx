"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { AudioWithMsTime } from "@/components/audio-with-ms-time";
import { SentencePresetSelect } from "@/components/sentence-preset-select";
import { DEFAULT_SWEEP_TEXT } from "@/lib/sentence-presets";
import { verifyAudioFromSrc } from "@/lib/stt-qa";
import { verdictLabelKo, type QaVerdict } from "@/lib/text-similarity";
import { cn } from "@/lib/utils";
import {
  ANNOUNCER_STYLE,
  COMPARE_EMOTIONS,
  COMPARE_VOICES,
  MODEL_LABEL,
  STYLE_CANDIDATES,
  TARGET_VOICE_LABEL,
  bundleFor,
  downloadText,
  loadJson,
  pct,
  saveJson,
  synthesizeV2,
  toCsv,
  voiceGroup,
  type CompareEmotion,
  type CompareVoice,
  type ModelKey,
  type VoiceGroup,
} from "@/lib/model-compare";
import { Loader2 } from "lucide-react";

const LOG_KEY = "model-compare-ab-log-v1";

type Fit = "yes" | "meh" | "no";
const FIT_LABEL: Record<Fit, string> = { yes: "맞음", meh: "애매", no: "다름" };

type Clip = {
  status: "loading" | "success" | "error";
  playUrl?: string;
  error?: string;
  sttStatus?: "running" | "done" | "error";
  sttScore?: number;
  sttVerdict?: QaVerdict;
  transcript?: string;
};

type Rating = { quality?: number; fit?: Fit };

/** 2.5와 3.8을 한 쌍으로 들어 보는 단위. key는 모델이거나 style 후보 인덱스 */
type Pair = {
  id: string;
  voice: CompareVoice;
  emotion: CompareEmotion;
  text: string;
  style: string;
  blind: boolean;
  /** 화면에 놓이는 순서 (블라인드면 섞음) */
  order: ModelKey[];
  clips: Partial<Record<ModelKey, Clip>>;
  ratings: Partial<Record<ModelKey, Rating>>;
  saved: boolean;
};

type LogEntry = {
  at: string;
  voice: CompareVoice;
  emotion: CompareEmotion;
  model: ModelKey;
  style: string;
  text: string;
  quality: number | null;
  fit: Fit | null;
  sttScore: number | null;
};

type SweepItem = {
  style: string;
  label: string;
  clip: Clip;
  fit?: Fit;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function runStt(playUrl: string, text: string): Promise<Partial<Clip>> {
  try {
    const r = await verifyAudioFromSrc({ src: playUrl, originalText: text });
    return { sttStatus: "done", sttScore: r.score, sttVerdict: r.verdict, transcript: r.transcript };
  } catch (e) {
    return { sttStatus: "error", transcript: e instanceof Error ? e.message : String(e) };
  }
}

function SttLine({ clip }: { clip: Clip }) {
  if (clip.sttStatus === "running")
    return <p className="text-[11px] text-muted-foreground">STT 확인 중…</p>;
  if (clip.sttStatus === "error")
    return <p className="text-[11px] text-destructive">STT 실패: {clip.transcript}</p>;
  if (clip.sttStatus !== "done" || clip.sttScore == null || !clip.sttVerdict) return null;
  return (
    <div className="space-y-1">
      <Badge
        variant={clip.sttVerdict === "pass" ? "secondary" : "destructive"}
        className="text-[10px]"
      >
        STT {verdictLabelKo(clip.sttVerdict)} {(clip.sttScore * 100).toFixed(0)}%
      </Badge>
      <p className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        {clip.transcript}
      </p>
    </div>
  );
}

function ChoiceRow<T extends string | number>({
  value,
  options,
  onPick,
}: {
  value: T | undefined;
  options: Array<[T, string]>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <Button
          key={String(v)}
          type="button"
          size="sm"
          variant={value === v ? "default" : "outline"}
          className="h-8 min-w-9 px-2.5 text-xs"
          onClick={() => onPick(v)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function ModelAbTab() {
  const [voice, setVoice] = useState<CompareVoice>("Sulafat");
  const [emotion, setEmotion] = useState<CompareEmotion>("Default");
  const [text, setText] = useState(DEFAULT_SWEEP_TEXT);
  const [style, setStyle] = useState("");
  const [blind, setBlind] = useState(true);
  const [cacheBust, setCacheBust] = useState(true);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sweep, setSweep] = useState<SweepItem[]>([]);
  const [sweepMeta, setSweepMeta] = useState<{ voice: CompareVoice; emotion: CompareEmotion; text: string } | null>(null);

  useEffect(() => setLog(loadJson<LogEntry[]>(LOG_KEY, [])), []);

  const group: VoiceGroup = voiceGroup(voice);
  const candidates = STYLE_CANDIDATES[group][emotion];

  const patchClip = useCallback((pairId: string, model: ModelKey, patch: Partial<Clip>) => {
    setPairs((prev) =>
      prev.map((p) =>
        p.id === pairId
          ? { ...p, clips: { ...p.clips, [model]: { ...(p.clips[model] ?? { status: "loading" }), ...patch } } }
          : p,
      ),
    );
  }, []);

  const generatePair = useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    const models: ModelKey[] = ["g25", "g38"];
    const pair: Pair = {
      id: crypto.randomUUID(),
      voice,
      emotion,
      text: t,
      style: style.trim(),
      blind,
      order: blind ? shuffle(models) : models,
      clips: { g25: { status: "loading" }, g38: { status: "loading" } },
      ratings: {},
      saved: false,
    };
    setPairs((prev) => [pair, ...prev]);
    await Promise.all(
      models.map(async (m) => {
        try {
          const r = await synthesizeV2({
            text: t,
            bundleName: bundleFor(m, voice, emotion),
            style: m === "g38" ? pair.style : undefined,
            cacheBust,
          });
          patchClip(pair.id, m, { status: "success", playUrl: r.playUrl, sttStatus: "running" });
          patchClip(pair.id, m, await runStt(r.playUrl, t));
        } catch (e) {
          patchClip(pair.id, m, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }, [text, voice, emotion, style, blind, cacheBust, patchClip]);

  const rate = useCallback((pairId: string, model: ModelKey, patch: Rating) => {
    setPairs((prev) =>
      prev.map((p) =>
        p.id === pairId ? { ...p, ratings: { ...p.ratings, [model]: { ...p.ratings[model], ...patch } } } : p,
      ),
    );
  }, []);

  const savePair = useCallback(
    (pair: Pair) => {
      const at = new Date().toISOString();
      const entries: LogEntry[] = (["g25", "g38"] as ModelKey[]).map((m) => ({
        at,
        voice: pair.voice,
        emotion: pair.emotion,
        model: m,
        style: m === "g38" ? pair.style : "(기존 프롬프트)",
        text: pair.text,
        quality: pair.ratings[m]?.quality ?? null,
        fit: pair.ratings[m]?.fit ?? null,
        sttScore: pair.clips[m]?.sttScore ?? null,
      }));
      setLog((prev) => {
        const next = [...entries, ...prev];
        saveJson(LOG_KEY, next);
        return next;
      });
      setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, saved: true } : p)));
    },
    [],
  );

  const runSweep = useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    const list: SweepItem[] = [
      ...candidates.map((s, i) => ({ style: s, label: `${i}단계`, clip: { status: "loading" as const } })),
      { style: ANNOUNCER_STYLE, label: "아나운서", clip: { status: "loading" as const } },
    ];
    setSweep(list);
    setSweepMeta({ voice, emotion, text: t });
    const patch = (i: number, c: Partial<Clip>) =>
      setSweep((prev) => prev.map((x, j) => (j === i ? { ...x, clip: { ...x.clip, ...c } } : x)));
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        try {
          const r = await synthesizeV2({
            text: t,
            bundleName: bundleFor("g38", voice, emotion),
            style: list[i]!.style,
            cacheBust,
          });
          patch(i, { status: "success", playUrl: r.playUrl, sttStatus: "running" });
          patch(i, await runStt(r.playUrl, t));
        } catch (e) {
          patch(i, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }, [text, candidates, voice, emotion, cacheBust]);

  const saveSweepFit = useCallback(
    (i: number, fit: Fit) => {
      if (!sweepMeta) return;
      const item = sweep[i];
      if (!item) return;
      setSweep((prev) => prev.map((x, j) => (j === i ? { ...x, fit } : x)));
      setLog((prev) => {
        const next: LogEntry[] = [
          {
            at: new Date().toISOString(),
            voice: sweepMeta.voice,
            emotion: sweepMeta.emotion,
            model: "g38",
            style: item.style,
            text: sweepMeta.text,
            quality: null,
            fit,
            sttScore: item.clip.sttScore ?? null,
          },
          ...prev,
        ];
        saveJson(LOG_KEY, next);
        return next;
      });
    },
    [sweep, sweepMeta],
  );

  const summary = useMemo(() => {
    const keys: Array<[VoiceGroup, ModelKey]> = [
      ["female", "g25"], ["female", "g38"], ["male", "g25"], ["male", "g38"],
    ];
    return keys.map(([g, m]) => {
      const es = log.filter((e) => voiceGroup(e.voice) === g && e.model === m);
      const q = es.filter((e) => e.quality != null).map((e) => e.quality!);
      const fits = es.filter((e) => e.fit != null);
      return {
        g,
        m,
        n: es.length,
        quality: q.length ? q.reduce((a, b) => a + b, 0) / q.length : null,
        qn: q.length,
        fitYes: fits.length ? fits.filter((e) => e.fit === "yes").length / fits.length : null,
        fn: fits.length,
      };
    });
  }, [log]);

  const exportLog = () =>
    downloadText(
      `gemini-2.5-vs-3.8-청취-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        ["시각", "보이스", "감정", "모델", "style", "문장", "음질(1-5)", "목표 목소리", "STT 일치율"],
        ...log.map((e) => [
          e.at, e.voice, e.emotion, MODEL_LABEL[e.model], e.style, e.text,
          e.quality, e.fit ? FIT_LABEL[e.fit] : "", e.sttScore != null ? (e.sttScore * 100).toFixed(0) : "",
        ]),
      ]),
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-lg">2.5 Pro와 3.8 비교 청취</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            같은 문장을 2.5 번들(<span className="font-mono">{bundleFor("g25", voice, emotion)}</span>)과 3.8 번들(
            <span className="font-mono">{bundleFor("g38", voice, emotion)}</span>)로 만들어 나란히 들음. 블라인드를 켜면 어느 쪽이
            어느 모델인지 평가를 저장한 뒤에 공개됨.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">보이스</Label>
              <Select value={voice} onValueChange={(v) => setVoice(v as CompareVoice)}>
                <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPARE_VOICES.map((v) => (
                    <SelectItem key={v} value={v} className="text-sm">
                      {v} ({voiceGroup(v) === "female" ? "여자 LAURA" : "남자 아이"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">감정</Label>
              <Select value={emotion} onValueChange={(v) => setEmotion(v as CompareEmotion)}>
                <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPARE_EMOTIONS.map((e) => (
                    <SelectItem key={e} value={e} className="text-sm">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            목표 목소리: <span className="font-medium text-foreground">{TARGET_VOICE_LABEL[group]}</span>
          </p>

          <div className="space-y-2">
            <SentencePresetSelect value={text} onChange={setText} />
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">3.8 style (2.5는 번들의 기존 프롬프트를 그대로 씀)</Label>
            <Select
              value={candidates.includes(style) ? `c:${style}` : style === ANNOUNCER_STYLE ? "announcer" : "custom"}
              onValueChange={(v) => {
                if (v === "announcer") setStyle(ANNOUNCER_STYLE);
                else if (v.startsWith("c:")) setStyle(v.slice(2));
              }}
            >
              <SelectTrigger className="h-10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {candidates.map((s, i) => (
                  <SelectItem key={i} value={`c:${s}`} className="text-xs">
                    {i}단계: {s || "(빈 값)"}
                  </SelectItem>
                ))}
                <SelectItem value="announcer" className="text-xs">아나운서 (학습자용 또박또박)</SelectItem>
                <SelectItem value="custom" className="text-xs">직접 입력</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="(빈 값: style 없이 보냄)"
              className="h-9 font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={blind} onCheckedChange={setBlind} /> 블라인드
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={cacheBust} onCheckedChange={setCacheBust} /> 캐시 우회
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void generatePair()} disabled={!text.trim()}>
              2.5 / 3.8 한 쌍 생성
            </Button>
            <Button type="button" variant="outline" onClick={() => void runSweep()} disabled={!text.trim()}>
              3.8 style 후보 전부 생성
            </Button>
          </div>
        </CardContent>
      </Card>

      {sweepMeta && sweep.length > 0 ? (
        <Card>
          <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
            <CardTitle className="text-base">
              3.8 style 후보: {sweepMeta.voice} {sweepMeta.emotion}
            </CardTitle>
            <CardDescription className="text-xs">
              같은 문장을 style만 바꿔 생성함. 목표 목소리({TARGET_VOICE_LABEL[voiceGroup(sweepMeta.voice)]})에 맞는지 고르면 기록에 저장됨.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 sm:px-6">
            {sweep.map((it, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline" className="text-[10px]">{it.label}</Badge>
                  <span className="break-all font-mono text-xs">{it.style || "(빈 값)"}</span>
                </div>
                {it.clip.status === "loading" ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 생성 중
                  </p>
                ) : it.clip.status === "error" ? (
                  <p className="text-xs text-destructive">{it.clip.error}</p>
                ) : it.clip.playUrl ? (
                  <>
                    <AudioWithMsTime src={it.clip.playUrl} className="w-full max-w-md" />
                    <SttLine clip={it.clip} />
                    <ChoiceRow<Fit>
                      value={it.fit}
                      options={(["yes", "meh", "no"] as Fit[]).map((f) => [f, `목표 목소리 ${FIT_LABEL[f]}`])}
                      onPick={(f) => saveSweepFit(i, f)}
                    />
                  </>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {pairs.map((pair) => {
        const ready = pair.order.every((m) => pair.clips[m]?.status !== "loading");
        const complete = pair.order.every((m) => pair.ratings[m]?.quality != null && pair.ratings[m]?.fit != null);
        const reveal = !pair.blind || pair.saved;
        return (
          <Card key={pair.id}>
            <CardHeader className="space-y-1 px-4 pb-2 pt-4 sm:px-6">
              <CardTitle className="text-base">
                {pair.voice} {pair.emotion}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  목표: {TARGET_VOICE_LABEL[voiceGroup(pair.voice)]}
                </span>
              </CardTitle>
              <CardDescription className="break-words text-xs">
                {pair.text}
                <br />
                3.8 style: <span className="font-mono">{pair.style || "(빈 값)"}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 sm:px-6">
              <div className="grid gap-3 md:grid-cols-2">
                {pair.order.map((m, idx) => {
                  const clip = pair.clips[m] ?? { status: "loading" as const };
                  const r = pair.ratings[m] ?? {};
                  return (
                    <div key={m} className="min-w-0 space-y-2 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{idx === 0 ? "X" : "Y"}</span>
                        {reveal ? (
                          <Badge variant={m === "g38" ? "default" : "secondary"} className="text-[10px]">
                            {MODEL_LABEL[m]}
                          </Badge>
                        ) : null}
                      </div>
                      {clip.status === "loading" ? (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 생성 중
                        </p>
                      ) : clip.status === "error" ? (
                        <p className="break-words text-xs text-destructive">{clip.error}</p>
                      ) : clip.playUrl ? (
                        <AudioWithMsTime src={clip.playUrl} className="w-full" />
                      ) : null}
                      <SttLine clip={clip} />
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">음질 (1 나쁨 ~ 5 좋음)</p>
                        <ChoiceRow<number>
                          value={r.quality}
                          options={[1, 2, 3, 4, 5].map((n) => [n, String(n)])}
                          onPick={(n) => rate(pair.id, m, { quality: n })}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">목표 목소리에 맞는가</p>
                        <ChoiceRow<Fit>
                          value={r.fit}
                          options={(["yes", "meh", "no"] as Fit[]).map((f) => [f, FIT_LABEL[f]])}
                          onPick={(f) => rate(pair.id, m, { fit: f })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!ready || !complete || pair.saved}
                  onClick={() => savePair(pair)}
                >
                  {pair.saved ? "저장됨" : pair.blind ? "평가 저장하고 정답 보기" : "평가 저장"}
                </Button>
                {!complete && !pair.saved ? (
                  <span className="text-xs text-muted-foreground">두 음성 모두 음질과 목표 목소리를 고르면 저장할 수 있음</span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base">청취 기록 요약</CardTitle>
          <CardDescription className="text-xs">
            이 브라우저에 저장된 평가 총 {log.length}건. style 후보 평가도 3.8 쪽에 함께 집계됨.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-6">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">목표 목소리</th>
                  <th className="py-2 pr-3 font-medium">모델</th>
                  <th className="py-2 pr-3 font-medium">평가 수</th>
                  <th className="py-2 pr-3 font-medium">평균 음질</th>
                  <th className="py-2 font-medium">목표 목소리 &quot;맞음&quot;</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={`${s.g}-${s.m}`} className="border-b last:border-0">
                    <td className="py-2 pr-3">{s.g === "female" ? "여자 LAURA" : "남자 아이"}</td>
                    <td className="py-2 pr-3">{MODEL_LABEL[s.m]}</td>
                    <td className="py-2 pr-3 tabular-nums">{s.n}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {s.quality != null ? `${s.quality.toFixed(2)} (${s.qn}건)` : "—"}
                    </td>
                    <td className={cn("py-2 tabular-nums")}>
                      {s.fitYes != null ? `${pct(s.fitYes, 0)} (${s.fn}건)` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={log.length === 0} onClick={exportLog}>
            기록 CSV 내려받기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
