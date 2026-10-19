// Игровые данные на сервере (14.6): файлы data/*.json, их хэши для манифеста и патчи админки из БД.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '@primo/shared';
import { desc, eq } from 'drizzle-orm';
import type { Db } from './db';
import { adminPatches } from './db/schema';

export const SEED_FILE = 'primo_seed_regions.json';
const DATAPACK_RE = /^datapack-.+\.json$/;

export interface DataFile {
  name: string;
  sha256: string;
  json: unknown;
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Файлы data/ с кэшем по mtime и размеру: правка файла без перезапуска сразу видна в манифесте. */
export class GameFiles {
  private readonly cache = new Map<string, DataFile & { mtimeMs: number; size: number }>();

  constructor(readonly dir: string) {}

  /** Текущий датапак — самый новый по имени `datapack-<дата>.json`. */
  async datapackName(): Promise<string> {
    const names = (await readdir(this.dir)).filter((n) => DATAPACK_RE.test(n)).sort();
    const last = names.at(-1);
    if (!last) throw new Error(`В ${this.dir} нет файлов datapack-*.json`);
    return last;
  }

  async read(name: string): Promise<DataFile> {
    const file = path.join(this.dir, name);
    const st = await stat(file);
    const hit = this.cache.get(name);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const raw = await readFile(file);
    const entry = {
      name,
      sha256: sha256(raw),
      json: JSON.parse(raw.toString('utf8')) as unknown,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
    this.cache.set(name, entry);
    return entry;
  }

  async datapack(): Promise<DataFile> {
    return this.read(await this.datapackName());
  }
}

export interface StoredPatch {
  version: number;
  patch: unknown;
  createdAt: Date;
}

export async function latestPatch(db: Db): Promise<StoredPatch | null> {
  const [row] = await db.select().from(adminPatches).orderBy(desc(adminPatches.version)).limit(1);
  return row ?? null;
}

export async function patchByVersion(db: Db, version: number): Promise<StoredPatch | null> {
  const [row] = await db.select().from(adminPatches).where(eq(adminPatches.version, version)).limit(1);
  return row ?? null;
}

/** Тело файла /data/patch-<n>.json; хэш в манифесте считается от этой же строки. */
export const patchBody = (p: StoredPatch) => JSON.stringify(p.patch);
export const patchPath = (version: number) => `/data/patch-${version}.json`;

const numberField = (json: unknown, field: string): number => {
  const v = (json as Record<string, unknown> | null)?.[field];
  if (typeof v !== 'number') throw new Error(`В игровых данных нет числового поля ${field}`);
  return v;
};

export async function buildManifest(files: GameFiles, db: Db): Promise<Manifest> {
  const [pack, seed, patch] = await Promise.all([files.datapack(), files.read(SEED_FILE), latestPatch(db)]);
  return {
    generatedAt: new Date().toISOString(),
    packVersion: numberField(pack.json, 'packVersion'),
    seedSchemaVersion: numberField(seed.json, 'schemaVersion'),
    files: {
      datapack: { path: `/data/${pack.name}`, sha256: pack.sha256 },
      seed: { path: `/data/${seed.name}`, sha256: seed.sha256 },
    },
    patch: patch
      ? {
          version: patch.version,
          sha256: sha256(patchBody(patch)),
          path: patchPath(patch.version),
          updatedAt: patch.createdAt.toISOString(),
        }
      : null,
  };
}
