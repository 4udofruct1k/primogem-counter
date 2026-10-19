// «Админка данных» (решение пользователя: суммы ивентов и шаблон правятся из админки).
// Патч поверх датапака хранится на сервере (версии, оптимистичная блокировка), клиенты накладывают его при загрузке.
import {
  applyDatapackPatch,
  ms,
  slotsForVersion,
  type DatapackPatchLike,
  type EventSlot,
  type EventTemplate,
  type RawEvent,
} from '@primo/domain';
import { DatapackPatchSchema, DatapackSchema } from '@primo/shared';
import { useEffect, useState } from 'react';
import { ApiFailure } from '../data/api';
import { loadGameData } from '../data/gamedata';
import { useApp, useModel, useServices, useStoreApi } from '../state/context';
import { Badge, Button, Card, Empty, Field, NumberInput } from '../ui/components';

type Patch = DatapackPatchLike;

/** Проверка патча: схема патча и итоговый пак (как на сервере). */
export function validatePatch(base: Parameters<typeof applyDatapackPatch>[0], patch: unknown): string | null {
  const p = DatapackPatchSchema.safeParse(patch);
  if (!p.success) return `Патч: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  const merged = DatapackSchema.safeParse(applyDatapackPatch(base, p.data as Patch));
  if (!merged.success)
    return `Итоговый пак: ${merged.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  return null;
}

export function AdminScreen() {
  const account = useApp((s) => s.account);
  const game = useApp((s) => s.game);
  const store = useStoreApi();
  const { api } = useServices();
  const [version, setVersion] = useState<number | null>(null);
  const [patch, setPatch] = useState<Patch>({});
  const [json, setJson] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!account?.isAdmin) return;
    api.adminGetPatch().then(
      (r) => {
        setVersion(r.version);
        setPatch((r.patch ?? {}) as Patch);
        setJson(JSON.stringify(r.patch ?? {}, null, 2));
      },
      (e) => setError(String(e)),
    );
  }, [account?.isAdmin, api]);

  if (!account?.isAdmin)
    return (
      <Card title="Админка данных">
        {<Empty>Доступно только администраторам (ADMIN_USERNAMES на сервере).</Empty>}
      </Card>
    );
  if (!game || version === null)
    return (
      <Card title="Админка данных">
        {error ? <p className="hot">{error}</p> : <Empty>Загрузка патча…</Empty>}
      </Card>
    );

  const base = game.basePack;
  const update = (next: Patch) => {
    setPatch(next);
    setJson(JSON.stringify(next, null, 2));
    setStatus(null);
  };
  const problem = validatePatch(base, patch);

  const save = async () => {
    setError(null);
    try {
      const r = await api.adminPutPatch(patch, version);
      setVersion(r.version);
      setStatus(`Сохранено, версия патча ${r.version}`);
      store.getState().setGame(await loadGameData(store.deps.db, store.deps.fetch));
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.code === 'CONFLICT'
          ? 'Патч уже изменили — обновите страницу'
          : String(e instanceof Error ? e.message : e),
      );
    }
  };

  return (
    <>
      <Card
        title={
          <>
            Админка данных <Badge>патч v{version}</Badge>
          </>
        }
      >
        <p className="small muted">
          Правки накладываются поверх датапака из data/ по id. Сохранение создаёт новую версию патча; клиенты
          получат её при следующем запуске.
        </p>
        {problem && <p className="hot small">{problem}</p>}
        {error && <p className="hot small">{error}</p>}
        {status && <p className="ok small">{status}</p>}
        <div className="btn-row">
          <Button variant="primary" disabled={!!problem} onClick={save}>
            Сохранить патч
          </Button>
          <Button onClick={() => update({})}>Очистить патч</Button>
        </div>
      </Card>
      <TemplateEditor base={base.eventTemplate} patch={patch} onChange={update} />
      <EventsEditor events={applyDatapackPatch(base, patch).events} patch={patch} onChange={update} />
      <Card title="JSON патча">
        <textarea
          className="input"
          aria-label="JSON патча"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
        />
        <Button
          onClick={() => {
            try {
              update(JSON.parse(json) as Patch);
              setError(null);
            } catch (e) {
              setError(`JSON: ${String(e)}`);
            }
          }}
        >
          Применить JSON
        </Button>
      </Card>
    </>
  );
}

