import { randomInt } from 'node:crypto';
import { ALL_IDS, JOKER_IDS, card, scoreGostop, loserPi } from '../shared/hwatu.js';

/*
 * 고스톱 한 판 (2인 맞고 / 3인 고스톱)
 *  - 2인: 손패 10장, 바닥 8장, 7점부터 날 수 있다 / 3인: 손패 7장, 바닥 6장, 3점부터
 *  - 낸 패와 뒤집은 패로 같은 달을 먹는다. 쪽·뻑·따닥·싹쓸이·폭탄·흔들기·총통
 *  - 점수가 나면 고(계속) 또는 스톱(끝). 고 1번마다 +1점, 3고부터 2배씩
 *  - 피박·광박·멍박 2배, 흔들기·폭탄 2배, 3인에서 고를 부르고 진 사람은 고박(혼자 다 냄), 나가리면 다음 판 2배
 *  - 다른 사람 손패는 장수만 view 에 넣는다
 */

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const monthOf = (id) => card(id).month;
const isJoker = (id) => !!card(id)?.joker;
/** 두 장이 먹을 때 다를 게 없는 패인지 (둘 다 피 같은 경우 고를 필요 없음) */
const sameValue = (a, b) => {
  const x = card(a);
  const y = card(b);
  return x.kind === y.kind && x.ribbon === y.ribbon && x.bird === y.bird && x.rainGwang === y.rainGwang && x.gukjin === y.gukjin;
};

export const GOSTOP_RULES = { 2: { hand: 10, floor: 8, win: 7 }, 3: { hand: 7, floor: 6, win: 3 } };

export class GostopGame {
  /** order: 참가자 id (첫 번째가 선), deck: 테스트용으로 정해진 순서를 넣을 수 있음 (pop 으로 뽑힘) */
  constructor(room, order, { deck = null, nagari = 1, seller = null, jokers = 0 } = {}) {
    this.room = room;
    this.jokers = Math.max(0, Math.min(JOKER_IDS.length, jokers)); // 조커(보너스 쌍피) 장수
    this.seller = seller; // 4명 이상일 때 이번 판을 쉬며 광을 파는 사람
    this.sale = null;
    this.kind = 'gostop';
    this.order = order;
    this.rule = GOSTOP_RULES[order.length];
    this.nagari = nagari; // 지난 판 나가리 배수
    this.fixedDeck = deck;
    this.phase = 'play'; // play → chooseFlip → goStop → result
    this.turnIdx = 0;
    this.hands = new Map();
    this.captured = new Map(order.map((id) => [id, []]));
    this.floor = [];
    this.deck = [];
    this.ppeok = new Map(); // 달 → 뻑을 만든 사람 (바닥에 쌓인 3장)
    this.ppeokCount = new Map(order.map((id) => [id, 0]));
    this.goCount = new Map(order.map((id) => [id, 0]));
    this.lastGoScore = new Map(order.map((id) => [id, 0]));
    this.shakes = new Map(order.map((id) => [id, 0])); // 흔들기·폭탄 횟수 (1번마다 2배)
    this.skips = new Map(order.map((id) => [id, 0])); // 폭탄 뒤 손패 없이 뒤집기만 하는 차례
    this.pending = null; // 뒤집은 패로 바닥 두 장 중 고를 때
    this.last = null; // 직전 차례에 일어난 일 (화면 연출용)
    this.turnNo = 0;
    this.result = null;
  }

  get turn() {
    return this.phase === 'result' ? null : this.order[this.turnIdx];
  }

