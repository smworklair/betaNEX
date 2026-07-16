// Смоук-нагрузка k6 (веха M8): базовая проверка, что сервис держит
// умеренный поток запросов без ошибок и с приличной латентностью.
//
// Дополняет tools/api_smoke.py: тот проверяет ПОВЕДЕНИЕ (команды,
// статусы ошибок), этот меряет ЛАТЕНТНОСТЬ/ошибки под нагрузкой на
// реальных бизнес-эндпоинтах, а не только на /healthz.
//
// Подготовка (один раз, см. tools/README.md):
//   make dev && make run
//   go run ./cmd/nexd tenant create college-1 "Колледж №1"
//   make seed          # чтобы GET-эндпоинты отдавали непустые данные
//
// Два режима аутентификации — AUTH_MODE:
//
//   • "dev" (по умолчанию) — заголовки X-Dev-Actor/X-Dev-Roles/X-Dev-Tenant,
//     см. internal/platform/httpapi/devauth.go и tools/nex_api.py. Работают,
//     только если у сервера NEX_ENV=development (умолчание `make run`).
//     Годится для локальной разработки без создания реального пользователя.
//
//   • "session" — настоящий вход через POST /api/v1/auth/login один раз в
//     setup() (не в каждой итерации: login rate-limited 10 попыток/5мин на
//     IP+email, см. internal/platform/httpapi/auth.go:newAuthAPI), дальше
//     httpOnly-cookie сессии передаётся вручную на каждый запрос. Нужен
//     реальный пользователь — единственный способ прогнать смоук против
//     окружения, где DevAuth выключен (staging/прод-подобный стенд).
//
// Запуск:
//   k6 run load/smoke.js                                        # dev-режим
//   BASE_URL=https://staging.example.com \
//   AUTH_MODE=session NEX_TENANT=college-1 \
//   NEX_EMAIL=demo@college-1.test NEX_PASSWORD=... \
//     k6 run load/smoke.js                                      # session-режим
import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  vus: 10, // виртуальных пользователей
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"], // меньше 1% ошибок
    // /healthz — без обращения к БД, поэтому отдельный (более строгий)
    // порог; бизнес-эндпоинты ходят в Postgres и закладывают латентность
    // на порядок выше.
    "http_req_duration{endpoint:healthz}": ["p(95)<100"],
    "http_req_duration{endpoint:business}": ["p(95)<400"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const AUTH_MODE = __ENV.AUTH_MODE || "dev";

const NEX_TENANT = __ENV.NEX_TENANT || "college-1";
const NEX_ACTOR = __ENV.NEX_ACTOR || "dev-admin";
const NEX_ROLES = __ENV.NEX_ROLES || "admin";
const NEX_EMAIL = __ENV.NEX_EMAIL || "";
const NEX_PASSWORD = __ENV.NEX_PASSWORD || "";

// GET-эндпоинты по реальным модулям — намеренно только чтения: POST/PUT/
// DELETE рвут mutationRateLimit (120/мин, см. internal/platform/httpapi/
// ratelimit.go) уже на нескольких VU и засоряли бы данные тенанта при
// повторных прогонах.
const BUSINESS_ENDPOINTS = [
  "/api/v1/tasks",
  "/api/v1/campus/students",
  "/api/v1/campus/groups",
  "/api/v1/finance/accounts",
  "/api/v1/notifications/unread-count",
];

// setup() выполняется один раз до старта VU — здесь, а не в default(),
// делаем единственный вход в session-режиме, чтобы не упереться в
// rate-limit логина при параллельных VU.
export function setup() {
  if (AUTH_MODE !== "session") return {};
  if (!NEX_EMAIL || !NEX_PASSWORD) {
    throw new Error("AUTH_MODE=session требует NEX_EMAIL и NEX_PASSWORD");
  }
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ tenant: NEX_TENANT, email: NEX_EMAIL, password: NEX_PASSWORD }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200) {
    throw new Error(`не удалось войти: HTTP ${res.status} ${res.body}`);
  }
  const setCookie = res.headers["Set-Cookie"] || "";
  // Из "nex_session=<токен>; Path=/; HttpOnly; ..." нужен только первый
  // сегмент — k6 не хранит cookie между setup() и VU автоматически,
  // поэтому передаём её вручную заголовком на каждый запрос ниже.
  const cookie = setCookie.split(";")[0];
  if (!cookie) {
    throw new Error("логин вернул 200, но без Set-Cookie — не должно случаться");
  }
  return { cookie };
}

function authHeaders(data) {
  if (AUTH_MODE === "session") {
    return { Cookie: data.cookie };
  }
  return {
    "X-Dev-Actor": NEX_ACTOR,
    "X-Dev-Roles": NEX_ROLES,
    "X-Dev-Tenant": NEX_TENANT,
  };
}

export default function (data) {
  group("healthz", () => {
    const res = http.get(`${BASE}/healthz`, { tags: { endpoint: "healthz" } });
    check(res, {
      "status 200": (r) => r.status === 200,
      "body ok": (r) => r.json("status") === "ok",
    });
  });

  group("business", () => {
    const headers = authHeaders(data);
    for (const path of BUSINESS_ENDPOINTS) {
      const res = http.get(`${BASE}${path}`, { headers, tags: { endpoint: "business", path } });
      check(res, {
        "status 200": (r) => r.status === 200,
        "тело — JSON": (r) => {
          try {
            r.json();
            return true;
          } catch {
            return false;
          }
        },
      });
    }
  });

  sleep(0.1);
}
