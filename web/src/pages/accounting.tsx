import { useState, type ReactNode } from 'react';
import {
  TrendingUp, Receipt, HandCoins, FileBarChart, Calculator, Banknote,
  PiggyBank, Landmark, Download, Send, CheckCircle2, Sparkles,
} from 'lucide-react';
import { PageHead, Chip, NexAsk, useApp } from '../ui';
import { Donut, Bars, Legend, type Segment } from '../charts';
import { finance, charges, payroll, budgetLines, reports } from '../data';

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

/* ============================ Обзор ============================ */
export function FinOverview() {
  const received = finance.payments.filter((p) => p.status === 'Оплачено').reduce((a, p) => a + p.sum, 0);
  const segs: Segment[] = [
    { label: 'Поступило', value: received, color: 'var(--success)' },
    { label: 'Задолженность', value: 248000, color: 'var(--danger)' },
  ];
  return (
    <div className="fade content-narrow">
      <PageHead title="Финансы · Обзор" sub="Живая картина денег за текущий месяц" />
      <FinNote ask="Сделай финансовую сводку: поступления, долги, риски, что сделать в первую очередь">
        Поступило <b>{rub(received)}</b>, ждём ещё <b>₽ 248 000</b> от 8 студентов до 30 июня.
        Прогноз на месяц — около <b>₽ 512 000</b>. Три платежа помечены как аномальные — стоит проверить.
      </FinNote>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Поступило</div><div className="kpi-value">{rub(received)}</div></div>
        <div className="kpi"><div className="kpi-label">Задолженность</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>₽ 248 000</div></div>
        <div className="kpi"><div className="kpi-label">Должников</div><div className="kpi-value">8</div></div>
        <div className="kpi"><div className="kpi-label">Прогноз</div><div className="kpi-value" style={{ color: 'var(--success)' }}>₽ 512K</div></div>
      </div>
      <div className="grid cols-2">
        <div className="card"><div className="card-head"><div className="card-title">Поступления и долги</div></div>
          <div className="card-body chart-flex"><Donut segments={segs} centerTop="₽" centerSub="месяц" /><Legend segments={segs} withValues /></div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Исполнение бюджета</div></div>
          <div className="card-body"><Bars data={budgetLines.map((b) => ({ label: b.name.split(' ')[0], value: Math.round(b.fact / 1000) }))} /></div>
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
export function FinScholarship() {
  return (
    <div className="fade content-narrow">
      <PageHead title="Стипендии" sub="Назначения текущего семестра" />
      <FinNote ask="Кто претендует на повышенную стипендию и на каком основании">
        Кандидаты подобраны по успеваемости и подтверждающим документам. Основание указано в каждой строке.
      </FinNote>
      <div className="card"><div className="table-wrap"><table className="tbl">
        <thead><tr><th>Студент</th><th>Группа</th><th>Тип</th><th className="right">Сумма</th><th>Основание</th></tr></thead>
        <tbody>{finance.scholarships.map((s) => (
          <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.student}</td><td className="mono">{s.group}</td>
            <td><Chip tone="chip-info">{s.type}</Chip></td><td className="right mono">{rub(s.sum)}</td>
            <td className="muted" style={{ fontSize: 12.5 }}>{s.basis}</td></tr>
        ))}</tbody>
      </table></div></div>
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
