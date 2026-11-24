// 칩 더미 그리기
import { el, short } from './util.js';

const DENOMS = [100000, 25000, 5000, 1000, 500, 100, 25, 5, 1];

/** 금액을 칩 색 목록으로 (최대 max개, 큰 칩부터) */
export function breakdown(amount, max = 7) {
  const out = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of DENOMS) {
    while (left >= d && out.length < max) {
      out.push(d);
      left -= d;
    }
    if (out.length >= max) break;
  }
  return out.reverse(); // 아래에 작은 칩, 위에 큰 칩이 보이도록
}

function chipEl(d, i) {
  return el('i', { class: `chip c${d}`, style: { '--i': i } });
}

/** 칩 더미 + 금액 라벨. 같은 요소를 계속 갱신할 수 있게 update 를 붙여 돌려준다 */
export function createStack({ label = true, cls = '' } = {}) {
  const pile = el('span', { class: 'pile' });
  const amt = label ? el('span', { class: 'stack-amt' }) : null;
  const root = el('div', { class: `stack ${cls}` }, pile, amt);
  root._amount = -1;
  root.update = (amount) => {
    if (amount === root._amount) return;
    root._amount = amount;
    root.classList.toggle('empty', !amount);
    pile.replaceChildren(...breakdown(amount).map(chipEl));
    if (amt) amt.textContent = amount ? short(amount) : '';
  };
  return root;
}

/** 날아가는 칩 (애니메이션용 임시 요소) */
export function flyingChips(amount) {
  const n = Math.min(5, Math.max(1, breakdown(amount, 5).length));
  const pile = el('span', { class: 'pile' }, breakdown(amount, n).map(chipEl));
  return el('div', { class: 'stack flying' }, pile);
}
