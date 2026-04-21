import { Mp3Encoder } from "lamejs";

/** Gemini TTS PCM: mono 24kHz 16-bit LE ([문서](https://ai.google.dev/gemini-api/docs/speech-generation)) */
const SAMPLE_RATE = 24000;
const MP3_KBPS = 128;
const BLOCK = 1152;

export function pcmS16leMonoToMp3(pcm: Buffer): Buffer {
  if (pcm.length < 2 || pcm.length % 2 !== 0) {
    throw new Error("PCM buffer length must be a positive even number of bytes");
  }
  const sampleCount = pcm.length / 2;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcm.readInt16LE(i * 2);
  }
  const enc = new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS);
  const chunks: Buffer[] = [];
  for (let i = 0; i < samples.length; i += BLOCK) {
    const chunk = samples.subarray(i, Math.min(i + BLOCK, samples.length));
    const mp3buf = enc.encodeBuffer(chunk);
    if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}
