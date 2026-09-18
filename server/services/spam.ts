// Basic anti-spam: sliding-window rate limit per user + duplicate detection.
const windows = new Map<string, number[]>();
const lastContent = new Map<string, { text: string; at: number }>();

export function checkSpam(userId: string, content: string): { ok: boolean; retryAfterMs?: number; reason?: string } {
  const now = Date.now();
  const arr = (windows.get(userId) ?? []).filter((t) => now - t < 10_000);
  arr.push(now);
  windows.set(userId, arr);
  if (arr.length > 8) return { ok: false, retryAfterMs: 10_000 - (now - arr[0]), reason: 'slow-down' };
  const last = lastContent.get(userId);
  if (last && last.text === content && now - last.at < 5_000) {
    return { ok: false, retryAfterMs: 5_000 - (now - last.at), reason: 'duplicate' };
  }
  lastContent.set(userId, { text: content, at: now });
  return { ok: true };
}
