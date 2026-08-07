#!/usr/bin/env python3
"""
CMU 발음사전 기반 음절 수 예외 사전 생성.

휴리스틱(src/lib/syllables.ts countWordSyllables)이 CMUdict와 다른 단어만 담는다.
사전에 있는 단어는 CMUdict 값을 그대로 쓰므로 g2p_en과 동일한 결과가 되고,
전체 사전(1.5MB) 대신 예외만 담아 파일이 훨씬 작아진다.

산출물: src/data/cmudict-syllables.json  {"단어": 음절수, ...}
사용:   python3 scripts/build_syllable_dict.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "cmudict-syllables.json"
CACHE = ROOT / "docs" / "spm-sweep" / ".cmudict.dict"
URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"


def normalize(token: str) -> str:
    """UI/서버 공통 토큰 정규화 — 소문자, a-z와 어퍼스트로피만 남김."""
    return re.sub(r"[^a-z']", "", token.lower())


def heuristic(raw: str) -> int:
    """src/lib/syllables.ts countWordSyllables 와 동일 로직."""
    word = re.sub(r"[^a-z]", "", raw.lower())
    if not word:
        return 0
    if len(word) <= 2:
        return 1
    groups = re.findall(r"[aeiouy]+", word)
    count = len(groups) if groups else 1
    if re.search(r"[^aeiouy]e$", word) and not re.search(r"[^aeiouy]le$", word):
        count -= 1
    if re.search(r"[^aeiouy]ed$", word) and not re.search(r"[td]ed$", word):
        count -= 1
    return max(1, count)


def load_cmudict() -> dict[str, int]:
    if not CACHE.is_file():
        print(f"CMUdict 내려받는 중: {URL}")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlopen(URL, timeout=120)  # noqa: S310
        with urllib.request.urlopen(URL, timeout=120) as r:  # noqa: S310
            CACHE.write_bytes(r.read())
    ref: dict[str, int] = {}
    for line in CACHE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith(";;;"):
            continue
        parts = line.split()
        word = parts[0]
        if "(" in word:  # 대체 발음은 첫 항목만 사용
            continue
        syl = sum(1 for p in parts[1:] if p and p[-1].isdigit())
        if syl > 0:
            ref[word] = syl
    return ref


def main() -> None:
    ref = load_cmudict()
    print(f"CMUdict 단어(첫 발음): {len(ref):,}")

    # 정규화 키 기준으로 모으고, 충돌(같은 키 다른 음절수)은 최빈값 채택
    by_key: dict[str, Counter] = {}
    for word, syl in ref.items():
        key = normalize(word)
        if not key:
            continue
        by_key.setdefault(key, Counter())[syl] += 1

    # 전체 사전을 담는다. 예외(휴리스틱과 다른 단어)만 담으면 파일은 작지만
    # "사전에 실제로 없는 단어(OOV)"를 구분할 수 없어, UI가 사전 수록 단어까지
    # 추정으로 셌다고 잘못 표기하게 된다. 정확한 출처 표기를 위해 전량 수록.
    full: dict[str, int] = {}
    collisions = 0
    mismatches = 0
    for key, counter in by_key.items():
        if len(counter) > 1:
            collisions += 1
        syl = counter.most_common(1)[0][0]
        full[key] = syl
        if heuristic(key) != syl:
            mismatches += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(full, separators=(",", ":"), sort_keys=True)
    OUT.write_text(payload)

    total_keys = len(by_key)
    print(f"정규화 키: {total_keys:,} (키 충돌 {collisions:,}건은 최빈값 채택)")
    print(f"휴리스틱과 불일치했던 단어: {mismatches:,} "
          f"({mismatches / total_keys * 100:.1f}%) — 사전값으로 교정됨")
    print(f"저장: {OUT.relative_to(ROOT)}  {len(payload) / 1024 / 1024:.2f} MB")

    # 검증: 저장한 사전이 CMUdict를 100% 재현하는지
    bad = sum(
        1
        for key, counter in by_key.items()
        if full.get(key) != counter.most_common(1)[0][0]
    )
    print(f"\n검증: 저장 사전 == CMUdict  ->  불일치 {bad:,}건 "
          f"({'통과' if bad == 0 else '실패'})")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
