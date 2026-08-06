"use client";

import { cn } from "@/lib/utils";

/**
 * 실측 SPM 한 줄 표시 — 오디오 길이에서 계산한 실제 발화 속도.
 * 요청 spm과의 괴리율을 함께 보여, 그 VP에서 요청값이 실제로 얼마로 떨어지는지 판단하게 한다.
 * (프로바이더/VP마다 서버 baseSpm의 정확도가 달라 괴리가 크게 벌어질 수 있음)
 */
export function MeasuredSpmLine({
  requestSpm,
  measuredSpm,
  className,
}: {
  requestSpm: number;
  measuredSpm?: number | null;
  className?: string;
}) {
  if (measuredSpm == null) {
    return (
      <span className={cn("block text-[10px] text-muted-foreground", className)}>
        실측 측정 중...
      </span>
    );
  }

  const deltaPct =
    requestSpm > 0 ? Math.round(((measuredSpm - requestSpm) / requestSpm) * 100) : null;

  return (
    <span className={cn("block text-[10px]", className)}>
      <span className="text-muted-foreground">실측 </span>
      <span className="font-mono font-medium text-foreground">{measuredSpm} SPM</span>
      {deltaPct != null ? (
        <span
          className={cn(
            "ml-1 font-mono",
            Math.abs(deltaPct) > 15
              ? "text-destructive"
              : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          ({deltaPct >= 0 ? "+" : ""}
          {deltaPct}%)
        </span>
      ) : null}
    </span>
  );
}
