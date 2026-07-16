import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  Sparkles, ArrowUp, ArrowRight, ShieldAlert, Wallet, AlertTriangle,
  Activity, GraduationCap, Calendar, Users, Plus, Copy, ThumbsUp, ThumbsDown,
  GitBranch, Paperclip, Boxes, AtSign, Check,
} from 'lucide-react';
import { useApp, Chip } from '../ui';
import { nexReply, planFor, type NavLink } from '../nexbrain';
import { llmReady, llmAsk, llmAskStream, LlmStreamError, type LlmTurn } from '../llm';
import { Md } from '../md';
import { DataBlock } from '../nexdata';

/* NEX performs an action as a visible agentic run (plan → steps → audit). */
function AgentRun({ label }: { label: string }) {
  const steps = planFor(label);
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (done >= steps.length) return;
    const t = setTimeout(() => setDone((d) => d + 1), 650);
    return () => clearTimeout(t);
  }, [done, steps.length]);
  const finished = done >= steps.length;
  return (
    <div className="agent-run">
      <div className="agent-run-head"><Sparkles size={13} />NEX выполняет: {label}</div>
      <div className="agent-steps">
        {steps.map((s, i) => (
          <div key={i} className={`agent-step ${i < done ? 'done' : i === done ? 'active' : ''}`}>
            <span className="dot">{i < done ? <Check size={11} /> : <span className="spin" />}</span>{s}
          </div>
        ))}
      </div>
      {finished && <div className="agent-done"><Check size={13} /> Готово · записано в журнал аудита</div>}
    </div>
  );
}

const SUGGEST: { icon: typeof Sparkles; label: string; q: string }[] = [
  { icon: Activity, label: 'Что сегодня важно?', q: 'Что сегодня важно?' },
  { icon: AlertTriangle, label: 'Студенты в зоне риска', q: 'Покажи студентов в зоне риска' },
  { icon: Wallet, label: 'Финансы и долги', q: 'Что с финансами и задолженностью?' },
  { icon: ShieldAlert, label: 'Состояние безопасности', q: 'Состояние безопасности' },
  { icon: GraduationCap, label: 'Готовность к выпуску', q: 'Какая готовность к выпуску?' },
  { icon: Calendar, label: 'Окна в расписании', q: 'Покажи окна в расписании' },
];

/* Sections that can be pulled into context via "@" */
const MENTIONS = ['Студенты', 'Финансы', 'Безопасность', 'Расписание', 'Аналитика', 'Посещаемость'];

function NavChips({ nav }: { nav: NavLink[] }) {
  const { setPage } = useApp();
  return (
    <div className="chat-nav">
      {nav.map((n) => (
        <button key={n.page + n.label} className="chip-btn" onClick={() => setPage(n.page)}>
          {n.label} <ArrowRight size={13} className="ic" />
        </button>
      ))}
    </div>
  );
}

