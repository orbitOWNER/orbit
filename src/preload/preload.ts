import { contextBridge, ipcRenderer } from 'electron';

// Minimal, least-privilege preload: no Node globals leak to the renderer.
const orbit = {
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('orbit:pickFiles'),
  notify: (title: string, body: string): Promise<boolean> => ipcRenderer.invoke('orbit:notify', { title, body }),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('orbit:openExternal', url),
  onDeepLink: (cb: (code: string) => void): (() => void) => {
    const handler = (_e: unknown, data: { inviteCode: string }) => cb(data.inviteCode);
    ipcRenderer.on('orbit:deep-link', handler as never);
    return () => ipcRenderer.removeListener('orbit:deep-link', handler as never);
  },
  onShortcut: (cb: (id: string) => void): (() => void) => {
    const handler = (_e: unknown, data: { id: string }) => cb(data.id);
    ipcRenderer.on('orbit:shortcut', handler as never);
    return () => ipcRenderer.removeListener('orbit:shortcut', handler as never);
  },
  onUpdateStatus: (cb: (status: string, data?: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: unknown, data: { status: string; data?: Record<string, unknown> }) => cb(data.status, data.data);
    ipcRenderer.on('orbit:update-status', handler as never);
    return () => ipcRenderer.removeListener('orbit:update-status', handler as never);
  },
  checkForUpdates: (): Promise<{ updateInfo?: unknown; error?: string }> => ipcRenderer.invoke('orbit:checkForUpdates'),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke('orbit:quitAndInstall'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('orbit:getAppVersion'),
  getSession: (): Promise<string | null> => ipcRenderer.invoke('orbit:getSession'),
  setSession: (token: string | null): Promise<boolean> => ipcRenderer.invoke('orbit:setSession', token),
  kvGet: (key: string): Promise<unknown> => ipcRenderer.invoke('orbit:kv:get', key),
  kvSet: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('orbit:kv:set', key, value),
  isDesktop: true,
};

contextBridge.exposeInMainWorld('orbit', orbit);
export type OrbitPreload = typeof orbit;
