import { randomBytes, randomInt } from 'node:crypto';
import { SeotdaGame } from './seotda.js';
import { GostopGame } from './gostop.js';

/*
 * 화투 방 (섯다 / 고스톱). 방장이 모드를 고르고, 판은 자동으로 이어진다.
 *  - 섯다: 2~10명
 *  - 고스톱: 2명이면 맞고, 3명 이상이면 3명이 치고 한 명은 광을 팔고 나머지는 쉰다 (판마다 자리를 돌린다)
 *  - 효과음·음성은 fx 이벤트(번호가 붙은 목록)로 보내고, 브라우저가 새 번호만 재생한다
 */

export const HWATU_DEFAULTS = {
  maxPlayers: 10,
  startChips: 10_000,
  ante: 100,
  pointChips: 100,
  turnSec: 20,
  jokers: 2,
  awayMs: 5_000,
  nextGameMs: 7_000,
  replayMs: 3_500,
  dropMs: 20_000,
};

export const SETTING_LIMITS = {
  startChips: [1_000, 1_000_000],
  ante: [10, 10_000],
  pointChips: [10, 10_000],
  turnSec: [10, 60],
  jokers: [0, 4], // 고스톱 조커 장수
};

const newId = () => randomBytes(6).toString('hex');
const clampInt = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v))));

