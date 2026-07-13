import { useState, useMemo, useRef, useEffect, type ReactNode, type FormEvent } from 'react';
import {
  Sparkles, TrendingUp, ArrowDownLeft, ArrowUpRight, Receipt, CheckCircle2,
  Download, Wand2, ArrowUp, ShieldCheck, AlertTriangle, Landmark, Wallet,
  Link2, Unlink, PiggyBank, Scale, Gauge as GaugeIcon, Flame,
  Building2, HandCoins, FileCheck2, Lock, Zap, Percent, RefreshCw, Info, Search,
} from 'lucide-react';
import { PageHead, NexAsk, Chip, useApp } from '../ui';
import { Line, DualLine, Donut, Legend, Gauge, HBars, Waterfall, type Segment } from '../charts';
import { payroll, budgetLines } from '../data';
import { useCollection, type Entity } from '../beta/store';

/* ============================================================
   Финансовый центр «Про»: единый AI-native кокпит для
   бухгалтера и экономиста. Живые расчёты на сид-данных,
   NEX-копайлот с числами, интерактивная сверка, закрытие
   периода и сценарное моделирование.
   ============================================================ */

const rub = (n: number) => '₽ ' + Math.round(n).toLocaleString('ru');
const krub = (n: number) => '₽ ' + Math.round(n / 1000).toLocaleString('ru') + 'K';
const mrub = (n: number) => '₽ ' + (n / 1e6).toFixed(1) + ' млн';
const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

/* ---------- базовая финансовая модель (единая на все экраны) ---------- */
const M = (() => {
  const payrollFund = payroll.reduce((a, w) => a + w.base + w.bonus, 0);
  const income = 1_240_000;
  const expense = 968_000;
  const taxes = 214_000;
  const suppliers = 148_000;
  const utilities = 52_300;
  const dueThisWeek = payrollFund + taxes + suppliers + utilities;
  const openingCash = 3_820_000;
  const net = income - expense;
  const cashEnd = openingCash + net * 0.4;
  const freeCash = cashEnd - dueThisWeek;
  const budgetPlan = budgetLines.reduce((a, b) => a + b.plan, 0);
  const budgetFact = budgetLines.reduce((a, b) => a + b.fact, 0);
  return { payrollFund, income, expense, taxes, suppliers, utilities, dueThisWeek, openingCash, net, cashEnd, freeCash, budgetPlan, budgetFact };
})();

/* ============================================================
   NEX-копайлот финансов — AI-native ядро раздела.
   Отвечает вычисленными числами и рисует ответ.
   ============================================================ */
interface CoAnswer { text: ReactNode; chart?: ReactNode; act?: { label: string; done: string }; }
type Intent = { id: string; label: string; icon: typeof Sparkles; kw: string; run: () => CoAnswer };

const flow14 = Array.from({ length: 14 }, (_, i) => (M.cashEnd - M.dueThisWeek * 0.5) / 1000 + Math.sin(i * 0.7) * 180 - i * 12);

