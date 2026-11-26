// 전통 화투 그림 (SVG 직접 그림). viewBox 0 0 60 96.
// 달마다 식물 배경 + 카드별 그림(광·열끗·띠)을 겹친다. 한국 화투처럼 11월 오동, 12월 비.

const C = {
  red: '#e8392f',
  red2: '#ff5a3c',
  black: '#17130f',
  green: '#2f9a55',
  green2: '#1f6e3c',
  leaf: '#4c8a3a',
  purple: '#6a4bd0',
  pink: '#f08aa0',
  pinkL: '#ffd3dc',
  yellow: '#f6b52a',
  white: '#ffffff',
  cream: '#f6efdf',
  blue: '#2457d6',
  brown: '#8a4b22',
  sky: '#f26a3d',
};

const circle = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d, stroke, w = 1.5, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;

/** 꽃 한 송이 (꽃잎 5장) */
function blossom(x, y, r, petal, center = C.yellow) {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    s += circle((x + Math.cos(a) * r * 0.62).toFixed(1), (y + Math.sin(a) * r * 0.62).toFixed(1), (r * 0.5).toFixed(1), petal);
  }
  return s + circle(x, y, (r * 0.28).toFixed(1), center);
}

/** 띠 (홍단·청단·초단·비띠) */
function ribbon(kind) {
  const fill = kind === 'cheong' ? C.blue : C.red;
  const text = kind === 'hong' ? '홍단' : kind === 'cheong' ? '청단' : '';
  const shape = kind === 'rain' ? 'M22 8 L38 8 L38 54 L33 60 L30 56 L27 61 L22 55Z' : 'M22 8 L38 8 L38 58 L30 64 L22 58Z';
  let s = path(shape, fill, `stroke="${C.black}" stroke-width="0.8"`);
  s += line('M24 10 L24 56', '#ffffff55', 1);
  if (text) {
    s += `<rect x="25.5" y="14" width="9" height="26" rx="1" fill="${C.cream}"/>`;
    s += `<text x="30" y="21" font-size="7" font-weight="900" text-anchor="middle" fill="${kind === 'cheong' ? '#0f1f4a' : C.black}" stroke="none" font-family="'Noto Serif KR',serif">${text[0]}</text>`;
    s += `<text x="30" y="33" font-size="7" font-weight="900" text-anchor="middle" fill="${kind === 'cheong' ? '#0f1f4a' : C.black}" stroke="none" font-family="'Noto Serif KR',serif">${text[1]}</text>`;
  }
  return s;
}

