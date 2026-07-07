import { useState } from 'react';
import {
  Search, Send, Paperclip, FileText, Download, Upload, Bell, Heart, MessageCircle,
  Share2, BookOpen, GraduationCap, Library, Rss, Star, Megaphone, Sparkles, ChevronLeft,
} from 'lucide-react';
import { PageHead, Chip, Avatar, Beta, NexAsk, useApp, useIsMobile } from '../ui';
import { AiBox } from './aibox';
import { llmReady, llmAsk } from '../llm';

function BetaNote({ text }: { text: string }) {
  return (
    <div className="ai-card" style={{ marginBottom: 16, borderLeftColor: 'var(--ai)' }}>
      <div className="ai-head"><Sparkles size={14} /> Бета-функция</div>
      <div className="ai-body">{text} Данные демонстрационные, часть действий пока недоступна.</div>
    </div>
  );
}

/* ===================== Messenger ===================== */
const THREADS = [
  { id: 1, name: 'Петров А.И.', role: 'Зав. кафедрой', last: 'Согласуем расписание на среду?', time: '10:24', unread: 2 },
  { id: 2, name: 'Группа ПИ-21-1', role: '24 участника', last: 'Староста: занятие перенесено', time: '09:50', unread: 0 },
  { id: 3, name: 'Бухгалтерия', role: 'Сидорова Н.П.', last: 'Акт сверки готов', time: 'Вчера', unread: 0 },
  { id: 4, name: 'Волкова О.', role: 'Студент · ПИ-21-1', last: 'Здравствуйте, по поводу пересдачи', time: 'Вчера', unread: 1 },
];
const MSGS = [
  { me: false, t: 'Здравствуйте! Согласуем расписание на среду?', time: '10:20' },
  { me: true, t: 'Да, давайте перенесём «Сети» на 12:00, ауд. 305 — окно свободно.', time: '10:22' },
  { me: false, t: 'Отлично, NEX подсказал то же. Подтверждаю.', time: '10:24' },
];

