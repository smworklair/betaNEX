import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Sparkles, ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHead, Chip, NexAsk, useApp } from '../ui';
import { tasks as seedTasks, nexLog, exams, calEvents } from '../data';
import { tasksApi } from '../api';

/* ============================ Лента · Календарь (полный месяц) ============================ */
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const KIND_COLOR: Record<string, string> = { meet: 'var(--accent)', exam: 'var(--warn)', deadline: 'var(--danger)' };

export function MonthCalendar() {
  const today = 5;
  const firstWeekday = 2; // июль условно начинается со среды (0=Пн)
  const daysInMonth = 31;
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const [sel, setSel] = useState<number>(today);
  const evOf = (d: number) => calEvents.filter((e) => e.day === d);
  const selEvents = evOf(sel);

  return (
    <div className="fade content-narrow">
      <PageHead title="Календарь" sub="Июль 2026 · события, экзамены, дедлайны"
        actions={<div className="cal-nav"><button className="icon-btn"><ChevronLeft size={18} /></button><b>Июль</b><button className="icon-btn"><ChevronRight size={18} /></button></div>} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
        <div className="card"><div className="card-body">
          <div className="month-grid month-head">{WD.map((w) => <div key={w} className="month-wd">{w}</div>)}</div>
          <div className="month-grid">
            {cells.map((d, i) => (
              <button key={i} className={`month-cell ${d === null ? 'empty' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`}
                disabled={d === null} onClick={() => d && setSel(d)}>
                {d && <span className="month-num">{d}</span>}
                <div className="month-dots">{evOf(d || 0).map((e, j) => <i key={j} style={{ background: KIND_COLOR[e.kind] }} />)}</div>
              </button>
            ))}
          </div>
        </div></div>
        <div className="card"><div className="card-head"><div className="card-title">{sel} июля</div></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selEvents.length ? selEvents.map((e, i) => (
              <div key={i} className="cal-ev-row" style={{ borderLeftColor: KIND_COLOR[e.kind] }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{e.kind === 'exam' ? 'Экзамен' : e.kind === 'deadline' ? 'Дедлайн' : 'Встреча'}</div>
              </div>
            )) : <div className="muted" style={{ fontSize: 13 }}>На этот день событий нет.</div>}
            <NexAsk q={`Что запланировать на ${sel} июля и не пересекается ли это с другими событиями?`} label="Спланировать с NEX" subtle={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ Лента · Задачи ============================ */
export function Tasks() {
  const { toast } = useApp();
  // Список из бэкенда (/api/v1/tasks) с автофолбэком на моки — грузим при монтировании.
  const [items, setItems] = useState<tasksApi.UITask[]>(() => seedTasks.map(tasksApi.seedToUI));
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(seedTasks.map((t) => [t.id, t.done])));

  useEffect(() => {
    let live = true;
    tasksApi.listTasks().then((ts) => {
      if (!live) return;
      setItems(ts);
      setDone(Object.fromEntries(ts.map((t) => [t.id, t.status === 'done'])));
    });
    return () => { live = false; };
  }, []);

  const toggle = (t: tasksApi.UITask) => {
    const next = !done[t.id];
    setDone((d) => ({ ...d, [t.id]: next }));
    if (next) {
      toast('Отмечено выполненным');
      // Best-effort: фиксируем на сервере, если он подключён; при ошибке — оставляем локально.
      tasksApi.completeTask(t.id).catch(() => {});
    }
  };

  const open = items.filter((t) => !done[t.id]).length;
  return (
    <div className="fade content-narrow">
      <PageHead title="Задачи" sub={`${open} дел ждут действия · собрано NEX из всех разделов`} />
      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">Я собрал всё, что требует вашего внимания, в один список — из финансов, приёма, безопасности и расписания. Отмечайте галочкой, что сделано.</div>
      </div>
      <div className="card"><div className="row-list">
        {items.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            onClick={() => toggle(t)}>
            <span style={{ color: done[t.id] ? 'var(--success)' : 'var(--text-3)', flexShrink: 0 }}>
              {done[t.id] ? <CheckCircle2 size={20} /> : <Circle size={20} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, textDecoration: done[t.id] ? 'line-through' : 'none', opacity: done[t.id] ? 0.5 : 1 }}>{t.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>Ответственный: {t.who}</div>
            </div>
            <Chip tone={t.due === 'сегодня' || t.due === 'вчера' ? 'chip-warn' : 'chip-neutral'}>{t.due}</Chip>
          </div>
        ))}
      </div></div>
    </div>
  );
}

