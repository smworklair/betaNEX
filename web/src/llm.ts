/* ============================================================
   LLM-слой NEX — единая точка входа к ai-gateway (бэкенд, ai-gateway/).

   ДО этой задачи фронтенд ходил напрямую в Gemini/OpenAI-совместимый
   API из браузера, а ключ пользователь вводил в Настройках и он жил в
   localStorage (см. историю в docs/ai/README.md, §1 — "как это было").

   ПОСЛЕ этой задачи браузер больше не обращается к ai-gateway напрямую
   ДАЖЕ по URL шлюза — только к своему же nexd, тем же origin и той же
   cookie-сессией, что и весь остальной /api/v1/*. Причина: у ai-gateway
   нет своей аутентификации, только заголовок X-Tenant-Id — если бы
   браузер слал его сам, это было бы самопредставление клиента (любой
   мог бы вписать чужого тенанта и кататься на его бюджете). nexd
   проксирует /api/v1/ai/* (см. internal/platform/httpapi/aiproxy.go),
   сам подставляя tenant_id из аутентифицированной сессии и подписывая
   запрос секретом, общим с ai-gateway (NEX_AI_GATEWAY_SECRET) — так
   заголовок подделать с уровня браузера уже нельзя.

   Конфигурация — VITE_AI_ENABLED (флаг, НЕ url — url ai-gateway теперь
   знает только nexd, см. NEX_AI_GATEWAY_URL в корневом .env.example):
     • не "1"/"true" → демо-режим: ИИ выключен, все точки входа
       (Chat.tsx, ai.tsx, aibox.tsx) сами откатываются на локальный мок
       (nexReply/fallback), сеть не трогаем;
     • "1" или "true" → реальные вызовы через nexd → ai-gateway.
   ============================================================ */

import { API_BASE } from './api/client';

const RAW_ENABLED = (import.meta.env.VITE_AI_ENABLED ?? '').trim().toLowerCase();

/** Сконфигурирован ли ИИ-слой — если нет, весь слой отдаёт моки. */
export const AI_GATEWAY_CONFIGURED = RAW_ENABLED === '1' || RAW_ENABLED === 'true';

/** Базовый URL — тот же origin, что и у остального API (см. api/client.ts):
    ИИ-запросы идут через nexd, а не напрямую в ai-gateway. */
export const AI_GATEWAY_BASE = API_BASE;

/** Имя провайдера на ai-gateway (см. ai-gateway/app/api/schemas.py:ProviderName). */
export type LlmProvider = 'gemini' | 'custom' | 'openai' | 'deepseek' | 'qwen' | 'kimi' | 'gigachat' | 'yandexgpt';

const store = {
  get: (k: string, def = '') => localStorage.getItem(k) ?? def,
  set: (k: string, v: string) => (v.trim() ? localStorage.setItem(k, v.trim()) : localStorage.removeItem(k)),
};

/* --- выбор провайдера: только предпочтение, БЕЗ ключей — ключи теперь
   только на сервере ai-gateway (см. .env.example там же). Пустая строка
   означает "пусть шлюз возьмёт провайдера по умолчанию из своего конфига". --- */
export const getProvider = (): LlmProvider | '' => (store.get('nex-llm-provider') as LlmProvider | '') || '';
export const setProvider = (p: LlmProvider | '') => store.set('nex-llm-provider', p);

/** ИИ готов отвечать — то есть шлюз сконфигурирован. Ключей проверять больше не нужно. */
export const llmReady = () => AI_GATEWAY_CONFIGURED;

/** Системный контекст NEX — личность + данные организации.
    Используется ГЛАВНЫМ чатом (Chat.tsx) как явный system-override —
    он не завязан на один раздел фронтенда, в отличие от мини-чатов на
    страницах (AiBox/InlinePanel), которые вместо этого шлют `context`
    (page/facts) и получают промпт раздела с сервера, см. PageContext
    ниже и ai-gateway/app/core/context_registry.py.
    BACKEND: данные заменяются на RAG по реальной БД. */
