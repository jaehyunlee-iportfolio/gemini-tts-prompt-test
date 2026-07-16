#!/usr/bin/env python3
"""
아동 목표 청감 WPM(B100/I120/A137)을 내는 VP별 요청 spm을 child-results 선형 fit으로
역산하고(GEMINI는 저rate 침묵 방지 위해 beginner rate>=0.75 클램프), 그 값으로 실제
음원을 생성해 청감 WPM/STT가 목표에 맞는지 확인한다. GEMINI는 3회 반복 중앙값.

출력: docs/spm-sweep/child-confirm.json (VP별 최종 요청값 + 실측 검증)
"""
from __future__ import annotations
import json, os, statistics, sys, time, difflib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import (SWEEP_SYLLABLES, SWEEP_TEXT, SWEEP_WORDS, download,
                       load_auth_token, norm_words, stt_transcribe, synthesize)
from spm_postprocess import speech_bounds_sec

OUT = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
SYL_PER_WORD = 23 / 18
TARGETS_WPM = {"beginner": 100, "intermediate": 120, "advanced": 137}
GEMINI_BEGINNER_RATE_FLOOR = 0.75
GEMINI_REPS = 3


def linfit(xs, ys):
    n = len(xs); sx = sum(xs); sy = sum(ys)
    sxx = sum(x * x for x in xs); sxy = sum(x * y for x, y in zip(xs, ys))
    den = n * sxx - sx * sx
    if den == 0: return None, None
    slope = (n * sxy - sx * sy) / den
    return slope, (sy - slope * sx) / n


def r5(x): return int(round(x / 5) * 5)


def main():
    token = load_auth_token()
    api_key = os.environ.get("OPENAI_API_KEY")
    child = json.loads((OUT / "child-results.json").read_text())
    audio_dir = OUT / "confirm-audio"; audio_dir.mkdir(parents=True, exist_ok=True)

    # 1) fit으로 요청 spm 역산 + 클램프
    picks = {}
    for r in child["results"]:
        b = r["bundle"]; base = r["baseSpm"]
        pts = [(p["spm"], p["speechSpm"]) for p in r["points"] if p.get("ok") and p.get("speechSpm")]
        if len(pts) < 3: continue
        slope, icpt = linfit([p[0] for p in pts], [p[1] for p in pts])
        if not slope or slope <= 0: continue
        req = {}
        for lvl, wpm in TARGETS_WPM.items():
            myspm = wpm * SYL_PER_WORD
            req[lvl] = (myspm - icpt) / slope
        # GEMINI beginner 저rate 침묵 방지
        if b.startswith("GEMINI"):
            floor = GEMINI_BEGINNER_RATE_FLOOR * base
            if req["beginner"] < floor:
                req["beginner"] = floor
        # 단조 보장 및 라운딩
        rB = max(30, r5(req["beginner"]))
        rI = max(rB + 5, r5(req["intermediate"]))
        rA = max(rI + 5, r5(req["advanced"]))
        picks[b] = {"base": base, "beginner": rB, "intermediate": rI, "advanced": rA}

    print(f"확정 검증 — {len(picks)}개 VP x 3레벨 생성", flush=True)

    # 2) 각 레벨 실제 생성 + 청감 WPM/STT 측정
    def measure(bundle, spm, reps):
        wpms, stts = [], []
        bd = audio_dir / bundle; bd.mkdir(parents=True, exist_ok=True)
        for rep in range(reps):
            res = synthesize(token, bundle, spm)
            if not res.get("ok"): continue
            f = bd / f"{spm}_{rep}.mp3"
            if not download(res["url"], f): continue
            bnd = speech_bounds_sec(f)
            if not bnd: continue
            total, lead, tail = bnd
            speech = max(0.2, total - lead - tail)
            wpms.append(SWEEP_WORDS / speech * 60)
            if api_key:
                t = stt_transcribe(api_key, f)
                if t is not None:
                    stts.append(round(difflib.SequenceMatcher(
                        None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))).ratio(), 3))
            time.sleep(0.2)
        return (round(statistics.median(wpms), 1) if wpms else None,
                round(statistics.median(stts), 3) if stts else None)

    def do(bundle):
        p = picks[bundle]; reps = GEMINI_REPS if bundle.startswith("GEMINI") else 1
        for lvl in ("beginner", "intermediate", "advanced"):
            wpm, stt = measure(bundle, p[lvl], reps)
            p[f"{lvl}_wpm"] = wpm; p[f"{lvl}_stt"] = stt
            p[f"{lvl}_rate"] = round(p[lvl] / p["base"], 2)
        print(f"[{bundle}] B {p['beginner']}({p.get('beginner_wpm')}wpm r{p['beginner_rate']}) "
              f"I {p['intermediate']}({p.get('intermediate_wpm')}) "
              f"A {p['advanced']}({p.get('advanced_wpm')}) stt~{p.get('advanced_stt')}", flush=True)
        return bundle, p

    with ThreadPoolExecutor(max_workers=3) as ex:
        for _ in ex.map(do, list(picks)):
            pass

    (OUT / "child-confirm.json").write_text(json.dumps(
        {"targetsWpm": TARGETS_WPM, "sylPerWord": SYL_PER_WORD, "picks": picks},
        ensure_ascii=False, indent=2))
    print(f"완료 -> {OUT}/child-confirm.json", flush=True)


if __name__ == "__main__":
    main()