  start() {
    for (let tries = 0; tries < 20; tries++) {
      const deck = this.fixedDeck ? [...this.fixedDeck] : shuffle([...ALL_IDS, ...JOKER_IDS.slice(0, this.jokers)]);
      this.hands = new Map(this.order.map((id) => [id, []]));
      for (const id of this.order) for (let i = 0; i < this.rule.hand; i++) this.hands.get(id).push(deck.pop());
      this.floor = [];
      for (let i = 0; i < this.rule.floor; i++) this.floor.push(deck.pop());
      // 광팔기: 쉬는 사람도 한 몫(7장)을 받아 광만 보여 주고, 그 패는 더미 맨 밑으로 들어간다
      this.sellerHand = [];
      if (this.seller) for (let i = 0; i < this.rule.hand; i++) this.sellerHand.push(deck.pop());
      deck.unshift(...this.sellerHand);
      this.deck = deck;
      // 바닥에 같은 달 4장이면 다시 돌린다
      if (this.fixedDeck || !this.monthCounts(this.floor).some(([m, n]) => m > 0 && n === 4)) break;
    }
    // 바닥에 깔린 조커는 선이 가져가고 그 자리는 더미에서 채운다
    while (this.floor.some(isJoker) && this.deck.length) {
      const j = this.floor.find(isJoker);
      this.floor.splice(this.floor.indexOf(j), 1, this.deck.pop());
      this.captured.get(this.order[0]).push(j);
      this.room.sound('joker', { pid: this.order[0] });
    }
    for (const id of this.order) this.hands.get(id).sort((a, b) => monthOf(a) - monthOf(b) || a.localeCompare(b));
    this.room.sound('deal');
    if (this.seller) this.sellGwang();
    // 총통: 손에 같은 달 4장
    for (const id of this.order) {
      const four = this.monthCounts(this.hands.get(id)).find(([m, n]) => m > 0 && n === 4);
      if (four) {
        this.room.say(`${this.name(id)}님 총통! (${four[0]}월 네 장) 바로 이겼어요.`);
        this.room.sound('chongtong', { pid: id, month: four[0] });
        return this.finish(id, { chongtong: four[0] });
      }
    }
    const saleLine = this.sale ? (this.sale.cards.length ? ` ${this.name(this.seller)}님이 광 ${this.sale.cards.length}장을 팔았어요.` : ` ${this.name(this.seller)}님은 광이 없어 그냥 쉬어요.`) : '';
    this.room.say(`${this.name(this.turn)}님이 선이에요. ${this.rule.win}점부터 날 수 있어요.${saleLine}${this.nagari > 1 ? ` 지난 판 나가리로 이번 판은 ${this.nagari}배!` : ''}`);
    this.setTimer();
  }

  /** 광 판 사람에게 치는 사람마다 광 1장당 점당 칩을 낸다 */
  sellGwang() {
    const gw = this.sellerHand.filter((c) => card(c).kind === 'gwang');
    const unit = this.room.settings.pointChips;
    const paid = [];
    const s = this.room.player(this.seller);
    for (const id of this.order) {
      const p = this.room.player(id);
      const n = Math.min(gw.length * unit, p?.chips ?? 0);
      if (p) p.chips -= n;
      if (s) s.chips += n;
      paid.push({ from: id, chips: n });
    }
    this.sale = { seller: this.seller, cards: gw, paid };
    if (gw.length) this.room.sound('gwangSale', { pid: this.seller, n: gw.length });
  }

  name(id) {
    return this.room.player(id)?.name ?? '나간 사람';
  }

  monthCounts(ids) {
    const m = new Map();
    for (const id of ids) m.set(monthOf(id), (m.get(monthOf(id)) ?? 0) + 1);
    return [...m.entries()];
  }

  floorOf(month) {
    return this.floor.filter((id) => monthOf(id) === month);
  }

  score(id) {
    return scoreGostop(this.captured.get(id));
  }

  // ───────── 타이머 ─────────
  setTimer() {
    const id = this.turn;
    const p = this.room.player(id);
    const ms = p?.connected ? this.room.settings.turnSec * 1000 : this.room.opt.awayMs;
    this.room.later(ms, () => this.autoMove(id));
  }

  /** 시간 초과: 먹을 수 있는 패 먼저, 고르기는 첫 번째, 고/스톱은 스톱 */
  autoMove(id) {
    if (this.turn !== id) return;
    if (this.phase === 'goStop') return this.decide(id, 'stop', true);
    if (this.phase === 'chooseFlip') return this.chooseFlip(id, this.pending.options[0]);
    const hand = this.hands.get(id);
    if (!hand.length) return this.flipOnly(id);
    const pick = hand.find((c) => this.floorOf(monthOf(c)).length) ?? hand[0];
    const matches = this.floorOf(monthOf(pick));
    this.play(id, pick, { target: matches.length === 2 ? matches[0] : undefined });
  }

