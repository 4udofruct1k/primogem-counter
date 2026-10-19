// «Версия» (10.4): все вхождения версии по группам, «забрано X из Y».
import { addRewards, ms, type Occurrence } from '@primo/domain';
import { useState } from 'react';
import { useModel } from '../state/context';
import { groupOccurrences, versionOccurrences } from '../state/select';
import { Badge, Card, ConfidenceBadge, Progress, Tabs } from '../ui/components';
import { dateTime, rewardText } from '../ui/format';
import { OccurrenceRow } from '../ui/OccurrenceRow';
import { href, useRoute } from '../ui/router';

export function VersionScreen() {
  const model = useModel();
  const route = useRoute();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!model) return null;
  const now = ms(model.now);
  // прошлая, текущая и три следующие версии
  const idx = Math.max(
    0,
    model.versions.findIndex((v) => v.id === model.currentVersion?.id),
  );
  const choices = model.versions.slice(Math.max(0, idx - 1), idx + 4);
  const selectedId = route.query.get('v') ?? model.currentVersion?.id ?? choices[0]?.id;
  const v = model.versions.find((x) => x.id === selectedId) ?? choices[0];
  if (!v) return null;

  const occs = versionOccurrences(model, v);
  const groups = groupOccurrences(occs);
  const claimed = occs.filter((o) => o.status === 'claimed').length;
  const banners = model.banners.filter((b) => b.versionId === v.id);
  const claimedSum = addRewards(
    ...occs.filter((o) => o.status === 'claimed').map((o) => o.actual ?? o.reward),
  );

  return (
    <>
      <Tabs
        value={v.id}
        onChange={(id) => {
          window.location.hash = `${href('version')}?v=${encodeURIComponent(id)}`;
        }}
        items={choices.map((c) => ({
          id: c.id,
          label: `${c.id}${c.id === model.currentVersion?.id ? ' · сейчас' : ''}`,
        }))}
      />
      <Card
        title={`Версия ${v.id}${v.name ? ` — ${v.name}` : ''}`}
        actions={<ConfidenceBadge c={v.confidence} />}
      >
        <div className="small muted">
          Старт {dateTime(v.start, model.deviceOffset)} · фаза 2 {dateTime(v.phase2Start, model.deviceOffset)}{' '}
          · конец БП {dateTime(v.bpEnd, model.deviceOffset)} · дедлайн версии{' '}
          {dateTime(v.endDeadline, model.deviceOffset)}
        </div>
        {banners.length > 0 && (
          <div className="chip-row">
            {banners.map((b) => (
              <Badge key={b.id}>
                {b.kind === 'weapon' ? '⚔' : '★'} {b.phase ? `Ф${b.phase}: ` : ''}
                {b.featured5.join(', ')}
              </Badge>
            ))}
          </div>
        )}
        <div>
          Забрано <b data-testid="version-claimed">{claimed}</b> из <b>{occs.length}</b> ·{' '}
          {rewardText(claimedSum, '0')}
        </div>
        <Progress value={claimed} max={occs.length} />
      </Card>
      {groups.map((g) => {
        const collapsible = g.items.length > 6;
        const expanded = open[g.key] ?? !collapsible;
        // свёрнутая группа показывает идущие сейчас и ближайшие
        const visible = expanded ? g.items : g.items.filter((o) => isRelevant(o, now)).slice(0, 3);
        return (
          <Card
            key={g.key}
            title={
              <>
                {g.title}{' '}
                <span className="muted small">
                  · забрано {g.claimed} из {g.total}
                </span>
              </>
            }
            actions={
              collapsible ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => setOpen({ ...open, [g.key]: !expanded })}
                >
                  {expanded ? 'Свернуть' : `Все ${g.total}`}
                </button>
              ) : null
            }
          >
            <ul className="list">
              {visible.map((o) => (
                <OccurrenceRow key={o.id} model={model} occ={o} />
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}

function isRelevant(o: Occurrence, now: number): boolean {
  return ms(o.from) <= now + 86_400_000 && (!o.deadline || ms(o.deadline) > now) && o.status === 'planned';
}