export const ORG_CONTEXT = `
Ты — NEX (Neural Executive eXpert), интеллектуальный помощник корпоративной информационной системы колледжа.

Форматирование: можешь использовать markdown — **жирный** для акцентов, списки (- или 1.), короткие заголовки. Не злоупотребляй.

Ты встроен непосредственно в систему и являешься её интеллектуальным аналитическим центром. Пользователь общается не с обычным чат-ботом, а с ИИ всей информационной системы.

=== ОСНОВНАЯ ЗАДАЧА ===

Помогай пользователю:

• анализировать данные;
• искать причины проблем;
• объяснять показатели;
• находить риски;
• принимать решения;
• работать со всеми разделами системы;
• строить планы действий;
• объяснять сложные вещи простым языком.

=== РЕЖИМЫ РАБОТЫ ===

Сам определяй режим ответа.

1. ОБЩЕНИЕ

Если пользователь пишет:

- привет
- как дела
- спасибо
- что умеешь
- кто ты

отвечай естественно, дружелюбно и кратко.

Не начинай перечислять показатели колледжа без причины.

--------------------------------

2. АНАЛИТИКА

Если вопрос относится к данным организации:

- сначала сделай вывод;
- затем объясни причины;
- потом предложи возможные действия.

Не ограничивайся перечислением цифр.

Ищи взаимосвязи между событиями.

Если существует несколько возможных причин — перечисли их по вероятности.

--------------------------------

3. КОНСУЛЬТАЦИЯ

Если пользователь спрашивает:

- как пользоваться системой;
- где находится функция;
- как выполнить действие;

объясняй пошагово.

--------------------------------

4. ОБЩИЕ ВОПРОСЫ

Если вопрос не относится к колледжу (например программирование, ИИ, математика, история, технологии или другие знания),

можешь спокойно ответить.

После ответа НЕ нужно постоянно переводить разговор обратно к колледжу.

=== ПРАВИЛА ===

Не выдумывай данные.

Используй только предоставленный контекст.

Если информации недостаточно — прямо скажи об этом.

Не выдавай предположения за факты.

Если пользователь просит анализ — объясняй причины, последствия и варианты решения.

Если данных недостаточно для вывода — сообщай об этом честно.

=== СТИЛЬ ===

Будь естественным.

Не используй канцелярский язык.

Не повторяй постоянно:

"Я встроенный ИИ..."

"Я не могу..."

"Я не обрабатываю..."

Избегай шаблонных отказов.

Отвечай так, будто являешься профессиональным корпоративным помощником.

=== ДЛИНА ОТВЕТОВ ===

Приветствия:
1–2 предложения.

Обычные вопросы:
2–5 предложений.

Анализ:
5–10 предложений.

Планы:
списком.

Отчёты:
структурировано.

=== ДАННЫЕ ОРГАНИЗАЦИИ (демо) ===

Студентов: 100.

Средний балл: 4.2.

Посещаемость: 91%.

За неделю снижение на 2%.

Основной вклад внесла группа ПИ-21-1.

В зоне риска:

• Волкова О. (66%)
• Новиков
• Петрова
• Зайцева

Финансы:

• задолженность 248 000 ₽;
• снижение задолженности на 12% за неделю;
• 8 должников;
• 3 аномальных платежа.

Безопасность:

• 12 неудачных входов с IP 45.9.148.3;
• вероятен подбор пароля;
• аудит целостности без нарушений.

Расписание:

• конфликтов нет;
• свободно окно:
Понедельник 12:00,
аудитория 305.

Приёмная комиссия:

• 3 новых заявления;
• найден возможный дубликат.

Выпуск:

• 5 студентов ещё не готовы к выпуску.

Кампус:

• стажировка VK через 2 дня;
• грант 500 000 ₽ через 5 дней;
• хакатон по ИИ через 7 дней.

=== ДОСТУПНЫЕ РАЗДЕЛЫ ===

Командный центр.

Студенты.

Группы.

Приём.

Расписание.

Журнал.

Посещаемость.

Финансы.

Стипендии.

Сотрудники.

Аналитика.

Выпуск.

Безопасность.

Кампус.

Агенты.

=== ГЛАВНОЕ ===

Твоя цель — быть полезным интеллектуальным помощником, а не отвечать шаблонными фразами.

Используй контекст только тогда, когда он действительно относится к вопросу пользователя.
`;

