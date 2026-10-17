import { createInterface } from 'node:readline';
import { handle } from './worker.mjs';
import { PortalClient } from './portal.mjs';

// MCP newline-delimited JSON over stdio. stdout is reserved for protocol data.
const client = new PortalClient();
const env = { PORTAL_ACCESS_ENABLED: process.env.PORTAL_ACCESS_ENABLED ?? 'false' };
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const response = await handle(new Request('http://mcp.local/mcp', { method: 'POST', body: line }), env, client);
    if (response.status !== 202) process.stdout.write(await response.text() + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } }) + '\n');
  }
}
