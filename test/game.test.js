import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/game.js';

/** 시간을 직접 돌리는 가짜 스케줄러 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const q = [];
  return {
    schedule(fn, ms) {
      const t = { at: now + ms, fn, id: seq++, dead: false };
      q.push(t);
      return () => (t.dead = true);
    },
    step() {
      const live = q.filter((t) => !t.dead);
      if (!live.length) return false;
      live.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = live[0];
      t.dead = true;
      now = t.at;
      t.fn();
      return true;
    },
    /** 차례가 오거나 판이 끝날 때까지 예약된 흐름(스트리트 넘김 등)을 돌린다. 차례 타이머는 건드리지 않음 */
    live() {
      return q.filter((t) => !t.dead).length;
    },
    flush(room) {
      while (!room.currentSeat() && room.hand && room.hand.street !== 'done') if (!this.step()) break;
    },
  };
}

function setup(n, chips) {
  const clock = fakeClock();
  const room = new Room('TEST', { schedule: clock.schedule });
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(room.join({ token: `token-${i}-xxxxxxxxxxxx`, name: `P${i}`, socketId: `s${i}` }).player);
  if (chips) chips.forEach((c, i) => (ps[i].chips = c));
  return { room, clock, ps };
}

const chipsOnTable = (room) =>
  room.players.reduce((a, p) => a + p.chips, 0) + (room.hand && room.hand.street !== 'done' ? room.hand.seats.reduce((a, s) => a + s.total, 0) : 0);

function assertNoLeak(room) {
  const h = room.hand;
  if (!h) return;
  for (const viewer of room.players) {
    const v = room.viewFor(viewer.id);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('"deck"'), '덱이 화면 상태에 포함됨');
    for (const p of v.players) {
      if (p.id === viewer.id || !p.cards) continue;
      if (!h.revealed.has(p.id)) assert.ok(p.cards.every((c) => c === 'back'), `${viewer.name} 화면에 ${p.name} 패가 보임`);
    }
  }
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAction(room, rnd) {
  const s = room.currentSeat();
  const o = room.options(s);
  const x = rnd();
  if (x < 0.12) return room.act(s.id, 'fold');
  if (x < 0.2 && o.canRaise) return room.act(s.id, 'allin');
  if (x < 0.45 && o.canRaise) return room.act(s.id, 'raise', o.minTo + Math.floor(rnd() * (o.maxTo - o.minTo + 1)));
  return room.act(s.id, o.canCheck ? 'check' : 'call');
}

test('무작위 3000판: 칩 총량 보존, 패 유출 없음, 진행 멈춤 없음', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = mulberry32(seed);
    const n = 2 + (seed % 8);
    const { room, clock, ps } = setup(n);
    const expected = () => n * 1000 + room.players.reduce((a, p) => a + p.rebuys, 0) * 1000;
    assert.equal(room.start(ps[0].id).error, undefined);
    let hands = 0;
    let guard = 0;
    while (hands < 100 && guard++ < 200_000) {
      assertNoLeak(room);
      assert.equal(chipsOnTable(room), expected(), `seed ${seed}: 칩 총량이 변함`);
      for (const p of room.players) assert.ok(p.chips >= 0 && Number.isInteger(p.chips), '칩이 음수이거나 정수가 아님');
      const h = room.hand;
      if (h.street === 'done') {
        hands++;
        for (const p of room.players) if (p.chips === 0) assert.equal(room.rebuy(p.id).error, undefined);
        assert.ok(clock.step(), '다음 판 예약이 없음');
        continue;
      }
      if (room.currentSeat()) {
        // 가끔은 시간 초과로 자동 처리
        if (rnd() < 0.03) {
          assert.ok(clock.step());
          continue;
        }
        const r = randomAction(room, rnd);
        assert.equal(r.error, undefined, `seed ${seed}: ${r.error}`);
      } else {
        assert.ok(clock.step(), `seed ${seed}: 차례도 예약도 없이 멈춤 (street=${h.street})`);
      }
    }
    assert.equal(hands, 100, `seed ${seed}: 100판을 못 채움`);
  }
});

