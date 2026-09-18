import { describe, expect, it } from 'vitest';
import { checkSpam } from '../server/services/spam';
import { orbitEvent, OrbitEvents } from '../src/shared/events/events';
import { BLOCKED_EXTENSIONS, MAX_MESSAGE_LENGTH } from '../src/shared/constants/app';

describe('anti-spam', () => {
  it('allows normal pace', () => {
    const u = `u-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(checkSpam(u, `msg ${i}`).ok).toBe(true);
  });
  it('blocks bursts over 8 per 10s', () => {
    const u = `u-${Math.random()}`;
    let blocked = false;
    for (let i = 0; i < 12; i++) if (!checkSpam(u, `burst ${i}`).ok) blocked = true;
    expect(blocked).toBe(true);
  });
  it('blocks immediate duplicates', () => {
    const u = `u-${Math.random()}`;
    expect(checkSpam(u, 'same').ok).toBe(true);
    expect(checkSpam(u, 'same').ok).toBe(false);
  });
});

describe('events', () => {
  it('builds typed events for every required channel', () => {
    for (const name of ['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE','REACTION_ADD','REACTION_REMOVE','TYPING_START','PRESENCE_UPDATE','MEMBER_JOIN','MEMBER_LEAVE','CHANNEL_CREATE','CHANNEL_UPDATE','CHANNEL_DELETE','VOICE_STATE_UPDATE'] as const) {
      expect((OrbitEvents as Record<string, string>)[name]).toBe(name);
      expect(orbitEvent(name, {}).type).toBe(name);
    }
  });
});

describe('upload policy', () => {
  it('blocks executables and caps message length', () => {
    for (const ext of ['exe','bat','ps1','msi']) expect(BLOCKED_EXTENSIONS.has(ext)).toBe(true);
    expect(MAX_MESSAGE_LENGTH).toBe(2000);
  });
});