  // ───────── 차례 진행 ─────────
  /**
   * 손패 한 장 내기.
   * opts.target: 바닥에 같은 달이 두 장일 때 먹을 패
   * opts.shake: 흔들기 (같은 달 3장을 들고 있고 바닥에 없을 때)
   * opts.bomb: 폭탄 (같은 달 3장을 들고 있고 바닥에 1장일 때 3장을 한꺼번에)
   */
  play(id, cardId, opts = {}) {
    if (this.phase !== 'play') return { error: '지금은 패를 낼 수 없어요' };
    if (this.turn !== id) return { error: '내 차례가 아니에요' };
    const hand = this.hands.get(id);
    if (!hand.includes(cardId)) return { error: '손에 없는 패예요' };
    if (isJoker(cardId)) return this.playJoker(id, cardId);
    const m = monthOf(cardId);
    const sameInHand = hand.filter((c) => monthOf(c) === m);
    const fm = this.floorOf(m);
    const ev = { pid: id, played: [cardId], flipped: null, took: [], specials: [], steal: 0 };

    if (opts.bomb) {
      if (sameInHand.length !== 3 || fm.length !== 1) return { error: '폭탄은 같은 달 3장을 들고 바닥에 한 장 있을 때만 돼요' };
      for (const c of sameInHand) hand.splice(hand.indexOf(c), 1);
      ev.played = sameInHand;
      this.floor = this.floor.filter((c) => c !== fm[0]);
      this.take(id, [...sameInHand, fm[0]], ev);
      ev.specials.push('bomb');
      ev.steal++;
      this.shakes.set(id, this.shakes.get(id) + 1);
      this.skips.set(id, this.skips.get(id) + 2);
      this.room.sound('bomb', { pid: id, month: m });
      return this.afterPlay(id, { kind: 'none', month: m }, ev);
    }
    if (opts.shake) {
      if (sameInHand.length !== 3 || fm.length !== 0) return { error: '흔들기는 같은 달 3장을 들고 바닥에 없을 때만 돼요' };
      this.shakes.set(id, this.shakes.get(id) + 1);
      ev.specials.push('shake');
      ev.shook = sameInHand;
      this.room.sound('shake', { pid: id, cards: sameInHand });
    }
    let target = null;
    if (fm.length === 2) {
      target = opts.target;
      if (!fm.includes(target)) {
        if (sameValue(fm[0], fm[1])) target = fm[0];
        else return { error: '바닥에서 먹을 패를 골라 주세요', choose: fm };
      }
    }
    hand.splice(hand.indexOf(cardId), 1);
    this.room.sound('slap', { pid: id });
    // 낸 패의 상태: none(바닥에 놓임) / pair(1장과 짝) / pick(2장 중 골라 짝) / all(3장 다 먹음)
    let played;
    if (fm.length === 0) played = { kind: 'none', card: cardId, month: m };
    else if (fm.length === 1) played = { kind: 'pair', card: cardId, with: fm[0], month: m };
    else if (fm.length === 2) played = { kind: 'pick', card: cardId, with: target, other: fm.find((c) => c !== target), month: m };
    else played = { kind: 'all', card: cardId, with: fm, month: m };
    this.floor.push(cardId);
    return this.afterPlay(id, played, ev);
  }

  /** 조커를 내면 바로 먹고, 더미에서 한 장을 손으로 가져와 이어서 친다 */
  playJoker(id, cardId) {
    const hand = this.hands.get(id);
    hand.splice(hand.indexOf(cardId), 1);
    const ev = { pid: id, played: [cardId], flipped: null, took: [], specials: ['joker'], steal: 0, drew: false };
    this.take(id, [cardId], ev);
    if (this.deck.length) {
      hand.push(this.deck.pop());
      hand.sort((a, b) => monthOf(a) - monthOf(b) || a.localeCompare(b));
      ev.drew = true;
    }
    this.last = ev;
    this.room.say(`${this.name(id)}님 조커! 보너스 피를 먹고 한 장 더 받아요.`);
    // 손패가 남았으면 같은 사람이 이어서 낸다
    if (hand.length || this.skips.get(id) > 0) {
      this.room.sound('joker', { pid: id });
      this.setTimer();
      return {};
    }
    return this.endTurn(id, ev);
  }

