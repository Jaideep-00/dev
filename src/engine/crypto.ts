import type { AuthorId, LocalIdentity, RoomId } from './types';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function randomRoomId(): RoomId {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function generateRoomKeyBase64(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return bytesToBase64(raw);
}

/** Generate an ECDSA P-256 identity keypair using real Web Crypto API. */
export async function generateIdentityKeypair(
  displayName: string,
  listenAddr: string = '192.168.1.42:4000',
): Promise<LocalIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const pubRaw = new TextEncoder().encode(JSON.stringify({ x: publicKeyJwk.x, y: publicKeyJwk.y }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pubRaw));
  const authorId: AuthorId = bytesToHex(digest.slice(0, 16));

  return {
    authorId,
    displayName: displayName.trim(),
    createdAtMs: Date.now(),
    publicKeyJwk,
    privateKeyJwk,
    listenAddr,
  };
}

export async function signPayload(privateKeyJwk: JsonWebKey, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return bytesToHex(new Uint8Array(sig));
}

export async function verifyPayload(
  publicKeyJwk: JsonWebKey,
  payload: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const sigBytes = new Uint8Array(signatureHex.length / 2);
    for (let i = 0; i < sigBytes.length; i++) {
      sigBytes[i] = parseInt(signatureHex.slice(i * 2, i * 2 + 2), 16);
    }
    const data = new TextEncoder().encode(payload);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, data);
  } catch {
    return false;
  }
}

/** Real AES-256-GCM room message encryption bound to room/epoch/author/seq AAD. */
export async function encryptRoomPayload(
  roomKeyBase64: string,
  aad: string,
  plaintext: string,
): Promise<string> {
  const keyBytes = base64ToBytes(roomKeyBase64);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(aad),
    },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return bytesToHex(combined);
}

/** 5-minute rotating discovery token derived from room key via HMAC-SHA256. */
export async function deriveDiscoveryToken(
  roomKeyBase64: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const windowId = Math.floor(nowMs / 1000 / 300);
  const keyBytes = base64ToBytes(roomKeyBase64);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = new TextEncoder().encode(`discover:${windowId}`);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
  return bytesToHex(mac.slice(0, 8));
}

export interface EncryptedIdentityBackup {
  format: 'devchat-identity-backup-v1';
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  exportedAt: string;
}

/** Passphrase-encrypted identity backup using PBKDF2-SHA256 + AES-256-GCM. */
export async function exportEncryptedIdentityBackup(
  identity: LocalIdentity,
  passphrase: string,
): Promise<EncryptedIdentityBackup> {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const encoded = new TextEncoder().encode(JSON.stringify(identity));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, encoded);

  return {
    format: 'devchat-identity-backup-v1',
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(ct)),
    exportedAt: new Date().toISOString(),
  };
}

export async function importEncryptedIdentityBackup(
  backup: EncryptedIdentityBackup,
  passphrase: string,
): Promise<LocalIdentity> {
  if (backup.format !== 'devchat-identity-backup-v1') {
    throw new Error('Unrecognized backup file format.');
  }
  const salt = base64ToBytes(backup.saltBase64);
  const iv = base64ToBytes(backup.ivBase64);
  const ct = base64ToBytes(backup.ciphertextBase64);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
  return JSON.parse(new TextDecoder().decode(plain)) as LocalIdentity;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(digest));
}
