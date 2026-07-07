import { useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Heart, MessageCircle, Pin, Send, Sparkles, Search, Megaphone, Users2, Wand2,
  Image as ImageIcon, Paperclip, Mic, Smile, ChevronDown, ArrowLeft, MessageSquare,
  Inbox, Star, Archive, Reply, Forward, Pencil, X, Trash2, MoreHorizontal, Phone, Video,
  Maximize2, Minimize2, Plus,
} from 'lucide-react';
import { PageHead, Avatar, useApp, useIsMobile } from '../ui';
import {
  posts, postComments, chats, thread, threads, groups, emails, MAIL_FOLDERS,
  type PostKind, type MailFolder, type Email,
} from '../data';

const KIND_STYLE: Record<PostKind, { bg: string; fg: string }> = {
  official: { bg: 'var(--danger-weak)', fg: 'var(--danger)' },
  teacher: { bg: 'var(--info-weak)', fg: 'var(--info)' },
  club: { bg: 'var(--ai-weak)', fg: 'var(--ai)' },
  service: { bg: 'var(--success-weak)', fg: 'var(--success)' },
};
const FILTERS: { id: 'all' | PostKind; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'official', label: 'Официально' },
  { id: 'teacher', label: 'Преподаватели' },
  { id: 'club', label: 'Сообщество' },
];

