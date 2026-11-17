import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`Failed to start ${command}: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
