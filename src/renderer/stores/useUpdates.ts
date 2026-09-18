import { create } from 'zustand';
import { desktop } from '../lib/desktop';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  error: string | null;
  info: UpdateInfo | null;
  progress: number | null;
  checkForUpdates: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  setStatus: (s: UpdateState['status'], info?: Partial<UpdateInfo> | null, progress?: number | null) => void;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  status: 'idle',
  error: null,
  info: null,
  progress: null,
  setStatus: (status, info, progress) => set((s) => ({
    status,
    info: info ? { ...(s.info ?? { version: '', releaseDate: '', releaseNotes: '' }), ...info } : s.info,
    progress: progress ?? s.progress,
    error: status === 'error' ? (info?.releaseNotes as string ?? 'Unknown error') : s.error,
  })),
  checkForUpdates: async () => {
    const res = await desktop.checkForUpdates();
    if (res.error) get().setStatus('error', { releaseNotes: res.error });
    else if (res.updateInfo) get().setStatus('available', res.updateInfo as UpdateInfo);
    else get().setStatus('not-available');
  },
  quitAndInstall: async () => {
    await desktop.quitAndInstall();
  },
  getAppVersion: async () => {
    return desktop.getAppVersion();
  },
}));