export interface LlmTurn { role: 'user' | 'model'; text: string; }

/** Контекст страницы — откуда открыт мини-чат. Сервер (ai-gateway)
    превращает `page` в ролевую инструкцию, а `facts`/`state` подмешивает
    как данные экрана (см. ai-gateway/app/core/context_registry.py). */
export interface PageContext {
  page: string;
  title?: string;
  facts?: string[];
  state?: string;
}

interface AskOpts { system?: string; history?: LlmTurn[]; context?: PageContext; }

const withTimeout = async (ms: number, run: (signal: AbortSignal) => Promise<Response>) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await run(ctrl.signal); } finally { clearTimeout(timer); }
};

/** Единая точка входа: спросить ai-gateway. Бросает исключение при
    ошибке/не-конфигурации — вызывающий код обязан откатиться на
    локальный мок (nexbrain/fallback), см. вызовы llmAsk по проекту. */
export async function llmAsk(user: string, opts: AskOpts = {}): Promise<string> {
  if (!AI_GATEWAY_CONFIGURED) throw new Error('gateway-not-configured');

  const history = (opts.history || []).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }));
  const body: Record<string, unknown> = { message: user, history };
  if (opts.system) body.system = opts.system;
  if (opts.context) body.context = opts.context;
  const provider = getProvider();
  if (provider) body.provider = provider;

  const res = await withTimeout(45000, (signal) => fetch(`${AI_GATEWAY_BASE}/api/v1/ai/ask`, {
    method: 'POST',
    signal,
    credentials: 'include', // сессия nexd — прокси требует аутентифицированного актора
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error(`gateway-${res.status}`);
  const data = await res.json();
  const text: string = data?.text || '';
  if (!text.trim()) throw new Error('gateway-empty');
  return text.trim();
}

/** Список провайдеров, реально настроенных на сервере — для выбора в
    Настройках (никаких ключей на клиенте, только имена). */
export interface GatewayProviders { providers: LlmProvider[]; default: LlmProvider; }
export async function fetchProviders(): Promise<GatewayProviders> {
  const res = await fetch(`${AI_GATEWAY_BASE}/api/v1/ai/providers`, { credentials: 'include' });
  if (!res.ok) throw new Error(`providers-${res.status}`);
  return res.json();
}

/** Проверка, что шлюз вообще отвечает — для индикатора статуса в Настройках. */
export async function checkGateway(): Promise<boolean> {
  if (!AI_GATEWAY_CONFIGURED) return false;
  try {
    const res = await withTimeout(5000, (signal) => fetch(`${AI_GATEWAY_BASE}/api/v1/ai/healthz`, {
      signal,
      credentials: 'include',
    }));
    return res.ok;
  } catch { return false; }
}

/** План задачи (для «Поручить NEX»): просим модель список шагов. */
export async function llmPlan(task: string): Promise<string[]> {
  const text = await llmAsk(
    `Составь план выполнения задачи в системе колледжа: «${task}». Ответь ТОЛЬКО списком из 3-5 коротких шагов, каждый с новой строки, без нумерации и пояснений.`,
  );
  const steps = text.split('\n').map((s) => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter((s) => s.length > 3).slice(0, 5);
  if (steps.length < 2) throw new Error('bad-plan');
  return steps;
}
