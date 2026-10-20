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

/** Версия содержимого в ссылке на файл данных (D-317): первые 16 hex его SHA-256. */
export const contentVersion = (sha: string) => sha.slice(0, 16);

/**
 * Ссылка из манифеста: `<путь>?v=<версия содержимого>`. Новое содержимое — новый URL, которого нет в HTTP-кэше
 * браузера (14.4: «immutable по имени с версией»); статика и Caddy query-строку при поиске файла не учитывают.
 */
export const versionedPath = (p: string, sha: string) => `${p}?v=${contentVersion(sha)}`;

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

  /**
   * Отдаваемый файл `filePath` (его stat) — ровно та версия `v`, что была в манифесте: запись кэша с тем же mtime и
   * размером и тем же хэшем. Нет записи (файл не попадал в манифест этого процесса) или файл с тех пор менялся — нет.
   */
  isVersion(filePath: string, st: { mtimeMs: number; size: number }, v: string): boolean {
    if (path.dirname(filePath) !== path.resolve(this.dir)) return false;
    const hit = this.cache.get(path.basename(filePath));
    return !!hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && contentVersion(hit.sha256) === v;
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
      datapack: { path: versionedPath(`/data/${pack.name}`, pack.sha256), sha256: pack.sha256 },
      seed: { path: versionedPath(`/data/${seed.name}`, seed.sha256), sha256: seed.sha256 },
    },
    patch: patch ? patchRef(patch) : null,
  };
}

function patchRef(patch: StoredPatch): NonNullable<Manifest['patch']> {
  const hash = sha256(patchBody(patch));
  return {
    version: patch.version,
    sha256: hash,
    path: versionedPath(patchPath(patch.version), hash),
    updatedAt: patch.createdAt.toISOString(),
  };
}
