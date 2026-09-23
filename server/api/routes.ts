import { randomUUID } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { all, get, run } from '../database/db.js';
import { channelSchema, hashPassword, loginSchema, messageSchema, passwordChangeSchema, profilePatchSchema, registerSchema, serverSchema, verifyPassword, signToken, verifyToken } from '../services/auth.js';
import { isMember, memberPermissions, requirePerm } from '../services/permissions.js';
import { checkSpam } from '../services/spam.js';
import { broadcast, getVoiceStates, setVoiceState } from '../websocket/hub.js';
import { ALLOWED_UPLOAD_MIME, BLOCKED_EXTENSIONS, MAX_UPLOAD_MB } from '../../src/shared/constants/app.js';

export interface Authed extends Request { userId?: string }

function iso() { return new Date().toISOString(); }
function inviteCode(): string {
  return Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6);
}
function sanitizeContent(s: string): string {
  return s.replace(/\0/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 2000);
}
function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
function rowToMessage(r: Record<string, unknown>) {
  return {
    id: r.id, channelId: r.channelId, authorId: r.authorId,
    content: r.content, attachments: parseJson(r.attachments, []),
    replyTo: r.replyTo ?? null, editedAt: r.editedAt ?? null,
    createdAt: r.createdAt, pinned: Number(r.pinned ?? 0) === 1,
    clientId: (r.clientId as string | null) ?? null,
  };
}
function audit(serverId: string, actorId: string, action: string, targetId: string | null = null, detail: string | null = null) {
  run('INSERT INTO audit_log (id, serverId, actorId, action, targetId, detail, createdAt) VALUES (?,?,?,?,?,?,?)',
    [randomUUID(), serverId, actorId, action, targetId, detail, iso()]);
}

export function authMiddleware(req: Authed, res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const sub = verifyToken(token);
  if (!sub) { res.status(401).json({ error: 'Invalid token' }); return; }
  req.userId = sub;
  next();
}

function publicUser(r: Record<string, unknown>) {
  return { id: r.id, username: r.username, displayName: r.displayName, avatar: r.avatar ?? null, status: r.status ?? 'offline', customStatus: r.customStatus ?? null, bio: (r.bio as string | null) ?? null, createdAt: r.createdAt };
}

