type Environment = NodeJS.ProcessEnv;

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function validateProductionEnvironment(env: Environment = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];

  const errors: string[] = [];
  validateDatabaseUrl(env.DATABASE_URL, errors);
  validateHttpsOrigin('WEB_ORIGIN', env.WEB_ORIGIN, errors);
  validateHttpsOrigin('NEXT_PUBLIC_SITE_URL', env.NEXT_PUBLIC_SITE_URL, errors);

  if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== 'resend') {
    errors.push('EMAIL_PROVIDER must be explicitly set to "resend" in production.');
  }
  if (!env.RESEND_API_KEY?.trim()) errors.push('RESEND_API_KEY is required in production.');
  if (!isValidEmailSender(env.EMAIL_FROM?.trim() ?? '')) {
    errors.push('EMAIL_FROM must contain a valid sender email address.');
  }
  if (!/^[a-fA-F0-9]{64}$/.test(env.MFA_ENCRYPTION_KEY ?? '')) {
    errors.push('MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key (64 characters).');
  }
  return errors;
}

export function assertProductionEnvironment(env: Environment = process.env): void {
  const errors = validateProductionEnvironment(env);
  if (errors.length) {
    throw new Error(
      ['Production environment validation failed:', ...errors.map((error) => '- ' + error)].join('\n'),
    );
  }
}

function validateDatabaseUrl(value: string | undefined, errors: string[]): void {
  if (!value?.trim()) {
    errors.push('DATABASE_URL is required in production.');
    return;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const loopback = LOCAL_DATABASE_HOSTS.has(hostname) ||
      hostname.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      errors.push('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
    }
    if (!url.hostname || loopback) {
      errors.push('DATABASE_URL must point to a non-local PostgreSQL host in production.');
    }
    if (!url.username || !url.password) {
      errors.push('DATABASE_URL must include a database username and password.');
    }
  } catch {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
}

function validateHttpsOrigin(
  name: 'WEB_ORIGIN' | 'NEXT_PUBLIC_SITE_URL',
  value: string | undefined,
  errors: string[],
): void {
  if (!value?.trim()) {
    errors.push(name + ' is required in production.');
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') errors.push(name + ' must use HTTPS in production.');
    if (!url.hostname || url.username || url.password) {
      errors.push(name + ' must be a valid HTTPS origin without credentials.');
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      errors.push(name + ' must contain only the origin, without a path, query, or fragment.');
    }
  } catch {
    errors.push(name + ' must be a valid absolute HTTPS URL.');
  }
}

function isValidEmailSender(value: string): boolean {
  if (!value || /[\r\n]/.test(value)) return false;
  const bracketedAddress = value.match(/<([^<>]+)>/);
  if ((value.includes('<') || value.includes('>')) && (!bracketedAddress || !value.endsWith('>'))) {
    return false;
  }
  const address = bracketedAddress?.[1] ?? value;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address);
}
