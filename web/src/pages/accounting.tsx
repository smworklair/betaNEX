import { useState, type ReactNode } from 'react';
import {
  TrendingUp, Receipt, HandCoins, FileBarChart, Calculator, Banknote,
  PiggyBank, Landmark, Download, Send, CheckCircle2, Sparkles,
  ArrowDownLeft, ArrowUpRight, CreditCard,
} from 'lucide-react';
import { PageHead, Chip, NexAsk, Beta, useApp } from '../ui';
import { Donut, Bars, Legend, Line, type Segment } from '../charts';
import { finance, charges, payroll, budgetLines, reports, students } from '../data';
import { useCollection, type Entity } from '../beta/store';
import { EntityManager } from '../beta/manager';

const rub = (n: number) => '₽ ' + n.toLocaleString('ru');

/* ---------- общий заголовок финансового раздела с ИИ-подсказкой ---------- */
function FinNote({ children, ask, tone = 'ai' }: { children: ReactNode; ask: string; tone?: 'ai' | 'warn' }) {
  return (
    <div className="ai-card" style={{ marginBottom: 16, ...(tone === 'warn' ? { borderLeftColor: 'var(--warn)' } : {}) }}>
      <div className="ai-head" style={tone === 'warn' ? { color: 'var(--warn)' } : {}}><Sparkles size={14} /> NEX</div>
      <div className="ai-body">{children}</div>
      <div className="ai-actions"><NexAsk q={ask} label="Разобрать" subtle={false} /></div>
    </div>
  );
}

/* ============================ Обзор (финансовый кокпит) ============================ */
const krub = (n: number) => '₽ ' + Math.round(n / 1000) + 'K';

