import { limitedPulls, standardPulls } from '@primo/domain';
import { useState } from 'react';
import { useModel } from '../state/context';
import { Button, Card, Stat } from '../ui/components';
import { num } from '../ui/format';
import { ReconcileSheet } from './ReconcileSheet';

export function TodayScreen() {
  const model = useModel();
  const [reconcile, setReconcile] = useState(false);
  if (!model) return null;
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
      </Card>
      <ReconcileSheet open={reconcile} onClose={() => setReconcile(false)} />
    </>
  );
}
