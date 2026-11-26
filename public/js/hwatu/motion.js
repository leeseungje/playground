// 고스톱 패 모션: 손(또는 상대 자리)에서 던짐 → 바닥 패에 부딪힘 → 더미 패 뒤집어 떨어짐 → 먹은 패가 먹은 칸으로 쓸려 감
// 화면은 새 상태로 먼저 그리고, 날아올 카드는 잠시 숨겨 두었다가 비행 카드가 도착하면 보여 준다.
import { card } from '/shared/hwatu.js';
import { cardEl, backEl } from './card.js';
import { play } from '../sound.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** 그리기 전에 지금 화면의 카드 위치를 적어 둔다 */
export function snapshot(me) {
  const s = { floor: new Map(), hand: new Map(), capt: new Map(), seats: new Map(), groups: new Map(), deck: null, floorBox: null };
  document.querySelectorAll('.floor .hwc[data-id]').forEach((n) => s.floor.set(n.dataset.id, rectOf(n)));
  document.querySelectorAll('.floor-group[data-month]').forEach((n) => s.groups.set(Number(n.dataset.month), rectOf(n)));
  document.querySelectorAll('#mine .me-hand .hwc[data-id]').forEach((n) => s.hand.set(n.dataset.id, rectOf(n)));
  document.querySelectorAll('[data-cpid] .hwc[data-id]').forEach((n) => s.capt.set(`${n.closest('[data-cpid]').dataset.cpid}:${n.dataset.id}`, rectOf(n)));
  document.querySelectorAll('.hseat[data-pid]').forEach((n) => s.seats.set(n.dataset.pid, rectOf(n.querySelector('.hseat-cards') ?? n)));
  s.deck = rectOf(document.querySelector('.deck-pile .hwc:last-of-type') ?? document.querySelector('.deck-pile'));
  s.floorBox = rectOf(document.querySelector('.floor'));
  s.me = me;
  return s;
}

let running = [];
/** 진행 중인 모션을 즉시 끝낸다 (다음 상태가 빨리 올 때) */
export function finishAll() {
  for (const r of running) r();
  running = [];
}

function flyer(id, from, { back = false, w = null, flip = false } = {}) {
  if (!from) throw new Error("no from rect");
  let n;
  if (flip && id) {
    // 앞뒤 두 면 카드: 뒷면이 보이다가 뒤집히며 앞면이 나온다
    n = document.createElement('div');
    n.className = 'mv-fly mv-3d';
    n.append(cardEl(id, { size: 'md' }), backEl({ size: 'md', cls: 'mv-back' }));
  } else n = id && !back ? cardEl(id, { size: 'md', cls: 'mv-fly' }) : backEl({ size: 'md', cls: 'mv-fly' });
  const width = w ?? from.w;
  n.style.setProperty('--w', `${width}px`);
  n.style.left = `${from.x}px`;
  n.style.top = `${from.y}px`;
  document.body.append(n);
  return n;
}

function hide(nodes) {
  for (const n of nodes) n && n.classList.add('mv-hidden');
  return () => nodes.forEach((n) => n && n.classList.remove('mv-hidden'));
}

