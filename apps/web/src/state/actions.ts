// Действия пользователя: отметки, сверка, траты, прогресс регионов и трекеров (5.1).
import {
  addRewards,
  areaFlags,
  type Area,
  type AreaState,
  type Balance,
  type Calculable,
  type CategoryProgress,
  claimOccurrence,
  collected,
  type ISO,
  isZero,
  type LedgerEntry,
  type Occurrence,
  type OccStatus,
  type PaymentProfile,
  type Pity,
  type Region,
  type Reward,
  spendPullsDelta,
  subtractRewards,
  unclaimOccurrence,
} from '@primo/domain';
import { DEFAULT_SETTINGS, type Collection, type DocOf, type Settings } from '@primo/shared';
import type { DocsState } from './docs';
import type { Model } from './model';
import type { AppStore, DocWrite } from './store';

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Момент действия с миллисекундами: запись леджера после снимка в ту же секунду не должна потеряться. */
function nowIso(store: AppStore): ISO {
  return store.deps.clock().toISOString();
}

function progressEntry(refId: string, delta: Reward, at: ISO): DocWrite | null {
  const d = addRewards(delta);
  if (isZero(d)) return null;
  const entry: LedgerEntry = { id: `progress:${refId}:${newId()}`, at, delta: d, reason: 'progress', refId };
  return { collection: 'ledger', id: entry.id, data: entry };
}

