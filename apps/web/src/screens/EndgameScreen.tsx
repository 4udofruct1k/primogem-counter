// «Эндгейм» (раздел 12): бездна по звёздам, театр по актам и арканам, натиск по сложности; история; ожидания.
import {
  abyssCyclePrimo,
  abyssFloorPrimo,
  ms,
  stygianPrimo,
  theaterMaxActs,
  theaterMaxArcana,
  theaterPrimo,
  type ExpectationMode,
  type Occurrence,
  type TheaterDifficulty,
} from '@primo/domain';
import type { DocOf } from '@primo/shared';
import { useActions, useApp, useModel } from '../state/context';
import type { Model } from '../state/model';
import { Badge, Button, Card, Field, NumberInput } from '../ui/components';
import { dateTime, num, rewardText, untilText } from '../ui/format';

type Stars = [number, number, number][];
const EMPTY_STARS: Stars = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

/** Текущий цикл трекера (идёт сейчас) или ближайший будущий. */
function currentCycle(model: Model, ruleId: string): Occurrence | undefined {
  const now = ms(model.now);
  const list = model.occurrences.filter((o) => o.ruleId === ruleId).sort((a, b) => ms(a.from) - ms(b.from));
  return (
    list.find((o) => ms(o.from) <= now && (!o.deadline || now < ms(o.deadline))) ??
    list.find((o) => ms(o.from) > now)
  );
}

function pastCycles(model: Model, ruleId: string): Occurrence[] {
  return model.trackerHistory
    .filter((o) => o.ruleId === ruleId)
    .sort((a, b) => ms(b.from) - ms(a.from))
    .slice(0, 6);
}

export function EndgameScreen() {
  const model = useModel();
  if (!model) return null;
  return (
    <>
      <AbyssCard model={model} />
      <TheaterCard model={model} />
      <StygianCard model={model} />
      <ExpectationsCard model={model} />
    </>
  );
}

function CycleHeader({ model, occ, sum }: { model: Model; occ: Occurrence; sum: number }) {
  const actions = useActions();
  const started = ms(occ.from) <= ms(model.now);
  return (
    <div className="btn-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="small muted">
        {started ? 'до сброса' : 'начнётся'}{' '}
        {untilText(started && occ.deadline ? occ.deadline : occ.from, model.now)} · {dateTime(occ.from)} →{' '}
        {dateTime(occ.deadline)}
      </span>
      {occ.status === 'claimed' ? (
        <Button small variant="ghost" onClick={() => actions.setStatus(model, occ, 'planned')}>
          ✓ забрано · вернуть
        </Button>
      ) : (
        <Button
          small
          variant="primary"
          disabled={!started}
          onClick={() => actions.claim(model, occ, { primo: sum })}
        >
          Забрал {num(sum)}
        </Button>
      )}
    </div>
  );
}

