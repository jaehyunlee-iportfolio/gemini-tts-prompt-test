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
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const syllables = countTextSyllables(text);
  if (syllables === 0) return null;
  return Math.round((syllables / (durationMs / 60000)) * 10) / 10;
}
