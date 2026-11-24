// 경주마와 기수 그림 (SVG). 말은 4단계 갤럽 동작, 기수는 큰 머리의 귀여운 캐릭터.
import { svg } from '../util.js';

const COATS = [
  ['#7a4a2a', '#5e3820'], // 갈색
  ['#5b3420', '#422617'], // 진갈색
  ['#a0612e', '#7d4a22'], // 밤색
  ['#2d2420', '#1c1714'], // 흑색
  ['#9b938a', '#7b746c'], // 회색
  ['#c08850', '#9a6a3c'], // 연갈색
  ['#6b3f22', '#50301a'],
  ['#3b2a22', '#2a1e18'],
];
const LIGHT = ['#f4f1e8', '#f2c230', '#5fc4d9', '#9aa3ad'];
export const inkOn = (c) => (LIGHT.includes(c) ? '#111' : '#fff');

const s = (tag, attrs, ...kids) => svg(tag, attrs, ...kids);

/** 다리 하나: 어깨/엉덩이 → 무릎 → 발굽 */
function leg(points, color, w = 6) {
  const [a, b, c] = points;
  return [
    s('path', { d: `M${a} L${b} L${c}`, stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }),
    s('ellipse', { cx: c.split(',')[0], cy: Number(c.split(',')[1]) + 1, rx: 3.6, ry: 2.4, fill: '#1a1410' }),
  ];
}

// 갤럽 4단계 (앞다리·뒷다리, 가까운 쪽/먼 쪽)
const FRONT = [
  [['98,62', '104,80', '100,100'], ['94,62', '90,81', '94,100']], // 모음
  [['98,62', '114,76', '130,84'], ['94,62', '106,78', '118,92']], // 앞으로 뻗음
  [['98,62', '108,78', '100,86'], ['94,62', '101,80', '93,88']], // 공중 (접음)
  [['98,62', '92,80', '80,97'], ['94,62', '96,82', '89,100']], // 밀어냄
];
const HIND = [
  [['48,60', '40,78', '46,100'], ['53,60', '57,80', '53,100']],
  [['48,60', '34,74', '18,84'], ['53,60', '40,78', '27,90']],
  [['48,60', '58,76', '50,88'], ['53,60', '63,78', '56,90']],
  [['48,60', '60,78', '70,97'], ['53,60', '57,81', '65,100']],
];

/** 헬멧 무늬 */
function helmetPattern(pattern, cx, cy, r, color) {
  const c = inkOn(color) === '#111' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.75)';
  switch (pattern) {
    case 'stripe':
      return s('path', { d: `M${cx - 2} ${cy - r} L${cx - 2} ${cy} M${cx + 3} ${cy - r + 1} L${cx + 3} ${cy}`, stroke: c, 'stroke-width': 2.2 });
    case 'star':
      return s('path', { d: `M${cx} ${cy - r + 2} l1.6 3.4 3.7 .4 -2.8 2.5 .8 3.6 -3.3 -1.9 -3.3 1.9 .8 -3.6 -2.8 -2.5 3.7 -.4z`, fill: c });
    case 'dots':
      return s('g', { fill: c }, s('circle', { cx: cx - 4, cy: cy - 5, r: 1.6 }), s('circle', { cx: cx + 2, cy: cy - 7, r: 1.6 }), s('circle', { cx: cx + 5, cy: cy - 2, r: 1.6 }));
    case 'hoop':
      return s('path', { d: `M${cx - r + 1} ${cy - 4} Q${cx} ${cy - 8} ${cx + r - 1} ${cy - 4}`, stroke: c, 'stroke-width': 2.4, fill: 'none' });
    case 'cross':
      return s('path', { d: `M${cx - 5} ${cy - 9} L${cx + 5} ${cy - 1} M${cx + 5} ${cy - 9} L${cx - 5} ${cy - 1}`, stroke: c, 'stroke-width': 2 });
    case 'diamond':
      return s('path', { d: `M${cx} ${cy - 10} L${cx + 4} ${cy - 5} L${cx} ${cy} L${cx - 4} ${cy - 5}Z`, fill: c });
    case 'half':
      return s('path', { d: `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx + r} ${cy} L${cx} ${cy}Z`, fill: c });
    default:
      return null;
  }
}

