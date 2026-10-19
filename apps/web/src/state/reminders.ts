// Напоминания (раздел 17; доставка — 14.7: блок «горит», счётчик на иконке, Notification API при открытой вкладке).
import { ms, serverDateOf, type Occurrence } from '@primo/domain';
import type { Model } from './model';
import { hotItems } from './select';

export interface Reminder {
  /** Ключ для однократной доставки. */
  key: string;
  title: string;
  body: string;
  /** Момент, с которого напоминание актуально. */
  at: number;
}

const H = 3_600_000;
/** Письмо в игровой почте живёт 30 дней после доставки (4.3). */
const MAIL_LIFE = 30 * 24 * H;

function isMail(o: Occurrence): boolean {
  return (
    o.ruleId === 'maint_comp' ||
    o.ruleId === 'fix_comp' ||
    !!o.eventId?.endsWith('maint-comp') ||
    !!o.eventId?.includes('missive')
  );
}

function rewardBig(o: Occurrence, minPrimo: number): boolean {
  const r = o.reward;
  return (r.primo ?? 0) >= minPrimo || (r.if ?? 0) > 0 || r.primo === null || r.if === null;
}

/** Напоминания, которые должны сработать к моменту `now` (окно: от момента срабатывания до дедлайна). */
export function dueReminders(model: Model): Reminder[] {
  const now = ms(model.now);
  const out: Reminder[] = [];
  const add = (key: string, title: string, body: string, at: number, until: number) => {
    if (now >= at && now < until) out.push({ key, title, body, at });
  };
  const minPrimo = model.settings.notifications.minPrimo;
  const today = serverDateOf(model.now, model.settings.server);

  for (const o of model.occurrences) {
    if (o.status !== 'planned' || o.virtual) continue;
    // почта компенсаций и подарков — за 3 дня до истечения письма (30 дней после доставки), а не окна получения
    if (isMail(o)) {
      // у ивента-письма срок из данных; у правил компенсаций дедлайн — окно получения, письмо живёт 30 дней
      const expiry = o.eventId && o.deadline ? ms(o.deadline) : ms(o.from) + MAIL_LIFE;
      add(`${o.id}:mail`, 'Почта скоро истечёт', o.title, expiry - 72 * H, expiry);
    }
    if (!o.deadline) continue;
    const dl = ms(o.deadline);
    if (dl <= now || ms(o.from) > now) continue;

    // дейлики не отмечены — за 3 ч до сброса
    if (o.ruleId === 'daily_commissions' && o.id.endsWith(today)) {
      add(`${o.id}:3h`, 'Дейлики не отмечены', 'До сброса меньше 3 часов', dl - 3 * H, dl);
      continue;
    }
    // луна не отмечена — за 3 ч до сброса (только реальные покупки)
    if (o.ruleId === 'welkin' && !o.virtual && !o.id.endsWith(':buy')) {
      add(`${o.id}:3h`, 'Луна не отмечена', 'До сброса меньше 3 часов', dl - 3 * H, dl);
      continue;
    }
    // бездна / театр — за 48 ч, если трекер < ожидания; натиск — за 48 ч, если < 450 (номинал)
    if (o.tracker && o.tracker !== 'hoyolab') {
      const sum = model.trackerSums[o.id] ?? 0;
      const goal =
        o.tracker === 'stygian'
          ? (o.reward.primo ?? 0)
          : (model.expectations[o.ruleId!]?.expected.primo ?? o.expected.primo ?? 0);
      if (sum < goal)
        add(
          `${o.id}:48h`,
          `${o.title}: не добито`,
          `${sum} из ${goal} — до сброса меньше 2 дней`,
          dl - 48 * H,
          dl,
        );
      continue;
    }
    // дедлайн вхождения/ивента — за 24 ч и за 3 ч (≥ minPrimo примогемов или любые IF)
    if (o.category !== 'daily' && rewardBig(o, minPrimo)) {
      add(`${o.id}:24h`, 'Сгорает через сутки', o.title, dl - 24 * H, dl - 3 * H);
      add(`${o.id}:3h`, 'Сгорает через 3 часа', o.title, dl - 3 * H, dl);
    }
  }

  // луна заканчивается — за 3 дня
  const welkinDays = model.occurrences.filter(
    (o) => o.ruleId === 'welkin' && !o.virtual && !o.id.endsWith(':buy'),
  );
  const lastDay = welkinDays.at(-1);
  if (lastDay?.deadline) {
    const end = ms(lastDay.deadline);
    add(`welkin-end:${lastDay.id}`, 'Луна заканчивается', 'Осталось меньше 3 дней', end - 72 * H, end);
  }

  // закрытие покупки БП — за 24 ч до 02:59 server
  if (model.payment.bpPaid !== 'never') {
    for (const v of model.versions) {
      const close = ms(v.bpPurchaseEnd);
      add(`bp-buy:${v.id}`, 'Закрывается покупка БП', `Версия ${v.id}`, close - 24 * H, close);
    }
  }

  // спецпрограмма — в день стрима
  for (const o of model.occurrences) {
    if (o.ruleId === 'stream_codes' && o.status === 'planned' && o.deadline) {
      add(`${o.id}:day`, 'Сегодня спецпрограмма', 'Коды на 300 примогемов', ms(o.from), ms(o.deadline));
    }
  }
  return out;
}

/**
 * Напоминания, которых нет среди строк «горит» (луна заканчивается, покупка БП, стрим, почта, дейлики…):
 * на «Сегодня» они показываются в том же блоке и входят в счётчик иконки (14.7).
 */
export function standaloneReminders(model: Model): Reminder[] {
  const hot = hotItems(model).map((o) => `${o.id}:`);
  return dueReminders(model).filter((r) => !hot.some((h) => r.key.startsWith(h)));
}

/** Счётчик на иконке PWA: «горит» + остальные сработавшие напоминания (Badging API, где есть). */
export function badgeCount(model: Model): number {
  return hotItems(model).length + standaloneReminders(model).length;
}
