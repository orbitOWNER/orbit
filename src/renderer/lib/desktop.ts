// Desktop bridge: window.orbit (Electron preload) with graceful web fallback.
export interface DesktopBridge {
  pickFiles: () => Promise<string[]>;
  notify: (title: string, body: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  onDeepLink: (cb: (code: string) => void) => () => void;
  onShortcut: (cb: (id: string) => void) => () => void;
  onUpdateStatus: (cb: (status: string, data?: Record<string, unknown>) => void) => () => void;
  checkForUpdates: () => Promise<{ updateInfo?: unknown; error?: string }>;
  quitAndInstall: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getSession: () => Promise<string | null>;
  setSession: (token: string | null) => Promise<boolean>;
  kvGet: (key: string) => Promise<unknown>;
  kvSet: (key: string, value: unknown) => Promise<boolean>;
  isDesktop: boolean;
}

declare global { interface Window { orbit?: DesktopBridge } }

export const desktop: DesktopBridge = typeof window !== 'undefined' && window.orbit
  ? window.orbit
  : {
    pickFiles: async () => [],
    notify: async (title, body) => {
      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') new Notification(title, { body });
          else if (Notification.permission !== 'denied') {
            const p = await Notification.requestPermission();
            if (p === 'granted') new Notification(title, { body });
          }
          return true;
        }
      } catch { /* unsupported */ }
      return false;
    },
    openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; },
    onDeepLink: () => () => undefined,
    onShortcut: () => () => undefined,
    onUpdateStatus: () => () => undefined,
    checkForUpdates: async () => ({ error: 'Not in desktop mode' }),
    quitAndInstall: async () => {},
    getAppVersion: async () => '0.0.0-web',
    getSession: async () => { try { return localStorage.getItem('orbit.token'); } catch { return null; } },
    setSession: async (token) => {
      try { if (token) localStorage.setItem('orbit.token', token); else localStorage.removeItem('orbit.token'); return true; }
      catch { return false; }
    },
    kvGet: async (key) => {
      try {
        const raw = localStorage.getItem(`orbit.kv.${key}`);
        return raw == null ? null : JSON.parse(raw) as unknown;
      } catch { return null; }
    },
    kvSet: async (key, value) => {
      try {
        if (value == null) localStorage.removeItem(`orbit.kv.${key}`);
        else localStorage.setItem(`orbit.kv.${key}`, JSON.stringify(value));
        return true;
      } catch { return false; }
    },
    isDesktop: false,
  };

export function notify(title: string, body: string): void {
  void desktop.notify(title, body);
}