/** from → to 로 던지기. 포물선 + 회전 + 착지 때 눌림 */
function throwCard(node, from, to, { ms = 360, lift = 60, spin = 0, flip = false, scaleTo = 1 } = {}) {
  if (!from || !to || !from.w) return Promise.resolve();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sx = to.w / from.w;
  const kf = [
    { transform: `translate(0,0) rotate(0deg) scale(1) ${flip ? 'rotateY(180deg)' : ''}`, offset: 0 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) rotate(${spin * 0.6}deg) scale(${1.28 * (0.5 + sx / 2)}) ${flip ? 'rotateY(90deg)' : ''}`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${sx * scaleTo * 1.06}) rotateY(0deg)`, offset: 0.86 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${sx * scaleTo}) rotateY(0deg)`, offset: 1 },
  ];
  return node.animate(kf, { duration: ms, easing: 'cubic-bezier(.25,.75,.35,1)', fill: 'forwards' }).finished.catch(() => {});
}

/** 부딪힐 때 바닥 패가 움찔하고 먼지 링이 퍼진다 */
function impact(at, big = false) {
  const ring = document.createElement('div');
  ring.className = `mv-ring${big ? ' big' : ''}`;
  ring.style.left = `${at.x}px`;
  ring.style.top = `${at.y}px`;
  document.body.append(ring);
  setTimeout(() => ring.remove(), 600);
}

export function shake(el, power = 1) {
  if (!el || reduced()) return;
  const p = 5 * power;
  el.animate(
    [{ transform: 'translate(0,0)' }, { transform: `translate(${-p}px, ${p * 0.6}px)` }, { transform: `translate(${p}px, ${-p * 0.4}px)` }, { transform: `translate(${-p * 0.5}px, ${p * 0.3}px)` }, { transform: 'translate(0,0)' }],
    { duration: 260, easing: 'ease-out' },
  );
}

/**
 * 고스톱 한 차례 모션.
 * @param snap 그리기 전 위치 (snapshot)
 * @param pg 이전 game view, g 새 game view
 */
export async function animateTurn(snap, pg, g) {
  try {
    await animateTurnInner(snap, pg, g);
  } catch (e) {
    console.warn("[motion]", e);
    finishAll();
  }
}

async function animateTurnInner(snap, pg, g) {
  if (!snap || !pg || !g || reduced()) return;
  const L = g.last;
  if (!L) return;
  const key = `${g.turnNo}:${g.phase === 'chooseFlip' ? 'c' : 'd'}`;
  const prevKey = `${pg.turnNo}:${pg.phase === 'chooseFlip' ? 'c' : 'd'}`;
  if (key === prevKey) return;
  const continuing = pg.phase === 'chooseFlip' && pg.turnNo === g.turnNo; // 바닥 패 고르기를 끝낸 상태
  const me = snap.me;
  const mover = L.pid;
  const monthOf = (id) => card(id).month;

  // 새 화면의 카드 위치
  const newFloor = new Map();
  document.querySelectorAll('.floor .hwc[data-id]').forEach((n) => newFloor.set(n.dataset.id, n));
  const newCapt = new Map();
  document.querySelectorAll('[data-cpid] .hwc[data-id]').forEach((n) => newCapt.set(`${n.closest('[data-cpid]').dataset.cpid}:${n.dataset.id}`, n));
  const prevFloor = new Set(pg.floor);
  const prevCapt = new Set(Object.entries(pg.captured).flatMap(([pid, ids]) => ids.map((c) => `${pid}:${c}`)));
  const arrivedCapt = [...newCapt.keys()].filter((k) => !prevCapt.has(k));
  const arrivedFloor = [...newFloor.keys()].filter((c) => !prevFloor.has(c));

  // 날아올 카드는 잠깐 숨긴다
  const restore = hide([...arrivedCapt.map((k) => newCapt.get(k)), ...arrivedFloor.map((c) => newFloor.get(c))]);
  const cleanups = [restore];
  const done = () => cleanups.forEach((f) => f());
  running.push(done);

  // 바닥에서 사라진 패는 옛 자리에 유령으로 남겨 두었다가 날려 보낸다
  const ghosts = new Map();
  for (const [id, r] of snap.floor) {
    if (!r || newFloor.has(id)) continue;
    const gnode = flyer(id, r);
    ghosts.set(id, { node: gnode, at: r });
    cleanups.push(() => gnode.remove());
  }

  const floorBox = rectOf(document.querySelector('.floor')) ?? snap.floorBox;
  // 같은 달 바닥 패 위치 (부딪힐 곳)
  const hitPoint = (id, fallback) => {
    const m = monthOf(id);
    const old = snap.groups.get(m);
    if (old) {
      const cw = old.h / 1.517; // 카드 너비 (화투 비율)
      return { x: old.x + Math.max(0, old.w - cw * 0.75), y: old.y + 6, w: cw, h: old.h };
    }
    const nf = newFloor.get(id);
    if (nf) return rectOf(nf);
    return fallback;
  };
  const sourceOfPlayed = (id) => {
    if (mover === me && snap.hand.get(id)) return snap.hand.get(id);
    const seat = snap.seats.get(mover);
    if (seat) return { x: seat.x + seat.w / 2 - 20, y: seat.y, w: 40, h: 64 };
    return snap.floorBox;
  };
  const placeFor = (id, landing) => {
    const nf = newFloor.get(id);
    return nf ? rectOf(nf) : landing;
  };

  const landed = new Map(); // id → { node, at }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) 낸 패 던지기
  if (!continuing && L.played.length) {
    const throws = L.played.map(async (id, i) => {
      const from = sourceOfPlayed(id);
      if (!from) return newFloor.get(id)?.classList.remove('mv-hidden');
      await sleep(i * 70);
      const to0 = hitPoint(id, floorBox ? { x: floorBox.x + floorBox.w / 2, y: floorBox.y + 10, w: from.w * 0.6, h: from.h * 0.6 } : from);
      const to = placeFor(id, to0);
      const size = (newFloor.get(id) && rectOf(newFloor.get(id))) || (ghosts.size ? [...ghosts.values()][0].at : null) || to || from;
      if (!to) return newFloor.get(id)?.classList.remove('mv-hidden');
      const node = flyer(id, from);
      cleanups.push(() => node.remove());
      play('whoosh');
      await throwCard(node, from, { ...to, w: size.w, h: size.h }, { ms: 340, lift: mover === me ? 90 : 40, spin: (Math.random() - 0.5) * 14 });
      const target = { x: to.x, y: to.y, w: size.w, h: size.h };
      landed.set(id, { node, at: target });
      play('slap', 0, L.played.length > 1 ? 1.3 : 1.1);
      impact(center(target), L.played.length > 1);
      if (newFloor.get(id)) {
        newFloor.get(id).classList.remove('mv-hidden');
        node.remove();
      }
    });
    await Promise.all(throws);
    if (L.specials.includes('bomb')) shake(document.querySelector('.hw-table'), 1.6);
    await sleep(170);
  }

  // 2) 더미에서 뒤집기
  if (!continuing && L.flipped && snap.deck) {
    const id = L.flipped;
    const from = snap.deck;
    const sz = (newFloor.get(id) && rectOf(newFloor.get(id))) || [...ghosts.values()][0]?.at || [...landed.values()][0]?.at || from;
    let to = placeFor(id, hitPoint(id, floorBox ? { x: floorBox.x + floorBox.w - sz.w, y: floorBox.y, w: sz.w, h: sz.h } : from));
    // 고르기 중이면 고르기 상자의 뒤집은 패 자리로
    const chooseSlot = g.phase === 'chooseFlip' ? document.querySelector('.choose-box .row .hwc') : null;
    if (chooseSlot) to = rectOf(chooseSlot) ?? to;
    if (!to) to = sz;
    const node = flyer(id, from, { flip: true });
    cleanups.push(() => node.remove());
    play('turnover');
    await throwCard(node, from, { ...to, w: sz.w, h: sz.h }, { ms: 380, lift: 34, flip: true, spin: (Math.random() - 0.5) * 10 });
    landed.set(id, { node, at: { x: to.x, y: to.y, w: sz.w, h: sz.h } });
    play('slap', 0, 1.2);
    impact(center(to));
    if (newFloor.get(id)) {
      newFloor.get(id).classList.remove('mv-hidden');
      node.remove();
    }
    if (chooseSlot) node.remove();
    const sp = L.specials;
    if (sp.includes('jjok') || sp.includes('ttadak') || sp.includes('ppeok')) shake(document.querySelector('.hw-table'), 1.2);
    await sleep(260);
  }

  // 3) 먹은 패가 먹은 칸으로 쓸려 간다 (뺏은 피는 상대 칸에서 날아온다)
  const sweeps = arrivedCapt.map(async (k, i) => {
    const [pid, id] = k.split(':');
    const dest = newCapt.get(k);
    const to = rectOf(dest);
    let src = landed.get(id) ?? ghosts.get(id);
    let fromRect = src?.at;
    let node = src?.node;
    if (!node) {
      // 뺏은 피: 상대 먹은 칸의 옛 자리에서
      const victim = [...snap.capt.keys()].find((kk) => kk.endsWith(`:${id}`) && !kk.startsWith(`${pid}:`));
      fromRect = victim ? snap.capt.get(victim) : snap.seats.get(mover);
      if (!fromRect || !to) return dest.classList.remove('mv-hidden');
      node = flyer(id, fromRect);
      cleanups.push(() => node.remove());
      await sleep(250);
    }
    if (!to) {
      node.remove();
      return dest.classList.remove('mv-hidden');
    }
    await sleep(i * 45);
    if (i === 0) play('take', 0, arrivedCapt.length);
    // 이미 부딪힌 자리에서 출발 (애니메이션 fill 로 옮겨진 위치를 기준으로 다시 잡는다)
    const cur = node.isConnected ? rectOf(node) : null;
    if (!cur) {
      node.remove();
      return dest.classList.remove('mv-hidden');
    }
    node.getAnimations().forEach((a) => a.cancel());
    node.style.left = `${cur.x}px`;
    node.style.top = `${cur.y}px`;
    node.style.setProperty('--w', `${cur.w}px`);
    await throwCard(node, cur, to, { ms: 320, lift: 18 });
    dest.classList.remove('mv-hidden');
    node.remove();
  });
  await Promise.all(sweeps);
  done();
  running = running.filter((f) => f !== done);
}

/**
 * 판 시작: 딜러(또는 더미)에서 바닥 패를 한 장씩 깔고 앞면으로 뒤집는다. 내 손패도 날아와 뒤집힌다.
 * @param from 출발 위치 (딜러 손)
 */
export async function animateDeal(from) {
  try {
    await animateDealInner(from);
  } catch (e) {
    console.warn("[motion]", e);
    finishAll();
  }
}

async function animateDealInner(from) {
  if (reduced()) return;
  const floor = [...document.querySelectorAll('.floor .hwc[data-id]')];
  const hand = [...document.querySelectorAll('#mine .me-hand .hwc[data-id]')];
  const src = from ?? rectOf(document.querySelector('.deck-pile'));
  if (!src) return;
  const restore = hide([...floor, ...hand]);
  const extras = [];
  const done = () => {
    restore();
    extras.forEach((n) => n.remove());
  };
  running.push(done);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lay = async (n, i, gap, lift) => {
    await sleep(i * gap);
    const to = rectOf(n);
    if (!to) return n.classList.remove('mv-hidden');
    const f = flyer(n.dataset.id, { x: src.x, y: src.y, w: to.w * 0.7, h: to.h * 0.7 }, { flip: true });
    extras.push(f);
    play('deal');
    await throwCard(f, { x: src.x, y: src.y, w: to.w * 0.7, h: to.h * 0.7 }, to, { ms: 360, lift, flip: true, spin: (Math.random() - 0.5) * 30 });
    play('place');
    n.classList.remove('mv-hidden');
    f.remove();
  };
  // 바닥 먼저, 그다음 내 손패
  await Promise.all(floor.map((n, i) => lay(n, i, 110, 30)));
  await Promise.all(hand.map((n, i) => lay(n, i, 70, 60)));
  done();
  running = running.filter((f) => f !== done);
}