/* ============================ Лента · Сообщество (соцсеть колледжа) ============================ */
export function Community() {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | PostKind>('all');
  const list = posts.filter((p) => filter === 'all' || p.kind === filter);

  return (
    <div className="fade content-narrow" style={{ maxWidth: 680 }}>
      <PageHead title="Сообщество" sub="Общая лента колледжа — объявления, преподаватели, студсовет" />

      <div className="composer">
        <Avatar name="Вы" />
        <div style={{ flex: 1 }}>
          <textarea className="composer-input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Поделитесь новостью или объявлением…" />
          <div className="composer-foot">
            <div className="composer-tools">
              <button className="icon-btn" title="Фото (в разработке)" onClick={() => toast('Фото — в разработке')}><ImageIcon size={17} /></button>
              <button className="icon-btn" title="Файл (в разработке)" onClick={() => toast('Файл — в разработке')}><Paperclip size={17} /></button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => { if (text.trim()) { toast('Опубликовано'); setText(''); } }}><Send size={14} />Опубликовать</button>
          </div>
        </div>
      </div>

      <div className="feed-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`feed-filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((p) => {
          const style = KIND_STYLE[p.kind];
          const comments = postComments[p.id] || [];
          const isOpen = open[p.id];
          return (
            <article className={`post-card ${p.pinned ? 'pinned' : ''}`} key={p.id}>
              {p.pinned && <div className="post-pinned-strip"><Pin size={12} /> Закреплено</div>}
              <div className="post-card-head">
                <span className="post-ava" style={{ background: style.bg, color: style.fg }}>{p.author[0]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="post-author">{p.author}</div>
                  <div className="post-meta"><span className="post-role" style={{ background: style.bg, color: style.fg }}>{p.role}</span><span className="dim">· {p.time}</span></div>
                </div>
              </div>
              <div className="post-text">{p.text}</div>
              <div className="post-actions">
                <button className={`post-btn ${liked[p.id] ? 'on' : ''}`} onClick={() => setLiked((l) => ({ ...l, [p.id]: !l[p.id] }))}>
                  <Heart size={16} fill={liked[p.id] ? 'currentColor' : 'none'} /> {p.likes + (liked[p.id] ? 1 : 0)}
                </button>
                <button className="post-btn" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                  <MessageCircle size={16} /> {p.comments}
                </button>
              </div>
              {isOpen && (
                <div className="post-comments">
                  {comments.map((c, i) => (
                    <div className="post-comment" key={i}>
                      <Avatar name={c.author} />
                      <div><b>{c.author}</b> {c.text}<div className="dim" style={{ fontSize: 11 }}>{c.time}</div></div>
                    </div>
                  ))}
                  <div className="post-comment-add">
                    <Avatar name="Вы" />
                    <input placeholder="Написать комментарий…" onKeyDown={(e) => { if (e.key === 'Enter') toast('Комментарий добавлен'); }} />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ Лента · Сообщения ============================
   Полноэкранный мессенджер. На десктопе — переключатель «Чат / Почта»:
   почта разворачивается в полноценный почтовый клиент. На мобайле —
   список чатов, а выбранный чат открывается на весь экран с кнопкой «назад». */

/* ---- шапка чата: конспект от NEX, звонки ---- */
function ConvHeader({ name, role, isGroup, onBack }: { name: string; role: string; isGroup: boolean; onBack?: () => void }) {
  const { toast } = useApp();
  return (
    <div className="msgr2-conv-head">
      {onBack && <button className="icon-btn msgr2-back" onClick={onBack} aria-label="Назад"><ArrowLeft size={20} /></button>}
      <span className="msgr2-ava">{isGroup ? <Users2 size={17} /> : name[0]}</span>
      <div className="msgr2-conv-id"><b>{name}</b><div className="dim" style={{ fontSize: 12 }}>{isGroup ? role : 'в сети'}</div></div>
      <div className="msgr2-conv-tools">
        <button className="icon-btn" onClick={() => toast('Звонок — в разработке')} aria-label="Позвонить"><Phone size={17} /></button>
        <button className="icon-btn" onClick={() => toast('Видеозвонок — в разработке')} aria-label="Видео"><Video size={17} /></button>
        <button className="btn btn-sm btn-outline msgr2-recap" onClick={() => toast('NEX: за сегодня обсудили перенос консультации на понедельник 12:00')}>
          <Sparkles size={14} /><span>Пересказать</span>
        </button>
      </div>
    </div>
  );
}

/* ---- лента сообщений + строка ввода (общая для десктопа и мобайла) ---- */
function ConvBody({ chatId }: { chatId: string }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState('');
  const [tools, setTools] = useState(false);
  const msgs = threads[chatId] || thread;

  return (
    <>
      <div className="msgr2-body">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble2 ${m.me ? 'me' : ''}`}>{m.text}<span className="bubble2-time">{m.time}</span></div>
        ))}
      </div>
      {tools && (
        <div className="msgr2-tools-row">
          <button className="msgr2-tool" onClick={() => toast('Фото — бета, скоро заработает')}><ImageIcon size={16} />Фото</button>
          <button className="msgr2-tool" onClick={() => toast('Файл — бета, скоро заработает')}><Paperclip size={16} />Файл</button>
          <button className="msgr2-tool" onClick={() => toast('Голосовое — бета, скоро заработает')}><Mic size={16} />Голосовое</button>
          <span className="beta-badge">beta</span>
        </div>
      )}
      <div className="msgr2-input">
        <button className={`icon-btn ${tools ? 'on' : ''}`} onClick={() => setTools((v) => !v)} title="Вложения"><Paperclip size={17} /></button>
        <button className="icon-btn" onClick={() => toast('NEX предложил ответ')} title="Составить ответ с NEX"><Wand2 size={17} /></button>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Сообщение…"
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { toast('Отправлено'); setDraft(''); } }} />
        <button className="icon-btn" title="Эмодзи (в разработке)" onClick={() => toast('Эмодзи — в разработке')}><Smile size={17} /></button>
        <button className="ask-send sm" onClick={() => { if (draft.trim()) { toast('Отправлено'); setDraft(''); } }}><Send size={16} /></button>
      </div>
    </>
  );
}

/* ---- список чатов (с прокруткой и слотом внизу для переключателя) ---- */
function ChatList({ active, onPick, footer }: { active: string | null; onPick: (id: string) => void; footer?: ReactNode }) {
  const [q, setQ] = useState('');
  const list = chats.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="msgr2-list">
      <div className="msgr2-search"><Search size={15} /><input placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="msgr2-list-scroll">
        {list.map((c) => (
          <button key={c.id} className={`msgr2-item ${active === c.id ? 'on' : ''}`} onClick={() => onPick(c.id)}>
            <span className="msgr2-ava">{c.kind === 'group' ? <Users2 size={17} /> : c.name[0]}</span>
            <div className="msgr2-main">
              <div className="msgr2-top"><b>{c.name}</b><span className="dim">{c.time}</span></div>
              <div className="msgr2-last">{c.last}</div>
            </div>
            {c.unread > 0 && <span className="msgr2-badge">{c.unread}</span>}
          </button>
        ))}
        {list.length === 0 && <div className="dim" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>Ничего не найдено</div>}
      </div>
      {footer}
    </div>
  );
}

/* ---- переключатель Чат / Почта (живёт внизу левой колонки) ---- */
function ModeToggle({ mode, setMode }: { mode: 'chat' | 'mail'; setMode: (m: 'chat' | 'mail') => void }) {
  return (
    <div className="msgr-mode">
      <div className="seg msgr-mode-seg">
        <button className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}><MessageSquare size={14} />Чат</button>
        <button className={mode === 'mail' ? 'on' : ''} onClick={() => setMode('mail')}><Inbox size={14} />Почта</button>
      </div>
    </div>
  );
}

/* ---- десктоп: мессенджер на весь экран, две колонки ---- */
function DesktopMessenger({ mode, setMode }: { mode: 'chat' | 'mail'; setMode: (m: 'chat' | 'mail') => void }) {
  const [active, setActive] = useState(chats[0].id);
  const chat = chats.find((c) => c.id === active)!;
  return (
    <div className="msgr2 full">
      <ChatList active={active} onPick={setActive} footer={<ModeToggle mode={mode} setMode={setMode} />} />
      <div className="msgr2-conv">
        <ConvHeader name={chat.name} role={chat.role} isGroup={chat.kind === 'group'} />
        <ConvBody chatId={active} />
      </div>
    </div>
  );
}

/* ---- мобайл: список на весь экран → выбранный чат оверлеем с «назад» ---- */
function MobileMessenger() {
  const [active, setActive] = useState<string | null>(null);
  const chat = active ? chats.find((c) => c.id === active)! : null;
  return (
    <div className="msgr-m">
      <ChatList active={active} onPick={setActive} />
      {chat && (
        <div className="msgr-m-conv">
          <ConvHeader name={chat.name} role={chat.role} isGroup={chat.kind === 'group'} onBack={() => setActive(null)} />
          <ConvBody chatId={chat.id} />
        </div>
      )}
    </div>
  );
}

/* ---- десктоп: почтовый клиент (все фичи почты) ---- */
function MailClient({ mode, setMode }: { mode: 'chat' | 'mail'; setMode: (m: 'chat' | 'mail') => void }) {
  const { toast } = useApp();
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [q, setQ] = useState('');
  const [starred, setStarred] = useState<Record<string, boolean>>(
    () => Object.fromEntries(emails.filter((e) => e.starred).map((e) => [e.id, true])),
  );

  const list = emails
    .filter((e) => e.folder === folder)
    .filter((e) => (e.subject + e.from + e.preview).toLowerCase().includes(q.toLowerCase()));
  const open = openId ? emails.find((e) => e.id === openId) : null;
  const unreadInbox = emails.filter((e) => e.folder === 'inbox' && e.unread).length;

  const toggleStar = (id: string) => setStarred((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div className="mailc">
      <div className="mailc-rail">
        <button className="btn btn-primary mailc-compose" onClick={() => setCompose(true)}><Pencil size={15} />Написать</button>
        {MAIL_FOLDERS.map((f) => {
          const Icon = f.id === 'inbox' ? Inbox : f.id === 'sent' ? Send : f.id === 'drafts' ? Pencil : Archive;
          const count = f.id === 'inbox' ? unreadInbox : 0;
          return (
            <button key={f.id} className={`mailc-folder ${folder === f.id ? 'on' : ''}`} onClick={() => { setFolder(f.id); setOpenId(null); }}>
              <Icon size={16} /><span>{f.label}</span>{count > 0 && <span className="msgr2-badge">{count}</span>}
            </button>
          );
        })}
        <div className="mailc-rail-sep" />
        <button className="mailc-folder" onClick={() => toast('Корзина пуста')}><Trash2 size={16} /><span>Корзина</span></button>
        <ModeToggle mode={mode} setMode={setMode} />
      </div>

      <div className="mailc-list">
        <div className="msgr2-search"><Search size={15} /><input placeholder="Поиск в почте" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="mailc-list-scroll">
          {list.map((e) => (
            <button key={e.id} className={`mailc-item ${openId === e.id ? 'on' : ''} ${e.unread ? 'unread' : ''}`} onClick={() => setOpenId(e.id)}>
              <span className="mailc-star" onClick={(ev) => { ev.stopPropagation(); toggleStar(e.id); }}>
                <Star size={15} fill={starred[e.id] ? 'currentColor' : 'none'} className={starred[e.id] ? 'on' : ''} />
              </span>
              <div className="mailc-item-main">
                <div className="mailc-item-top"><b>{folder === 'sent' || folder === 'drafts' ? e.to : e.from}</b><span className="dim">{e.time}</span></div>
                <div className="mailc-item-subj">{e.subject}</div>
                <div className="mailc-item-prev">{e.preview}</div>
              </div>
              {e.attachments && <Paperclip size={13} className="mailc-clip" />}
            </button>
          ))}
          {list.length === 0 && <div className="dim" style={{ padding: 30, textAlign: 'center', fontSize: 13 }}>Папка пуста</div>}
        </div>
      </div>

      <div className="mailc-read">
        {open ? (
          <>
            <div className="mailc-read-head">
              <div className="mailc-read-subj">{open.subject}</div>
              <div className="mailc-read-tools">
                <button className="icon-btn" onClick={() => toggleStar(open.id)} aria-label="В избранное"><Star size={17} fill={starred[open.id] ? 'currentColor' : 'none'} /></button>
                <button className="icon-btn" onClick={() => toast('Письмо в архиве')} aria-label="Архивировать"><Archive size={17} /></button>
                <button className="icon-btn" onClick={() => { toast('Письмо удалено'); setOpenId(null); }} aria-label="Удалить"><Trash2 size={17} /></button>
                <button className="icon-btn" onClick={() => toast('Ещё — в разработке')} aria-label="Ещё"><MoreHorizontal size={17} /></button>
              </div>
            </div>
            <div className="mailc-read-from">
              <span className="msgr2-ava">{open.from[0]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><b>{open.from}</b> <span className="dim">&lt;{open.fromRole}&gt;</span></div>
                <div className="dim" style={{ fontSize: 12 }}>кому: {open.to} · {open.date}, {open.time}</div>
              </div>
              <button className="nex-ask-chip" onClick={() => toast('NEX: письмо о совещании в четверг, нужна сводка по направлению к 14:00')}><Sparkles size={12} />Кратко</button>
            </div>
            <div className="mailc-read-body">{open.body}</div>
            {open.attachments && (
              <div className="mailc-attach">
                {open.attachments.map((a) => (
                  <button key={a} className="mailc-att" onClick={() => toast('Загрузка вложения — в разработке')}><Paperclip size={14} />{a}</button>
                ))}
              </div>
            )}
            <div className="mailc-read-actions">
              <button className="btn btn-primary btn-sm" onClick={() => { setCompose(true); }}><Reply size={14} />Ответить</button>
              <button className="btn btn-outline btn-sm" onClick={() => setCompose(true)}><Forward size={14} />Переслать</button>
            </div>
          </>
        ) : (
          <div className="mailc-empty">
            <Inbox size={40} strokeWidth={1.4} />
            <div>Выберите письмо, чтобы прочитать</div>
          </div>
        )}
      </div>

      {compose && <MailCompose replyTo={open} onClose={() => setCompose(false)} />}
    </div>
  );
}

/* ---- окно написания письма ---- */
function MailCompose({ replyTo, onClose }: { replyTo: Email | null; onClose: () => void }) {
  const { toast } = useApp();
  const [to, setTo] = useState(replyTo ? replyTo.from : '');
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : '');
  const [body, setBody] = useState('');
  const send = () => { if (to.trim() && subject.trim()) { toast('Письмо отправлено'); onClose(); } else { toast('Заполните получателя и тему'); } };
  const draftAi = () => setBody('Добрый день!\n\nБлагодарю за письмо. Подготовлю необходимые материалы и вернусь с ответом в ближайшее время.\n\nС уважением');
  return (
    <div className="mailc-compose-veil" onClick={onClose}>
      <div className="mailc-compose-win" onClick={(e) => e.stopPropagation()}>
        <div className="mailc-compose-head">
          <b>Новое письмо</b>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <input className="mailc-compose-field" placeholder="Кому" value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="mailc-compose-field" placeholder="Тема" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="mailc-compose-body" placeholder="Текст письма…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mailc-compose-foot">
          <button className="btn btn-primary" onClick={send}><Send size={15} />Отправить</button>
          <button className="nex-ask-chip" onClick={draftAi}><Sparkles size={12} />Составить с NEX</button>
          <button className="icon-btn" onClick={() => toast('Вложение — в разработке')} style={{ marginLeft: 'auto' }} aria-label="Вложить"><Paperclip size={17} /></button>
          <button className="icon-btn" onClick={() => { toast('Черновик сохранён'); onClose(); }} aria-label="Удалить"><Trash2 size={17} /></button>
        </div>
      </div>
    </div>
  );
}

export function Mail() {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<'chat' | 'mail'>('chat');
  const [fs, setFs] = useState(false);

  /* Esc выходит из полноэкранного режима */
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFs(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fs]);

  if (isMobile) return <MobileMessenger />;

  const content = (
    <div className={`msgr-page ${fs ? 'msgr-fs' : ''}`}>
      <div className="msgr-page-bar">
        <div className="msgr-page-bar-l">
          <MessageSquare size={17} className="msgr-page-bar-ico" />
          <b>Сообщения</b>
          <div className="seg msgr-bar-seg">
            <button className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}><MessageSquare size={13} />Чат</button>
            <button className={mode === 'mail' ? 'on' : ''} onClick={() => setMode('mail')}><Inbox size={13} />Почта</button>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setFs((v) => !v)} title={fs ? 'Свернуть (Esc)' : 'Во весь экран'} aria-label="Полноэкранный режим">
          {fs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      <div className="msgr-page-body">
        {mode === 'chat' ? <DesktopMessenger mode={mode} setMode={setMode} /> : <MailClient mode={mode} setMode={setMode} />}
      </div>
    </div>
  );

  /* полноэкранный режим выносим порталом в body — иначе backdrop-filter сцены
     ограничивает position:fixed рамкой контента */
  return fs ? createPortal(<div className="msgr-fs-veil">{content}</div>, document.body) : content;
}

/* ============================ Мини-мессенджер (боковой вылет) ============================
   Плавающая кнопка справа. По нажатию выезжает компактная панель с чатом и почтой —
   не покидая текущий экран. Кнопка «во весь экран» открывает полный мессенджер. */
export function MiniMessenger() {
  const { setPage, page, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'chat' | 'mail'>('chat');
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [openMail, setOpenMail] = useState<string | null>(null);

  const unreadChats = chats.reduce((n, c) => n + c.unread, 0);
  const unreadMail = emails.filter((e) => e.folder === 'inbox' && e.unread).length;
  const unread = unreadChats + unreadMail;

  const chat = activeChat ? chats.find((c) => c.id === activeChat) ?? null : null;
  const inbox = emails.filter((e) => e.folder === 'inbox');
  const mail = openMail ? emails.find((e) => e.id === openMail) ?? null : null;

  const goFull = () => { setOpen(false); setPage('mail'); };

  return (
    <>
      {!open && (
        <button className="mini-fab" onClick={() => setOpen(true)} aria-label="Открыть мессенджер" title="Мессенджер и почта">
          <MessageSquare size={22} />
          {unread > 0 && <span className="mini-fab-badge">{unread}</span>}
        </button>
      )}

      {open && (
        <div className="mini-msgr">
          <div className="mini-head">
            <div className="seg mini-seg">
              <button className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}>
                <MessageSquare size={13} />Чат{unreadChats > 0 && <span className="mini-seg-dot">{unreadChats}</span>}
              </button>
              <button className={mode === 'mail' ? 'on' : ''} onClick={() => setMode('mail')}>
                <Inbox size={13} />Почта{unreadMail > 0 && <span className="mini-seg-dot">{unreadMail}</span>}
              </button>
            </div>
            <div className="mini-head-tools">
              <button className="icon-btn" onClick={goFull} title="Во весь экран" aria-label="Открыть полностью"><Maximize2 size={16} /></button>
              <button className="icon-btn" onClick={() => setOpen(false)} title="Свернуть" aria-label="Свернуть"><X size={17} /></button>
            </div>
          </div>

          <div className="mini-body">
            {mode === 'chat' ? (
              chat ? (
                <div className="mini-conv">
                  <div className="mini-conv-head">
                    <button className="icon-btn" onClick={() => setActiveChat(null)} aria-label="Назад"><ArrowLeft size={18} /></button>
                    <span className="msgr2-ava sm">{chat.kind === 'group' ? <Users2 size={15} /> : chat.name[0]}</span>
                    <div className="mini-conv-id"><b>{chat.name}</b><span className="dim">{chat.kind === 'group' ? chat.role : 'в сети'}</span></div>
                    <button className="icon-btn" onClick={() => toast('NEX: обсуждали перенос консультации на понедельник 12:00')} title="Пересказать с NEX" aria-label="Пересказать"><Sparkles size={15} /></button>
                  </div>
                  <ConvBody chatId={chat.id} />
                </div>
              ) : (
                <div className="mini-list">
                  {chats.map((c) => (
                    <button key={c.id} className="mini-item" onClick={() => setActiveChat(c.id)}>
                      <span className="msgr2-ava sm">{c.kind === 'group' ? <Users2 size={15} /> : c.name[0]}</span>
                      <div className="mini-item-main">
                        <div className="mini-item-top"><b>{c.name}</b><span className="dim">{c.time}</span></div>
                        <div className="mini-item-last">{c.last}</div>
                      </div>
                      {c.unread > 0 && <span className="msgr2-badge">{c.unread}</span>}
                    </button>
                  ))}
                </div>
              )
            ) : (
              mail ? (
                <div className="mini-mail-read">
                  <div className="mini-conv-head">
                    <button className="icon-btn" onClick={() => setOpenMail(null)} aria-label="Назад"><ArrowLeft size={18} /></button>
                    <div className="mini-conv-id"><b>{mail.from}</b><span className="dim">{mail.date}, {mail.time}</span></div>
                    <button className="icon-btn" onClick={() => toast('NEX: краткое содержание письма готово')} title="Кратко с NEX" aria-label="Кратко"><Sparkles size={15} /></button>
                  </div>
                  <div className="mini-mail-subj">{mail.subject}</div>
                  <div className="mini-mail-body">{mail.body}</div>
                  <div className="mini-mail-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => { toast('Ответ отправлен'); }}><Reply size={13} />Ответить</button>
                    <button className="btn btn-sm btn-outline" onClick={goFull}><Maximize2 size={13} />Открыть в почте</button>
                  </div>
                </div>
              ) : (
                <div className="mini-list">
                  {inbox.map((e) => (
                    <button key={e.id} className={`mini-item ${e.unread ? 'unread' : ''}`} onClick={() => setOpenMail(e.id)}>
                      <span className="msgr2-ava sm">{e.from[0]}</span>
                      <div className="mini-item-main">
                        <div className="mini-item-top"><b>{e.from}</b><span className="dim">{e.time}</span></div>
                        <div className="mini-item-subj">{e.subject}</div>
                        <div className="mini-item-last">{e.preview}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="mini-foot">
            {mode === 'chat'
              ? <button className="btn btn-sm btn-ghost" onClick={() => toast('Новый чат — в разработке')}><Plus size={14} />Новый чат</button>
              : <button className="btn btn-sm btn-ghost" onClick={goFull}><Pencil size={14} />Написать письмо</button>}
            <button className="mini-full-link" onClick={goFull}>Открыть мессенджер{page === 'mail' ? ' целиком' : ''} <Maximize2 size={12} /></button>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================ Лента · Рассылка (отдельно от личных чатов) ============================ */
export function Broadcast() {
  const { toast } = useApp();
  const [sel, setSel] = useState<string[]>([groups[0].name]);
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const toggle = (g: string) => setSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]));
  const draftAi = () => setText('Уважаемые студенты! Напоминаем: экзамен по базам данных — 11 июля, 09:00, аудитория 305. Просьба не опаздывать и иметь при себе зачётные книжки.');
  const reach = sel.length * 25;

  return (
    <div className="fade content-narrow" style={{ maxWidth: 720 }}>
      <PageHead title="Рассылка" sub="Официальные сообщения студентам и преподавателям" />
      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Megaphone size={14} /> Административный канал</div>
        <div className="ai-body">Отдельно от личных чатов — для официальных объявлений по группам. NEX поможет составить текст.</div>
      </div>
      <div className="card"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label className="field-label">Кому</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {groups.map((g) => (
              <button key={g.id} className={`int-chip ${sel.includes(g.name) ? 'on' : ''}`} onClick={() => toggle(g.name)}>{g.name}</button>
            ))}
            <button className={`int-chip ${sel.includes('Преподаватели') ? 'on' : ''}`} onClick={() => toggle('Преподаватели')}>Преподаватели</button>
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="field-label" style={{ margin: 0 }}>Текст сообщения</label>
            <button className="nex-ask-chip" onClick={draftAi}><Sparkles size={12} /> Составить с NEX</button>
          </div>
          <textarea className="input" style={{ height: 120, padding: 12, resize: 'none' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: напоминание об экзамене, изменение расписания…" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => { if (text.trim() && sel.length) toast(`Рассылка отправлена — охват ~${reach} чел.`); }}><Send size={15} />Отправить рассылку</button>
          <span className="muted" style={{ fontSize: 13 }}>Охват ~{reach} человек</span>
        </div>
      </div></div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setShowAll((v) => !v)}>
        <ChevronDown size={14} style={{ transform: showAll ? 'rotate(180deg)' : 'none' }} />История рассылок
      </button>
      {showAll && (
        <div className="card" style={{ marginTop: 10 }}><div className="row-list">
          <div className="feed-row"><div className="feed-main"><div className="t">Расписание сессии опубликовано</div><div className="m">Всем группам · 2 ч назад</div></div></div>
          <div className="feed-row"><div className="feed-main"><div className="t">Напоминание об оплате</div><div className="m">8 студентов · вчера</div></div></div>
        </div></div>
      )}
    </div>
  );
}
