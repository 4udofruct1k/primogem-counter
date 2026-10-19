// Патч админки поверх датапака (раздел 16): записи по id, шаблон ивентов — по слотам и версиям.
import type { RawBanner, RawDatapack, RawEvent, RawRule } from './datapack';
import { clone } from './reward';
import type { EventSlot, EventTemplate } from './types';
import type { RawVersion } from './versions';

type Entry<T> = (Partial<T> & { id: string; _delete?: undefined }) | { id: string; _delete: true };

export interface DatapackPatchLike {
  versions?: Entry<RawVersion>[];
  banners?: Entry<RawBanner>[];
  events?: Entry<RawEvent>[];
  rules?: Entry<RawRule>[];
  eventTemplate?: Partial<EventTemplate>;
  notes?: string[];
}

export function applyDatapackPatch(base: RawDatapack, patch: DatapackPatchLike): RawDatapack {
  const out = clone(base);
  if (patch.versions) out.versions = mergeEntries(out.versions, patch.versions);
  if (patch.banners) out.banners = mergeEntries(out.banners, patch.banners);
  if (patch.events) out.events = mergeEntries(out.events, patch.events);
  if (patch.rules) out.rules = mergeEntries(out.rules, patch.rules);
  if (patch.eventTemplate) out.eventTemplate = mergeTemplate(out.eventTemplate, patch.eventTemplate);
  if (patch.notes?.length) out.notes = [...(out.notes ?? []), ...patch.notes];
  return out;
}

function mergeEntries<T extends { id: string }>(items: T[], patch: Entry<T>[]): T[] {
  const result = [...items];
  for (const p of patch) {
    const i = result.findIndex((x) => x.id === p.id);
    if (p._delete) {
      if (i >= 0) result.splice(i, 1);
    } else if (i >= 0) {
      result[i] = { ...result[i]!, ...clone(p) };
    } else {
      result.push(clone(p) as unknown as T);
    }
  }
  return result;
}

function mergeTemplate(base: EventTemplate | undefined, patch: Partial<EventTemplate>): EventTemplate {
  const t: EventTemplate = clone(base) ?? { confidence: 'projected', slots: [] };
  const { slots, versions, ...rest } = clone(patch);
  Object.assign(t, rest);
  if (slots) {
    for (const s of slots) {
      const i = t.slots.findIndex((x) => x.id === s.id);
      if (i >= 0) t.slots[i] = { ...t.slots[i]!, ...s };
      else t.slots.push(s as EventSlot);
    }
  }
  if (versions) {
    t.versions ??= {};
    for (const [v, bySlot] of Object.entries(versions)) {
      t.versions[v] ??= {};
      for (const [slot, p] of Object.entries(bySlot)) t.versions[v][slot] = { ...t.versions[v][slot], ...p };
    }
  }
  return t;
}