  /** 폭탄 뒤 손패 없이 뒤집기만 */
  flipOnly(id) {
    if (this.phase !== 'play') return { error: '지금은 뒤집을 수 없어요' };
    if (this.turn !== id) return { error: '내 차례가 아니에요' };
    if (this.skips.get(id) <= 0 && this.hands.get(id).length) return { error: '손패를 내 주세요' };
    if (this.skips.get(id) > 0) this.skips.set(id, this.skips.get(id) - 1);
    return this.afterPlay(id, { kind: 'none', month: 0 }, { pid: id, played: [], flipped: null, took: [], specials: [], steal: 0 });
  }

  afterPlay(id, played, ev) {
    this.turnNo++;
    let flip = this.deck.length ? this.deck.pop() : null;
    // 뒤집은 패가 조커면 먹고 한 장 더 뒤집는다
    while (flip && isJoker(flip)) {
      this.take(id, [flip], ev);
      ev.specials.push('joker');
      flip = this.deck.length ? this.deck.pop() : null;
    }
    ev.flipped = flip;
    const fmonth = flip ? monthOf(flip) : -1;
    if (flip) this.room.sound('turnover');

    if (flip && fmonth === played.month && played.kind !== 'all') {
      // 낸 패와 뒤집은 패가 같은 달
      if (played.kind === 'none') {
        // 쪽: 낸 패를 바닥에 놓았는데 뒤집은 패가 그걸 먹음
        this.floor = this.floor.filter((c) => c !== played.card);
        this.take(id, [played.card, flip], ev);
        ev.specials.push('jjok');
        ev.steal++;
      } else if (played.kind === 'pair') {
        // 뻑: 세 장이 바닥에 쌓인다
        this.floor.push(flip);
        this.ppeok.set(played.month, id);
        this.ppeokCount.set(id, this.ppeokCount.get(id) + 1);
        ev.specials.push('ppeok');
      } else if (played.kind === 'pick') {
        // 따닥: 바닥 두 장 + 낸 패 + 뒤집은 패 네 장을 다 먹음
        const four = this.floorOf(played.month);
        this.floor = this.floor.filter((c) => monthOf(c) !== played.month);
        this.take(id, [...four, flip], ev);
        ev.specials.push('ttadak');
        ev.steal++;
      }
      return this.endTurn(id, ev);
    }

    // 낸 패 정리
    this.resolveMonth(id, played, ev);
    // 뒤집은 패 정리
    if (flip) {
      const fm = this.floorOf(fmonth);
      if (fm.length === 0) this.floor.push(flip);
      else if (fm.length === 1) {
        this.floor = this.floor.filter((c) => c !== fm[0]);
        this.take(id, [fm[0], flip], ev);
      } else if (fm.length === 2) {
        if (sameValue(fm[0], fm[1])) {
          this.floor = this.floor.filter((c) => c !== fm[0]);
          this.take(id, [fm[0], flip], ev);
        } else {
          // 바닥 두 장 중 고르기
          this.pending = { flip, options: fm, ev };
          this.phase = 'chooseFlip';
          this.last = ev;
          this.setTimer();
          this.room.changed();
          return {};
        }
      } else {
        this.floor = this.floor.filter((c) => monthOf(c) !== fmonth);
        this.take(id, [...fm, flip], ev);
        this.ppeokSteal(id, fmonth, ev);
      }
    }
    return this.endTurn(id, ev);
  }

  /** 낸 패를 바닥과 맞춰 먹는다 (뒤집은 패와 다른 달일 때) */
  resolveMonth(id, played, ev) {
    if (played.kind === 'pair') {
      this.floor = this.floor.filter((c) => c !== played.card && c !== played.with);
      this.take(id, [played.with, played.card], ev);
    } else if (played.kind === 'pick') {
      this.floor = this.floor.filter((c) => c !== played.card && c !== played.with);
      this.take(id, [played.with, played.card], ev);
    } else if (played.kind === 'all') {
      this.floor = this.floor.filter((c) => monthOf(c) !== played.month);
      this.take(id, [...played.with, played.card], ev);
      this.ppeokSteal(id, played.month, ev);
    }
  }

