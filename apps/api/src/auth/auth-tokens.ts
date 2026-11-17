import { createHash, randomBytes } from 'node:crypto';

export interface OpaqueToken {
  token: string;
  tokenHash: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(): OpaqueToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOpaqueToken(token) };
}
