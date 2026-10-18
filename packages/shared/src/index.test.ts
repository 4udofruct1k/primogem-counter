import { describe, expect, it } from 'vitest';
import { ServerIdSchema } from './index';

describe('ServerIdSchema', () => {
  it('принимает серверы из 4.1', () => {
    for (const id of ['asia', 'tw_hk_mo', 'europe', 'america']) {
      expect(ServerIdSchema.parse(id)).toBe(id);
    }
  });

  it('отклоняет неизвестный сервер', () => {
    expect(ServerIdSchema.safeParse('moon').success).toBe(false);
  });
});