function TemplateEditor({
  base,
  patch,
  onChange,
}: {
  base: EventTemplate | undefined;
  patch: Patch;
  onChange: (p: Patch) => void;
}) {
  const model = useModel();
  if (!base || !model) return null;
  const merged = applyDatapackPatch(
    {
      versions: [],
      banners: [],
      events: [],
      rules: [],
      packVersion: 0,
      generatedAt: '',
      gameVersion: '',
      eventTemplate: base,
    },
    patch,
  ).eventTemplate!;
  const setTemplate = (t: Partial<EventTemplate>) =>
    onChange({ ...patch, eventTemplate: { ...patch.eventTemplate, ...t } });
  const setSlot = (slot: EventSlot) => {
    const slots = [...(patch.eventTemplate?.slots ?? [])].filter((s) => s.id !== slot.id);
    setTemplate({ slots: [...slots, slot] });
  };
  const setVersionSlot = (v: string, slotId: string, p: Partial<Omit<EventSlot, 'id'>>) => {
    const versions = { ...patch.eventTemplate?.versions };
    versions[v] = { ...versions[v], [slotId]: { ...versions[v]?.[slotId], ...p } };
    setTemplate({ versions });
  };
  const versions = model.versions.filter((v) => ms(v.end) > ms(model.now)).slice(0, 8);
  return (
    <Card title="Шаблон ивентов версии">
      <p className="small muted">По умолчанию на каждую версию; реальный ивент с полем slot занимает слот.</p>
      {merged.slots.map((s) => (
        <div key={s.id} className="grid2">
          <Field label={`${s.title}: сколько`}>
            <NumberInput
              aria-label={`Шаблон ${s.id}: число`}
              value={s.count}
              min={0}
              max={10}
              onChange={(v) => setSlot({ ...s, count: Math.max(0, Math.floor(v)) })}
            />
          </Field>
          <Field label={`${s.title}: примогемов`}>
            <NumberInput
              aria-label={`Шаблон ${s.id}: примогемов`}
              value={s.reward.primo ?? 0}
              min={0}
              onChange={(v) => setSlot({ ...s, reward: { ...s.reward, primo: Math.max(0, v) } })}
            />
          </Field>
        </div>
      ))}
      <Field label="Пробные персонажи за фазу (если баннеры не объявлены)">
        <NumberInput
          aria-label="Пробы за фазу"
          value={merged.trialsPerPhase?.primo ?? 0}
          min={0}
          onChange={(v) => setTemplate({ trialsPerPhase: { primo: Math.max(0, v) } })}
        />
      </Field>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Версия</th>
              {merged.slots.map((s) => (
                <th key={s.id} colSpan={2}>
                  {s.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const slots = slotsForVersion(merged, v.id);
              return (
                <tr key={v.id}>
                  <td>{v.id}</td>
                  {slots.map((s) => (
                    <SlotCells
                      key={s.id}
                      versionId={v.id}
                      slot={s}
                      onChange={(p) => setVersionSlot(v.id, s.id, p)}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SlotCells({
  versionId,
  slot,
  onChange,
}: {
  versionId: string;
  slot: EventSlot;
  onChange: (p: Partial<Omit<EventSlot, 'id'>>) => void;
}) {
  return (
    <>
      <td style={{ width: 70 }}>
        <NumberInput
          aria-label={`${versionId} ${slot.id}: число`}
          value={slot.count}
          min={0}
          max={10}
          onChange={(v) => onChange({ count: Math.max(0, Math.floor(v)) })}
        />
      </td>
      <td style={{ width: 90 }}>
        <NumberInput
          aria-label={`${versionId} ${slot.id}: примогемов`}
          value={slot.reward.primo ?? 0}
          min={0}
          onChange={(v) => onChange({ reward: { primo: Math.max(0, v) } })}
        />
      </td>
    </>
  );
}

function EventsEditor({
  events,
  patch,
  onChange,
}: {
  events: RawEvent[];
  patch: Patch;
  onChange: (p: Patch) => void;
}) {
  const setEvent = (id: string, fields: Partial<RawEvent>) => {
    const list = [...(patch.events ?? [])];
    const i = list.findIndex((e) => e.id === id);
    const prev = i >= 0 && !list[i]!._delete ? (list[i] as Partial<RawEvent>) : {};
    const next = { ...prev, ...fields, id } as Partial<RawEvent> & { id: string };
    if (i >= 0) list[i] = next;
    else list.push(next);
    onChange({ ...patch, events: list });
  };
  return (
    <Card title="Ивенты датапака">
      <ul className="list">
        {events.map((e) => (
          <li key={e.id} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="row-main">
              <div className="row-title small">{e.title}</div>
              <div className="row-sub">
                {e.id} · {e.versionId} · {e.confidence}
              </div>
            </div>
            {!e.tasks?.length && (
              <label className="field" style={{ width: 100 }}>
                <span className="field-label">примогемы</span>
                <input
                  className="input"
                  type="number"
                  aria-label={`${e.id}: примогемов`}
                  value={e.reward.primo ?? ''}
                  placeholder="?"
                  onChange={(ev) =>
                    setEvent(e.id, {
                      reward: {
                        ...e.reward,
                        primo: ev.target.value === '' ? null : Math.max(0, Number(ev.target.value)),
                      },
                    })
                  }
                />
              </label>
            )}
            <label className="field" style={{ width: 120 }}>
              <span className="field-label">слот</span>
              <select
                className="input"
                aria-label={`${e.id}: слот`}
                value={e.slot ?? ''}
                onChange={(ev) => setEvent(e.id, { slot: ev.target.value })}
              >
                <option value="">—</option>
                <option value="small">малый</option>
                <option value="big">большой</option>
              </select>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
