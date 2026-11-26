// 효과음 (파일 없이 Web Audio 로 합성)
import { storage } from './util.js';

let ctx = null;
let master = null;
let muted = storage.get('muted', false);
let volume = storage.get('volume', 0.7);

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    // 살짝 눌러 주는 컴프레서로 겹쳐도 깨지지 않게
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 브라우저 정책상 사용자 입력이 있어야 소리가 난다
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => ensure(), { once: false, passive: true });

export const isMuted = () => muted;
export function setMuted(v) {
  muted = !!v;
  storage.set('muted', muted);
  if (master) master.gain.value = muted ? 0 : volume;
}

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(gainNode, t, a, peak, dcy) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}

function tone(freq, t, { type = 'sine', a = 0.005, peak = 0.3, dcy = 0.2, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  env(g, t, a, peak, dcy);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + a + dcy + 0.05);
  return o;
}

function swish(t, { from = 3000, to = 900, dur = 0.12, peak = 0.25 } = {}) {
  const s = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.01, peak, dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

function clink(t, peak = 0.12) {
  // 칩끼리 부딪히는 금속성 소리: 높은 부분음 여러 개
  const base = 2600 + Math.random() * 900;
  for (const m of [1, 1.47, 2.09]) tone(base * m, t, { type: 'sine', a: 0.001, peak: peak / m, dcy: 0.07 + Math.random() * 0.04 });
  swish(t, { from: 6000, to: 3000, dur: 0.03, peak: peak * 0.5 });
}

const SOUNDS = {
  deal(t) {
    swish(t, { from: 4200, to: 1200, dur: 0.09, peak: 0.22 });
  },
  flip(t) {
    swish(t, { from: 2500, to: 5000, dur: 0.06, peak: 0.15 });
  },
  chips(t, n = 3) {
    for (let i = 0; i < n; i++) clink(t + i * (0.035 + Math.random() * 0.03), 0.14 - i * 0.02);
  },
  check(t) {
    // 테이블 두 번 두드리기
    for (const dt of [0, 0.11]) {
      tone(140, t + dt, { type: 'sine', a: 0.002, peak: 0.5, dcy: 0.09 });
      swish(t + dt, { from: 900, to: 300, dur: 0.04, peak: 0.25 });
    }
  },
  fold(t) {
    swish(t, { from: 1800, to: 500, dur: 0.18, peak: 0.18 });
  },
  allin(t) {
    tone(98, t, { type: 'sawtooth', a: 0.04, peak: 0.12, dcy: 0.7 });
    tone(147, t + 0.02, { type: 'triangle', a: 0.04, peak: 0.12, dcy: 0.7 });
    SOUNDS.chips(t + 0.05, 6);
  },
  turn(t) {
    // 내 차례 알림: 부드러운 두 음
    tone(659.25, t, { type: 'triangle', peak: 0.22, dcy: 0.35 });
    tone(880, t + 0.13, { type: 'triangle', peak: 0.22, dcy: 0.5 });
  },
  tick(t) {
    tone(1200, t, { type: 'square', a: 0.001, peak: 0.05, dcy: 0.03 });
  },
  win(t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, { type: 'triangle', peak: 0.2, dcy: 0.45 }));
    SOUNDS.chips(t + 0.1, 5);
  },
  pot(t) {
    SOUNDS.chips(t, 5);
  },
  fanfare(t) {
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    seq.forEach((f, i) => {
      tone(f, t + i * 0.12, { type: 'square', peak: 0.08, dcy: 0.3 });
      tone(f / 2, t + i * 0.12, { type: 'triangle', peak: 0.12, dcy: 0.35 });
    });
  },
  bell(t) {
    for (const [f, d] of [[1318.5, 0], [987.77, 0.18]]) tone(f, t + d, { type: 'sine', peak: 0.2, dcy: 0.9 });
  },
  pop(t) {
    const o = tone(500, t, { type: 'sine', a: 0.002, peak: 0.15, dcy: 0.08 });
    o.frequency.exponentialRampToValueAtTime(900, t + 0.06);
  },
  join(t) {
    tone(587.33, t, { type: 'sine', peak: 0.12, dcy: 0.2 });
    tone(880, t + 0.08, { type: 'sine', peak: 0.12, dcy: 0.3 });
  },
};

/** play('chips') 처럼 부른다. delay 는 ms */
export function play(name, delay = 0, ...args) {
  if (muted) return;
  const c = ensure();
  if (!c || c.state !== 'running' || !SOUNDS[name]) return;
  try {
    SOUNDS[name](c.currentTime + 0.01 + delay / 1000, ...args);
  } catch {
    /* 소리 실패는 게임에 영향 없음 */
  }
}

