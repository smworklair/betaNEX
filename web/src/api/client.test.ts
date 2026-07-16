import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ============================================================
   Тесты для api/client.ts — общего HTTP-слоя (apiFetch/withFallback).

   API_CONFIGURED вычисляется при загрузке модуля из
   import.meta.env.VITE_API_URL, поэтому каждый тест явно задаёт
   значение через vi.stubEnv + resetModules(), как и в llm.test.ts —
   не завязываемся на локальный web/.env разработчика.
   ============================================================ */

async function loadClient(apiUrl: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', apiUrl ?? '');
  return import('./client');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('API_BASE / API_CONFIGURED', () => {
  it('пустой VITE_API_URL → демо-режим, base пуст', async () => {
    const client = await loadClient(undefined);
    expect(client.API_CONFIGURED).toBe(false);
    expect(client.API_BASE).toBe('');
  });

  it('VITE_API_URL="/" → тот же origin, base пуст, но сконфигурирован', async () => {
    const client = await loadClient('/');
    expect(client.API_CONFIGURED).toBe(true);
    expect(client.API_BASE).toBe('');
  });

  it('VITE_API_URL с адресом → base без хвостовых слэшей', async () => {
    const client = await loadClient('https://nex-api.example.com/');
    expect(client.API_CONFIGURED).toBe(true);
    expect(client.API_BASE).toBe('https://nex-api.example.com');
  });
});

describe('apiFetch', () => {
  it('шлёт credentials:include и разбирает JSON-ответ', async () => {
    const client = await loadClient('/');
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const data = await client.apiFetch<{ ok: boolean }>('/api/v1/ping');
    expect(data).toEqual({ ok: true });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init!.credentials).toBe('include');
  });

  it('204 → возвращает undefined', async () => {
    const client = await loadClient('/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(client.apiFetch('/api/v1/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('не-2xx с problem+json → бросает ApiError с title/detail/status', async () => {
    const client = await loadClient('/');
    const problem = { title: 'Неверные данные', detail: 'Пароль не подходит' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(problem), { status: 401 })));

    await expect(client.apiFetch('/api/v1/auth/login')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      title: 'Неверные данные',
      detail: 'Пароль не подходит',
    });
  });

  it('не-2xx без тела → title откатывается на statusText', async () => {
    const client = await loadClient('/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500, statusText: 'Internal Server Error' })));
    await expect(client.apiFetch('/api/v1/x')).rejects.toMatchObject({ status: 500, title: 'Internal Server Error' });
  });

  it('проставляет Content-Type: application/json, если есть тело и заголовок не задан явно', async () => {
    const client = await loadClient('/');
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await client.apiFetch('/api/v1/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('withFallback', () => {
  it('в демо-режиме (не сконфигурирован) сразу отдаёт мок, сеть не трогает', async () => {
    const client = await loadClient(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const mock = vi.fn(() => 'мок-данные');
    const result = await client.withFallback(() => Promise.resolve('реальные'), mock);
    expect(result).toBe('мок-данные');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('сконфигурирован и call() успешен → отдаёт реальные данные', async () => {
    const client = await loadClient('/');
    const result = await client.withFallback(() => Promise.resolve('реальные'), () => 'мок-данные');
    expect(result).toBe('реальные');
  });

  it('сконфигурирован, но call() падает → откатывается на мок', async () => {
    const client = await loadClient('/');
    const result = await client.withFallback(
      () => Promise.reject(new Error('нет сети')),
      () => 'мок-данные',
    );
    expect(result).toBe('мок-данные');
  });
});
