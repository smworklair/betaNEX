-- 00007_campus.sql — модуль «Кампус»: группы, студенты, учебный журнал.
-- Ядро домена колледжа: остальные модули (расписание, приёмка, стипендии)
-- будут ссылаться на эти сущности.

-- +goose Up
CREATE TABLE campus_groups (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    code       text NOT NULL,               -- "ИС-21"
    name       text NOT NULL DEFAULT '',    -- "Информационные системы, 2 курс"
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE campus_students (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    full_name  text NOT NULL,
    email      text NOT NULL DEFAULT '',
    group_id   uuid REFERENCES campus_groups (id),
    status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'academic', 'expelled', 'graduated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    search tsvector GENERATED ALWAYS AS (
        to_tsvector('russian', coalesce(full_name, '') || ' ' || coalesce(email, ''))
    ) STORED
);
CREATE INDEX campus_students_group_idx  ON campus_students (tenant_id, group_id);
CREATE INDEX campus_students_search_idx ON campus_students USING gin (search);

-- Учебный журнал: оценка студента по дисциплине за дату. Append-only,
-- исправление — новой записью (история оценок не переписывается).
CREATE TABLE campus_grades (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    student_id uuid NOT NULL REFERENCES campus_students (id),
    subject    text NOT NULL,
    grade      smallint NOT NULL CHECK (grade BETWEEN 2 AND 5),
    graded_on  date NOT NULL DEFAULT current_date,
    graded_by  text NOT NULL DEFAULT '',
    note       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campus_grades_student_idx ON campus_grades (tenant_id, student_id, graded_on DESC);
CREATE INDEX campus_grades_subject_idx ON campus_grades (tenant_id, subject, graded_on DESC);

ALTER TABLE campus_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_groups   FORCE ROW LEVEL SECURITY;
ALTER TABLE campus_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_students FORCE ROW LEVEL SECURITY;
ALTER TABLE campus_grades   ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_grades   FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_groups ON campus_groups
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_students ON campus_students
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_grades ON campus_grades
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS campus_grades;
DROP TABLE IF EXISTS campus_students;
DROP TABLE IF EXISTS campus_groups;
