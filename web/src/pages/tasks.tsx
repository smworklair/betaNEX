import { useMemo, useState } from 'react';
import {
  CheckCircle2, Circle, Sparkles, Plus, Trash2, Edit3, Send, Users, Repeat, LayoutTemplate,
  Wand2, MessageSquare, History as HistoryIcon, Paperclip, ListChecks, Flag, Tag as TagIcon,
  Eye, CalendarClock, X, Copy,
} from 'lucide-react';
import { PageHead, Chip, NexAsk, Beta, useApp } from '../ui';
import { tasks as seedTasks } from '../data';
import { staff, groups } from '../data';
import { useCollection, uid, nowIso, humanTime, type Entity } from '../beta/store';
import { Modal, Field, Text, Area, Select, TagInput, MultiSelect, Toolbar, AddButton, BulkBar, Confirm, Empty, RowCheck } from '../beta/kit';

/* ------------------------- Модель задачи ------------------------- */
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'open' | 'in_progress' | 'done' | 'canceled';
type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

interface Subtask { id: string; title: string; done: boolean; }
interface ChecklistItem { id: string; text: string; done: boolean; }
interface Comment { id: string; author: string; text: string; at: string; }
interface HistoryRec { id: string; text: string; at: string; }
interface Attachment { id: string; name: string; }

interface BTask extends Entity {
  title: string;
  note: string;
  status: Status;
  priority: Priority;
  category: string;
  tags: string[];
  due: string;            // YYYY-MM-DD | ''
  assignees: string[];
  watchers: string[];
  recurrence: Recurrence;
  subtasks: Subtask[];
  checklist: ChecklistItem[];
  comments: Comment[];
  history: HistoryRec[];
  attachments: Attachment[];
}

interface Template extends Entity {
  name: string;
  title: string;
  note: string;
  priority: Priority;
  category: string;
  checklist: string[];
}

interface Rule extends Entity {
  name: string;
  when: string;           // условие-триггер (человекочитаемо)
  createTitle: string;
  assignee: string;
  priority: Priority;
  enabled: boolean;
}

const PRIORITY: Record<Priority, { label: string; tone: string; color: string }> = {
  low: { label: 'Низкий', tone: 'chip-neutral', color: 'var(--text-3)' },
  normal: { label: 'Обычный', tone: 'chip-info', color: 'var(--accent)' },
  high: { label: 'Высокий', tone: 'chip-warn', color: 'var(--warn)' },
  urgent: { label: 'Срочный', tone: 'chip-danger', color: 'var(--danger)' },
};
const STATUS: Record<Status, string> = { open: 'Открыта', in_progress: 'В работе', done: 'Выполнена', canceled: 'Отменена' };
const CATEGORIES = ['Общее', 'Финансы', 'Учебный процесс', 'Приём', 'Безопасность', 'Хозяйственное', 'Кадры'];
const CANDIDATES = [...staff.map((s) => s.name), 'NEX', 'Секретарь', 'Бухгалтерия'];
const GROUP_NAMES = groups.map((g) => g.name);

const emptyTask = (): Omit<BTask, keyof Entity> => ({
  title: '', note: '', status: 'open', priority: 'normal', category: 'Общее', tags: [],
  due: '', assignees: [], watchers: [], recurrence: 'none',
  subtasks: [], checklist: [], comments: [], history: [], attachments: [],
});

/* сид из прототипа → богатая модель (один раз при первом заходе) */
const priorityOf = (due: string): Priority => (due === 'сегодня' || due === 'вчера' ? 'high' : 'normal');
/* Сид общий с терминалом на «Главном»: обе поверхности смотрят в одну
   коллекцию 'tasks' — экосистема, а не отдельные копии данных. */
