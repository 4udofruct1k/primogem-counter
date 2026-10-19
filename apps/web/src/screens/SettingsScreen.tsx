import type { ServerId } from '@primo/domain';
import type { Settings } from '@primo/shared';
import { useActions, useModel, useStoreApi } from '../state/context';
import { notificationsSupported } from '../state/notifier';
import { Button, Card, Field, NumberInput, Toggle } from '../ui/components';
import { AccountCard } from './AccountCard';
import { BackupCard } from './BackupCard';

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
      <BackupCard />
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
      <ChestPrices />
      <Card title="Уведомления">
        <Toggle
          checked={s.notifications.enabled}
          onChange={(v) => save({ notifications: { ...s.notifications, enabled: v } })}
          label="Напоминать о дедлайнах"
          hint="Пока вкладка или приложение открыты; всегда — блок «горит» и счётчик на иконке"
        />
        <Field label="Дедлайны — от скольки примогемов" hint="или любые судьбы">
          <NumberInput
            aria-label="Порог напоминаний"
            value={s.notifications.minPrimo}
            min={0}
            step={50}
            onChange={(v) =>
              save({ notifications: { ...s.notifications, minPrimo: Math.max(0, Math.floor(v)) } })
            }
          />
        </Field>
        {notificationsSupported() && Notification.permission !== 'granted' && (
          <Button onClick={() => void Notification.requestPermission()}>
            Разрешить уведомления браузера
          </Button>
        )}
      </Card>
    </>
  );
}

function clamp5(v: number): number {
  return Math.max(0, Math.min(5, Math.floor(v)));
}

/** Глобальные цены сундуков (11.2): Override `chestType`. */
function ChestPrices() {
  const model = useModel();
  const actions = useActions();
  const store = useStoreApi();
  if (!model) return null;
  const save = (typeId: string, field: 'values.low' | 'values.high', value: number) =>
    actions.putDoc('override', `chestType:${typeId}:${field}`, {
      entity: 'chestType',
      id: typeId,
      field,
      value,
      at: store.deps.clock().toISOString(),
    });
  return (
    <Card title="Цены сундуков">
      <p className="muted small">
        low — низкоуровневые зоны Мондштадта и Ли Юэ, high — остальные. Роскошный — две кнопки «+10» и «+40»
        везде.
      </p>
      {model.calc.chestTypes
        .filter((t) => !t.variants?.length)
        .map((t) => (
          <div key={t.id} className="grid2">
            <Field label={`${t.name}: low`}>
              <NumberInput
                aria-label={`Цена ${t.name} low`}
                value={t.values.low}
                min={0}
                onChange={(v) => save(t.id, 'values.low', Math.max(0, v))}
              />
            </Field>
            <Field label={`${t.name}: high`}>
              <NumberInput
                aria-label={`Цена ${t.name} high`}
                value={t.values.high}
                min={0}
                onChange={(v) => save(t.id, 'values.high', Math.max(0, v))}
              />
            </Field>
          </div>
        ))}
    </Card>
  );
}
