// 서버와 브라우저가 함께 쓰는 화투 카드 정의, 섯다 족보, 고스톱 점수 계산.
// (외부 import 없음: 브라우저에서 /shared/hwatu.js 로 그대로 불러온다)

/** 달 이름과 그림 */
export const MONTHS = {
  1: { name: '송학', flower: '소나무', icon: '🌲', color: '#2f7d4f' },
  2: { name: '매조', flower: '매화', icon: '🌸', color: '#c2417a' },
  3: { name: '벚꽃', flower: '벚꽃', icon: '🌸', color: '#e07aa0' },
  4: { name: '흑싸리', flower: '등나무', icon: '🍇', color: '#4a3b6b' },
  5: { name: '난초', flower: '창포', icon: '🪻', color: '#5a5fc8' },
  6: { name: '모란', flower: '모란', icon: '🌺', color: '#c8243a' },
  7: { name: '홍싸리', flower: '싸리', icon: '🍂', color: '#b5562c' },
  8: { name: '공산', flower: '억새', icon: '🌕', color: '#6b6f2a' },
  9: { name: '국화', flower: '국화', icon: '🌼', color: '#c99a14' },
  10: { name: '단풍', flower: '단풍', icon: '🍁', color: '#c8401f' },
  11: { name: '오동', flower: '오동', icon: '🍃', color: '#3c5c2a' },
  12: { name: '비', flower: '버들', icon: '☔', color: '#2c4f7c' },
};

/*
 * 48장. kind: gwang(광) | yeol(열끗) | tti(띠) | pi(피) | ssangpi(쌍피)
 * tag: 그림 설명. ribbon: hong(홍단) | cheong(청단) | cho(초단) | rain(비띠, 단 없음)
 * bird: 고도리 새(2·4·8월 열끗). rainGwang: 비광. gukjin: 9월 열끗(국진, 쌍피로도 쓸 수 있음)
 */
const SPEC = {
  1: [['gwang', '학'], ['tti', '홍단', 'hong'], ['pi'], ['pi']],
  2: [['yeol', '꾀꼬리', null, 'bird'], ['tti', '홍단', 'hong'], ['pi'], ['pi']],
  3: [['gwang', '벚꽃 장막'], ['tti', '홍단', 'hong'], ['pi'], ['pi']],
  4: [['yeol', '두견새', null, 'bird'], ['tti', '초단', 'cho'], ['pi'], ['pi']],
  5: [['yeol', '팔각다리'], ['tti', '초단', 'cho'], ['pi'], ['pi']],
  6: [['yeol', '나비'], ['tti', '청단', 'cheong'], ['pi'], ['pi']],
  7: [['yeol', '멧돼지'], ['tti', '초단', 'cho'], ['pi'], ['pi']],
  8: [['gwang', '보름달'], ['yeol', '기러기', null, 'bird'], ['pi'], ['pi']],
  9: [['yeol', '술잔', null, 'gukjin'], ['tti', '청단', 'cheong'], ['pi'], ['pi']],
  10: [['yeol', '사슴'], ['tti', '청단', 'cheong'], ['pi'], ['pi']],
  11: [['gwang', '봉황'], ['ssangpi', '쌍피'], ['pi'], ['pi']],
  12: [['gwang', '비광', null, 'rainGwang'], ['yeol', '제비'], ['tti', '비띠', 'rain'], ['ssangpi', '쌍피']],
};

const KIND_LABEL = { gwang: '광', yeol: '열끗', tti: '띠', pi: '피', ssangpi: '쌍피' };

/** id: '1-0' ~ '12-3' */
export const CARDS = Object.fromEntries(
  Object.entries(SPEC).flatMap(([m, list]) =>
    list.map(([kind, tag, ribbon, flag], i) => {
      const id = `${m}-${i}`;
      return [id, { id, month: Number(m), kind, tag: tag ?? KIND_LABEL[kind], ribbon: ribbon ?? null, bird: flag === 'bird', rainGwang: flag === 'rainGwang', gukjin: flag === 'gukjin' }];
    }),
  ),
);
/** 고스톱 조커(보너스패): 방 설정에서 0~4장. 달이 없고 피 2장 값 */
export const JOKER_IDS = ['J-1', 'J-2', 'J-3', 'J-4'];
for (const id of JOKER_IDS) CARDS[id] = { id, month: 0, kind: 'joker', tag: '조커 (보너스 쌍피)', ribbon: null, bird: false, rainGwang: false, gukjin: false, joker: true };
export const card = (id) => CARDS[id];
export const ALL_IDS = Object.keys(CARDS).filter((id) => !CARDS[id].joker);

