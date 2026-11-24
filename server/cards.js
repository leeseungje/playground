import { randomInt } from 'node:crypto';

export const SUITS = ['s', 'h', 'd', 'c'];

/** 암호학적 난수로 섞은 52장 덱 */
export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * 5장 평가. 사전식으로 비교 가능한 점수 배열을 돌려준다.
 * [족보(0~8), 비교용 숫자들...]
 */
export function eval5(cards) {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const count = new Map();
  for (const r of rs) count.set(r, (count.get(r) || 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kick = groups.map((g) => g[0]);

  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, ...kick];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...kick];
  if (flush) return [5, ...rs];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...kick];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...kick];
  if (groups[0][1] === 2) return [1, ...kick];
  return [0, ...rs];
}

export function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 5~7장 중 최고의 5장 조합 */
export function bestHand(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = eval5(five);
            if (!best || compareScore(score, best.score) > 0) best = { score, cards: five };
          }
  return { ...best, name: handName(best.score) };
}

const NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

export function handName(score) {
  if (score[0] === 8 && score[1] === 14) return '로열 플러시';
  return NAMES[score[0]];
}