function AbyssCard({ model }: { model: Model }) {
  const actions = useActions();
  const docs = useApp((s) => s.docs.abyss);
  const occ = currentCycle(model, 'abyss');
  if (!occ) return null;
  const doc: DocOf<'abyss'> = docs[occ.id] ?? { id: occ.id, stars: EMPTY_STARS, claimed: false };
  const cfg = model.seed.endgame;
  const sum = abyssCyclePrimo(doc, cfg);
  const save = (stars: Stars) =>
    actions.saveTracker(model, 'abyss', { ...doc, stars }, (d) => (d ? abyssCyclePrimo(d, cfg) : 0));
  const tap = (f: number, c: number) => {
    const stars = doc.stars.map((row) => [...row]) as Stars;
    stars[f]![c] = (stars[f]![c]! + 1) % 4;
    return save(stars);
  };
  return (
    <Card
      title={
        <>
          Витая бездна <span className="muted small">· этажи 9–12</span>
        </>
      }
      actions={<b data-testid="abyss-sum">{num(sum)}</b>}
    >
      <CycleHeader model={model} occ={occ} sum={sum} />
      <div className="table-wrap">
        <table className="tbl">
          <tbody>
            {doc.stars.map((row, f) => {
              const floorStars = row.reduce((a, b) => a + b, 0);
              return (
                <tr key={f}>
                  <th>Этаж {cfg.abyss.floors[f]}</th>
                  {row.map((st, c) => (
                    <td key={c}>
                      <button
                        type="button"
                        className="btn btn-small"
                        aria-label={`Этаж ${cfg.abyss.floors[f]}, зал ${c + 1}`}
                        onClick={() => tap(f, c)}
                        style={{ minWidth: 64 }}
                      >
                        {'★'.repeat(st)}
                        <span className="muted">{'☆'.repeat(3 - st)}</span>
                      </button>
                    </td>
                  ))}
                  <td className="num">
                    {floorStars}★ → {abyssFloorPrimo(floorStars, cfg)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <Button small onClick={() => save(EMPTY_STARS.map(() => [3, 3, 3]) as Stars)}>
          Все 36★
        </Button>
        <Button small variant="ghost" onClick={() => save(EMPTY_STARS)}>
          Сбросить
        </Button>
      </div>
      <p className="hint">
        3★ → 50, 6★ → 50, 9★ → 100 за этаж. С 5.1 полные звёзды 9–10 этажа засчитываются, если 11–12 закрыты
        на 9★. Незабранное к сбросу сгорает.
      </p>
      <History model={model} ruleId="abyss" />
    </Card>
  );
}

const DIFFICULTY_LABEL: Record<TheaterDifficulty, string> = {
  easy: 'Лёгкая',
  normal: 'Обычная',
  hard: 'Сложная',
  visionary: 'Визионер',
  lunar: 'Лунный режим',
};

function TheaterCard({ model }: { model: Model }) {
  const actions = useActions();
  const docs = useApp((s) => s.docs.theater);
  const occ = currentCycle(model, 'theater');
  if (!occ) return null;
  const cfg = model.seed.endgame;
  const doc: DocOf<'theater'> = docs[occ.id] ?? {
    id: occ.id,
    difficulty: 'visionary',
    acts: 0,
    arcana: 0,
    claimed: false,
  };
  const sum = theaterPrimo(doc, cfg);
  const maxActs = theaterMaxActs(doc.difficulty, cfg);
  const maxArcana = theaterMaxArcana(doc.difficulty, cfg);
  const save = (next: DocOf<'theater'>) =>
    actions.saveTracker(model, 'theater', next, (d) => (d ? theaterPrimo(d, cfg) : 0));
  return (
    <Card title="Театр «Воображариум»" actions={<b data-testid="theater-sum">{num(sum)}</b>}>
      <CycleHeader model={model} occ={occ} sum={sum} />
      <Field label="Сложность">
        <select
          className="input"
          aria-label="Сложность театра"
          value={doc.difficulty}
          onChange={(e) => {
            const difficulty = e.target.value as TheaterDifficulty;
            void save({
              ...doc,
              difficulty,
              acts: Math.min(doc.acts, theaterMaxActs(difficulty, cfg)),
              arcana: Math.min(doc.arcana, theaterMaxArcana(difficulty, cfg)),
            });
          }}
        >
          {cfg.theater.difficulties.map((d) => (
            <option key={d.id} value={d.id}>
              {DIFFICULTY_LABEL[d.id]} — {d.acts} актов{d.arcana ? ` + ${d.arcana} арканы` : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="chip-row" role="group" aria-label="Акты">
        {Array.from({ length: maxActs }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`tab ${i < doc.acts ? 'tab-active' : ''}`}
            aria-label={`Акт ${i + 1}`}
            onClick={() => save({ ...doc, acts: doc.acts === i + 1 ? i : i + 1 })}
          >
            {i + 1} · {cfg.theater.acts[i]}
          </button>
        ))}
      </div>
      {maxArcana > 0 && (
        <div className="chip-row" role="group" aria-label="Арканы">
          {Array.from({ length: maxArcana }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`tab ${i < doc.arcana ? 'tab-active' : ''}`}
              aria-label={`Аркана ${i + 1}`}
              onClick={() => save({ ...doc, arcana: doc.arcana === i + 1 ? i : i + 1 })}
            >
              Аркана {i + 1} · {cfg.theater.arcana[i]}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        Тап по акту N — пройдены акты 1…N.{' '}
        {cfg.theater.difficulties.find((d) => d.id === doc.difficulty)?.note ?? ''}
      </p>
      <History model={model} ruleId="theater" />
    </Card>
  );
}

function StygianCard({ model }: { model: Model }) {
  const actions = useActions();
  const docs = useApp((s) => s.docs.stygian);
  const occ = currentCycle(model, 'stygian');
  if (!occ) return null;
  const cfg = model.seed.endgame;
  const doc: DocOf<'stygian'> = docs[occ.id] ?? { id: occ.id, maxDifficulty: 0, claimed: false };
  const sum = stygianPrimo(doc.maxDifficulty, cfg);
  return (
    <Card title={`Натиск · ${occ.versionId ?? ''}`} actions={<b data-testid="stygian-sum">{num(sum)}</b>}>
      <CycleHeader model={model} occ={occ} sum={sum} />
      <Field label="Максимальная пройденная сложность">
        <select
          className="input"
          aria-label="Сложность натиска"
          value={doc.maxDifficulty}
          onChange={(e) =>
            actions.saveTracker(
              model,
              'stygian',
              { ...doc, maxDifficulty: Number(e.target.value) as DocOf<'stygian'>['maxDifficulty'] },
              (d) => (d ? stygianPrimo(d.maxDifficulty, cfg) : 0),
            )
          }
        >
          <option value={0}>Не проходил</option>
          {cfg.stygian.difficulties.map((d) => (
            <option key={d.level} value={d.level}>
              {d.name} ({d.primo ? `+${d.primo}` : 'без примогемов'})
            </option>
          ))}
        </select>
      </Field>
      <p className="hint">Normal / Advancing / Hard — по 150 накопительно, выше — без примогемов.</p>
      <History model={model} ruleId="stygian" />
    </Card>
  );
}

function History({ model, ruleId }: { model: Model; ruleId: string }) {
  const past = pastCycles(model, ruleId);
  if (past.length === 0) return null;
  return (
    <details>
      <summary className="small muted">История</summary>
      <ul className="list">
        {past.map((o) => (
          <li key={o.id} className="row">
            <span className="row-main small">{o.id}</span>
            <span className="row-amount small">{num(model.trackerSums[o.id] ?? 0)}</span>
            <Badge tone={o.status === 'claimed' ? 'ok' : o.status === 'missed' ? 'hot' : 'neutral'}>
              {o.status === 'claimed' ? 'забрано' : o.status === 'missed' ? 'сгорело' : o.status}
            </Badge>
          </li>
        ))}
      </ul>
    </details>
  );
}

const MODES: [ExpectationMode['mode'], string][] = [
  ['pack', 'Из данных'],
  ['max', 'Максимум'],
  ['last', 'Как в прошлый раз'],
  ['avg3', 'Среднее за 3 цикла'],
  ['manual', 'Своё число'],
];

function ExpectationsCard({ model }: { model: Model }) {
  const actions = useActions();
  const rules = model.rules.filter((r) => r.tracker && r.tracker !== 'hoyolab');
  return (
    <Card title="Ожидания для прогноза">
      <p className="small muted">
        «Ожидаемо» берёт ожидание, «Минимум» — минимум (из 3 последних циклов или вручную), «Максимум» —
        номинал.
      </p>
      {rules.map((r) => {
        const mode = (model.settings.expectations[r.id] as ExpectationMode | undefined) ?? {
          mode: 'pack' as const,
        };
        const exp = model.expectations[r.id];
        const save = (next: Partial<ExpectationMode> & { mode: ExpectationMode['mode'] }) =>
          actions.saveSettings({
            expectations: { ...model.settings.expectations, [r.id]: { ...mode, ...next } as never },
          });
        return (
          <div key={r.id} className="grid2">
            <Field
              label={r.title}
              hint={
                exp
                  ? `ожидание ${rewardText(exp.expected)} · минимум ${rewardText(exp.expectedMin)}`
                  : undefined
              }
            >
              <select
                className="input"
                aria-label={`Ожидание: ${r.title}`}
                value={mode.mode}
                onChange={(e) => save({ mode: e.target.value as ExpectationMode['mode'] })}
              >
                {MODES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {mode.mode === 'manual' && (
              <Field label="Ожидание, примогемов">
                <NumberInput
                  aria-label={`Ожидание вручную: ${r.title}`}
                  value={'primo' in mode ? (mode.primo ?? 0) : 0}
                  min={0}
                  onChange={(v) => save({ mode: 'manual', primo: Math.max(0, v) } as never)}
                />
              </Field>
            )}
            <Field label="Минимум">
              <select
                className="input"
                aria-label={`Минимум: ${r.title}`}
                value={typeof mode.min === 'number' ? 'manual' : (mode.min ?? 'pack')}
                onChange={(e) =>
                  save({
                    mode: mode.mode,
                    min:
                      e.target.value === 'manual'
                        ? (exp?.expectedMin.primo ?? 0)
                        : (e.target.value as 'pack' | 'min3'),
                  } as never)
                }
              >
                <option value="pack">Из данных</option>
                <option value="min3">Минимум из 3 циклов</option>
                <option value="manual">Своё число</option>
              </select>
            </Field>
            {typeof mode.min === 'number' && (
              <Field label="Минимум, примогемов">
                <NumberInput
                  aria-label={`Минимум вручную: ${r.title}`}
                  value={mode.min}
                  min={0}
                  onChange={(v) => save({ mode: mode.mode, min: Math.max(0, v) } as never)}
                />
              </Field>
            )}
          </div>
        );
      })}
    </Card>
  );
}
