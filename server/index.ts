import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomController } from './room.ts';
import { COLOR_WAR_COMMANDS } from '../shared/color-war.ts';
import type { Ack, RoomLayout } from '../shared/protocol.ts';
import {makeTurnCredentials,type TurnOptions} from './turn.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type ServerOptions = { port?: number; host?: string; layout?: RoomLayout; layoutPath?: string; distPath?: string; iceServers?: IceServer[]; turn?:TurnOptions };

function publicIceServers(input: unknown): IceServer[] {
  if (!Array.isArray(input) || input.length > 16) throw new Error('ICE_SERVERS must be a JSON array containing up to 16 ICE servers');
  return input.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid ICE server');
    const urls = typeof value.urls === 'string' ? [value.urls] : value.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || !urls.every((url: unknown) => typeof url === 'string' && url.length <= 2048 && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error('ICE server URLs must use stun:, stuns:, turn:, or turns:');
    if (value.username !== undefined && (typeof value.username !== 'string' || value.username.length > 256)) throw new Error('Invalid ICE username');
    if (value.credential !== undefined && (typeof value.credential !== 'string' || value.credential.length > 2048)) throw new Error('Invalid ICE credential');
    return { urls: typeof value.urls === 'string' ? value.urls : [...urls], ...(value.username !== undefined ? { username: value.username } : {}), ...(value.credential !== undefined ? { credential: value.credential } : {}) };
  });
}

/** Start the same HTTP + Socket.IO service used in development and deployment. */
export async function startServer(options: ServerOptions = {}) {
  const layout = options.layout ?? JSON.parse(readFileSync(options.layoutPath ?? resolve(projectRoot, 'public/assets/interaction-layout.json'), 'utf8')) as RoomLayout;
  const iceServers = publicIceServers(options.iceServers ?? (process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [{ urls: 'stun:stun.l.google.com:19302' }]));
  const turn=options.turn??(process.env.TURN_SHARED_SECRET?{secret:process.env.TURN_SHARED_SECRET,urls:JSON.parse(process.env.TURN_URLS??'[]')}:undefined);
  if(turn)makeTurnCredentials(turn); // Validate before listening, rather than failing in a user's voice setup.
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => { res.set('Cache-Control', 'no-store'); const temporary=turn?makeTurnCredentials(turn):undefined; res.json({ iceServers:temporary?[...iceServers,temporary.iceServer]:iceServers,...(temporary?{turnExpiresAt:temporary.expiresAt}:{}) }); });
  const distPath = options.distPath ?? resolve(projectRoot, 'dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res) => {
    const index = resolve(distPath, 'index.html');
    if (req.path.startsWith('/api/')) { res.status(404).json({ error: 'Not found' }); return; }
    if (existsSync(index)) res.sendFile(index);
    else res.status(503).type('text').send('Frontend build is unavailable. Run npm run build, or use the Vite development server.');
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: true, methods: ['GET', 'POST'] }, maxHttpBufferSize: 65536, pingInterval: 10000, pingTimeout: 10000 });
  const channel = (roomId: string) => `choir:${roomId}`;
  const rooms = new RoomController(layout, { onPiano: (roomId, event) => io.to(channel(roomId)).emit('piano', event) });
  const reply = (ack: unknown, result: Ack) => { if (typeof ack === 'function') ack(result); };

  io.on('connection', socket => {
    socket.on('join', (payload: unknown, ack: unknown) => {
      const previous = rooms.getRoomId(socket.id);
      const result = rooms.join(socket.id, payload);
      if (result.ok) {
        if (previous) void socket.leave(channel(previous));
        void socket.join(channel(rooms.getRoomId(socket.id)!));
      }
      reply(ack, result);
    });
    for (const event of ['move', 'sync', 'claim', 'release', 'avatar', 'mic', 'emote', 'pose', 'chat', 'piano', 'tempo', 'conduct-gesture', ...COLOR_WAR_COMMANDS]) socket.on(event, (payload: unknown, ack: unknown) => reply(ack, rooms.command(socket.id, event, payload)));
    socket.on('signal', (payload: unknown, ack: unknown) => {
      const message = rooms.relaySignal(socket.id, payload);
      if (message) io.to(message.to).emit('signal', message.signal);
      reply(ack, message ? { ok: true } : { ok: false, error: '语音信令无效或目标不在同一房间' });
    });
    socket.on('disconnect', () => rooms.disconnect(socket.id));
  });
  const interval = setInterval(() => rooms.flushStates((roomId, state) => io.to(channel(roomId)).emit('state', state)), 50);
  interval.unref();
  const port = options.port ?? Number(process.env.PORT ?? 3001), host = options.host ?? '0.0.0.0';
  try {
    await new Promise<void>((resolveListen, reject) => { httpServer.once('error', reject); httpServer.listen(port, host, () => { httpServer.off('error', reject); resolveListen(); }); });
  } catch (error) { clearInterval(interval); io.close(); throw error; }
  const address = httpServer.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const url = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${actualPort}`;
  const close = async () => { clearInterval(interval); await new Promise<void>(resolveClose => io.close(() => resolveClose())); };
  return { app, httpServer, io, rooms, url, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(server => {
    console.log(`407 Choir server listening at ${server.url}`);
    const stop = () => { void server.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
