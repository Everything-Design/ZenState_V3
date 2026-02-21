import Store from 'electron-store';
import { User, DailyRecord, FocusSchedule, FocusTemplate } from '../../shared/types';

const store = new Store({
  name: 'zenstate-data',
  defaults: {
    currentUser: null as User | null,
    dailyRecords: [] as DailyRecord[],
    categories: ['Meetings', 'Research', 'Design', 'Development', 'Editing', 'Animation', 'Writing', 'Sales', 'Accounting', 'Other'],
    categoryColors: {} as Record<string, string>,
    focusSchedules: [] as FocusSchedule[],
    focusTemplates: [
      { id: '1', name: 'Deep Work', icon: 'brain', defaultDuration: 5400, color: '#5856D6' },
      { id: '2', name: 'Code Review', icon: 'code', defaultDuration: 1800, color: '#007AFF' },
      { id: '3', name: 'Writing', icon: 'pencil', defaultDuration: 3600, color: '#34C759' },
      { id: '4', name: 'Design', icon: 'palette', defaultDuration: 2700, color: '#FF9500' },
      { id: '5', name: 'Meeting Prep', icon: 'calendar', defaultDuration: 900, color: '#FF3B30' },
      { id: '6', name: 'Quick Task', icon: 'zap', defaultDuration: 900, color: '#AF52DE' },
    ] as FocusTemplate[],
    emergencyGrantedIds: [] as string[],
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

  getEmergencyGrantedIds(): string[] {
    return store.get('emergencyGrantedIds') as string[];
  }

  saveEmergencyGrantedIds(ids: string[]): void {
    store.set('emergencyGrantedIds', ids);
  }
}
