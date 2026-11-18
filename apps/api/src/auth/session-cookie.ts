export const SESSION_COOKIE_NAME = 'questoria_session';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_COOKIE_HEADER_LENGTH = 8_192;

/**
 * Reads the opaque session token without allowing malformed percent-encoding
 * or duplicate session-cookie names to escape into request handling.
 */
export function parseSessionCookie(header: string | undefined): string | null {
  if (!header || header.length > MAX_COOKIE_HEADER_LENGTH) return null;

  let sessionToken: string | null = null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    // Duplicate cookie names are ambiguous and should never authenticate.
    if (sessionToken !== null) return null;

    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }

    if (!SESSION_TOKEN_PATTERN.test(value)) return null;
    sessionToken = value;
  }

  return sessionToken;
}
