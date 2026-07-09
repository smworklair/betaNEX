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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
