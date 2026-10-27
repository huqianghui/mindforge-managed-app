import { useEffect, useState } from 'react';

export const SPEEDS = { slow: 140, normal: 60, fast: 20 } as const;

export interface Playback {
  cursor: number;
  setCursor: (d: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: keyof typeof SPEEDS;
  setSpeed: (s: keyof typeof SPEEDS) => void;
}

/** 播放：光标一天一天往前走，走到最后一天自动停 */
export function usePlayback(totalDays: number): Playback {
  const [cursor, setCursor] = useState(totalDays);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>('normal');
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setCursor((c) => {
        if (c >= totalDays) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, SPEEDS[speed]);
    return () => window.clearInterval(t);
  }, [playing, speed, totalDays]);
  return { cursor, setCursor, playing, setPlaying, speed, setSpeed };
}
