export function mergeSessions<T extends { id: string; createdAt: string }>(current: T[] = [], incoming: T[] = []) {
  return [...new Map([...current, ...incoming].map(session => [session.id, session])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
