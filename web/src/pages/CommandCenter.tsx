import type { ReactNode } from 'react';
import {
  Sparkles, ShieldAlert, Wallet, Users, CalendarCheck, FileText, AlertTriangle, LogIn,
  Monitor, TrendingUp, TrendingDown, CheckCircle2, Activity, ShieldCheck, BookOpen,
} from 'lucide-react';
import { useApp, Chip, Avatar, Sparkline, NexAsk, AskHero, severityTone, severityLabel } from '../ui';
import { AtRiskList } from '../blocks';
import { Donut, Bars, Line, Legend, type Segment } from '../components/charts';
import {
  sessions, failedLogins, failedLoginTrend, notifications, auditEvents, roleLabel,
  groups, gradesFor, type Severity,
} from '../data';

function Charts() {
  const dist: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
  groups.forEach((g) => Object.values(gradesFor(g.name)).forEach((row) => row.forEach((v) => { if (v >= 2 && v <= 5) dist[v]++; })));
  const gradeSegs: Segment[] = [
    { label: 'Отлично (5)', value: dist[5], color: 'var(--success)' },
    { label: 'Хорошо (4)', value: dist[4], color: 'var(--accent)' },
    { label: 'Удовл. (3)', value: dist[3], color: 'var(--warn)' },
    { label: 'Неуд. (2)', value: dist[2], color: 'var(--danger)' },
  ];
  const total = gradeSegs.reduce((a, s) => a + s.value, 0);
  const byGroup = groups.map((g) => ({ label: g.name, value: g.students }));
  const attendanceTrend = [88, 90, 91, 89, 92, 90, 91, 93, 92, 90, 89, 91];
  return (
    <div className="grid cols-3" style={{ marginBottom: 18 }}>
      <div className="card">
        <div className="card-head"><div className="card-title">Посещаемость · динамика</div><NexAsk q="Почему посещаемость снизилась на 2% за неделю? Какие группы дали основной вклад?" label="Объяснить тренд" /></div>
        <div className="card-body"><Line data={attendanceTrend} color="var(--accent)" min={80} max={100} /><div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Средняя 91% · −2% за неделю</div></div>
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title">Распределение оценок</div><NexAsk q="Разбери распределение оценок по организации и где проседает успеваемость" label="Разобрать" /></div>
        <div className="card-body chart-flex"><Donut segments={gradeSegs} centerTop={total} centerSub="оценок" /><Legend segments={gradeSegs} withValues /></div>
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title">Студенты по группам</div><NexAsk q="Сравни группы по численности и нагрузке" label="Сравнить" /></div>
        <div className="card-body"><Bars data={byGroup} color="var(--ai)" /></div>
      </div>
    </div>
  );
}