/** 섯다용 20장: 1~10월 각 두 장 (1·3·8월은 광, 4·7·9월은 열끗이 들어간다) */
export const SEOTDA_IDS = Array.from({ length: 10 }, (_, i) => {
  const m = i + 1;
  return m === 8 ? ['8-0', '8-1'] : [`${m}-0`, `${m}-1`];
}).flat();

// ───────────────────────── 섯다 족보 ─────────────────────────

/*
 * rank: 클수록 높다.
 *   38광땡 1000 / 13·18광땡 900 / 땡 800+달(장땡 810) / 알리 706 독사 705 구삥 704 장삥 703 장사 702 세륙 701
 *   끗 100+끗수(갑오 109, 망통 100)
 * special: amhaeng(암행어사) | ttaengjabi(땡잡이) | gusa(구사) | meong(멍텅구리 구사)
 */
export const SEOTDA_TABLE = [
  { key: '38', name: '38광땡', desc: '3광 + 8광', note: '최고 족보' },
  { key: 'gwang', name: '13·18광땡', desc: '1광+3광, 1광+8광', note: '암행어사에게 잡힘' },
  { key: 'jang', name: '장땡', desc: '10 + 10', note: '땡 중 최고' },
  { key: 'ttaeng', name: '9땡 ~ 1땡', desc: '같은 달 두 장', note: '땡잡이에게 잡힘' },
  { key: 'ali', name: '알리', desc: '1 + 2' },
  { key: 'doksa', name: '독사', desc: '1 + 4' },
  { key: 'gubbing', name: '구삥', desc: '1 + 9' },
  { key: 'jangbbing', name: '장삥', desc: '1 + 10' },
  { key: 'jangsa', name: '장사', desc: '10 + 4' },
  { key: 'seryuk', name: '세륙', desc: '4 + 6' },
  { key: 'kkeut', name: '갑오 ~ 1끗', desc: '두 달을 더한 끝자리 (9끗 = 갑오)' },
  { key: 'mangtong', name: '망통', desc: '끝자리 0 (0끗)', note: '가장 낮음' },
];
export const SEOTDA_SPECIAL_TABLE = [
  { key: 'amhaeng', name: '암행어사', desc: '4열끗 + 7열끗', note: '13·18광땡을 잡음. 아니면 1끗' },
  { key: 'ttaengjabi', name: '땡잡이', desc: '3광 + 7열끗', note: '1땡~9땡을 잡음. 아니면 망통' },
  { key: 'gusa', name: '구사', desc: '4 + 9', note: '상대 최고가 알리 이하면 재경기. 아니면 3끗' },
  { key: 'meong', name: '멍텅구리 구사', desc: '4열끗 + 9열끗', note: '상대 최고가 장땡 이하면 재경기. 아니면 3끗' },
];

const isGwang = (c) => c.kind === 'gwang';
const isYeol = (c) => c.kind === 'yeol';

/** 섯다 두 장 판정 */
export function evalSeotda(ids) {
  const [a, b] = ids.map(card).sort((x, y) => x.month - y.month);
  const m1 = a.month;
  const m2 = b.month;
  const has = (x, y) => m1 === x && m2 === y;
  if (has(3, 8) && isGwang(a) && isGwang(b)) return { rank: 1000, name: '38광땡', key: '38' };
  if ((has(1, 3) || has(1, 8)) && isGwang(a) && isGwang(b)) return { rank: 900, name: `${m1}${m2}광땡`, key: 'gwang' };
  if (m1 === m2) return { rank: 800 + m1, name: m1 === 10 ? '장땡' : `${m1}땡`, key: m1 === 10 ? 'jang' : 'ttaeng' };
  if (has(4, 7) && isYeol(a) && isYeol(b)) return { rank: 101, name: '암행어사', key: 'amhaeng', special: 'amhaeng', plain: '1끗' };
  if (has(3, 7) && isGwang(a) && isYeol(b)) return { rank: 100, name: '땡잡이', key: 'ttaengjabi', special: 'ttaengjabi', plain: '망통' };
  if (has(4, 9) && isYeol(a) && isYeol(b)) return { rank: 103, name: '멍텅구리 구사', key: 'meong', special: 'meong', plain: '3끗' };
  if (has(4, 9)) return { rank: 103, name: '구사', key: 'gusa', special: 'gusa', plain: '3끗' };
  const named = [
    [1, 2, 706, '알리', 'ali'],
    [1, 4, 705, '독사', 'doksa'],
    [1, 9, 704, '구삥', 'gubbing'],
    [1, 10, 703, '장삥', 'jangbbing'],
    [4, 10, 702, '장사', 'jangsa'],
    [4, 6, 701, '세륙', 'seryuk'],
  ].find(([x, y]) => has(x, y));
  if (named) return { rank: named[2], name: named[3], key: named[4] };
  const k = (m1 + m2) % 10;
  return { rank: 100 + k, name: k === 0 ? '망통' : k === 9 ? '갑오' : `${k}끗`, key: k === 0 ? 'mangtong' : 'kkeut' };
}

