import { create } from 'zustand';
import { api, loadSavedToken, setToken, type AuthUserShape } from '../lib/api';
import { connect, disconnect } from '../lib/realtime';
import { OrbitApiError } from '../lib/api';
import { useData } from './useData';

interface AuthState {
  user: AuthUserShape | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'offline';
  error: string | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { username: string; displayName: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
  patchMe: (b: Partial<AuthUserShape> & { status?: string; customStatus?: string | null; avatar?: string | null; displayName?: string; bio?: string | null; username?: string; email?: string }) => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'idle',
  error: null,
  init: async () => {
    const t = await loadSavedToken();
    if (!t) { set({ status: 'ready', user: null }); return; }
    set({ status: 'loading' });
    try {
      const { user } = await api.me();
      set({ user, status: 'ready' });
      connect(t);
    } catch (e) {
      if (e instanceof OrbitApiError && e.status === 401) {
        // Token genuinely dead: clear it so the user gets a clean login.
        setToken(null);
        set({ user: null, status: 'ready' });
      } else {
        // Backend unreachable (still starting, port busy, offline):
        // KEEP the token so reopening/retrying signs straight back in.
        set({ user: null, status: 'offline', error: e instanceof OrbitApiError ? e.message : 'Service unreachable' });
      }
    }
  },
  login: async (email, password) => {
    set({ status: 'loading', error: null });
    try {
      const { token, user } = await api.login({ email, password });
      setToken(token);
      connect(token);
      set({ user, status: 'ready' });
    } catch (e) {
      set({ status: 'error', error: e instanceof OrbitApiError ? e.message : 'Login failed' });
      throw e;
    }
  },
  register: async (b) => {
    set({ status: 'loading', error: null });
    try {
      const { token, user } = await api.register(b);
      setToken(token);
      connect(token);
      set({ user, status: 'ready' });
    } catch (e) {
      set({ status: 'error', error: e instanceof OrbitApiError ? e.message : 'Registration failed' });
      throw e;
    }
  },
  logout: () => {
    setToken(null);
    disconnect();
    set({ user: null, status: 'ready' });
  },
  patchMe: async (b) => {
    const { user } = await api.patchMe(b);
    set({ user });
    // keep the shared users map (members, DMs, search) in sync too
    useData.getState().upsertUser(user);
  },
}));
