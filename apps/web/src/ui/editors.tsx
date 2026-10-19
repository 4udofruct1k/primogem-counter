// Редакторы категорий (11.2): сундуки, сумма, количество, уровни, чек-лист, галочка.
import {
  addAmount,
  addChest,
  categorySummary,
  chestButtons,
  clampLevel,
  effectiveProgress,
  levelCap,
  levelKeys,
  levelTable,
  maxLevel,
  points,
  setCount,
  setDone,
  setLevel,
  toggleItem,
  undoLastChest,
  type Area,
  type CalcContext,
  type Calculable,
  type CategoryProgress,
  type ChestVariant,
  type Flags,
  type ISO,
  type Reward,
} from '@primo/domain';
import { useState } from 'react';
import { Badge, Button, ConfidenceBadge, NumberInput, Stepper } from './components';
import { num, rewardText } from './format';

export interface EditorProps {
  cat: Calculable;
  area: Pick<Area, 'chestBracket'> | null;
  progress: CategoryProgress | undefined;
  flags: Flags;
  ctx: CalcContext;
  now: () => ISO;
  onSave: (next: CategoryProgress) => void;
}

const blank = (cat: Calculable, at: ISO): CategoryProgress => ({ categoryId: cat.id, updatedAt: at });

export function CategoryCard(props: EditorProps & { onRename?: () => void; onHide?: () => void }) {
  const { cat, progress, flags, ctx } = props;
  const s = categorySummary(cat, progress, flags, ctx);
  const total = s.total;
  return (
    <section className="card" data-testid={`cat-${cat.id}`}>
      <header className="card-head">
        <h3>
          {cat.title} <ConfidenceBadge c={cat.confidence} />
        </h3>
        <div className="row-amount" data-testid={`collected-${cat.id}`}>
          {rewardText(s.collected, '0')} <span className="muted">/ {total ? rewardText(total) : '?'}</span>
        </div>
      </header>
      {s.overTotal && (
        <p className="warn">Больше итога из данных — проверьте ввод (данные видео могут быть неполными).</p>
      )}
      {s.unknown && <p className="muted small">Итог неизвестен — в прогнозе 0, в блоке «не учтено».</p>}
      {Object.keys(s.later).length > 0 && (
        <p className="muted small">
          Откроется позже: {rewardText(s.later)}
          {cat.maxLevelNowNote ? ` (${cat.maxLevelNowNote})` : ''}
        </p>
      )}
      <div className="small muted">
        Осталось: <b data-testid={`remaining-${cat.id}`}>{rewardText(s.remaining, '0')}</b>
      </div>
      <Editor {...props} />
      {cat.note && <p className="hint">{cat.note}</p>}
      {(props.onRename || props.onHide) && (
        <div className="btn-row">
          {props.onRename && (
            <Button small variant="ghost" onClick={props.onRename}>
              Переименовать
            </Button>
          )}
          {props.onHide && (
            <Button small variant="ghost" onClick={props.onHide}>
              Убрать категорию
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Editor(props: EditorProps) {
  switch (props.cat.editor) {
    case 'chests':
      return <ChestsEditor {...props} />;
    case 'amount':
      return <AmountEditor {...props} />;
    case 'count':
      return <CountEditor {...props} />;
    case 'level':
      return <LevelEditor {...props} />;
    case 'checklist':
      return <ChecklistEditor {...props} />;
    case 'binary':
      return <BinaryEditor {...props} />;
  }
}

function ChestsEditor({ cat, area, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const bracket = area?.chestBracket ?? 'high';
  const known = cat.chestCounts;
  const click = (typeId: string, variant: ChestVariant, delta: 1 | -1) => {
    const type = ctx.chestTypes.find((t) => t.id === typeId)!;
    onSave(addChest(p, { chestBracket: bracket }, type, variant, delta, now()));
  };
  return (
    <div>
      {flags.chests100 && (
        <p className="small ok">«Сундуки 100%»: собрано = итогу; счётчики ниже сохраняются.</p>
      )}
      <ul className="list">
        {ctx.chestTypes.map((type) => {
          const counts = p.chestCounts?.[type.id] ?? {};
          const opened = Object.values(counts).reduce((a, b) => a + b, 0);
          const knownCount = known?.[type.id as keyof typeof known];
          return (
            <li key={type.id} className="row" style={{ flexWrap: 'wrap' }}>
              <div className="row-main">
                <div className="row-title">{type.name}</div>
                <div className="row-sub">
                  открыто {opened}
                  {typeof knownCount === 'number' ? ` / известно ${knownCount} на ${known!.asOf}` : ''}
                </div>
              </div>
              <div className="btn-row">
                {chestButtons(type, bracket).map((b) => {
                  const key = String(b.variant);
                  const label = `${type.name} ${typeof b.variant === 'number' ? '' : `${b.variant} `}+${b.price}`;
                  return (
                    <span key={key} className="stepper">
                      <button
                        type="button"
                        className="btn btn-small"
                        aria-label={`${label} −`}
                        disabled={!counts[key]}
                        onClick={() => click(type.id, b.variant, -1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        aria-label={label}
                        onClick={() => click(type.id, b.variant, 1)}
                      >
                        +{b.price} <span className="muted">×{counts[key] ?? 0}</span>
                      </button>
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <Button small disabled={!p.chestLog?.length} onClick={() => onSave(undoLastChest(p, now()))}>
        Отменить последнее
      </Button>
      {known && <p className="hint">Числа сундуков — справочно ({known.source}), не лимит.</p>}
    </div>
  );
}

function AmountEditor({ cat, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const eff = effectiveProgress(cat, progress, flags, ctx);
  const [custom, setCustom] = useState(0);
  const currencies = (['primo', 'if', 'af'] as const).filter((c) => c === 'primo' || cat.total?.[c]);
  const add = (delta: Reward) => onSave(addAmount(p, delta, now()));
  const quick = cat.quick ?? [10, 20, 30, 40, 50, 60];
  return (
    <div className="grid2" style={{ gridTemplateColumns: '1fr' }}>
      <div className="chip-row">
        {quick.map((q) => (
          <Button
            key={q}
            small
            disabled={flags.closed}
            onClick={() => add({ primo: q })}
            aria-label={`${cat.title} +${q}`}
          >
            +{q}
          </Button>
        ))}
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <NumberInput aria-label={`${cat.title}: своё число`} value={custom} onChange={setCustom} />
        <Button small disabled={flags.closed || !custom} onClick={() => add({ primo: custom })}>
          Добавить
        </Button>
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        {currencies.map((c) => (
          <label key={c} className="field" style={{ maxWidth: 160 }}>
            <span className="field-label">{c === 'primo' ? 'Всего примогемов' : c.toUpperCase()}</span>
            <NumberInput
              aria-label={`${cat.title}: ${c === 'primo' ? 'всего' : c.toUpperCase()}`}
              value={eff.amount?.[c] ?? 0}
              min={0}
              onChange={(v) =>
                onSave({ ...p, amount: { ...p.amount, [c]: Math.max(0, v) }, updatedAt: now() })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function CountEditor({ cat, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const eff = effectiveProgress(cat, progress, flags, ctx);
  return (
    <Stepper
      label={cat.title}
      value={eff.count ?? 0}
      max={cat.count ?? undefined}
      onChange={(v) => !flags.closed && onSave(setCount(p, cat, v, now()))}
    />
  );
}

function LevelEditor({ cat, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const eff = effectiveProgress(cat, progress, flags, ctx);
  const rows = levelTable(cat, ctx);
  const cap = levelCap(cat, ctx);
  const max = maxLevel(cat, ctx);
  const n = points(cat);
  const levels = Array.from({ length: n }, (_, i) => eff.levels?.[i] ?? 0);
  const keys = levelKeys(cat, progress, flags, ctx);
  const [showTable, setShowTable] = useState(false);
  const shown = rows.filter((r) => r.primo || r.af || r.if || r.key || r.req);
  return (
    <div>
      <div className="grid2">
        {levels.map((lvl, i) => (
          <div key={i} className="btn-row" style={{ alignItems: 'center' }}>
            {n > 1 && <span className="muted small">Точка {i + 1}</span>}
            <Stepper
              label={n > 1 ? `${cat.title} ${i + 1}` : cat.title}
              value={lvl}
              max={cap}
              onChange={(v) =>
                !flags.closed && onSave(setLevel(p, cat, i, clampLevel(cat, v, ctx), ctx, now()))
              }
            />
            {max > 12 && (
              <NumberInput
                aria-label={`${cat.title}${n > 1 ? ` ${i + 1}` : ''}: уровень`}
                value={lvl}
                min={0}
                max={cap}
                onChange={(v) => !flags.closed && onSave(setLevel(p, cat, i, v, ctx, now()))}
              />
            )}
          </div>
        ))}
      </div>
      {cap < max && (
        <p className="small muted">
          Доступно до ур. {cap} из {max}
          {cat.maxLevelNowNote ? ` — ${cat.maxLevelNowNote}` : ''}
        </p>
      )}
      {keys > 0 && <p className="small muted">Ключей усыпальниц: {keys} (справочно)</p>}
      <Button small variant="ghost" onClick={() => setShowTable(!showTable)}>
        {showTable ? 'Скрыть таблицу уровней' : 'Таблица уровней'}
      </Button>
      {showTable && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Ур.</th>
                <th>Примо</th>
                <th>IF</th>
                <th>AF</th>
                <th>Ключ</th>
                {shown.some((r) => r.req) && <th>Порог</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const passed = levels.some((l) => l >= r.level);
                const next = !passed && levels.some((l) => l + 1 === r.level);
                return (
                  <tr
                    key={r.level}
                    className={r.level > cap ? 'locked' : passed ? 'passed' : next ? 'next' : ''}
                  >
                    <td>{r.level}</td>
                    <td>{r.primo ? num(r.primo) : ''}</td>
                    <td>{r.if ?? ''}</td>
                    <td>{r.af ?? ''}</td>
                    <td>{r.key ?? ''}</td>
                    {shown.some((x) => x.req) && <td>{r.req ? num(r.req) : ''}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cap < max && (
            <p className="hint">
              Серым — уровни выше доступного сейчас{cat.maxLevelNowNote ? ` (${cat.maxLevelNowNote})` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistEditor({ cat, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const eff = effectiveProgress(cat, progress, flags, ctx);
  const checked = new Set(eff.checked ?? []);
  if (!cat.items?.length) return <Badge>нет списка</Badge>;
  return (
    <ul className="list">
      {cat.items.map((item) => (
        <li key={item} className="row">
          <label className="toggle" style={{ flex: 1 }}>
            <input
              type="checkbox"
              checked={checked.has(item)}
              disabled={flags.closed}
              onChange={() => onSave(toggleItem(p, item, now()))}
              aria-label={item}
            />
            <span className="toggle-text">{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function BinaryEditor({ cat, progress, flags, ctx, now, onSave }: EditorProps) {
  const p = progress ?? blank(cat, now());
  const eff = effectiveProgress(cat, progress, flags, ctx);
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={!!eff.done}
        disabled={flags.closed}
        onChange={(e) => onSave(setDone(p, e.target.checked, now()))}
        aria-label={`${cat.title}: выполнено`}
      />
      <span className="toggle-text">Выполнено</span>
    </label>
  );
}
