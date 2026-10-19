// Ошибки API: всегда `{ error: { code, message } }` (14.4), коды — ERROR_CODES из @primo/shared.
import type { ErrorCode } from '@primo/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const validation = (message: string) => new ApiError(400, 'VALIDATION', message);
export const authRequired = () => new ApiError(401, 'AUTH_REQUIRED', 'Нужно войти в аккаунт');
export const badCredentials = (message = 'Неверный логин или пароль') =>
  new ApiError(401, 'BAD_CREDENTIALS', message);
export const forbidden = (message: string) => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Не найдено') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
export const rateLimited = (seconds: number) =>
  new ApiError(429, 'RATE_LIMIT', `Слишком много попыток — повторите через ${seconds} с`);

/** Первые ошибки zod одной строкой: «username: логин: 3–32 символа…». */
export function formatIssues(error: z.ZodError, limit = 3): string {
  const parts = error.issues
    .slice(0, limit)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  if (error.issues.length > limit) parts.push(`и ещё ${error.issues.length - limit}`);
  return parts.join('; ');
}

/** Проверка входа zod-схемой; ошибка — 400 VALIDATION. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(formatIssues(r.error));
  return r.data;
}

/** Статус ошибки Fastify и плагинов → код API. */
function codeOf(status: number): ErrorCode {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMIT';
  return 'VALIDATION';
}

const FASTIFY_MESSAGES: Record<number, string> = {
  400: 'Некорректный запрос',
  413: 'Тело запроса больше 1 МБ',
  415: 'Ожидается JSON (content-type: application/json)',
  429: 'Слишком много запросов',
};

export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | ApiError>((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      req.log.info({ err: { code: err.code, message: err.message } }, 'отклонённый запрос');
      const message = FASTIFY_MESSAGES[status] ?? err.message;
      return reply.status(status).send({ error: { code: codeOf(status), message } });
    }
    req.log.error({ err }, 'внутренняя ошибка');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: `Не найдено: ${req.method} ${req.url.split('?')[0]}` } }),
  );
}
