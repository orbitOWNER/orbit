import { describe, expect, it } from 'vitest';
import { newClientId, nextDelayMs, orderOutbox, shouldAutoRetry } from '../src/renderer/lib/outbox-utils';

describe('outbox helpers', () => {
  it('backs off exponentially and caps at 30s', () => {
    expect(nextDelayMs(0)).toBe(1000);
    expect(nextDelayMs(1)).toBe(2000);
    expect(nextDelayMs(3)).toBe(8000);
    expect(nextDelayMs(10)).toBe(30000);
    expect(nextDelayMs(100)).toBe(30000);
  });
  it('retries at most 5 times', () => {
    expect(shouldAutoRetry(0)).toBe(true);
    expect(shouldAutoRetry(4)).toBe(true);
    expect(shouldAutoRetry(5)).toBe(false);
  });
  it('flushes oldest first', () => {
    const items = [
      { createdAt: '2026-01-03T00:00:00Z' },
      { createdAt: '2026-01-01T00:00:00Z' },
      { createdAt: '2026-01-02T00:00:00Z' },
    ];
    expect(orderOutbox(items).map((i) => i.createdAt)).toEqual([
      '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z',
    ]);
  });
  it('mints unique client ids', () => {
    const ids = new Set([newClientId(), newClientId(), newClientId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id.length).toBeGreaterThan(8);
  });
});
