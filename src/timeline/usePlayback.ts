import { useEffect, useState } from 'react';

const BASE_MS = 140; // 1× 时每天的间隔，speed 倍时除以倍数

export interface Playback {
  cursor: number;
  setCursor: (d: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
}

/**
 * 播放：光标一天一天往前走，走到最后一天自动停。
 * dwell(day) 给出 1× 时在这一天停留的毫秒数，不传就每天一样长；调用方要 memo 住它
 */
export function usePlayback(totalDays: number, dwell?: (day: number) => number, initialSpeed = 3): Playback {
  const [cursor, setCursor] = useState(totalDays);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  useEffect(() => {
    if (!playing) return;
    const ms = (dwell?.(cursor) ?? BASE_MS) / speed;
    const t = window.setTimeout(() => {
      if (cursor >= totalDays) setPlaying(false);
      else setCursor(cursor + 1);
    }, ms);
    return () => window.clearTimeout(t);
  }, [playing, speed, totalDays, cursor, dwell]);
  return { cursor, setCursor, playing, setPlaying, speed, setSpeed };
}
