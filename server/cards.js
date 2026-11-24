import { randomInt } from 'node:crypto';

export { eval5, compareScore, bestHand, handName, handDetail } from '../shared/hand-eval.js';

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
