/* ============================================================
   Модуль «Кампус» — обёртка над /api/v1/campus/*.

   Контракт бэкенда (internal/module/campus/http.go):
     GET /api/v1/campus/groups    → {id, code, name, active_students}[]
     GET /api/v1/campus/students  → studentDTO[]
     GET /api/v1/campus/journal   → grade rows

   Отвечает за экраны «Люди → Студенты/Группы». Читает через
   withFallback, приводя ответы сервера к формам прототипа
   (Group/Student из data.ts).
   ============================================================ */

import { groups as seedGroups, students as seedStudents, type Group, type Student } from '../data';
import { apiFetch, withFallback } from './client';

export interface ApiGroup {
  id: string;
  code: string;
  name: string;
  active_students: number;
}

export interface ApiStudent {
  id: string;
  full_name: string;
  email?: string;
  group_id?: string;
  group_code?: string;
  status: string; // active | academic | expelled | graduated
  created_at: string;
}

export interface ApiGrade {
  id: string;
  student_id: string;
  full_name: string;
  group_code?: string;
  subject: string;
  grade: number;
  graded_on: string;
  graded_by?: string;
  note?: string;
}

// Статус бэкенда → русская метка прототипа.
const STATUS_LABEL: Record<string, string> = {
  active: 'Обучается',
  academic: 'Академический отпуск',
  expelled: 'Отчислен',
  graduated: 'Выпущен',
};

function groupFromApi(g: ApiGroup, i: number): Group {
  return {
    id: i + 1,
    name: g.code,
    spec: g.name,
    course: 0,
    curator: '—',
    year: 0,
    students: g.active_students,
  };
}

function studentFromApi(s: ApiStudent, i: number): Student {
  const parts = s.full_name.trim().split(/\s+/);
  return {
    id: i + 1,
    lastname: parts[0] ?? '',
    firstname: parts[1] ?? '',
    patronymic: parts.slice(2).join(' '),
    dob: '',
    group: s.group_code || '—',
    form: '—',
    finance: '—',
    phone: '',
    email: s.email || '',
    status: STATUS_LABEL[s.status] || s.status,
  };
}

/** Список групп: реальный бэкенд или моки. */
export function listGroups(): Promise<Group[]> {
  return withFallback(
    async () => (await apiFetch<ApiGroup[]>('/api/v1/campus/groups')).map(groupFromApi),
    () => seedGroups,
  );
}

/** Список студентов: реальный бэкенд или моки. */
export function listStudents(): Promise<Student[]> {
  return withFallback(
    async () => (await apiFetch<ApiStudent[]>('/api/v1/campus/students')).map(studentFromApi),
    () => seedStudents,
  );
}

/** Учебный журнал (оценки). Без мока — пустой список в демо-режиме. */
export function listJournal(params: { group?: string; student?: string; subject?: string } = {}): Promise<ApiGrade[]> {
  const q = new URLSearchParams();
  if (params.group) q.set('group', params.group);
  if (params.student) q.set('student', params.student);
  if (params.subject) q.set('subject', params.subject);
  const qs = q.toString();
  return withFallback(
    () => apiFetch<ApiGrade[]>(`/api/v1/campus/journal${qs ? `?${qs}` : ''}`),
    () => [],
  );
}
