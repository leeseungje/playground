// 경주로 그리기: 옆에서 보는 트랙, 선두를 따라가는 카메라, 질주하는 말, 실황 자막
import { el, svg } from '../util.js';
import { play, startRaceAmbience, stopRaceAmbience } from '../sound.js';
import { runnerSvg, inkOn } from './sprites.js';

const W = 1280;
const H = 440;
const VIEW_M = 72; // 화면에 보이는 거리 (m)
const PPM = W / VIEW_M; // 1m 당 픽셀
const LANE_TOP = 236;
const START_CAM = -8;
// 기수 외침
const SHOUTS = {
  pass: ['비켜 비켜~!', '실례합니다~', '먼저 갈게요!', '추월 들어갑니다!', '칼퇴 간다!!'],
  push: ['가즈아!!!', '조금만 더!', '월급날까지 달려!', '야근은 싫어!!', '으아아아!', '퇴근이 코앞이다!'],
  lead: ['따라올 테면 따라와!', '1등 맛집!', '오늘 회식은 내가 쏜다!', '이대로 퇴근!'],
  tired: ['헉헉…', '다리가… 무거워…', '커피 한 잔만…', '내일 연차 낼래…'],
  win: ['해냈다!!!', '칼퇴 확정!', '성과급 가즈아!', '오늘 치킨이다!'],
};
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)]; // 출발 전 카메라: 게이트가 화면 왼쪽에 조금 들어오게
const LANE_BOTTOM = 404;
export function createTrack(wrap) {
  const sky = el('div', { class: 'rt-sky' });
  const stand = el('div', { class: 'rt-stand' });
  const fence = el('div', { class: 'rt-fence' });
  const turf = el('div', { class: 'rt-turf' });
  const innerRail = el('div', { class: 'rt-inner' });
  const objects = el('div', { class: 'rt-objects' }); // 거리 표지판·게이트·결승선
  const horsesLayer = el('div', { class: 'rt-horses' });
  const mini = el('div', { class: 'rt-mini' }, el('div', { class: 'rt-mini-line' }), el('div', { class: 'rt-mini-flag' }, '🏁'));
  const order = el('div', { class: 'rt-order' });
  const ticker = el('div', { class: 'rt-ticker' });
  const countdown = el('div', { class: 'rt-countdown' });
  const flash = el('div', { class: 'rt-flash' });
  const stage = el('div', { class: 'rt-stage' }, sky, stand, fence, turf, innerRail, objects, horsesLayer, mini, order, ticker, countdown, flash);
  wrap.append(stage);

  let scale = 1;
  function fit() {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    scale = Math.min(w / W, h / H);
    stage.style.transform = `translate(${(w - W * scale) / 2}px, ${(h - H * scale) / 2}px) scale(${scale})`;
  }
  new ResizeObserver(fit).observe(wrap);

  let horses = new Map(); // no → { root, dot, chip }
  let cardKey = '';
  let distance = 1000;
  let race = null; // 재생 중인 경주
  let localStart = 0;
  let camX = 0;
  let raf = 0;
  let lastT = null;
  let evIdx = 0;
  const FX = {
    boost: { '커피 부스트': '☕ BOOST ON!', '로켓 부스트': '🚀 BOOST ON!', '방귀 부스트': '💨 뿌웅~ BOOST!' },
    fall: '💫',
    bump: '💥 쿵!',
    sleep: 'Zzz…',
    reverse: '?!',
  };
  /** 이벤트 한 개를 말 위에 연출한다. 경주 시간 → 화면 시간으로 바꾸되 너무 짧으면 보이게 늘린다 */
  function triggerEvent(e) {
    const ms = Math.max(e.type === 'fall' ? 1500 : 1100, (e.dur / race.speedup) * 1000);
    const targets = [e.no, ...(e.partner ? [e.partner] : [])];
    for (const no of targets) {
      const h = horses.get(no);
      if (!h) continue;
      const cls = `ev-${e.type}`;
      h.root.classList.remove(cls);
      void h.root.offsetWidth;
      h.root.classList.add(cls);
      h.root.style.setProperty('--evms', `${ms}ms`);
      if (e.type === 'boost') {
        h.boost.dataset.kind = e.kind;
        h.fx.textContent = FX.boost[e.kind] ?? '🚀 BOOST ON!';
      } else h.fx.textContent = FX[e.type];
      h.fx.className = `rt-fx show ${e.type}`;
      const timer = setTimeout(() => {
        h.root.classList.remove(cls);
        h.fx.className = 'rt-fx';
      }, ms);
      h.evTimers.push(timer);
    }
    play(`ev_${e.type}`, 0, e.kind);
  }
  let lineIdx = -1;
  let finishedFlashed = false;
  let bugled = false;
  let gateRung = false;
  let ambience = null;
  let onFinish = null;

  function buildObjects() {
    objects.replaceChildren();
    // 남은 거리 표지판 (200m 마다)
    for (let m = 200; m < distance; m += 200) {
      const left = distance - m;
      objects.append(el('div', { class: 'rt-post', style: { '--x': `${m}` } }, el('span', {}, left >= 1000 ? `${left}` : `${left}`), el('small', {}, 'm')));
    }
    objects.append(el('div', { class: 'rt-gate', style: { '--x': '0' } }, el('div', { class: 'rt-gate-top' }, '출발')));
    objects.append(el('div', { class: 'rt-finish', style: { '--x': `${distance}` } }, el('div', { class: 'rt-finish-top' }, 'FINISH')));
  }

  function laneY(i, n) {
    return n <= 1 ? LANE_TOP : LANE_TOP + ((LANE_BOTTOM - LANE_TOP) * i) / (n - 1);
  }

  /** 출주표가 바뀌면 말을 새로 세운다 */
  function setCard(card) {
    const key = card ? `${card.distance}-${card.horses.map((h) => `${h.no}${h.name}${h.scratched ? 'x' : ''}`).join()}` : '';
    if (key === cardKey) return;
    cardKey = key;
    horsesLayer.replaceChildren();
    mini.querySelectorAll('.rt-dot').forEach((d) => d.remove());
    horses = new Map();
    if (!card) return;
    distance = card.distance;
    buildObjects();
    const list = card.horses;
    list.forEach((h, i) => {
      const y = laneY(i, list.length);
      const s = 0.78 + (i / Math.max(1, list.length - 1)) * 0.22; // 앞 레인일수록 크게
      const root = el(
        'div',
        { class: `rt-horse${h.scratched ? ' scratched' : ''}`, style: { '--y': `${y}px`, '--s': s, zIndex: 10 + i } },
        el('div', { class: 'rt-shadow' }),
        el('div', { class: 'rt-dust' }),
        runnerSvg(h),
        el('div', { class: 'rt-tag', style: { background: h.color, color: inkOn(h.color) } }, String(h.no)),
        el('div', { class: 'rt-shout' }),
        el('div', { class: 'rt-boost' }),
        el('div', { class: 'rt-fx' }),
      );
      horsesLayer.append(root);
      const dot = el('div', { class: 'rt-dot', style: { background: h.color } }, String(h.no));
      mini.append(dot);
      horses.set(h.no, { root, dot, data: h, y, gait: 0, phase: Math.random() * Math.PI * 2, prev: 0, lastRank: null, shoutAt: 0, shout: root.querySelector('.rt-shout'), fx: root.querySelector('.rt-fx'), boost: root.querySelector('.rt-boost'), evTimers: [] });
    });
    placeStatic();
  }

  /** 경주 전: 게이트 앞에 서 있는 모습 */
  function placeStatic() {
    camX = START_CAM;
    stage.style.setProperty('--cam', String(camX));
    for (const [, h] of horses) {
      h.root.style.setProperty('--x', `${(0 - camX) * PPM - 120}px`);
      h.root.classList.remove('running');
      h.dot.style.left = '0%';
    }
    order.replaceChildren();
  }

  function interp(t) {
    const f = race.frames;
    if (t <= 0) return f[0].p;
    if (t >= f[f.length - 1].t) return f[f.length - 1].p;
    // 프레임 간격이 일정하므로 위치로 바로 찾는다
    const step = f[1].t - f[0].t || 0.4;
    let i = Math.min(f.length - 2, Math.max(0, Math.floor(t / step)));
    while (i > 0 && f[i].t > t) i--;
    while (i < f.length - 2 && f[i + 1].t < t) i++;
    const a = f[i];
    const b = f[i + 1];
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return a.p.map((x, j) => x + (b.p[j] - x) * k);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!race) return;
    const now = performance.now();
    const msToStart = localStart - now;
    // 출발 전 카운트다운
    if (msToStart > 0) {
      const sec = Math.ceil(msToStart / 1000);
      countdown.textContent = msToStart > 2600 ? '게이트 진입 중…' : String(sec);
      countdown.classList.add('show');
      if (!bugled && msToStart > 1800) {
        bugled = true;
        play('bugle');
      }
      return;
    }
    if (!gateRung) {
      gateRung = true;
      countdown.classList.remove('show');
      play('gate');
      ambience = startRaceAmbience();
      for (const [, h] of horses) if (!h.data.scratched) h.root.classList.add('running');
    }
    const t = ((now - localStart) / 1000) * race.speedup; // 경주 시간(초)
    const pos = interp(t);
    const nos = race.nos;
    // 카메라: 선두 기준, 부드럽게 따라감
    let lead = 0;
    for (let i = 1; i < pos.length; i++) if (pos[i] > pos[lead]) lead = i;
    const target = Math.max(START_CAM, Math.min(distance - VIEW_M * 0.7, pos[lead] - VIEW_M * 0.64));
    camX += (target - camX) * 0.12;
    stage.style.setProperty('--cam', camX.toFixed(2));
    // 말 위치
    const ranked = pos.map((p, i) => ({ p, no: nos[i] })).sort((a, b) => b.p - a.p);
    const dtSec = lastT == null ? 0 : t - lastT;
    lastT = t;
    const rankOf = new Map(ranked.map((r, i) => [r.no, i]));
    for (let i = 0; i < nos.length; i++) {
      const h = horses.get(nos[i]);
      if (!h) continue;
      const x = (pos[i] - camX) * PPM - 130; // 코끝 기준
      const off = x < -110;
      const done = pos[i] >= distance;
      // 자리다툼: 레인 안에서 살짝 위아래로 흔들림
      const jostle = done ? 0 : Math.sin(t * 1.7 + h.phase) * 3 + Math.sin(t * 4.3 + h.phase * 2) * 1.2;
      h.root.style.setProperty('--x', `${Math.max(-70, x)}px`);
      h.root.style.setProperty('--jy', `${jostle.toFixed(1)}px`);
      h.root.classList.toggle('behind', off);
      h.root.classList.toggle('done', done);
      // 속도 → 발걸음 빠르기 (자주 바꾸면 동작이 끊기므로 차이가 클 때만)
      if (dtSec > 0) {
        const v = (pos[i] - h.prev) / dtSec;
        const gait = done ? 0.6 : Math.max(0.24, Math.min(0.5, 0.36 - (v - 16) * 0.035));
        if (Math.abs(gait - h.gait) > 0.03) {
          h.gait = gait;
          h.root.style.setProperty('--gait', `${gait.toFixed(2)}s`);
        }
      }
      h.prev = pos[i];
      const rank = rankOf.get(nos[i]);
      const lp = pos[i] / distance;
      h.root.classList.toggle('lead', rank === 0 && !done);
      h.root.classList.toggle('push', !done && rank > 0 && rank < 5 && lp > 0.72);
      h.root.classList.toggle('won', done && rank === 0);
      h.root.classList.toggle('tired', !done && rank >= nos.length - 2 && lp > 0.45);
      // 외침: 추월했을 때, 막판, 선두, 지칠 때 (한 마리당 4초에 한 번, 화면에 2개까지)
      const nowMs = performance.now();
      let kind = null;
      if (done && rank === 0 && !h.saidWin) {
        kind = 'win';
        h.saidWin = true;
      } else if (!done && h.lastRank != null && rank < h.lastRank && lp > 0.15) kind = 'pass';
      else if (!done && lp > 0.8 && rank < 4 && Math.random() < 0.02) kind = 'push';
      else if (!done && rank === 0 && lp > 0.3 && Math.random() < 0.004) kind = 'lead';
      else if (!done && rank >= nos.length - 2 && lp > 0.5 && Math.random() < 0.004) kind = 'tired';
      h.lastRank = rank;
      if (kind && !off && (kind === 'win' || (nowMs - h.shoutAt > 4000 && stage.querySelectorAll('.rt-shout.show').length < 2))) {
        h.shoutAt = nowMs;
        h.shout.textContent = pickOne(SHOUTS[kind]);
        h.shout.classList.remove('show');
        void h.shout.offsetWidth;
        h.shout.classList.add('show');
        clearTimeout(h.shoutTimer);
        h.shoutTimer = setTimeout(() => h.shout.classList.remove('show'), kind === 'win' ? 3500 : 1800);
      }
      h.dot.style.left = `${(pos[i] / distance) * 100}%`;
    }
    // 현재 순위 띠
    const sig = ranked.map((r) => r.no).join();
    if (order.dataset.sig !== sig) {
      order.dataset.sig = sig;
      order.replaceChildren(
        ...ranked.map((r, i) => {
          const hd = horses.get(r.no)?.data;
          return el('span', { class: 'rt-ord', style: { background: hd?.color, color: ['#f4f1e8', '#f2c230', '#5fc4d9', '#9aa3ad'].includes(hd?.color) ? '#111' : '#fff' } }, el('b', {}, `${i + 1}`), ` ${r.no}`);
        }),
      );
    }
    // 돌발 이벤트 연출 (서버가 정한 시각에 맞춰)
    for (let k = evIdx; k < (race.events?.length ?? 0); k++) {
      const e = race.events[k];
      if (e.t > t) break;
      evIdx = k + 1;
      triggerEvent(e);
    }
    // 실황 자막
    let li = -1;
    for (let i = 0; i < race.lines.length; i++) if (race.lines[i].t <= t) li = i;
    if (li !== lineIdx && li >= 0) {
      lineIdx = li;
      ticker.textContent = race.lines[li].text;
      ticker.classList.remove('pop');
      void ticker.offsetWidth;
      ticker.classList.add('pop');
    }
    // 소리 세기: 선두가 결승에 가까울수록 함성이 커진다
    const lp = pos[lead] / distance;
    ambience?.set(0.4 + lp * 0.6, lp < 0.7 ? 0.15 : 0.15 + (lp - 0.7) * 2.6);
    // 골인
    if (!finishedFlashed && t >= race.finishSec) {
      finishedFlashed = true;
      flash.textContent = race.lines.at(-1)?.text.startsWith('사진') ? '📸 사진 판정!' : '골인!';
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1800);
      play('result');
    }
    if (pos.every((p) => p >= distance) || t > race.finishSec + 30) {
      for (const [, h] of horses) h.root.classList.remove('running');
      ambience?.set(0, 0.25);
      setTimeout(() => stopRaceAmbience(), 1200);
      ambience = null;
      cancelAnimationFrame(raf);
      raf = 0;
      onFinish?.();
    }
  }

  return {
    fit,
    stage,
    setCard,
    /** 서버가 보낸 경주 기록으로 재생 시작 (같은 경주면 무시) */
    playRace(r, receivedAt, { onDone } = {}) {
      const id = `${r.distance}-${r.finishSec}`;
      if (race && race.id === id) return;
      race = { ...r, id };
      localStart = receivedAt + r.msUntilStart;
      lineIdx = -1;
      lastT = null;
      evIdx = 0;
      for (const [, h] of horses) {
        h.saidWin = false;
        h.lastRank = null;
        h.shout?.classList.remove('show');
        for (const tm of h.evTimers ?? []) clearTimeout(tm);
        h.evTimers = [];
        h.root.classList.remove('ev-boost', 'ev-fall', 'ev-bump', 'ev-sleep', 'ev-reverse');
        if (h.fx) h.fx.className = 'rt-fx';
      }
      finishedFlashed = false;
      // 이미 시작한 경주에 늦게 들어왔으면 나팔은 생략
      bugled = r.msUntilStart < 1800;
      gateRung = r.msUntilStart <= 0;
      if (gateRung) for (const [, h] of horses) if (!h.data.scratched) h.root.classList.add('running');
      if (gateRung) ambience = startRaceAmbience();
      ticker.textContent = '';
      onFinish = onDone;
      stage.classList.add('racing');
      if (!raf) raf = requestAnimationFrame(frame);
    },
    /** 경주가 아닐 때 (발매 중): 게이트 앞 모습 */
    idle() {
      if (race) {
        race = null;
        cancelAnimationFrame(raf);
        raf = 0;
        stopRaceAmbience();
        ambience = null;
      }
      countdown.classList.remove('show');
      ticker.textContent = '';
      stage.classList.remove('racing');
      placeStatic();
    },
    say(text) {
      ticker.textContent = text;
    },
  };
}
