import { Card } from '../ui/components';

export function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p className="muted">Экран в разработке.</p>
    </Card>
  );
}
