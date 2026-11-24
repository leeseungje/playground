import { randomBytes } from 'node:crypto';
import { newDeck, bestHand, compareScore } from './cards.js';

export const DEFAULTS = {
  maxPlayers: 9,
  startChips: 1000,
  smallBlind: 10,
  bigBlind: 20,
  turnMs: 30_000, // 자기 차례 제한 시간
  awayTurnMs: 5_000, // 접속이 끊긴 사람 차례
  streetPauseMs: 700, // 스트리트 사이 잠깐 멈춤
  runoutStepMs: 1_500, // 올인 후 보드 한 장씩 열기
  nextHandMs: 8_000, // 결과 보여 준 뒤 다음 판
};

const ACTION_LABEL = { fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인' };

function newId() {
  return randomBytes(6).toString('hex');
}

/**
 * 방 하나 = 테이블 하나. 딜러(NPC)는 이 클래스의 진행 로직이다.
 * 카드 정보는 viewFor() 에서만 밖으로 나가며, 다른 사람의 홀카드는 공개 전까지 절대 포함하지 않는다.
 */
export class Room {
  constructor(code, { onChange = () => {}, schedule, options = {} } = {}) {
    this.code = code;
    this.opt = { ...DEFAULTS, ...options };
    this.onChange = onChange;
    // 테스트에서 시간을 직접 돌릴 수 있게 타이머를 주입 받는다
    this.schedule =
      schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.players = []; // { id, token, name, chips, connected, socketId, rebuys, leaving, seatNo }
    this.seatCounter = 0;
    this.departed = new Map(); // token → { chips, rebuys } : 나간 사람이 다시 들어올 때 이어 받기
    this.hostId = null;
    this.running = false;
    this.hand = null;
    this.handNo = 0;
    this.lastButtonSeatNo = null;
    this.log = [];
    this.dealerLine = '어서 오세요. 2명 이상 모이면 방장이 게임을 시작할 수 있어요.';
    this.turnCancel = null;
    this.flowCancel = null;
    this.lastActive = Date.now();
  }

  // ───────── 공통 ─────────

  say(text, { log = true } = {}) {
    this.dealerLine = text;
    if (log) {
      this.log.push(text);
      if (this.log.length > 40) this.log.shift();
    }
  }

  changed() {
    this.lastActive = Date.now();
    this.onChange(this);
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  clearTurnTimer() {
    this.turnCancel?.();
    this.turnCancel = null;
  }

  clearFlowTimer() {
    this.flowCancel?.();
    this.flowCancel = null;
  }

  later(ms, fn) {
    this.clearFlowTimer();
    this.flowCancel = this.schedule(() => {
      this.flowCancel = null;
      fn();
      this.changed();
    }, ms);
  }

  // ───────── 입장·퇴장 ─────────

  join({ token, name, socketId }) {
    let p = this.players.find((x) => x.token === token);
    if (p) {
      const wasAway = !p.connected;
      p.socketId = socketId;
      p.connected = true;
      p.leaving = false;
      if (wasAway) this.say(`${p.name}님이 다시 접속했어요.`);
      if (!this.hostConnected()) this.hostId = p.id;
      this.rescheduleTurnIfNeeded(p.id);
      this.changed();
      return { player: p };
    }
    if (this.players.length >= this.opt.maxPlayers) {
      // 탭을 닫아 돌아올 수 없는 사람이 자리를 영구히 차지하지 않도록, 판에 앉아 있지 않은 끊긴 사람을 비운다
      for (const x of [...this.players]) {
        if (x.connected || (this.seatOf(x.id) && this.hand.street !== 'done')) continue;
        this.departed.set(x.token, { chips: x.chips, rebuys: x.rebuys });
        this.removePlayer(x.id);
        if (this.players.length < this.opt.maxPlayers) break;
      }
    }
    if (this.players.length >= this.opt.maxPlayers) return { error: `방이 가득 찼어요 (최대 ${this.opt.maxPlayers}명)` };
    // 나갔다가 같은 탭으로 다시 들어오면 칩을 이어 받는다 (나갔다 들어와 칩을 새로 받는 것 방지)
    const back = this.departed.get(token);
    this.departed.delete(token);
    let base = (name || '').trim().slice(0, 12) || `플레이어${this.seatCounter + 1}`;
    let finalName = base;
    for (let i = 2; this.players.some((x) => x.name === finalName); i++) finalName = `${base}${i}`;
    p = {
      id: newId(),
      token,
      name: finalName,
      chips: back ? back.chips : this.opt.startChips,
      connected: true,
      socketId,
      rebuys: back ? back.rebuys : 0,
      leaving: false,
      seatNo: this.seatCounter++,
    };
    this.players.push(p);
    if (!this.hostConnected()) this.hostId = p.id;
    this.say(`${p.name}님이 들어왔어요.${this.hand && this.hand.street !== 'done' ? ' 다음 판부터 참여해요.' : ''}`);
    this.changed();
    return { player: p };
  }

  hostConnected() {
    const h = this.player(this.hostId);
    return !!h && h.connected && !h.leaving;
  }

  pickNewHost() {
    const next = this.players.find((p) => p.connected && !p.leaving);
    this.hostId = next ? next.id : this.players[0]?.id ?? null;
    if (next) this.say(`이제 ${next.name}님이 방장이에요.`);
  }

  disconnect(socketId) {
    const p = this.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    this.say(`${p.name}님의 접속이 끊겼어요.`);
    if (this.hostId === p.id) this.pickNewHost();
    this.rescheduleTurnIfNeeded(p.id);
    this.changed();
  }

  leave(playerId) {
    const p = this.player(playerId);
    if (!p) return;
    const seat = this.seatOf(playerId);
    p.leaving = true;
    p.connected = false;
    p.socketId = null;
    this.say(`${p.name}님이 나갔어요.`);
    if (seat && this.hand.street !== 'done' && !seat.folded) {
      if (this.currentSeat() === seat) {
        this.doAction(seat, 'fold');
      } else {
        seat.folded = true;
        seat.lastAction = '폴드';
        this.afterOutOfTurnFold();
      }
    }
    if (!this.seatOf(playerId) || this.hand?.street === 'done') this.removePlayer(playerId);
    if (this.hostId === playerId) this.pickNewHost();
    this.changed();
  }

  removePlayer(id) {
    const p = this.player(id);
    if (p && p.leaving) this.departed.set(p.token, { chips: p.chips, rebuys: p.rebuys });
    this.players = this.players.filter((x) => x.id !== id);
  }

  rebuy(playerId) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (p.chips > 0) return { error: '칩이 남아 있을 때는 다시 받을 수 없어요' };
    const seat = this.seatOf(playerId);
    if (seat && this.hand.street !== 'done') return { error: '이번 판이 끝난 뒤에 받을 수 있어요' };
    p.chips = this.opt.startChips;
    p.rebuys++;
    this.say(`${p.name}님이 칩 ${this.opt.startChips}개를 다시 받았어요.`);
    this.changed();
    return {};
  }

  // ───────── 방장 조작 ─────────

  start(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 시작할 수 있어요' };
    if (this.eligible().length < 2) return { error: '칩이 있는 접속자가 2명 이상 있어야 해요' };
    this.running = true;
    if (!this.hand || this.hand.street === 'done') {
      this.clearFlowTimer();
      this.startHand();
    }
    this.changed();
    return {};
  }

  pause(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 멈출 수 있어요' };
    this.running = false;
    const midHand = this.hand && this.hand.street !== 'done';
    // 진행 중인 판의 흐름(스트리트 넘김·쇼다운)은 그대로 두고, 다음 판 예약만 취소한다
    if (!midHand) this.clearFlowTimer();
    this.say(midHand ? '이번 판까지만 하고 쉴게요.' : '게임을 멈췄어요.');
    this.changed();
    return {};
  }

  // ───────── 한 판 진행 ─────────

  eligible() {
    return this.players.filter((p) => p.chips > 0 && p.connected && !p.leaving);
  }

  seatOf(playerId) {
    if (!this.hand) return null;
    return this.hand.seats.find((s) => s.id === playerId) ?? null;
  }

  currentSeat() {
    const h = this.hand;
    if (!h || h.toActIdx < 0) return null;
    return h.seats[h.toActIdx];
  }

  startHand() {
    this.clearTurnTimer();
    this.clearFlowTimer();
    // 지난 판에 나간 사람 정리
    for (const p of [...this.players]) if (p.leaving) this.removePlayer(p.id);

    const seatsP = this.eligible();
    if (seatsP.length < 2) {
      this.running = false;
      this.say('칩이 있는 접속자가 2명 이상 있어야 다음 판을 시작할 수 있어요.');
      return;
    }
    const { smallBlind, bigBlind } = this.opt;
    this.handNo++;
    const n = seatsP.length;
    let buttonIdx = 0;
    if (this.lastButtonSeatNo !== null) {
      const i = seatsP.findIndex((p) => p.seatNo > this.lastButtonSeatNo);
      buttonIdx = i === -1 ? 0 : i;
    }
    this.lastButtonSeatNo = seatsP[buttonIdx].seatNo;
    const sbIdx = n === 2 ? buttonIdx : (buttonIdx + 1) % n;
    const bbIdx = (sbIdx + 1) % n;

    const h = {
      no: this.handNo,
      deck: newDeck(),
      board: [],
      street: 'preflop',
      seats: seatsP.map((p) => ({
        id: p.id,
        p,
        hole: [],
        bet: 0,
        total: 0,
        folded: false,
        allIn: false,
        acted: false,
        lastAction: null,
      })),
      buttonIdx,
      sbIdx,
      bbIdx,
      currentBet: 0,
      minRaise: bigBlind,
      toActIdx: -1,
      turnEndsAt: 0,
      revealed: new Set(),
      results: null,
    };
    this.hand = h;

    this.commit(h.seats[sbIdx], Math.min(smallBlind, h.seats[sbIdx].p.chips));
    h.seats[sbIdx].lastAction = `SB ${h.seats[sbIdx].bet}`;
    this.commit(h.seats[bbIdx], Math.min(bigBlind, h.seats[bbIdx].p.chips));
    h.seats[bbIdx].lastAction = `BB ${h.seats[bbIdx].bet}`;
    // 빅블라인드가 모자라 올인이어도 콜 금액은 빅블라인드 기준
    h.currentBet = Math.max(bigBlind, h.seats[sbIdx].bet, h.seats[bbIdx].bet);

    for (let round = 0; round < 2; round++)
      for (let k = 0; k < n; k++) h.seats[(sbIdx + k) % n].hole.push(h.deck.pop());

    this.say(`${this.handNo}번째 판을 시작합니다. 카드를 나눠 드릴게요.`);
    const first = n === 2 ? buttonIdx : (bbIdx + 1) % n;
    this.proceed(first);
  }

  commit(seat, amount) {
    seat.p.chips -= amount;
    seat.bet += amount;
    seat.total += amount;
    if (seat.p.chips === 0) seat.allIn = true;
  }

  alive() {
    return this.hand.seats.filter((s) => !s.folded);
  }

  canActSeats() {
    return this.hand.seats.filter((s) => !s.folded && !s.allIn);
  }

  roundDone() {
    const h = this.hand;
    const canAct = this.canActSeats();
    const pending = canAct.filter((s) => !(s.acted && s.bet === h.currentBet));
    if (pending.length === 0) return true;
    // 혼자만 베팅할 수 있고, 남은 상대(모두 올인) 중 가장 많이 낸 사람만큼 이미 냈다면 물어볼 필요가 없다
    // (헤즈업에서 BB가 블라인드보다 적게 올인한 경우 등)
    if (canAct.length === 1) {
      const maxOther = Math.max(0, ...this.alive().filter((s) => s !== canAct[0]).map((s) => s.bet));
      if (canAct[0].bet >= maxOther) return true;
    }
    return false;
  }

  findActor(fromIdx) {
    const h = this.hand;
    const n = h.seats.length;
    for (let k = 0; k < n; k++) {
      const idx = (((fromIdx + k) % n) + n) % n;
      const s = h.seats[idx];
      if (!s.folded && !s.allIn && !(s.acted && s.bet === h.currentBet)) return idx;
    }
    return -1;
  }

  /** 지금 상태에서 다음에 할 일을 정한다 (판 종료 / 스트리트 종료 / 다음 사람 차례) */
  proceed(fromIdx) {
    const h = this.hand;
    this.clearTurnTimer();
    h.toActIdx = -1;
    const alive = this.alive();
    if (alive.length === 1) return this.finishByFold(alive[0]);
    if (this.roundDone()) return this.endStreet();
    const idx = this.findActor(fromIdx);
    if (idx < 0) return this.endStreet();
    this.setTurn(idx);
  }

  setTurn(idx) {
    const h = this.hand;
    // 재접속 등으로 다시 걸 때 이전 타이머가 남아 있으면 원래 마감 시각에 자동 처리돼 버린다
    this.clearTurnTimer();
    h.toActIdx = idx;
    const s = h.seats[idx];
    const ms = s.p.connected ? this.opt.turnMs : this.opt.awayTurnMs;
    h.turnEndsAt = Date.now() + ms;
    const toCall = h.currentBet - s.bet;
    this.say(`${s.p.name}님 차례입니다.${toCall > 0 ? ` (콜 ${Math.min(toCall, s.p.chips)})` : ''}`, { log: false });
    const handNo = h.no;
    this.turnCancel = this.schedule(() => {
      this.turnCancel = null;
      if (this.hand?.no !== handNo || this.currentSeat() !== s) return;
      const timeout = h.currentBet - s.bet > 0 ? 'fold' : 'check';
      this.say(`${s.p.name}님 시간이 지나 자동으로 ${ACTION_LABEL[timeout]}했어요.`);
      this.doAction(s, timeout);
      this.changed();
    }, ms);
  }

  rescheduleTurnIfNeeded(playerId) {
    const s = this.currentSeat();
    if (s && s.id === playerId) this.setTurn(this.hand.toActIdx);
  }

  /** 지금 차례인 사람이 할 수 있는 행동 */
  options(seat) {
    const h = this.hand;
    const toCall = Math.max(0, h.currentBet - seat.bet);
    const chips = seat.p.chips;
    const maxTo = seat.bet + chips;
    // 상대가 모두 올인이면 더 걸어도 받을 사람이 없으므로 레이즈를 막는다
    const opponentCanAct = h.seats.some((s) => s !== seat && !s.folded && !s.allIn);
    const canRaise = !seat.acted && chips > toCall && opponentCanAct;
    const minTo = Math.min(h.currentBet + h.minRaise, maxTo);
    return {
      toCall: Math.min(toCall, chips),
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise,
      isBet: h.currentBet === 0,
      minTo,
      maxTo,
      pot: h.seats.reduce((a, s) => a + s.total, 0),
      currentBet: h.currentBet,
      myBet: seat.bet,
    };
  }

  act(playerId, type, amount) {
    const h = this.hand;
    if (!h || h.street === 'done') return { error: '진행 중인 판이 없어요' };
    const seat = this.currentSeat();
    if (!seat || seat.id !== playerId) return { error: '지금은 차례가 아니에요' };
    const res = this.doAction(seat, type, amount);
    if (!res.error) this.changed();
    return res;
  }

  doAction(seat, type, amount) {
    const h = this.hand;
    const o = this.options(seat);
    const before = h.toActIdx;
    const name = seat.p.name;

    if (type === 'allin') {
      if (seat.p.chips <= o.toCall || !o.canRaise) type = 'call';
      else {
        type = 'raise';
        amount = o.maxTo;
      }
    }

    switch (type) {
      case 'fold':
        seat.folded = true;
        seat.lastAction = '폴드';
        this.say(`${name}님 폴드.`);
        break;
      case 'check':
        if (!o.canCheck) return { error: `체크할 수 없어요. 콜하려면 ${o.toCall}이 필요해요` };
        seat.lastAction = '체크';
        this.say(`${name}님 체크.`);
        break;
      case 'call': {
        if (!o.canCall) return { error: '콜할 금액이 없어요. 체크하세요' };
        this.commit(seat, o.toCall);
        seat.lastAction = seat.allIn ? `올인 ${seat.bet}` : `콜 ${seat.bet}`;
        this.say(`${name}님 ${seat.allIn ? '올인' : '콜'} (${o.toCall}).`);
        break;
      }
      case 'bet':
      case 'raise': {
        if (!o.canRaise) return { error: '지금은 레이즈할 수 없어요' };
        let to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) return { error: '금액이 올바르지 않아요' };
        if (to > o.maxTo) to = o.maxTo;
        if (to <= h.currentBet) return { error: `현재 베팅(${h.currentBet})보다 많이 걸어야 해요` };
        if (to < o.minTo && to !== o.maxTo) return { error: `최소 ${o.minTo}까지 걸어야 해요` };
        const raiseBy = to - h.currentBet;
        const wasBet = h.currentBet === 0;
        this.commit(seat, to - seat.bet);
        if (raiseBy >= h.minRaise) {
          h.minRaise = raiseBy;
          for (const s of h.seats) if (s !== seat) s.acted = false;
        }
        h.currentBet = to;
        seat.lastAction = seat.allIn ? `올인 ${to}` : `${wasBet ? '벳' : '레이즈'} ${to}`;
        this.say(`${name}님 ${seat.allIn ? '올인' : wasBet ? '벳' : '레이즈'} ${to}.`);
        break;
      }
      default:
        return { error: '알 수 없는 행동이에요' };
    }
    seat.acted = true;
    this.proceed(before + 1);
    return {};
  }

  afterOutOfTurnFold() {
    const h = this.hand;
    const alive = this.alive();
    if (alive.length === 1) {
      this.clearTurnTimer();
      h.toActIdx = -1;
      this.finishByFold(alive[0]);
    } else if (h.toActIdx >= 0 && this.roundDone()) {
      this.proceed(h.toActIdx);
    }
  }

  endStreet() {
    const h = this.hand;
    h.toActIdx = -1;
    for (const s of h.seats) {
      s.bet = 0;
      s.acted = false;
    }
    h.currentBet = 0;
    h.minRaise = this.opt.bigBlind;

    if (h.street === 'river') {
      this.later(this.opt.streetPauseMs, () => this.showdown());
      return;
    }
    if (this.canActSeats().length <= 1) {
      // 더 베팅할 사람이 없으면 패를 공개하고 보드를 끝까지 연다
      for (const s of this.alive()) h.revealed.add(s.id);
      this.say('더 베팅할 수 없어요. 패를 공개하고 남은 카드를 엽니다.');
      this.runout();
      return;
    }
    this.later(this.opt.streetPauseMs, () => {
      this.dealStreet();
      for (const s of h.seats) if (!s.folded && !s.allIn) s.lastAction = null;
      this.proceed(h.buttonIdx + 1);
    });
  }

  runout() {
    const h = this.hand;
    this.later(this.opt.runoutStepMs, () => {
      if (h.street === 'river') return this.showdown();
      this.dealStreet();
      this.runout();
    });
  }

  dealStreet() {
    const h = this.hand;
    h.deck.pop(); // 번 카드
    if (h.street === 'preflop') {
      h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
      h.street = 'flop';
      this.say('플롭을 엽니다.');
    } else if (h.street === 'flop') {
      h.board.push(h.deck.pop());
      h.street = 'turn';
      this.say('턴 카드를 엽니다.');
    } else if (h.street === 'turn') {
      h.board.push(h.deck.pop());
      h.street = 'river';
      this.say('리버 카드를 엽니다.');
    }
  }

  finishByFold(winner) {
    const h = this.hand;
    const pot = h.seats.reduce((a, s) => a + s.total, 0);
    winner.p.chips += pot;
    h.results = {
      type: 'fold',
      pots: [{ amount: pot, winners: [winner.id] }],
      payouts: { [winner.id]: pot },
      hands: {},
    };
    this.say(`모두 폴드해서 ${winner.p.name}님이 ${pot}을 가져갑니다.`);
    this.endHand();
  }

  showdown() {
    const h = this.hand;
    h.toActIdx = -1;
    h.street = 'showdown';
    const alive = this.alive();
    for (const s of alive) h.revealed.add(s.id);
    const best = new Map(alive.map((s) => [s.id, bestHand([...s.hole, ...h.board])]));

    // 사이드팟 계산
    const remaining = h.seats.map((s) => ({ s, amt: s.total }));
    const pots = [];
    for (;;) {
      const contenders = remaining.filter((x) => x.amt > 0 && !x.s.folded);
      if (contenders.length === 0) {
        const left = remaining.reduce((a, x) => a + x.amt, 0);
        if (left > 0 && pots.length) pots[pots.length - 1].amount += left;
        break;
      }
      const level = Math.min(...contenders.map((x) => x.amt));
      let amount = 0;
      for (const x of remaining) {
        const take = Math.min(x.amt, level);
        amount += take;
        x.amt -= take;
      }
      pots.push({ amount, eligible: contenders.map((x) => x.s) });
    }

    // 버튼 왼쪽부터 순서 (나머지 칩 배분용)
    const n = h.seats.length;
    const order = (s) => (h.seats.indexOf(s) - h.buttonIdx - 1 + n) % n;
    const payouts = {};
    const potResults = [];
    for (const pot of pots) {
      let top = null;
      let winners = [];
      for (const s of pot.eligible) {
        const c = top ? compareScore(best.get(s.id).score, top) : 1;
        if (c > 0) {
          top = best.get(s.id).score;
          winners = [s];
        } else if (c === 0) winners.push(s);
      }
      winners.sort((a, b) => order(a) - order(b));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const win = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        w.p.chips += win;
        payouts[w.id] = (payouts[w.id] || 0) + win;
      }
      potResults.push({ amount: pot.amount, winners: winners.map((w) => w.id) });
    }

    const hands = {};
    for (const [id, b] of best) hands[id] = { name: b.name, cards: b.cards };
    h.results = { type: 'showdown', pots: potResults, payouts, hands };

    const msg = Object.entries(payouts)
      .map(([id, amt]) => `${this.player(id)?.name ?? '?'}님 ${hands[id].name}로 ${amt}`)
      .join(', ');
    this.say(`쇼다운! ${msg} 획득.`);
    this.endHand();
  }

  endHand() {
    const h = this.hand;
    this.clearTurnTimer();
    // 스트리트 넘김·런아웃 예약이 남아 있으면 끝난 판을 다시 건드리므로 반드시 지운다
    this.clearFlowTimer();
    h.street = 'done';
    h.toActIdx = -1;
    for (const p of [...this.players]) if (p.leaving) this.removePlayer(p.id);
    if (!this.hostConnected()) this.pickNewHost();
    if (this.running) {
      this.later(this.opt.nextHandMs, () => {
        if (this.running) this.startHand();
      });
    }
  }

  // ───────── 화면용 상태 (플레이어별) ─────────

  viewFor(playerId) {
    const h = this.hand;
    const me = this.player(playerId);
    const players = this.players.map((p) => {
      const seat = this.seatOf(p.id);
      let cards = null;
      if (seat) {
        if (p.id === playerId || h.revealed.has(p.id)) cards = seat.hole;
        else if (!seat.folded) cards = ['back', 'back'];
      }
      return {
        id: p.id,
        name: p.name,
        chips: p.chips,
        connected: p.connected,
        rebuys: p.rebuys,
        seatNo: p.seatNo,
        inHand: !!seat && h.street !== 'done',
        folded: seat?.folded ?? false,
        allIn: seat?.allIn ?? false,
        bet: seat?.bet ?? 0,
        lastAction: seat?.lastAction ?? null,
        cards,
      };
    });

    let hand = null;
    if (h) {
      const cur = this.currentSeat();
      hand = {
        no: h.no,
        street: h.street,
        board: h.board,
        pot: h.seats.reduce((a, s) => a + s.total, 0),
        currentBet: h.currentBet,
        buttonId: h.seats[h.buttonIdx].id,
        sbId: h.seats[h.sbIdx].id,
        bbId: h.seats[h.bbIdx].id,
        toActId: cur?.id ?? null,
        turnMsLeft: cur ? Math.max(0, h.turnEndsAt - Date.now()) : 0,
        turnMsTotal: cur ? (cur.p.connected ? this.opt.turnMs : this.opt.awayTurnMs) : 0,
        results: h.results,
      };
    }
    const mySeat = this.seatOf(playerId);
    const myTurn = mySeat && this.currentSeat() === mySeat;

    return {
      code: this.code,
      me: playerId,
      hostId: this.hostId,
      running: this.running,
      blinds: [this.opt.smallBlind, this.opt.bigBlind],
      startChips: this.opt.startChips,
      players,
      hand,
      actions: myTurn ? this.options(mySeat) : null,
      dealerLine: this.dealerLine,
      log: this.log.slice(-15),
      canRebuy: !!me && me.chips === 0 && !(mySeat && h.street !== 'done'),
    };
  }
}
