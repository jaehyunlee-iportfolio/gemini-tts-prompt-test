#!/usr/bin/env python3
"""
실측 SPM이 요청 spm보다 일정 배수로 높게 나오는 원인 진단.

가설
  A) 서버 baseSpm이 실제 자연속도보다 낮게 등록됨 -> rate가 과대 적용되어 빨라짐
  B) 프로바이더가 문장을 끝까지 읽지 않음(누락/절단) -> 길이가 짧아 SPM이 부풀려짐
  C) 무음(선/후 패딩) 차이로 총길이 기준 계산이 왜곡됨

측정
  - baseline(spm 미지정, rate 1.0) 및 spm=baseSpm, spm=165 각각 생성
  - 총길이 / 발화구간만의 길이(무음 제거) 둘 다 측정
  - STT로 실제 발화 텍스트를 받아 원문 단어 보존율 확인 (가설 B 검증)
  - baseline 실측으로 '진짜 baseSpm'을 역산해 서버 값과 대조 (가설 A 검증)
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import (
    SWEEP_TEXT,
    download,
    load_auth_token,
    norm_words,
    probe_duration_sec,
    stt_transcribe,
    synthesize,
)
from spm_postprocess import speech_bounds_sec

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "spm-sweep"
AUDIO = OUT / "deviation-diag-audio"

# 비교군: Azure(문제) / Gemini(정상 대조) / GCP, AWS, CHIRP
TARGETS = [
    ("AZ-Jenny-Cheerful", 154.9),
    ("AZ-Nancy-Default", 148.0),
    ("GEMINI-Rasalgethi-Default", 160.1),
    ("GCP-Jeremy-Default", 239.8),
    ("AWS-Kevin-Default", 227.8),
    ("CHIRP-Zephyr-Default", 219.2),
]

SYLLABLES = 23  # SWEEP_TEXT 음절 수 (UI countTextSyllables와 동일)


def load_openai_key() -> str | None:
    env = ROOT / ".env.local"
    if not env.is_file():
        return os.environ.get("OPENAI_API_KEY")
    for line in env.read_text().splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    return os.environ.get("OPENAI_API_KEY")


def spm_from(dur_sec: float) -> float:
    return round(SYLLABLES / (dur_sec / 60), 1)


def one(token: str, bundle: str, spm: float | None, tag: str, api_key: str | None) -> dict:
    r = synthesize(token, bundle, spm)
    row: dict = {"tag": tag, "requestSpm": spm}
    if not r.get("ok"):
        row["error"] = str(r.get("error") or r.get("detail"))[:160]
        return row
    f = AUDIO / f"{bundle}__{tag}.mp3"
    if not download(r["url"], f):
        row["error"] = "download failed"
        return row

    total = probe_duration_sec(f)
    row["totalSec"] = round(total, 3) if total else None
    if total:
        row["totalSpm"] = spm_from(total)

    b = speech_bounds_sec(f)
    if b:
        t, lead, tail = b
        speech = max(0.05, t - lead - tail)
        row["leadSilenceSec"] = round(lead, 3)
        row["tailSilenceSec"] = round(tail, 3)
        row["speechSec"] = round(speech, 3)
        row["speechSpm"] = spm_from(speech)

    if api_key:
        tr = stt_transcribe(api_key, f)
        if tr:
            row["transcript"] = tr
            src, got = norm_words(SWEEP_TEXT), norm_words(tr)
            kept = sum(1 for w in src if w in got)
            row["wordsExpected"] = len(src)
            row["wordsHeard"] = len(got)
            row["wordKeepPct"] = round(kept / len(src) * 100)
    return row


def main() -> None:
    token = load_auth_token()
    api_key = load_openai_key()
    AUDIO.mkdir(parents=True, exist_ok=True)
    print(f"진단 시작 (음절 {SYLLABLES}, STT {'on' if api_key else 'off'})")
    print(f"문장: {SWEEP_TEXT}\n")

    out = []
    for bundle, server_base in TARGETS:
        print(f"--- {bundle} (서버 baseSpm {server_base})", flush=True)
        rows = [
            one(token, bundle, None, "baseline", api_key),
            one(token, bundle, server_base, "at_basespm", api_key),
            one(token, bundle, 165, "at_165", api_key),
        ]
        base_row = rows[0]
        real_base = base_row.get("speechSpm") or base_row.get("totalSpm")
        entry = {
            "bundle": bundle,
            "serverBaseSpm": server_base,
            "realBaseSpmMeasured": real_base,
            "baseSpmErrorRatio": round(real_base / server_base, 3) if real_base else None,
            "rows": rows,
        }
        out.append(entry)

        for r in rows:
            if r.get("error"):
                print(f"    {r['tag']:11} 실패: {r['error']}", flush=True)
                continue
            print(
                f"    {r['tag']:11} req={str(r['requestSpm']):>6} "
                f"총{r.get('totalSec')}s(={r.get('totalSpm')}) "
                f"발화{r.get('speechSec')}s(={r.get('speechSpm')}) "
                f"무음 앞{r.get('leadSilenceSec')}/뒤{r.get('tailSilenceSec')} "
                f"단어보존{r.get('wordKeepPct')}%",
                flush=True,
            )
        if real_base:
            print(
                f"    => 실측 자연속도 {real_base} SPM vs 서버 {server_base} "
                f"= {entry['baseSpmErrorRatio']}배\n", flush=True,
            )

    (OUT / "deviation-diag.json").write_text(
        json.dumps({"text": SWEEP_TEXT, "syllables": SYLLABLES, "results": out},
                   ensure_ascii=False, indent=2)
    )

    print("=== 결론 요약 ===", flush=True)
    for e in out:
        ratio = e["baseSpmErrorRatio"]
        print(
            f"  {e['bundle']:28} 서버base {e['serverBaseSpm']:>6} / "
            f"실측 {e['realBaseSpmMeasured']} => {ratio}배", flush=True,
        )
    print(f"\n산출물: {OUT}/deviation-diag.json", flush=True)


if __name__ == "__main__":
    main()
