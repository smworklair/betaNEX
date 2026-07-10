import { useState, type ReactNode } from 'react';
import {
  Users, KeyRound, Activity, Monitor, ShieldCheck, Fingerprint, Sparkles, Plus, Trash2,
  Copy, Smartphone, Globe, Lock, DatabaseBackup, ScrollText, Wifi, BadgeCheck,
} from 'lucide-react';
import { PageHead, NexAsk, Beta, Chip, Avatar, useApp } from '../ui';
import { useCollection, uid, humanTime, type Entity } from '../beta/store';
import { EntityManager, type Col, type FieldDef } from '../beta/manager';
import { Modal, Field, Text, Select, AddButton, Confirm } from '../beta/kit';
import { sessions as seedSessions, auditEvents, services, roleLabel } from '../data';

function Screen({ title, sub, icon, children, ask }: { title: string; sub: string; icon: ReactNode; children: ReactNode; ask?: string }) {
  return (
    <div className="fade content-narrow">
      <PageHead title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{icon}{title}</span>} sub={sub} actions={<Beta />} />
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX · один из инструментов раздела</div>
        <div className="ai-body">ИИ помогает замечать аномалии, но безопасность держится на политиках, ролях и журналах. Реальное применение (блокировки, выпуск ключей, бэкапы) выполняет бэкенд — см. backend.md.</div>
        <div className="ai-actions"><NexAsk q={ask || `Оцени состояние раздела «${title}»`} label="Оценить" subtle={false} /></div>
      </div>
      {children}
    </div>
  );
}
const cols = <T,>(...c: Col<T>[]) => c;
const flds = <T,>(...f: FieldDef<T>[]) => f;

/* ---------------- Пользователи ---------------- */
interface SUser extends Entity, Record<string, unknown> { name: string; email: string; role: string; mfa: string; status: string; }
const SEED_USERS: SUser[] = [
  { id: 'u1', name: 'Администратор', email: 'admin@nex.ru', role: 'Администратор', mfa: 'Включена', status: 'Активен' },
  { id: 'u2', name: 'Козлова М.В.', email: 'kozlova@nex.ru', role: 'Преподаватель', mfa: 'Выключена', status: 'Активен' },
  { id: 'u3', name: 'Григорьев П.С.', email: 'grigoriev@nex.ru', role: 'Бухгалтер', mfa: 'Включена', status: 'Активен' },
];
export function SecUsers() {
  const col = useCollection<SUser>('sec-users', SEED_USERS);
  return <Screen title="Пользователи" sub="Учётные записи и доступ" icon={<Users size={18} />} ask="Есть ли учётки без MFA и лишние права">
    <EntityManager title="Пользователи" col={col} empty="Пользователей пока нет"
      columns={cols<SUser>({ key: 'name', label: 'Имя' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Роль', kind: 'chip' }, { key: 'mfa', label: 'MFA', kind: 'status' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<SUser>({ key: 'name', label: 'Имя' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Роль', options: ['Администратор', 'Преподаватель', 'Бухгалтер', 'Студент', 'Методист'] }, { key: 'mfa', label: 'MFA', options: ['Включена', 'Выключена'] }, { key: 'status', label: 'Статус', options: ['Активен', 'Заблокирован'] })} />
  </Screen>;
}

