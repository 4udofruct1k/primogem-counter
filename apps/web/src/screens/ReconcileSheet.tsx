import type { Balance, Pity } from '@primo/domain';
import { useState } from 'react';
import { useActions, useModel } from '../state/context';
import { Button, Field, NumberInput, Sheet, Toggle } from '../ui/components';

const FIELDS: [keyof Balance, string][] = [
  ['primo', 'Камни Истока (примогемы)'],
  ['crystal', 'Кристаллы Сотворения'],
  ['if', 'Переплетающиеся судьбы (IF)'],
  ['af', 'Судьбоносные встречи (AF)'],
  ['starglitter', 'Звёздный блеск'],
  ['stardust', 'Звёздная пыль'],
];

/** «Сверка» — ручной ввод реальных цифр из игры → новый снимок кошелька (5.1). */
export function ReconcileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const model = useModel();
  if (!model || !open) return null;
  return <ReconcileForm key={String(open)} balance={model.balance} pity={model.pity} onClose={onClose} />;
}

function ReconcileForm({ balance, pity, onClose }: { balance: Balance; pity: Pity; onClose: () => void }) {
  const actions = useActions();
  const [b, setB] = useState<Balance>({ ...balance });
  const [p, setP] = useState<Pity>({ ...pity });
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v)));

  return (
    <Sheet open onClose={onClose} title="Сверка с игрой">
      <div className="grid2">
        {FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <NumberInput
              aria-label={label}
              value={b[k]}
              min={0}
              onChange={(v) => setB({ ...b, [k]: Math.max(0, v) })}
            />
          </Field>
        ))}
      </div>
      <h3>Pity</h3>
      <div className="grid2">
        <Field label="Персонаж: круток с последней 5★ (0–89)">
          <NumberInput
            aria-label="pity персонажа"
            value={p.char}
            onChange={(v) => setP({ ...p, char: clamp(v, 89) })}
          />
        </Field>
        <Field label="Сияние: подряд проигранных 50/50 (0–3)">
          <NumberInput
            aria-label="счётчик сияния"
            value={p.radiance}
            onChange={(v) => setP({ ...p, radiance: clamp(v, 3) as Pity['radiance'] })}
          />
        </Field>
        <Field label="Оружие: круток с последней 5★ (0–79)">
          <NumberInput
            aria-label="pity оружия"
            value={p.weapon}
            onChange={(v) => setP({ ...p, weapon: clamp(v, 79) })}
          />
        </Field>
        <Field label="Очко судьбы (0–1)">
          <NumberInput
            aria-label="очко судьбы"
            value={p.weaponFatePoint}
            onChange={(v) => setP({ ...p, weaponFatePoint: clamp(v, 2) })}
          />
        </Field>
      </div>
      <Toggle
        checked={p.charGuaranteed}
        onChange={(v) => setP({ ...p, charGuaranteed: v })}
        label="Гарант на персонажа (проиграл 50/50)"
      />
      <Toggle
        checked={p.weaponGuaranteed}
        onChange={(v) => setP({ ...p, weaponGuaranteed: v })}
        label="Гарант 75/25 на оружие"
      />
      <div className="btn-row">
        <Button
          variant="primary"
          onClick={async () => {
            await actions.reconcile(b, p);
            onClose();
          }}
        >
          Сохранить снимок
        </Button>
        <Button onClick={onClose}>Отмена</Button>
      </div>
    </Sheet>
  );
}
