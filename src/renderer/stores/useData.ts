import { create } from 'zustand';
import { api, type Bootstrap, type ChannelShape, type MemberShape, type MsgShape, type ReactionShape, type RoleShape, type ServerShape, type UserShape, type FriendshipShape, type DMShape } from '../lib/api';

export interface ReadState { lastReadId: string | null; unread: number; mentions: number; }

// Best-effort server persistence of read markers (debounced per channel).
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
function persistRead(channelId: string, s: ReadState): void {
  const prev = readTimers.get(channelId);
  if (prev) clearTimeout(prev);
  readTimers.set(
    channelId,
    setTimeout(() => {
      readTimers.delete(channelId);
      api.saveReadState(channelId, { lastReadMessageId: s.lastReadId, unread: s.unread, mentions: s.mentions }).catch(() => undefined);
    }, 800),
  );
}

interface DataState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  users: Record<string, UserShape>;
  servers: ServerShape[];
  channels: ChannelShape[];
  messages: Record<string, MsgShape[]>; // channelId -> asc
  hasMore: Record<string, boolean>;
  loadingMore: Record<string, boolean>;
  reactions: Record<string, ReactionShape[]>; // messageId ->
  members: MemberShape[];
  roles: RoleShape[];
  friendships: FriendshipShape[];
  dms: DMShape[];
  read: Record<string, ReadState>;
  mutedChannels: Record<string, boolean>;
  mutedServers: Record<string, boolean>;
  typing: Record<string, { userId: string; at: number }[]>;
  bootstrap: () => Promise<void>;
  loadMessages: (channelId: string, opts?: { more?: boolean }) => Promise<void>;
  sendMessage: (channelId: string, content: string, extra?: { replyTo?: string | null; attachments?: MsgShape['attachments'] }) => Promise<MsgShape>;
  editMessage: (id: string, channelId: string, content: string) => Promise<void>;
  deleteMessage: (id: string, channelId: string) => Promise<void>;
  togglePin: (id: string, channelId: string, pinned: boolean) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
  upsertMessage: (m: MsgShape) => void;
  removeMessage: (id: string, channelId: string) => void;
  setMessages: (channelId: string, msgs: MsgShape[], hasMore: boolean) => void;
  prependMessages: (channelId: string, msgs: MsgShape[], hasMore: boolean) => void;
  upsertReaction: (r: ReactionShape) => void;
  removeReaction: (messageId: string, userId: string, emoji: string) => void;
  setReactions: (messageId: string, list: ReactionShape[]) => void;
  addTyping: (channelId: string, userId: string) => void;
  markRead: (channelId: string, messageId: string | null, opts?: { mention?: boolean }) => void;
  bumpUnread: (channelId: string, message: MsgShape, meId: string, muted: boolean) => void;
  refreshMembers: (serverId: string) => Promise<void>;
  refreshRoles: (serverId: string) => Promise<void>;
  refreshFriends: () => Promise<void>;
  refreshDMs: () => Promise<void>;
  applyBootstrap: (b: Bootstrap) => void;
  upsertServer: (s: ServerShape) => void;
  removeServer: (id: string) => void;
  upsertChannel: (c: ChannelShape) => void;
  removeChannel: (id: string) => void;
  upsertUser: (u: UserShape) => void;
  toggleMuteChannel: (id: string) => void;
  toggleMuteServer: (id: string) => void;
  memberJoin: (serverId: string, userId: string) => void;
  memberLeave: (serverId: string, userId: string) => void;
}

function normRoles(m: MemberShape): MemberShape {
  if (typeof m.roleIds === 'string') {
    try { return { ...m, roleIds: JSON.parse(m.roleIds) }; } catch { return { ...m, roleIds: [] }; }
  }
  return m;
}

