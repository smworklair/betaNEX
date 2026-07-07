// Смоук-нагрузка k6 (веха M8): базовая проверка, что сервис держит
// умеренный поток запросов без ошибок и с приличной латентностью.
// Запуск: k6 run load/smoke.js  (сервис должен быть запущен: make run)
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10, // виртуальных пользователей
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"], // меньше 1% ошибок
    http_req_duration: ["p(95)<100"], // 95-й перцентиль < 100 мс
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const res = http.get(`${BASE}/healthz`);
  check(res, {
    "status 200": (r) => r.status === 200,
    "body ok": (r) => r.json("status") === "ok",
  });
  sleep(0.1);
}
