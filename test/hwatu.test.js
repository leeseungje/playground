import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalSeotda, resolveSeotda, scoreGostop, SEOTDA_IDS, ALL_IDS, card } from '../shared/hwatu.js';
import { HwatuRoom } from '../server/hwatu.js';
import { GostopGame } from '../server/gostop.js';

// ───────── 도우미 ─────────
function setup(n = 3, settings = {}) {
  const q = [];
  let now = 0;
  const room = new HwatuRoom('H', {
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, dead: false };
      q.push(t);
      return () => (t.dead = true);
    },
    now: () => now,
  });
  const ps = Array.from({ length: n }, (_, i) => room.join({ token: `hwatu-tok-${i}-xxxxxxxx`, name: `P${i}`, socketId: `s${i}` }).player);
  if (Object.keys(settings).length) assert.equal(room.updateSettings(ps[0].id, settings).error, undefined);
  const step = () => {
    const live = q.filter((t) => !t.dead).sort((a, b) => a.at - b.at);
    if (!live.length) return false;
    live[0].dead = true;
    now = live[0].at;
    live[0].fn();
    return true;
  };
  const total = () => room.players.reduce((s, p) => s + p.chips, 0) + (room.game?.kind === 'seotda' && room.game.phase !== 'result' ? room.game.pot : 0);
  return { room, ps, step, total };
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 바닥 a 장, 뒤집을 순서 b 를 정해 둔 고스톱 덱 (pop 이 뒤에서부터 뽑으므로 거꾸로 쌓는다)
function rigDeck({ hands, floor, flips }) {
  const used = new Set([...hands.flat(), ...floor, ...flips]);
  const rest = ALL_IDS.filter((id) => !used.has(id));
  const seq = [...hands.flat(), ...floor, ...flips];
  return [...rest, ...seq.reverse()];
}
function rigGostop({ hands, floor, flips, n = 2 }) {
  const { room, ps } = setup(n, { mode: 'gostop' });
  // 손패가 모자란 만큼 남은 카드로 채운다 (같은 달 4장이 되지 않게 조심)
  const g = new GostopGame(room, ps.map((p) => p.id), { deck: rigDeck({ hands, floor, flips }) });
  room.game = g;
  room.running = false;
  g.start();
  return { room, ps, g };
}

// ───────── 섯다 족보 ─────────
test('섯다 족보 판정', () => {
  const cases = [
    [['3-0', '8-0'], '38광땡', 1000],
    [['1-0', '3-0'], '13광땡', 900],
    [['1-0', '8-0'], '18광땡', 900],
    [['10-0', '10-1'], '장땡', 810],
    [['9-0', '9-1'], '9땡', 809],
    [['1-0', '1-1'], '1땡', 801],
    [['1-1', '2-1'], '알리', 706],
    [['1-1', '4-1'], '독사', 705],
    [['1-1', '9-1'], '구삥', 704],
    [['1-1', '10-1'], '장삥', 703],
    [['4-1', '10-1'], '장사', 702],
    [['4-1', '6-1'], '세륙', 701],
    [['2-1', '7-1'], '갑오', 109],
    [['3-1', '8-1'], '1끗', 101],
    [['3-1', '7-1'], '망통', 100],
    [['4-0', '7-0'], '암행어사', 101],
    [['3-0', '7-0'], '땡잡이', 100],
    [['4-1', '9-1'], '구사', 103],
    [['4-0', '9-0'], '멍텅구리 구사', 103],
    [['3-1', '8-0'], '1끗', 101], // 3이 광이 아니면 광땡 아님
  ];
  for (const [ids, name, rank] of cases) {
    const r = evalSeotda(ids);
    assert.equal(r.name, name, ids.join('+'));
    assert.equal(r.rank, rank, ids.join('+'));
    assert.deepEqual(evalSeotda([...ids].reverse()).name, name, '순서 무관');
  }
  assert.equal(SEOTDA_IDS.length, 20);
  assert.equal(new Set(SEOTDA_IDS).size, 20);
});

