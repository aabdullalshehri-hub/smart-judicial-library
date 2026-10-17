import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('stdio starts, negotiates MCP and discovers tools without network', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/stdio.mjs', import.meta.url))], {
    env: { ...process.env, PORTAL_ACCESS_ENABLED: 'false' }, stdio: ['pipe', 'pipe', 'pipe']
  });
  let out = '', err = '';
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  const deadline = setTimeout(() => child.kill(), 5000);
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  for (const rpc of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'portal_status', arguments: {} } }
  ]) child.stdin.write(JSON.stringify(rpc) + '\n');
  child.stdin.end();
  const code = await exited; clearTimeout(deadline);
  assert.equal(code, 0, err);
  const replies = out.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, 3);
  assert.equal(replies[0].result.protocolVersion, '2025-11-25');
  assert.deepEqual(replies[1].result.tools.map(t => t.name), ['search_judgments', 'get_judgment', 'portal_status']);
  assert.equal(JSON.parse(replies[2].result.content[0].text).upstream_enabled, false);
});
