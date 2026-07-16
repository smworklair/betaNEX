import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Eraser } from 'lucide-react';
import { llmReady, llmAsk, llmAskStream, LlmStreamError, type LlmTurn } from '../features/ai/llm';
import { Md } from '../components/md';

/* ============================================================
   AiBox — встраиваемый мини-чат для раздела страницы.

   Вместо того чтобы каждая страница сама формулировала системный
   промпт строкой (как было раньше), она передаёт `page` — идентификатор
   раздела (тот же, что в web/src/nexbrain.ts:PAGE_TITLES) — и `facts` —
   короткие живые данные экрана. Роль ассистента для этого раздела
   ("ты — финансовый аналитик колледжа" и т.п.) достаётся с сервера, из
   ai-gateway/app/core/context_registry.py — так роль версионируется в
   одном месте, а не разбросана по компонентам.

   История диалога — своя на каждый `page` (sessionStorage), поэтому
   мини-чат в «Финансах» и мини-чат в «Приёме» не путают контекст между
   собой, даже если оба открыты в одной вкладке браузера.
   ============================================================ */

const HISTORY_LIMIT = 12; // последние ~6 пар вопрос-ответ — этого достаточно для мини-чата на странице

function historyKey(page: string): string {
  return `nex-ai-hist:${page}`;
}

function loadHistory(page: string): LlmTurn[] {
  try {
    const raw = sessionStorage.getItem(historyKey(page));
    return raw ? (JSON.parse(raw) as LlmTurn[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(page: string, turns: LlmTurn[]): void {
  try {
    sessionStorage.setItem(historyKey(page), JSON.stringify(turns.slice(-HISTORY_LIMIT)));
  } catch {
    /* приватный режим / квота — история просто не сохранится, не критично */
  }
}

export function AiBox({ title, placeholder, quick = [], page, facts, system, fallback }: {
  title: string;
  placeholder: string;
  quick?: string[];
  /** Идентификатор раздела для реестра контекста на сервере (см. шапку файла). */
  page: string;
  /** Короткие живые факты о текущем состоянии экрана — не системная роль, а данные. */
  facts?: string[];
  /** Явный оверрайд системного промпта — для случаев, не описанных в реестре разделов. */
  system?: string;
  fallback?: (q: string) => string;
}) {
  const [turns, setTurns] = useState<LlmTurn[]>(() => loadHistory(page));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // При переключении на другой раздел (другой page) — своя история.
  useEffect(() => { setTurns(loadHistory(page)); }, [page]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [turns]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setInput(''); setBusy(true);
    const history = turns;
    const withQuestion: LlmTurn[] = [...turns, { role: 'user', text: q }];
    setTurns(withQuestion);

    const finish = (answerText: string) => {
      const next: LlmTurn[] = [...withQuestion, { role: 'model', text: answerText }];
      setTurns(next);
      saveHistory(page, next);
      setBusy(false);
    };

    if (llmReady()) {
      // Стриминг: печатаем ответ по мере поступления кусков текста
      // (ai-gateway /api/v1/ai/stream через nexd) — заводим "живую"
      // последнюю запись в turns и дописываем в неё каждый onDelta.
      setTurns([...withQuestion, { role: 'model', text: '' }]);
      let streamed = '';
      try {
        const text = await llmAskStream(q, { history, system, context: { page, title, facts } }, (delta) => {
          streamed += delta;
          setTurns((cur) => {
            const next = cur.slice();
            next[next.length - 1] = { role: 'model', text: streamed };
            return next;
          });
        });
        const next: LlmTurn[] = [...withQuestion, { role: 'model', text: text }];
        setTurns(next);
        saveHistory(page, next);
        setBusy(false);
        return;
      } catch (err) {
        // Стрим не отдал вообще ничего (см. LlmStreamError) — откатываемся
        // на обычный не-стриминговый /ask, прежде чем сдаться на демо-мок.
        setTurns(withQuestion);
        if (err instanceof LlmStreamError) {
          try {
            const text = await llmAsk(q, { history, system, context: { page, title, facts } });
            finish(text);
            return;
          } catch { /* тихий откат на фолбэк ниже */ }
        }
      }
    }
    finish(fallback ? fallback(q) : 'Демо-режим. Настройте ai-gateway (см. ai-gateway/README.md), чтобы получить живой ответ.');
  };

  const clear = () => { setTurns([]); saveHistory(page, []); };

  return (
    <div className="card ai-box" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div className="card-title"><span className="ai-orb"><Sparkles size={13} /></span> {title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {turns.length > 0 && <button className="icon-btn" title="Очистить историю раздела" onClick={clear}><Eraser size={14} /></button>}
          <span className="dim" style={{ fontSize: 12 }}>{llmReady() ? 'ИИ' : 'демо'}</span>
        </div>
      </div>
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
        {turns.length > 0 && (
          <div className="ai-box-thread" style={{ marginTop: 12 }}>
            {turns.map((t, i) => t.role === 'user'
              ? <div className="ai-box-question" key={i}>{t.text}</div>
              : <div className="ai-box-answer" key={i}><Md text={t.text} /></div>)}
            <div ref={endRef} />
          </div>
        )}
        {busy && !turns[turns.length - 1]?.text && <div className="typing" style={{ marginTop: 12 }}><span /><span /><span /></div>}
      </div>
    </div>
  );
}