/* ============================ Лента · История NEX ============================ */
export function NexHistory() {
  return (
    <div className="fade content-narrow">
      <PageHead title="История NEX" sub="Что ассистент сделал сам — прозрачно, по-человечески" />
      <div className="card"><div className="card-body">
        <div className="tl">
          {nexLog.map((l) => (
            <div className="tl-item ai" key={l.id}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{l.text}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{l.time}</div>
            </div>
          ))}
        </div>
      </div></div>
    </div>
  );
}

/* ============================ Учёба · Сессия ============================ */
const EXAM_TEACHER: Record<string, string> = {
  'Базы данных': 'Козлова М.В.', 'Математика': 'Петров А.И.',
  'Проектирование ИС': 'Сидорова Н.П.', 'Бухучёт': 'Фёдорова О.В.',
};
export function Exams() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Сессия" sub="Летняя сессия 2026 · расписание, преподаватели, готовность, рассылки"
        actions={<button className="btn btn-primary" onClick={() => toast('Расписание сессии разослано студентам и преподавателям')}><Sparkles size={15} />Разослать всем</button>} />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Экзаменов</div><div className="kpi-value">{exams.length}</div></div>
        <div className="kpi"><div className="kpi-label">Допущено</div><div className="kpi-value">{exams.reduce((a, e) => a + e.ready, 0)}</div></div>
        <div className="kpi"><div className="kpi-label">Не допущено</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>{exams.reduce((a, e) => a + (e.total - e.ready), 0)}</div></div>
        <div className="kpi"><div className="kpi-label">Отчёты сдать до</div><div className="kpi-value" style={{ fontSize: 20 }}>18 июл</div></div>
      </div>

      <div className="ai-card" style={{ marginBottom: 16, borderLeftColor: 'var(--warn)' }}>
        <div className="ai-head" style={{ color: 'var(--warn)' }}><ClipboardCheck size={14} /> Допуск</div>
        <div className="ai-body">У части студентов не закрыты задолженности — они не попадают в списки допуска. Ведомости преподаватели сдают до 18 июля.</div>
        <div className="ai-actions"><NexAsk q="Кто не допущен к сессии и что нужно закрыть каждому" label="Кто не допущен" subtle={false} /></div>
      </div>

      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Группа</th><th>Экзамен</th><th>Преподаватель</th><th>Дата</th><th>Ауд.</th><th style={{ width: '22%' }}>Допуск</th><th>Быстрые действия</th></tr></thead>
        <tbody>{exams.map((e, i) => {
          const pct = Math.round((e.ready / e.total) * 100);
          return (
            <tr key={i}><td className="mono" style={{ fontWeight: 600 }}>{e.group}</td><td style={{ fontWeight: 600 }}>{e.subject}</td>
              <td className="muted">{EXAM_TEACHER[e.subject] || '—'}</td>
              <td>{e.date}</td><td className="mono">{e.room}</td>
              <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="meter" style={{ flex: 1, height: 8 }}><i style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--success)' : 'var(--warn)' }} /></div>
                <span className="mono" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{e.ready}/{e.total}</span>
              </div></td>
              <td><div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-outline" title="Сообщить студентам об экзамене" onClick={() => toast(`Студентам ${e.group}: экзамен «${e.subject}» — ${e.date}, ауд. ${e.room}`)}>Студентам</button>
                <button className="btn btn-sm btn-ghost" title="Напомнить преподавателю про ведомость" onClick={() => toast(`Преподавателю ${EXAM_TEACHER[e.subject]}: сдать ведомость до 18 июля`)}>Преподу</button>
              </div></td></tr>
          );
        })}</tbody>
      </table></div></div>
    </div>
  );
}
