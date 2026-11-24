import { randomBytes, randomInt } from 'node:crypto';
import { CATEGORIES } from './liar-words.js';

/*
 * 라이어 찾기 (사내 파티 게임)
 *  - 시민은 제시어를, 라이어는 카테고리만 안다 (바보 모드: 라이어도 다른 제시어를 받아 자기가 라이어인지 모른다)
 *  - 돌아가며 힌트 → 토론 → 투표 → (동표면 한 번 재투표) → 라이어가 지목되면 제시어 맞히기 기회
 *  - 제시어는 viewFor 에서 시민에게만 보낸다. 라이어 화면으로는 절대 가지 않는다.
 */

export const LIAR_DEFAULTS = {
  maxPlayers: 12,
  revealMs: 6_000, // 카드 확인 시간
  hintSec: 30,
  hintRounds: 1,
  discussSec: 60,
  voteSec: 30,
  guessSec: 30,
  resultMs: 0, // 결과는 방장이 다음 라운드를 누를 때까지 유지
  awayMs: 5_000, // 접속이 끊긴 사람 차례는 5초 뒤 넘김
};

export const SETTING_LIMITS = {
  hintSec: [10, 90],
  hintRounds: [1, 3],
  discussSec: [0, 300],
  voteSec: [10, 90],
};

const newId = () => randomBytes(6).toString('hex');
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clampInt = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v))));

export class LiarRoom {
  constructor(code, { onChange = () => {}, schedule, now = () => Date.now(), options = {} } = {}) {
    this.code = code;
    this.opt = { ...LIAR_DEFAULTS, ...options };
    this.settings = {
      category: 'random',
      mode: 'normal', // normal | fool
      liarCount: 1,
      hintSec: this.opt.hintSec,
      hintRounds: this.opt.hintRounds,
      discussSec: this.opt.discussSec,
      voteSec: this.opt.voteSec,
    };
    this.onChange = onChange;
    this.now = now;
    this.schedule =
      schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.players = [];
    this.departed = new Map();
    this.hostId = null;
    this.phase = 'lobby'; // lobby → reveal → hint → discuss → vote → (revote) → guess → result
    this.phaseEndsAt = 0;
    this.roundNo = 0;
    this.round = null;
    this.history = [];
    this.chat = [];
    this.lastChatAt = new Map();
    this.seq = 0;
    this.host = '어서 오세요! 3명 이상 모이면 방장이 게임을 시작할 수 있어요.';
    this.timer = null;
    this.lastActive = this.now();
  }