export function Messenger() {
  const { toast } = useApp();
  const isMobile = useIsMobile();
  const [active, setActive] = useState<number | null>(isMobile ? null : 1);
  const [text, setText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const thread = THREADS.find((t) => t.id === active) || THREADS[0];

  /* NEX помогает прямо в переписке: черновик ответа / суммаризация */
  const aiAssist = async (mode: 'reply' | 'summary') => {
    if (aiBusy) return;
    const convo = MSGS.map((m) => `${m.me ? 'Я' : thread.name}: ${m.t}`).join('\n');
    const prompt = mode === 'reply'
      ? `Переписка с «${thread.name}»:\n${convo}\n\nСоставь вежливый короткий ответ от моего лица (только текст сообщения).`
      : `Кратко (1-2 предложения) суммируй суть переписки:\n${convo}`;
    if (!llmReady()) { toast('Подключите ИИ в Настройках → Интеллект'); return; }
    setAiBusy(true);
    try {
      const t = await llmAsk(prompt, { system: 'Ты — ассистент во внутреннем мессенджере колледжа. Пиши по-деловому и кратко.' });
      if (mode === 'reply') { setText(t); toast('NEX предложил ответ — проверьте и отправьте'); }
      else toast(t);
    } catch { toast('ИИ недоступен'); }
    setAiBusy(false);
  };

  const List = (
    <div className="msgr-list">
      <div className="msgr-search"><Search size={15} /><input placeholder="Поиск чатов…" /></div>
      {THREADS.map((t) => (
        <div key={t.id} className={`msgr-thread ${t.id === active ? 'active' : ''}`} onClick={() => setActive(t.id)}>
          <Avatar name={t.name} />
          <div className="msgr-thread-main">
            <div className="t"><b>{t.name}</b><span className="dim">{t.time}</span></div>
            <div className="m">{t.last}</div>
          </div>
          {t.unread > 0 && <span className="msgr-badge">{t.unread}</span>}
        </div>
      ))}
    </div>
  );

  const Conv = (
    <div className="msgr-conv">
      <div className="msgr-conv-head">
        {isMobile && <button className="icon-btn" onClick={() => setActive(null)} aria-label="Назад"><ChevronLeft size={20} /></button>}
        <Avatar name={thread.name} />
        <div><b>{thread.name}</b><div className="dim" style={{ fontSize: 12 }}>{thread.role}</div></div>
      </div>
      <div className="msgr-msgs">
        {MSGS.map((m, i) => <div key={i} className={`msgr-bubble ${m.me ? 'me' : ''}`}>{m.t}<span className="msgr-time">{m.time}</span></div>)}
      </div>
      <div className="msgr-ai">
        <button className="chip-btn sm" disabled={aiBusy} onClick={() => aiAssist('reply')}><Sparkles size={12} className="ic" />{aiBusy ? 'NEX думает…' : 'Составить ответ'}</button>
        <button className="chip-btn sm" disabled={aiBusy} onClick={() => aiAssist('summary')}><Sparkles size={12} className="ic" />Суммировать</button>
      </div>
      <form className="msgr-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { toast('Отправка — бета'); setText(''); } }}>
        <button type="button" className="ci-tool" title="Файл · бета" onClick={() => toast('Файлы — бета')}><Paperclip size={16} /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение…" />
        <button className="ask-send sm" type="submit" aria-label="Отправить"><Send size={15} /></button>
      </form>
    </div>
  );

  if (isMobile) {
    return (
      <div className="fade content-narrow">
        <PageHead title="Мессенджер" sub="Внутренние переписки" actions={<Beta />} />
        {active === null ? (
          <>
            <BetaNote text="Общение между сотрудниками, группами и студентами в одном месте." />
            <div className="card msgr-mobile">{List}</div>
          </>
        ) : (
          <div className="card msgr-mobile conv">{Conv}</div>
        )}
      </div>
    );
  }

  return (
    <div className="fade content-narrow">
      <PageHead title="Мессенджер" sub="Внутренние переписки" actions={<Beta />} />
      <BetaNote text="Общение между сотрудниками, группами и студентами в одном месте." />
      <div className="card msgr">{List}{Conv}</div>
    </div>
  );
}

/* ===================== Notifications ===================== */
const NOTES = [
  { id: 1, icon: Megaphone, tone: 'chip-danger', title: 'Подозрительные входы', desc: '12 неудачных попыток с одного IP за ночь', time: '2 мин', unread: true },
  { id: 2, icon: Bell, tone: 'chip-warn', title: 'Срок оплаты', desc: 'У 8 студентов оплата истекает 30.06', time: '1 ч', unread: true },
  { id: 3, icon: Sparkles, tone: 'chip-ai', title: 'NEX: 4 студента в зоне риска', desc: 'Сформирован список и план действий', time: '3 ч', unread: false },
  { id: 4, icon: FileText, tone: 'chip-info', title: 'Новое заявление в приём', desc: 'ИС-21 · средний балл 248', time: 'Вчера', unread: false },
];
export function NotificationsPage() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const list = tab === 'unread' ? NOTES.filter((n) => n.unread) : NOTES;
  return (
    <div className="fade content-narrow">
      <PageHead title="Уведомления" sub="Всё важное в одном потоке" actions={<Beta />} />
      <BetaNote text="Единый центр уведомлений с приоритетами от NEX." />
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Все</button>
        <button className={tab === 'unread' ? 'on' : ''} onClick={() => setTab('unread')}>Непрочитанные</button>
      </div>
      <div className="card"><div className="row-list">
        {list.map((n) => { const Icon = n.icon; return (
          <div className="feed-row" key={n.id} style={{ background: n.unread ? 'var(--ai-weak)' : undefined }}>
            <div className="feed-ico"><Icon size={14} /></div>
            <div className="feed-main"><div className="t">{n.title}</div><div className="m">{n.desc} · {n.time}</div></div>
            <Chip tone={n.tone}>{n.unread ? 'новое' : 'прочитано'}</Chip>
          </div>
        ); })}
      </div></div>
    </div>
  );
}