test('헤즈업: 버튼이 SB이고 프리플롭 먼저, 플롭부터는 BB가 먼저', () => {
  const { room, clock, ps } = setup(2);
  room.start(ps[0].id);
  const h = room.hand;
  assert.equal(h.sbIdx, h.buttonIdx);
  assert.equal(room.currentSeat(), h.seats[h.buttonIdx]);
  room.act(room.currentSeat().id, 'call');
  assert.equal(room.currentSeat(), h.seats[h.bbIdx]); // BB 옵션
  room.act(room.currentSeat().id, 'check');
  clock.flush(room);
  assert.equal(h.street, 'flop');
  assert.equal(room.currentSeat(), h.seats[h.bbIdx]);
});

test('사이드팟: 짧은 올인은 자기 몫 이상 못 가져감', () => {
  const { room, clock, ps } = setup(3, [100, 1000, 1000]);
  room.start(ps[0].id);
  const h = room.hand;
  // 패를 고정: P0 최강, P1 2등, P2 최약
  const find = (id) => h.seats.find((s) => s.id === id);
  find(ps[0].id).hole = [{ r: 14, s: 's' }, { r: 14, s: 'h' }];
  find(ps[1].id).hole = [{ r: 13, s: 's' }, { r: 13, s: 'h' }];
  find(ps[2].id).hole = [{ r: 2, s: 'c' }, { r: 7, s: 'd' }];
  h.deck = [{ r: 3, s: 'd' }, { r: 4, s: 'c' }, { r: 9, s: 'h' }, { r: 10, s: 'c' }, { r: 12, s: 'd' }, { r: 5, s: 'h' }, { r: 6, s: 'c' }, { r: 8, s: 's' }];
  // 모두 올인
  while (room.currentSeat()) room.act(room.currentSeat().id, 'allin');
  while (h.street !== 'done') assert.ok(clock.step());
  // 메인팟 300 → P0, 사이드팟 1800 → P1
  assert.equal(ps[0].chips, 300);
  assert.equal(ps[1].chips, 1800);
  assert.equal(ps[2].chips, 0);
  assert.equal(h.results.pots.length, 2);
});

test('불완전 올인 레이즈는 이미 행동한 사람에게 레이즈 권한을 다시 주지 않음', () => {
  const { room, clock, ps } = setup(3, [1000, 1000, 1000]);
  room.start(ps[0].id);
  const h = room.hand;
  // 프리플롭은 콜로 넘김
  while (h.street === 'preflop') {
    const s = room.currentSeat();
    if (!s) clock.flush(room);
    else room.act(s.id, room.options(s).canCheck ? 'check' : 'call');
  }
  clock.flush(room);
  const a = room.currentSeat();
  room.act(a.id, 'bet', 100);
  const b = room.currentSeat();
  // b 는 칩을 130만 남겨 두고 올인 (100 → 130, 최소 레이즈 200 미만)
  b.p.chips = 130;
  room.act(b.id, 'allin');
  assert.equal(h.currentBet, 130);
  const c = room.currentSeat();
  assert.ok(room.options(c).canRaise, '아직 행동 안 한 사람은 레이즈 가능');
  room.act(c.id, 'call');
  // 다시 a 차례: 콜/폴드만 가능
  assert.equal(room.currentSeat(), a);
  assert.equal(room.options(a).canRaise, false);
  assert.ok(room.act(a.id, 'raise', 500).error);
  assert.equal(room.act(a.id, 'call').error, undefined);
});

test('차례에 시간이 지나면 체크 가능하면 체크, 아니면 폴드', () => {
  const { room, clock, ps } = setup(3);
  room.start(ps[0].id);
  const s = room.currentSeat();
  assert.ok(room.options(s).canCall);
  clock.step(); // 차례 타이머
  assert.equal(s.folded, true);
});

test('판 도중 나가면 폴드 처리되고 판이 끝나면 자리에서 빠짐', () => {
  const { room, clock, ps } = setup(3);
  room.start(ps[0].id);
  const h = room.hand;
  const notTurn = h.seats.find((s) => s !== room.currentSeat());
  room.leave(notTurn.id);
  assert.equal(notTurn.folded, true);
  assert.ok(room.player(notTurn.id), '판이 끝나기 전에는 남아 있음');
  while (h.street !== 'done') {
    const s = room.currentSeat();
    if (s) room.act(s.id, 'fold');
    else clock.step();
  }
  assert.equal(room.player(notTurn.id), undefined);
  // 나간 사람은 남은 칩을 들고 나가고, 이미 낸 블라인드는 팟에 남는다
  assert.equal(room.players.reduce((a, p) => a + p.chips, 0), 3000 - notTurn.p.chips);
});

