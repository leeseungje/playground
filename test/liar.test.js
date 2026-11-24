import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiarRoom } from '../server/liar.js';

function setup(n = 4, settings = {}) {
  const q = [];
  let now = 0;
  const room = new LiarRoom('L', {
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, dead: false };
      q.push(t);
      return () => (t.dead = true);
    },
    now: () => now,
  });
  const ps = Array.from({ length: n }, (_, i) => room.join({ token: `liar-tok-${i}-xxxxxxxxx`, name: `P${i}`, socketId: `s${i}` }).player);
  if (Object.keys(settings).length) assert.equal(room.updateSettings(ps[0].id, settings).error, undefined);
  const step = () => {
    const live = q.filter((t) => !t.dead).sort((a, b) => a.at - b.at);
    if (!live.length) return false;
    live[0].dead = true;
    now = live[0].at;
    live[0].fn();
    return true;
  };
  return { room, ps, step };
}

const allHints = (room) => {
  while (room.phase === 'hint') assert.equal(room.submitHint(room.currentTurn(), '음…').error, undefined);
};

test('3명 미만이면 시작 불가, 방장만 시작', () => {
  const { room, ps } = setup(2);
  assert.ok(room.start(ps[0].id).error);
  const s = setup(3);
  assert.ok(s.room.start(s.ps[1].id).error);
  assert.equal(s.room.start(s.ps[0].id).error, undefined);
});

test('제시어는 시민에게만, 라이어에게는 카테고리만 (화면 상태 전체 검사)', () => {
  for (let k = 0; k < 30; k++) {
    const { room, ps, step } = setup(6, { liarCount: k % 2 ? 2 : 1 });
    room.start(ps[0].id);
    const r = room.round;
    for (const p of ps) {
      const v = room.viewFor(p.id);
      const json = JSON.stringify(v);
      if (r.liars.includes(p.id)) {
        assert.equal(v.card.liar, true);
        assert.ok(!json.includes(r.word), '라이어 화면에 제시어가 있음');
      } else assert.equal(v.card.word, r.word);
    }
    step(); // 카드 확인 끝 → 힌트
    allHints(room);
    for (const p of ps) if (r.liars.includes(p.id)) assert.ok(!JSON.stringify(room.viewFor(p.id)).includes(r.word), '진행 중 유출');
  }
});

test('바보 모드: 라이어는 다른 제시어를 받고 자기가 라이어인지 모름', () => {
  const { room, ps } = setup(4, { mode: 'fool' });
  room.start(ps[0].id);
  const r = room.round;
  const liar = r.liars[0];
  const v = room.viewFor(liar);
  assert.equal(v.card.liar, false);
  assert.equal(v.card.word, r.foolWord);
  assert.notEqual(r.foolWord, r.word);
  assert.ok(!JSON.stringify(v).includes(r.word));
});

test('힌트에 제시어를 그대로 쓰면 거절, 차례가 아니면 거절', () => {
  const { room, ps, step } = setup(4);
  room.start(ps[0].id);
  step();
  const turn = room.currentTurn();
  const other = ps.find((p) => p.id !== turn).id;
  assert.ok(room.submitHint(other, '안녕').error);
  assert.ok(room.submitHint(turn, `이건 ${room.round.word} 이야`).error);
  assert.equal(room.submitHint(turn, '').error, undefined);
  assert.equal(room.round.hints[0].text, '(말로 설명했어요)');
});

