import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ============================================================
   Тесты для AiBox — встраиваемого мини-чата раздела страницы.

   llmReady() внутри AiBox читает AI_GATEWAY_CONFIGURED из llm.ts,
   которое фиксируется при загрузке модуля из import.meta.env —
   поэтому, как и в llm.test.ts, каждый тест явно задаёт нужный режим
   через vi.stubEnv + resetModules() и заново импортирует AiBox.
   ============================================================ */

async function loadAiBox(aiEnabled: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_AI_ENABLED', aiEnabled ?? '');
  const mod = await import('./aibox');
  return mod.AiBox;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(frames[i]));
      i++;
    },
  });
  return new Response(body, { status: 200 });
}

describe('AiBox — демо-режим (ai-gateway не сконфигурирован)', () => {
  it('рендерит заголовок, placeholder и быстрые подсказки', async () => {
    const AiBox = await loadAiBox(undefined);
    render(<AiBox title="Финансовый ассистент" placeholder="Спросите про финансы" quick={['Кто должник?']} page="finance" />);
    expect(screen.getByText('Финансовый ассистент')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Спросите про финансы')).toBeInTheDocument();
    expect(screen.getByText('Кто должник?')).toBeInTheDocument();
    expect(screen.getByText('демо')).toBeInTheDocument();
  });

  it('отправка вопроса показывает fallback-ответ, если он передан', async () => {
    const AiBox = await loadAiBox(undefined);
    const fallback = vi.fn((q: string) => `Демо-ответ на «${q}»`);
    render(<AiBox title="Т" placeholder="P" page="finance" fallback={fallback} />);

    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'сколько должников?' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);

    expect(await screen.findByText('сколько должников?')).toBeInTheDocument();
    expect(await screen.findByText('Демо-ответ на «сколько должников?»')).toBeInTheDocument();
    expect(fallback).toHaveBeenCalledWith('сколько должников?');
  });

  it('без fallback показывает стандартное сообщение демо-режима', async () => {
    const AiBox = await loadAiBox(undefined);
    render(<AiBox title="Т" placeholder="P" page="finance" />);
    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'привет' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);
    expect(await screen.findByText(/Демо-режим/)).toBeInTheDocument();
  });

  it('клик по быстрой подсказке отправляет её как вопрос', async () => {
    const AiBox = await loadAiBox(undefined);
    render(<AiBox title="Т" placeholder="P" page="finance" quick={['Кто в зоне риска?']} fallback={() => 'ответ'} />);
    fireEvent.click(screen.getByText('Кто в зоне риска?'));
    expect(await screen.findByText('ответ')).toBeInTheDocument();
  });

  it('история изолирована по page (sessionStorage) и очищается кнопкой', async () => {
    const AiBox = await loadAiBox(undefined);
    const { unmount } = render(<AiBox title="Т" placeholder="P" page="finance" fallback={() => 'ответ'} />);
    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'вопрос 1' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);
    await screen.findByText('ответ');
    unmount();

    // Переоткрытие того же раздела — история восстанавливается из sessionStorage.
    render(<AiBox title="Т" placeholder="P" page="finance" fallback={() => 'ответ'} />);
    expect(screen.getByText('вопрос 1')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Очистить историю раздела'));
    expect(screen.queryByText('вопрос 1')).not.toBeInTheDocument();
  });
});

describe('AiBox — ai-gateway сконфигурирован', () => {
  it('стримит ответ по частям через onDelta и показывает финальный текст', async () => {
    const AiBox = await loadAiBox('1');
    const fetchSpy = vi.fn<typeof fetch>(async () => sseResponse([
      sseFrame('delta', { text: 'Привет' }),
      sseFrame('delta', { text: ', это NEX' }),
    ]));
    vi.stubGlobal('fetch', fetchSpy);

    render(<AiBox title="Т" placeholder="P" page="finance" />);
    expect(screen.getByText('ИИ')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'кто ты?' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);

    await waitFor(() => expect(screen.getByText('Привет, это NEX')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v1/ai/stream');
  });

  it('при провале стрима без единого дельта-байта откатывается на /ask', async () => {
    const AiBox = await loadAiBox('1');
    const fetchSpy = vi.fn()
      .mockImplementationOnce(async () => new Response('', { status: 500 })) // /stream падает
      .mockImplementationOnce(async () => new Response(JSON.stringify({ text: 'ответ через /ask' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    render(<AiBox title="Т" placeholder="P" page="finance" />);
    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'вопрос' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);

    await waitFor(() => expect(screen.getByText('ответ через /ask')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/api/v1/ai/ask');
  });

  it('при провале и /stream, и /ask откатывается на демо-фолбэк', async () => {
    const AiBox = await loadAiBox('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));

    render(<AiBox title="Т" placeholder="P" page="finance" fallback={() => 'локальный мок'} />);
    fireEvent.change(screen.getByPlaceholderText('P'), { target: { value: 'вопрос' } });
    fireEvent.submit(screen.getByPlaceholderText('P').closest('form')!);

    expect(await screen.findByText('локальный мок')).toBeInTheDocument();
  });
});
