#!/usr/bin/env python3
"""
전 VP(프로바이더 전체) 실측 SPM 표시 검증용 데이터 수집.

각 VP를 그 프로바이더의 적용 I값(고정 165를 min/max로 클램프)으로 1회 생성하고,
ffprobe로 오디오 길이를 재서 실측 SPM을 계산한다. 동시에 브라우저 검증용
HTML 페이지를 생성해, 실제 <audio>에서 duration을 읽을 수 있는지(= UI에 실측이
표시되는지) 프로바이더별로 확인할 수 있게 한다.

산출물:
  docs/spm-sweep/measure-all.json
  docs/spm-sweep/measure-all-browser-test.html   (Browser로 열어 검증)
"""
from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spm_sweep import download, load_auth_token, probe_duration_sec, synthesize

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "spm-sweep"

# UI 기본 청취 문장과 동일 (spm-audition-tab / spm-matrix-tab DEFAULT_TEXT)
TEXT = (
    "The little bird flew over the tall trees and landed on the old wooden fence near the river."
)

# 확정 min/max (SPM) + 고정 B/I/A
PROVIDER_RANGE = {
    "GEMINI": (120, 210),
    "GCP": (160, 220),
    "AWS": (180, 220),
    "CHIRP": (170, 230),
    "AZ": (130, 170),
}
LEVELS = {"B": 145, "I": 165, "A": 165}


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def load_profiles() -> list[tuple[str, float]]:
    """voice-table.ts에서 baseSpm 있는 VP만 (bundleName, baseSpm)."""
    ts = (ROOT / "src" / "lib" / "voice-table.ts").read_text()
    out = []
    for m in re.finditer(r'bundleName:\s*"([\w-]+)".*?baseSpm:\s*([\d.]+)', ts):
        out.append((m.group(1), float(m.group(2))))
    return out


def js_syllables(text: str) -> int:
    """src/lib/syllables.ts countTextSyllables 동일 로직 포팅(브라우저와 값 일치 확인용)."""
    total = 0
    for token in re.split(r"\s+", text):
        if not token:
            continue
        total += len(re.sub(r"\D", "", token))
        word = re.sub(r"[^a-z]", "", token.lower())
        if not word:
            continue
        if len(word) <= 2:
            total += 1
            continue
        groups = re.findall(r"[aeiouy]+", word)
        count = len(groups) if groups else 1
        if re.search(r"[^aeiouy]e$", word) and not re.search(r"[^aeiouy]le$", word):
            count -= 1
        if re.search(r"[^aeiouy]ed$", word) and not re.search(r"[td]ed$", word):
            count -= 1
        total += max(1, count)
    return total


SYLLABLES = js_syllables(TEXT)


def measure(token: str, bundle: str, base_spm: float, audio_dir: Path) -> dict:
    prov = bundle.split("-")[0]
    lo, hi = PROVIDER_RANGE.get(prov, (0, 10_000))
    spm = clamp(LEVELS["I"], lo, hi)

    row: dict = {
        "bundle": bundle,
        "provider": prov,
        "baseSpm": base_spm,
        "requestSpm": spm,
        "rate": round(spm / base_spm, 3) if base_spm else None,
    }
    r = synthesize(token, bundle, spm)
    if not r.get("ok"):
        row["error"] = str(r.get("error") or r.get("detail") or "synthesize failed")[:200]
        print(f"[FAIL ] {bundle:28} {row['error']}", flush=True)
        return row

    url = r["url"]
    row["url"] = url
    dest = audio_dir / f"{bundle}_{spm}.mp3"
    if not download(url, dest):
        row["error"] = "download failed"
        print(f"[FAIL ] {bundle:28} download failed", flush=True)
        return row

    row["bytes"] = dest.stat().st_size
    dur = probe_duration_sec(dest)
    if not dur or dur <= 0:
        row["error"] = "ffprobe duration unreadable"
        print(f"[FAIL ] {bundle:28} duration unreadable", flush=True)
        return row

    row["durationSec"] = round(dur, 3)
    row["measuredSpm"] = round(SYLLABLES / (dur / 60) * 10) / 10
    row["deltaPct"] = round((row["measuredSpm"] - spm) / spm * 100)
    print(
        f"[ ok  ] {bundle:28} base{base_spm:>6.1f} req{spm:>4} "
        f"dur{dur:6.2f}s 실측{row['measuredSpm']:>7.1f} ({row['deltaPct']:+d}%)",
        flush=True,
    )
    return row


