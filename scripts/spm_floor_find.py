#!/usr/bin/env python3
"""
VP별 clean floor(기계음 없는 최저 rate) 자동 탐지 -> B/I/A 산출.
방식: rate를 낮춰가며 DNSMOS SIG 측정. SIG가 자연(rate 1.0) 대비 0.2 이상 떨어지기
직전 rate = clean floor. GEMINI는 문장 중간 침묵(<0.35s) 조건도 함께(저rate 침묵 회피).
그 floor를 beginner 앵커로: B = round(base x floor), I = B + 25, A = B + 60 (간격 25/35 고정).

실행: <venv>/bin/python scripts/spm_floor_find.py  (speechmos, librosa, numpy 필요)
결과: docs/spm-sweep/floor-find.json
"""
from __future__ import annotations
import json, re, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import download, load_auth_token, synthesize
from spm_postprocess import speech_bounds_sec

import librosa  # noqa: E402
import numpy as np  # noqa: E402
from speechmos import dnsmos  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
RATES = [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 0.90, 1.00]
SIG_DROP = 0.20          # 자연 대비 이만큼 떨어지면 열화
GEMINI_PAUSE_MAX = 0.35  # 문장 중간 침묵 허용
GAP_LO, GAP_HI = 25, 35


def load_base():
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    return {m.group(1): float(m.group(2))
            for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts)}


def mid_pause_sec(path):
    import subprocess
    total = None
    try:
        out = subprocess.run(["ffmpeg", "-i", str(path), "-af",
                              "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"],
                             capture_output=True, text=True, timeout=60).stderr
    except Exception:
        return 0.0
    import re as _re
    total = None
    m = _re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if m:
        total = int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3))
    starts = [float(x) for x in _re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in _re.findall(r"silence_end: ([\d.]+)", out)]
    if total is None:
        return 0.0
    mids = 0.0
    for i, st in enumerate(starts):
        en = ends[i] if i < len(ends) else total
        if st > 0.06 and en < total - 0.06:
            mids += en - st
    return round(mids, 2)


def sig_at(token, api_key_unused, bundle, spm, reps, audio_dir):
    sigs = []
    pauses = []
    bd = audio_dir / bundle; bd.mkdir(parents=True, exist_ok=True)
    for rep in range(reps):
        r = synthesize(token, bundle, spm)
        if not r.get("ok"):
            continue
        f = bd / f"{spm}_{rep}.mp3"
        if not download(r["url"], f):
            continue
        y, _ = librosa.load(str(f), sr=16000)
        peak = float(np.max(np.abs(y))) if y.size else 1.0
        if peak > 1.0:
            y = y / peak
        y = np.clip(y, -1.0, 1.0)
        res = dnsmos.run(y, sr=16000)
        sigs.append(res["sig_mos"])
        pauses.append(mid_pause_sec(f))
        time.sleep(0.15)
    if not sigs:
        return None
    return round(statistics.mean(sigs), 2), round(statistics.median(pauses), 2)


def main():
    token = load_auth_token()
    base = load_base()
    audio_dir = OUT / "floor-audio"; audio_dir.mkdir(parents=True, exist_ok=True)
    print(f"clean floor 탐지 — {len(base)}개 VP x {len(RATES)}rate", flush=True)
    results = []
    for bundle, b in base.items():
        isG = bundle.startswith("GEMINI")
        reps = 2 if isG else 1
        curve = {}
        for rate in RATES:
            spm = round(b * rate)
            m = sig_at(token, None, bundle, spm, reps, audio_dir)
            if m:
                curve[rate] = {"spm": spm, "sig": m[0], "midPause": m[1]}
        if 1.0 not in curve:
            continue
        nat_sig = curve[1.0]["sig"]
        # floor: 낮은 rate부터 올라가며 조건 만족하는 최저 rate
        floor = 1.0
        for rate in RATES:
            c = curve.get(rate)
            if not c:
                continue
            ok = c["sig"] >= nat_sig - SIG_DROP
            if isG and c["midPause"] > GEMINI_PAUSE_MAX:
                ok = False
            if ok:
                floor = rate
                break
        B = round(b * floor)
        I = B + GAP_LO
        A = B + GAP_LO + GAP_HI
        row = {"bundle": bundle, "base": b, "floorRate": floor, "natSig": nat_sig,
               "B": B, "I": I, "A": A, "rateI": round(I / b, 2), "rateA": round(A / b, 2),
               "curve": curve}
        results.append(row)
        sigline = " ".join(f"{r}:{curve[r]['sig']}" for r in RATES if r in curve)
        print(f"[{bundle:28}] floor {floor} -> B{B}/I{I}/A{A} (rateI {row['rateI']}) | SIG {sigline}", flush=True)

    (OUT / "floor-find.json").write_text(json.dumps({"rates": RATES, "gap": [GAP_LO, GAP_HI],
                                                     "results": results}, ensure_ascii=False, indent=2))
    print(f"\n완료 -> {OUT}/floor-find.json", flush=True)


if __name__ == "__main__":
    main()