export const TASK_SEED: BTask[] = seedTasks.map((t) => ({
  id: t.id, createdAt: nowIso(), updatedAt: nowIso(),
  title: t.title, note: '', status: t.done ? 'done' : 'open', priority: priorityOf(t.due),
  category: 'Общее', tags: [], due: '', assignees: t.who === 'вы' ? [] : [t.who], watchers: [],
  recurrence: 'none', subtasks: [], checklist: [], comments: [],
  history: [{ id: uid('h'), text: 'Задача создана', at: nowIso() }], attachments: [],
}));

const DEFAULT_TEMPLATES: Template[] = [
  { id: 'tpl1', name: 'Приказ об отчислении', title: 'Подготовить приказ об отчислении', note: 'Проверить основания и задолженности.', priority: 'high', category: 'Учебный процесс', checklist: ['Проверить задолженности', 'Согласовать с деканатом', 'Подписать у директора'] },
  { id: 'tpl2', name: 'Рассылка должникам', title: 'Разослать напоминания должникам', note: '', priority: 'normal', category: 'Финансы', checklist: ['Сформировать список', 'Составить текст', 'Отправить'] },
  { id: 'tpl3', name: 'Подготовка к сессии', title: 'Подготовить расписание сессии', note: '', priority: 'high', category: 'Учебный процесс', checklist: ['Собрать ведомости', 'Проверить допуски', 'Опубликовать'] },
];

const DEFAULT_RULES: Rule[] = [
  { id: 'rl1', name: 'Просроченный платёж → задача бухгалтеру', when: 'Платёж просрочен более 3 дней', createTitle: 'Связаться с должником', assignee: 'Бухгалтерия', priority: 'high', enabled: true },
  { id: 'rl2', name: 'Посещаемость < 70% → задача куратору', when: 'Посещаемость студента ниже 70%', createTitle: 'Провести беседу со студентом', assignee: 'Козлова Мария Викторовна', priority: 'normal', enabled: true },
];

/* ============================ Раздел «Задачи» ============================ */
export function Tasks() {
  const { toast } = useApp();
  const col = useCollection<BTask>('tasks', TASK_SEED);
  const [tab, setTab] = useState<'list' | 'templates' | 'rules'>('list');

  return (
    <div className="fade content-narrow">
      <PageHead title="Задачи" sub="Полноценный планировщик: подзадачи, чек-листы, исполнители, повторы, шаблоны и правила"
        actions={<Beta />} />

      <div className="bk-tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}><ListChecks size={15} />Список</button>
        <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}><LayoutTemplate size={15} />Шаблоны</button>
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}><Wand2 size={15} />Правила</button>
      </div>

      {tab === 'list' && <TaskList col={col} toast={toast} />}
      {tab === 'templates' && <Templates col={col} toast={toast} />}
      {tab === 'rules' && <Rules toast={toast} />}
    </div>
  );
}