/**
 * 기수 머리 (표정 3가지를 모두 그려 두고 CSS 로 바꾼다: 보통 / 신남(선두) / 안간힘(막판))
 * cx, cy: 머리 중심, r: 반지름
 */
export function jockeyHead(look, silk, cx, cy, r) {
  const k = r / 11; // 기준 크기 11
  const ey = cy + 2 * k;
  const my = cy + 6.5 * k;
  return s(
    'g',
    { class: 'jk-head' },
    // 얼굴
    s('circle', { cx, cy, r, fill: look.skin, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 0.8 }),
    // 헬멧 (위쪽 절반) + 챙
    s('path', { d: `M${cx - r - 0.6} ${cy - 0.5 * k} A${r + 0.6} ${r + 0.6} 0 0 1 ${cx + r + 0.6} ${cy - 0.5 * k}Z`, fill: silk, stroke: 'rgba(0,0,0,.3)', 'stroke-width': 0.8 }),
    helmetPattern(look.pattern, cx, cy - 0.5 * k, r, silk),
    s('path', { d: `M${cx + 2 * k} ${cy - 0.5 * k} L${cx + r + 4 * k} ${cy - 0.2 * k}`, stroke: 'rgba(0,0,0,.55)', 'stroke-width': 2 * k, 'stroke-linecap': 'round' }),
    // 고글 (헬멧 위에 올려 둠)
    s('rect', { x: cx - 6 * k, y: cy - 5.2 * k, width: 12 * k, height: 3.6 * k, rx: 1.8 * k, fill: '#2b3a4a', stroke: '#9fb6c9', 'stroke-width': 0.8 }),
    s('rect', { x: cx - 4.6 * k, y: cy - 4.4 * k, width: 4 * k, height: 2 * k, rx: 1 * k, fill: '#7fd3ff', opacity: 0.8 }),
    s('rect', { x: cx + 0.8 * k, y: cy - 4.4 * k, width: 4 * k, height: 2 * k, rx: 1 * k, fill: '#7fd3ff', opacity: 0.8 }),
    // 눈: 보통
    s('g', { class: 'ex-n', fill: '#1a1410' }, s('ellipse', { cx: cx - 3.4 * k, cy: ey, rx: 1.3 * k, ry: 1.7 * k }), s('ellipse', { cx: cx + 3.6 * k, cy: ey, rx: 1.3 * k, ry: 1.7 * k })),
    // 눈: 신남 (^ ^)
    s(
      'g',
      { class: 'ex-h', stroke: '#1a1410', 'stroke-width': 1.4 * k, fill: 'none', 'stroke-linecap': 'round' },
      s('path', { d: `M${cx - 5 * k} ${ey + 0.8 * k} Q${cx - 3.4 * k} ${ey - 1.6 * k} ${cx - 1.8 * k} ${ey + 0.8 * k}` }),
      s('path', { d: `M${cx + 2 * k} ${ey + 0.8 * k} Q${cx + 3.6 * k} ${ey - 1.6 * k} ${cx + 5.2 * k} ${ey + 0.8 * k}` }),
    ),
    // 눈: 안간힘 (> <)
    s(
      'g',
      { class: 'ex-s', stroke: '#1a1410', 'stroke-width': 1.3 * k, fill: 'none', 'stroke-linecap': 'round' },
      s('path', { d: `M${cx - 5 * k} ${ey - 1.4 * k} L${cx - 2 * k} ${ey} L${cx - 5 * k} ${ey + 1.4 * k}` }),
      s('path', { d: `M${cx + 5.4 * k} ${ey - 1.4 * k} L${cx + 2.4 * k} ${ey} L${cx + 5.4 * k} ${ey + 1.4 * k}` }),
    ),
    // 입
    s('path', { class: 'ex-n', d: `M${cx - 2 * k} ${my} Q${cx} ${my + 1.6 * k} ${cx + 2.4 * k} ${my}`, stroke: '#7a3326', 'stroke-width': 1.2 * k, fill: 'none', 'stroke-linecap': 'round' }),
    s('path', { class: 'ex-h', d: `M${cx - 3 * k} ${my - 0.8 * k} Q${cx} ${my + 4 * k} ${cx + 3.4 * k} ${my - 0.8 * k}Z`, fill: '#b5413a' }),
    s('ellipse', { class: 'ex-s', cx: cx + 0.2 * k, cy: my + 0.4 * k, rx: 2.2 * k, ry: 1.6 * k, fill: '#5a2620' }),
    // 소품
    look.acc === 'mustache' ? s('path', { d: `M${cx - 4 * k} ${my - 1.6 * k} Q${cx - 2 * k} ${my - 3.4 * k} ${cx} ${my - 1.8 * k} Q${cx + 2 * k} ${my - 3.4 * k} ${cx + 4.4 * k} ${my - 1.6 * k} Q${cx} ${my - 0.4 * k} ${cx - 4 * k} ${my - 1.6 * k}Z`, fill: look.hair }) : null,
    look.acc === 'glasses' ? s('g', { stroke: '#222', 'stroke-width': 0.9 * k, fill: 'none' }, s('circle', { cx: cx - 3.4 * k, cy: ey, r: 2.4 * k }), s('circle', { cx: cx + 3.6 * k, cy: ey, r: 2.4 * k }), s('path', { d: `M${cx - 1 * k} ${ey} L${cx + 1.2 * k} ${ey}` })) : null,
    look.acc === 'blush' ? s('g', { fill: '#ff8f8f', opacity: 0.55 }, s('ellipse', { cx: cx - 6 * k, cy: ey + 2.8 * k, rx: 2 * k, ry: 1.2 * k }), s('ellipse', { cx: cx + 6.4 * k, cy: ey + 2.8 * k, rx: 2 * k, ry: 1.2 * k })) : null,
    look.acc === 'band' ? s('path', { d: `M${cx - r + 1} ${my + 1.4 * k} Q${cx} ${my + 5 * k} ${cx + r - 1} ${my + 1.4 * k}`, stroke: '#fff', 'stroke-width': 1.6 * k, fill: 'none', opacity: 0.9 }) : null,
  );
}

