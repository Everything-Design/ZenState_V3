#!/usr/bin/env node
/**
 * ZenState License Key Generator
 *
 * Generates Ed25519-signed license keys for ZenState Pro.
 *
 * First run: generates a keypair in scripts/keys/
 * Subsequent runs: signs license payloads with the existing private key.
 *
 * Usage:
 *   node scripts/generate-license.js --team "Acme Corp" --seats 10 --expires 2027-01-01 --features pro
 *
 * The generated license key is a single string: base64(signature).base64(payload)
 * Users paste this into the app's license activation field.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

// ── Parse CLI arguments ────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      parsed[key] = value;
    }
  }

  return parsed;
}

// ── Ensure keypair exists ──────────────────────────────────────

function ensureKeypair() {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return;
  }

  console.log('Generating Ed25519 keypair...');
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf-8');
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf-8');

  console.log(`Private key saved: ${PRIVATE_KEY_PATH}`);
  console.log(`Public key saved:  ${PUBLIC_KEY_PATH}`);
  console.log('');
  console.log('IMPORTANT: Update the PUBLIC_KEY constant in');
  console.log('  src/main/services/licenseManager.ts');
  console.log('with the contents of public.pem');
  console.log('');
}

// ── Generate license key ───────────────────────────────────────

function generateLicense(opts) {
  const { team, seats, expires, features } = opts;

  if (!team) {
    console.error('Error: --team is required');
    process.exit(1);
  }

  const isLifetime = opts.lifetime === true || expires === 'lifetime' || expires === 'never';
  const expiresAt = isLifetime
    ? '9999-12-31'
    : (expires || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  const payload = {
    teamName: team,
    seats: parseInt(seats) || 1,
    expiresAt,
    features: features ? features.split(',') : ['pro'],
    issuedAt: new Date().toISOString(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBuffer = Buffer.from(payloadJson, 'utf-8');

  // Read private key
  const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');

  // Sign with Ed25519
  const signature = crypto.sign(null, payloadBuffer, privateKeyPem);

  // Compose license key: base64(signature).base64(payload)
  const licenseKey = `${signature.toString('base64')}.${payloadBuffer.toString('base64')}`;

  console.log('License key generated successfully!');
  console.log('');
  console.log('Payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');
  console.log('License Key:');
  console.log(licenseKey);
  console.log('');
}

// ── Main ───────────────────────────────────────────────────────

const args = parseArgs();

if (args.help) {
  console.log('Usage: node scripts/generate-license.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --team <name>       Team/company name (required)');
  console.log('  --seats <number>    Number of seats (default: 1)');
  console.log('  --expires <date>    Expiry date YYYY-MM-DD (default: 1 year from now)');
  console.log('  --lifetime          Generate a lifetime license (no expiry)');
  console.log('  --features <list>   Comma-separated features (default: pro)');
  console.log('  --show-public-key   Print the public key for embedding in the app');
  console.log('  --help              Show this help');
  process.exit(0);
}

ensureKeypair();

if (args['show-public-key']) {
  const pubKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
  console.log('Public key (embed in licenseManager.ts):');
  console.log(pubKey);
  process.exit(0);
}

if (!args.team) {
  console.log('No --team specified. Run with --help for usage.');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/generate-license.js --team "Acme Corp" --seats 10 --expires 2027-01-01 --features pro');
  process.exit(0);
}

generateLicense(args);
