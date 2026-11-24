import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = fileURLToPath(new URL('../server/index.js', import.meta.url));

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => String(d).includes('켜졌어요') && resolve(proc));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('서버가 안 켜짐')), 8000);
  });
}

function client(name, i) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.token = `socket-test-token-${i}-xxxxxxxx`;
  s.name = name;
  s.states = [];
  s.raw = [];
  s.onAny((ev, payload) => {
    if (ev === 'state') {
      s.states.push(payload);
      s.raw.push(JSON.stringify(payload));
    }
  });
  s.call = (ev, msg = {}) => new Promise((r) => s.emit(ev, msg, r));
  return s;
}
const last = (s) => s.states.at(-1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await wait(20);
  }
  throw new Error('시간 초과');
}

test('소켓: 방 만들기·입장·한 판 진행, 남의 패는 네트워크로도 안 감', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());
  const [a, b, c] = ['가', '나', '다'].map(client);
  t.after(() => [a, b, c].forEach((s) => s.close()));

  const created = await a.call('create', { name: a.name, token: a.token });
  assert.ok(created.ok, created.error);
  const code = created.code;
  assert.match(code, /^[A-Z2-9]{4}$/);

  assert.ok((await b.call('join', { code, name: b.name, token: b.token })).ok);
  assert.ok((await c.call('join', { code: code.toLowerCase(), name: c.name, token: c.token })).ok);
  assert.ok((await b.call('join', { code: 'ZZZZ', name: 'x', token: 'socket-test-token-x-xxxxxxxx' })).error);

  // 방장 아닌 사람은 시작 불가
  assert.ok((await b.call('start')).error);
  assert.ok((await a.call('start')).ok !== false);
  await until(() => [a, b, c].every((s) => last(s)?.hand?.street === 'preflop'));

  const ids = Object.fromEntries([a, b, c].map((s) => [s.name, last(s).me]));
  const myHole = (s) => last(s).players.find((p) => p.id === last(s).me).cards;
  for (const s of [a, b, c]) {
    const mine = myHole(s);
    assert.equal(mine.length, 2);
    assert.ok(mine.every((x) => typeof x === 'object'), '내 패는 보여야 함');
    for (const p of last(s).players) if (p.id !== last(s).me) assert.deepEqual(p.cards, ['back', 'back']);
  }

  // 다른 두 사람의 실제 패가 내 소켓으로 온 적이 있는지 원문 검사 (보드에 없는 카드 기준)
  const holes = Object.fromEntries([a, b, c].map((s) => [last(s).me, myHole(s)]));
  const checkNoLeak = () => {
    for (const s of [a, b, c]) {
      const me = last(s).me;
      for (const raw of s.raw) {
        const st = JSON.parse(raw);
        const revealed = new Set(
          st.players.filter((p) => p.id !== me && p.cards && p.cards[0] !== 'back').map((p) => p.id),
        );
        for (const [pid, cards] of Object.entries(holes)) {
          if (pid === me || revealed.has(pid)) continue;
          const playersJson = JSON.stringify(st.players) + JSON.stringify(st.actions);
          for (const card of cards) assert.ok(!playersJson.includes(JSON.stringify(card)) || st.hand.board.some((x) => x.r === card.r && x.s === card.s), `${pid}의 패가 ${s.name}에게 전송됨`);
        }
      }
    }
  };
  checkNoLeak();

  // 차례가 아닌 사람 행동 거절
  const turnId = last(a).hand.toActId;
  const sockets = [a, b, c];
  const byId = (id) => sockets.find((s) => last(s).me === id);
  const notTurn = sockets.find((s) => last(s).me !== turnId);
  assert.ok((await notTurn.call('action', { type: 'call' })).error);

  // 모두 콜/체크로 끝까지
  const start = last(a).hand.no;
  for (let i = 0; i < 40; i++) {
    const st = last(a);
    if (st.hand.no !== start || st.hand.street === 'done') break;
    if (!st.hand.toActId) {
      await wait(100);
      continue;
    }
    const s = byId(st.hand.toActId);
    await until(() => last(s).actions);
    const act = last(s).actions.canCheck ? 'check' : 'call';
    const r = await s.call('action', { type: act });
    assert.ok(!r.error, r.error);
    await wait(30);
  }
  await until(() => last(a).hand.street === 'done', 8000);
  checkNoLeak();

  const total = last(a).players.reduce((x, p) => x + p.chips, 0);
  assert.equal(total, 3000);
  assert.equal(last(a).hand.results.type, 'showdown');
  // 쇼다운이면 모두의 패가 공개됨
  for (const p of last(b).players) assert.ok(p.cards[0] !== 'back');
  void ids;

  // 새로고침(재접속) 시 같은 토큰이면 같은 자리
  const before = last(b).me;
  b.close();
  const b2 = client('나', 1);
  t.after(() => b2.close());
  const re = await b2.call('join', { code, name: '나', token: b.token });
  assert.ok(re.ok);
  await until(() => last(b2));
  assert.equal(last(b2).me, before);
  assert.equal(last(b2).players.length, 3);
});

test('소켓: 이상한 값을 보내도 서버가 죽지 않음', async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());
  const s = client('x', 9);
  t.after(() => s.close());
  for (const ev of ['create', 'join', 'action', 'start', 'leave', 'rebuy', 'pause']) {
    for (const bad of [null, 0, 'abc', [], { token: null }, { code: {} }]) {
      const r = await s.call(ev, bad);
      assert.ok(r && r.error, `${ev} ${JSON.stringify(bad)} → 오류 응답이어야 함`);
    }
    s.emit(ev, null); // 콜백 없이
  }
  await wait(200);
  assert.equal(proc.exitCode, null, '서버가 종료됨');
  const ok = await s.call('create', { name: 'x', token: s.token });
  assert.ok(ok.ok);
});
