import { useState, useEffect } from 'react';
import {
  Sparkles, Bot, Check, X, ArrowUp, Pause, Play, ShieldAlert, ScrollText, Send,
  Gauge, ListChecks, Eye, Plus,
} from 'lucide-react';
import { PageHead, Chip, Beta, useApp } from '../ui';
import { planFor } from '../nexbrain';
import { llmReady, llmPlan } from '../llm';
import {
  AGENTS, QUEUE, AGENT_LOG, AUTONOMY_LEVELS, AUTOPILOT_PRESETS, RULES, agentById, guessAgent, dryRun,
  type Agent, type Autonomy, type PendingAction, type Rule,
} from '../agents';

/* ============================================================
   АГЕНТЫ — экспериментальный центр агентности NEX (только админ).
   Человек управляет ПОЛИТИКОЙ, а не кнопками:
   автопилот → уровни автономии → правила словами → очередь
   с прогнозом последствий → журнал.
   ============================================================ */

const riskTone = { low: 'chip-success', medium: 'chip-warn', high: 'chip-danger' } as const;
const riskLabel = { low: 'низкий риск', medium: 'средний риск', high: 'высокий риск' } as const;

/* ---- видимое исполнение: план тикает по шагам (BACKEND: стрим статуса воркера) ---- */
function StepsRun({ label, steps: given, onDone }: { label: string; steps?: string[]; onDone: () => void }) {
  const steps = given ?? planFor(label);
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (done >= steps.length) { const t = setTimeout(onDone, 900); return () => clearTimeout(t); }
    const t = setTimeout(() => setDone((d) => d + 1), 550);
    return () => clearTimeout(t);
  }, [done, steps.length, onDone]);
  return (
    <div className="agent-run" style={{ marginTop: 10 }}>
      <div className="agent-run-head"><Sparkles size={13} />Выполняю: {label}</div>
      <div className="agent-steps">
        {steps.map((s, i) => (
          <div key={i} className={`agent-step ${i < done ? 'done' : i === done ? 'active' : ''}`}>
            <span className="dot">{i < done ? <Check size={11} /> : <span className="spin" />}</span>{s}
          </div>
        ))}
      </div>
      {done >= steps.length && <div className="agent-done"><Check size={13} /> Готово · записано в аудит</div>}
    </div>
  );
}

