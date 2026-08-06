/**
 * <audio>에서 재생 길이(ms)를 안정적으로 읽는다.
 *
 * loadedmetadata 시점의 duration은 프로바이더/인코딩에 따라 Infinity나 NaN으로
 * 오는 경우가 있다(길이 헤더가 없는 mp3). 이때는 아주 큰 위치로 seek해서 브라우저가
 * 끝을 확정하도록 유도한 뒤(durationchange) 값을 읽고, currentTime을 되돌린다.
 * 실측 SPM이 특정 프로바이더에서만 "—"로 비는 문제를 막기 위한 보정이다.
 */

const SEEK_PROBE_SEC = 1e101;
const DEFAULT_TIMEOUT_MS = 4000;

function toMs(durationSec: number): number | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  return Math.round(durationSec * 1000);
}

export function resolveAudioDurationMs(
  el: HTMLAudioElement,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number | null> {
  const direct = toMs(el.duration);
  if (direct != null) return Promise.resolve(direct);

  return new Promise((resolve) => {
    let settled = false;
    const prevTime = el.currentTime;

    const cleanup = () => {
      el.removeEventListener("durationchange", onDurationChange);
      window.clearTimeout(timer);
    };

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      // 탐침용 seek 복원 — 사용자가 재생을 누르면 처음부터 나오도록
      try {
        if (Number.isFinite(prevTime)) el.currentTime = prevTime;
      } catch {
        /* seek 불가한 상태면 무시 */
      }
      resolve(value);
    };

    const onDurationChange = () => {
      const ms = toMs(el.duration);
      if (ms != null) finish(ms);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    el.addEventListener("durationchange", onDurationChange);

    try {
      el.currentTime = SEEK_PROBE_SEC;
    } catch {
      finish(null);
    }
  });
}