// ───────── 달별 식물 ─────────
const PLANT = {
  // 송학: 소나무
  1: (v) => {
    const clump = (x, y, r) => circle(x, y, r, C.green2) + circle(x - r * 0.3, y - r * 0.3, r * 0.6, C.green);
    return path('M30 96 C30 80 26 70 20 62', 'none', `stroke="${C.black}" stroke-width="3"`) + path('M30 80 C38 74 44 72 52 72', 'none', `stroke="${C.black}" stroke-width="2"`) + clump(20, 62, 10) + clump(44, 72, 9) + clump(10, 80, 8) + clump(34, 86, 8) + (v ? clump(52, 86, 7) : clump(50, 60, 7));
  },
  // 매조: 매화 가지
  2: (v) => line(v ? 'M4 90 C20 70 30 50 56 30' : 'M56 92 C40 74 32 52 6 34', C.black, 3) + line(v ? 'M24 66 C30 66 36 72 40 80' : 'M36 70 C30 70 24 76 20 84', C.black, 1.8) + [[16, 76], [28, 58], [44, 40], [38, 76], [52, 32]].map(([x, y]) => blossom(v ? x : 60 - x, y, 6, C.red2, C.yellow)).join(''),
  // 벚꽃
  3: (v) => line(v ? 'M0 40 C20 44 34 58 40 96' : 'M60 40 C40 44 26 58 20 96', C.black, 3) + [[10, 30], [22, 22], [34, 30], [16, 46], [30, 44], [44, 50], [8, 60], [26, 64], [48, 70]].map(([x, y]) => blossom(v ? x : 60 - x, y, 6.5, C.pink, C.pinkL)).join(''),
  // 흑싸리: 늘어진 검은 등나무
  4: (v) => {
    let s = line('M0 4 C20 10 40 6 60 12', C.black, 2.5);
    for (const x of v ? [10, 24, 40, 52] : [8, 20, 34, 48]) {
      for (let k = 0; k < 7; k++) s += path(`M${x - 3 + (k % 2)} ${10 + k * 7} q3 -3 6 0 q-3 4 -6 0z`, C.black);
    }
    return s;
  },
  // 난초(창포): 보라 꽃 + 잎
  5: (v) => {
    let s = '';
    for (const x of [12, 24, 36, 48]) s += line(`M${x} 96 C${x - 2} 76 ${x + 3} 64 ${x + (v ? 4 : -4)} 50`, C.leaf, 2.4);
    for (const [x, y] of v ? [[14, 46], [34, 40], [48, 52]] : [[16, 52], [30, 38], [46, 46]]) s += path(`M${x} ${y} c-6 -8 -2 -14 0 -16 c2 2 6 8 0 16z`, C.purple) + path(`M${x} ${y} c-8 -2 -10 -8 -8 -11 c4 0 8 4 8 11z`, '#7a55b8') + path(`M${x} ${y} c8 -2 10 -8 8 -11 c-4 0 -8 4 -8 11z`, '#7a55b8');
    return s;
  },
  // 모란: 큰 붉은 꽃 + 잎
  6: (v) => {
    const peony = (x, y) => circle(x, y, 11, C.red) + circle(x - 3, y - 3, 7, C.red2) + circle(x + 2, y + 1, 4, '#ff7a7f') + circle(x, y, 2, C.yellow);
    return path('M8 96 C14 80 26 76 34 82 C42 74 54 78 56 96Z', C.green2) + path('M4 86 C10 74 20 72 26 80Z', C.leaf) + path('M56 84 C50 72 40 72 36 80Z', C.leaf) + peony(v ? 22 : 38, 66) + (v ? peony(42, 80) : '');
  },
  // 홍싸리: 붉은 싸리
  7: (v) => {
    let s = '';
    for (const [d, n] of [[v ? 'M6 96 C12 60 30 40 56 20' : 'M54 96 C48 60 30 40 4 20', 9], ['M30 96 C30 70 22 56 10 46', 6]]) {
      s += line(d, C.black, 1.8);
    }
    for (let k = 0; k < 14; k++) {
      const t = k / 13;
      const x = v ? 6 + t * 50 : 54 - t * 50;
      const y = 92 - t * 72 + Math.sin(t * 9) * 4;
      s += path(`M${x.toFixed(1)} ${y.toFixed(1)} q3 -4 6 -1 q-3 4 -6 1z`, k % 3 ? C.red : C.red2) + path(`M${(x - 2).toFixed(1)} ${(y + 3).toFixed(1)} q-3 -3 -1 -6 q3 2 1 6z`, C.leaf);
    }
    return s;
  },
  // 공산: 검은 언덕과 억새
  8: () => {
    let s = path('M0 52 C14 44 34 42 60 50 L60 96 L0 96Z', C.black);
    for (let k = 0; k < 9; k++) s += line(`M${4 + k * 7} 96 C${4 + k * 7} 80 ${8 + k * 7} 66 ${12 + k * 7} 54`, '#3a3a3a', 0.8);
    return s;
  },
  // 국화
  9: (v) => {
    const mum = (x, y, r, col) => {
      let s = '';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        s += `<ellipse cx="${(x + Math.cos(a) * r * 0.55).toFixed(1)}" cy="${(y + Math.sin(a) * r * 0.55).toFixed(1)}" rx="${(r * 0.45).toFixed(1)}" ry="${(r * 0.18).toFixed(1)}" transform="rotate(${((a * 180) / Math.PI).toFixed(0)} ${(x + Math.cos(a) * r * 0.55).toFixed(1)} ${(y + Math.sin(a) * r * 0.55).toFixed(1)})" fill="${col}"/>`;
      }
      return s + circle(x, y, r * 0.25, '#c77a0a');
    };
    return line('M30 96 C30 80 26 70 20 60', C.green2, 2) + line('M30 84 C38 78 42 70 44 62', C.green2, 2) + path('M14 90 c6 -6 12 -4 14 0z', C.leaf) + path('M36 80 c6 -6 12 -4 14 0z', C.leaf) + mum(v ? 20 : 42, v ? 58 : 60, 13, C.yellow) + mum(v ? 46 : 18, v ? 74 : 76, 10, v ? C.white : C.yellow);
  },
  // 단풍
  10: (v) => {
    const maple = (x, y, r, col) => path(`M${x} ${y - r} l${r * 0.25} ${r * 0.55} l${r * 0.55} -${r * 0.25} l-${r * 0.25} ${r * 0.55} l${r * 0.45} ${r * 0.2} l-${r * 0.6} ${r * 0.2} l${r * 0.1} ${r * 0.5} l-${r * 0.5} -${r * 0.35} l-${r * 0.5} ${r * 0.35} l${r * 0.1} -${r * 0.5} l-${r * 0.6} -${r * 0.2} l${r * 0.45} -${r * 0.2} l-${r * 0.25} -${r * 0.55} l${r * 0.55} ${r * 0.25}z`, col);
    return line(v ? 'M0 10 C20 20 30 30 40 50' : 'M60 10 C40 20 30 30 20 50', C.black, 2) + [[12, 14], [26, 24], [40, 12], [34, 40], [16, 36], [50, 30]].map(([x, y], i) => maple(v ? x : 60 - x, y, 8, i % 2 ? C.red : C.red2)).join('');
  },
  // 오동: 검은 큰 잎 + 보라 꽃
  11: (v) => {
    const big = (x, y, s) => path(`M${x} ${y} c-${10 * s} -${2 * s} -${14 * s} -${12 * s} -${8 * s} -${18 * s} c${4 * s} ${2 * s} ${6 * s} ${2 * s} ${8 * s} 0 c${2 * s} ${2 * s} ${4 * s} ${2 * s} ${8 * s} 0 c${6 * s} ${6 * s} ${2 * s} ${16 * s} -${8 * s} ${18 * s}z`, C.black);
    return big(30, 96, 1.3) + big(v ? 14 : 46, 80, 0.9) + line('M30 70 L30 40', C.black, 1.5) + [[26, 40], [30, 36], [34, 40], [28, 46], [32, 46]].map(([x, y]) => circle(x, y, 2.6, '#9a6fd0')).join('');
  },
  // 비: 버드나무
  12: (v) => {
    let s = line(v ? 'M60 0 C44 10 36 20 30 40' : 'M0 0 C16 10 24 20 30 40', C.black, 2.5);
    for (let k = 0; k < 6; k++) {
      const x = v ? 54 - k * 6 : 6 + k * 6;
      s += line(`M${x} ${4 + k * 2} C${x - 2} 24 ${x + 2} 40 ${x} ${50 + (k % 3) * 6}`, C.green2, 1.6);
      for (let j = 0; j < 4; j++) s += path(`M${x} ${14 + j * 10 + k} q2 3 0 6 q-2 -3 0 -6z`, C.leaf);
    }
    return s;
  },
};