  /** 쌓인 뻑을 먹으면 피를 뺏는다 (내가 싼 뻑이면 자뻑: 두 장) */
  ppeokSteal(id, month, ev) {
    if (!this.ppeok.has(month)) return;
    const by = this.ppeok.get(month);
    this.ppeok.delete(month);
    ev.specials.push(by === id ? 'jappeok' : 'ppeokTake');
    ev.steal += by === id ? 2 : 1;
  }

  chooseFlip(id, target) {
    if (this.phase !== 'chooseFlip') return { error: '지금은 고를 수 없어요' };
    if (this.turn !== id) return { error: '내 차례가 아니에요' };
    const { flip, options, ev } = this.pending;
    if (!options.includes(target)) return { error: '보기 중에서 골라 주세요' };
    this.pending = null;
    this.phase = 'play';
    this.floor = this.floor.filter((c) => c !== target);
    this.take(id, [target, flip], ev);
    return this.endTurn(id, ev);
  }

  take(id, ids, ev) {
    this.captured.get(id).push(...ids);
    ev.took.push(...ids);
  }

  /** 상대마다 피 n장 뺏기 (보통 피 먼저, 없으면 쌍피) */
  stealPi(id, n, ev) {
    ev.stolen = [];
    for (const other of this.order) {
      if (other === id) continue;
      for (let k = 0; k < n; k++) {
        const cap = this.captured.get(other);
        const pick = cap.find((c) => card(c).kind === 'pi') ?? cap.find((c) => card(c).kind === 'ssangpi' || isJoker(c));
        if (!pick) break;
        cap.splice(cap.indexOf(pick), 1);
        this.captured.get(id).push(pick);
        ev.stolen.push({ from: other, card: pick });
      }
    }
  }

  endTurn(id, ev) {
    // 싹쓸이: 바닥을 다 쓸면 (마지막 차례 제외)
    const lastTurn = this.isLastTurn();
    if (this.floor.length === 0 && ev.took.length && !lastTurn) {
      ev.specials.push('sseul');
      ev.steal++;
    }
    if (ev.steal) this.stealPi(id, ev.steal, ev);
    this.last = ev;
    const words = { joker: '조커!', jjok: '쪽!', ppeok: '뻑!', ttadak: '따닥!', sseul: '싹쓸이!', bomb: '폭탄!', shake: '흔들었어요!', jappeok: '자뻑!', ppeokTake: '뻑 먹었다!' };
    const said = ev.specials.map((s) => words[s]).filter(Boolean);
    for (const s of ev.specials) if (s !== 'joker' || ev.played.length) this.room.sound(s, { pid: id });
    if (ev.took.length) this.room.sound('take', { pid: id, n: ev.took.length });
    if (ev.stolen?.length) this.room.sound('steal', { pid: id, n: ev.stolen.length });
    // 3뻑이면 바로 승리
    if (this.ppeokCount.get(id) >= 3) {
      this.room.say(`${this.name(id)}님 3뻑! 바로 이겼어요.`);
      return this.finish(id, { threePpeok: true });
    }
    const sc = this.score(id).total;
    if (sc >= this.rule.win && sc > this.lastGoScore.get(id)) {
      if (lastTurn) {
        this.room.say(`${said.length ? `${said.join(' ')} ` : ''}${this.name(id)}님 ${sc}점, 마지막 패라 스톱!`);
        return this.finish(id);
      }
      this.phase = 'goStop';
      this.room.say(`${said.length ? `${said.join(' ')} ` : ''}${this.name(id)}님 ${sc}점! 고? 스톱?`);
      this.setTimer();
      this.room.changed();
      return {};
    }
    if (said.length) this.room.say(`${this.name(id)}님 ${said.join(' ')}${ev.stolen?.length ? ` 피 ${ev.stolen.length}장 뺏기` : ''}`);
    else this.room.say(`${this.name(this.order[(this.turnIdx + 1) % this.order.length])}님 차례예요.`);
    return this.nextTurn();
  }

  /** 모두 손패·뒤집기 차례가 남지 않았는가 */
  isLastTurn() {
    return this.order.every((p) => this.hands.get(p).length === 0 && this.skips.get(p) === 0) || this.deck.length === 0;
  }

