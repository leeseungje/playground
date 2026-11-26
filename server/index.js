import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { Room } from './game.js';
import { RaceRoom } from './race.js';
import { LiarRoom } from './liar.js';

const PORT = Number(process.env.PORT) || 7777;
const MAX_ROOMS = 200;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared'); // 서버·브라우저 공용 모듈 (족보 판정)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ───────── 정적 파일 ─────────
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const shared = urlPath.startsWith('/shared/');
    const baseDir = shared ? SHARED_DIR : PUBLIC_DIR;
    if (urlPath === '/race' || urlPath === '/liar') {
      const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.writeHead(301, { location: `${urlPath}/${q}` }).end();
      return;
    }
    let rel = urlPath === '/' ? 'index.html' : urlPath.replace(shared ? /^\/shared\/+/ : /^\/+/, '');
    if (rel.endsWith('/')) rel += 'index.html'; // /race/ → race/index.html
    const file = path.resolve(baseDir, rel);
    if (!file.startsWith(baseDir + path.sep)) {
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

// ───────── 방 관리 (게임마다 socket.io 네임스페이스 하나) ─────────
const io = new Server(server);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

const games = [];

/**
 * 게임 하나를 네임스페이스에 붙인다.
 * makeRoom(code, onChange) 로 방을 만들고, handlers 의 이벤트는 (room, pid, msg) 로 호출된다.
 */
function attachGame(nsp, { makeRoom, handlers, dispose }) {
  const rooms = new Map();
  games.push({ rooms, dispose });
  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const broadcast = (room) => {
    for (const p of room.players) if (p.connected && p.socketId) nsp.to(p.socketId).emit('state', room.viewFor(p.id));
  };

  nsp.on('connection', (socket) => {
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
          console.error(`[${nsp.name} ${event}]`, e);
          reply(cb, { error: '서버 오류가 났어요' });
        }
      });

    on('create', (msg, cb) => {
      if (!isToken(msg.token)) return reply(cb, { error: '잘못된 요청이에요' });
      if (rooms.size >= MAX_ROOMS) cleanupRooms(0);
      if (rooms.size >= MAX_ROOMS) return reply(cb, { error: '방이 너무 많아요. 잠시 뒤에 다시 시도해 주세요' });
      const code = newCode();
      const room = makeRoom(code, broadcast);
      rooms.set(code, room);
      enter(room, msg, cb);
    });
    on('join', (msg, cb) => {
      if (!isToken(msg.token)) return reply(cb, { error: '잘못된 요청이에요' });
      const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase().slice(0, 8) : '';
      const room = rooms.get(code);
      if (!room) return reply(cb, { error: `${code || '그런'} 방이 없어요. 코드를 확인해 주세요` });
      enter(room, msg, cb);
    });
    for (const [event, fn] of Object.entries(handlers))
      on(event, (msg, cb) => {
        const { room, pid } = current();
        if (!room) return reply(cb, { error: '방에 들어가 있지 않아요' });
        const res = fn(room, pid, msg) ?? {};
        // 강퇴된 사람의 화면을 로비로 돌려보낸다
        if (res.kickSocket) {
          const out = nsp.sockets.get(res.kickSocket);
          if (out) {
            out.data.code = null;
            out.data.playerId = null;
            out.emit('kicked', { code: room.code });
          }
        }
        delete res.kickSocket;
        reply(cb, res);
      });
    on('leave', (msg, cb) => {
      const { room, pid } = current();
      if (!room) return reply(cb, { error: '방에 들어가 있지 않아요' });
      room.leave(pid);
      socket.data.code = null;
      socket.data.playerId = null;
      reply(cb, {});
    });
    socket.on('disconnect', () => {
      const { room } = current();
      room?.disconnect(socket.id);
    });
  });
}

// 홀덤
attachGame(io.of('/'), {
  makeRoom: (code, onChange) => new Room(code, { onChange }),
  dispose: (room) => {
    room.clearTurnTimer();
    room.clearFlowTimer();
  },
  handlers: {
    start: (room, pid) => room.start(pid),
    pause: (room, pid) => room.pause(pid),
    rebuy: (room, pid) => room.rebuy(pid),
    action: (room, pid, msg) => room.act(pid, String(msg.type), msg.amount),
    settings: (room, pid, msg) => room.updateSettings(pid, msg),
    chat: (room, pid, msg) => room.sendChat(pid, msg.text),
    react: (room, pid, msg) => room.react(pid, msg.emoji),
    voteKick: (room, pid, msg) => room.voteKick(pid, typeof msg.target === 'string' ? msg.target : ''),
  },
});

// 경마
attachGame(io.of('/race'), {
  makeRoom: (code, onChange) => new RaceRoom(code, { onChange }),
  dispose: (room) => room.clearTimer(),
  handlers: {
    start: (room, pid) => room.start(pid),
    pause: (room, pid) => room.pause(pid),
    rebuy: (room, pid) => room.rebuy(pid),
    bet: (room, pid, msg) => room.placeBet(pid, { type: String(msg.type), horses: msg.horses, amount: msg.amount }),
    cancel: (room, pid, msg) => room.cancelBet(pid, msg.id),
    quote: (room, pid, msg) => room.quote(String(msg.type), msg.horses),
    settings: (room, pid, msg) => room.setBettingSec(pid, msg.bettingSec),
    chat: (room, pid, msg) => room.sendChat(pid, msg.text),
  },
});

// 라이어 찾기
attachGame(io.of('/liar'), {
  makeRoom: (code, onChange) => new LiarRoom(code, { onChange }),
  dispose: (room) => room.clearTimer(),
  handlers: {
    start: (room, pid) => room.start(pid),
    skip: (room, pid) => room.skip(pid),
    settings: (room, pid, msg) => room.updateSettings(pid, msg),
    hint: (room, pid, msg) => room.submitHint(pid, msg.text),
    vote: (room, pid, msg) => room.vote(pid, String(msg.target)),
    guess: (room, pid, msg) => room.submitGuess(pid, typeof msg.word === 'string' ? msg.word : null),
    chat: (room, pid, msg) => room.sendChat(pid, msg.text),
  },
});

// 아무도 접속하지 않은 방은 10분 뒤 정리
function cleanupRooms(idleMs = 10 * 60_000) {
  for (const { rooms, dispose } of games)
    for (const [code, room] of rooms) {
      const someone = room.players.some((p) => p.connected);
      if (!someone && Date.now() - room.lastActive >= idleMs) {
        dispose(room);
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
