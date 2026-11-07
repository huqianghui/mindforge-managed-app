import { useEffect, useState } from 'react';
import { contentUrl } from '../docs/content';

// 学习路径与题库：同步时由 scripts/paths.py 从 wiki/paths/ 解析成 paths.json，
// wikilink 已改写成应用内 #/doc/ 链接，这里只负责加载和类型

export interface FrontierTrend {
  topic: string;
  title: string;
  priority?: 'high' | 'medium' | 'low';
  action?: string;
  date: string;
  report: string;
  /** 这一站引用的哪些 wiki 页命中了该主题的关联节点 */
  via: string[];
}

export interface Station {
  n: number;
  title: string;
  reads: string;
  prereq: number[];
  minutes: number | null;
  stale: string;
  mastery: string[];
  pages: string[];
  frontierAuto: FrontierTrend[];
}

export interface Question {
  id: string;
  station: number;
  type: string;
  question: string;
  answer: string;
  source: string;
}

export interface LearningPath {
  id: string;
  doc: string;
  title: string;
  audience?: string;
  gapTopics: string[];
  signals: string[];
  intro: string;
  stations: Station[];
  frontier: string;
  graduation: string;
  gaps: string;
  quiz: Question[];
}

let cached: Promise<LearningPath[]> | null = null;

function load(): Promise<LearningPath[]> {
  cached ??= fetch(contentUrl('paths.json'))
    .then((res) => res.json())
    .then((d: { paths: LearningPath[] }) => d.paths);
  return cached;
}

export function usePaths(): LearningPath[] | null {
  const [paths, setPaths] = useState<LearningPath[] | null>(null);
  useEffect(() => {
    load().then(setPaths).catch((err) => console.error('Failed to load paths.json', err));
  }, []);
  return paths;
}

export const totalMinutes = (p: LearningPath) => p.stations.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
