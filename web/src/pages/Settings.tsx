import { useState, type ReactNode } from 'react';
import { Sun, Moon, ShieldCheck, KeyRound, Sparkles, LogOut, PanelLeft, PanelTop, Bot, Palette, Check, Plus, Smartphone, Search, X as XIcon, LayoutDashboard, Settings2 } from 'lucide-react';
import { PageHead, Chip, Avatar, Soon, Beta, useApp, type Prefs } from '../ui';
import { DOCK_CATALOG, DEFAULT_DOCK, DOCK_MIN, DOCK_MAX, TOPBAR_CATALOG, DEFAULT_TOPBAR, TOPBAR_MIN } from '../dock';
import { HOME_BLOCK_CATALOG, DEFAULT_HOME_BLOCKS } from '../home';
import { roleLabel } from '../data';
import {
  getProvider, setProvider, getGeminiKey, setGeminiKey,
  getCustomKey, setCustomKey, getCustomUrl, setCustomUrl, getCustomModel, setCustomModel,
  testLlmKey, llmReady, CUSTOM_DEFAULT_URL, CUSTOM_DEFAULT_MODEL, type LlmProvider,
} from '../llm';

const ACCENTS: { id: Prefs['accent']; name: string; color: string }[] = [
  { id: 'blue', name: 'Синий', color: '#007aff' },
  { id: 'violet', name: 'Фиолетовый', color: '#af52de' },
  { id: 'green', name: 'Зелёный', color: '#34c759' },
  { id: 'orange', name: 'Оранжевый', color: '#ff9500' },
  { id: 'rose', name: 'Розовый', color: '#ff2d55' },
  { id: 'graphite', name: 'Графит', color: '#636366' },
];

