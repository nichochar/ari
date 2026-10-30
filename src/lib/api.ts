type RequestPolicy = { timeoutMs?: number; fallbackError?: string };

export async function requestJson<T>(path: string, options?: RequestInit, policy: RequestPolicy = {}): Promise<T> {
  const controller = policy.timeoutMs === undefined ? undefined : new AbortController();
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), policy.timeoutMs) : undefined;
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const signal = controller
    ? options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    : options?.signal;
  try {
    const response = await fetch(path, { ...options, signal, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.error === 'string' && data.error
      ? data.error : policy.fallbackError ?? `Request failed (${response.status}).`);
    return data as T;
  } catch (error) {
    if (controller?.signal.aborted && !options?.signal?.aborted) throw new Error('The request timed out. Try again.');
    throw error;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

export function api<T>(path: string, options?: RequestInit, timeout = 180000): Promise<T> {
  return requestJson<T>(path, options, { timeoutMs: timeout });
}

export function post<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  return api<T>(path, { method, body: JSON.stringify(body) }, 210000);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
