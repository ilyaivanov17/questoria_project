import { createHash, randomBytes } from 'node:crypto';

export const MFA_RECOVERY_CODE_COUNT = 10;

export interface GeneratedMfaRecoveryCodes {
  codes: string[];
  hashes: string[];
}

export function normalizeMfaRecoveryCode(code: string): string | null {
  const normalized = code.trim().replace(/[-\s]/g, '').toUpperCase();
  return /^[A-F0-9]{24}$/.test(normalized) ? normalized : null;
}

export function hashMfaRecoveryCode(code: string): string {
  const normalized = normalizeMfaRecoveryCode(code);
  if (!normalized) throw new Error('Invalid MFA recovery code format.');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function generateMfaRecoveryCodes(): GeneratedMfaRecoveryCodes {
  const codes = Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(12).toString('hex').toUpperCase();
    return raw.match(/.{6}/g)!.join('-');
  });

  return {
    codes,
    hashes: codes.map(hashMfaRecoveryCode),
  };
}
