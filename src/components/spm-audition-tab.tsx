"use client";

import { useCallback, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { proxyPlayUrl } from "@/lib/tts-sse";
import { cn } from "@/lib/utils";
import {
  groupProfilesByProvider,
  TTS_PROVIDER_LABELS,
  voiceProfileLabel,
} from "@/lib/voice-table";
import { spmRecommendationFor, type SpmLevelRecommendation } from "@/lib/spm-recommendations";
import { Loader2 } from "lucide-react";

const API_BASE = "/api";
const DEFAULT_TEXT =
  "The little bird flew over the tall trees and landed on the old wooden fence near the river.";

type Level = "beginner" | "intermediate" | "advanced";
const LEVELS: { key: Level; label: string }[] = [
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];

type ClipState = { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string };

function levelSpm(rec: SpmLevelRecommendation, lvl: Level): number {
  return rec[lvl];
}
function levelWpm(rec: SpmLevelRecommendation, lvl: Level): number | undefined {
  return rec[`${lvl}Wpm` as const];
}

export function SpmAuditionTab() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [clips, setClips] = useState<Record<string, ClipState>>({});
  const groups = useMemo(() => groupProfilesByProvider(), []);

  const generate = useCallback(
    async (bundleName: string, lvl: Level, spm: number) => {
      const key = `${bundleName}|${lvl}`;
      setClips((p) => ({ ...p, [key]: { status: "loading" } }));
      try {
        const res = await fetch(`${API_BASE}/spm-synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim(), bundleName, spm, platform: "PLAYGROUND" }),
        });
        const j = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !j.url) throw new Error(j.error || `요청 실패 (${res.status})`);
        setClips((p) => ({ ...p, [key]: { status: "ready", url: proxyPlayUrl(j.url!) } }));
      } catch (e) {
        setClips((p) => ({
          ...p,
          [key]: { status: "error", error: e instanceof Error ? e.message : String(e) },
        }));
      }
    },
    [text],
  );

  return (
    <div className="space-y-4">
      <Alert className="text-sm">
        <AlertTitle className="text-sm sm:text-base">VP별 B / I / A 청취</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed sm:text-sm">
          각 VP의 추천 레벨 버튼을 누르면 그 요청 spm으로 실제 음원을 생성해 재생합니다(같은 문장 + spm은
          서버 캐시로 즉시). 간격 25/35 고정, GEMINI는 자연속도 앵커 / 비-GEMINI는 clean floor 0.6 앵커.
          spm 옆 wpm은 실측 자연속도 기반 예상 청감 속도입니다.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base">청취 문장</CardTitle>
          <CardDescription className="text-xs">
            전 VP 공통으로 이 문장을 사용합니다. 바꾸면 이후 생성분에 적용됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Label htmlFor="aud-text" className="sr-only">
            청취 문장
          </Label>
          <Textarea
            id="aud-text"
            rows={2}
            className="min-h-[4rem] resize-y text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </CardContent>
      </Card>

      {groups.map((g) => (
        <Card key={g.provider}>
          <CardHeader className="px-4 pb-2 pt-4 sm:px-6">
            <CardTitle className="text-base">{TTS_PROVIDER_LABELS[g.provider]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 sm:px-6">
            {g.profiles.map((p) => {
              const rec = spmRecommendationFor(p.bundleName);
              return (
                <div
                  key={p.bundleName}
                  className="flex flex-col gap-2 border-b border-border py-2 last:border-0 lg:flex-row lg:items-center lg:gap-4"
                >
                  <div className="min-w-0 lg:w-[280px] lg:shrink-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-xs">{p.bundleName}</span>
                      {rec?.category ? (
                        <Badge
                          variant={rec.category === "child" ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          {rec.category === "child" ? "child" : "fast"}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {voiceProfileLabel(p)}
                      {p.baseSpm != null ? ` · base ${p.baseSpm}` : ""}
                    </span>
                  </div>
                  {rec ? (
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                      {LEVELS.map(({ key, label }) => {
                        const spm = levelSpm(rec, key);
                        const wpm = levelWpm(rec, key);
                        const ck = `${p.bundleName}|${key}`;
                        const st = clips[ck] ?? { status: "idle" as const };
                        return (
                          <div key={key} className="min-w-0">
                            {st.status === "ready" && st.url ? (
                              <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground">
                                  {label} · spm {spm}
                                  {wpm != null ? ` · ~${wpm}wpm` : ""}
                                </span>
                                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                <audio controls autoPlay preload="none" src={st.url} className="h-8 w-full" />
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 w-full flex-col items-start gap-0 py-1 sm:h-10"
                                disabled={st.status === "loading" || !text.trim()}
                                onClick={() => void generate(p.bundleName, key, spm)}
                              >
                                <span className="flex items-center gap-1 text-xs font-medium">
                                  {st.status === "loading" ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : null}
                                  {label}
                                </span>
                                <span
                                  className={cn(
                                    "text-[10px] font-normal",
                                    st.status === "error" ? "text-destructive" : "text-muted-foreground",
                                  )}
                                >
                                  {st.status === "error"
                                    ? "실패 - 재시도"
                                    : `spm ${spm}${wpm != null ? ` · ~${wpm}wpm` : ""}`}
                                </span>
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="flex-1 text-xs text-muted-foreground">
                      추천값 없음 (v2 미지원)
                    </span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
