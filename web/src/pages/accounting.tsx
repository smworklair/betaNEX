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
  const mult = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;

  const income = 1240000 * mult;                    // поступления
  const expense = 968000 * mult;                    // расходы (ФОТ, содержание, стипендии)
  const net = income - expense;                     // чистый денежный поток
  const cashEnd = 3820000 + net * 0.4;              // остаток на счетах и в кассе
  const receivable = 248000;                        // дебиторская задолженность
  const payable = 200300;                           // кредиторская задолженность
  const payrollFund = payroll.reduce((a, w) => a + w.base + w.bonus, 0);

  /* движение денег по периодам */
  const flowLen = period === 'month' ? 12 : period === 'quarter' ? 8 : 6;
  const flow = Array.from({ length: flowLen }, (_, i) => 3200 + Math.round(Math.sin(i * 0.8) * 420 + i * 55));

  /* доходы / расходы — структура */
  const incomeSegs: Segment[] = [
    { label: 'Контракты (обучение)', value: 820, color: 'var(--accent)' },
    { label: 'Бюджетное финансирование', value: 340, color: 'var(--ai)' },
    { label: 'Доп. услуги', value: 80, color: 'var(--success)' },
  ];
  const expenseSegs: Segment[] = [
    { label: 'Зарплата (ФОТ)', value: 560, color: 'var(--warn)' },
    { label: 'Содержание', value: 261, color: 'var(--danger)' },
    { label: 'Стипендии', value: 147, color: 'var(--accent)' },
  ];

  /* дебиторка по срокам (aging) */
  const aging = [
    { label: 'Текущая (0–30 дн.)', value: 96000, color: 'var(--success)' },
    { label: 'Просрочка 31–60 дн.', value: 88000, color: 'var(--warn)' },
    { label: 'Просрочка 60+ дн.', value: 64000, color: 'var(--danger)' },
  ];
  const agingMax = Math.max(...aging.map((a) => a.value));

  const topDebtors = charges.filter((c) => !c.paid).sort((a, b) => b.sum - a.sum).slice(0, 4);
  const upcoming = [
    { label: 'Зарплата за июль', due: '5 авг', sum: payrollFund, kind: 'ФОТ' },
    { label: 'НДФЛ и взносы', due: '15 авг', sum: 214000, kind: 'Налоги' },
    { label: 'Оплата ООО «Техносервис»', due: '10 июл', sum: 148000, kind: 'Поставщик' },
    { label: 'Электроэнергия, июнь', due: '15 июл', sum: 52300, kind: 'Коммуналка' },
  ];

  return (
    <div className="fade content-narrow">
      <PageHead title="Финансы · Обзор" sub="Финансовый кокпит: денежный поток, задолженность, бюджет и обязательства"
        actions={<>
          <div className="seg">
            <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Месяц</button>
            <button className={period === 'quarter' ? 'on' : ''} onClick={() => setPeriod('quarter')}>Квартал</button>
            <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Год</button>
          </div>
          <button className="btn btn-outline" onClick={() => toast('Финансовый отчёт выгружен')}><Download size={15} />Экспорт</button>
        </>} />

      <FinNote ask="Сделай финансовую сводку: денежный поток, задолженность, риски, что сделать в первую очередь">
        Чистый поток за период — <b style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{net >= 0 ? '+' : ''}{rub(net)}</b>.
        Дебиторка <b>{rub(receivable)}</b> (из них просрочено {rub(152000)}), кредиторка <b>{rub(payable)}</b>.
        Ближайшее крупное обязательство — зарплата <b>{rub(payrollFund)}</b> до 5 августа. Три платежа помечены как аномальные.
      </FinNote>

      {/* Ключевые показатели */}
      <div className="fin-kpis">
        <div className="fin-kpi hero">
          <div className="fin-kpi-l">Денежные средства</div>
          <div className="fin-kpi-v">{rub(Math.round(cashEnd))}</div>
          <div className="fin-kpi-spark"><Line data={flow} height={44} color="var(--success)" /></div>
          <div className="fin-kpi-foot"><TrendingUp size={13} /> чистый поток {net >= 0 ? '+' : ''}{krub(net)}</div>
        </div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowDownLeft size={13} /> Поступления</div><div className="fin-kpi-v" style={{ color: 'var(--success)' }}>{rub(income)}</div><div className="fin-kpi-foot ok">+8% к плану</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowUpRight size={13} /> Расходы</div><div className="fin-kpi-v">{rub(expense)}</div><div className="fin-kpi-foot">исполнено 84%</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><HandCoins size={13} /> Дебиторка</div><div className="fin-kpi-v" style={{ color: 'var(--danger)' }}>{rub(receivable)}</div><div className="fin-kpi-foot bad">8 должников</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><CreditCard size={13} /> Кредиторка</div><div className="fin-kpi-v" style={{ color: 'var(--warn)' }}>{rub(payable)}</div><div className="fin-kpi-foot">2 обязательства</div></div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><div className="card-title">Движение денежных средств</div><NexAsk q="Разбери денежный поток и спрогнозируй остаток на конец периода" label="Прогноз" /></div>
          <div className="card-body"><Line data={flow} min={Math.min(...flow) - 200} max={Math.max(...flow) + 200} />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Тыс. ₽ · остаток на конец периода {rub(Math.round(cashEnd))}</div></div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Структура доходов</div></div>
          <div className="card-body chart-flex"><Donut segments={incomeSegs} centerTop={krub(income)} centerSub="доходы" /><Legend segments={incomeSegs} withValues /></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><div className="card-title">Дебиторка по срокам</div><NexAsk q="Кого из должников уведомить в первую очередь и на какую сумму" label="Кого уведомить" /></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {aging.map((a) => (
              <div key={a.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span>{a.label}</span><span className="mono" style={{ fontWeight: 600 }}>{rub(a.value)}</span>
                </div>
                <div className="meter" style={{ height: 9 }}><i style={{ width: `${(a.value / agingMax) * 100}%`, background: a.color }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Структура расходов</div></div>
          <div className="card-body chart-flex"><Donut segments={expenseSegs} centerTop={krub(expense)} centerSub="расходы" /><Legend segments={expenseSegs} withValues /></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><div className="card-title">Топ должников</div></div>
          <div className="row-list">
            {topDebtors.map((c) => (
              <div className="feed-row" key={c.id}>
                <div className="feed-ico" style={{ background: 'var(--danger-weak)', color: 'var(--danger)' }}><HandCoins size={14} /></div>
                <div className="feed-main"><div className="t">{c.student}</div><div className="m">{c.kind} · срок {c.due}</div></div>
                <span className="mono" style={{ fontWeight: 700 }}>{rub(c.sum)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Предстоящие обязательства</div><NexAsk q="Хватит ли остатка на все ближайшие платежи и налоги" label="Проверить ликвидность" /></div>
          <div className="row-list">
            {upcoming.map((u) => (
              <div className="feed-row" key={u.label}>
                <div className="feed-ico"><Landmark size={14} /></div>
                <div className="feed-main"><div className="t">{u.label}</div><div className="m">{u.kind} · до {u.due}</div></div>
                <span className="mono" style={{ fontWeight: 700 }}>{rub(u.sum)}</span>
              </div>
            ))}
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