export const useData = create<DataState>((set, get) => ({
  ready: false, loading: false, error: null,
  users: {}, servers: [], channels: [], messages: {}, hasMore: {}, loadingMore: {},
  reactions: {}, members: [], roles: [], friendships: [], dms: [],
  read: {}, mutedChannels: {}, mutedServers: {}, typing: {},

  applyBootstrap: (b) => {
    const users: Record<string, UserShape> = {};
    for (const u of b.users) users[u.id] = u;
    const read: Record<string, ReadState> = {};
    for (const r of b.readStates ?? []) {
      read[r.channelId] = { lastReadId: r.lastReadMessageId, unread: r.unread ?? 0, mentions: r.mentions ?? 0 };
    }
    set({
      users, servers: b.servers, channels: b.channels,
      members: b.members.map(normRoles), roles: b.roles,
      friendships: b.friendships, dms: b.dmChannels, ready: true, loading: false, error: null,
      read,
    });
  },

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const b = await api.bootstrap();
      get().applyBootstrap(b);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      throw e;
    }
  },

  loadMessages: async (channelId, opts) => {
    if (get().loadingMore[channelId]) return;
    if (opts?.more && !get().hasMore[channelId]) return;
    set((s) => ({ loadingMore: { ...s.loadingMore, [channelId]: true } }));
    try {
      const existing = get().messages[channelId] ?? [];
      const before = opts?.more ? existing[0]?.id : undefined;
      if (opts?.more && !before) { set((s) => ({ loadingMore: { ...s.loadingMore, [channelId]: false } })); return; }
      const { messages, reactions, hasMore } = await api.messages(channelId, 50, before);
      if (opts?.more) get().prependMessages(channelId, messages, hasMore);
      else get().setMessages(channelId, messages, hasMore);
      const byMsg: Record<string, ReactionShape[]> = {};
      for (const r of reactions) { (byMsg[r.messageId] ??= []).push(r); }
      set((s) => ({ reactions: { ...s.reactions, ...byMsg }, loadingMore: { ...s.loadingMore, [channelId]: false } }));
    } catch {
      set((s) => ({ loadingMore: { ...s.loadingMore, [channelId]: false } }));
      throw new Error('Failed to load messages');
    }
  },

  sendMessage: async (channelId, content, extra) => {
    const { message } = await api.sendMessage(channelId, { content, replyTo: extra?.replyTo ?? null, attachments: extra?.attachments ?? [] });
    get().upsertMessage(message);
    get().markRead(channelId, message.id);
    return message;
  },
  editMessage: async (id, channelId, content) => {
    const { message } = await api.editMessage(id, content);
    get().upsertMessage(message);
    void channelId;
  },
  deleteMessage: async (id, channelId) => {
    await api.deleteMessage(id);
    get().removeMessage(id, channelId);
  },
  togglePin: async (id, _channelId, pinned) => {
    const { message } = await api.pinMessage(id, pinned);
    get().upsertMessage(message);
  },
  toggleReaction: async (messageId, emoji, userId) => {
    const list = get().reactions[messageId] ?? [];
    const mine = list.some((r) => r.userId === userId && r.emoji === emoji);
    if (mine) { await api.unreact(messageId, emoji); get().removeReaction(messageId, userId, emoji); }
    else { await api.react(messageId, emoji); get().upsertReaction({ id: `${messageId}:${userId}:${emoji}`, messageId, userId, emoji }); }
  },

  upsertMessage: (m) => set((s) => {
    const list = s.messages[m.channelId] ?? [];
    const i = list.findIndex((x) => x.id === m.id);
    const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { messages: { ...s.messages, [m.channelId]: next } };
  }),
  removeMessage: (id, channelId) => set((s) => ({
    messages: { ...s.messages, [channelId]: (s.messages[channelId] ?? []).filter((m) => m.id !== id) },
  })),
  setMessages: (channelId, msgs, hasMore) => set((s) => ({
    messages: { ...s.messages, [channelId]: msgs }, hasMore: { ...s.hasMore, [channelId]: hasMore },
  })),
  prependMessages: (channelId, msgs, hasMore) => set((s) => ({
    messages: { ...s.messages, [channelId]: [...msgs, ...(s.messages[channelId] ?? [])] },
    hasMore: { ...s.hasMore, [channelId]: hasMore },
  })),
  upsertReaction: (r) => set((s) => {
    const list = s.reactions[r.messageId] ?? [];
    if (list.some((x) => x.userId === r.userId && x.emoji === r.emoji)) return s;
    return { reactions: { ...s.reactions, [r.messageId]: [...list, r] } };
  }),
  removeReaction: (messageId, userId, emoji) => set((s) => ({
    reactions: { ...s.reactions, [messageId]: (s.reactions[messageId] ?? []).filter((r) => !(r.userId === userId && r.emoji === emoji)) },
  })),
  setReactions: (messageId, list) => set((s) => ({ reactions: { ...s.reactions, [messageId]: list } })),
  addTyping: (channelId, userId) => set((s) => {
    const now = Date.now();
    const list = (s.typing[channelId] ?? []).filter((t) => t.userId !== userId && now - t.at < 6000);
    return { typing: { ...s.typing, [channelId]: [...list, { userId, at: now }] } };
  }),

  markRead: (channelId, messageId, opts) => {
    const cur = get().read[channelId] ?? { lastReadId: null, unread: 0, mentions: 0 };
    const next: ReadState = {
      lastReadId: messageId ?? cur.lastReadId,
      unread: 0,
      mentions: opts?.mention ? cur.mentions : 0,
    };
    set((s) => ({ read: { ...s.read, [channelId]: next } }));
    persistRead(channelId, next);
  },
  bumpUnread: (channelId, message, meId, muted) => {
    if (message.authorId === meId) return;
    const st = get();
    const cur = st.read[channelId] ?? { lastReadId: null, unread: 0, mentions: 0 };
    const mentioned = message.content.toLowerCase().includes(`@${(st.users[meId]?.username ?? '').toLowerCase()}`) || message.content.includes('@everyone');
    const next: ReadState = {
      lastReadId: cur.lastReadId,
      unread: muted ? cur.unread : cur.unread + 1,
      mentions: mentioned && !muted ? cur.mentions + 1 : cur.mentions,
    };
    set((s) => ({ read: { ...s.read, [channelId]: next } }));
    persistRead(channelId, next);
  },

  refreshMembers: async (serverId) => {
    const { members } = await api.members(serverId);
    set((s) => ({ members: [...s.members.filter((m) => m.serverId !== serverId), ...members.map(normRoles)] }));
  },
  refreshRoles: async (serverId) => {
    const { roles } = await api.roles(serverId);
    set((s) => ({ roles: [...s.roles.filter((r) => r.serverId !== serverId), ...roles] }));
  },
  refreshFriends: async () => {
    const { friendships } = await api.friends();
    set({ friendships });
  },
  refreshDMs: async () => {
    const { dms } = await api.dms();
    set({ dms });
  },

  upsertServer: (sv) => set((s) => ({
    servers: s.servers.some((x) => x.id === sv.id) ? s.servers.map((x) => (x.id === sv.id ? sv : x)) : [...s.servers, sv],
  })),
  removeServer: (id) => set((s) => ({
    servers: s.servers.filter((x) => x.id !== id),
    channels: s.channels.filter((c) => c.serverId !== id),
  })),
  upsertChannel: (c) => set((s) => ({
    channels: s.channels.some((x) => x.id === c.id) ? s.channels.map((x) => (x.id === c.id ? c : x)) : [...s.channels, c],
  })),
  removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
  upsertUser: (u) => set((s) => ({ users: { ...s.users, [u.id]: { ...(s.users[u.id] ?? {}), ...u } } })),
  toggleMuteChannel: (id) => set((s) => ({ mutedChannels: { ...s.mutedChannels, [id]: !s.mutedChannels[id] } })),
  toggleMuteServer: (id) => set((s) => ({ mutedServers: { ...s.mutedServers, [id]: !s.mutedServers[id] } })),
  memberJoin: (serverId, userId) => {
    void serverId; void userId;
    const sid = serverId;
    void api.members(sid).then(({ members }) => set((s) => ({
      members: [...s.members.filter((m) => !(m.serverId === sid && m.userId === userId)), ...members.map(normRoles).filter((m) => m.userId === userId)],
    }))).catch(() => undefined);
  },
  memberLeave: (serverId, userId) => set((s) => ({
    members: s.members.filter((m) => !(m.serverId === serverId && m.userId === userId)),
  })),
}));
