# tools/ — dev-скрипты (Python)

Скрипты для работы с запущенным dev-сервером через HTTP API. Только
стандартная библиотека Python 3.10+ — ничего ставить не нужно.

Подготовка (один раз):

```sh
make dev && make run                          # Postgres + nexd
go run ./cmd/nexd tenant create college-1 "Колледж №1"
```

## api_smoke.py — функциональный смоук API

Сквозной сценарий по модулям «Задачи» и «Кампус»: создание, поиск,
смена статусов, ошибки валидации. Ненулевой код выхода при провале —
можно вешать в CI поверх поднятого окружения.

```sh
python3 tools/api_smoke.py                    # или: make smoke-api
python3 tools/api_smoke.py --base-url http://localhost:8080 --tenant college-1
```

Дополняет `load/smoke.js` (k6, см. `load/README.md`): тот меряет
латентность под нагрузкой, этот проверяет поведение.

## seed_demo.py — демо-данные

Наполняет tenant группами, студентами, оценками и задачами через те же
командные эндпоинты, что и UI, — данные проходят валидацию и аудит.

```sh
python3 tools/seed_demo.py                    # или: make seed
python3 tools/seed_demo.py --groups 3 --students-per-group 5 --tasks 20 --seed 42
```

## nex_api.py — общий клиент

Мини-клиент API с dev-авторизацией (заголовки `X-Dev-*`, работают только
в `NEX_ENV=development`). Используется скриптами выше; годится как основа
для новых утилит:

```python
from nex_api import NexAPI
api = NexAPI(tenant="college-1")
print(api.get("/api/v1/tasks", status="open"))
```