// ───────── 경마용 소리 ─────────
Object.assign(SOUNDS, {
  /** 출발 신호 나팔 (출주 팡파르) */
  bugle(t) {
    const notes = [[392, 0.18], [523.25, 0.18], [659.25, 0.18], [783.99, 0.36], [659.25, 0.14], [783.99, 0.6]];
    let at = t;
    for (const [f, d] of notes) {
      tone(f, at, { type: 'sawtooth', a: 0.02, peak: 0.07, dcy: d });
      tone(f * 2, at, { type: 'triangle', a: 0.02, peak: 0.05, dcy: d });
      at += d * 0.85;
    }
  },
  /** 게이트 열리는 벨 */
  gate(t) {
    for (let i = 0; i < 6; i++) tone(1568 + (i % 2) * 90, t + i * 0.06, { type: 'square', a: 0.002, peak: 0.07, dcy: 0.05 });
    swish(t + 0.35, { from: 600, to: 200, dur: 0.25, peak: 0.35 });
  },
  /** 마권 구매 (인쇄기 + 칩) */
  ticket(t) {
    for (let i = 0; i < 5; i++) swish(t + i * 0.035, { from: 5000, to: 3500, dur: 0.025, peak: 0.08 });
    SOUNDS.chips(t + 0.18, 2);
  },
  /** 결과 확정 */
  result(t) {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.1, { type: 'triangle', peak: 0.15, dcy: 0.5 }));
  },
  /** 적중! 동전 쏟아지는 소리 */
  jackpot(t) {
    SOUNDS.win(t);
    for (let i = 0; i < 10; i++) clink(t + 0.3 + i * 0.05, 0.1);
  },
});

// 말발굽·관중 소리는 경주 동안 계속 나므로 따로 켜고 끈다
let raceLoop = null;
/** 경주 소리 켜기. 반환된 객체의 set(intensity 0~1, crowd 0~1) 로 세기를 바꾸고 stop() 으로 끈다 */
export function startRaceAmbience() {
  stopRaceAmbience();
  const c = ensure();
  if (!c || muted) return { set() {}, stop() {} };
  // 관중 함성: 걸러 낸 잡음을 계속 재생
  const crowd = noise();
  crowd.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.6;
  const cg = c.createGain();
  cg.gain.value = 0.0001;
  crowd.connect(bp).connect(cg).connect(master);
  crowd.start();
  // 말발굽: 강도에 따라 간격을 바꿔 가며 '두두둑' 반복
  let intensity = 0.5;
  let stopped = false;
  let next = c.currentTime + 0.05;
  const hoof = (at, peak) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + Math.random() * 40, at);
    o.frequency.exponentialRampToValueAtTime(55, at + 0.07);
    env(g, at, 0.003, peak, 0.08);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + 0.12);
    swish(at, { from: 1400, to: 500, dur: 0.035, peak: peak * 0.4 });
  };
  const tick = () => {
    if (stopped) return;
    while (next < c.currentTime + 0.25) {
      // 갤럽 리듬: 네 박이 한 묶음
      const gap = 0.07 - intensity * 0.02;
      for (let k = 0; k < 4; k++) hoof(next + k * gap, 0.12 + intensity * 0.22);
      next += 4 * gap + 0.16 - intensity * 0.06;
    }
    setTimeout(tick, 80);
  };
  tick();
  raceLoop = {
    set(i, crowdLevel = 0.2) {
      intensity = Math.max(0, Math.min(1, i));
      cg.gain.setTargetAtTime(0.02 + crowdLevel * 0.35, c.currentTime, 0.4);
    },
    stop() {
      stopped = true;
      cg.gain.setTargetAtTime(0.0001, c.currentTime, 0.6);
      setTimeout(() => {
        try {
          crowd.stop();
        } catch {
          /* 이미 멈춤 */
        }
      }, 2500);
    },
  };
  return raceLoop;
}
export function stopRaceAmbience() {
  raceLoop?.stop();
  raceLoop = null;
}

