import { useSyncExternalStore } from 'react';
import { ReadingStateService } from '../../state/generated-typescript';
import type { DataApiError, ReadingStateWrite } from '../../state/generated-typescript';
import { currentUser } from './user';

// 阅读进度与收藏：Managed App 的 App state，集合 readingState 按用户隔离（state/schema.json 里
// x-ms-ownership: perUser），每人每篇一条。平台按登录身份区分数据，前端不传、也无法伪造用户 ID。
// 浏览器本地始终存一份：不在宿主里（npm run dev、ms app dev 都不提供 /.ms/state）或请求失败时，至少本机不丢。
export interface ReadingState {
  scroll: number;
  lastReadAt: string;
  favorite: boolean;
}

/**
 * loading：确认身份与读取中；cloud：读写都走 App state；
 * local：不在宿主里；offline：App state 请求失败，新改动只存本机
 */
export type Backend = 'loading' | 'cloud' | 'local' | 'offline';

export interface Snapshot {
  backend: Backend;
  error?: string;
  states: ReadonlyMap<string, ReadingState>;
}

const WRITE_DELAY_MS = 1500;

let snapshot: Snapshot = { backend: 'loading', states: new Map() };
const listeners = new Set<() => void>();
const ids = new Map<string, string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let storageKey = 'mf-reading:anon';
let started = false;

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

function loadLocal(): Map<string, ReadingState> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey) ?? '{}')));
  } catch {
    return new Map();
  }
}

function saveLocal(states: ReadonlyMap<string, ReadingState>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(states)));
  } catch {
    // 隐私模式等情况下不可写，忽略
  }
}

const errorText = (e: DataApiError) => `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}`;

async function start() {
  const user = await currentUser();
  if (!user) {
    emit({ backend: 'local', states: loadLocal() });
    return;
  }
  storageKey = `mf-reading:${user.objectId}`;
  const local = loadLocal();
  const res = await ReadingStateService.getAll({ scope: 'private' });
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error), states: local });
    return;
  }
  const states = new Map(local);
  for (const item of res.data) {
    ids.set(item.docPath, item.itemId);
    const remote: ReadingState = { scroll: item.scroll ?? 0, lastReadAt: item.lastReadAt ?? '', favorite: !!item.favorite };
    const mine = states.get(item.docPath);
    if (!mine || mine.lastReadAt <= remote.lastReadAt) states.set(item.docPath, remote);
  }
  saveLocal(states);
  emit({ backend: 'cloud', states });
}

async function writeRemote(path: string) {
  const s = snapshot.states.get(path);
  if (!s || snapshot.backend !== 'cloud') return;
  const item: ReadingStateWrite = { docPath: path, scroll: Math.round(s.scroll * 1e4) / 1e4, favorite: s.favorite };
  if (s.lastReadAt) item.lastReadAt = s.lastReadAt;
  const id = ids.get(path);
  // update 是整条覆盖（PUT），这里每次都写全部字段
  const res = id ? await ReadingStateService.update(id, item) : await ReadingStateService.create(item);
  if (!res.success) {
    emit({ backend: 'offline', error: errorText(res.error) });
    return;
  }
  ids.set(path, res.data.itemId);
}

export function updateReading(path: string, patch: Partial<ReadingState>) {
  const prev = snapshot.states.get(path) ?? { scroll: 0, lastReadAt: '', favorite: false };
  const states = new Map(snapshot.states);
  states.set(path, { ...prev, ...patch, lastReadAt: new Date().toISOString() });
  saveLocal(states);
  emit({ states });
  clearTimeout(pending.get(path));
  pending.set(path, setTimeout(() => {
    pending.delete(path);
    void writeRemote(path);
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

export function useReading(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
