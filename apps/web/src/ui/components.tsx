import type { Confidence } from '@primo/domain';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { CONFIDENCE_LABEL } from './format';

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  big,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  big?: boolean;
}) {
  return (
    <div className={`stat ${big ? 'stat-big' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  small?: boolean;
};
export function Button({ variant = 'default', small, className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${small ? 'btn-small' : ''} ${className ?? ''}`}
      {...rest}
    />
  );
}

const WEAK: Confidence[] = ['projected', 'leak', 'unknown', 'conflict', 'derived', 'user'];
export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className={`badge badge-${c} ${WEAK.includes(c) ? '' : 'badge-quiet'}`} title={`Метка: ${c}`}>
      {CONFIDENCE_LABEL[c]}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn' | 'ok' | 'hot';
}) {
  return <span className={`badge badge-tone-${tone}`}>{children}</span>;
}

export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <div className="stepper" aria-label={label}>
      <button
        type="button"
        className="btn btn-small"
        aria-label={`${label ?? ''} −`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="stepper-value" data-testid={label ? `stepper-${label}` : undefined}>
        {value}
        {max !== undefined && Number.isFinite(max) ? <span className="muted"> / {max}</span> : null}
      </span>
      <button
        type="button"
        className="btn btn-small"
        aria-label={`${label ?? ''} +`}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-text">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  'aria-label'?: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      className="input"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      {...rest}
    />
  );
}

/** Шторка снизу (на телефоне) / окно по центру (на широком экране). */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          aria-selected={i.id === value}
          className={`tab ${i.id === value ? 'tab-active' : ''}`}
          onClick={() => onChange(i.id)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
