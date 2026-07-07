import { useState, useMemo } from 'react';
import {
  Sparkles, BookOpen, Library, FileText, GraduationCap, Calendar, Briefcase,
  Trophy, FolderOpen, Bookmark, CalendarPlus, Flame, Play, Star, CheckCircle2, Rss,
} from 'lucide-react';
import { PageHead, Chip, Beta, NexAsk, useApp } from '../ui';
import {
  INTERESTS, OPPORTUNITIES, OPP_KIND_LABEL, LECTURES, CALENDAR, PROGRESS, ACHIEVEMENTS, PORTFOLIO, PERKS,
  matchScore, whyRecommended, urgency, forYou, continueLecture,
  type Interest, type Opportunity, type OppKind,
} from '../campus';

/* ============================================================
   КАМПУС — личный центр возможностей студента.
   Вкладки: Для вас · Возможности · Учёба · Карьера · Прогресс.
   ИИ здесь не чат, а слой: ранжирует, объясняет «почему вам»,
   следит за дедлайнами, собирает портфолио.
   ============================================================ */

type Tab = 'foryou' | 'opps' | 'study' | 'career' | 'progress';

/* Подписки хранятся локально — BACKEND: PUT /campus/interests */
const DEFAULT_INTERESTS: Interest[] = ['Backend', 'AI', 'Стажировки'];

function MatchChip({ opp, interests }: { opp: Opportunity; interests: Interest[] }) {
  const score = matchScore(opp, interests);
  return <span className="match-chip" title={whyRecommended(opp, interests)}><Sparkles size={11} />{score}%</span>;
}

function DeadlineChip({ days }: { days: number | null }) {
  if (days === null) return null;
  const u = urgency(days);
  if (u === 'critical') return <Chip tone="chip-danger"><Flame size={11} style={{ marginRight: 3 }} />осталось {days} дн.</Chip>;
  if (u === 'soon') return <Chip tone="chip-warn">до дедлайна {days} дн.</Chip>;
  return <Chip tone="chip-neutral">{days} дн.</Chip>;
}

function OppCard({ opp, interests }: { opp: Opportunity; interests: Interest[] }) {
  const { toast } = useApp();
  return (
    <div className="opp-card">
      <div className="opp-head">
        <Chip tone="chip-info">{OPP_KIND_LABEL[opp.kind]}</Chip>
        <MatchChip opp={opp} interests={interests} />
        <DeadlineChip days={opp.deadlineDays} />
      </div>
      <div className="opp-title">{opp.title}</div>
      <div className="opp-org">{opp.org}{opp.reward ? ` · ${opp.reward}` : ''}</div>
      <div className="opp-desc">{opp.desc}</div>
      {/* объяснимость: NEX всегда говорит, ПОЧЕМУ это показано */}
      <div className="opp-why"><Sparkles size={11} /> {whyRecommended(opp, interests)}</div>
      <div className="opp-actions">
        <button className="btn btn-sm btn-primary" onClick={() => toast('Заявка — бета')}>Подать заявку</button>
        <button className="icon-btn" title="В календарь" onClick={() => toast('Добавлено в календарь')}><CalendarPlus size={16} /></button>
        <button className="icon-btn" title="Сохранить" onClick={() => toast('Сохранено')}><Bookmark size={16} /></button>
      </div>
    </div>
  );
}

