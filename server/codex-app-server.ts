import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, mkdir, readlink, realpath, stat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type CodexTransportErrorCode = 'CODEX_UNAVAILABLE' | 'CODEX_TIMEOUT' | 'CODEX_PROTOCOL' | 'CODEX_CLOSED' | 'CODEX_FAILED' | 'CODEX_AUTH' | 'CODEX_LIMIT' | 'CODEX_MODEL' | 'CODEX_UPGRADE';

/** Never retain server diagnostics, RPC parameters, or credential-bearing errors. */
export class CodexTransportError extends Error {
  constructor(readonly code: CodexTransportErrorCode) {
    super(code);
    this.name = 'CodexTransportError';
  }
}

export interface CodexNotification { method: string; params: unknown }
export interface CodexServerRequest extends CodexNotification { id: string | number }
type NotificationHandler = (notification: CodexNotification) => void | Promise<void>;
type RequestHandler = (request: CodexServerRequest) => unknown | Promise<unknown>;

export interface CodexAppServerClient {
  readonly cwd: string;
  readonly threadConfig: Record<string, unknown>;
  request<T = unknown>(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<T>;
  notify(method: string, params?: unknown): void;
  subscribe(handler: NotificationHandler): () => void;
  onNotification(handler: NotificationHandler): () => void;
  onRequest(handler: RequestHandler): () => void;
  onClose(handler: (error: CodexTransportError) => void): () => void;
  close(): void;
}

export interface CodexAppServerOptions {
  binary?: string;
  /** An empty app-owned runtime directory, never the repository or learner files. */
  cwd?: string;
  /** Isolates resumable model context from the desktop app while reusing sign-in. */
  stateDir?: string;
  /** Existing managed login home. Only auth-file metadata is inspected. */
  authHome?: string;
  requestTimeoutMs?: number;
  maxLineBytes?: number;
  maxPendingRequests?: number;
  maxQueuedEvents?: number;
  maxQueuedBytes?: number;
}

const disabledFeatures = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent',
  'browser_use', 'computer_use', 'image_generation', 'view_image',
  'code_mode', 'code_mode_only', 'code_mode_tool_search',
  'workspace_dependencies', 'in_app_browser',
  'browser_use_external', 'browser_use_full_cdp_access', 'remote_plugin',
  'memories', 'goals', 'skill_search',
];

export function codexAppServerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER']) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function codexAppServerArguments(stateDir?: string): string[] {
  return [
    'app-server', '--listen', 'stdio://',
    '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
    '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"',
    '-c', 'cli_auth_credentials_store="file"',
    '-c', 'web_search="live"', '-c', 'project_doc_max_bytes=0',
    '-c', 'instructions=""', '-c', 'developer_instructions=""',
    // The host dispatches app-provided tools as well as native tools. Keep the
    // dispatcher available while disabling the separate model JS tool surface.
    '--enable', 'code_mode_host',
    ...(stateDir ? ['-c', `sqlite_home=${JSON.stringify(resolve(stateDir))}`, '-c', `log_dir=${JSON.stringify(resolve(stateDir, 'logs'))}`] : []),
    ...disabledFeatures.flatMap(feature => ['--disable', feature]),
  ];
}

/** config/read is deliberately reduced to server names; no values leave this function. */
export function disabledMcpServerConfig(response: unknown): Record<string, unknown> {
  const config = isRecord(response) && isRecord(response.config) ? response.config : {};
  const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {};
  return { mcp_servers: Object.fromEntries(Object.keys(servers).map(name => [name, { enabled: false }])) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function privateCodexHome(stateDir: string, authHome: string): Promise<string> {
  const home = join(stateDir, 'home');
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Never use the desktop's home for model history, even through a directory link.
  const canonicalHome = await realpath(home);
  const canonicalAuthHome = await realpath(authHome).catch(() => resolve(authHome));
  if (canonicalHome === canonicalAuthHome) throw new CodexTransportError('CODEX_PROTOCOL');
  const privateAuth = join(home, 'auth.json');
  const sharedAuth = join(authHome, 'auth.json');
  try {
    const existing = await lstat(privateAuth);
    // Codex may replace a symlink during credential refresh. Preserve the
    // resulting private managed login, without reading or copying its contents.
    if (existing.isFile()) return home;
    if (existing.isSymbolicLink() && resolve(home, await readlink(privateAuth)) === sharedAuth) return home;
    throw new CodexTransportError('CODEX_AUTH');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  try {
    if (!(await stat(sharedAuth)).isFile()) throw new CodexTransportError('CODEX_AUTH');
    await symlink(sharedAuth, privateAuth, 'file');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const existing = await lstat(privateAuth);
      if (existing.isFile() || (existing.isSymbolicLink() && resolve(home, await readlink(privateAuth)) === sharedAuth)) return home;
    }
    // A keychain-only or missing login needs an explicit managed ChatGPT login;
    // API credentials are never a fallback and are never inspected here.
    throw new CodexTransportError('CODEX_AUTH');
  }
  return home;
}

function sanitizedRemoteError(value: unknown): CodexTransportError {
  const message = isRecord(value) && typeof value.message === 'string' ? value.message : '';
  const code: CodexTransportErrorCode = /usage limit|rate.limit|quota|credits/i.test(message) ? 'CODEX_LIMIT'
    : /requires a newer version/i.test(message) ? 'CODEX_UPGRADE'
      : /not supported.*ChatGPT|unknown model|model.*not found/i.test(message) ? 'CODEX_MODEL'
        : /log.?in|authentication|unauthorized|401/i.test(message) ? 'CODEX_AUTH' : 'CODEX_FAILED';
  return new CodexTransportError(code);
}

const activeChildren = new Set<ChildProcessWithoutNullStreams>();
function killChild(child: ChildProcessWithoutNullStreams) {
  // A detached child owns its process group, including any descendants.
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* Already exited, or a platform without process groups. */ }
  }
  try { child.kill('SIGKILL'); } catch { /* Already exited. */ }
}
process.once('exit', () => { for (const child of activeChildren) killChild(child); });

