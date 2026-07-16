#!/usr/bin/env python3
"""
spm_sweep.py 결과 후처리:
  1. ffmpeg silencedetect로 선행·후행 무음을 재고 speech-only 길이·SPM 재계산
     (프로바이더별 꼬리 무음 0.3~0.9초 편차가 실측 SPM을 왜곡하므로)
  2. gpt-4o-transcribe STT 재실행(누락분)
  3. rate 극단값(0.5~2.4 × 역산 baseSpm) 추가 스윕 — 저속 기계음·고속 붕괴·프로바이더
     상한(GCP speakingRate 2.0 등) 경계 탐지
결과는 results.json에 병합 저장.

사용: python3 scripts/spm_postprocess.py [--skip-extremes] [--skip-stt]
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import (  # noqa: E402
    SWEEP_SYLLABLES,
    SWEEP_TEXT,
    SWEEP_WORDS,
    load_auth_token,
    norm_words,
    probe_duration_sec,
    stt_transcribe,
    synthesize,
    download,
)

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"

# 극단 rate 배수 — 저속 기계음 하한과 고속 붕괴/프로바이더 상한 경계 탐지
EXTREME_RATES = [0.5, 0.65, 0.8, 1.7, 1.9, 2.1, 2.4]


def speech_bounds_sec(path: Path) -> tuple[float, float, float] | None:
    """(전체 길이, 선행 무음, 후행 무음) — silencedetect -35dB/0.25s 기준"""
    try:
        out = subprocess.run(
            ["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-35dB:d=0.25",
             "-f", "null", "-"],
            capture_output=True, text=True, timeout=60,
        ).stderr
    except Exception:  # noqa: BLE001
        return None
    total = probe_duration_sec(path)
    if not total:
        return None
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", out)]
    lead = 0.0
    tail = 0.0
    for s, e in zip(starts, ends + [total]):
        if s <= 0.05:
            lead = e
        if e >= total - 0.05:
            tail = total - s
    # 끝나지 않은 무음(파일 끝까지)
    if starts and (len(ends) < len(starts) or ends[-1] < starts[-1]):
        tail = total - starts[-1]
    return total, lead, tail


def enrich_row(row: dict) -> None:
    f = row.get("file")
    if not f or not Path(f).exists():
        return
    b = speech_bounds_sec(Path(f))
    if not b:
        return
    total, lead, tail = b
    speech = max(0.2, total - lead - tail)
    row["speechDurationSec"] = round(speech, 3)
    row["leadSilenceSec"] = round(lead, 3)
    row["tailSilenceSec"] = round(tail, 3)
    row["speechSpm"] = round(SWEEP_SYLLABLES / speech * 60, 1)
    row["speechWpm"] = round(SWEEP_WORDS / speech * 60, 1)


def add_stt_missing(results: list[dict], api_key: str) -> None:
    jobs = [
        row
        for res in results
        for row in res["rows"]
        if row.get("ok") and row.get("file") and "sttScore" not in row
    ]
    print(f"STT 대상 {len(jobs)}건", flush=True)

    def work(row: dict) -> None:
        t = stt_transcribe(api_key, Path(row["file"]))
        if t is None:
            row["sttError"] = True
            return
        row.pop("sttError", None)
        row["sttTranscript"] = t
        ratio = difflib.SequenceMatcher(
            None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))
        ).ratio()
        row["sttScore"] = round(ratio, 3)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(work, jobs))


def run_extremes(results: list[dict], token: str, audio_root: Path) -> None:
    supported = [r for r in results if r["spmSupported"] and r.get("derivedBaseSpmMedian")]
    print(f"극단값 스윕 — {len(supported)}개 번들 × {len(EXTREME_RATES)}점", flush=True)

    def sweep_one(res: dict) -> None:
        bundle = res["bundle"]
        base = res["derivedBaseSpmMedian"]
        existing = {r["spm"] for r in res["rows"] if r.get("spm")}
        bundle_dir = audio_root / bundle
        bundle_dir.mkdir(parents=True, exist_ok=True)
        base_row = next((r for r in res["rows"] if r["spm"] is None and r.get("ok")), None)
        base_dur = base_row.get("durationSec") if base_row else None
        for rate in EXTREME_RATES:
            spm = round(base * rate)
            if spm in existing or spm <= 0:
                continue
            r = synthesize(token, bundle, spm)
            row: dict = {
                "bundle": bundle, "spm": spm, "label": str(spm),
                "targetRate": rate, "phase": "extreme", **r,
            }
            if r["ok"]:
                f = bundle_dir / f"{spm}.mp3"
                if download(r["url"], f):
                    dur = probe_duration_sec(f)
                    if dur:
                        row["durationSec"] = round(dur, 3)
                        row["measuredSpm"] = round(SWEEP_SYLLABLES / dur * 60, 1)
                        row["measuredWpm"] = round(SWEEP_WORDS / dur * 60, 1)
                    row["file"] = str(f)
                if base_dur and row.get("durationSec"):
                    row["derivedBaseSpm"] = round(spm * row["durationSec"] / base_dur, 1)
            res["rows"].append(row)
            time.sleep(0.3)
        ok_n = sum(1 for r in res["rows"] if r.get("phase") == "extreme" and r.get("ok"))
        print(f"[{bundle}] extremes {ok_n}/{len(EXTREME_RATES)} ok", flush=True)

    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(sweep_one, supported))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-extremes", action="store_true")
    ap.add_argument("--skip-stt", action="store_true")
    args = ap.parse_args()

    results_path = OUT_DIR / "results.json"
    data = json.loads(results_path.read_text())
    results = data["results"]

    audio_root = None
    for res in results:
        for row in res["rows"]:
            if row.get("file"):
                audio_root = Path(row["file"]).parent.parent
                break
        if audio_root:
            break
    if not audio_root:
        print("오디오 파일 경로를 찾을 수 없음", file=sys.stderr)
        sys.exit(1)

    if not args.skip_extremes:
        token = load_auth_token()
        run_extremes(results, token, audio_root)

    print("무음 트리밍 재계산...", flush=True)
    all_rows = [r for res in results for r in res["rows"] if r.get("ok")]
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(enrich_row, all_rows))

    # speech 기준 역산 baseSpm 재계산
    for res in results:
        base_row = next((r for r in res["rows"] if r["spm"] is None and r.get("ok")), None)
        base_speech = base_row.get("speechDurationSec") if base_row else None
        derived = []
        for row in res["rows"]:
            if row.get("spm") and row.get("speechDurationSec") and base_speech:
                d = round(row["spm"] * row["speechDurationSec"] / base_speech, 1)
                row["derivedBaseSpmSpeech"] = d
                derived.append(d)
        if derived:
            derived.sort()
            res["derivedBaseSpmSpeechMedian"] = derived[len(derived) // 2]
        if base_row:
            res["baselineSpeechSpm"] = base_row.get("speechSpm")

    if not args.skip_stt:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("OPENAI_API_KEY 없음 — STT 생략", file=sys.stderr)
        else:
            add_stt_missing(results, api_key)

    data["postprocessedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    results_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"완료 — {results_path}", flush=True)


if __name__ == "__main__":
    main()
