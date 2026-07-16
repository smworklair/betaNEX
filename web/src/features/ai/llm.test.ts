import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ============================================================
   Тесты для llm.ts — слоя обращений к ai-gateway (через nexd-прокси).

   AI_GATEWAY_CONFIGURED вычисляется один раз при загрузке модуля из
   import.meta.env.VITE_AI_ENABLED, поэтому каждый тест сам явно
   задаёт нужное значение через vi.stubEnv + vi.resetModules() и
   заново импортирует модуль — так тест не зависит от локального
   web/.env разработчика (там обычно VITE_AI_ENABLED=1 для ручной
   проверки в браузере).
   ============================================================ */

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= frames.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(frames[i]));
      i++;
    },
  });
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function loadLlm(aiEnabled: string | undefined) {
  vi.resetModules();
  if (aiEnabled === undefined) vi.stubEnv('VITE_AI_ENABLED', '');
  else vi.stubEnv('VITE_AI_ENABLED', aiEnabled);
  return import('./llm');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('шлюз не сконфигурирован (VITE_AI_ENABLED не 1/true)', () => {
  it('AI_GATEWAY_CONFIGURED === false и llmReady() === false', async () => {
    const llm = await loadLlm(undefined);
    expect(llm.AI_GATEWAY_CONFIGURED).toBe(false);
    expect(llm.llmReady()).toBe(false);
  });

  it('llmAsk бросает без обращения к сети', async () => {
    const llm = await loadLlm(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(llm.llmAsk('привет')).rejects.toThrow('gateway-not-configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('llmAskStream бросает LlmStreamError без обращения к сети', async () => {
    const llm = await loadLlm(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(llm.llmAskStream('привет', {}, () => {})).rejects.toBeInstanceOf(llm.LlmStreamError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checkGateway() === false без обращения к сети', async () => {
    const llm = await loadLlm(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(llm.checkGateway()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('llmAsk (шлюз сконфигурирован)', () => {
  it('отправляет message/history/system/context/provider и возвращает text', async () => {
    const llm = await loadLlm('1');
    llm.setProvider('gemini');
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ text: '  ответ  ' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await llm.llmAsk('вопрос', {
      system: 'ты — ассистент',
      history: [{ role: 'user', text: 'привет' }, { role: 'model', text: 'здравствуйте' }],
      context: { page: 'finance', title: 'Финансы', facts: ['долг 100'] },
    });

    expect(result).toBe('ответ');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/ai/ask');
    expect(init!.credentials).toBe('include');
    const body = JSON.parse(init!.body as string);
    expect(body.message).toBe('вопрос');
    expect(body.system).toBe('ты — ассистент');
    expect(body.context).toEqual({ page: 'finance', title: 'Финансы', facts: ['долг 100'] });
    expect(body.provider).toBe('gemini');
    expect(body.history).toEqual([
      { role: 'user', content: 'привет' },
      { role: 'assistant', content: 'здравствуйте' },
    ]);
  });

  it('бросает gateway-{status} при не-200 ответе', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(llm.llmAsk('вопрос')).rejects.toThrow('gateway-429');
  });

  it('бросает gateway-empty при пустом text', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 })));
    await expect(llm.llmAsk('вопрос')).rejects.toThrow('gateway-empty');
  });
});

describe('llmAskStream (шлюз сконфигурирован)', () => {
  it('вызывает onDelta по мере поступления кусков и возвращает полный текст', async () => {
    const llm = await loadLlm('1');
    const body = sseStream([
      sseFrame('delta', { text: 'Привет' }),
      sseFrame('delta', { text: ', мир' }),
      sseFrame('usage', { prompt_tokens: 10 }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const deltas: string[] = [];
    const result = await llm.llmAskStream('вопрос', {}, (d) => deltas.push(d));

    expect(deltas).toEqual(['Привет', ', мир']);
    expect(result).toBe('Привет, мир');
  });

  it('при ошибке ПОСЛЕ уже полученного текста возвращает частичный результат, а не бросает', async () => {
    const llm = await loadLlm('1');
    const body = sseStream([
      sseFrame('delta', { text: 'Часть ответа' }),
      sseFrame('error', { detail: 'провайдер упал' }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const result = await llm.llmAskStream('вопрос', {}, () => {});
    expect(result).toBe('Часть ответа');
  });

  it('бросает LlmStreamError(detail), если ошибка пришла до первого дельта-события', async () => {
    const llm = await loadLlm('1');
    const body = sseStream([sseFrame('error', { detail: 'бюджет исчерпан' })]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    await expect(llm.llmAskStream('вопрос', {}, () => {})).rejects.toThrow('бюджет исчерпан');
  });

  it('бросает LlmStreamError при не-200 ответе', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(llm.llmAskStream('вопрос', {}, () => {})).rejects.toBeInstanceOf(llm.LlmStreamError);
  });

  it('бросает LlmStreamError при сетевой ошибке fetch', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(llm.llmAskStream('вопрос', {}, () => {})).rejects.toBeInstanceOf(llm.LlmStreamError);
  });
});

describe('checkGateway / fetchProviders (шлюз сконфигурирован)', () => {
  it('checkGateway() === true при 200 OK', async () => {
    const llm = await loadLlm('true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await expect(llm.checkGateway()).resolves.toBe(true);
  });

  it('checkGateway() === false при не-200 и при исключении', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(llm.checkGateway()).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(llm.checkGateway()).resolves.toBe(false);
  });

  it('fetchProviders() возвращает разобранный JSON', async () => {
    const llm = await loadLlm('1');
    const payload = { providers: ['gemini', 'openai'], default: 'gemini' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
    await expect(llm.fetchProviders()).resolves.toEqual(payload);
  });

  it('fetchProviders() бросает providers-{status} при ошибке', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(llm.fetchProviders()).rejects.toThrow('providers-403');
  });
});

describe('llmPlan', () => {
  it('разбирает ответ модели на 2-5 шагов, убирая маркеры списка', async () => {
    const llm = await loadLlm('1');
    const text = '1. Собрать данные\n2. Проверить расчёты\n- Сформировать отчёт\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text }), { status: 200 })));

    const steps = await llm.llmPlan('подготовить отчёт');
    expect(steps).toEqual(['Собрать данные', 'Проверить расчёты', 'Сформировать отчёт']);
  });

  it('бросает bad-plan, если шагов меньше двух', async () => {
    const llm = await loadLlm('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'один шаг' }), { status: 200 })));
    await expect(llm.llmPlan('задача')).rejects.toThrow('bad-plan');
  });
});