/* ===================== Documents ===================== */
const DOCS = [
  { id: 1, name: 'Приказ о зачислении 2024.pdf', kind: 'Приказ', size: '240 КБ', date: '12.06', by: 'NEX (черновик)' },
  { id: 2, name: 'Справка об обучении — Волкова.docx', kind: 'Справка', size: '52 КБ', date: '11.06', by: 'Петров А.И.' },
  { id: 3, name: 'Учебный план ПИ-21.xlsx', kind: 'План', size: '1.1 МБ', date: '03.06', by: 'Уч. часть' },
  { id: 4, name: 'Акт сверки — июнь.pdf', kind: 'Финансы', size: '180 КБ', date: '01.06', by: 'Бухгалтерия' },
];
export function Documents() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Документы" sub="Хранилище и шаблоны" actions={<><Beta /><NexAsk q="Подготовь черновик документа по шаблону" label="Собрать документ" /><button className="btn btn-primary" onClick={() => toast('Загрузка — бета')}><Upload size={15} />Загрузить</button></>} />
      <BetaNote text="Документы и шаблоны; NEX готовит черновики и подставляет данные." />
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Документ</th><th>Тип</th><th>Размер</th><th>Изменён</th><th>Автор</th><th></th></tr></thead>
        <tbody>{DOCS.map((d) => (
          <tr key={d.id}>
            <td style={{ fontWeight: 600 }}><FileText size={14} style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--ai)' }} />{d.name}</td>
            <td><Chip tone="chip-info">{d.kind}</Chip></td>
            <td className="muted">{d.size}</td>
            <td className="muted">{d.date}</td>
            <td className="muted">{d.by}</td>
            <td className="right"><button className="icon-btn" title="Скачать · бета" onClick={() => toast('Скачивание — бета')}><Download size={16} /></button></td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}

/* ===================== Student feed ===================== */
const POSTS = [
  { id: 1, who: 'Студсовет', time: '1 ч', text: 'В пятницу — день открытых дверей кафедры ИТ. Приходите, будет разбор проектов!', likes: 24, comments: 5, tag: 'Событие' },
  { id: 2, who: 'Кафедра ПИ', time: '3 ч', text: 'Опубликованы материалы лекции по базам данных. Доступны в разделе «Кампус».', likes: 12, comments: 2, tag: 'Учёба' },
  { id: 3, who: 'NEX', time: '5 ч', text: 'Напоминание: 8 студентов с истекающим сроком оплаты. Проверьте раздел «Финансы».', likes: 3, comments: 0, tag: 'NEX' },
];
export function Feed() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow" style={{ maxWidth: 720 }}>
      <PageHead title="Лента" sub="Студенческая жизнь и объявления" actions={<Beta />} />
      <BetaNote text="Общая лента: объявления, события, материалы и подсказки NEX." />
      <div className="grid" style={{ gap: 14 }}>
        {POSTS.map((p) => (
          <div className="card" key={p.id}><div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Avatar name={p.who} />
              <div style={{ flex: 1 }}><b>{p.who}</b><div className="dim" style={{ fontSize: 12 }}>{p.time} назад</div></div>
              <Chip tone={p.tag === 'NEX' ? 'chip-ai' : 'chip-info'}>{p.tag}</Chip>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>{p.text}</div>
            <div className="feed-actions">
              <button onClick={() => toast('Лайк — бета')}><Heart size={15} />{p.likes}</button>
              <button onClick={() => toast('Комментарии — бета')}><MessageCircle size={15} />{p.comments}</button>
              <button onClick={() => toast('Поделиться — бета')}><Share2 size={15} />Поделиться</button>
            </div>
          </div></div>
        ))}
      </div>
    </div>
  );
}

/* ===================== Calendar (beta) — AI planning ===================== */
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const CAL_EVENTS: { day: number; time: string; title: string; kind: 'para' | 'exam' | 'meet' | 'deadline' }[] = [
  { day: 0, time: '09:00', title: 'Базы данных · лекция', kind: 'para' },
  { day: 0, time: '12:00', title: 'Свободное окно · ауд. 305', kind: 'meet' },
  { day: 1, time: '10:30', title: 'Совет кафедры', kind: 'meet' },
  { day: 2, time: '09:00', title: 'Экзамен · ПИ-21-1', kind: 'exam' },
  { day: 3, time: '15:00', title: 'Дедлайн: приказы на подпись', kind: 'deadline' },
  { day: 4, time: '11:00', title: 'Карьерная ярмарка', kind: 'meet' },
];
const kindTone: Record<string, string> = { para: 'chip-info', exam: 'chip-warn', meet: 'chip-ai', deadline: 'chip-danger' };