  // ───────── 공통 ─────────
  changed() {
    this.lastActive = this.now();
    this.onChange(this);
  }
  player(id) {
    return this.players.find((p) => p.id === id);
  }
  later(ms, fn) {
    this.timer?.();
    this.phaseEndsAt = this.now() + ms;
    this.timer = this.schedule(() => {
      this.timer = null;
      fn();
      this.changed();
    }, ms);
  }
  clearTimer() {
    this.timer?.();
    this.timer = null;
  }
  say(text) {
    this.host = text;
  }
  hostConnected() {
    const h = this.player(this.hostId);
    return !!h && h.connected;
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

  pickHost() {
    const next = this.players.find((p) => p.connected);
    this.hostId = next?.id ?? null;
  }
  inRound(id) {
    return !!this.round && this.round.order.includes(id);
  }
  isLiar(id) {
    return !!this.round && this.round.liars.includes(id);
  }

  // ───────── 입장·퇴장 ─────────
  join({ token, name, socketId }) {
    let p = this.players.find((x) => x.token === token);
    if (p) {
      this.cancelDrop(p);
      p.socketId = socketId;
      p.connected = true;
      if (!this.hostConnected()) this.hostId = p.id;
      this.changed();
      return { player: p };
    }
    if (this.players.length >= this.opt.maxPlayers) {
      const idle = this.players.find((x) => !x.connected && !this.inRound(x.id));
      if (idle) this.removePlayer(idle.id);
    }
    if (this.players.length >= this.opt.maxPlayers) return { error: `방이 가득 찼어요 (최대 ${this.opt.maxPlayers}명)` };
    const back = this.departed.get(token);
    this.departed.delete(token);
    const base = (name || '').trim().slice(0, 12) || `참가자${this.players.length + 1}`;
    let finalName = base;
    for (let i = 2; this.players.some((x) => x.name === finalName); i++) finalName = `${base}${i}`;
    p = { id: newId(), token, name: finalName, score: back?.score ?? 0, liarTimes: back?.liarTimes ?? 0, wins: back?.wins ?? 0, connected: true, socketId };
    this.players.push(p);
    if (!this.hostConnected()) this.hostId = p.id;
    if (this.phase !== 'lobby' && this.phase !== 'result') this.say(`${p.name}님이 들어왔어요. 다음 라운드부터 참여해요.`);
    this.changed();
    return { player: p };
  }

  disconnect(socketId) {
    const p = this.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    if (this.hostId === p.id) this.pickHost();
    this.scheduleDrop(p);
    // 힌트 차례였다면 짧게 기다렸다가 넘긴다
    if (this.phase === 'hint' && this.currentTurn() === p.id) this.later(this.opt.awayMs, () => this.submitHint(p.id, null, true));
    this.maybeFinishVote();
    this.changed();
  }

  leave(playerId) {
    const p = this.player(playerId);
    if (!p) return;
    this.departed.set(p.token, { score: p.score, liarTimes: p.liarTimes, wins: p.wins });
    const wasTurn = this.phase === 'hint' && this.currentTurn() === playerId;
    this.players = this.players.filter((x) => x.id !== playerId);
    this.lastChatAt.delete(playerId);
    if (this.hostId === playerId) this.pickHost();
    if (this.round) {
      // 라이어가 나가면 이번 라운드는 시민 승리로 끝낸다. 시민이 나가면 순서에서 뺀다
      if (this.isLiar(playerId) && this.phase !== 'result') {
        this.say(`라이어였던 ${p.name}님이 나가서 이번 라운드는 시민 승리!`);
        this.finish('citizens', 'liarLeft');
      } else if (this.phase !== 'result') {
        const idx = this.round.order.indexOf(playerId);
        if (idx >= 0) {
          this.round.order.splice(idx, 1);
          if (idx < this.round.turnIdx) this.round.turnIdx--;
        }
        this.round.votes.delete(playerId);
        for (const [k, v] of this.round.votes) if (v === playerId) this.round.votes.delete(k);
        if (this.round.order.length < 3) {
          this.say('인원이 부족해서 이번 라운드를 멈췄어요.');
          this.toLobby();
        } else if (wasTurn) this.nextTurn();
        else this.maybeFinishVote();
      }
    }
    this.changed();
  }

  sendChat(playerId, text) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    const clean = typeof text === 'string' ? Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 100).join('') : '';
    if (!clean) return { error: '메시지가 비어 있어요' };
    const now = this.now();
    if (now - (this.lastChatAt.get(playerId) ?? -Infinity) < 600) return { error: '조금 천천히 보내 주세요' };
    this.lastChatAt.set(playerId, now);
    this.chat.push({ id: ++this.seq, pid: p.id, name: p.name, text: clean, at: now });
    if (this.chat.length > 80) this.chat.shift();
    this.changed();
    return {};
  }

  // ───────── 방장 ─────────
  updateSettings(playerId, patch = {}) {
    if (playerId !== this.hostId) return { error: '방장만 바꿀 수 있어요' };
    if (this.phase !== 'lobby' && this.phase !== 'result') return { error: '라운드가 끝난 뒤에 바꿀 수 있어요' };
    const s = { ...this.settings };
    if (patch.category !== undefined) {
      if (patch.category !== 'random' && !CATEGORIES[patch.category]) return { error: '알 수 없는 카테고리예요' };
      s.category = patch.category;
    }
    if (patch.mode !== undefined) {
      if (!['normal', 'fool'].includes(patch.mode)) return { error: '알 수 없는 모드예요' };
      s.mode = patch.mode;
    }
    if (patch.liarCount !== undefined) s.liarCount = clampInt(patch.liarCount, [1, 2]);
    for (const k of Object.keys(SETTING_LIMITS)) if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) s[k] = clampInt(patch[k], SETTING_LIMITS[k]);
    this.settings = s;
    this.changed();
    return {};
  }

  start(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 시작할 수 있어요' };
    if (this.phase !== 'lobby' && this.phase !== 'result') return { error: '라운드가 진행 중이에요' };
    const ready = this.players.filter((p) => p.connected);
    if (ready.length < 3) return { error: '접속한 사람이 3명 이상 있어야 해요' };
    const liarCount = Math.min(this.settings.liarCount, ready.length >= 6 ? 2 : 1);
    const catKey = this.settings.category === 'random' ? Object.keys(CATEGORIES)[randomInt(Object.keys(CATEGORIES).length)] : this.settings.category;
    const words = shuffle(CATEGORIES[catKey].words);
    const order = shuffle(ready.map((p) => p.id));
    const liars = shuffle(order).slice(0, liarCount);
    this.roundNo++;
    this.round = {
      no: this.roundNo,
      category: catKey,
      word: words[0],
      foolWord: words[1], // 바보 모드에서 라이어가 받는 다른 제시어
      mode: this.settings.mode,
      liars,
      order,
      hintRound: 1,
      turnIdx: 0,
      hints: [],
      votes: new Map(),
      candidates: null, // 재투표 후보
      revoted: false,
      accused: null,
      guess: null,
      result: null,
    };
    // 라이어 횟수는 라운드가 끝난 뒤에 올린다 (진행 중에 올리면 누가 라이어인지 드러남)
    this.phase = 'reveal';
    this.say(`${this.roundNo}라운드! 카테고리는 「${CATEGORIES[catKey].label}」. 각자 카드를 몰래 확인하세요. ${liarCount > 1 ? '라이어는 두 명이에요!' : ''}`);
    this.later(this.opt.revealMs, () => this.startHints());
    this.changed();
    return {};
  }

  /** 방장이 지금 단계를 건너뛴다 (토론을 일찍 끝내는 등) */
  skip(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 넘길 수 있어요' };
    if (this.phase === 'reveal') this.startHints();
    else if (this.phase === 'discuss') this.startVote();
    else if (this.phase === 'hint') this.submitHint(this.currentTurn(), null, true);
    else return { error: '지금은 넘길 수 없어요' };
    this.changed();
    return {};
  }

  toLobby() {
    this.clearTimer();
    this.phase = 'lobby';
    this.round = null;
  }

  // ───────── 힌트 ─────────
  currentTurn() {
    const r = this.round;
    return r ? r.order[r.turnIdx] ?? null : null;
  }

  startHints() {
    this.phase = 'hint';
    this.round.turnIdx = 0;
    this.round.hintRound = 1;
    this.setTurn();
  }

  setTurn() {
    const id = this.currentTurn();
    const p = this.player(id);
    const ms = p?.connected ? this.settings.hintSec * 1000 : this.opt.awayMs;
    this.say(`${p?.name ?? '?'}님 차례예요. 제시어를 너무 티 나지 않게 설명해 주세요!`);
    this.later(ms, () => this.submitHint(id, null, true));
  }

  /** 힌트 제출. text 가 비어 있으면 '말로 했어요' 처리 */
  submitHint(playerId, text, timeout = false) {
    if (this.phase !== 'hint') return { error: '지금은 힌트 시간이 아니에요' };
    if (this.currentTurn() !== playerId) return { error: '내 차례가 아니에요' };
    const clean = typeof text === 'string' ? Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 40).join('') : '';
    const r = this.round;
    // 제시어를 그대로 말하면 안 된다
    if (clean && (clean.includes(r.word) || (r.mode === 'fool' && clean.includes(r.foolWord)))) return { error: '제시어를 그대로 쓰면 안 돼요!' };
    r.hints.push({ pid: playerId, text: clean || (timeout ? '(시간 초과)' : '(말로 설명했어요)'), round: r.hintRound, spoken: !clean });
    this.nextTurn();
    this.changed();
    return {};
  }

  nextTurn() {
    const r = this.round;
    r.turnIdx++;
    if (r.turnIdx >= r.order.length) {
      if (r.hintRound < this.settings.hintRounds) {
        r.hintRound++;
        r.turnIdx = 0;
      } else return this.startDiscuss();
    }
    this.setTurn();
  }

  startDiscuss() {
    if (!this.settings.discussSec) return this.startVote();
    this.phase = 'discuss';
    this.say('힌트가 다 모였어요! 누가 라이어 같은지 자유롭게 이야기해 보세요.');
    this.later(this.settings.discussSec * 1000, () => this.startVote());
  }

  // ───────── 투표 ─────────
  startVote(candidates = null) {
    this.phase = candidates ? 'revote' : 'vote';
    this.round.votes = new Map();
    this.round.candidates = candidates;
    this.say(candidates ? `동표예요! ${candidates.map((id) => this.player(id)?.name).join(', ')} 중에서 다시 투표해 주세요.` : '투표 시간! 라이어라고 생각하는 사람을 고르세요.');
    this.later(this.settings.voteSec * 1000, () => this.closeVote());
  }

  vote(playerId, target) {
    if (this.phase !== 'vote' && this.phase !== 'revote') return { error: '지금은 투표 시간이 아니에요' };
    const r = this.round;
    if (!r.order.includes(playerId)) return { error: '이번 라운드 참가자만 투표할 수 있어요' };
    if (!r.order.includes(target)) return { error: '그 사람에게는 투표할 수 없어요' };
    if (target === playerId) return { error: '자기 자신에게는 투표할 수 없어요' };
    if (r.candidates && !r.candidates.includes(target)) return { error: '재투표 후보 중에서 골라 주세요' };
    r.votes.set(playerId, target);
    this.maybeFinishVote();
    this.changed();
    return {};
  }

  maybeFinishVote() {
    if (this.phase !== 'vote' && this.phase !== 'revote') return;
    const voters = this.round.order.filter((id) => this.player(id)?.connected);
    if (voters.length && voters.every((id) => this.round.votes.has(id))) this.closeVote();
  }

  closeVote() {
    const r = this.round;
    const tally = new Map();
    for (const t of r.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
    r.lastTally = Object.fromEntries(tally);
    r.lastVotes = Object.fromEntries(r.votes);
    const max = Math.max(0, ...tally.values());
    const top = [...tally.entries()].filter(([, n]) => n === max).map(([id]) => id);
    if (max === 0) {
      this.say('아무도 투표하지 않았어요… 라이어가 몰래 도망쳤습니다!');
      return this.finish('liar', 'noVote');
    }
    if (top.length > 1) {
      if (!r.revoted) {
        r.revoted = true;
        return this.startVote(top);
      }
      this.say('또 동표! 라이어를 찾지 못했어요.');
      return this.finish('liar', 'tie');
    }
    r.accused = top[0];
    const name = this.player(r.accused)?.name ?? '?';
    if (!this.isLiar(r.accused)) {
      this.say(`${name}님은… 라이어가 아니었습니다! 라이어의 승리!`);
      return this.finish('liar', 'wrong');
    }
    // 라이어 지목 → 제시어 맞히기 기회
    const words = CATEGORIES[r.category].words.filter((w) => w !== r.word && w !== r.foolWord);
    r.guess = { options: shuffle([r.word, ...shuffle(words).slice(0, 11)]), choice: null, by: r.accused };
    this.phase = 'guess';
    this.say(`${name}님이 라이어로 지목됐어요! 마지막 기회, 제시어를 맞히면 라이어의 역전승!`);
    this.later(this.opt.guessSec * 1000, () => this.submitGuess(r.accused, null));
  }

  submitGuess(playerId, word) {
    if (this.phase !== 'guess') return { error: '지금은 정답을 맞힐 시간이 아니에요' };
    const r = this.round;
    if (playerId !== r.guess.by) return { error: '지목된 라이어만 맞힐 수 있어요' };
    if (word != null && !r.guess.options.includes(word)) return { error: '보기 중에서 골라 주세요' };
    r.guess.choice = word ?? null;
    const name = this.player(playerId)?.name ?? '?';
    if (word === r.word) {
      this.say(`${name}님이 제시어 「${r.word}」를 맞혔어요! 라이어의 대역전승!`);
      this.finish('liar', 'guessed');
    } else {
      this.say(word ? `「${word}」… 틀렸습니다! 제시어는 「${r.word}」. 시민의 승리!` : `시간 초과! 제시어는 「${r.word}」. 시민의 승리!`);
      this.finish('citizens', 'caught');
    }
    this.changed();
    return {};
  }

  finish(winner, reason) {
    this.clearTimer();
    const r = this.round;
    r.result = { winner, reason };
    // 점수: 시민 승리 시 시민 +1, 라이어 승리 시 라이어 +3
    for (const id of r.order) {
      const p = this.player(id);
      if (!p) continue;
      const liar = r.liars.includes(id);
      if (liar) p.liarTimes++;
      if ((winner === 'liar' && liar) || (winner === 'citizens' && !liar)) {
        p.score += liar ? 3 : 1;
        p.wins++;
      }
    }
    this.history.unshift({
      no: r.no,
      category: CATEGORIES[r.category].label,
      word: r.word,
      liars: r.liars.map((id) => this.player(id)?.name ?? '나간 사람'),
      winner,
      reason,
    });
    if (this.history.length > 20) this.history.pop();
    this.phase = 'result';
    this.phaseEndsAt = 0;
  }

  // ───────── 화면용 상태 ─────────
  viewFor(playerId) {
    const r = this.round;
    const now = this.now();
    const done = this.phase === 'result';
    const inThis = r && r.order.includes(playerId);
    let card = null;
    if (r && inThis) {
      const liar = r.liars.includes(playerId);
      const cat = CATEGORIES[r.category].label;
      if (done) card = { category: cat, word: liar ? null : r.word, liar, foolWord: liar && r.mode === 'fool' ? r.foolWord : null };
      else if (liar && r.mode === 'normal') card = { category: cat, liar: true };
      // 바보 모드: 라이어도 시민처럼 보이지만 다른 제시어를 받는다 (본인은 모름)
      else card = { category: cat, word: liar ? r.foolWord : r.word, liar: false };
    }
    const showVotes = done || (r && r.lastTally && (this.phase === 'revote' || this.phase === 'guess'));
    return {
      code: this.code,
      me: playerId,
      hostId: this.hostId,
      phase: this.phase,
      phaseMsLeft: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - now) : 0,
      settings: this.settings,
      limits: SETTING_LIMITS,
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])),
      host: this.host,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, score: p.score, wins: p.wins, liarTimes: p.liarTimes, inRound: !!r && r.order.includes(p.id) })),
      round: r
        ? {
            no: r.no,
            category: CATEGORIES[r.category].label,
            mode: r.mode,
            liarCount: r.liars.length,
            order: r.order,
            turn: this.phase === 'hint' ? this.currentTurn() : null,
            hintRound: r.hintRound,
            hintRounds: this.settings.hintRounds,
            hints: r.hints,
            // 투표: 진행 중에는 누가 투표했는지만, 내 선택은 나에게만
            voted: [...r.votes.keys()],
            myVote: r.votes.get(playerId) ?? null,
            candidates: r.candidates,
            tally: showVotes ? r.lastTally : null,
            votes: done ? r.lastVotes ?? null : null,
            accused: r.accused,
            guess: r.guess ? { options: this.phase === 'guess' && playerId === r.guess.by ? r.guess.options : done ? r.guess.options : null, by: r.guess.by, choice: done ? r.guess.choice : null } : null,
            result: done ? { ...r.result, word: r.word, foolWord: r.mode === 'fool' ? r.foolWord : null, liars: r.liars } : null,
          }
        : null,
      card,
      history: this.history,
      chat: this.chat.slice(-60),
    };
  }
}