test('두 명 중 한 명이 나가면 남은 사람이 팟을 가져가고 판이 끝남', () => {
  const { room, ps } = setup(2);
  room.start(ps[0].id);
  const other = room.hand.seats.find((s) => s !== room.currentSeat());
  room.leave(other.id);
  assert.equal(room.hand.street, 'done');
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].chips, 2000 - other.p.chips);
  assert.equal(room.hand.results.payouts[room.players[0].id], 30);
});

test('방장 외에는 시작할 수 없음', () => {
  const { room, ps } = setup(3);
  assert.ok(room.start(ps[1].id).error);
  assert.equal(room.start(ps[0].id).error, undefined);
});

test('차례가 아닌 사람의 행동은 거절', () => {
  const { room } = setup(3);
  room.start(room.hostId);
  const notTurn = room.hand.seats.find((s) => s !== room.currentSeat());
  assert.ok(room.act(notTurn.id, 'call').error);
});

// ───────── 코드 리뷰에서 재현된 버그 회귀 테스트 ─────────

test('재접속으로 차례 타이머를 다시 걸면 이전 타이머는 사라짐', () => {
  const { room, clock, ps } = setup(3);
  room.start(ps[0].id);
  const s = room.currentSeat();
  room.disconnect(s.p.socketId); // 5초 타이머로 바뀜
  room.join({ token: s.p.token, name: s.p.name, socketId: 'new' }); // 다시 30초
  assert.equal(clock.live(), 1, '살아 있는 차례 타이머는 하나여야 함');
  clock.step();
  assert.equal(s.folded, true);
  assert.ok(room.log.filter((l) => l.includes(`${s.p.name}님 시간이 지나`)).length === 1);
});

test('헤즈업에서 BB가 블라인드보다 적게 올인하면 SB에게 묻지 않고 보드를 연다', () => {
  const { room, clock, ps } = setup(2, [1000, 5]);
  room.start(ps[0].id);
  const h = room.hand;
  assert.equal(room.currentSeat(), null, 'SB에게 액션이 가면 안 됨');
  while (h.street !== 'done') assert.ok(clock.step());
  assert.equal(h.board.length, 5);
  assert.equal(ps[0].chips + ps[1].chips, 1005);
});

test('상대가 모두 올인이면 레이즈 불가', () => {
  const { room, ps } = setup(3, [1000, 100, 100]);
  room.start(ps[0].id);
  // 3인: 버튼 P0, SB P1, BB P2 → P0 먼저
  assert.equal(room.currentSeat().id, ps[0].id);
  room.act(ps[0].id, 'call');
  room.act(ps[1].id, 'allin');
  room.act(ps[2].id, 'allin');
  const o = room.options(room.currentSeat());
  assert.equal(room.currentSeat().id, ps[0].id);
  assert.equal(o.canRaise, false);
  assert.ok(room.act(ps[0].id, 'raise', 900).error);
});

test('방이 가득 차도 끊긴 지 오래된(판에 없는) 사람 자리는 비워 준다', () => {
  const { room, ps } = setup(9);
  for (const p of ps.slice(1)) room.disconnect(p.socketId);
  const r = room.join({ token: 'token-new-xxxxxxxxxxxx', name: '새사람', socketId: 'sx' });
  assert.equal(r.error, undefined);
  assert.equal(room.players.length, 9);
});

test('나갔다가 같은 탭으로 다시 들어오면 칩이 이어짐', () => {
  const { room, ps } = setup(3);
  ps[1].chips = 7;
  const token = ps[1].token;
  room.leave(ps[1].id);
  const back = room.join({ token, name: 'P1', socketId: 'again' }).player;
  assert.equal(back.chips, 7);
});

// ───────── 방 설정·토너먼트·채팅·기록 ─────────

