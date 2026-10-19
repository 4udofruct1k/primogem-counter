// «Таймлайн» (раздел 9): Гант с зумом, дорожками, линией «сейчас» и перетаскиваемой линией цели.
import { addDays, fromMs, ms, type ISO } from '@primo/domain';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp, useModel } from '../state/context';
import { runForecast, type Model } from '../state/model';
import { buildTimeline, LANES, stackRows, type TimelineItem } from '../state/timeline';
import { Badge, Card, ConfidenceBadge, Sheet, Tabs, Toggle } from '../ui/components';
import { date, dateTime, num, rewardText } from '../ui/format';
import { OccurrenceRow } from '../ui/OccurrenceRow';
import { href } from '../ui/router';

type Zoom = 'week' | 'month' | 'version';
const PX_PER_DAY: Record<Zoom, number> = { week: 72, month: 20, version: 7 };
const SPAN_DAYS: Record<Zoom, [number, number]> = { week: [-7, 60], month: [-14, 200], version: [-42, 400] };
const ROW_H = 26;
const DAY_MS = 86_400_000;
const LABEL_W = 108;

export function TimelineScreen() {
  const model = useModel();
  const areaStates = useApp((s) => s.docs.area_state);
  const [zoom, setZoom] = useState<Zoom>('month');
  const [showLeaks, setShowLeaks] = useState(false);
  const [selected, setSelected] = useState<TimelineItem | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [debounced, setDebounced] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    if (!model) return null;
    const [back, ahead] = SPAN_DAYS[zoom];
    return { from: addDays(model.now, back), to: addDays(model.now, ahead) };
  }, [model, zoom]);
  const items = useMemo(
    () => (model && range ? buildTimeline(model, range, { showLeaks, areaStates }) : []),
    [model, range, showLeaks, areaStates],
  );

  // линия цели: пересчёт прогноза с задержкой 150 мс (раздел 9)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(target), 150);
    return () => clearTimeout(t);
  }, [target]);
  const goalForecast = useMemo(() => {
    if (!model || debounced === null) return null;
    const T = fromMs(debounced);
    return {
      T,
      min: runForecast(model, T, 'min'),
      exp: runForecast(model, T, 'expected'),
      max: runForecast(model, T, 'max'),
    };
  }, [model, debounced]);

  const px = PX_PER_DAY[zoom];
  const start = range ? ms(range.from) : 0;
  const x = (iso: ISO) => ((ms(iso) - start) / DAY_MS) * px;

  // при открытии и смене зума — прокрутка к «сейчас»
  useEffect(() => {
    if (!model || !scroller.current) return;
    scroller.current.scrollLeft = Math.max(0, x(model.now) - 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, Boolean(model)]);

  if (!model || !range) return null;
  const width = ((ms(range.to) - start) / DAY_MS) * px;
  const nowX = x(model.now);
  const targetMs = target ?? ms(model.now) + 30 * DAY_MS;
  const targetX = ((targetMs - start) / DAY_MS) * px;

  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || !(e.buttons & 1)) return;
    const rect = el.getBoundingClientRect();
    const posX = e.clientX - rect.left + el.scrollLeft - LABEL_W;
    const t = start + (posX / px) * DAY_MS;
    setTarget(Math.min(ms(range.to), Math.max(ms(model.now), t)));
  };

  return (
    <>
      <Card
        title="Таймлайн"
        actions={
          <Tabs
            value={zoom}
            onChange={setZoom}
            items={[
              { id: 'week', label: 'Неделя' },
              { id: 'month', label: 'Месяц' },
              { id: 'version', label: 'Версия' },
            ]}
          />
        }
      >
        <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Toggle checked={showLeaks} onChange={setShowLeaks} label="Показывать утечки" />
          <span className="small muted">Тяните ромб цели — прогноз пересчитается</span>
        </div>
        <GoalReadout model={model} forecast={goalForecast} />
        <div className="timeline" ref={scroller} data-testid="timeline">
          <div className="timeline-inner" style={{ width: width + LABEL_W }}>
            <Axis start={start} width={width} px={px} zoom={zoom} offset={model.deviceOffset} />
            {LANES.map((lane) => {
              const laneItems = items.filter((i) => i.lane === lane.id);
              const rows = stackRows(
                laneItems,
                (lane.id === 'points' || lane.id === 'content' ? 110 / px : 0) * DAY_MS,
              );
              const height = Math.max(1, ...[...rows.values()].map((r) => r + 1)) * ROW_H + 6;
              return (
                <div
                  key={lane.id}
                  className="timeline-lane"
                  style={{ height }}
                  data-testid={`lane-${lane.id}`}
                >
                  <div className="timeline-lane-title">{lane.title}</div>
                  {laneItems.map((it) => {
                    const left = LABEL_W + x(it.from);
                    const row = rows.get(it.id) ?? 0;
                    const top = 3 + row * ROW_H;
                    if (!it.to) {
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`tl-point tone-${it.tone}`}
                          style={{ left, top }}
                          onClick={() => setSelected(it)}
                          title={it.label}
                        >
                          <span className="tl-dot" />
                          <span className="tl-text">{it.label}</span>
                        </button>
                      );
                    }
                    const w = Math.max(6, x(it.to) - x(it.from));
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`tl-bar tone-${it.tone}`}
                        style={{ left, top, width: w }}
                        onClick={() => setSelected(it)}
                        title={it.label}
                      >
                        <span className="tl-text">{it.label}</span>
                        {it.marker && (
                          <span
                            className="tl-marker"
                            style={{ left: x(it.marker.at) - x(it.from) }}
                            title={it.marker.label}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <div className="tl-now" style={{ left: LABEL_W + nowX }} aria-label="сейчас" />
            <div className="tl-goal" style={{ left: LABEL_W + targetX }}>
              <div
                className="tl-goal-handle"
                role="slider"
                aria-label="Линия цели"
                aria-valuetext={date(fromMs(targetMs), model.deviceOffset)}
                aria-valuenow={Math.round((targetMs - ms(model.now)) / DAY_MS)}
                tabIndex={0}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  onDrag(e);
                }}
                onPointerMove={onDrag}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setTarget(Math.min(ms(range.to), targetMs + DAY_MS));
                  if (e.key === 'ArrowLeft') setTarget(Math.max(ms(model.now), targetMs - DAY_MS));
                }}
                onFocus={() => target === null && setTarget(targetMs)}
              >
                ◆
              </div>
            </div>
          </div>
        </div>
        <div className="legend">
          <span>
            <span className="legend-swatch tone-accent" /> объявлено
          </span>
          <span>
            <span className="legend-swatch tone-projected" /> проекция
          </span>
          <span>
            <span className="legend-swatch tone-leak" /> утечка
          </span>
          <span>
            <span className="legend-swatch tone-empty" /> трекер 0%
          </span>
          <span>
            <span className="legend-swatch tone-partial" /> частично
          </span>
          <span>
            <span className="legend-swatch tone-full" /> максимум / забрано
          </span>
        </div>
      </Card>
      {selected && <ItemSheet model={model} item={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function GoalReadout({
  model,
  forecast,
}: {
  model: Model;
  forecast: {
    T: ISO;
    min: { limitedPulls: number };
    exp: { limitedPulls: number };
    max: { limitedPulls: number };
  } | null;
}) {
  if (!forecast) return <p className="small muted">Линия цели не выбрана.</p>;
  return (
    <p className="small" data-testid="goal-readout">
      К {date(forecast.T, model.deviceOffset, 'dd.MM.yyyy')}: <b>{num(forecast.exp.limitedPulls)}</b> круток
      (мин. {num(forecast.min.limitedPulls)}, макс. {num(forecast.max.limitedPulls)}) ·{' '}
      <a href={`${href('forecast')}?t=${encodeURIComponent(forecast.T)}`}>подробно →</a>
    </p>
  );
}

function Axis({
  start,
  width,
  px,
  zoom,
  offset,
}: {
  start: number;
  width: number;
  px: number;
  zoom: Zoom;
  offset: number;
}) {
  const ticks: { x: number; label: string; major: boolean }[] = [];
  const days = Math.ceil(width / px);
  for (let d = 0; d <= days; d++) {
    const t = start + d * DAY_MS;
    const iso = fromMs(t);
    const dd = date(iso, offset, 'dd');
    const show =
      zoom === 'week'
        ? true
        : zoom === 'month'
          ? new Date(t + offset * 3_600_000).getUTCDay() === 1
          : dd === '01';
    if (show)
      ticks.push({
        x: d * px,
        label: zoom === 'version' ? date(iso, offset, 'MM.yy') : date(iso, offset, 'dd.MM'),
        major: dd === '01',
      });
  }
  return (
    <div className="timeline-axis" style={{ width: width + LABEL_W }}>
      {ticks.map((t) => (
        <span key={t.x} className={`tl-tick ${t.major ? 'major' : ''}`} style={{ left: LABEL_W + t.x }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

function ItemSheet({ model, item, onClose }: { model: Model; item: TimelineItem; onClose: () => void }) {
  // свежие статусы из модели (после отметки в шторке)
  const occs = item.occ
    ? model.occurrences.filter((o) => o.id === item.occ!.id)
    : item.id.startsWith('e:')
      ? model.occurrences.filter((o) => o.eventId === item.id.slice(2))
      : [];
  return (
    <Sheet open onClose={onClose} title={item.label}>
      <p className="small muted">
        {dateTime(item.from, model.deviceOffset)}
        {item.to ? ` → ${dateTime(item.to, model.deviceOffset)}` : ''}
        {item.marker ? ` · ${item.marker.label} ${dateTime(item.marker.at, model.deviceOffset)}` : ''}
      </p>
      {item.reward && <p>Награда: {rewardText(item.reward)}</p>}
      {item.detail && <p className="small">{item.detail}</p>}
      {item.tone === 'projected' && <Badge>проекция по расписанию</Badge>}
      {item.occ && <ConfidenceBadge c={item.occ.confidence} />}
      {occs.length > 0 && (
        <ul className="list">
          {occs.map((o) => (
            <OccurrenceRow key={o.id} model={model} occ={o} />
          ))}
        </ul>
      )}
    </Sheet>
  );
}
