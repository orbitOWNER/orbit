import type { WebSocket } from 'ws';
import type { OrbitEventName } from '../../src/shared/events/events.js';

interface Client { ws: WebSocket; userId: string | null; }

const clients = new Set<Client>();
const voiceStates = new Map<string, { channelId: string | null; serverId: string | null; muted: boolean; deafened: boolean; speaking: boolean; video: boolean; sharing: boolean }>();

export function addClient(ws: WebSocket, userId: string | null): Client {
  const c: Client = { ws, userId };
  clients.add(c);
  return c;
}
export function removeClient(c: Client): void { clients.delete(c); }

export function broadcast(type: OrbitEventName, data: unknown, except?: Client): void {
  const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
  for (const c of clients) {
    if (c === except) continue;
    try {
      if ((c.ws as unknown as { readyState: number }).readyState === 1) c.ws.send(payload);
    } catch { /* ignore broken socket */ }
  }
}

export function sendToUser(userId: string, type: OrbitEventName, data: unknown): void {
  const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
  for (const c of clients) {
    if (c.userId !== userId) continue;
    try { if ((c.ws as unknown as { readyState: number }).readyState === 1) c.ws.send(payload); } catch { /* ignore */ }
  }
}

export function setVoiceState(userId: string, s: { channelId: string | null; serverId: string | null; muted: boolean; deafened: boolean; speaking: boolean; video: boolean; sharing: boolean }): void {
  voiceStates.set(userId, s);
  broadcast('VOICE_STATE_UPDATE', { userId, ...s });
}
export function getVoiceStates(channelId?: string): Array<{ userId: string } & { channelId: string | null; serverId: string | null; muted: boolean; deafened: boolean; speaking: boolean; video: boolean; sharing: boolean }> {
  const out: Array<{ userId: string } & { channelId: string | null; serverId: string | null; muted: boolean; deafened: boolean; speaking: boolean; video: boolean; sharing: boolean }> = [];
  for (const [userId, s] of voiceStates) {
    if (channelId && s.channelId !== channelId) continue;
    out.push({ userId, ...s });
  }
  return out;
}
