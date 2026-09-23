import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, displayName TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL,
  avatar TEXT, status TEXT DEFAULT 'online', customStatus TEXT, bio TEXT,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  ownerId TEXT NOT NULL REFERENCES users(id), createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, serverId TEXT REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, type TEXT NOT NULL, categoryId TEXT,
  position INTEGER DEFAULT 0, topic TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, channelId TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  authorId TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL,
  attachments TEXT DEFAULT '[]', replyTo TEXT, editedAt TEXT,
  createdAt TEXT NOT NULL, pinned INTEGER DEFAULT 0, clientId TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channelId, createdAt);
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY, messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id), emoji TEXT NOT NULL,
  UNIQUE(messageId, userId, emoji)
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, permissions TEXT NOT NULL, position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id), nickname TEXT,
  roleIds TEXT DEFAULT '[]', joinedAt TEXT NOT NULL, timedOutUntil TEXT,
  UNIQUE(serverId, userId)
);
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id),
  friendId TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, createdAt TEXT NOT NULL,
  UNIQUE(userId, friendId)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL, creatorId TEXT NOT NULL, expiresAt TEXT,
  maxUses INTEGER, uses INTEGER DEFAULT 0, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, memberIds TEXT NOT NULL,
  isGroup INTEGER DEFAULT 0, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, serverId TEXT NOT NULL, actorId TEXT NOT NULL,
  action TEXT NOT NULL, targetId TEXT, detail TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bans (
  serverId TEXT NOT NULL, userId TEXT NOT NULL, reason TEXT, createdAt TEXT NOT NULL,
  PRIMARY KEY (serverId, userId)
);
CREATE TABLE IF NOT EXISTS channel_read_state (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channelId TEXT NOT NULL,
  lastReadMessageId TEXT,
  unread INTEGER DEFAULT 0,
  mentions INTEGER DEFAULT 0,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (userId, channelId)
);
CREATE TABLE IF NOT EXISTS installations (
  deviceId TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  displayName TEXT NOT NULL,
  appVersion TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  lastSeen TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_installations_user ON installations(userId);
`;