test('특수 족보: 암행어사·땡잡이·구사 재경기', () => {
  const h = (pid, ids) => ({ pid, ids });
  // 암행어사는 18광땡을 잡지만 38광땡은 못 잡는다
  assert.deepEqual(resolveSeotda([h('a', ['4-0', '7-0']), h('b', ['1-0', '8-0'])]).winners, ['a']);
  assert.deepEqual(resolveSeotda([h('a', ['4-0', '7-0']), h('b', ['3-0', '8-0'])]).winners, ['b']);
  // 광땡이 없으면 암행어사는 1끗
  assert.deepEqual(resolveSeotda([h('a', ['4-0', '7-0']), h('b', ['2-1', '10-1'])]).winners, ['b']);
  // 땡잡이는 9땡을 잡지만 장땡은 못 잡는다
  assert.deepEqual(resolveSeotda([h('a', ['3-0', '7-0']), h('b', ['9-0', '9-1'])]).winners, ['a']);
  assert.deepEqual(resolveSeotda([h('a', ['3-0', '7-0']), h('b', ['10-0', '10-1'])]).winners, ['b']);
  assert.deepEqual(resolveSeotda([h('a', ['3-0', '7-0']), h('b', ['1-1', '2-1'])]).winners, ['b'], '땡이 없으면 망통');
  // 구사: 상대 최고가 알리 이하면 재경기, 땡이면 그냥 3끗
  assert.ok(resolveSeotda([h('a', ['4-1', '9-1']), h('b', ['1-1', '2-1'])]).replay);
  assert.deepEqual(resolveSeotda([h('a', ['4-1', '9-1']), h('b', ['2-0', '2-1'])]).winners, ['b']);
  // 멍텅구리 구사: 장땡까지 재경기, 광땡이면 아님
  assert.ok(resolveSeotda([h('a', ['4-0', '9-0']), h('b', ['10-0', '10-1'])]).replay);
  assert.deepEqual(resolveSeotda([h('a', ['4-0', '9-0']), h('b', ['1-0', '3-0'])]).winners, ['b']);
  // 동점은 나눈다
  assert.deepEqual(resolveSeotda([h('a', ['2-1', '5-1']), h('b', ['3-1', '4-1'])]).winners.sort(), ['a', 'b']);
});

// ───────── 섯다 진행 ─────────
test('섯다: 남의 패는 공개 전까지 보내지 않고, 칩 총량이 보존된다', () => {
  for (let k = 0; k < 150; k++) {
    const n = 2 + (k % 5);
    const { room, ps, step, total } = setup(n);
    const before = total();
    assert.equal(room.start(ps[0].id).error, undefined);
    let guard = 0;
    while (room.game && room.game.phase !== 'result' && guard++ < 200) {
      const g = room.game;
      for (const p of ps) {
        const v = room.viewFor(p.id).game;
        for (const [id, hand] of Object.entries(v.hands)) if (id !== p.id) assert.ok(hand.every((c) => c === null), '남의 패 유출');
      }
      const o = g.options(g.turn);
      if (Math.random() < 0.15) step();
      else assert.equal(g.act(g.turn, { type: pick(Object.keys(o)) }).error, undefined);
      if (room.game.phase === 'result' && room.game.result.reason === 'replay') step();
    }
    assert.equal(room.game.phase, 'result');
    assert.equal(total(), before, '칩이 새거나 생김');
    room.pause(ps[0].id);
  }
});

test('섯다: 학교를 내고 두 번 베팅, 다이하면 남은 사람이 가져감', () => {
  const { room, ps } = setup(3, { ante: 100 });
  room.start(ps[0].id);
  const g = room.game;
  assert.equal(g.pot, 300);
  assert.equal(g.stage, 1);
  const order = g.order;
  assert.equal(g.act(order[0], { type: 'bbing' }).error, undefined);
  assert.equal(g.act(order[1], { type: 'ttadang' }).error, undefined);
  assert.equal(g.currentBet, 200);
  assert.equal(g.act(order[2], { type: 'die' }).error, undefined);
  assert.equal(g.act(order[0], { type: 'call' }).error, undefined);
  assert.equal(g.stage, 2, '두 번째 장');
  assert.equal(g.act(order[0], { type: 'die' }).error, undefined);
  assert.equal(g.phase, 'result');
  assert.deepEqual(g.result.winners, [order[1]]);
  assert.equal(room.player(order[1]).chips, 10_000 - 300 + 700);
});

