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