def build_browser_test(rows: list[dict]) -> str:
    """브라우저에서 <audio>.duration을 실제로 읽어 실측 SPM이 표시되는지 검증하는 페이지."""
    data = [
        {
            "bundle": r["bundle"],
            "provider": r["provider"],
            "url": r["url"],
            "requestSpm": r["requestSpm"],
            "ffprobeSpm": r.get("measuredSpm"),
        }
        for r in rows
        if r.get("url")
    ]
    return f"""<!doctype html>
<meta charset="utf-8">
<title>실측 SPM 브라우저 검증</title>
<style>
 body{{font:13px system-ui;margin:16px}}
 table{{border-collapse:collapse}}
 td,th{{border:1px solid #ddd;padding:4px 8px;text-align:right}}
 td:first-child,th:first-child,td:nth-child(2){{text-align:left}}
 .ok{{color:#0a0}} .bad{{color:#c00;font-weight:700}}
 #sum{{font-size:15px;font-weight:700;margin:10px 0}}
</style>
<h3>브라우저 audio.duration 기반 실측 SPM 검증</h3>
<div id="sum">측정 중...</div>
<table id="t"><thead><tr>
<th>bundle</th><th>prov</th><th>요청 spm</th><th>duration</th>
<th>실측 SPM (브라우저)</th><th>ffprobe SPM</th><th>차이</th><th>표시</th>
</tr></thead><tbody></tbody></table>
<script>
const DATA = {json.dumps(data, ensure_ascii=False)};
const TEXT = {json.dumps(TEXT)};
function countWordSyllables(rawWord){{
  const word = rawWord.toLowerCase().replace(/[^a-z]/g,"");
  if(!word) return 0;
  if(word.length<=2) return 1;
  const groups = word.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  if(/[^aeiouy]e$/.test(word) && !/[^aeiouy]le$/.test(word)) count -= 1;
  if(/[^aeiouy]ed$/.test(word) && !/[td]ed$/.test(word)) count -= 1;
  return Math.max(1,count);
}}
function countTextSyllables(text){{
  let total=0;
  for(const token of text.split(/\\s+/)){{
    if(!token) continue;
    total += token.replace(/\\D/g,"").length;
    total += countWordSyllables(token);
  }}
  return total;
}}
function computeSpm(text,durationMs){{
  if(!Number.isFinite(durationMs)||durationMs<=0) return null;
  const s=countTextSyllables(text);
  if(s===0) return null;
  return Math.round((s/(durationMs/60000))*10)/10;
}}
const SYL = countTextSyllables(TEXT);
function readDuration(url){{
  return new Promise((resolve)=>{{
    const a=document.createElement("audio");
    a.preload="metadata"; a.src=url;
    let done=false;
    const finish=(d)=>{{ if(done) return; done=true; resolve(d); }};
    a.addEventListener("loadedmetadata",()=>finish(a.duration));
    a.addEventListener("error",()=>finish(null));
    setTimeout(()=>finish(null),20000);
  }});
}}
(async()=>{{
  const tb=document.querySelector("#t tbody");
  let shown=0, missing=0, mismatch=0;
  for(const d of DATA){{
    const dur=await readDuration(d.url);
    const ms=(dur!=null&&Number.isFinite(dur))?Math.round(dur*1000):NaN;
    const spm=computeSpm(TEXT,ms);
    const ok=spm!=null;
    if(ok) shown++; else missing++;
    let diff="";
    if(ok&&d.ffprobeSpm){{
      const p=Math.abs(spm-d.ffprobeSpm)/d.ffprobeSpm*100;
      diff=p.toFixed(1)+"%";
      if(p>2) mismatch++;
    }}
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${{d.bundle}}</td><td>${{d.provider}}</td><td>${{d.requestSpm}}</td>`
      +`<td>${{dur==null?"null":(Number.isFinite(dur)?dur.toFixed(2)+"s":String(dur))}}</td>`
      +`<td>${{ok?spm:"—"}}</td><td>${{d.ffprobeSpm??"-"}}</td><td>${{diff}}</td>`
      +`<td class="${{ok?"ok":"bad"}}">${{ok?"표시됨":"실패"}}</td>`;
    tb.appendChild(tr);
    document.querySelector("#sum").textContent =
      `총 ${{DATA.length}} / 표시됨 ${{shown}} / 실패 ${{missing}} / ffprobe와 2%↑ 불일치 ${{mismatch}} (음절 ${{SYL}})`;
  }}
  document.title = missing===0 ? "ALL_OK" : "HAS_FAILURE";
  document.querySelector("#sum").textContent +=
    missing===0 ? "  => 전 VP 표시 정상" : "  => 표시 실패 있음";
}})();
</script>
"""


def main() -> None:
    token = load_auth_token()
    profiles = load_profiles()
    audio_dir = OUT / "measure-all-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    print(f"전 VP 실측 수집: {len(profiles)}개 VP, 음절 {SYLLABLES}\n", flush=True)

    with ThreadPoolExecutor(max_workers=3) as ex:
        rows = list(ex.map(lambda p: measure(token, p[0], p[1], audio_dir), profiles))

    ok = [r for r in rows if r.get("measuredSpm")]
    bad = [r for r in rows if not r.get("measuredSpm")]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "measure-all.json").write_text(
        json.dumps(
            {"text": TEXT, "syllables": SYLLABLES, "levels": LEVELS,
             "providerRange": PROVIDER_RANGE, "results": rows},
            ensure_ascii=False, indent=2,
        )
    )
    (OUT / "measure-all-browser-test.html").write_text(build_browser_test(rows))

    print("\n=== 프로바이더별 요약 (ffprobe 실측) ===", flush=True)
    for prov in ("GEMINI", "GCP", "AWS", "CHIRP", "AZ"):
        rs = [r for r in ok if r["provider"] == prov]
        if not rs:
            print(f"  {prov:7} 성공 0건", flush=True)
            continue
        ms = [r["measuredSpm"] for r in rs]
        print(
            f"  {prov:7} {len(rs):2}개 VP  요청 {rs[0]['requestSpm']:>3} "
            f"-> 실측 {min(ms):.0f}~{max(ms):.0f} SPM", flush=True,
        )
    print(f"\n성공 {len(ok)} / 실패 {len(bad)}", flush=True)
    for r in bad:
        print(f"  실패: {r['bundle']} - {r.get('error')}", flush=True)
    print(f"\n산출물: {OUT}/measure-all.json, {OUT}/measure-all-browser-test.html", flush=True)


if __name__ == "__main__":
    main()
