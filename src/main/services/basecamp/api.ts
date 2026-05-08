import { BasecampOAuth, BC_USER_AGENT } from './oauth';
import { BasecampProject, BasecampTodoList, BasecampTodo, BasecampTimesheetEntry } from '../../../shared/types';

interface RawProject {
  id: number;
  name: string;
  description?: string;
  dock?: Array<{ id: number; name: string; enabled: boolean; url: string }>;
  timesheet_enabled?: boolean;
}

interface RawTimesheetEntry {
  id: number;
  date: string;
  hours: string;
  description?: string;
  parent: { id: number; title?: string; type?: string };
  person: { id: number; name: string };
  app_url: string;
}

interface RawTodoSet {
  id: number;
  todolists_url: string;
}

interface RawTodoList {
  id: number;
  title: string;
  description?: string;
  todos_url: string;
  groups_url?: string;
}

interface RawTodo {
  id: number;
  content: string;
  description?: string;
  completed: boolean;
  due_on?: string;
  parent?: { id: number } | null;
  comments_count: number;
  url: string;
  app_url: string;
  assignees: Array<{ id: number }>;
}

const MAX_AUTH_RETRIES = 1;
const MAX_RATE_LIMIT_RETRIES = 3;

export class BasecampApi {
  constructor(private readonly oauth: BasecampOAuth) {}

  // Authenticated fetch with auto-refresh on 401 and bounded backoff on 429.
  private async fetchAuth(url: string, init: RequestInit = {}, opts: { authRetries?: number; rateRetries?: number } = {}): Promise<Response> {
    const authRetries = opts.authRetries ?? MAX_AUTH_RETRIES;
    const rateRetries = opts.rateRetries ?? MAX_RATE_LIMIT_RETRIES;

    const token = await this.oauth.getAccessToken();
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'User-Agent': BC_USER_AGENT,
      'Accept': 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };

    const res = await fetch(url, { ...init, headers });

    if (res.status === 401 && authRetries > 0) {
      // Force the next getAccessToken() call to refresh, then retry once.
      this.oauth.forceExpire();
      return this.fetchAuth(url, init, { authRetries: authRetries - 1, rateRetries });
    }

    if (res.status === 429 && rateRetries > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      await new Promise((r) => setTimeout(r, Math.max(1, retryAfter) * 1000));
      return this.fetchAuth(url, init, { authRetries, rateRetries: rateRetries - 1 });
    }

    return res;
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchAuth(url, init);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Basecamp API ${res.status}: ${body || res.statusText}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // Walks Link: rel="next" pagination, returning a flattened list.
  private async paginate<T>(firstUrl: string): Promise<T[]> {
    const all: T[] = [];
    let url: string | null = firstUrl;
    while (url) {
      const res = await this.fetchAuth(url);
      if (!res.ok) throw new Error(`Basecamp API ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as T[];
      all.push(...page);
      url = parseNext(res.headers.get('Link'));
    }
    return all;
  }

  private accountBase(): string {
    // Prefer the account `href` returned by the auth info call, since Basecamp
    // is the source of truth for the API base URL. Fall back to the canonical
    // host (3.basecampapi.com — note "api", not "app") if href isn't stored.
    const href = this.oauth.getAccountHref();
    if (href) return href.replace(/\/$/, '');
    return `https://3.basecampapi.com/${this.oauth.getAccountId()}`;
  }

  async listProjects(): Promise<BasecampProject[]> {
    const raw = await this.paginate<RawProject>(`${this.accountBase()}/projects.json`);
    return raw.map((p) => {
      const todoset = p.dock?.find((d) => d.name === 'todoset' && d.enabled);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        todoSetId: todoset?.id,
        timesheetEnabled: p.timesheet_enabled === true,
      };
    });
  }

  async listTodoLists(projectId: number, todoSetId: number): Promise<BasecampTodoList[]> {
    const set = await this.requestJson<RawTodoSet>(`${this.accountBase()}/buckets/${projectId}/todosets/${todoSetId}.json`);
    const lists = await this.paginate<RawTodoList>(set.todolists_url);
    return lists.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      todosUrl: l.todos_url,
      groupsUrl: l.groups_url,
    }));
  }

  async listTodos(projectId: number, todoListId: number): Promise<BasecampTodo[]> {
    const todos = await this.paginate<RawTodo>(`${this.accountBase()}/buckets/${projectId}/todolists/${todoListId}/todos.json`);
    return todos.map(this.mapTodo);
  }

  async createTodo(input: {
    projectId: number;
    todoListId: number;
    content: string;
    description?: string;
    parentId?: number;
  }): Promise<BasecampTodo> {
    const body: Record<string, unknown> = { content: input.content };
    if (input.description) body.description = input.description;
    if (input.parentId) body.parent_id = input.parentId;

    const todo = await this.requestJson<RawTodo>(
      `${this.accountBase()}/buckets/${input.projectId}/todolists/${input.todoListId}/todos.json`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return this.mapTodo(todo);
  }

  async postComment(input: { projectId: number; todoId: number; content: string }): Promise<void> {
    await this.requestJson<void>(
      `${this.accountBase()}/buckets/${input.projectId}/recordings/${input.todoId}/comments.json`,
      { method: 'POST', body: JSON.stringify({ content: input.content }) },
    );
  }

  // Create a Basecamp timesheet entry on a recording (to-do).
  // `hours` accepts decimal ("1.5") or H:MM ("1:30") format.
  async createTimesheetEntry(input: {
    todoId: number;
    date: string;
    hours: string;
    description?: string;
  }): Promise<BasecampTimesheetEntry> {
    const body: Record<string, unknown> = { date: input.date, hours: input.hours };
    if (input.description) body.description = input.description;

    const raw = await this.requestJson<RawTimesheetEntry>(
      `${this.accountBase()}/recordings/${input.todoId}/timesheet/entries.json`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return this.mapTimesheetEntry(raw);
  }

  // Get all timesheet entries for a project (paginated). Use this to compute
  // per-todo totals by grouping on `parentId` and summing `hours`.
  async getProjectTimesheet(projectId: number): Promise<BasecampTimesheetEntry[]> {
    const raw = await this.paginate<RawTimesheetEntry>(`${this.accountBase()}/projects/${projectId}/timesheet.json`);
    return raw.map((r) => this.mapTimesheetEntry(r));
  }

  private mapTimesheetEntry(r: RawTimesheetEntry): BasecampTimesheetEntry {
    return {
      id: r.id,
      date: r.date,
      hours: r.hours,
      description: r.description,
      parentId: r.parent.id,
      parentTitle: r.parent.title,
      parentType: r.parent.type,
      personId: r.person.id,
      personName: r.person.name,
      appUrl: r.app_url,
    };
  }

  private mapTodo(t: RawTodo): BasecampTodo {
    return {
      id: t.id,
      content: t.content,
      description: t.description,
      completed: t.completed,
      assigneeIds: t.assignees?.map((a) => a.id) ?? [],
      dueOn: t.due_on,
      parentId: t.parent?.id,
      commentsCount: t.comments_count,
      url: t.url,
      appUrl: t.app_url,
    };
  }
}

function parseNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}