export default function Chat() {
  const { user, chatLog, setChatLog, pendingAsk, clearPendingAsk, toast } = useApp();
  const [input, setInput] = useState('');
  const [fb, setFb] = useState<Record<number, 'up' | 'down'>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  /* Живой Gemini, если ключ подключён в Настройках; иначе локальный мок.
     BACKEND: в проде — /api/nex с ключом в env, история — с сервера. */
  const send = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setInput('');
    setChatLog((m) => [...m, { who: 'u', text }]);

    if (llmReady()) {
      setChatLog((m) => [...m, { who: 'n', text: '', pending: true }]);
      const history: LlmTurn[] = chatLog
        .filter((m) => !m.run && !m.pending && m.text)
        .slice(-8)
        .map((m) => ({ role: m.who === 'u' ? 'user' : 'model', text: m.text }));
      let streamed = '';
      try {
        const answer = await llmAskStream(text, { history }, (delta) => {
          streamed += delta;
          // Первый пришедший кусок сразу гасит индикатор "печатает" —
          // дальше текст растёт сам по себе, дублировать "typing" не нужно.
          setChatLog((m) => [...m.slice(0, -1), { who: 'n', text: streamed, pending: false }]);
        });
        setChatLog((m) => [...m.slice(0, -1), { who: 'n', text: answer }]);
        return;
      } catch (err) {
        if (err instanceof LlmStreamError) {
          // Стрим не дал ни одного куска — пробуем обычный /ask, прежде
          // чем откатываться на локальный мок.
          try {
            const answer = await llmAsk(text, { history });
            setChatLog((m) => [...m.slice(0, -1), { who: 'n', text: answer }]);
            return;
          } catch { /* падаем на мок ниже */ }
        }
        setChatLog((m) => m.slice(0, -1)); // ИИ недоступен — падаем на мок
      }
    }
    const a = nexReply(text);
    setChatLog((m) => [...m, { who: 'n', ...a }]);
  };

  useEffect(() => {
    if (pendingAsk) { send(pendingAsk); clearPendingAsk(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatLog]);

  const submit = (e: FormEvent) => { e.preventDefault(); send(input); };
  const empty = chatLog.length === 0;

  const newChat = () => { setChatLog(() => []); setFb({}); setInput(''); };
  const copy = (text: string, i: number) => { navigator.clipboard?.writeText(text); setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400); };
  const rate = (i: number, v: 'up' | 'down') => { setFb((f) => ({ ...f, [i]: f[i] === v ? undefined as never : v })); toast(v === 'up' ? 'Спасибо за оценку' : 'Учту — отвечу лучше'); };
  const branch = (text: string) => { setChatLog(() => []); setFb({}); toast('Новая ветка от этого ответа'); setTimeout(() => send(text), 0); };
  const addMention = (m: string) => { setInput((s) => `${s}@${m} `.replace(/\s+@/, ' @').trimStart()); setMentionOpen(false); };
  const runAction = (label: string) => { setChatLog((m) => [...m, { who: 'n', text: '', run: label }]); };

  return (
    <div className="chat-page fade">
      {empty ? (
        <div className="chat-hero">
          <div className="chat-hero-mark"><Sparkles size={26} /></div>
          <h1>Здравствуйте, {user?.name?.split(' ')[0] || 'коллега'}</h1>
          <p>Спросите что угодно об организации — я отвечу по данным и при необходимости открою нужный раздел. Это полноценная альтернатива навигации по NEX.</p>

          <form className="chat-input chat-input-hero" onSubmit={submit}>
            <Sparkles size={18} className="lead" />
            <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Например: что сегодня важно?" />
            <button className="ask-send" type="submit" aria-label="Спросить"><ArrowUp size={18} /></button>
          </form>

          <div className="chat-suggest">
            {SUGGEST.map((s) => { const Icon = s.icon; return (
              <button key={s.label} className="chat-sug" onClick={() => send(s.q)}>
                <Icon size={15} /><span>{s.label}</span>
              </button>
            ); })}
          </div>
        </div>
      ) : (
        <>
          <div className="chat-thread">
            <div className="chat-thread-inner">
              {chatLog.map((m, i) => m.who === 'u' ? (
                <div className="chat-msg u" key={i}>{m.text}</div>
              ) : (
                <div className="chat-msg n" key={i}>
                  <div className="ava"><Sparkles size={15} /></div>
                  <div className="body">
                    {m.pending ? (
                      <div className="typing"><span /><span /><span /></div>
                    ) : m.run ? <AgentRun label={m.run} /> : <div className="prose"><Md text={m.text} /></div>}
                    {m.data && <DataBlock kind={m.data} />}
                    {m.nav && m.nav.length > 0 && <NavChips nav={m.nav} />}
                    {m.action && (
                      <div className="chat-act">
                        <button className="btn btn-sm btn-primary" onClick={() => runAction(m.action!)}><Sparkles size={13} />{m.action}</button>
                        <span className="dim" style={{ fontSize: 11.5 }}>NEX выполнит по шагам · с аудитом</span>
                      </div>
                    )}
                    {!m.run && !m.pending && (
                      <div className="msg-tools">
                        <button title="Скопировать" onClick={() => copy(m.text, i)}>{copied === i ? <Check size={13} /> : <Copy size={13} />}</button>
                        <button className={fb[i] === 'up' ? 'on' : ''} title="Хороший ответ" onClick={() => rate(i, 'up')}><ThumbsUp size={13} /></button>
                        <button className={fb[i] === 'down' ? 'on' : ''} title="Плохой ответ" onClick={() => rate(i, 'down')}><ThumbsDown size={13} /></button>
                        <button title="Ветка в новом чате" onClick={() => branch(m.text)}><GitBranch size={13} /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>

          <div className="chat-dock">
            <div className="chat-dock-inner">
              <button className="icon-btn" title="Новый чат" onClick={newChat}><Plus size={18} /></button>
              <form className="chat-input" onSubmit={submit}>
                <div className="chat-input-tools">
                  <button type="button" className="ci-tool" title="Прикрепить файл · бета" onClick={() => toast('Файлы — бета, скоро')}><Paperclip size={16} /></button>
                  <button type="button" className="ci-tool" title="Коннекторы · бета" onClick={() => toast('Коннекторы — бета, скоро')}><Boxes size={16} /></button>
                  <div className="ci-mention">
                    <button type="button" className="ci-tool" title="Добавить раздел в контекст (@)" onClick={() => setMentionOpen((v) => !v)}><AtSign size={16} /></button>
                    {mentionOpen && (
                      <div className="mention-pop">
                        <div className="mention-h">Подключить раздел</div>
                        {MENTIONS.map((m) => <button key={m} onClick={() => addMention(m)}><AtSign size={12} />{m}</button>)}
                      </div>
                    )}
                  </div>
                </div>
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Спросите NEX… ( @ — подключить раздел )" />
                <button className="ask-send" type="submit" aria-label="Спросить"><ArrowUp size={18} /></button>
              </form>
            </div>
            <div className="chat-dock-hint"><Users size={12} /> {llmReady() ? 'ИИ подключён — живые ответы' : 'Демо-режим · подключите ИИ в Настройках'} · файлы и коннекторы — в бете</div>
          </div>
        </>
      )}
    </div>
  );
}
