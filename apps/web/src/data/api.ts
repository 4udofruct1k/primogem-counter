// Клиент API (14.4): cookie-сессия, ошибки { error: { code, message } }.
import type { ApiError, SyncRequest, SyncResponse } from '@primo/shared';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['error']['code'] | 'NETWORK',
    message: string,
    /** Retry-After у 429, с. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(fetchImpl: Fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiFailure(0, 'NETWORK', `Нет связи с сервером (${String(e)})`);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      const retry = Number(res.headers.get('retry-after'));
      throw new ApiFailure(
        res.status,
        err?.code ?? 'INTERNAL',
        err?.message ?? `HTTP ${res.status}`,
        Number.isFinite(retry) && retry > 0 ? retry : null,
      );
    }
    return json as T;
  }

  return {
    register: (username: string, password: string) =>
      call<{ user: { id: string; username: string; createdAt: string }; recoveryCode: string }>(
        'POST',
        '/api/auth/register',
        { username, password },
      ),
    login: (username: string, password: string) =>
      call<{ ok: true }>('POST', '/api/auth/login', { username, password }),
    logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
    logoutAll: () => call<{ ok: true }>('POST', '/api/auth/logout-all', {}),
    recover: (username: string, recoveryCode: string, newPassword: string) =>
      call<{ recoveryCode: string }>('POST', '/api/auth/recover', { username, recoveryCode, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) =>
      call<{ ok: true }>('POST', '/api/auth/password', { currentPassword, newPassword }),
    newRecoveryCode: (password: string) =>
      call<{ recoveryCode: string }>('POST', '/api/auth/recovery-code', { password }),
    me: () => call<{ id: string; username: string; createdAt: string; isAdmin: boolean }>('GET', '/api/me'),
    sync: (req: SyncRequest) => call<SyncResponse>('POST', '/api/sync', req),
    exportAll: () => call<unknown>('GET', '/api/export'),
    deleteAccount: (password: string) => call<{ ok: true }>('DELETE', '/api/account', { password }),
    adminGetPatch: () =>
      call<{ version: number; patch: unknown; updatedAt: string | null }>('GET', '/api/admin/patch'),
    adminPutPatch: (patch: unknown, baseVersion: number) =>
      call<{ version: number }>('PUT', '/api/admin/patch', { patch, baseVersion }),
  };
}

export type Api = ReturnType<typeof createApi>;
