// Маршрутизация по hash: #/regions/mondstadt?area=dragonspine
import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [p = '', q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href : `#${href}`;
}

export function href(...parts: (string | undefined)[]): string {
  return `#/${parts
    .filter(Boolean)
    .map((p) => encodeURIComponent(p!))
    .join('/')}`;
}
