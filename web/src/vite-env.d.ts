/// <reference types="vite/client" />

// Типы переменных окружения Vite, доступных во фронтенде через
// import.meta.env. Определены явно, чтобы `tsc --noEmit` (npm run lint)
// проходил независимо от разрешения типов vite/client.
interface ImportMetaEnv {
  /**
   * Базовый URL бэкенда nexd. Пусто/не задано — фронтенд работает на
   * встроенных моках (демо-режим). Значение `/` — тот же origin
   * (когда бэкенд проксируется перед фронтендом).
   * Пример: https://nex-api.example.com
   */
  readonly VITE_API_URL?: string;

  /**
   * Включает ИИ-слой (см. ai-gateway/README.md). Это ФЛАГ, не URL:
   * браузер обращается только к nexd (VITE_API_URL) — nexd сам
   * проксирует запрос в ai-gateway, см. web/src/llm.ts и
   * internal/platform/httpapi/aiproxy.go. Ключи провайдеров LLM НЕ
   * хранятся во фронтенде — они живут только в переменных окружения
   * ai-gateway.
   * "1" или "true" — включено; пусто/не задано — демо-режим на моках.
   */
  readonly VITE_AI_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
