#!/usr/bin/env python3
"""
VP별 rate 배수 방식 B/I/A 검증.
레벨 = 각 VP baseSpm x (rateB/rateI/rateA). spm = round(base*rate)를 실제 생성해
  - 레벨이 B<I<A로 구분되는지(실측 speech my-SPM)
  - STT 명료도(씹힘 없는지)
  - GEMINI 지터로 레벨이 뭉개지는지(3회 반복 표준편차)
확인. 결과 docs/spm-sweep/rate-band.json.

rate 밴드는 아래 상수. 비균등(B-I < I-A), beginner 하한으로 기계음 회피.
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
RATES = {"beginner": 0.85, "intermediate": 1.0, "advanced": 1.18}
GEMINI_REPS = 3


def load_base():
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    import re
    return {m.group(1): float(m.group(2))
            for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts)}


def measure(token, api_key, bundle, spm, reps, audio_dir):
    myspms, stts = [], []
    bd = audio_dir / bundle; bd.mkdir(parents=True, exist_ok=True)
    for rep in range(reps):
        r = synthesize(token, bundle, spm)
        if not r.get("ok"):
            continue
        f = bd / f"{spm}_{rep}.mp3"
        if not download(r["url"], f):
            continue
        b = speech_bounds_sec(f)
        if not b:
            continue
        total, lead, tail = b
        speech = max(0.2, total - lead - tail)
        myspms.append(SWEEP_SYLLABLES / speech * 60)
        if api_key:
            t = stt_transcribe(api_key, f)
            if t is not None:
                stts.append(round(difflib.SequenceMatcher(
                    None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))).ratio(), 3))
        time.sleep(0.2)
    if not myspms:
        return None
    return {
        "spm": spm,
        "mySpmMed": round(statistics.median(myspms), 1),
        "mySpmMin": round(min(myspms), 1),
        "mySpmMax": round(max(myspms), 1),
        "wpmMed": round(statistics.median(myspms) / (SWEEP_SYLLABLES / SWEEP_WORDS), 1),
        "sttMed": round(statistics.median(stts), 3) if stts else None,
    }


def main():
    token = load_auth_token()
    api_key = os.environ.get("OPENAI_API_KEY")
    base = load_base()
    audio_dir = OUT / "rateband-audio"; audio_dir.mkdir(parents=True, exist_ok=True)
    print(f"rate 밴드 검증 — B{RATES['beginner']}/I{RATES['intermediate']}/A{RATES['advanced']}, {len(base)}개 VP", flush=True)

    def do(bundle):
        bspm = base[bundle]
        reps = GEMINI_REPS if bundle.startswith("GEMINI") else 1
        row = {"bundle": bundle, "base": bspm, "levels": {}}
        for lvl, rate in RATES.items():
            spm = round(bspm * rate)
            m = measure(token, api_key, bundle, spm, reps, audio_dir)
            if m:
                m["rate"] = rate
                row["levels"][lvl] = m
        b = row["levels"].get("beginner", {}).get("mySpmMed")
        i = row["levels"].get("intermediate", {}).get("mySpmMed")
        a = row["levels"].get("advanced", {}).get("mySpmMed")
        # 레벨 구분 판정: B<I<A (마진 5 my-SPM)
        ok = (b is not None and i is not None and a is not None and i - b > 5 and a - i > 5)
        row["distinct"] = ok
        row["order"] = f"{b}/{i}/{a}"
        stt_min = min([lv.get("sttMed") or 1 for lv in row["levels"].values()], default=None)
        row["sttMin"] = stt_min
        print(f"[{bundle}] base {bspm} spm {row['levels'].get('beginner',{}).get('spm')}/"
              f"{row['levels'].get('intermediate',{}).get('spm')}/{row['levels'].get('advanced',{}).get('spm')} "
              f"-> mySPM {b}/{i}/{a} {'OK' if ok else 'X(레벨뭉침)'} stt{stt_min}", flush=True)
        return row

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(do, list(base)))

    (OUT / "rate-band.json").write_text(json.dumps(
        {"rates": RATES, "results": results}, ensure_ascii=False, indent=2))
    distinct = sum(1 for r in results if r["distinct"])
    print(f"\n레벨 구분 성공 {distinct}/{len(results)} VP", flush=True)
    print(f"완료 -> {OUT}/rate-band.json", flush=True)


if __name__ == "__main__":
    main()
