import { randomBytes } from 'node:crypto';
import { newDeck, bestHand, compareScore, handDetail } from './cards.js';

export const DEFAULTS = {
  maxPlayers: 9,
  startChips: 1000,
  bigBlind: 20,
  turnSec: 30, // 자기 차례 제한 시간
  mode: 'cash', // cash: 칩 다시 받기 가능 / tournament: 블라인드가 오르고 마지막 1명이 우승
  blindUpHands: 8, // 토너먼트에서 몇 판마다 블라인드가 오르는지 (0이면 오르지 않음: 시작 칩을 다 쓰면 탈락만)
  awayTurnMs: 5_000, // 접속이 끊긴 사람 차례
  streetPauseMs: 900, // 스트리트 사이 잠깐 멈춤 (칩 모으는 연출 시간)
  runoutStepMs: 1_600, // 올인 후 보드 한 장씩 열기
  nextHandMs: 7_000, // 결과 보여 준 뒤 다음 판
};

/** 방장이 바꿀 수 있는 설정과 허용 범위 */
export const SETTING_LIMITS = {
  startChips: [100, 1_000_000],
  bigBlind: [2, 100_000],
  turnSec: [10, 120],
  blindUpHands: [0, 50], // 0 = 상승 없음, 그 외에는 2판 이상
};

/** 토너먼트 블라인드 단계 (빅블라인드 20 기준, 시작 빅블라인드에 맞춰 배율 적용) */
const BLIND_LEVELS = [
  [10, 20], [15, 30], [25, 50], [40, 80], [50, 100], [75, 150], [100, 200], [150, 300],
  [200, 400], [300, 600], [400, 800], [500, 1000], [750, 1500], [1000, 2000], [1500, 3000], [2000, 4000],
  [3000, 6000], [5000, 10000],
];

export const REACTIONS = ['👍', '👏', '😂', '😮', '😭', '😎', '🤔', '🔥'];

const ACTION_LABEL = { fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인' };

function newId() {
  return randomBytes(6).toString('hex');
}

const clampInt = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v))));

/**
 * 방 하나 = 테이블 하나. 딜러(NPC)는 이 클래스의 진행 로직이다.
 * 카드 정보는 viewFor() 에서만 밖으로 나가며, 다른 사람의 홀카드는 공개 전까지 절대 포함하지 않는다.
 */
export class Room {
  constructor(code, { onChange = () => {}, schedule, now = () => Date.now(), options = {} } = {}) {
    this.code = code;
    this.opt = { ...DEFAULTS, ...options };
    this.settings = {
      startChips: this.opt.startChips,
      bigBlind: this.opt.bigBlind,
      turnSec: this.opt.turnSec,
      mode: this.opt.mode,
      blindUpHands: this.opt.blindUpHands,
    };
    this.blinds = [Math.floor(this.settings.bigBlind / 2), this.settings.bigBlind];
    this.onChange = onChange;
    this.now = now;
    // 테스트에서 시간을 직접 돌릴 수 있게 타이머를 주입 받는다
    this.schedule =
      schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.players = []; // { id, token, name, chips, bought, connected, socketId, rebuys, leaving, seatNo, stats, place }
    this.seatCounter = 0;
    this.departed = new Map(); // token → 나간 사람 정보 : 같은 탭으로 다시 들어올 때 이어 받기
    this.hostId = null;
    this.running = false;
    this.hand = null;
    this.handNo = 0;
    this.lastButtonSeatNo = null;
    this.log = [];
    this.dealerLine = '어서 오세요. 2명 이상 모이면 방장이 게임을 시작할 수 있어요.';
    this.turnCancel = null;
    this.flowCancel = null;
    this.lastActive = this.now();
    // 토너먼트 진행 상황
    this.tourney = { active: false, hands: 0, level: 0, winnerId: null, winnerName: null, places: [] };
    // 채팅·이모지·효과음용 이벤트·판 기록
    this.chat = [];
    this.reactions = [];
    this.events = [];
    this.seq = 0;
    this.history = [];
    this.lastChatAt = new Map();
  }

