import { shell, safeStorage } from 'electron';
import { EventEmitter } from 'events';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import Store from 'electron-store';
import { BasecampAccount, BasecampCredentials } from '../../../shared/types';

export const BC_REDIRECT_PORT = 53682;
export const BC_REDIRECT_URI = `http://127.0.0.1:${BC_REDIRECT_PORT}/basecamp/callback`;
const BC_AUTH_URL = 'https://launchpad.37signals.com/authorization/new';
const BC_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const BC_AUTH_INFO_URL = 'https://launchpad.37signals.com/authorization.json';

// Basecamp's API requires a User-Agent that identifies the integration with contact info.
export const BC_USER_AGENT = 'ZenState (saurabh@everything.design)';

interface EncField {
  v: string;        // base64-encoded ciphertext (or plain bytes if !enc)
  enc: boolean;     // whether v is safeStorage-encrypted
}

interface StoredCredentials {
  clientId: string;
  clientSecretEnc: EncField;
}

interface StoredAuth {
  accessToken: EncField;
  refreshToken: EncField;
  expiresAt: string;       // ISO date
  account: { id: number; name: string; href?: string };
  identity: { id: number; firstName: string; lastName: string; emailAddress: string };
}

interface BasecampStoreSchema {
  basecampCredentials: StoredCredentials | null;
  basecampAuth: StoredAuth | null;
}

const store = new Store<BasecampStoreSchema>({
  name: 'zenstate-basecamp',
  defaults: {
    basecampCredentials: null,
    basecampAuth: null,
  },
});

let warnedNoEncryption = false;
function encrypt(value: string): EncField {
  if (safeStorage.isEncryptionAvailable()) {
    return { v: safeStorage.encryptString(value).toString('base64'), enc: true };
  }
  if (!warnedNoEncryption) {
    console.warn('[Basecamp] safeStorage unavailable — secrets stored as base64 plaintext on disk');
    warnedNoEncryption = true;
  }
  return { v: Buffer.from(value, 'utf8').toString('base64'), enc: false };
}

function decrypt(field: EncField): string {
  if (field.enc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(field.v, 'base64'));
  }
  return Buffer.from(field.v, 'base64').toString('utf8');
}

export type BasecampOAuthEvents = 'authChanged' | 'reauthRequired';

export class BasecampOAuth extends EventEmitter {
  private pendingCallback: ((result: { code?: string; state?: string; error?: string }) => void) | null = null;
  private server: http.Server | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  // Memoize an in-flight refresh so two simultaneous API calls hitting an
  // expired token don't both POST to /authorization/token — Basecamp
  // invalidates the refresh_token on first use, so the second call would 401
  // and trigger an unwanted disconnect/sign-out.
  private refreshInFlight: Promise<string> | null = null;
  // Same idea for the OAuth connect flow — the local callback server binds
  // to a fixed port (53682), so two concurrent connects collide on EADDRINUSE.
  private connectInFlight: Promise<void> | null = null;

  // ── Credentials (BYO Client ID + Secret) ────────────────────────

  getCredentials(): BasecampCredentials | null {
    const stored = store.get('basecampCredentials');
    if (!stored) return null;
    return { clientId: stored.clientId, clientSecret: decrypt(stored.clientSecretEnc) };
  }

  saveCredentials(creds: BasecampCredentials): void {
    store.set('basecampCredentials', {
      clientId: creds.clientId,
      clientSecretEnc: encrypt(creds.clientSecret),
    });
  }

  clearCredentials(): void {
    store.set('basecampCredentials', null);
  }

  // ── Auth state ──────────────────────────────────────────────────

  isConnected(): boolean {
    return store.get('basecampAuth') !== null;
  }

  getStoredAuth(): StoredAuth | null {
    return store.get('basecampAuth');
  }

