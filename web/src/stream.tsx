import { useState, useEffect, useRef, useMemo, type ReactNode, type FormEvent } from 'react';
import {
  ShieldAlert, TrendingDown, Wallet, Link2, CheckCircle2, CalendarClock, Sparkles,
  ArrowUp, Sun, Moon, LogOut, ShieldCheck, BookOpen,
} from 'lucide-react';
import { useApp } from './ui';
import { students, finance, roleLabel } from './data';
import { AtRiskList, ContextDrawer, attendanceRate, avgGrade } from './blocks';

/* ---------- in-prose interactive atoms ---------- */
function StudentLink({ last, children }: { last: string; children?: ReactNode }) {
  const { openStudent } = useApp();
  const s = students.find((x) => x.lastname === last);
  return <span className="ent" onClick={() => s && openStudent(s.id)}>{children || last}</span>;
}

function Do({ label, primary, ai, msg }: { label: string; primary?: boolean; ai?: boolean; msg: string }) {
  const { toast } = useApp();
  return <button className={`iact${primary ? ' primary' : ''}${ai ? ' ai' : ''}`} onClick={() => toast(msg)}>{label}</button>;
}

function More({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="iact link" onClick={() => setOpen((o) => !o)}>{open ? 'Свернуть' : label}</button>
      {open && <div className="th-expand">{children}</div>}
    </>
  );
}

