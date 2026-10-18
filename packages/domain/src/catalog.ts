// Справочные метаданные регулярных источников, которых нет в датапаке:
// названия (раздел 6) и категории (типы раздела 5). Игровых чисел здесь нет.
import type { Category } from './types';

export interface RuleMeta {
  title: string;
  category: Category;
}

export const RULE_META: Record<string, RuleMeta> = {
  daily_commissions: { title: 'Ежедневные поручения', category: 'daily' },
  welkin: { title: 'Благословение полой луны', category: 'paid' },
  bp_paid: { title: 'БП (Гимн гнозиса)', category: 'paid' },
  bp_free: { title: 'БП, бесплатная ветка', category: 'version_fixed' },
  stardust_shop: { title: 'Покупка круток в магазине Паймон (звёздная пыль)', category: 'shop' },
  abyss: { title: 'Витая бездна', category: 'endgame' },
  theater: { title: 'Театр «Воображариум»', category: 'endgame' },
  stygian: { title: 'Натиск', category: 'endgame' },
  maint_comp: { title: 'Обновление: компенсация за обслуживание', category: 'version_fixed' },
  fix_comp: { title: 'Обновление: компенсация за исправления', category: 'version_fixed' },
  stream_codes: { title: 'Коды стрима разработчиков', category: 'special' },
  trials: { title: 'Пробные персонажи', category: 'event' },
  hoyolab: { title: 'Отметки HoYoLAB', category: 'external' },
  web_events: { title: 'Веб-ивенты', category: 'external' },
  events_tpl: { title: 'Ивенты версии (шаблон)', category: 'event' },
  new_content_tpl: { title: 'Новый контент версии (шаблон)', category: 'one_time' },
};

export const CATEGORY_TITLES: Record<Category, string> = {
  daily: 'Ежедневное',
  endgame: 'Эндгейм',
  shop: 'Магазин',
  version_fixed: 'За версию',
  event: 'Ивенты',
  paid: 'Платное',
  external: 'Внешнее',
  special: 'Особое',
  one_time: 'Разовый контент',
};
