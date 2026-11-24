import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestHand, compareScore } from '../server/cards.js';

const R = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const c = (s) => s.split(' ').map((x) => ({ r: R[x[0]] ?? Number(x[0]), s: x[1] }));
const best = (s) => bestHand(c(s));
const cmp = (a, b) => Math.sign(compareScore(best(a).score, best(b).score));

test('족보 이름', () => {
  assert.equal(best('As Ks Qs Js Ts 2d 3c').name, '로열 플러시');
  assert.equal(best('9s 8s 7s 6s 5s 2d 3c').name, '스트레이트 플러시');
  assert.equal(best('9s 9h 9d 9c 5s 2d 3c').name, '포카드');
  assert.equal(best('9s 9h 9d 5c 5s 2d 3c').name, '풀하우스');
  assert.equal(best('As 9s 7s 4s 2s Kd Qc').name, '플러시');
  assert.equal(best('Ad 2s 3h 4c 5d 9c Kh').name, '스트레이트');
  assert.equal(best('9s 9h 9d 5c 4s 2d Kc').name, '트리플');
  assert.equal(best('9s 9h 5d 5c 4s 2d Kc').name, '투페어');
  assert.equal(best('9s 9h 5d 7c 4s 2d Kc').name, '원페어');
  assert.equal(best('9s Th 5d 7c 4s 2d Kc').name, '하이카드');
});

test('비교', () => {
  // 휠(A-5)은 6하이 스트레이트보다 낮다
  assert.equal(cmp('Ad 2s 3h 4c 5d 9c 9h', '6d 2s 3h 4c 5d 9c 9h'), -1);
  // 키커
  assert.equal(cmp('As Ah Kd 7c 4s 2d 3c', 'As Ah Qd 7c 4s 2d 3c'), 1);
  // 투페어 세 쌍이면 높은 두 쌍 + 남은 최고 키커
  assert.equal(best('As Ah Kd Kc 4s 4d 3c').score.join(), [2, 14, 13, 4].join());
  // 보드 플레이 → 무승부
  assert.equal(cmp('2c 3d As Ks Qs Js Ts', '4c 5d As Ks Qs Js Ts'), 0);
  // 풀하우스: 트리플 두 개면 높은 트리플 + 낮은 트리플 중 2장
  assert.equal(best('9s 9h 9d 5c 5s 5d Kc').score.join(), [6, 9, 5].join());
  // 플러시는 5장 전체 비교
  assert.equal(cmp('As 9s 7s 4s 3s Kd Qc', 'As 9s 7s 4s 2s Kd Qc'), 1);
});
