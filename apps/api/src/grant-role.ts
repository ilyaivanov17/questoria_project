import 'dotenv/config';
import { Pool } from 'pg';

const [emailArg, roleArg] = process.argv.slice(2);
const allowedRoles = new Set(['AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN']);
const email = emailArg?.trim().toLowerCase();
const role = roleArg?.trim().toUpperCase();

if (process.env.QUESTORIA_ALLOW_ROLE_GRANT !== '1') {
  throw new Error('Set QUESTORIA_ALLOW_ROLE_GRANT=1 to enable explicit role assignment.');
}
if (!email || !role || !allowedRoles.has(role)) {
  throw new Error('Usage: QUESTORIA_ALLOW_ROLE_GRANT=1 pnpm --filter @questoria/api admin:grant-role <email> <AUTHOR|REVIEWER|ADMIN|SUPER_ADMIN>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = $1 FOR UPDATE',
      [email],
    );
    if (!user.rows[0]) throw new Error('No registered user found for this email.');

    const roleRow = await client.query<{ id: string }>(
      'SELECT id FROM roles WHERE key = $1',
      [role],
    );
    if (!roleRow.rows[0]) throw new Error('Role definitions are missing; run pnpm db:seed first.');

    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [user.rows[0].id, roleRow.rows[0].id],
    );
    await client.query(
      `INSERT INTO admin_audit_logs
       (id, actor_user_id, action, entity_type, entity_id, after_json, reason)
       VALUES (gen_random_uuid(), NULL, 'security.role.granted.bootstrap', 'USER', $1, $2::jsonb, $3)`,
      [user.rows[0].id, JSON.stringify({ email, role }), 'Explicit one-off command-line role bootstrap'],
    );
    await client.query('COMMIT');
    process.stdout.write(`Granted ${role} to ${email}.\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

run()
  .catch((error: unknown) => {
    console.error('Role grant failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
