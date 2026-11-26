import { randomInt } from 'node:crypto';
import { SEOTDA_IDS, evalSeotda, resolveSeotda, seotdaOneCard } from '../shared/hwatu.js';

/*
 * 2장 섯다 한 판.
 *  - 학교(기본금)를 내고 한 장 → 베팅 → 한 장 더 → 베팅 → 패 공개
 *  - 베팅: 체크·삥(기본금만큼)·콜·따당(앞 베팅의 두 배)·하프(콜 후 판돈의 절반)·다이
 *  - 한 판에 걸 수 있는 최대 칩 = 시작할 때 참가자 중 가장 적은 칩 (사이드팟이 생기지 않는다)
 *  - 구사·멍텅구리 구사 재경기는 판돈을 그대로 두고 살아 있던 사람끼리 다시 친다
 *  - 다른 사람의 패는 공개 전까지 view 에 넣지 않는다
 */

export const ACTION_LABEL = { check: '체크', bbing: '삥', call: '콜', ttadang: '따당', half: '하프', die: '다이', max: '맥스' };

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class SeotdaGame {
  /**
   * @param room HwatuRoom
   * @param order 참가자 id (첫 번째가 선)
   * @param carry 재경기면 { pot, contrib } 를 이어 받는다
   */
  constructor(room, order, { carry = null, replayNo = 0, deck = null } = {}) {
    this.room = room;
    this.kind = 'seotda';
    this.order = order;
    this.replayNo = replayNo;
    this.deck = deck ?? shuffle(SEOTDA_IDS);
    this.hands = new Map(order.map((id) => [id, []]));
    this.folded = new Set();
    this.contrib = new Map(order.map((id) => [id, carry?.contrib.get(id) ?? 0]));
    this.bets = new Map();
    this.pot = carry?.pot ?? 0;
    this.ante = room.settings.ante;
    this.stage = 0; // 받은 카드 수
    this.phase = 'betting'; // betting → result
    this.turn = null;
    this.currentBet = 0;
    this.acted = new Set();
    this.log = []; // 이번 판 행동 기록 [{ pid, type, amount }]
    this.result = null;
    // 최대 베팅: 지금 가진 칩 중 가장 적은 사람 기준
    const chips = order.map((id) => room.player(id)?.chips ?? 0);
    if (!carry) {
      for (const id of order) this.pay(id, Math.min(this.ante, room.player(id).chips));
      this.cap = Math.min(...chips);
    } else this.cap = Math.min(...order.map((id) => (this.contrib.get(id) ?? 0) + (room.player(id)?.chips ?? 0)));
  }

  pay(id, amount) {
    const p = this.room.player(id);
    const n = Math.max(0, Math.min(amount, p ? p.chips : 0));
    if (p) p.chips -= n;
    this.contrib.set(id, (this.contrib.get(id) ?? 0) + n);
    this.bets.set(id, (this.bets.get(id) ?? 0) + n);
    this.pot += n;
    return n;
  }

  alive() {
    return this.order.filter((id) => !this.folded.has(id));
  }

  start() {
    this.dealOne();
  }

  dealOne() {
    this.stage++;
    for (const id of this.order) if (!this.folded.has(id)) this.hands.get(id).push(this.deck.pop());
    this.bets = new Map();
    this.currentBet = 0;
    this.acted = new Set();
    this.room.say(this.stage === 1 ? (this.replayNo ? `재경기! 판돈 ${this.pot.toLocaleString('ko-KR')}칩을 걸고 다시 칩니다. 첫 장이에요.` : '첫 장을 돌렸어요. 내 패를 보고 베팅하세요.') : '두 번째 장! 족보를 확인하고 마지막 베팅을 하세요.');
    this.room.sound('deal', { n: this.alive().length, stage: this.stage });
    this.setTurn(this.alive()[0]);
  }

  /** 지금 차례인 사람이 할 수 있는 행동과 금액 */
  options(id) {
    if (this.phase !== 'betting' || this.turn !== id) return null;
    const p = this.room.player(id);
    const mine = this.bets.get(id) ?? 0;
    const toCall = this.currentBet - mine;
    const room = this.cap - (this.contrib.get(id) ?? 0); // 이번 판에 더 낼 수 있는 칩
    const can = Math.min(room, p?.chips ?? 0);
    const opts = { die: 0 };
    if (toCall <= 0) opts.check = 0;
    else opts.call = Math.min(toCall, can);
    // 올릴 수 있는 여유가 있어야 레이즈 계열을 준다
    const raiseTo = (level) => {
      const need = level - mine;
      if (need <= toCall || need > can) return null;
      return need;
    };
    if (this.currentBet === 0) {
      const b = raiseTo(this.ante);
      if (b != null) opts.bbing = b;
    } else {
      const t = raiseTo(this.currentBet * 2);
      if (t != null) opts.ttadang = t;
    }
    const half = raiseTo(this.currentBet + Math.floor((this.pot + Math.max(0, toCall)) / 2));
    if (half != null && half !== opts.ttadang && half !== opts.bbing) opts.half = half;
    // 남은 한도를 전부 거는 맥스 (다른 레이즈보다 클 때만)
    if (can > toCall && can !== opts.half && can !== opts.ttadang && can !== opts.bbing && raiseTo(mine + can) != null) opts.max = can;
    return opts;
  }

  setTurn(id) {
    this.turn = id;
    const p = this.room.player(id);
    const ms = p?.connected ? this.room.settings.turnSec * 1000 : this.room.opt.awayMs;
    this.room.later(ms, () => {
      const o = this.options(id);
      if (o) this.act(id, { type: o.check != null ? 'check' : 'die' }, true);
    });
  }

  act(id, msg, timeout = false) {
    if (this.phase !== 'betting') return { error: '지금은 베팅할 수 없어요' };
    if (this.turn !== id) return { error: '내 차례가 아니에요' };
    const type = String(msg.type);
    const opts = this.options(id);
    if (!Object.hasOwn(opts, type)) return { error: '지금은 그 행동을 할 수 없어요' };
    const name = this.room.player(id)?.name ?? '?';
    if (type === 'die') {
      this.folded.add(id);
      this.log.push({ pid: id, type });
      this.room.say(`${name}님 ${timeout ? '시간 초과로 ' : ''}다이.`);
      this.room.sound('bet', { pid: id, type: 'die' });
    } else {
      const amount = opts[type];
      this.pay(id, amount);
      const mine = this.bets.get(id) ?? 0;
      if (mine > this.currentBet) {
        this.currentBet = mine;
        this.acted = new Set();
      }
      this.log.push({ pid: id, type, amount });
      const words = { check: '체크', bbing: '삥!', call: '콜', ttadang: '따당!', half: '하프!', max: '맥스!' };
      this.room.say(`${name}님 ${timeout ? '시간 초과로 ' : ''}${words[type]}${amount ? ` (${amount.toLocaleString('ko-KR')})` : ''}`);
      this.room.sound('bet', { pid: id, type });
    }
    this.acted.add(id);
    this.advance();
    return {};
  }

  /** 한 사람이 나가거나 끊겨서 빠질 때 */
  remove(id) {
    if (this.phase !== 'betting' || this.folded.has(id) || !this.order.includes(id)) return;
    this.folded.add(id);
    this.log.push({ pid: id, type: 'die' });
    if (this.turn === id) this.advance();
    else if (this.alive().length <= 1) this.advance();
  }

  advance() {
    const alive = this.alive();
    if (alive.length <= 1) return this.finish({ winners: alive, reason: 'fold' });
    const done = alive.every((id) => this.acted.has(id) && ((this.bets.get(id) ?? 0) >= this.currentBet || (this.contrib.get(id) ?? 0) >= this.cap));
    if (done) {
      if (this.stage < 2) return this.dealOne();
      return this.showdown();
    }
    // 다음 사람 (순서대로, 다이 안 한 사람)
    const i = this.order.indexOf(this.turn);
    for (let k = 1; k <= this.order.length; k++) {
      const id = this.order[(i + k) % this.order.length];
      if (this.folded.has(id)) continue;
      const settled = this.acted.has(id) && ((this.bets.get(id) ?? 0) >= this.currentBet || (this.contrib.get(id) ?? 0) >= this.cap);
      if (!settled) return this.setTurn(id);
    }
    return this.stage < 2 ? this.dealOne() : this.showdown();
  }

  showdown() {
    const alive = this.alive();
    const res = resolveSeotda(alive.map((pid) => ({ pid, ids: this.hands.get(pid) })));
    if (res.replay) return this.finish({ replay: res.replay, results: res.results, reason: 'replay' });
    return this.finish({ winners: res.winners, results: res.results, reason: 'showdown' });
  }

  finish({ winners = [], results = null, replay = null, reason }) {
    this.room.clearTimer();
    this.turn = null;
    this.phase = 'result';
    const nameOf = (id) => this.room.player(id)?.name ?? '나간 사람';
    if (replay) {
      this.result = { reason, replay, results, pot: this.pot, shown: this.alive() };
      const label = replay.key === 'meong' ? '멍텅구리 구사' : '구사';
      this.room.say(`${nameOf(replay.by)}님의 ${label}! 재경기예요. 판돈은 그대로 이어집니다.`);
      this.room.sound('replay', { pid: replay.by, label });
      return this.room.gameOver(this);
    }
    // 판돈 나누기: 나머지는 순서상 앞사람에게
    const live = winners.filter((id) => this.room.player(id));
    const share = live.length ? Math.floor(this.pot / live.length) : 0;
    let rest = this.pot - share * live.length;
    const won = {};
    for (const id of this.order.filter((x) => live.includes(x))) {
      const extra = rest > 0 ? rest : 0;
      rest = 0;
      won[id] = share + extra;
      this.room.player(id).chips += share + extra;
    }
    this.result = { reason, winners: live, won, results, pot: this.pot, shown: reason === 'showdown' ? this.alive() : [] };
    const top = live.map(nameOf).join(', ');
    if (!live.length) this.room.say('이긴 사람이 모두 나가서 판돈이 사라졌어요.');
    else if (reason === 'fold') this.room.say(`모두 다이! ${top}님이 ${this.pot.toLocaleString('ko-KR')}칩을 가져가요.`);
    else {
      const r = results[live[0]];
      const how = r.caught ? `${r.name}로 잡았어요!` : `${r.name}!`;
      this.room.say(live.length > 1 ? `${r.name} 동점! ${top}님이 판돈을 나눠 가져요.` : `${top}님 ${how} ${this.pot.toLocaleString('ko-KR')}칩 획득!`);
    }
    if (reason === 'showdown' && live.length) {
      const r = results[live[0]];
      this.room.sound('jokbo', { pid: live[0], name: r.name, rank: r.eff, caught: !!r.caught, tie: live.length > 1 });
    }
    this.room.sound('pot', { pid: live[0] ?? null });
    return this.room.gameOver(this);
  }

  view(me) {
    const done = this.phase === 'result';
    const shown = new Set(done ? this.result.shown : []);
    return {
      kind: 'seotda',
      phase: this.phase,
      stage: this.stage,
      replayNo: this.replayNo,
      order: this.order,
      turn: this.turn,
      pot: this.pot,
      cap: this.cap,
      ante: this.ante,
      currentBet: this.currentBet,
      folded: [...this.folded],
      bets: Object.fromEntries(this.bets),
      contrib: Object.fromEntries(this.contrib),
      lastActs: Object.fromEntries(this.log.map((l) => [l.pid, l])),
      // 내 패는 나에게만, 다른 사람 패는 쇼다운에서 공개된 것만
      hands: Object.fromEntries(
        this.order.map((id) => {
          const h = this.hands.get(id);
          if (id === me || shown.has(id)) return [id, h];
          return [id, h.map(() => null)];
        }),
      ),
      myHand: this.hands.get(me) ? { ids: this.hands.get(me), jokbo: this.hands.get(me).length === 2 ? evalSeotda(this.hands.get(me)) : null, one: this.hands.get(me).length === 1 ? seotdaOneCard(this.hands.get(me)[0]) : null } : null,
      options: this.options(me),
      result: done
        ? {
            reason: this.result.reason,
            replay: this.result.replay ?? null,
            winners: this.result.winners ?? [],
            won: this.result.won ?? {},
            pot: this.result.pot,
            results: this.result.results ? Object.fromEntries(Object.entries(this.result.results).filter(([id]) => shown.has(id))) : null,
          }
        : null,
    };
  }
}
