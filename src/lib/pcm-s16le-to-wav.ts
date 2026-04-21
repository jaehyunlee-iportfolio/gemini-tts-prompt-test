/** Gemini TTS PCM: mono 24kHz 16-bit LE — WAV 컨테이너로 감쌉니다. */
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

export function pcmS16leMonoToWav(pcm: Buffer): Buffer {
  if (pcm.length < 2 || pcm.length % 2 !== 0) {
    throw new Error("PCM buffer length must be a positive even number of bytes");
  }
  const dataSize = pcm.length;
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const chunkSize = 36 + dataSize;
  const out = Buffer.alloc(44 + dataSize);

  out.write("RIFF", 0);
  out.writeUInt32LE(chunkSize, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(NUM_CHANNELS, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(BITS_PER_SAMPLE, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);
  pcm.copy(out, 44);
  return out;
}
