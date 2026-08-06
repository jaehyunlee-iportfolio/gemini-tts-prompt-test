/**
 * 업로드한 오디오의 발화 구간 분석 — 선행·후행 무음을 제외한 실제 발화 길이를 구한다.
 *
 * 프로바이더별로 꼬리 무음이 0.3~0.9초씩 달라(측정 결과: Azure 약 0.85s, GCP 약 0.73s,
 * AWS 0s) 총 길이 기준 SPM은 발화 속도를 과소평가한다. 그래서 총 길이와 발화 구간
 * 두 기준을 함께 낸다.
 *
 * 기준은 팀 스크립트(scripts/spm_postprocess.py, ffmpeg silencedetect
 * noise=-35dB:d=0.25)와 맞춘다.
 */

export const SILENCE_THRESHOLD_DB = -35;
/** 무음으로 인정하는 최소 길이(초) — ffmpeg silencedetect d=0.25 와 동일 */
export const SILENCE_MIN_SEC = 0.25;
/** RMS 측정 창(ms) — ffmpeg silencedetect의 기본 window 0.02s와 맞춰 판정 민감도를 일치시킨다 */
const HOP_MS = 20;

export type AudioAnalysis = {
  totalSec: number;
  leadSilenceSec: number;
  tailSilenceSec: number;
  /** 총 길이에서 선행·후행 무음을 뺀 발화 구간 길이 */
  speechSec: number;
  sampleRate: number;
  channels: number;
};

/** 채널 병합 모노 샘플 */
function toMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= numberOfChannels;
  return mono;
}

export function analyzeAudioBuffer(
  buffer: AudioBuffer,
  thresholdDb: number = SILENCE_THRESHOLD_DB,
): AudioAnalysis {
  const samples = toMono(buffer);
  const sampleRate = buffer.sampleRate;
  const hop = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const threshold = Math.pow(10, thresholdDb / 20);
  const totalSec = buffer.duration;

  // 프레임별 RMS로 발화/무음 판정
  let firstVoiced = -1;
  let lastVoiced = -1;
  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    if (rms >= threshold) {
      if (firstVoiced < 0) firstVoiced = start;
      lastVoiced = end;
    }
  }

  if (firstVoiced < 0) {
    // 전 구간 무음 — 발화 구간 없음
    return {
      totalSec,
      leadSilenceSec: totalSec,
      tailSilenceSec: 0,
      speechSec: 0,
      sampleRate,
      channels: buffer.numberOfChannels,
    };
  }

  const leadRaw = firstVoiced / sampleRate;
  const tailRaw = totalSec - lastVoiced / sampleRate;
  // 최소 길이 미만의 짧은 여백은 무음으로 세지 않는다(ffmpeg d=0.25 와 동일 취지)
  const leadSilenceSec = leadRaw >= SILENCE_MIN_SEC ? leadRaw : 0;
  const tailSilenceSec = tailRaw >= SILENCE_MIN_SEC ? tailRaw : 0;
  const speechSec = Math.max(0.01, totalSec - leadSilenceSec - tailSilenceSec);

  return {
    totalSec,
    leadSilenceSec,
    tailSilenceSec,
    speechSec,
    sampleRate,
    channels: buffer.numberOfChannels,
  };
}

/** 파일을 디코드해 발화 구간을 분석한다. 디코드 실패 시 null */
export async function analyzeAudioFile(file: File | Blob): Promise<AudioAnalysis | null> {
  const AC: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  const ctx = new AC();
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    return analyzeAudioBuffer(buffer);
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}
