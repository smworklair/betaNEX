import { useState } from 'react';
import { Plus, Sparkles, AlertTriangle, FileText, Calculator } from 'lucide-react';
import { PageHead, Chip, NexAsk, Soon, useApp } from '../ui';
import { admissions, finance } from '../data';
import { AiBox } from './aibox';

export function Admissions() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'apps' | 'reg' | 'stats'>('apps');
  return (
    <div className="fade content-narrow">
      <PageHead title="Приём" sub="Приёмная кампания 2024" actions={<><Soon /><button className="btn btn-primary" onClick={() => toast('Функция в разработке')}><Plus size={15} />Заявление</button></>} />

      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'apps' ? 'on' : ''} onClick={() => setTab('apps')}>Заявления</button>
        <button className={tab === 'reg' ? 'on' : ''} onClick={() => setTab('reg')}>Регистрация</button>
        <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>Статистика</button>
      </div>

      {tab === 'apps' && (
        <>
          <div className="ai-card" style={{ marginBottom: 16 }}>
            <div className="ai-head"><Sparkles size={14} /> Обработка документов</div>
            <div className="ai-body">Поля распознаны из загруженных документов автоматически. Найден <b>возможный дубликат</b> — отмечен в списке.</div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Абитуриент</th><th>Специальность</th><th className="right">Баллы</th><th>Статус</th><th>Заметки ИИ</th></tr></thead>
                <tbody>
                  {admissions.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td className="muted">{a.spec}</td>
                      <td className="right mono" style={{ fontWeight: 600 }}>{a.score}</td>
                      <td><Chip tone={a.status === 'Рекомендован' ? 'chip-success' : a.status === 'На рассмотрении' ? 'chip-info' : 'chip-warn'}>{a.status}</Chip></td>
                      <td>{a.flag ? <span className="ai-inline"><Sparkles size={12} />{a.flag}</span> : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {tab === 'reg' && (
        <>
        <AiBox
          title="Помощь с регистрацией"
          placeholder="Например: какие документы нужны для очной бюджетной формы?"
          quick={['Какие документы нужны?', 'Проверь проходной балл на ПИ', 'Подходит ли абитуриент на бюджет?']}
          system="Ты — помощник приёмной комиссии колледжа. Специальности: Прикладная информатика (проходной ~240), Информационные системы (~235), Экономика и бухучёт (~220). Формы: очная/заочная, бюджет/контракт. Помогай с документами, проходными баллами и подбором формы обучения. Отвечай кратко и по делу."
          fallback={(q) => `По запросу «${q}»: для очной бюджетной формы нужны аттестат, паспорт, 4 фото и заявление. Проходной на ПИ ~240 баллов. Подключите ИИ для точных ответов по конкретному абитуриенту.`}
        />
        <div className="card"><div className="card-body grid cols-2">
          <div><label className="field-label">ФИО абитуриента</label><input className="input" placeholder="Введите ФИО" /></div>
          <div><label className="field-label">Специальность</label><select className="select"><option>Прикладная информатика</option><option>Информационные системы</option><option>Экономика и бухучёт</option></select></div>
          <div><label className="field-label">Средний балл аттестата</label><input className="input" placeholder="0.00" /></div>
          <div><label className="field-label">Телефон</label><input className="input" placeholder="+7 ___ ___-__-__" /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}><button className="btn btn-primary" onClick={() => toast('Функция в разработке')}>Зарегистрировать</button><Soon /></div>
        </div></div>
        </>
      )}
      {tab === 'stats' && (
        <div className="grid cols-3">
          <div className="kpi"><div className="kpi-label">Всего заявлений</div><div className="kpi-value">3</div></div>
          <div className="kpi"><div className="kpi-label">Средний балл</div><div className="kpi-value">238</div></div>
          <div className="kpi"><div className="kpi-label">Конкурс</div><div className="kpi-value">2.4</div></div>
        </div>
      )}
    </div>
  );
}

/* Интерактивный финансовый калькулятор: реальные расчёты, а не заглушка */
function FinanceCalc() {
  const [sum, setSum] = useState(124000);
  const [months, setMonths] = useState(10);
  const [penalty, setPenalty] = useState(false);
  const perMonth = Math.round(sum / Math.max(months, 1));
  const withPenalty = Math.round(sum * 1.05);
  const fmt = (n: number) => '₽ ' + n.toLocaleString('ru');
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="card-title"><Calculator size={15} /> Калькулятор рассрочки</div></div>
      <div className="card-body grid cols-2" style={{ gap: 14 }}>
        <div>
          <label className="field-label">Сумма контракта</label>
          <input className="input" type="number" value={sum} onChange={(e) => setSum(+e.target.value || 0)} />
        </div>
        <div>
          <label className="field-label">Срок рассрочки: {months} мес.</label>
          <input type="range" min={1} max={24} value={months} onChange={(e) => setMonths(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div className="kpi-label">Платёж в месяц</div><div className="kpi-value" style={{ fontSize: 22 }}>{fmt(perMonth)}</div></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={penalty} onChange={(e) => setPenalty(e.target.checked)} /> с пеней 5% при просрочке
          </label>
          {penalty && <div><div className="kpi-label">Итого с пеней</div><div className="kpi-value" style={{ fontSize: 22, color: 'var(--danger)' }}>{fmt(withPenalty)}</div></div>}
        </div>
      </div>
    </div>
  );
}

export function Finance() {
  const { toast } = useApp();
  const tone = (s: string) => (s === 'Оплачено' ? 'chip-success' : s === 'Просрочено' ? 'chip-danger' : 'chip-warn');
  const total = finance.payments.reduce((a, p) => a + (p.status === 'Оплачено' ? p.sum : 0), 0);
  return (
    <div className="fade content-narrow">
      <PageHead title="Деньги" sub="Кто заплатил, кто должен и сколько ждём в этом месяце" actions={<><Soon /><button className="btn btn-outline" onClick={() => toast('Функция в разработке')}><FileText size={15} />Выгрузить</button></>} />

      <p className="home-brief" style={{ fontSize: 15.5, marginBottom: 18 }}>
        В этом месяце уже поступило <b>₽ {total.toLocaleString('ru')}</b>. Ещё <b>₽ 248 000</b> должны 8 студентов —
        срок по договору до 30 июня. Если вовремя напомнить, к концу месяца ожидаем около <b>₽ 512 000</b>.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Поступило</div><div className="kpi-value">₽ {total.toLocaleString('ru')}</div></div>
        <div className="kpi"><div className="kpi-label">Задолженность</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>₽ 248 000</div></div>
        <div className="kpi"><div className="kpi-label">Должников</div><div className="kpi-value">8</div></div>
        <div className="kpi"><div className="kpi-label">Прогноз на месяц</div><div className="kpi-value" style={{ color: 'var(--success)' }}>₽ 512K</div><div className="kpi-foot" style={{ color: 'var(--success)' }}>по графику оплат</div></div>
      </div>

      <FinanceCalc />

      <AiBox
        title="Финансовый ИИ"
        placeholder="Например: посчитай, сколько соберём, если 5 должников оплатят до 30.06"
        quick={['Прогноз поступлений на месяц', 'Кого срочно уведомить об оплате?', 'Разбей задолженность по группам']}
        system="Ты — финансовый аналитик колледжа. Поступило ~₽124K, задолженность ₽248K (8 должников, срок до 30.06), 3 аномальных платежа от одного контрагента, прогноз поступлений ~₽512K/мес. Помогай считать, прогнозировать и приоритизировать. Отвечай с цифрами, кратко."
        fallback={(q) => `По запросу «${q}»: при оплате 5 из 8 должников до 30.06 закроется ~₽155K из ₽248K долга. Точные расчёты — после подключения ИИ.`}
      />

      <div className="ai-card" style={{ marginBottom: 16, borderLeftColor: 'var(--warn)' }}>
        <div className="ai-head" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> Аномалия в платежах</div>
        <div className="ai-body">Три перевода на нетипичную сумму от одного контрагента. Рекомендуется проверка перед закрытием периода.</div>
        <div className="ai-actions"><NexAsk q="Покажи аномальные платежи и объясни, почему они помечены" label="Разобрать аномалию" subtle={false} /></div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Платежи</div><NexAsk q="Сформируй финансовый отчёт по платежам и задолженности за период" label="Собрать отчёт" /></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Студент</th><th>Группа</th><th className="right">Сумма</th><th>Дата</th><th>Способ</th><th>Статус</th></tr></thead>
            <tbody>
              {finance.payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.student}</td>
                  <td className="mono">{p.group}</td>
                  <td className="right mono">₽ {p.sum.toLocaleString('ru')}</td>
                  <td>{p.date}</td>
                  <td className="muted">{p.method}</td>
                  <td><Chip tone={tone(p.status)}>{p.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Scholarship() {
  return (
    <div className="fade content-narrow">
      <PageHead title="Стипендии" sub="Назначения текущего семестра" />
      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Sparkles size={14} /> Подбор кандидатов</div>
        <div className="ai-body">Право на стипендию рассчитано по успеваемости и подтверждающим документам — с указанием основания в каждой строке.</div>
        <div className="ai-actions"><NexAsk q="Кто претендует на повышенную стипендию и почему?" label="Разобрать кандидатов" subtle={false} /></div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Студент</th><th>Группа</th><th>Тип</th><th className="right">Сумма</th><th>Основание</th></tr></thead>
            <tbody>
              {finance.scholarships.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.student}</td>
                  <td className="mono">{s.group}</td>
                  <td><Chip tone="chip-info">{s.type}</Chip></td>
                  <td className="right mono">₽ {s.sum.toLocaleString('ru')}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{s.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
