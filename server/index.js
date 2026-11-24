import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { Room } from './game.js';

const PORT = Number(process.env.PORT) || 7777;
const MAX_ROOMS = 200;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ───────── 정적 파일 ─────────
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('없는 페이지예요');
  }
});

// ───────── 방 관리 ─────────
const io = new Server(server);
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', room.viewFor(p.id));
  }
}

function createRoom() {
  const code = newCode();
  const room = new Room(code, { onChange: broadcast });
  rooms.set(code, room);
  return room;
}

const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);
const cleanName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '');
const reply = (cb, v) => typeof cb === 'function' && cb(v);

/** 다른 사람이 접속할 사내망 주소 (WSL·Hyper-V 가상 어댑터 제외) */
function lanUrls() {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback/i.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => `http://${i.address}:${PORT}`);
}

io.on('connection', (socket) => {
  socket.emit('hello', { lanUrls: lanUrls() });
  const current = () => {
    const room = rooms.get(socket.data.code);
    const pid = socket.data.playerId;
    if (!room || !room.player(pid) || room.player(pid).socketId !== socket.id) return {};
    return { room, pid };
  };

  const enter = (room, { name, token }, cb) => {
    // 다른 방에 있었다면 그 방에서는 접속 끊김 처리
    const prev = rooms.get(socket.data.code);
    if (prev && prev !== room) prev.disconnect(socket.id);
    const res = room.join({ token, name: cleanName(name), socketId: socket.id });
    if (res.error) return reply(cb, { error: res.error });
    socket.data.code = room.code;
    socket.data.playerId = res.player.id;
    reply(cb, { ok: true, code: room.code });
    socket.emit('state', room.viewFor(res.player.id));
  };

  /** 어떤 값이 와도 서버가 죽지 않게 메시지를 정리하고 예외를 잡는다 */
  const on = (event, fn) =>
    socket.on(event, (...args) => {
      const cb = typeof args.at(-1) === 'function' ? args.at(-1) : null;
      const msg = args[0] && typeof args[0] === 'object' ? args[0] : {};
      try {
        fn(msg, cb);
      } catch (e) {
        console.error(`[${event}]`, e);
        reply(cb, { error: '서버 오류가 났어요' });
      }
    });

  on('create', (msg, cb) => {
    if (!isToken(msg.token)) return reply(cb, { error: '잘못된 요청이에요' });
    if (rooms.size >= MAX_ROOMS) cleanupRooms(0);
    if (rooms.size >= MAX_ROOMS) return reply(cb, { error: '방이 너무 많아요. 잠시 뒤에 다시 시도해 주세요' });
    enter(createRoom(), msg, cb);
  });

  on('join', (msg, cb) => {
    if (!isToken(msg.token)) return reply(cb, { error: '잘못된 요청이에요' });
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase().slice(0, 8) : '';
    const room = rooms.get(code);
    if (!room) return reply(cb, { error: `${code || '그런'} 방이 없어요. 코드를 확인해 주세요` });
    enter(room, msg, cb);
  });

  const handle = (event, fn) =>
    on(event, (msg, cb) => {
      const { room, pid } = current();
      if (!room) return reply(cb, { error: '방에 들어가 있지 않아요' });
      reply(cb, fn(room, pid, msg) ?? {});
    });

  handle('start', (room, pid) => room.start(pid));
  handle('pause', (room, pid) => room.pause(pid));
  handle('rebuy', (room, pid) => room.rebuy(pid));
  handle('action', (room, pid, msg) => room.act(pid, String(msg.type), msg.amount));
  handle('leave', (room, pid) => {
    room.leave(pid);
    socket.data.code = null;
    socket.data.playerId = null;
    return {};
  });

  socket.on('disconnect', () => {
    const { room } = current();
    room?.disconnect(socket.id);
  });
});

// 아무도 접속하지 않은 방은 10분 뒤 정리
function cleanupRooms(idleMs = 10 * 60_000) {
  for (const [code, room] of rooms) {
    const someone = room.players.some((p) => p.connected);
    if (!someone && Date.now() - room.lastActive >= idleMs) {
      room.clearTurnTimer();
      room.clearFlowTimer();
      rooms.delete(code);
    }
  }
}
setInterval(() => cleanupRooms(), 60_000).unref();

// 타이머 안에서 예상 못 한 오류가 나도 다른 방 게임이 멈추지 않게 서버는 살려 둔다
process.on('uncaughtException', (e) => console.error('[uncaught]', e));

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있어요. 다른 포트로 켜 주세요. 예: PORT=7778 npm start` : e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('홀덤 서버가 켜졌어요.');
  console.log(`  내 PC:   http://localhost:${PORT}`);
  for (const url of lanUrls()) console.log(`  사내망:  ${url}   ← 이 주소를 동료에게 공유하세요`);
});
