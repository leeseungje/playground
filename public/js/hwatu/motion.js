// 고스톱 패 모션 (맞고 게임의 손맛을 참고)
//  1) 낸 패: 손에서 툭 들어 올렸다가 바닥 같은 달 패 위로 내리꽂힌다 → 번쩍 + 링 + 바닥 패 움찔
//  2) 더미 패: 더미 위로 크게 떠오르며 뒤집혀 앞면을 보여 준 뒤 제자리로 떨어진다
//  3) 먹은 패: 바닥에서 한데 모았다가 먹은 칸으로 쓸려 간다 (뺏은 피는 상대 칸에서 날아온다)
//  4) 내 손패: 빠진 자리를 남은 패가 미끄러지며 채운다
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATIO = 1.517; // 화투 세로/가로
const EASE_OUT = 'cubic-bezier(.2,.8,.3,1)';
const EASE_IN = 'cubic-bezier(.6,0,.9,.45)'; // 내리꽂을 때 가속

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

/** 화면 위를 나는 카드. flip 이면 앞뒤 두 면(처음엔 뒷면) */
function flyer(id, from, { back = false, flip = false } = {}) {
  if (!from) throw new Error('no from rect');
  let n;
  if (flip && id) {
    n = document.createElement('div');
    n.className = 'mv-fly mv-3d';
    n.append(cardEl(id, { size: 'md' }), backEl({ size: 'md', cls: 'mv-back' }));
  } else n = id && !back ? cardEl(id, { size: 'md', cls: 'mv-fly' }) : backEl({ size: 'md', cls: 'mv-fly' });
  n.style.setProperty('--w', `${from.w}px`);
  n.style.left = `${from.x}px`;
  n.style.top = `${from.y}px`;
  document.body.append(n);
  return n;
}

function hide(nodes) {
  for (const n of nodes) n && n.classList.add('mv-hidden');
  return () => nodes.forEach((n) => n && n.classList.remove('mv-hidden'));
}

/**
 * from 자리에 놓인 비행 카드를 기준으로 한 transform.
 * scale 은 가운데를 기준으로 커지므로 가운데끼리 맞춰 옮긴다.
 */
function T(from, to, { s = null, dy = 0, rot = 0, ry = 0 } = {}) {
  const a = center(from);
  const b = center(to);
  const sc = s ?? to.w / from.w;
  return `perspective(900px) translate(${b.x - a.x}px, ${b.y - a.y + dy}px) rotate(${rot}deg) scale(${sc}) rotateY(${ry}deg)`;
}
const anim = (node, kf, ms) => node.animate(kf, { duration: ms, fill: 'forwards' }).finished.catch(() => {});

/** 부딪힌 자리: 번쩍 + 링 퍼짐 (+ 큰 충돌이면 불티) */
function impact(at, { big = false } = {}) {
  const flash = document.createElement('div');
  flash.className = 'mv-flash';
  Object.assign(flash.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px`, borderRadius: `${at.w * 0.075}px` });
  document.body.append(flash);
  flash.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.14)' }], { duration: 280, easing: 'ease-out', fill: 'forwards' });
  const c = center(at);
  const ring = document.createElement('div');
  ring.className = `mv-ring${big ? ' big' : ''}`;
  ring.style.left = `${c.x}px`;
  ring.style.top = `${c.y}px`;
  document.body.append(ring);
  const sparks = [];
  if (big) {
    for (let i = 0; i < 9; i++) {
      const sp = document.createElement('i');
      sp.className = 'mv-spark';
      sp.style.left = `${c.x}px`;
      sp.style.top = `${c.y}px`;
      document.body.append(sp);
      const ang = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      const d = at.w * (0.9 + Math.random() * 0.6);
      sp.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * d}px, ${Math.sin(ang) * d}px) scale(0.3)`, opacity: 0 }], { duration: 440, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' });
      sparks.push(sp);
    }
  }
  setTimeout(() => [flash, ring, ...sparks].forEach((n) => n.remove()), 650);
}

/** 바닥 패가 부딪힘에 움찔 (비행 카드는 지금 transform 위에 덧붙인다) */
function jolt(nodes, from) {
  for (const n of nodes) {
    const r = rectOf(n);
    if (!r) continue;
    const a = center(r);
    const dx = Math.sign(a.x - from.x || 1) * 5;
    const dy = Math.sign(a.y - from.y || 1) * 3;
    const t = getComputedStyle(n).transform;
    const t0 = t && t !== 'none' ? t : '';
    n.animate([{ transform: `${t0} translate(0px,0px)` }, { transform: `${t0} translate(${dx}px, ${dy}px) rotate(${dx * 0.5}deg)` }, { transform: `${t0} translate(0px,0px)` }], { duration: 200, easing: 'ease-out' });
  }
}