test('방 설정: 방장만, 판 사이에만, 범위 검사, 첫 판 전이면 칩을 맞춤', () => {
  const { room, ps } = setup(3);
  assert.ok(room.updateSettings(ps[1].id, { bigBlind: 50 }).error);
  assert.ok(room.updateSettings(ps[0].id, { bigBlind: 500, startChips: 1000 }).error, '시작 칩 < 빅블라인드×10');
  assert.equal(room.updateSettings(ps[0].id, { bigBlind: 50, startChips: 5000, turnSec: 999 }).error, undefined);
  assert.deepEqual(room.blinds, [25, 50]);
  assert.equal(room.settings.turnSec, 120);
  assert.ok(ps.every((p) => p.chips === 5000));
  room.start(ps[0].id);
  assert.ok(room.updateSettings(ps[0].id, { bigBlind: 20 }).error, '판 도중 변경 불가');
});

test('토너먼트: 블라인드가 오르고, 리바이 불가, 마지막 1명이 우승하며 순위가 매겨짐', () => {
  const clock = fakeClock();
  const room = new Room('T', { schedule: clock.schedule });
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(room.join({ token: `tour-${i}-xxxxxxxxxxxxx`, name: `T${i}`, socketId: `t${i}` }).player);
  assert.equal(room.updateSettings(ps[0].id, { mode: 'tournament', startChips: 500, bigBlind: 20, blindUpHands: 2 }).error, undefined);
  assert.equal(room.start(ps[0].id).error, undefined);
  assert.ok(room.tourney.active);
  const rnd = mulberry32(7);
  let guard = 0;
  let sawLevel2 = false;
  while (room.tourney.active && guard++ < 100_000) {
    if (room.tourney.level >= 1) sawLevel2 = true;
    assert.equal(chipsOnTable(room), 2500);
    const h = room.hand;
    if (h.street === 'done') {
      for (const p of room.players) if (p.chips === 0) assert.ok(room.rebuy(p.id).error, '토너먼트 리바이 불가');
      assert.ok(clock.step());
      continue;
    }
    if (room.currentSeat()) {
      const s = room.currentSeat();
      // 공격적으로 올인을 섞어 빨리 끝나게
      // 처음 몇 판은 조용히(체크·콜) 넘겨 블라인드 상승을 확인하고, 그 뒤엔 공격적으로 끝낸다
      const r = room.handNo <= 4 ? room.act(s.id, room.options(s).canCheck ? 'check' : 'call') : rnd() < 0.3 && room.options(s).canRaise ? room.act(s.id, 'allin') : randomAction(room, rnd);
      assert.equal(r.error, undefined);
    } else assert.ok(clock.step());
  }
  assert.equal(room.tourney.active, false, '토너먼트가 끝나지 않음');
  assert.ok(sawLevel2, '블라인드가 오르지 않음');
  const champ = room.player(room.tourney.winnerId);
  assert.equal(champ.chips, 2500);
  const places = room.tourney.places.map((x) => x.place).sort((a, b) => a - b);
  assert.deepEqual(places, [1, 2, 3, 4, 5]);
  assert.equal(room.running, false);
  // 끝난 뒤 다시 시작하면 새 토너먼트
  assert.equal(room.start(ps[0].id).error, undefined);
  assert.ok(room.players.every((p) => p.chips + (room.seatOf(p.id)?.total ?? 0) === 500));
});

test('토너먼트 중 새로 들어온 사람은 구경만 (칩 0)', () => {
  const { room, ps } = setup(3);
  room.updateSettings(ps[0].id, { mode: 'tournament' });
  room.start(ps[0].id);
  const late = room.join({ token: 'late-xxxxxxxxxxxxxxxx', name: '늦게', socketId: 'z' }).player;
  assert.equal(late.chips, 0);
  assert.equal(room.viewFor(late.id).players.find((p) => p.id === late.id).spectator, true);
});

