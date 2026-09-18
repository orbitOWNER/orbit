import type { PermissionKey } from '../../src/shared/types/models.js';
import { all, get } from '../database/db.js';

export function memberPermissions(serverId: string, userId: string): Set<PermissionKey> {
  const server = get<{ ownerId: string }>('SELECT ownerId FROM servers WHERE id = ?', [serverId]);
  if (server && server.ownerId === userId) {
    return new Set<PermissionKey>(['administrator','manageServer','manageChannels','manageRoles','kickMembers','banMembers','manageMessages','mentionEveryone','connect','speak','stream']);
  }
  const m = get<{ roleIds: string }>('SELECT roleIds FROM members WHERE serverId = ? AND userId = ?', [serverId, userId]);
  if (!m) return new Set();
  let ids: string[] = [];
  try { ids = JSON.parse(m.roleIds); } catch { ids = []; }
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const roles = all<{ permissions: string }>(`SELECT permissions FROM roles WHERE id IN (${placeholders})`, ids);
  const out = new Set<PermissionKey>();
  for (const r of roles) {
    try {
      for (const p of JSON.parse(r.permissions) as PermissionKey[]) out.add(p);
    } catch { /* ignore */ }
  }
  if (out.has('administrator')) {
    for (const p of ['manageServer','manageChannels','manageRoles','kickMembers','banMembers','manageMessages','mentionEveryone','connect','speak','stream'] as PermissionKey[]) out.add(p);
  }
  return out;
}

export function requirePerm(serverId: string, userId: string, perm: PermissionKey): boolean {
  return memberPermissions(serverId, userId).has(perm);
}

export function isMember(serverId: string, userId: string): boolean {
  return !!get('SELECT id FROM members WHERE serverId = ? AND userId = ?', [serverId, userId]);
}
