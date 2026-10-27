import { useEffect, useState } from 'react';
import type { IUser } from '@microsoft/managed-apps/auth';

let cached: Promise<IUser | null> | null = null;

// 不在宿主里（纯 vite dev）时 getUser 不会返回；限时等待，超时视为匿名
export function currentUser(timeoutMs = 3000): Promise<IUser | null> {
  cached ??= (async () => {
    try {
      const { getUser } = await import('@microsoft/managed-apps/auth');
      return await Promise.race([
        getUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
    } catch {
      return null;
    }
  })();
  return cached;
}

/** undefined = 还在确认，null = 不在宿主里 */
export function useUser(): IUser | null | undefined {
  const [user, setUser] = useState<IUser | null | undefined>(undefined);
  useEffect(() => {
    currentUser().then(setUser);
  }, []);
  return user;
}
