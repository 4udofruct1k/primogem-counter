// «Регионы» (10.6, раздел 11): список регионов, вкладки областей, редакторы, флаги, общие источники.
import {
  areaFlags,
  areaSummary,
  categorySummary,
  regionSummary,
  type Area,
  type AreaPlan,
  type AreaState,
  type CategoryProgress,
  type Region,
  type Reward,
} from '@primo/domain';
import { useState } from 'react';
import { useActions, useApp, useModel, useStoreApi } from '../state/context';
import type { Model } from '../state/model';
import { newUserEntityId, type UserAreaData, type UserCategoryData } from '../state/seedCustom';
import { Badge, Button, Card, Field, NumberInput, Progress, Sheet, Tabs, Toggle } from '../ui/components';
import { CategoryCard } from '../ui/editors';
import { date, rewardText } from '../ui/format';
import { href, navigate, useRoute } from '../ui/router';

export function RegionsScreen() {
  const route = useRoute();
  const model = useModel();
  if (!model) return null;
  const regionId = route.path[1];
  if (regionId === 'general') return <GeneralSources model={model} />;
  const region = regionId ? model.seed.regions.find((r) => r.id === regionId) : undefined;
  if (region) return <RegionView model={model} region={region} areaId={route.query.get('area')} />;
  return <RegionList model={model} />;
}

function useProgress() {
  return useApp((s) => s.docs.cat_progress) as Record<string, CategoryProgress>;
}
function useAreaStates() {
  return useApp((s) => s.docs.area_state) as Record<string, AreaState>;
}
function useRegionStates() {
  return useApp((s) => s.docs.region_state);
}

const primoAndFates = (r: Reward) => rewardText({ primo: r.primo ?? 0, if: r.if, af: r.af }, '0');