export function FinOverview() {
  const { toast } = useApp();
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [done, setDone] = useState<string[]>([]);
  const mult = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
  const income = 1240000 * mult;
  const expense = 968000 * mult;
  const net = income - expense;
  const openingCash = 3820000;
  const cashEnd = openingCash + net * 0.4;
  const payrollFund = payroll.reduce((a, w) => a + w.base + w.bonus, 0);
  const dueThisWeek = payrollFund + 214000 + 148000 + 52300;
  const freeCash = cashEnd - dueThisWeek;
  const flowLen = period === 'month' ? 12 : period === 'quarter' ? 8 : 6;
  const flow = Array.from({ length: flowLen }, (_, i) => 3200 + Math.round(Math.sin(i * 0.8) * 420 + i * 55));
  const incomeSegs: Segment[] = [
    { label: 'Контракты (обучение)', value: 820, color: 'var(--accent)' },
    { label: 'Бюджетное финансирование', value: 340, color: 'var(--ai)' },
    { label: 'Доп. услуги', value: 80, color: 'var(--success)' },
  ];
  const aging = [
    { label: '0–30 дней', value: 96000, color: 'var(--success)' },
    { label: '31–60 дней', value: 88000, color: 'var(--warn)' },
    { label: '60+ дней', value: 64000, color: 'var(--danger)' },
  ];
  const actions = [
    { id: 'bank', priority: 'Сейчас', title: 'Сверить выписку банка', note: '3 операции на ₽ 184 700 без сопоставления', tone: 'var(--danger)', cta: 'Открыть сверку' },
    { id: 'payroll', priority: 'Сегодня', title: 'Подготовить зарплатную ведомость', note: `ФОТ ${rub(payrollFund)} · выплата 5 августа`, tone: 'var(--warn)', cta: 'Проверить ведомость' },
    { id: 'debt', priority: 'До 15:00', title: 'Запустить взыскание просрочки 60+', note: '4 контрагента · ₽ 64 000', tone: 'var(--danger)', cta: 'Сформировать письма' },
    { id: 'close', priority: 'На этой неделе', title: 'Закрыть июнь', note: '8 из 11 контрольных процедур выполнены', tone: 'var(--ai)', cta: 'Открыть чек-лист' },
  ];
  const incomplete = actions.filter((a) => !done.includes(a.id));
  const complete = (id: string, label: string) => {
    setDone((items) => [...items, id]);
    toast(`${label}: задача отмечена выполненной`);
  };

  return (
    <div className="fade content-narrow">
      <PageHead title="Финансы" sub="Живая финансовая картина и следующие действия"
        actions={<>
          <div className="seg">
            <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Месяц</button>
            <button className={period === 'quarter' ? 'on' : ''} onClick={() => setPeriod('quarter')}>Квартал</button>
            <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Год</button>
          </div>
          <button className="btn btn-outline" onClick={() => toast('Собран пакет для финансового директора')}><Download size={15} />Пакет отчётов</button>
        </>} />

      <FinNote ask="Составь план работы финансового отдела на сегодня: приоритизируй риски, платежи и закрытие периода">
        <b>Деньги под контролем:</b> после обязательств этой недели останется <b style={{ color: freeCash >= 0 ? 'var(--success)' : 'var(--danger)' }}>{rub(freeCash)}</b>.
        Но три банковские операции ещё не сверены, а <b>{rub(64000)}</b> дебиторки перешло в 60+ дней. Ниже — очередь, которую стоит разобрать первой.
      </FinNote>

      <div className="fin-kpis">
        <div className="fin-kpi hero">
          <div className="fin-kpi-l">Доступно после обязательств</div>
          <div className="fin-kpi-v">{rub(Math.round(freeCash))}</div>
          <div className="fin-kpi-spark"><Line data={flow} height={44} color="var(--success)" /></div>
          <div className="fin-kpi-foot"><TrendingUp size={13} /> прогноз на конец периода {rub(Math.round(cashEnd))}</div>
        </div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowDownLeft size={13} /> Поступления</div><div className="fin-kpi-v" style={{ color: 'var(--success)' }}>{rub(income)}</div><div className="fin-kpi-foot ok">+8% к плану</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowUpRight size={13} /> Обязательства недели</div><div className="fin-kpi-v">{rub(dueThisWeek)}</div><div className="fin-kpi-foot">ФОТ, налоги, поставщики</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><Receipt size={13} /> Несверенные операции</div><div className="fin-kpi-v" style={{ color: 'var(--danger)' }}>3</div><div className="fin-kpi-foot bad">₽ 184 700 требуют решения</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><CheckCircle2 size={13} /> Закрытие июня</div><div className="fin-kpi-v">8 / 11</div><div className="fin-kpi-foot">3 контрольные точки</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><div className="card-title">Что требует вашего решения</div><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{incomplete.length ? `${incomplete.length} задачи до безопасного состояния` : 'Очередь разобрана — можно переходить к плановым задачам'}</div></div><NexAsk q="Объясни риски в финансовой очереди и предложи порядок действий" label="Разобрать приоритеты" /></div>
        <div className="row-list">
          {incomplete.map((a) => (
            <div className="feed-row" key={a.id}>
              <div className="feed-ico" style={{ background: 'var(--surface-2)', color: a.tone }}><Sparkles size={14} /></div>
              <div className="feed-main"><div className="t"><span style={{ color: a.tone, fontSize: 11, fontWeight: 700, marginRight: 8 }}>{a.priority.toUpperCase()}</span>{a.title}</div><div className="m">{a.note}</div></div>
              <button className="btn btn-sm btn-outline" onClick={() => complete(a.id, a.title)}>{a.cta}</button>
            </div>
          ))}
          {!incomplete.length && <div className="card-body muted">Критичная очередь пуста. NEX продолжает отслеживать новые операции и сроки.</div>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><div className="card-title">Ликвидность: ближайшие 14 дней</div><NexAsk q="Построй консервативный прогноз ликвидности на 14 дней с учётом обязательств и дебиторки" label="Сценарии" /></div>
          <div className="card-body">
            <Line data={flow} min={Math.min(...flow) - 200} max={Math.max(...flow) + 200} />
            <div className="grid cols-2" style={{ marginTop: 14 }}>
              <div><div className="kpi-label">На счетах сейчас</div><div className="kpi-value" style={{ fontSize: 21 }}>{rub(openingCash)}</div></div>
              <div><div className="kpi-label">Запас после платежей</div><div className="kpi-value" style={{ fontSize: 21, color: 'var(--success)' }}>{rub(Math.round(freeCash))}</div></div>
            </div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Доходы: факт против источников</div></div>
          <div className="card-body chart-flex"><Donut segments={incomeSegs} centerTop={krub(income)} centerSub="поступления" /><Legend segments={incomeSegs} withValues /></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><div className="card-title">Дебиторка — не просто сумма</div><NexAsk q="Кого из должников уведомить сегодня: приоритет, текст и ожидаемый эффект" label="Подготовить взыскание" /></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {aging.map((a) => (
              <div key={a.label}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}><span>{a.label}</span><span className="mono" style={{ fontWeight: 600 }}>{rub(a.value)}</span></div><div className="meter" style={{ height: 9 }}><i style={{ width: `${(a.value / 96000) * 100}%`, background: a.color }} /></div></div>
            ))}
            <div className="muted" style={{ fontSize: 12 }}>Цель на сегодня: вернуть в работу все 4 долга 60+ и зафиксировать результат коммуникации.</div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Закрытие периода</div><NexAsk q="Проверь готовность закрытия июня и перечисли отсутствующие первичные документы" label="Проверить закрытие" /></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[['Банк и касса', 'Сверить 3 операции', 'var(--danger)'], ['Расчёты с поставщиками', '2 акта ожидают проведения', 'var(--warn)'], ['Налоги и ФОТ', 'Контроль выполнен', 'var(--success)']].map(([title, note, tone]) => (
              <div key={title} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><div><div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div><div className="muted" style={{ fontSize: 12 }}>{note}</div></div><span style={{ width: 9, height: 9, borderRadius: 9, background: tone, flex: '0 0 auto' }} /></div>
            ))}
            <button className="btn btn-outline" onClick={() => toast('Открыт чек-лист закрытия периода')}><CheckCircle2 size={14} />Открыть полный чек-лист</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ Платежи ============================ */
export function FinPayments() {
  const tone = (s: string) => (s === 'Оплачено' ? 'chip-success' : s === 'Просрочено' ? 'chip-danger' : 'chip-warn');
  return (
    <div className="fade content-narrow">
      <PageHead title="Платежи" sub="Реестр поступлений за период" actions={<button className="btn btn-outline"><Download size={15} />Выгрузить</button>} />
      <div className="card">
        <div className="card-head"><div className="card-title">Все платежи</div><NexAsk q="Собери отчёт по платежам и найди аномалии" label="Отчёт" /></div>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Студент</th><th>Группа</th><th className="right">Сумма</th><th>Дата</th><th>Способ</th><th>Статус</th></tr></thead>
          <tbody>{finance.payments.map((p) => (
            <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.student}</td><td className="mono">{p.group}</td>
              <td className="right mono">{rub(p.sum)}</td><td>{p.date}</td><td className="muted">{p.method}</td>
              <td><Chip tone={tone(p.status)}>{p.status}</Chip></td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

/* ============================ Задолженности ============================ */
export function FinDebts() {
  const { toast } = useApp();
  const debtors = charges.filter((c) => !c.paid);
  const total = debtors.reduce((a, c) => a + c.sum, 0);
  return (
    <div className="fade content-narrow">
      <PageHead title="Задолженности" sub={`${debtors.length} неоплаченных начислений на ${rub(total)}`}
        actions={<button className="btn btn-primary" onClick={() => toast('Напоминания отправлены всем должникам')}><Send size={15} />Напомнить всем</button>} />
      <FinNote tone="warn" ask="Кого уведомить в первую очередь и на какую сумму закроется долг">
        Ближе всего к сроку — двое по обучению (до 30 июня). Если напомнить сегодня, вероятность оплаты в срок выше на треть.
      </FinNote>
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Студент</th><th>Группа</th><th>За что</th><th className="right">Сумма</th><th>Срок</th><th></th></tr></thead>
        <tbody>{debtors.map((c) => (
          <tr key={c.id}><td style={{ fontWeight: 600 }}>{c.student}</td><td className="mono">{c.group}</td>
            <td className="muted">{c.kind}</td><td className="right mono">{rub(c.sum)}</td><td>{c.due}</td>
            <td className="right"><button className="btn btn-sm btn-outline" onClick={() => toast(`Напоминание отправлено: ${c.student}`)}>Напомнить</button></td></tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}

/* ============================ Начисления ============================ */
export function FinCharges() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Начисления" sub="Что кому выставлено к оплате"
        actions={<button className="btn btn-primary" onClick={() => toast('Функция в разработке')}>Новое начисление</button>} />
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Студент</th><th>Группа</th><th>Основание</th><th className="right">Сумма</th><th>Срок</th><th>Статус</th></tr></thead>
        <tbody>{charges.map((c) => (
          <tr key={c.id}><td style={{ fontWeight: 600 }}>{c.student}</td><td className="mono">{c.group}</td>
            <td className="muted">{c.kind}</td><td className="right mono">{rub(c.sum)}</td><td>{c.due}</td>
            <td>{c.paid ? <Chip tone="chip-success">Оплачено</Chip> : <Chip tone="chip-warn">Ждём оплату</Chip>}</td></tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}

/* ============================ Расчёты (калькуляторы) ============================ */
export function FinCalc() {
  const [sum, setSum] = useState(124000);
  const [months, setMonths] = useState(10);
  const [penalty, setPenalty] = useState(false);
  const per = Math.round(sum / Math.max(months, 1));
  const withPenalty = Math.round(sum * 1.05);
  return (
    <div className="fade content-narrow">
      <PageHead title="Расчёты" sub="Рассрочка, пеня, прогноз — считаем на месте" />
      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><div className="card-title"><Calculator size={15} /> Рассрочка</div></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><label className="field-label">Сумма договора</label><input className="input" type="number" value={sum} onChange={(e) => setSum(+e.target.value || 0)} /></div>
            <div><label className="field-label">Срок: {months} мес.</label><input type="range" min={1} max={24} value={months} onChange={(e) => setMonths(+e.target.value)} style={{ width: '100%' }} /></div>
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
              <div><div className="kpi-label">Платёж в месяц</div><div className="kpi-value" style={{ fontSize: 24 }}>{rub(per)}</div></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={penalty} onChange={(e) => setPenalty(e.target.checked)} /> пеня 5% при просрочке</label>
              {penalty && <div><div className="kpi-label">Итого с пеней</div><div className="kpi-value" style={{ fontSize: 24, color: 'var(--danger)' }}>{rub(withPenalty)}</div></div>}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Прогноз поступлений</div></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>Если из 8 должников заплатят 5 до 30 июня, закроется около <b>₽ 155 000</b> из ₽ 248 000. Остаток перейдёт на июль.</div>
            <div className="grid cols-2">
              <div className="kpi"><div className="kpi-label">Оптимистично</div><div className="kpi-value" style={{ fontSize: 22, color: 'var(--success)' }}>₽ 248K</div></div>
              <div className="kpi"><div className="kpi-label">Реалистично</div><div className="kpi-value" style={{ fontSize: 22 }}>₽ 155K</div></div>
            </div>
            <NexAsk q="Посчитай, сколько соберём при разных сценариях оплаты должников" label="Пересчитать сценарии" subtle={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ Зарплата ============================ */
export function FinPayroll() {
  const total = payroll.reduce((a, w) => a + w.base + w.bonus, 0);
  return (
    <div className="fade content-narrow">
      <PageHead title="Зарплата" sub={`Ведомость за июнь · фонд ${rub(total)}`} actions={<button className="btn btn-outline"><Download size={15} />Ведомость</button>} />
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Сотрудник</th><th>Должность</th><th className="right">Оклад</th><th className="right">Премия</th><th className="right">К выплате</th></tr></thead>
        <tbody>{payroll.map((w) => (
          <tr key={w.id}><td style={{ fontWeight: 600 }}>{w.name}</td><td className="muted">{w.role}</td>
            <td className="right mono">{rub(w.base)}</td><td className="right mono">{w.bonus ? rub(w.bonus) : '—'}</td>
            <td className="right mono" style={{ fontWeight: 700 }}>{rub(w.base + w.bonus)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>Итого фонд</td><td className="right mono" style={{ fontWeight: 700 }}>{rub(total)}</td></tr></tfoot>
      </table></div></div>
    </div>
  );
}

/* ============================ Стипендии ============================ */
interface Scholarship extends Entity, Record<string, unknown> { student: string; group: string; type: string; sum: number; basis: string; }
const SCHOLARSHIP_SEED: Scholarship[] = finance.scholarships.map((s) => ({
  id: s.id, student: s.student, group: s.group, type: s.type, sum: s.sum, basis: s.basis,
}));
const STUD_OPTS = students.map((s) => `${s.lastname} ${s.firstname[0]}.${s.patronymic[0]}.`);
const GROUP_OPTS = [...new Set(students.map((s) => s.group))];

export function FinScholarship() {
  const col = useCollection<Scholarship>('fin-scholarships', SCHOLARSHIP_SEED);
  const total = col.items.reduce((a, s) => a + s.sum, 0);
  return (
    <div className="fade content-narrow">
      <PageHead title="Стипендии" sub={`${col.items.length} назначений · фонд ${rub(total)} в месяц`} actions={<Beta />} />
      <FinNote ask="Кто претендует на повышенную стипендию и на каком основании">
        Назначайте, изменяйте и снимайте стипендии, выгружайте ведомость. Кандидаты подбираются по успеваемости и подтверждающим документам.
      </FinNote>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Получателей</div><div className="kpi-value">{col.items.length}</div></div>
        <div className="kpi"><div className="kpi-label">Фонд в месяц</div><div className="kpi-value">{rub(total)}</div></div>
        <div className="kpi"><div className="kpi-label">Повышенных</div><div className="kpi-value">{col.items.filter((s) => /повыш/i.test(s.type)).length}</div></div>
      </div>
      <EntityManager title="Стипендии" col={col} empty="Стипендии ещё не назначены"
        columns={[
          { key: 'student', label: 'Студент' }, { key: 'group', label: 'Группа' },
          { key: 'type', label: 'Тип', kind: 'chip' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'basis', label: 'Основание' },
        ]}
        fields={[
          { key: 'student', label: 'Студент', options: STUD_OPTS },
          { key: 'group', label: 'Группа', options: GROUP_OPTS },
          { key: 'type', label: 'Тип стипендии', options: ['Академическая', 'Повышенная', 'Социальная', 'Именная', 'Президентская'] },
          { key: 'sum', label: 'Сумма, ₽/мес', type: 'number' },
          { key: 'basis', label: 'Основание', type: 'textarea' },
        ]} />
    </div>
  );
}

/* ============================ Бюджет ============================ */
export function FinBudget() {
  const plan = budgetLines.reduce((a, b) => a + b.plan, 0);
  const fact = budgetLines.reduce((a, b) => a + b.fact, 0);
  return (
    <div className="fade content-narrow">
      <PageHead title="Бюджет" sub={`План ${rub(plan)} · исполнено ${rub(fact)} (${Math.round((fact / plan) * 100)}%)`} />
      <div className="card"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {budgetLines.map((b) => {
          const pct = Math.min((b.fact / b.plan) * 100, 130);
          const over = b.fact > b.plan;
          return (
            <div key={b.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{b.name}</span>
                <span className="mono">{rub(b.fact)} <span className="muted">/ {rub(b.plan)}</span></span>
              </div>
              <div className="meter" style={{ height: 10 }}><i style={{ width: `${Math.min(pct, 100)}%`, background: over ? 'var(--danger)' : 'var(--accent)' }} /></div>
              {over && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>Перерасход {rub(b.fact - b.plan)}</div>}
            </div>
          );
        })}
      </div></div>
    </div>
  );
}

/* ============================ Отчёты ============================ */
export function FinReports() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Отчёты" sub="Готовые бухгалтерские документы" />
      <div className="grid cols-2">
        {reports.map((r) => (
          <div className="card" key={r.id}><div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="feed-ico"><Landmark size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{r.period}</div>
            </div>
            {r.ready
              ? <button className="btn btn-sm btn-outline" onClick={() => toast(`Скачивание: ${r.name}`)}><Download size={14} />Скачать</button>
              : <Chip tone="chip-warn">готовится</Chip>}
          </div></div>
        ))}
      </div>
    </div>
  );
}

/* иконки для подпунктов (используются в App для меню) */
export const FIN_ICONS = { TrendingUp, Receipt, HandCoins, FileBarChart, Calculator, Banknote, PiggyBank, Landmark, CheckCircle2 };