  // ───────── 공통 ─────────

  say(text, { log = true } = {}) {
    this.dealerLine = text;
    if (log) {
      this.log.push(text);
      if (this.log.length > 60) this.log.shift();
    }
  }

  /** 화면 연출·효과음용 이벤트. 카드 정보는 절대 넣지 않는다 */
  emit(type, data = {}) {
    // data 의 키가 type 을 덮어쓰지 않도록 type 을 마지막에 둔다
    this.events.push({ ...data, seq: ++this.seq, type });
    if (this.events.length > 40) this.events.shift();
  }

  changed() {
    this.lastActive = this.now();
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

  handLive() {
    return !!this.hand && this.hand.street !== 'done';
  }

  // ───────── 입장·퇴장 ─────────

  join({ token, name, socketId }) {
    let p = this.players.find((x) => x.token === token);
    if (p) {
      const wasAway = !p.connected;
      this.cancelDrop(p);
      p.socketId = socketId;
      p.connected = true;
      // 토너먼트에서 기권한 뒤(아직 판이 안 끝나 자리에 남아 있을 때) 돌아오면 구경만
      if (p.leaving && this.tourney.active && p.place != null) p.spectator = true;
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
        if (x.connected || (this.seatOf(x.id) && this.handLive())) continue;
        // 토너먼트에서 칩을 가진 사람은 끊겨도 아직 대회 참가자라 비우지 않는다
        if (this.tourney.active && x.chips > 0) continue;
        this.stash(x);
        this.removePlayer(x.id);
        if (this.players.length < this.opt.maxPlayers) break;
      }
    }
    if (this.players.length >= this.opt.maxPlayers) return { error: `방이 가득 찼어요 (최대 ${this.opt.maxPlayers}명)` };
    // 나갔다가 같은 탭으로 다시 들어오면 칩·기록을 이어 받는다 (나갔다 들어와 칩을 새로 받는 것 방지)
    const back = this.departed.get(token);
    this.departed.delete(token);
    const base = (name || '').trim().slice(0, 12) || `플레이어${this.seatCounter + 1}`;
    let finalName = base;
    for (let i = 2; this.players.some((x) => x.name === finalName); i++) finalName = `${base}${i}`;
    // 토너먼트가 진행 중이면 새로 온 사람, 이번 대회에서 기권한 사람은 구경만 (칩 0).
    // (departed 는 토너먼트 시작 때 비우므로, 여기서 back 은 이번 대회에서 나간 사람뿐이다)
    const lateToTourney = this.tourney.active && (!back || back.chips === 0);
    p = {
      id: newId(),
      token,
      name: finalName,
      chips: lateToTourney ? 0 : back ? back.chips : this.settings.startChips,
      bought: lateToTourney ? back?.bought ?? 0 : back ? back.bought : this.settings.startChips,
      connected: true,
      socketId,
      rebuys: back ? back.rebuys : 0,
      leaving: false,
      seatNo: this.seatCounter++,
      stats: back ? back.stats : { hands: 0, wins: 0, biggestPot: 0 },
      place: back ? back.place : null,
      spectator: lateToTourney,
    };
    this.players.push(p);
    if (!this.hostConnected()) this.hostId = p.id;
    const note = lateToTourney ? ' 토너먼트가 진행 중이라 이번엔 구경할게요.' : this.handLive() ? ' 다음 판부터 참여해요.' : '';
    this.say(`${p.name}님이 들어왔어요.${note}`);
    this.emit('join', { pid: p.id });
    this.changed();
    return { player: p };
  }