export function Calendar() {
  const today = 2; // среда — для подсветки
  return (
    <div className="fade content-narrow">
      <PageHead title="Календарь" sub="Единое расписание событий и дедлайнов" actions={<Beta />} />
      <AiBox
        title="Планирование с NEX"
        placeholder="Например: спланируй мою неделю с учётом экзамена и дедлайнов…"
        quick={['Спланируй неделю', 'Куда вписать консультацию?', 'Что перенести из-за экзамена?']}
        system="Ты — планировщик расписания колледжа. У пользователя на неделе: Пн лекция БД 9:00 и свободное окно 12:00 ауд.305, Вт совет кафедры 10:30, Ср экзамен ПИ-21-1 9:00, Чт дедлайн приказов 15:00, Пт карьерная ярмарка 11:00. Помогай планировать: предлагай конкретные слоты, учитывай конфликты, отвечай кратко и по делу."
        fallback={(q) => `На неделе плотно: экзамен в среду и дедлайн приказов в четверг. Свободный слот — Пн 12:00 (ауд. 305): туда логично вписать консультацию или подготовку к экзамену. Запрос «${q}» обработаю живой моделью после подключения ИИ.`}
      />
      <div className="card">
        <div className="card-head"><div className="card-title">Эта неделя</div><NexAsk q="Оптимизируй мою неделю: где окна, что перенести" label="Оптимизировать" /></div>
        <div className="cal-week">
          {WEEK.map((d, i) => (
            <div key={d} className={`cal-col ${i === today ? 'today' : ''}`}>
              <div className="cal-day">{d}{i === today && <span className="cal-today">сегодня</span>}</div>
              <div className="cal-events">
                {CAL_EVENTS.filter((e) => e.day === i).map((e, j) => (
                  <div key={j} className={`cal-event ${e.kind}`}>
                    <span className="cal-time">{e.time}</span>{e.title}
                  </div>
                ))}
                {CAL_EVENTS.filter((e) => e.day === i).length === 0 && <div className="cal-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================== Cloud (beta) ===================== */
const CLOUD_FILES = [
  { name: 'Учебные планы 2024', kind: 'folder', size: '—', items: 18 },
  { name: 'Приказы', kind: 'folder', size: '—', items: 42 },
  { name: 'Отчёт_посещаемость_июнь.xlsx', kind: 'xlsx', size: '340 КБ' },
  { name: 'Презентация_приёмная_кампания.pdf', kind: 'pdf', size: '2.1 МБ' },
  { name: 'Договор_ВК_стажировка.docx', kind: 'docx', size: '88 КБ' },
  { name: 'backup_бд_ночной.zip', kind: 'zip', size: '1.4 ГБ' },
];

export function Cloud() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Облако" sub="Файлы организации в одном месте" actions={<><Beta /><button className="btn btn-primary" onClick={() => toast('Загрузка — бета')}><Upload size={15} />Загрузить</button></>} />
      <AiBox
        title="NEX по файлам"
        placeholder="Найди договор со стажировкой · суммируй последний отчёт…"
        quick={['Где договор с ВК?', 'Суммируй отчёт по посещаемости', 'Какие файлы давно не трогали?']}
        system="Ты — ассистент по файловому хранилищу колледжа. Доступные файлы: папки «Учебные планы 2024», «Приказы»; файлы «Отчёт_посещаемость_июнь.xlsx», «Презентация_приёмная_кампания.pdf», «Договор_ВК_стажировка.docx», «backup_бд_ночной.zip». Помогай находить и объяснять файлы, отвечай кратко."
        fallback={(q) => `По запросу «${q}»: похоже, вам нужен «Договор_ВК_стажировка.docx» или «Отчёт_посещаемость_июнь.xlsx». Полноценный поиск и суммаризация — после подключения ИИ в Настройках.`}
      />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Занято</div><div className="kpi-value">3.9 ГБ</div><div className="meter" style={{ height: 6, marginTop: 8 }}><i style={{ width: '39%', background: 'var(--accent)' }} /></div></div>
        <div className="kpi"><div className="kpi-label">Файлов</div><div className="kpi-value">312</div></div>
        <div className="kpi"><div className="kpi-label">Общий доступ</div><div className="kpi-value">27</div></div>
      </div>
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Имя</th><th>Тип</th><th className="right">Размер</th><th></th></tr></thead>
        <tbody>{CLOUD_FILES.map((f) => (
          <tr key={f.name}>
            <td style={{ fontWeight: 600 }}>{f.kind === 'folder' ? '📁 ' : ''}{f.name}</td>
            <td><Chip tone={f.kind === 'folder' ? 'chip-ai' : 'chip-info'}>{f.kind === 'folder' ? `${f.items} эл.` : f.kind}</Chip></td>
            <td className="right muted">{f.size}</td>
            <td className="right"><button className="icon-btn" title="Скачать · бета" onClick={() => toast('Скачивание — бета')}><Download size={16} /></button></td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}