function RegionList({ model }: { model: Model }) {
  const progress = useProgress();
  const areaStates = useAreaStates();
  const regionStates = useRegionStates();
  const summaries = model.seed.regions.map((r) => ({
    region: r,
    s: regionSummary(r, progress, areaStates, regionStates[r.id]?.closed ?? false, model.calc),
  }));
  const general = model.seed.general.map((g) =>
    categorySummary(g, progress[g.id], areaFlags(areaStates[g.id], false), model.calc),
  );
  const generalTotal = general.reduce((a, s) => a + (s.total?.primo ?? 0), 0);
  const generalCollected = general.reduce((a, s) => a + (s.collected.primo ?? 0), 0);

  return (
    <>
      <Card title="Регионы">
        <ul className="list">
          {summaries.map(({ region, s }) => {
            const total = s.total.primo ?? 0;
            const got = Math.min(total, s.collected.primo ?? 0);
            return (
              <li key={region.id} className="row" style={{ display: 'grid', gap: 4 }}>
                <a
                  href={href('regions', region.id)}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  data-testid={`region-${region.id}`}
                >
                  <div className="row-title">
                    {region.name} {s.complete && <Badge tone="ok">на 100%</Badge>}
                  </div>
                  <div className="row-sub">
                    {region.areas.map((a) => {
                      const closed = s.areas.find((x) => x.id === a.id)?.closed;
                      return (
                        <span key={a.id} style={{ marginRight: 8 }}>
                          {closed ? '✓ ' : ''}
                          {a.name}
                        </span>
                      );
                    })}
                  </div>
                  <Progress value={got} max={total} />
                  <div className="row-sub">
                    осталось <b>{primoAndFates(s.remaining)}</b>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Общие источники" actions={<a href={href('regions', 'general')}>Открыть →</a>}>
        <Progress value={generalCollected} max={generalTotal} />
        <p className="small muted">
          Ранг приключений, задания архонтов и легенд, достижения, чайник, ККИ и другое.
        </p>
      </Card>
      {model.orphans.length > 0 && (
        <Card title="Устаревшие категории">
          <p className="small muted">
            Прогресс по категориям, которых больше нет в игровых данных — сохранён, в расчёт не входит.
          </p>
          <ul className="list">
            {model.orphans.map((id) => (
              <li key={id} className="row">
                <span className="row-title">{id}</span> <Badge tone="warn">устарела</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function RegionView({ model, region, areaId }: { model: Model; region: Region; areaId: string | null }) {
  const actions = useActions();
  const regionStates = useRegionStates();
  const regionClosed = regionStates[region.id]?.closed ?? false;
  const [addArea, setAddArea] = useState(false);
  const area = region.areas.find((a) => a.id === areaId) ?? region.areas[0];
  return (
    <>
      <div className="btn-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <a href={href('regions')}>← Регионы</a>
        <Toggle
          checked={regionClosed}
          onChange={(v) => actions.setRegionClosed(model, region, v)}
          label={<b>Регион закрыт</b>}
        />
      </div>
      <h1>{region.name}</h1>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        {region.areas.length > 0 && (
          <Tabs
            value={area?.id ?? ''}
            onChange={(id) => navigate(`${href('regions', region.id)}?area=${encodeURIComponent(id)}`)}
            items={region.areas.map((a) => ({ id: a.id, label: a.name }))}
          />
        )}
        <Button small variant="ghost" onClick={() => setAddArea(true)}>
          + область
        </Button>
      </div>
      {area ? (
        <AreaView model={model} region={region} area={area} regionClosed={regionClosed} />
      ) : (
        <p className="muted">Областей нет — добавьте свою.</p>
      )}
      {addArea && <AddAreaSheet region={region} onClose={() => setAddArea(false)} />}
    </>
  );
}

function AreaView({
  model,
  region,
  area,
  regionClosed,
}: {
  model: Model;
  region: Region;
  area: Area;
  regionClosed: boolean;
}) {
  const actions = useActions();
  const store = useStoreApi();
  const progress = useProgress();
  const areaStates = useAreaStates();
  const state = areaStates[area.id];
  const ctx = model.ctxForArea(area.id);
  const s = areaSummary(area, progress, state, regionClosed, ctx);
  const flags = areaFlags(state, regionClosed);
  const [addCat, setAddCat] = useState(false);
  const [rename, setRename] = useState<{
    entity: 'area' | 'category';
    id: string;
    field: string;
    value: string;
  } | null>(null);
  const [prices, setPrices] = useState(false);
  const now = () => store.deps.clock().toISOString();
  const current: AreaState = state ?? {
    areaId: area.id,
    chests100: false,
    closed: false,
    plan: { kind: 'none' },
  };
  const saveState = (next: AreaState) =>
    actions.saveAreaState(model, { id: area.id, categories: area.categories, regionId: region.id }, next);
  const hasChests = area.categories.some((c) => c.editor === 'chests');

  return (
    <>
      <Card
        title={
          <>
            {area.name} {area.addedIn && <Badge>с {area.addedIn}</Badge>}{' '}
            {s.badge && <Badge tone="warn">сумма строк ≠ итог видео</Badge>}
          </>
        }
      >
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Собрано</div>
            <div className="stat-value" data-testid="area-collected">
              {primoAndFates(s.collected)}
            </div>
            <div className="stat-sub">из {primoAndFates(s.total)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Осталось</div>
            <div className="stat-value" data-testid="area-remaining">
              {primoAndFates(s.remaining)}
            </div>
            {Object.keys(s.later).length > 0 && (
              <div className="stat-sub">откроется позже {rewardText(s.later)}</div>
            )}
          </div>
        </div>
        {area.note && <p className="hint">{area.note}</p>}
        <div className="btn-row">
          {hasChests && (
            <Toggle
              checked={current.chests100}
              onChange={(v) => saveState({ ...current, chests100: v })}
              label="Сундуки 100%"
            />
          )}
          <Toggle
            checked={current.closed || regionClosed}
            onChange={(v) => saveState({ ...current, closed: v })}
            label="Область закрыта"
            hint={regionClosed ? 'закрыт весь регион' : undefined}
          />
        </div>
        <PlanEditor
          plan={current.plan}
          onChange={(plan) => saveState({ ...current, plan })}
          offset={model.deviceOffset}
        />
        <div className="btn-row">
          <Button small variant="ghost" onClick={() => setAddCat(true)}>
            + категория
          </Button>
          <Button
            small
            variant="ghost"
            onClick={() => setRename({ entity: 'area', id: area.id, field: 'name', value: area.name })}
          >
            Переименовать область
          </Button>
          {hasChests && (
            <Button small variant="ghost" onClick={() => setPrices(true)}>
              Цены сундуков
            </Button>
          )}
        </div>
      </Card>
      {area.categories.map((cat) => (
        <CategoryCard
          key={cat.id}
          cat={cat}
          area={area}
          progress={progress[cat.id]}
          flags={flags}
          ctx={ctx}
          now={now}
          onSave={(next) => actions.saveProgress(model, cat, area, next)}
          onRename={() => setRename({ entity: 'category', id: cat.id, field: 'title', value: cat.title })}
          onHide={() =>
            actions.putDoc('override', `category:${cat.id}:hidden`, {
              entity: 'category',
              id: cat.id,
              field: 'hidden',
              value: true,
              at: now(),
            })
          }
        />
      ))}
      {addCat && <AddCategorySheet areaId={area.id} onClose={() => setAddCat(false)} />}
      {rename && <RenameSheet value={rename} onClose={() => setRename(null)} />}
      {prices && <ChestPricesSheet model={model} areaId={area.id} onClose={() => setPrices(false)} />}
    </>
  );
}

function PlanEditor({
  plan,
  onChange,
  offset,
}: {
  plan: AreaPlan;
  onChange: (p: AreaPlan) => void;
  offset: number;
}) {
  return (
    <div className="grid2">
      <Field label="План в прогнозе" hint="Учитывается в «Ожидаемо» и «Максимум»">
        <select
          className="input"
          aria-label="План в прогнозе"
          value={plan.kind}
          onChange={(e) => {
            const kind = e.target.value as AreaPlan['kind'];
            onChange(
              kind === 'byDate'
                ? {
                    kind,
                    at: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) + 'T12:00:00Z',
                  }
                : { kind },
            );
          }}
        >
          <option value="none">Не планирую (только «осталось в игре»)</option>
          <option value="byDate">Пройду к дате</option>
          <option value="rate">Темпом из настроек</option>
        </select>
      </Field>
      {plan.kind === 'byDate' && (
        <Field label="Дата" hint={date(plan.at, offset)}>
          <input
            className="input"
            type="date"
            aria-label="Дата плана"
            value={plan.at.slice(0, 10)}
            onChange={(e) =>
              e.target.value && onChange({ kind: 'byDate', at: `${e.target.value}T12:00:00Z` })
            }
          />
        </Field>
      )}
    </div>
  );
}

function GeneralSources({ model }: { model: Model }) {
  const actions = useActions();
  const store = useStoreApi();
  const progress = useProgress();
  const areaStates = useAreaStates();
  const now = () => store.deps.clock().toISOString();
  return (
    <>
      <a href={href('regions')}>← Регионы</a>
      <h1>Общие источники</h1>
      {model.seed.general.map((g) => {
        const state = areaStates[g.id] ?? {
          areaId: g.id,
          chests100: false,
          closed: false,
          plan: { kind: 'none' as const },
        };
        return (
          <div key={g.id} style={{ display: 'grid', gap: 6 }}>
            <CategoryCard
              cat={g}
              area={null}
              progress={progress[g.id]}
              flags={areaFlags(state, false)}
              ctx={model.calc}
              now={now}
              onSave={(next) => actions.saveProgress(model, g, null, next)}
            />
            <PlanEditor
              plan={state.plan}
              offset={model.deviceOffset}
              onChange={(plan) =>
                actions.saveAreaState(model, { id: g.id, categories: [g] }, { ...state, plan })
              }
            />
          </div>
        );
      })}
    </>
  );
}

function AddAreaSheet({ region, onClose }: { region: Region; onClose: () => void }) {
  const actions = useActions();
  const [name, setName] = useState('');
  return (
    <Sheet open onClose={onClose} title={`Новая область — ${region.name}`}>
      <Field label="Название">
        <input
          className="input"
          aria-label="Название области"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Button
        variant="primary"
        disabled={!name.trim()}
        onClick={async () => {
          const data: UserAreaData = { regionId: region.id, name: name.trim(), chestBracket: 'high' };
          const id = newUserEntityId('area', region.id);
          await actions.putDoc('user_entity', id, {
            id,
            kind: 'area',
            data: data as unknown as Record<string, unknown>,
          });
          onClose();
        }}
      >
        Добавить
      </Button>
    </Sheet>
  );
}

function AddCategorySheet({ areaId, onClose }: { areaId: string; onClose: () => void }) {
  const actions = useActions();
  const [title, setTitle] = useState('');
  const [editor, setEditor] = useState<UserCategoryData['editor']>('amount');
  const [primo, setPrimo] = useState(0);
  const [count, setCount] = useState(1);
  return (
    <Sheet open onClose={onClose} title="Новая категория">
      <Field label="Название">
        <input
          className="input"
          aria-label="Название категории"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field label="Ввод">
        <select
          className="input"
          aria-label="Тип ввода"
          value={editor}
          onChange={(e) => setEditor(e.target.value as UserCategoryData['editor'])}
        >
          <option value="amount">Суммой</option>
          <option value="count">Количеством</option>
          <option value="binary">Одной галочкой</option>
        </select>
      </Field>
      <div className="grid2">
        <Field label="Итог, примогемов (0 — неизвестно)">
          <NumberInput
            aria-label="Итог категории"
            value={primo}
            min={0}
            onChange={(v) => setPrimo(Math.max(0, v))}
          />
        </Field>
        {editor === 'count' && (
          <Field label="Сколько штук">
            <NumberInput
              aria-label="Число штук"
              value={count}
              min={1}
              onChange={(v) => setCount(Math.max(1, Math.floor(v)))}
            />
          </Field>
        )}
      </div>
      <Button
        variant="primary"
        disabled={!title.trim()}
        onClick={async () => {
          const data: UserCategoryData = {
            areaId,
            title: title.trim(),
            editor,
            total: primo ? { primo } : null,
          };
          if (editor === 'count') {
            data.count = count;
            if (primo) data.unit = { primo: Math.floor(primo / count) };
          }
          const id = newUserEntityId('category', areaId);
          await actions.putDoc('user_entity', id, {
            id,
            kind: 'category',
            data: data as unknown as Record<string, unknown>,
          });
          onClose();
        }}
      >
        Добавить
      </Button>
    </Sheet>
  );
}

function RenameSheet({
  value,
  onClose,
}: {
  value: { entity: 'area' | 'category'; id: string; field: string; value: string };
  onClose: () => void;
}) {
  const actions = useActions();
  const store = useStoreApi();
  const [text, setText] = useState(value.value);
  return (
    <Sheet open onClose={onClose} title="Переименовать">
      <input
        className="input"
        aria-label="Новое название"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="primary"
        disabled={!text.trim()}
        onClick={async () => {
          await actions.putDoc('override', `${value.entity}:${value.id}:${value.field}`, {
            entity: value.entity,
            id: value.id,
            field: value.field,
            value: text.trim(),
            at: store.deps.clock().toISOString(),
          });
          onClose();
        }}
      >
        Сохранить
      </Button>
    </Sheet>
  );
}

function ChestPricesSheet({ model, areaId, onClose }: { model: Model; areaId: string; onClose: () => void }) {
  const actions = useActions();
  const store = useStoreApi();
  const types = model.ctxForArea(areaId).chestTypes;
  const save = (typeId: string, field: 'values.low' | 'values.high', value: number) =>
    actions.putDoc('override', `areaChestType:${areaId}/${typeId}:${field}`, {
      entity: 'areaChestType',
      id: `${areaId}/${typeId}`,
      field,
      value,
      at: store.deps.clock().toISOString(),
    });
  return (
    <Sheet open onClose={onClose} title="Цены сундуков в области">
      <p className="small muted">Глобальные цены меняются в «Настройках»; здесь — только для этой области.</p>
      {types
        .filter((t) => !t.variants?.length)
        .map((t) => (
          <div key={t.id} className="grid2">
            <Field label={`${t.name}: low`}>
              <NumberInput
                aria-label={`${t.name} low`}
                value={t.values.low}
                min={0}
                onChange={(v) => save(t.id, 'values.low', Math.max(0, v))}
              />
            </Field>
            <Field label={`${t.name}: high`}>
              <NumberInput
                aria-label={`${t.name} high`}
                value={t.values.high}
                min={0}
                onChange={(v) => save(t.id, 'values.high', Math.max(0, v))}
              />
            </Field>
          </div>
        ))}
    </Sheet>
  );
}
