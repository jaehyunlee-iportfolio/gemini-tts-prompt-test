import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedGoogleEmailDomain } from "@/lib/registry-access";
import { analyzeTextSyllables } from "@/lib/syllables";
import cmudictSyllables from "@/data/cmudict-syllables.json";

export const runtime = "nodejs";

/**
 * CMU 발음사전 기준 음절 수 계산.
 *
 * 사전 파일은 "휴리스틱이 CMUdict와 다른 단어"만 담은 예외 사전(약 225KB)이라,
 * 예외 사전 + 휴리스틱 조합이 사전 수록 단어에 대해 CMUdict를 그대로 재현한다
 * (scripts/build_syllable_dict.py 에서 불일치 0건 검증). 사전에 없는 단어는
 * 휴리스틱으로 세며, 이는 g2p_en이 OOV에 신경망을 쓰는 것과 대응한다.
 */
const DICT = cmudictSyllables as Readonly<Record<string, number>>;

const MAX_TEXT_LENGTH = 20_000;

export async function POST(req: Request) {
  const session = await auth();
  if (!isAllowedGoogleEmailDomain(session?.user?.email)) {
    return NextResponse.json(
      { error: "로그인된 @iportfolio.co.kr 계정에서만 사용할 수 있습니다." },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text =
    raw && typeof raw === "object" && typeof (raw as { text?: unknown }).text === "string"
      ? (raw as { text: string }).text
      : null;
  if (text == null) {
    return NextResponse.json({ error: "text가 필요합니다." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text가 너무 깁니다 (최대 ${MAX_TEXT_LENGTH}자).` },
      { status: 400 },
    );
  }

  const result = analyzeTextSyllables(text, DICT);
  return NextResponse.json({
    total: result.total,
    dictHits: result.dictHits,
    oov: result.oov,
    words: result.words,
    dictSize: Object.keys(DICT).length,
  });
}
