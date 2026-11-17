type Environment = NodeJS.ProcessEnv;

const LOCAL_WEB_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

export function getWebOrigin(env: Environment = process.env): string {
  const configured = env.WEB_ORIGIN?.trim();
  const codespacesOrigin =
    env.CODESPACES === 'true' && env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ? `https://${env.CODESPACE_NAME}-3000.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
      : undefined;

  if (configured) {
    const origin = new URL(configured).origin;
    if (!(codespacesOrigin && LOCAL_WEB_ORIGINS.has(origin))) {
      return origin;
    }
  }

  return codespacesOrigin ?? 'http://localhost:3000';
}
