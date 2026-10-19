// Игровые данные: манифест /data, кэш в IndexedDB, работа без сети (14.6).
import { applyDatapackPatch, type DatapackPatchLike, type RawDatapack, type RawSeed } from '@primo/domain';
import {
  DatapackPatchSchema,
  DatapackSchema,
  ManifestSchema,
  SeedSchema,
  type Manifest,
} from '@primo/shared';
import type { PrimoDB } from './db';

export interface GameData {
  /** Датапак с наложенным патчем админки. */
  datapack: RawDatapack;
  /** Датапак без патча — для редактора админки. */
  basePack: RawDatapack;
  patch: DatapackPatchLike | null;
  patchVersion: number | null;
  seed: RawSeed;
  manifest: Manifest;
  source: 'network' | 'cache';
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function fetchJson(fetchImpl: Fetch, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchImpl(path, init);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Файл по манифесту: из кэша, если хэш совпадает, иначе из сети (и в кэш). */
async function getFile(db: PrimoDB, fetchImpl: Fetch, key: string, ref: { path: string; sha256: string }) {
  const cached = await db.gamefiles.get(key);
  if (cached && cached.sha256 === ref.sha256) return cached.json;
  const json = await fetchJson(fetchImpl, ref.path);
  await db.gamefiles.put({ key, sha256: ref.sha256, json, fetchedAt: new Date().toISOString() });
  return json;
}

export async function loadGameData(db: PrimoDB, fetchImpl: Fetch = fetch): Promise<GameData> {
  let manifest: Manifest;
  let source: GameData['source'] = 'network';
  try {
    manifest = ManifestSchema.parse(await fetchJson(fetchImpl, '/data/manifest.json', { cache: 'no-store' }));
    await db.meta.put({ key: 'manifest', value: manifest });
  } catch (e) {
    const cached = await db.meta.get('manifest');
    if (!cached)
      throw new Error(`Нет связи с сервером и нет сохранённых игровых данных (${String(e)})`, { cause: e });
    manifest = ManifestSchema.parse(cached.value);
    source = 'cache';
  }

  const load = async (key: string, ref: { path: string; sha256: string }) =>
    source === 'network' ? getFile(db, fetchImpl, key, ref) : (await db.gamefiles.get(key))?.json;

  const basePack = DatapackSchema.parse(
    await load('datapack', manifest.files.datapack),
  ) as unknown as RawDatapack;
  const seed = SeedSchema.parse(await load('seed', manifest.files.seed)) as unknown as RawSeed;
  let patch: DatapackPatchLike | null = null;
  if (manifest.patch) {
    const raw = await load('patch', manifest.patch);
    if (raw) patch = DatapackPatchSchema.parse(raw) as DatapackPatchLike;
  }
  return {
    datapack: patch ? applyDatapackPatch(basePack, patch) : basePack,
    basePack,
    patch,
    patchVersion: manifest.patch?.version ?? null,
    seed,
    manifest,
    source,
  };
}
