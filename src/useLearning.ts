import { appStorage } from './storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningView, MainChatRequest } from '../shared/learning';

export async function learningApi<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch('/api/learning' + path, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not save this change. Try again.');
  return result as T;
}
export function learningError(error: unknown) { return error instanceof Error ? error.message : 'Request failed. Try again.'; }
export type PendingMainMessage = { request: MainChatRequest; createdAt: string; status: 'sending' | 'failed'; error?: string };
const pendingKey = 'ari:mainPending';
function savedPending(): PendingMainMessage[] {
  try { return (JSON.parse(appStorage.getItem(pendingKey) || '[]') as PendingMainMessage[])
    .filter(item => item.request?.id && item.request?.message).map(item => ({ ...item, status: 'failed', error: 'Delivery was interrupted. Retry to check or resume this message.' })); }
  catch { return []; }
}
export function useLearning(mainOpen: boolean, betweenExercises = mainOpen) {
  const [data, setData] = useState<LearningView | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingMainMessage[]>(savedPending);
  const busyRef = useRef(false);
  const refreshRef = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const streamUpdates = useRef(new Map<string, { content: string; version: number }>());
  const streamVersion = useRef(0);
  const eventSource = useRef<EventSource | null>(null);
  const acknowledgedRef = useRef(new Set<string>());
  const refresh = useCallback((): Promise<void> => {
    if (refreshRef.current) { refreshAgain.current = true; return refreshRef.current; }
    refreshRef.current = (async () => {
      do {
        refreshAgain.current = false;
        const version = streamVersion.current;
        try {
          const next = await learningApi<LearningView>('');
          next.messages = next.messages.map(message => {
            const update = streamUpdates.current.get(message.id);
            if (!update) return message;
            if ((message.status === 'complete' || message.status === 'failed') && update.version <= version) {
              streamUpdates.current.delete(message.id); return message;
            }
            return { ...message, content: update.content, status: 'streaming' };
          });
          acknowledgedRef.current = new Set(next.messages.map(message => message.id));
          setData(next); setError('');
          setPending(current => current.filter(item => !next.messages.some(message => message.id === item.request.id)));
        } catch (failure) { setError(learningError(failure)); }
      } while (refreshAgain.current);
    })().finally(() => { refreshRef.current = null; });
    return refreshRef.current;
  }, []);
  useEffect(() => { appStorage.setItem(pendingKey, JSON.stringify(pending)); }, [pending]);
  useEffect(() => {
    void refresh();
    const stream = new EventSource('/api/learning/events');
    eventSource.current = stream;
    const onChange = () => { void refresh(); };
    stream.addEventListener('change', onChange);
    stream.addEventListener('message', event => {
      const update = JSON.parse((event as MessageEvent).data) as { id: string; content: string; status: 'streaming' };
      streamUpdates.current.set(update.id, { content: update.content, version: ++streamVersion.current });
      setData(current => current ? { ...current, messages: current.messages.map(message => message.id === update.id ? { ...message, ...update } : message) } : current);
    });
    // Reconcile after reconnects and refreshes, including server-owned work that
    // completed while this browser was asleep. This never delivers idle messages.
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { stream.close(); eventSource.current = null; window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  const idle = useCallback(() => { void learningApi('/idle', {}).then(refresh).catch(() => {}); }, [refresh]);
  const running = data?.runs.some(run => run.status === 'running' || run.status === 'queued') || false;
  useEffect(() => {
    if (!running && !pending.some(item => item.status === 'sending')) return;
    const interval = window.setInterval(() => { if (eventSource.current?.readyState !== EventSource.OPEN) void refresh(); }, 4000);
    return () => window.clearInterval(interval);
  }, [running, pending, refresh]);
  const completedReviews = data?.runs.filter(run => run.kind === 'review' && run.status === 'complete').map(run => run.id).join('|') || '';
  const chatRunning = data?.runs.some(run => run.kind === 'chat' && (run.status === 'running' || run.status === 'queued')) || false;
  const available = Boolean(data);
  useEffect(() => {
    // A review can finish after the learner reaches Learning path or the main
    // chat. Deliver at that safe point, while never reacting mid-exercise.
    // Stable run IDs prevent SSE/refetch cycles from repeatedly calling idle.
    if (betweenExercises && available && !chatRunning) void learningApi('/idle', {}).then(refresh).catch(() => {});
  }, [betweenExercises, available, completedReviews, chatRunning, refresh]);
  useEffect(() => {
    if (mainOpen && data?.unreadCount) void learningApi('/read', {}).then(refresh).catch(() => {});
  }, [mainOpen, data?.unreadCount, refresh]);
  const deliver = useCallback(async (item: PendingMainMessage) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(current => [...current.filter(other => other.request.id !== item.request.id), { ...item, status: 'sending', error: undefined }]);
    try { await learningApi('/chat', item.request); await refresh(); }
    catch (failure) {
      // A rejected retry of an already-saved message must not become an
      // unsent local message that locks the composer. Reconcile even on 409.
      setPending(current => acknowledgedRef.current.has(item.request.id)
        ? current.filter(other => other.request.id !== item.request.id)
        : current.map(other => other.request.id === item.request.id
          ? { ...other, status: 'failed', error: learningError(failure) } : other));
      await refresh();
    }
    finally { busyRef.current = false; }
  }, [refresh]);
  return { data, error, pending, refresh, deliver, running,
    idle,
  };
}
