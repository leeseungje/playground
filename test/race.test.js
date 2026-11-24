import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceRoom, BET_TYPES, _test } from '../server/race.js';

const { winningCombos, allCombos, makeCard, simulate, mulberry32 } = _test;
const order = (...nos) => nos.map((no, i) => ({ no, time: 70 + i }));

function room(opts = {}) {
  const q = [];
  let now = 0;
  const r = new RaceRoom('R', {
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, dead: false };
      q.push(t);
      return () => (t.dead = true);
    },
    now: () => now,
    options: { simRuns: 300, scratchChance: 0, ...opts },
  });
  const step = () => {
    const live = q.filter((t) => !t.dead).sort((a, b) => a.at - b.at);
    if (!live.length) return false;
    live[0].dead = true;
    now = live[0].at;
    live[0].fn();
    return true;
  };
  return { r, step };
}
const join = (r, i) => r.join({ token: `race-token-${i}-xxxxxxxxx`, name: `P${i}`, socketId: `s${i}` }).player;

test('승식별 적중 조합 (8두 이상 연승 3착, 7두 이하 2착)', () => {
  const o = order(5, 2, 7, 1);
  assert.deepEqual(winningCombos('win', o, 10), ['5']);
  assert.deepEqual(winningCombos('place', o, 10), ['5', '2', '7']);
  assert.deepEqual(winningCombos('place', o, 7), ['5', '2']);
  assert.deepEqual(winningCombos('quinella', o, 10), ['2-5']);
  assert.deepEqual(winningCombos('exacta', o, 10), ['5-2']);
  assert.deepEqual(winningCombos('quinellaPlace', o, 10), ['2-5', '5-7', '2-7']);
  assert.deepEqual(winningCombos('trio', o, 10), ['2-5-7']);
  assert.deepEqual(winningCombos('trifecta', o, 10), ['5-2-7']);
});

test('조합 개수', () => {
  const nos = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(allCombos('quinella', nos).length, 28);
  assert.equal(allCombos('exacta', nos).length, 56);
  assert.equal(allCombos('trio', nos).length, 56);
  assert.equal(allCombos('trifecta', nos).length, 336);
});

test('경주 시뮬레이션: 모든 말이 결승선 통과, 기록은 실제 경주 범위', () => {
  for (let k = 0; k < 20; k++) {
    const card = makeCard();
    const { order: o, frames } = simulate(card, mulberry32(k + 1), true);
    assert.equal(o.length, card.field);
    for (const x of o) assert.ok(x.time < 999);
    const perM = o[0].time / card.distance;
    assert.ok(perM > 0.05 && perM < 0.075, `1m 당 ${perM.toFixed(3)}초`);
    assert.ok(frames.length > 10);
  }
});

test('마권 구매·취소·검증', () => {
  const { r } = room();
  const a = join(r, 0);
  assert.ok(r.placeBet(a.id, { type: 'win', horses: [1], amount: 100 }).error, '발매 전에는 불가');
  r.start(a.id);
  assert.equal(r.phase, 'betting');
  assert.ok(r.placeBet(a.id, { type: 'win', horses: [1], amount: 5 }).error, '최소 금액');
  assert.ok(r.placeBet(a.id, { type: 'win', horses: [1], amount: 15 }).error, '10 단위');
  assert.ok(r.placeBet(a.id, { type: 'quinella', horses: [1], amount: 10 }).error, '두 마리 필요');
  assert.ok(r.placeBet(a.id, { type: 'quinella', horses: [1, 1], amount: 10 }).error, '같은 말 두 번');
  assert.ok(r.placeBet(a.id, { type: 'win', horses: [99], amount: 10 }).error, '없는 번호');
  assert.ok(r.placeBet(a.id, { type: 'win', horses: [1], amount: 5000 }).error, '칩 부족');
  assert.ok(r.placeBet(a.id, { type: 'nope', horses: [1], amount: 10 }).error);
  assert.equal(r.placeBet(a.id, { type: 'trifecta', horses: [3, 1, 2], amount: 100 }).error, undefined);
  assert.equal(a.chips, 900);
  const v = r.viewFor(a.id);
  assert.equal(v.myBets.length, 1);
  assert.deepEqual(v.myBets[0].horses, [3, 1, 2], '쌍승·삼쌍승은 순서 유지');
  assert.equal(r.cancelBet(a.id, v.myBets[0].id).error, undefined);
  assert.equal(a.chips, 1000);
});

test('발매 중에는 경주 기록이 화면 상태에 없음', () => {
  const { r } = room();
  const a = join(r, 0);
  r.start(a.id);
  const v = r.viewFor(a.id);
  assert.equal(v.race, null);
  assert.equal(r.race, null, '결과가 아직 정해지지 않아야 함');
});

test('정산: 파리뮤추얼 배당대로 지급, 칩 계산이 맞음', () => {
  for (let k = 0; k < 15; k++) {
    const { r, step } = room();
    const ps = [0, 1, 2].map((i) => join(r, i));
    r.start(ps[0].id);
    const field = r.card.field;
    // 여러 승식으로 골고루 구매
    const buys = [];
    for (const p of ps)
      for (const type of Object.keys(BET_TYPES)) {
        const size = BET_TYPES[type].size;
        const horses = Array.from({ length: size }, (_, i) => ((k + i * 3 + p.name.length) % field) + 1);
        if (new Set(horses).size !== size) continue;
        assert.equal(r.placeBet(p.id, { type, horses, amount: 20 }).error, undefined);
        buys.push({ p, type, horses });
      }
    const before = ps.map((p) => p.chips);
    step(); // 발매 마감 → 경주
    assert.equal(r.phase, 'racing');
    const odds = r.race.finalOdds;
    step(); // 경주 끝 → 정산
    assert.equal(r.phase, 'result');
    const o = r.race.sim.order;
    ps.forEach((p, i) => {
      let expect = before[i];
      for (const b of buys.filter((x) => x.p === p)) {
        const key = (BET_TYPES[b.type].ordered ? b.horses : [...b.horses].sort((x, y) => x - y)).join('-');
        if (winningCombos(b.type, o, o.length).includes(key)) expect += Math.floor(20 * odds[b.type][key]);
      }
      assert.equal(p.chips, expect, `${p.name} 정산 금액`);
    });
    // 최저 배당 1.0
    for (const t of Object.keys(BET_TYPES)) for (const v of Object.values(odds[t])) assert.ok(v >= 1);
  }
});

test('출전 취소: 관련 마권 환불', () => {
  const { r, step } = room({ scratchChance: 1 });
  const a = join(r, 0);
  r.start(a.id);
  for (let n = 1; n <= r.card.field; n++) r.placeBet(a.id, { type: 'win', horses: [n], amount: 10 });
  const spent = 1000 - a.chips;
  step();
  const scratched = r.race.scratched[0];
  assert.ok(scratched);
  assert.equal(a.chips, 1000 - spent + 10, '취소된 말 마권 10칩 환불');
  assert.equal(r.viewFor(a.id).race.refund, 10);
  assert.ok(!r.race.sim.nos.includes(scratched), '취소된 말은 달리지 않음');
});

test('다음 경주로 자동 진행, 멈춤', () => {
  const { r, step } = room();
  const a = join(r, 0);
  r.start(a.id);
  step();
  step();
  assert.equal(r.phase, 'result');
  step();
  assert.equal(r.phase, 'betting');
  assert.equal(r.round, 2);
  r.pause(a.id);
  step();
  step();
  step();
  assert.equal(r.phase, 'idle');
});