// ───────── 카드별 그림 ─────────
const crane = () =>
  path('M22 70 C18 60 20 50 28 46 C32 44 36 46 36 50 L40 66 C40 74 30 78 22 70Z', C.white, `stroke="${C.black}" stroke-width="0.8"`) +
  line('M30 47 C32 36 30 28 26 22', C.black, 2.2) +
  circle(26, 21, 2.6, C.white, `stroke="${C.black}" stroke-width="0.6"`) +
  circle(26, 19.5, 1.2, C.red) +
  path('M24 21 L17 24 L24 22.5Z', C.black) +
  path('M24 60 C28 56 34 58 38 64 C34 64 28 64 24 60Z', C.black) +
  line('M28 74 L26 88 M32 74 L34 88', C.black, 1.2);

const SPECIAL = {
  '1-0': () => `<rect x="0" y="0" width="60" height="54" fill="${C.sky}"/>` + circle(40, 22, 13, C.red, `stroke="${C.yellow}" stroke-width="1.2"`) + crane(),
  '2-0': () => path('M18 50 C20 42 30 40 34 46 C38 44 42 46 40 50 C36 56 26 58 18 50Z', '#8fa83a', `stroke="${C.black}" stroke-width="0.6"`) + circle(35, 46, 1, C.black) + path('M40 47 L44 46 L40 49Z', C.black) + path('M18 50 L10 54 L18 53Z', '#6c8226'),
  '3-0': () => path('M0 58 L60 58 L60 86 C50 82 40 88 30 84 C20 88 10 82 0 86Z', C.red) + `<rect x="0" y="62" width="60" height="5" fill="${C.white}"/>` + `<rect x="0" y="72" width="60" height="5" fill="${C.white}"/>` + circle(30, 70, 7, C.white, `stroke="${C.red}" stroke-width="1.2"`) + blossom(30, 70, 5, C.pink, C.red),
  '4-0': () => path('M50 22 C52 14 46 8 40 10 C46 12 48 18 46 22Z', C.red) + path('M14 44 C24 36 34 38 42 32 C36 42 26 46 14 44Z', C.black) + path('M20 42 L10 36 L22 40Z', C.black) + circle(38, 34, 0.9, C.white),
  '5-0': () => path('M0 70 L60 62 L60 68 L0 76Z', C.brown, `stroke="${C.black}" stroke-width="0.6"`) + path('M10 70 L60 64 L60 66 L10 72Z', '#b77a42') + [8, 22, 36, 50].map((x) => `<rect x="${x}" y="${74 - x * 0.13}" width="2.2" height="14" fill="${C.black}"/>`).join(''),
  '6-0': () => {
    const fly = (x, y, c) => path(`M${x} ${y} c-6 -8 -12 -2 -8 4 c-4 2 -2 8 4 4z`, c) + path(`M${x} ${y} c6 -8 12 -2 8 4 c4 2 2 8 -4 4z`, c) + line(`M${x} ${y - 4} L${x} ${y + 6}`, C.black, 1);
    return fly(18, 24, '#f2c94c') + fly(40, 34, '#7fc4f0');
  },
  '7-0': () => path('M8 76 C8 62 22 56 36 58 C48 58 54 66 52 74 C50 82 40 84 30 82 C22 84 10 84 8 76Z', C.brown, `stroke="${C.black}" stroke-width="0.8"`) + path('M48 62 L56 58 L54 66Z', C.black) + circle(46, 66, 1.2, C.black) + line('M14 82 L14 90 M24 83 L24 90 M38 83 L38 90 M46 80 L46 88', C.black, 2.2) + line('M12 64 L20 60 L28 62 L36 58', C.black, 1),
  '8-0': () => `<rect x="0" y="0" width="60" height="52" fill="${C.sky}"/>` + circle(30, 26, 17, C.white, `stroke="${C.cream}" stroke-width="1"`) + PLANT[8](),
  '8-1': () => `<rect x="0" y="0" width="60" height="52" fill="${C.sky}"/>` + [[14, 16], [30, 24], [44, 14]].map(([x, y]) => path(`M${x} ${y} c-4 -4 -8 -4 -10 -2 c4 0 6 2 10 2 c4 0 6 -2 10 -2 c-2 -2 -6 -2 -10 2z`, C.black)).join('') + PLANT[8](),
  '9-0': () => path('M14 62 L46 62 L42 78 C40 84 20 84 18 78Z', C.red, `stroke="${C.black}" stroke-width="0.8"`) + `<ellipse cx="30" cy="62" rx="16" ry="3.5" fill="#f4d06f"/>` + `<text x="30" y="77" font-size="11" font-weight="900" text-anchor="middle" fill="${C.yellow}" stroke="none" font-family="'Noto Serif KR',serif">壽</text>`,
  '10-0': () => path('M12 66 C12 56 24 52 36 54 C44 54 48 60 46 66 C44 72 36 74 26 72 C18 74 12 72 12 66Z', '#b0642c', `stroke="${C.black}" stroke-width="0.8"`) + path('M42 56 C44 46 48 42 52 42 C54 46 50 52 46 58Z', '#b0642c', `stroke="${C.black}" stroke-width="0.8"`) + circle(49, 46, 0.9, C.black) + line('M50 42 L46 34 M46 34 L42 32 M46 34 L48 30 M52 42 L56 34 M56 34 L58 30', C.black, 1) + line('M16 72 L14 86 M24 73 L24 86 M36 73 L38 86 M42 70 L44 84', C.black, 1.6) + [[22, 62], [30, 60], [26, 66]].map(([x, y]) => circle(x, y, 1, C.white)).join(''),
  '11-0': () => `<rect x="0" y="0" width="60" height="40" fill="${C.sky}"/>` + path('M30 30 C20 30 14 20 18 12 C22 18 26 20 30 20 C34 20 38 18 42 12 C46 20 40 30 30 30Z', '#2ea36a', `stroke="${C.black}" stroke-width="0.6"`) + circle(30, 18, 3.5, C.yellow) + path('M30 14 L30 6 L33 10Z', C.red) + path('M18 12 L10 4 L20 10Z', '#e26a2c') + path('M42 12 L50 4 L40 10Z', '#e26a2c') + line('M26 30 C22 40 16 46 8 50 M34 30 C38 40 44 46 52 50', '#e26a2c', 2),
  '11-1': () => `<rect x="0" y="0" width="60" height="96" fill="#f3d36b" opacity="0.45"/>`,
  '12-0': () =>
    `<rect x="0" y="0" width="60" height="96" fill="${C.black}" opacity="0.88"/>` +
    line('M0 20 L60 30 M0 44 L60 54', '#ffffff33', 0.6) +
    path('M10 30 C18 16 42 16 50 30Z', C.yellow, `stroke="${C.black}" stroke-width="0.6"`) +
    line('M30 30 L30 62', C.black, 1.4) +
    path('M22 40 C22 34 34 34 34 40 L36 70 L20 70Z', C.red) +
    circle(28, 36, 4, '#f4d3b4') +
    path('M24 34 L32 32 L30 30 L24 31Z', C.black) +
    line('M22 70 L20 80 M34 70 L36 80', C.black, 1.6) +
    path('M42 82 C42 76 50 76 50 82 C50 86 42 86 42 82Z', '#3f8a3c') +
    PLANT[12](true),
  '12-1': () => path('M14 44 C24 30 36 36 46 26 C40 40 30 46 14 44Z', '#1a2440') + path('M20 44 L8 50 L18 46 L10 56 L22 46Z', '#1a2440') + circle(42, 30, 1, C.white) + path('M44 30 C46 32 46 34 44 36Z', C.red),
  '12-3': () => `<rect x="0" y="0" width="60" height="96" fill="${C.black}" opacity="0.85"/>` + path('M30 10 L22 40 L32 38 L24 70 L42 30 L32 32 L40 10Z', C.yellow) + circle(14, 70, 9, C.red, `stroke="${C.yellow}" stroke-width="1.5"`) + circle(14, 70, 3, C.yellow),
};

