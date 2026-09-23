// Typed fetch client for the Orbit REST API (works against embedded or remote backend).
import { desktop } from './desktop';
const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://127.0.0.1:6742';

export class OrbitApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as { error: string }).error) : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// Auth token: in-memory first (works everywhere), mirrored to the persistent
// session store (main process on desktop, localStorage on web).
let memToken: string | null = null;
export function setToken(t: string | null): void {
  memToken = t;
  void desktop.setSession(t);
}
export async function loadSavedToken(): Promise<string | null> {
  try {
    const t = await desktop.getSession();
    if (t) { memToken = t; return t; }
  } catch { /* fall through to memory */ }
  return memToken;
}

function token(): string | null {
  if (memToken) return memToken;
  try { return localStorage.getItem('orbit.token'); } catch { return null; }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new OrbitApiError(0, { error: 'Cannot reach Orbit service. Is it running? (npm run server)' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new OrbitApiError(res.status, body);
  return body as T;
}

export const api = {
  base: BASE,
  health: () => req<{ ok: boolean }>('/api/health'),
  register: (b: object) => req<{ token: string; user: AuthUserShape }>('/api/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  login: (b: object) => req<{ token: string; user: AuthUserShape }>('/api/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  me: () => req<{ user: AuthUserShape }>('/api/auth/me'),
  patchMe: (b: object) => req<{ user: AuthUserShape }>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(b) }),
  updatePassword: (b: { currentPassword: string; newPassword: string }) => req<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: JSON.stringify(b) }),
  deleteAccount: (password: string) => req<{ ok: boolean }>('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
  bootstrap: () => req<Bootstrap>('/api/bootstrap'),
  createServer: (b: object) => req<{ server: ServerShape }>('/api/servers', { method: 'POST', body: JSON.stringify(b) }),
  patchServer: (id: string, b: object) => req<{ server: ServerShape }>(`/api/servers/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteServer: (id: string) => req<{ ok: boolean }>(`/api/servers/${id}`, { method: 'DELETE' }),
  leaveServer: (id: string) => req<{ ok: boolean }>(`/api/servers/${id}/leave`, { method: 'POST' }),
  createChannel: (sid: string, b: object) => req<{ channel: ChannelShape }>(`/api/servers/${sid}/channels`, { method: 'POST', body: JSON.stringify(b) }),
  patchChannel: (id: string, b: object) => req<{ channel: ChannelShape }>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteChannel: (id: string) => req<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE' }),
  reorderChannels: (orderedIds: string[]) => req<{ ok: boolean }>('/api/channels/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) }),
  messages: (cid: string, limit = 50, before?: string) =>
    req<{ messages: MsgShape[]; reactions: ReactionShape[]; hasMore: boolean }>(
      `/api/channels/${cid}/messages?limit=${limit}${before ? `&before=${before}` : ''}`),
  sendMessage: (cid: string, b: object) => req<{ message: MsgShape }>(`/api/channels/${cid}/messages`, { method: 'POST', body: JSON.stringify(b) }),
  editMessage: (id: string, content: string) => req<{ message: MsgShape }>(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  deleteMessage: (id: string) => req<{ ok: boolean }>(`/api/messages/${id}`, { method: 'DELETE' }),
  pinMessage: (id: string, pinned: boolean) => req<{ message: MsgShape }>(`/api/messages/${id}/pin`, { method: 'POST', body: JSON.stringify({ pinned }) }),
  pins: (cid: string) => req<{ messages: MsgShape[] }>(`/api/channels/${cid}/pins`),
  readStates: () => req<{ states: ReadStateShape[] }>('/api/read-states'),
  saveReadState: (channelId: string, b: { lastReadMessageId: string | null; unread: number; mentions: number }) =>
    req<{ ok: boolean }>(`/api/read-states/${encodeURIComponent(channelId)}`, { method: 'PUT', body: JSON.stringify(b) }),
  react: (id: string, emoji: string) => req<{ ok: boolean }>(`/api/messages/${id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  unreact: (id: string, emoji: string) => req<{ ok: boolean }>(`/api/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`, { method: 'DELETE' }),
  members: (sid: string) => req<{ members: MemberShape[] }>(`/api/servers/${sid}/members`),
  roles: (sid: string) => req<{ roles: RoleShape[] }>(`/api/servers/${sid}/roles`),
  createRole: (sid: string, b: object) => req<{ role: RoleShape }>(`/api/servers/${sid}/roles`, { method: 'POST', body: JSON.stringify(b) }),
  setRoles: (sid: string, uid: string, roleIds: string[]) =>
    req<{ ok: boolean }>(`/api/servers/${sid}/members/${uid}/roles`, { method: 'PATCH', body: JSON.stringify({ roleIds }) }),
  kick: (sid: string, userId: string, reason?: string) => req<{ ok: boolean }>(`/api/servers/${sid}/kick`, { method: 'POST', body: JSON.stringify({ userId, reason }) }),
  ban: (sid: string, userId: string, reason?: string) => req<{ ok: boolean }>(`/api/servers/${sid}/ban`, { method: 'POST', body: JSON.stringify({ userId, reason }) }),
  timeout: (sid: string, userId: string, minutes: number) => req<{ ok: boolean; timedOutUntil: string }>(`/api/servers/${sid}/timeout`, { method: 'POST', body: JSON.stringify({ userId, minutes }) }),
  audit: (sid: string) => req<{ entries: AuditShape[] }>(`/api/servers/${sid}/audit`),
  report: (mid: string, reason: string) => req<{ ok: boolean }>(`/api/messages/${mid}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
  createInvite: (sid: string, b: object) => req<{ invite: InviteShape; url: string }>(`/api/servers/${sid}/invites`, { method: 'POST', body: JSON.stringify(b) }),
  inviteInfo: (code: string) => req<{ invite: InviteShape; server: ServerShape; status: string }>(`/api/invites/${code}`),
  joinInvite: (code: string) => req<{ server: ServerShape }>(`/api/invites/${code}/join`, { method: 'POST', body: '{}' }),
  friends: () => req<{ friendships: FriendshipShape[] }>('/api/friends'),
  friendRequest: (username: string) => req<{ ok: boolean; autoAccepted?: boolean }>('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  friendAccept: (userId: string) => req<{ ok: boolean }>(`/api/friends/${userId}/accept`, { method: 'POST' }),
  friendBlock: (userId: string) => req<{ ok: boolean }>(`/api/friends/${userId}/block`, { method: 'POST' }),
  friendRemove: (userId: string) => req<{ ok: boolean }>(`/api/friends/${userId}`, { method: 'DELETE' }),
  dms: () => req<{ dms: DMShape[] }>('/api/dms'),
  createDM: (userIds: string[], name?: string) => req<{ dm: DMShape }>('/api/dms', { method: 'POST', body: JSON.stringify({ userIds, name }) }),
  users: (q?: string) => req<{ users: UserShape[] }>(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  search: (q: string) => req<{ messages: MsgShape[]; users: UserShape[]; channels: ChannelShape[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  typing: (cid: string) => req<{ ok: boolean }>(`/api/channels/${cid}/typing`, { method: 'POST', body: '{}' }),
  presence: (status: string) => req<{ ok: boolean }>('/api/presence', { method: 'POST', body: JSON.stringify({ status }) }),
  voiceStates: () => req<{ states: VoiceStateShape[] }>('/api/voice/states'),
  voiceJoin: (channelId: string) => req<{ ok: boolean }>('/api/voice/join', { method: 'POST', body: JSON.stringify({ channelId }) }),
  voiceLeave: () => req<{ ok: boolean }>('/api/voice/leave', { method: 'POST', body: '{}' }),
  voiceState: (b: object) => req<{ ok: boolean }>('/api/voice/state', { method: 'POST', body: JSON.stringify(b) }),
  reportInstall: (b: { appVersion: string; platform: string; arch: string; deviceId: string }) => req<{ ok: boolean }>('/api/installs/report', { method: 'POST', body: JSON.stringify(b) }),
  getInstalls: () => req<{ installs: InstallShape[] }>('/api/installs'),
};

export interface UserShape { id: string; username: string; displayName: string; avatar: string | null; status: string; customStatus: string | null; bio: string | null; createdAt: string; }
export interface AuthUserShape extends UserShape { email: string; }
export interface ServerShape { id: string; name: string; icon: string | null; ownerId: string; createdAt: string; }
export interface ChannelShape { id: string; serverId: string | null; name: string; type: string; categoryId: string | null; position: number; topic: string | null; }
export interface AttachmentShape { id: string; name: string; mime: string; size: number; url: string; }
export interface MsgShape { id: string; channelId: string; authorId: string; content: string; attachments: AttachmentShape[]; replyTo: string | null; editedAt: string | null; createdAt: string; pinned?: boolean; clientId?: string | null; }
export interface ReactionShape { id: string; messageId: string; userId: string; emoji: string; }
export interface RoleShape { id: string; serverId: string; name: string; color: string; permissions: string[]; position: number; }
export interface MemberShape { id: string; serverId: string; userId: string; nickname: string | null; roleIds: string[] | string; joinedAt: string; timedOutUntil?: string | null; username?: string; displayName?: string; avatar?: string | null; status?: string; customStatus?: string | null; }
export interface FriendshipShape { id: string; userId: string; friendId: string; status: string; createdAt: string; username?: string; displayName?: string; avatar?: string | null; status2?: string; }
export interface InviteShape { id: string; serverId: string; code: string; creatorId: string; expiresAt: string | null; maxUses: number | null; uses: number; createdAt: string; }
export interface DMShape { id: string; name: string; memberIds: string | string[]; isGroup: number | boolean; createdAt: string; }
export interface AuditShape { id: string; serverId: string; actorId: string; action: string; targetId: string | null; detail: string | null; createdAt: string; }
export interface VoiceStateShape { userId: string; channelId: string | null; serverId: string | null; muted: boolean; deafened: boolean; speaking: boolean; video: boolean; sharing: boolean; }
export interface InstallShape { deviceId: string; userId: string; username: string; displayName: string; appVersion: string; platform: string; arch: string; lastSeen: string; createdAt: string; }
export interface ReadStateShape { channelId: string; lastReadMessageId: string | null; unread: number; mentions: number; updatedAt: string; }
export interface Bootstrap {
  users: UserShape[]; servers: ServerShape[]; channels: ChannelShape[];
  dmChannels: DMShape[]; dmChannelIds: string[]; members: MemberShape[];
  roles: RoleShape[]; friendships: FriendshipShape[]; readStates: ReadStateShape[];
}