/** 진짜 카드가 착지할 때 살짝 눌렸다 튀어 오른다 */
function squash(n) {
  n?.animate([{ transform: 'scale(1.1)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
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
 * 고스톱 한 차례 모션. 끝나면 resolve 된다.
 * @param snap 그리기 전 위치 (snapshot)
 * @param pg 이전 game view, g 새 game view
 */
export async function animateTurn(snap, pg, g) {
  try {
    await animateTurnInner(snap, pg, g);
  } catch (e) {
    console.warn('[motion]', e);
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
  let cancelled = false; // 다음 상태가 와서 끝냈으면 남은 단계는 건너뛴다
  const done = () => {
    cancelled = true;
    cleanups.forEach((f) => f());
  };
  running.push(done);

  // 바닥에서 사라진 패는 옛 자리에 유령으로 남겨 두었다가 날려 보낸다
  const ghosts = new Map();
  for (const [id, r] of snap.floor) {
    if (!r || newFloor.has(id)) continue;
    const gnode = flyer(id, r);
    ghosts.set(id, { node: gnode, at: r });
    cleanups.push(() => gnode.remove());
  }

  // 내 손패: 빠진 자리를 남은 패가 채운다
  if (mover === me && !continuing) {
    document.querySelectorAll('#mine .me-hand .hwc[data-id]').forEach((n) => {
      const old = snap.hand.get(n.dataset.id);
      const now = rectOf(n);
      if (!old || !now || Math.abs(old.x - now.x) < 1) return;
      n.animate([{ transform: `translate(${old.x - now.x}px, ${old.y - now.y}px)` }, { transform: 'none' }], { duration: 320, delay: 140, easing: EASE_OUT, fill: 'backwards' });
    });
  }

  const floorBox = rectOf(document.querySelector('.floor')) ?? snap.floorBox;
  const cardSize = () => {
    const any = [...newFloor.values()].map(rectOf).find(Boolean) ?? [...ghosts.values()][0]?.at ?? snap.deck;
    return any ? { w: any.w, h: any.h } : { w: 60, h: 60 * RATIO };
  };
  // 같은 달 바닥 패 위 (겹쳐 놓일 자리)
  const hitPoint = (id) => {
    const nf = newFloor.get(id);
    if (nf) return rectOf(nf);
    const old = snap.groups.get(monthOf(id));
    const { w, h } = cardSize();
    if (old) return { x: old.x + w * 0.22, y: old.y + h * 0.12, w, h };
    return floorBox ? { x: floorBox.x + floorBox.w / 2 - w / 2, y: floorBox.y + floorBox.h / 2 - h / 2, w, h } : null;
  };
  const sameMonthFloor = (id) => {
    const m = monthOf(id);
    return [
      ...[...ghosts.entries()].filter(([gid]) => gid !== id && monthOf(gid) === m).map(([, v]) => v.node),
      ...[...newFloor.entries()].filter(([fid, n]) => fid !== id && monthOf(fid) === m && !n.classList.contains('mv-hidden')).map(([, n]) => n),
    ];
  };
  const sourceOfPlayed = (id) => {
    if (mover === me && snap.hand.get(id)) return { rect: snap.hand.get(id), mine: true };
    const seat = snap.seats.get(mover);
    const { w } = cardSize();
    if (seat) return { rect: { x: seat.x + seat.w / 2 - w / 2, y: seat.y, w, h: w * RATIO }, mine: false };
    return null;
  };

  const landed = new Map(); // id → { node, at }
  const specials = L.specials ?? [];

  // 1) 낸 패: 들어 올림 → 내리꽂기
  if (!continuing && L.played.length) {
    const many = L.played.length > 1; // 폭탄
    await Promise.all(
      L.played.map(async (id, i) => {
        const src = sourceOfPlayed(id);
        const to = hitPoint(id);
        if (!src || !to) return newFloor.get(id)?.classList.remove('mv-hidden');
        await sleep(i * 90);
        if (cancelled) return;
        const from = src.rect;
        const node = flyer(id, from, { flip: !src.mine });
        cleanups.push(() => node.remove());
        const spin = (Math.random() - 0.5) * 16;
        const s1 = to.w / from.w;
        play('whoosh');
        const kf = src.mine
          ? [
              { transform: T(from, from, { s: 1 }), offset: 0, easing: EASE_OUT },
              { transform: T(from, from, { s: 1.18, dy: -from.h * 0.32, rot: spin * 0.3 }), offset: 0.3, easing: EASE_IN },
              { transform: T(from, to, { s: s1 * 1.12, rot: spin * 0.15 }), offset: 0.85, easing: 'ease-out' },
              { transform: T(from, to, { s: s1 }), offset: 1 },
            ]
          : [
              { transform: T(from, from, { s: 1, ry: 180 }), offset: 0, easing: EASE_OUT },
              { transform: T(from, { ...from, y: from.y + (to.y - from.y) * 0.4 }, { s: 1.35, rot: spin * 0.3, ry: 0 }), offset: 0.45, easing: EASE_IN },
              { transform: T(from, to, { s: s1 * 1.12, ry: 0 }), offset: 0.86, easing: 'ease-out' },
              { transform: T(from, to, { s: s1, ry: 0 }), offset: 1 },
            ];
        await anim(node, kf, src.mine ? 440 : 520);
        if (cancelled) return;
        landed.set(id, { node, at: to });
        play('slap', 0, many ? 1.4 : 1.15);
        impact(to, { big: many });
        jolt(sameMonthFloor(id), center(to));
        const real = newFloor.get(id);
        if (real) {
          real.classList.remove('mv-hidden');
          node.remove();
          squash(real);
        }
      }),
    );
    if (specials.includes('bomb')) shake(document.querySelector('.hw-table'), 1.6);
    await sleep(L.flipped ? 160 : 260);
    if (cancelled) return;
  }

  // 2) 더미 패: 떠오르며 뒤집혀 보여 준 뒤 떨어진다
  if (!continuing && L.flipped && snap.deck) {
    const id = L.flipped;
    const from = snap.deck;
    let to = hitPoint(id);
    const chooseSlot = g.phase === 'chooseFlip' ? document.querySelector('.choose-box .row .hwc') : null;
    if (chooseSlot) to = rectOf(chooseSlot) ?? to;
    if (!to) to = { ...from };
    const node = flyer(id, from, { flip: true });
    cleanups.push(() => node.remove());
    play('turnover');
    const s1 = to.w / from.w;
    const up = -from.h * 0.28;
    await anim(
      node,
      [
        { transform: T(from, from, { s: 1, ry: 180 }), offset: 0, easing: EASE_OUT },
        { transform: T(from, from, { s: 1.6, dy: up, ry: 0 }), offset: 0.38 },
        { transform: T(from, from, { s: 1.62, dy: up, ry: 0 }), offset: 0.6, easing: EASE_IN },
        { transform: T(from, to, { s: s1 * 1.12 }), offset: 0.9, easing: 'ease-out' },
        { transform: T(from, to, { s: s1 }), offset: 1 },
      ],
      760,
    );
    if (cancelled) return;
    landed.set(id, { node, at: to });
    const bigHit = specials.includes('jjok') || specials.includes('ttadak') || specials.includes('ppeok');
    play('slap', 0, bigHit ? 1.35 : 1.15);
    impact(to, { big: bigHit });
    jolt(sameMonthFloor(id), center(to));
    const real = newFloor.get(id);
    if (real) {
      real.classList.remove('mv-hidden');
      node.remove();
      squash(real);
    }
    if (chooseSlot) node.remove();
    if (bigHit) shake(document.querySelector('.hw-table'), 1.2);
    await sleep(arrivedCapt.length ? 330 : 120);
  } else if (arrivedCapt.length && !continuing) await sleep(120);
  if (cancelled) return;

  // 3) 먹은 패: 바닥에서 달별로 한데 모았다가 먹은 칸으로 쓸려 간다
  const fromFloor = [];
  const stolen = [];
  for (const k of arrivedCapt) {
    const [pid, id] = k.split(':');
    const src = landed.get(id) ?? ghosts.get(id);
    if (src?.node?.isConnected) fromFloor.push({ k, pid, id, node: src.node });
    else stolen.push({ k, pid, id });
  }
  // 애니메이션으로 옮겨진 자리를 기준으로 다시 잡는다
  const settle = (node) => {
    const cur = rectOf(node);
    node.getAnimations().forEach((a) => a.cancel());
    if (!cur) return null;
    node.style.left = `${cur.x}px`;
    node.style.top = `${cur.y}px`;
    node.style.setProperty('--w', `${cur.w}px`);
    return cur;
  };
  const byMonth = new Map();
  for (const it of fromFloor) {
    const m = monthOf(it.id);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(it);
  }
  const gathers = [];
  for (const items of byMonth.values()) {
    const anchor = settle(items[0].node);
    items.slice(1).forEach((it, j) => {
      const cur = settle(it.node);
      if (!cur || !anchor) return;
      const dest = { x: anchor.x + (j + 1) * 3, y: anchor.y - (j + 1) * 3, w: anchor.w, h: anchor.h };
      it.node.style.zIndex = String(61 + j);
      gathers.push(anim(it.node, [{ transform: T(cur, cur, { s: 1 }) }, { transform: T(cur, dest, { s: 1 }) }], 150));
    });
  }
  if (gathers.length) {
    await Promise.all(gathers);
    play('place');
    await sleep(70);
  }
  if (cancelled) return;
  if (fromFloor.length) play('take', 0, fromFloor.length);
  const sweeps = fromFloor.map(async (it, i) => {
    const dest = newCapt.get(it.k);
    const to = rectOf(dest);
    const node = it.node;
    const cur = settle(node);
    if (!to || !cur) {
      node.remove();
      return dest?.classList.remove('mv-hidden');
    }
    await sleep(i * 40);
    if (cancelled) return;
    const mid = { x: (cur.x + to.x) / 2, y: Math.min(cur.y, to.y) - 30, w: cur.w, h: cur.h };
    await anim(
      node,
      [
        { transform: T(cur, cur, { s: 1 }), easing: 'ease-in' },
        { transform: T(cur, mid, { s: ((1 + to.w / cur.w) / 2) * 1.05, rot: -4 }), offset: 0.45, easing: 'cubic-bezier(.3,.6,.3,1)' },
        { transform: T(cur, to, { s: to.w / cur.w }) },
      ],
      420,
    );
    dest.classList.remove('mv-hidden');
    node.remove();
    dest.animate([{ transform: 'translateY(-4px)' }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
  });
  // 뺏은 피: 상대 먹은 칸의 옛 자리에서 날아온다
  const steals = stolen.map(async ({ k, pid, id }, i) => {
    const dest = newCapt.get(k);
    const to = rectOf(dest);
    const victim = [...snap.capt.keys()].find((kk) => kk.endsWith(`:${id}`) && !kk.startsWith(`${pid}:`));
    const fromRect = victim ? snap.capt.get(victim) : null;
    if (!fromRect || !to) return dest?.classList.remove('mv-hidden');
    await sleep(260 + i * 120);
    if (cancelled) return;
    const node = flyer(id, fromRect);
    cleanups.push(() => node.remove());
    const mid = { x: (fromRect.x + to.x) / 2, y: Math.min(fromRect.y, to.y) - 60, w: fromRect.w, h: fromRect.h };
    await anim(node, [{ transform: T(fromRect, fromRect, { s: 1 }) }, { transform: T(fromRect, mid, { s: 1.6, rot: 10 }), offset: 0.5 }, { transform: T(fromRect, to, { s: to.w / fromRect.w }) }], 560);
    dest.classList.remove('mv-hidden');
    node.remove();
  });
  await Promise.all([...sweeps, ...steals]);
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
    console.warn('[motion]', e);
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
  const lay = async (n, i, gap, lift) => {
    await sleep(i * gap);
    const to = rectOf(n);
    if (!to) return n.classList.remove('mv-hidden');
    const start = { x: src.x, y: src.y, w: to.w * 0.7, h: to.w * 0.7 * RATIO };
    const f = flyer(n.dataset.id, start, { flip: true });
    extras.push(f);
    play('deal');
    const spin = (Math.random() - 0.5) * 30;
    await anim(
      f,
      [
        { transform: T(start, start, { s: 1, ry: 180, rot: spin }), easing: EASE_OUT },
        { transform: T(start, { ...to, y: Math.min(to.y, start.y) - lift }, { s: (to.w / start.w) * 1.15, ry: 90, rot: spin * 0.4 }), offset: 0.55, easing: EASE_IN },
        { transform: T(start, to, { s: to.w / start.w, ry: 0 }) },
      ],
      380,
    );
    play('place');
    n.classList.remove('mv-hidden');
    f.remove();
    squash(n);
  };
  // 바닥 먼저, 그다음 내 손패
  await Promise.all(floor.map((n, i) => lay(n, i, 110, 30)));
  await Promise.all(hand.map((n, i) => lay(n, i, 70, 60)));
  done();
  running = running.filter((f) => f !== done);
}