  nextTurn() {
    if (this.isLastTurn()) return this.nagariEnd();
    for (let k = 1; k <= this.order.length; k++) {
      const idx = (this.turnIdx + k) % this.order.length;
      const p = this.order[idx];
      if (this.hands.get(p).length || this.skips.get(p) > 0) {
        this.turnIdx = idx;
        this.phase = 'play';
        this.setTimer();
        this.room.changed();
        return {};
      }
    }
    return this.nagariEnd();
  }

  decide(id, choice, timeout = false) {
    if (this.phase !== 'goStop') return { error: '지금은 고/스톱을 고를 때가 아니에요' };
    if (this.turn !== id) return { error: '내 차례가 아니에요' };
    if (choice === 'go') {
      const n = this.goCount.get(id) + 1;
      this.goCount.set(id, n);
      this.lastGoScore.set(id, this.score(id).total);
      this.room.say(`${this.name(id)}님 ${n}고!${n >= 3 ? ` 이제 ${2 ** (n - 2)}배!` : ''}`);
      this.room.sound('go', { pid: id, n });
      return this.nextTurn();
    }
    if (choice !== 'stop') return { error: '고 또는 스톱을 골라 주세요' };
    this.room.sound('stop', { pid: id });
    this.room.say(`${this.name(id)}님 ${timeout ? '시간 초과로 ' : ''}스톱!`);
    return this.finish(id);
  }

  nagariEnd() {
    this.room.clearTimer();
    this.phase = 'result';
    this.result = { nagari: true, winner: null, payments: [], nextNagari: this.nagari * 2 };
    this.room.say(`나가리! 아무도 나지 못했어요. 다음 판은 ${this.nagari * 2}배로 갑니다.`);
    this.room.sound('nagari');
    return this.room.gameOver(this);
  }

  /** 승자 정산 */
  finish(winner, { chongtong = null, threePpeok = false } = {}) {
    this.room.clearTimer();
    this.phase = 'result';
    this.pending = null;
    const sc = this.score(winner);
    const go = this.goCount.get(winner);
    const base = chongtong || threePpeok ? Math.max(10, sc.total) : sc.total;
    const goMul = go >= 3 ? 2 ** (go - 2) : 1;
    const shakeMul = 2 ** this.shakes.get(winner);
    const points = (base + go) * goMul * shakeMul * this.nagari;
    const unit = this.room.settings.pointChips;
    const losers = this.order.filter((id) => id !== winner);
    const bills = losers.map((id) => {
      const cs = this.captured.get(id).map(card);
      const tags = [];
      let mul = 1;
      if (!chongtong && !threePpeok) {
        const pi = loserPi(this.captured.get(id));
        if (sc.piScore && pi > 0 && pi <= 7) {
          mul *= 2;
          tags.push('피박');
        }
        if (sc.gwangScore && !cs.some((c) => c.kind === 'gwang')) {
          mul *= 2;
          tags.push('광박');
        }
        if (sc.yeol >= 7) {
          mul *= 2;
          tags.push('멍박');
        }
      }
      return { id, points: points * mul, tags };
    });
    // 3인: 고를 부르고 진 사람이 있으면 그 사람이 혼자 다 낸다 (고박)
    const goBak = losers.length > 1 ? losers.find((id) => this.goCount.get(id) > 0) : null;
    if (goBak) {
      const total = bills.reduce((s, b) => s + b.points, 0);
      for (const b of bills) {
        if (b.id === goBak) {
          b.points = total;
          b.tags.push('고박');
        } else b.points = 0;
      }
    }
    const payments = [];
    for (const b of bills) {
      const p = this.room.player(b.id);
      const want = b.points * unit;
      const paid = Math.min(want, p?.chips ?? 0);
      if (p) p.chips -= paid;
      const w = this.room.player(winner);
      if (w) w.chips += paid;
      payments.push({ from: b.id, points: b.points, chips: paid, want, tags: b.tags });
    }
    this.result = {
      nagari: false,
      winner,
      score: sc,
      go,
      goMul,
      shakeMul,
      nagariMul: this.nagari,
      points,
      payments,
      chongtong,
      threePpeok,
      nextNagari: 1,
    };
    const total = payments.reduce((s, x) => s + x.chips, 0);
    this.room.say(`${this.name(winner)}님 승리! ${points}점${payments.some((x) => x.tags.length) ? ` (${[...new Set(payments.flatMap((x) => x.tags))].join('·')})` : ''} · ${total.toLocaleString('ko-KR')}칩 획득`);
    this.room.sound('win', { pid: winner });
    return this.room.gameOver(this);
  }

