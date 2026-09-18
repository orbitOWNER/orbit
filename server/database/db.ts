import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs, { type Database as SqlJsDb } from 'sql.js';
import { SCHEMA } from './schema.js';

let db: SqlJsDb | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let dbFile = '';

function locateWasm(file: string): string {
  // Resolve next to the installed sql.js package: works in dev (node_modules),
  // tsx, and inside the packaged Electron asar (Electron patches fs for asar).
  try {
    const jsPath = createRequire(import.meta.url).resolve('sql.js');
    const nextToPkg = path.join(path.dirname(jsPath), file);
    if (fs.existsSync(nextToPkg)) return nextToPkg;
  } catch { /* fall through to cwd lookup */ }
  const fromCwd = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return file;
}

export async function openDatabase(filePath?: string): Promise<SqlJsDb> {
  if (db) return db;
  const SQL = await initSqlJs({ locateFile: (f: string) => locateWasm(f) });
  dbFile = filePath ?? process.env.DATABASE_PATH ?? './data/orbit.sqlite';
  fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
  const resolved = path.resolve(dbFile);
  if (fs.existsSync(resolved)) {
    const buf = fs.readFileSync(resolved);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  runMigrations();
  persistSoon();
  return db;
}

export function getDb(): SqlJsDb {
  if (!db) throw new Error('Database not opened. Call openDatabase() first.');
  return db;
}

export function persistNow(): void {
  if (!db || !dbFile) return;
  try {
    const data = db.export();
    fs.writeFileSync(path.resolve(dbFile), Buffer.from(data));
  } catch { /* never silently fail in callers; persistence errors surface via API */ }
}

export function persistSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 400);
}

// Idempotent migrations for databases created by older builds.
export function runMigrations(): void {
  const d = getDb();
  d.exec(`CREATE TABLE IF NOT EXISTS channel_read_state (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channelId TEXT NOT NULL,
    lastReadMessageId TEXT,
    unread INTEGER DEFAULT 0,
    mentions INTEGER DEFAULT 0,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (userId, channelId)
  );`);
  try {
    const info = all<{ name: string }>('PRAGMA table_info(messages)');
    if (!info.some((c) => c.name === 'clientId')) {
      getDb().exec('ALTER TABLE messages ADD COLUMN clientId TEXT');
    }
  } catch { /* PRAGMA unavailable; column likely present via schema */ }
  try {
    const uinfo = all<{ name: string }>('PRAGMA table_info(users)');
    if (!uinfo.some((c) => c.name === 'bio')) {
      getDb().exec('ALTER TABLE users ADD COLUMN bio TEXT');
    }
  } catch { /* ignore */ }
  try { getDb().exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client ON messages(clientId) WHERE clientId IS NOT NULL'); } catch { /* older sqlite */ }
  persistSoon();
}

function bindParams(stmt: ReturnType<SqlJsDb['prepare']>, params: unknown[]): void {
  if (params.length > 0) stmt.bind(params as never[]);
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const d = getDb();
  const stmt = d.prepare(sql);
  try {
    bindParams(stmt, params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally { stmt.free(); persistSoon(); }
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return all<T>(sql, params)[0];
}

export function run(sql: string, params: unknown[] = []): { changes: number } {
  const d = getDb();
  const stmt = d.prepare(sql);
  try {
    bindParams(stmt, params);
    stmt.step();
    const changes = d.getRowsModified();
    persistSoon();
    return { changes };
  } finally { stmt.free(); }
}