/** 말 소품 (사내 테마) — 번호로 하나씩 고정 */
export const GEARS = ['tie', 'badge', 'shades', 'ribbon', 'headset', 'partyhat', 'tie', 'shades', 'badge', 'ribbon', 'headset', 'partyhat'];
export const GEAR_LABEL = { tie: '넥타이', badge: '사원증', shades: '선글라스', ribbon: '리본', headset: '헤드셋', partyhat: '고깔모자' };
function gearSvg(gear, silk) {
  switch (gear) {
    case 'tie':
      return s('g', {}, s('path', { d: 'M104 50 L110 52 L107 55Z', fill: '#c9281b' }), s('path', { d: 'M107 55 L104 70 L108 74 L112 70 L109 55Z', fill: '#c9281b', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 0.6 }), s('path', { d: 'M105 62 L111 60 M104.6 67 L111.4 65', stroke: '#f2c230', 'stroke-width': 1 }));
    case 'badge':
      return s('g', {}, s('path', { d: 'M100 44 L106 62 L112 42', stroke: '#2f6fd6', 'stroke-width': 1.6, fill: 'none' }), s('rect', { x: 100, y: 61, width: 12, height: 15, rx: 1.5, fill: '#fff', stroke: '#2f6fd6', 'stroke-width': 1 }), s('rect', { x: 102, y: 63, width: 8, height: 6, fill: '#9fb6c9' }), s('path', { d: 'M102 72 L110 72', stroke: '#333', 'stroke-width': 1 }));
    case 'shades':
      return s('g', {}, s('path', { d: 'M128 21 L141 25', stroke: '#111', 'stroke-width': 1.4 }), s('rect', { x: 130, y: 20, width: 9, height: 6, rx: 2, fill: '#111' }), s('path', { d: 'M131 21 L135 21', stroke: 'rgba(255,255,255,.6)', 'stroke-width': 1 }));
    case 'ribbon':
      return s('g', { transform: 'translate(118 14)' }, s('path', { d: 'M0 0 L-7 -5 L-7 5Z M0 0 L7 -5 L7 5Z', fill: '#e26aa8', stroke: 'rgba(0,0,0,.2)', 'stroke-width': 0.6 }), s('circle', { r: 2.2, fill: '#c94b8c' }));
    case 'headset':
      return s('g', { fill: 'none' }, s('path', { d: 'M121 18 Q128 6 136 16', stroke: '#222', 'stroke-width': 2.4 }), s('rect', { x: 132, y: 15, width: 5, height: 7, rx: 2, fill: '#222' }), s('path', { d: 'M134 22 Q138 30 143 30', stroke: '#222', 'stroke-width': 1.4 }), s('circle', { cx: 143.5, cy: 30, r: 1.6, fill: '#c9281b' }));
    case 'partyhat':
      return s('g', {}, s('path', { d: 'M121 15 L127 -4 L133 15Z', fill: silk, stroke: 'rgba(0,0,0,.3)', 'stroke-width': 0.8 }), s('path', { d: 'M123.5 8 L130.5 8 M125 2 L129 2', stroke: 'rgba(255,255,255,.75)', 'stroke-width': 1.4 }), s('circle', { cx: 127, cy: -5, r: 2.6, fill: '#f2c230' }));
    default:
      return null;
  }
}

