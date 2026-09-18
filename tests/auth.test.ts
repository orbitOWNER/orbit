import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../server/services/auth';

describe('auth crypto', () => {
  it('hashes and verifies without storing plaintext', async () => {
    const hash = await hashPassword('orbit-demo-123');
    expect(hash).not.toContain('orbit-demo-123');
    expect(await verifyPassword('orbit-demo-123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('round-trips JWT subject', () => {
    const t = signToken('u_demo');
    expect(verifyToken(t)).toBe('u_demo');
    expect(verifyToken('garbage')).toBeNull();
  });
});
