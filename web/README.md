# web/ — фронтенд NEX

Сейчас здесь лежит **визуальный прототип «КИС Колледж»** (React + Vite), перенесённый из корня репозитория. Он служит референсом дизайна и **не является** целевой архитектурой фронтенда.

По роадмапу (веха M7, см. `../docs/roadmap.md`) прототип будет заменён новым приложением: Vite + TypeScript strict + TanStack Router/Query + Zustand + Tailwind v4 + shadcn/ui, работающим против OpenAPI-контракта из `../api/openapi.yaml`.

## Запуск прототипа

```sh
cd web
npm install   # позже: pnpm install
npm run dev   # http://localhost:3000
```

Прототип обращается к Gemini API — ключ задаётся в `.env` (см. `.env.example`). К бэкенду nexd он пока не подключён.