/* ---- Для вас: персональная лента, ре-ранжируется живьём при смене подписок ---- */
function ForYou({ interests, setInterests }: { interests: Interest[]; setInterests: (v: Interest[]) => void }) {
  const feed = useMemo(() => forYou(interests), [interests]);
  const cont = continueLecture();
  const toggle = (i: Interest) => setInterests(interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i]);

  return (
    <>
      {/* Подписки на интересы — основа персонализации */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title"><Rss size={15} /> Мои подписки</div><span className="dim" style={{ fontSize: 12 }}>лента перестраивается сразу</span></div>
        <div className="card-body interests">
          {INTERESTS.map((i) => (
            <button key={i} className={`int-chip ${interests.includes(i) ? 'on' : ''}`} onClick={() => toggle(i)}>{i}</button>
          ))}
        </div>
      </div>

      {cont && (
        <div className="ai-card" style={{ marginBottom: 14 }}>
          <div className="ai-head"><Play size={13} /> Продолжить</div>
          <div className="ai-body"><b>{cont.title}</b> · {cont.subject} — вы на {cont.progress}%.</div>
          <div className="meter" style={{ height: 6, marginTop: 8 }}><i style={{ width: `${cont.progress}%`, background: 'var(--ai)' }} /></div>
        </div>
      )}

      <div className="opp-grid">
        {feed.slice(0, 6).map((o) => <div key={o.id} style={{ display: 'contents' }}><OppCard opp={o} interests={interests} /></div>)}
      </div>

      {/* Студенческие подписки — сервисы, положенные по статусу студента */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div className="card-title"><Star size={15} /> Студенческие подписки</div><span className="dim" style={{ fontSize: 12 }}>бесплатно или со скидкой по статусу студента</span></div>
        <div className="card-body perk-grid">
          {PERKS.map((p) => <div key={p.id} style={{ display: 'contents' }}><PerkCard service={p.service} what={p.what} status={p.status} /></div>)}
        </div>
      </div>
    </>
  );
}

function PerkCard({ service, what, status }: { service: string; what: string; status: 'active' | 'available' }) {
  const { toast } = useApp();
  return (
    <div className="perk-card">
      <div className="perk-logo">{service[0]}</div>
      <div className="perk-main">
        <div className="perk-name">{service}</div>
        <div className="perk-what">{what}</div>
      </div>
      {status === 'active'
        ? <Chip tone="chip-success">активна</Chip>
        : <button className="btn btn-sm btn-outline" onClick={() => toast('Активация — бета')}>Активировать</button>}
    </div>
  );
}

/* ---- Возможности: карточки с фильтром по типу ---- */
function Opps({ interests }: { interests: Interest[] }) {
  const [kind, setKind] = useState<OppKind | 'all'>('all');
  const kinds: (OppKind | 'all')[] = ['all', 'internship', 'vacancy', 'course', 'hackathon', 'grant', 'conference', 'club'];
  const list = OPPORTUNITIES.filter((o) => kind === 'all' || o.kind === kind);
  return (
    <>
      <div className="chips" style={{ marginBottom: 14 }}>
        {kinds.map((k) => (
          <button key={k} className={`chip-btn sm ${kind === k ? 'on-ai' : ''}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'Все' : OPP_KIND_LABEL[k]}
          </button>
        ))}
        <NexAsk q="Подбери возможности под мой профиль и дедлайны" label="Подбор NEX" subtle={false} />
      </div>
      <div className="opp-grid">
        {list.map((o) => <div key={o.id} style={{ display: 'contents' }}><OppCard opp={o} interests={interests} /></div>)}
      </div>
    </>
  );
}

/* ---- Учёба: лекции + энциклопедия + документация ---- */
function Study() {
  const { toast } = useApp();
  const tiles = [
    { icon: Library, t: 'Энциклопедия', d: 'Термины · глоссарий · шпаргалки · формулы' },
    { icon: FileText, t: 'Документация', d: 'Методички · ГОСТ · бланки · учебные планы' },
    { icon: Star, t: 'Избранное', d: 'Сохранённые лекции и материалы' },
  ];
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title"><BookOpen size={15} /> Лекции</div><NexAsk q="Что мне сегодня учить и какие дедлайны?" label="Что учить" /></div>
        <div className="row-list">
          {LECTURES.map((l) => (
            <div className="feed-row" key={l.id}>
              <div className="feed-ico" style={{ background: 'var(--ai-weak)', color: 'var(--ai)' }}><BookOpen size={14} /></div>
              <div className="feed-main">
                <div className="t">{l.title} {l.progress === 100 && <CheckCircle2 size={13} style={{ color: 'var(--success)', verticalAlign: 'middle' }} />}</div>
                <div className="m">{l.subject} · {l.by} · {l.dur}</div>
                {l.progress > 0 && l.progress < 100 && <div className="meter" style={{ height: 4, marginTop: 6 }}><i style={{ width: `${l.progress}%`, background: 'var(--ai)' }} /></div>}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => toast('Просмотр — бета')}>{l.progress > 0 && l.progress < 100 ? 'Продолжить' : 'Открыть'}</button>
            </div>
          ))}
        </div>
      </div>
      <div className="grid cols-3">
        {tiles.map(({ icon: Icon, t, d }) => (
          <div className="card campus-tile" key={t} onClick={() => toast(`${t} — бета`)}>
            <div className="campus-ic"><Icon size={20} /></div>
            <div><div style={{ fontWeight: 700 }}>{t}</div><div className="muted" style={{ fontSize: 12.5 }}>{d}</div></div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---- Карьера ---- */
function Career({ interests }: { interests: Interest[] }) {
  const { toast } = useApp();
  const jobs = OPPORTUNITIES.filter((o) => o.kind === 'internship' || o.kind === 'vacancy');
  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">Карьерный рейтинг</div><div className="kpi-value">72<span className="dim" style={{ fontSize: 14 }}>/100</span></div></div>
        <div className="kpi"><div className="kpi-label">Заявок подано</div><div className="kpi-value">{PROGRESS.applications}</div></div>
        <div className="kpi"><div className="kpi-label">Компаний-партнёров</div><div className="kpi-value">12</div></div>
      </div>
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> Резюме</div>
        <div className="ai-body">Резюме заполнено на 70%. NEX может проверить его и подтянуть данные из портфолио (сертификаты, практика, достижения).</div>
        <div className="ai-actions">
          <NexAsk q="Проверь моё резюме и скажи, что усилить" label="Проверить резюме" subtle={false} />
          <button className="btn btn-sm btn-outline" onClick={() => toast('Консультация — бета')}><Briefcase size={14} />Записаться к консультанту</button>
        </div>
      </div>
      <div className="opp-grid">
        {jobs.map((o) => <div key={o.id} style={{ display: 'contents' }}><OppCard opp={o} interests={interests} /></div>)}
      </div>
    </>
  );
}

/* ---- Прогресс: развитие, достижения, портфолио, календарь ---- */
function Progress() {
  const { toast } = useApp();
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">Лекций пройдено</div><div className="kpi-value">{PROGRESS.lectures}</div></div>
        <div className="kpi"><div className="kpi-label">Сертификатов</div><div className="kpi-value">{PROGRESS.certificates}</div></div>
        <div className="kpi"><div className="kpi-label">Мероприятий</div><div className="kpi-value">{PROGRESS.events}</div></div>
        <div className="kpi"><div className="kpi-label">Часов обучения</div><div className="kpi-value">{PROGRESS.hours}</div></div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><div className="card-title"><Trophy size={15} /> Достижения</div></div>
          <div className="row-list">
            {ACHIEVEMENTS.map((a) => (
              <div className="feed-row" key={a.id} style={{ opacity: a.done ? 1 : 0.85 }}>
                <div className="feed-ico" style={{ background: a.done ? 'var(--success)' : 'var(--surface-2)', color: a.done ? '#fff' : 'var(--text-3)' }}><Trophy size={13} /></div>
                <div className="feed-main">
                  <div className="t">{a.title}</div><div className="m">{a.desc}</div>
                  {!a.done && a.progress > 0 && <div className="meter" style={{ height: 4, marginTop: 6 }}><i style={{ width: `${a.progress}%`, background: 'var(--ai)' }} /></div>}
                </div>
                {a.done && <Chip tone="chip-success">получено</Chip>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><Calendar size={15} /> Единый календарь</div><NexAsk q="Какие мероприятия и дедлайны у меня на неделе?" label="Спросить NEX" /></div>
          <div className="row-list">
            {CALENDAR.map((e) => (
              <div className="feed-row" key={e.id}>
                <div className="feed-ico" style={e.kind === 'deadline' ? { background: 'var(--danger-weak)', color: 'var(--danger)' } : undefined}><Calendar size={13} /></div>
                <div className="feed-main"><div className="t">{e.title}</div><div className="m">{e.when}</div></div>
                <Chip tone={e.kind === 'exam' ? 'chip-warn' : e.kind === 'deadline' ? 'chip-danger' : 'chip-info'}>
                  {e.kind === 'exam' ? 'экзамен' : e.kind === 'deadline' ? 'дедлайн' : 'событие'}
                </Chip>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Портфолио собирает NEX из данных системы — одна кнопка на выпуске */}
      <div className="card">
        <div className="card-head">
          <div className="card-title"><FolderOpen size={15} /> Портфолио · собирает NEX автоматически</div>
          <button className="btn btn-sm btn-primary" onClick={() => toast('Портфолио собрано в PDF — бета')}><Sparkles size={13} />Собрать портфолио</button>
        </div>
        <div className="row-list">
          {PORTFOLIO.map((p) => (
            <div className="feed-row" key={p.title}>
              <div className="feed-ico ai"><Sparkles size={13} /></div>
              <div className="feed-main"><div className="t">{p.title}</div><div className="m">{p.kind} · {p.source}</div></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function Campus() {
  const [tab, setTab] = useState<Tab>('foryou');
  const [interests, setInterests] = useState<Interest[]>(DEFAULT_INTERESTS);
  const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: 'foryou', label: 'Для вас', icon: Sparkles },
    { id: 'opps', label: 'Возможности', icon: Flame },
    { id: 'study', label: 'Учёба', icon: BookOpen },
    { id: 'career', label: 'Карьера', icon: Briefcase },
    { id: 'progress', label: 'Прогресс', icon: GraduationCap },
  ];
  return (
    <div className="fade content-narrow">
      <PageHead title="Кампус" sub="Навигатор по возможностям, пока вы студент" actions={<Beta />} />
      <div className="seg campus-tabs" style={{ marginBottom: 16 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={14} style={{ marginRight: 6 }} />{label}</button>
        ))}
      </div>
      {tab === 'foryou' && <ForYou interests={interests} setInterests={setInterests} />}
      {tab === 'opps' && <Opps interests={interests} />}
      {tab === 'study' && <Study />}
      {tab === 'career' && <Career interests={interests} />}
      {tab === 'progress' && <Progress />}
    </div>
  );
}