export function createActions(store: AppStore) {
  const write = (changes: (DocWrite | null)[]) =>
    store.getState().write(changes.filter((c): c is DocWrite => !!c));
  const docs = (): DocsState => store.getState().docs;

  return {
    /** «Забрал»: claimed + при autoApplyClaims запись в леджер (5.1). */
    async claim(model: Model, occ: Occurrence, actual?: Reward) {
      const at = nowIso(store);
      // у трекеров сумма уже в кошельке через записи прогресса — отметка меняет только статус
      const res = claimOccurrence(occ, at, {
        autoApply: model.settings.autoApplyClaims && !occ.tracker,
        ...(actual ? { actual } : {}),
      });
      await write([
        { collection: 'occ_status', id: occ.id, data: res.status },
        res.ledger ? { collection: 'ledger', id: res.ledger.id, data: res.ledger } : null,
      ]);
    },

    /** Смена статуса: planned / missed / skipped; снятие «забрал» — отрицательная запись. */
    async setStatus(model: Model, occ: Occurrence, status: Exclude<OccStatus, 'claimed'>) {
      const at = nowIso(store);
      const changes: (DocWrite | null)[] = [
        { collection: 'occ_status', id: occ.id, data: { id: occ.id, status } },
      ];
      if (occ.status === 'claimed' && model.settings.autoApplyClaims && !occ.tracker) {
        const res = unclaimOccurrence(occ, at, { autoApply: true });
        if (res.ledger) changes.push({ collection: 'ledger', id: res.ledger.id, data: res.ledger });
      }
      await write(changes);
    },

    /** Сверка — ручной ввод реальных цифр → новый снимок (5.1). */
    async reconcile(balance: Balance, pity: Pity) {
      const at = nowIso(store);
      const id = `snap:${at}:${newId().slice(0, 8)}`;
      await write([{ collection: 'wallet_snapshot', id, data: { id, at, ...balance, pity } }]);
    },

    /** Новый pity без изменения баланса: снимок = текущий баланс + pity. */
    async setPity(model: Model, pity: Pity) {
      const at = nowIso(store);
      const id = `snap:${at}:${newId().slice(0, 8)}`;
      await write([{ collection: 'wallet_snapshot', id, data: { id, at, ...model.balance, pity } }]);
    },

    /** «Потратил N круток»: сначала IF, потом по 160 (5.1). */
    async spendPulls(model: Model, n: number) {
      const at = nowIso(store);
      const entry: LedgerEntry = {
        id: `spend:${at}:${newId().slice(0, 8)}`,
        at,
        delta: spendPullsDelta(model.balance, n),
        reason: 'spend_pulls',
      };
      await write([{ collection: 'ledger', id: entry.id, data: entry }]);
    },

    async manualEntry(delta: Reward, reason: LedgerEntry['reason'] = 'manual') {
      const at = nowIso(store);
      const entry: LedgerEntry = {
        id: `${reason}:${at}:${newId().slice(0, 8)}`,
        at,
        delta: addRewards(delta),
        reason,
      };
      await write([{ collection: 'ledger', id: entry.id, data: entry }]);
    },

    /** Прогресс категории; при autoApply — запись в леджер на разницу «было → стало» (5.1). */
    async saveProgress(model: Model, cat: Calculable, area: Area | null, next: CategoryProgress) {
      const at = nowIso(store);
      const prev = docs().cat_progress[cat.id] as CategoryProgress | undefined;
      const flags = area
        ? areaFlags(
            docs().area_state[area.id] as AreaState | undefined,
            (docs().region_state[area.regionId] as DocOf<'region_state'> | undefined)?.closed ?? false,
          )
        : areaFlags(docs().area_state[cat.id] as AreaState | undefined, false);
      const delta = subtractRewards(
        collected(cat, next, flags, model.calc),
        collected(cat, prev, flags, model.calc),
      );
      await write([
        { collection: 'cat_progress', id: cat.id, data: { ...next, updatedAt: at } },
        model.settings.autoApplyClaims ? progressEntry(cat.id, delta, at) : null,
      ]);
    },

    /** Флаги и план области; разница собранного по всем категориям — в леджер. */
    async saveAreaState(
      model: Model,
      unit: { id: string; categories: Calculable[]; regionId?: string },
      next: AreaState,
    ) {
      const at = nowIso(store);
      const prevState = docs().area_state[unit.id] as AreaState | undefined;
      const regionClosed = unit.regionId
        ? ((docs().region_state[unit.regionId] as DocOf<'region_state'> | undefined)?.closed ?? false)
        : false;
      const before = areaFlags(prevState, regionClosed);
      const after = areaFlags(next, regionClosed);
      let delta: Reward = {};
      for (const c of unit.categories) {
        const p = docs().cat_progress[c.id] as CategoryProgress | undefined;
        delta = addRewards(
          delta,
          subtractRewards(collected(c, p, after, model.calc), collected(c, p, before, model.calc)),
        );
      }
      await write([
        { collection: 'area_state', id: unit.id, data: next },
        model.settings.autoApplyClaims ? progressEntry(unit.id, delta, at) : null,
      ]);
    },

    async setRegionClosed(model: Model, region: Region, closed: boolean) {
      const at = nowIso(store);
      let delta: Reward = {};
      const wasClosed =
        (docs().region_state[region.id] as DocOf<'region_state'> | undefined)?.closed ?? false;
      for (const a of region.areas) {
        const state = docs().area_state[a.id] as AreaState | undefined;
        const before = areaFlags(state, wasClosed);
        const after = areaFlags(state, closed);
        for (const c of a.categories) {
          const p = docs().cat_progress[c.id] as CategoryProgress | undefined;
          delta = addRewards(
            delta,
            subtractRewards(collected(c, p, after, model.calc), collected(c, p, before, model.calc)),
          );
        }
      }
      await write([
        { collection: 'region_state', id: region.id, data: { regionId: region.id, closed } },
        model.settings.autoApplyClaims ? progressEntry(region.id, delta, at) : null,
      ]);
    },

    /** Трекер эндгейма: документ цикла + разница суммы трекера в леджер. */
    async saveTracker<C extends 'abyss' | 'theater' | 'stygian' | 'hoyolab'>(
      model: Model,
      collection: C,
      doc: DocOf<C>,
      sumOf: (d: DocOf<C> | undefined) => number,
    ) {
      const at = nowIso(store);
      const id = (doc as { id: string }).id;
      const prev = docs()[collection][id] as DocOf<C> | undefined;
      const delta = sumOf(doc) - sumOf(prev);
      await write([
        { collection, id, data: doc },
        model.settings.autoApplyClaims ? progressEntry(id, { primo: delta }, at) : null,
      ]);
    },

    async saveSettings(patch: Partial<Settings>) {
      const current = (docs().settings.main as Settings | undefined) ?? {};
      await write([{ collection: 'settings', id: 'main', data: { ...defaultsFor(current), ...patch } }]);
    },

    async savePayment(payment: PaymentProfile) {
      await write([{ collection: 'payment', id: 'main', data: payment }]);
    },

    async putDoc<C extends Collection>(collection: C, id: string, data: DocOf<C> | null) {
      await write([{ collection, id, data }]);
    },
  };
}

function defaultsFor(current: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...current };
}

export type Actions = ReturnType<typeof createActions>;