export class HwatuRoom {
  constructor(code, { onChange = () => {}, schedule, now = () => Date.now(), options = {} } = {}) {
    this.code = code;
    this.opt = { ...HWATU_DEFAULTS, ...options };
    this.settings = {
      mode: 'seotda',
      startChips: this.opt.startChips,
      ante: this.opt.ante,
      pointChips: this.opt.pointChips,
      turnSec: this.opt.turnSec,
      jokers: this.opt.jokers,
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
    this.running = false;
    this.game = null;
    this.gameNo = 0;
    this.phaseEndsAt = 0;
    this.timer = null;
    this.dealerLine = '어서 오세요! 2명 이상 모이면 방장이 게임을 시작할 수 있어요.';
    this.chat = [];
    this.lastChatAt = new Map();
    this.seq = 0;
    this.fx = [];
    this.fxSeq = 0;
    this.history = [];
    this.leadId = null; // 다음 판 선 (지난 판 승자)
    this.nagari = 1;
    this.rotation = 0;
    this.pendingReplay = false; // 섯다 재경기를 기다리는 중 (판돈이 아직 걸려 있음) // 고스톱 자리 돌리기
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
  say(text) {
    this.dealerLine = text;
  }
  /** 효과음·음성 이벤트 */
  sound(name, data = {}) {
    this.fx.push({ seq: ++this.fxSeq, name, ...data });
    if (this.fx.length > 30) this.fx.shift();
  }
  later(ms, fn) {
    this.timer?.();
    this.phaseEndsAt = this.now() + ms;
    this.phaseTotal = ms;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.phaseEndsAt = 0;
      fn();
      this.changed();
    }, ms);
  }
  clearTimer() {
    this.timer?.();
    this.timer = null;
    this.phaseEndsAt = 0;
  }
  hostConnected() {
    const h = this.player(this.hostId);
    return !!h && h.connected;
  }
  pickHost() {
    this.hostId = this.players.find((p) => p.connected)?.id ?? null;
  }
  inGame(id) {
    return !!this.game && this.game.phase !== 'result' && this.game.order.includes(id);
  }

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
      }, this.opt.dropMs),
    );
  }
  cancelDrop(p) {
    this.dropTimers?.get(p.id)?.();
    this.dropTimers?.delete(p.id);
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
      const idle = this.players.find((x) => !x.connected && !this.inGame(x.id));
      if (idle) this.removePlayer(idle.id);
    }
    if (this.players.length >= this.opt.maxPlayers) return { error: `방이 가득 찼어요 (최대 ${this.opt.maxPlayers}명)` };
    const back = this.departed.get(token);
    this.departed.delete(token);
    const base = (name || '').trim().slice(0, 12) || `손님${this.players.length + 1}`;
    let finalName = base;
    for (let i = 2; this.players.some((x) => x.name === finalName); i++) finalName = `${base}${i}`;
    p = {
      id: newId(),
      token,
      name: finalName,
      chips: back?.chips ?? this.settings.startChips,
      rebuys: back?.rebuys ?? 0,
      wins: back?.wins ?? 0,
      played: back?.played ?? 0,
      best: back?.best ?? 0,
      connected: true,
      socketId,
    };
    this.players.push(p);
    if (!this.hostConnected()) this.hostId = p.id;
    this.sound('join');
    if (this.game && this.game.phase !== 'result') this.say(`${p.name}님이 들어왔어요. 다음 판부터 같이해요.`);
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
    // 끊긴 사람 차례면 짧게 기다렸다가 자동 진행
    if (this.game && this.game.phase !== 'result' && this.game.turn === p.id) this.game.setTimer ? this.game.setTimer() : this.game.setTurn(p.id);
    this.changed();
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    this.departed.set(p.token, { chips: p.chips, rebuys: p.rebuys, wins: p.wins, played: p.played, best: p.best });
    this.players = this.players.filter((x) => x.id !== id);
    this.lastChatAt.delete(id);
    if (this.hostId === id) this.pickHost();
  }

  leave(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.inGame(id)) this.game.remove(id);
    this.removePlayer(id);
    if (!this.players.some((x) => x.connected)) this.pause(null, true);
    this.changed();
  }

  sendChat(id, text) {
    const p = this.player(id);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    const clean = typeof text === 'string' ? Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 100).join('') : '';
    if (!clean) return { error: '메시지가 비어 있어요' };
    const now = this.now();
    if (now - (this.lastChatAt.get(id) ?? -Infinity) < 600) return { error: '조금 천천히 보내 주세요' };
    this.lastChatAt.set(id, now);
    this.chat.push({ id: ++this.seq, pid: p.id, name: p.name, text: clean, at: now });
    if (this.chat.length > 80) this.chat.shift();
    this.changed();
    return {};
  }

  // ───────── 방장 ─────────
  updateSettings(id, patch = {}) {
    if (id !== this.hostId) return { error: '방장만 바꿀 수 있어요' };
    if (this.game && this.game.phase !== 'result') return { error: '판이 끝난 뒤에 바꿀 수 있어요' };
    if (this.pendingReplay) return { error: '재경기가 끝난 뒤에 바꿀 수 있어요' };
    const s = { ...this.settings };
    if (patch.mode !== undefined) {
      if (!['seotda', 'gostop'].includes(patch.mode)) return { error: '알 수 없는 게임이에요' };
      if (patch.mode !== s.mode) {
        this.nagari = 1;
        this.leadId = null;
      }
      s.mode = patch.mode;
    }
    for (const k of Object.keys(SETTING_LIMITS)) if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) s[k] = clampInt(patch[k], SETTING_LIMITS[k]);
    this.settings = s;
    this.say(`설정이 바뀌었어요: ${s.mode === 'seotda' ? `섯다 · 학교 ${s.ante}칩` : `고스톱 · 점당 ${s.pointChips}칩 · 조커 ${s.jokers}장`}`);
    this.changed();
    return {};
  }

  /** 다음 판에 나갈 수 있는 사람 (접속 중, 칩이 있는 사람) */
  eligible() {
    const need = this.settings.mode === 'seotda' ? this.settings.ante : 1;
    return this.players.filter((p) => p.connected && p.chips >= need);
  }

  start(id) {
    if (id !== this.hostId) return { error: '방장만 시작할 수 있어요' };
    if (this.running) return { error: '이미 진행 중이에요' };
    if (this.pendingReplay) {
      // 재경기는 이미 예약돼 있다. 그 뒤로 판이 이어지게만 한다
      this.running = true;
      this.changed();
      return {};
    }
    if (this.eligible().length < 2) return { error: '칩이 있는 접속자가 2명 이상 있어야 해요' };
    this.running = true;
    this.startGame();
    this.changed();
    return {};
  }

  /** 판이 끝나면 다음 판으로 넘어가지 않고 멈춘다 */
  pause(id, force = false) {
    if (!force && id !== this.hostId) return { error: '방장만 멈출 수 있어요' };
    this.running = false;
    if (this.pendingReplay) this.say('재경기가 끝나면 멈출게요.');
    else if (!this.game || this.game.phase === 'result') {
      this.clearTimer();
      this.say('잠시 쉬어 갑니다. 방장이 「게임 시작」을 누르면 이어서 해요.');
    } else this.say('이번 판이 끝나면 멈출게요.');
    if (!force) this.changed();
    return {};
  }

  rebuy(id) {
    const p = this.player(id);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (this.inGame(id)) return { error: '판이 끝난 뒤에 받을 수 있어요' };
    const need = this.settings.mode === 'seotda' ? this.settings.ante * 3 : this.settings.pointChips * 10;
    if (p.chips >= need) return { error: '아직 칩이 남아 있어요' };
    p.chips += this.settings.startChips;
    p.rebuys++;
    this.say(`${p.name}님이 칩을 다시 받았어요 (+${this.settings.startChips.toLocaleString('ko-KR')})`);
    this.sound('rebuy', { pid: id });
    this.changed();
    return {};
  }

  /** 선(지난 판 승자)부터 시작하도록 순서를 돌린다 */
  orderFrom(ids) {
    const i = ids.indexOf(this.leadId);
    return i > 0 ? [...ids.slice(i), ...ids.slice(0, i)] : ids;
  }

  startGame({ replay = null } = {}) {
    const ready = this.eligible().map((p) => p.id);
    if (!replay && ready.length < 2) {
      this.running = false;
      this.game = null;
      this.say('칩이 있는 사람이 2명 이상 있어야 해요. 사람을 기다리는 중…');
      return;
    }
    this.gameNo += replay ? 0 : 1;
    if (replay || this.settings.mode === 'seotda') {
      if (replay) this.game = new SeotdaGame(this, replay.order, { carry: replay.carry, replayNo: replay.no });
      else {
        if (!ready.includes(this.leadId)) this.leadId = ready[randomInt(ready.length)];
        this.game = new SeotdaGame(this, this.orderFrom(ready));
      }
    } else {
      let order = ready;
      let seller = null;
      if (ready.length > 3) {
        // 자리 돌리기: 판마다 시작점을 한 칸씩 옮겨 3명을 고르고, 다음 사람이 광을 판다
        const start = this.rotation % ready.length;
        const rotated = [...ready.slice(start), ...ready.slice(0, start)];
        order = rotated.slice(0, 3);
        seller = rotated[3];
        this.rotation++;
      }
      if (!order.includes(this.leadId)) this.leadId = order[randomInt(order.length)];
      order = this.orderFrom(order);
      this.game = new GostopGame(this, order, { nagari: this.nagari, seller, jokers: this.settings.jokers });
    }
    for (const id of this.game.order) {
      const p = this.player(id);
      if (p && !replay) p.played++;
    }
    this.game.start();
  }

  /** 엔진이 판을 끝내면 부른다 */
  gameOver(game) {
    const r = game.result;
    if (game.kind === 'seotda') {
      if (r.replay) {
        this.pendingReplay = true;
        this.later(this.opt.replayMs, () => {
          this.pendingReplay = false;
          // 재경기 전에 나간 사람은 빼고, 한 명만 남으면 그 사람이 판돈을 가져간다
          const alive = game.alive().filter((id) => this.player(id));
          if (alive.length >= 2) return this.startGame({ replay: { order: alive, carry: { pot: game.pot, contrib: game.contrib }, no: game.replayNo + 1 } });
          game.phase = 'betting';
          game.folded = new Set(game.order.filter((id) => !alive.includes(id)));
          game.finish({ winners: alive, reason: 'fold' });
        });
        this.changed();
        return {};
      }
      if (r.winners.length === 1) this.leadId = r.winners[0];
      for (const id of r.winners) {
        const p = this.player(id);
        if (p) {
          p.wins++;
          p.best = Math.max(p.best, r.won[id] ?? 0);
        }
      }
      const res = r.results ?? {};
      this.history.unshift({
        no: this.gameNo,
        kind: 'seotda',
        winners: r.winners.map((id) => this.player(id)?.name ?? '나간 사람'),
        hand: r.winners.length && res[r.winners[0]] ? res[r.winners[0]].name : '다이',
        pot: r.pot,
      });
    } else {
      this.nagari = r.nextNagari ?? 1;
      if (r.winner) {
        this.leadId = r.winner;
        const p = this.player(r.winner);
        const total = r.payments.reduce((s, x) => s + x.chips, 0);
        if (p) {
          p.wins++;
          p.best = Math.max(p.best, total);
        }
        this.history.unshift({ no: this.gameNo, kind: 'gostop', winners: [p?.name ?? '나간 사람'], hand: `${r.points}점${r.go ? ` · ${r.go}고` : ''}`, pot: total, tags: [...new Set(r.payments.flatMap((x) => x.tags))] });
      } else this.history.unshift({ no: this.gameNo, kind: 'gostop', winners: [], hand: r.aborted ? '무효' : '나가리', pot: 0 });
    }
    if (this.history.length > 30) this.history.pop();
    if (this.running) this.later(this.opt.nextGameMs, () => this.startGame());
    else this.clearTimer();
    this.changed();
    return {};
  }

  // ───────── 게임 행동 ─────────
  bet(id, msg) {
    if (this.game?.kind !== 'seotda') return { error: '섯다 판이 아니에요' };
    const r = this.game.act(id, msg);
    if (!r.error) this.changed();
    return r;
  }
  play(id, msg) {
    if (this.game?.kind !== 'gostop') return { error: '고스톱 판이 아니에요' };
    const g = this.game;
    let r;
    if (msg.flipOnly) r = g.flipOnly(id);
    else r = g.play(id, String(msg.card ?? ''), { target: typeof msg.target === 'string' ? msg.target : undefined, shake: !!msg.shake, bomb: !!msg.bomb });
    if (!r.error) this.changed();
    return r;
  }
  choose(id, msg) {
    if (this.game?.kind !== 'gostop') return { error: '고스톱 판이 아니에요' };
    const r = this.game.chooseFlip(id, String(msg.card ?? ''));
    if (!r.error) this.changed();
    return r;
  }
  goStop(id, msg) {
    if (this.game?.kind !== 'gostop') return { error: '고스톱 판이 아니에요' };
    const r = this.game.decide(id, msg.choice === 'go' ? 'go' : msg.choice === 'stop' ? 'stop' : '');
    if (!r.error) this.changed();
    return r;
  }

  // ───────── 화면용 상태 ─────────
  viewFor(id) {
    const now = this.now();
    return {
      code: this.code,
      me: id,
      hostId: this.hostId,
      running: this.running,
      settings: this.settings,
      limits: SETTING_LIMITS,
      gameNo: this.gameNo,
      dealer: this.dealerLine,
      msLeft: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - now) : 0,
      msTotal: this.phaseEndsAt ? this.phaseTotal : 0,
      nagari: this.nagari,
      players: this.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips, connected: p.connected, wins: p.wins, played: p.played, rebuys: p.rebuys, best: p.best })),
      game: this.game ? this.game.view(id) : null,
      fx: this.fx,
      history: this.history,
      chat: this.chat.slice(-60),
    };
  }
}
