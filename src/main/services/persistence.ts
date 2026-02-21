import Store from 'electron-store';
import { User, DailyRecord, FocusSchedule, FocusTemplate, AppSettings } from '../../shared/types';

const store = new Store({
  name: 'zenstate-data',
  defaults: {
    currentUser: null as User | null,
    dailyRecords: [] as DailyRecord[],
    categories: ['Meetings', 'Research', 'Design', 'Development', 'Editing', 'Animation', 'Writing', 'Sales', 'Accounting', 'Other'],
    categoryColors: {} as Record<string, string>,
    focusSchedules: [] as FocusSchedule[],
    focusTemplates: [
      { id: '1', name: 'Meeting', icon: 'zap', defaultDuration: 1800, color: '#007AFF', category: 'Meetings' },
      { id: '2', name: 'Discussion', icon: 'zap', defaultDuration: 600, color: '#007AFF', category: 'Meetings' },
      { id: '3', name: 'Quick Task', icon: 'zap', defaultDuration: 1200, color: '#007AFF', category: 'Meetings' },
    ] as FocusTemplate[],
    emergencyGrantedIds: [] as string[],
    appSettings: {
      dailyFocusGoalSeconds: 0, // disabled by default
      breakReminderEnabled: false,
      breakReminderIntervalSeconds: 90 * 60, // 90 minutes
      idleDetectionEnabled: false,
      idleThresholdSeconds: 5 * 60, // 5 minutes
    } as AppSettings,
  },
});

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

  getCategoryColors(): Record<string, string> {
    return store.get('categoryColors') as Record<string, string>;
  }

  saveCategoryColors(colors: Record<string, string>): void {
    store.set('categoryColors', colors);
  }

  getSchedules(): FocusSchedule[] {
    return store.get('focusSchedules') as FocusSchedule[];
  }

  saveSchedules(schedules: FocusSchedule[]): void {
    store.set('focusSchedules', schedules);
  }

  getTemplates(): FocusTemplate[] {
    return store.get('focusTemplates') as FocusTemplate[];
  }

  saveTemplates(templates: FocusTemplate[]): void {
    store.set('focusTemplates', templates);
  }

  getSettings(): AppSettings {
    return store.get('appSettings') as AppSettings;
  }

  saveSettings(settings: AppSettings): void {
    store.set('appSettings', settings);
  }

  getEmergencyGrantedIds(): string[] {
    return store.get('emergencyGrantedIds') as string[];
  }

  saveEmergencyGrantedIds(ids: string[]): void {
    store.set('emergencyGrantedIds', ids);
  }
}