test('섯다: 베팅 한도는 가장 적은 칩', () => {
  const { room, ps } = setup(2, { ante: 100 });
  ps[1].chips = 500;
  room.start(ps[0].id);
  const g = room.game;
  assert.equal(g.cap, 500);
  let guard = 0;
  while (g.phase === 'betting' && guard++ < 50) {
    const o = g.options(g.turn);
    const t = o.max != null ? 'max' : o.half != null ? 'half' : o.call != null ? 'call' : 'check';
    g.act(g.turn, { type: t });
  }
  for (const id of g.order) assert.ok(g.contrib.get(id) <= 500);
});

// ───────── 고스톱 점수 ─────────
test('고스톱 점수: 광·고도리·단·피', () => {
  assert.equal(scoreGostop(['1-0', '3-0', '8-0']).total, 3);
  assert.equal(scoreGostop(['1-0', '3-0', '12-0']).total, 2, '비삼광');
  assert.equal(scoreGostop(['1-0', '3-0', '8-0', '11-0']).total, 4);
  assert.equal(scoreGostop(['1-0', '3-0', '8-0', '11-0', '12-0']).total, 15);
  assert.equal(scoreGostop(['2-0', '4-0', '8-1']).total, 5, '고도리');
  assert.equal(scoreGostop(['1-1', '2-1', '3-1']).total, 3, '홍단');
  assert.equal(scoreGostop(['6-1', '9-1', '10-1']).total, 3, '청단');
  assert.equal(scoreGostop(['4-1', '5-1', '7-1']).total, 3, '초단');
  assert.equal(scoreGostop(['1-1', '2-1', '3-1', '4-1', '12-2']).total, 4, '홍단 + 띠 5장');
  // 피 10장 = 1점, 쌍피는 2장
  assert.equal(scoreGostop(['1-2', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '5-2', '5-3']).total, 1);
  assert.equal(scoreGostop(['1-2', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '11-1', '12-3']).total, 2, '쌍피 2장 = 피 11장');
  // 국진은 점수가 높은 쪽으로
  assert.equal(scoreGostop(['1-2', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-0']).total, 1, '국진을 쌍피로 → 피 10장');
});

// ───────── 고스톱 특수 상황 ─────────
test('고스톱: 쪽 — 낸 패를 뒤집은 패가 먹고 피를 뺏음', () => {
  const { g, ps } = rigGostop({
    hands: [['5-0', '6-2', '6-3', '7-2', '7-3', '10-2', '10-3', '11-2', '11-3', '12-3'], ['1-2', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['8-0', '8-1', '8-2', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['5-1'],
  });
  g.captured.get(ps[1].id).push('11-1'); // 뺏길 피 (쌍피밖에 없으면 쌍피)
  assert.equal(g.play(ps[0].id, '5-0').error, undefined);
  assert.ok(g.last.specials.includes('jjok'));
  assert.ok(g.captured.get(ps[0].id).includes('5-0') && g.captured.get(ps[0].id).includes('5-1'));
  assert.ok(g.captured.get(ps[0].id).includes('11-1'), '피 뺏기');
});

test('고스톱: 뻑 → 나중에 먹으면 피 뺏기, 따닥', () => {
  const { g, ps } = rigGostop({
    hands: [['5-0', '6-0', '6-2', '7-2', '7-3', '10-2', '10-3', '11-2', '11-3', '12-3'], ['5-3', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['5-1', '6-1', '6-3', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['5-2', '8-0'],
  });
  const [a, b] = ps.map((p) => p.id);
  // A: 5월 내서 바닥 5-1 과 짝, 뒤집으니 5-2 → 뻑
  assert.equal(g.play(a, '5-0').error, undefined);
  assert.ok(g.last.specials.includes('ppeok'));
  assert.equal(g.floorOf(5).length, 3);
  // B: 남은 5월로 뻑 먹기 → 4장 + 피 뺏기
  g.captured.get(a).push('1-2');
  assert.equal(g.play(b, '5-3').error, undefined);
  assert.ok(g.last.specials.includes('ppeokTake'));
  assert.equal(g.floorOf(5).length, 0);
  assert.ok(g.captured.get(b).includes('1-2'));
});

test('고스톱: 따닥 — 바닥 두 장 + 낸 패 + 뒤집은 패', () => {
  const { g, ps } = rigGostop({
    hands: [['6-0', '5-2', '7-2', '7-3', '10-2', '10-3', '11-2', '11-3', '12-3', '1-2'], ['5-3', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['6-1', '6-2', '5-0', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['6-3'],
  });
  const a = ps[0].id;
  assert.ok(g.play(a, '6-0').choose, '바닥 6월 두 장이 다르면 골라야 함');
  assert.equal(g.play(a, '6-0', { target: '6-1' }).error, undefined);
  assert.ok(g.last.specials.includes('ttadak'));
  for (const c of ['6-0', '6-1', '6-2', '6-3']) assert.ok(g.captured.get(a).includes(c));
});

test('고스톱: 폭탄은 세 장을 한 번에, 이후 뒤집기만 두 번', () => {
  const { g, ps } = rigGostop({
    hands: [['7-0', '7-1', '7-2', '5-2', '10-2', '10-3', '11-2', '11-3', '12-3', '1-2'], ['5-3', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['7-3', '6-2', '5-0', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['8-0'],
  });
  const a = ps[0].id;
  assert.equal(g.play(a, '7-0', { bomb: true }).error, undefined);
  assert.equal(g.hands.get(a).length, 7);
  assert.equal(g.skips.get(a), 2);
  assert.equal(g.shakes.get(a), 1);
});

test('고스톱: 무작위 판 수백 번 — 카드 48장·칩 보존, 남의 손패 비공개, 반드시 끝남', () => {
  for (let k = 0; k < 300; k++) {
    const n = 2 + (k % 4); // 2~5명 (4명 이상이면 광팔기)
    const { room, ps, step, total } = setup(n, { mode: 'gostop', jokers: k % 5 });
    const before = total();
    assert.equal(room.start(ps[0].id).error, undefined);
    const g = room.game;
    assert.equal(g.order.length, Math.min(3, n));
    if (n > 3) assert.ok(g.sale, '광팔기');
    let guard = 0;
    while (g.phase !== 'result' && guard++ < 400) {
      const id = g.turn;
      const v = room.viewFor(id).game;
      for (const o of g.order) if (o !== id) assert.equal(typeof v.hands[o], 'number', '남의 손패 유출');
      const cards = [...g.floor, ...g.deck, ...(g.pending ? [g.pending.flip] : []), ...g.order.flatMap((o) => [...g.hands.get(o), ...g.captured.get(o)])];
      assert.equal(cards.length, 48 + g.jokers, `카드 수 ${cards.length}`);
      assert.equal(new Set(cards).size, 48 + g.jokers, '중복 카드');
      if (Math.random() < 0.05) {
        step();
        continue;
      }
      if (g.phase === 'goStop') g.decide(id, Math.random() < 0.5 ? 'go' : 'stop');
      else if (g.phase === 'chooseFlip') g.chooseFlip(id, pick(g.pending.options));
      else if (!g.hands.get(id).length) assert.equal(g.flipOnly(id).error, undefined);
      else {
        const c = pick(g.hands.get(id));
        const pl = v.playable[c];
        const r = g.play(id, c, { target: pl.choose ? pick(pl.matches) : undefined, bomb: pl.bomb && Math.random() < 0.5, shake: pl.shake && Math.random() < 0.5 });
        assert.equal(r.error, undefined, r.error);
      }
    }
    assert.equal(g.phase, 'result', '판이 끝나지 않음');
    assert.equal(total(), before, '칩이 새거나 생김');
    if (g.result.winner) for (const pay of g.result.payments) assert.ok(pay.chips >= 0);
  }
});

test('고스톱: 5명이면 판마다 자리를 돌린다', () => {
  const { room, ps, step } = setup(5, { mode: 'gostop' });
  room.start(ps[0].id);
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    room.game.order.forEach((id) => seen.add(id));
    seen.add(room.game.seller);
    room.game.remove(room.game.order[0]); // 판을 빨리 끝냄 (무효)
    step(); // 다음 판
  }
  assert.equal(seen.size, 5, '모두 한 번은 들어옴');
});

test('카드 정의: 48장, 달마다 4장', () => {
  assert.equal(ALL_IDS.length, 48);
  for (let m = 1; m <= 12; m++) assert.equal(ALL_IDS.filter((id) => card(id).month === m).length, 4);
  assert.equal(ALL_IDS.filter((id) => card(id).kind === 'gwang').length, 5);
  assert.equal(ALL_IDS.filter((id) => card(id).bird).length, 3);
});

test('고스톱: 조커 — 내면 바로 먹고 한 장 받아 이어서, 뒤집으면 먹고 한 번 더', () => {
  const { g, ps } = rigGostop({
    hands: [['J-1', '5-2', '7-2', '7-3', '10-2', '10-3', '11-2', '11-3', '12-3', '1-2'], ['5-3', '1-3', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['6-1', '6-2', '5-0', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['8-0', 'J-2', '8-1'],
  });
  const a = ps[0].id;
  assert.equal(g.play(a, 'J-1').error, undefined);
  assert.ok(g.captured.get(a).includes('J-1'));
  assert.ok(g.hands.get(a).includes('8-0'), '더미에서 한 장 받음');
  assert.equal(g.turn, a, '같은 사람이 이어서 냄');
  // 5-2 를 내서 바닥 5-0 을 먹고, 뒤집은 J-2 를 먹고 한 번 더 뒤집어 8-1
  assert.equal(g.play(a, '5-2').error, undefined);
  assert.ok(g.captured.get(a).includes('J-2'));
  assert.equal(g.last.flipped, '8-1');
  assert.equal(scoreGostop(['J-1', 'J-2', '1-2', '1-3', '2-2', '2-3', '3-2', '3-3']).total, 1, '조커는 피 2장');
});

test('고스톱: 바닥에 깔린 조커는 선이 가져감', () => {
  const { g, ps } = rigGostop({
    hands: [['5-2', '7-2', '7-3', '10-2', '10-3', '11-2', '11-3', '12-3', '1-2', '1-3'], ['5-3', '2-1', '2-2', '2-3', '3-2', '3-3', '4-2', '4-3', '9-2', '9-3']],
    floor: ['J-1', '6-2', '5-0', '1-0', '2-0', '3-0', '9-0', '12-0'],
    flips: ['8-0'],
  });
  assert.ok(g.captured.get(ps[0].id).includes('J-1'));
  assert.equal(g.floor.length, 8);
  assert.ok(!g.floor.includes('J-1'));
});

test('섯다: 이상한 베팅 값(toString 등)은 거부, 칩은 그대로', () => {
  const { room, ps, total } = setup(2);
  room.start(ps[0].id);
  const before = total();
  for (const type of ['toString', 'constructor', '__proto__', 'valueOf']) assert.ok(room.bet(room.game.turn, { type }).error);
  assert.equal(total(), before);
  assert.ok(room.players.every((p) => Number.isFinite(p.chips)));
});

test('섯다: 구사 재경기 대기 중 멈추기·설정 변경을 해도 판돈이 사라지지 않음', () => {
  const { room, ps, step, total } = setup(2);
  room.start(ps[0].id);
  const g = room.game;
  const [a, b] = g.order;
  g.hands.set(a, ['4-1', '9-1']); // 구사
  g.hands.set(b, ['5-0', '6-0']); // 1끗
  g.showdown();
  assert.ok(g.result.replay);
  const before = room.players.reduce((s, p) => s + p.chips, 0) + g.pot;
  assert.equal(room.pause(ps[0].id).error, undefined);
  assert.ok(room.updateSettings(ps[0].id, { mode: 'gostop' }).error, '재경기 대기 중 설정 변경 거부');
  step(); // 재경기 시작
  assert.equal(room.game.kind, 'seotda');
  assert.ok(room.game.replayNo >= 1);
  assert.equal(room.players.reduce((s, p) => s + p.chips, 0) + room.game.pot, before);
  void total;
});

test('고스톱: 판 도중에 나가면 기권패 — 나간 사람만 내고 다시 들어와도 그대로', () => {
  const { room, ps } = setup(2, { mode: 'gostop' });
  room.start(ps[0].id);
  const g = room.game;
  const [a, b] = g.order;
  g.captured.get(a).push('1-0', '3-0', '8-0'); // 3점
  const loser = room.player(b);
  const tok = loser.token;
  room.leave(b);
  assert.equal(g.result.forfeit, b);
  assert.equal(g.result.winner, a);
  const pay = g.result.payments[0];
  assert.equal(pay.chips, 7 * 100, '맞고 최소 7점 × 점당 100');
  const back = room.join({ token: tok, name: 'P1', socketId: 'sx' }).player;
  assert.equal(back.chips, 10_000 - 700);
});
