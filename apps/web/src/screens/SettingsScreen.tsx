import type { ServerId } from '@primo/domain';
import type { Settings } from '@primo/shared';
import { useActions, useModel } from '../state/context';
import { Card, Field, NumberInput, Toggle } from '../ui/components';
import { AccountCard } from './AccountCard';

const SERVERS: [ServerId, string][] = [
  ['europe', 'Europe (UTC+1)'],
  ['asia', 'Asia (UTC+8)'],
  ['tw_hk_mo', 'TW/HK/MO (UTC+8)'],
  ['america', 'America (UTC−5)'],
];

export function SettingsScreen() {
  const model = useModel();
  const actions = useActions();
  if (!model) return null;
  const s = model.settings;
  const save = (patch: Partial<Settings>) => actions.saveSettings(patch);

  return (
    <>
      <AccountCard />
      <Card title="Игра">
        <Field label="Сервер" hint="Смена сервера перерезолвит время; отметки и прогресс сохраняются">
          <select
            className="input"
            aria-label="Сервер"
            value={s.server}
            onChange={(e) => save({ server: e.target.value as ServerId })}
          >
            {SERVERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Сценарий прогноза по умолчанию">
          <select
            className="input"
            aria-label="Сценарий"
            value={s.scenario}
            onChange={(e) => save({ scenario: e.target.value as Settings['scenario'] })}
          >
            <option value="min">Минимум</option>
            <option value="expected">Ожидаемо</option>
            <option value="max">Максимум</option>
          </select>
        </Field>
      </Card>
      <Card title="Учёт">
        <Toggle
          checked={s.countCrystals}
          onChange={(v) => save({ countCrystals: v })}
          label="Считать кристаллы"
          hint="1 кристалл → 1 примогем"
        />
        <Toggle
          checked={s.countStarglitter}
          onChange={(v) => save({ countStarglitter: v })}
          label="Считать звёздный блеск"
          hint="5 блеска → 1 крутка"
        />
        <Toggle
          checked={s.autoApplyClaims}
          onChange={(v) => save({ autoApplyClaims: v })}
          label="Отметки сразу меняют кошелёк"
          hint="«Забрал» и прогресс пишут запись в леджер"
        />
      </Card>
      <Card title="Магазин Паймон (звёздная пыль)">
        <p className="muted small">
          Сколько круток в месяц планируете покупать за пыль — это идёт в прогноз.
        </p>
        <div className="grid2">
          <Field label="IF в месяц (0–5)">
            <NumberInput
              aria-label="IF в месяц"
              value={s.stardustShop.if}
              min={0}
              max={5}
              onChange={(v) => save({ stardustShop: { ...s.stardustShop, if: clamp5(v) } })}
            />
          </Field>
          <Field label="AF в месяц (0–5)">
            <NumberInput
              aria-label="AF в месяц"
              value={s.stardustShop.af}
              min={0}
              max={5}
              onChange={(v) => save({ stardustShop: { ...s.stardustShop, af: clamp5(v) } })}
            />
          </Field>
        </div>
      </Card>
      <Card title="Разовый контент">
        <Field label="Темп, примогемов в неделю" hint="Для областей с планом «темпом»; 0 — выключено">
          <NumberInput
            aria-label="Темп разового контента"
            value={s.weeklyOneTimePrimo}
            min={0}
            step={50}
            onChange={(v) => save({ weeklyOneTimePrimo: Math.max(0, Math.floor(v)) })}
          />
        </Field>
      </Card>
      <Card title="Уведомления">
        <Toggle
          checked={s.notifications.enabled}
          onChange={(v) => save({ notifications: { ...s.notifications, enabled: v } })}
          label="Напоминать о дедлайнах"
          hint="Пока вкладка или приложение открыты"
        />
      </Card>
    </>
  );
}

function clamp5(v: number): number {
  return Math.max(0, Math.min(5, Math.floor(v)));
}