  async getAccessToken(): Promise<string> {
    const auth = this.getStoredAuth();
    if (!auth) throw new Error('Basecamp is not connected');

    const expiresAt = new Date(auth.expiresAt).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      return this.refreshAccessToken();
    }
    return decrypt(auth.accessToken);
  }

  // Force a refresh on next call by clamping expiry into the past.
  // Used by the API client when a 401 indicates the token is invalid even though it appears unexpired.
  forceExpire(): void {
    const auth = this.getStoredAuth();
    if (!auth) return;
    store.set('basecampAuth', { ...auth, expiresAt: new Date(0).toISOString() });
  }

  getAccountId(): number {
    const auth = this.getStoredAuth();
    if (!auth) throw new Error('Basecamp is not connected');
    return auth.account.id;
  }

  getAccountHref(): string | undefined {
    return this.getStoredAuth()?.account.href;
  }

  getIdentityName(): string {
    const auth = this.getStoredAuth();
    if (!auth) return '';
    return [auth.identity.firstName, auth.identity.lastName].filter(Boolean).join(' ').trim();
  }

  disconnect(): void {
    store.set('basecampAuth', null);
    this.emit('authChanged');
  }

  // ── OAuth flow ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    // Prevent concurrent connect() calls — the loopback callback server binds
    // to a fixed port (53682), so a second call while one is in flight would
    // EADDRINUSE and leave the user with a partially-failed flow.
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = this.runConnect().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async runConnect(): Promise<void> {
    const creds = this.getCredentials();
    if (!creds || !creds.clientId || !creds.clientSecret) {
      throw new Error('Basecamp client ID and secret must be saved first');
    }

    const code = await this.runAuthFlow(creds.clientId);
    const tokens = await this.exchangeCodeForToken(creds, code);
    const info = await this.fetchAuthInfo(tokens.accessToken);

    const account = info.accounts.find((a) => a.product === 'bc3');
    if (!account) {
      throw new Error('No Basecamp 3 account found for this user');
    }

    const stored: StoredAuth = {
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      account: { id: account.id, name: account.name, href: account.href },
      identity: info.identity,
    };
    store.set('basecampAuth', stored);
    this.emit('authChanged');
  }

  private async runAuthFlow(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.stopServer();

      const nonce = crypto.randomBytes(16).toString('hex');

      this.pendingCallback = (result) => {
        this.stopServer();
        if (result.error) reject(new Error(result.error));
        else if (!result.code) reject(new Error('No authorization code received'));
        else if (result.state !== nonce) reject(new Error('OAuth state mismatch — aborting'));
        else resolve(result.code);
      };

      this.server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url ?? '', `http://127.0.0.1:${BC_REDIRECT_PORT}`);
          if (url.pathname !== '/basecamp/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const code = url.searchParams.get('code') ?? undefined;
          const state = url.searchParams.get('state') ?? undefined;
          const error = url.searchParams.get('error') ?? undefined;

          // Escape the error param before reflecting it into the HTML —
          // Basecamp normally sends short codes like "access_denied" but a
          // hostile redirect could include arbitrary text/markup.
          const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => (
            c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
          ));
          const safeError = error ? escapeHtml(error) : null;

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ZenState</title>
            <style>body{font:14px -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3}.box{text-align:center;padding:40px}.box h1{margin:0 0 8px;font-size:18px}.box p{margin:0;opacity:.7}</style></head>
            <body><div class="box"><h1>${safeError ? 'Connection failed' : 'ZenState connected to Basecamp'}</h1>
            <p>${safeError ? safeError : 'You can close this window and return to ZenState.'}</p></div></body></html>`);

          this.pendingCallback?.({ code, state, error });
        } catch (err) {
          res.writeHead(500);
          res.end('Server error');
          this.pendingCallback?.({ error: (err as Error).message });
        }
      });

      this.server.on('error', (err) => {
        reject(new Error(`Could not start callback listener on port ${BC_REDIRECT_PORT}: ${err.message}`));
      });

      this.server.listen(BC_REDIRECT_PORT, '127.0.0.1', () => {
        const params = new URLSearchParams({
          type: 'web_server',
          client_id: clientId,
          redirect_uri: BC_REDIRECT_URI,
          state: nonce,
        });
        shell.openExternal(`${BC_AUTH_URL}?${params.toString()}`);
      });

      // 90 seconds is plenty for someone to authorize in the browser. The
      // old 5-minute timeout left users staring at a frozen "Connecting…"
      // spinner for ages if they closed the OAuth tab without completing.
      this.timeoutHandle = setTimeout(() => {
        this.pendingCallback?.({ error: 'Authorization timed out — please try again' });
      }, 90 * 1000);
    });
  }

  // Renderer-callable cancel for the OAuth flow. Used by Settings → Cancel
  // on the connect spinner so the user doesn't have to wait 90 s for the
  // timeout when they realised they don't have the credentials handy.
  cancelConnect(): void {
    if (!this.pendingCallback) return;
    this.pendingCallback({ error: 'Authorization cancelled' });
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.pendingCallback = null;
  }

  private async exchangeCodeForToken(creds: BasecampCredentials, code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const params = new URLSearchParams({
      type: 'web_server',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: BC_REDIRECT_URI,
      code,
    });
    const res = await fetch(`${BC_TOKEN_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'User-Agent': BC_USER_AGENT },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${body}`);
    }
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  private async refreshAccessToken(): Promise<string> {
    // If a refresh is already in flight, share its promise — Basecamp burns
    // the refresh_token on first use, so two parallel POSTs would race and
    // the loser would 401 → disconnect.
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const auth = this.getStoredAuth();
      const creds = this.getCredentials();
      if (!auth || !creds) throw new Error('Basecamp is not connected');

      const refreshToken = decrypt(auth.refreshToken);
      const params = new URLSearchParams({
        type: 'refresh',
        refresh_token: refreshToken,
        client_id: creds.clientId,
        redirect_uri: BC_REDIRECT_URI,
        client_secret: creds.clientSecret,
      });
      const res = await fetch(`${BC_TOKEN_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'User-Agent': BC_USER_AGENT },
      });
      if (!res.ok) {
        const body = await res.text();
        // Forced disconnect — fire a distinct event so the renderer can
        // surface a persistent "session expired, reconnect" banner instead
        // of silently entering the disconnected state. authChanged still
        // fires too, for state-update consumers.
        this.disconnect();
        this.emit('reauthRequired');
        throw new Error(`Token refresh failed (${res.status}): ${body}`);
      }
      const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };

      const updated: StoredAuth = {
        ...auth,
        accessToken: encrypt(data.access_token),
        refreshToken: data.refresh_token ? encrypt(data.refresh_token) : auth.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };
      store.set('basecampAuth', updated);
      this.emit('authChanged');
      return data.access_token;
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  private async fetchAuthInfo(accessToken: string): Promise<{
    accounts: BasecampAccount[];
    identity: { id: number; firstName: string; lastName: string; emailAddress: string };
  }> {
    const res = await fetch(BC_AUTH_INFO_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': BC_USER_AGENT,
      },
    });
    if (!res.ok) throw new Error(`Failed to fetch authorization info (${res.status})`);
    const data = await res.json() as {
      accounts: Array<{ id: number; name: string; href: string; product: string }>;
      identity: { id: number; first_name: string; last_name: string; email_address: string };
    };
    return {
      accounts: data.accounts,
      identity: {
        id: data.identity.id,
        firstName: data.identity.first_name,
        lastName: data.identity.last_name,
        emailAddress: data.identity.email_address,
      },
    };
  }
}