  stash(p) {
    this.departed.set(p.token, { chips: p.chips, bought: p.bought, rebuys: p.rebuys, stats: p.stats, place: p.place });
  }

/** 끊긴 사람은 잠깐(새로고침 등) 기다렸다가 돌아오지 않으면 자리에서 뺀다 */
  scheduleDrop(p) {
    this.dropTimers ??= new Map();
    this.dropTimers.get(p.id)?.();
    const id = p.id;
    this.dropTimers.set(
      id,
      this.schedule(() => {
        this.dropTimers.delete(id);
        const x = this.player(id);
        if (x && !x.connected) {
          this.leave(id);
          this.changed();
        }
      }, this.opt.dropMs ?? 20_000),
    );
  }
  cancelDrop(p) {
    this.dropTimers?.get(p.id)?.();
    this.dropTimers?.delete(p.id);
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
    this.say(`${p.name}님의 접속이 끊겼어요. 20초 안에 돌아오지 않으면 자리에서 빠져요.`);
    if (this.hostId === p.id) this.pickNewHost();
    this.rescheduleTurnIfNeeded(p.id);
    this.scheduleDrop(p);
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
    // 토너먼트 중에 나가면 기권: 남은 칩은 몰수하고, 지금 남은 인원 기준으로 순위를 준다.
    // (폴드로 판이 끝나며 우승 판정이 먼저 일어날 수 있으므로 폴드 처리보다 앞에서 한다)
    if (this.tourney.active && p.place == null && !p.spectator && (p.chips > 0 || seat)) {
      p.place = this.tourneyAlive().length + 1;
      p.chips = 0;
      this.tourney.places.push({ id: p.id, name: p.name, place: p.place });
      this.say(`${p.name}님이 기권해서 ${p.place}위가 됐어요.`);
    }
    if (seat && this.handLive() && !seat.folded) {
      if (this.currentSeat() === seat) {
        this.doAction(seat, 'fold');
      } else {
        seat.folded = true;
        seat.lastAction = '폴드';
        this.emit('action', { pid: seat.id, action: 'fold', amount: 0 });
        this.afterOutOfTurnFold();
      }
    }
    if (!this.seatOf(playerId) || !this.handLive()) this.removePlayer(playerId);
    if (this.hostId === playerId) this.pickNewHost();
    if (!this.handLive()) this.checkTourneyEnd();
    this.changed();
  }

  removePlayer(id) {
    const p = this.player(id);
    if (p && p.leaving) this.stash(p);
    this.lastChatAt.delete(id);
    this.players = this.players.filter((x) => x.id !== id);
  }

  /** 토너먼트에서 아직 살아 있는 사람 (칩 있음, 나가지 않음, 순위 없음) */
  tourneyAlive() {
    return this.players.filter((p) => p.chips > 0 && !p.leaving && p.place == null);
  }

  /** 살아 있는 사람이 1명 이하면 우승을 확정한다. 판이 진행 중이면 판이 끝난 뒤(endHand)에 다시 확인한다 */
  checkTourneyEnd() {
    if (!this.tourney.active || this.handLive()) return false;
    const alive = this.tourneyAlive();
    if (alive.length > 1) return false;
    const champ = alive[0] ?? null;
    if (champ) {
      champ.place = 1;
      this.tourney.places.push({ id: champ.id, name: champ.name, place: 1 });
    }
    this.tourney.active = false;
    this.tourney.winnerId = champ?.id ?? null;
    this.tourney.winnerName = champ?.name ?? null;
    this.running = false;
    this.clearFlowTimer();
    // 끝난 뒤에는 방 설정의 블라인드로 돌려 놓는다 (마지막 레벨이 남지 않게)
    this.blinds = [Math.floor(this.settings.bigBlind / 2), this.settings.bigBlind];
    this.say(champ ? `🏆 토너먼트 우승은 ${champ.name}님! 축하합니다!` : '토너먼트가 끝났어요.');
    this.emit('tourneyEnd', { winnerId: champ?.id ?? null });
    return true;
  }

