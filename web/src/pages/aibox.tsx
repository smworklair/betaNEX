import { useState } from 'react';
import { Sparkles, ArrowUp } from 'lucide-react';
import { llmReady, llmAsk } from '../llm';
import { Md } from '../md';

/* ============================================================
   AiBox — встраиваемый ИИ-помощник для любой страницы.
   Живой ответ через активного провайдера (Настройки → Интеллект),
   иначе — переданный фолбэк. Один компонент на все разделы.
   ============================================================ */
export function AiBox({ title, placeholder, quick = [], system, fallback }: {
  title: string;
  placeholder: string;
  quick?: string[];
  system?: string;
  fallback?: (q: string) => string;
}) {
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setInput(''); setBusy(true); setAnswer(null);
    if (llmReady()) {
      try { const t = await llmAsk(q, system ? { system } : {}); setAnswer(t); setBusy(false); return; }
      catch { /* тихий откат на фолбэк ниже */ }
    }
    setAnswer(fallback ? fallback(q) : 'Демо-режим. Подключите ИИ в Настройках → Интеллект, чтобы получить живой ответ.');
    setBusy(false);
  };

  return (
    <div className="card ai-box" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> {title}</div>
        <span className="dim" style={{ fontSize: 12 }}>{llmReady() ? 'ИИ' : 'демо'}</span></div>
      <div className="card-body">
        {quick.length > 0 && (
          <div className="ai-box-quick">
            {quick.map((q) => <button key={q} className="chip-btn sm" onClick={() => ask(q)}><Sparkles size={11} className="ic" />{q}</button>)}
          </div>
        )}
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }} style={{ marginTop: quick.length ? 10 : 0 }}>
          <Sparkles size={16} className="lead" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} />
          <button className="ask-send" type="submit" aria-label="Спросить"><ArrowUp size={17} /></button>
        </form>
        {busy && <div className="typing" style={{ marginTop: 12 }}><span /><span /><span /></div>}
        {answer && !busy && <div className="ai-box-answer"><Md text={answer} /></div>}
      </div>
    </div>
  );
}
