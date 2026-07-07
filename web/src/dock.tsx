import {
  Newspaper, MessageSquare, GraduationCap, Wallet, Users, BarChart3,
  ShieldCheck, FlaskConical, type LucideIcon,
} from 'lucide-react';

/* Каталог разделов верхней панели (десктоп). id совпадает с id раздела в SECTIONS.
   Пользователь может убрать часть кнопок — скрытые остаются доступны через поиск. */
export interface TopItem { id: string; label: string; icon: LucideIcon; }
export const TOPBAR_CATALOG: TopItem[] = [
  { id: 'feed',      label: 'Лента',        icon: Newspaper },
  { id: 'finance',   label: 'Финансы',      icon: Wallet },
  { id: 'study',     label: 'Учёба',        icon: GraduationCap },
  { id: 'people',    label: 'Люди',         icon: Users },
  { id: 'analytics', label: 'Аналитика',    icon: BarChart3 },
  { id: 'security',  label: 'Безопасность', icon: ShieldCheck },
  { id: 'beta',      label: 'Бета',         icon: FlaskConical },
];
export const DEFAULT_TOPBAR = TOPBAR_CATALOG.map((t) => t.id);
export const TOPBAR_MIN = 2;

/* Каталог кнопок нижнего докбара (мобайл). id совпадает с id раздела,
   кроме «mail» — это отдельная кнопка мессенджера. page — куда ведёт кнопка. */
export interface DockItem { id: string; label: string; icon: LucideIcon; page: string; }

export const DOCK_CATALOG: DockItem[] = [
  { id: 'feed',      label: 'Лента',        icon: Newspaper,      page: 'home' },
  { id: 'mail',      label: 'Сообщения',    icon: MessageSquare,  page: 'mail' },
  { id: 'study',     label: 'Учёба',        icon: GraduationCap,  page: 'journal' },
  { id: 'finance',   label: 'Финансы',      icon: Wallet,         page: 'fin-overview' },
  { id: 'people',    label: 'Люди',         icon: Users,          page: 'students' },
  { id: 'analytics', label: 'Аналитика',    icon: BarChart3,      page: 'analytics' },
  { id: 'security',  label: 'Безопасность', icon: ShieldCheck,    page: 'security' },
  { id: 'beta',      label: 'Бета',         icon: FlaskConical,   page: 'documents' },
];

export const DOCK_BY_ID: Record<string, DockItem> = {};
DOCK_CATALOG.forEach((d) => { DOCK_BY_ID[d.id] = d; });

/* По умолчанию — 5 кнопок, включая мессенджер */
export const DEFAULT_DOCK = ['feed', 'mail', 'study', 'finance', 'people'];
export const DOCK_MIN = 2;
export const DOCK_MAX = 6;