/* ---------------------------- Список задач ---------------------------- */
function TaskList({ col, toast }: { col: ReturnType<typeof useCollection<BTask>>; toast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<'all' | Status>('all');
  const [fPriority, setFPriority] = useState<'all' | Priority>('all');
  const [fCat, setFCat] = useState<'all' | string>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<BTask | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [send, setSend] = useState<BTask | null>(null);

  const list = useMemo(() => col.items.filter((t) => {
    if (q && !(t.title + t.note + t.tags.join(' ') + t.assignees.join(' ')).toLowerCase().includes(q.toLowerCase())) return false;
    if (fStatus !== 'all' && t.status !== fStatus) return false;
    if (fPriority !== 'all' && t.priority !== fPriority) return false;
    if (fCat !== 'all' && t.category !== fCat) return false;
    return true;
  }), [col.items, q, fStatus, fPriority, fCat]);

  const openCount = col.items.filter((t) => t.status !== 'done' && t.status !== 'canceled').length;
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());
  const allChecked = list.length > 0 && list.every((t) => sel.has(t.id));

  const complete = (t: BTask) => {
    const done = t.status === 'done';
    col.update(t.id, {
      status: done ? 'open' : 'done',
      history: [...t.history, { id: uid('h'), text: done ? 'Возвращена в работу' : 'Отмечена выполненной', at: nowIso() }],
    });
    if (!done) toast('Задача выполнена');
  };

  const detailTask = detail ? col.items.find((t) => t.id === detail) || null : null;

  return (
    <>
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">{openCount} задач ждут действия. Отсортируйте по приоритету, назначьте исполнителей и разошлите — я помогу с формулировками.</div>
        <div className="ai-actions"><NexAsk q="Разбери мои задачи по приоритету и подскажи, с чего начать" label="Приоритизировать" subtle={false} /></div>
      </div>

      <Toolbar query={q} onQuery={setQ} placeholder="Поиск по названию, тегам, исполнителю…"
        right={<AddButton label="Новая задача" onClick={() => setEditing('new')} />}>
        <select className="select bk-filter" value={fStatus} onChange={(e) => setFStatus(e.target.value as 'all' | Status)}>
          <option value="all">Все статусы</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select bk-filter" value={fPriority} onChange={(e) => setFPriority(e.target.value as 'all' | Priority)}>
          <option value="all">Любой приоритет</option>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select bk-filter" value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="all">Все категории</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Toolbar>

      <BulkBar count={sel.size} onClear={clearSel}>
        <button className="btn btn-sm btn-outline" onClick={() => { col.patchMany([...sel], { status: 'done' }); toast(`${sel.size} задач завершено`); clearSel(); }}><CheckCircle2 size={14} />Завершить</button>
        <button className="btn btn-sm btn-outline" onClick={() => { col.patchMany([...sel], { priority: 'high' }); toast('Приоритет повышен'); clearSel(); }}><Flag size={14} />Высокий</button>
        <button className="btn btn-sm btn-outline" onClick={() => { toast('Задачи разосланы исполнителям'); clearSel(); }}><Send size={14} />Разослать</button>
        <button className="btn btn-sm btn-danger" onClick={() => setConfirmDel([...sel])}><Trash2 size={14} />Удалить</button>
      </BulkBar>

      {list.length === 0 ? (
        <Empty icon={<ListChecks size={26} />} title="Задач не найдено" hint="Измените фильтры или создайте новую задачу."
          action={<AddButton label="Новая задача" onClick={() => setEditing('new')} />} />
      ) : (
        <div className="card">
          <div className="bk-list-head">
            <RowCheck checked={allChecked} onChange={(v) => setSel(v ? new Set(list.map((t) => t.id)) : new Set())} />
            <span>Задача</span>
          </div>
          <div className="row-list">
            {list.map((t) => {
              const done = t.status === 'done' || t.status === 'canceled';
              const checkDone = t.checklist.filter((c) => c.done).length;
              return (
                <div key={t.id} className="bk-task-row">
                  <RowCheck checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} />
                  <button className="bk-task-toggle" onClick={() => complete(t)} aria-label="Готово"
                    style={{ color: done ? 'var(--success)' : 'var(--text-3)' }}>
                    {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  </button>
                  <div className="bk-task-main" onClick={() => setDetail(t.id)}>
                    <div className="bk-task-title" style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}>
                      <span className="bk-prio-dot" style={{ background: PRIORITY[t.priority].color }} />
                      {t.title || 'Без названия'}
                    </div>
                    <div className="bk-task-meta">
                      <span>{t.category}</span>
                      {t.assignees.length > 0 && <span>· {t.assignees.join(', ')}</span>}
                      {t.subtasks.length > 0 && <span>· <ListChecks size={11} /> {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}</span>}
                      {t.checklist.length > 0 && <span>· ☑ {checkDone}/{t.checklist.length}</span>}
                      {t.comments.length > 0 && <span>· <MessageSquare size={11} /> {t.comments.length}</span>}
                      {t.recurrence !== 'none' && <span>· <Repeat size={11} /></span>}
                      {t.tags.map((tag) => <span key={tag} className="bk-minitag">#{tag}</span>)}
                    </div>
                  </div>
                  {t.due && <Chip tone="chip-neutral">{t.due}</Chip>}
                  <Chip tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Chip>
                  <div className="bk-task-actions">
                    <button className="icon-btn sm" title="Разослать" onClick={() => setSend(t)}><Send size={15} /></button>
                    <button className="icon-btn sm" title="Изменить" onClick={() => setEditing(t)}><Edit3 size={15} /></button>
                    <button className="icon-btn sm" title="Удалить" onClick={() => setConfirmDel([t.id])}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && <TaskEditor col={col} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} toast={toast} />}
      {detailTask && <TaskDetail col={col} task={detailTask} onClose={() => setDetail(null)} onEdit={() => { setEditing(detailTask); setDetail(null); }} onSend={() => setSend(detailTask)} />}
      {confirmDel && <Confirm title="Удалить задачи?" body={`Будет удалено: ${confirmDel.length}. Действие необратимо.`}
        onConfirm={() => { col.removeMany(confirmDel); clearSel(); toast('Удалено'); }} onClose={() => setConfirmDel(null)} />}
      {send && <SendDialog task={send} onClose={() => setSend(null)} toast={toast} />}
    </>
  );
}

/* ---------------------------- Редактор задачи ---------------------------- */
function TaskEditor({ col, task, onClose, toast }: {
  col: ReturnType<typeof useCollection<BTask>>; task: BTask | null; onClose: () => void; toast: (m: string) => void;
}) {
  const [f, setF] = useState<Omit<BTask, keyof Entity>>(() => task ? { ...task } : emptyTask());
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = () => {
    if (!f.title.trim()) { toast('Введите название задачи'); return; }
    if (task) {
      col.update(task.id, { ...f, history: [...task.history, { id: uid('h'), text: 'Задача изменена', at: nowIso() }] });
      toast('Задача сохранена');
    } else {
      col.add({ ...f, history: [{ id: uid('h'), text: 'Задача создана', at: nowIso() }] });
      toast('Задача создана');
    }
    onClose();
  };

  return (
    <Modal wide title={task ? 'Изменить задачу' : 'Новая задача'} sub="Все поля сохраняются локально (бета)"
      onClose={onClose} footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" onClick={save}><CheckCircle2 size={15} />{task ? 'Сохранить' : 'Создать'}</button>
      </>}>
      <div className="bk-form-grid">
        <Field label="Название"><Text value={f.title} onChange={(v) => set('title', v)} placeholder="Что нужно сделать" autoFocus /></Field>
        <Field label="Описание"><Area value={f.note} onChange={(v) => set('note', v)} placeholder="Детали, контекст, ссылки" /></Field>
        <div className="bk-form-two">
          <Field label="Приоритет"><Select value={f.priority} onChange={(v) => set('priority', v)}
            options={Object.entries(PRIORITY).map(([value, m]) => ({ value: value as Priority, label: m.label }))} /></Field>
          <Field label="Статус"><Select value={f.status} onChange={(v) => set('status', v)}
            options={Object.entries(STATUS).map(([value, label]) => ({ value: value as Status, label }))} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="Категория"><Select value={f.category} onChange={(v) => set('category', v)}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Дедлайн"><Text type="date" value={f.due} onChange={(v) => set('due', v)} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="Исполнители"><MultiSelect value={f.assignees} onChange={(v) => set('assignees', v)} options={CANDIDATES} /></Field>
          <Field label="Наблюдатели"><MultiSelect value={f.watchers} onChange={(v) => set('watchers', v)} options={CANDIDATES} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="Повтор"><Select value={f.recurrence} onChange={(v) => set('recurrence', v)}
            options={[['none', 'Без повтора'], ['daily', 'Ежедневно'], ['weekly', 'Еженедельно'], ['monthly', 'Ежемесячно']].map(([value, label]) => ({ value: value as Recurrence, label }))} /></Field>
          <Field label="Теги"><TagInput value={f.tags} onChange={(v) => set('tags', v)} /></Field>
        </div>
        <Field label="Чек-лист" hint="Enter — добавить пункт">
          <ChecklistEditor items={f.checklist} onChange={(v) => set('checklist', v)} />
        </Field>
        <Field label="Подзадачи" hint="Enter — добавить подзадачу">
          <SubtaskEditor items={f.subtasks} onChange={(v) => set('subtasks', v)} />
        </Field>
      </div>
    </Modal>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (v: ChecklistItem[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t) { onChange([...items, { id: uid('c'), text: t, done: false }]); setDraft(''); } };
  return (
    <div className="bk-checklist">
      {items.map((c) => (
        <div key={c.id} className="bk-check-row">
          <button className={`bk-rowcheck ${c.done ? 'on' : ''}`} onClick={() => onChange(items.map((x) => x.id === c.id ? { ...x, done: !x.done } : x))}>{c.done && <span>✓</span>}</button>
          <span style={{ textDecoration: c.done ? 'line-through' : 'none', opacity: c.done ? 0.55 : 1 }}>{c.text}</span>
          <button className="icon-btn sm" onClick={() => onChange(items.filter((x) => x.id !== c.id))}><X size={13} /></button>
        </div>
      ))}
      <div className="bk-check-add">
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Пункт чек-листа…" />
        <button className="btn btn-sm btn-outline" onClick={add}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function SubtaskEditor({ items, onChange }: { items: Subtask[]; onChange: (v: Subtask[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t) { onChange([...items, { id: uid('s'), title: t, done: false }]); setDraft(''); } };
  return (
    <div className="bk-checklist">
      {items.map((c) => (
        <div key={c.id} className="bk-check-row">
          <button className={`bk-rowcheck ${c.done ? 'on' : ''}`} onClick={() => onChange(items.map((x) => x.id === c.id ? { ...x, done: !x.done } : x))}>{c.done && <span>✓</span>}</button>
          <span style={{ textDecoration: c.done ? 'line-through' : 'none', opacity: c.done ? 0.55 : 1 }}>{c.title}</span>
          <button className="icon-btn sm" onClick={() => onChange(items.filter((x) => x.id !== c.id))}><X size={13} /></button>
        </div>
      ))}
      <div className="bk-check-add">
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Подзадача…" />
        <button className="btn btn-sm btn-outline" onClick={add}><Plus size={14} /></button>
      </div>
    </div>
  );
}

/* ---------------------------- Карточка задачи ---------------------------- */
function TaskDetail({ col, task, onClose, onEdit, onSend }: {
  col: ReturnType<typeof useCollection<BTask>>; task: BTask; onClose: () => void; onEdit: () => void; onSend: () => void;
}) {
  const { user } = useApp();
  const [comment, setComment] = useState('');
  const [attName, setAttName] = useState('');

  const addComment = () => {
    const t = comment.trim(); if (!t) return;
    col.update(task.id, {
      comments: [...task.comments, { id: uid('cm'), author: user?.name || 'Вы', text: t, at: nowIso() }],
      history: [...task.history, { id: uid('h'), text: 'Добавлен комментарий', at: nowIso() }],
    });
    setComment('');
  };
  const addAtt = () => {
    const n = attName.trim(); if (!n) return;
    col.update(task.id, { attachments: [...task.attachments, { id: uid('at'), name: n }] });
    setAttName('');
  };
  const toggleSub = (id: string) => col.update(task.id, { subtasks: task.subtasks.map((s) => s.id === id ? { ...s, done: !s.done } : s) });
  const toggleChk = (id: string) => col.update(task.id, { checklist: task.checklist.map((c) => c.id === id ? { ...c, done: !c.done } : c) });

  return (
    <Modal wide title={task.title} sub={`${task.category} · ${STATUS[task.status]}`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Закрыть</button>
      <button className="btn btn-outline" onClick={onSend}><Send size={15} />Разослать</button>
      <button className="btn btn-primary" onClick={onEdit}><Edit3 size={15} />Изменить</button>
    </>}>
      <div className="bk-detail">
        <div className="bk-detail-chips">
          <Chip tone={PRIORITY[task.priority].tone}>{PRIORITY[task.priority].label}</Chip>
          {task.due && <Chip tone="chip-neutral"><CalendarClock size={12} /> {task.due}</Chip>}
          {task.recurrence !== 'none' && <Chip tone="chip-info"><Repeat size={12} /> повтор</Chip>}
          {task.tags.map((t) => <span key={t} className="bk-minitag">#{t}</span>)}
        </div>
        {task.note && <p className="bk-detail-note">{task.note}</p>}

        <div className="bk-detail-people">
          {task.assignees.length > 0 && <div><span className="field-label"><Users size={12} /> Исполнители</span>{task.assignees.join(', ')}</div>}
          {task.watchers.length > 0 && <div><span className="field-label"><Eye size={12} /> Наблюдатели</span>{task.watchers.join(', ')}</div>}
        </div>

        {task.subtasks.length > 0 && (
          <div className="bk-detail-sec"><div className="bk-detail-h"><ListChecks size={14} /> Подзадачи</div>
            {task.subtasks.map((s) => (
              <div key={s.id} className="bk-check-row">
                <button className={`bk-rowcheck ${s.done ? 'on' : ''}`} onClick={() => toggleSub(s.id)}>{s.done && <span>✓</span>}</button>
                <span style={{ textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.55 : 1 }}>{s.title}</span>
              </div>
            ))}
          </div>
        )}
        {task.checklist.length > 0 && (
          <div className="bk-detail-sec"><div className="bk-detail-h">☑ Чек-лист</div>
            {task.checklist.map((c) => (
              <div key={c.id} className="bk-check-row">
                <button className={`bk-rowcheck ${c.done ? 'on' : ''}`} onClick={() => toggleChk(c.id)}>{c.done && <span>✓</span>}</button>
                <span style={{ textDecoration: c.done ? 'line-through' : 'none', opacity: c.done ? 0.55 : 1 }}>{c.text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bk-detail-sec"><div className="bk-detail-h"><Paperclip size={14} /> Вложения</div>
          {task.attachments.map((a) => <div key={a.id} className="bk-att"><Paperclip size={13} />{a.name}</div>)}
          <div className="bk-check-add">
            <input className="input" value={attName} onChange={(e) => setAttName(e.target.value)} placeholder="Имя файла (демо)…" onKeyDown={(e) => { if (e.key === 'Enter') addAtt(); }} />
            <button className="btn btn-sm btn-outline" onClick={addAtt}><Plus size={14} /></button>
          </div>
        </div>

        <div className="bk-detail-sec"><div className="bk-detail-h"><MessageSquare size={14} /> Комментарии</div>
          {task.comments.map((c) => (
            <div key={c.id} className="bk-comment"><b>{c.author}</b> <span className="dim">{humanTime(c.at)}</span><div>{c.text}</div></div>
          ))}
          <div className="bk-check-add">
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Написать комментарий…" onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }} />
            <button className="btn btn-sm btn-primary" onClick={addComment}><Send size={14} /></button>
          </div>
        </div>

        <div className="bk-detail-sec"><div className="bk-detail-h"><HistoryIcon size={14} /> История изменений</div>
          <div className="tl">
            {[...task.history].reverse().map((h) => (
              <div key={h.id} className="tl-item"><div style={{ fontSize: 13 }}>{h.text}</div><div className="dim" style={{ fontSize: 11 }}>{humanTime(h.at)}</div></div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------- Диалог рассылки ---------------------------- */
function SendDialog({ task, onClose, toast }: { task: BTask; onClose: () => void; toast: (m: string) => void }) {
  const [mode, setMode] = useState<'one' | 'group' | 'many'>('one');
  const [one, setOne] = useState(CANDIDATES[0]);
  const [group, setGroup] = useState(GROUP_NAMES[0]);
  const [many, setMany] = useState<string[]>([]);

  const send = () => {
    if (mode === 'one') toast(`Задача «${task.title}» отправлена: ${one}`);
    else if (mode === 'group') toast(`Задача разослана группе ${group}`);
    else toast(`Задача разослана ${many.length} получателям`);
    onClose();
  };

  return (
    <Modal title="Отправить задачу" sub={task.title} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={send}><Send size={15} />Отправить</button>
    </>}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>Одному</button>
        <button className={mode === 'group' ? 'on' : ''} onClick={() => setMode('group')}>Группе</button>
        <button className={mode === 'many' ? 'on' : ''} onClick={() => setMode('many')}>Нескольким</button>
      </div>
      {mode === 'one' && <Field label="Получатель"><Select value={one} onChange={setOne} options={CANDIDATES.map((c) => ({ value: c, label: c }))} /></Field>}
      {mode === 'group' && <Field label="Учебная группа"><Select value={group} onChange={setGroup} options={GROUP_NAMES.map((c) => ({ value: c, label: c }))} /></Field>}
      {mode === 'many' && <Field label="Получатели"><MultiSelect value={many} onChange={setMany} options={CANDIDATES} placeholder="Выберите несколько…" /></Field>}
    </Modal>
  );
}

/* ---------------------------- Шаблоны ---------------------------- */
function Templates({ col, toast }: { col: ReturnType<typeof useCollection<BTask>>; toast: (m: string) => void }) {
  const tcol = useCollection<Template>('task-templates', DEFAULT_TEMPLATES);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  const useTemplate = (t: Template) => {
    col.add({
      ...emptyTask(), title: t.title, note: t.note, priority: t.priority, category: t.category,
      checklist: t.checklist.map((text) => ({ id: uid('c'), text, done: false })),
      history: [{ id: uid('h'), text: `Создана из шаблона «${t.name}»`, at: nowIso() }],
    });
    toast(`Задача создана из шаблона «${t.name}»`);
  };

  return (
    <>
      <Toolbar right={<AddButton label="Новый шаблон" onClick={() => setEditing('new')} />} />
      <div className="grid cols-2">
        {tcol.items.map((t) => (
          <div className="card" key={t.id}><div className="card-body">
            <div className="bk-tpl-head">
              <div><div style={{ fontWeight: 700 }}>{t.name}</div><div className="muted" style={{ fontSize: 12.5 }}>{t.category} · {PRIORITY[t.priority].label}</div></div>
              <Chip tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Chip>
            </div>
            <div className="muted" style={{ fontSize: 13, margin: '8px 0' }}>{t.title}</div>
            {t.checklist.length > 0 && <ul className="bk-tpl-list">{t.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            <div className="chips" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-primary" onClick={() => useTemplate(t)}><Copy size={14} />Создать задачу</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)}><Edit3 size={14} /></button>
              <button className="btn btn-sm btn-ghost" onClick={() => { tcol.remove(t.id); toast('Шаблон удалён'); }}><Trash2 size={14} /></button>
            </div>
          </div></div>
        ))}
      </div>
      {editing && <TemplateEditor col={tcol} tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} toast={toast} />}
    </>
  );
}

function TemplateEditor({ col, tpl, onClose, toast }: {
  col: ReturnType<typeof useCollection<Template>>; tpl: Template | null; onClose: () => void; toast: (m: string) => void;
}) {
  const [f, setF] = useState(() => tpl ? { ...tpl } : { name: '', title: '', note: '', priority: 'normal' as Priority, category: 'Общее', checklist: [] as string[] });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.name.trim() || !f.title.trim()) { toast('Заполните название и задачу'); return; }
    if (tpl) col.update(tpl.id, f); else col.add(f);
    toast('Шаблон сохранён'); onClose();
  };
  return (
    <Modal title={tpl ? 'Изменить шаблон' : 'Новый шаблон'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={save}>Сохранить</button>
    </>}>
      <div className="bk-form-grid">
        <Field label="Название шаблона"><Text value={f.name} onChange={(v) => set('name', v)} autoFocus /></Field>
        <Field label="Заголовок задачи"><Text value={f.title} onChange={(v) => set('title', v)} /></Field>
        <Field label="Описание"><Area value={f.note} onChange={(v) => set('note', v)} /></Field>
        <div className="bk-form-two">
          <Field label="Приоритет"><Select value={f.priority} onChange={(v) => set('priority', v)} options={Object.entries(PRIORITY).map(([value, m]) => ({ value: value as Priority, label: m.label }))} /></Field>
          <Field label="Категория"><Select value={f.category} onChange={(v) => set('category', v)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
        </div>
        <Field label="Пункты чек-листа"><TagInput value={f.checklist} onChange={(v) => set('checklist', v)} placeholder="Пункт и Enter…" /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------- Правила автосоздания ---------------------------- */
function Rules({ toast }: { toast: (m: string) => void }) {
  const rcol = useCollection<Rule>('task-rules', DEFAULT_RULES);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  return (
    <>
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Wand2 size={14} /> Автоматизация</div>
        <div className="ai-body">Правила создают задачи автоматически по событиям в системе — просроченный платёж, низкая посещаемость, новый приказ. Пока правила настраиваются здесь; исполнять их будет бэкенд (см. backend.md).</div>
      </div>
      <Toolbar right={<AddButton label="Новое правило" onClick={() => setEditing('new')} />} />
      <div className="card"><div className="row-list">
        {rcol.items.map((r) => (
          <div key={r.id} className="feed-row">
            <div className="feed-ico" style={{ background: r.enabled ? 'var(--accent-weak)' : 'var(--surface-2)', color: r.enabled ? 'var(--accent)' : 'var(--text-3)' }}><Wand2 size={14} /></div>
            <div className="feed-main">
              <div className="t">{r.name}</div>
              <div className="m">Когда: {r.when} → создать «{r.createTitle}» для {r.assignee}</div>
            </div>
            <button className={`bk-switch ${r.enabled ? 'on' : ''}`} onClick={() => rcol.update(r.id, { enabled: !r.enabled })} aria-label="Вкл/выкл"><span /></button>
            <button className="icon-btn sm" onClick={() => setEditing(r)}><Edit3 size={15} /></button>
            <button className="icon-btn sm" onClick={() => { rcol.remove(r.id); toast('Правило удалено'); }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div></div>
      {editing && <RuleEditor col={rcol} rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} toast={toast} />}
    </>
  );
}

function RuleEditor({ col, rule, onClose, toast }: {
  col: ReturnType<typeof useCollection<Rule>>; rule: Rule | null; onClose: () => void; toast: (m: string) => void;
}) {
  const [f, setF] = useState(() => rule ? { ...rule } : { name: '', when: '', createTitle: '', assignee: CANDIDATES[0], priority: 'normal' as Priority, enabled: true });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.name.trim() || !f.when.trim() || !f.createTitle.trim()) { toast('Заполните все поля'); return; }
    if (rule) col.update(rule.id, f); else col.add(f);
    toast('Правило сохранено'); onClose();
  };
  return (
    <Modal title={rule ? 'Изменить правило' : 'Новое правило'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={save}>Сохранить</button>
    </>}>
      <div className="bk-form-grid">
        <Field label="Название правила"><Text value={f.name} onChange={(v) => set('name', v)} autoFocus /></Field>
        <Field label="Условие (когда срабатывает)" hint="Например: «Платёж просрочен более 3 дней»"><Text value={f.when} onChange={(v) => set('when', v)} /></Field>
        <Field label="Создать задачу с заголовком"><Text value={f.createTitle} onChange={(v) => set('createTitle', v)} /></Field>
        <div className="bk-form-two">
          <Field label="Назначить на"><Select value={f.assignee} onChange={(v) => set('assignee', v)} options={CANDIDATES.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Приоритет"><Select value={f.priority} onChange={(v) => set('priority', v)} options={Object.entries(PRIORITY).map(([value, m]) => ({ value: value as Priority, label: m.label }))} /></Field>
        </div>
      </div>
    </Modal>
  );
}
