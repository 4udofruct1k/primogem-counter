import { describe, expect, it } from 'vitest';
import * as domain from './index';

describe('@primo/domain', () => {
  it('модуль загружается', () => {
    expect(domain).toBeTypeOf('object');
  });
});
