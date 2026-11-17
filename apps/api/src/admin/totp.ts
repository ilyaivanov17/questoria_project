import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ISSUER = 'Questoria';

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function encryptTotpSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptTotpSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const packed = Buffer.from(encrypted, 'base64url');
  if (packed.length < 29) throw new Error('Invalid encrypted MFA secret.');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createTotpCode(secret: string, timeMs = Date.now()): string {
  const counter = Math.floor(timeMs / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string, timeMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code, 'ascii');

  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(createTotpCode(secret, timeMs + offset), 'ascii');
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

function getEncryptionKey(): Buffer {
  const value = process.env.MFA_ENCRYPTION_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key.');
  }
  return Buffer.from(value, 'hex');
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 MFA secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
