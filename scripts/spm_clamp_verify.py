#!/usr/bin/env python3
"""
Stage의 클램핑이 SPM 기준으로 동작하는지 검증 (rate 기준 여부 판별).

절대 속도로는 판정할 수 없다(서버 baseSpm이 실제 발화와 어긋남: Azure 약 1.6배).
그래서 '동일성'과 '단조성'만 본다. 이는 baseSpm 정확도와 무관하게 성립한다.

판정 기준
  A) min 미만 요청들의 결과 == min 요청 결과      (하한 클램프)
  B) max 초과 요청들의 결과 == max 요청 결과      (상한 클램프)
  C) 범위 내에서는 spm이 커질수록 오디오가 짧아짐  (spm이 실제로 반영됨)
  D) 같은 프로바이더에서 baseSpm이 다른 VP 두 개가 같은 SPM 지점에서 클램프
     -> rate 기준이면 VP별로 클램프 지점이 SPM으로 환산했을 때 달라진다

'결과가 같다'는 오디오 길이 동일(±0.05s)로 보고, 응답 URL 일치도 함께 기록한다
(캐시 키에 rate가 들어가므로 클램프 후 rate가 같으면 URL도 같아질 수 있음).

산출물: docs/spm-sweep/clamp-verify.json
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import download, load_auth_token, probe_duration_sec, synthesize

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "spm-sweep"
AUDIO = OUT / "clamp-verify-audio"

TEXT = (
    "The little bird flew over the tall trees and landed on the old wooden fence near the river."
)

# 확정 min/max (SPM)
RANGE = {
    "GEMINI": (120, 210),
    "GCP": (160, 220),
    "AWS": (180, 220),
    "CHIRP": (170, 230),
    "AZ": (130, 170),
}

# 프로바이더별로 baseSpm이 서로 다른 VP를 골라 D) 검증이 되게 한다
TARGETS = {
    "GEMINI": [("GEMINI-Puck-Gentle", 146.7), ("GEMINI-Rasalgethi-Cheerful", 170.3)],
    "GCP": [("GCP-Rey-Default", 223.8), ("GCP-Jeremy-Default", 239.8)],
    "AWS": [("AWS-Justin-Default", 215.1), ("AWS-Kevin-Default", 227.8)],
    "CHIRP": [("CHIRP-Zephyr-Default", 219.2)],
    "AZ": [("AZ-Nancy-Default", 148.0), ("AZ-Xiaoyou-Default", 197.7)],
}

# GEMINI는 발화 지터가 있어 같은 요청도 길이가 흔들린다 -> 반복 측정 후 중앙값
REPEATS = {"GEMINI": 3}
SAME_TOL_SEC = 0.05
# 지터가 있는 프로바이더는 동일 판정 허용오차를 넓힌다
JITTER_TOL_SEC = {"GEMINI": 0.60}


def spm_points(lo: int, hi: int) -> list[tuple[str, int]]:
    mid = lo + (hi - lo) // 2
    return [
        ("below_far", lo - 30),
        ("below_near", lo - 10),
        ("at_min", lo),
        ("inside_mid", mid),
        ("at_max", hi),
        ("above_near", hi + 10),
        ("above_far", hi + 30),
    ]


def measure(token: str, bundle: str, spm: int, reps: int) -> dict:
    durs: list[float] = []
    urls: list[str] = []
    err = None
    bd = AUDIO / bundle
    bd.mkdir(parents=True, exist_ok=True)
    for rep in range(reps):
        r = synthesize(token, bundle, spm)
        if not r.get("ok"):
            err = str(r.get("error") or r.get("detail"))[:160]
            continue
        urls.append(r["url"])
        f = bd / f"{spm}_{rep}.mp3"
        if not download(r["url"], f):
            err = "download failed"
            continue
        d = probe_duration_sec(f)
        if d:
            durs.append(d)
        time.sleep(0.1)
    if not durs:
        return {"spm": spm, "error": err or "no duration"}
    return {
        "spm": spm,
        "durationSec": round(statistics.median(durs), 3),
        "durations": [round(x, 3) for x in durs],
        "url": urls[0] if urls else None,
        "urlAllSame": len(set(urls)) == 1 if urls else None,
    }


def run_bundle(token: str, prov: str, bundle: str, base: float) -> dict:
    lo, hi = RANGE[prov]
    reps = REPEATS.get(prov, 1)
    rows = {}
    for tag, spm in spm_points(lo, hi):
        row = measure(token, bundle, spm, reps)
        row["tag"] = tag
        row["rateIfNoClamp"] = round(spm / base, 3)
        rows[tag] = row
        d = row.get("durationSec")
        print(
            f"    {tag:11} spm{spm:>4} -> "
            f"{'길이 ' + format(d, '.3f') + 's' if d else 'ERR ' + str(row.get('error'))}",
            flush=True,
        )
    return {"bundle": bundle, "provider": prov, "baseSpm": base, "rows": rows}


def judge(entry: dict, tol: float) -> dict:
    rows = entry["rows"]

    def dur(tag):
        return rows.get(tag, {}).get("durationSec")

    at_min, at_max = dur("at_min"), dur("at_max")
    verdict = {}

    # A) 하한 클램프
    lows = [t for t in ("below_far", "below_near") if dur(t) is not None]
    if at_min is not None and lows:
        diffs = {t: round(abs(dur(t) - at_min), 3) for t in lows}
        verdict["A_min_clamp"] = {
            "pass": all(v <= tol for v in diffs.values()),
            "diffsVsAtMin": diffs,
        }

    # B) 상한 클램프
    highs = [t for t in ("above_near", "above_far") if dur(t) is not None]
    if at_max is not None and highs:
        diffs = {t: round(abs(dur(t) - at_max), 3) for t in highs}
        verdict["B_max_clamp"] = {
            "pass": all(v <= tol for v in diffs.values()),
            "diffsVsAtMax": diffs,
        }

    # C) 범위 내 단조 감소 (min > mid > max 순으로 길이가 짧아져야)
    mid = dur("inside_mid")
    if None not in (at_min, mid, at_max):
        verdict["C_monotonic_inside"] = {
            "pass": at_min > mid > at_max,
            "durations": {"at_min": at_min, "inside_mid": mid, "at_max": at_max},
        }
    return verdict


def main() -> None:
    token = load_auth_token()
    AUDIO.mkdir(parents=True, exist_ok=True)
    print("클램핑 기준 검증 (SPM 기준인지 rate 기준인지)\n")

    jobs = [(p, b, base) for p, lst in TARGETS.items() for b, base in lst]
    results = []
    for prov, bundle, base in jobs:
        print(f"--- {bundle} ({prov}, baseSpm {base}, min/max {RANGE[prov]})", flush=True)
        entry = run_bundle(token, prov, bundle, base)
        tol = JITTER_TOL_SEC.get(prov, SAME_TOL_SEC)
        entry["verdict"] = judge(entry, tol)
        entry["toleranceSec"] = tol
        results.append(entry)
        for k, v in entry["verdict"].items():
            print(f"      {k}: {'PASS' if v['pass'] else 'FAIL'}", flush=True)
        print("", flush=True)

    # D) 같은 프로바이더 내 VP 간 클램프 지점 일관성
    print("=== D) 같은 프로바이더, baseSpm 다른 VP 간 일관성 ===", flush=True)
    consistency = {}
    for prov, lst in TARGETS.items():
        if len(lst) < 2:
            continue
        es = [e for e in results if e["provider"] == prov]
        ok = all(
            e["verdict"].get("A_min_clamp", {}).get("pass")
            and e["verdict"].get("B_max_clamp", {}).get("pass")
            for e in es
        )
        consistency[prov] = {
            "pass": ok,
            "bundles": {
                e["bundle"]: {
                    "baseSpm": e["baseSpm"],
                    "A": e["verdict"].get("A_min_clamp", {}).get("pass"),
                    "B": e["verdict"].get("B_max_clamp", {}).get("pass"),
                }
                for e in es
            },
        }
        print(f"  {prov:7} {'PASS' if ok else 'FAIL'}  "
              + ", ".join(f"{e['bundle'].split('-')[1]}(base {e['baseSpm']})" for e in es),
              flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "clamp-verify.json").write_text(
        json.dumps(
            {"text": TEXT, "range": RANGE, "results": results, "vpConsistency": consistency},
            ensure_ascii=False, indent=2,
        )
    )

    # 총평
    total = fails = 0
    for e in results:
        for v in e["verdict"].values():
            total += 1
            if not v["pass"]:
                fails += 1
    print(f"\n=== 총평: 검사 {total}건 중 실패 {fails}건 "
          f"({'클램핑 SPM 기준 동작 확인' if fails == 0 else '이상 있음'}) ===")
    print(f"산출물: {OUT}/clamp-verify.json")


if __name__ == "__main__":
    main()