test('채팅·이모지: 정리·길이 제한·도배 방지', () => {
  let t = 0;
  const room = new Room('C', { schedule: () => () => {}, now: () => t });
  const a = room.join({ token: 'chat-a-xxxxxxxxxxxxxx', name: 'A', socketId: 'a' }).player;
  assert.equal(room.sendChat(a.id, '  안녕\n하세요  ').error, undefined);
  assert.equal(room.chat.at(-1).text, '안녕 하세요');
  assert.ok(room.sendChat(a.id, '또').error, '600ms 안에 다시 보내면 거절');
  t += 700;
  assert.equal(room.sendChat(a.id, 'x'.repeat(500)).error, undefined);
  assert.equal(room.chat.at(-1).text.length, 100);
  t += 700;
  assert.ok(room.react(a.id, '💩').error);
  assert.equal(room.react(a.id, '🔥').error, undefined);
  assert.ok(room.sendChat(a.id, '   ').error);
});

test('판 기록·이벤트에는 공개되지 않은 패가 들어가지 않음', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rnd = mulberry32(seed * 31);
    const { room, clock, ps } = setup(4);
    room.start(ps[0].id);
    for (let k = 0; k < 2000 && room.handNo < 15; k++) {
      const h = room.hand;
      if (h.street === 'done') {
        // 직전 판: 공개되지 않은 사람의 패가 기록·이벤트·다른 사람 화면에 없어야 함
        const rec = room.history[0];
        assert.equal(rec.no, h.no);
        for (const s of h.seats) {
          if (h.revealed.has(s.id)) continue;
          const recJson = JSON.stringify(rec) + JSON.stringify(room.events);
          for (const c of s.hole) {
            const onBoard = h.board.some((b) => b.r === c.r && b.s === c.s);
            if (!onBoard) assert.ok(!recJson.includes(JSON.stringify(c)), `seed ${seed}: 공개 안 된 패가 기록에 들어감`);
          }
          for (const viewer of room.players) {
            if (viewer.id === s.id) continue;
            const v = room.viewFor(viewer.id);
            assert.equal(v.players.find((p) => p.id === s.id)?.cards?.[0] ?? 'back', 'back');
          }
        }
        for (const p of room.players) if (p.chips === 0) room.rebuy(p.id);
        clock.step();
        continue;
      }
      if (room.currentSeat()) randomAction(room, rnd);
      else clock.step();
    }
  }
});

test('이벤트: 데이터가 이벤트 종류(type)를 덮어쓰지 않음', () => {
  const { room, clock, ps } = setup(2);
  room.start(ps[0].id);
  room.act(room.currentSeat().id, 'fold');
  const win = room.events.find((e) => e.type === 'win');
  assert.ok(win, 'win 이벤트가 있어야 함');
  assert.equal(win.kind, 'fold');
  for (const e of room.events) assert.ok(['join', 'deal', 'turn', 'action', 'collect', 'street', 'win', 'reveal', 'blinds', 'settings', 'rebuy', 'tourneyStart', 'tourneyEnd'].includes(e.type), `알 수 없는 이벤트 ${e.type}`);
  void clock;
});

// ───────── 2차 검토에서 재현된 토너먼트 문제 회귀 테스트 ─────────

function tourney(n, chips = 500, extra = {}) {
  const clock = fakeClock();
  const room = new Room('TT', { schedule: clock.schedule });
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(room.join({ token: `tt-${i}-xxxxxxxxxxxxxxx`, name: `T${i}`, socketId: `t${i}` }).player);
  assert.equal(room.updateSettings(ps[0].id, { mode: 'tournament', startChips: chips, bigBlind: 20, blindUpHands: 3, ...extra }).error, undefined);
  assert.equal(room.start(ps[0].id).error, undefined);
  return { room, clock, ps };
}
const runUntil = (room, clock, pred, act = (s) => room.act(s.id, room.options(s).canCheck ? 'check' : 'call')) => {
  for (let k = 0; k < 50_000 && !pred(); k++) {
    if (room.currentSeat()) act(room.currentSeat());
    else if (!clock.step()) break;
  }
};

test('토너먼트: 판 도중 나가면 기권 처리되고 남은 1명이 우승', () => {
  const { room, clock, ps } = tourney(2);
  const other = room.hand.seats.find((s) => s !== room.currentSeat()).p;
  room.leave(other.id);
  runUntil(room, clock, () => !room.tourney.active);
  assert.equal(room.tourney.active, false);
  assert.ok(room.tourney.winnerId);
  assert.notEqual(room.tourney.winnerId, other.id);
  assert.deepEqual(room.tourney.places.map((x) => x.place).sort(), [1, 2]);
});

