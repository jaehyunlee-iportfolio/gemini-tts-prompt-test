#!/usr/bin/env node
/**
 * 할루시네이션 비교 배치 (2.5 Pro vs 3.8)를 브라우저 없이 실행한다.
 *
 * 문장마다 Spindle v2 Stage로 음성을 만들고 gpt-4o-transcribe로 받아 적어 원문과 비교한다.
 * 결과 JSON은 사이트 "할루시네이션 비교" 탭의 파일 선택에 그대로 올리면 청취와 판정을 이어 갈 수 있다.
 * 중간에 멈춰도 같은 --out으로 다시 실행하면 남은 건만 처리한다.
 *
 * 필요: .env.local 의 TTS_V2_AUTH_TOKEN(또는 TTS_AUTH_TOKEN), OPENAI_API_KEY (`vercel env pull .env.local`)
 *
 * 예:
 *   node scripts/halluc_batch.mjs --csv local-data/hallucination-sample-1000.csv \
 *     --out local-data/halluc-result.json --concurrency 12
 *   옵션: --models g25,g38  --emotion Default  --style-female "warm"  --style-male "cheerful"  --no-cache-bust
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { basename } from "node:path";

const V2_SAVE_URL = "https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save";
const STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const STT_MODEL = process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe";
const STT_PASS_MIN = 0.88;
const STT_REVIEW_MIN = 0.72;
const VOICES = ["Sulafat", "Puck", "Rasalgethi", "Fenrir"];

// ---- 인자, 환경변수 ----
function parseArgs(argv) {
  const a = { models: "g25,g38", emotion: "Default", styleFemale: "", styleMale: "", concurrency: 12, cacheBust: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--csv") a.csv = v();
    else if (k === "--out") a.out = v();
    else if (k === "--models") a.models = v();
    else if (k === "--emotion") a.emotion = v();
    else if (k === "--style-female") a.styleFemale = v();
    else if (k === "--style-male") a.styleMale = v();
    else if (k === "--concurrency") a.concurrency = Number(v());
    else if (k === "--no-cache-bust") a.cacheBust = false;
    else throw new Error(`알 수 없는 옵션: ${k}`);
  }
  if (!a.csv || !a.out) throw new Error("--csv 와 --out 이 필요함");
  return a;
}

function loadEnv(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/\\n/g, "\n");
  }
}

// ---- 사이트와 같은 로직 (src/lib/model-compare.ts, text-similarity.ts, cache-bust.ts) ----
const bundleFor = (model, voice, emotion) =>
  model === "g38" ? `GEMINI-${voice}-Default38` : `GEMINI-${voice}-${emotion}`;
const voiceGroup = (voice) => (voice === "Sulafat" ? "female" : "male");

function cacheBustToken() {
  const chars = "​‌‍﻿";
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  let token = "";
  for (const c of id) token += chars[c.charCodeAt(0) % chars.length];
  return ` ${token}`;
}

const normalize = (s) =>
  s.normalize("NFKC").toLowerCase().replace(/\|/g, " ").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function similarity(ref, hyp) {
  const ra = normalize(ref);
  const hb = normalize(hyp);
  if (!ra.length && !hb.length) return 1;
  if (!ra.length || !hb.length) return 0;
  return 1 - levenshtein(ra, hb) / Math.max(ra.length, hb.length);
}

const verdictOf = (s) => (s >= STT_PASS_MIN ? "pass" : s >= STT_REVIEW_MIN ? "review" : "fail");

function parseCsv(raw) {
  const s = raw.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function loadRows(path) {
  const table = parseCsv(readFileSync(path, "utf8"));
  const h = table[0].map((x) => x.trim().toLowerCase());
  const col = (name) => h.indexOf(name);
  const [iNo, iVoice, iText, iJune, iCat] = ["no", "voice", "text", "june12", "category"].map(col);
  if (iText < 0) throw new Error("CSV 헤더에 text 열이 필요함");
  const out = [];
  table.slice(1).forEach((c, i) => {
    const text = (c[iText] ?? "").trim();
    if (!text) return;
    const v = iVoice >= 0 ? (c[iVoice] ?? "").trim() : "Sulafat";
    out.push({
      no: iNo >= 0 ? (c[iNo] ?? "").trim() : String(i + 1),
      voice: VOICES.includes(v) ? v : "Sulafat",
      text,
      june12: iJune >= 0 ? (c[iJune] ?? "").trim() : "",
      category: iCat >= 0 ? (c[iCat] ?? "").trim() : "",
    });
  });
  return out;
}

// ---- 호출 ----
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e.noRetry) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function synthesize({ text, bundleName, style, cacheBust }) {
  const body = { text: text.trim() + (cacheBust ? cacheBustToken() : ""), bundleName, platform: "PLAYGROUND", userId: 2 };
  if (style) body.style = style;
  const res = await fetch(V2_SAVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SS-Authorization": process.env.SPINDLE_TOKEN },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`TTS ${res.status}: ${raw.slice(0, 200)}`);
    if (res.status === 400 || res.status === 404) err.noRetry = true;
    throw err;
  }
  const url = JSON.parse(raw).url;
  if (!url) throw new Error("TTS 응답에 url 없음");
  return url;
}

async function transcribe(url) {
  const audio = await fetch(url);
  if (!audio.ok) throw new Error(`오디오 다운로드 ${audio.status}`);
  const blob = await audio.blob();
  const form = new FormData();
  form.append("file", blob, url.endsWith(".wav") ? "audio.wav" : "audio.mp3");
  form.append("model", STT_MODEL);
  const res = await fetch(STT_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const raw = await res.text();
  if (!res.ok) throw new Error(`STT ${res.status}: ${raw.slice(0, 200)}`);
  return (JSON.parse(raw).text ?? "").trim();
}

// ---- 실행 ----
async function main() {
  loadEnv();
  process.env.SPINDLE_TOKEN = (process.env.TTS_V2_AUTH_TOKEN || process.env.TTS_AUTH_TOKEN || "").trim();
  if (!process.env.SPINDLE_TOKEN || !process.env.OPENAI_API_KEY) {
    throw new Error(".env.local 에 TTS_V2_AUTH_TOKEN(또는 TTS_AUTH_TOKEN)과 OPENAI_API_KEY 가 필요함");
  }
  const args = parseArgs(process.argv.slice(2));
  const models = args.models.split(",").map((m) => m.trim()).filter((m) => m === "g25" || m === "g38");
  const config = { emotion: args.emotion, styleFemale: args.styleFemale, styleMale: args.styleMale, cacheBust: args.cacheBust };

  let state;
  if (existsSync(args.out)) {
    state = JSON.parse(readFileSync(args.out, "utf8"));
    if (JSON.stringify(state.config) !== JSON.stringify(config)) {
      throw new Error(`${args.out} 은 다른 설정으로 만든 결과임. 새 --out 을 쓰거나 같은 설정으로 실행할 것`);
    }
  } else {
    state = { sourceName: basename(args.csv), rows: loadRows(args.csv), config, results: {} };
  }

  const jobs = [];
  state.rows.forEach((row, i) => {
    for (const m of models) {
      const key = `${i}|${m}`;
      if (state.results[key]?.status !== "done") jobs.push({ i, m, key, row });
    }
  });
  const total = state.rows.length * models.length;
  let done = total - jobs.length;
  let errors = 0;
  console.log(`문장 ${state.rows.length}개, 남은 작업 ${jobs.length}건 / 총 ${total}건, 동시 ${args.concurrency}건`);

  let dirty = 0;
  const save = () => {
    writeFileSync(args.out + ".tmp", JSON.stringify(state));
    renameSync(args.out + ".tmp", args.out);
    dirty = 0;
  };
  const startedAt = Date.now();
  const startDone = done;

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { i, m, key, row } = jobs[next++];
      const style = m === "g38" ? (voiceGroup(row.voice) === "female" ? config.styleFemale : config.styleMale) : undefined;
      try {
        const url = await withRetry(() => synthesize({ text: row.text, bundleName: bundleFor(m, row.voice, config.emotion), style, cacheBust: config.cacheBust }));
        const transcript = await withRetry(() => transcribe(url));
        const score = similarity(row.text, transcript);
        state.results[key] = { ...state.results[key], status: "done", url, transcript, score, verdict: verdictOf(score) };
      } catch (e) {
        errors++;
        state.results[key] = { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
      done++;
      if (++dirty >= 20) save();
      if (done % 50 === 0 || done === total) {
        const rate = (done - startDone) / ((Date.now() - startedAt) / 60000);
        const left = rate > 0 ? Math.ceil((total - done) / rate) : "?";
        console.log(`${done}/${total} 완료, 오류 ${errors}건, 분당 ${rate.toFixed(0)}건, 남은 시간 약 ${left}분`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  save();

  const by = {};
  for (const [k, r] of Object.entries(state.results)) {
    if (r.status !== "done") continue;
    const m = k.split("|")[1];
    by[m] ??= { pass: 0, review: 0, fail: 0 };
    by[m][r.verdict]++;
  }
  console.log("STT 판정:", JSON.stringify(by));
  console.log(errors ? `오류 ${errors}건. 같은 명령을 다시 실행하면 오류 건만 재시도함.` : "오류 없음.");
  console.log(`결과: ${args.out} -> 사이트 "할루시네이션 비교" 탭의 파일 선택에 올리면 됨`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
