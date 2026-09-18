// Realtime WebSocket client with auto-reconnect and typed subscriptions.
import { OrbitEvents, type OrbitEventName } from '@shared/events/events';

type Handler = (data: never) => void;

const handlers = new Map<OrbitEventName, Set<Handler>>();
let ws: WebSocket | null = null;
let token: string | null = null;
let retries = 0;
let wantConnect = false;
let pingTimer: number | null = null;

function base(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const api = env?.VITE_API_URL ?? 'http://127.0.0.1:6742';
  return api.replace(/^http/, 'ws');
}

export function onEvent<T>(type: OrbitEventName, cb: (data: T) => void): () => void {
  let set = handlers.get(type);
  if (!set) { set = new Set(); handlers.set(type, set); }
  set.add(cb as Handler);
  return () => { set!.delete(cb as Handler); };
}

function dispatch(type: string, data: unknown): void {
  const set = handlers.get(type as OrbitEventName);
  if (!set) return;
  for (const h of [...set]) {
    try { h(data as never); } catch (err) { console.error('[realtime] handler failed', type, err); }
  }
}

function scheduleReconnect(): void {
  if (!wantConnect) return;
  retries += 1;
  const delay = Math.min(1000 * 2 ** Math.min(retries, 5), 15000);
  setTimeout(() => { if (wantConnect) connect(token); }, delay);
}

export function connect(t: string | null): void {
  wantConnect = true;
  token = t;
  try { ws?.close(); } catch { /* noop */ }
  ws = null;
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (!t) return;
  try {
    ws = new WebSocket(`${base()}/ws?token=${encodeURIComponent(t)}`);
  } catch { scheduleReconnect(); return; }
  ws.onopen = () => {
    retries = 0;
    pingTimer = window.setInterval(() => { try { ws?.send(JSON.stringify({ type: 'PING' })); } catch { /* noop */ } }, 25000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type: string; data: unknown };
      if (msg.type === 'PONG') return;
      dispatch(msg.type, msg.data);
    } catch { /* ignore malformed frames */ }
  };
  ws.onclose = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } scheduleReconnect(); };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

export function disconnect(): void {
  wantConnect = false;
  try { ws?.close(); } catch { /* noop */ }
  ws = null;
}

export function sendSignal(data: object): void {
  try { ws?.send(JSON.stringify({ type: 'VOICE_SIGNAL', data })); } catch { /* offline */ }
}

export { OrbitEvents };
