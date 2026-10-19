// Разовый контент для прогноза (11.6): области и общие источники с планом прохождения.
import type { OneTimeUnit } from './forecast';
import { areaFlags, categorySummary, type CalcContext, type Seed } from './regions';
import type { AreaState, CategoryProgress, RegionState, Version } from './types';
import { versionIdOf } from './versions';

const NO_PLAN = { kind: 'none' } as const;

/**
 * Единицы планирования: каждая область (порядок — как регионы в seed) и каждый общий источник
 * (план хранится в AreaState с areaId = id источника, `general:<id>`).
 */
export function oneTimeUnits(
  seed: Seed,
  progress: Record<string, CategoryProgress | undefined>,
  areaStates: Record<string, AreaState | undefined>,
  regionStates: Record<string, RegionState | undefined>,
  ctx: CalcContext,
  versions: Version[],
  /** Контекст расчёта области (цены сундуков с переопределением на уровне области, 11.2). */
  ctxForArea: (areaId: string) => CalcContext = () => ctx,
): OneTimeUnit[] {
  const units: OneTimeUnit[] = [];
  let order = 0;
  for (const region of seed.regions) {
    const regionClosed = regionStates[region.id]?.closed ?? false;
    for (const area of region.areas) {
      const state = areaStates[area.id];
      const flags = areaFlags(state, regionClosed);
      const unit: OneTimeUnit = {
        id: area.id,
        title: area.name,
        order: order++,
        plan: state?.plan ?? NO_PLAN,
        parts: area.categories.map((c) => {
          const s = categorySummary(c, progress[c.id], flags, ctxForArea(area.id));
          return {
            id: c.id,
            title: `${area.name}: ${c.title}`,
            reward: s.remainingNow,
            confidence: c.confidence,
            unknown: s.unknown,
          };
        }),
      };
      if (area.addedIn) {
        unit.addedIn = area.addedIn;
        const v = versions.find((x) => x.id === versionIdOf(area.addedIn!));
        if (v) unit.availableFrom = v.start;
      }
      units.push(unit);
    }
  }
  for (const g of seed.general) {
    const state = areaStates[g.id];
    const s = categorySummary(g, progress[g.id], areaFlags(state, false), ctx);
    units.push({
      id: g.id,
      title: g.title,
      order: order++,
      plan: state?.plan ?? NO_PLAN,
      parts: [
        { id: g.id, title: g.title, reward: s.remainingNow, confidence: g.confidence, unknown: s.unknown },
      ],
    });
  }
  return units;
}

/** Версии, в которых по seed появились новые области (11.7): для них не генерируется new_content_tpl. */
export function newContentVersions(seed: Seed): string[] {
  const out = new Set<string>();
  for (const r of seed.regions) for (const a of r.areas) if (a.addedIn) out.add(versionIdOf(a.addedIn));
  return [...out];
}