// ───────── 경주 돌발 이벤트 소리 ─────────
Object.assign(SOUNDS, {
  ev_boost(t, kind) {
    if (kind === '방귀 부스트') {
      // 뿌웅~ (낮은 톱니파가 떨리며 내려감)
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.5);
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 28;
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      env(g, t, 0.02, 0.18, 0.5);
      o.connect(g).connect(master);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.6);
      lfo.stop(t + 0.6);
    }
    // 휘이잉 가속
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(300, t + 0.05);
    o2.frequency.exponentialRampToValueAtTime(1400, t + 0.55);
    env(g2, t + 0.05, 0.05, 0.1, 0.5);
    o2.connect(g2).connect(master);
    o2.start(t);
    o2.stop(t + 0.7);
    swish(t + 0.1, { from: 800, to: 4000, dur: 0.45, peak: 0.2 });
  },
  ev_fall(t) {
    tone(90, t, { type: 'sine', a: 0.003, peak: 0.6, dcy: 0.25 });
    swish(t, { from: 1200, to: 200, dur: 0.3, peak: 0.35 });
    // 관중 "오오~"
    tone(220, t + 0.15, { type: 'sawtooth', a: 0.08, peak: 0.04, dcy: 0.7 });
    tone(196, t + 0.15, { type: 'sawtooth', a: 0.08, peak: 0.04, dcy: 0.7 });
  },
  ev_bump(t) {
    const o = tone(180, t, { type: 'square', a: 0.002, peak: 0.18, dcy: 0.15 });
    o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
    swish(t, { from: 2000, to: 600, dur: 0.08, peak: 0.3 });
  },
  ev_sleep(t) {
    for (let i = 0; i < 2; i++) {
      const o = tone(140, t + i * 0.45, { type: 'sine', a: 0.15, peak: 0.08, dcy: 0.3 });
      o.frequency.linearRampToValueAtTime(190, t + i * 0.45 + 0.3);
    }
  },
  ev_reverse(t) {
    const o = tone(1200, t, { type: 'square', a: 0.002, peak: 0.07, dcy: 0.35 });
    o.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    tone(880, t + 0.4, { type: 'sine', peak: 0.1, dcy: 0.15 });
    tone(1320, t + 0.5, { type: 'sine', peak: 0.1, dcy: 0.2 });
  },
});

// ───────── 화투용 소리 ─────────
/** 두꺼운 종이를 담요 위에 내려치는 소리: 낮은 쿵 + 짧은 딱 */
function thud(t, { pitch = 120, peak = 0.5 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch * 1.8, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + 0.08);
  env(g, t, 0.002, peak, 0.11);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.2);
}
Object.assign(SOUNDS, {
  /** 화투 내려치기 「탁!」 (세게) */
  slap(t, power = 1) {
    thud(t, { pitch: 110, peak: 0.55 * power });
    swish(t, { from: 3800, to: 1400, dur: 0.035, peak: 0.45 * power });
    swish(t + 0.004, { from: 900, to: 400, dur: 0.06, peak: 0.25 * power });
  },
  /** 바닥에 살짝 내려놓기 */
  place(t) {
    thud(t, { pitch: 150, peak: 0.25 });
    swish(t, { from: 3000, to: 1500, dur: 0.03, peak: 0.18 });
  },
  /** 덱에서 뒤집기 */
  turnover(t) {
    swish(t, { from: 1800, to: 4200, dur: 0.07, peak: 0.16 });
    SOUNDS.place(t + 0.08);
  },
  /** 패 먹기: 두 장이 맞부딪히는 탁탁 + 쓸어 담는 소리 */
  take(t, n = 2) {
    SOUNDS.slap(t, 0.9);
    swish(t + 0.12, { from: 2200, to: 700, dur: 0.18, peak: 0.12 });
    for (let i = 1; i < Math.min(n, 4); i++) SOUNDS.place(t + 0.1 + i * 0.05);
  },
  /** 피 뺏기 */
  steal(t) {
    swish(t, { from: 5000, to: 1500, dur: 0.12, peak: 0.2 });
    tone(523.25, t + 0.05, { type: 'triangle', peak: 0.12, dcy: 0.12 });
    tone(392, t + 0.13, { type: 'triangle', peak: 0.12, dcy: 0.2 });
  },
  /** 뻑: 김 빠지는 소리 */
  ppeok(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.4);
    env(g, t, 0.01, 0.1, 0.4);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.5);
  },
  /** 고! 북 두 번 + 상승음 */
  go(t, n = 1) {
    thud(t, { pitch: 70, peak: 0.7 });
    thud(t + 0.16, { pitch: 70, peak: 0.7 });
    const base = 392 * Math.pow(1.06, Math.min(n, 6));
    [1, 1.26, 1.5].forEach((m, i) => tone(base * m, t + 0.3 + i * 0.08, { type: 'square', peak: 0.07, dcy: 0.25 }));
  },
  /** 스톱 / 판 끝 징 */
  gong(t) {
    for (const [f, p] of [[110, 0.3], [164, 0.18], [220, 0.12], [331, 0.06]]) tone(f, t, { type: 'sine', a: 0.01, peak: p, dcy: 2.2 });
    swish(t, { from: 1200, to: 300, dur: 0.3, peak: 0.2 });
  },
  /** 섯다 패 쪼으기 (한 장씩 밀어 보는 소리) */
  squeeze(t) {
    swish(t, { from: 900, to: 2600, dur: 0.35, peak: 0.08 });
  },
  /** 땡·광땡 등 큰 족보 공개 */
  big(t) {
    SOUNDS.slap(t, 1.2);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + 0.1 + i * 0.07, { type: 'triangle', peak: 0.14, dcy: 0.4 }));
  },
});

