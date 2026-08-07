/**
 * 영어 음절 수 추정 — 발화 속도(SPM, syllables per minute) 실측용.
 * 팀 표준(analyze_spm.py)은 g2p_en(CMU 사전) 기반이지만 브라우저에서는
 * 모음군(vowel group) 휴리스틱으로 근사한다: 일반 문장 기준 ±5% 내외 오차.
 * 절대값이 서버 산정과 다를 수 있으므로, 실측 SPM은 동일 텍스트 내
 * 상대 비교(요청 spm 대비 변화율) 지표로 쓰는 것이 안전하다.
 */

/** 단어 1개의 음절 수 (최소 1) */
export function countWordSyllables(rawWord: string): number {
  const word = rawWord.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 2) return 1;

  const groups = word.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;

  // silent e ("make", "note") — 단 "-le" 음절("table", "little")은 유지
  if (/[^aeiouy]e$/.test(word) && !/[^aeiouy]le$/.test(word)) {
    count -= 1;
  }
  // -ed 는 t/d 뒤에서만 음절 ("wanted" 2모음군 유지, "walked"는 1로 보정)
  if (/[^aeiouy]ed$/.test(word) && !/[td]ed$/.test(word)) {
    count -= 1;
  }

  return Math.max(1, count);
}

/** 텍스트 전체 음절 수 — 숫자는 자릿수 읽기로 근사(숫자 1자리 ≈ 1음절) */
export function countTextSyllables(text: string): number {
  let total = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    total += token.replace(/\D/g, "").length; // "2026" → 4음절 근사
    total += countWordSyllables(token);
  }
  return total;
}

/** 실측 SPM = 음절 수 / (duration분). durationMs가 유효하지 않으면 null */
export function computeSpm(text: string, durationMs: number): number | null {
  return spmFromSyllables(countTextSyllables(text), durationMs);
}

/** 음절 수를 이미 아는 경우(사전 조회 결과·사용자 지정값)의 SPM 계산 */
export function spmFromSyllables(syllables: number, durationMs: number): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (!Number.isFinite(syllables) || syllables <= 0) return null;
  return Math.round((syllables / (durationMs / 60000)) * 10) / 10;
}

/** 사전 조회용 토큰 정규화 — 소문자, a-z와 어퍼스트로피만 (scripts/build_syllable_dict.py와 동일) */
export function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z']/g, "");
}

export type SyllableWord = {
  token: string;
  syllables: number;
  /** dict = CMU 발음사전 값, heuristic = 모음군 추정 */
  source: "dict" | "heuristic";
};

export type SyllableAnalysis = {
  total: number;
  words: SyllableWord[];
  /** 사전에서 찾은 단어 수 */
  dictHits: number;
  /** 사전에 없어 추정으로 센 단어들 */
  oov: string[];
};

/**
 * 텍스트 음절 분석. dict(예외 사전)가 있으면 그 값을 우선 쓰고, 없는 단어는 휴리스틱으로 센다.
 * 예외 사전은 "휴리스틱이 CMUdict와 다른 단어"만 담으므로, 사전에 없다고 해서 곧바로
 * 부정확한 것은 아니다(사전에 없으면서 휴리스틱이 맞는 경우가 대부분).
 */
export function analyzeTextSyllables(
  text: string,
  dict?: Readonly<Record<string, number>>,
): SyllableAnalysis {
  const words: SyllableWord[] = [];
  let total = 0;
  let dictHits = 0;
  const oov: string[] = [];

  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    // 숫자는 자릿수만큼 음절로 근사 ("2026" -> 4)
    const digits = token.replace(/\D/g, "").length;
    if (digits > 0) total += digits;

    const key = normalizeToken(token);
    if (!key) {
      if (digits > 0) words.push({ token, syllables: digits, source: "heuristic" });
      continue;
    }

    const fromDict = dict ? dict[key] : undefined;
    const syllables = typeof fromDict === "number" ? fromDict : countWordSyllables(token);
    if (typeof fromDict === "number") {
      dictHits += 1;
    } else if (dict) {
      oov.push(key);
    }
    total += syllables;
    words.push({
      token,
      syllables: syllables + digits,
      source: typeof fromDict === "number" ? "dict" : "heuristic",
    });
  }

  return { total, words, dictHits, oov };
}
