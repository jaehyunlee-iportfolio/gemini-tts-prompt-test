#!/usr/bin/env python3
"""
7-9세 아동 적정 절대 SPM대에서 VP별 B/I/A 확정용 집중 스윕.

이전 rate 배수 방식(baseSpm x 0.8/1.0/1.25)과 달리, 아동에게 맞는 절대 속도대
(대략 100~215 SPM)를 고정 그리드로 전 VP에 동일 적용해 생성한다. 목적:
  - 상한(씹힘/깨짐): gpt-4o-transcribe STT 정확도 하락 + 요청 대비 실측 속도 포화점
  - 하한(기계음): rate = 목표 spm / baseSpm 이 0.72 미만이면 위험으로 표시(청감은 사람이 확정)
  - GEMINI는 발화 지터가 커서 각 지점 3회 반복(cacheBust) 후 중앙값 사용

사용: python3 scripts/spm_child_sweep.py [--out DIR]
"""

from __future__ import annotations

import json
import os
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import (  # noqa: E402
    SWEEP_SYLLABLES,
    SWEEP_TEXT,
    SWEEP_WORDS,
    download,
    load_auth_token,
    norm_words,
    probe_duration_sec,
    stt_transcribe,
    synthesize,
)
from spm_postprocess import speech_bounds_sec  # noqa: E402
import difflib  # noqa: E402

# 7-9세 아동 적정 절대 SPM 그리드 (대략 77~165 WPM 범위)
CHILD_GRID = [100, 115, 130, 145, 160, 175, 190, 205, 220]
GEMINI_REPS = 3
NON_GEMINI_REPS = 1
CONCURRENCY = 3

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"


def load_base_spm() -> dict:
    """voice-table.ts에서 bundleName -> baseSpm 파싱"""
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    out = {}
    for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts):
        out[m.group(1)] = float(m.group(2))
    return out


def stt_score(api_key: str, path: Path) -> float | None:
    t = stt_transcribe(api_key, path)
    if t is None:
        return None
    return round(
        difflib.SequenceMatcher(
            None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))
        ).ratio(),
        3,
    )


def sweep_point(token, api_key, bundle, spm, base_spm, audio_dir, reps) -> dict:
    speech_spms, stts, rates_eff = [], [], []
    bundle_dir = audio_dir / bundle
    bundle_dir.mkdir(parents=True, exist_ok=True)
    ok = 0
    base_speech = None
    for rep in range(reps):
        r = synthesize(token, bundle, spm)
        if not r.get("ok"):
            continue
        f = bundle_dir / f"{spm}_{rep}.mp3"
        if not download(r["url"], f):
            continue
        b = speech_bounds_sec(f)
        if not b:
            continue
        total, lead, tail = b
        speech = max(0.2, total - lead - tail)
        speech_spms.append(round(SWEEP_SYLLABLES / speech * 60, 1))
        if api_key:
            s = stt_score(api_key, f)
            if s is not None:
                stts.append(s)
        ok += 1
        time.sleep(0.2)
    if ok == 0:
        return {"spm": spm, "ok": False}
    rate_req = round(spm / base_spm, 3) if base_spm else None
    med_speech = round(statistics.median(speech_spms), 1) if speech_spms else None
    return {
        "spm": spm,
        "ok": True,
        "reps": ok,
        "rateReq": rate_req,
        "speechSpm": med_speech,
        "speechSpmAll": speech_spms,
        "sttMedian": round(statistics.median(stts), 3) if stts else None,
        "sttMin": min(stts) if stts else None,
        "sttAll": stts,
    }


