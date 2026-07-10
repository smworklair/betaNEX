import { useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Users, Repeat, MapPin, Bell, Paperclip,
  Send, Trash2, Edit3, CheckSquare, DoorOpen,
} from 'lucide-react';
import { PageHead, Chip, NexAsk, Beta, useApp } from '../ui';
import { calEvents as seedEvents } from '../data';
import { staff, groups } from '../data';
import { useCollection, uid, nowIso, type Entity } from '../beta/store';
import { Modal, Field, Text, Area, Select, MultiSelect, TagInput, AddButton, Confirm, Empty } from '../beta/kit';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
type Kind = 'meet' | 'exam' | 'deadline' | 'lesson' | 'personal';
const KIND: Record<Kind, { label: string; color: string }> = {
  meet: { label: 'Встреча', color: 'var(--accent)' },
  exam: { label: 'Экзамен', color: 'var(--warn)' },
  deadline: { label: 'Дедлайн', color: 'var(--danger)' },
  lesson: { label: 'Занятие', color: 'var(--ai)' },
  personal: { label: 'Личное', color: 'var(--success)' },
};
const ROOMS = ['305', '210', '114', '207', '118', 'Актовый зал', 'Онлайн (Zoom)'];
const REMINDERS = [['none', 'Без напоминания'], ['10m', 'За 10 минут'], ['1h', 'За час'], ['1d', 'За день']] as const;
const CANDIDATES = [...staff.map((s) => s.name), 'Студсовет', 'Кафедра ИТ'];
const GROUP_NAMES = groups.map((g) => g.name);

interface CEvent extends Entity {
  day: number; title: string; kind: Kind; time: string; location: string;
  participants: string[]; groups: string[]; recurrence: string; reminder: string;
  linkTask: boolean; attachments: string[]; note: string;
}

const SEED: CEvent[] = seedEvents.map((e) => ({
  id: uid('ev'), createdAt: nowIso(), updatedAt: nowIso(),
  day: e.day, title: e.title.replace(/\s\d{1,2}:\d{2}$/, ''), kind: e.kind as Kind,
  time: (e.title.match(/\d{1,2}:\d{2}/) || ['09:00'])[0], location: '', participants: [], groups: [],
  recurrence: 'none', reminder: '1h', linkTask: false, attachments: [], note: '',
}));

const emptyEvent = (day: number): Omit<CEvent, keyof Entity> => ({
  day, title: '', kind: 'meet', time: '12:00', location: '', participants: [], groups: [],
  recurrence: 'none', reminder: '1h', linkTask: false, attachments: [], note: '',
});