/** 한 장만 보고 있을 때 화면 안내 */
export function seotdaOneCard(id) {
  const c = card(id);
  const extra = isGwang(c) ? '광' : isYeol(c) ? '열끗' : '';
  return `${c.month}월${extra ? ` ${extra}` : ''}`;
}

/**
 * 쇼다운. hands: [{ pid, ids }] (다이 안 한 사람만)
 * 돌려줌: { replay: { by, key } } 또는 { winners: [pid], results: { pid: { ...eval, eff } } }
 */
export function resolveSeotda(hands) {
  const results = Object.fromEntries(hands.map((h) => [h.pid, { ...evalSeotda(h.ids) }]));
  const ranks = (except) => hands.filter((h) => h.pid !== except).map((h) => results[h.pid].rank);
  // 재경기 (구사·멍구사): 다른 사람 중 최고가 기준 이하일 때
  for (const h of hands) {
    const r = results[h.pid];
    const others = ranks(h.pid);
    if (!others.length) continue;
    const top = Math.max(...others);
    if (r.special === 'meong' && top <= 810) return { replay: { by: h.pid, key: 'meong' }, results };
    if (r.special === 'gusa' && top <= 706) return { replay: { by: h.pid, key: 'gusa' }, results };
  }
  const all = hands.map((h) => results[h.pid].rank);
  const hasGwang1318 = all.includes(900);
  const hasLowTtaeng = all.some((r) => r >= 801 && r <= 809);
  for (const h of hands) {
    const r = results[h.pid];
    r.eff = r.rank;
    if (r.special === 'amhaeng' && hasGwang1318) {
      r.eff = 950;
      r.caught = true;
    }
    if (r.special === 'ttaengjabi' && hasLowTtaeng) {
      r.eff = 809.5;
      r.caught = true;
    }
  }
  const best = Math.max(...hands.map((h) => results[h.pid].eff));
  return { winners: hands.filter((h) => results[h.pid].eff === best).map((h) => h.pid), results };
}

// ───────────────────────── 고스톱 점수 ─────────────────────────

/** 피 장수 (쌍피 2장, 국진을 쌍피로 쓰면 2장) */
export function piCount(ids, gukjinAsPi = false) {
  let n = 0;
  for (const id of ids) {
    const c = card(id);
    if (c.kind === 'pi') n += 1;
    else if (c.kind === 'ssangpi' || c.kind === 'joker') n += 2;
    else if (c.gukjin && gukjinAsPi) n += 2;
  }
  return n;
}

function scoreWith(ids, gukjinAsPi) {
  const cs = ids.map(card);
  const items = [];
  const gw = cs.filter((c) => c.kind === 'gwang');
  if (gw.length === 5) items.push(['오광', 15]);
  else if (gw.length === 4) items.push(['사광', 4]);
  else if (gw.length === 3) items.push(gw.some((c) => c.rainGwang) ? ['비삼광', 2] : ['삼광', 3]);
  const yeol = cs.filter((c) => c.kind === 'yeol' && !(c.gukjin && gukjinAsPi));
  if (yeol.length >= 5) items.push([`열끗 ${yeol.length}장`, yeol.length - 4]);
  if (yeol.filter((c) => c.bird).length === 3) items.push(['고도리', 5]);
  const tti = cs.filter((c) => c.kind === 'tti');
  if (tti.length >= 5) items.push([`띠 ${tti.length}장`, tti.length - 4]);
  for (const [r, label] of [['hong', '홍단'], ['cheong', '청단'], ['cho', '초단']]) if (tti.filter((c) => c.ribbon === r).length === 3) items.push([label, 3]);
  const pi = piCount(ids, gukjinAsPi);
  if (pi >= 10) items.push([`피 ${pi}장`, pi - 9]);
  return {
    total: items.reduce((s, [, v]) => s + v, 0),
    items,
    gwang: gw.length,
    yeol: yeol.length,
    tti: tti.length,
    pi,
    gukjinAsPi,
    gwangScore: items.some(([n]) => n.includes('광')),
    piScore: pi >= 10,
  };
}

/** 먹은 패 점수. 국진(9월 열끗)은 점수가 더 높은 쪽으로 자동 선택 */
export function scoreGostop(ids) {
  const hasGukjin = ids.some((id) => card(id).gukjin);
  const a = scoreWith(ids, false);
  if (!hasGukjin) return a;
  const b = scoreWith(ids, true);
  return b.total > a.total ? b : a;
}

/** 진 사람이 피박을 피하려고 국진을 쌍피로 쓸 수 있으므로, 피 장수는 큰 쪽 */
export const loserPi = (ids) => Math.max(piCount(ids, false), piCount(ids, true));
