import {
  Wallet, Users, BookOpen, ListChecks, MessageSquare, CalendarDays, BarChart3,
  ShieldCheck, Megaphone, ClipboardList, Rss, Bell, type LucideIcon,
} from 'lucide-react';

/* ============================================================
   Конструктор главного экрана: каталоги блоков и ярлыков.
   Пользователь включает/выключает и переставляет их —
   выбор хранится в prefs (localStorage), как док и верхняя панель.
   ============================================================ */

export interface HomeBlock { id: string; label: string; desc: string; col?: boolean; }

/* col: true — блок живёт в правой/левой колонке двухколоночной сетки
   (соседние col-блоки встают рядом). Остальные — на всю ширину. */
export const HOME_BLOCK_CATALOG: HomeBlock[] = [
  { id: 'brief', label: 'Сводка дня', desc: 'Короткий человеческий текст: что важно сегодня' },
  { id: 'console', label: 'Командная строка NEX', desc: 'Строка команд и быстрые запросы к ассистенту' },
  { id: 'shortcuts', label: 'Ярлыки разделов', desc: 'Плитки быстрого перехода в разделы' },
  { id: 'today', label: 'На сегодня', desc: 'Мягкий список приоритетов дня', col: true },
  { id: 'recent', label: 'Недавнее у NEX', desc: 'Последние действия ассистента', col: true },
];
export const DEFAULT_HOME_BLOCKS = HOME_BLOCK_CATALOG.map((b) => b.id);
export const HOME_BLOCK_BY_ID: Record<string, HomeBlock> = {};
HOME_BLOCK_CATALOG.forEach((b) => { HOME_BLOCK_BY_ID[b.id] = b; });

export interface HomeShortcut { id: string; label: string; icon: LucideIcon; page: string; }
export const HOME_SHORTCUT_CATALOG: HomeShortcut[] = [
  { id: 'finance', label: 'Финансы', icon: Wallet, page: 'fin-overview' },
  { id: 'students', label: 'Студенты', icon: Users, page: 'students' },
  { id: 'journal', label: 'Журнал', icon: BookOpen, page: 'journal' },
  { id: 'tasks', label: 'Задачи', icon: ListChecks, page: 'tasks' },
  { id: 'mail', label: 'Сообщения', icon: MessageSquare, page: 'mail' },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays, page: 'calendar' },
  { id: 'analytics', label: 'Аналитика', icon: BarChart3, page: 'analytics' },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck, page: 'security' },
  { id: 'broadcast', label: 'Рассылка', icon: Megaphone, page: 'broadcast' },
  { id: 'admissions', label: 'Приём', icon: ClipboardList, page: 'admissions' },
  { id: 'community', label: 'Сообщество', icon: Rss, page: 'community' },
  { id: 'notifications', label: 'Уведомления', icon: Bell, page: 'notifications' },
];
export const DEFAULT_HOME_SHORTCUTS = ['finance', 'students', 'journal', 'tasks', 'mail', 'calendar'];
export const HOME_SHORTCUT_BY_ID: Record<string, HomeShortcut> = {};
HOME_SHORTCUT_CATALOG.forEach((s) => { HOME_SHORTCUT_BY_ID[s.id] = s; });

/** Переставить элемент в массиве на dir позиций (−1 вверх/влево, +1 вниз/вправо). */
export function moveInArray<T>(arr: T[], item: T, dir: number): T[] {
  const i = arr.indexOf(item);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