/** 조커 (보너스 쌍피) */
function joker() {
  let s = `<rect x="0" y="0" width="60" height="96" fill="#2457d6"/>`;
  for (let k = 0; k < 8; k++) s += path(`M30 48 L${(30 + Math.cos((k / 8) * 6.283) * 60).toFixed(1)} ${(48 + Math.sin((k / 8) * 6.283) * 60).toFixed(1)} L${(30 + Math.cos(((k + 0.5) / 8) * 6.283) * 60).toFixed(1)} ${(48 + Math.sin(((k + 0.5) / 8) * 6.283) * 60).toFixed(1)}Z`, '#3a6cf0', 'stroke="none"');
  s += circle(30, 46, 17, C.yellow) + path('M30 32 L34 42 L45 42 L36 49 L40 60 L30 53 L20 60 L24 49 L15 42 L26 42Z', C.red);
  s += `<rect x="8" y="70" width="44" height="14" rx="3" fill="${C.cream}"/>`;
  s += `<text x="30" y="80.5" font-size="9" font-weight="900" text-anchor="middle" fill="#17130f" stroke="none" font-family="'Noto Sans KR',sans-serif">JOKER</text>`;
  s += `<text x="30" y="16" font-size="7" font-weight="900" text-anchor="middle" fill="${C.cream}" stroke="none" font-family="'Noto Sans KR',sans-serif">보너스 쌍피</text>`;
  return s;
}