/** 질주하는 말 + 기수 (오른쪽을 본다). h: 출주표의 말 정보 */
export function runnerSvg(h) {
  const [coat, coatFar] = COATS[(h.no * 3) % COATS.length];
  const silk = h.color;
  const look = h.jockeyLook ?? { pattern: 'none', skin: '#f3c9a0', acc: 'none', hair: '#222' };
  const frames = (set, color) => set.map((pair, i) => s('g', { class: `gf g${i + 1}` }, leg(pair[1], color, 5.5), leg(pair[0], color, 6.2)));
  return s(
    'svg',
    { viewBox: '0 0 150 110', class: 'runner', 'aria-hidden': 'true' },
    s(
      'g',
      { class: 'hz-body' },
      // 꼬리
      s('path', { class: 'hz-tail', d: 'M34 50 C18 46 8 54 2 68 C14 62 22 60 36 58Z', fill: '#1a1410' }),
      // 먼 쪽 다리 → 몸 → 가까운 쪽 다리 순서는 frames 안에서 처리
      s('g', { class: 'hz-hind' }, frames(HIND, coatFar)),
      s('g', { class: 'hz-front' }, frames(FRONT, coatFar)),
      // 몸통
      s('ellipse', { cx: 72, cy: 57, rx: 40, ry: 16.5, fill: coat }),
      s('ellipse', { cx: 68, cy: 50, rx: 30, ry: 6, fill: 'rgba(255,255,255,.12)' }),
      // 목·머리
      s(
        'g',
        { class: 'hz-head' },
        s('path', { d: 'M96 50 C104 38 112 28 121 20 L134 25 C130 35 120 47 108 62Z', fill: coat }),
        s('path', { class: 'hz-mane', d: 'M101 44 C108 34 114 26 121 19 L116 22 C110 28 104 36 98 46Z', fill: '#1a1410' }),
        s('path', { d: 'M119 17 C130 12 141 19 148 30 C149.5 34 146 37.5 142 36 L125 30Z', fill: coat }),
        s('path', { d: 'M123 16 L125 7 L130 15Z', fill: coat }),
        s('circle', { cx: 134, cy: 23.5, r: 1.8, fill: '#111' }),
        s('circle', { cx: 134.6, cy: 23, r: 0.6, fill: '#fff' }),
        s('ellipse', { cx: 145, cy: 32, rx: 1.4, ry: 1, fill: '#111' }),
        // 막판 안간힘: 치켜뜬 눈썹
        s('path', { class: 'hz-brow', d: 'M130 19.5 L137.5 21.5', stroke: '#111', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        // 지침: 혀 내밀고 땀
        s('path', { class: 'hz-tongue', d: 'M143 35 Q147 41 142 42 Q139 40 141 35.5Z', fill: '#e2687a' }),
        s('path', { class: 'hz-sweat', d: 'M128 10 Q130 14 128.5 16 Q126.5 14 128 10Z', fill: '#8fd3ff' }),
        // 굴레·고삐
        s('path', { d: 'M130 20 L138 33 M126 26 L144 30', stroke: '#3a2416', 'stroke-width': 1.4 }),
      ),
      gearSvg(GEARS[(h.no - 1) % GEARS.length], silk),
      // 번호천
      s('rect', { x: 58, y: 45, width: 26, height: 17, rx: 2.5, fill: '#fff', stroke: 'rgba(0,0,0,.2)' }),
      s('text', { x: 71, y: 58, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 900, fill: '#111', 'font-family': 'sans-serif' }, String(h.no)),
      // 기수
      s(
        'g',
        { class: 'jk' },
        // 다리·부츠
        s('path', { d: 'M74 42 L84 51 L78 56', stroke: '#f4f1e8', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        s('path', { d: 'M80 54 L77 58', stroke: '#1a1410', 'stroke-width': 5, 'stroke-linecap': 'round' }),
        // 몸통 (앞으로 숙임)
        s('ellipse', { cx: 79, cy: 35, rx: 13, ry: 8, fill: silk, stroke: 'rgba(0,0,0,.28)', 'stroke-width': 0.8, transform: 'rotate(-18 79 35)' }),
        helmetPattern(look.pattern, 79, 40, 9, silk),
        // 고삐 잡은 팔
        s('path', { d: 'M88 33 L104 34 L118 28', stroke: silk, 'stroke-width': 4.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        s('circle', { cx: 104, cy: 34, r: 2.4, fill: look.skin }),
        s('path', { d: 'M104 34 L124 26', stroke: '#3a2416', 'stroke-width': 1 }),
        // 채찍 팔 (막판에 휘두름)
        s(
          'g',
          { class: 'jk-whip' },
          s('path', { d: 'M76 31 L66 25', stroke: silk, 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
          s('circle', { cx: 66, cy: 25, r: 2.3, fill: look.skin }),
          s('path', { d: 'M66 25 L46 15', stroke: '#2a1c14', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        ),
        // 머리 (크게)
        jockeyHead(look, silk, 93, 20, 11.5),
      ),
    ),
  );
}

/** 프로필 창용 기수 초상 */
export function jockeyPortrait(h) {
  const look = h.jockeyLook;
  return s(
    'svg',
    { viewBox: '0 0 120 120', class: 'jk-portrait', 'aria-hidden': 'true' },
    s('circle', { cx: 60, cy: 60, r: 58, fill: 'rgba(255,255,255,.06)' }),
    s('path', { d: 'M22 120 C24 96 40 84 60 84 C80 84 96 96 98 120Z', fill: h.color, stroke: 'rgba(0,0,0,.3)' }),
    helmetPattern(look.pattern, 60, 108, 16, h.color),
    s('rect', { x: 48, y: 92, width: 24, height: 16, rx: 3, fill: '#fff' }),
    s('text', { x: 60, y: 105, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 900, fill: '#111', 'font-family': 'sans-serif' }, String(h.no)),
    jockeyHead(look, h.color, 60, 52, 32),
  );
}
