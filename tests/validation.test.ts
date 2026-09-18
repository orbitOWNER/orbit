import { describe, expect, it } from 'vitest';
import { channelSchema, loginSchema, messageSchema, passwordChangeSchema, profilePatchSchema, registerSchema, serverSchema } from '../server/services/auth';

describe('validation', () => {
  it('accepts a good registration', () => {
    expect(registerSchema.safeParse({ username: 'nova', displayName: 'Nova', email: 'a@b.co', password: 'long-enough-1' }).success).toBe(true);
  });
  it('rejects bad usernames and short passwords', () => {
    expect(registerSchema.safeParse({ username: 'a', displayName: 'A', email: 'not-mail', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'x', password: '' }).success).toBe(false);
  });
  it('requires message text or attachment', () => {
    expect(messageSchema.safeParse({ content: '  ', attachments: [] }).success).toBe(false);
    expect(messageSchema.safeParse({ content: 'hi' }).success).toBe(true);
    expect(messageSchema.safeParse({ content: '', attachments: [{ id: '1', name: 'a.png', mime: 'image/png', size: 10, url: 'data:x' }] }).success).toBe(true);
  });
  it('caps messages at 2000 chars and validates channels/servers', () => {
    expect(messageSchema.safeParse({ content: 'x'.repeat(2001) }).success).toBe(false);
    expect(serverSchema.safeParse({ name: '' }).success).toBe(false);
    expect(channelSchema.safeParse({ name: 'general', type: 'text' }).success).toBe(true);
    expect(channelSchema.safeParse({ name: 'bad name!', type: 'text' }).success).toBe(false);
  });
  it('accepts idempotency clientIds for offline-queue retries', () => {
    expect(messageSchema.safeParse({ content: 'hi', clientId: 'abc-123' }).success).toBe(true);
    expect(messageSchema.safeParse({ content: 'hi', clientId: 'x'.repeat(65) }).success).toBe(false);
  });
  it('validates profile patches', () => {
    expect(profilePatchSchema.safeParse({ displayName: 'Nova', bio: 'hi' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ username: 'bad name!' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ bio: 'x'.repeat(513) }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ avatar: '🪐' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ avatar: 'not-an-emoji-and-not-a-data-url-either!!' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ avatar: 'data:image/png;base64,AAA' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ status: 'busy' }).success).toBe(false);
  });
  it('requires a decent new password on change', () => {
    expect(passwordChangeSchema.safeParse({ currentPassword: 'old-12345', newPassword: 'new-12345' }).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ currentPassword: '', newPassword: 'new-12345' }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ currentPassword: 'old-12345', newPassword: 'short' }).success).toBe(false);
  });
});