const cache = new Map();
/** 카드 그림 SVG 문자열 */
export function artSvg(id, meta) {
  if (cache.has(id)) return cache.get(id);
  if (meta.joker) {
    const j = `<svg viewBox="0 0 60 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g stroke="#17130f" stroke-width="0.9">${joker()}</g></svg>`;
    cache.set(id, j);
    return j;
  }
  const [m, i] = id.split('-').map(Number);
  const v = i % 2 === 0; // 같은 달 두 장의 피가 조금 달라 보이게 좌우를 바꾼다
  const plantFirst = m === 8 && (i === 0 || i === 1) ? '' : PLANT[m](v);
  let body = '';
  // 광·열끗 그림이 배경을 덮는 카드는 그림 안에서 식물을 그린다
  if (SPECIAL[id]) body = id === '12-0' || id === '12-3' ? SPECIAL[id]() + (id === '12-3' ? '' : '') : plantFirst + SPECIAL[id]();
  else body = plantFirst;
  if (id === '11-1' || id === '12-3') body = SPECIAL[id]() + PLANT[m](v);
  if (id === '12-3') body = SPECIAL[id]() + PLANT[12](false);
  if (meta.kind === 'tti') body += ribbon(meta.ribbon);
  const svgText = `<svg viewBox="0 0 60 96" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g stroke="#17130f" stroke-width="0.9" stroke-linejoin="round">${body}</g></svg>`;
  cache.set(id, svgText);
  return svgText;
}
