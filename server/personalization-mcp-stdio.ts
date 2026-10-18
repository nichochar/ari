import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const endpoint = process.env.ARI_WORKSPACE_MCP_URL;
const token = process.env.ARI_WORKSPACE_MCP_TOKEN;
// This child receives a scoped capability, never access to the workspace itself.
delete process.env.ARI_WORKSPACE_MCP_TOKEN;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !token) process.exit(1);
const instance = randomUUID();
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(value: unknown) { process.stdout.write(JSON.stringify(value) + '\n'); }
function error(id: unknown, code: number, message: string) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
async function call(path: string, body?: unknown): Promise<JsonObject> {
  const response = await fetch(endpoint + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error('Tool session unavailable');
  const result: unknown = await response.json();
  if (!object(result)) throw new Error('Invalid tool response');
  return result;
}
async function handle(line: string) {
  if (Buffer.byteLength(line) > 512 * 1024) { error(null, -32600, 'Tool request is too large.'); return; }
  let message: unknown;
  try { message = JSON.parse(line); } catch { error(null, -32700, 'Invalid JSON.'); return; }
  if (!object(message)) { error(null, -32600, 'Invalid request.'); return; }
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method } = message;
  if (message.jsonrpc !== '2.0' || (typeof id !== 'string' && typeof id !== 'number') || typeof method !== 'string') {
    error(null, -32600, 'Invalid request.'); return;
  }
  const respond = (result: unknown) => send({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') {
    respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ari-workspace', version: '1.0.0' } }); return;
  }
  if (method === 'ping') { respond({}); return; }
  if (method !== 'tools/list' && method !== 'tools/call') { error(id, -32601, 'Unknown method.'); return; }
  try {
    if (method === 'tools/list') { respond(await call('/tools')); return; }
    const params = message.params;
    if (!object(params) || typeof params.name !== 'string' || (params.arguments !== undefined && !object(params.arguments))) {
      error(id, -32602, 'Invalid tool arguments.'); return;
    }
    const result = await call('/call', { name: params.name, arguments: params.arguments ?? {}, callId: `mcp:${instance}:${id}` });
    if (typeof result.error === 'string') { respond({ content: [{ type: 'text', text: result.error }], isError: true }); return; }
    const value = result.result;
    if (object(value) && value.type === 'image_result' && Array.isArray(value.images)) {
      const images = value.images.slice(0, 3).flatMap(image => {
        const match = typeof image === 'string' && /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(image);
        return match ? [{ type: 'image', mimeType: match[1], data: match[2] }] : [];
      });
      respond({ content: [{ type: 'text', text: String(value.text ?? '') }, ...images] });
    } else respond({ content: [{ type: 'text', text: JSON.stringify(value ?? null) }] });
  } catch { respond({ content: [{ type: 'text', text: 'This tutor tool session is unavailable. Retry to continue.' }], isError: true }); }
}
input.on('line', line => { void handle(line); });
