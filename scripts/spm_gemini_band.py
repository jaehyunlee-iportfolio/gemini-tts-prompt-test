#!/usr/bin/env python3
"""
GEMINI 전용 rate 밴드 재검증 (레벨 뭉침 해소 목적).
두 후보 밴드를 비교:
  wide-low : B 0.78 / I 1.02 / A 1.30  (넓게, beginner 저rate)
  wide-safe: B 0.85 / I 1.08 / A 1.35  (넓게, beginner 안전)
각 레벨 3회 반복해서
  - 레벨 구분(B<I<A, median my-SPM, 마진 8)
  - 지터(각 레벨 my-SPM 표준편차)
  - beginner 문장 중간 침묵(mid-pause: 시작/끝 아닌 무음의 개수와 총 길이) = Gemini 저rate 열화
  - STT
측정. 결과 docs/spm-sweep/gemini-band.json.
"""
from __future__ import annotations
import json, os, re, statistics, subprocess, sys, time, difflib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import (SWEEP_SYLLABLES, SWEEP_TEXT, SWEEP_WORDS, download,
                       load_auth_token, norm_words, probe_duration_sec,
                       stt_transcribe, synthesize)

OUT = Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
BANDS = {
    "wide-low": {"beginner": 0.78, "intermediate": 1.02, "advanced": 1.30},
    "wide-safe": {"beginner": 0.85, "intermediate": 1.08, "advanced": 1.35},
}
REPS = 3
W = 18 / 23  # my-SPM -> WPM


def load_gemini_base():
    ts = (Path(__file__).resolve().parent.parent / "src" / "lib" / "voice-table.ts").read_text()
    out = {}
    for m in re.finditer(r'bundleName:\s*"(GEMINI-[\w-]+)".*?baseSpm:\s*([\d.]+)', ts):
        out[m.group(1)] = float(m.group(2))
    return out


def analyze(path):
    """(speech my-SPM, mid-pause 개수, mid-pause 총초)"""
    total = probe_duration_sec(path)
    if not total:
        return None
    out = subprocess.run(
        ["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"],
        capture_output=True, text=True, timeout=60).stderr
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", out)]
    lead = tail = 0.0
    mid_n = 0
    mid_s = 0.0
    for idx, st in enumerate(starts):
        en = ends[idx] if idx < len(ends) else total
        dur = en - st
        if st <= 0.06:
            lead = en
        elif en >= total - 0.06:
            tail = total - st
        else:
            mid_n += 1
            mid_s += dur
    speech = max(0.2, total - lead - tail)
    return round(SWEEP_SYLLABLES / speech * 60, 1), mid_n, round(mid_s, 2)


def main():
    token = load_auth_token()
    api_key = os.environ.get("OPENAI_API_KEY")
    base = load_gemini_base()
    audio = OUT / "gemini-band-audio"; audio.mkdir(parents=True, exist_ok=True)
    print(f"GEMINI 밴드 재검증 — {len(base)}개 x {len(BANDS)}밴드", flush=True)

    def measure(bundle, spm):
        vals, stts, midn, mids = [], [], [], []
        bd = audio / bundle; bd.mkdir(parents=True, exist_ok=True)
        for rep in range(REPS):
            r = synthesize(token, bundle, spm)
            if not r.get("ok"):
                continue
            f = bd / f"{spm}_{rep}.mp3"
            if not download(r["url"], f):
                continue
            a = analyze(f)
            if not a:
                continue
            vals.append(a[0]); midn.append(a[1]); mids.append(a[2])
            if api_key:
                t = stt_transcribe(api_key, f)
                if t is not None:
                    stts.append(round(difflib.SequenceMatcher(
                        None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))).ratio(), 3))
            time.sleep(0.2)
        if not vals:
            return None
        return {"spm": spm, "mySpmMed": round(statistics.median(vals), 1),
                "mySpmSD": round(statistics.pstdev(vals), 1) if len(vals) > 1 else 0,
                "wpmMed": round(statistics.median(vals) * W),
                "midPauseN": round(statistics.median(midn), 1), "midPauseSec": round(statistics.median(mids), 2),
                "sttMed": round(statistics.median(stts), 3) if stts else None}

    def do(bundle):
        b = base[bundle]
        row = {"bundle": bundle, "base": b, "bands": {}}
        for bn, rates in BANDS.items():
            lvls = {}
            for lvl, rate in rates.items():
                m = measure(bundle, round(b * rate))
                if m:
                    m["rate"] = rate
                    lvls[lvl] = m
            bw = lvls.get("beginner", {}).get("mySpmMed")
            iw = lvls.get("intermediate", {}).get("mySpmMed")
            aw = lvls.get("advanced", {}).get("mySpmMed")
            distinct = (bw and iw and aw and iw - bw > 8 and aw - iw > 8)
            bpause = lvls.get("beginner", {}).get("midPauseSec", 0)
            row["bands"][bn] = {"levels": lvls, "distinct": bool(distinct),
                                "order": f"{bw}/{iw}/{aw}", "beginnerPauseSec": bpause}
        wl = row["bands"]["wide-low"]; ws = row["bands"]["wide-safe"]
        print(f"[{bundle}] low {wl['order']} {'OK' if wl['distinct'] else 'X'} pause{wl['beginnerPauseSec']}s | "
              f"safe {ws['order']} {'OK' if ws['distinct'] else 'X'} pause{ws['beginnerPauseSec']}s", flush=True)
        return row

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(do, list(base)))

    (OUT / "gemini-band.json").write_text(json.dumps({"bands": BANDS, "results": results}, ensure_ascii=False, indent=2))
    for bn in BANDS:
        d = sum(1 for r in results if r["bands"][bn]["distinct"])
        pausey = sum(1 for r in results if r["bands"][bn]["beginnerPauseSec"] and r["bands"][bn]["beginnerPauseSec"] > 0.35)
        print(f"{bn}: 레벨구분 {d}/{len(results)}, beginner 중간침묵>0.35s {pausey}종", flush=True)
    print(f"완료 -> {OUT}/gemini-band.json", flush=True)


if __name__ == "__main__":
    main()
