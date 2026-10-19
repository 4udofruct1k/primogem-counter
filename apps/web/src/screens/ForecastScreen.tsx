// «Прогноз» (10.3, раздел 8): цель, три сценария, разрыв, дата достижения, вклад по категориям, график, «не учтено».
import {
  addDays,
  CATEGORY_TITLES,
  goalGap,
  ms,
  reachDate,
  type ForecastResult,
  type Goal,
  type GoalNeed,
  type ISO,
  type Scenario,
} from '@primo/domain';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
} from 'recharts';
import { useActions, useApp, useModel } from '../state/context';
import { goalNeed, goalPullStats, goalTarget, needLabel } from '../state/goals';
import { runForecast, type Model } from '../state/model';
import { Badge, Button, Card, Empty, Field, NumberInput, Sheet, Stat, Tabs } from '../ui/components';
import { date, dateTime, num, rewardText } from '../ui/format';
import { href, navigate, useRoute } from '../ui/router';
import { useCssVars } from '../ui/useCssVars';

const SCENARIOS: { id: Scenario; label: string; color: string }[] = [
  { id: 'min', label: 'Минимум', color: '--series-2' },
  { id: 'expected', label: 'Ожидаемо', color: '--series-1' },
  { id: 'max', label: 'Максимум', color: '--series-3' },
];