test('토너먼트: 판 사이에 나가도 우승이 확정됨', () => {
  const { room, clock, ps } = tourney(2);
  room.act(room.currentSeat().id, 'fold');
  assert.equal(room.hand.street, 'done');
  room.leave(ps[1].id);
  assert.equal(room.tourney.active, false);
  assert.equal(room.tourney.winnerId, ps[0].id);
  assert.equal(clock.step(), false, '끝난 뒤 다음 판 예약이 남으면 안 됨');
});

test('토너먼트: 칩을 가진 채 끊긴 사람도 블라인드를 내며 결국 끝남', () => {
  const { room, clock, ps } = tourney(3, 300);
  room.disconnect(ps[2].socketId);
  // 남은 둘은 계속 올인, 끊긴 사람은 시간 초과로 자동 처리
  runUntil(room, clock, () => !room.tourney.active, (s) => room.act(s.id, room.options(s).canRaise ? 'allin' : room.options(s).canCheck ? 'check' : 'call'));
  assert.equal(room.tourney.active, false, '토너먼트가 끝나지 않음');
  assert.deepEqual(room.tourney.places.map((x) => x.place).sort(), [1, 2, 3]);
});

test('토너먼트: 지난 게임에서 나간 사람은 칩·순위를 들고 들어올 수 없음', () => {
  const { room, ps } = setup(3);
  ps[2].chips = 5000;
  const token = ps[2].token;
  room.leave(ps[2].id);
  room.updateSettings(ps[0].id, { mode: 'tournament' });
  room.start(ps[0].id);
  const back = room.join({ token, name: 'P2', socketId: 'b' }).player;
  assert.equal(back.chips, 0);
  assert.equal(back.spectator, true);
});

test('토너먼트: 기권한 사람이 다시 들어오면 구경만', () => {
  const { room, ps } = tourney(3);
  const token = ps[2].token;
  room.leave(ps[2].id);
  const back = room.join({ token, name: 'T2', socketId: 'b' }).player;
  assert.equal(back.chips, 0);
  assert.equal(back.spectator, true);
  assert.ok(back.place);
});

test('토너먼트: 같은 판에서 여럿 탈락하면 칩이 적었던 사람이 더 낮은 순위', () => {
  const { room, clock, ps } = tourney(3, 2000);
  // 첫 판을 끝내고 칩을 맞춘 뒤 다음 판에서 모두 올인
  runUntil(room, clock, () => room.hand.street === 'done', (s) => room.act(s.id, 'fold'));
  ps[0].chips = 2000;
  ps[1].chips = 300;
  ps[2].chips = 700;
  clock.step(); // 다음 판
  const h = room.hand;
  h.seats.find((s) => s.id === ps[0].id).hole = [{ r: 14, s: 's' }, { r: 14, s: 'h' }];
  h.seats.find((s) => s.id === ps[1].id).hole = [{ r: 2, s: 'c' }, { r: 7, s: 'd' }];
  h.seats.find((s) => s.id === ps[2].id).hole = [{ r: 3, s: 'c' }, { r: 8, s: 'd' }];
  h.deck = [{ r: 4, s: 'd' }, { r: 9, s: 'c' }, { r: 10, s: 'h' }, { r: 12, s: 'c' }, { r: 13, s: 'd' }, { r: 5, s: 'h' }, { r: 6, s: 'c' }, { r: 11, s: 's' }];
  runUntil(room, clock, () => room.hand.street === 'done', (s) => room.act(s.id, 'allin'));
  assert.equal(ps[1].place, 3, '칩 300이던 사람이 3위');
  assert.equal(ps[2].place, 2, '칩 700이던 사람이 2위');
  assert.equal(room.tourney.winnerId, ps[0].id);
});

test('토너먼트: 칩을 가진 채 나간 사람도 순위에 들어감', () => {
  const { room, clock, ps } = tourney(4, 300);
  runUntil(room, clock, () => room.hand.street === 'done', (s) => room.act(s.id, 'fold'));
  room.leave(ps[3].id);
  assert.equal(ps[3].place, 4);
  runUntil(room, clock, () => !room.tourney.active, (s) => room.act(s.id, room.options(s).canRaise ? 'allin' : 'call'));
  assert.deepEqual(room.tourney.places.map((x) => x.place).sort(), [1, 2, 3, 4]);
});

