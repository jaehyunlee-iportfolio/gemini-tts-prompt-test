export type QaVerdict = "pass" | "review" | "fail";

export function normalizeForCompare(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\|/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** 0~1, 1에 가까울수록 동일. */
export function stringSimilarity(reference: string, hypothesis: string): number {
  const ra = normalizeForCompare(reference);
  const hb = normalizeForCompare(hypothesis);
  if (!ra.length && !hb.length) return 1;
  if (!ra.length || !hb.length) return 0;
  const d = levenshtein(ra, hb);
  return 1 - d / Math.max(ra.length, hb.length);
}

export function verdictFromScore(
  score: number,
  passMin: number,
  reviewMin: number,
): QaVerdict {
  if (score >= passMin) return "pass";
  if (score >= reviewMin) return "review";
  return "fail";
}

export function verdictLabelKo(v: QaVerdict) {
  if (v === "pass") return "통과";
  if (v === "review") return "검토필요";
  return "실패";
}
