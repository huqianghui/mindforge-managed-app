import { useSyncExternalStore } from 'react';
import { SolutionStateService } from '../../../state/generated-typescript';
import type { DataApiError } from '../../../state/generated-typescript';
import { currentUser } from '../../platform/user';
import type { PlanResult } from './plan';

// 方案助手的存档：App state 集合 solutionState，按用户隔离（x-ms-ownership: perUser）。
// 一个方案一条，value 存 JSON：客户场景、当时的推荐、事后回填的实际结果。
// 里面会有客户细节，所以只放在这里（以及本机兜底），不进 git；流回 vault 要经导出、由 Claude Code 脱敏。

export type OutcomeStatus = 'open' | 'adopted' | 'changed' | 'dropped';

export interface Outcome {
  status: OutcomeStatus;
  /** 客户最后选了什么 */
  chosen: string;
  /** 行得通的地方 */
  worked: string;
  /** 踩的坑、和推荐不一致的地方 */
  pitfalls: string;
  updatedAt: string;
}

export interface Solution {
  id: string;
  createdAt: string;
  title: string;
  scenario: string;
  deployment?: string;
  result: PlanResult;
  outcome?: Outcome;
}

export type Backend = 'loading' | 'cloud' | 'local' | 'offline';

interface Snapshot {
  backend: Backend;
  error?: string;
  items: ReadonlyMap<string, Solution>;
}

let snapshot: Snapshot = { backend: 'loading', items: new Map() };
const listeners = new Set<() => void>();
const ids = new Map<string, string>();
let storageKey = 'mf-solutions:anon';
let started = false;

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

function loadLocal(): Map<string, Solution> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey) ?? '{}')));
  } catch {
    return new Map();
  }
}

function saveLocal(items: ReadonlyMap<string, Solution>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(items)));
  } catch {
    // 不可写时只在本次会话生效
  }
}

const errorText = (e: DataApiError) => `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}`;

async function start() {
  const user = await currentUser();
  if (!user) {
    emit({ backend: 'local', items: loadLocal() });
    return;
  }
  storageKey = `mf-solutions:${user.objectId}`;
  const items = loadLocal();
  const res = await SolutionStateService.getAll({ scope: 'private' });
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error), items });
    return;
  }
  for (const it of res.data) {
    ids.set(it.key, it.itemId);
    try {
      if (it.value) items.set(it.key, JSON.parse(it.value));
    } catch {
      // 损坏的记录跳过
    }
  }
  saveLocal(items);
  emit({ backend: 'cloud', items });
}

export async function saveSolution(s: Solution) {
  const items = new Map(snapshot.items);
  items.set(s.id, s);
  saveLocal(items);
  emit({ items });
  if (snapshot.backend !== 'cloud') return;
  const item = { key: s.id, value: JSON.stringify(s), updatedAt: new Date().toISOString() };
  const id = ids.get(s.id);
  const res = id ? await SolutionStateService.update(id, item) : await SolutionStateService.create(item);
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error) });
    return;
  }
  ids.set(s.id, res.data.itemId);
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true;
    void start();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSolutions() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
