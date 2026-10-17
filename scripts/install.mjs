import { spawnSync } from 'node:child_process';
import { access, cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'saudi_judicial_portal';
const entry = join(root, 'src', 'stdio.mjs');
const codex = process.platform === 'win32' ? 'codex.exe' : 'codex';
const skillSource = join(root, 'skills', 'qada');
const skillTarget = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'qada');
const args = ['mcp', 'add', name, '--env', 'PORTAL_ACCESS_ENABLED=true', '--', process.execPath, entry];
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required.');
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ mutation: false, command: codex, arguments: args, skillSource, skillTarget }, null, 2));
} else if (process.argv.includes('--install')) {
  const existing = spawnSync(codex, ['mcp', 'get', name, '--json'], { encoding: 'utf8', windowsHide: true });
  if (existing.error) throw new Error('Codex CLI was not found. Install Codex and make its CLI available in PATH.');
  let skillExists = false;
  try { await access(skillTarget); skillExists = true; } catch {}
  if ((existing.status === 0 || skillExists) && !process.argv.includes('--replace')) {
    throw new Error('An existing connector or qada skill was found. Inspect it first; use --replace only to explicitly replace it.');
  }
  const installed = spawnSync(codex, args, { encoding: 'utf8', windowsHide: true });
  if (installed.status !== 0) throw new Error('MCP registration failed: ' + (installed.stderr || installed.error?.message || 'unknown error'));
  await mkdir(dirname(skillTarget), { recursive: true });
  await cp(skillSource, skillTarget, { recursive: true, force: process.argv.includes('--replace') });
  const check = spawnSync(codex, ['mcp', 'get', name, '--json'], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0) throw new Error('Registration could not be read back.');
  console.log('Installed: saudi_judicial_portal + $qada. Restart Codex to load them.');
  console.log('This confirms installation only; run a search and read a judgment to verify upstream access.');
} else {
  console.log('Usage: node scripts/install.mjs --dry-run | --install [--replace]');
}
