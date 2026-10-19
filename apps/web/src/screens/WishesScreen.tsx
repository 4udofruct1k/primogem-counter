// «Молитвы» (раздел 13): ввод состояния и цели, «Прокрутить N раз» в воркерах, таблицы шансов, «моя удача».
import {
  charCopiesDist,
  cdfAt,
  distMean,
  FATE_POINT_MAX,
  limitedPulls,
  makeModel,
  milestoneLabels,
  simInputError,
  RADIANCE_SAFETY,
  STARGLITTER_DEFAULTS,
  type CountKey,
  type EpitomizedPath,
  type FiftyFifty,
  type GachaModel,
  type Pity,
  type Ramp,
  type SimInput,
  type SimMode,
  type SimRuns,
  type SimSummary,
  type SoftPreset,
} from '@primo/domain';
import { useEffect, useRef, useState } from 'react';
import { useActions, useApp, useModel } from '../state/context';
import type { Model } from '../state/model';
import { goalNeed, simTargetOf } from '../state/goals';
import { Button, Card, Field, NumberInput, Progress, Sheet, Tabs, Toggle } from '../ui/components';
import { num } from '../ui/format';
import { useRoute } from '../ui/router';
import { runSimulation, type PortFactory, type SimRun } from '../workers/pool';

const MODES: { id: SimMode; label: string }[] = [
  { id: 'char_and_weapon', label: 'Персонаж + сигна' },
  { id: 'char_only', label: 'Персонаж' },
  { id: 'weapon_only', label: 'Оружие' },
];
const PRESET_NAMES: Record<SoftPreset, string> = {
  community: 'Сообщество',
  fit_consolidated: 'Подгонка под сводную',
  late_weapon: 'Поздний мягкий гарант',
  custom: 'Свои коэффициенты',
};
/** Подпись пресета: числа берутся из самой модели, а не пишутся в интерфейсе. */
function presetLabel(preset: SoftPreset): string {
  if (preset === 'custom') return PRESET_NAMES.custom;
  const m = makeModel(preset);
  const pct = (v: number) => `+${Math.round(v * 1000) / 10}%`;
  return `${PRESET_NAMES[preset]} (персонаж с ${m.char5.start}-й ${pct(m.char5.step)}, оружие с ${m.weapon5.start}-й ${pct(m.weapon5.step)})`;
}
const PRESETS = (Object.keys(PRESET_NAMES) as SoftPreset[]).map((id) => ({ id, label: presetLabel(id) }));
const FIFTY_NAMES: Record<FiftyFifty, string> = { radiance: '«Захват сияния»', classic: 'классика' };
const RUNS: SimRuns[] = [100, 1000, 10000, 100000];

export interface WishesForm {
  budget: number;
  mode: SimMode;
  consTarget: number;
  refTarget: number;
  runs: SimRuns;
  seed: number;
  pity: Pity;
  model: GachaModel;
  starglitter: SimInput['starglitter'];
  luckResult: string;
  luckPulls: number;
}