/* ---------------- Роли и права ---------------- */
const PERMS = ['Просмотр финансов', 'Изменение финансов', 'Управление людьми', 'Журнал и оценки', 'Приказы', 'Настройки безопасности', 'Экспорт данных', 'Управление ролями'];
interface SRole extends Entity, Record<string, unknown> { name: string; perms: string[]; }
const SEED_ROLES: SRole[] = [
  { id: 'r1', name: 'Администратор', perms: [...PERMS] },
  { id: 'r2', name: 'Преподаватель', perms: ['Журнал и оценки'] },
  { id: 'r3', name: 'Бухгалтер', perms: ['Просмотр финансов', 'Изменение финансов', 'Экспорт данных'] },
];
export function SecRoles() {
  const { toast } = useApp();
  const col = useCollection<SRole>('sec-roles', SEED_ROLES);
  const [name, setName] = useState('');
  const toggle = (r: SRole, p: string) => col.update(r.id, { perms: r.perms.includes(p) ? r.perms.filter((x) => x !== p) : [...r.perms, p] });
  const add = () => { if (!name.trim()) return; col.add({ name: name.trim(), perms: [] }); setName(''); toast('Роль создана'); };
  return <Screen title="Роли и разрешения" sub="Матрица прав по ролям" icon={<BadgeCheck size={18} />}>
    <div className="bk-toolbar"><div className="bk-search" style={{ maxWidth: 260 }}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название новой роли…" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></div>
      <div className="bk-toolbar-right"><AddButton label="Добавить роль" onClick={add} /></div></div>
    <div className="card"><div className="table-wrap"><table className="tbl">
      <thead><tr><th>Право / Роль</th>{col.items.map((r) => <th key={r.id} style={{ textAlign: 'center' }}>{r.name}</th>)}</tr></thead>
      <tbody>{PERMS.map((p) => (
        <tr key={p}><td style={{ fontWeight: 600 }}>{p}</td>{col.items.map((r) => (
          <td key={r.id} style={{ textAlign: 'center' }}>
            <button className={`bk-rowcheck ${r.perms.includes(p) ? 'on' : ''}`} style={{ margin: '0 auto' }} onClick={() => toggle(r, p)}>{r.perms.includes(p) && <span>✓</span>}</button>
          </td>
        ))}</tr>
      ))}
        <tr><td className="dim">Удалить роль</td>{col.items.map((r) => (
          <td key={r.id} style={{ textAlign: 'center' }}><button className="icon-btn sm" onClick={() => { col.remove(r.id); toast('Роль удалена'); }}><Trash2 size={14} /></button></td>
        ))}</tr>
      </tbody>
    </table></div></div>
  </Screen>;
}

/* ---------------- Аудит и журнал безопасности ---------------- */
interface AuditRow extends Entity, Record<string, unknown> { actor: string; action: string; target: string; severity: string; time: string; }
const SEED_AUDIT: AuditRow[] = auditEvents.map((e) => ({ id: e.id, actor: e.actor, action: e.action, target: e.target, severity: e.severity, time: e.time }));
export function SecAudit() {
  const col = useCollection<AuditRow>('sec-audit', SEED_AUDIT);
  return <Screen title="Аудит и журнал событий" sub="Кто, что и когда изменил" icon={<Activity size={18} />} ask="Что необычного в журнале за последнее время">
    <EntityManager title="Журнал аудита" col={col} empty="Событий пока нет"
      columns={cols<AuditRow>({ key: 'actor', label: 'Инициатор' }, { key: 'action', label: 'Действие' }, { key: 'target', label: 'Объект' }, { key: 'severity', label: 'Уровень', kind: 'chip' }, { key: 'time', label: 'Время' })}
      fields={flds<AuditRow>({ key: 'actor', label: 'Инициатор' }, { key: 'action', label: 'Действие' }, { key: 'target', label: 'Объект' }, { key: 'severity', label: 'Уровень', options: ['low', 'medium', 'high', 'critical'] }, { key: 'time', label: 'Время' })} />
  </Screen>;
}