/* строка-настройка с сегментом Вкл/Выкл или вариантами */
function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="card-body set-row">
      <div><div style={{ fontWeight: 600 }}>{title}</div><div className="muted" style={{ fontSize: 13 }}>{desc}</div></div>
      {children}
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme, user, setUser, sidebarEnabled, setSidebarEnabled, pulseEnabled, setPulseEnabled, prefs, setPref, setPage, setHomeEditing, openChat, toast } = useApp();
  /* --- Интеллект: выбор провайдера + ключи --- */
  const [provider, setProviderState] = useState<LlmProvider>(getProvider());
  const [key, setKey] = useState(provider === 'custom' ? getCustomKey() : getGeminiKey());
  const [customUrl, setCustomUrlState] = useState(getCustomUrl());
  const [customModel, setCustomModelState] = useState(getCustomModel());
  const [keyState, setKeyState] = useState<'idle' | 'checking' | 'ok' | 'bad'>(llmReady() ? 'ok' : 'idle');

  const switchProvider = (p: LlmProvider) => {
    setProviderState(p);
    setProvider(p);
    setKey(p === 'custom' ? getCustomKey() : getGeminiKey());
    setKeyState(llmReady() ? 'ok' : 'idle');
  };

  const saveKey = async () => {
    if (!key.trim()) {
      if (provider === 'custom') setCustomKey(''); else setGeminiKey('');
      setKeyState('idle'); toast('Ключ удалён — NEX в демо-режиме'); return;
    }
    setKeyState('checking');
    const ok = await testLlmKey(provider, key, customUrl, customModel);
    if (ok) {
      if (provider === 'custom') { setCustomKey(key); setCustomUrl(customUrl || CUSTOM_DEFAULT_URL); setCustomModel(customModel || CUSTOM_DEFAULT_MODEL); }
      else setGeminiKey(key);
      setKeyState('ok'); toast('Подключено — NEX отвечает живой моделью');
    } else { setKeyState('bad'); toast('Ключ не прошёл проверку'); }
  };

  /* ---- настройка нижнего докбара (мобайл) ---- */
  const dock = prefs.dock && prefs.dock.length ? prefs.dock : DEFAULT_DOCK;
  const toggleDock = (id: string) => {
    if (dock.includes(id)) {
      if (dock.length <= DOCK_MIN) { toast(`Оставьте минимум ${DOCK_MIN} кнопки`); return; }
      setPref('dock', dock.filter((x) => x !== id));
    } else {
      if (dock.length >= DOCK_MAX) { toast(`В докбаре максимум ${DOCK_MAX} кнопок`); return; }
      setPref('dock', DOCK_CATALOG.filter((d) => dock.includes(d.id) || d.id === id).map((d) => d.id));
    }
  };

  /* ---- настройка верхней панели (десктоп): скрытые разделы остаются в поиске ---- */
  const topbar = prefs.topbar && prefs.topbar.length ? prefs.topbar : DEFAULT_TOPBAR;
  const toggleTop = (id: string) => {
    if (topbar.includes(id)) {
      if (topbar.length <= TOPBAR_MIN) { toast(`Оставьте минимум ${TOPBAR_MIN} раздела`); return; }
      setPref('topbar', topbar.filter((x) => x !== id));
    } else {
      setPref('topbar', TOPBAR_CATALOG.filter((t) => topbar.includes(t.id) || t.id === id).map((t) => t.id));
    }
  };

  /* ---- конструктор главного экрана: какие блоки показывать ---- */
  const homeBlocks = prefs.homeBlocks && prefs.homeBlocks.length ? prefs.homeBlocks : DEFAULT_HOME_BLOCKS;
  const toggleHomeBlock = (id: string) => {
    if (homeBlocks.includes(id)) setPref('homeBlocks', homeBlocks.filter((x) => x !== id));
    else setPref('homeBlocks', HOME_BLOCK_CATALOG.filter((b) => homeBlocks.includes(b.id) || b.id === id).map((b) => b.id));
  };
  const openHomeBuilder = () => { setHomeEditing(true); setPage('home'); toast('Открыт конструктор главного экрана'); };

  return (
    <div className="fade content-narrow" style={{ maxWidth: 760 }}>
      <PageHead title="Настройки" sub="Профиль, оформление и безопасность" />

      {/* Profile */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title">Профиль</div></div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={user?.name || ''} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{user?.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>{user ? roleLabel[user.role] : ''}</div>
          </div>
          <button className="btn btn-outline" onClick={() => setUser(null)}><LogOut size={15} />Выйти</button>
        </div>
      </div>

      {/* Appearance — theme toggle lives here, not in the main UI */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title">Оформление</div></div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Тема интерфейса</div>
            <div className="muted" style={{ fontSize: 13 }}>Светлая по умолчанию, тёмная — для режима мониторинга</div>
          </div>
          <div className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}><Sun size={14} style={{ marginRight: 6 }} />Светлая</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}><Moon size={14} style={{ marginRight: 6 }} />Тёмная</button>
          </div>
        </div>
      </div>

      {/* ---- Персонализация: цвет, плотность, шрифт, углы, полоса NEX ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><Palette size={15} /> Персонализация</div></div>
        <Row title="Цвет акцента" desc="Кнопки, ссылки, активные элементы">
          <div className="accent-row">
            {ACCENTS.map((a) => (
              <button key={a.id} className={`accent-swatch ${prefs.accent === a.id ? 'on' : ''}`} style={{ background: a.color }}
                title={a.name} onClick={() => setPref('accent', a.id)}>
                {prefs.accent === a.id && <Check size={13} />}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Плотность" desc="Компактный режим — больше данных на экране">
          <div className="seg">
            <button className={prefs.density === 'normal' ? 'on' : ''} onClick={() => setPref('density', 'normal')}>Обычная</button>
            <button className={prefs.density === 'compact' ? 'on' : ''} onClick={() => setPref('density', 'compact')}>Компактная</button>
          </div>
        </Row>
        <Row title="Размер текста" desc="Крупный — легче читать с расстояния">
          <div className="seg">
            <button className={prefs.font === 'normal' ? 'on' : ''} onClick={() => setPref('font', 'normal')}>Обычный</button>
            <button className={prefs.font === 'large' ? 'on' : ''} onClick={() => setPref('font', 'large')}>Крупный</button>
          </div>
        </Row>
        <Row title="Скругления" desc="Мягкие углы или строгая геометрия">
          <div className="seg">
            <button className={prefs.corners === 'soft' ? 'on' : ''} onClick={() => setPref('corners', 'soft')}>Мягкие</button>
            <button className={prefs.corners === 'sharp' ? 'on' : ''} onClick={() => setPref('corners', 'sharp')}>Строгие</button>
          </div>
        </Row>
        <Row title="Полоса подсказок NEX" desc="Проактивная строка ИИ вверху страниц">
          <div className="seg">
            <button className={prefs.strip ? 'on' : ''} onClick={() => setPref('strip', true)}>Вкл</button>
            <button className={!prefs.strip ? 'on' : ''} onClick={() => setPref('strip', false)}>Выкл</button>
          </div>
        </Row>
        <Row title="Прозрачность интерфейса" desc="Меньше прозрачности — плотные непрозрачные поверхности, выше контраст">
          <div className="seg">
            <button className={!prefs.solid ? 'on' : ''} onClick={() => setPref('solid', false)}>Стекло</button>
            <button className={prefs.solid ? 'on' : ''} onClick={() => setPref('solid', true)}>Плотно</button>
          </div>
        </Row>
      </div>

      {/* ---- Конструктор главного экрана ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><LayoutDashboard size={15} /> Главный экран</div><span className="dim" style={{ fontSize: 12.5 }}>{homeBlocks.length} из {HOME_BLOCK_CATALOG.length} блоков</span></div>
        <div className="card-body">
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Соберите «Главное» под себя: включайте нужные блоки и ярлыки, меняйте порядок. Нажмите <b>«Настроить экран»</b> — откроется само «Главное» в режиме конструктора, где всё меняется прямо на месте.
          </div>
          <button className="btn btn-primary" onClick={openHomeBuilder}><Settings2 size={15} />Настроить экран</button>
          <div className="field-label" style={{ margin: '16px 0 8px' }}>Быстро включить/выключить блоки</div>
          <div className="dock-pick">
            {HOME_BLOCK_CATALOG.map((b) => {
              const on = homeBlocks.includes(b.id);
              return (
                <button key={b.id} className={`dock-chip ${on ? 'on' : ''}`} title={b.desc} onClick={() => toggleHomeBlock(b.id)}>
                  <span>{b.label}</span>
                  {on ? <Check size={14} className="dock-chip-mark" /> : <Plus size={14} className="dock-chip-mark" />}
                </button>
              );
            })}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setPref('homeBlocks', DEFAULT_HOME_BLOCKS)}>Сбросить блоки</button>
        </div>
        <Row title="Вид ярлыков" desc="Колонки — одна панель с разделителями, плитки — отдельные карточки">
          <div className="seg">
            <button className={prefs.homeShortcutStyle !== 'tiles' ? 'on' : ''} onClick={() => setPref('homeShortcutStyle', 'columns')}>Колонки</button>
            <button className={prefs.homeShortcutStyle === 'tiles' ? 'on' : ''} onClick={() => setPref('homeShortcutStyle', 'tiles')}>Плитки</button>
          </div>
        </Row>
        <Row title="Часы в шапке" desc="Тихие часы рядом с приветствием">
          <div className="seg">
            <button className={prefs.homeClock ? 'on' : ''} onClick={() => setPref('homeClock', true)}>Показать</button>
            <button className={!prefs.homeClock ? 'on' : ''} onClick={() => setPref('homeClock', false)}>Скрыть</button>
          </div>
        </Row>
        <Row title="Подсказки под полем NEX" desc="Готовые вопросы вроде «Что важно сегодня?»">
          <div className="seg">
            <button className={prefs.homeChips ? 'on' : ''} onClick={() => setPref('homeChips', true)}>Показать</button>
            <button className={!prefs.homeChips ? 'on' : ''} onClick={() => setPref('homeChips', false)}>Скрыть</button>
          </div>
        </Row>
        <Row title="Обращение в приветствии" desc="Как здороваться на «Главном»; пусто — имя из профиля">
          <input className="input" style={{ width: 200 }} value={prefs.homeName} maxLength={40}
            placeholder={user?.name?.split(' ')[0] || 'Например, Анна Сергеевна'}
            onChange={(e) => setPref('homeName', e.target.value)} />
        </Row>
      </div>

      {/* ---- Рабочая область и горячие клавиши (десктоп) ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><PanelLeft size={15} /> Рабочая область</div></div>
        <Row title="Боковая панель раздела" desc="Развёрнутая — с подписями, свёрнутая — только иконки (больше места контенту)">
          <div className="seg">
            <button className={prefs.sidebar !== 'collapsed' ? 'on' : ''} onClick={() => setPref('sidebar', 'expanded')}>Развёрнута</button>
            <button className={prefs.sidebar === 'collapsed' ? 'on' : ''} onClick={() => setPref('sidebar', 'collapsed')}>Свёрнута</button>
          </div>
        </Row>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="field-label" style={{ marginBottom: 8 }}>Горячие клавиши</div>
          <div className="hotkeys">
            {[['Ctrl', 'K', 'Поиск и NEX'], ['Ctrl', 'B', 'Свернуть/развернуть панель'], ['Ctrl', 'I', 'Чат NEX'], ['Alt', '1–9', 'Разделы']].map((k, i) => (
              <div className="hotkey-row" key={i}>
                <span className="hotkey-keys">{k.slice(0, -1).filter(Boolean).map((key) => <kbd key={key}>{key}</kbd>)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{k[k.length - 1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Верхняя панель (десктоп): какие разделы показывать ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><PanelTop size={15} /> Верхняя панель</div><span className="dim" style={{ fontSize: 12.5 }}>{topbar.length} из {TOPBAR_CATALOG.length}</span></div>
        <div className="card-body">
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Выберите разделы в верхней панели на компьютере. Убранные кнопки не пропадают — они остаются под рукой в поиске <Search size={12} style={{ verticalAlign: 'middle', color: 'var(--ai)' }} /> вверху (⌘K).
          </div>
          <div className="dock-pick">
            {TOPBAR_CATALOG.map((t) => {
              const Icon = t.icon;
              const on = topbar.includes(t.id);
              return (
                <button key={t.id} className={`dock-chip ${on ? 'on' : ''}`} onClick={() => toggleTop(t.id)}>
                  <Icon size={16} /><span>{t.label}</span>
                  {on ? <Check size={14} className="dock-chip-mark" /> : <Plus size={14} className="dock-chip-mark" />}
                </button>
              );
            })}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setPref('topbar', DEFAULT_TOPBAR)}>Показать все</button>
        </div>
      </div>

      {/* ---- Нижняя панель (докбар) на телефоне: добавить/убрать кнопки ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><Smartphone size={15} /> Нижняя панель</div><span className="dim" style={{ fontSize: 12.5 }}>{dock.length} из {DOCK_MAX}</span></div>
        <div className="card-body">
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Выберите кнопки нижнего докбара на телефоне — добавляйте нужные разделы и убирайте лишние. Порядок — как в списке ниже.
          </div>
          <div className="dock-pick">
            {DOCK_CATALOG.map((d) => {
              const Icon = d.icon;
              const on = dock.includes(d.id);
              return (
                <button key={d.id} className={`dock-chip ${on ? 'on' : ''}`} onClick={() => toggleDock(d.id)}>
                  <Icon size={16} /><span>{d.label}</span>
                  {on ? <Check size={14} className="dock-chip-mark" /> : <Plus size={14} className="dock-chip-mark" />}
                </button>
              );
            })}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setPref('dock', DEFAULT_DOCK)}>Сбросить по умолчанию</button>
        </div>
      </div>

      {/* ---- Интеллект: провайдер на выбор. Ключи хранятся только в этом браузере ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Интеллект</div>
          {keyState === 'ok' ? <Chip tone="chip-success">{provider === 'custom' ? 'LLM API подключён' : 'Gemini подключён'}</Chip> : <Chip tone="chip-neutral">демо-режим</Chip>}
        </div>
        <Row title="Провайдер" desc="Кто отвечает в чате, инлайн-панелях и планировщике">
          <div className="seg">
            <button className={provider === 'gemini' ? 'on' : ''} onClick={() => switchProvider('gemini')}>Gemini</button>
            <button className={provider === 'custom' ? 'on' : ''} onClick={() => switchProvider('custom')}>LLM API</button>
          </div>
        </Row>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            {provider === 'custom'
              ? <>OpenAI-совместимый API. Ключ хранится <b>только в этом браузере</b>.</>
              : <>Ключ Gemini API из Google AI Studio. Хранится <b>только в этом браузере</b>.</>}
          </div>
          {provider === 'custom' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input className="input" value={customUrl} onChange={(e) => setCustomUrlState(e.target.value)} placeholder={CUSTOM_DEFAULT_URL} style={{ flex: 2, minWidth: 200 }} />
              <input className="input" value={customModel} onChange={(e) => setCustomModelState(e.target.value)} placeholder={CUSTOM_DEFAULT_MODEL} style={{ flex: 1, minWidth: 100 }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" type="password" value={key} onChange={(e) => { setKey(e.target.value); setKeyState('idle'); }}
              placeholder={provider === 'custom' ? 'Ключ LLM API (llm-…)' : 'Ключ Gemini API…'} style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={saveKey} disabled={keyState === 'checking'}>
              {keyState === 'checking' ? 'Проверяю…' : 'Сохранить'}
            </button>
            {(provider === 'custom' ? getCustomKey() : getGeminiKey()) && (
              <button className="btn btn-ghost" title="Отключить" onClick={() => {
                if (provider === 'custom') setCustomKey(''); else setGeminiKey('');
                setKey(''); setKeyState('idle'); toast('Отключено — демо-режим');
              }}><XIcon size={15} /></button>
            )}
          </div>
          {keyState === 'bad' && (
            <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>
              Ключ не прошёл проверку. {provider === 'custom' ? 'Проверьте ключ, адрес и модель; возможно, сервис не разрешает запросы из браузера (CORS).' : 'Проверьте ключ в Google AI Studio.'}
            </div>
          )}
        </div>
      </div>

      {/* ---- Центр агентов живёт здесь, а не в левом меню ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><Bot size={15} /> Агенты NEX</div><Beta /></div>
        <Row title="Центр агентов" desc="Штат фоновых агентов: автопилот, уровни автономии, очередь подтверждений, правила и журнал.">
          <button className="btn btn-outline" onClick={() => setPage('agents')}><Bot size={15} />Открыть</button>
        </Row>
      </div>

      {/* Navigation & AI architecture */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><PanelLeft size={15} /> Навигация и ИИ</div></div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Боковая панель</div>
            <div className="muted" style={{ fontSize: 13 }}>Можно отключить и работать в ИИ-режиме: навигация и задачи — через NEX (строка вверху и пространство NEX).</div>
          </div>
          <div className="seg">
            <button className={sidebarEnabled ? 'on' : ''} onClick={() => setSidebarEnabled(true)}>Вкл</button>
            <button className={!sidebarEnabled ? 'on' : ''} onClick={() => setSidebarEnabled(false)}>Выкл</button>
          </div>
        </div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Пульс агентов в шапке</div>
            <div className="muted" style={{ fontSize: 13 }}>Строка «кто из агентов что делает сейчас» рядом с поиском. По умолчанию выключена, чтобы не отвлекать.</div>
          </div>
          <div className="seg">
            <button className={pulseEnabled ? 'on' : ''} onClick={() => setPulseEnabled(true)}>Вкл</button>
            <button className={!pulseEnabled ? 'on' : ''} onClick={() => setPulseEnabled(false)}>Выкл</button>
          </div>
        </div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Как работает NEX в интерфейсе</div>
            <div className="muted" style={{ fontSize: 13 }}>ИИ-функции раскрываются <b>прямо в странице</b> под кнопкой, где вы нажали. Выделите текст — всплывёт лёгкий объяснитель. Кнопка <Sparkles size={12} style={{ color: 'var(--ai)', verticalAlign: 'middle' }} /> вверху открывает полный чат.</div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => openChat()}><Sparkles size={14} />Открыть чат</button>
        </div>
      </div>

      {/* Security */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><ShieldCheck size={15} /> Безопасность</div></div>
        <div className="row-list">
          <div className="feed-row" style={{ alignItems: 'center' }}>
            <div className="feed-ico"><KeyRound size={14} /></div>
            <div className="feed-main"><div className="t">Двухфакторная аутентификация <Soon /></div><div className="m">Дополнительный код при входе</div></div>
            <Chip tone="chip-warn">не настроена</Chip>
            <button className="btn btn-sm btn-outline" onClick={() => toast('Функция в разработке')}>Включить</button>
          </div>
          <div className="feed-row" style={{ alignItems: 'center' }}>
            <div className="feed-ico"><ShieldCheck size={14} /></div>
            <div className="feed-main"><div className="t">Пароль <Soon /></div><div className="m">Последнее изменение: 14 дней назад</div></div>
            <Chip tone="chip-success">надёжный</Chip>
            <button className="btn btn-sm btn-outline" onClick={() => toast('Функция в разработке')}>Сменить</button>
          </div>
        </div>
      </div>

      {/* AI */}
      <div className="card">
        <div className="card-head"><div className="card-title"><Sparkles size={15} style={{ color: 'var(--ai)' }} /> Интеллектуальные функции</div></div>
        <div className="card-body muted" style={{ fontSize: 13 }}>
          NEX встроен в рабочие процессы и помогает без отдельного чат-бота: подсказывает действия, предотвращает ошибки и заранее показывает важное.
          Все действия ИИ проходят через журнал аудита как действия отдельного участника.
        </div>
      </div>
    </div>
  );
}
