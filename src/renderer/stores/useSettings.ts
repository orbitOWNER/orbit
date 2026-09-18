import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Density = 'cozy' | 'compact';

interface SettingsState {
  theme: Theme;
  accent: string;
  density: Density;
  fontScale: number;
  reduceMotion: boolean;
  dnd: boolean;
  desktopNotifications: boolean;
  readReceipts: boolean;
  pushToTalk: boolean;
  pttKey: string;
  inputDevice: string;
  outputDevice: string;
  language: string;
  set: (p: Partial<SettingsState>) => void;
}

const KEY = 'orbit.settings.v1';

function load(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Partial<SettingsState>;
  } catch { /* fresh defaults */ }
  return {};
}

export const useSettings = create<SettingsState>((set) => ({
  theme: 'dark',
  accent: '#6c8cff',
  density: 'cozy',
  fontScale: 1,
  reduceMotion: false,
  dnd: false,
  desktopNotifications: true,
  readReceipts: true,
  pushToTalk: false,
  pttKey: 'V',
  inputDevice: 'default',
  outputDevice: 'default',
  language: 'en',
  ...load(),
  set: (p) => {
    set(p);
    try {
      const cur = JSON.parse(localStorage.getItem(KEY) ?? '{}') as object;
      localStorage.setItem(KEY, JSON.stringify({ ...cur, ...p }));
    } catch { /* storage unavailable */ }
  },
}));

export function applySettingsToDom(s: SettingsState): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--font-scale', String(s.fontScale));
  root.dataset.density = s.density;
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
}