  rebuy(playerId) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (this.settings.mode === 'tournament') return { error: '토너먼트에서는 칩을 다시 받을 수 없어요' };
    if (p.chips > 0) return { error: '칩이 남아 있을 때는 다시 받을 수 없어요' };
    const seat = this.seatOf(playerId);
    if (seat && this.handLive()) return { error: '이번 판이 끝난 뒤에 받을 수 있어요' };
    p.chips = this.settings.startChips;
    p.bought += this.settings.startChips;
    p.rebuys++;
    p.spectator = false;
    this.say(`${p.name}님이 칩 ${this.settings.startChips.toLocaleString('ko-KR')}개를 다시 받았어요.`);
    this.emit('rebuy', { pid: p.id });
    this.changed();
    return {};
  }

  // ───────── 채팅·이모지 ─────────

  sendChat(playerId, text) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    // 이모지 같은 서로게이트 쌍이 반으로 잘리지 않게 글자 단위로 자른다
    const clean = typeof text === 'string' ? Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 100).join('') : '';
    if (!clean) return { error: '메시지가 비어 있어요' };
    const now = this.now();
    if (now - (this.lastChatAt.get(playerId) ?? -Infinity) < 600) return { error: '조금 천천히 보내 주세요' };
    this.lastChatAt.set(playerId, now);
    this.chat.push({ id: ++this.seq, pid: p.id, name: p.name, text: clean, at: now });
    if (this.chat.length > 50) this.chat.shift();
    this.changed();
    return {};
  }

  react(playerId, emoji) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (!REACTIONS.includes(emoji)) return { error: '쓸 수 없는 이모지예요' };
    const now = this.now();
    if (now - (this.lastChatAt.get(playerId) ?? -Infinity) < 600) return { error: '조금 천천히 보내 주세요' };
    this.lastChatAt.set(playerId, now);
    this.reactions.push({ id: ++this.seq, pid: p.id, emoji, at: now });
    if (this.reactions.length > 20) this.reactions.shift();
    this.changed();
    return {};
  }

  // ───────── 방장 조작 ─────────

  updateSettings(playerId, patch = {}) {
    if (playerId !== this.hostId) return { error: '방장만 설정을 바꿀 수 있어요' };
    if (this.handLive()) return { error: '판이 끝난 뒤에 바꿀 수 있어요' };
    if (this.tourney.active) return { error: '토너먼트 중에는 설정을 바꿀 수 없어요' };
    const s = { ...this.settings };
    for (const k of Object.keys(SETTING_LIMITS)) {
      if (patch[k] === undefined) continue;
      const v = Number(patch[k]);
      if (!Number.isFinite(v)) return { error: '숫자가 올바르지 않아요' };
      s[k] = clampInt(v, SETTING_LIMITS[k]);
      if (k === 'blindUpHands' && s[k] === 1) s[k] = 2;
    }
    if (patch.mode !== undefined) {
      if (patch.mode !== 'cash' && patch.mode !== 'tournament') return { error: '알 수 없는 모드예요' };
      s.mode = patch.mode;
    }
    if (s.mode !== this.settings.mode && this.running) return { error: '게임을 멈춘 뒤에 모드를 바꿀 수 있어요' };
    if (s.bigBlind % 2 === 1 && s.bigBlind > 2) s.bigBlind += 1; // 스몰블라인드가 딱 절반이 되도록 (검사 전에 맞춘다)
    if (s.bigBlind * 10 > s.startChips) return { error: '시작 칩은 빅블라인드의 10배 이상이어야 해요' };
    const startChanged = s.startChips !== this.settings.startChips;
    // 자유 게임으로 돌아가면 지난 토너먼트의 순위·구경 표시를 지운다
    if (s.mode === 'cash' && this.settings.mode === 'tournament') {
      for (const p of this.players) {
        p.place = null;
        p.spectator = false;
      }
      this.tourney = { active: false, hands: 0, level: 0, winnerId: null, winnerName: null, places: [] };
    }
    if (startChanged && this.handNo === 0) this.departed.clear();
    this.settings = s;
    this.blinds = [Math.floor(s.bigBlind / 2), s.bigBlind];
    // 아직 한 판도 안 했으면 모두의 칩을 새 시작 칩으로 맞춘다
    if (startChanged && this.handNo === 0) {
      for (const p of this.players) {
        p.chips = s.startChips;
        p.bought = s.startChips;
      }
    }
    this.say(
      `방 설정이 바뀌었어요: ${s.mode === 'tournament' ? (s.blindUpHands ? `토너먼트(${s.blindUpHands}판마다 블라인드 상승)` : '토너먼트(블라인드 고정, 칩을 다 쓰면 탈락)') : '자유 게임'}, ` +
        `블라인드 ${this.blinds[0]}/${this.blinds[1]}, 시작 칩 ${s.startChips.toLocaleString('ko-KR')}, 제한 시간 ${s.turnSec}초.`,
    );
    this.emit('settings');
    this.changed();
    return {};
  }

  start(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 시작할 수 있어요' };
    if (this.settings.mode === 'tournament' && !this.tourney.active) {
      const ready = this.players.filter((p) => p.connected && !p.leaving);
      if (ready.length < 2) return { error: '접속한 사람이 2명 이상 있어야 해요' };
      if (this.handLive()) return { error: '판이 끝난 뒤에 시작할 수 있어요' };
      this.startTourney();
    }
    if (this.eligible().length < 2) return { error: '칩이 있는 접속자가 2명 이상 있어야 해요' };
    this.running = true;
    if (!this.handLive()) {
      this.clearFlowTimer();
      this.startHand();
    }
    this.changed();
    return {};
  }

  startTourney() {
    const s = this.settings;
    for (const p of [...this.players]) if (p.leaving) this.removePlayer(p.id);
    // 지난 게임에서 나간 사람의 칩·순위를 들고 들어오지 못하게 비운다
    this.departed.clear();
    for (const p of this.players) {
      const inIt = p.connected;
      p.chips = inIt ? s.startChips : 0;
      p.bought = p.chips;
      p.rebuys = 0;
      p.place = null;
      p.spectator = !inIt;
      p.stats = { hands: 0, wins: 0, biggestPot: 0 };
    }
    this.tourney = { active: true, hands: 0, level: 0, winnerId: null, winnerName: null, places: [], entrants: this.players.filter((p) => !p.spectator).length };
    this.blinds = this.levelBlinds(0);
    this.history = [];
    this.say(`토너먼트를 시작합니다! ${this.tourney.entrants}명 참가, 블라인드 ${this.blinds[0]}/${this.blinds[1]}${s.blindUpHands ? `부터 ${s.blindUpHands}판마다 올라가요` : '로 고정이에요'}. 시작 칩을 다 쓰면 탈락이에요.`);
    this.emit('tourneyStart');
  }

  levelBlinds(level) {
    const k = this.settings.bigBlind / 20;
    const [sb, bb] = BLIND_LEVELS[Math.min(level, BLIND_LEVELS.length - 1)];
    const big = Math.max(2, Math.round(bb * k));
    return [Math.max(1, Math.floor(big / 2)), big];
  }

  pause(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 멈출 수 있어요' };
    this.running = false;
    const midHand = this.handLive();
    // 진행 중인 판의 흐름(스트리트 넘김·쇼다운)은 그대로 두고, 다음 판 예약만 취소한다
    if (!midHand) this.clearFlowTimer();
    this.say(midHand ? '이번 판까지만 하고 쉴게요.' : '게임을 멈췄어요.');
    this.changed();
    return {};
  }

  // ───────── 한 판 진행 ─────────

  eligible() {
    // 토너먼트에서는 끊긴 사람도 자리에 앉혀 자동 체크/폴드로 블라인드를 내게 한다 (안 그러면 대회가 끝나지 않는다)
    return this.players.filter((p) => p.chips > 0 && !p.leaving && (p.connected || this.tourney.active));
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
      if (this.checkTourneyEnd()) return;
      this.running = false;
      this.say('칩이 있는 접속자가 2명 이상 있어야 다음 판을 시작할 수 있어요.');
      return;
    }

    // 토너먼트 블라인드 상승
    if (this.tourney.active) {
      const level = this.settings.blindUpHands ? Math.floor(this.tourney.hands / this.settings.blindUpHands) : 0;
      if (level !== this.tourney.level) {
        this.tourney.level = level;
        this.blinds = this.levelBlinds(level);
        this.say(`블라인드가 올라갑니다! 이제 ${this.blinds[0]}/${this.blinds[1]}이에요.`);
        this.emit('blinds', { sb: this.blinds[0], bb: this.blinds[1] });
      }
      this.tourney.hands++;
    }

    const [smallBlind, bigBlind] = this.blinds;
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
        startChips: p.chips,
        folded: false,
        allIn: false,
        acted: false,
        lastAction: null,
      })),
      buttonIdx,
      sbIdx,
      bbIdx,
      blinds: [smallBlind, bigBlind],
      currentBet: 0,
      minRaise: bigBlind,
      toActIdx: -1,
      turnEndsAt: 0,
      turnMs: 0,
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
    this.emit('deal', { handNo: h.no, order: [...h.seats.slice(sbIdx), ...h.seats.slice(0, sbIdx)].map((s) => s.id) });
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
    const ms = s.p.connected ? this.settings.turnSec * 1000 : this.opt.awayTurnMs;
    h.turnEndsAt = this.now() + ms;
    h.turnMs = ms;
    const toCall = h.currentBet - s.bet;
    this.say(`${s.p.name}님 차례입니다.${toCall > 0 ? ` (콜 ${Math.min(toCall, s.p.chips).toLocaleString('ko-KR')})` : ''}`, { log: false });
    this.emit('turn', { pid: s.id });
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
      bigBlind: h.blinds[1],
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
    const fmt = (n) => n.toLocaleString('ko-KR');

    if (type === 'allin') {
      if (seat.p.chips <= o.toCall || !o.canRaise) type = 'call';
      else {
        type = 'raise';
        amount = o.maxTo;
      }
    }

    let evAction = type;
    let evAmount = 0;
    switch (type) {
      case 'fold':
        seat.folded = true;
        seat.lastAction = '폴드';
        this.say(`${name}님 폴드.`);
        break;
      case 'check':
        if (!o.canCheck) return { error: `체크할 수 없어요. 콜하려면 ${fmt(o.toCall)}이 필요해요` };
        seat.lastAction = '체크';
        this.say(`${name}님 체크.`);
        break;
      case 'call': {
        if (!o.canCall) return { error: '콜할 금액이 없어요. 체크하세요' };
        this.commit(seat, o.toCall);
        evAmount = o.toCall;
        if (seat.allIn) evAction = 'allin';
        seat.lastAction = seat.allIn ? `올인 ${fmt(seat.bet)}` : `콜 ${fmt(seat.bet)}`;
        this.say(`${name}님 ${seat.allIn ? '올인' : '콜'} (${fmt(o.toCall)}).`);
        break;
      }
      case 'bet':
      case 'raise': {
        if (!o.canRaise) return { error: '지금은 레이즈할 수 없어요' };
        let to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) return { error: '금액이 올바르지 않아요' };
        if (to > o.maxTo) to = o.maxTo;
        if (to <= h.currentBet) return { error: `현재 베팅(${fmt(h.currentBet)})보다 많이 걸어야 해요` };
        if (to < o.minTo && to !== o.maxTo) return { error: `최소 ${fmt(o.minTo)}까지 걸어야 해요` };
        const raiseBy = to - h.currentBet;
        const wasBet = h.currentBet === 0;
        evAmount = to - seat.bet;
        this.commit(seat, to - seat.bet);
        if (raiseBy >= h.minRaise) {
          h.minRaise = raiseBy;
          for (const s of h.seats) if (s !== seat) s.acted = false;
        }
        h.currentBet = to;
        evAction = seat.allIn ? 'allin' : wasBet ? 'bet' : 'raise';
        seat.lastAction = seat.allIn ? `올인 ${fmt(to)}` : `${wasBet ? '벳' : '레이즈'} ${fmt(to)}`;
        this.say(`${name}님 ${seat.allIn ? '올인' : wasBet ? '벳' : '레이즈'} ${fmt(to)}.`);
        break;
      }
      default:
        return { error: '알 수 없는 행동이에요' };
    }
    seat.acted = true;
    this.emit('action', { pid: seat.id, action: evAction, amount: evAmount });
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
    const hadBets = h.seats.some((s) => s.bet > 0);
    for (const s of h.seats) {
      s.bet = 0;
      s.acted = false;
    }
    h.currentBet = 0;
    h.minRaise = h.blinds[1];
    if (hadBets) this.emit('collect');

    if (h.street === 'river') {
      this.later(this.opt.streetPauseMs, () => this.showdown());
      return;
    }
    if (this.canActSeats().length <= 1) {
      // 더 베팅할 사람이 없으면 패를 공개하고 보드를 끝까지 연다
      for (const s of this.alive()) h.revealed.add(s.id);
      this.say('더 베팅할 수 없어요. 패를 공개하고 남은 카드를 엽니다.');
      this.emit('reveal');
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
    this.emit('street', { street: h.street });
  }

  finishByFold(winner) {
    const h = this.hand;
    const pot = h.seats.reduce((a, s) => a + s.total, 0);
    winner.p.chips += pot;
    h.results = {
      type: 'fold',
      pots: [{ amount: pot, winners: [winner.id] }],
      payouts: { [winner.id]: pot },
      returns: {},
      hands: {},
    };
    this.say(`모두 폴드해서 ${winner.p.name}님이 ${pot.toLocaleString('ko-KR')}을 가져갑니다.`);
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
    const returns = {}; // 아무도 받지 않은 베팅(혼자만 걸린 팟)은 '이긴 것'이 아니라 돌려받은 것
    const potResults = [];
    for (const pot of pots) {
      if (pot.eligible.length === 1) {
        const only = pot.eligible[0];
        only.p.chips += pot.amount;
        returns[only.id] = (returns[only.id] || 0) + pot.amount;
        potResults.push({ amount: pot.amount, winners: [only.id], returned: true });
        continue;
      }
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
    for (const [id, b] of best) hands[id] = { name: b.name, detail: handDetail(b.score), cards: b.cards };
    h.results = { type: 'showdown', pots: potResults, payouts, returns, hands };

    const msg = Object.entries(payouts)
      .map(([id, amt]) => `${this.player(id)?.name ?? '?'}님 ${hands[id].detail}로 ${amt.toLocaleString('ko-KR')}`)
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
    for (const s of h.seats) s.bet = 0;

    // 통계
    const r = h.results;
    for (const s of h.seats) s.p.stats.hands++;
    for (const [id, amt] of Object.entries(r.payouts)) {
      const p = this.player(id);
      if (!p) continue;
      p.stats.wins++;
      p.stats.biggestPot = Math.max(p.stats.biggestPot, amt);
    }
    this.emit('win', { payouts: r.payouts, returns: r.returns ?? {}, kind: r.type });

    // 판 기록 (공개된 정보만)
    this.history.unshift({
      no: h.no,
      board: h.board,
      blinds: h.blinds,
      pot: h.seats.reduce((a, s) => a + s.total, 0),
      type: r.type,
      winners: Object.entries(r.payouts).map(([id, amount]) => ({ id, name: this.player(id)?.name ?? '?', amount, hand: r.hands[id]?.detail ?? null })),
      returned: Object.entries(r.returns ?? {}).map(([id, amount]) => ({ id, name: this.player(id)?.name ?? '?', amount })),
      shown: [...h.revealed].map((id) => {
        const s = this.seatOf(id);
        return { id, name: s.p.name, cards: s.hole, hand: r.hands[id]?.detail ?? null };
      }),
      players: h.seats.map((s) => ({ name: s.p.name, net: s.p.chips - s.startChips })),
    });
    if (this.history.length > 30) this.history.pop();

    // 토너먼트 탈락·우승
    if (this.tourney.active) {
      // 같은 판에서 여럿이 탈락하면 판 시작 때 칩이 적었던 사람이 더 낮은 순위 (기권한 사람은 이미 순위가 있음)
      const busted = h.seats.filter((s) => s.p.chips === 0 && s.p.place == null && !s.p.leaving).sort((a, b) => a.startChips - b.startChips);
      const remaining = this.tourneyAlive().length;
      busted.forEach((s, i) => {
        s.p.place = remaining + busted.length - i;
        this.tourney.places.push({ id: s.id, name: s.p.name, place: s.p.place });
      });
      if (busted.length) this.say(`${busted.map((s) => `${s.p.name}님 ${s.p.place}위`).join(', ')}로 탈락했어요.`);
    }

    for (const p of [...this.players]) if (p.leaving) this.removePlayer(p.id);
    this.checkTourneyEnd();
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
    const now = this.now();
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
        dealtIn: !!seat,
        folded: seat?.folded ?? false,
        allIn: seat?.allIn ?? false,
        bet: seat?.bet ?? 0,
        lastAction: seat?.lastAction ?? null,
        cards,
        stats: { ...p.stats, net: p.chips - p.bought },
        place: p.place,
        spectator: !!p.spectator,
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
        // 이번 스트리트 베팅을 뺀, 가운데 모인 칩
        collected: h.seats.reduce((a, s) => a + s.total - s.bet, 0),
        currentBet: h.currentBet,
        blinds: h.blinds,
        buttonId: h.seats[h.buttonIdx].id,
        sbId: h.seats[h.sbIdx].id,
        bbId: h.seats[h.bbIdx].id,
        toActId: cur?.id ?? null,
        turnMsLeft: cur ? Math.max(0, h.turnEndsAt - now) : 0,
        turnMsTotal: cur ? h.turnMs : 0,
        results: h.results,
      };
    }
    const mySeat = this.seatOf(playerId);
    const myTurn = mySeat && this.currentSeat() === mySeat;
    const t = this.tourney;

    return {
      code: this.code,
      me: playerId,
      hostId: this.hostId,
      running: this.running,
      settings: this.settings,
      blinds: this.blinds,
      limits: SETTING_LIMITS,
      reactionList: REACTIONS,
      tourney: {
        active: t.active,
        level: t.level + 1,
        // 이번 판 다음으로 몇 판 더 하면 블라인드가 오르는지 (0이면 다음 판부터 상승)
        handsToNext: t.active && this.settings.blindUpHands ? (this.settings.blindUpHands - (t.hands % this.settings.blindUpHands)) % this.settings.blindUpHands : 0,
        blindsFixed: !this.settings.blindUpHands,
        nextBlinds: t.active ? this.levelBlinds(t.level + 1) : null,
        winnerId: t.winnerId,
        winnerName: t.winnerName,
        places: t.places,
        entrants: t.entrants ?? 0,
      },
      players,
      hand,
      actions: myTurn ? this.options(mySeat) : null,
      dealerLine: this.dealerLine,
      log: this.log.slice(-30),
      chat: this.chat.slice(-40),
      reactions: this.reactions.filter((x) => now - x.at < 4000),
      events: this.events,
      history: this.history,
      canRebuy: !!me && this.settings.mode === 'cash' && me.chips === 0 && !(mySeat && h.street !== 'done'),
    };
  }
}
