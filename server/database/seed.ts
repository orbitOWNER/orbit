import { randomUUID } from 'node:crypto';
import { all, get, openDatabase, run } from './db.js';
import { hashPassword } from '../services/auth.js';

function isoNow() { return new Date().toISOString(); }

export async function seedDatabase(): Promise<void> {
  await openDatabase();
  const existing = get<{ c: number }>('SELECT COUNT(*) as c FROM users');
  if (existing && Number(existing.c) > 0) return;

  const now = isoNow();
  const pw = await hashPassword('orbit-demo-123');
  const users = [
    { id: 'u_demo', username: 'nova', displayName: 'Nova', email: 'nova@orbit.local', avatar: '🪐', status: 'online', customStatus: 'building orbits', bio: 'Orbit enjoyer. I run HQ and break things before breakfast.' },
    { id: 'u_2', username: 'pixel', displayName: 'Pixel', email: 'pixel@orbit.local', avatar: '🎮', status: 'online', customStatus: 'online — working on levels', bio: 'Level designer. Co-op enjoyer. Tournament host on Fridays.' },
    { id: 'u_3', username: 'echo', displayName: 'Echo', email: 'echo@orbit.local', avatar: '🎧', status: 'idle', customStatus: 'in the studio' },
    { id: 'u_4', username: 'sol', displayName: 'Sol', email: 'sol@orbit.local', avatar: '☀️', status: 'dnd', customStatus: 'focus mode' },
    { id: 'u_5', username: 'wren', displayName: 'Wren', email: 'wren@orbit.local', avatar: '📚', status: 'offline', customStatus: null },
  ];
  for (const u of users) {
    run('INSERT INTO users (id, username, displayName, email, passwordHash, avatar, status, customStatus, bio, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [u.id, u.username, u.displayName, u.email, pw, u.avatar, u.status, u.customStatus, (u as { bio?: string }).bio ?? null, now]);
  }

  const servers = [
    { id: 's_hq', name: 'Orbit HQ', icon: '🪐', ownerId: 'u_demo' },
    { id: 's_games', name: 'Game Night', icon: '🎮', ownerId: 'u_2' },
  ];
  for (const s of servers) {
    run('INSERT INTO servers (id, name, icon, ownerId, createdAt) VALUES (?,?,?,?,?)', [s.id, s.name, s.icon, s.ownerId, now]);
  }

  const roles = [
    { id: 'r_admin', serverId: 's_hq', name: 'Admins', color: '#f0a35e', permissions: JSON.stringify(['administrator']), position: 2 },
    { id: 'r_mod', serverId: 's_hq', name: 'Mods', color: '#7cc7ff', permissions: JSON.stringify(['manageMessages','kickMembers','manageChannels']), position: 1 },
    { id: 'r_member', serverId: 's_hq', name: 'Member', color: '#9aa4b2', permissions: JSON.stringify(['connect','speak','stream']), position: 0 },
    { id: 'r_g_admin', serverId: 's_games', name: 'Hosts', color: '#b48cff', permissions: JSON.stringify(['administrator']), position: 1 },
  ];
  for (const r of roles) run('INSERT INTO roles (id, serverId, name, color, permissions, position) VALUES (?,?,?,?,?,?)', [r.id, r.serverId, r.name, r.color, r.permissions, r.position]);

  const members: Array<[string, string, string[], string | null]> = [
    ['s_hq', 'u_demo', ['r_admin'], null],
    ['s_hq', 'u_2', ['r_mod'], 'Pix'],
    ['s_hq', 'u_3', ['r_member'], null],
    ['s_hq', 'u_4', ['r_member'], null],
    ['s_hq', 'u_5', ['r_member'], null],
    ['s_games', 'u_2', ['r_g_admin'], null],
    ['s_games', 'u_demo', [], null],
    ['s_games', 'u_3', [], null],
  ];
  for (const [sid, uid, rids, nick] of members) {
    run('INSERT INTO members (id, serverId, userId, nickname, roleIds, joinedAt) VALUES (?,?,?,?,?,?)',
      [randomUUID(), sid, uid, nick, JSON.stringify(rids), now]);
  }

  const channels = [
    { id: 'c_general', serverId: 's_hq', name: 'general', type: 'text', topic: 'Welcome to Orbit HQ — say hi!' },
    { id: 'c_news', serverId: 's_hq', name: 'announcements', type: 'announcement', topic: 'Official updates from the team' },
    { id: 'c_gaming', serverId: 's_hq', name: 'gaming', type: 'text', topic: 'Find a squad' },
    { id: 'c_random', serverId: 's_hq', name: 'random', type: 'text', topic: 'Anything goes' },
    { id: 'c_lounge', serverId: 's_hq', name: 'Lounge', type: 'voice', topic: null },
    { id: 'c_g_general', serverId: 's_games', name: 'general', type: 'text', topic: 'Plan game night' },
    { id: 'c_g_voice', serverId: 's_games', name: 'Squad Voice', type: 'voice', topic: null },
  ];
  channels.forEach((c, i) => run(
    'INSERT INTO channels (id, serverId, name, type, categoryId, position, topic) VALUES (?,?,?,?,?,?,?)',
    [c.id, c.serverId, c.name, c.type, null, i, c.topic]));

  const msgs: Array<[string, string, string, string]> = [
    ['c_general', 'u_demo', 'Welcome to **Orbit**! 🪐\nThis is a fresh, original community app. Check out `#announcements` for updates.', '2026-05-01T10:00:00.000Z'],
    ['c_general', 'u_2', 'Hey everyone! Quick code sample:\n```ts\nconst orbit = await connect("orbit.gg/hq");\n```', '2026-05-01T10:05:00.000Z'],
    ['c_general', 'u_3', 'Replying to @nova — the voice lounge sounds great. See https://example.com for the plan.', '2026-05-01T10:07:00.000Z'],
    ['c_news', 'u_demo', '📣 **v0.1 is live** — servers, channels, DMs, voice, search, and settings all work locally.', '2026-05-02T09:00:00.000Z'],
    ['c_gaming', 'u_2', 'Who is up for co-op tonight? React with 🎮', '2026-05-03T18:00:00.000Z'],
    ['c_gaming', 'u_3', 'I am in! I can stream too.', '2026-05-03T18:02:00.000Z'],
    ['c_random', 'u_4', '*Focus mode on* — but this `inline code` styling looks nice.', '2026-05-04T12:00:00.000Z'],
    ['c_g_general', 'u_2', 'Friday = tournament night. Bracket drops tomorrow.', '2026-05-05T15:00:00.000Z'],
  ];
  const msgIds: string[] = [];
  for (const [ch, au, content, at] of msgs) {
    const id = randomUUID();
    msgIds.push(id);
    run('INSERT INTO messages (id, channelId, authorId, content, attachments, replyTo, editedAt, createdAt, pinned) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, ch, au, content, '[]', null, null, at, ch === 'c_news' ? 1 : 0]);
  }
  run('INSERT INTO reactions (id, messageId, userId, emoji) VALUES (?,?,?,?)', [randomUUID(), msgIds[4], 'u_3', '🎮']);
  run('INSERT INTO reactions (id, messageId, userId, emoji) VALUES (?,?,?,?)', [randomUUID(), msgIds[0], 'u_2', '🪐']);
  run('INSERT INTO reactions (id, messageId, userId, emoji) VALUES (?,?,?,?)', [randomUUID(), msgIds[0], 'u_3', '🎉']);

  // DM channel nova<->pixel + one group
  run('INSERT INTO dm_channels (id, name, memberIds, isGroup, createdAt) VALUES (?,?,?,?,?)',
    ['dm_nova_pixel', 'Pixel', JSON.stringify(['u_demo', 'u_2']), 0, now]);
  run('INSERT INTO channels (id, serverId, name, type, categoryId, position, topic) VALUES (?,?,?,?,?,?,?)',
    ['dm_nova_pixel', null, 'Pixel', 'text', null, 0, 'Direct messages']);
  run('INSERT INTO messages (id, channelId, authorId, content, attachments, replyTo, editedAt, createdAt, pinned) VALUES (?,?,?,?,?,?,?,?,?)',
    [randomUUID(), 'dm_nova_pixel', 'u_2', 'Hey Nova! Did you try the new voice channel?', '[]', null, null, now, 0]);

  // friendships
  run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), 'u_demo', 'u_2', 'accepted', now]);
  run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), 'u_2', 'u_demo', 'accepted', now]);
  run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), 'u_demo', 'u_3', 'accepted', now]);
  run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), 'u_3', 'u_demo', 'accepted', now]);
  run('INSERT INTO friendships (id, userId, friendId, status, createdAt) VALUES (?,?,?,?,?)', [randomUUID(), 'u_4', 'u_demo', 'pending', now]);

  run('INSERT INTO invites (id, serverId, code, creatorId, expiresAt, maxUses, uses, createdAt) VALUES (?,?,?,?,?,?,?,?)',
    [randomUUID(), 's_hq', 'orbit-hq-welcome', 'u_demo', null, 100, 3, now]);
  run('INSERT INTO audit_log (id, serverId, actorId, action, targetId, detail, createdAt) VALUES (?,?,?,?,?,?,?)',
    [randomUUID(), 's_hq', 'u_demo', 'SERVER_CREATE', 's_hq', 'Seeded Orbit HQ', now]);

  const { persistNow } = await import('./db.js');
  persistNow();
}
