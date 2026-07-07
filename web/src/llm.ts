/* ============================================================
   LLM-слой NEX — два провайдера на выбор (Настройки → Интеллект):
   1) Gemini (Google, gemini-2.5-flash)
   2) LLM API — любой OpenAI-совместимый endpoint (/chat/completions)

   Ключи вводятся в Настройках и хранятся ТОЛЬКО в localStorage
   браузера — в репозиторий и на сервер не попадают.
   BACKEND: в проде этот файл заменяется на вызов /api/nex,
   где ключ лежит в переменной окружения, а не у клиента.
   ============================================================ */

const GEMINI_MODEL = 'gemini-2.5-flash';

export type LlmProvider = 'gemini' | 'custom';

const store = {
  get: (k: string, def = '') => localStorage.getItem(k) ?? def,
  set: (k: string, v: string) => (v.trim() ? localStorage.setItem(k, v.trim()) : localStorage.removeItem(k)),
};

/* --- активный провайдер --- */
export const getProvider = (): LlmProvider => (store.get('nex-llm-provider') === 'custom' ? 'custom' : 'gemini');
export const setProvider = (p: LlmProvider) => store.set('nex-llm-provider', p);

/* --- Gemini --- */
export const getGeminiKey = () => store.get('nex-gemini-key');
export const setGeminiKey = (k: string) => store.set('nex-gemini-key', k);

/* --- LLM API (OpenAI-совместимый) --- */
export const CUSTOM_DEFAULT_URL = 'https://llm-api.fun/v1';
export const CUSTOM_DEFAULT_MODEL = 'agent';
export const getCustomKey = () => store.get('nex-custom-key');
export const setCustomKey = (k: string) => store.set('nex-custom-key', k);
export const getCustomUrl = () => store.get('nex-custom-url', CUSTOM_DEFAULT_URL);
export const setCustomUrl = (u: string) => store.set('nex-custom-url', u.replace(/\/+$/, ''));
export const getCustomModel = () => store.get('nex-custom-model', CUSTOM_DEFAULT_MODEL);
export const setCustomModel = (m: string) => store.set('nex-custom-model', m);

/** Активный провайдер настроен и готов отвечать. */
export const llmReady = () =>
  getProvider() === 'custom' ? getCustomKey().length > 5 : getGeminiKey().length > 10;

/** Системный контекст NEX — личность + данные организации.
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
interface AskOpts { system?: string; history?: LlmTurn[]; }

const withTimeout = async (ms: number, run: (signal: AbortSignal) => Promise<Response>) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await run(ctrl.signal); } finally { clearTimeout(timer); }
};

/* --- путь 1: Gemini generateContent --- */
async function askGemini(user: string, opts: AskOpts, key = getGeminiKey()): Promise<string> {
  if (!key) throw new Error('no-key');
  const contents = [
    ...(opts.history || []).map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: user }] },
  ];
  const res = await withTimeout(40000, (signal) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system || ORG_CONTEXT }] },
      contents,
      /* лёгкое «мышление» ради связности, но без долгих пауз */
      generationConfig: { temperature: 0.75, topP: 0.95, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 256 } },
    }),
  }));
  if (!res.ok) throw new Error(`gemini-${res.status}`);
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error('gemini-empty');
  return text.trim();
}

/* --- путь 2: OpenAI-совместимый /chat/completions (LLM API) --- */
async function askCustom(user: string, opts: AskOpts, key = getCustomKey(), url = getCustomUrl(), model = getCustomModel()): Promise<string> {
  if (!key) throw new Error('no-key');
  const messages = [
    { role: 'system', content: opts.system || ORG_CONTEXT },
    ...(opts.history || []).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
    { role: 'user', content: user },
  ];
  const res = await withTimeout(60000, (signal) => fetch(`${url}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.75, max_tokens: 2048 }),
  }));
  if (!res.ok) throw new Error(`custom-${res.status}`);
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('custom-empty');
  return text.trim();
}

/** Единая точка входа: спросить активного провайдера. Бросает исключение
    при ошибке — вызывающий код обязан откатиться на локальный мок (nexbrain). */
export async function llmAsk(user: string, opts: AskOpts = {}): Promise<string> {
  return getProvider() === 'custom' ? askCustom(user, opts) : askGemini(user, opts);
}

/** Проверка ключа из Настроек: короткий дешёвый запрос выбранному провайдеру. */
export async function testLlmKey(provider: LlmProvider, key: string, url?: string, model?: string): Promise<boolean> {
  try {
    if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.trim() },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 5 } }),
      });
      return res.ok;
    }
    const text = await askCustom('Ответь одним словом: ок', {}, key.trim(), (url || CUSTOM_DEFAULT_URL).replace(/\/+$/, ''), model || CUSTOM_DEFAULT_MODEL);
    return text.length > 0;
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