export function CalendarPage() {
  const { toast } = useApp();
  const col = useCollection<CEvent>('calendar', SEED);
  const today = 9;
  const firstWeekday = 2;
  const daysInMonth = 31;
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const [sel, setSel] = useState<number>(today);
  const [editing, setEditing] = useState<CEvent | number | null>(null); // number = new on that day
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [invite, setInvite] = useState<CEvent | null>(null);

  const evOf = (d: number) => col.items.filter((e) => e.day === d).sort((a, b) => a.time.localeCompare(b.time));
  const selEvents = evOf(sel);

  return (
    <div className="fade content-narrow">
      <PageHead title="Календарь" sub="Июль 2026 · события, участники, аудитории, напоминания"
        actions={<><Beta /><div className="cal-nav"><button className="icon-btn"><ChevronLeft size={18} /></button><b>Июль</b><button className="icon-btn"><ChevronRight size={18} /></button></div>
          <AddButton label="Событие" onClick={() => setEditing(sel)} /></>} />

      <div className="grid" style={{ gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
        <div className="card"><div className="card-body">
          <div className="month-grid month-head">{WD.map((w) => <div key={w} className="month-wd">{w}</div>)}</div>
          <div className="month-grid">
            {cells.map((d, i) => (
              <button key={i} className={`month-cell ${d === null ? 'empty' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`}
                disabled={d === null} onClick={() => d && setSel(d)} onDoubleClick={() => d && setEditing(d)}>
                {d && <span className="month-num">{d}</span>}
                <div className="month-dots">{evOf(d || 0).slice(0, 4).map((e) => <i key={e.id} style={{ background: KIND[e.kind].color }} />)}</div>
              </button>
            ))}
          </div>
          <div className="cal-legend">{Object.entries(KIND).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}</div>
        </div></div>

        <div className="card"><div className="card-head"><div className="card-title">{sel} июля</div>
          <button className="btn btn-sm btn-outline" onClick={() => setEditing(sel)}><Plus size={14} /></button></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selEvents.length ? selEvents.map((e) => (
              <div key={e.id} className="cal-ev-card" style={{ borderLeftColor: KIND[e.kind].color }}>
                <div className="cal-ev-top">
                  <div><b>{e.time}</b> {e.title}</div>
                  <div className="cal-ev-btns">
                    <button className="icon-btn sm" onClick={() => setInvite(e)} title="Пригласить"><Send size={14} /></button>
                    <button className="icon-btn sm" onClick={() => setEditing(e)} title="Изменить"><Edit3 size={14} /></button>
                    <button className="icon-btn sm" onClick={() => setConfirmDel(e.id)} title="Удалить"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="cal-ev-meta">
                  <Chip tone="chip-neutral">{KIND[e.kind].label}</Chip>
                  {e.location && <span><MapPin size={11} /> {e.location}</span>}
                  {e.participants.length > 0 && <span><Users size={11} /> {e.participants.length}</span>}
                  {e.recurrence !== 'none' && <span><Repeat size={11} /></span>}
                  {e.reminder !== 'none' && <span><Bell size={11} /></span>}
                  {e.linkTask && <span><CheckSquare size={11} /> задача</span>}
                </div>
              </div>
            )) : <Empty title="На этот день событий нет" hint="Двойной клик по дню — быстрое создание."
              action={<AddButton label="Создать событие" onClick={() => setEditing(sel)} />} />}
            <NexAsk q={`Что запланировать на ${sel} июля и не пересекается ли это с другими событиями?`} label="Спланировать с NEX" subtle={false} />
          </div>
        </div>
      </div>

      {editing !== null && <EventEditor col={col} event={typeof editing === 'number' ? null : editing} day={typeof editing === 'number' ? editing : editing.day} onClose={() => setEditing(null)} toast={toast} />}
      {confirmDel && <Confirm title="Удалить событие?" body="Событие будет удалено из календаря." onConfirm={() => { col.remove(confirmDel); toast('Событие удалено'); }} onClose={() => setConfirmDel(null)} />}
      {invite && <InviteDialog event={invite} onClose={() => setInvite(null)} toast={toast} />}
    </div>
  );
}

function EventEditor({ col, event, day, onClose, toast }: {
  col: ReturnType<typeof useCollection<CEvent>>; event: CEvent | null; day: number; onClose: () => void; toast: (m: string) => void;
}) {
  const [f, setF] = useState<Omit<CEvent, keyof Entity>>(() => event ? { ...event } : emptyEvent(day));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.title.trim()) { toast('Введите название события'); return; }
    if (event) col.update(event.id, f); else col.add(f);
    toast(event ? 'Событие сохранено' : 'Событие создано'); onClose();
  };
  return (
    <Modal wide title={event ? 'Изменить событие' : 'Новое событие'} sub={`${f.day} июля 2026`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={save}>{event ? 'Сохранить' : 'Создать'}</button>
    </>}>
      <div className="bk-form-grid">
        <Field label="Название"><Text value={f.title} onChange={(v) => set('title', v)} placeholder="Педсовет, экзамен, встреча…" autoFocus /></Field>
        <div className="bk-form-two">
          <Field label="Тип"><Select value={f.kind} onChange={(v) => set('kind', v)} options={Object.entries(KIND).map(([value, m]) => ({ value: value as Kind, label: m.label }))} /></Field>
          <Field label="Время"><Text type="time" value={f.time} onChange={(v) => set('time', v)} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="День (июль)"><Text type="number" value={String(f.day)} onChange={(v) => set('day', Math.max(1, Math.min(31, +v || 1)))} /></Field>
          <Field label="Аудитория / место"><Select value={f.location} onChange={(v) => set('location', v)} options={[{ value: '', label: '— не указано —' }, ...ROOMS.map((r) => ({ value: r, label: r }))]} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="Участники"><MultiSelect value={f.participants} onChange={(v) => set('participants', v)} options={CANDIDATES} /></Field>
          <Field label="Группы"><MultiSelect value={f.groups} onChange={(v) => set('groups', v)} options={GROUP_NAMES} /></Field>
        </div>
        <div className="bk-form-two">
          <Field label="Повтор"><Select value={f.recurrence} onChange={(v) => set('recurrence', v)} options={[['none', 'Без повтора'], ['daily', 'Ежедневно'], ['weekly', 'Еженедельно'], ['monthly', 'Ежемесячно']].map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Напоминание"><Select value={f.reminder} onChange={(v) => set('reminder', v)} options={REMINDERS.map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Вложения"><TagInput value={f.attachments} onChange={(v) => set('attachments', v)} placeholder="Имя файла и Enter…" /></Field>
        <Field label="Заметка"><Area value={f.note} onChange={(v) => set('note', v)} /></Field>
        <label className="bk-switch-row">
          <button type="button" className={`bk-switch ${f.linkTask ? 'on' : ''}`} onClick={() => set('linkTask', !f.linkTask)}><span /></button>
          <span><CheckSquare size={14} style={{ verticalAlign: 'middle' }} /> Создать связанную задачу-напоминание</span>
        </label>
      </div>
    </Modal>
  );
}

function InviteDialog({ event, onClose, toast }: { event: CEvent; onClose: () => void; toast: (m: string) => void }) {
  const [people, setPeople] = useState<string[]>(event.participants);
  const [grps, setGrps] = useState<string[]>(event.groups);
  const total = useMemo(() => people.length + grps.length, [people, grps]);
  const send = () => { toast(`Приглашения разосланы: ${people.length} участникам, ${grps.length} группам`); onClose(); };
  return (
    <Modal title="Разослать приглашения" sub={`${event.title} · ${event.day} июля`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={send} disabled={!total}><Send size={15} />Разослать ({total})</button>
    </>}>
      <div className="bk-form-grid">
        <Field label="Участники"><MultiSelect value={people} onChange={setPeople} options={CANDIDATES} /></Field>
        <Field label="Группы (массовая рассылка)"><MultiSelect value={grps} onChange={setGrps} options={GROUP_NAMES} /></Field>
        <div className="ai-card"><div className="ai-head"><DoorOpen size={13} /> Аудитория</div>
          <div className="ai-body">{event.location ? `Бронь аудитории «${event.location}» подтверждается вместе с рассылкой.` : 'Аудитория не указана — приглашение уйдёт без брони.'}</div></div>
      </div>
    </Modal>
  );
}
