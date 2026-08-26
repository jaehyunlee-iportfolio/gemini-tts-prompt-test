#!/usr/bin/env python3
"""Voice Profile 하나의 클램핑 구간(min/max SPM)을 산출한다.

왜 이런 구조인가
----------------
처음에는 음질 지표(DNSMOS)로 "기계음 나기 직전 rate"를 찾아 min을 잡으려 했다.
34개 VP를 90~500 SPM 전 구간에서 실측한 결과 그 방식은 쓸 수 없다는 것이 확인됐다.

  - 음질 점수는 rate에 거의 반응하지 않는다. 32개 VP 중 30개가 저속 구간에서
    0.15 미만으로만 변했고, 저속 평균과 고속 평균의 차이는 중앙값 +0.01 이었다.
  - STT 정확도는 78~342 SPM 전 구간에서 1.000 이다. 발음이 씹히는 지점이 없다.
  - 실측 속도는 요청에 계속 비례한다. 500 SPM 에서도 엔진이 포화되지 않는다.

즉 min/max 는 엔진이 깨지는 물리적 한계가 아니라 **사람이 정한 청감 기준선**이다.
그래서 이 스크립트는 한계를 "발견"하지 않는다. 사람이 확정한 5개 프로바이더의
min/max 를 기준점으로 삼아, 새 VP 를 같은 잣대 위에 올려놓는다.

모델
----
  min = MIN_SLOPE x baseSpm
        저속 하한은 rate 축에서 결정된다(엔진이 늘어지는 정도가 rate 에 따라 정해짐).

  max = min( MAX_RATE_CAP x baseSpm,  MAX_DELIVERED_SPM x baseSpm / 자연발화SPM )
        상한은 두 제약 중 먼저 걸리는 쪽이다.
          1) rate 자체가 너무 높으면 음이 뭉갠다        -> rate 상한
          2) 실제 전달 속도가 학습자에게 너무 빠르다    -> 전달 속도 상한
        느린 엔진(GEMINI)은 1번이, 빠른 엔진은 2번이 걸린다.

min/max 는 VP 단위가 아니라 프로바이더 단위로 정하는 값이다. 그래서 최종 판단은
그 프로바이더의 VP 를 여러 개 돌린 뒤 --rollup 으로 중앙값을 내서 한다.
VP 한 개 결과만 보고 확정하지 말 것. 특히 AZ 는 baseSpm 오차가 커서 VP 별 편차가 크다.

확정값 대비 정확도 (프로바이더 롤업 기준)
  GEMINI  min 120 -> 122 (+1.7%)   max 210 -> 207 (-1.4%)
  AZ      min 130 -> 120 (-7.7%)   max 170 -> 161 (-5.3%)
  GCP     min 160 -> 178 (+11.3%)  max 220 -> 227 (+3.2%)
  AWS     min 180 -> 170 (-5.6%)   max 220 -> 225 (+2.3%)
  CHIRP   min 170 -> 168 (-1.2%)   max 230 -> 230 (+0.0%)
  min 평균 5.5% 최대 11.3%,  max 평균 2.4% 최대 5.3%

한 프로바이더를 빼고 나머지 넷으로 상수를 맞춘 뒤 뺀 쪽을 맞히는 검증(leave-one-provider-out)
결과는 min 평균 7.1% 최대 14.9%, max 평균 7.4% 최대 21.0% 다. 위 표보다 이 숫자가
"처음 보는 프로바이더"에서 기대할 수 있는 실제 오차에 가깝다. 최대 오차는 전부 GEMINI 를
뺐을 때 나온다. 나머지 넷과 성격이 가장 다르기 때문이다.

이 도구가 못 하는 일
  음질을 판단하지 않는다. 음원에서 뽑는 정보는 속도 하나뿐이고 나머지는 계산이다.
  "이 목소리가 이상하다"는 못 잡는다. 후보 구간을 좁혀 청취 시간을 줄이는 용도이며
  최종 확인은 귀로 해야 한다.

사용법은 scripts/README-vp-band.md 참고.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V2_SAVE_URL = "https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save"

# 전 VP 공통 측정 문장. 바꾸면 음절 수도 같이 바꿔야 하고 기존 결과와 비교가 안 된다.
SWEEP_TEXT = ("The little bird flew over the tall trees and landed on the old wooden fence "
              "near the river.")
SWEEP_SYLLABLES = 23

# --- 보정 상수 -------------------------------------------------------------
# docs/spm-sweep/results.json (34개 VP, 90~500 SPM 실측) + 사람이 확정한
# 프로바이더 5쌍의 min/max 로 적합했다. 확정값이 바뀌면 여기를 다시 맞춰야 한다.
MIN_SLOPE = 0.766
MAX_RATE_CAP = 1.30
MAX_DELIVERED_SPM = 305

# 검증 단계에서 요청 대비 전달 속도가 이만큼 어긋나면 서버 클램핑을 의심한다.
CLAMP_WARN = 0.15

SILENCE_DB = -35
SILENCE_MIN_SEC = 0.25


# --- 환경 -----------------------------------------------------------------
def load_token() -> str:
    import os
    for key in ("TTS_V2_AUTH_TOKEN", "TTS_AUTH_TOKEN"):
        if os.environ.get(key):
            return os.environ[key]
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            m = re.match(r"^(TTS_V2_AUTH_TOKEN|TTS_AUTH_TOKEN)=(.+)$", line.strip())
            if m:
                return m.group(2).strip()
    sys.exit("ERROR: TTS_V2_AUTH_TOKEN 이 없습니다 (.env.local 또는 환경변수)")


def load_base_spm(bundle: str) -> float | None:
    ts = ROOT / "src" / "lib" / "voice-table.ts"
    if not ts.exists():
        return None
    for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts.read_text()):
        if m.group(1) == bundle:
            return float(m.group(2))
    return None


# --- TTS ------------------------------------------------------------------
def synthesize(token: str, bundle: str, spm: float | None) -> dict:
    body: dict = {"text": SWEEP_TEXT, "bundleName": bundle, "platform": "PLAYGROUND", "userId": 2}
    if spm is not None:
        body["spm"] = spm
    req = urllib.request.Request(
        V2_SAVE_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-SS-Authorization": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode()[:200]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    if payload.get("url"):
        return {"ok": True, "url": payload["url"]}
    return {"ok": False, "error": str(payload)[:200]}


def download(url: str, dest: Path) -> bool:
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as resp:
            dest.write_bytes(resp.read())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  다운로드 실패: {e}", file=sys.stderr)
        return False


# --- 오디오 측정 -----------------------------------------------------------
def probe_duration_sec(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30, check=True).stdout.strip()
        d = float(out)
        return d if d > 0 else None
    except Exception:  # noqa: BLE001
        return None


def speech_duration_sec(path: Path) -> tuple[float, float, float] | None:
    """(발화 구간 길이, 선행 무음, 후행 무음). 앞뒤 무음을 빼야 속도가 정확하다."""
    total = probe_duration_sec(path)
    if not total:
        return None
    try:
        err = subprocess.run(
            ["ffmpeg", "-i", str(path), "-af",
             f"silencedetect=noise={SILENCE_DB}dB:d={SILENCE_MIN_SEC}", "-f", "null", "-"],
            capture_output=True, text=True, timeout=60).stderr
    except Exception:  # noqa: BLE001
        return total, 0.0, 0.0
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    lead = tail = 0.0
    for s, e in zip(starts, ends + [total]):
        if s <= 0.05:
            lead = e
        if e >= total - 0.05:
            tail = total - s
    return max(total - lead - tail, 0.01), lead, tail


def measure(token: str, bundle: str, spm: float | None, audio_dir: Path) -> dict | None:
    r = synthesize(token, bundle, spm)
    if not r["ok"]:
        print(f"  합성 실패 (spm={spm}): {r['error']}", file=sys.stderr)
        return None
    dest = audio_dir / f"{'base' if spm is None else int(spm)}.mp3"
    if not download(r["url"], dest):
        return None
    sd = speech_duration_sec(dest)
    if not sd:
        return None
    speech, lead, tail = sd
    return {
        "requestSpm": spm,
        "url": r["url"],
        "file": str(dest),
        "totalSec": round(probe_duration_sec(dest) or 0, 3),
        "speechSec": round(speech, 3),
        "leadSilenceSec": round(lead, 3),
        "tailSilenceSec": round(tail, 3),
        "measuredSpm": round(SWEEP_SYLLABLES / speech * 60, 1),
    }


# --- 모델 -----------------------------------------------------------------
def predict(base_spm: float, natural_spm: float) -> dict:
    by_rate = MAX_RATE_CAP * base_spm
    by_delivered = MAX_DELIVERED_SPM * base_spm / natural_spm
    return {
        "min": round(MIN_SLOPE * base_spm),
        "max": round(min(by_rate, by_delivered)),
        "maxBoundBy": "rate" if by_rate <= by_delivered else "delivered",
        "maxByRate": round(by_rate),
        "maxByDelivered": round(by_delivered),
    }


def rollup(out_dir: Path, provider: str) -> None:
    """프로바이더의 VP 결과들을 모아 실제로 설정에 넣을 min/max 한 쌍을 낸다."""
    import statistics
    files = sorted(out_dir.glob(f"{provider}-*.json"))
    if not files:
        sys.exit(f"ERROR: {out_dir} 에 {provider} VP 결과가 없습니다. 먼저 VP 를 돌리세요.")
    rows = [json.loads(f.read_text()) for f in files]
    mins = [r["minSpm"] for r in rows]
    maxs = [r["maxSpm"] for r in rows]
    mn, mx = round(statistics.median(mins)), round(statistics.median(maxs))
    print(f"[{provider}] VP {len(rows)}개")
    for r in sorted(rows, key=lambda x: x["bundle"]):
        print(f"  {r['bundle']:<32} base {r['baseSpm']:>6}  자연 {r['naturalSpm']:>6}  "
              f"min {r['minSpm']:>4}  max {r['maxSpm']:>4}")
    print(f"\n  중앙값   min {mn}   max {mx}")
    print(f"  VP 편차  min {min(mins)}~{max(mins)}   max {min(maxs)}~{max(maxs)}")
    if len(rows) < 3:
        print(f"  주의: VP 가 {len(rows)}개뿐입니다. 3개 이상 돌린 뒤 확정하는 것을 권합니다.")
    out = out_dir / f"_provider-{provider}.json"
    out.write_text(json.dumps({
        "provider": provider, "vpCount": len(rows), "minSpm": mn, "maxSpm": mx,
        "minRange": [min(mins), max(mins)], "maxRange": [min(maxs), max(maxs)],
        "bundles": [r["bundle"] for r in rows],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  결과     {out.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description="VP 하나의 클램핑 구간(min/max SPM) 산출")
    ap.add_argument("bundle", nargs="?", help="예: GEMINI-Rasalgethi-Default")
    ap.add_argument("--rollup", metavar="PROVIDER",
                    help="이미 돌린 VP 결과를 모아 프로바이더 min/max 확정 (예: --rollup AZ)")
    ap.add_argument("--base", type=float, help="baseSpm 직접 지정 (voice-table.ts 에 없을 때)")
    ap.add_argument("--no-verify", action="store_true", help="제안값 실제 생성 검증을 건너뛴다")
    ap.add_argument("--out", default="docs/spm-sweep/vp-band", help="결과 디렉터리")
    args = ap.parse_args()

    if args.rollup:
        rollup(ROOT / args.out, args.rollup)
        return
    if not args.bundle:
        sys.exit("ERROR: bundleName 을 지정하거나 --rollup PROVIDER 를 쓰세요.")

    token = load_token()
    base_spm = args.base or load_base_spm(args.bundle)
    if not base_spm:
        sys.exit(f"ERROR: {args.bundle} 의 baseSpm 을 찾을 수 없습니다. --base 로 지정하세요.")

    out_dir = ROOT / args.out
    audio_dir = out_dir / "audio" / args.bundle
    audio_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()

    print(f"[{args.bundle}] baseSpm {base_spm}")
    print("  1/3 자연 속도 측정 중...")
    baseline = measure(token, args.bundle, None, audio_dir)
    if not baseline:
        sys.exit("ERROR: 기준 음원 생성 실패")
    natural = baseline["measuredSpm"]
    print(f"      자연 발화 속도 {natural} SPM (앞뒤 무음 제외)")

    band = predict(base_spm, natural)
    print(f"  제안 구간  min {band['min']}  max {band['max']}  "
          f"(상한 근거: {'rate' if band['maxBoundBy'] == 'rate' else '전달 속도'})")

    checks = []
    if not args.no_verify:
        for label, spm in (("min", band["min"]), ("max", band["max"])):
            print(f"  {2 if label == 'min' else 3}/3 {label} 검증 중 (spm={spm})...")
            m = measure(token, args.bundle, spm, audio_dir)
            if not m:
                continue
            expected = natural * spm / base_spm
            off = m["measuredSpm"] / expected - 1
            m.update({"label": label, "expectedSpm": round(expected, 1), "offRatio": round(off, 3)})
            if abs(off) > CLAMP_WARN:
                m["warning"] = ("요청과 전달 속도가 어긋납니다. 서버 클램핑에 걸렸거나 "
                                "baseSpm 이 실제와 다를 수 있습니다.")
                print(f"      경고: 예상 {expected:.0f} SPM 인데 실측 {m['measuredSpm']} SPM ({off:+.0%})")
            else:
                print(f"      실측 {m['measuredSpm']} SPM (예상 대비 {off:+.0%})")
            checks.append(m)

    result = {
        "bundle": args.bundle,
        "provider": args.bundle.split("-")[0],
        "baseSpm": base_spm,
        "naturalSpm": natural,
        "minSpm": band["min"],
        "maxSpm": band["max"],
        "maxBoundBy": band["maxBoundBy"],
        "maxByRate": band["maxByRate"],
        "maxByDelivered": band["maxByDelivered"],
        "minRate": round(band["min"] / base_spm, 3),
        "maxRate": round(band["max"] / base_spm, 3),
        "model": {"minSlope": MIN_SLOPE, "maxRateCap": MAX_RATE_CAP,
                  "maxDeliveredSpm": MAX_DELIVERED_SPM},
        "baseline": baseline,
        "checks": checks,
        "elapsedSec": round(time.time() - started, 1),
    }
    out_json = out_dir / f"{args.bundle}.json"
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = out_dir / "summary.csv"
    new = not summary.exists()
    with summary.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["bundle", "provider", "baseSpm", "naturalSpm",
                        "minSpm", "maxSpm", "minRate", "maxRate", "maxBoundBy"])
        w.writerow([result["bundle"], result["provider"], base_spm, natural,
                    result["minSpm"], result["maxSpm"], result["minRate"],
                    result["maxRate"], result["maxBoundBy"]])

    print(f"\n  결과  {out_json.relative_to(ROOT)}")
    print(f"  누적  {summary.relative_to(ROOT)}")
    print(f"  소요  {result['elapsedSec']}초")


if __name__ == "__main__":
    main()
