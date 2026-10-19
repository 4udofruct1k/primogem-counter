import { limitedPulls, ms, standardPulls, type LedgerEntry, type WalletSnapshot } from '@primo/domain';
import { useState } from 'react';
import { useActions, useApp, useModel } from '../state/context';
import { Button, Card, Empty, Field, NumberInput, Stat } from '../ui/components';
import { dateTime, num, rewardText } from '../ui/format';
import { ReconcileSheet } from './ReconcileSheet';

const REASON: Record<LedgerEntry['reason'], string> = {
  claim: 'забрал',
  progress: 'прогресс',
  spend_pulls: 'крутки',
  purchase: 'покупка',
  manual: 'вручную',
};

export function WalletScreen() {
  const model = useModel();
  const actions = useActions();
  const ledger = useApp((s) => s.docs.ledger);
  const snapshots = useApp((s) => s.docs.wallet_snapshot);
  const [reconcile, setReconcile] = useState(false);
  const [spend, setSpend] = useState(10);
  if (!model) return null;
  const b = model.balance;
  const entries = (Object.values(ledger) as LedgerEntry[]).sort((x, y) => ms(y.at) - ms(x.at)).slice(0, 100);
  const snaps = (Object.entries(snapshots) as [string, WalletSnapshot][]).sort(
    ([, x], [, y]) => ms(y.at) - ms(x.at),
  );

  return (
    <>
      <Card title="Кошелёк" actions={<Button onClick={() => setReconcile(true)}>Сверка</Button>}>
        <div className="stats">
          <Stat label="Лимитированные крутки" value={num(limitedPulls(b, model.settings))} big />
          <Stat label="Стандартные (AF)" value={num(standardPulls(b))} big />
        </div>
        <div className="stats">
          <Stat label="Примогемы" value={num(b.primo)} />
          <Stat
            label="Кристаллы"
            value={num(b.crystal)}
            sub={model.settings.countCrystals ? 'учитываются' : 'не учитываются'}
          />
          <Stat label="IF" value={num(b.if)} />
          <Stat label="AF" value={num(b.af)} />
          <Stat label="Звёздный блеск" value={num(b.starglitter)} />
          <Stat label="Звёздная пыль" value={num(b.stardust)} />
        </div>
        <p className="muted small">
          Pity: персонаж {model.pity.char}
          {model.pity.charGuaranteed ? ' (гарант)' : ''}, сияние {model.pity.radiance}; оружие{' '}
          {model.pity.weapon}
          {model.pity.weaponGuaranteed ? ' (гарант 75/25)' : ''}, очко {model.pity.weaponFatePoint}.
        </p>
      </Card>

      <Card title="Потратил крутки">
        <div className="btn-row">
          <Field label="Круток">
            <NumberInput
              aria-label="круток потрачено"
              value={spend}
              min={1}
              onChange={(v) => setSpend(Math.max(1, Math.floor(v)))}
            />
          </Field>
        </div>
        <Button onClick={() => actions.spendPulls(model, spend)}>
          Списать {spend} (сначала IF, потом по 160)
        </Button>
      </Card>

      <Card title="Леджер">
        {entries.length === 0 ? (
          <Empty>Пока пусто. Отметки «забрал» и прогресс попадают сюда автоматически.</Empty>
        ) : (
          <ul className="list">
            {entries.map((e) => (
              <li key={e.id} className="row">
                <div className="row-main">
                  <div className="row-title">{REASON[e.reason]}</div>
                  <div className="row-sub">
                    {dateTime(e.at)} {e.refId ? `· ${e.refId}` : ''}
                  </div>
                </div>
                <div className="row-amount">{rewardText(e.delta, '0')}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ReconcileSheet open={reconcile} onClose={() => setReconcile(false)} />
      <Card title={`Снимки — ${snaps.length}`}>
        {snaps.length === 0 ? (
          <Empty>Снимков нет — нажмите «Сверка», чтобы ввести реальные цифры.</Empty>
        ) : (
          <ul className="list" data-testid="snapshots">
            {snaps.slice(0, 50).map(([id, sn], i) => (
              <li key={id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    {dateTime(sn.at)}
                    {i === 0 ? ' · от него считается баланс' : ''}
                  </div>
                  <div className="row-sub">
                    {rewardText(sn, '0')} · pity {sn.pity.char}
                    {sn.pity.charGuaranteed ? ' (гарант)' : ''} / {sn.pity.weapon}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