/** Bounded newline-delimited JSON-RPC, with response resolution outside the event queue. */
export async function createCodexAppServer(options: CodexAppServerOptions = {}): Promise<CodexAppServerClient> {
  const cwd = resolve(options.cwd ?? '.local/codex-app-server-runtime');
  const stateDir = resolve(options.stateDir ?? '.local/codex-app-server-state');
  const authHome = resolve(options.authHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  const maxLineBytes = options.maxLineBytes ?? 8 * 1024 * 1024;
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  const maxPending = options.maxPendingRequests ?? 64;
  const maxQueued = options.maxQueuedEvents ?? 1024;
  const maxQueuedBytes = options.maxQueuedBytes ?? 16 * 1024 * 1024;
  for (const bound of [maxLineBytes, requestTimeoutMs, maxPending, maxQueued, maxQueuedBytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new CodexTransportError('CODEX_PROTOCOL');
  }
  let codexHome: string;
  try {
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    codexHome = await privateCodexHome(stateDir, authHome);
  } catch (error) {
    throw error instanceof CodexTransportError ? error : new CodexTransportError('CODEX_UNAVAILABLE');
  }
  const configuredBinary = options.binary ?? process.env.CODEX_BIN ?? 'codex';
  const binary = configuredBinary.includes('/') ? resolve(configuredBinary) : configuredBinary;
  const child = spawn(binary, codexAppServerArguments(stateDir), {
    cwd, env: { ...codexAppServerEnvironment(), CODEX_HOME: codexHome }, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeChildren.add(child);
  let closed: CodexTransportError | undefined;
  let sequence = 0;
  let buffered = Buffer.alloc(0);
  let queue = Promise.resolve();
  let queued = 0;
  let queuedBytes = 0;
  let requestHandler: RequestHandler | undefined;
  let threadConfig: Record<string, unknown> = {};
  const subscribers = new Set<NotificationHandler>();
  const closeSubscribers = new Set<(error: CodexTransportError) => void>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: CodexTransportError) => void; timer: ReturnType<typeof setTimeout> }>();
  const stop = (error: CodexTransportError) => {
    if (closed) return;
    closed = error;
    buffered = Buffer.alloc(0);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    activeChildren.delete(child);
    killChild(child);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    for (const handler of closeSubscribers) { try { handler(error); } catch { /* Notification cannot prevent cleanup. */ } }
    closeSubscribers.clear();
    subscribers.clear();
    requestHandler = undefined;
  };
  const write = (message: unknown) => {
    if (closed) throw closed;
    let line: string;
    try { line = JSON.stringify(message) + '\n'; } catch { throw new CodexTransportError('CODEX_PROTOCOL'); }
    if (Buffer.byteLength(line) > maxLineBytes) throw new CodexTransportError('CODEX_PROTOCOL');
    // Cap queued writes too; slow/unresponsive children must not grow memory indefinitely.
    if (child.stdin.writableLength + Buffer.byteLength(line) > maxLineBytes * 2) {
      stop(new CodexTransportError('CODEX_PROTOCOL'));
      throw closed;
    }
    child.stdin.write(line, error => { if (error) stop(new CodexTransportError('CODEX_CLOSED')); });
  };
  const enqueue = (work: () => Promise<void>, bytes: number) => {
    queuedBytes += bytes;
    if (++queued > maxQueued || queuedBytes > maxQueuedBytes) { stop(new CodexTransportError('CODEX_PROTOCOL')); return; }
    queue = queue.then(async () => { if (!closed) await work(); }).catch(() => {
      stop(new CodexTransportError('CODEX_FAILED'));
    }).finally(() => { queued--; queuedBytes -= bytes; });
  };
  const handle = (message: unknown, bytes: number) => {
    if (!isRecord(message)) { stop(new CodexTransportError('CODEX_PROTOCOL')); return; }
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && (typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isSafeInteger(message.id)))) {
      stop(new CodexTransportError('CODEX_PROTOCOL')); return;
    }
    if (typeof message.method === 'string') {
      if (!message.method || message.method.length > 256) { stop(new CodexTransportError('CODEX_PROTOCOL')); return; }
      const event = { method: message.method, params: message.params };
      if (hasId) {
        const id = message.id as string | number;
        const handler = requestHandler;
        enqueue(async () => {
          if (event.method !== 'item/tool/call' || !handler) {
            write({ id, error: { code: -32601, message: 'This client does not permit this request.' } });
            return;
          }
          try {
            const result = await handler({ ...event, id });
            if (result === undefined) throw new CodexTransportError('CODEX_PROTOCOL');
            if (!closed) write({ id, result });
          } catch {
            if (!closed) write({ id, error: { code: -32603, message: 'Tool execution failed.' } });
          }
        }, bytes);
      } else {
        // Capture the listener set at receipt; later subscribers must not receive earlier events.
        const listeners = [...subscribers];
        enqueue(async () => { for (const handler of listeners) await handler(event); }, bytes);
      }
      return;
    }
    if (!hasId || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) {
      stop(new CodexTransportError('CODEX_PROTOCOL')); return;
    }
    const entry = pending.get(String(message.id));
    // Late replies after a timeout and replies to an already rejected request are harmless.
    if (!entry) return;
    pending.delete(String(message.id));
    clearTimeout(entry.timer);
    if (Object.hasOwn(message, 'error')) entry.reject(sanitizedRemoteError(message.error));
    else entry.resolve(message.result);
  };
  child.stdout.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffered = Buffer.concat([buffered, chunk]);
    let newline: number;
    while ((newline = buffered.indexOf(10)) >= 0) {
      if (newline > maxLineBytes) { stop(new CodexTransportError('CODEX_PROTOCOL')); return; }
      const line = buffered.subarray(0, newline).toString('utf8');
      buffered = buffered.subarray(newline + 1);
      if (!line.trim()) continue;
      try { handle(JSON.parse(line), newline); } catch { stop(new CodexTransportError('CODEX_PROTOCOL')); }
      if (closed) return;
    }
    if (buffered.length > maxLineBytes) stop(new CodexTransportError('CODEX_PROTOCOL'));
  });
  // Drain diagnostics without retaining them; they may contain sensitive user configuration.
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => stop(new CodexTransportError('CODEX_CLOSED')));
  child.stdout.on('error', () => stop(new CodexTransportError('CODEX_PROTOCOL')));
  child.stderr.on('error', () => stop(new CodexTransportError('CODEX_CLOSED')));
  child.on('error', () => stop(new CodexTransportError('CODEX_UNAVAILABLE')));
  child.on('close', code => stop(new CodexTransportError(code === 0 ? 'CODEX_CLOSED' : 'CODEX_FAILED')));
  const subscribe = (handler: NotificationHandler) => { subscribers.add(handler); return () => { subscribers.delete(handler); }; };
  const client: CodexAppServerClient = {
    cwd,
    get threadConfig() { return { ...threadConfig }; },
    request<T>(method: string, params: unknown, requestOptions?: { timeoutMs?: number }) {
      if (closed) return Promise.reject(closed);
      if (pending.size >= maxPending) return Promise.reject(new CodexTransportError('CODEX_PROTOCOL'));
      const timeoutMs = requestOptions?.timeoutMs ?? requestTimeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new CodexTransportError('CODEX_PROTOCOL'));
      const id = `ari-${++sequence}`;
      return new Promise<T>((resolveResult, reject) => {
        const timer = setTimeout(() => stop(new CodexTransportError('CODEX_TIMEOUT')), timeoutMs);
        pending.set(id, { resolve: value => resolveResult(value as T), reject, timer });
        try { write({ id, method, params }); } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof CodexTransportError ? error : new CodexTransportError('CODEX_PROTOCOL'));
        }
      });
    },
    notify(method, params) { write({ method, ...(params === undefined ? {} : { params }) }); },
    subscribe,
    onNotification: subscribe,
    onRequest(handler) {
      if (requestHandler) throw new CodexTransportError('CODEX_PROTOCOL');
      requestHandler = handler;
      return () => { if (requestHandler === handler) requestHandler = undefined; };
    },
    onClose(handler) {
      if (closed) handler(closed);
      else closeSubscribers.add(handler);
      return () => { closeSubscribers.delete(handler); };
    },
    close() { stop(new CodexTransportError('CODEX_CLOSED')); },
  };
  try {
    await client.request('initialize', {
      clientInfo: { name: 'ari_tutor', title: 'ARI tutor', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    client.notify('initialized');
    threadConfig = disabledMcpServerConfig(await client.request('config/read', { includeLayers: false, cwd }));
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}
