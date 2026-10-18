import { normalizeRules, resolveBanners, resolveEvents, type RawDatapack } from '../datapack';
import { addDays } from '../time';
import type { PaymentProfile, ServerId } from '../types';
import { resolveVersions } from '../versions';
import { datapack } from './fixtures';

export const pack = datapack as unknown as RawDatapack;

export const noPayments: PaymentProfile = {
  welkinPurchases: [],
  welkinPlanned: 'none',
  bpPaid: 'never',
  plannedTopUps: [],
};

/** Резолвленный датапак для сервера, горизонт — now + 400 дней (раздел 7). */
export function packFor(server: ServerId, now: string) {
  return {
    versions: resolveVersions(pack.versions, server, { until: addDays(now, 400) }),
    banners: resolveBanners(pack.banners, server),
    events: resolveEvents(pack.events, server),
    rules: normalizeRules(pack.rules),
    eventTemplate: pack.eventTemplate,
  };
}
