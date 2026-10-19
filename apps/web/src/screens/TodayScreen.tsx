import { hoyolabPrimo, limitedPulls, standardPulls } from '@primo/domain';
import { useMemo, useState } from 'react';
import { useActions, useApp, useModel } from '../state/context';
import { runForecast } from '../state/model';
import { standaloneReminders } from '../state/reminders';
import { currentHoyolab, hotItems, todayChecklist } from '../state/select';
import { Button, Card, Empty, Stat } from '../ui/components';
import { date, num } from '../ui/format';
import { OccurrenceRow } from '../ui/OccurrenceRow';
import { href } from '../ui/router';
import { ReconcileSheet } from './ReconcileSheet';

export function TodayScreen() {
  const model = useModel();
  const actions = useActions();
  const hoyolabDocs = useApp((s) => s.docs.hoyolab);
  const [reconcile, setReconcile] = useState(false);
  const toVersionEnd = useMemo(
    () => (model?.currentVersion ? runForecast(model, model.currentVersion.endDeadline) : null),
    [model],
  );
  if (!model) return null;
  const checklist = todayChecklist(model);
  const hoyolab = currentHoyolab(model);
  const hot = hotItems(model);
  const reminders = standaloneReminders(model);
  const hotCount = hot.length + reminders.length;
  const v = model.currentVersion;
  const lab = hoyolab ? (model.trackerSums[hoyolab.id] ?? 0) : 0;
  const checkIns = hoyolab ? (hoyolabDocs[hoyolab.id]?.checkIns ?? 0) : 0;
  const setCheckIns = (n: number) =>
    hoyolab &&
    actions.saveTracker(model, 'hoyolab', { id: hoyolab.id, checkIns: n }, (d) =>
      hoyolabPrimo(d?.checkIns ?? 0),
    );

  return (
    <>
      <Card title="Крутки сейчас" actions={<Button onClick={() => setReconcile(true)}>Сверка</Button>}>
        <div className="stats">
          <Stat
            big
            label="Лимитированные"
            value={
              <span data-testid="limited-pulls">{num(limitedPulls(model.balance, model.settings))}</span>
            }
            sub={`${num(model.balance.primo)} примогемов · ${num(model.balance.if)} IF`}
          />
          <Stat
            big
            label="Стандартные"
            value={<span data-testid="standard-pulls">{num(standardPulls(model.balance))}</span>}
            sub="AF"
          />
        </div>
        {v && toVersionEnd && (
          <p className="muted small">
            К концу версии {v.id} ({date(v.endDeadline, 'dd.MM')}) — около{' '}
            <b>{num(toVersionEnd.limitedPulls)}</b> круток. <a href={href('forecast')}>Прогноз →</a>
          </p>
        )}
      </Card>

      <Card title="Сегодня">
        {checklist.length === 0 && !hoyolab ? (
          <Empty>На сегодня ничего.</Empty>
        ) : (
          <ul className="list">
            {checklist.map((o) => (
              <OccurrenceRow key={o.id} model={model} occ={o} compact />
            ))}
            {hoyolab && (
              <li className="row">
                <div className="row-main">
                  <div className="row-title">Отметка HoYoLAB</div>
                  <div className="row-sub">
                    отметок в месяце: <span data-testid="hoyolab-count">{checkIns}</span> · примогемы за 4-ю,
                    11-ю и 18-ю
                  </div>
                </div>
                <div className="row-amount">{num(lab)}</div>
                <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                  <Button
                    small
                    disabled={checkIns <= 0}
                    onClick={() => setCheckIns(checkIns - 1)}
                    aria-label="HoYoLAB −1"
                  >
                    −1
                  </Button>
                  <Button
                    small
                    variant="primary"
                    disabled={checkIns >= 31}
                    onClick={() => setCheckIns(checkIns + 1)}
                    aria-label="HoYoLAB +1"
                  >
                    +1
                  </Button>
                </div>
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card title={`Горит — ${hotCount ? `${hotCount}` : 'ничего'}`}>
        {hotCount === 0 ? (
          <Empty>В ближайшие 7 дней ничего не сгорает.</Empty>
        ) : (
          <ul className="list" data-testid="hot-list">
            {reminders.map((r) => (
              <li key={r.key} className="row" data-testid="reminder">
                <div className="row-main">
                  <div className="row-title hot">{r.title}</div>
                  <div className="row-sub">{r.body}</div>
                </div>
              </li>
            ))}
            {hot.map((o) => (
              <OccurrenceRow key={o.id} model={model} occ={o} />
            ))}
          </ul>
        )}
      </Card>
      <ReconcileSheet open={reconcile} onClose={() => setReconcile(false)} />
    </>
  );
}
