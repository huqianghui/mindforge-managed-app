import { useEffect, useState } from 'react';
import { contentUrl } from '../docs/content';

// 周报：同步时由 scripts/weekly.py 从 wiki/weekly/<ISO 周>.md 解析成 weekly.json，最新一周在最前

export interface HeavyItem {
  title: string;
  url?: string;
  why_hot: string;
  relation: string;
  effort: string;
  path?: string;
}

export type Bucket = 'must' | 'heavy' | 'extend';

export interface Recommendation {
  bucket: Bucket;
  title: string;
  reason: string;
  effort?: string;
  action?: 'path' | 'frontier' | 'write' | 'practice';
  path?: string;
  station?: number;
}

export interface Week {
  week: string;
  range?: string;
  title?: string;
  doc: string;
  edition?: string;
  newArticles: { path: string; title: string }[];
  wiki: {
    concepts?: [number, number];
    methods?: [number, number];
    decisions?: [number, number];
    claims?: [number, number];
    new_pages?: string[];
    new_paths?: number;
    new_questions?: number;
  };
  revalidate: Partial<Record<'scanned' | 'longterm' | 'confirm' | 'revise' | 'downgrade' | 'retire' | 'pending' | 'stale_before' | 'stale_after', number>>;
  heavy: HeavyItem[];
  recommendations: Recommendation[];
  body: string;
}

let cached: Promise<Week[]> | null = null;

function load(): Promise<Week[]> {
  cached ??= fetch(contentUrl('weekly.json'))
    .then((res) => (res.ok ? res.json() : { weeks: [] }))
    .then((d: { weeks: Week[] }) => d.weeks)
    .catch(() => []);
  return cached;
}

export function useWeeks(): Week[] | null {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  useEffect(() => {
    load().then(setWeeks);
  }, []);
  return weeks;
}

export const BUCKETS: Record<Bucket, { label: string; hint: string; color: string }> = {
  must: { label: '必须掌握', hint: '工作主线上绕不过去的', color: '#1565c0' },
  heavy: { label: '重磅热点', hint: '外面很热，至少该知道它是什么、和你有什么关系', color: '#d84315' },
  extend: { label: '适合延伸', hint: '和已有路径相邻的前沿', color: '#6a1b9a' },
};

export const ACTIONS: Record<NonNullable<Recommendation['action']>, string> = {
  path: '去学这条路径',
  frontier: '看前沿站',
  write: '读完写一篇',
  practice: '动手实测',
};

/** 推荐卡片要跳到的学习页地址 */
export function recommendationHref(r: Recommendation): string | undefined {
  if (!r.path) return undefined;
  const s = r.action === 'frontier' && !r.station ? 99 : r.station;
  return `#/learn?path=${encodeURIComponent(r.path)}${s ? `&s=${s}` : ''}`;
}
