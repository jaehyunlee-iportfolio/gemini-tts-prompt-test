#!/usr/bin/env python3
"""
확정 후보(프로바이더당 단일 B/I/A triple) 실제 체감 속도 검증.
각 VP에 그 프로바이더의 B/I/A spm을 실제 주입 -> 생성 -> speech 길이로 체감 WPM/SPM 실측.
GEMINI는 지터로 3회 반복 중앙값. 프로바이더 단일값이므로 VP별 체감이 갈리는 폭을 본다.

결과: docs/spm-sweep/verify-final.json + 프로바이더별 체감 WPM 스프레드 출력.
"""
from __future__ import annotations
import json, re, statistics, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import SWEEP_SYLLABLES, SWEEP_WORDS, download, load_auth_token, synthesize
from spm_postprocess import speech_bounds_sec

OUT = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
W = SWEEP_WORDS / SWEEP_SYLLABLES  # my-SPM -> WPM (18/23)

# 사용자 확정 후보 (프로바이더당 단일 triple) + 차단 min/max
PROVIDER = {
    "GEMINI": {"B": 140, "I": 160, "A": 190, "min": 70, "max": 250},
    "GCP": {"B": 185, "I": 200, "A": 220, "min": 110, "max": 300},
    "AWS": {"B": 185, "I": 200, "A": 220, "min": 110, "max": 300},
    "CHIRP": {"B": 185, "I": 200, "A": 220, "min": 110, "max": 300},
    "AZ": {"B": 130, "I": 140, "A": 160, "min": 80, "max": 250},
}


def load_base():
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    return {m.group(1): float(m.group(2))
            for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts)}


def measure(token, bundle, spm, reps, audio_dir):
    wpms = []
    bd = audio_dir / bundle
    bd.mkdir(parents=True, exist_ok=True)
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
        wpms.append(SWEEP_WORDS / speech * 60)
        time.sleep(0.15)
    if not wpms:
        return None
    return round(statistics.median(wpms))


def main():
    token = load_auth_token()
    base = load_base()
    audio_dir = OUT / "verify-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    print("확정 후보 체감 속도 검증 (프로바이더 단일 triple 주입)", flush=True)

    def do(item):
        bundle, bspm = item
        prov = bundle.split("-")[0]
        cfg = PROVIDER[prov]
        reps = 3 if prov == "GEMINI" else 1
        row = {"bundle": bundle, "prov": prov, "base": bspm}
        for lvl in ("B", "I", "A"):
            spm = cfg[lvl]
            wpm = measure(token, bundle, spm, reps, audio_dir)
            row[f"{lvl}_spm"] = spm
            row[f"{lvl}_rate"] = round(spm / bspm, 2)
            row[f"{lvl}_wpm"] = wpm
        print(f"[{bundle:28}] base{bspm:.0f} "
              f"B{cfg['B']}(r{row['B_rate']},{row['B_wpm']}wpm) "
              f"I{cfg['I']}(r{row['I_rate']},{row['I_wpm']}wpm) "
              f"A{cfg['A']}(r{row['A_rate']},{row['A_wpm']}wpm)", flush=True)
        return row

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(do, sorted(base.items())))

    (OUT / "verify-final.json").write_text(json.dumps(
        {"provider": PROVIDER, "results": results}, ensure_ascii=False, indent=2))

    print("\n=== 프로바이더별 체감 WPM 스프레드 (단일 triple 적용 결과) ===", flush=True)
    order = ["GEMINI", "GCP", "AWS", "CHIRP", "AZ"]
    for p in order:
        rs = [r for r in results if r["prov"] == p]
        for lvl, name in (("B", "Beg"), ("I", "Int"), ("A", "Adv")):
            ws = [r[f"{lvl}_wpm"] for r in rs if r[f"{lvl}_wpm"]]
            rates = [r[f"{lvl}_rate"] for r in rs]
            if ws:
                print(f"  {p:7} {name}: 체감 {min(ws)}~{max(ws)} WPM (rate {min(rates)}~{max(rates)})", flush=True)
        print("", flush=True)
    print(f"완료 -> {OUT}/verify-final.json", flush=True)


if __name__ == "__main__":
    main()
