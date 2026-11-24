// 테이블(무대) 그리기와 연출. 고정 좌표 무대를 화면에 맞춰 확대·축소한다.
import { el, svg, fmt, short, hueOf, initial, reducedMotion } from './util.js';
import { createCard, setCard, sameCard } from './cards.js';
import { createStack, flyingChips } from './chips.js';
import { createDealer } from './dealer.js';
import { play } from './sound.js';

const LAYOUTS = {
  landscape: {
    W: 1280, H: 720,
    cx: 640, cy: 352,
    rail: [492, 250], // 테이블 바깥 반지름
    seat: [528, 270], // 좌석이 놓이는 타원
    me: [640, 640],
    board: [640, 340],
    pot: [640, 262],
    dealer: [640, 58],
    gap: 26,
  },
  // 세로 휴대폰 화면 비율(약 0.68)에 맞춘 무대. 좌석은 작은 명패를 쓴다
  portrait: {
    W: 560, H: 840,
    cx: 280, cy: 432,
    rail: [238, 318],
    seat: [222, 350],
    me: [280, 782],
    board: [280, 420],
    pot: [280, 336],
    dealer: [280, 50],
    gap: 44,
  },
};

function portraitLayout(H) {
  const cy = Math.round(H / 2 + 14);
  const ry = Math.round(H / 2 - 104);
  return {
    W: 560, H,
    cx: 280, cy,
    rail: [238, ry],
    seat: [204, ry + 30],
    me: [280, H - 56],
    board: [280, cy - 10],
    pot: [280, cy - 94],
    dealer: [280, 50],
    gap: 44,
  };
}

const RING_R = 33;
const RING_C = 2 * Math.PI * RING_R;