test('설정: 게임이 돌아가는 중에는 모드를 바꿀 수 없음', () => {
  const { room, ps } = setup(2);
  room.start(ps[0].id);
  room.act(room.currentSeat().id, 'fold');
  assert.ok(room.updateSettings(ps[0].id, { mode: 'tournament' }).error);
  room.pause(ps[0].id);
  assert.equal(room.updateSettings(ps[0].id, { mode: 'tournament' }).error, undefined);
});

test('설정: 빅블라인드 홀수 올림 후에도 시작 칩 ≥ 빅블라인드×10', () => {
  const { room, ps } = setup(2);
  assert.ok(room.updateSettings(ps[0].id, { startChips: 110, bigBlind: 11 }).error);
});

test('채팅: 이모지가 반으로 잘리지 않음', () => {
  let t = 0;
  const room = new Room('E', { schedule: () => () => {}, now: () => (t += 1000) });
  const a = room.join({ token: 'emoji-a-xxxxxxxxxxxxx', name: 'A', socketId: 'a' }).player;
  room.sendChat(a.id, '😀'.repeat(150));
  assert.equal(Array.from(room.chat.at(-1).text).length, 100);
  assert.ok(!/[\uD800-\uDBFF]$/.test(room.chat.at(-1).text));
});

test('혼자만 걸린 팟은 승리가 아니라 반환으로 기록', () => {
  const { room, clock, ps } = setup(3, [100, 1000, 300]);
  room.start(ps[0].id);
  const h = room.hand;
  const find = (id) => h.seats.find((s) => s.id === id);
  find(ps[0].id).hole = [{ r: 14, s: 's' }, { r: 14, s: 'h' }];
  find(ps[1].id).hole = [{ r: 13, s: 's' }, { r: 13, s: 'h' }];
  find(ps[2].id).hole = [{ r: 2, s: 'c' }, { r: 7, s: 'd' }];
  h.deck = [{ r: 3, s: 'd' }, { r: 4, s: 'c' }, { r: 9, s: 'h' }, { r: 10, s: 'c' }, { r: 12, s: 'd' }, { r: 5, s: 'h' }, { r: 6, s: 'c' }, { r: 8, s: 's' }];
  while (room.currentSeat()) room.act(room.currentSeat().id, 'allin');
  while (h.street !== 'done') assert.ok(clock.step());
  // P1(1000)이 P2(300)보다 더 낸 700은 아무도 못 받으므로 반환
  assert.equal(h.results.returns[ps[1].id], 700);
  assert.ok(!(ps[1].id in h.results.payouts) || h.results.payouts[ps[1].id] > 0);
  const win = room.events.find((e) => e.type === 'win');
  assert.equal(win.returns[ps[1].id], 700);
  assert.equal(room.history[0].returned[0].amount, 700);
  assert.equal(ps[0].chips + ps[1].chips + ps[2].chips, 1400);
});

test('토너먼트가 끝나면 블라인드가 방 설정으로 돌아가고, 자유 게임으로 바꾸면 순위가 지워짐', () => {
  const { room, ps } = tourney(2);
  room.act(room.currentSeat().id, 'fold');
  room.leave(ps[1].id);
  assert.equal(room.tourney.active, false);
  assert.deepEqual(room.blinds, [10, 20]);
  assert.equal(ps[0].place, 1);
  assert.equal(room.updateSettings(ps[0].id, { mode: 'cash' }).error, undefined);
  assert.equal(ps[0].place, null);
  assert.equal(room.viewFor(ps[0].id).tourney.winnerName, null);
});

test('토너먼트: 블라인드 상승 0이면 블라인드 고정, 칩을 다 쓰면 탈락', () => {
  const { room, clock, ps } = tourney(3, 300, { blindUpHands: 0 });
  assert.equal(room.settings.blindUpHands, 0);
  runUntil(room, clock, () => !room.tourney.active, (s) => room.act(s.id, room.options(s).canRaise ? 'allin' : room.options(s).canCheck ? 'check' : 'call'));
  assert.equal(room.tourney.active, false);
  assert.equal(room.tourney.level, 0);
  assert.deepEqual(room.tourney.places.map((x) => x.place).sort(), [1, 2, 3]);
  for (const p of ps) if (p.id !== room.tourney.winnerId) assert.ok(room.rebuy(p.id).error, '탈락자는 다시 받을 수 없음');
  assert.ok(room.viewFor(ps[0].id).tourney.blindsFixed);
});

