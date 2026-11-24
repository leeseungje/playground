// 트럼프 카드 그리기 (앞면은 SVG 무늬, 뒷면은 CSS 무늬, 뒤집기는 3D 회전)
import { el, svg } from './util.js';

export const RANK = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const SUIT_NAME = { s: '스페이드', h: '하트', d: '다이아', c: '클로버' };
export const rankText = (r) => RANK[r] ?? String(r);
export const isRed = (s) => s === 'h' || s === 'd';
export const sameCard = (a, b) => !!a && !!b && typeof a === 'object' && typeof b === 'object' && a.r === b.r && a.s === b.s;

/** 무늬 SVG (viewBox 0 0 100 100) */
export function suitIcon(s, cls = '') {
  const attrs = { viewBox: '0 0 100 100', class: `suit-icon ${cls}`, 'aria-hidden': 'true' };
  switch (s) {
    case 'h':
      return svg('svg', attrs, svg('path', { d: 'M50 90 C22 68 4 50 4 30 C4 14 16 4 30 4 C40 4 47 10 50 18 C53 10 60 4 70 4 C84 4 96 14 96 30 C96 50 78 68 50 90Z' }));
    case 'd':
      return svg('svg', attrs, svg('path', { d: 'M50 3 L86 50 L50 97 L14 50Z' }));
    case 's':
      return svg(
        'svg',
        attrs,
        svg('path', { d: 'M50 4 C36 24 6 40 6 61 C6 75 17 83 29 83 C38 83 44 79 47 73 C46 83 42 90 33 96 L67 96 C58 90 54 83 53 73 C56 79 62 83 71 83 C83 83 94 75 94 61 C94 40 64 24 50 4Z' }),
      );
    case 'c':
      return svg(
        'svg',
        attrs,
        svg('circle', { cx: 50, cy: 27, r: 20 }),
        svg('circle', { cx: 27, cy: 57, r: 20 }),
        svg('circle', { cx: 73, cy: 57, r: 20 }),
        svg('path', { d: 'M45 50 C45 74 40 87 31 96 L69 96 C60 87 55 74 55 50Z' }),
      );
    default:
      return svg('svg', attrs);
  }
}

function front(card) {
  const r = rankText(card.r);
  const face = card.r >= 11 && card.r <= 13;
  const corner = (cls) => el('div', { class: `pc-corner ${cls}` }, el('span', { class: 'pc-rank' }, r), suitIcon(card.s, 'pc-corner-suit'));
  const center = face
    ? el('div', { class: 'pc-center pc-court' }, el('span', { class: 'pc-court-letter' }, r), suitIcon(card.s, 'pc-court-suit'))
    : card.r === 14
      ? el('div', { class: 'pc-center pc-ace' }, suitIcon(card.s, 'pc-big'))
      : el('div', { class: 'pc-center' }, suitIcon(card.s, 'pc-big'));
  return [corner('tl'), center, corner('br')];
}

/** 카드 한 장. size: 'sm' | 'md' | 'lg' */
export function createCard(size = 'md') {
  const frontEl = el('div', { class: 'pc-face pc-front' });
  const backEl = el('div', { class: 'pc-face pc-back' }, el('div', { class: 'pc-back-emblem' }, '♠'));
  const inner = el('div', { class: 'pc-inner' }, frontEl, backEl);
  const root = el('div', { class: `pcard ${size} is-back is-empty` }, inner);
  root._front = frontEl;
  root._value = null;
  return root;
}

/**
 * 카드 값을 바꾼다. 'back' 이면 뒷면, null 이면 빈 자리.
 * 뒷면 → 앞면으로 바뀌면 3D 뒤집기가 CSS 전환으로 재생된다. 바뀌었으면 true.
 */
export function setCard(root, value, { flip = true } = {}) {
  const prev = root._value;
  const same = value === prev || (sameCard(value, prev) && typeof value === 'object');
  if (same) return false;
  root._value = value;
  root.classList.toggle('is-empty', value == null);
  if (value && typeof value === 'object') {
    root._front.replaceChildren(...front(value));
    root.classList.toggle('red', isRed(value.s));
    root.setAttribute('aria-label', `${SUIT_NAME[value.s]} ${rankText(value.r)}`);
    if (!flip) {
      root.classList.add('no-anim');
      root.classList.remove('is-back');
      void root.offsetWidth;
      root.classList.remove('no-anim');
    } else root.classList.remove('is-back');
  } else {
    root.classList.add('is-back');
    root.setAttribute('aria-label', value === 'back' ? '뒷면 카드' : '빈 자리');
  }
  return true;
}

/** 기록 패널용 작은 정적 카드 */
export function miniCard(card) {
  if (!card || typeof card !== 'object') return el('span', { class: 'mini-card back' });
  return el('span', { class: `mini-card${isRed(card.s) ? ' red' : ''}`, title: `${SUIT_NAME[card.s]} ${rankText(card.r)}` }, rankText(card.r), suitIcon(card.s, 'mini-suit'));
}
