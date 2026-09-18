import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { all, get, openDatabase, run, runMigrations } from '../server/database/db';

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-test-')), 't.sqlite');
afterAll(() => { try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch { /* noop */ } });

describe('sqlite persistence layer', () => {
  it('migrates idempotently and enforces clientId uniqueness', async () => {
    await openDatabase(tmp);
    runMigrations();
    runMigrations(); // must be safe to run twice
    const cols = all<{ name: string }>('PRAGMA table_info(messages)');
    expect(cols.some((c) => c.name === 'clientId')).toBe(true);
    const rs = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name='channel_read_state'`);
    expect(rs.length).toBe(1);

    const now = new Date().toISOString();
    run('INSERT INTO users (id, username, displayName, email, passwordHash, createdAt) VALUES (?,?,?,?,?,?)',
      ['u_t', 'tester', 'Tester', 't@t.local', 'x', now]);
    run('INSERT INTO servers (id, name, ownerId, createdAt) VALUES (?,?,?,?)', ['s_t', 'T', 'u_t', now]);
    run('INSERT INTO channels (id, serverId, name, type, position) VALUES (?,?,?,?,?)', ['c_t', 's_t', 'general', 'text', 0]);
    run('INSERT INTO messages (id, channelId, authorId, content, createdAt, clientId) VALUES (?,?,?,?,?,?)',
      ['m1', 'c_t', 'u_t', 'hello', now, 'dup-1']);
    // same clientId must violate the unique index (route layer turns this into dedupe)
    expect(() => run('INSERT INTO messages (id, channelId, authorId, content, createdAt, clientId) VALUES (?,?,?,?,?,?)',
      ['m2', 'c_t', 'u_t', 'hello again', now, 'dup-1'])).toThrow();
    // ...while messages without clientId coexist fine
    run('INSERT INTO messages (id, channelId, authorId, content, createdAt) VALUES (?,?,?,?,?)', ['m3', 'c_t', 'u_t', 'plain', now]);

    run(`INSERT INTO channel_read_state (userId, channelId, lastReadMessageId, unread, mentions, updatedAt)
         VALUES (?,?,?,?,?,?) ON CONFLICT(userId, channelId) DO UPDATE SET
           lastReadMessageId=excluded.lastReadMessageId, unread=excluded.unread,
           mentions=excluded.mentions, updatedAt=excluded.updatedAt`,
      ['u_t', 'c_t', 'm1', 3, 1, now]);
    run(`INSERT INTO channel_read_state (userId, channelId, lastReadMessageId, unread, mentions, updatedAt)
         VALUES (?,?,?,?,?,?) ON CONFLICT(userId, channelId) DO UPDATE SET
           lastReadMessageId=excluded.lastReadMessageId, unread=excluded.unread,
           mentions=excluded.mentions, updatedAt=excluded.updatedAt`,
      ['u_t', 'c_t', 'm3', 0, 0, now]);
    const st = get<{ lastReadMessageId: string; unread: number }>('SELECT lastReadMessageId, unread FROM channel_read_state WHERE userId=? AND channelId=?', ['u_t', 'c_t']);
    expect(st?.lastReadMessageId).toBe('m3');
    expect(st?.unread).toBe(0);
  });
});