test('설정: 블라인드 상승 1은 2로 맞춤', () => {
  const { room, ps } = setup(2);
  room.updateSettings(ps[0].id, { blindUpHands: 1 });
  assert.equal(room.settings.blindUpHands, 2);
});

test('홀덤: 끊긴 사람은 20초 뒤 자리에서 빠짐 (판 도중이면 폴드 후)', () => {
  const { room, clock, ps } = setup(3);
  room.disconnect('s2');
  assert.ok(room.player(ps[2].id));
  while (room.player(ps[2].id) && clock.step());
  assert.equal(room.player(ps[2].id), undefined);
  room.start(ps[0].id);
  const seat = room.hand.seats.find((s) => s.id === ps[1].id);
  room.disconnect('s1');
  runUntil(room, clock, () => !room.player(ps[1].id) || room.hand.street === 'done');
  assert.ok(seat.folded || room.hand.street === 'done');
});

test('강퇴 투표: 과반이 찬성하면 내보내고 같은 토큰으로는 다시 못 들어온다', () => {
  const { room, ps } = setup(4);
  const [a, b, c, d] = ps;
  // d 를 뺀 3명 중 2명이 찬성해야 한다
  let r = room.voteKick(a.id, d.id);
  assert.equal(r.voted, true);
  assert.deepEqual(room.viewFor(b.id).kickVotes.map((v) => [v.name, v.count, v.need, v.mine]), [['P3', 1, 2, false]]);
  // 다시 누르면 취소, 투표도 사라진다
  r = room.voteKick(a.id, d.id);
  assert.equal(r.voted, false);
  assert.equal(room.viewFor(b.id).kickVotes.length, 0);
  room.voteKick(a.id, d.id);
  r = room.voteKick(b.id, d.id);
  assert.equal(r.kicked, true);
  assert.equal(r.kickSocket, 's3');
  assert.ok(!room.player(d.id));
  assert.ok(room.join({ token: d.token, name: 'P3', socketId: 's9' }).error);
  assert.equal(room.viewFor(a.id).kickVotes.length, 0);
  assert.equal(room.voteKick(c.id, c.id).error, '나를 강퇴할 수는 없어요');
});

test('강퇴 투표: 시간이 지나면 끝나고, 판 중에 강퇴되면 폴드 처리 후 판이 끝나면 빠진다', () => {
  const { room, clock, ps } = setup(3);
  const [a, b, c] = ps;
  room.voteKick(a.id, c.id);
  assert.equal(room.kickVotes.size, 1);
  while (clock.step());
  assert.equal(room.kickVotes.size, 0);
  room.start(room.hostId);
  clock.flush(room);
  const before = chipsOnTable(room);
  room.voteKick(a.id, c.id);
  const r = room.voteKick(b.id, c.id);
  assert.equal(r.kicked, true);
  assert.equal(room.seatOf(c.id)?.folded ?? true, true);
  assert.equal(chipsOnTable(room), before);
  // 판이 끝날 때까지 돌리면 c 는 사라진다
  for (let i = 0; i < 200 && room.handLive(); i++) {
    const cur = room.currentSeat();
    if (cur) room.act(cur.id, 'call') ?? room.act(cur.id, 'check');
    else if (!clock.step()) break;
  }
  room.pause(room.hostId);
  for (let i = 0; i < 50 && clock.step(); i++);
  assert.ok(!room.player(c.id));
  assert.ok(room.join({ token: c.token, name: 'P2', socketId: 's9' }).error);
});

test('끊긴 사람은 기다렸다가 자리에서 빠지고, 나가면 바로 빠진다', () => {
  const { room, clock, ps } = setup(3);
  room.disconnect('s2');
  assert.ok(room.player(ps[2].id));
  while (clock.step());
  assert.ok(!room.player(ps[2].id));
  room.leave(ps[1].id);
  assert.ok(!room.player(ps[1].id));
  assert.equal(room.players.length, 1);
});
