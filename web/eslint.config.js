// Конфигурация ESLint (flat config, ESLint 9+) для web/src.
// Минимальный набор: рекомендованные правила TypeScript-ESLint + правила
// хуков React (rules-of-hooks — обязательные, exhaustive-deps — предупреждение,
// т.к. в проекте есть осознанные [] с обращением к внешнему состоянию).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // В проекте принят `cond ? a() : b()` как statement для условного
      // побочного эффекта (без промежуточной if/else) — разрешаем явно,
      // а не переписываем рабочий код под дефолт правила.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
    },
  },
);