def pick_bia(bundle, base_spm, points) -> dict:
    """
    아동 절대 밴드에서 B/I/A 선정.
    - 상한(씹힘): STT median >= 0.9 이고 실측 속도가 목표를 따라 계속 증가(포화 전)인 최고 지점
    - 하한(기계음): rateReq >= 0.72
    - 앵커: B 125 / I 160 / A 190 (아동 적정), VP clean 범위로 clamp
    """
    ok = [p for p in points if p.get("ok")]
    if not ok:
        return {}
    STT_MIN = 0.9
    RATE_FLOOR = 0.72
    # 씹힘 상한: STT 유지 + 속도 tracking (직전 대비 speechSpm이 유의미하게 증가)
    clean_hi = None
    prev = None
    for p in sorted(ok, key=lambda x: x["spm"]):
        stt_ok = p["sttMedian"] is None or p["sttMedian"] >= STT_MIN
        tracking = True
        if prev and p["speechSpm"] and prev["speechSpm"]:
            # 목표를 15 올렸는데 실측이 3 미만 상승 => 포화(씹힘 시작)
            tracking = (p["speechSpm"] - prev["speechSpm"]) > 3
        if stt_ok and tracking:
            clean_hi = p["spm"]
        elif clean_hi is not None:
            break
        prev = p
    if clean_hi is None:
        clean_hi = max(p["spm"] for p in ok)
    # 기계음 하한: rate>=floor 인 최저 목표
    clean_lo = None
    for p in sorted(ok, key=lambda x: x["spm"]):
        if p["rateReq"] is None or p["rateReq"] >= RATE_FLOOR:
            clean_lo = p["spm"]
            break
    if clean_lo is None:
        clean_lo = min(p["spm"] for p in ok)

    def r5(x):
        return int(round(x / 5) * 5)

    # 아동 앵커
    A_anchor, I_anchor, B_anchor = 190, 160, 125
    A = min(A_anchor, clean_hi)
    B = max(B_anchor, clean_lo)
    # I는 B와 A 사이, 앵커 160 우선
    I = min(max(I_anchor, B + 10), A - 10) if A - B > 20 else (A + B) // 2
    # A가 너무 낮아 역전되면 정리
    if A <= I:
        A = min(clean_hi, I + 15)
    return {
        "beginner": r5(B),
        "intermediate": r5(I),
        "advanced": r5(A),
        "cleanLo": clean_lo,
        "cleanHi": clean_hi,
        "baseSpm": base_spm,
        "rateB": round(r5(B) / base_spm, 2) if base_spm else None,
        "rateA": round(r5(A) / base_spm, 2) if base_spm else None,
    }


def main() -> None:
    token = load_auth_token()
    api_key = os.environ.get("OPENAI_API_KEY")
    base = load_base_spm()
    audio_dir = OUT_DIR / "child-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    bundles = [b for b in base]  # baseSpm 있는 번들만 (TC 제외)
    print(f"아동 밴드 스윕 — {len(bundles)}개 VP, 그리드 {CHILD_GRID}, STT={'on' if api_key else 'off'}", flush=True)

    def do_bundle(bundle):
        bspm = base[bundle]
        reps = GEMINI_REPS if bundle.startswith("GEMINI") else NON_GEMINI_REPS
        pts = [sweep_point(token, api_key, bundle, spm, bspm, audio_dir, reps) for spm in CHILD_GRID]
        pick = pick_bia(bundle, bspm, pts)
        print(f"[{bundle}] base {bspm} -> B{pick.get('beginner')}/I{pick.get('intermediate')}/A{pick.get('advanced')} "
              f"(clean {pick.get('cleanLo')}~{pick.get('cleanHi')}, rateA {pick.get('rateA')})", flush=True)
        return {"bundle": bundle, "baseSpm": bspm, "points": pts, "pick": pick}

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        results = list(ex.map(do_bundle, bundles))

    payload = {
        "text": SWEEP_TEXT, "syllables": SWEEP_SYLLABLES, "words": SWEEP_WORDS,
        "grid": CHILD_GRID, "results": results,
    }
    (OUT_DIR / "child-results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"완료 -> {OUT_DIR}/child-results.json", flush=True)


if __name__ == "__main__":
    main()
