// 서버와 브라우저가 함께 쓰는 족보 판정. (외부 import 없음: 브라우저에서 /shared/hand-eval.js 로 그대로 불러온다)

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
const RANK_NAME = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
const rn = (r) => RANK_NAME[r] ?? String(r);

export function handName(score) {
  if (score[0] === 8 && score[1] === 14) return '로열 플러시';
  return NAMES[score[0]];
}

/** "A 원페어", "K·7 투페어" 처럼 조금 더 자세한 이름 */
export function handDetail(score) {
  const [k, a, b] = score;
  switch (k) {
    case 0: return `${rn(a)} 하이`;
    case 1: return `${rn(a)} 원페어`;
    case 2: return `${rn(a)}·${rn(b)} 투페어`;
    case 3: return `${rn(a)} 트리플`;
    case 4: return `${rn(a)} 하이 스트레이트`;
    case 5: return `${rn(a)} 하이 플러시`;
    case 6: return `${rn(a)} 풀하우스`;
    case 7: return `${rn(a)} 포카드`;
    case 8: return a === 14 ? '로열 플러시' : `${rn(a)} 하이 스트레이트 플러시`;
    default: return '';
  }
}

/**
 * 2~7장으로 지금 족보를 알려 준다 (홀카드만 있을 때도 동작).
 * 5장 미만이면 페어 여부 정도만 판단한다.
 */
export function currentHand(cards) {
  if (cards.length >= 5) {
    const b = bestHand(cards);
    return { score: b.score, cards: b.cards, name: b.name, detail: handDetail(b.score) };
  }
  const rs = cards.map((c) => c.r).sort((x, y) => y - x);
  const pair = rs.find((r, i) => rs.indexOf(r) !== i);
  if (pair) return { score: [1, pair], cards: cards.filter((c) => c.r === pair), name: '원페어', detail: `${rn(pair)} 원페어` };
  return { score: [0, rs[0]], cards: [], name: '하이카드', detail: `${rn(rs[0])} 하이` };
}
