"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SWEEP_TEXT,
  findPresetByText,
  SENTENCE_PRESETS,
} from "@/lib/sentence-presets";
import { cn } from "@/lib/utils";

const CUSTOM = "__custom__";
const DEFAULT = "__default__";

/**
 * LAURA 다빈도 문장 20개 중 하나를 골라 발화 텍스트에 넣는 셀렉트.
 * 직접 입력한 문장이면 "직접 입력"으로 표시되고, 표준 문장이면 그대로 알아본다.
 */
export function SentencePresetSelect({
  value,
  onChange,
  className,
  label = "문장 프리셋",
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  label?: string;
}) {
  const matched = findPresetByText(value);
  const isDefault = value.trim() === DEFAULT_SWEEP_TEXT;
  const current = matched ? String(matched.no) : isDefault ? DEFAULT : CUSTOM;

  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select
        value={current}
        onValueChange={(v) => {
          if (v === CUSTOM) return;
          if (v === DEFAULT) {
            onChange(DEFAULT_SWEEP_TEXT);
            return;
          }
          const p = SENTENCE_PRESETS.find((x) => String(x.no) === v);
          if (p) onChange(p.text);
        }}
      >
        <SelectTrigger className="h-10 w-full text-xs">
          <SelectValue placeholder="문장 선택" />
        </SelectTrigger>
        <SelectContent className="max-w-[min(92vw,44rem)]">
          <SelectItem value={DEFAULT} className="text-xs">
            표준 측정 문장 (23음절)
          </SelectItem>
          {current === CUSTOM ? (
            <SelectItem value={CUSTOM} className="text-xs">
              직접 입력
            </SelectItem>
          ) : null}
          {SENTENCE_PRESETS.map((p) => (
            <SelectItem key={p.no} value={String(p.no)} className="text-xs">
              <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">
                {String(p.no).padStart(2, "0")}
              </span>
              <span className="line-clamp-2">{p.text}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
