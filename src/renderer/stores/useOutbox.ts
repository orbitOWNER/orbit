import { create } from 'zustand';
import { OrbitApiError, api, type AttachmentShape } from '../lib/api';
import { desktop } from '../lib/desktop';
import { newClientId, nextDelayMs, orderOutbox, shouldAutoRetry } from '../lib/outbox-utils';
import { useData } from './useData';
import { useUI } from './useUI';

export interface OutboxItem {
  clientId: string;
  channelId: string;
  content: string;
  replyTo: string | null;
  attachments: AttachmentShape[];
  createdAt: string;
  attempts: number;
  status: 'queued' | 'sending' | 'failed';
  error?: string;
}

interface OutboxState {
  items: OutboxItem[];
  flushing: boolean;
  load: () => Promise<void>;
  enqueue: (d: { channelId: string; content: string; replyTo?: string | null; attachments?: AttachmentShape[] }) => string;
  retry: (clientId: string) => void;
  remove: (clientId: string) => void;
  flush: () => Promise<void>;
}

const KEY = 'orbit.outbox.v1';
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(items: OutboxItem[]): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Anything mid-flight at save time goes back to queued on next boot.
    const clean = items.map((i) => (i.status === 'sending' ? { ...i, status: 'queued' as const } : i));
    void desktop.kvSet(KEY, clean);
  }, 300);
}

export const useOutbox = create<OutboxState>((set, get) => ({
  items: [],
  flushing: false,

  load: async () => {
    try {
      const raw = (await desktop.kvGet(KEY)) as OutboxItem[] | null;
      if (Array.isArray(raw)) {
        const clean = raw
          .filter((i) => i && typeof i.clientId === 'string' && typeof i.channelId === 'string' && typeof i.content === 'string')
          .map((i) => ({ ...i, status: 'queued' as const, attempts: i.attempts ?? 0 }));
        set({ items: orderOutbox(clean) });
      }
    } catch { /* start empty */ }
  },

  enqueue: (d) => {
    const item: OutboxItem = {
      clientId: newClientId(),
      channelId: d.channelId,
      content: d.content,
      replyTo: d.replyTo ?? null,
      attachments: d.attachments ?? [],
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'queued',
    };
    const next = orderOutbox([...get().items, item]);
    set({ items: next });
    persist(next);
    void get().flush();
    return item.clientId;
  },

  retry: (clientId) => {
    const next = get().items.map((i) => (i.clientId === clientId ? { ...i, status: 'queued' as const, attempts: 0, error: undefined } : i));
    set({ items: next });
    persist(next);
    void get().flush();
  },

  remove: (clientId) => {
    const next = get().items.filter((i) => i.clientId !== clientId);
    set({ items: next });
    persist(next);
  },

  flush: async () => {
    if (get().flushing) return;
    const pending = orderOutbox(get().items.filter((i) => i.status !== 'sending'));
    if (pending.length === 0) return;
    set({ flushing: true });
    try {
      for (const item of pending) {
        // Item may have been removed/retried while we worked.
        if (!get().items.some((i) => i.clientId === item.clientId)) continue;
        set((s) => ({ items: s.items.map((i) => (i.clientId === item.clientId ? { ...i, status: 'sending' as const } : i)) }));
        try {
          const { message } = await api.sendMessage(item.channelId, {
            content: item.content, replyTo: item.replyTo, attachments: item.attachments, clientId: item.clientId,
          });
          useData.getState().upsertMessage(message);
          useData.getState().markRead(item.channelId, message.id);
          const next = get().items.filter((i) => i.clientId !== item.clientId);
          set({ items: next });
          persist(next);
        } catch (e) {
          const offline = e instanceof OrbitApiError && e.status === 0;
          const msg = e instanceof Error ? e.message : 'Send failed';
          if (offline) {
            const attempts = item.attempts + 1;
            const failed = !shouldAutoRetry(attempts);
            const next = get().items.map((i) => (i.clientId === item.clientId
              ? { ...i, status: (failed ? 'failed' : 'queued') as OutboxItem['status'], attempts, error: failed ? 'Still offline' : undefined }
              : i));
            set({ items: next });
            persist(next);
            if (!failed) {
              setTimeout(() => { void get().flush(); }, nextDelayMs(attempts));
              break; // still offline: stop the loop, retry later
            }
          } else {
            // Rejected by the server (validation etc.): never auto-retry.
            const next = get().items.map((i) => (i.clientId === item.clientId ? { ...i, status: 'failed' as const, error: msg } : i));
            set({ items: next });
            persist(next);
            useUI.getState().toast('error', `Queued message failed: ${msg}`);
          }
        }
      }
    } finally {
      set({ flushing: false });
    }
  },
}));

// Flush triggers: back online, app visible again, and periodic sweep.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void useOutbox.getState().flush(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && useOutbox.getState().items.length > 0) void useOutbox.getState().flush();
  });
  const t = setInterval(() => {
    if (useOutbox.getState().items.length > 0) void useOutbox.getState().flush();
  }, 30000);
  (t as unknown as { unref?: () => void }).unref?.();
}
