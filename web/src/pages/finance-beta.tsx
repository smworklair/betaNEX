import type { ReactNode } from 'react';
import {
  FileText, ReceiptText, FileCheck2, FileSignature, Wallet, Building2, BookOpenCheck,
  Sparkles, ArrowDownLeft, ArrowUpRight, HandCoins, CreditCard,
} from 'lucide-react';
import { PageHead, NexAsk, Beta } from '../ui';
import { useCollection, type Entity } from '../beta/store';
import { EntityManager, rub, type Col, type FieldDef } from '../beta/manager';

/* ================= Типы документов ================= */
interface Invoice extends Entity, Record<string, unknown> { number: string; counterparty: string; sum: number; date: string; status: string; }
interface Vat extends Entity, Record<string, unknown> { number: string; counterparty: string; sum: number; vat: number; date: string; status: string; }
interface Act extends Entity, Record<string, unknown> { number: string; counterparty: string; subject: string; sum: number; date: string; status: string; }
interface Contract extends Entity, Record<string, unknown> { number: string; counterparty: string; subject: string; sum: number; start: string; status: string; }
interface Cash extends Entity, Record<string, unknown> { doc: string; type: string; article: string; sum: number; date: string; }
interface Bank extends Entity, Record<string, unknown> { doc: string; direction: string; counterparty: string; sum: number; date: string; status: string; }
interface Op extends Entity, Record<string, unknown> { date: string; debit: string; credit: string; sum: number; note: string; }
interface Debt extends Entity, Record<string, unknown> { counterparty: string; kind: string; sum: number; due: string; status: string; }

/* ================= Сиды ================= */
const SEED_INV: Invoice[] = [
  { id: 'i1', number: '№ 214', counterparty: 'ООО «Техносервис»', sum: 148000, date: '2026-07-02', status: 'Оплачено' },
  { id: 'i2', number: '№ 215', counterparty: 'Зайцева Т.О. (контракт)', sum: 62000, date: '2026-07-05', status: 'Ждёт оплату' },
  { id: 'i3', number: '№ 216', counterparty: 'ИП Смирнов', sum: 24500, date: '2026-07-06', status: 'Просрочено' },
];
const SEED_VAT: Vat[] = [{ id: 'v1', number: 'СФ-88', counterparty: 'ООО «Техносервис»', sum: 148000, vat: 24667, date: '2026-07-02', status: 'Проведено' }];
const SEED_ACT: Act[] = [
  { id: 'a1', number: 'Акт-51', counterparty: 'ООО «Клин-Сервис»', subject: 'Уборка помещений, июнь', sum: 38000, date: '2026-06-30', status: 'Подписан' },
  { id: 'a2', number: 'Акт-52', counterparty: 'ООО «Техносервис»', subject: 'Настройка сети', sum: 148000, date: '2026-07-02', status: 'Ждёт подпись' },
];
const SEED_CONTR: Contract[] = [
  { id: 'c1', number: 'Д-2026/14', counterparty: 'Зайцева Т.О.', subject: 'Обучение (контракт)', sum: 124000, start: '2025-09-01', status: 'Исполняется' },
  { id: 'c2', number: 'Д-2026/09', counterparty: 'ООО «Клин-Сервис»', subject: 'Клининг на год', sum: 456000, start: '2026-01-01', status: 'Исполняется' },
];
const SEED_CASH: Cash[] = [
  { id: 'k1', doc: 'ПКО-118', type: 'Приход', article: 'Оплата обучения', sum: 62000, date: '2026-07-05' },
  { id: 'k2', doc: 'РКО-77', type: 'Расход', article: 'Хознужды', sum: 4200, date: '2026-07-04' },
];
const SEED_BANK: Bank[] = [
  { id: 'b1', doc: 'ПП-330', direction: 'Поступление', counterparty: 'Зайцева Т.О.', sum: 62000, date: '2026-07-05', status: 'Проведено' },
  { id: 'b2', doc: 'ПП-331', direction: 'Списание', counterparty: 'ООО «Техносервис»', sum: 148000, date: '2026-07-03', status: 'Проведено' },
];
const SEED_OPS: Op[] = [
  { id: 'o1', date: '2026-07-05', debit: '51 Расчётный счёт', credit: '62 Расчёты с покупателями', sum: 62000, note: 'Оплата контракта' },
  { id: 'o2', date: '2026-07-03', debit: '60 Поставщики', credit: '51 Расчётный счёт', sum: 148000, note: 'Оплата услуг' },
];
const SEED_RECV: Debt[] = [
  { id: 'dr1', counterparty: 'Лебедев С.А.', kind: 'Обучение · 2 семестр', sum: 62000, due: '2026-06-30', status: 'Просрочено' },
  { id: 'dr2', counterparty: 'Смирнов П.Р.', kind: 'Обучение · 2 семестр', sum: 62000, due: '2026-06-30', status: 'Ждёт оплату' },
];
const SEED_PAY: Debt[] = [
  { id: 'dp1', counterparty: 'ООО «Техносервис»', kind: 'Оборудование', sum: 148000, due: '2026-07-10', status: 'Ждёт оплату' },
  { id: 'dp2', counterparty: 'Энергосбыт', kind: 'Электроэнергия, июнь', sum: 52300, due: '2026-07-15', status: 'Ждёт оплату' },
];