/* ---- поручить задачу своими словами: план → утверждение → исполнение ---- */
function Delegate() {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);

  /* план составляет Gemini (если подключён), иначе шаблонный planFor */
  const propose = async () => {
    const t = text.trim();
    if (!t) return;
    setThinking(true);
    let s: string[];
    try { s = llmReady() ? await llmPlan(t) : planFor(t); }
    catch { s = planFor(t); }
    setSteps(s);
    setPlan(t);
    setThinking(false);
    setRunning(false);
  };
  const reset = () => { setPlan(null); setSteps([]); setText(''); setRunning(false); };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="card-title"><Send size={15} /> Поручить NEX</div><span className="dim" style={{ fontSize: 12 }}>задача словами → план → утверждение → исполнение</span></div>
      <div className="card-body">
        {!plan && (
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); propose(); }}>
            <Sparkles size={16} className="lead" />
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={thinking}
              placeholder={thinking ? 'NEX составляет план…' : 'Например: подготовь справки всем отличникам ПИ-21-1…'} />
            <button className="ask-send" type="submit" aria-label="Составить план"><ArrowUp size={17} /></button>
          </form>
        )}
        {plan && !running && (
          <div className="agent-run">
            <div className="agent-run-head"><Sparkles size={13} />План: {plan}{llmReady() && <span className="inline-badge" style={{ marginLeft: 6 }}>ИИ</span>}</div>
            <div className="agent-steps">
              {steps.map((s, i) => (
                <div key={i} className="agent-step done"><span className="dot"><Check size={11} /></span>{s}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-primary" onClick={() => setRunning(true)}><Check size={14} />Утвердить и выполнить</button>
              <button className="btn btn-sm btn-ghost" onClick={reset}><X size={14} />Отменить</button>
            </div>
          </div>
        )}
        {plan && running && <StepsRun label={plan} steps={steps} onDone={() => { toast('Задача выполнена, отчёт в журнале'); reset(); }} />}
      </div>
    </div>
  );
}

/* ---- очередь подтверждений: с прогнозом последствий до решения ---- */
function Queue() {
  const { toast } = useApp();
  const [items, setItems] = useState<PendingAction[]>(QUEUE);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const decline = (id: number) => { setItems((xs) => xs.filter((x) => x.id !== id)); toast('Отклонено — агент учтёт'); };
  const finish = (id: number) => { setItems((xs) => xs.filter((x) => x.id !== id)); setRunningId(null); };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div className="card-title"><ShieldAlert size={15} /> Ждут подтверждения</div>
        <Chip tone={items.length ? 'chip-warn' : 'chip-success'}>{items.length ? `${items.length} действий` : 'пусто'}</Chip>
      </div>
      <div className="row-list">
        {items.length === 0 && <div className="feed-row"><div className="feed-main"><div className="m">Очередь пуста — агенты работают в рамках своих уровней автономии.</div></div></div>}
        {items.map((q) => (
          <div className="feed-row" key={q.id} style={{ flexWrap: 'wrap' }}>
            <div className="feed-ico ai"><Bot size={14} /></div>
            <div className="feed-main">
              <div className="t"><b>{agentById(q.agentId).name}</b> — {q.action}</div>
              <div className="m">{q.why}</div>
              {/* прогноз последствий (dry-run) — смотришь, ЧТО изменится, до решения */}
              {previewId === q.id && (
                <div className="dryrun">
                  {dryRun(q.action).map((e, i) => <div key={i} className="dryrun-row"><Eye size={12} />{e}</div>)}
                </div>
              )}
              {runningId === q.id && <StepsRun label={q.action} onDone={() => finish(q.id)} />}
            </div>
            {runningId !== q.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                <Chip tone={riskTone[q.risk]}>{riskLabel[q.risk]}</Chip>
                <button className="btn btn-sm btn-outline" onClick={() => setPreviewId(previewId === q.id ? null : q.id)}><Eye size={13} />Прогноз</button>
                <button className="btn btn-sm btn-primary" onClick={() => setRunningId(q.id)}>Подтвердить</button>
                <button className="btn btn-sm btn-ghost" onClick={() => decline(q.id)}>Отклонить</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- правила: автоматизации, описанные обычным языком ---- */
function Rules() {
  const { toast } = useApp();
  const [rules, setRules] = useState<Rule[]>(RULES);
  const [text, setText] = useState('');

  const toggle = (id: number) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const add = () => {
    const t = text.trim();
    if (!t) return;
    // BACKEND: текст правила разбирает LLM в триггер+действие; здесь только подбор агента
    setRules((rs) => [{ id: Date.now(), text: t, agentId: guessAgent(t), enabled: true }, ...rs]);
    setText('');
    toast('Правило создано — назначен агент ' + agentById(guessAgent(t)).name);
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="card-title"><ListChecks size={15} /> Правила</div><span className="dim" style={{ fontSize: 12 }}>автоматизации обычным языком</span></div>
      <div className="card-body" style={{ paddingBottom: 6 }}>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); add(); }} style={{ height: 42 }}>
          <Plus size={15} className="lead" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Опишите правило: «если …, то …» — NEX сам назначит агента" />
          <button className="ask-send sm" type="submit" aria-label="Добавить правило"><ArrowUp size={15} /></button>
        </form>
      </div>
      <div className="row-list">
        {rules.map((r) => (
          <div className="feed-row" key={r.id} style={{ alignItems: 'center', opacity: r.enabled ? 1 : 0.55 }}>
            <div className="feed-ico ai"><Bot size={13} /></div>
            <div className="feed-main">
              <div className="t">{r.text}</div>
              <div className="m">агент: {agentById(r.agentId).name}</div>
            </div>
            <button className={`rule-toggle ${r.enabled ? 'on' : ''}`} onClick={() => toggle(r.id)} aria-label="Переключить правило"><i /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- карточка агента: пауза + уровень автономии ---- */
function AgentCard({ a, autonomy, setAutonomy }: { a: Agent; autonomy: Autonomy; setAutonomy: (v: Autonomy) => void }) {
  const { toast } = useApp();
  const [paused, setPaused] = useState(a.paused);
  return (
    <div className={`agent-card ${paused ? 'paused' : ''}`}>
      <div className="agent-card-head">
        <div className="feed-ico ai"><Bot size={15} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="agent-name">{a.name} <span className="dim" style={{ fontWeight: 500 }}>· {a.domain}</span></div>
          <div className="agent-desc">{a.desc}</div>
        </div>
        <button className="icon-btn" title={paused ? 'Возобновить' : 'Пауза'} onClick={() => { setPaused(!paused); toast(paused ? `${a.name} возобновлён` : `${a.name} на паузе`); }}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      </div>

      <div className="auto-seg">
        {AUTONOMY_LEVELS.map((l) => (
          <button key={l.level} className={autonomy === l.level ? 'on' : ''} title={l.desc}
            onClick={() => { setAutonomy(l.level as Autonomy); toast(`${a.name}: уровень «${l.name}»`); }}>
            {l.name}
          </button>
        ))}
      </div>

      <div className="agent-foot">
        <span className="dim">{a.lastAction}</span>
        <Chip tone="chip-ai">{a.actionsToday} сегодня</Chip>
      </div>
    </div>
  );
}

export default function Agents() {
  const { toast } = useApp();
  /* уровни всех агентов — единое состояние, чтобы автопилот менял всё разом */
  const [levels, setLevels] = useState<Record<string, Autonomy>>(
    () => Object.fromEntries(AGENTS.map((a) => [a.id, a.autonomy])),
  );
  const setLevel = (id: string, v: Autonomy) => setLevels((m) => ({ ...m, [id]: v }));
  const applyPreset = (level: Autonomy, name: string) => {
    setLevels(Object.fromEntries(AGENTS.map((a) => [a.id, level])));
    toast(`Автопилот «${name}»: уровень применён ко всем агентам`);
  };
  const activePreset = AUTOPILOT_PRESETS.find((p) => AGENTS.every((a) => levels[a.id] === p.level))?.id ?? null;

  return (
    <div className="fade content-narrow">
      <PageHead title="Агенты" sub="Штат фоновых агентов NEX — вы управляете политикой, а не кнопками" actions={<Beta />} />

      {/* Автопилот: одно движение — политика всей организации */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><Gauge size={15} /> Автопилот</div><span className="dim" style={{ fontSize: 12 }}>пресет выставляет уровень всем агентам</span></div>
        <div className="card-body pilot-row">
          {AUTOPILOT_PRESETS.map((p) => (
            <button key={p.id} className={`pilot-btn ${activePreset === p.id ? 'on' : ''}`} onClick={() => applyPreset(p.level, p.name)}>
              <b>{p.name}</b><span>{p.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <Delegate />
      <Queue />
      <Rules />

      <div className="agent-grid" style={{ marginBottom: 16 }}>
        {AGENTS.map((a) => (
          <div key={a.id} style={{ display: 'contents' }}>
            <AgentCard a={a} autonomy={levels[a.id]} setAutonomy={(v) => setLevel(a.id, v)} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><ScrollText size={15} /> Журнал агентов</div><span className="dim" style={{ fontSize: 12 }}>сделано автономно</span></div>
        <div className="row-list">
          {AGENT_LOG.map((e) => (
            <div className="feed-row" key={e.id}>
              <div className="feed-ico ai"><Sparkles size={13} /></div>
              <div className="feed-main"><div className="t"><b>{agentById(e.agentId).name}</b> — {e.text}</div></div>
              <span className="dim" style={{ fontSize: 11 }}>{e.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
