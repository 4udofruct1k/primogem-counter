import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('рендерит заголовок', () => {
    expect(renderToString(<App />)).toContain('Копилка круток');
  });
});