/* ---------------- Сессии и устройства ---------------- */
interface Device extends Entity, Record<string, unknown> { name: string; owner: string; os: string; lastSeen: string; trusted: string; }
const SEED_DEV: Device[] = [
  { id: 'dv1', name: 'Рабочий ПК', owner: 'Администратор', os: 'Windows 11', lastSeen: 'сейчас', trusted: 'Доверенное' },
  { id: 'dv2', name: 'iPhone', owner: 'Козлова М.В.', os: 'iOS 18', lastSeen: '3 мин назад', trusted: 'Доверенное' },
  { id: 'dv3', name: 'Неизвестное устройство', owner: 'Сидорова Н.П.', os: 'Linux', lastSeen: '40 мин назад', trusted: 'Не доверенное' },
];
export function SecSessions() {
  const { toast } = useApp();
  const [ss, setSs] = useState(seedSessions);
  const devCol = useCollection<Device>('sec-devices', SEED_DEV);
  return <Screen title="Сессии и устройства" sub="Активные входы и привязанные устройства" icon={<Monitor size={18} />}>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="card-title"><Monitor size={15} /> Активные сессии</div></div>
      <div className="row-list">
        {ss.map((s) => (
          <div className="feed-row" key={s.id}>
            <Avatar name={s.name} />
            <div className="feed-main"><div className="t">{s.name} {s.current && <span className="dim">· вы</span>}</div>
              <div className="m">{roleLabel[s.role]} · {s.device} · {s.location} · {s.ip}</div>
              {s.anomaly && <div style={{ marginTop: 4 }}><Chip tone="chip-warn">{s.anomaly}</Chip></div>}</div>
            {!s.current && <button className="btn btn-sm btn-ghost" onClick={() => { setSs((p) => p.filter((x) => x.id !== s.id)); toast('Сессия завершена'); }}>Завершить</button>}
          </div>
        ))}
      </div>
    </div>
    <div className="card-title" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={15} /> Устройства</div>
    <EntityManager title="Устройства" col={devCol} empty="Устройств пока нет"
      columns={cols<Device>({ key: 'name', label: 'Устройство' }, { key: 'owner', label: 'Владелец' }, { key: 'os', label: 'ОС' }, { key: 'lastSeen', label: 'Активность' }, { key: 'trusted', label: 'Доверие', kind: 'status' })}
      fields={flds<Device>({ key: 'name', label: 'Устройство' }, { key: 'owner', label: 'Владелец' }, { key: 'os', label: 'ОС' }, { key: 'lastSeen', label: 'Последняя активность' }, { key: 'trusted', label: 'Доверие', options: ['Доверенное', 'Не доверенное'] })} />
  </Screen>;
}

/* ---------------- Ключи и внешний доступ ---------------- */
interface ApiKey extends Entity { name: string; token: string; scope: string; created: string; }
const SEED_KEYS: ApiKey[] = [
  { id: 'k1', name: 'Интеграция 1С', token: 'nex_live_••••••7f3a', scope: 'Финансы (чтение)', created: '2026-05-01' },
];
export function SecKeys() {
  const { toast } = useApp();
  const col = useCollection<ApiKey>('sec-keys', SEED_KEYS);
  const [creating, setCreating] = useState(false);
  const [oauth, setOauth] = useState({ google: true, yandex: false });
  const [sso, setSso] = useState(false);
  return <Screen title="Ключи и внешний доступ" sub="API-ключи, OAuth и SSO" icon={<KeyRound size={18} />}>
    <div className="bk-toolbar"><div className="bk-search" /><div className="bk-toolbar-right"><AddButton label="Новый ключ" onClick={() => setCreating(true)} /></div></div>
    <div className="card" style={{ marginBottom: 16 }}><div className="row-list">
      {col.items.map((k) => (
        <div className="feed-row" key={k.id}>
          <div className="feed-ico"><KeyRound size={14} /></div>
          <div className="feed-main"><div className="t">{k.name}</div><div className="m mono">{k.token} · {k.scope} · с {k.created}</div></div>
          <button className="icon-btn sm" onClick={() => { navigator.clipboard?.writeText(k.token); toast('Ключ скопирован'); }}><Copy size={14} /></button>
          <button className="icon-btn sm" onClick={() => { col.remove(k.id); toast('Ключ отозван'); }}><Trash2 size={14} /></button>
        </div>
      ))}
    </div></div>

    <div className="grid cols-2">
      <div className="card"><div className="card-head"><div className="card-title"><Globe size={15} /> OAuth-провайдеры</div></div>
        <div className="row-list">
          <ToggleRow label="Google Workspace" desc="Вход через корпоративный Google" on={oauth.google} onToggle={() => setOauth((o) => ({ ...o, google: !o.google }))} />
          <ToggleRow label="Яндекс ID" desc="Вход через Яндекс" on={oauth.yandex} onToggle={() => setOauth((o) => ({ ...o, yandex: !o.yandex }))} />
        </div>
      </div>
      <div className="card"><div className="card-head"><div className="card-title"><Fingerprint size={15} /> SSO (SAML)</div></div>
        <div className="row-list">
          <ToggleRow label="Единый вход организации" desc="SAML 2.0 / корпоративный IdP" on={sso} onToggle={() => setSso((v) => !v)} />
        </div>
      </div>
    </div>
    {creating && <KeyCreate onClose={() => setCreating(false)} onCreate={(name, scope) => { col.add({ name, scope, token: 'nex_live_••••••' + uid('').slice(-4), created: new Date().toISOString().slice(0, 10) }); toast('Ключ создан'); }} />}
  </Screen>;
}
function KeyCreate({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, scope: string) => void }) {
  const [name, setName] = useState(''); const [scope, setScope] = useState('Финансы (чтение)');
  return <Modal title="Новый API-ключ" onClose={onClose} footer={<>
    <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
    <button className="btn btn-primary" onClick={() => { if (name.trim()) { onCreate(name.trim(), scope); onClose(); } }}>Создать</button>
  </>}>
    <div className="bk-form-grid">
      <Field label="Название"><Text value={name} onChange={setName} autoFocus /></Field>
      <Field label="Область доступа"><Select value={scope} onChange={setScope} options={['Финансы (чтение)', 'Финансы (запись)', 'Люди (чтение)', 'Полный доступ'].map((o) => ({ value: o, label: o }))} /></Field>
    </div>
  </Modal>;
}