function DebtorExpand() {
  const { openStudent } = useApp();
  const debtors = finance.payments.filter((p) => p.status !== 'Оплачено');
  return (
    <div className="table-wrap"><table className="tbl">
      <thead><tr><th>Студент</th><th>Группа</th><th className="right">Сумма</th><th>Статус</th></tr></thead>
      <tbody>{debtors.map((p) => {
        const s = students.find((x) => p.student.startsWith(x.lastname));
        return (
          <tr key={p.id} style={s ? { cursor: 'pointer' } : undefined} onClick={() => s && openStudent(s.id)}>
            <td style={{ fontWeight: 600 }}>{p.student}</td><td className="mono">{p.group}</td>
            <td className="right mono">₽ {p.sum.toLocaleString('ru')}</td>
            <td>{p.status}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

/* ---------- a "thought" descriptor ---------- */
type Tone = 'crit' | 'warn' | 'ai' | 'ok' | 'info';
interface Thought { id: number; tone: Tone; icon: ReactNode; time: string; fresh?: boolean; body: ReactNode; }

let idSeq = 1000;
const nextId = () => ++idSeq;

/* ---------- thought content (system thinking out loud) ---------- */
function adminThoughts(): Thought[] {
  return [
    {
      id: nextId(), tone: 'crit', icon: <ShieldAlert size={16} />, time: 'ночью',
      body: <>
        <div className="th-text">Ночью — <b>12 попыток входа</b> с одного адреса (45.9.148.3, Нидерланды). Это похоже на подбор пароля: я временно ограничил доступ и держу его под наблюдением. Учётные записи не скомпрометированы.</div>
        <div className="th-actions"><Do label="Заблокировать совсем" primary msg="IP заблокирован · записано в аудит" /><Do label="Снять ограничение" msg="Ограничение снято" /><Do label="Почему так решил" ai msg="Частота и геолокация попыток нетипичны для организации" /></div>
      </>,
    },
    {
      id: nextId(), tone: 'warn', icon: <TrendingDown size={16} />, time: '2 ч назад',
      body: <>
        <div className="th-text">За две недели <b>4 студента</b> перешли в зону риска. Общий фактор — посещаемость ниже 75% в ПИ-21-1 и ПИ-22-1, у части ещё и снижается средний балл. Я подготовил обращения кураторам.</div>
        <div className="th-actions"><Do label="Отправить кураторам" primary msg="Обращения отправлены кураторам" /><More label="Показать студентов"><AtRiskList /></More><Do label="Не сейчас" msg="Отложено" /></div>
      </>,
    },
    {
      id: nextId(), tone: 'ai', icon: <Link2 size={16} />, time: '3 ч назад',
      body: <>
        <div className="th-text">Объединил данные между сущностями: у <StudentLink last="Лебедев" /> истёк академический отпуск <b>и</b> накопилось три семестра задолженности — формально это основание для отчисления. Сам решать не буду, но черновик приказа уже готов.</div>
        <div className="th-actions"><Do label="Подготовить приказ" primary msg="Черновик приказа открыт на проверку" /><Do label="Открыть карточку" ai msg="" /></div>
      </>,
    },
    {
      id: nextId(), tone: 'warn', icon: <Wallet size={16} />, time: '5 ч назад',
      body: <>
        <div className="th-text">Срок оплаты у <b>8 студентов</b> истекает 30.06. Ожидаемое поступление ≈ <b>₽496 000</b>. Я свёл список и подготовил уведомления — нужно только подтвердить рассылку.</div>
        <div className="th-actions"><Do label="Разослать уведомления" primary msg="Уведомления подготовлены к отправке" /><More label="Показать должников"><DebtorExpand /></More></div>
      </>,
    },
    {
      id: nextId(), tone: 'ok', icon: <CheckCircle2 size={16} />, time: 'сегодня',
      body: <>
        <div className="th-text">Рутинное, сделал сам: разнёс <b>2 новых платежа</b> по студентам, пересчитал задолженность и собрал черновик реестра стипендий по среднему баллу. Действий от вас не требуется.</div>
        <div className="th-actions"><Do label="Открыть реестр стипендий" ai msg="Реестр стипендий открыт" /></div>
      </>,
    },
    {
      id: nextId(), tone: 'info', icon: <Sparkles size={16} />, time: 'наблюдение',
      body: <div className="th-text">Простыми словами: общая посещаемость снизилась на 2%, но это почти полностью одна группа — <b>ИС-21-1</b>, а не вся организация. В остальном динамика стабильная, поводов для тревоги нет.</div>,
    },
  ];
}

function adminPool(): Thought[] {
  return [
    {
      id: nextId(), tone: 'ai', icon: <Link2 size={16} />, time: 'только что',
      body: <div className="th-text">Заметил связь: у <StudentLink last="Соколова" /> одновременно падает посещаемость и есть частичная оплата — двойной риск. Поднял её приоритет в зоне внимания.</div>,
    },
    {
      id: nextId(), tone: 'info', icon: <CalendarClock size={16} />, time: 'только что',
      body: <>
        <div className="th-text">В расписании освободилось окно — <b>Пн 12:00, ауд. 305</b>. Туда можно перенести «Сети» из переполненного слота, конфликтов не возникнет.</div>
        <div className="th-actions"><Do label="Применить перенос" primary msg="Расписание обновлено" /></div>
      </>,
    },
    {
      id: nextId(), tone: 'ok', icon: <ShieldCheck size={16} />, time: 'только что',
      body: <div className="th-text">Проверка целостности базы данных и журнала аудита пройдена. Последняя резервная копия — 4 часа назад, восстановление возможно.</div>,
    },
  ];
}

function roleThoughts(role: string): Thought[] {
  if (role === 'accountant') return [
    { id: nextId(), tone: 'warn', icon: <Wallet size={16} />, time: 'сейчас', body: <><div className="th-text">К оплате близки <b>8 студентов</b> (срок 30.06, ≈ ₽496К). Уведомления готовы.</div><div className="th-actions"><Do label="Разослать" primary msg="Уведомления подготовлены" /><More label="Показать должников"><DebtorExpand /></More></div></> },
    { id: nextId(), tone: 'ai', icon: <Sparkles size={16} />, time: 'наблюдение', body: <div className="th-text">Нашёл <b>3 нетипичных перевода</b> от одного контрагента — стоит проверить до закрытия месяца.</div> },
  ];
  // teacher / student
  return [
    { id: nextId(), tone: 'info', icon: <CalendarClock size={16} />, time: 'сегодня', body: <div className="th-text">Сегодня у вас <b>3 пары</b>, ближайшая — Базы данных в 12:00, ауд. 305.</div> },
    { id: nextId(), tone: 'warn', icon: <TrendingDown size={16} />, time: '1 ч назад', body: <><div className="th-text">В вашей группе <b>2 студента</b> ушли в зону риска по посещаемости.</div><div className="th-actions"><More label="Показать"><AtRiskList /></More></div></> },
    { id: nextId(), tone: 'ok', icon: <BookOpen size={16} />, time: 'напоминание', body: <><div className="th-text">Вчерашнее занятие осталось без оценок в журнале.</div><div className="th-actions"><Do label="Заполнить журнал" primary msg="Журнал открыт" /></div></> },
  ];
}

/* ---------- steer: optional natural-language nudge ---------- */
function steerThought(q: string): Thought {
  const t = q.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  let body: ReactNode;
  if (has('должник', 'долг', 'оплат')) body = <><div className="th-text">Свёл должников: всего <b>{finance.payments.filter((p) => p.status !== 'Оплачено').length}</b>. Вот список — можно сразу подготовить уведомления.</div><div className="th-actions"><Do label="Подготовить уведомления" primary msg="Уведомления подготовлены" /><More label="Показать"><DebtorExpand /></More></div></>;
  else if (has('риск', 'отчисл')) body = <><div className="th-text">Студенты в зоне риска — отсортированы по серьёзности.</div><div className="th-actions"><More label="Показать"><AtRiskList /></More></div></>;
  else if (has('безопас', 'вход', 'угроз')) body = <div className="th-text">По безопасности: ядро, БД и журнал аудита целостны. Активна 1 серия подозрительных входов — я её ограничил.</div>;
  else if (has('расписан', 'окно')) body = <><div className="th-text">В расписании есть свободное окно: Пн 12:00, ауд. 305.</div><div className="th-actions"><Do label="Применить перенос" primary msg="Расписание обновлено" /></div></>;
  else {
    const s = students.find((x) => t.includes(x.lastname.toLowerCase()));
    if (s) body = <div className="th-text">Открываю <StudentLink last={s.lastname}>{s.lastname} {s.firstname}</StudentLink> со всеми связанными данными — успеваемость, посещаемость, оплата.</div>;
    else body = <div className="th-text">Принял: «{q}». Уточните направление — например «должники», «кто в зоне риска», «состояние безопасности».</div>;
  }
  return { id: nextId(), tone: 'ai', icon: <Sparkles size={16} />, time: 'ответ на ваш запрос', fresh: true, body };
}

/* ---------- account (no nav — minimal corner control) ---------- */
function Account() {
  const { user, setUser, theme, setTheme } = useApp();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="acct">
      <button className="acct-btn" onClick={() => setOpen((o) => !o)}>{(user.name[0] || 'U').toUpperCase()}</button>
      {open && (
        <div className="acct-menu" onMouseLeave={() => setOpen(false)}>
          <div className="who"><b>{user.name}</b><span>{roleLabel[user.role]}</span></div>
          <div className="mi" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</div>
          <div className="mi" onClick={() => setUser(null)}><LogOut size={15} />Выйти</div>
        </div>
      )}
    </div>
  );
}

/* ---------- the stream ---------- */
export function Stream() {
  const { user } = useApp();
  const role = user?.role || 'admin';

  const initial = useMemo(() => (role === 'admin' ? adminThoughts() : roleThoughts(role)), [role]);
  const pool = useMemo(() => (role === 'admin' ? adminPool() : []), [role]);
  const [thoughts, setThoughts] = useState<Thought[]>(initial);
  const [steer, setSteer] = useState('');
  const poolIdx = useRef(0);
  const [thinking, setThinking] = useState(false);

  // The system keeps thinking: it surfaces new observations over time on its own.
  useEffect(() => {
    if (pool.length === 0) return;
    const tick = window.setInterval(() => {
      if (poolIdx.current >= pool.length) { window.clearInterval(tick); return; }
      setThinking(true);
      window.setTimeout(() => {
        const t = { ...pool[poolIdx.current], fresh: true };
        poolIdx.current += 1;
        setThoughts((prev) => [t, ...prev.map((p) => ({ ...p, fresh: false }))]);
        setThinking(false);
      }, 900);
    }, 9000);
    return () => window.clearInterval(tick);
  }, [pool]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!steer.trim()) return;
    setThoughts((prev) => [steerThought(steer.trim()), ...prev.map((p) => ({ ...p, fresh: false }))]);
    setSteer('');
  };

  return (
    <div className="flow-app">
      <div className="pulse">
        <div className="brand-mark">N</div>
        <div className="pulse-state"><span className="pulse-dot" />{thinking ? 'NEX думает…' : 'NEX непрерывно анализирует организацию'}</div>
        <div className="pulse-counts">
          <div><b>100</b> <span>студентов</span></div>
          <div><b>4</b> <span>группы</span></div>
          <div><b>{thoughts.length}</b> <span>наблюдений</span></div>
          <Account />
        </div>
      </div>

      <div className="flow">
        <div className="flow-inner">
          <div className="flow-lead"><Sparkles size={13} style={{ color: 'var(--ai)' }} /> Что система замечает прямо сейчас — и что с этим можно сделать</div>
          {thoughts.map((t) => (
            <div key={t.id} className={`thought${t.fresh ? ' fresh' : ''}`}>
              <div className={`th-glyph th-${t.tone}`}>{t.icon}</div>
              <div className="th-body">
                <div className="th-time">{t.fresh && <span className="th-fresh">только что ·</span>}{t.time}</div>
                {t.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="steer-wrap">
        <form className="steer" onSubmit={send}>
          <div className="steer-hint">Система работает сама. Строка ниже — если хотите её направить (необязательно).</div>
          <div className="steer-bar">
            <input value={steer} onChange={(e) => setSteer(e.target.value)} placeholder="Направить NEX… например: «должники» или «кто в зоне риска»" />
            <button className="steer-send" type="submit" aria-label="Отправить"><ArrowUp size={19} /></button>
          </div>
        </form>
      </div>

      <ContextDrawer />
    </div>
  );
}
