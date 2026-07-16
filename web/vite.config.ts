import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {loadEnv} from 'vite';
// defineConfig из vitest/config — надмножество конфига vite с типом
// поля `test` ниже; сам vitest.config.ts не заводим, чтобы не держать
// два файла конфигурации в синхроне (plugins/alias общие для dev и тестов).
// loadEnv импортируем из 'vite' напрямую — vitest/config его не реэкспортирует.
import {defineConfig} from 'vitest/config';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Локальная разработка «фронт+бэк» на одном origin: /api/* → nexd.
      // Так фронт с пустым VITE_API_URL ходит на реальный бэкенд без CORS.
      // Адрес nexd переопределяется через NEX_DEV_PROXY (по умолчанию :8080).
      proxy: {
        '/api': {
          target: env.NEX_DEV_PROXY || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
