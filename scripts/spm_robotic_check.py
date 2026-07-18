#!/usr/bin/env python3
"""
기계음(저rate 음색 열화) 무참조 자동 탐지.
방법: DNSMOS(P.835) 무참조 MOS 예측 신경망으로 각 VP의 추천 beginner(저rate) 클립과
rate 1.0(자연) 클립의 SIG(speech 왜곡)/OVRL을 비교. beginner에서 SIG/OVRL이 rate 1.0
대비 크게 떨어지면 = 기계음 열화(사람 귀 없이 수치로 판정).

프로바이더별 추천 rate로 beginner spm 생성, 2회 반복 평균. rate 1.0(intermediate 자연)도
같이 생성해 delta 계산. 결과 docs/spm-sweep/robotic-check.json + 위험순위 출력.

실행: <venv>/bin/python scripts/spm_robotic_check.py   (venv에 speechmos, librosa, onnxruntime 필요)
"""
from __future__ import annotations
import json, re, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import download, load_auth_token, synthesize

import librosa  # noqa: E402
import numpy as np  # noqa: E402
from speechmos import dnsmos  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
PROV_BEGINNER_RATE = {"GEMINI": 0.85, "AZ": 0.50, "GCP": 0.48, "AWS": 0.49, "CHIRP": 0.47}
REPS = 2


def load_base():
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    return {m.group(1): float(m.group(2))
            for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts)}


def mos(path):
    y, _ = librosa.load(str(path), sr=16000)
    # mp3 디코딩이 [-1,1]을 살짝 초과할 수 있어 DNSMOS 입력 전 클리핑/정규화
    peak = float(np.max(np.abs(y))) if y.size else 1.0
    if peak > 1.0:
        y = y / peak
    y = np.clip(y, -1.0, 1.0)
    r = dnsmos.run(y, sr=16000)
    return r["sig_mos"], r["ovrl_mos"]


def score(token, bundle, spm, tag, audio_dir):
    sigs, ovrls = [], []
    bd = audio_dir / bundle; bd.mkdir(parents=True, exist_ok=True)
    for rep in range(REPS):
        r = synthesize(token, bundle, spm)
        if not r.get("ok"):
            continue
        f = bd / f"{tag}_{spm}_{rep}.mp3"
        if not download(r["url"], f):
            continue
        s, o = mos(f)
        sigs.append(s); ovrls.append(o)
        time.sleep(0.2)
    if not sigs:
        return None
    return round(statistics.mean(sigs), 2), round(statistics.mean(ovrls), 2)


def main():
    token = load_auth_token()
    base = load_base()
    audio_dir = OUT / "robotic-audio"; audio_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    print("기계음 무참조 탐지(DNSMOS) — 추천 beginner rate vs rate 1.0", flush=True)
    for bundle, b in base.items():
        prov = bundle.split("-")[0]
        rB = PROV_BEGINNER_RATE.get(prov, 0.85)
        bspm = round(b * rB)
        nat = round(b * 1.0)
        beg = score(token, bundle, bspm, "beg", audio_dir)
        ntv = score(token, bundle, nat, "nat", audio_dir)
        if not beg or not ntv:
            continue
        sigB, ovrlB = beg
        sigN, ovrlN = ntv
        row = {"bundle": bundle, "prov": prov, "beginnerRate": rB, "beginnerSpm": bspm,
               "sigBeginner": sigB, "sigNatural": sigN, "sigDrop": round(sigN - sigB, 2),
               "ovrlBeginner": ovrlB, "ovrlNatural": ovrlN, "ovrlDrop": round(ovrlN - ovrlB, 2)}
        rows.append(row)
        print(f"[{bundle:28}] beg rate{rB} SIG {sigB} (자연 {sigN}, drop {row['sigDrop']:+}) "
              f"OVRL {ovrlB}", flush=True)

    rows.sort(key=lambda r: r["sigBeginner"])
    (OUT / "robotic-check.json").write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=2))
    print("\n=== 기계음 위험 순위 (beginner SIG 낮은 순 = 위험) ===", flush=True)
    for r in rows:
        flag = "위험" if r["sigBeginner"] < 3.3 or r["sigDrop"] > 0.25 else ""
        print(f"  {r['bundle']:28} SIG {r['sigBeginner']} drop {r['sigDrop']:+} {flag}", flush=True)
    print(f"\n완료 -> {OUT}/robotic-check.json", flush=True)


if __name__ == "__main__":
    main()
