import { EventEmitter } from 'events';
import { BasecampOAuth } from './oauth';
import { BasecampApi } from './api';
import { BasecampAuthState, BasecampCredentials } from '../../../shared/types';

export type BasecampServiceEvent = 'authChanged';

export class BasecampService extends EventEmitter {
  readonly oauth = new BasecampOAuth();
  readonly api = new BasecampApi(this.oauth);

  constructor() {
    super();
    // Re-emit auth changes so the IPC layer can broadcast to renderers.
    this.oauth.on('authChanged', () => this.emit('authChanged', this.getAuthState()));
  }

  getAuthState(): BasecampAuthState {
    const stored = this.oauth.getStoredAuth();
    if (!stored) return { isConnected: false };
    return {
      isConnected: true,
      account: stored.account,
      identity: stored.identity,
      expiresAt: stored.expiresAt,
    };
  }

  getCredentials(): BasecampCredentials | null {
    return this.oauth.getCredentials();
  }

  saveCredentials(creds: BasecampCredentials): void {
    this.oauth.saveCredentials(creds);
  }

  async connect(): Promise<void> {
    await this.oauth.connect();
  }

  disconnect(): void {
    this.oauth.disconnect();
  }
}
