// Pure helpers for the offline outbox (unit-tested, no I/O).
export function nextDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, Math.floor(attempts)));
}

export function shouldAutoRetry(attempts: number): boolean {
  return attempts < 5;
}

export function orderOutbox<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function newClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}
