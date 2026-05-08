import Store from 'electron-store';
import { User, DailyRecord, FocusSchedule, AppSettings, TodayPlan, RecentTodo, PinnedTodo, PeerGroup } from '../../shared/types';

const RECENTS_MAX = 8; // cap so the list stays useful, not cluttered

const DEFAULT_APP_SETTINGS: AppSettings = {
  breakReminderEnabled: false,
  breakReminderIntervalSeconds: 90 * 60, // 90 minutes
  idleDetectionEnabled: false,
  idleThresholdSeconds: 5 * 60, // 5 minutes
  requireTimesheetConfirmation: true, // safer default — user reviews before anything hits Basecamp
  miniTimerEnabled: true, // visible by default — solves the "can't see timer in full-screen" problem
  miniTimerAutoDim: false, // off by default — opt-in for users who find the pill too prominent
};

const store = new Store({
  name: 'zenstate-data',
  defaults: {
    currentUser: null as User | null,
    dailyRecords: [] as DailyRecord[],
    categories: ['Meetings', 'Research', 'Design', 'Development', 'Editing', 'Animation', 'Writing', 'Sales', 'Accounting', 'Other'],
    categoryColors: {} as Record<string, string>,
    focusSchedules: [] as FocusSchedule[],
    emergencyGrantedIds: [] as string[],
    appSettings: DEFAULT_APP_SETTINGS,
    todayPlan: null as TodayPlan | null,
    recentTodos: [] as RecentTodo[],
    peerGroups: [] as PeerGroup[],
  },
});

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class PersistenceService {
  getUser(): User | null {
    return store.get('currentUser') as User | null;
  }

  saveUser(user: User): void {
    store.set('currentUser', user);
  }

  deleteUser(): void {
    store.set('currentUser', null);
  }

  getRecords(): DailyRecord[] {
    return store.get('dailyRecords') as DailyRecord[];
  }

  saveRecords(records: DailyRecord[]): void {
    store.set('dailyRecords', records);
  }

  getCategories(): string[] {
    return store.get('categories') as string[];
  }

  saveCategories(categories: string[]): void {
    store.set('categories', categories);
  }

  getSchedules(): FocusSchedule[] {
    return store.get('focusSchedules') as FocusSchedule[];
  }

  saveSchedules(schedules: FocusSchedule[]): void {
    store.set('focusSchedules', schedules);
  }

  getSettings(): AppSettings {
    // Merge with defaults so users upgrading from older builds don't get
    // `undefined` for newly-added fields (e.g. miniTimerEnabled).
    const stored = (store.get('appSettings') ?? {}) as Partial<AppSettings>;
    return { ...DEFAULT_APP_SETTINGS, ...stored };
  }

  saveSettings(settings: AppSettings): void {
    // Always merge with defaults on write too, in case a partial object slips in.
    store.set('appSettings', { ...DEFAULT_APP_SETTINGS, ...settings });
  }

  getEmergencyGrantedIds(): string[] {
    return store.get('emergencyGrantedIds') as string[];
  }

  saveEmergencyGrantedIds(ids: string[]): void {
    store.set('emergencyGrantedIds', ids);
  }

  // ── Today plan ─────────────────────────────────────────────
  // Auto-resets at midnight: if the stored plan is from yesterday or earlier,
  // we return an empty plan for today instead of reviving stale items.

  getTodayPlan(): TodayPlan {
    const today = todayDateStr();
    const stored = store.get('todayPlan') as TodayPlan | null;
    if (!stored || stored.date !== today) {
      return { date: today, items: [] };
    }
    return stored;
  }

  saveTodayPlan(plan: TodayPlan): void {
    store.set('todayPlan', plan);
  }

  // ── Recent todos ───────────────────────────────────────────
  // Newest first. Used by the popover to give one-tap restart on common todos.

  getRecentTodos(): RecentTodo[] {
    return (store.get('recentTodos') as RecentTodo[]) ?? [];
  }

  // Idempotent — re-using a todo just bumps it to the top with a fresh timestamp.
  pushRecentTodo(todo: Omit<RecentTodo, 'lastUsedAt'>): void {
    const existing = this.getRecentTodos().filter((r) => r.todoId !== todo.todoId);
    const next: RecentTodo[] = [
      { ...todo, lastUsedAt: new Date().toISOString() },
      ...existing,
    ].slice(0, RECENTS_MAX);
    store.set('recentTodos', next);
  }

  // Used at sign-out / reset; not exposed via IPC.
  clearTodayAndRecents(): void {
    store.set('todayPlan', null);
    store.set('recentTodos', []);
  }

  // ── Peer groups ─────────────────────────────────────────────
  // User-defined sets of teammates for one-tap multi-select when sending pings.
  // Stored locally per machine; no syncing across the team.

  getPeerGroups(): PeerGroup[] {
    return (store.get('peerGroups') as PeerGroup[]) ?? [];
  }

  // Idempotent upsert keyed on group.id. Used for both create and update.
  savePeerGroup(group: PeerGroup): PeerGroup[] {
    const existing = this.getPeerGroups();
    const idx = existing.findIndex((g) => g.id === group.id);
    if (idx >= 0) existing[idx] = group;
    else existing.push(group);
    store.set('peerGroups', existing);
    return existing;
  }

  deletePeerGroup(groupId: string): PeerGroup[] {
    const next = this.getPeerGroups().filter((g) => g.id !== groupId);
    store.set('peerGroups', next);
    return next;
  }
}

// Re-exported helper so main process can write the same shape without re-deriving it.
export type { TodayPlan, PinnedTodo, RecentTodo };
