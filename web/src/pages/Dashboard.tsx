import {
  ShieldAlert, ShieldCheck, Users, CalendarCheck, TrendingUp, TrendingDown,
  Monitor, LogIn, AlertTriangle, Sparkles, Bell, Activity, ChevronRight, CheckCircle2,
} from 'lucide-react';
import type { ReactNode, CSSProperties } from 'react';
import { useApp, Chip, Avatar, Sparkline, NexAsk, severityTone, severityLabel } from '../ui';
import {
  sessions, auditEvents, failedLogins, failedLoginTrend, notifications, aiInsights,
  services, roleLabel, criticalActions, groups,
} from '../data';

function Kpi({ icon, label, value, delta, up }: { icon: ReactNode; label: string; value: string; delta: string; up: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{delta}
      </div>
    </div>
  );
}

export function SecurityConsole() {
  const { toast } = useApp();
  const flagged = failedLogins.filter((f) => f.flagged).length;

  return (
    <div className="fade content-narrow">
      {/* Status ribbon */}
      <div className={`ribbon ${flagged ? 'ribbon-warn' : 'ribbon-ok'}`} style={{ marginBottom: 16 }}>
        <div className="ribbon-icon">{flagged ? <ShieldAlert size={22} /> : <ShieldCheck size={22} />}</div>
        <div>
          <h2>{flagged ? 'Система: требует внимания' : 'Система: защищена'}</h2>
          <p>{flagged
            ? `Обнаружены подозрительные попытки входа (${flagged}). Ядро, БД и журнал аудита целостны.`
            : 'Все подсистемы в норме, аномалий не обнаружено.'}</p>
        </div>
        <div className="ribbon-stats">
          <div className="ribbon-stat"><b>{sessions.length}</b><span>активных сессий</span></div>
          <div className="ribbon-stat"><b style={{ color: 'var(--danger)' }}>{flagged}</b><span>угроз входа</span></div>
          <div className="ribbon-stat"><b style={{ color: 'var(--ai)' }}>{aiInsights.length}</b><span>наблюдений ИИ</span></div>
        </div>
      </div>

      {/* Security KPIs */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi icon={<Monitor size={14} />} label="Активных сессий" value={String(sessions.length)} delta="норма" up />
        <Kpi icon={<ShieldAlert size={14} />} label="Угроз входа" value={String(flagged)} delta="за ночь" up={false} />
        <Kpi icon={<LogIn size={14} />} label="Неудачных входов" value={String(failedLogins.reduce((a, f) => a + f.attempts, 0))} delta="за сутки" up={false} />
        <Kpi icon={<Sparkles size={14} />} label="Наблюдений ИИ" value={String(aiInsights.length)} delta="активно" up />
      </div>

      <div className="grid dash-cols">
        {/* LEFT column */}
        <div className="grid" style={{ gap: 16 }}>
          {/* Audit feed */}
          <div className="card">
            <div className="card-head">
              <div className="card-title"><Activity size={15} /> Лента аудита</div>
              <NexAsk q="Что необычного в ленте аудита за последнее время? На что обратить внимание?" label="Найти необычное" />
            </div>
            <div className="row-list" aria-live="polite">
              {auditEvents.map((e) => (
                <div className="feed-row" key={e.id}>
                  <div className={`feed-ico ${e.actorType === 'ai' ? 'ai' : ''}`}>
                    {e.actorType === 'ai' ? <Sparkles size={14} /> : <Avatar name={e.actor} />}
                  </div>
                  <div className="feed-main">
                    <div className="t"><b>{e.actor}</b> — {e.action}</div>
                    <div className="m">{e.target}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <Chip tone={severityTone[e.severity]}>{severityLabel[e.severity]}</Chip>
                    <span className="dim" style={{ fontSize: 11 }}>{e.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Critical actions */}
          <div className="card">
            <div className="card-head"><div className="card-title"><AlertTriangle size={15} /> Критические действия</div></div>
            <div className="row-list">
              {criticalActions.map((e) => (
                <div className="feed-row" key={e.id}>
                  <div className="feed-ico" style={{ background: 'var(--danger-weak)', color: 'var(--danger)' }}><AlertTriangle size={14} /></div>
                  <div className="feed-main">
                    <div className="t">{e.action}</div>
                    <div className="m">{e.actor} · {e.target}</div>
                  </div>
                  <span className="dim" style={{ fontSize: 11 }}>{e.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div className="grid" style={{ gap: 16 }}>
          {/* Active sessions */}
          <div className="card">
            <div className="card-head"><div className="card-title"><Monitor size={15} /> Активные сессии</div></div>
            <div className="row-list">
              {sessions.map((s) => (
                <div className="feed-row" key={s.id}>
                  <Avatar name={s.name} />
                  <div className="feed-main">
                    <div className="t">{s.name} {s.current && <span className="dim">· вы</span>}</div>
                    <div className="m">{roleLabel[s.role]} · {s.device} · {s.location}</div>
                    {s.anomaly && <div style={{ marginTop: 4 }}><Chip tone="chip-warn">{s.anomaly}</Chip></div>}
                  </div>
                  {!s.current && <button className="btn btn-sm btn-ghost" onClick={() => toast('Сессия завершена')}>Завершить</button>}
                </div>
              ))}
            </div>
          </div>

          {/* Failed logins */}
          <div className="card">
            <div className="card-head">
              <div className="card-title"><LogIn size={15} /> Неудачные попытки входа</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><NexAsk q="Это атака подбора? Какие IP стоит заблокировать?" label="Оценить угрозу" /><Sparkline data={failedLoginTrend} color="var(--danger)" /></div>
            </div>
            <div className="row-list">
              {failedLogins.map((f) => (
                <div className="feed-row" key={f.id}>
                  <div className="feed-ico" style={{ background: f.flagged ? 'var(--danger-weak)' : 'var(--surface-2)', color: f.flagged ? 'var(--danger)' : 'var(--text-2)' }}>
                    <LogIn size={14} />
                  </div>
                  <div className="feed-main">
                    <div className="t"><span className="mono">{f.name}</span> · {f.attempts} попыток</div>
                    <div className="m">{f.ip} · {f.location} · {f.time}</div>
                  </div>
                  {f.flagged && <Chip tone="chip-danger">Блокировка</Chip>}
                </div>
              ))}
            </div>
          </div>

          {/* AI monitoring */}
          <div className="card">
            <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Мониторинг ИИ</div><Chip tone="chip-ai">активен</Chip></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {aiInsights.map((i) => {
                const pct = Math.round(i.confidence * 100);
                return (
                  <div className="insight-row" key={i.id}>
                    <div className="insight-ring" style={{ '--pct': `${pct}%` } as CSSProperties}>
                      <span>{pct}%</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.title}</div>
                      <div className="dim" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{i.desc}</div>
                    </div>
                    <NexAsk q={`Разбери подробнее: ${i.title}`} label="Открыть" subtle={false} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* System integrity */}
          <div className="card">
            <div className="card-head"><div className="card-title"><ShieldCheck size={15} /> Целостность системы</div></div>
            <div className="card-body">
              <div className="svc-grid">
                {services.map((s) => (
                  <div className="svc-tile" key={s.name}>
                    <span className={`svc-dot ${s.status}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="svc-name">{s.name}</div>
                      <div className="svc-value">{s.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="card">
            <div className="card-head"><div className="card-title"><Bell size={15} /> Важные уведомления</div></div>
            <div className="row-list">
              {notifications.map((n) => (
                <div className="feed-row" key={n.id}>
                  <div className="feed-ico" style={{ background: 'var(--surface-2)' }}><Bell size={13} /></div>
                  <div className="feed-main">
                    <div className="t">{n.title}</div>
                    <div className="m">{n.desc} · {n.time}</div>
                  </div>
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

function FocusDashboard() {
  const { user } = useApp();
  return (
    <div className="fade content-narrow">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Sparkles size={20} style={{ color: 'var(--ai)' }} />
          <div>
            <div style={{ fontWeight: 600 }}>Здравствуйте, {user?.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>На сегодня готово: расписание загружено, важных задач — 2. Лишних действий не требуется.</div>
          </div>
        </div>
      </div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Kpi icon={<CalendarCheck size={14} />} label="Пар сегодня" value="3" delta="следующая в 12:00" up />
        <Kpi icon={<CheckCircle2 size={14} />} label="Требует действий" value="2" delta="1 срочное" up={false} />
        <Kpi icon={<Users size={14} />} label="Групп" value={String(groups.length)} delta="кураторство" up />
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title"><AlertTriangle size={15} /> Требует внимания</div></div>
        <div className="row-list">
          {notifications.slice(0, 3).map((n) => (
            <div className="feed-row" key={n.id}>
              <div className="feed-ico"><ChevronRight size={14} /></div>
              <div className="feed-main"><div className="t">{n.title}</div><div className="m">{n.desc}</div></div>
              <Chip tone={severityTone[n.severity]}>{severityLabel[n.severity]}</Chip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useApp();
  return user?.role === 'admin' ? <SecurityConsole /> : <FocusDashboard />;
}
