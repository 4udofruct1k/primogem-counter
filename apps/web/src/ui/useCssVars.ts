import { useEffect, useState } from 'react';

/** Значения CSS-переменных (цвета серий) с обновлением при смене темы — SVG-атрибуты не понимают var(). */
export function useCssVars(names: string[]): Record<string, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim() || '#888888']));
  };
  const [vars, setVars] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setVars(read());
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return vars;
}
