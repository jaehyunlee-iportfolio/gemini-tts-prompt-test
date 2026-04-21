/** 다운로드용: `CID_IMAGEID_문장일부.mp3` (파일시스템에 안전한 문자만). */
export function buildClipBaseName(
  contentId: string,
  imageId: string,
  spokenText: string,
  maxHintLen = 56,
) {
  const hint = spokenText
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[/\\:*?"<>|\u0000-\u001F]/g, "_")
    .slice(0, maxHintLen)
    .replace(/[.\s_]+$/, "");
  const safeCid = contentId.replace(/[/\\:*?"<>|\u0000-\u001F]/g, "_");
  const safeIid = imageId.replace(/[/\\:*?"<>|\u0000-\u001F]/g, "_");
  const tail = hint.length > 0 ? hint : "utterance";
  return `${safeCid}_${safeIid}_${tail}`;
}
