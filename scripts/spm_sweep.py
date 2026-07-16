#!/usr/bin/env python3
"""
TTS v2 `spm` 파라미터 전 VP 스윕 — VP별 beginner/intermediate/advanced SPM 선정용 실측.

동작:
  1. 각 bundleName에 대해 baseline(spm 미지정, rate 1.0) 생성 → ffprobe로 길이 실측
  2. spm=163 프로브로 spm 지원 여부 확인(baseSpm 미설정 번들은 500 "baseSpm is required")
  3. SPM 그리드 생성 → 실측 SPM(음절/길이), 역산 baseSpm(spm × D_spm / D_base) 계산
  4. (옵션) gpt-4o-transcribe STT로 명료도 검증

사용:
  python3 scripts/spm_sweep.py [--out DIR] [--stt] [--bundles NAME,NAME]
키:
  TTS_V2_AUTH_TOKEN 환경변수 또는 .env.local의 TTS_V2_AUTH_TOKEN/TTS_AUTH_TOKEN
  --stt 사용 시 OPENAI_API_KEY 필요
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

V2_SAVE_URL = "https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save"

SWEEP_TEXT = (
    "The little bird flew over the tall trees and landed on the old wooden fence "
    "near the river."
)
# g2p_en(CMU 사전) 기준 — analyze_spm.py와 동일 방법으로 사전 계산
SWEEP_SYLLABLES = 23
SWEEP_WORDS = 18

# 레벨 목표(WPM 100/125/150의 SPM 환산 130/163/195)를 포함해 저속·고속 붕괴 지점까지 커버
SPM_GRID = [90, 110, 130, 145, 163, 180, 195, 220, 250]
PROBE_SPM = 163

# Confluence SS/Voice Table 활성 번들 (TC 3종은 spm 미지원 예상 — 프로브로 확인)
BUNDLES = [
    "GCP-Jeremy-Default",
    "AWS-Kevin-Default",
    "AWS-Justin-Default",
    "AZ-TuningAna-Default",
    "AZ-TuningEvelyn-Default",
    "GEMINI-Rasalgethi-Default",
    "GEMINI-Rasalgethi-Cheerful",
    "GEMINI-Rasalgethi-Gentle",
    "GEMINI-Puck-Default",
    "GEMINI-Puck-Cheerful",
    "GEMINI-Puck-Gentle",
    "GEMINI-Fenrir-Default",
    "GEMINI-Fenrir-Cheerful",
    "GEMINI-Fenrir-Gentle",
    "GCP-Rey-Default",
    "AZ-TuningMaisie-Default",
    "AZ-Guy-Friendly",
    "TC-Tim-Default",
    "AZ-Oliver-Default",
    "AZ-Tony-Default",
    "TC-Sindarin-Default",
    "AZ-Alfie-Default",
    "AZ-Ana-Default",
    "AZ-Maisie-Default",
    "AZ-Sara-Friendly",
    "AZ-Jenny-Cheerful",
    "TC-Harper-Default",
    "GEMINI-Sulafat-Default",
    "GEMINI-Sulafat-Cheerful",
    "GEMINI-Sulafat-Gentle",
    "CHIRP-Zephyr-Default",
    "AZ-Sonia-Cheerful",
    "AZ-Nancy-Default",
    "AZ-Hollie-Default",
]

BUNDLE_CONCURRENCY = 3
CALL_PAUSE_SEC = 0.3
REQUEST_TIMEOUT_SEC = 120


def load_auth_token() -> str:
    for key in ("TTS_V2_AUTH_TOKEN", "TTS_AUTH_TOKEN"):
        v = os.environ.get(key)
        if v:
            return v
    env_local = Path(__file__).resolve().parent.parent / ".env.local"
    if env_local.exists():
        for line in env_local.read_text().splitlines():
            m = re.match(r"^(TTS_V2_AUTH_TOKEN|TTS_AUTH_TOKEN)=(.+)$", line.strip())
            if m:
                return m.group(2).strip()
    print("ERROR: TTS_V2_AUTH_TOKEN 이 없습니다 (.env.local 또는 환경변수)", file=sys.stderr)
    sys.exit(1)


def http_json(url: str, body: dict, headers: dict) -> tuple[int, dict | str]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:  # noqa: BLE001 — 네트워크 오류는 문자열로 기록
        return 0, str(e)


def synthesize(token: str, bundle: str, spm: float | None) -> dict:
    body: dict = {
        "text": SWEEP_TEXT,
        "bundleName": bundle,
        "platform": "PLAYGROUND",
        "userId": 2,
    }
    if spm is not None:
        body["spm"] = spm
    headers = {"Content-Type": "application/json", "X-SS-Authorization": token}
    started = time.time()
    status, payload = http_json(V2_SAVE_URL, body, headers)
    elapsed_ms = round((time.time() - started) * 1000)
    if status == 200 and isinstance(payload, dict) and payload.get("url"):
        return {"ok": True, "url": payload["url"], "elapsedMs": elapsed_ms}
    detail = ""
    if isinstance(payload, dict):
        detail = str(payload.get("detail") or payload.get("message") or payload)
    else:
        detail = str(payload)[:300]
    return {"ok": False, "status": status, "error": detail, "elapsedMs": elapsed_ms}


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=60) as resp:
            dest.write_bytes(resp.read())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  다운로드 실패 {url}: {e}", file=sys.stderr)
        return False


def probe_duration_sec(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        d = float(out)
        return d if d > 0 else None
    except Exception:  # noqa: BLE001
        return None


def sweep_bundle(token: str, bundle: str, audio_dir: Path) -> dict:
    rows: list[dict] = []
    bundle_dir = audio_dir / bundle
    bundle_dir.mkdir(parents=True, exist_ok=True)

    def run_one(spm: float | None, retry: bool = True) -> dict:
        label = "base" if spm is None else str(spm)
        r = synthesize(token, bundle, spm)
        if not r["ok"] and retry and "baseSpm" not in r.get("error", ""):
            time.sleep(1.5)
            r = synthesize(token, bundle, spm)
        row: dict = {"bundle": bundle, "spm": spm, "label": label, **r}
        if r["ok"]:
            f = bundle_dir / f"{label}.mp3"
            if download(r["url"], f):
                dur = probe_duration_sec(f)
                if dur:
                    row["durationSec"] = round(dur, 3)
                    row["measuredSpm"] = round(SWEEP_SYLLABLES / dur * 60, 1)
                    row["measuredWpm"] = round(SWEEP_WORDS / dur * 60, 1)
                row["file"] = str(f)
        time.sleep(CALL_PAUSE_SEC)
        return row

    base_row = run_one(None)
    rows.append(base_row)
    base_dur = base_row.get("durationSec")

    probe_row = run_one(PROBE_SPM)
    spm_supported = probe_row["ok"]
    rows.append(probe_row)

    if spm_supported:
        for spm in SPM_GRID:
            if spm == PROBE_SPM:
                continue
            rows.append(run_one(spm))

    # 역산 baseSpm = spm × (D_spm / D_base) — rate가 선형 반영될 때 성립
    derived: list[float] = []
    for row in rows:
        if row.get("spm") and row.get("durationSec") and base_dur:
            d = round(row["spm"] * row["durationSec"] / base_dur, 1)
            row["derivedBaseSpm"] = d
            derived.append(d)

    derived_sorted = sorted(derived)
    median_base = derived_sorted[len(derived_sorted) // 2] if derived_sorted else None
    result = {
        "bundle": bundle,
        "spmSupported": spm_supported,
        "unsupportedReason": None if spm_supported else probe_row.get("error"),
        "baselineDurationSec": base_dur,
        "baselineMeasuredSpm": base_row.get("measuredSpm"),
        "derivedBaseSpmMedian": median_base,
        "rows": rows,
    }
    ok_n = sum(1 for r in rows if r.get("ok"))
    print(
        f"[{bundle}] done — {ok_n}/{len(rows)} ok, baseline "
        f"{base_row.get('measuredSpm')} SPM, derived base {median_base}",
        flush=True,
    )
    return result


def norm_words(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9 ]", " ", text.lower()).split()


def stt_transcribe(api_key: str, path: Path) -> str | None:
    """gpt-4o-transcribe 전사 — curl 멀티파트 (표준 라이브러리 회피)"""
    try:
        out = subprocess.run(
            [
                "curl", "-sS", "--max-time", "90",
                "https://api.openai.com/v1/audio/transcriptions",
                "-H", f"Authorization: Bearer {api_key}",
                "-F", f"file=@{path}",
                "-F", "model=gpt-4o-transcribe",
                "-F", "language=en",
            ],
            capture_output=True, text=True, timeout=120, check=True,
        ).stdout
        j = json.loads(out)
        return j.get("text")
    except Exception:  # noqa: BLE001
        return None


def add_stt(results: list[dict], api_key: str) -> None:
    jobs = [
        row
        for res in results
        for row in res["rows"]
        if row.get("ok") and row.get("file")
    ]
    print(f"STT 검증 시작 — {len(jobs)}건", flush=True)

    def work(row: dict) -> None:
        t = stt_transcribe(api_key, Path(row["file"]))
        if t is None:
            row["sttError"] = True
            return
        row["sttTranscript"] = t
        ratio = difflib.SequenceMatcher(
            None, " ".join(norm_words(SWEEP_TEXT)), " ".join(norm_words(t))
        ).ratio()
        row["sttScore"] = round(ratio, 3)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(work, jobs))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="결과 출력 디렉토리")
    ap.add_argument("--audio-dir", default=None, help="mp3 저장 디렉토리")
    ap.add_argument("--stt", action="store_true", help="gpt-4o-transcribe STT 검증 포함")
    ap.add_argument("--bundles", default=None, help="쉼표 구분 번들 지정(기본 전체)")
    args = ap.parse_args()

    token = load_auth_token()
    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "docs" / "spm-sweep"
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = Path(args.audio_dir) if args.audio_dir else out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    bundles = args.bundles.split(",") if args.bundles else BUNDLES
    print(f"스윕 시작 — 번들 {len(bundles)}개, 그리드 {SPM_GRID}, 텍스트 {SWEEP_SYLLABLES}음절", flush=True)

    started = time.time()
    with ThreadPoolExecutor(max_workers=BUNDLE_CONCURRENCY) as ex:
        results = list(ex.map(lambda b: sweep_bundle(token, b, audio_dir), bundles))

    if args.stt:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("OPENAI_API_KEY 없음 — STT 생략", file=sys.stderr)
        else:
            add_stt(results, api_key)

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "text": SWEEP_TEXT,
        "syllables": SWEEP_SYLLABLES,
        "words": SWEEP_WORDS,
        "spmGrid": SPM_GRID,
        "elapsedSec": round(time.time() - started, 1),
        "results": results,
    }
    (out_dir / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))

    with (out_dir / "results.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "bundle", "spm", "ok", "durationSec", "measuredSpm", "measuredWpm",
            "derivedBaseSpm", "sttScore", "elapsedMs", "error", "url",
        ])
        for res in results:
            for row in res["rows"]:
                w.writerow([
                    row["bundle"], row["label"], row.get("ok"),
                    row.get("durationSec"), row.get("measuredSpm"), row.get("measuredWpm"),
                    row.get("derivedBaseSpm"), row.get("sttScore"),
                    row.get("elapsedMs"), row.get("error", ""), row.get("url", ""),
                ])

    print(f"완료 — {out_dir}/results.json, results.csv ({payload['elapsedSec']}s)", flush=True)


if __name__ == "__main__":
    main()