/* ---- recommended next action (the "what should I do next" unit) ---- */
interface Act { label: string; primary?: boolean; run: () => void; }
function Rec({ tone, icon, title, why, actions }: { tone: Severity; icon: ReactNode; title: string; why: string; actions: Act[] }) {
  const cls = tone === 'critical' ? 'crit' : tone === 'high' ? 'warn' : 'info';
  return (
    <div className="feed-row" style={{ padding: '13px 16px' }}>
      <div className={`attn-ic ${cls}`} style={{ width: 32, height: 32 }}>{icon}</div>
      <div className="feed-main">
        <div className="t" style={{ fontWeight: 600 }}>{title}</div>
        <div className="m" style={{ color: 'var(--text-2)' }}>{why}</div>
      </div>
      <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
        {actions.map((a) => (
          <button key={a.label} className={`btn btn-sm ${a.primary ? 'btn-primary' : 'btn-outline'}`} onClick={a.run}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, delta, up }: { icon: ReactNode; label: string; value: string; delta: string; up: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{delta}</div>
    </div>
  );
}

function AdminCenter() {
  const { setPage, toast } = useApp();
  return (
    <div className="fade content-narrow">
      <AskHero />

      {/* what changed since last session */}
      <div className="ai-card" style={{ marginBottom: 18 }}>
        <div className="ai-head"><Sparkles size={14} /> Сводка с прошлого входа</div>
        <div className="ai-body">
          За ночь: 12 неудачных входов с одного IP (требует реакции), поступило 2 платежа и 1 заявление, выставлены оценки в ПИ-21-1.
          Посещаемость снизилась на 2%. Ниже — что стоит сделать в первую очередь.
        </div>
      </div>

      {/* state first: спокойный обзор до списка дел */}
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Kpi icon={<Users size={14} />} label="Студентов" value="100" delta="+4 за месяц" up />
        <Kpi icon={<CalendarCheck size={14} />} label="Посещаемость" value="91%" delta="−2% за неделю" up={false} />
        <Kpi icon={<Wallet size={14} />} label="Задолженность" value="₽ 248K" delta="−12% за неделю" up />
        <Kpi icon={<FileText size={14} />} label="Заявления" value="3" delta="+1 новое" up />
      </div>

      {/* recommended next actions — answers "what should I do next" */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Рекомендованные действия</div><span className="dim" style={{ fontSize: 12 }}>подобрано NEX</span></div>
        <div className="row-list">
          <Rec tone="critical" icon={<ShieldAlert size={16} />} title="Заблокировать IP 45.9.148.3" why="12 неудачных входов за ночь · вероятная атака подбора"
            actions={[{ label: 'Заблокировать', primary: true, run: () => toast('IP заблокирован, событие в аудите') }, { label: 'Консоль', run: () => setPage('security') }]} />
          <Rec tone="high" icon={<Wallet size={16} />} title="Разослать уведомления 8 должникам" why="срок оплаты по контракту истекает 30.06"
            actions={[{ label: 'Разослать', primary: true, run: () => toast('Уведомления подготовлены') }, { label: 'Финансы', run: () => setPage('fin-overview') }]} />
          <Rec tone="medium" icon={<AlertTriangle size={16} />} title="4 студента в зоне риска" why="посещаемость ниже 75% и снижение успеваемости"
            actions={[{ label: 'Открыть список', primary: true, run: () => setPage('attendance') }]} />
          <Rec tone="medium" icon={<FileText size={16} />} title="2 приказа об отчислении ждут подписи" why="подготовлены NEX, требуется проверка и подпись"
            actions={[{ label: 'Открыть', primary: true, run: () => toast('Открываю черновики приказов') }]} />
        </div>
      </div>

      <Charts />

      {/* NEX acts on its own — the agentic OS, under control */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> NEX действует сам</div><span className="dim" style={{ fontSize: 12 }}>автономно · под вашим контролем</span></div>
        <div className="row-list">
          <div className="feed-row">
            <div className="feed-ico ai"><Sparkles size={14} /></div>
            <div className="feed-main"><div className="t">Отметил 3 аномальных платежа</div><div className="m">нетипичные суммы от одного контрагента · добавлено в аудит</div></div>
            <Chip tone="chip-success">сделано</Chip>
          </div>
          <div className="feed-row">
            <div className="feed-ico ai"><Sparkles size={14} /></div>
            <div className="feed-main"><div className="t">Подготовил 2 черновика приказов об отчислении</div><div className="m">по студентам с незакрытыми задолженностями</div></div>
            <button className="btn btn-sm btn-outline" onClick={() => toast('Открываю черновики')}>Проверить</button>
          </div>
          <div className="feed-row">
            <div className="feed-ico ai"><Sparkles size={14} /></div>
            <div className="feed-main"><div className="t">Сбалансировал расписание</div><div className="m">закрыл свободное окно Пн 12:00 переносом «Сетей»</div></div>
            <Chip tone="chip-success">сделано</Chip>
          </div>
          <div className="feed-row">
            <div className="feed-ico ai"><Sparkles size={14} /></div>
            <div className="feed-main"><div className="t">Подготовил уведомления 8 должникам</div><div className="m">ждёт вашего подтверждения перед отправкой</div></div>
            <button className="btn btn-sm btn-primary" onClick={() => toast('Уведомления отправлены, событие в аудите')}>Подтвердить</button>
          </div>
        </div>
      </div>

      <div className="grid dash-cols">
        <div className="grid" style={{ gap: 18 }}>
          <div className="card">
            <div className="card-head"><div className="card-title"><Activity size={15} /> Что изменилось</div><span className="dim" style={{ fontSize: 12 }}>с прошлого входа</span></div>
            <div className="row-list" aria-live="polite">
              {auditEvents.map((e) => (
                <div className="feed-row" key={e.id}>
                  <div className={`feed-ico ${e.actorType === 'ai' ? 'ai' : ''}`}>{e.actorType === 'ai' ? <Sparkles size={14} /> : <Avatar name={e.actor} />}</div>
                  <div className="feed-main"><div className="t"><b>{e.actor}</b> — {e.action}</div><div className="m">{e.target}</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <Chip tone={severityTone[e.severity]}>{severityLabel[e.severity]}</Chip>
                    <span className="dim" style={{ fontSize: 11 }}>{e.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title"><AlertTriangle size={15} /> Студенты в зоне риска</div></div>
            <AtRiskList />
          </div>
        </div>

        <div className="grid" style={{ gap: 18 }}>
          <div className="card">
            <div className="card-head"><div className="card-title"><LogIn size={15} /> Неудачные входы</div><Sparkline data={failedLoginTrend} color="var(--danger)" /></div>
            <div className="row-list">
              {failedLogins.map((f) => (
                <div className="feed-row" key={f.id}>
                  <div className="feed-ico" style={{ background: f.flagged ? 'var(--danger-weak)' : 'var(--surface-2)', color: f.flagged ? 'var(--danger)' : 'var(--text-2)' }}><LogIn size={14} /></div>
                  <div className="feed-main"><div className="t"><span className="mono">{f.name}</span> · {f.attempts} попыток</div><div className="m">{f.ip} · {f.location} · {f.time}</div></div>
                  {f.flagged && <Chip tone="chip-danger">блок</Chip>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title"><Monitor size={15} /> Активные сессии</div><button className="btn btn-sm btn-ghost" onClick={() => setPage('security')}>Все</button></div>
            <div className="row-list">
              {sessions.slice(0, 3).map((s) => (
                <div className="feed-row" key={s.id}>
                  <Avatar name={s.name} />
                  <div className="feed-main"><div className="t">{s.name}</div><div className="m">{roleLabel[s.role]} · {s.location}</div></div>
                  {s.anomaly ? <Chip tone="chip-warn">аномалия</Chip> : <Chip tone="chip-success">ок</Chip>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Дедлайны и уведомления</div></div>
            <div className="row-list">
              {notifications.map((n) => (
                <div className="feed-row" key={n.id}>
                  <div className="feed-ico"><CheckCircle2 size={13} /></div>
                  <div className="feed-main"><div className="t">{n.title}</div><div className="m">{n.desc} · {n.time}</div></div>
                  <Chip tone={severityTone[n.severity]}>{severityLabel[n.severity]}</Chip>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleCenter() {
  const { user, setPage, toast } = useApp();
  const isAcc = user?.role === 'accountant';
  return (
    <div className="fade content-narrow">
      <AskHero />

      <div className="ai-card" style={{ marginBottom: 18 }}>
        <div className="ai-head"><Sparkles size={14} /> Сводка с прошлого входа</div>
        <div className="ai-body">
          Здравствуйте, {user?.name}. {isAcc ? 'Появились 2 новых платежа, 8 студентов с истекающим сроком оплаты.' : 'Сегодня 3 пары, 2 студента в зоне риска, вчерашний журнал не заполнен.'} Рекомендации ниже.
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Рекомендованные действия</div></div>
        <div className="row-list">
          {isAcc ? (
            <>
              <Rec tone="high" icon={<Wallet size={16} />} title="Разослать уведомления должникам" why="8 студентов, срок 30.06"
                actions={[{ label: 'Разослать', primary: true, run: () => toast('Уведомления подготовлены') }, { label: 'Финансы', run: () => setPage('fin-overview') }]} />
              <Rec tone="medium" icon={<AlertTriangle size={16} />} title="Проверить аномалию в платежах" why="3 нетипичных перевода от одного контрагента"
                actions={[{ label: 'Открыть', primary: true, run: () => setPage('fin-overview') }]} />
            </>
          ) : (
            <>
              <Rec tone="medium" icon={<BookOpen size={16} />} title="Заполнить журнал за вчера" why="занятие без выставленных оценок"
                actions={[{ label: 'Открыть журнал', primary: true, run: () => setPage('journal') }]} />
              <Rec tone="medium" icon={<AlertTriangle size={16} />} title="2 студента в зоне риска" why="посещаемость ниже 70%"
                actions={[{ label: 'Посмотреть', primary: true, run: () => setPage('attendance') }]} />
            </>
          )}
        </div>
      </div>

      <div className="grid cols-3">
        <Kpi icon={<CalendarCheck size={14} />} label={isAcc ? 'Платежи сегодня' : 'Пар сегодня'} value={isAcc ? '2' : '3'} delta={isAcc ? '+₽124K' : 'следующая 12:00'} up />
        <Kpi icon={<CheckCircle2 size={14} />} label="Требует действий" value="2" delta="1 срочное" up={false} />
        <Kpi icon={<ShieldCheck size={14} />} label="Ваш доступ" value="ОК" delta="2FA не настроена" up={false} />
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const { user } = useApp();
  return user?.role === 'admin' ? <AdminCenter /> : <RoleCenter />;
}
