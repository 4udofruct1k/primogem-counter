// Доставка напоминаний в браузере (14.7): Notification API, пока вкладка/PWA открыты, и Badging API.
import { useEffect } from 'react';
import type { Model } from './model';
import { badgeCount, dueReminders } from './reminders';

const STORAGE_KEY = 'primo:notified';

function readSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSent(keys: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys].slice(-500)));
  } catch {
    // хранилище недоступно (приватный режим) — напоминание может повториться, это не страшно
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function useNotifier(model: Model | null) {
  useEffect(() => {
    if (!model) return;
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const count = badgeCount(model);
    if (nav.setAppBadge)
      void (count ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => undefined);

    if (
      !model.settings.notifications.enabled ||
      !notificationsSupported() ||
      Notification.permission !== 'granted'
    )
      return;
    const sent = readSent();
    let changed = false;
    for (const r of dueReminders(model)) {
      if (sent.has(r.key)) continue;
      try {
        new Notification(r.title, { body: r.body, tag: r.key });
      } catch {
        // некоторые мобильные браузеры требуют уведомления через service worker — тогда только «горит» и бейдж
      }
      sent.add(r.key);
      changed = true;
    }
    if (changed) writeSent(sent);
  }, [model]);
}
