#!/usr/bin/env python3
"""Функциональный смоук HTTP API: прогоняет сквозной сценарий по модулям
«Задачи» и «Кампус» против запущенного dev-сервера и падает с ненулевым
кодом при первом расхождении.

Дополняет load/smoke.js (k6): тот меряет нагрузку на /healthz, этот
проверяет поведение — команды, фильтры, статусы ошибок.

Запуск (нужен nexd с Postgres: make dev && make run):

    python3 tools/api_smoke.py [--base-url URL] [--tenant SLUG]

Tenant должен существовать: nexd tenant create college-1 "Колледж №1".
"""

from __future__ import annotations

import argparse
import sys
import uuid

from nex_api import ApiError, NexAPI

_failures = 0


def step(name: str, ok: bool, extra: str = "") -> None:
    """Печатает результат шага и копит счётчик провалов."""
    global _failures
    mark = "ok " if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {extra}" if extra else ""))
    if not ok:
        _failures += 1


def smoke_tasks(api: NexAPI) -> None:
    """Задачи: создать → найти → выполнить → удалить; валидация входа."""
    print("Задачи:")
    marker = f"смоук-{uuid.uuid4().hex[:8]}"
    api.post("/api/v1/tasks", {"title": f"Задача {marker}", "due_on": "2030-01-15"})

    found = api.get("/api/v1/tasks", q=marker)
    step("создание и поиск по тексту", len(found) == 1, f"найдено {len(found)}")
    if not found:
        return
    task = found[0]
    step("срок сохранился", task.get("due_on") == "2030-01-15", str(task.get("due_on")))
    step("исполнитель по умолчанию — автор", task.get("assignee") == api.actor)

    api.post(f"/api/v1/tasks/{task['id']}/complete")
    done = api.get("/api/v1/tasks", q=marker, status="done")
    step("выполнение меняет статус", len(done) == 1 and done[0]["status"] == "done")
    step("done_at проставлен", bool(done and done[0].get("done_at")))

    # Повторное выполнение — идемпотентный отказ: задача уже не open.
    try:
        api.post(f"/api/v1/tasks/{task['id']}/complete")
        step("повторное выполнение → 404", False, "получен 2xx")
    except ApiError as e:
        step("повторное выполнение → 404", e.status == 404, str(e))

    api.delete(f"/api/v1/tasks/{task['id']}")
    step("удаление", api.get("/api/v1/tasks", q=marker) == [])

    # Валидация входа: пустой заголовок и кривая дата — 400 до шины команд.
    for name, body in [
        ("пустой заголовок → 400", {"title": ""}),
        ("кривая дата → 400", {"title": "x", "due_on": "15.01.2030"}),
    ]:
        try:
            api.post("/api/v1/tasks", body)
            step(name, False, "получен 2xx")
        except ApiError as e:
            step(name, e.status == 400, str(e))


def smoke_campus(api: NexAPI) -> None:
    """Кампус: группа → студент → оценка → журнал → отчисление."""
    print("Кампус:")
    marker = uuid.uuid4().hex[:8]
    code = f"СМ-{marker[:4]}"
    api.post("/api/v1/campus/groups", {"code": code, "name": f"Смоук {marker}"})
    groups = [g for g in api.get("/api/v1/campus/groups") if g["code"] == code]
    step("создание группы", len(groups) == 1)
    if not groups:
        return
    group_id = groups[0]["id"]

    full_name = f"Смоуков Тест {marker}"
    api.post(
        "/api/v1/campus/students",
        {"full_name": full_name, "email": f"smoke-{marker}@example.ru", "group_id": group_id},
    )
    students = api.get("/api/v1/campus/students", q=f"Смоуков {marker}")
    step("зачисление студента", len(students) == 1)
    if not students:
        return
    student = students[0]
    step("студент попал в группу", student.get("group_id") == group_id)

    api.post(
        "/api/v1/campus/grades",
        {"student_id": student["id"], "subject": "Математика", "grade": 5},
    )
    journal = api.get("/api/v1/campus/journal", student=student["id"])
    step("оценка видна в журнале", any(e.get("grade") == 5 for e in journal))

    try:
        api.post(
            "/api/v1/campus/grades",
            {"student_id": student["id"], "subject": "Математика", "grade": 1},
        )
        step("оценка вне шкалы → 400", False, "получен 2xx")
    except ApiError as e:
        step("оценка вне шкалы → 400", e.status == 400, str(e))

    api.patch(
        f"/api/v1/campus/students/{student['id']}",
        {"full_name": full_name, "status": "expelled"},
    )
    expelled = api.get("/api/v1/campus/students", q=f"Смоуков {marker}", status="expelled")
    step("отчисление меняет статус", len(expelled) == 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--tenant", default="college-1", help="slug существующего tenant'а")
    args = parser.parse_args()

    api = NexAPI(base_url=args.base_url, tenant=args.tenant, actor="smoke-bot")
    if not api.healthz():
        print(f"Сервис на {args.base_url} не отвечает. Запустите: make dev && make run")
        return 2

    try:
        smoke_tasks(api)
        smoke_campus(api)
    except ApiError as e:
        print(f"Сценарий оборвался ошибкой API: {e}")
        return 1

    if _failures:
        print(f"\nПровалено шагов: {_failures}")
        return 1
    print("\nВсе шаги пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
