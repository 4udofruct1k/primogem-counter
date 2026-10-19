// Пароли и коды восстановления (argon2id), токены сессий (14.2).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import type { Argon2Params } from '../config';

/** `Algorithm.Argon2id` — const enum недоступен при isolatedModules, поэтому числом. */
const ARGON2ID = 2 as Algorithm;

export class Secrets {
  private dummy: Promise<string> | null = null;

  constructor(private readonly params: Argon2Params) {}

  hash(secret: string): Promise<string> {
    return hash(secret, { ...this.params, algorithm: ARGON2ID });
  }

  /**
   * Проверка секрета по хэшу. Без хэша (нет такого пользователя) сверяет с фиктивным,
   * чтобы время ответа не выдавало, существует ли логин.
   */
  async verify(stored: string | undefined, secret: string): Promise<boolean> {
    if (stored === undefined) {
      this.dummy ??= this.hash(newSessionToken());
      await verify(await this.dummy, secret).catch(() => false);
      return false;
    }
    return verify(stored, secret).catch(() => false);
  }
}

/** Алфавит кода восстановления: A–Z и 2–9 без похожих 0/O, 1/I/L. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_LENGTH = 16;

/** Код восстановления: 16 символов (~79 бит), показывается один раз. */
export function newRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++)
    code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return code;
}

/** Токен сессии для cookie: 256 случайных бит, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Id сессии в БД — SHA-256 токена: утечка таблицы не даёт войти чужой сессией (D-303). */
export function sessionIdOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
