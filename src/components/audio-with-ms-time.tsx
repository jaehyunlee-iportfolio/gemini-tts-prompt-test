"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveAudioDurationMs } from "@/lib/audio-duration";
import { cn } from "@/lib/utils";

/**
 * 네이티브 오디오 플레이어 + 밀리초 단위 시간 표시.
 *
 * 네이티브 controls는 초 단위(0:05)까지만 보여주고 표시 형식을 바꿀 수 없어서,
 * 아래에 현재 위치와 전체 길이를 ms까지 따로 표기한다. 재생 중에는
 * requestAnimationFrame으로 갱신한다(timeupdate는 초당 4회 정도라 ms 표시에 부족).
 *
 * 길이가 확정되면 onDurationMs로 알려준다 — 실측 SPM 계산에 쓰인다.
 * duration이 Infinity로 오는 경우는 resolveAudioDurationMs가 보정한다.
 */
export function AudioWithMsTime({
  src,
  autoPlay,
  className,
  timeClassName,
  onDurationMs,
}: {
  src: string;
  autoPlay?: boolean;
  className?: string;
  timeClassName?: string;
  onDurationMs?: (durationMs: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const syncNow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCurrentMs(Math.round(el.currentTime * 1000));
  }, []);

  const tick = useCallback(() => {
    syncNow();
    rafRef.current = requestAnimationFrame(tick);
  }, [syncNow]);

  useEffect(() => stopRaf, [stopRaf]);

  // src가 바뀌면 표시 초기화
  useEffect(() => {
    setCurrentMs(0);
    setDurationMs(null);
  }, [src]);

  const handleLoadedMetadata = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    void resolveAudioDurationMs(el).then((ms) => {
      if (ms == null) return;
      setDurationMs(ms);
      onDurationMs?.(ms);
    });
  }, [onDurationMs]);

  return (
    <div className={cn("space-y-0.5", className)}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={ref}
        controls
        autoPlay={autoPlay}
        preload="metadata"
        src={src}
        className="h-8 w-full"
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => {
          stopRaf();
          rafRef.current = requestAnimationFrame(tick);
        }}
        onPause={() => {
          stopRaf();
          syncNow();
        }}
        onEnded={() => {
          stopRaf();
          syncNow();
        }}
        onSeeked={syncNow}
        // 항상 동기화한다 — 탭이 백그라운드면 requestAnimationFrame이 멈추므로
        // rAF 등록 여부로 분기하면 시간 표시가 갱신되지 않는다.
        onTimeUpdate={syncNow}
      />
      <span
        className={cn(
          "block font-mono text-[10px] tabular-nums text-muted-foreground",
          timeClassName,
        )}
      >
        {fmtMs(currentMs)} / {durationMs == null ? "—" : fmtMs(durationMs)}
      </span>
    </div>
  );
}

/** 3,142ms -> "3.142s", 65,300ms -> "1:05.300" */
function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const rest = String(ms % 1000).padStart(3, "0");
  if (totalSec < 60) return `${totalSec}.${rest}s`;
  const m = Math.floor(totalSec / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}.${rest}`;
}
