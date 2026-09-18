import { api } from './api';
import { useAuth } from '../stores/useAuth';
import { useData } from '../stores/useData';
import { useUI } from '../stores/useUI';

function memberIdsOf(dm: { memberIds: string | string[] }): string[] {
  return Array.isArray(dm.memberIds) ? dm.memberIds : JSON.parse(String(dm.memberIds)) as string[];
}

// Open a 1:1 DM, reusing the existing one instead of creating duplicates.
export async function openDMWith(userId: string): Promise<void> {
  const me = useAuth.getState().user;
  if (!me) throw new Error('Not signed in');
  const st = useData.getState();
  await st.refreshDMs().catch(() => undefined);
  const existing = useData.getState().dms.find((d) => {
    if (d.isGroup) return false;
    const ids = memberIdsOf(d);
    return ids.includes(me.id) && ids.includes(userId);
  });
  if (existing) {
    useUI.getState().set({ view: 'home', homeTab: 'dms', activeDMId: existing.id });
    return;
  }
  const { dm } = await api.createDM([userId]);
  await st.refreshDMs().catch(() => undefined);
  useUI.getState().set({ view: 'home', homeTab: 'dms', activeDMId: dm.id });
}

export function dmDisplayName(dmId: string): string {
  const st = useData.getState();
  const me = useAuth.getState().user;
  const d = st.dms.find((x) => x.id === dmId);
  if (!d) return '?';
  if (d.isGroup) return d.name;
  const other = memberIdsOf(d).find((i) => i !== me?.id);
  return (other && st.users[other]?.displayName) || d.name;
}