function useCopilotIntents(): Intent[] {
  return useMemo(() => [
    {
      id: 'liquidity', label: 'Хватит ли денег до конца месяца?', icon: Wallet, kw: 'деньги ликвидность касса остаток хватит',
      run: () => ({
        text: <>После обязательств недели ({rub(M.dueThisWeek)}) на счетах останется <b style={{ color: 'var(--success)' }}>{rub(M.freeCash)}</b>. Кассовых разрывов в горизонте 14 дней <b>не прогнозируется</b> — минимум запаса {rub(Math.min(...flow14) * 1000)} около 9-го дня.</>,
        chart: <Line data={flow14} height={120} color="var(--success)" />,
      }),
    },
    {
      id: 'anomaly', label: 'Есть ли аномалии в платежах?', icon: AlertTriangle, kw: 'аномалия подозрительн мошенн платежи',
      run: () => ({
        text: <>Найдено <b style={{ color: 'var(--danger)' }}>3 операции на {rub(184_700)}</b> с признаками аномалии: нетипичная сумма и один контрагент за 40 минут. Отклонение от медианы платежа — <b>×6.2</b>. Рекомендую пометить на сверку до проведения.</>,
        act: { label: 'Пометить на сверку', done: '3 операции отмечены для сверки' },
      }),
    },
    {
      id: 'debt', label: 'Кого из должников уведомить первым?', icon: HandCoins, kw: 'долг дебиторка взыскание напомнить',
      run: () => ({
        text: <>В приоритете <b>4 контрагента 60+ дней на {rub(64_000)}</b>. По модели оплаты своевременное напоминание сегодня повышает возврат в срок на <b>≈34%</b>. Черновики писем готовы.</>,
        chart: <HBars data={[{ label: 'Лебедев С.А.', value: 62000, color: 'var(--danger)' }, { label: 'Смирнов П.Р.', value: 62000, color: 'var(--warn)' }, { label: 'ООО «Клин»', value: 38000, color: 'var(--warn)' }]} format={rub} />,
        act: { label: 'Сформировать письма', done: 'Письма-напоминания подготовлены' },
      }),
    },
    {
      id: 'budget', label: 'Где перерасход бюджета?', icon: Scale, kw: 'бюджет перерасход план факт исполнение отклонение',
      run: () => {
        const over = budgetLines.filter((b) => b.fact > b.plan);
        return {
          text: <>Исполнение бюджета <b>{Math.round((M.budgetFact / M.budgetPlan) * 100)}%</b>. Перерасход по статье <b>«{over[0]?.name}»</b> на {rub((over[0]?.fact ?? 0) - (over[0]?.plan ?? 0))} — драйвер: рост тарифов на содержание. Остальные статьи в пределах плана.</>,
          chart: <HBars data={budgetLines.map((b) => ({ label: b.name, value: b.fact - b.plan, color: b.fact > b.plan ? 'var(--danger)' : 'var(--success)' }))} format={rub} />,
        };
      },
    },
    {
      id: 'close', label: 'Что мешает закрыть период?', icon: FileCheck2, kw: 'закрытие период отчёт закрыть месяц',
      run: () => ({
        text: <>До закрытия июня осталось <b>3 из 11</b> контрольных процедур: сверить 3 банковские операции, провести 2 акта поставщиков, приложить первичку по хознуждам. Оценка времени — <b>~40 минут</b>.</>,
        act: { label: 'Открыть чек-лист', done: 'Открыт чек-лист закрытия' },
      }),
    },
    {
      id: 'forecast', label: 'Дай прогноз поступлений', icon: TrendingUp, kw: 'прогноз поступления выручка сценарий',
      run: () => ({
        text: <>Ожидаемые поступления до конца периода: <b style={{ color: 'var(--success)' }}>{rub(248_000)}</b> оптимистично, <b>{rub(155_000)}</b> базово. При текущей собираемости 94% реалистичная оценка — <b>{rub(180_000)}</b>.</>,
        chart: <DualLine a={[120, 138, 155, 172, 190, 210, 248]} b={[120, 130, 142, 150, 160, 170, 180]} height={120} />,
      }),
    },
  ], []);
}