test('라이어 지목 → 제시어 맞히면 라이어 승, 틀리면 시민 승 / 엉뚱한 사람 지목 → 라이어 승', () => {
  for (const scenario of ['guessRight', 'guessWrong', 'wrongPerson']) {
    const { room, ps, step } = setup(4, { discussSec: 0 });
    room.start(ps[0].id);
    step();
    allHints(room);
    assert.equal(room.phase, 'vote');
    const liar = room.round.liars[0];
    const citizen = ps.find((p) => p.id !== liar).id;
    const target = scenario === 'wrongPerson' ? citizen : liar;
    for (const p of ps) {
      const t = p.id === target ? ps.find((x) => x.id !== target && x.id !== p.id).id : target;
      assert.equal(room.vote(p.id, t).error, undefined);
    }
    if (scenario === 'wrongPerson') {
      assert.equal(room.phase, 'result');
      assert.equal(room.round.result.winner, 'liar');
      assert.equal(room.player(liar).score, 3);
      continue;
    }
    assert.equal(room.phase, 'guess');
    const opts = room.viewFor(liar).round.guess.options;
    assert.equal(opts.length, 12);
    assert.ok(opts.includes(room.round.word));
    assert.equal(room.viewFor(citizen).round.guess.options, null, '다른 사람에게는 보기가 안 보임');
    const pick = scenario === 'guessRight' ? room.round.word : opts.find((w) => w !== room.round.word);
    assert.equal(room.submitGuess(liar, pick).error, undefined);
    assert.equal(room.round.result.winner, scenario === 'guessRight' ? 'liar' : 'citizens');
    if (scenario === 'guessWrong') for (const p of ps) assert.equal(p.score, p.id === liar ? 0 : 1);
  }
});

test('동표면 한 번 재투표, 또 동표면 라이어 승', () => {
  const { room, ps, step } = setup(4, { discussSec: 0 });
  room.start(ps[0].id);
  step();
  allHints(room);
  const [a, b, c, d] = ps.map((p) => p.id);
  room.vote(a, b);
  room.vote(b, a);
  room.vote(c, a);
  room.vote(d, b);
  assert.equal(room.phase, 'revote');
  assert.deepEqual([...room.round.candidates].sort(), [a, b].sort());
  assert.ok(room.vote(a, c).error, '후보가 아닌 사람');
  room.vote(a, b);
  room.vote(b, a);
  room.vote(c, a);
  room.vote(d, b);
  assert.equal(room.phase, 'result');
  assert.equal(room.round.result.winner, 'liar');
  assert.equal(room.round.result.reason, 'tie');
});

test('자기 자신에게 투표 불가, 라이어가 나가면 시민 승', () => {
  const { room, ps, step } = setup(4, { discussSec: 0 });
  room.start(ps[0].id);
  step();
  allHints(room);
  assert.ok(room.vote(ps[0].id, ps[0].id).error);
  room.leave(room.round.liars[0]);
  assert.equal(room.phase, 'result');
  assert.equal(room.round.result.winner, 'citizens');
});

test('시간이 지나면 자동으로 다음 단계', () => {
  const { room, ps, step } = setup(3);
  room.start(ps[0].id);
  step(); // reveal → hint
  for (let i = 0; i < 3; i++) step(); // 힌트 3번 시간 초과
  assert.equal(room.phase, 'discuss');
  assert.ok(room.round.hints.every((h) => h.text === '(시간 초과)'));
  step();
  assert.equal(room.phase, 'vote');
  step();
  assert.equal(room.phase, 'result', '아무도 투표 안 하면 라이어 승');
  assert.equal(room.round.result.reason, 'noVote');
});

test('진행 중 화면 상태로 라이어가 드러나지 않음 (점수·횟수·투표 등)', () => {
  const { room, ps, step } = setup(5, { discussSec: 0 });
  room.start(ps[0].id);
  const liar = room.round.liars[0];
  const views = () => ps.filter((p) => p.id !== liar).map((p) => room.viewFor(p.id));
  const check = () => {
    for (const v of views()) {
      for (const p of v.players) assert.equal(p.liarTimes, 0, '진행 중 라이어 횟수 노출');
      assert.equal(v.round.result, null);
      assert.ok(!JSON.stringify(v.round).includes('"liars"'));
    }
  };
  check();
  step();
  allHints(room);
  check();
  for (const p of ps.slice(0, 2)) room.vote(p.id, ps.find((x) => x.id !== p.id).id);
  check();
});
