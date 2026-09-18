// Orbit shared domain types — original design, no third-party assets.
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type ChannelType = 'text' | 'voice' | 'announcement' | 'category';
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
export type InviteStatus = 'valid' | 'expired' | 'exhausted' | 'invalid';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null; // color-key or data-url; no external assets
  status: PresenceStatus;
  customStatus: string | null;
  bio: string | null;
  createdAt: string;
}

export interface AuthUser extends User {
  email: string;
}

export interface Server {
  id: string;
  name: string;
  icon: string | null; // emoji/gradient key, original
  ownerId: string;
  createdAt: string;
  memberCount?: number;
}

export interface Channel {
  id: string;
  serverId: string | null; // null => DM channel
  name: string;
  type: ChannelType;
  categoryId: string | null;
  position: number;
  topic: string | null;
  nsfw?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string; // data-url or local file url
  width?: number;
  height?: number;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  attachments: Attachment[];
  replyTo: string | null;
  editedAt: string | null;
  createdAt: string;
  pinned?: boolean;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export type PermissionKey =
  | 'administrator'
  | 'manageServer'
  | 'manageChannels'
  | 'manageRoles'
  | 'kickMembers'
  | 'banMembers'
  | 'manageMessages'
  | 'mentionEveryone'
  | 'connect'
  | 'speak'
  | 'stream';

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string;
  permissions: PermissionKey[];
  position: number;
}

export interface Member {
  id: string;
  serverId: string;
  userId: string;
  nickname: string | null;
  roleIds: string[];
  joinedAt: string;
  timedOutUntil?: string | null;
  user?: User;
}

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
  friend?: User;
}

export interface Invite {
  id: string;
  serverId: string;
  code: string;
  creatorId: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  createdAt: string;
}

export interface DMChannel {
  id: string;
  name: string;
  memberIds: string[];
  isGroup: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  serverId: string;
  actorId: string;
  action: string;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface VoiceState {
  userId: string;
  channelId: string | null;
  serverId: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  video: boolean;
  sharing: boolean;
}

export interface ReadState {
  channelId: string;
  lastReadMessageId: string | null;
  mentionCount: number;
  unreadCount: number;
}
