import { useState, type FormEvent } from 'react';
import {
  ArrowUp, ShieldAlert, Wallet, Users, FileSignature, ArrowRight, Sun, Sunrise, Moon,
} from 'lucide-react';
import { useApp } from '../ui';
import { finance, aiInsights } from '../data';

/* ============================================================
   Главное — спокойная сводка дня.
   NEX объясняет простыми словами, что происходит, и рядом с
   каждым делом — одна кнопка. Без стены графиков и виджетов.
   ============================================================ */

type Task = {
  id: string;
  icon: typeof Wallet;
  tone: 'danger' | 'warn' | 'info';
  title: string;
  detail: string;
  action: string;
  go: string;            // раздел, который откроется
};

function greeting(): { hi: string; icon: typeof Sun } {
  const h = new Date().getHours();
  if (h < 6) return { hi: 'Доброй ночи', icon: Moon };
  if (h < 12) return { hi: 'Доброе утро', icon: Sunrise };
  if (h < 18) return { hi: 'Добрый день', icon: Sun };
  return { hi: 'Добрый вечер', icon: Moon };
}

const TONE_ICON = { danger: 'var(--danger)', warn: 'var(--warn)', info: 'var(--accent)' };

export default function Home() {
  const { user, setPage, openChat } = useApp();
  const [q, setQ] = useState('');

  const unpaid = finance.payments.filter((p) => p.status !== 'Оплачено').length;
  const risk = aiInsights.find((i) => i.page === 'students');

  const tasks: Task[] = [
    {
      id: 'security', icon: ShieldAlert, tone: 'danger',
      title: 'Ночью кто-то пытался войти под чужим паролем',
      detail: '12 неудачных попыток с одного адреса. Похоже на подбор — стоит закрыть этот адрес.',
      action: 'Посмотреть и закрыть', go: 'security',
    },
    {
      id: 'finance', icon: Wallet, tone: 'warn',
      title: `${unpaid} студента ещё не заплатили за обучение`,
      detail: 'Срок по договору — до 30 июня. Можно отправить всем вежливое напоминание в один клик.',
      action: 'Открыть оплату', go: 'fin-overview',
    },
    {
      id: 'risk', icon: Users, tone: 'info',
      title: risk?.title ?? 'Несколько студентов реже ходят на занятия',
      detail: risk?.desc ?? 'Посещаемость и оценки поползли вниз. Возможно, стоит поговорить с куратором.',
      action: 'Показать студентов', go: 'students',
    },
    {
      id: 'docs', icon: FileSignature, tone: 'info',
      title: '2 приказа готовы и ждут вашей подписи',
      detail: 'NEX собрал документы и проверил данные. Осталось прочитать и подписать.',
      action: 'Открыть задачи', go: 'tasks',
    },
  ];

  const g = greeting();
  const GIcon = g.icon;
  const name = user?.name?.split(' ')[0] || 'коллега';
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const submit = (e: FormEvent) => { e.preventDefault(); openChat(q.trim() || undefined); };

  return (
    <div className="fade home">
      <div className="home-hi">
        <span className="home-hi-ic"><GIcon size={22} /></span>
        <div>
          <h1>{g.hi}, {name}</h1>
          <div className="home-date">{today}</div>
        </div>
      </div>

      {/* одна человеческая фраза — что сегодня главное */}
      <p className="home-brief">
        Пока вас не было, NEX присмотрел за колледжем. Ночью были попытки чужого входа,
        {' '}<b>{unpaid} студента</b> не оплатили обучение, а у нескольких падает посещаемость.
        {' '}Ниже — что стоит сделать сегодня, по порядку важности.
      </p>

      {/* дела дня — крупные строки, у каждого одна кнопка */}
      <div className="home-tasks">
        {tasks.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.id} className="home-task" onClick={() => setPage(t.go)}>
              <span className="home-task-ic" style={{ color: TONE_ICON[t.tone], background: `color-mix(in srgb, ${TONE_ICON[t.tone]} 14%, transparent)` }}>
                <Icon size={20} />
              </span>
              <div className="home-task-main">
                <div className="home-task-title">{t.title}</div>
                <div className="home-task-detail">{t.detail}</div>
              </div>
              <button className="btn btn-primary home-task-btn" onClick={(e) => { e.stopPropagation(); setPage(t.go); }}>
                {t.action} <ArrowRight size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {/* тихая строка «спросить своими словами» */}
      <form className="home-ask" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Спросите NEX своими словами — например, «сколько соберём, если все должники заплатят»" />
        <button className="home-ask-send" type="submit" aria-label="Спросить NEX"><ArrowUp size={18} /></button>
      </form>
      <div className="home-ask-hint">NEX ответит понятно и, если нужно, сам откроет нужный раздел.</div>
    </div>
  );
}
