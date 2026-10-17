import { PortalClient, PortalError } from './portal.mjs';

export const tools = [
  { name: 'search_judgments', description: 'البحث في الأحكام المنشورة بالبوابة القانونية السعودية وإرجاع بياناتها من المصدر. قد يرفض المصدر الطلبات البرمجية.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', maxLength: 200 }, judgment_number: { type: 'string', maxLength: 100 },
      court_type: { type: 'integer', minimum: 0, maximum: 3, description: 'قيمة تصنيف المحكمة من البوابة؛ 0 هو المسار العام المرصود.' },
      page: { type: 'integer', minimum: 1, maximum: 1000 }, page_size: { type: 'integer', minimum: 1, maximum: 20 }
    }, additionalProperties: false } },
  { name: 'get_judgment', description: 'قراءة نص حكم باستخدام معرف مصدره نتيجة بحث البوابة، مع رابط المصدر ووقت الجلب.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 300 },
      court_type: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['id'], additionalProperties: false } },
  { name: 'portal_status', description: 'يعرض حالة التحقق والتفعيل؛ لا ينفذ طلبًا إلى الوزارة.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handle(request, env = {}, client = new PortalClient()) {
  if (new URL(request.url).pathname !== '/mcp') return reply({
    name: 'موصل البوابة القانونية السعودية', version: '0.1.0',
    state: env.PORTAL_ACCESS_ENABLED === 'true' ? 'enabled' : 'disabled', note: 'استخدم portal_status للتحقق من نجاح الجلب في جلسة الخادم الحالية.'
  });
  if (request.method !== 'POST') return reply({ error: 'POST required' }, 405);
  let rpc;
  try { rpc = await request.json(); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  if (rpc.method.startsWith('notifications/') && rpc.id === undefined) return new Response(null, { status: 202 });
  const ok = result => reply({ jsonrpc: '2.0', id: rpc.id ?? null, result });
  if (rpc.method === 'server/discover') return ok({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
  if (rpc.method === 'initialize') return ok({ protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'].includes(rpc.params?.protocolVersion) ? rpc.params.protocolVersion : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'saudi-judicial-portal', version: '0.2.0' } });
  if (rpc.method === 'ping') return ok({});
  if (rpc.method === 'tools/list') return ok({ tools });
  if (rpc.method !== 'tools/call') return reply({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'Method not found' } });
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  try {
    const name = rpc.params?.name;
    const schema = tools.find(t => t.name === name)?.inputSchema;
    if (!schema) throw new PortalError('UNKNOWN_TOOL', 'الأداة المطلوبة غير موجودة.');
    const args = rpc.params.arguments ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args) || Object.keys(args).some(k => !(k in schema.properties))) {
      throw new PortalError('INVALID_INPUT', 'معاملات الأداة غير صالحة.');
    }
    if (name === 'portal_status') return ok(result({ state: env.PORTAL_ACCESS_ENABLED === 'true' ? 'enabled' : 'disabled',
      upstream_enabled: env.PORTAL_ACCESS_ENABLED === 'true',
      verified_in_this_process: client.verification,
      connected_verified: Boolean(client.verification?.search && client.verification?.judgment) }));
    if (env.PORTAL_ACCESS_ENABLED !== 'true') throw new PortalError('ACCESS_NOT_VERIFIED',
      'الجلب معطل افتراضيًا بعد رفض المصدر للاختبار. يلزم تأكيد إتاحة الوصول مع الجهة المشغلة ثم إجراء اختبار ناجح قبل التفعيل.');
    return ok(result(name === 'search_judgments' ? await client.search(args) : await client.judgment(args)));
  } catch (error) {
    return ok({ ...result({ code: error instanceof PortalError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof PortalError ? error.message : 'تعذر إكمال الطلب.',
      ...(error.supportId ? { support_id: error.supportId } : {}) }), isError: true });
  }
}

export default { fetch(request, env) { return handle(request, env); } };
