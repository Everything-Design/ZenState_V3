import crypto from 'crypto';
import os from 'os';
import Store from 'electron-store';
import { LicensePayload, LicenseState } from '../../shared/types';

// Ed25519 public key for license verification (PEM format)
// The corresponding private key is kept offline in scripts/keys/private.pem
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABXgyBC5XyfT9osUW9RChFwHGH7EIgIP03nEX8Ei7lmY=
-----END PUBLIC KEY-----`;

const licenseStore = new Store({
  name: 'zenstate-license',
  defaults: {
    licenseKey: null as string | null,
    deviceId: null as string | null,
  },
});

/**
 * Generate a stable device fingerprint from hostname + username + platform + arch.
 * This doesn't change unless the OS is reinstalled or the machine is swapped.
 */
function getDeviceFingerprint(): string {
  const raw = `${os.hostname()}:${os.userInfo().username}:${os.platform()}:${os.arch()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export class LicenseManager {
  private cachedState: LicenseState | null = null;

  /**
   * Activate a license key. Validates the signature, checks expiry,
   * stores the key if valid, and returns the resulting state.
   * Admin keys are locked to the first device they're activated on.
   */
  activateLicense(key: string): LicenseState {
    const state = this.validateKey(key);
    if (state.isValid) {
      const isAdminKey = state.payload?.features.includes('admin') ?? false;

      if (isAdminKey) {
        const currentDevice = getDeviceFingerprint();
        const storedDevice = licenseStore.get('deviceId') as string | null;

        if (storedDevice && storedDevice !== currentDevice) {
          // Admin key already activated on a different device
          return {
            isValid: false,
            isPro: false,
            isAdmin: false,
            payload: state.payload,
            error: 'This admin license is already activated on another device',
          };
        }

        // Lock to this device
        licenseStore.set('deviceId', currentDevice);
      }

      licenseStore.set('licenseKey', key);
    }
    this.cachedState = state;
    return state;
  }

  /**
   * Get the current license state. Reads the stored key (if any),
   * validates it, and returns the state.
   */
  getLicenseState(): LicenseState {
    if (this.cachedState) return this.cachedState;

    const storedKey = licenseStore.get('licenseKey') as string | null;
    if (!storedKey) {
      const free: LicenseState = { isValid: false, isPro: false, isAdmin: false, payload: null };
      this.cachedState = free;
      return free;
    }

    const state = this.validateKey(storedKey);

    // For admin keys, verify device fingerprint matches
    if (state.isValid && state.isAdmin) {
      const storedDevice = licenseStore.get('deviceId') as string | null;
      const currentDevice = getDeviceFingerprint();
      if (storedDevice && storedDevice !== currentDevice) {
        const locked: LicenseState = {
          isValid: false,
          isPro: false,
          isAdmin: false,
          payload: state.payload,
          error: 'This admin license is already activated on another device',
        };
        this.cachedState = locked;
        return locked;
      }
    }

    this.cachedState = state;
    return state;
  }

  /**
   * Remove the stored license key and revert to free tier.
   */
  deactivateLicense(): void {
    licenseStore.set('licenseKey', null);
    licenseStore.set('deviceId', null);
    this.cachedState = { isValid: false, isPro: false, isAdmin: false, payload: null };
  }

  /**
   * Check if a specific feature is enabled under the current license.
   */
  isFeatureEnabled(feature: string): boolean {
    const state = this.getLicenseState();
    if (!state.isValid || !state.payload) return false;
    return state.payload.features.includes(feature) || state.payload.features.includes('pro');
  }

  /**
   * Check if the current license grants Pro access.
   */
  isPro(): boolean {
    return this.getLicenseState().isPro;
  }

  /**
   * Invalidate cached state so next getLicenseState() re-validates.
   */
  clearCache(): void {
    this.cachedState = null;
  }

  // ── Internal ─────────────────────────────────────────────────

  private validateKey(key: string): LicenseState {
    try {
      const dotIndex = key.indexOf('.');
      if (dotIndex === -1) {
        return { isValid: false, isPro: false, isAdmin: false, payload: null, error: 'Invalid license key format' };
      }

      const signatureB64 = key.substring(0, dotIndex);
      const payloadB64 = key.substring(dotIndex + 1);

      // Decode
      const signature = Buffer.from(signatureB64, 'base64');
      const payloadBytes = Buffer.from(payloadB64, 'base64');

      // Verify Ed25519 signature
      const isVerified = crypto.verify(
        null, // Ed25519 doesn't use a separate hash algorithm
        payloadBytes,
        PUBLIC_KEY,
        signature,
      );

      if (!isVerified) {
        return { isValid: false, isPro: false, isAdmin: false, payload: null, error: 'Invalid license key signature' };
      }

      // Parse payload
      const payload: LicensePayload = JSON.parse(payloadBytes.toString('utf-8'));

      // Check expiry
      const expiresAt = new Date(payload.expiresAt);
      if (isNaN(expiresAt.getTime())) {
        return { isValid: false, isPro: false, isAdmin: false, payload, error: 'Invalid expiry date in license' };
      }
      if (expiresAt < new Date()) {
        return { isValid: false, isPro: false, isAdmin: false, payload, error: `License expired on ${expiresAt.toLocaleDateString()}` };
      }

      // Valid! Determine flags
      const isPro = payload.features.includes('pro');
      const isAdmin = payload.features.includes('admin');

      return { isValid: true, isPro, isAdmin, payload };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error validating license';
      return { isValid: false, isPro: false, isAdmin: false, payload: null, error: message };
    }
  }
}
