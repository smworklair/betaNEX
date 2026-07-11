#!/usr/bin/env python3
"""Наполняет dev-окружение демо-данными через HTTP API: учебные группы,
студенты с оценками и рабочие задачи. Все изменения идут через шину команд,
поэтому данные ложатся так же, как от живых пользователей, — с аудитом.

Запуск (нужен nexd с Postgres: make dev && make run):

    python3 tools/seed_demo.py [--groups N] [--students-per-group N]
                               [--tasks N] [--seed N]

Tenant должен существовать: nexd tenant create college-1 "Колледж №1".
Скрипт идемпотентен по группам (существующий код группы пропускается),
студенты и задачи добавляются поверх.
"""

from __future__ import annotations

import argparse
import datetime as dt
import random
import sys

from nex_api import ApiError, NexAPI

LAST_NAMES = [
    "Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов",
    "Волков", "Соколов", "Морозов", "Новиков", "Фёдоров", "Козлов",
]
FIRST_NAMES = [
    "Александр", "Дмитрий", "Мария", "Анна", "Сергей", "Екатерина",
    "Андрей", "Ольга", "Никита", "Татьяна", "Павел", "Дарья",
]
MIDDLE_NAMES = [
    "Александрович", "Дмитриевна", "Сергеевич", "Андреевна",
    "Павлович", "Николаевна", "Игоревич", "Владимировна",
]
SPECIALTIES = [
    ("ИС", "Информационные системы и программирование"),
    ("БУ", "Экономика и бухгалтерский учёт"),
    ("ПР", "Право и организация социального обеспечения"),
    ("ДО", "Дошкольное образование"),
    ("СА", "Сетевое и системное администрирование"),
]
SUBJECTS = ["Математика", "Русский язык", "История", "Информатика", "Физкультура"]
TASK_TEMPLATES = [
    "Подготовить приказ о зачислении",
    "Проверить документы абитуриента",
    "Напомнить о задолженности по оплате",
    "Составить расписание на семестр",
    "Согласовать план практики с работодателем",
    "Обновить контингент в отчёте для министерства",
]


def seed_groups(api: NexAPI, rng: random.Random, count: int) -> list[dict]:
    """Создаёт группы по специальностям; уже существующие коды пропускает."""
    existing = {g["code"] for g in api.get("/api/v1/campus/groups")}
    year = dt.date.today().year % 100
    created = 0
    for i in range(count):
        code_prefix, title = SPECIALTIES[i % len(SPECIALTIES)]
        code = f"{code_prefix}-{year - i // len(SPECIALTIES)}"
        if code in existing:
            continue
        api.post("/api/v1/campus/groups", {"code": code, "name": title})
        created += 1
    print(f"Группы: создано {created}, пропущено {count - created}")
    return api.get("/api/v1/campus/groups")


def seed_students(api: NexAPI, rng: random.Random, groups: list[dict], per_group: int) -> None:
    """Зачисляет студентов и выставляет каждому несколько оценок."""
    students = grades = 0
    for group in groups:
        for _ in range(per_group):
            name = f"{rng.choice(LAST_NAMES)} {rng.choice(FIRST_NAMES)} {rng.choice(MIDDLE_NAMES)}"
            email = f"student{rng.randrange(10**6):06d}@college.example.ru"
            api.post(
                "/api/v1/campus/students",
                {"full_name": name, "email": email, "group_id": group["id"]},
            )
            students += 1
        # Оценки — свежезачисленным студентам группы.
        for student in api.get("/api/v1/campus/students", group=group["id"]):
            for subject in rng.sample(SUBJECTS, k=2):
                graded_on = dt.date.today() - dt.timedelta(days=rng.randrange(1, 90))
                api.post(
                    "/api/v1/campus/grades",
                    {
                        "student_id": student["id"],
                        "subject": subject,
                        "grade": rng.choices([2, 3, 4, 5], weights=[1, 3, 5, 4])[0],
                        "graded_on": graded_on.isoformat(),
                    },
                )
                grades += 1
    print(f"Студенты: зачислено {students}, оценок выставлено {grades}")


def seed_tasks(api: NexAPI, rng: random.Random, count: int) -> None:
    """Создаёт рабочие задачи с разбросом сроков вокруг сегодняшнего дня."""
    for i in range(count):
        body: dict = {"title": f"{rng.choice(TASK_TEMPLATES)} №{i + 1}"}
        if rng.random() < 0.8:  # часть задач — без срока
            due = dt.date.today() + dt.timedelta(days=rng.randrange(-7, 30))
            body["due_on"] = due.isoformat()
        api.post("/api/v1/tasks", body)
    print(f"Задачи: создано {count}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--tenant", default="college-1", help="slug существующего tenant'а")
    parser.add_argument("--groups", type=int, default=5)
    parser.add_argument("--students-per-group", type=int, default=8)
    parser.add_argument("--tasks", type=int, default=12)
    parser.add_argument("--seed", type=int, default=None, help="зерно генератора для воспроизводимости")
    args = parser.parse_args()

    api = NexAPI(base_url=args.base_url, tenant=args.tenant, actor="seed-bot")
    if not api.healthz():
        print(f"Сервис на {args.base_url} не отвечает. Запустите: make dev && make run")
        return 2

    rng = random.Random(args.seed)
    try:
        groups = seed_groups(api, rng, args.groups)
        seed_students(api, rng, groups, args.students_per_group)
        seed_tasks(api, rng, args.tasks)
    except ApiError as e:
        print(f"Ошибка API: {e}")
        return 1
    print("Готово.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