/* ---------- обёртка экрана ---------- */
function Screen({ title, sub, icon, children, ask }: { title: string; sub: string; icon: ReactNode; children: ReactNode; ask?: string }) {
  return (
    <div className="fade content-narrow">
      <PageHead title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{icon}{title}</span>} sub={sub} actions={<Beta />} />
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">Бета на локальных данных: создание, редактирование, удаление, поиск, экспорт CSV и импорт JSON. Проводки в учёте, обмен с банком и ФНС — на стороне бэкенда (см. backend.md).</div>
        <div className="ai-actions"><NexAsk q={ask || `Проанализируй раздел «${title}»`} label="Разобрать" subtle={false} /></div>
      </div>
      {children}
    </div>
  );
}

const cols = <T,>(...c: Col<T>[]) => c;
const flds = <T,>(...f: FieldDef<T>[]) => f;

export function FinInvoices() {
  const col = useCollection<Invoice>('fin-invoices', SEED_INV);
  return <Screen title="Счета" sub="Счета на оплату — выставленные и полученные" icon={<FileText size={18} />}>
    <EntityManager title="Счета" col={col} empty="Счетов пока нет"
      columns={cols<Invoice>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Invoice>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Ждёт оплату', 'Оплачено', 'Просрочено', 'Частично'] })} />
  </Screen>;
}

export function FinVat() {
  const col = useCollection<Vat>('fin-vat', SEED_VAT);
  return <Screen title="Счета-фактуры" sub="НДС · книга покупок и продаж" icon={<ReceiptText size={18} />}>
    <EntityManager title="Счета-фактуры" col={col} empty="Счетов-фактур пока нет"
      columns={cols<Vat>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'vat', label: 'НДС', kind: 'money' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Vat>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'vat', label: 'НДС', type: 'number' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Черновик', 'Проведено'] })} />
  </Screen>;
}

export function FinActs() {
  const col = useCollection<Act>('fin-acts', SEED_ACT);
  return <Screen title="Акты" sub="Акты выполненных работ и услуг" icon={<FileCheck2 size={18} />}>
    <EntityManager title="Акты" col={col} empty="Актов пока нет"
      columns={cols<Act>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'subject', label: 'Предмет' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Act>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'subject', label: 'Предмет' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Ждёт подпись', 'Подписан'] })} />
  </Screen>;
}

export function FinContracts() {
  const col = useCollection<Contract>('fin-contracts', SEED_CONTR);
  return <Screen title="Договоры" sub="Реестр договоров с контрагентами и студентами" icon={<FileSignature size={18} />}>
    <EntityManager title="Договоры" col={col} empty="Договоров пока нет"
      columns={cols<Contract>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'subject', label: 'Предмет' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'start', label: 'Начало' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Contract>({ key: 'number', label: 'Номер' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'subject', label: 'Предмет' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'start', label: 'Дата начала', type: 'date' }, { key: 'status', label: 'Статус', options: ['Черновик', 'Исполняется', 'Закрыт'] })} />
  </Screen>;
}

export function FinReceivables() {
  const col = useCollection<Debt>('fin-receivables', SEED_RECV);
  const total = col.items.filter((d) => d.status !== 'Оплачено').reduce((a, d) => a + d.sum, 0);
  return <Screen title="Дебиторская задолженность" sub={`Нам должны · ${rub(total)}`} icon={<HandCoins size={18} />} ask="Кто должен и кого уведомить первым">
    <EntityManager title="Дебиторка" col={col} empty="Дебиторки нет"
      columns={cols<Debt>({ key: 'counterparty', label: 'Должник' }, { key: 'kind', label: 'Основание' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'due', label: 'Срок' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Debt>({ key: 'counterparty', label: 'Должник' }, { key: 'kind', label: 'Основание' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'due', label: 'Срок', type: 'date' }, { key: 'status', label: 'Статус', options: ['Ждёт оплату', 'Просрочено', 'Частично', 'Оплачено'] })} />
  </Screen>;
}

export function FinPayables() {
  const col = useCollection<Debt>('fin-payables', SEED_PAY);
  const total = col.items.filter((d) => d.status !== 'Оплачено').reduce((a, d) => a + d.sum, 0);
  return <Screen title="Кредиторская задолженность" sub={`Мы должны · ${rub(total)}`} icon={<CreditCard size={18} />} ask="Какие обязательства оплатить в первую очередь">
    <EntityManager title="Кредиторка" col={col} empty="Кредиторки нет"
      columns={cols<Debt>({ key: 'counterparty', label: 'Кредитор' }, { key: 'kind', label: 'Основание' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'due', label: 'Срок' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Debt>({ key: 'counterparty', label: 'Кредитор' }, { key: 'kind', label: 'Основание' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'due', label: 'Срок', type: 'date' }, { key: 'status', label: 'Статус', options: ['Ждёт оплату', 'Просрочено', 'Частично', 'Оплачено'] })} />
  </Screen>;
}

export function FinCashbook() {
  const col = useCollection<Cash>('fin-cash', SEED_CASH);
  const income = col.items.filter((c) => c.type === 'Приход').reduce((a, c) => a + c.sum, 0);
  const out = col.items.filter((c) => c.type === 'Расход').reduce((a, c) => a + c.sum, 0);
  return <Screen title="Касса" sub="Кассовая книга · ПКО и РКО" icon={<Wallet size={18} />}>
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="kpi"><div className="kpi-label"><ArrowDownLeft size={13} /> Приход</div><div className="kpi-value" style={{ color: 'var(--success)' }}>{rub(income)}</div></div>
      <div className="kpi"><div className="kpi-label"><ArrowUpRight size={13} /> Расход</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>{rub(out)}</div></div>
      <div className="kpi"><div className="kpi-label">Остаток</div><div className="kpi-value">{rub(income - out)}</div></div>
    </div>
    <EntityManager title="Касса" col={col} empty="Кассовых операций пока нет"
      columns={cols<Cash>({ key: 'doc', label: 'Документ' }, { key: 'type', label: 'Тип' }, { key: 'article', label: 'Статья' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'date', label: 'Дата' })}
      fields={flds<Cash>({ key: 'doc', label: 'Документ' }, { key: 'type', label: 'Тип', options: ['Приход', 'Расход'] }, { key: 'article', label: 'Статья' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'date', label: 'Дата', type: 'date' })} />
  </Screen>;
}

export function FinBank() {
  const col = useCollection<Bank>('fin-bank', SEED_BANK);
  return <Screen title="Банк" sub="Банковские операции и платёжные поручения" icon={<Building2 size={18} />}>
    <EntityManager title="Банк" col={col} empty="Банковских операций пока нет"
      columns={cols<Bank>({ key: 'doc', label: 'Документ' }, { key: 'direction', label: 'Направление' }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Bank>({ key: 'doc', label: 'Документ' }, { key: 'direction', label: 'Направление', options: ['Поступление', 'Списание'] }, { key: 'counterparty', label: 'Контрагент' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Черновик', 'Проведено'] })} />
  </Screen>;
}

export function FinJournal() {
  const col = useCollection<Op>('fin-ops', SEED_OPS);
  return <Screen title="Журнал операций" sub="Проводки — двойная запись" icon={<BookOpenCheck size={18} />}>
    <EntityManager title="Журнал операций" col={col} empty="Проводок пока нет"
      columns={cols<Op>({ key: 'date', label: 'Дата' }, { key: 'debit', label: 'Дебет' }, { key: 'credit', label: 'Кредит' }, { key: 'sum', label: 'Сумма', kind: 'money' }, { key: 'note', label: 'Назначение' })}
      fields={flds<Op>({ key: 'date', label: 'Дата', type: 'date' }, { key: 'debit', label: 'Счёт дебета' }, { key: 'credit', label: 'Счёт кредита' }, { key: 'sum', label: 'Сумма', type: 'number' }, { key: 'note', label: 'Назначение' })} />
  </Screen>;
}
