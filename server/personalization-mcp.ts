import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { LearningTool } from './learning-provider.js';

const allowed = new Set(['workspace_list', 'workspace_read', 'workspace_search', 'workspace_write', 'workspace_edit', 'workspace_move', 'workspace_delete', 'complete_onboarding']);
const readOnly = new Set(['workspace_list', 'workspace_read', 'workspace_search']);
const maximumBodyBytes = 512 * 1024;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Run-scoped tools for native threads whose original dynamic catalog is immutable. */
export async function createWorkspaceMcpBridge(tools: LearningTool[], execute: (name: string, args: unknown, callId: string) => Promise<unknown>): Promise<{
  config: Record<string, unknown>; close(): Promise<void>;
}> {
  const selected = new Map(tools.filter(tool => allowed.has(tool.name)).map(tool => [tool.name, tool]));
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from('Bearer ' + token);
  let closed = false;
  const pending = new Set<Promise<unknown>>();
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      if (response.destroyed) return;
      const body = JSON.stringify(value);
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(body);
    };
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (closed || supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      send(401, { error: 'This tool session is unavailable.' }); return;
    }
    if (request.method === 'GET' && request.url === '/tools') {
      send(200, { tools: [...selected.values()].map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters,
        annotations: { readOnlyHint: readOnly.has(tool.name), destructiveHint: !readOnly.has(tool.name) && tool.name !== 'complete_onboarding', idempotentHint: readOnly.has(tool.name), openWorldHint: false },
      })) }); return;
    }
    if (request.method !== 'POST' || request.url !== '/call') { send(404, { error: 'Unknown tool request.' }); return; }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { send(415, { error: 'Tool arguments must be JSON.' }); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maximumBodyBytes) { send(413, { error: 'Tool request is too large.' }); return; }
        chunks.push(Buffer.from(chunk));
      }
    } catch { send(400, { error: 'Could not read the tool request.' }); return; }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { error: 'Tool arguments must be JSON.' }); return; }
    if (!object(input) || typeof input.name !== 'string' || !selected.has(input.name) ||
      typeof input.callId !== 'string' || !input.callId || input.callId.length > 200 || !object(input.arguments)) {
      send(400, { error: 'This tool request is unavailable or invalid.' }); return;
    }
    if (pending.size >= 64) { send(429, { error: 'The tutor has too many tool requests. Retry shortly.' }); return; }
    const task = Promise.resolve().then(() => execute(input.name as string, input.arguments, input.callId as string));
    pending.add(task);
    try { send(200, { result: await task }); }
    catch { send(200, { error: 'Ari could not complete this tool call. Retry to continue.' }); }
    finally { pending.delete(task); }
  });
  server.requestTimeout = 180_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  server.unref();
  const onExit = () => { closed = true; server.closeAllConnections(); server.close(); };
  process.once('exit', onExit);
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open the local tutor tools.'); }
  const config = {
    mcp_servers: { ari_workspace: {
      command: process.execPath,
      args: ['--import', fileURLToPath(import.meta.resolve('tsx')), fileURLToPath(new URL('./personalization-mcp-stdio.ts', import.meta.url))],
      env: { ARI_WORKSPACE_MCP_URL: `http://127.0.0.1:${address.port}`, ARI_WORKSPACE_MCP_TOKEN: token },
      enabled: true, required: true, startup_timeout_sec: 15, tool_timeout_sec: 180,
      enabled_tools: [...selected.keys()], default_tools_approval_mode: 'prompt',
      // The application has already authorized these bounded, path-scoped tools.
      // Keep the server default restrictive and grant only this exact catalog.
      tools: Object.fromEntries([...selected.keys()].map(name => [name, { approval_mode: 'approve' }])),
    } },
  };
  let closePromise: Promise<void> | undefined;
  return { config, close() {
    return closePromise ??= (async () => {
      closed = true;
      process.removeListener('exit', onExit);
      const stopped = new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.allSettled([...pending]);
      server.closeAllConnections(); await stopped;
    })();
  } };
}