export function ForecastScreen() {
  const model = useModel();
  const route = useRoute();
  const goals = useApp((s) => s.docs.goal);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [editGoal, setEditGoal] = useState<Goal | 'new' | null>(null);

  const goal = route.query.get('goal') ? (goals[route.query.get('goal')!] as Goal | undefined) : undefined;
  const target: ISO | null = model
    ? goal
      ? goalTarget(model, goal)
      : (route.query.get('t') ?? model.currentVersion?.endDeadline ?? addDays(model.now, 30))
    : null;

  const results = useMemo(() => {
    if (!model || !target) return null;
    return Object.fromEntries(SCENARIOS.map((s) => [s.id, runForecast(model, target, s.id)])) as Record<
      Scenario,
      ForecastResult
    >;
  }, [model, target]);

  if (!model || !target || !results) return null;
  const active = scenario ?? model.settings.scenario;
  const r = results[active];
  const need = goal ? goalNeed(model, goal) : null;
  const pastTarget = ms(target) <= ms(model.now);

  return (
    <>
      <TargetPicker
        model={model}
        target={target}
        goals={Object.values(goals) as Goal[]}
        goalId={goal?.id ?? null}
        onEditGoal={setEditGoal}
      />
      {pastTarget && <p className="warn">Цель уже в прошлом — прогноз равен текущему балансу.</p>}
      <Card title={`К ${dateTime(target, model.deviceOffset)}`}>
        <div className="scenario-tiles">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`stat ${s.id === active ? 'active' : ''}`}
              style={{
                borderTopColor: `var(${s.color})`,
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
              }}
              onClick={() => setScenario(s.id)}
            >
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" data-testid={`pulls-${s.id}`}>
                {num(results[s.id].limitedPulls)}
              </div>
              <div className="stat-sub">+ {num(results[s.id].standardPulls)} AF</div>
            </button>
          ))}
        </div>
        {goal && need !== null && <GoalPanel model={model} goal={goal} need={need} result={r} />}
        <div className="btn-row">
          <Button
            small
            onClick={() =>
              navigate(
                `${href('wishes')}?budget=${r.limitedPulls}${goal ? `&goal=${encodeURIComponent(goal.id)}` : ''}`,
              )
            }
          >
            Шансы на эту дату →
          </Button>
        </div>
      </Card>

      <Card title="Крутки по дням">
        <ForecastChart results={results} need={need} />
      </Card>

      <Card title={`Откуда — ${SCENARIOS.find((s) => s.id === active)!.label.toLowerCase()}`}>
        <Tabs
          value={active}
          onChange={setScenario}
          items={SCENARIOS.map((s) => ({ id: s.id, label: s.label }))}
        />
        <ul className="list" data-testid="by-category">
          <li className="row">
            <span className="row-main">Сейчас в кошельке</span>
            <span className="row-amount">{rewardText(model.balance, '0')}</span>
          </li>
          {r.byCategory.map((c) => (
            <li key={c.category} className="row">
              <span className="row-main">{CATEGORY_TITLES[c.category]}</span>
              <span className="row-amount">{rewardText(c.reward, '0')}</span>
            </li>
          ))}
        </ul>
        <details>
          <summary className="small muted">Все поступления ({r.contributions.length})</summary>
          <ul className="list">
            {r.contributions.map((c, i) => (
              <li key={`${c.id}-${i}`} className="row">
                <div className="row-main">
                  <div className="row-title small">{c.title}</div>
                  <div className="row-sub">{dateTime(c.at, model.deviceOffset)}</div>
                </div>
                <span className="row-amount small">{rewardText(c.reward)}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <Card title="Не учтено">
        {r.unknown.length === 0 ? (
          <Empty>Всё в окне прогноза имеет известные суммы.</Empty>
        ) : (
          <>
            <p className="small muted">Суммы неизвестны — в прогнозе 0.</p>
            <ul className="list" data-testid="unknown-list">
              {dedupe(r.unknown).map((u) => (
                <li key={u.id} className="row">
                  <span className="row-main small">{u.title}</span>
                  <Badge tone="warn">?</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {r.deadlines.length > 0 && (
        <Card title="Дедлайны до цели">
          <ul className="list">
            {r.deadlines.slice(0, 30).map((d) => (
              <li key={d.id} className="row">
                <div className="row-main">
                  <div className="row-title small">{d.title}</div>
                  <div className="row-sub">до {dateTime(d.deadline, model.deviceOffset)}</div>
                </div>
                <span className="row-amount small">{rewardText(d.reward)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editGoal && (
        <GoalSheet
          model={model}
          goal={editGoal === 'new' ? null : editGoal}
          onClose={() => setEditGoal(null)}
        />
      )}
    </>
  );
}

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

function GoalPanel({
  model,
  goal,
  need,
  result,
}: {
  model: Model;
  goal: Goal;
  need: number;
  result: ForecastResult;
}) {
  const gap = goalGap(need, result.limitedPulls);
  const reach = reachDate(result.series, need);
  const stats = useMemo(() => goalPullStats(model, goal.need), [model, goal.need]);
  return (
    <div className="stats">
      <Stat
        label={`Цель: ${goal.title || needLabel(goal.need)}`}
        value={num(need)}
        sub={
          stats ? (
            <span data-testid="goal-stats">
              круток в худшем случае · медиана {num(stats.median)}, p90 {num(stats.p90)}
            </span>
          ) : (
            'круток в худшем случае'
          )
        }
      />
      <Stat
        label={gap > 0 ? 'Не хватает' : 'Запас'}
        value={
          <span data-testid="goal-gap" className={gap > 0 ? 'hot' : 'ok'}>
            {num(Math.abs(gap))}
          </span>
        }
        sub={gap > 0 ? 'круток к цели' : 'круток сверх цели'}
      />
      <Stat
        label="Дата достижения"
        value={<span data-testid="reach-date">{reach ? reach.split('-').reverse().join('.') : '—'}</span>}
        sub={reach ? 'худший случай набирается' : `не к ${date(goalTarget(model, goal), model.deviceOffset)}`}
      />
    </div>
  );
}

function TargetPicker({
  model,
  target,
  goals,
  goalId,
  onEditGoal,
}: {
  model: Model;
  target: ISO;
  goals: Goal[];
  goalId: string | null;
  onEditGoal: (g: Goal | 'new') => void;
}) {
  const upcoming = model.versions.filter((v) => ms(v.endDeadline) > ms(model.now)).slice(0, 4);
  const banners = model.banners.filter((b) => b.kind === 'character' && ms(b.end) > ms(model.now));
  const set = (t: ISO) => navigate(`${href('forecast')}?t=${encodeURIComponent(t)}`);
  return (
    <Card title="Цель прогноза">
      <div className="chip-row">
        {upcoming.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`tab ${!goalId && target === v.endDeadline ? 'tab-active' : ''}`}
            onClick={() => set(v.endDeadline)}
          >
            конец {v.id}
          </button>
        ))}
        {banners.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`tab ${!goalId && target === b.end ? 'tab-active' : ''}`}
            onClick={() => set(b.end)}
          >
            до конца: {b.featured5.join(' / ')}
          </button>
        ))}
      </div>
      <Field label="Или дата">
        <input
          className="input"
          type="date"
          aria-label="Дата прогноза"
          value={date(target, model.deviceOffset, 'yyyy-MM-dd')}
          onChange={(e) =>
            e.target.value &&
            set(`${e.target.value}T${String(23 - model.deviceOffset).padStart(2, '0')}:59:00Z`)
          }
        />
      </Field>
      <div>
        <div className="field-label">Цели</div>
        <div className="chip-row">
          {goals.map((g) => (
            <span key={g.id} className="stepper">
              <button
                type="button"
                className={`tab ${goalId === g.id ? 'tab-active' : ''}`}
                onClick={() => navigate(`${href('forecast')}?goal=${encodeURIComponent(g.id)}`)}
              >
                {g.title || needLabel(g.need)}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-label={`Изменить цель ${g.title}`}
                onClick={() => onEditGoal(g)}
              >
                ✎
              </button>
            </span>
          ))}
          <Button small onClick={() => onEditGoal('new')}>
            + цель
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ForecastChart({
  results,
  need,
}: {
  results: Record<Scenario, ForecastResult>;
  need: number | null;
}) {
  const colors = useCssVars(['--series-1', '--series-2', '--series-3', '--chart-grid', '--chart-axis']);
  const data = results.expected.series.map((p, i) => ({
    date: p.date,
    min: results.min.series[i]?.limitedPulls ?? null,
    expected: p.limitedPulls,
    max: results.max.series[i]?.limitedPulls ?? null,
  }));
  if (data.length < 2) return <Empty>Слишком короткий период для графика.</Empty>;
  const last = data.length - 1;
  // прямые подписи на концах линий (relief для бирюзового ниже 3:1 и идентичность не только цветом)
  const endLabel = (name: string) => (props: LabelProps) => {
    if (props.index !== last) return <g />;
    return (
      <text
        x={Number(props.x) - 4}
        y={Number(props.y) - 8}
        textAnchor="end"
        fontSize={11}
        fill={colors['--chart-axis']}
      >
        {name} {props.value}
      </text>
    );
  };
  return (
    <>
      <div className="legend" aria-hidden>
        {SCENARIOS.map((s) => (
          <span key={s.id}>
            <span className="legend-key" style={{ background: colors[s.color] }} />
            {s.label}
          </span>
        ))}
        {need !== null && (
          <span>
            <span className="legend-key dashed" />
            цель {need}
          </span>
        )}
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 18, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={colors['--chart-grid']} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: colors['--chart-axis'] }}
              tickFormatter={(d: string) => d.slice(8, 10) + '.' + d.slice(5, 7)}
              minTickGap={24}
              stroke={colors['--chart-grid']}
            />
            <YAxis
              tick={{ fontSize: 11, fill: colors['--chart-axis'] }}
              stroke={colors['--chart-grid']}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="chart-tip">
                    <div className="muted">{String(label).split('-').reverse().join('.')}</div>
                    {[...payload].reverse().map((p) => (
                      <div key={String(p.dataKey)}>
                        <span className="legend-key" style={{ background: p.color }} />
                        <b>{p.value as number}</b> {SCENARIOS.find((s) => s.id === p.dataKey)?.label}
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            {need !== null && (
              <ReferenceLine y={need} stroke={colors['--chart-axis']} strokeDasharray="4 3" />
            )}
            {SCENARIOS.map((s) => (
              <Line
                key={s.id}
                type="stepAfter"
                dataKey={s.id}
                stroke={colors[s.color]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                label={endLabel(s.label)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="small muted">Таблица</summary>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Дата</th>
                {SCENARIOS.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data
                .filter((_, i) => i % 7 === 0 || i === last)
                .map((d) => (
                  <tr key={d.date}>
                    <td>{d.date.split('-').reverse().join('.')}</td>
                    <td>{d.min}</td>
                    <td>{d.expected}</td>
                    <td>{d.max}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

type NeedKind = 'pulls' | 'char' | 'weapon' | 'both';

function GoalSheet({ model, goal, onClose }: { model: Model; goal: Goal | null; onClose: () => void }) {
  const actions = useActions();
  const banners = model.banners.filter((b) => ms(b.end) > ms(model.now));
  const initial = parseNeed(goal?.need);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [targetKind, setTargetKind] = useState<'date' | 'banner'>(goal?.target.kind ?? 'banner');
  const [at, setAt] = useState(
    goal?.target.kind === 'date' ? goal.target.at : (model.currentVersion?.endDeadline ?? model.now),
  );
  const [bannerId, setBannerId] = useState(
    goal?.target.kind === 'banner' ? goal.target.bannerId : (banners[0]?.id ?? ''),
  );
  const [point, setPoint] = useState<'start' | 'end'>(
    goal?.target.kind === 'banner' ? goal.target.point : 'end',
  );
  const [kind, setKind] = useState<NeedKind>(initial.kind);
  const [pulls, setPulls] = useState(initial.pulls);
  const [cons, setCons] = useState(initial.cons);
  const [refs, setRefs] = useState(initial.refs);

  const need: GoalNeed =
    kind === 'pulls'
      ? { kind: 'pulls', n: pulls }
      : kind === 'char'
        ? { kind: 'char5', copies: cons + 1 }
        : kind === 'weapon'
          ? { kind: 'weapon5', copies: refs }
          : {
              kind: 'sum',
              parts: [
                { kind: 'char5', copies: cons + 1 },
                { kind: 'weapon5', copies: refs },
              ],
            };

  const save = async () => {
    const id = goal?.id ?? `goal:${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const doc: Goal = {
      id,
      title: title.trim() || needLabel(need),
      target: targetKind === 'date' ? { kind: 'date', at } : { kind: 'banner', bannerId, point },
      need,
    };
    await actions.putDoc('goal', id, doc);
    onClose();
    navigate(`${href('forecast')}?goal=${encodeURIComponent(id)}`);
  };

  return (
    <Sheet open onClose={onClose} title={goal ? 'Цель' : 'Новая цель'}>
      <Field label="Название">
        <input
          className="input"
          aria-label="Название цели"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Скирк C2 + сигна"
        />
      </Field>
      <Field label="Что нужно">
        <select
          className="input"
          aria-label="Что нужно"
          value={kind}
          onChange={(e) => setKind(e.target.value as NeedKind)}
        >
          <option value="pulls">Число круток</option>
          <option value="char">Персонаж (созвездие)</option>
          <option value="weapon">Оружие (пробуждение)</option>
          <option value="both">Персонаж + оружие</option>
        </select>
      </Field>
      <div className="grid2">
        {kind === 'pulls' && (
          <Field label="Круток">
            <NumberInput
              aria-label="Круток нужно"
              value={pulls}
              min={1}
              onChange={(v) => setPulls(Math.max(1, Math.floor(v)))}
            />
          </Field>
        )}
        {(kind === 'char' || kind === 'both') && (
          <Field label="Созвездие C0–C6">
            <NumberInput
              aria-label="Созвездие"
              value={cons}
              min={0}
              max={6}
              onChange={(v) => setCons(Math.max(0, Math.min(6, Math.floor(v))))}
            />
          </Field>
        )}
        {(kind === 'weapon' || kind === 'both') && (
          <Field label="Пробуждение R1–R5">
            <NumberInput
              aria-label="Пробуждение"
              value={refs}
              min={1}
              max={5}
              onChange={(v) => setRefs(Math.max(1, Math.min(5, Math.floor(v))))}
            />
          </Field>
        )}
      </div>
      <Field label="К какому моменту">
        <select
          className="input"
          aria-label="Тип цели"
          value={targetKind}
          onChange={(e) => setTargetKind(e.target.value as 'date' | 'banner')}
        >
          <option value="banner">Баннер</option>
          <option value="date">Дата</option>
        </select>
      </Field>
      {targetKind === 'banner' ? (
        <div className="grid2">
          <Field label="Баннер">
            <select
              className="input"
              aria-label="Баннер цели"
              value={bannerId}
              onChange={(e) => setBannerId(e.target.value)}
            >
              {banners.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.versionId} {b.phase ? `ф${b.phase}` : ''} {b.kind === 'weapon' ? '⚔' : '★'}{' '}
                  {b.featured5.join(' / ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Момент">
            <select
              className="input"
              aria-label="Момент баннера"
              value={point}
              onChange={(e) => setPoint(e.target.value as 'start' | 'end')}
            >
              <option value="start">Начало</option>
              <option value="end">Конец</option>
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Дата">
          <input
            className="input"
            type="date"
            aria-label="Дата цели"
            value={date(at, model.deviceOffset, 'yyyy-MM-dd')}
            onChange={(e) =>
              e.target.value &&
              setAt(`${e.target.value}T${String(23 - model.deviceOffset).padStart(2, '0')}:59:00Z`)
            }
          />
        </Field>
      )}
      <p className="small muted">
        Худший случай сейчас: {num(goalNeedFor(model, need))} круток (pity из кошелька).
      </p>
      <div className="btn-row">
        <Button variant="primary" onClick={save}>
          Сохранить
        </Button>
        {goal && (
          <Button
            variant="danger"
            onClick={async () => {
              await actions.putDoc('goal', goal.id, null);
              onClose();
              navigate(href('forecast'));
            }}
          >
            Удалить
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function goalNeedFor(model: Model, need: GoalNeed): number {
  return goalNeed(model, { id: '', title: '', target: { kind: 'date', at: model.now }, need });
}

function parseNeed(need: GoalNeed | undefined): {
  kind: NeedKind;
  pulls: number;
  cons: number;
  refs: number;
} {
  const base = { kind: 'both' as NeedKind, pulls: 90, cons: 0, refs: 1 };
  if (!need) return base;
  if (need.kind === 'pulls') return { ...base, kind: 'pulls', pulls: need.n };
  if (need.kind === 'char5') return { ...base, kind: 'char', cons: need.copies - 1 };
  if (need.kind === 'weapon5') return { ...base, kind: 'weapon', refs: need.copies };
  const c = need.parts.find((p) => p.kind === 'char5');
  const w = need.parts.find((p) => p.kind === 'weapon5');
  return {
    ...base,
    cons: c && c.kind === 'char5' ? c.copies - 1 : 0,
    refs: w && w.kind === 'weapon5' ? w.copies : 1,
  };
}
