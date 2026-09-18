import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { openDatabase } from './database/db.js';
import { seedDatabase } from './database/seed.js';
import { mountApi } from './api/routes.js';
import { addClient, broadcast, removeClient } from './websocket/hub.js';
import { verifyToken } from './services/auth.js';

const PORT = Number(process.env.PORT ?? 6742);

export async function startServer(port = PORT) {
  await openDatabase();
  await seedDatabase();
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(express.json({ limit: '40mb' }));
  mountApi(app);

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/ws', 'http://local');
    const token = url.searchParams.get('token');
    const userId = token ? verifyToken(token) : null;
    const client = addClient(ws, userId);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; data?: unknown };
        if (msg.type === 'PING' && 'send' in ws) (ws as unknown as { send: (s: string) => void }).send(JSON.stringify({ type: 'PONG', at: new Date().toISOString() }));
        // Voice signaling relay: SDP/ICE forwarded to channel peers
        if (msg.type === 'VOICE_SIGNAL') {
          broadcast('VOICE_STATE_UPDATE', { relay: true, from: client.userId, ...(msg.data as object) }, client);
        }
      } catch { /* ignore malformed */ }
    });
    ws.on('close', () => removeClient(client));
  });

  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  console.log(`[orbit] API+WS on http://127.0.0.1:${port}`);
  return { app, http, wss };
}

if (process.argv[1]?.endsWith('index.ts') || process.env.ORBIT_RUN_SERVER === '1') {
  void startServer();
}
