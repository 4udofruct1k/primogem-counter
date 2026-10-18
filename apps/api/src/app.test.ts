import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';

describe('api', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ ...loadConfig({}), version: 'test' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, version: 'test' });
  });

  it('GET /data/<file>.json раздаёт игровые данные', async () => {
    const res = await app.inject({ method: 'GET', url: '/data/datapack-2026-10-19.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gameVersion: '7.1' });
  });
});
