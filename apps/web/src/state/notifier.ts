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

/**
 * Показ через service worker: на Android (Chrome и установленная PWA) конструктор `Notification` запрещён.
 * true — уведомление показано.
 */
async function show(title: string, body: string, tag: string): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/favicon-64.png' });
      return true;
    }
  } catch {
    // нет сервис-воркера или он не разрешил — пробуем напрямую
  }
  try {
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

let delivering = false;

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
      delivering ||
      !model.settings.notifications.enabled ||
      !notificationsSupported() ||
      Notification.permission !== 'granted'
    )
      return;
    const due = dueReminders(model);
    delivering = true;
    void (async () => {
      const sent = readSent();
      let changed = false;
      for (const r of due) {
        if (sent.has(r.key)) continue;
        // отмечаем доставленным только показанное — иначе попробуем при следующем пересчёте
        if (await show(r.title, r.body, r.key)) {
          sent.add(r.key);
          changed = true;
        }
      }
      if (changed) writeSent(sent);
    })().finally(() => {
      delivering = false;
    });
  }, [model]);
}