/** Случайный seed — целое uint32 (13.4). */
export function newSeed(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** Границы ввода состояния баннера — из модели: pity < hard, сияние ≤ RADIANCE_SAFETY, очко ≤ максимума пути. */
function pityLimits(m: GachaModel) {
  return {
    char: m.char5.hard - 1,
    weapon: m.weapon5.hard - 1,
    radiance: RADIANCE_SAFETY,
    fate: FATE_POINT_MAX[m.epitomized],
  };
}

export function defaultForm(model: Model, budget?: number): WishesForm {
  return {
    budget: budget ?? limitedPulls(model.balance, model.settings),
    mode: 'char_and_weapon',
    consTarget: 0,
    refTarget: 1,
    runs: 10000,
    seed: newSeed(),
    pity: { ...model.pity },
    model: makeModel('community'),
    starglitter: { ...STARGLITTER_DEFAULTS, enabled: false },
    luckResult: '',
    luckPulls: 0,
  };
}

export function toInput(f: WishesForm): SimInput {
  const input: SimInput = {
    budget: f.budget,
    pity: f.pity,
    mode: f.mode,
    consTarget: f.consTarget,
    refTarget: f.refTarget,
    runs: f.runs,
    seed: f.seed,
    starglitter: f.starglitter,
    model: f.model,
  };
  if (f.luckResult && f.luckPulls > 0) input.luck = { result: f.luckResult, pulls: f.luckPulls };
  return input;
}

export function WishesScreen({ portFactory }: { portFactory?: PortFactory } = {}) {
  const model = useModel();
  if (!model) return null;
  return <Wishes model={model} {...(portFactory ? { portFactory } : {})} />;
}

function Wishes({ model, portFactory }: { model: Model; portFactory?: PortFactory }) {
  const route = useRoute();
  const goals = useApp((s) => s.docs.goal);
  const saved = useApp((s) => s.docs.sim_preset.last) as Partial<WishesForm> | undefined;
  const actions = useActions();
  // начальная форма: сохранённые параметры, бюджет и цель из адреса (кнопка «Шансы на эту дату», 13.6)
  const [form, setForm] = useState<WishesForm>(() => {
    const budget = route.query.get('budget');
    const base = defaultForm(model, budget ? Number(budget) : undefined);
    const f: WishesForm = saved
      ? { ...base, ...saved, pity: { ...model.pity }, budget: base.budget, seed: saved.seed ?? base.seed }
      : base;
    const goalId = route.query.get('goal');
    const goal = goalId ? goals[goalId] : undefined;
    return goal ? { ...f, ...targetFromGoal(goal.need) } : f;
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<SimSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState(false);
  const running = useRef<SimRun | null>(null);

  useEffect(() => () => running.current?.cancel(), []);

  const set = (patch: Partial<WishesForm>) => {
    setForm({ ...form, ...patch });
    setSummary(null);
  };
  const input = toInput(form);
  const inputError = simInputError(input);
  const labels = milestoneLabels(input);

  const run = async () => {
    setError(null);
    setSummary(null);
    setProgress({ done: 0, total: form.runs });
    void actions.putDoc('sim_preset', 'last', {
      ...form,
      pity: undefined,
      budget: undefined,
    } as unknown as Record<string, unknown>);
    const job = runSimulation(input, {
      ...(portFactory ? { factory: portFactory } : {}),
      onProgress: (p) => {
        setProgress({ done: p.done, total: p.total });
        setSummary(p.summary);
      },
    });
    running.current = job;
    try {
      const s = await job.promise;
      setSummary(s);
      setProgress(null);
    } catch (e) {
      setProgress(null);
      if (!(e instanceof Error && e.message === 'cancelled'))
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      running.current = null;
    }
  };

  const goalList = Object.values(goals);
  const exactChar = form.mode !== 'weapon_only' && !form.starglitter.enabled ? exactCharChance(form) : null;

  return (
    <>
      <Card
        title="Молитвы — симулятор"
        actions={<Button onClick={() => setRecord(true)}>Записать реальные крутки</Button>}
      >
        <p className="small muted">
          Всё считается на этом устройстве, без сети: прогоны делятся между ядрами процессора.
        </p>
        <Tabs value={form.mode} onChange={(mode) => set({ mode })} items={MODES} />
        <div className="grid2">
          <Field label="Бюджет, круток" hint={`в кошельке ${limitedPulls(model.balance, model.settings)}`}>
            <NumberInput
              aria-label="Бюджет круток"
              value={form.budget}
              min={0}
              onChange={(v) => set({ budget: Math.max(0, Math.floor(v)) })}
            />
          </Field>
          {form.mode !== 'weapon_only' && (
            <Field label="Цель: созвездие">
              <select
                className="input"
                aria-label="Цель созвездие"
                value={form.consTarget}
                onChange={(e) => set({ consTarget: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                  <option key={c} value={c}>
                    C{c}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {form.mode !== 'char_only' && (
            <Field label="Цель: сигна">
              <select
                className="input"
                aria-label="Цель сигна"
                value={form.refTarget}
                onChange={(e) => set({ refTarget: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    R{r}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="chip-row">
          <Button small onClick={() => set({ budget: limitedPulls(model.balance, model.settings) })}>
            Из кошелька
          </Button>
          {goalList.map((g) => (
            <Button
              key={g.id}
              small
              onClick={() => set(targetFromGoal(g.need))}
              title={`Худший случай: ${goalNeed(model, g)} круток`}
            >
              цель: {g.title}
            </Button>
          ))}
        </div>
        <BannerState form={form} set={set} />
        <ModelSettings form={form} set={set} />
        <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
          <Field label="Прогонов">
            <select
              className="input"
              aria-label="Прогонов"
              value={form.runs}
              onChange={(e) => set({ runs: Number(e.target.value) as SimRuns })}
            >
              {RUNS.map((r) => (
                <option key={r} value={r}>
                  {num(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seed">
            <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
              <NumberInput
                aria-label="Seed"
                value={form.seed}
                min={0}
                onChange={(v) => set({ seed: Math.max(0, Math.floor(v)) })}
              />
              <Button small onClick={() => set({ seed: newSeed() })}>
                новый
              </Button>
            </div>
          </Field>
        </div>
        <Toggle
          checked={form.starglitter.enabled}
          onChange={(v) => set({ starglitter: { ...form.starglitter, enabled: v } })}
          label="Возврат звёздного блеска"
          hint="каждые 5 блеска — +1 крутка в течение прогона"
        />
        {form.starglitter.enabled && (
          <div className="grid2">
            {(
              [
                ['per4', '4★'],
                ['perStd5', '5★ стандартный'],
                ['perDup5', '5★ ивентовый, не первая копия'],
                ['perWeapon5', '5★ оружие'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={`Блеск: ${label}`}>
                <NumberInput
                  aria-label={`Блеск: ${label}`}
                  value={form.starglitter[k]}
                  min={0}
                  onChange={(v) => set({ starglitter: { ...form.starglitter, [k]: Math.max(0, v) } })}
                />
              </Field>
            ))}
          </div>
        )}
        <details>
          <summary className="small muted">Моя удача</summary>
          <div className="grid2">
            <Field label="Результат">
              <select
                className="input"
                aria-label="Мой результат"
                value={form.luckResult}
                onChange={(e) => set({ luckResult: e.target.value })}
              >
                <option value="">—</option>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сколько круток ушло">
              <NumberInput
                aria-label="Моих круток ушло"
                value={form.luckPulls}
                min={0}
                onChange={(v) => set({ luckPulls: Math.max(0, Math.floor(v)) })}
              />
            </Field>
          </div>
        </details>
        {inputError && <p className="hot small">{inputError}</p>}
        {error && <p className="hot small">{error}</p>}
        <div className="btn-row">
          <Button variant="primary" disabled={!!inputError || !!progress} onClick={run}>
            Прокрутить {num(form.runs)} раз
          </Button>
          {progress && (
            <Button variant="danger" onClick={() => running.current?.cancel()}>
              Отменить
            </Button>
          )}
        </div>
        {progress && (
          <div>
            <Progress value={progress.done} max={progress.total} />
            <p className="small muted">
              {num(progress.done)} из {num(progress.total)}
            </p>
          </div>
        )}
      </Card>
      {summary && <Results summary={summary} exactChar={exactChar} done={!progress} />}
      {record && <RecordSheet model={model} onClose={() => setRecord(false)} />}
    </>
  );
}

/** Режим и цель симулятора из цели прогноза (13.6). */
function targetFromGoal(need: Parameters<typeof simTargetOf>[0]): Partial<WishesForm> {
  const t = simTargetOf(need);
  if (t.cons !== null && t.refs !== null)
    return { mode: 'char_and_weapon', consTarget: t.cons, refTarget: t.refs };
  if (t.cons !== null) return { mode: 'char_only', consTarget: t.cons };
  if (t.refs !== null) return { mode: 'weapon_only', refTarget: t.refs };
  return {};
}

/** Точный шанс персонажной цели в пределах бюджета (без блеска) — для сверки с Монте-Карло. */
function exactCharChance(form: WishesForm): number | null {
  try {
    const d = charCopiesDist(form.model, form.pity, form.consTarget + 1, form.budget);
    return cdfAt(d, form.budget) * 100;
  } catch {
    return null;
  }
}

function BannerState({ form, set }: { form: WishesForm; set: (p: Partial<WishesForm>) => void }) {
  const p = form.pity;
  const setPity = (patch: Partial<Pity>) => set({ pity: { ...p, ...patch } });
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v)));
  const lim = pityLimits(form.model);
  return (
    <details open>
      <summary className="small muted">Состояние баннеров</summary>
      <div className="grid2">
        {form.mode !== 'weapon_only' && (
          <>
            <Field label={`Персонаж: pity (0–${lim.char})`}>
              <NumberInput
                aria-label="Персонаж pity"
                value={p.char}
                onChange={(v) => setPity({ char: clamp(v, lim.char) })}
              />
            </Field>
            <Field label={`Счётчик сияния (0–${lim.radiance})`}>
              <NumberInput
                aria-label="Счётчик сияния"
                value={p.radiance}
                onChange={(v) => setPity({ radiance: clamp(v, lim.radiance) as Pity['radiance'] })}
              />
            </Field>
          </>
        )}
        {form.mode !== 'char_only' && (
          <>
            <Field label={`Оружие: pity (0–${lim.weapon})`}>
              <NumberInput
                aria-label="Оружие pity"
                value={p.weapon}
                onChange={(v) => setPity({ weapon: clamp(v, lim.weapon) })}
              />
            </Field>
            <Field label={`Очко судьбы (0–${lim.fate})`}>
              <NumberInput
                aria-label="Очко судьбы"
                value={p.weaponFatePoint}
                onChange={(v) => setPity({ weaponFatePoint: clamp(v, lim.fate) })}
              />
            </Field>
          </>
        )}
      </div>
      <div className="btn-row">
        {form.mode !== 'weapon_only' && (
          <Toggle
            checked={p.charGuaranteed}
            onChange={(v) => setPity({ charGuaranteed: v })}
            label="Гарант на персонажа"
          />
        )}
        {form.mode !== 'char_only' && (
          <Toggle
            checked={p.weaponGuaranteed}
            onChange={(v) => setPity({ weaponGuaranteed: v })}
            label="Гарант 75/25"
          />
        )}
      </div>
    </details>
  );
}

function ModelSettings({ form, set }: { form: WishesForm; set: (p: Partial<WishesForm>) => void }) {
  const m = form.model;
  const setPreset = (preset: SoftPreset) =>
    set({
      model:
        preset === 'custom'
          ? { ...m, softPreset: 'custom' }
          : { ...makeModel(preset, { fiftyFifty: m.fiftyFifty, epitomized: m.epitomized }) },
    });
  const setRamp = (key: 'char5' | 'weapon5' | 'char4' | 'weapon4', patch: Partial<Ramp>) =>
    set({ model: { ...m, softPreset: 'custom', [key]: { ...m[key], ...patch } } });
  return (
    <details>
      <summary className="small muted">Модель: {PRESETS.find((p) => p.id === m.softPreset)?.label}</summary>
      <div className="grid2">
        <Field label="Мягкий гарант">
          <select
            className="input"
            aria-label="Пресет мягкого гаранта"
            value={m.softPreset}
            onChange={(e) => setPreset(e.target.value as SoftPreset)}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Оружейный путь">
          <select
            className="input"
            aria-label="Оружейный путь"
            value={m.epitomized}
            onChange={(e) => set({ model: { ...m, epitomized: e.target.value as EpitomizedPath } })}
          >
            <option value="5.0+">5.0+ (1 очко)</option>
            <option value="2.0-4.8">2.0–4.8 (2 очка)</option>
            <option value="1.x">1.x (пути нет)</option>
          </select>
        </Field>
        <Field label="50/50">
          <select
            className="input"
            aria-label="Модель 50/50"
            value={m.fiftyFifty}
            onChange={(e) => set({ model: { ...m, fiftyFifty: e.target.value as FiftyFifty } })}
          >
            <option value="radiance">«Захват сияния» (5.0+)</option>
            <option value="classic">Классика 50/50</option>
          </select>
        </Field>
      </div>
      {m.softPreset === 'custom' && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>base</th>
                <th>start</th>
                <th>step</th>
                <th>hard</th>
              </tr>
            </thead>
            <tbody>
              {(['char5', 'weapon5', 'char4', 'weapon4'] as const).map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  {(['base', 'start', 'step', 'hard'] as const).map((f) => (
                    <td key={f} style={{ minWidth: 80 }}>
                      <NumberInput
                        aria-label={`${k} ${f}`}
                        value={m[k][f]}
                        step={f === 'base' || f === 'step' ? 0.001 : 1}
                        onChange={(v) => setRamp(k, { [f]: v })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

const COUNT_TITLES: Partial<Record<CountKey, string>> = {
  char5Featured: 'Ивентовых 5★ персонажей',
  char5Std: 'Стандартных 5★ персонажей',
  w5Chosen: 'Выбранного оружия',
  w5Other: 'Второго ивентового оружия',
  w5Std: 'Стандартного 5★ оружия',
};

function Results({
  summary,
  exactChar,
  done,
}: {
  summary: SimSummary;
  exactChar: number | null;
  done: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pct = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString('ru-RU')} %`;
  const fours = summary.countDists.fours;
  return (
    <>
      <Card title={done ? 'Результаты' : 'Результаты (идёт счёт…)'}>
        <div className="table-wrap">
          <table className="tbl" data-testid="sim-results">
            <thead>
              <tr>
                <th>Результат</th>
                <th>% прогонов</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r) => (
                <tr
                  key={r.label}
                  onClick={() => setOpen(open === r.label ? null : r.label)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{r.label}</td>
                  <td>
                    <b>{pct(r.pct)}</b>
                    {open === r.label && r.pulls && (
                      <div className="small muted">
                        круток: среднее {num(Math.round(r.pulls.mean * 10) / 10)}, медиана{' '}
                        {num(r.pulls.median)}, p10 {num(r.pulls.p10)}, p90 {num(r.pulls.p90)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Тап по строке — сколько круток понадобилось дошедшим. Погрешность при 10 000 прогонов — не больше ±1
          п. п.
        </p>
        {exactChar !== null && (
          <p className="small muted">Точный расчёт для персонажа без блеска: {pct(exactChar)}.</p>
        )}
        {summary.luckPercentile !== undefined && (
          <p data-testid="luck">
            Моя удача: <b>удачливее {pct(summary.luckPercentile)} прогонов</b>
          </p>
        )}
      </Card>
      <Card title="Итоговые сочетания">
        <ul className="list" data-testid="sim-combos">
          {summary.combos.map((c) => (
            <li key={c.label} className="row">
              <span className="row-main">{c.label}</span>
              <span className="row-amount">{pct(c.pct)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Ивентовые и стандартные">
        {summary.winRate5050 !== null && (
          <p>
            Выиграно 50/50: <b>{pct(summary.winRate5050)}</b>
          </p>
        )}
        {Object.entries(COUNT_TITLES).map(([k, title]) => {
          const d = summary.countDists[k as CountKey];
          if (!d || d.length === 0) return null;
          return (
            <div key={k}>
              <div className="small">
                {title}: в среднем {num(Math.round(distMean(d) * 100) / 100)}
              </div>
              <div className="chip-row small muted">
                {d
                  .filter((x) => x.pct >= 0.05)
                  .map((x) => (
                    <span key={x.k}>
                      {x.k} шт — {pct(x.pct)}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
        {fours && (
          <p className="small muted">
            4★ за бюджет — в среднем {num(Math.round(distMean(fours) * 10) / 10)} (справочно).
          </p>
        )}
      </Card>
      <p className="hint">
        Модель: {PRESET_NAMES[summary.meta.softPreset]}, путь {summary.meta.epitomized}, 50/50{' '}
        {FIFTY_NAMES[summary.meta.fiftyFifty]} · прогонов {num(summary.meta.runs)} · seed {summary.meta.seed}
      </p>
    </>
  );
}

/** «Записать реальные крутки» (13.6): списать крутки из кошелька и обновить Pity. */
function RecordSheet({ model, onClose }: { model: Model; onClose: () => void }) {
  const actions = useActions();
  const [pulls, setPulls] = useState(0);
  const [p, setP] = useState<Pity>({ ...model.pity });
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v)));
  const lim = pityLimits(makeModel());
  return (
    <Sheet open onClose={onClose} title="Записать реальные крутки">
      <Field label="Сколько круток сделано">
        <NumberInput
          aria-label="Сделано круток"
          value={pulls}
          min={0}
          onChange={(v) => setPulls(Math.max(0, Math.floor(v)))}
        />
      </Field>
      <div className="grid2">
        <Field label="Персонаж: pity">
          <NumberInput
            aria-label="Новый pity персонажа"
            value={p.char}
            onChange={(v) => setP({ ...p, char: clamp(v, lim.char) })}
          />
        </Field>
        <Field label="Сияние">
          <NumberInput
            aria-label="Новый счётчик сияния"
            value={p.radiance}
            onChange={(v) => setP({ ...p, radiance: clamp(v, lim.radiance) as Pity['radiance'] })}
          />
        </Field>
        <Field label="Оружие: pity">
          <NumberInput
            aria-label="Новый pity оружия"
            value={p.weapon}
            onChange={(v) => setP({ ...p, weapon: clamp(v, lim.weapon) })}
          />
        </Field>
        <Field label="Очко судьбы">
          <NumberInput
            aria-label="Новое очко судьбы"
            value={p.weaponFatePoint}
            onChange={(v) => setP({ ...p, weaponFatePoint: clamp(v, lim.fate) })}
          />
        </Field>
      </div>
      <Toggle
        checked={p.charGuaranteed}
        onChange={(v) => setP({ ...p, charGuaranteed: v })}
        label="Гарант на персонажа"
      />
      <Toggle
        checked={p.weaponGuaranteed}
        onChange={(v) => setP({ ...p, weaponGuaranteed: v })}
        label="Гарант 75/25"
      />
      <Button
        variant="primary"
        onClick={async () => {
          await actions.recordWishes(model, pulls, p);
          onClose();
        }}
      >
        Записать
      </Button>
    </Sheet>
  );
}