export function mountApi(app: Express) {
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'orbit', at: iso() }));

  // ---- auth ----
  app.post('/api/auth/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', detail: parsed.error.flatten() }); return; }
    const { username, displayName, email, password } = parsed.data;
    if (get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username])) {
      res.status(409).json({ error: 'Email or username already taken' }); return;
    }
    const id = randomUUID();
    const hash = await hashPassword(password);
    run('INSERT INTO users (id, username, displayName, email, passwordHash, avatar, status, customStatus, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, username, displayName, email, hash, '🪐', 'online', null, iso()]);
    const token = signToken(id);
    const row = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [id]);
    res.status(201).json({ token, user: { ...publicUser(row!), email } });
  });

  app.post('/api/auth/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }
    const row = get<Record<string, unknown> & { passwordHash: string }>('SELECT * FROM users WHERE email = ?', [parsed.data.email]);
    if (!row || !(await verifyPassword(parsed.data.password, row.passwordHash))) {
      res.status(401).json({ error: 'Invalid email or password' }); return;
    }
    run('UPDATE users SET status = ? WHERE id = ?', ['online', row.id]);
    broadcast('PRESENCE_UPDATE', { userId: row.id, status: 'online' });
    const token = signToken(String(row.id));
    res.json({ token, user: { ...publicUser(row), email: row.email } });
  });

  app.get('/api/auth/me', authMiddleware, (req: Authed, res) => {
    const row = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [req.userId!]);
    if (!row) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user: { ...publicUser(row), email: row.email } });
  });

  app.patch('/api/auth/me', authMiddleware, (req: Authed, res) => {
    const parsed = profilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'Invalid profile', detail: parsed.error.flatten() }); return; }
    const b = parsed.data;
    if (b.username !== undefined) {
      const taken = get<{ id: string }>('SELECT id FROM users WHERE username = ? AND id != ?', [b.username, req.userId!]);
      if (taken) { res.status(409).json({ error: 'Username already taken' }); return; }
    }
    if (b.email !== undefined) {
      const taken = get<{ id: string }>('SELECT id FROM users WHERE email = ? AND id != ?', [b.email, req.userId!]);
      if (taken) { res.status(409).json({ error: 'Email already in use' }); return; }
    }
    const sets: string[] = []; const vals: unknown[] = [];
    if (b.displayName !== undefined) { sets.push('displayName = ?'); vals.push(b.displayName); }
    if (b.username !== undefined) { sets.push('username = ?'); vals.push(b.username); }
    if (b.email !== undefined) { sets.push('email = ?'); vals.push(b.email); }
    if (b.customStatus !== undefined) { sets.push('customStatus = ?'); vals.push(b.customStatus); }
    if (b.bio !== undefined) { sets.push('bio = ?'); vals.push(b.bio); }
    if (b.status !== undefined) { sets.push('status = ?'); vals.push(b.status); }
    if (b.avatar !== undefined) { sets.push('avatar = ?'); vals.push(b.avatar); }
    if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.userId!]);
    if (b.status) broadcast('PRESENCE_UPDATE', { userId: req.userId!, status: b.status });
    const row = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [req.userId!]);
    res.json({ user: { ...publicUser(row!), email: row!.email } });
  });

  app.post('/api/auth/password', authMiddleware, async (req: Authed, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', detail: parsed.error.flatten() }); return; }
    const row = get<Record<string, unknown> & { passwordHash: string }>('SELECT * FROM users WHERE id = ?', [req.userId!]);
    if (!row || !(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }
    run('UPDATE users SET passwordHash = ? WHERE id = ?', [await hashPassword(parsed.data.newPassword), req.userId!]);
    res.json({ ok: true });
  });

  app.delete('/api/auth/me', authMiddleware, async (req: Authed, res) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || !password) { res.status(400).json({ error: 'Password required' }); return; }
    const row = get<Record<string, unknown> & { passwordHash: string }>('SELECT * FROM users WHERE id = ?', [req.userId!]);
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      res.status(401).json({ error: 'Password is incorrect' }); return;
    }
    const owned = get<{ id: string }>('SELECT id FROM servers WHERE ownerId = ? LIMIT 1', [req.userId!]);
    if (owned) { res.status(400).json({ error: 'Delete the servers you own first (your communities survive you)' }); return; }
    const uid = req.userId!;
    const serverIds = all<{ serverId: string }>('SELECT DISTINCT serverId FROM members WHERE userId = ?', [uid]).map((r) => r.serverId);
    run('DELETE FROM reactions WHERE userId = ?', [uid]);
    run('DELETE FROM messages WHERE authorId = ?', [uid]);
    run('DELETE FROM members WHERE userId = ?', [uid]);
    run('DELETE FROM friendships WHERE userId = ? OR friendId = ?', [uid, uid]);
    run('DELETE FROM invites WHERE creatorId = ?', [uid]);
    run('DELETE FROM channel_read_state WHERE userId = ?', [uid]);
    run('DELETE FROM bans WHERE userId = ?', [uid]);
    run('DELETE FROM users WHERE id = ?', [uid]);
    setVoiceState(uid, { channelId: null, serverId: null, muted: false, deafened: false, speaking: false, video: false, sharing: false });
    for (const sid of serverIds) broadcast('MEMBER_LEAVE', { serverId: sid, userId: uid });
    res.json({ ok: true });
  });

  // ---- bootstrap: everything the client needs on load ----
  app.get('/api/bootstrap', authMiddleware, (req: Authed, res) => {
    const me = req.userId!;
    const memberOf = all<{ serverId: string }>('SELECT serverId FROM members WHERE userId = ?', [me]).map((r) => r.serverId);
    const owned = all<{ id: string }>('SELECT id FROM servers WHERE ownerId = ?', [me]).map((r) => r.id);
    const serverIds = [...new Set([...memberOf, ...owned])];
    const servers = serverIds.length
      ? all<Record<string, unknown>>(`SELECT * FROM servers WHERE id IN (${serverIds.map(() => '?').join(',')})`, serverIds)
      : [];
    const channels = serverIds.length
      ? all<Record<string, unknown>>(`SELECT * FROM channels WHERE serverId IN (${serverIds.map(() => '?').join(',')}) ORDER BY position`, serverIds)
      : [];
    const dmIds = all<{ id: string }>('SELECT id FROM channels WHERE serverId IS NULL').filter((c) => {
      const ch = get<{ name: string }>('SELECT name FROM channels WHERE id = ?', [c.id]);
      return !!ch;
    }).map((c) => c.id);
    const dmChannels = all<Record<string, unknown>>('SELECT * FROM dm_channels');
    const users = all<Record<string, unknown>>('SELECT id, username, displayName, avatar, status, customStatus, bio, createdAt FROM users LIMIT 200');
    const members = serverIds.length
      ? all<Record<string, unknown>>(`SELECT * FROM members WHERE serverId IN (${serverIds.map(() => '?').join(',')})`, serverIds)
      : [];
    const roles = serverIds.length
      ? all<Record<string, unknown>>(`SELECT * FROM roles WHERE serverId IN (${serverIds.map(() => '?').join(',')})`, serverIds)
      : [];
    const friendships = all<Record<string, unknown>>(
      `SELECT f.*, u.username, u.displayName, u.avatar, u.status AS userStatus, u.customStatus
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.userId = ? THEN f.friendId ELSE f.userId END
       WHERE f.userId = ? OR (f.friendId = ? AND f.status = 'pending')`,
      [me, me, me]);
    const readStates = all('SELECT channelId, lastReadMessageId, unread, mentions, updatedAt FROM channel_read_state WHERE userId = ?', [me]);
    res.json({
      users, servers, channels, dmChannels, dmChannelIds: dmIds, members,
      roles: roles.map((r) => ({ ...r, permissions: parseJson(r.permissions, []) })),
      friendships, readStates,
    });
  });

  // ---- servers ----
  app.post('/api/servers', authMiddleware, (req: Authed, res) => {
    const parsed = serverSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid server' }); return; }
    const id = randomUUID();
    run('INSERT INTO servers (id, name, icon, ownerId, createdAt) VALUES (?,?,?,?,?)',
      [id, parsed.data.name.trim(), parsed.data.icon ?? '🪐', req.userId!, iso()]);
    run('INSERT INTO members (id, serverId, userId, nickname, roleIds, joinedAt) VALUES (?,?,?,?,?,?)',
      [randomUUID(), id, req.userId!, null, '[]', iso()]);
    const roleId = randomUUID();
    run('INSERT INTO roles (id, serverId, name, color, permissions, position) VALUES (?,?,?,?,?,?)',
      [roleId, id, 'Admins', '#f0a35e', JSON.stringify(['administrator']), 1]);
    run('UPDATE members SET roleIds = ? WHERE serverId = ? AND userId = ?', [JSON.stringify([roleId]), id, req.userId!]);
    const chId = randomUUID();
    run('INSERT INTO channels (id, serverId, name, type, categoryId, position, topic) VALUES (?,?,?,?,?,?,?)',
      [chId, id, 'general', 'text', null, 0, 'Say hello!']);
    audit(id, req.userId!, 'SERVER_CREATE', id, parsed.data.name);
    const server = get('SELECT * FROM servers WHERE id = ?', [id]);
    broadcast('SERVER_CREATE', server);
    res.status(201).json({ server });
  });

  app.patch('/api/servers/:id', authMiddleware, (req: Authed, res) => {
    const sid = req.params.id;
    const perms = memberPermissions(sid, req.userId!);
    if (!perms.has('manageServer')) { res.status(403).json({ error: 'Missing Manage Server' }); return; }
    const { name, icon } = req.body ?? {};
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.length > 100)) { res.status(400).json({ error: 'Bad name' }); return; }
    if (name !== undefined) run('UPDATE servers SET name = ? WHERE id = ?', [name.trim(), sid]);
    if (icon !== undefined) run('UPDATE servers SET icon = ? WHERE id = ?', [icon, sid]);
    audit(sid, req.userId!, 'SERVER_UPDATE', sid, name ?? null);
    const server = get('SELECT * FROM servers WHERE id = ?', [sid]);
    broadcast('SERVER_UPDATE', server);
    res.json({ server });
  });

  app.delete('/api/servers/:id', authMiddleware, (req: Authed, res) => {
    const sid = req.params.id;
    const s = get<{ ownerId: string }>('SELECT ownerId FROM servers WHERE id = ?', [sid]);
    if (!s) { res.status(404).json({ error: 'Not found' }); return; }
    if (s.ownerId !== req.userId) { res.status(403).json({ error: 'Only owner can delete' }); return; }
    run('DELETE FROM servers WHERE id = ?', [sid]);
    broadcast('SERVER_DELETE', { id: sid });
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/leave', authMiddleware, (req: Authed, res) => {
    const sid = req.params.id;
    const s = get<{ ownerId: string }>('SELECT ownerId FROM servers WHERE id = ?', [sid]);
    if (!s) { res.status(404).json({ error: 'Not found' }); return; }
    if (s.ownerId === req.userId) { res.status(400).json({ error: 'Owner cannot leave; delete or transfer first' }); return; }
    run('DELETE FROM members WHERE serverId = ? AND userId = ?', [sid, req.userId!]);
    broadcast('MEMBER_LEAVE', { serverId: sid, userId: req.userId });
    res.json({ ok: true });
  });

  // ---- channels ----
  app.post('/api/servers/:id/channels', authMiddleware, (req: Authed, res) => {
    const sid = req.params.id;
    if (!requirePerm(sid, req.userId!, 'manageChannels') && get<{ ownerId: string }>('SELECT ownerId FROM servers WHERE id = ?', [sid])?.ownerId !== req.userId) {
      res.status(403).json({ error: 'Missing Manage Channels' }); return;
    }
    const parsed = channelSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid channel' }); return; }
    const maxPos = get<{ m: number }>('SELECT COALESCE(MAX(position), -1) as m FROM channels WHERE serverId = ?', [sid]);
    const id = randomUUID();
    run('INSERT INTO channels (id, serverId, name, type, categoryId, position, topic) VALUES (?,?,?,?,?,?,?)',
      [id, sid, parsed.data.name.trim(), parsed.data.type, parsed.data.categoryId ?? null, (maxPos?.m ?? -1) + 1, parsed.data.topic ?? null]);
    audit(sid, req.userId!, 'CHANNEL_CREATE', id, parsed.data.name);
    const ch = get('SELECT * FROM channels WHERE id = ?', [id]);
    broadcast('CHANNEL_CREATE', ch);
    res.status(201).json({ channel: ch });
  });

  app.patch('/api/channels/:id', authMiddleware, (req: Authed, res) => {
    const ch = get<Record<string, unknown> & { serverId: string }>('SELECT * FROM channels WHERE id = ?', [req.params.id]);
    if (!ch) { res.status(404).json({ error: 'Not found' }); return; }
    if (ch.serverId && !requirePerm(ch.serverId, req.userId!, 'manageChannels')) { res.status(403).json({ error: 'Missing Manage Channels' }); return; }
    const { name, topic, position, categoryId } = req.body ?? {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) { res.status(400).json({ error: 'Bad name' }); return; }
      run('UPDATE channels SET name = ? WHERE id = ?', [name.trim(), ch.id]);
    }
    if (topic !== undefined) run('UPDATE channels SET topic = ? WHERE id = ?', [topic, ch.id]);
    if (position !== undefined && Number.isInteger(position)) run('UPDATE channels SET position = ? WHERE id = ?', [position, ch.id]);
    if (categoryId !== undefined) run('UPDATE channels SET categoryId = ? WHERE id = ?', [categoryId, ch.id]);
    const updated = get('SELECT * FROM channels WHERE id = ?', [ch.id]);
    broadcast('CHANNEL_UPDATE', updated);
    res.json({ channel: updated });
  });

  app.delete('/api/channels/:id', authMiddleware, (req: Authed, res) => {
    const ch = get<Record<string, unknown> & { serverId: string; name: string }>('SELECT * FROM channels WHERE id = ?', [req.params.id]);
    if (!ch) { res.status(404).json({ error: 'Not found' }); return; }
    if (ch.name === 'general') { res.status(400).json({ error: 'Cannot delete #general' }); return; }
    if (ch.serverId && !requirePerm(ch.serverId, req.userId!, 'manageChannels')) { res.status(403).json({ error: 'Missing Manage Channels' }); return; }
    if (ch.serverId) audit(ch.serverId, req.userId!, 'CHANNEL_DELETE', String(ch.id), ch.name);
    run('DELETE FROM channels WHERE id = ?', [ch.id]);
    broadcast('CHANNEL_DELETE', { id: ch.id, serverId: ch.serverId });
    res.json({ ok: true });
  });

  app.post('/api/channels/reorder', authMiddleware, (req: Authed, res) => {
    const { orderedIds } = req.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length > 200) { res.status(400).json({ error: 'Bad order' }); return; }
    orderedIds.forEach((id, i) => run('UPDATE channels SET position = ? WHERE id = ?', [i, id]));
    res.json({ ok: true });
  });

  // ---- messages ----
  app.get('/api/channels/:id/messages', authMiddleware, (req: Authed, res) => {
    const cid = req.params.id;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const before = req.query.before ? String(req.query.before) : null;
    let rows: Record<string, unknown>[];
    if (before) {
      const anchor = get<{ createdAt: string }>('SELECT createdAt FROM messages WHERE id = ?', [before]);
      rows = anchor
        ? all('SELECT * FROM messages WHERE channelId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?', [cid, anchor.createdAt, limit])
        : [];
    } else {
      rows = all('SELECT * FROM messages WHERE channelId = ? ORDER BY createdAt DESC LIMIT ?', [cid, limit]);
    }
    const items = rows.reverse().map(rowToMessage);
    const reactions = cid ? all<Record<string, unknown>>('SELECT * FROM reactions WHERE messageId IN (SELECT id FROM messages WHERE channelId = ?)', [cid]) : [];
    res.json({ messages: items, reactions, hasMore: rows.length >= limit });
  });

  app.post('/api/channels/:id/messages', authMiddleware, (req: Authed, res) => {
    const cid = req.params.id;
    const ch = get<{ serverId: string }>('SELECT serverId FROM channels WHERE id = ?', [cid]);
    if (!ch) { res.status(404).json({ error: 'Channel not found' }); return; }
    if (ch.serverId) {
      const ban = get('SELECT * FROM bans WHERE serverId = ? AND userId = ?', [ch.serverId, req.userId!]);
      if (ban) { res.status(403).json({ error: 'You are banned from this server' }); return; }
      const m = get<{ timedOutUntil: string }>('SELECT timedOutUntil FROM members WHERE serverId = ? AND userId = ?', [ch.serverId, req.userId!]);
      if (m?.timedOutUntil && new Date(m.timedOutUntil).getTime() > Date.now()) { res.status(403).json({ error: 'You are timed out' }); return; }
    }
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid message', detail: parsed.error.flatten() }); return; }
    // Idempotent sends FIRST: retries (e.g. offline-queue flush) carry the same
    // clientId and must receive the original message — before spam checks,
    // which would otherwise 429 a byte-identical retry as a "duplicate".
    const clientId = typeof parsed.data.clientId === 'string' && parsed.data.clientId.length > 0
      ? parsed.data.clientId.slice(0, 64) : null;
    if (clientId) {
      const dup = get<Record<string, unknown>>('SELECT * FROM messages WHERE clientId = ?', [clientId]);
      if (dup) { res.status(200).json({ message: rowToMessage(dup), deduped: true }); return; }
    }
    const spam = checkSpam(req.userId!, parsed.data.content);
    if (!spam.ok) { res.status(429).json({ error: spam.reason === 'duplicate' ? 'Duplicate message' : 'You are sending too fast', retryAfterMs: spam.retryAfterMs }); return; }
    const content = sanitizeContent(parsed.data.content);
    if (content.includes('@everyone') && ch.serverId && !requirePerm(ch.serverId, req.userId!, 'mentionEveryone')) {
      res.status(403).json({ error: 'Missing Mention Everyone permission' }); return;
    }
    const id = randomUUID();
    const atts = parsed.data.attachments ?? [];
    // validate uploads
    for (const a of atts) {
      const ext = a.name.split('.').pop()?.toLowerCase() ?? '';
      if (BLOCKED_EXTENSIONS.has(ext)) { res.status(400).json({ error: `File type .${ext} is blocked` }); return; }
      if (!ALLOWED_UPLOAD_MIME.has(a.mime) && !a.mime.startsWith('image/')) { res.status(400).json({ error: `MIME ${a.mime} not allowed` }); return; }
      if (a.size > MAX_UPLOAD_MB * 1024 * 1024) { res.status(400).json({ error: 'File too large' }); return; }
    }
    try {
      run('INSERT INTO messages (id, channelId, authorId, content, attachments, replyTo, editedAt, createdAt, pinned, clientId) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, cid, req.userId!, content, JSON.stringify(atts), parsed.data.replyTo ?? null, null, iso(), 0, clientId]);
    } catch (err) {
      // Lost a race with our own retry: return the winner instead of 500.
      if (clientId) {
        const dup = get<Record<string, unknown>>('SELECT * FROM messages WHERE clientId = ?', [clientId]);
        if (dup) { res.status(200).json({ message: rowToMessage(dup), deduped: true }); return; }
      }
      throw err;
    }
    const msg = rowToMessage(get<Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [id])!);
    broadcast('MESSAGE_CREATE', msg);
    res.status(201).json({ message: msg });
  });

  app.patch('/api/messages/:id', authMiddleware, (req: Authed, res) => {
    const m = get<Record<string, unknown> & { authorId: string; channelId: string }>('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    const ch = get<{ serverId: string }>('SELECT serverId FROM channels WHERE id = ?', [m.channelId]);
    const canManage = ch?.serverId ? requirePerm(ch.serverId, req.userId!, 'manageMessages') : false;
    if (m.authorId !== req.userId && !canManage) { res.status(403).json({ error: 'Cannot edit' }); return; }
    const content = sanitizeContent(String(req.body?.content ?? ''));
    if (!content.trim() || content.length > 2000) { res.status(400).json({ error: 'Bad content' }); return; }
    run('UPDATE messages SET content = ?, editedAt = ? WHERE id = ?', [content, iso(), m.id]);
    const updated = rowToMessage(get<Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [m.id])!);
    broadcast('MESSAGE_UPDATE', updated);
    res.json({ message: updated });
  });

  app.delete('/api/messages/:id', authMiddleware, (req: Authed, res) => {
    const m = get<Record<string, unknown> & { authorId: string; channelId: string }>('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    const ch = get<{ serverId: string }>('SELECT serverId FROM channels WHERE id = ?', [m.channelId]);
    const canManage = ch?.serverId ? requirePerm(ch.serverId, req.userId!, 'manageMessages') : false;
    if (m.authorId !== req.userId && !canManage) { res.status(403).json({ error: 'Cannot delete' }); return; }
    if (ch?.serverId && canManage && m.authorId !== req.userId) audit(ch.serverId, req.userId!, 'MESSAGE_DELETE', String(m.id), null);
    run('DELETE FROM reactions WHERE messageId = ?', [m.id]);
    run('DELETE FROM messages WHERE id = ?', [m.id]);
    broadcast('MESSAGE_DELETE', { id: m.id, channelId: m.channelId });
    res.json({ ok: true });
  });

  app.post('/api/messages/:id/pin', authMiddleware, (req: Authed, res) => {
    const m = get<{ channelId: string } & Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    const ch = get<{ serverId: string }>('SELECT serverId FROM channels WHERE id = ?', [m.channelId]);
    if (ch?.serverId && !requirePerm(ch.serverId, req.userId!, 'manageMessages')) { res.status(403).json({ error: 'Missing Manage Messages' }); return; }
    const pinned = Number(req.body?.pinned ?? 1) === 1 ? 1 : 0;
    run('UPDATE messages SET pinned = ? WHERE id = ?', [pinned, m.id]);
    const updated = rowToMessage(get<Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [m.id])!);
    broadcast('MESSAGE_UPDATE', updated);
    res.json({ message: updated });
  });

  app.get('/api/channels/:id/pins', authMiddleware, (req, res) => {
    const rows = all('SELECT * FROM messages WHERE channelId = ? AND pinned = 1 ORDER BY createdAt DESC', [req.params.id]);
    res.json({ messages: rows.map(rowToMessage) });
  });

  // ---- read states (persisted unread markers) ----
  app.get('/api/read-states', authMiddleware, (req: Authed, res) => {
    res.json({
      states: all('SELECT channelId, lastReadMessageId, unread, mentions, updatedAt FROM channel_read_state WHERE userId = ?', [req.userId!]),
    });
  });
  app.put('/api/read-states/:channelId', authMiddleware, (req: Authed, res) => {
    const cid = String(req.params.channelId).slice(0, 64);
    const b = (req.body ?? {}) as { lastReadMessageId?: string | null; unread?: number; mentions?: number };
    const last = b.lastReadMessageId == null ? null : String(b.lastReadMessageId).slice(0, 64);
    const unread = Math.max(0, Math.min(9999, Math.floor(Number(b.unread) || 0)));
    const mentions = Math.max(0, Math.min(9999, Math.floor(Number(b.mentions) || 0)));
    run(`INSERT INTO channel_read_state (userId, channelId, lastReadMessageId, unread, mentions, updatedAt)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(userId, channelId) DO UPDATE SET
           lastReadMessageId=excluded.lastReadMessageId, unread=excluded.unread,
           mentions=excluded.mentions, updatedAt=excluded.updatedAt`,
      [req.userId!, cid, last, unread, mentions, iso()]);
    res.json({ ok: true });
  });

  // ---- reactions ----
  app.post('/api/messages/:id/reactions', authMiddleware, (req: Authed, res) => {
    const { emoji } = req.body as { emoji: string };
    if (typeof emoji !== 'string' || [...emoji].length > 8 || emoji.length > 32) { res.status(400).json({ error: 'Bad emoji' }); return; }
    const m = get('SELECT id FROM messages WHERE id = ?', [req.params.id]);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    try {
      run('INSERT INTO reactions (id, messageId, userId, emoji) VALUES (?,?,?,?)', [randomUUID(), req.params.id, req.userId!, emoji]);
    } catch { /* already reacted */ }
    broadcast('REACTION_ADD', { messageId: req.params.id, userId: req.userId, emoji });
    res.status(201).json({ ok: true });
  });
  app.delete('/api/messages/:id/reactions', authMiddleware, (req: Authed, res) => {
    const emoji = String(req.query.emoji ?? '');
    run('DELETE FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?', [req.params.id, req.userId!, emoji]);
    broadcast('REACTION_REMOVE', { messageId: req.params.id, userId: req.userId, emoji });
    res.json({ ok: true });
  });

  // ---- members / roles / moderation ----
  app.get('/api/servers/:id/members', authMiddleware, (req, res) => {
    const rows = all<Record<string, unknown>>(
      'SELECT m.*, u.username, u.displayName, u.avatar, u.status, u.customStatus FROM members m JOIN users u ON u.id = m.userId WHERE m.serverId = ?', [req.params.id]);
    res.json({ members: rows.map((r) => ({ ...r, roleIds: parseJson(r.roleIds, []) })) });
  });

  app.get('/api/servers/:id/roles', authMiddleware, (req, res) => {
    const rows = all<Record<string, unknown>>('SELECT * FROM roles WHERE serverId = ? ORDER BY position DESC', [req.params.id]);
    res.json({ roles: rows.map((r) => ({ ...r, permissions: parseJson(r.permissions, []) })) });
  });

  app.post('/api/servers/:id/roles', authMiddleware, (req: Authed, res) => {
    if (!requirePerm(req.params.id, req.userId!, 'manageRoles')) { res.status(403).json({ error: 'Missing Manage Roles' }); return; }
    const { name, color, permissions } = req.body as { name: string; color: string; permissions: string[] };
    if (!name || name.length > 50) { res.status(400).json({ error: 'Bad role name' }); return; }
    const id = randomUUID();
    run('INSERT INTO roles (id, serverId, name, color, permissions, position) VALUES (?,?,?,?,?,?)',
      [id, req.params.id, name, color ?? '#9aa4b2', JSON.stringify(permissions ?? []), 0]);
    audit(req.params.id, req.userId!, 'ROLE_CREATE', id, name);
    res.status(201).json({ role: get('SELECT * FROM roles WHERE id = ?', [id]) });
  });

  app.patch('/api/servers/:sid/members/:uid/roles', authMiddleware, (req: Authed, res) => {
    if (!requirePerm(req.params.sid, req.userId!, 'manageRoles')) { res.status(403).json({ error: 'Missing Manage Roles' }); return; }
    const { roleIds } = req.body as { roleIds: string[] };
    run('UPDATE members SET roleIds = ? WHERE serverId = ? AND userId = ?', [JSON.stringify(roleIds ?? []), req.params.sid, req.params.uid]);
    res.json({ ok: true });
  });

  function modGuard(sid: string, actor: string, perm: 'kickMembers' | 'banMembers' | 'manageMessages'): { err?: string } {
    if (!requirePerm(sid, actor, perm)) return { err: `Missing ${perm}` };
    return {};
  }

  app.post('/api/servers/:id/kick', authMiddleware, (req: Authed, res) => {
    const g = modGuard(req.params.id, req.userId!, 'kickMembers');
    if (g.err) { res.status(403).json({ error: g.err }); return; }
    const { userId, reason } = req.body as { userId: string; reason?: string };
    run('DELETE FROM members WHERE serverId = ? AND userId = ?', [req.params.id, userId]);
    audit(req.params.id, req.userId!, 'KICK', userId, reason ?? null);
    broadcast('MEMBER_LEAVE', { serverId: req.params.id, userId });
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/ban', authMiddleware, (req: Authed, res) => {
    const g = modGuard(req.params.id, req.userId!, 'banMembers');
    if (g.err) { res.status(403).json({ error: g.err }); return; }
    const { userId, reason } = req.body as { userId: string; reason?: string };
    run('INSERT OR REPLACE INTO bans (serverId, userId, reason, createdAt) VALUES (?,?,?,?)', [req.params.id, userId, reason ?? null, iso()]);
    run('DELETE FROM members WHERE serverId = ? AND userId = ?', [req.params.id, userId]);
    audit(req.params.id, req.userId!, 'BAN', userId, reason ?? null);
    broadcast('MEMBER_LEAVE', { serverId: req.params.id, userId });
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/timeout', authMiddleware, (req: Authed, res) => {
    const g = modGuard(req.params.id, req.userId!, 'manageMessages');
    if (g.err) { res.status(403).json({ error: g.err }); return; }
    const { userId, minutes } = req.body as { userId: string; minutes: number };
    const until = new Date(Date.now() + Math.min(Math.max(minutes ?? 10, 1), 40320) * 60_000).toISOString();
    run('UPDATE members SET timedOutUntil = ? WHERE serverId = ? AND userId = ?', [until, req.params.id, userId]);
    audit(req.params.id, req.userId!, 'TIMEOUT', userId, until);
    res.json({ ok: true, timedOutUntil: until });
  });

  app.get('/api/servers/:id/audit', authMiddleware, (req: Authed, res) => {
    if (!requirePerm(req.params.id, req.userId!, 'manageServer')) { res.status(403).json({ error: 'Missing Manage Server' }); return; }
    res.json({ entries: all('SELECT * FROM audit_log WHERE serverId = ? ORDER BY createdAt DESC LIMIT 100', [req.params.id]) });
  });

  app.post('/api/messages/:id/report', authMiddleware, (req: Authed, res) => {
    const m = get<{ channelId: string }>('SELECT channelId FROM messages WHERE id = ?', [req.params.id]);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    const ch = get<{ serverId: string }>('SELECT serverId FROM channels WHERE id = ?', [m.channelId]);
    if (ch?.serverId) audit(ch.serverId, req.userId!, 'REPORT', req.params.id, String(req.body?.reason ?? 'reported').slice(0, 500));
    res.json({ ok: true });
  });

  // ---- invites ----
  app.post('/api/servers/:id/invites', authMiddleware, (req: Authed, res) => {
    if (!isMember(req.params.id, req.userId!)) { res.status(403).json({ error: 'Not a member' }); return; }
    const { maxUses, expiresInHours } = req.body as { maxUses?: number; expiresInHours?: number };
    const code = inviteCode();
    const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600_000).toISOString() : null;
    const id = randomUUID();
    run('INSERT INTO invites (id, serverId, code, creatorId, expiresAt, maxUses, uses, createdAt) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.params.id, code, req.userId!, expiresAt, maxUses ?? null, 0, iso()]);
    res.status(201).json({ invite: get('SELECT * FROM invites WHERE id = ?', [id]), url: `orbit://${code}` });
  });

  app.get('/api/invites/:code', (req, res) => {
    const inv = get<Record<string, unknown> & { expiresAt: string; maxUses: number; uses: number }>('SELECT * FROM invites WHERE code = ?', [req.params.code]);
    if (!inv) { res.status(404).json({ error: 'Invalid invite', status: 'invalid' }); return; }
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) { res.status(410).json({ error: 'Invite expired', status: 'expired' }); return; }
    if (inv.maxUses != null && inv.uses >= inv.maxUses) { res.status(410).json({ error: 'Invite exhausted', status: 'exhausted' }); return; }
    const server = get('SELECT * FROM servers WHERE id = ?', [inv.serverId]);
    res.json({ invite: inv, server, status: 'valid' });
  });

  app.post('/api/invites/:code/join', authMiddleware, (req: Authed, res) => {
    const inv = get<Record<string, unknown> & { expiresAt: string; maxUses: number; uses: number; serverId: string }>('SELECT * FROM invites WHERE code = ?', [req.params.code]);
    if (!inv) { res.status(404).json({ error: 'Invalid invite' }); return; }
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) { res.status(410).json({ error: 'Invite expired' }); return; }
    if (inv.maxUses != null && inv.uses >= inv.maxUses) { res.status(410).json({ error: 'Invite exhausted' }); return; }
    const ban = get('SELECT * FROM bans WHERE serverId = ? AND userId = ?', [inv.serverId, req.userId!]);
    if (ban) { res.status(403).json({ error: 'You are banned' }); return; }
    if (!isMember(inv.serverId, req.userId!)) {
      run('INSERT INTO members (id, serverId, userId, nickname, roleIds, joinedAt) VALUES (?,?,?,?,?,?)',
        [randomUUID(), inv.serverId, req.userId!, null, '[]', iso()]);
      broadcast('MEMBER_JOIN', { serverId: inv.serverId, userId: req.userId });
    }
    run('UPDATE invites SET uses = uses + 1 WHERE code = ?', [req.params.code]);
    res.json({ server: get('SELECT * FROM servers WHERE id = ?', [inv.serverId]) });
  });

  // ---- friends / DMs ----
  app.get('/api/friends', authMiddleware, (req: Authed, res) => {
    // Outgoing rows (userId = me, any status) plus incoming pending requests
    // (friendId = me). Accepted mirror rows are excluded to avoid duplicates.
    const rows = all<Record<string, unknown>>(
      `SELECT f.*, u.username, u.displayName, u.avatar, u.status AS userStatus, u.customStatus
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.userId = ? THEN f.friendId ELSE f.userId END
       WHERE f.userId = ? OR (f.friendId = ? AND f.status = 'pending')`,
      [req.userId!, req.userId!, req.userId!]);
    res.json({ friendships: rows });
  });
  app.post('/api/friends/request', authMiddleware, (req: Authed, res) => {
    const raw = String((req.body as { username?: string })?.username ?? '').trim();
    if (!raw) { res.status(400).json({ error: 'Username required' }); return; }
    const target = get<{ id: string }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [raw]);
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }
    if (target.id === req.userId) { res.status(400).json({ error: 'Cannot friend yourself' }); return; }
    // Blocked in either direction => silent 404-style to avoid probing
    const blocked = get('SELECT id FROM friendships WHERE ((userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)) AND status = ?', [req.userId!, target.id, target.id, req.userId!, 'blocked']);
    if (blocked) { res.status(403).json({ error: 'Cannot send request to this user' }); return; }
    const alreadyFriends = get('SELECT id FROM friendships WHERE ((userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)) AND status = ?', [req.userId!, target.id, target.id, req.userId!, 'accepted']);
    if (alreadyFriends) { res.status(409).json({ error: 'Already friends' }); return; }
    const samePending = get('SELECT id FROM friendships WHERE userId = ? AND friendId = ? AND status = ?', [req.userId!, target.id, 'pending']);
    if (samePending) { res.status(409).json({ error: 'Already requested' }); return; }
    const oppPending = get<{ id: string }>('SELECT id FROM friendships WHERE userId = ? AND friendId = ? AND status = ?', [target.id, req.userId!, 'pending']);
    if (oppPending) {
      // Reciprocal request -> auto-accept (friends immediately, no extra click needed)
      run('UPDATE friendships SET status = ? WHERE userId = ? AND friendId = ?', ['accepted', target.id, req.userId!]);
      try {
        run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), req.userId!, target.id, 'accepted', iso()]);
      } catch {
        run('UPDATE friendships SET status = ? WHERE userId = ? AND friendId = ?', ['accepted', req.userId!, target.id]);
      }
      broadcast('FRIEND_UPDATE', { userId: target.id });
      broadcast('FRIEND_UPDATE', { userId: req.userId });
      res.status(201).json({ ok: true, autoAccepted: true });
      return;
    }
    try {
      run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), req.userId!, target.id, 'pending', iso()]);
    } catch { res.status(409).json({ error: 'Already requested' }); return; }
    broadcast('FRIEND_UPDATE', { userId: target.id });
    broadcast('FRIEND_UPDATE', { userId: req.userId });
    res.status(201).json({ ok: true });
  });
  app.post('/api/friends/:id/accept', authMiddleware, (req: Authed, res) => {
    const incoming = get<{ id: string }>('SELECT id FROM friendships WHERE userId = ? AND friendId = ? AND status = ?', [req.params.id, req.userId!, 'pending']);
    if (!incoming) { res.status(404).json({ error: 'No request' }); return; }
    run('UPDATE friendships SET status = ? WHERE userId = ? AND friendId = ?', ['accepted', req.params.id, req.userId!]);
    try { run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), req.userId!, req.params.id, 'accepted', iso()]); }
    catch { run('UPDATE friendships SET status = ? WHERE userId = ? AND friendId = ?', ['accepted', req.userId!, req.params.id]); }
    broadcast('FRIEND_UPDATE', { userId: req.params.id });
    broadcast('FRIEND_UPDATE', { userId: req.userId });
    res.json({ ok: true });
  });
  app.post('/api/friends/:id/block', authMiddleware, (req: Authed, res) => {
    // Block wipes any existing pending/accepted rows between the two users
    run('DELETE FROM friendships WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)', [req.userId!, req.params.id, req.params.id, req.userId!]);
    try {
      run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), req.userId!, req.params.id, 'blocked', iso()]);
    } catch {
      run('UPDATE friendships SET status = ? WHERE userId = ? AND friendId = ?', ['blocked', req.userId!, req.params.id]);
    }
    broadcast('FRIEND_UPDATE', { userId: req.params.id });
    broadcast('FRIEND_UPDATE', { userId: req.userId });
    res.json({ ok: true });
  });
  app.delete('/api/friends/:id', authMiddleware, (req: Authed, res) => {
    const existed = get('SELECT id FROM friendships WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)', [req.userId!, req.params.id, req.params.id, req.userId!]);
    run('DELETE FROM friendships WHERE userId = ? AND friendId = ?', [req.userId!, req.params.id]);
    run('DELETE FROM friendships WHERE userId = ? AND friendId = ?', [req.params.id, req.userId!]);
    if (existed) {
      broadcast('FRIEND_UPDATE', { userId: req.params.id });
      broadcast('FRIEND_UPDATE', { userId: req.userId });
    }
    res.json({ ok: true });
  });

  app.get('/api/dms', authMiddleware, (req: Authed, res) => {
    const dms = all<Record<string, unknown>>('SELECT * FROM dm_channels');
    const mine = dms.filter((d) => (parseJson<string[]>(d.memberIds, [])).includes(req.userId!));
    res.json({ dms: mine });
  });
  app.post('/api/dms', authMiddleware, (req: Authed, res) => {
    const { userIds, name } = req.body as { userIds: string[]; name?: string };
    const ids = [...new Set([req.userId!, ...((userIds ?? []).slice(0, 9))])].sort();
    const isGroup = ids.length > 2;
    // 1:1 dedupe: don't create a second DM for the same two people
    if (!isGroup && ids.length === 2) {
      const allDms = all<{ id: string; memberIds: string; isGroup: number }>('SELECT id, memberIds, isGroup FROM dm_channels WHERE isGroup = 0');
      for (const d of allDms) {
        try {
          const cur = (JSON.parse(d.memberIds) as string[]).slice().sort();
          if (cur.length === 2 && cur[0] === ids[0] && cur[1] === ids[1]) {
            const existing = get('SELECT * FROM dm_channels WHERE id = ?', [d.id]);
            res.status(200).json({ dm: existing, existing: true });
            return;
          }
        } catch { /* ignore */ }
      }
    }
    const id = randomUUID();
    const label = name ?? ids.map((i) => get<{ displayName: string }>('SELECT displayName FROM users WHERE id = ?', [i])?.displayName ?? '?').join(', ');
    run('INSERT INTO dm_channels (id, name, memberIds, isGroup, createdAt) VALUES (?,?,?,?,?)', [id, label, JSON.stringify(ids), isGroup ? 1 : 0, iso()]);
    run('INSERT INTO channels (id, serverId, name, type, categoryId, position, topic) VALUES (?,?,?,?,?,?,?)', [id, null, label, 'text', null, 0, 'Direct messages']);
    res.status(201).json({ dm: get('SELECT * FROM dm_channels WHERE id = ?', [id]) });
  });

  // ---- users lookup (for mentions / search) ----
  app.get('/api/users', authMiddleware, (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const rows = q
      ? all('SELECT id, username, displayName, avatar, status, customStatus, bio, createdAt FROM users WHERE username LIKE ? OR displayName LIKE ? LIMIT 25', [`%${q}%`, `%${q}%`])
      : all('SELECT id, username, displayName, avatar, status, customStatus, bio, createdAt FROM users LIMIT 50');
    res.json({ users: rows });
  });

  // ---- global search ----
  app.get('/api/search', authMiddleware, (req: Authed, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 200);
    if (!q) { res.json({ messages: [], users: [], channels: [] }); return; }
    const memberOf = all<{ serverId: string }>('SELECT serverId FROM members WHERE userId = ?', [req.userId!]).map((r) => r.serverId);
    const myDMs = all<{ id: string; memberIds: string }>('SELECT id, memberIds FROM dm_channels')
      .filter((d) => {
        try { return (JSON.parse(d.memberIds) as string[]).includes(req.userId!); }
        catch { return false; }
      })
      .map((d) => d.id);
    let messages: unknown[] = [];
    if (memberOf.length || myDMs.length) {
      const serverCond = memberOf.length ? `channelId IN (SELECT id FROM channels WHERE serverId IN (${memberOf.map(() => '?').join(',')}))` : '1=0';
      const dmCond = myDMs.length ? `channelId IN (${myDMs.map(() => '?').join(',')})` : '1=0';
      messages = all(`SELECT * FROM messages WHERE content LIKE ? AND (${serverCond} OR ${dmCond}) ORDER BY createdAt DESC LIMIT 25`, [`%${q}%`, ...memberOf, ...myDMs]).map(rowToMessage);
    }
    const users = all('SELECT id, username, displayName, avatar, status, customStatus, bio, createdAt FROM users WHERE username LIKE ? OR displayName LIKE ? LIMIT 10', [`%${q}%`, `%${q}%`]);
    const channels = memberOf.length
      ? all(`SELECT * FROM channels WHERE name LIKE ? AND serverId IN (${memberOf.map(() => '?').join(',')}) LIMIT 10`, [`%${q}%`, ...memberOf])
      : [];
    res.json({ messages, users, channels });
  });

  // ---- installations (owner-only) ----
  function isOwner(userId: string): boolean {
    const row = get<{ username: string }>('SELECT username FROM users WHERE id = ?', [userId]);
    return row?.username === 'sansOWNER';
  }
  app.post('/api/installs/report', authMiddleware, (req: Authed, res) => {
    const { appVersion, platform, arch, deviceId } = (req.body ?? {}) as { appVersion?: string; platform?: string; arch?: string; deviceId?: string };
    const user = get<{ username: string; displayName: string }>('SELECT username, displayName FROM users WHERE id = ?', [req.userId!]);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const now = iso();
    const ver = String(appVersion ?? 'unknown').slice(0, 32);
    const plat = String(platform ?? 'unknown').slice(0, 32);
    const arc = String(arch ?? 'unknown').slice(0, 32);
    const did = String(deviceId ?? req.userId!).slice(0, 64);
    const existing = get<{ createdAt: string }>('SELECT createdAt FROM installations WHERE deviceId = ?', [did]);
    if (existing) {
      run('UPDATE installations SET userId = ?, username = ?, displayName = ?, appVersion = ?, platform = ?, arch = ?, lastSeen = ? WHERE deviceId = ?', [req.userId!, user.username, user.displayName, ver, plat, arc, now, did]);
    } else {
      run('INSERT INTO installations (deviceId, userId, username, displayName, appVersion, platform, arch, lastSeen, createdAt) VALUES (?,?,?,?,?,?,?,?,?)', [did, req.userId!, user.username, user.displayName, ver, plat, arc, now, now]);
    }
    res.json({ ok: true });
  });
  app.get('/api/installs', authMiddleware, (req: Authed, res) => {
    if (!isOwner(req.userId!)) { res.status(403).json({ error: 'Owner only' }); return; }
    const rows = all('SELECT deviceId, userId, username, displayName, appVersion, platform, arch, lastSeen, createdAt FROM installations ORDER BY lastSeen DESC');
    res.json({ installs: rows });
  });

  // ---- read states / typing / presence / voice ----
  app.post('/api/channels/:id/typing', authMiddleware, (req: Authed, res) => {
    broadcast('TYPING_START', { channelId: req.params.id, userId: req.userId });
    res.json({ ok: true });
  });
  app.post('/api/presence', authMiddleware, (req: Authed, res) => {
    const { status } = req.body as { status: string };
    if (!['online','idle','dnd','invisible','offline'].includes(status)) { res.status(400).json({ error: 'Bad status' }); return; }
    run('UPDATE users SET status = ? WHERE id = ?', [status, req.userId!]);
    broadcast('PRESENCE_UPDATE', { userId: req.userId, status });
    res.json({ ok: true });
  });
  app.get('/api/voice/states', authMiddleware, (_req, res) => res.json({ states: getVoiceStates() }));
  app.post('/api/voice/join', authMiddleware, (req: Authed, res) => {
    const { channelId } = req.body as { channelId: string };
    const ch = get<{ serverId: string; type: string }>('SELECT serverId, type FROM channels WHERE id = ?', [channelId]);
    if (!ch || ch.type !== 'voice') { res.status(404).json({ error: 'Voice channel not found' }); return; }
    if (ch.serverId && !isMember(ch.serverId, req.userId!) && get<{ ownerId: string }>('SELECT ownerId FROM servers WHERE id = ?', [ch.serverId])?.ownerId !== req.userId) {
      res.status(403).json({ error: 'Not a member' }); return;
    }
    if (ch.serverId && !requirePerm(ch.serverId, req.userId!, 'connect')) {
      // owners/members without explicit role still allowed unless roles deny; keep permissive for demo
    }
    setVoiceState(req.userId!, { channelId, serverId: ch.serverId ?? null, muted: false, deafened: false, speaking: false, video: false, sharing: false });
    res.json({ ok: true });
  });
  app.post('/api/voice/leave', authMiddleware, (req: Authed, res) => {
    setVoiceState(req.userId!, { channelId: null, serverId: null, muted: false, deafened: false, speaking: false, video: false, sharing: false });
    res.json({ ok: true });
  });
  app.post('/api/voice/state', authMiddleware, (req: Authed, res) => {
    const cur = getVoiceStates().find((s) => s.userId === req.userId!) ?? { channelId: null, serverId: null, muted: false, deafened: false, speaking: false, video: false, sharing: false };
    const next = { ...cur, ...(req.body ?? {}), userId: req.userId! };
    setVoiceState(req.userId!, next);
    res.json({ ok: true, state: next });
  });

  // ---- uploads (validated metadata; bytes stay local/data-url in v1) ----
  app.post('/api/uploads/validate', authMiddleware, (req, res) => {
    const { name, mime, size } = req.body as { name: string; mime: string; size: number };
    const ext = String(name ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_EXTENSIONS.has(ext)) { res.status(400).json({ error: `Blocked file type .${ext}` }); return; }
    if (!ALLOWED_UPLOAD_MIME.has(mime) && !String(mime).startsWith('image/')) { res.status(400).json({ error: 'MIME not allowed' }); return; }
    if (size > MAX_UPLOAD_MB * 1024 * 1024) { res.status(400).json({ error: 'File too large' }); return; }
    res.json({ ok: true, id: randomUUID() });
  });

  // ---- error fallback ----
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[orbit api]', err);
    res.status(500).json({ error: 'Internal error' });
  });
}