  /**
   * 판 도중에 나가면 기권패: 남은 사람 중 점수가 가장 높은 사람이 이기고, 나간 사람만 낸다.
   * (나간 사람 칩은 아직 방에 남아 있을 때 정산한다)
   */
  remove(id) {
    if (this.phase === 'result' || !this.order.includes(id)) return;
    this.room.clearTimer();
    this.phase = 'result';
    this.pending = null;
    const others = this.order.filter((x) => x !== id);
    const winner = others.reduce((best, x) => (this.score(x).total > this.score(best).total ? x : best), others[0]);
    const sc = this.score(winner);
    const points = Math.max(sc.total, this.rule.win) * this.nagari;
    const unit = this.room.settings.pointChips;
    const p = this.room.player(id);
    const want = points * unit;
    const paid = Math.min(want, p?.chips ?? 0);
    if (p) p.chips -= paid;
    const w = this.room.player(winner);
    if (w) w.chips += paid;
    this.result = {
      nagari: false,
      forfeit: id,
      winner,
      score: sc,
      go: this.goCount.get(winner),
      goMul: 1,
      shakeMul: 1,
      nagariMul: this.nagari,
      points,
      payments: [{ from: id, points, chips: paid, want, tags: ['기권'] }],
      nextNagari: 1,
    };
    this.room.say(`${this.name(id)}님이 나가서 기권패! ${this.name(winner)}님이 ${paid.toLocaleString('ko-KR')}칩을 받아요.`);
    this.room.sound('win', { pid: winner });
    this.room.gameOver(this);
  }

  view(me) {
    const done = this.phase === 'result';
    const mine = this.order.includes(me);
    const scores = Object.fromEntries(this.order.map((id) => [id, this.score(id)]));
    const hand = mine ? this.hands.get(me) : null;
    // 내가 낼 수 있는 패마다 바닥 짝, 흔들기·폭탄 가능 여부
    let playable = null;
    if (mine && this.turn === me && this.phase === 'play') {
      playable = Object.fromEntries(
        hand.map((c) => {
          if (isJoker(c)) return [c, { matches: [], choose: false, shake: false, bomb: false, joker: true }];
          const m = monthOf(c);
          const fm = this.floorOf(m);
          const same = hand.filter((x) => monthOf(x) === m).length;
          return [c, { matches: fm, choose: fm.length === 2 && !sameValue(fm[0], fm[1]), shake: same === 3 && fm.length === 0, bomb: same === 3 && fm.length === 1 }];
        }),
      );
    }
    return {
      kind: 'gostop',
      phase: this.phase,
      order: this.order,
      turn: this.turn,
      rule: this.rule,
      nagari: this.nagari,
      sale: this.sale,
      deckCount: this.deck.length,
      floor: this.floor,
      ppeok: [...this.ppeok.keys()],
      myHand: hand,
      playable,
      canFlipOnly: mine && this.turn === me && this.phase === 'play' && this.skips.get(me) > 0,
      // 결과 화면에서는 남은 손패도 공개
      hands: Object.fromEntries(this.order.map((id) => [id, id === me || done ? this.hands.get(id) : this.hands.get(id).length])),
      captured: Object.fromEntries(this.captured),
      scores,
      goCount: Object.fromEntries(this.goCount),
      shakes: Object.fromEntries(this.shakes),
      skips: Object.fromEntries(this.skips),
      ppeokCount: Object.fromEntries(this.ppeokCount),
      pending: this.phase === 'chooseFlip' && this.turn === me ? { flip: this.pending.flip, options: this.pending.options } : this.phase === 'chooseFlip' ? { flip: this.pending.flip } : null,
      last: this.last,
      turnNo: this.turnNo,
      result: done ? this.result : null,
    };
  }
}
