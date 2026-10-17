import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient } from '../src/portal.mjs';
import { handle } from '../src/worker.mjs';

const rpc = (name, args = {}) => new Request('https://connector.invalid/mcp', { method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
const portalResponse = model => Response.json({ statusCode: 200, success: true, model, errors: [] });

test('HTTP 200 rejection is an error, not an empty result; no retries', async () => {
  let count = 0;
  const client = new PortalClient(async () => { count++; return new Response('<title>Request Rejected</title>Your support ID is: 12345', { status: 200 }); });
  await assert.rejects(client.search({}), e => e.code === 'UPSTREAM_REJECTED' && e.supportId === '12345');
  assert.equal(count, 1);
});
test('HTML and changed JSON schemas are not accepted as search results', async () => {
  for (const response of [new Response('<html>login</html>'), Response.json({ error: 'denied' })]) {
    await assert.rejects(new PortalClient(async () => response).search({}), e => ['UNEXPECTED_RESPONSE', 'UPSTREAM_APPLICATION_ERROR', 'SCHEMA_CHANGED'].includes(e.code));
  }
});
test('Arabic query is preserved and identity is empty in a bounded request', async () => {
  let request;
  const client = new PortalClient(async (url, opts) => { request = { url, ...opts }; return portalResponse({ judgementsCollection: [], totalCount: 0 }); });
  const result = await client.search({ query: 'فسخ عقد', page_size: 3 });
  assert.equal(result.total_count, 0);
  assert.equal(JSON.parse(request.body).term, 'فسخ عقد');
  assert.equal(JSON.parse(request.body).identityNumber, '');
  assert.equal(request.redirect, 'error');
});
test('invalid input is rejected before network access', async () => {
  const client = new PortalClient(() => { throw new Error('Network must not be called'); });
  await assert.rejects(client.search({ page_size: 10000 }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(client.judgment({ id: '' }), e => e.code === 'INVALID_INPUT');
});
test('details must contain a real judgment text; special id is URL encoded', async () => {
  let url;
  const client = new PortalClient(async u => { url = u; return portalResponse({ judgmentTextofRulling: 'نص تجريبي للاختبار' }); });
  const data = await client.judgment({ id: 'abc+123/=' });
  assert.equal(new URL(url).searchParams.get('id'), 'abc+123/=');
  assert.match(data.source_url, /abc%2B123%2F%3D$/);
  await assert.rejects(new PortalClient(async () => portalResponse({})).judgment({ id: 'abc' }), e => e.code === 'SCHEMA_CHANGED');
});
test('MCP carries upstream failure as isError', async () => {
  const client = new PortalClient(async () => new Response('Request Rejected'));
  const data = await (await handle(rpc('search_judgments'), { PORTAL_ACCESS_ENABLED: 'true' }, client)).json();
  assert.equal(data.result.isError, true);
  assert.equal(JSON.parse(data.result.content[0].text).code, 'UPSTREAM_REJECTED');
});
test('default state cannot silently claim connectivity or send requests', async () => {
  const client = { search() { throw new Error('Unexpected network'); } };
  const blocked = await (await handle(rpc('search_judgments'), {}, client)).json();
  assert.equal(JSON.parse(blocked.result.content[0].text).code, 'ACCESS_NOT_VERIFIED');
  const status = await (await handle(rpc('portal_status'))).json();
  assert.equal(JSON.parse(status.result.content[0].text).connected_verified, false);
});
test('MCP discovery, tool inventory, and malformed requests', async () => {
  for (const method of ['server/discover', 'tools/list', 'initialize']) {
    const response = await handle(new Request('https://connector.invalid/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 2, method }) }));
    assert.ok((await response.json()).result);
  }
  assert.equal((await (await handle(new Request('https://connector.invalid/mcp', { method: 'POST', body: 'null' }))).json()).error.code, -32600);
  const unknown = await (await handle(rpc('search_judgments', { arbitrary_url: 'https://example.org' }), { PORTAL_ACCESS_ENABLED: 'true' })).json();
  assert.equal(JSON.parse(unknown.result.content[0].text).code, 'INVALID_INPUT');
});
test('unsuccessful application envelope cannot be mistaken for a judgment', async () => {
  const client = new PortalClient(async () => Response.json({ statusCode: 200, success: false,
    model: { judgmentTextofRulling: 'Not a successful result' } }));
  await assert.rejects(client.judgment({ id: 'abc' }), e => e.code === 'UPSTREAM_APPLICATION_ERROR');
});
test('status verifies both successful operations in the same process', async () => {
  const client = new PortalClient(async (_url, opts) => portalResponse(opts.method === 'POST'
    ? { judgementsCollection: [{ id: 'abc', courtType: 1 }], totalCount: 1 }
    : { judgmentTextofRulling: 'نص الاختبار' }));
  const env = { PORTAL_ACCESS_ENABLED: 'true' };
  await handle(rpc('search_judgments'), env, client);
  let status = JSON.parse((await (await handle(rpc('portal_status'), env, client)).json()).result.content[0].text);
  assert.equal(status.connected_verified, false);
  await handle(rpc('get_judgment', { id: 'abc', court_type: 1 }), env, client);
  status = JSON.parse((await (await handle(rpc('portal_status'), env, client)).json()).result.content[0].text);
  assert.equal(status.connected_verified, true);
});
