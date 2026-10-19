// «Источники и оплата» (10.8): луна, БП, пополнения, регулярные правила (включение, задержка забора).
import { ms, type PaymentProfile, type Schedule, type SourceRule } from '@primo/domain';
import { useState } from 'react';
import { useActions, useModel, useStoreApi } from '../state/context';
import type { Model } from '../state/model';
import { Badge, Button, Card, ConfidenceBadge, Field, NumberInput, Toggle } from '../ui/components';
import { date, rewardText } from '../ui/format';

export function SourcesScreen() {
  const model = useModel();
  if (!model) return null;
  return (
    <>
      <WelkinCard model={model} />
      <BattlePassCard model={model} />
      <TopUpsCard model={model} />
      <RulesCard model={model} />
    </>
  );
}

function usePayment(model: Model) {
  const actions = useActions();
  return (patch: Partial<PaymentProfile>) => actions.savePayment({ ...model.payment, ...patch });
}

/** Полдень выбранной даты в зоне устройства → UTC ISO. */
function dayToIso(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - offset * 3_600_000).toISOString();
}

function WelkinCard({ model }: { model: Model }) {
  const save = usePayment(model);
  const [day, setDay] = useState(date(model.now, model.deviceOffset, 'yyyy-MM-dd'));
  const purchases = [...model.payment.welkinPurchases].sort((a, b) => ms(a.at) - ms(b.at));
  const lastDay = model.occurrences
    .filter((o) => o.ruleId === 'welkin' && !o.virtual && !o.id.endsWith(':buy'))
    .at(-1);
  return (
    <Card title="Благословение полой луны">
      <p className="small muted">
        300 кристаллов сразу + 90 примогемов в день 30 дней; покупки встают хвостом, не больше 180 дней.
      </p>
      {lastDay && <p className="small">Активна до {date(lastDay.from, model.deviceOffset)}</p>}
      <ul className="list">
        {purchases.map((p) => (
          <li key={p.id} className="row">
            <span className="row-main">Покупка {date(p.at, model.deviceOffset)}</span>
            <Button
              small
              variant="ghost"
              onClick={() =>
                save({ welkinPurchases: model.payment.welkinPurchases.filter((x) => x.id !== p.id) })
              }
              aria-label={`Удалить покупку ${date(p.at, model.deviceOffset)}`}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div className="btn-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Дата покупки">
          <input
            className="input"
            type="date"
            aria-label="Дата покупки луны"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Button
          onClick={() =>
            save({
              welkinPurchases: [
                ...model.payment.welkinPurchases,
                {
                  id: `p${globalThis.crypto.randomUUID().slice(0, 8)}`,
                  at: dayToIso(day, model.deviceOffset),
                },
              ],
            })
          }
        >
          Добавить покупку
        </Button>
      </div>
      <Toggle
        checked={model.payment.welkinPlanned === 'keepActive'}
        onChange={(v) => save({ welkinPlanned: v ? 'keepActive' : 'none' })}
        label="Планирую держать луну активной"
        hint="В «Ожидаемо» и «Максимум» — покупка в день окончания"
      />
    </Card>
  );
}

function BattlePassCard({ model }: { model: Model }) {
  const save = usePayment(model);
  const bp = model.payment.bpPaid;
  const versions = model.versions.filter((v) => ms(v.bpEnd) > ms(model.now)).slice(0, 6);
  const listed = typeof bp === 'object' ? bp.versions : [];
  const mode = typeof bp === 'object' ? 'list' : bp;
  return (
    <Card title="Боевой пропуск (Гимн гнозиса)">
      <p className="small muted">Платная ветка: 680 примогемов + 4 IF за версию; бесплатная — 5 AF всегда.</p>
      <Field label="Покупаю">
        <select
          className="input"
          aria-label="Покупка БП"
          value={mode}
          onChange={(e) => {
            const v = e.target.value;
            void save({ bpPaid: v === 'list' ? { versions: listed } : (v as 'never' | 'everyVersion') });
          }}
        >
          <option value="never">Не покупаю</option>
          <option value="everyVersion">Каждую версию</option>
          <option value="list">Выборочно</option>
        </select>
      </Field>
      {mode === 'list' && (
        <div className="chip-row">
          {versions.map((v) => (
            <Toggle
              key={v.id}
              checked={listed.includes(v.id)}
              onChange={(on) =>
                save({ bpPaid: { versions: on ? [...listed, v.id] : listed.filter((x) => x !== v.id) } })
              }
              label={`${v.id} (до ${date(v.bpPurchaseEnd, model.deviceOffset, 'dd.MM')})`}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function TopUpsCard({ model }: { model: Model }) {
  const save = usePayment(model);
  const [day, setDay] = useState(date(model.now, model.deviceOffset, 'yyyy-MM-dd'));
  const [crystal, setCrystal] = useState(980);
  return (
    <Card title="Плановые пополнения">
      <ul className="list">
        {model.payment.plannedTopUps.map((t, i) => (
          <li key={`${t.at}-${i}`} className="row">
            <span className="row-main">
              {date(t.at, model.deviceOffset)} · {t.crystal} кристаллов
            </span>
            <Button
              small
              variant="ghost"
              onClick={() => save({ plannedTopUps: model.payment.plannedTopUps.filter((_, j) => j !== i) })}
              aria-label="Удалить пополнение"
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div className="btn-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Дата">
          <input
            className="input"
            type="date"
            aria-label="Дата пополнения"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field label="Кристаллов">
          <NumberInput
            aria-label="Кристаллов в пополнении"
            value={crystal}
            min={1}
            onChange={(v) => setCrystal(Math.max(1, Math.floor(v)))}
          />
        </Field>
        <Button
          onClick={() =>
            save({
              plannedTopUps: [
                ...model.payment.plannedTopUps,
                { at: dayToIso(day, model.deviceOffset), crystal },
              ],
            })
          }
        >
          Добавить
        </Button>
      </div>
    </Card>
  );
}

function scheduleText(s: Schedule): string {
  switch (s.kind) {
    case 'daily':
      return 'каждый день';
    case 'monthly':
      return `${s.day}-го числа`;
    case 'perVersion':
      return `за версию${s.offsetDays ? `, старт ${s.offsetDays > 0 ? '+' : '−'}${Math.abs(s.offsetDays)} д` : ''}${s.windowDays ? `, окно ${s.windowDays} д` : ''}`;
    case 'perPhase':
      return 'за фазу';
    case 'subscription':
      return 'подписка';
    case 'fixed':
      return 'разово';
  }
}

function RulesCard({ model }: { model: Model }) {
  const actions = useActions();
  const store = useStoreApi();
  const setEnabled = (rule: SourceRule, enabled: boolean) =>
    actions.putDoc('override', `rule:${rule.id}:enabled`, {
      entity: 'rule',
      id: rule.id,
      field: 'enabled',
      value: enabled,
      at: store.deps.clock().toISOString(),
    });
  const setLag = (rule: SourceRule, hours: number) =>
    actions.saveSettings({
      claimLagHours: { ...model.settings.claimLagHours, [rule.id]: Math.max(0, hours) },
    });
  return (
    <Card title="Регулярные источники">
      <p className="small muted">
        Отключённое правило не попадает в отметки и прогноз. Задержка — через сколько часов после начала
        обычно забираете.
      </p>
      <ul className="list">
        {model.rules.map((r) => (
          <li key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="row-main">
              <div className="row-title">
                {r.title} <ConfidenceBadge c={r.confidence} /> {r.paid && <Badge>платно</Badge>}
              </div>
              <div className="row-sub">
                {rewardText(r.reward)} · {scheduleText(r.schedule)}
              </div>
            </div>
            <label className="field" style={{ width: 110 }}>
              <span className="field-label">задержка, ч</span>
              <NumberInput
                aria-label={`Задержка: ${r.title}`}
                value={model.settings.claimLagHours[r.id] ?? r.claimLagHours}
                min={0}
                onChange={(v) => setLag(r, v)}
              />
            </label>
            <Toggle checked={r.enabled} onChange={(v) => setEnabled(r, v)} label="вкл." />
          </li>
        ))}
      </ul>
    </Card>
  );
}