/** 좌석 위치: 나는 맨 아래, 시계 방향(왼쪽 위로)으로 진행, 맨 위 딜러 자리는 비운다 */
function seatPoints(n, L) {
  const pts = [L.me];
  if (n <= 1) return pts;
  const others = n - 1;
  const gap = L.gap ?? 26; // 맨 위(270°) 양쪽으로 딜러 자리로 비우는 각도
  const span = 180 - gap; // 왼쪽: 90° → 244°, 오른쪽: 296° → 450°
  const deg = [];
  if (others === 1) deg.push(270 - gap); // 헤즈업: 딜러 옆 왼쪽 위
  else {
    const left = Math.ceil(others / 2);
    const right = others - left;
    for (let i = 1; i <= left; i++) deg.push(90 + (span * i) / left);
    for (let i = right; i >= 1; i--) deg.push(450 - (span * i) / right);
  }
  for (const d of deg) {
    const a = (d * Math.PI) / 180;
    pts.push([L.cx + L.seat[0] * Math.cos(a), L.cy + L.seat[1] * Math.sin(a)]);
  }
  return pts;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function createTable(rootWrap, { onSeatClick } = {}) {
  const fx = el('div', { class: 'fx-layer' });
  const felt = el(
    'div',
    { class: 'table-rail' },
    el('div', { class: 'table-felt' }, el('div', { class: 'felt-line' }), el('div', { class: 'felt-logo' }, el('span', {}, '♠'), " HOLD'EM ", el('span', {}, '♥'))),
  );
  const dealer = createDealer();
  const boardEls = Array.from({ length: 5 }, () => createCard('md'));
  const board = el('div', { class: 'board' }, boardEls.map((c) => el('div', { class: 'board-slot' }, c)));
  const potStack = createStack({ label: false, cls: 'pot-stack' });
  const potLabel = el('div', { class: 'pot-label' });
  const pot = el('div', { class: 'pot' }, potStack, potLabel);
  const banner = el('div', { class: 'banner' });
  const dealerBtn = el('div', { class: 'dealer-btn', title: '딜러 버튼' }, 'D');
  const seatsLayer = el('div', { class: 'seats-layer' });
  const betsLayer = el('div', { class: 'bets-layer' });
  const stage = el('div', { class: 'stage' }, felt, dealer.root, board, pot, betsLayer, dealerBtn, seatsLayer, banner, fx);
  rootWrap.append(stage);

  let mode = 'landscape';
  let L = LAYOUTS[mode];
  let scale = 1;
  const seats = new Map(); // pid → 좌석 요소 묶음
  const holds = new Map(); // 카드 요소 → 이 시각까지 뒷면 유지 (딜·공개 연출)
  let potHold = { until: 0, value: 0 };
  let winHold = { until: 0, payouts: {} };
  let state = null;
  let prev = null;
  let rerenderTimer = null;

  // ───────── 크기 맞추기 ─────────
  function fit() {
    const w = rootWrap.clientWidth;
    const h = rootWrap.clientHeight;
    if (!w || !h) return;
    const nextMode = w / h >= 1.2 ? 'landscape' : 'portrait';
    // 세로 화면은 높이를 화면 비율에 맞춰 늘려 빈 공간 없이 채운다
    const nextL = nextMode === 'portrait' ? portraitLayout(Math.round(Math.min(1100, Math.max(760, (560 * h) / w)))) : LAYOUTS.landscape;
    if (nextMode !== mode || nextL.H !== L.H) {
      mode = nextMode;
      L = nextL;
      stage.dataset.mode = mode;
      if (state) layout(true);
    }
    scale = Math.min(w / L.W, h / L.H);
    stage.style.width = `${L.W}px`;
    stage.style.height = `${L.H}px`;
    stage.style.transform = `translate(${(w - L.W * scale) / 2}px, ${(h - L.H * scale) / 2}px) scale(${scale})`;
    place(felt, [L.cx, L.cy]);
    felt.style.width = `${L.rail[0] * 2}px`;
    felt.style.height = `${L.rail[1] * 2}px`;
    place(dealer.root, L.dealer);
    place(board, L.board);
    place(pot, L.pot);
    place(banner, [L.board[0], L.board[1] + (mode === 'landscape' ? 100 : 96)]);
  }
  stage.dataset.mode = mode;
  new ResizeObserver(fit).observe(rootWrap);

  function place(node, [x, y]) {
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  /** 요소 중심의 무대 좌표 */
  function posOf(node) {
    const r = node.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return [(r.left + r.width / 2 - s.left) / scale, (r.top + r.height / 2 - s.top) / scale];
  }

  // ───────── 좌석 ─────────
  function makeSeat(p) {
    const ring = svg(
      'svg',
      { class: 'ring', viewBox: '0 0 76 76', 'aria-hidden': 'true' },
      svg('circle', { class: 'ring-bg', cx: 38, cy: 38, r: RING_R }),
      svg('circle', { class: 'ring-fg', cx: 38, cy: 38, r: RING_R, 'stroke-dasharray': RING_C, 'stroke-dashoffset': 0 }),
    );
    const avatar = el('div', { class: 'avatar' }, el('span', { class: 'avatar-letter' }), ring);
    const name = el('div', { class: 'seat-name' });
    const chips = el('div', { class: 'seat-chips' });
    const plate = el('div', { class: 'seat-plate' }, avatar, el('div', { class: 'seat-info' }, name, chips));
    const cardEls = [createCard(p.id === state.me ? 'lg' : 'sm'), createCard(p.id === state.me ? 'lg' : 'sm')];
    const cards = el('div', { class: 'seat-cards' }, cardEls);
    const status = el('div', { class: 'seat-status' });
    const handName = el('div', { class: 'seat-hand' });
    const tags = el('div', { class: 'seat-tags' });
    const bubble = el('div', { class: 'seat-bubble' });
    const root = el('div', { class: 'seat', dataset: { pid: p.id } }, cards, plate, status, handName, tags, bubble);
    root.addEventListener('click', () => onSeatClick?.(p.id));
    const bet = createStack({ cls: 'bet-stack' });
    betsLayer.append(bet);
    seatsLayer.append(root);
    const s = { root, plate, avatar, ring: ring.querySelector('.ring-fg'), name, chips, cards, cardEls, status, handName, tags, bubble, bet, pos: [0, 0], betPos: [0, 0], lastStatus: '' };
    avatar.style.setProperty('--hue', hueOf(p.name));
    avatar.querySelector('.avatar-letter').textContent = initial(p.name);
    return s;
  }

  function layout(instant = false) {
    const list = state.players;
    const myIdx = Math.max(0, list.findIndex((p) => p.id === state.me));
    const ordered = list.map((_, i) => list[(myIdx + i) % list.length]);
    const pts = seatPoints(ordered.length, L);
    ordered.forEach((p, k) => {
      const s = seats.get(p.id);
      if (!s) return;
      const pos = pts[k];
      s.pos = pos;
      if (instant) s.root.classList.add('no-move');
      place(s.root, pos);
      // 카드는 테이블 안쪽으로, 베팅 칩은 좌석과 가운데 사이
      const center = [L.cx, L.cy];
      const v = [center[0] - pos[0], center[1] - pos[1]];
      const len = Math.hypot(...v) || 1;
      const u = [v[0] / len, v[1] / len];
      const isMe = p.id === state.me;
      s.root.classList.toggle('me', isMe);
      s.root.dataset.side = isMe ? 'me' : Math.abs(u[1]) > 0.55 ? (u[1] > 0 ? 'top' : 'bottom') : u[0] > 0 ? 'left' : 'right';
      // 옆자리는 명패(가로 200px)에 가리지 않게 가로로 더 들어가게
      const compact = mode === 'portrait';
      const cardOff = isMe ? [0, compact ? -100 : -108] : [u[0] * (compact ? 96 : 128), u[1] * (compact ? 58 : 66)];
      s.cards.style.transform = `translate(calc(-50% + ${cardOff[0]}px), calc(-50% + ${cardOff[1]}px))`;
      s.betPos = isMe ? [pos[0], pos[1] - (compact ? 196 : 218)] : lerp(pos, center, compact ? 0.45 : 0.42);
      place(s.bet, s.betPos);
      if (instant) requestAnimationFrame(() => s.root.classList.remove('no-move'));
    });
  }

  // ───────── 연출 도우미 ─────────
  function fly(node, from, to, { duration = 520, delay = 0, arc = 40, remove = true, easing = 'cubic-bezier(.25,.8,.25,1)' } = {}) {
    if (reducedMotion()) duration = 1;
    fx.append(node);
    place(node, from);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const anim = node.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 0.9 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - arc}px))`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 1 },
      ],
      { duration, delay, easing, fill: 'both' },
    );
    return anim.finished.then(() => remove && node.remove()).catch(() => node.remove());
  }

  function hold(cardEl, ms) {
    holds.set(cardEl, performance.now() + ms);
    armHoldTimer();
  }

  /** 아직 남은 '뒷면 유지' 중 가장 빨리 끝나는 시각에 카드를 다시 그린다 */
  function armHoldTimer() {
    clearTimeout(rerenderTimer);
    const now = performance.now();
    for (const [c, t] of holds) if (t <= now) holds.delete(c);
    if (!holds.size) return;
    const next = Math.min(...holds.values()) - now;
    rerenderTimer = setTimeout(() => state && renderCards(), next + 5);
  }

  function held(cardEl) {
    const t = holds.get(cardEl);
    if (t == null) return false;
    if (performance.now() >= t) {
      holds.delete(cardEl);
      return false;
    }
    return true;
  }

  function dealIn(cardEl, delay, from = L.dealer) {
    const to = posOf(cardEl);
    const dx = from[0] - to[0];
    const dy = from[1] + 30 - to[1];
    if (reducedMotion()) return;
    cardEl.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(-30deg) scale(.45)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 460, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
    );
  }

  // ───────── 이벤트 (렌더 전: 카드 공개 지연 / 렌더 후: 날아가는 연출·효과음) ─────────
  function preEvents(evs) {
    for (const e of evs) {
      if (e.type === 'deal') {
        // 각 좌석에 두 바퀴. 내 카드는 다 돌린 뒤 뒤집는다
        const n = e.order.length;
        const total = n * 2 * 90 + 460;
        const me = e.order.indexOf(state.me);
        if (me >= 0) {
          const s = seats.get(state.me);
          if (s) s.cardEls.forEach((c) => hold(c, total + 120));
        }
      }
      if (e.type === 'street') {
        const start = e.street === 'flop' ? 0 : e.street === 'turn' ? 3 : 4;
        const count = e.street === 'flop' ? 3 : 1;
        for (let i = 0; i < count; i++) hold(boardEls[start + i], 420 + i * 160 + 120);
      }
    }
    // 쇼다운·올인 공개: 좌석마다 조금씩 늦게 뒤집기
    let k = 0;
    for (const p of state.players) {
      const s = seats.get(p.id);
      const before = prev?.players.find((x) => x.id === p.id);
      if (!s || p.id === state.me || !p.cards || !before?.cards) continue;
      if (before.cards[0] === 'back' && p.cards[0] !== 'back' && state.hand?.no === prev?.hand?.no) {
        s.cardEls.forEach((c) => hold(c, 250 + k * 380));
        k++;
      }
    }
  }

  function postEvents(evs) {
    const banners = [];
    for (const e of evs) {
      switch (e.type) {
        case 'deal': {
          let i = 0;
          for (let round = 0; round < 2; round++)
            for (const pid of e.order) {
              const s = seats.get(pid);
              if (!s) continue;
              dealIn(s.cardEls[round], i * 90);
              play('deal', i * 90);
              i++;
            }
          dealer.say(state.dealerLine);
          break;
        }
        case 'street': {
          const start = e.street === 'flop' ? 0 : e.street === 'turn' ? 3 : 4;
          const count = e.street === 'flop' ? 3 : 1;
          for (let i = 0; i < count; i++) {
            dealIn(boardEls[start + i], i * 160);
            play('deal', i * 160);
            play('flip', 420 + i * 160);
          }
          break;
        }
        case 'action': {
          const s = seats.get(e.pid);
          if (!s) break;
          flashStatus(s, e.action);
          if (e.action === 'fold') {
            play('fold');
            if (e.pid !== state.me && !reducedMotion()) {
              for (let i = 0; i < 2; i++) {
                const g = createCard('sm');
                setCard(g, 'back', { flip: false });
                g.classList.add('ghost');
                const from = posOf(s.cards);
                fly(g, [from[0] + (i ? 12 : -12), from[1]], [L.cx + (i ? 10 : -10), L.cy - 10], { duration: 420, delay: i * 40, arc: 10 }).then(() => {});
                g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 200 + i * 40, fill: 'forwards' });
              }
            }
          } else if (e.action === 'check') play('check');
          else {
            if (e.amount > 0 && !reducedMotion()) {
              const from = s.pos;
              const to = s.betPos;
              s.bet.animate(
                [
                  { transform: `translate(calc(-50% + ${from[0] - to[0]}px), calc(-50% + ${from[1] - to[1]}px)) scale(.7)`, opacity: 0.4 },
                  { transform: 'translate(-50%, -50%)', opacity: 1 },
                ],
                { duration: 380, easing: 'cubic-bezier(.25,.8,.25,1)' },
              );
            }
            play(e.action === 'allin' ? 'allin' : 'chips', 0, e.action === 'call' ? 3 : 4);
          }
          break;
        }
        case 'collect': {
          // 이전 상태의 베팅을 가운데로 모은다
          let i = 0;
          for (const p of prev?.players ?? []) {
            const s = seats.get(p.id);
            if (!s || !p.bet) continue;
            fly(flyingChips(p.bet), s.betPos, L.pot, { duration: 480, delay: i * 50, arc: 20 });
            i++;
          }
          if (i) {
            potHold = { until: performance.now() + 480 + i * 50, value: prev?.hand?.collected ?? 0 };
            renderPot();
            setTimeout(renderPot, 480 + i * 50 + 10);
            play('chips', 350, 4);
          }
          break;
        }
        case 'reveal':
          dealer.mood('surprised', 2000);
          break;
        case 'win': {
          const results = state.hand?.results;
          const payouts = Object.entries(e.payouts || {});
          const collectedNow = evs.some((x) => x.type === 'collect');
          // 모이지 않은 베팅(모두 폴드로 끝난 경우)은 바로 승자에게
          const winnerIds = payouts.map(([id]) => id);
          let i = 0;
          if (!collectedNow) {
            for (const p of prev?.players ?? []) {
              const s = seats.get(p.id);
              if (!s || !p.bet || !winnerIds.length) continue;
              const w = seats.get(winnerIds[0]);
              if (w) fly(flyingChips(p.bet), s.betPos, w.pos, { duration: 600, delay: 300 + i * 60, arc: 30 });
              i++;
            }
          }
          const delay = results?.type === 'showdown' ? 1400 : 500;
          potHold = { until: performance.now() + delay, value: state.hand?.pot ?? 0 };
          renderPot();
          setTimeout(renderPot, delay + 10);
          // 승자 칩 숫자는 칩이 도착할 때 올린다
          winHold = { until: performance.now() + delay + 700 + payouts.length * 120, payouts: e.payouts || {} };
          renderChips();
          setTimeout(renderChips, winHold.until - performance.now() + 10);
          payouts.forEach(([id, amt], j) => {
            const w = seats.get(id);
            if (!w) return;
            setTimeout(() => {
              fly(flyingChips(amt), L.pot, w.pos, { duration: 700, arc: 50 });
              w.root.classList.add('winner');
              setTimeout(() => w.root.classList.remove('winner'), 3600);
              const plus = el('div', { class: 'win-plus' }, `+${fmt(amt)}`);
              w.root.append(plus);
              setTimeout(() => plus.remove(), 2600);
            }, delay + j * 120);
          });
          const iWon = winnerIds.includes(state.me);
          setTimeout(() => play(iWon ? 'win' : 'pot'), delay);
          dealer.mood('happy', 3000);
          if (results) banners.push(bannerText(results));
          break;
        }
        case 'blinds':
          play('bell');
          banners.push({ text: `블라인드 상승 ${fmt(e.sb)} / ${fmt(e.bb)}`, cls: 'blinds' });
          break;
        case 'turn':
          if (e.pid === state.me) play('turn');
          break;
        case 'join':
          play('join');
          break;
        case 'rebuy':
          play('chips', 0, 5);
          break;
        default:
      }
    }
    if (banners.length) showBanner(banners.at(-1));
  }

  function bannerText(r) {
    const name = (id) => state.players.find((p) => p.id === id)?.name ?? '?';
    const ids = Object.keys(r.payouts);
    if (r.type === 'fold') return { text: `${name(ids[0])}님이 팟을 가져갑니다`, cls: 'win' };
    if (ids.length === 1) return { text: `${name(ids[0])}님 승리 · ${r.hands[ids[0]]?.detail ?? ''}`, cls: 'win' };
    return { text: `${ids.map(name).join(', ')} 나눠 가짐`, cls: 'win' };
  }

  let bannerTimer = null;
  function showBanner({ text, cls }) {
    const delay = cls === 'win' && state.hand?.results?.type === 'showdown' ? 1300 : 300;
    setTimeout(() => {
      banner.textContent = text;
      banner.className = `banner show ${cls}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => (banner.className = 'banner'), 3400);
    }, delay);
  }

  const STATUS = { fold: ['폴드', 'fold'], check: ['체크', 'check'], call: ['콜', 'call'], bet: ['벳', 'bet'], raise: ['레이즈', 'raise'], allin: ['올인!', 'allin'] };
  function flashStatus(s, action) {
    const [text, cls] = STATUS[action] ?? [action, ''];
    s.status.textContent = text;
    s.status.className = `seat-status show ${cls}`;
    clearTimeout(s.statusTimer);
    s.statusTimer = setTimeout(() => s.status.classList.remove('show'), action === 'fold' || action === 'allin' ? 99999 : 2200);
  }

  // ───────── 렌더 ─────────
  function renderCards() {
    const h = state.hand;
    const best = myBestCards();
    const winners = winningCards();
    for (const p of state.players) {
      const s = seats.get(p.id);
      if (!s) continue;
      const cards = p.cards;
      s.cardEls.forEach((c, i) => {
        let v = cards ? cards[i] ?? null : null;
        if (v && v !== 'back' && held(c)) v = 'back';
        if (setCard(c, v) && v && v !== 'back' && c._wasBack) play('flip');
        c._wasBack = v === 'back';
        const inBest = v && typeof v === 'object' && (winners.length ? winners : p.id === state.me ? best : []).some((w) => sameCard(w, v));
        c.classList.toggle('glow', !!inBest);
        c.classList.toggle('dim', !!(winners.length && v && typeof v === 'object' && !inBest && h?.results?.type === 'showdown'));
      });
      s.cards.classList.toggle('mucked', p.folded);
      // 쇼다운 족보: 카드가 다 뒤집힌 뒤에 보여 준다
      const r = h?.results;
      const flipping = s.cardEls.some((c) => holds.has(c) && holds.get(c) > performance.now());
      const hn = r && h.street === 'done' && !flipping ? r.hands?.[p.id] ?? null : null;
      s.handName.textContent = hn ? hn.detail : '';
      s.handName.classList.toggle('show', !!hn);
      s.handName.classList.toggle('won', !!(hn && r.payouts[p.id]));
    }
    boardEls.forEach((c, i) => {
      let v = h?.board?.[i] ?? null;
      if (v && held(c)) v = 'back';
      setCard(c, v);
      const lit = v && typeof v === 'object' && (winners.length ? winners : best).some((w) => sameCard(w, v));
      c.classList.toggle('glow', !!lit);
      c.classList.toggle('dim', !!(winners.length && v && typeof v === 'object' && !lit));
    });
    armHoldTimer();
  }

  let bestCache = { key: '', cards: [] };
  let evalFn = null;
  import('/shared/hand-eval.js').then((m) => (evalFn = m.currentHand)).catch(() => {});
  function myBestCards() {
    const me = state.players.find((p) => p.id === state.me);
    if (!evalFn || !me?.cards || me.cards[0] === 'back' || me.folded) return [];
    const all = [...me.cards, ...(state.hand?.board ?? [])].filter((c) => c && typeof c === 'object');
    const key = JSON.stringify(all);
    if (key !== bestCache.key) {
      const r = all.length >= 2 ? evalFn(all) : null;
      // 하이카드는 강조하지 않고, 페어·투페어·트리플·포카드는 짝이 맞는 카드만 강조한다
      bestCache = { key, cards: r && r.score[0] > 0 ? madeCards(r.score, r.cards) : [] };
    }
    return bestCache.cards;
  }

  function winningCards() {
    const r = state.hand?.results;
    if (!r || r.type !== 'showdown' || state.hand.street !== 'done') return [];
    return [...new Set(Object.keys(r.payouts))].flatMap((id) => r.hands[id]?.cards ?? []);
  }

  /** 족보를 만드는 카드만 (키커 제외) */
  function madeCards(score, cards) {
    if (![1, 2, 3, 7].includes(score[0])) return cards;
    const count = {};
    for (const c of cards) count[c.r] = (count[c.r] || 0) + 1;
    return cards.filter((c) => count[c.r] >= 2);
  }

  function renderChips() {
    if (!state) return;
    const holding = performance.now() < winHold.until;
    for (const p of state.players) {
      const s = seats.get(p.id);
      if (!s) continue;
      const shown = holding ? p.chips - (winHold.payouts[p.id] || 0) : p.chips;
      s.chips.textContent = p.spectator ? '구경 중' : fmt(shown);
    }
  }

  function renderPot() {
    const h = state?.hand;
    let value = h ? (h.street === 'done' ? 0 : h.collected) : 0;
    if (h && performance.now() < potHold.until) value = potHold.value;
    potStack.update(value);
    const total = h && h.street !== 'done' ? h.pot : performance.now() < potHold.until ? potHold.value : 0;
    potLabel.textContent = total ? `팟 ${fmt(total)}` : '';
    pot.classList.toggle('empty', !total);
  }

  function render(next, newEvents) {
    prev = state;
    state = next;
    const ids = new Set(state.players.map((p) => p.id));
    let changedSeats = false;
    for (const p of state.players)
      if (!seats.has(p.id)) {
        seats.set(p.id, makeSeat(p));
        changedSeats = true;
      }
    for (const [id, s] of seats)
      if (!ids.has(id)) {
        s.root.classList.add('leaving');
        s.bet.remove();
        setTimeout(() => s.root.remove(), 400);
        seats.delete(id);
        changedSeats = true;
      }
    if (changedSeats || !prev || prev.players.map((p) => p.id).join() !== state.players.map((p) => p.id).join()) layout(!prev);

    preEvents(newEvents);

    const h = state.hand;
    const live = h && h.street !== 'done';
    for (const p of state.players) {
      const s = seats.get(p.id);
      s.name.textContent = p.name + (p.id === state.me ? ' (나)' : '');
      s.root.classList.toggle('active', !!live && h.toActId === p.id);
      s.root.classList.toggle('folded', !!live && p.folded);
      s.root.classList.toggle('sitout', !h || !p.dealtIn);
      s.root.classList.toggle('waiting', !!live && !p.dealtIn);
      s.root.classList.toggle('away', !p.connected);
      s.root.classList.toggle('busted', p.chips === 0 && !p.inHand);
      s.root.classList.toggle('host', state.hostId === p.id);
      // 상태 꼬리표
      const tags = [];
      if (live && h.sbId === p.id) tags.push(['SB', 'sb']);
      if (live && h.bbId === p.id) tags.push(['BB', 'bb']);
      if (!p.connected) tags.push(['끊김', 'away']);
      else if (live && !p.dealtIn) tags.push(['대기', 'wait']);
      if (p.place) tags.push([`${p.place}위`, 'place']);
      s.tags.replaceChildren(...tags.map(([t, c]) => el('span', { class: `tag ${c}` }, t)));
      // 베팅
      s.bet.update(live ? p.bet : 0);
      // 지난 판의 '폴드/올인' 표시는 새 판에서 지운다
      if (!live || (prev?.hand?.no !== h?.no)) {
        if (s.status.classList.contains('show') && (!live || prev?.hand?.no !== h?.no)) {
          s.status.classList.remove('show');
        }
      }
    }

    // 딜러 버튼
    if (h) {
      const b = seats.get(h.buttonId);
      if (b) {
        const center = [L.cx, L.cy];
        const v = [center[0] - b.pos[0], center[1] - b.pos[1]];
        const len = Math.hypot(...v) || 1;
        const perp = [-v[1] / len, v[0] / len];
        const base = lerp(b.pos, center, b.root.classList.contains('me') ? 0.25 : 0.27);
        place(dealerBtn, [base[0] + perp[0] * 78, base[1] + perp[1] * 78]);
        dealerBtn.classList.add('show');
      }
    } else dealerBtn.classList.remove('show');

    renderCards();
    renderPot();
    renderChips();
    if (!newEvents.some((e) => e.type === 'deal')) dealer.say(state.dealerLine);
    postEvents(newEvents);
  }

  // ───────── 차례 타이머 고리 ─────────
  let lastTick = 0;
  function tick() {
    if (state?.hand && state.hand.toActId) {
      const s = seats.get(state.hand.toActId);
      const total = state.hand.turnMsTotal || 1;
      const left = Math.max(0, state.hand.turnMsLeft - (performance.now() - state.receivedAt));
      if (s) {
        const f = left / total;
        s.ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - f)));
        s.ring.style.stroke = f > 0.5 ? '#7fe0a6' : f > 0.25 ? '#f1c04b' : '#ff6b5e';
        if (state.hand.toActId === state.me && left > 0 && left <= 5000) {
          const sec = Math.ceil(left / 1000);
          if (sec !== lastTick) {
            lastTick = sec;
            play('tick');
          }
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ───────── 채팅·이모지 말풍선 ─────────
  function bubble(pid, content, kind) {
    const s = seats.get(pid);
    if (!s) return;
    if (kind === 'emoji') {
      const e = el('div', { class: 'emoji-float' }, content);
      s.root.append(e);
      setTimeout(() => e.remove(), 2200);
      return;
    }
    s.bubble.textContent = content;
    s.bubble.classList.remove('show');
    void s.bubble.offsetWidth;
    s.bubble.classList.add('show');
    clearTimeout(s.bubbleTimer);
    s.bubbleTimer = setTimeout(() => s.bubble.classList.remove('show'), 4000);
  }

  return { render, fit, bubble, dealer, get scale() { return scale; }, stage };
}

export const _test = { seatPoints, LAYOUTS };
