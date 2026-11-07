import { useSyncExternalStore } from 'react';
import { LearningStateService } from '../../state/generated-typescript';
import type { DataApiError } from '../../state/generated-typescript';
import { currentUser } from '../platform/user';

// 学习进度与复习记录：App state 集合 learningState，按用户隔离（x-ms-ownership: perUser），
// 每个 key 一条，value 存 JSON。key 有两种：station:<路径>/<站号>（勾选了哪几条「算会」）、
// quiz:<题目 id>（复习排期）。做法与 readingState 相同：本机 localStorage 始终存一份，宿主外或请求失败时退回本机。

export interface StationProgress {
  checked: number[];
}

export type Grade = 'again' | 'hard' | 'good';

export interface Review {
  /** 下次到期时间 */
  due: string;
  /** 当前间隔（天） */
  interval: number;
  reps: number;
  lapses: number;
  last: Grade;
  lastAt: string;
}

export type Backend = 'loading' | 'cloud' | 'local' | 'offline';

interface Snapshot {
  backend: Backend;
  error?: string;
  values: ReadonlyMap<string, unknown>;
}

const WRITE_DELAY_MS = 1200;

let snapshot: Snapshot = { backend: 'loading', values: new Map() };
const listeners = new Set<() => void>();
const ids = new Map<string, string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let storageKey = 'mf-learning:anon';
let started = false;

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

function loadLocal(): Map<string, unknown> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey) ?? '{}')));
  } catch {
    return new Map();
  }
}

function saveLocal(values: ReadonlyMap<string, unknown>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(values)));
  } catch {
    // 隐私模式等情况下不可写，忽略
  }
}

const errorText = (e: DataApiError) => `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}`;

async function start() {
  const user = await currentUser();
  if (!user) {
    emit({ backend: 'local', values: loadLocal() });
    return;
  }
  storageKey = `mf-learning:${user.objectId}`;
  const values = loadLocal();
  const res = await LearningStateService.getAll({ scope: 'private' });
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error), values });
    return;
  }
  for (const item of res.data) {
    ids.set(item.key, item.itemId);
    try {
      if (item.value) values.set(item.key, JSON.parse(item.value));
    } catch {
      // 损坏的记录跳过，下次写入时覆盖
    }
  }
  saveLocal(values);
  emit({ backend: 'cloud', values });
}

async function writeRemote(key: string) {
  if (snapshot.backend !== 'cloud') return;
  const value = JSON.stringify(snapshot.values.get(key) ?? null);
  const item = { key, value, updatedAt: new Date().toISOString() };
  const id = ids.get(key);
  // update 是整条覆盖（PUT），每次写全部字段
  const res = id ? await LearningStateService.update(id, item) : await LearningStateService.create(item);
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error) });
    return;
  }
  ids.set(key, res.data.itemId);
}

function setValue(key: string, value: unknown) {
  const values = new Map(snapshot.values);
  values.set(key, value);
  saveLocal(values);
  emit({ values });
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    void writeRemote(key);
  }, WRITE_DELAY_MS));
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true;
    void start();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLearning() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export const stationKey = (pathId: string, n: number) => `station:${pathId}/${n}`;
export const quizKey = (id: string) => `quiz:${id}`;

export function getStation(values: ReadonlyMap<string, unknown>, pathId: string, n: number): StationProgress {
  return (values.get(stationKey(pathId, n)) as StationProgress | undefined) ?? { checked: [] };
}

export function toggleMastery(pathId: string, n: number, index: number) {
  const cur = getStation(snapshot.values, pathId, n);
  const checked = cur.checked.includes(index) ? cur.checked.filter((i) => i !== index) : [...cur.checked, index].sort((a, b) => a - b);
  setValue(stationKey(pathId, n), { checked });
}

export function getReview(values: ReadonlyMap<string, unknown>, id: string): Review | undefined {
  return values.get(quizKey(id)) as Review | undefined;
}

const DAY = 86_400_000;

/** 简化的间隔复习：没答上明天再见；模糊按 1.2 倍、答上了按 2.5 倍拉长间隔 */
export function nextReview(prev: Review | undefined, grade: Grade, now = Date.now()): Review {
  const interval = prev?.interval ?? 0;
  const next = grade === 'again' ? 1 : grade === 'hard' ? Math.max(1, Math.round(interval * 1.2) || 2) : Math.max(3, Math.round(interval * 2.5) || 3);
  return {
    due: new Date(now + next * DAY).toISOString(),
    interval: next,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (grade === 'again' ? 1 : 0),
    last: grade,
    lastAt: new Date(now).toISOString(),
  };
}

export function gradeQuestion(id: string, grade: Grade) {
  setValue(quizKey(id), nextReview(getReview(snapshot.values, id), grade));
}
