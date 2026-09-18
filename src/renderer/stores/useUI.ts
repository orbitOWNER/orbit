import { create } from 'zustand';

export interface Toast { id: string; kind: 'info' | 'success' | 'error'; text: string; }
export type ModalKind =
  | null
  | 'settings' | 'serverSettings' | 'createServer' | 'joinServer' | 'createChannel'
  | 'invite' | 'quickSwitcher' | 'search' | 'pins' | 'members' | 'videoGrid' | 'profile';

interface UIState {
  view: 'home' | 'server';
  activeServerId: string | null;
  activeChannelId: string | null;
  activeDMId: string | null;
  homeTab: 'friends' | 'dms';
  memberPanelOpen: boolean;
  modal: ModalKind;
  modalProps: Record<string, unknown>;
  toasts: Toast[];
  contextMenu: { x: number; y: number; items: { label: string; danger?: boolean; action: () => void }[] } | null;
  replyToId: string | null;
  editingId: string | null;
  highlightId: string | null;
  profileUserId: string | null;
  set: (p: Partial<UIState>) => void;
  openModal: (m: Exclude<ModalKind, null>, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
  openContext: (x: number, y: number, items: UIState['contextMenu'] extends infer T ? T extends { items: infer I } ? I : never : never) => void;
  closeContext: () => void;
}

export const useUI = create<UIState>((set) => ({
  view: 'home',
  activeServerId: null,
  activeChannelId: null,
  activeDMId: null,
  homeTab: 'friends',
  memberPanelOpen: true,
  modal: null,
  modalProps: {},
  toasts: [],
  contextMenu: null,
  replyToId: null,
  editingId: null,
  highlightId: null,
  profileUserId: null,
  set: (p) => set(p),
  openModal: (m, props = {}) => set({ modal: m, modalProps: props }),
  closeModal: () => set({ modal: null, modalProps: {} }),
  toast: (kind, text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openContext: (x, y, items) => set({ contextMenu: { x, y, items: items as { label: string; danger?: boolean; action: () => void }[] } }),
  closeContext: () => set({ contextMenu: null }),
}));
