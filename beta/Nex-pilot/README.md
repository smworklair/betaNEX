# Nex-pilot — учебный ассистент поверх FrankAI

Nex-pilot — тонкий слой оркестрации: принимает сообщение пользователя,
собирает промпт из шаблона и памяти диалога, передаёт его в "движок"
генерации (по умолчанию — [`FrankAI`](../FrankAI), собственный учебный
прототип модели из соседней папки), сохраняет обмен репликами и
возвращает ответ. Сам движок ничего не знает ни про историю диалога,
ни про системный промпт — это ровно то, что добавляет Nex-pilot.

**Это учебный прототип, не production-ассистент.** Качество ответов
целиком зависит от выбранного backend'а: с FrankAI (по умолчанию) это
показ МЕХАНИЗМА (промпт-шаблон + память + вызов модели), а не
содержательный диалог — см. честную оценку качества в
[`../FrankAI/README.md`](../FrankAI/README.md#честная-оценка-качества-пожалуйста-прочитайте-перед-тем-как-расстраиваться).

## Два backend'а

| Backend | Что вызывает | Нужна сеть/ключи? | Качество ответов |
|---|---|---|---|
| `frankai` (по умолчанию) | Локальный `FrankAI.generate()` | Нет | Учебное — см. оговорку выше |
| `gateway` | Уже готовый [`ai-gateway`](../../ai-gateway) → настоящий Gemini/OpenAI-совместимый API | Да (нужен запущенный ai-gateway + ключ провайдера) | Настоящее (LLM отвечает по-настоящему) |

Оба backend'а реализуют один и тот же интерфейс
`Backend.generate(prompt) -> str` (`nexpilot/backends/base.py`) — тот же
приём, что `LLMProvider` в `ai-gateway` и `Engine` в `FrankAI`. Верхний
слой (`assistant.py`, `cli.py`) не знает и не должен знать, какой из
них перед ним.

## Установка и запуск

Требуется Python 3.11+ и папка `../FrankAI` рядом (структура `beta/FrankAI` + `beta/Nex-pilot`).

```sh
cd beta/Nex-pilot
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt   # поставит FrankAI editable-пакетом из ../FrankAI + httpx
```

Запуск чат-REPL (backend по умолчанию — `frankai`):

```sh
python -m nexpilot.cli
```

При первом запуске FrankAI обучится на встроенном корпусе (несколько
секунд) и сохранит веса в `../FrankAI/weights/` — повторные запуски
будут мгновенными.

Пример сессии:

```
[nexpilot] backend=frankai, веса: .../FrankAI/weights/frankai_weights.npz
[nexpilot] FrankAI готов.
Nex-pilot (backend=frankai). Пустая строка, 'exit' или 'quit' — выход.
Вы: привет
Nex-pilot: ...текст, сгенерированный FrankAI, не ждите связного ответа...
Вы: exit
```

Через `ai-gateway` (нужен отдельно запущенный сервис, см.
[`../../ai-gateway/README.md`](../../ai-gateway/README.md)):

```sh
# в другом терминале: cd ai-gateway && uvicorn app.main:app --port 8090
python -m nexpilot.cli --backend gateway
```

## Программный интерфейс

```python
import asyncio
from frankai import FrankAI
from nexpilot.assistant import NexPilot
from nexpilot.backends.frankai_backend import FrankAIBackend

engine = FrankAI.load_or_train(
    "../FrankAI/weights/frankai_weights.npz",
    "../FrankAI/frankai/data/sample_corpus.txt",
)
pilot = NexPilot(FrankAIBackend(engine))

reply = asyncio.run(pilot.ask("Привет"))
print(reply)
```

## Что добавляет Nex-pilot поверх голого `generate()`

- **Промпт-шаблон** (`nexpilot/prompts.py`) — системная преамбула +
  история + новое сообщение, собранные в один текст перед вызовом
  backend'а.
- **Память диалога** (`nexpilot/memory.py`) — последние `max_turns`
  реплик (по умолчанию 6), только в памяти процесса; при перезапуске
  теряется. Не персистентность ради полноты, а минимум, чтобы диалог
  вообще имел контекст.
- **Единый вызов** (`nexpilot/assistant.py`) — `NexPilot.ask()` связывает
  шаблон, память и backend в одну точку входа.

Специально НЕ реализовано (за рамками учебной задачи): персистентность
памяти между запусками, несколько параллельных диалогов/пользователей,
RBAC/аудит (см. `docs/ai/README.md` в корне репозитория — там это
описано как план для настоящей интеграции AI в NEX).

## Конфигурация

Все переменные — в [`.env.example`](.env.example); для CLI ничего
настраивать не обязательно, есть разумные значения по умолчанию.

| Переменная | Назначение |
|---|---|
| `NEXPILOT_BACKEND` | `frankai` (по умолчанию) или `gateway`. Перебивается флагом `--backend`. |
| `FRANKAI_WEIGHTS_PATH` / `FRANKAI_CORPUS_PATH` | Пути к весам/корпусу FrankAI; по умолчанию — `../FrankAI/...`. |
| `FRANKAI_MAX_NEW_TOKENS` | Сколько символов генерировать за один ответ. |
| `AI_GATEWAY_URL` / `AI_GATEWAY_TENANT_ID` | Только для `backend=gateway` — адрес сервиса и (опционально) тенант для бюджетов ai-gateway. |
| `AI_GATEWAY_SECRET` | Только если на ai-gateway настроен `NEX_AI_GATEWAY_SECRET` — то же значение, см. ниже. |
| `AI_GATEWAY_PROVIDER` | Опционально: какой провайдер ai-gateway использовать (`gemini`/`deepseek`/`kimi`/...); пусто — решает сам ai-gateway. |

### `GatewayBackend` и схема безопасности ai-gateway

`ai-gateway` теперь ожидает, что запрос либо приходит через `nexd`
(браузер → `nexd` → `ai-gateway`, см. `docs/ai/README.md` в корне
репозитория), либо от другого доверенного server-side клиента, который
сам подписывает запрос общим секретом (`X-Gateway-Secret`) — именно так
`nexd` и делает (`internal/platform/httpapi/aiproxy.go`). Nex-pilot —
CLI-утилита, а не браузер, и подключается ко второй категории: если в
`ai-gateway/.env` задан `NEX_AI_GATEWAY_SECRET`, задайте то же значение
в `AI_GATEWAY_SECRET` здесь — `GatewayBackend` отправит его заголовком
`X-Gateway-Secret`. На локальном дев-стенде без секрета (по умолчанию)
ничего настраивать не нужно — заголовок просто не отправляется, как и
раньше.

## Структура файлов

```
beta/Nex-pilot/
├── nexpilot/
│   ├── __init__.py
│   ├── cli.py                    # REPL: python -m nexpilot.cli
│   ├── assistant.py               # NexPilot.ask() — оркестрация
│   ├── prompts.py                 # PromptTemplate
│   ├── memory.py                  # ConversationMemory
│   ├── config.py                  # конфиг из переменных окружения
│   └── backends/
│       ├── base.py                  # интерфейс Backend
│       ├── frankai_backend.py       # оборачивает FrankAI (sync -> asyncio.to_thread)
│       └── gateway_backend.py        # HTTP-клиент к ai-gateway (httpx, ленивый импорт)
├── .env.example
├── .gitignore
├── pyproject.toml
├── requirements.txt              # включает `-e ../FrankAI`
└── README.md
```

## Связанные документы

- [`../FrankAI`](../FrankAI) — движок генерации по умолчанию; там же —
  честная оценка качества, которую стоит прочитать перед тем, как
  судить об ответах Nex-pilot.
- [`../../ai-gateway`](../../ai-gateway) — сервис, который использует
  `backend=gateway`; там же — бюджеты по тенантам, rate-limit, реальные
  провайдеры.
- [`../../docs/ai/README.md`](../../docs/ai/README.md) — как AI
  интеграция задумана для настоящего NEX (Go); `beta/` — не часть этого
  плана, а отдельная учебная песочница рядом.
