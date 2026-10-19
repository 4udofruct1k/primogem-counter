// Строка вхождения с отметками «забрал / пропущу / вернуть» (раздел 10, 5.1).
import { hasNull, isZero, type Occurrence, type Reward } from '@primo/domain';
import { useState } from 'react';
import { useActions } from '../state/context';
import type { Model } from '../state/model';
import { Badge, Button, ConfidenceBadge, Field, NumberInput, Sheet } from './components';
import { dateTime, rewardText, untilText } from './format';

const STATUS_LABEL: Record<Occurrence['status'], string> = {
  planned: 'ожидает',
  claimed: 'забрано',
  missed: 'пропущено',
  skipped: 'пропущу',
};

/** Сумма, которую покажем и запишем при отметке: факт, трекер или номинал. */
export function displayReward(model: Model, o: Occurrence): Reward {
  if (o.actual) return o.actual;
  if (o.tracker && o.id in model.trackerSums) return { primo: model.trackerSums[o.id] };
  return o.reward;
}

export function OccurrenceRow({ model, occ, compact }: { model: Model; occ: Occurrence; compact?: boolean }) {
  const actions = useActions();
  const [ask, setAsk] = useState(false);
  const reward = displayReward(model, occ);
  const needsAmount = hasNull(occ.reward) && !occ.actual;
  const hot =
    occ.status === 'planned' &&
    occ.deadline &&
    Date.parse(occ.deadline) - Date.parse(model.now) < 3 * 86_400_000;

  const claim = () => {
    if (needsAmount) return setAsk(true);
    const actual =
      occ.tracker && occ.id in model.trackerSums ? { primo: model.trackerSums[occ.id] } : undefined;
    return actions.claim(model, occ, actual);
  };

  return (
    <li className={`row ${occ.status === 'claimed' ? 'done' : ''}`} data-testid={`occ-${occ.id}`}>
      <div className="row-main">
        <div className="row-title">
          {occ.title}{' '}
          {occ.confidence !== 'official' && occ.confidence !== 'tally' && (
            <ConfidenceBadge c={occ.confidence} />
          )}
        </div>
        {!compact && (
          <div className="row-sub">
            {dateTime(occ.from)}
            {occ.deadline ? ` → ${dateTime(occ.deadline)}` : ''}
            {occ.status === 'planned' && occ.deadline ? (
              <span className={hot ? 'hot' : ''}> · осталось {untilText(occ.deadline, model.now)}</span>
            ) : null}
            {occ.status !== 'planned' ? ` · ${STATUS_LABEL[occ.status]}` : ''}
          </div>
        )}
      </div>
      <div className="row-amount">{isZero(reward) && !hasNull(reward) ? '—' : rewardText(reward)}</div>
      <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
        {occ.status === 'planned' && (
          <>
            <Button small variant="primary" onClick={claim} aria-label={`Забрал: ${occ.title}`}>
              ✓
            </Button>
            {!compact && (
              <Button
                small
                onClick={() => actions.setStatus(model, occ, 'skipped')}
                aria-label={`Пропущу: ${occ.title}`}
              >
                ✕
              </Button>
            )}
          </>
        )}
        {occ.status === 'missed' && (
          <Button small onClick={claim} aria-label={`Забрал задним числом: ${occ.title}`}>
            забрал
          </Button>
        )}
        {(occ.status === 'claimed' || occ.status === 'skipped') && (
          <Button
            small
            variant="ghost"
            onClick={() => actions.setStatus(model, occ, 'planned')}
            aria-label={`Вернуть: ${occ.title}`}
          >
            ↺
          </Button>
        )}
      </div>
      {ask && (
        <AmountSheet occ={occ} onClose={() => setAsk(false)} onSave={(r) => actions.claim(model, occ, r)} />
      )}
    </li>
  );
}

/** Сумма не опубликована (null) — при отметке «забрал» вводится фактическая. */
function AmountSheet({
  occ,
  onClose,
  onSave,
}: {
  occ: Occurrence;
  onClose: () => void;
  onSave: (r: Reward) => Promise<void>;
}) {
  const [primo, setPrimo] = useState(0);
  const [fates, setFates] = useState(0);
  return (
    <Sheet open onClose={onClose} title="Сколько получено?">
      <p className="muted small">
        {occ.title}: сумма заранее не известна. <Badge tone="warn">не учтено в прогнозе</Badge>
      </p>
      <div className="grid2">
        <Field label="Примогемы">
          <NumberInput
            aria-label="Получено примогемов"
            value={primo}
            min={0}
            onChange={(v) => setPrimo(Math.max(0, v))}
          />
        </Field>
        <Field label="IF">
          <NumberInput
            aria-label="Получено IF"
            value={fates}
            min={0}
            onChange={(v) => setFates(Math.max(0, v))}
          />
        </Field>
      </div>
      <div className="btn-row">
        <Button
          variant="primary"
          onClick={async () => {
            await onSave({ primo, if: fates });
            onClose();
          }}
        >
          Забрал
        </Button>
        <Button onClick={onClose}>Отмена</Button>
      </div>
    </Sheet>
  );
}
