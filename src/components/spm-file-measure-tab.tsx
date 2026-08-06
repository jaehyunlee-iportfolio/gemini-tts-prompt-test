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
import { Textarea } from "@/components/ui/textarea";
import { AudioWithMsTime } from "@/components/audio-with-ms-time";
import {
  analyzeAudioFile,
  SILENCE_THRESHOLD_DB,
  type AudioAnalysis,
} from "@/lib/audio-analysis";
import { countTextSyllables } from "@/lib/syllables";
import { cn } from "@/lib/utils";
import { Loader2, Upload, X } from "lucide-react";

const DEFAULT_TEXT =
  "The little bird flew over the tall trees and landed on the old wooden fence near the river.";

type FileRow = {
  id: string;
  name: string;
  sizeBytes: number;
  objectUrl: string;
  status: "analyzing" | "done" | "error";
  error?: string;
  analysis?: AudioAnalysis;
};

function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[a-zA-Z0-9]/.test(t)).length;
}

function perMinute(count: number, seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || count <= 0) return null;
  return Math.round((count / (seconds / 60)) * 10) / 10;
}

function fmtSec(v?: number): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}s`;
}

function fmtKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export function SpmFileMeasureTab() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [rows, setRows] = useState<FileRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // 언마운트 시 objectURL 정리 — 메모리 누수 방지
  useEffect(() => {
    return () => {
      for (const r of rowsRef.current) URL.revokeObjectURL(r.objectUrl);
    };
  }, []);

  const syllables = useMemo(() => countTextSyllables(text), [text]);
  const words = useMemo(() => countWords(text), [text]);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming: FileRow[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      sizeBytes: f.size,
      objectUrl: URL.createObjectURL(f),
      status: "analyzing" as const,
    }));
    setRows((prev) => [...prev, ...incoming]);

    await Promise.all(
      Array.from(files).map(async (file, i) => {
        const row = incoming[i];
        const analysis = await analyzeAudioFile(file);
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? analysis
                ? { ...r, status: "done" as const, analysis }
                : {
                    ...r,
                    status: "error" as const,
                    error: "디코드 실패 — 오디오 파일이 맞는지 확인해 주세요.",
                  }
              : r,
          ),
        );
      }),
    );
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setRows((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.objectUrl);
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const copyCsv = useCallback(() => {
    const header =
      "file,syllables,words,totalSec,leadSilenceSec,tailSilenceSec,speechSec,spmTotal,spmSpeech,wpmSpeech";
    const lines = rowsRef.current
      .filter((r) => r.analysis)
      .map((r) => {
        const a = r.analysis!;
        return [
          `"${r.name.replaceAll('"', '""')}"`,
          syllables,
          words,
          a.totalSec.toFixed(3),
          a.leadSilenceSec.toFixed(3),
          a.tailSilenceSec.toFixed(3),
          a.speechSec.toFixed(3),
          perMinute(syllables, a.totalSec) ?? "",
          perMinute(syllables, a.speechSec) ?? "",
          perMinute(words, a.speechSec) ?? "",
        ].join(",");
      });
    void navigator.clipboard.writeText([header, ...lines].join("\n"));
  }, [syllables, words]);

  const doneCount = rows.filter((r) => r.analysis).length;

  return (
    <div className="space-y-4">
      <Alert className="text-sm">
        <AlertTitle className="text-sm sm:text-base">파일 SPM 측정</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed sm:text-sm">
          mp3 등 오디오 파일을 올리고 그 음원이 읽은 문장을 입력하면 실제 발화 속도를
          계산합니다. 브라우저에서만 처리하며 파일을 서버로 보내지 않습니다.
          <span className="font-medium"> 총 길이 기준</span>과{" "}
          <span className="font-medium">발화 구간 기준</span>(앞뒤 무음 제외) 두 값을 함께 냅니다.
          프로바이더마다 꼬리 무음이 0.3~0.9초씩 달라 총 길이만 보면 발화 속도가 실제보다
          느리게 나옵니다.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
          <CardTitle className="text-base sm:text-lg">1. 타겟 문장</CardTitle>
          <CardDescription className="text-xs">
            음원이 실제로 읽은 문장이어야 정확합니다. 문장을 바꾸면 아래 결과가 즉시 다시
            계산됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-4 sm:px-6">
          <Label htmlFor="measure-text" className="sr-only">
            타겟 문장
          </Label>
          <Textarea
            id="measure-text"
            rows={3}
            className="min-h-[5rem] resize-y text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="음원이 읽은 문장을 그대로 입력하세요."
          />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {syllables}음절
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {words}단어
            </Badge>
            <span>음절 수는 추정치(모음군 휴리스틱)이며 SPM 계산의 분자입니다.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 space-y-0 px-4 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <CardTitle className="text-base sm:text-lg">2. 오디오 파일</CardTitle>
            <CardDescription className="mt-1 text-xs">
              여러 개를 한 번에 올려 비교할 수 있습니다. mp3, wav, m4a 등.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {doneCount > 0 ? (
              <Button variant="outline" size="sm" className="h-9" onClick={copyCsv}>
                CSV 복사
              </Button>
            ) : null}
            {rows.length > 0 ? (
              <Button variant="outline" size="sm" className="h-9" onClick={clearAll}>
                전체 비우기
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              ref={inputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
              multiple
              className="h-11 cursor-pointer text-sm file:mr-3 file:cursor-pointer sm:h-10"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 sm:h-10"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              파일 선택
            </Button>
          </div>

          {rows.length === 0 ? (
            <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-dashed border-border">
              <p className="px-4 text-center text-sm text-muted-foreground">
                오디오 파일을 올리면 총 길이, 무음, 실측 SPM이 여기 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const a = r.analysis;
                const spmTotal = a ? perMinute(syllables, a.totalSec) : null;
                const spmSpeech = a ? perMinute(syllables, a.speechSec) : null;
                const wpmSpeech = a ? perMinute(words, a.speechSec) : null;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "rounded-lg border border-border p-3",
                      r.status === "error" && "border-destructive/50 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block break-all font-mono text-xs font-medium">
                          {r.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {fmtKb(r.sizeBytes)}
                          {a ? ` · ${a.sampleRate}Hz · ${a.channels}ch` : ""}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2"
                        onClick={() => removeRow(r.id)}
                        aria-label={`${r.name} 제거`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {r.status === "analyzing" ? (
                      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 분석 중...
                      </span>
                    ) : null}
                    {r.status === "error" ? (
                      <p className="mt-2 text-xs text-destructive">{r.error}</p>
                    ) : null}

                    {a ? (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <Metric label="실측 SPM (발화 구간)" value={spmSpeech} strong />
                          <Metric label="실측 SPM (총 길이)" value={spmTotal} />
                          <Metric label="WPM (발화 구간)" value={wpmSpeech} />
                          <Metric label="발화 길이" text={fmtSec(a.speechSec)} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                          <span>
                            총 길이 <span className="font-mono">{fmtSec(a.totalSec)}</span>
                          </span>
                          <span>
                            앞 무음 <span className="font-mono">{fmtSec(a.leadSilenceSec)}</span>
                          </span>
                          <span>
                            뒤 무음 <span className="font-mono">{fmtSec(a.tailSilenceSec)}</span>
                          </span>
                          <span>무음 판정 {SILENCE_THRESHOLD_DB}dB</span>
                        </div>
                      </>
                    ) : null}

                    <AudioWithMsTime src={r.objectUrl} className="mt-2 max-w-md" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  text,
  strong,
}: {
  label: string;
  value?: number | null;
  text?: string;
  strong?: boolean;
}) {
  const display = text ?? (value == null ? "—" : String(value));
  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      <span className="block text-[10px] leading-tight text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm",
          strong ? "font-semibold text-foreground" : "text-foreground",
        )}
      >
        {display}
      </span>
    </div>
  );
}
