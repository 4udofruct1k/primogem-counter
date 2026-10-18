// Игровые данные для тестов — только из data/*.json (правило 5).
import datapackJson from '../../../../data/datapack-2026-10-19.json';
import seedJson from '../../../../data/primo_seed_regions.json';

export const datapack = datapackJson;
export const seed = seedJson;

/** Устройство пользователя в тестах раздела 18 — UTC+5. */
export const DEVICE_OFFSET = 5;
