export type QueryCsvRow = {
  rowIndex: number;
  text: string;
  content_id: string;
  image_id: string;
};

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** `text` 열의 파이프는 발화용으로 공백으로 바꿉니다. */
export function spokenTextFromCsvCell(text: string) {
  return text.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}

/** 오른쪽 두 컬럼을 `content_id`, `image_id`로 보고 나머지 전부를 `text`로 뭉칩니다(텍스트에 쉼표가 있어도 동작). */
function splitTrailingTwo(line: string): [string, string, string] | null {
  const parts = line.split(",");
  if (parts.length < 3) return null;
  const image_id = (parts[parts.length - 1] ?? "").trim();
  const content_id = (parts[parts.length - 2] ?? "").trim();
  const text = parts.slice(0, -2).join(",").trim();
  if (!text || !content_id || !image_id) return null;
  return [text, content_id, image_id];
}

/**
 * `query_result` 형 CSV: 헤더에 `text`, `content_id`, `image_id`가 있거나,
 * 헤더 없이 세 필드 이상인 데이터 행만 있어도 됩니다.
 */
export function parseQueryResultCsv(raw: string): QueryCsvRow[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const first = lines[0]!;
  const firstParts = first.split(",").map((p) => normalizeHeader(p));
  const looksHeader =
    firstParts.includes("text") &&
    (firstParts.includes("content_id") || firstParts.includes("cid")) &&
    (firstParts.includes("image_id") || firstParts.includes("imageid"));

  let dataLines = lines;
  let colText = 0;
  let colCid = 1;
  let colIid = 2;

  if (looksHeader) {
    const headers = first.split(",").map((h) => normalizeHeader(h));
    const idx = (name: string, ...alts: string[]) => {
      for (const n of [name, ...alts]) {
        const i = headers.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iText = idx("text", "sentence", "utterance");
    const iCid = idx("content_id", "cid");
    const iIid = idx("image_id", "imageid");
    if (iText < 0 || iCid < 0 || iIid < 0) {
      throw new Error("CSV 헤더에서 text / content_id / image_id 열을 찾지 못했습니다.");
    }
    colText = iText;
    colCid = iCid;
    colIid = iIid;
    dataLines = lines.slice(1);
  }

  const out: QueryCsvRow[] = [];
  let rowIndex = 0;
  for (const line of dataLines) {
    rowIndex += 1;
    if (looksHeader) {
      const cells = splitCsvLine(line);
      const text = (cells[colText] ?? "").trim();
      const content_id = (cells[colCid] ?? "").trim();
      const image_id = (cells[colIid] ?? "").trim();
      if (!text && !content_id && !image_id) continue;
      if (!text || !content_id || !image_id) continue;
      out.push({ rowIndex, text, content_id, image_id });
    } else {
      const triple = splitTrailingTwo(line);
      if (!triple) continue;
      const [text, content_id, image_id] = triple;
      out.push({ rowIndex, text, content_id, image_id });
    }
  }
  return out;
}

/** 간단한 따옴표 인식 CSV 한 줄 파싱. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  cells.push(cur);
  return cells;
}