function FinCopilot() {
  const { toast, openChat } = useApp();
  const intents = useCopilotIntents();
  const [log, setLog] = useState<{ q: string; a: CoAnswer }[]>([]);
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [log]);

  const answer = (query: string) => {
    const ql = query.toLowerCase();
    const hit = intents.find((i) => i.label.toLowerCase() === ql)
      || intents.find((i) => (i.label + ' ' + i.kw).toLowerCase().includes(ql))
      || null;
    const a: CoAnswer = hit ? hit.run() : {
      text: <>Готов посчитать по данным раздела: ликвидность, дебиторка, бюджет, закрытие, прогноз. Могу открыть полный чат NEX для свободного вопроса.</>,
      act: { label: 'Открыть чат NEX', done: '' },
    };
    setLog((l) => [...l, { q: query, a }]);
    setQ('');
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (q.trim()) answer(q.trim()); };

  return (
    <div className="fin-copilot">
      <div className="fin-copilot-head">
        <span className="fin-copilot-orb"><Sparkles size={15} /></span>
        <div>
          <b>NEX для финансов</b>
          <span className="fin-copilot-sub">спросите числами — отвечу числами и покажу график</span>
        </div>
        <span className="fin-live"><i />live</span>
      </div>

      {log.length > 0 && (
        <div className="fin-copilot-log">
          {log.map((m, i) => (
            <div key={i} className="fin-co-turn">
              <div className="fin-co-q"><Search size={12} className="qi" />{m.q}</div>
              <div className="fin-co-a">
                <div className="bd">
                  <div>{m.a.text}</div>
                  {m.a.chart && <div className="fin-co-chart">{m.a.chart}</div>}
                  {m.a.act && (
                    <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }}
                      onClick={() => (m.a.act!.done ? toast(m.a.act!.done) : openChat())}>
                      <Zap size={13} /> {m.a.act.label}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div className="fin-copilot-chips">
        {intents.map((it) => { const Icon = it.icon; return (
          <button key={it.id} className="fin-co-chip" onClick={() => answer(it.label)}>
            <Icon size={13} /> {it.label}
          </button>
        ); })}
      </div>

      <form className="fin-copilot-box" onSubmit={submit}>
        <Sparkles size={16} className="lead" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например: сколько свободных денег после зарплаты?" />
        <button className="ask-send sm" type="submit" aria-label="Спросить"><ArrowUp size={16} /></button>
      </form>
    </div>
  );
}

/* ============================================================
   Кокпит (Обзор) — единая живая картина финансов
   ============================================================ */
export function FinCockpit() {
  const { toast } = useApp();
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [scenario, setScenario] = useState<'base' | 'cautious'>('base');
  const [done, setDone] = useState<string[]>([]);
  const mult = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;

  const income = M.income * mult;
  const flow = useMemo(() => flow14.map((v, i) => v + (scenario === 'cautious' ? -i * 22 - 40 : 0)), [scenario]);
  const flowB = useMemo(() => flow14.map((v, i) => v - i * 30 - 60), []);

  const incomeSegs: Segment[] = [
    { label: 'Контракты (обучение)', value: 820, color: 'var(--accent)' },
    { label: 'Бюджетное финансирование', value: 340, color: 'var(--ai)' },
    { label: 'Доп. услуги', value: 80, color: 'var(--success)' },
  ];
  const arAging: Segment[] = [
    { label: '0–30 дней', value: 96000, color: 'var(--success)' },
    { label: '31–60 дней', value: 88000, color: 'var(--warn)' },
    { label: '60+ дней', value: 64000, color: 'var(--danger)' },
  ];
  const apAging = [
    { label: 'ООО «Техносервис»', value: 148000, color: 'var(--warn)' },
    { label: 'Энергосбыт', value: 52300, color: 'var(--accent)' },
    { label: 'Налоги (2 кв.)', value: 214000, color: 'var(--danger)' },
  ];

  const insights = [
    { id: 'anom', tone: 'var(--danger)', conf: 0.94, icon: AlertTriangle, title: '3 аномальных платежа на ₽ 184 700', why: 'Нетипичная сумма от одного контрагента за 40 минут · ×6.2 к медиане', cta: 'На сверку', done: 'Отмечено на сверку' },
    { id: 'debt', tone: 'var(--warn)', conf: 0.88, icon: HandCoins, title: 'Дебиторка 60+ выросла до ₽ 64 000', why: 'Своевременное напоминание сегодня повышает возврат на ≈34%', cta: 'Письма должникам', done: 'Письма подготовлены' },
    { id: 'fx', tone: 'var(--ai)', conf: 0.79, icon: TrendingUp, title: 'ФОТ можно оптимизировать на ₽ 42 000', why: 'Премиальный фонд превышает план по 2 позициям — предложить пересмотр', cta: 'Показать расчёт', done: 'Открыт расчёт ФОТ' },
  ];

  const agentic = [
    { t: 'Разнёс 34 поступления по договорам', m: 'автосопоставление банк ⇄ начисления · точность 98%', status: 'сделано' as const },
    { t: 'Сформировал книгу покупок за июнь', m: '12 счетов-фактур, НДС ₽ 168 400 · готово к выгрузке', status: 'сделано' as const },
    { t: 'Подготовил платёжки поставщикам', m: '3 поручения на ₽ 254 300 · ждёт вашей подписи', status: 'confirm' as const, act: 'Подписать', doneMsg: 'Платёжные поручения подписаны' },
    { t: 'Собрал декларацию УСН (черновик)', m: '2 квартал · сверено с ОСВ, расхождений нет', status: 'confirm' as const, act: 'Проверить', doneMsg: 'Открыт черновик декларации' },
  ];

  return (
    <div className="fade content-narrow">
      <PageHead title="Финансовый центр" sub="Живая картина денег, рисков и следующего шага — одним взглядом"
        actions={<>
          <div className="seg">
            <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Месяц</button>
            <button className={period === 'quarter' ? 'on' : ''} onClick={() => setPeriod('quarter')}>Квартал</button>
            <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Год</button>
          </div>
          <button className="btn btn-outline" onClick={() => toast('AI собрал пакет отчётов для финдиректора')}><Download size={15} />AI-пакет отчётов</button>
        </>} />

      <FinCopilot />

      <div className="fin-kpis" style={{ marginTop: 16 }}>
        <div className="fin-kpi hero">
          <div className="fin-kpi-l"><Wallet size={13} /> Свободно после обязательств</div>
          <div className="fin-kpi-v">{rub(M.freeCash)}</div>
          <div className="fin-kpi-spark"><Line data={flow} height={40} color="var(--success)" /></div>
          <div className="fin-kpi-foot ok"><TrendingUp size={13} /> прогноз на конец периода {rub(M.cashEnd)}</div>
        </div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowDownLeft size={13} /> Поступления</div><div className="fin-kpi-v" style={{ color: 'var(--success)' }}>{krub(income)}</div><div className="fin-kpi-foot ok">+8% к плану</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><ArrowUpRight size={13} /> Обязательства недели</div><div className="fin-kpi-v">{krub(M.dueThisWeek)}</div><div className="fin-kpi-foot">ФОТ, налоги, поставщики</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><Receipt size={13} /> Несверено</div><div className="fin-kpi-v" style={{ color: 'var(--danger)' }}>3</div><div className="fin-kpi-foot bad">₽ 184 700 требуют решения</div></div>
        <div className="fin-kpi"><div className="fin-kpi-l"><CheckCircle2 size={13} /> Закрытие июня</div><div className="fin-kpi-v">8/11</div><div className="fin-kpi-foot">3 контрольные точки</div></div>
      </div>

      {/* AI-инсайты с уверенностью */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Инсайты NEX</div>
          <span className="dim" style={{ fontSize: 12 }}>ранжировано по риску и деньгам</span>
        </div>
        <div className="row-list">
          {insights.filter((x) => !done.includes(x.id)).map((x) => { const Icon = x.icon; return (
            <div className="feed-row" key={x.id} style={{ padding: '13px 16px' }}>
              <div className="feed-ico" style={{ background: 'var(--surface-2)', color: x.tone }}><Icon size={15} /></div>
              <div className="feed-main">
                <div className="t" style={{ fontWeight: 600 }}>{x.title}</div>
                <div className="m">{x.why}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span className="fin-conf" title="Уверенность модели"><i style={{ width: `${x.conf * 100}%` }} />{Math.round(x.conf * 100)}%</span>
                <button className="btn btn-sm btn-outline" onClick={() => { setDone((d) => [...d, x.id]); toast(x.done); }}>{x.cta}</button>
              </div>
            </div>
          ); })}
          {done.length === insights.length && <div className="card-body muted">Инсайты разобраны — NEX продолжает следить за потоком операций.</div>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Ликвидность · 14 дней</div>
            <div className="seg" style={{ transform: 'scale(.92)' }}>
              <button className={scenario === 'base' ? 'on' : ''} onClick={() => setScenario('base')}>База</button>
              <button className={scenario === 'cautious' ? 'on' : ''} onClick={() => setScenario('cautious')}>Осторожно</button>
            </div>
          </div>
          <div className="card-body">
            <DualLine a={flow} b={flowB} colorA={scenario === 'cautious' ? 'var(--warn)' : 'var(--success)'} height={150} />
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <div><div className="kpi-label">На счетах сейчас</div><div className="kpi-value" style={{ fontSize: 20 }}>{rub(M.openingCash)}</div></div>
              <div><div className="kpi-label">Минимум запаса</div><div className="kpi-value" style={{ fontSize: 20, color: 'var(--success)' }}>{rub(Math.min(...flow) * 1000)}</div></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Структура доходов</div><NexAsk q="Разбей выручку по источникам и оцени устойчивость каждого" label="Разобрать" /></div>
          <div className="card-body chart-flex"><Donut segments={incomeSegs} centerTop={krub(income)} centerSub="поступления" /><Legend segments={incomeSegs} withValues /></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><div className="card-title"><ArrowDownLeft size={14} /> Дебиторка по срокам</div><NexAsk q="Кого уведомить сегодня и на какую сумму закроется долг" label="Взыскание" /></div>
          <div className="card-body"><HBars data={arAging.map((a) => ({ label: a.label, value: a.value, color: a.color }))} format={rub} />
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>Цель дня: вернуть в работу все 4 долга 60+ и зафиксировать результат.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title"><ArrowUpRight size={14} /> Кредиторка к оплате</div><NexAsk q="Какие обязательства оплатить первыми, чтобы избежать пеней" label="Приоритет" /></div>
          <div className="card-body"><HBars data={apAging} format={rub} />
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>Ближайший срок — налоги 2 кв. Пеня при просрочке ≈ ₽ 640/день.</div>
          </div>
        </div>
      </div>

      {/* Агентный слой */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> NEX действует сам</div><span className="dim" style={{ fontSize: 12 }}>автономно · под вашим контролем</span></div>
        <div className="row-list">
          {agentic.map((a, i) => (
            <div className="feed-row" key={i}>
              <div className="feed-ico ai"><Sparkles size={14} /></div>
              <div className="feed-main"><div className="t">{a.t}</div><div className="m">{a.m}</div></div>
              {a.status === 'confirm'
                ? <button className="btn btn-sm btn-primary" onClick={() => toast(a.doneMsg!)}>{a.act}</button>
                : <Chip tone="chip-success">сделано</Chip>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Банковская сверка — интерактивный матчинг банк ⇄ учёт
   ============================================================ */
interface BankLine { id: string; date: string; counterparty: string; sum: number; dir: 'in' | 'out'; }
interface BookLine { id: string; doc: string; article: string; sum: number; dir: 'in' | 'out'; }

const BANK_SEED: BankLine[] = [
  { id: 'bk1', date: '05.07', counterparty: 'Зайцева Т.О.', sum: 62000, dir: 'in' },
  { id: 'bk2', date: '03.07', counterparty: 'ООО «Техносервис»', sum: 148000, dir: 'out' },
  { id: 'bk3', date: '05.07', counterparty: 'Сидоров Д.Н.', sum: 62000, dir: 'in' },
  { id: 'bk4', date: '04.07', counterparty: 'Энергосбыт', sum: 52300, dir: 'out' },
  { id: 'bk5', date: '06.07', counterparty: 'Неизвестный контрагент', sum: 40200, dir: 'in' },
];
const BOOK_SEED: BookLine[] = [
  { id: 'bo1', doc: 'ПКО-118', article: 'Оплата обучения', sum: 62000, dir: 'in' },
  { id: 'bo2', doc: 'ПП-331', article: 'Оборудование', sum: 148000, dir: 'out' },
  { id: 'bo3', doc: 'ПКО-119', article: 'Оплата обучения', sum: 62000, dir: 'in' },
  { id: 'bo4', doc: 'ПП-332', article: 'Электроэнергия', sum: 52300, dir: 'out' },
];
/* Предложения ИИ: банк.id → книга.id + уверенность */
const AI_MATCH: Record<string, { book: string; conf: number }> = {
  bk1: { book: 'bo1', conf: 0.99 }, bk2: { book: 'bo2', conf: 0.99 },
  bk3: { book: 'bo3', conf: 0.97 }, bk4: { book: 'bo4', conf: 0.95 },
};

export function FinReconcile() {
  const { toast } = useApp();
  const [matched, setMatched] = useState<Record<string, string>>({});
  const bank = BANK_SEED;
  const book = BOOK_SEED;
  const usedBooks = new Set(Object.values(matched));
  const unmatchedBank = bank.filter((b) => !matched[b.id]);
  const unmatchedSum = unmatchedBank.reduce((a, b) => a + b.sum, 0);
  const progress = Math.round((Object.keys(matched).length / bank.length) * 100);

  const applyAll = () => {
    const next: Record<string, string> = {};
    Object.entries(AI_MATCH).forEach(([bk, m]) => { next[bk] = m.book; });
    setMatched(next);
    toast(`ИИ сопоставил ${Object.keys(next).length} операций · осталось разобрать вручную ${bank.length - Object.keys(next).length}`);
  };
  const match = (bk: string, bo: string) => { setMatched((m) => ({ ...m, [bk]: bo })); toast('Операция сопоставлена и готова к проведению'); };
  const unmatch = (bk: string) => setMatched((m) => { const n = { ...m }; delete n[bk]; return n; });

  return (
    <div className="fade content-narrow">
      <PageHead title="Сверка с банком" sub="Сопоставление выписки с учётом — ИИ предлагает, вы подтверждаете"
        actions={<button className="btn btn-primary" onClick={applyAll}><Wand2 size={15} />Сопоставить всё (ИИ)</button>} />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="fin-stat"><Gauge value={progress} size={92} thickness={9} color={progress === 100 ? 'var(--success)' : 'var(--accent)'} sub="сверено" />
          <div><div className="kpi-label">Прогресс сверки</div><div className="kpi-value" style={{ fontSize: 22 }}>{Object.keys(matched).length}/{bank.length}</div><div className="muted" style={{ fontSize: 12 }}>операций разнесено</div></div>
        </div>
        <div className="kpi"><div className="kpi-label"><Unlink size={13} /> Не сопоставлено</div><div className="kpi-value" style={{ color: unmatchedBank.length ? 'var(--danger)' : 'var(--success)' }}>{unmatchedBank.length}</div><div className="muted" style={{ fontSize: 12 }}>{rub(unmatchedSum)}</div></div>
        <div className="kpi"><div className="kpi-label"><Sparkles size={13} style={{ color: 'var(--ai)' }} /> Уверенных совпадений</div><div className="kpi-value">{Object.keys(AI_MATCH).length}</div><div className="muted" style={{ fontSize: 12 }}>≥ 95% по сумме и контрагенту</div></div>
      </div>

      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">4 из 5 операций уверенно сопоставляются с учётом. Одна — <b>поступление ₽ 40 200 от неизвестного контрагента</b> — не находит основание: возможно, оплата без указания договора. Рекомендую уточнить назначение платежа перед проведением.</div>
        <div className="ai-actions"><NexAsk q="Что делать с непознанным поступлением ₽ 40 200 без основания" label="Разобрать" subtle={false} /></div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><Building2 size={15} /> Выписка ⇄ Учёт</div><Chip tone={progress === 100 ? 'chip-success' : 'chip-warn'}>{progress === 100 ? 'сверено' : 'в работе'}</Chip></div>
        <div className="row-list">
          {bank.map((b) => {
            const bo = matched[b.id] ? book.find((x) => x.id === matched[b.id]) : null;
            const sug = AI_MATCH[b.id];
            const sugBook = sug ? book.find((x) => x.id === sug.book) : null;
            return (
              <div className="fin-recon-row" key={b.id}>
                <div className="fin-recon-bank">
                  <span className={`fin-dir ${b.dir}`}>{b.dir === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                  <div><div className="t">{b.counterparty}</div><div className="m">{b.date} · выписка банка</div></div>
                  <div className="mono fin-recon-sum">{rub(b.sum)}</div>
                </div>
                <div className="fin-recon-mid">
                  {bo ? <span className="fin-link ok"><Link2 size={14} /></span> : sugBook ? <span className="fin-link sug"><Sparkles size={13} /></span> : <span className="fin-link none"><AlertTriangle size={13} /></span>}
                </div>
                <div className="fin-recon-book">
                  {bo ? (
                    <>
                      <div><div className="t">{bo.doc} · {bo.article}</div><div className="m">проведено</div></div>
                      <button className="icon-btn sm" title="Отменить" onClick={() => unmatch(b.id)}><Unlink size={14} /></button>
                    </>
                  ) : sugBook ? (
                    <>
                      <div><div className="t">{sugBook.doc} · {sugBook.article}</div><div className="m">предложено ИИ · {Math.round(sug!.conf * 100)}%</div></div>
                      <button className="btn btn-sm btn-primary" onClick={() => match(b.id, sugBook.id)}>Принять</button>
                    </>
                  ) : (
                    <>
                      <div><div className="t" style={{ color: 'var(--danger)' }}>Нет основания</div><div className="m">требует ручного разбора</div></div>
                      <button className="btn btn-sm btn-outline" onClick={() => toast('Открыт подбор основания')}>Подобрать</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {usedBooks.size > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: 'right' }}>Разнесено оснований: {usedBooks.size} из {book.length}</div>}
    </div>
  );
}

/* ============================================================
   Закрытие периода — чек-лист контрольных процедур
   ============================================================ */
interface CloseTask extends Entity, Record<string, unknown> { group: string; title: string; note: string; done: boolean; owner: string; }
const CLOSE_SEED: CloseTask[] = [
  { id: 'cl1', group: 'Банк и касса', title: 'Сверить банковскую выписку', note: '3 операции без сопоставления', done: false, owner: 'NEX + бухгалтер' },
  { id: 'cl2', group: 'Банк и касса', title: 'Закрыть кассовую книгу', note: 'ПКО/РКО за июнь', done: true, owner: 'Бухгалтер' },
  { id: 'cl3', group: 'Расчёты', title: 'Провести 2 акта поставщиков', note: 'Клин-Сервис, Техносервис', done: false, owner: 'Бухгалтер' },
  { id: 'cl4', group: 'Расчёты', title: 'Сверить дебиторку и кредиторку', note: 'ОСВ по счетам 60/62', done: true, owner: 'NEX' },
  { id: 'cl5', group: 'Налоги и ФОТ', title: 'Начислить зарплату и взносы', note: `ФОТ ${rub(M.payrollFund)}`, done: true, owner: 'Бухгалтер' },
  { id: 'cl6', group: 'Налоги и ФОТ', title: 'Проверить НДС / книгу покупок', note: 'НДС ₽ 168 400', done: true, owner: 'NEX' },
  { id: 'cl7', group: 'Налоги и ФОТ', title: 'Сформировать декларацию УСН', note: '2 квартал · черновик готов', done: false, owner: 'NEX' },
  { id: 'cl8', group: 'Отчётность', title: 'Собрать оборотно-сальдовую ведомость', note: 'после проведения актов', done: true, owner: 'Бухгалтер' },
  { id: 'cl9', group: 'Отчётность', title: 'Приложить первичку по хознуждам', note: '2 документа отсутствуют', done: false, owner: 'Бухгалтер' },
  { id: 'cl10', group: 'Отчётность', title: 'Сверить стипендиальный фонд', note: 'ведомость июня', done: true, owner: 'Бухгалтер' },
  { id: 'cl11', group: 'Отчётность', title: 'Зафиксировать закрытие периода', note: 'блокировка проводок июня', done: false, owner: 'Гл. бухгалтер' },
];

export function FinClose() {
  const { toast } = useApp();
  const col = useCollection<CloseTask>('fin-close-june', CLOSE_SEED);
  const total = col.items.length;
  const doneN = col.items.filter((t) => t.done).length;
  const progress = Math.round((doneN / total) * 100);
  const groups = [...new Set(col.items.map((t) => t.group))];
  const blockers = col.items.filter((t) => !t.done);

  const toggle = (t: CloseTask) => { col.update(t.id, { done: !t.done }); };
  const closeAll = () => { blockers.forEach((t) => col.update(t.id, { done: true })); toast('Все процедуры отмечены выполненными — период готов к закрытию'); };

  return (
    <div className="fade content-narrow">
      <PageHead title="Закрытие периода" sub="Июнь 2026 · контрольные процедуры перед фиксацией"
        actions={<>
          <button className="btn btn-outline" onClick={() => col.reset()}><RefreshCw size={15} />Сброс</button>
          <button className="btn btn-primary" disabled={progress === 100} onClick={closeAll}><Lock size={15} />{progress === 100 ? 'Период закрыт' : 'Закрыть период'}</button>
        </>} />

      <div className="fin-close-hero card">
        <Gauge value={progress} size={150} thickness={14} color={progress === 100 ? 'var(--success)' : 'var(--accent)'} sub={`${doneN} из ${total}`} />
        <div className="fin-close-hero-body">
          <div className="ai-head"><Sparkles size={14} /> NEX · оценка готовности</div>
          <div style={{ fontSize: 14.5, marginTop: 6, lineHeight: 1.55 }}>
            {progress === 100
              ? <>Все контрольные процедуры выполнены. Период можно фиксировать — проводки июня будут заблокированы от изменений.</>
              : <>Осталось <b>{blockers.length}</b> {blockers.length === 1 ? 'процедура' : 'процедуры'}. Основной блокер — <b>сверка банка</b> и <b>проведение актов</b>. Оценка времени до закрытия: <b>~40 минут</b>.</>}
          </div>
          {blockers.length > 0 && (
            <div className="fin-close-blockers">
              {blockers.slice(0, 3).map((b) => (
                <button key={b.id} className="chip-btn sm" onClick={() => toggle(b)}><CheckCircle2 size={12} className="ic" />{b.title}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {groups.map((g) => {
          const items = col.items.filter((t) => t.group === g);
          const gd = items.filter((t) => t.done).length;
          return (
            <div className="card" key={g}>
              <div className="card-head">
                <div className="card-title">{g}</div>
                <Chip tone={gd === items.length ? 'chip-success' : 'chip-warn'}>{gd}/{items.length}</Chip>
              </div>
              <div className="row-list">
                {items.map((t) => (
                  <label className={`fin-check-row ${t.done ? 'on' : ''}`} key={t.id}>
                    <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
                    <span className="fin-check-box">{t.done && <CheckCircle2 size={14} />}</span>
                    <div className="feed-main">
                      <div className="t" style={{ textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1 }}>{t.title}</div>
                      <div className="m">{t.note} · {t.owner}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Экономика — сценарное моделирование для экономиста
   ============================================================ */
interface Scen { contract: number; tuition: number; collection: number; payrollIx: number; }
const BASE_SCEN: Scen = { contract: 134, tuition: 124000, collection: 94, payrollIx: 100 };

function project(s: Scen) {
  const subsidy = 340_000 * 12;
  const otherOpex = (M.expense - M.payrollFund) * 12;
  const revenue = s.contract * s.tuition * (s.collection / 100) + subsidy;
  const payrollY = M.payrollFund * 12 * (s.payrollIx / 100);
  const costs = payrollY + otherOpex;
  const net = revenue - costs;
  const margin = (net / revenue) * 100;
  const perStudentCost = costs / (s.contract + 186); // + бюджетники
  const payrollShare = (payrollY / costs) * 100;
  return { revenue, costs, net, margin, perStudentCost, payrollShare, payrollY, otherOpex, subsidy };
}

export function FinStudio() {
  const { toast } = useApp();
  const [s, setS] = useState<Scen>(BASE_SCEN);
  const p = project(s);
  const base = project(BASE_SCEN);
  const dNet = p.net - base.net;

  const bridge = [
    { label: 'Контракты', delta: s.contract * s.tuition * (s.collection / 100), kind: 'start' as const },
    { label: 'Субсидия', delta: p.subsidy },
    { label: '− ФОТ', delta: -p.payrollY },
    { label: '− Прочее', delta: -p.otherOpex },
    { label: 'Прибыль', delta: p.net, kind: 'end' as const },
  ];

  const Slider = ({ label, value, min, max, step, fmt, on }: { label: string; value: number; min: number; max: number; step: number; fmt: (n: number) => string; on: (v: number) => void }) => (
    <div className="fin-slider">
      <div className="fin-slider-top"><span>{label}</span><b className="mono">{fmt(value)}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(+e.target.value)} />
    </div>
  );

  return (
    <div className="fade content-narrow">
      <PageHead title="Экономика и сценарии" sub="Модель «что если»: набор, стоимость, собираемость, ФОТ → прогноз P&L"
        actions={<>
          <button className="btn btn-outline" onClick={() => setS(BASE_SCEN)}><RefreshCw size={15} />Сбросить</button>
          <button className="btn btn-primary" onClick={() => toast('Сценарий сохранён и отправлен финдиректору')}><Download size={15} />Сохранить сценарий</button>
        </>} />

      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX · чувствительность</div>
        <div className="ai-body">
          Прибыль наиболее чувствительна к <b>собираемости</b> и <b>среднему контракту</b>: +1 п.п. собираемости ≈ <b>{krub(s.contract * s.tuition * 0.01)}</b> в год. Текущий сценарий даёт годовую прибыль <b style={{ color: p.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{mrub(p.net)}</b> ({pct(dNet / base.net * 100)} к базе).
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><div className="card-title"><GaugeIcon size={15} /> Параметры сценария</div><span className="dim" style={{ fontSize: 12 }}>тяните ползунки</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Slider label="Контрактных студентов" value={s.contract} min={90} max={220} step={1} fmt={(n) => String(n)} on={(v) => setS({ ...s, contract: v })} />
            <Slider label="Средний контракт, ₽/год" value={s.tuition} min={90000} max={190000} step={1000} fmt={rub} on={(v) => setS({ ...s, tuition: v })} />
            <Slider label="Собираемость" value={s.collection} min={70} max={100} step={1} fmt={(n) => n + '%'} on={(v) => setS({ ...s, collection: v })} />
            <Slider label="Индекс ФОТ" value={s.payrollIx} min={90} max={140} step={1} fmt={(n) => n + '%'} on={(v) => setS({ ...s, payrollIx: v })} />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><Scale size={15} /> Прогноз P&L · год</div><Chip tone={p.net >= 0 ? 'chip-success' : 'chip-danger'}>{p.net >= 0 ? 'профицит' : 'дефицит'}</Chip></div>
          <div className="card-body">
            <div className="fin-pl">
              <div className="fin-pl-row"><span>Выручка</span><b className="mono" style={{ color: 'var(--success)' }}>{rub(p.revenue)}</b></div>
              <div className="fin-pl-row sub"><span>ФОТ + взносы</span><b className="mono">−{rub(p.payrollY)}</b></div>
              <div className="fin-pl-row sub"><span>Прочие расходы</span><b className="mono">−{rub(p.otherOpex)}</b></div>
              <div className="fin-pl-row total"><span>Прибыль</span><b className="mono" style={{ color: p.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{rub(p.net)}</b></div>
            </div>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 14 }}>
              <Gauge value={Math.max(0, p.margin)} size={104} thickness={11} color={p.margin >= 0 ? 'var(--success)' : 'var(--danger)'} label={p.margin.toFixed(1) + '%'} sub="маржа" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><div className="kpi-label"><Percent size={12} /> Доля ФОТ в расходах</div><div className="kpi-value" style={{ fontSize: 20 }}>{p.payrollShare.toFixed(0)}%</div></div>
                <div><div className="kpi-label"><Flame size={12} /> Расход на студента</div><div className="kpi-value" style={{ fontSize: 20 }}>{rub(p.perStudentCost)}</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><div className="card-title"><PiggyBank size={15} /> Мост прибыли</div><span className="dim" style={{ fontSize: 12 }}>как складывается результат</span></div>
          <div className="card-body"><Waterfall steps={bridge} format={(n) => krub(Math.abs(n))} /></div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title"><Scale size={15} /> Исполнение бюджета</div><NexAsk q="Объясни отклонения бюджета по статьям и предложи корректировку" label="Разобрать" /></div>
          <div className="card-body">
            {budgetLines.map((b) => {
              const over = b.fact > b.plan;
              return (
                <div key={b.name} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span>{b.name}</span><span className="mono">{rub(b.fact)} <span className="muted">/ {rub(b.plan)}</span></span>
                  </div>
                  <div className="meter" style={{ height: 9 }}><i style={{ width: `${Math.min((b.fact / b.plan) * 100, 100)}%`, background: over ? 'var(--danger)' : 'var(--accent)' }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="fin-ratios">
        {[
          { icon: ShieldCheck, label: 'Коэф. текущей ликвидности', v: '2.4', hint: 'норма > 1.5', ok: true },
          { icon: HandCoins, label: 'Дни погашения дебиторки', v: '38', hint: 'цель < 45', ok: true },
          { icon: Landmark, label: 'Автономия (собств. средства)', v: '0.61', hint: 'норма > 0.5', ok: true },
          { icon: Info, label: 'Точка безубыточности', v: krub(base.costs / 12), hint: 'выручка/мес', ok: true },
        ].map((r) => { const Icon = r.icon; return (
          <div className="fin-ratio" key={r.label}>
            <span className="fin-ratio-ic"><Icon size={16} /></span>
            <div><div className="kpi-label">{r.label}</div><div className="kpi-value" style={{ fontSize: 21 }}>{r.v}</div><div className="muted" style={{ fontSize: 11.5 }}>{r.hint}</div></div>
          </div>
        ); })}
      </div>
    </div>
  );
}