/* ---------------- Политики безопасности ---------------- */
interface IpRule extends Entity, Record<string, unknown> { ip: string; list: string; note: string; }
const SEED_IP: IpRule[] = [
  { id: 'ip1', ip: '45.9.148.3', list: 'Чёрный список', note: 'Подбор пароля' },
  { id: 'ip2', ip: '95.30.11.0/24', list: 'Белый список', note: 'Офис' },
];
export function SecPolicies() {
  const { toast } = useApp();
  const ipCol = useCollection<IpRule>('sec-ip', SEED_IP);
  const [pol, setPol] = useState({ mfa: true, ip: false, complexity: true, timeout: true });
  return <Screen title="Политики безопасности" sub="MFA, пароли, ограничения IP, списки доступа" icon={<Lock size={18} />}>
    <div className="card" style={{ marginBottom: 16 }}><div className="row-list">
      <ToggleRow label="Обязательная MFA" desc="Второй фактor для всех администраторов" on={pol.mfa} onToggle={() => { setPol((p) => ({ ...p, mfa: !p.mfa })); toast('Политика обновлена'); }} />
      <ToggleRow label="Ограничение по IP" desc="Пускать только из белого списка сетей" on={pol.ip} onToggle={() => setPol((p) => ({ ...p, ip: !p.ip }))} />
      <ToggleRow label="Сложность паролей" desc="Минимум 12 символов, буквы, цифры, спецсимволы" on={pol.complexity} onToggle={() => setPol((p) => ({ ...p, complexity: !p.complexity }))} />
      <ToggleRow label="Автовыход по бездействию" desc="Завершать сессию после 30 минут" on={pol.timeout} onToggle={() => setPol((p) => ({ ...p, timeout: !p.timeout }))} />
    </div></div>
    <div className="card-title" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}><Wifi size={15} /> Белые и чёрные списки IP</div>
    <EntityManager title="Списки IP" col={ipCol} empty="Правил пока нет"
      columns={cols<IpRule>({ key: 'ip', label: 'IP / подсеть' }, { key: 'list', label: 'Список', kind: 'chip' }, { key: 'note', label: 'Примечание' })}
      fields={flds<IpRule>({ key: 'ip', label: 'IP или подсеть' }, { key: 'list', label: 'Список', options: ['Белый список', 'Чёрный список'] }, { key: 'note', label: 'Примечание' })} />
  </Screen>;
}

