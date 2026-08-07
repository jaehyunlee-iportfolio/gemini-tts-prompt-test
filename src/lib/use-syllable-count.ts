"use client";

import { useEffect, useRef, useState } from "react";
import { countTextSyllables } from "@/lib/syllables";

const API_BASE = "/api";
const DEBOUNCE_MS = 400;

export type SyllableCountState = {
  /** 최종 음절 수 — 사전 조회에 성공하면 사전값, 아니면 휴리스틱 추정값 */
  syllables: number;
  /** true면 CMU 발음사전 기준(g2p_en과 동일), false면 모음군 추정 */
  accurate: boolean;
  /** 사전에 없어 추정으로 센 단어 */
  oov: string[];
  loading: boolean;
  /** 사전 조회 실패 사유 — 실패해도 추정값으로 계속 동작한다 */
  error: string | null;
};

/**
 * 텍스트의 음절 수를 CMU 발음사전 기준으로 구한다.
 *
 * 먼저 휴리스틱 값을 즉시 돌려주어 화면이 비지 않게 하고, 디바운스 후 서버
 * (/api/syllables)에 물어 정확한 값으로 교체한다. 서버 조회가 실패하면 추정값을
 * 그대로 쓰므로 기능이 멈추지는 않는다.
 */
export function useSyllableCount(text: string): SyllableCountState {
  const [state, setState] = useState<SyllableCountState>(() => ({
    syllables: countTextSyllables(text),
    accurate: false,
    oov: [],
    loading: false,
    error: null,
  }));
  const reqIdRef = useRef(0);

  useEffect(() => {
    const fallback = countTextSyllables(text);
    // 입력 즉시 추정값으로 갱신 — 이후 서버 응답이 오면 교체된다
    setState({ syllables: fallback, accurate: false, oov: [], loading: true, error: null });

    if (!text.trim()) {
      setState({ syllables: 0, accurate: false, oov: [], loading: false, error: null });
      return;
    }

    const myId = ++reqIdRef.current;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`${API_BASE}/syllables`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abort.signal,
            body: JSON.stringify({ text }),
          });
          const j = (await res.json()) as {
            total?: number;
            oov?: string[];
            error?: string;
          };
          if (myId !== reqIdRef.current) return; // 더 최신 입력이 있으면 폐기
          if (!res.ok || typeof j.total !== "number") {
            throw new Error(j.error || `음절 조회 실패 (${res.status})`);
          }
          setState({
            syllables: j.total,
            accurate: true,
            oov: j.oov ?? [],
            loading: false,
            error: null,
          });
        } catch (e) {
          if (abort.signal.aborted || myId !== reqIdRef.current) return;
          setState({
            syllables: fallback,
            accurate: false,
            oov: [],
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [text]);

  return state;
}