// ───────── 음성 콜 (브라우저 내장 한국어 음성) ─────────
let voiceOn = storage.get('voice', true);
export const isVoiceOn = () => voiceOn;
export function setVoice(v) {
  voiceOn = !!v;
  storage.set('voice', voiceOn);
  if (!voiceOn) window.speechSynthesis?.cancel();
}
let koVoice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  koVoice = vs.find((v) => /ko[-_]KR/i.test(v.lang) && /Heami|SunHi|Yuna|Google/i.test(v.name)) ?? vs.find((v) => /^ko/i.test(v.lang)) ?? null;
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}
/** 「고!」「뻑!」처럼 짧게 외친다. 소리를 꺼 두었거나 한국어 음성이 없으면 조용히 넘어간다 */
export function speak(text, { rate = 1.15, pitch = 1.05 } = {}) {
  if (muted || !voiceOn || !window.speechSynthesis || !text) return;
  if (!koVoice) pickVoice();
  if (!koVoice) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = koVoice;
    u.lang = koVoice.lang;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = Math.min(1, volume + 0.2);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* 무시 */
  }
}

// ───────── 화투 「착!」 v2: 샘플을 직접 합성해 두고 재생 ─────────
// 두꺼운 플라스틱 패가 패 위에 붙는 소리 = 아주 짧은 딱(고역) + 납작한 탁(중역) + 담요 쿵(저역)
const slapBufs = [];
function makeSlap(c, seed) {
  const sr = c.sampleRate;
  const len = Math.floor(sr * 0.22);
  const buf = c.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  let lp2 = 0;
  let prev = 0;
  const bodyF = 0.18 + seed * 0.05; // 중역 필터 계수 (패마다 살짝 다르게)
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = Math.random() * 2 - 1;
    // 딱: 고역 강조(차분) + 3ms 감쇠
    const hp = n - prev;
    prev = n;
    const crack = hp * Math.exp(-t / 0.0035) * 0.9;
    // 탁: 중역 잡음 + 25ms 감쇠, 두 번째 접촉(3ms 뒤)
    lp += bodyF * (n - lp);
    lp2 += 0.5 * (lp - lp2);
    const body = (lp - lp2) * 3.2 * (Math.exp(-t / 0.025) + (t > 0.003 ? 0.5 * Math.exp(-(t - 0.003) / 0.018) : 0));
    // 쿵: 아래로 떨어지는 저음
    const f = 70 + 90 * Math.exp(-t / 0.02);
    const thump = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.05) * 0.55;
    d[i] = crack + body + thump;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  return buf;
}
function playBuf(buf, t, gain = 0.8, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(t);
}
Object.assign(SOUNDS, {
  /** 착! power 1 = 보통, 1.3 = 세게 */
  slap(t, power = 1) {
    if (!slapBufs.length) for (let k = 0; k < 4; k++) slapBufs.push(makeSlap(ctx, k / 3));
    const buf = slapBufs[Math.floor(Math.random() * slapBufs.length)];
    playBuf(buf, t, Math.min(1.2, 0.75 * power), 0.92 + Math.random() * 0.16);
    if (power > 1.15) playBuf(slapBufs[0], t + 0.012, 0.35, 0.8); // 세게 칠 때 겹치는 울림
  },
  /** 내려놓기 (가볍게) */
  place(t) {
    if (!slapBufs.length) for (let k = 0; k < 4; k++) slapBufs.push(makeSlap(ctx, k / 3));
    playBuf(slapBufs[2], t, 0.3, 1.35);
  },
  /** 패 던지는 바람 소리 */
  whoosh(t) {
    swish(t, { from: 700, to: 2600, dur: 0.16, peak: 0.12 });
  },
  /** 더미 패 뒤집기: 휙 + 살짝 */
  turnover(t) {
    swish(t, { from: 1600, to: 4200, dur: 0.12, peak: 0.13 });
  },
  /** 먹은 패 쓸어 담기: 착착 + 쓸리는 소리 */
  take(t, n = 2) {
    swish(t, { from: 2400, to: 600, dur: 0.22, peak: 0.12 });
    for (let i = 0; i < Math.min(n, 4); i++) SOUNDS.place(t + 0.04 + i * 0.045);
  },
});