/* ---------------- Резервные копии, сертификаты, мониторинг ---------------- */
interface Backup extends Entity { when: string; size: string; kind: string; }
interface Cert extends Entity, Record<string, unknown> { domain: string; issuer: string; until: string; status: string; }
const SEED_BK: Backup[] = [
  { id: 'bk1', when: 'сегодня, 04:00', size: '2.4 ГБ', kind: 'Полная' },
  { id: 'bk2', when: 'вчера, 04:00', size: '2.3 ГБ', kind: 'Полная' },
];
const SEED_CERT: Cert[] = [
  { id: 'ct1', domain: 'nex.college.ru', issuer: "Let's Encrypt", until: '2026-09-14', status: 'Действует' },
];
export function SecBackup() {
  const { toast } = useApp();
  const bkCol = useCollection<Backup>('sec-backups', SEED_BK);
  const certCol = useCollection<Cert>('sec-certs', SEED_CERT);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  return <Screen title="Резервные копии и мониторинг" sub="Бэкапы, сертификаты, целостность системы" icon={<DatabaseBackup size={18} />}>
    <div className="bk-toolbar"><div className="bk-search" /><div className="bk-toolbar-right">
      <button className="btn btn-primary" onClick={() => { bkCol.add({ when: humanTime(new Date().toISOString()), size: '2.4 ГБ', kind: 'Ручная' }); toast('Резервная копия создаётся'); }}><Plus size={15} />Создать бэкап</button>
    </div></div>
    <div className="card" style={{ marginBottom: 16 }}><div className="row-list">
      {bkCol.items.map((b) => (
        <div className="feed-row" key={b.id}>
          <div className="feed-ico"><DatabaseBackup size={14} /></div>
          <div className="feed-main"><div className="t">{b.kind} копия · {b.size}</div><div className="m">{b.when}</div></div>
          <button className="btn btn-sm btn-ghost" onClick={() => toast('Восстановление из копии запрошено')}>Восстановить</button>
          <button className="icon-btn sm" onClick={() => setConfirmDel(b.id)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div></div>

    <div className="card-title" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}><ScrollText size={15} /> Сертификаты</div>
    <EntityManager title="Сертификаты" col={certCol} empty="Сертификатов пока нет"
      columns={cols<Cert>({ key: 'domain', label: 'Домен' }, { key: 'issuer', label: 'Издатель' }, { key: 'until', label: 'Действует до' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Cert>({ key: 'domain', label: 'Домен' }, { key: 'issuer', label: 'Издатель' }, { key: 'until', label: 'Действует до', type: 'date' }, { key: 'status', label: 'Статус', options: ['Действует', 'Истекает', 'Отозван'] })} />

    <div className="card" style={{ marginTop: 16 }}><div className="card-head"><div className="card-title"><ShieldCheck size={15} /> Мониторинг целостности</div></div>
      <div className="card-body"><div className="svc-grid">
        {services.map((s) => (
          <div className="svc-tile" key={s.name}><span className={`svc-dot ${s.status}`} />
            <div style={{ flex: 1, minWidth: 0 }}><div className="svc-name">{s.name}</div><div className="svc-value">{s.value}</div></div>
          </div>
        ))}
      </div></div>
    </div>
    {confirmDel && <Confirm title="Удалить копию?" body="Резервная копия будет удалена." onConfirm={() => { bkCol.remove(confirmDel); toast('Копия удалена'); }} onClose={() => setConfirmDel(null)} />}
  </Screen>;
}

/* строка-переключатель */
function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="feed-row" style={{ alignItems: 'center' }}>
      <div className="feed-main"><div className="t">{label}</div><div className="m">{desc}</div></div>
      <button className={`bk-switch ${on ? 'on' : ''}`} onClick={onToggle} aria-label="Переключить"><span /></button>
    </div>
  );
}
