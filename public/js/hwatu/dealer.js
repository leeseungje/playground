// 화투판 딜러: 일러스트(SVG) + 말풍선 + 패 돌리기 연출. 수아(여)·지훈(남) 중 고를 수 있다.
import { el, svg, storage } from '../util.js';
import { backEl } from './card.js';
import { play } from '../sound.js';

const s = (tag, attrs, ...kids) => svg(tag, attrs, ...kids);
const grad = (id, stops, attrs = { x1: 0, y1: 0, x2: 0, y2: 1 }) => s('linearGradient', { id, ...attrs }, ...stops.map(([o, c, op]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': op ?? 1 })));
const rgrad = (id, stops, attrs = { cx: 0.5, cy: 0.5, r: 0.5 }) => s('radialGradient', { id, ...attrs }, ...stops.map(([o, c, op]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': op ?? 1 })));
const line = (d, stroke, w, extra = {}) => s('path', { d, stroke, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });

/** 눈 한쪽. cx 는 눈동자 중심 */
function eye(p, cx, side, { big = false } = {}) {
  const dx = cx - 66; // 왼쪽 눈 기준 좌표를 옮긴다
  const t = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${(Number(x) + dx).toFixed(1)} ${y}`);
  const mirror = side === 'r';
  const shape = big ? 'M58.5 65 Q66 57.6 74.5 63.6 Q66 70 58.5 65Z' : 'M58.8 64.6 Q66 59.4 73.6 63.4 Q66 67.4 58.8 64.6Z';
  const lash = big ? 'M55.2 60.6 Q56.4 62.6 58 64.2 Q66 56.4 75.2 63.4' : 'M58.2 64.2 Q66 58.2 74.2 63';
  const flip = (d) => (mirror ? d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${(160 - Number(x)).toFixed(1)} ${y}`) : t(d));
  const ix = mirror ? 160 - 66 : cx;
  return s(
    'g',
    { class: `hd-eye ${side}` },
    s('path', { d: flip(shape), fill: '#fff' }),
    s('circle', { cx: ix, cy: big ? 64.4 : 63.8, r: big ? 4.4 : 3.5, fill: `url(#${p}-iris)` }),
    s('circle', { cx: ix, cy: big ? 64.4 : 63.8, r: big ? 1.9 : 1.6, fill: '#140b08' }),
    s('circle', { cx: ix + 1.4, cy: big ? 62.8 : 62.5, r: big ? 1.4 : 1.1, fill: '#fff' }),
    s('circle', { cx: ix - 1.5, cy: big ? 66 : 65, r: 0.6, fill: '#fff', opacity: 0.8 }),
    line(flip(lash), '#140b08', big ? 2.1 : 2),
    big ? line(flip('M60.5 66.8 Q66 69.4 72 66.9'), '#8a5a4a', 0.7, { opacity: 0.6 }) : line(flip('M60.2 61.4 Q66 57.8 72.4 60.6'), '#7a4c3a', 0.8, { opacity: 0.45 }),
  );
}

function figureF() {
  const p = 'hf';
  return s(
    'svg',
    { viewBox: '0 0 160 176', class: 'hd-svg', 'aria-hidden': 'true' },
    s(
      'defs',
      {},
      grad(`${p}-skin`, [['0', '#fde8da'], ['1', '#f3cdb3']]),
      grad(`${p}-hair`, [['0', '#5a3a33'], ['0.5', '#2b1a1d'], ['1', '#140b0d']], { x1: 0, y1: 0, x2: 1, y2: 1 }),
      grad(`${p}-vest`, [['0', '#2c2230'], ['1', '#0f0b10']]),
      grad(`${p}-lip`, [['0', '#f0607a'], ['1', '#c9364f']]),
      grad(`${p}-back`, [['0', '#e0262f'], ['1', '#8f0d18']], { x1: 0, y1: 0, x2: 1, y2: 1 }),
      rgrad(`${p}-iris`, [['0', '#8a5a3c'], ['0.7', '#4a2a1c'], ['1', '#21120c']]),
      rgrad(`${p}-glow`, [['0', '#ffe9f0', 0.6], ['1', '#ffe9f0', 0]], { cx: 0.5, cy: 0.4, r: 0.6 }),
    ),
    s('ellipse', { cx: 80, cy: 70, rx: 70, ry: 66, fill: `url(#${p}-glow)` }),
    // 뒷머리 (긴 생머리)
    s('path', { d: 'M44 60 C38 24 62 10 82 10 C106 10 126 26 118 62 C122 92 126 116 116 136 C104 132 96 126 92 118 L68 118 C64 126 56 132 44 136 C34 116 38 90 44 60Z', fill: `url(#${p}-hair)` }),
    // 어깨: 흰 블라우스 + 검은 조끼 + 리본
    s('path', { d: 'M10 176 C12 144 32 124 60 118 L100 118 C128 124 148 144 150 176Z', fill: '#f8f5f1' }),
    s('path', { d: 'M24 176 C26 148 40 128 60 122 L80 150 L100 122 C120 128 134 148 136 176Z', fill: `url(#${p}-vest)` }),
    s('path', { d: 'M60 120 L80 150 L100 120 L92 116 L80 128 L68 116Z', fill: '#ffffff' }),
    s('path', { d: 'M80 124 L67 116.5 L67 131.5Z', fill: '#d81b3a' }),
    s('path', { d: 'M80 124 L93 116.5 L93 131.5Z', fill: '#d81b3a' }),
    s('rect', { x: 77, y: 121, width: 6, height: 6, rx: 2, fill: '#a3122a' }),
    s('rect', { x: 102, y: 140, width: 18, height: 7, rx: 1.5, fill: '#e8c46a' }),
    // 목
    s('path', { d: 'M72.5 96 L87.5 96 L87.5 116 L80 121 L72.5 116Z', fill: '#f0c6a8' }),
    s('path', { d: 'M72.5 100 Q80 106 87.5 100 L87.5 97 L72.5 97Z', fill: '#e0ad8e', opacity: 0.6 }),
    // 얼굴 (작은 V라인)
    s('path', { d: 'M54 58 C54 36 106 36 106 58 C106 79 99 92 88 99 C84 101.5 76 101.5 72 99 C61 92 54 79 54 58Z', fill: `url(#${p}-skin)` }),
    s('ellipse', { cx: 63, cy: 75.5, rx: 5, ry: 2.6, fill: '#ff8fa3', opacity: 0.28 }),
    s('ellipse', { cx: 97, cy: 75.5, rx: 5, ry: 2.6, fill: '#ff8fa3', opacity: 0.28 }),
    // 귀걸이
    s('circle', { cx: 54.5, cy: 78, r: 2.2, fill: '#f6d36b' }),
    s('circle', { cx: 105.5, cy: 78, r: 2.2, fill: '#f6d36b' }),
    // 앞머리 (가르마 커튼 뱅) + 얼굴 옆선
    s('path', { d: 'M50 58 C47 30 64 18 80 18 C97 18 113 30 110 58 C106 44 96 35 80 33.5 C64 35 54 44 50 58Z', fill: `url(#${p}-hair)` }),
    s('path', { d: 'M80 31 C69 35 59 45 55.5 62 C60 51 68 44 80 40Z', fill: '#24161a' }),
    s('path', { d: 'M80 31 C91 35 101 45 104.5 62 C100 51 92 44 80 40Z', fill: '#24161a' }),
    s('path', { d: 'M54 56 C49 76 51 98 58 112 C56 94 56 76 58.5 60Z', fill: `url(#${p}-hair)` }),
    s('path', { d: 'M106 56 C111 76 109 98 102 112 C104 94 104 76 101.5 60Z', fill: `url(#${p}-hair)` }),
    line('M60 26 C70 20 90 20 100 27', '#fff', 1.6, { opacity: 0.22 }),
    // 눈썹 (부드러운 아치)
    line('M60.5 55 Q67 52 73.5 54.2', '#3a2620', 1.8, { class: 'hd-brow' }),
    line('M86.5 54.2 Q93 52 99.5 55', '#3a2620', 1.8, { class: 'hd-brow' }),
    // 눈 (크고 맑게)
    s('g', { class: 'hd-eyes' }, eye(p, 66, 'l', { big: true }), eye(p, 94, 'r', { big: true })),
    s('g', { class: 'hd-eyes-happy' }, line('M59 65.5 Q66.5 58.5 74 65.5', '#140b08', 2.4), line('M86 65.5 Q93.5 58.5 101 65.5', '#140b08', 2.4)),
    line('M86 64.6 Q93.5 67.8 101 64.6', '#140b08', 2.4, { class: 'hd-wink' }),
    // 코
    line('M80.6 70 Q79.2 76.5 81 78.2', '#d9a084', 1.2),
    line('M78.6 79.2 Q80 80 81.6 79.2', '#d29478', 0.9, { opacity: 0.7 }),
    // 입술
    s('path', { class: 'hd-mouth', d: 'M73.8 86.8 Q77 84.8 80 86 Q83 84.8 86.2 86.8 Q80 92.8 73.8 86.8Z', fill: `url(#${p}-lip)` }),
    s('path', { class: 'hd-smile', d: 'M72.5 85.6 Q80 96 87.5 85.6 Q80 89.4 72.5 85.6Z', fill: '#fff', stroke: '#d8455e', 'stroke-width': 1.6 }),
    s('ellipse', { cx: 81.5, cy: 89.2, rx: 1.6, ry: 0.6, fill: '#fff', opacity: 0.55 }),
    arm(p, '#f8f5f1', '#f3cdb3'),
  );
}

function figureM() {
  const p = 'hm';
  return s(
    'svg',
    { viewBox: '0 0 160 176', class: 'hd-svg', 'aria-hidden': 'true' },
    s(
      'defs',
      {},
      grad(`${p}-skin`, [['0', '#f8dcc4'], ['1', '#ebc2a0']]),
      grad(`${p}-hair`, [['0', '#3a3140'], ['0.55', '#15121a'], ['1', '#07060a']], { x1: 0, y1: 0, x2: 1, y2: 1 }),
      grad(`${p}-suit`, [['0', '#262833'], ['1', '#0c0d11']]),
      grad(`${p}-back`, [['0', '#e0262f'], ['1', '#8f0d18']], { x1: 0, y1: 0, x2: 1, y2: 1 }),
      rgrad(`${p}-iris`, [['0', '#6a4632'], ['0.7', '#33201a'], ['1', '#150c09']]),
      rgrad(`${p}-glow`, [['0', '#fff7e8', 0.55], ['1', '#fff7e8', 0]], { cx: 0.5, cy: 0.4, r: 0.6 }),
    ),
    s('ellipse', { cx: 80, cy: 70, rx: 70, ry: 66, fill: `url(#${p}-glow)` }),
    // 정장 + 단추 하나 푼 셔츠
    s('path', { d: 'M6 176 C8 140 30 120 58 114 L102 114 C130 120 152 140 154 176Z', fill: `url(#${p}-suit)` }),
    s('path', { d: 'M60 114 L80 150 L100 114 L92 110 L80 126 L68 110Z', fill: '#f8f6f2' }),
    s('path', { d: 'M74.5 122 L80 134 L85.5 122 L80 126Z', fill: '#e2b593' }),
    s('path', { d: 'M58 114 L80 158 L66 120 L52 118Z', fill: '#191a20' }),
    s('path', { d: 'M102 114 L80 158 L94 120 L108 118Z', fill: '#191a20' }),
    line('M58 114 L80 158 M102 114 L80 158', '#3a3c47', 1),
    s('path', { d: 'M112 134 L124 132 L122 140 L113 141Z', fill: '#c8102e' }),
    // 목
    s('path', { d: 'M70 96 L90 96 L90 114 L80 123 L70 114Z', fill: '#e6b896' }),
    s('path', { d: 'M70 101 Q80 108 90 101 L90 97 L70 97Z', fill: '#d6a07e', opacity: 0.65 }),
    // 뒷머리 (얼굴 뒤를 채운다)
    s('path', { d: 'M49 68 C43 34 62 14 84 14 C106 14 119 32 111 68Z', fill: '#110e14' }),
    // 귀
    s('path', { d: 'M53 60 C46.5 56 45.5 70 52 74Z', fill: '#e8b998' }),
    s('path', { d: 'M107 60 C113.5 56 114.5 70 108 74Z', fill: '#e8b998' }),
    // 얼굴 (갸름한 턱선)
    s('path', { d: 'M53 58 C53 36 107 36 107 58 C107 80 100 94 87 101 C83 103 77 103 73 101 C60 94 53 80 53 58Z', fill: `url(#${p}-skin)` }),
    s('path', { d: 'M56 74 C59 87 66 96 74 100 C66 99 57 90 56 74Z', fill: '#d9a682', opacity: 0.45 }),
    s('path', { d: 'M104 74 C101 87 94 96 86 100 C94 99 103 90 104 74Z', fill: '#d9a682', opacity: 0.45 }),
    // 쉼표머리 (볼륨 있게 넘긴 앞머리)
    s('path', { d: 'M48 64 C43 30 62 13 84 14 C107 15 119 31 113 62 C111 51 106 45 98 42 C90 42.5 82 44.5 76.5 48.5 C72.5 51.5 70.8 54.5 70.5 58 C67 53 60.5 51 55.5 54.5 C52 57 50 60 48 64Z', fill: `url(#${p}-hair)` }),
    s('path', { d: 'M52.5 58 L53.5 71 L56.5 64Z', fill: '#15121a' }),
    s('path', { d: 'M107.5 58 L106.5 71 L103.5 64Z', fill: '#15121a' }),
    s('path', { d: 'M70.5 55 C68 61 70.5 66.5 75.5 65.5 C72.5 64.5 71 60.5 72.5 56Z', fill: `url(#${p}-hair)` }),
    line('M62 38 C72 31 88 30 100 36', '#6b5a7a', 1.4, { opacity: 0.55 }),
    line('M66 44 C74 38 86 37 96 41', '#6b5a7a', 1, { opacity: 0.4 }),
    // 눈썹 (곧고 또렷하게)
    line('M59.5 56.4 L72.5 54.8', '#16121a', 2.6, { class: 'hd-brow' }),
    line('M87.5 54.8 L100.5 56.4', '#16121a', 2.6, { class: 'hd-brow' }),
    // 눈
    s('g', { class: 'hd-eyes' }, eye(p, 66, 'l'), eye(p, 94, 'r')),
    s('g', { class: 'hd-eyes-happy' }, line('M59 64.5 Q66 58.5 73 64.5', '#16121a', 2.4), line('M87 64.5 Q94 58.5 101 64.5', '#16121a', 2.4)),
    line('M87 63.6 Q94 66.6 101 63.6', '#16121a', 2.4, { class: 'hd-wink' }),
    // 코 (높은 콧대)
    line('M79.4 64 L78.2 76.6 Q80.6 78.8 83.2 77.2', '#c48d6a', 1.4),
    line('M81 64.5 L80.4 75', '#fff3e6', 1.1, { opacity: 0.55 }),
    // 입 (옅은 미소)
    s('path', { class: 'hd-mouth', d: 'M73 87.2 Q80 90.6 87.4 86.2', stroke: '#a3584c', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }),
    line('M76.5 90.6 Q80 92 83.5 90.6', '#c98a78', 1, { opacity: 0.6 }),
    s('path', { class: 'hd-smile', d: 'M72 85.4 Q80 95 88.6 84.6 Q80 89.4 72 85.4Z', fill: '#fff', stroke: '#a3584c', 'stroke-width': 1.4 }),
    arm(p, `url(#${p}-suit)`, '#ebc2a0'),
  );
}

/** 오른팔과 화투 뭉치 (패를 돌릴 때 움직인다) */
function arm(p, sleeve, skin) {
  return s(
    'g',
    { class: 'hd-arm' },
    s('path', { d: 'M118 128 C130 134 140 146 142 160 L126 166 C122 154 116 146 108 140Z', fill: sleeve }),
    s('path', { d: 'M126 160 L142 156 L144 162 L128 167Z', fill: '#f8f6f2' }),
    s(
      'g',
      { class: 'hd-deck' },
      s('rect', { x: 130, y: 146, width: 18, height: 26, rx: 2, fill: `url(#${p}-back)`, stroke: '#1a1010', 'stroke-width': 1.2, transform: 'rotate(-14 139 159)' }),
      s('rect', { x: 133, y: 144, width: 18, height: 26, rx: 2, fill: `url(#${p}-back)`, stroke: '#1a1010', 'stroke-width': 1.2, transform: 'rotate(-4 142 157)' }),
    ),
    s('ellipse', { cx: 138, cy: 166, rx: 8.5, ry: 5.8, fill: skin }),
  );
}

export const DEALERS = { sua: { name: '딜러 수아', figure: figureF }, jihun: { name: '딜러 지훈', figure: figureM } };

/** 딜러 영역. say(text), mood('happy'|'wink'), deal(targets) */
export function createDealer() {
  const bubble = el('div', { class: 'hd-bubble', role: 'status', 'aria-live': 'polite' });
  const saved = storage.get('hwatu.dealer', 'sua');
  let who = DEALERS[saved] ? saved : 'sua';
  const nameBtn = el('button', { class: 'hd-name', title: '눌러서 딜러 바꾸기' });
  const fig = el('div', { class: 'hd-fig' });
  const draw = () => {
    fig.replaceChildren(DEALERS[who].figure(), nameBtn);
    nameBtn.textContent = `${DEALERS[who].name} ⇄`;
  };
  nameBtn.addEventListener('click', () => {
    who = who === 'sua' ? 'jihun' : 'sua';
    storage.set('hwatu.dealer', who);
    draw();
    play('pop');
  });
  draw();
  const root = el('div', { class: 'hd' }, fig, bubble);
  let moodTimer = null;
  let last = '';
  return {
    root,
    say(text) {
      if (text === last) return;
      last = text;
      bubble.textContent = text;
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
    },
    mood(kind, ms = 1600) {
      clearTimeout(moodTimer);
      fig.classList.remove('happy', 'wink');
      void fig.offsetWidth;
      fig.classList.add(kind);
      moodTimer = setTimeout(() => fig.classList.remove(kind), ms);
    },
    /** 손에서 카드가 날아가는 연출. targets: 받을 자리 요소 배열 (순서대로 한 장씩) */
    deal(targets, { gap = 95 } = {}) {
      const hand = fig.querySelector('.hd-deck');
      if (!hand || !targets.length || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      fig.classList.add('dealing');
      setTimeout(() => fig.classList.remove('dealing'), targets.length * gap + 500);
      targets.forEach((t, i) => {
        setTimeout(() => {
          if (!t.isConnected || !hand.isConnected) return;
          const a = hand.getBoundingClientRect();
          const b = t.getBoundingClientRect();
          const c = backEl({ size: 'sm', cls: 'hd-fly' });
          document.body.append(c);
          const w = c.offsetWidth || 42;
          const sx = a.left + a.width / 2 - w / 2;
          const sy = a.top + a.height / 2 - w * 0.8;
          const tx = b.left + Math.min(b.width, 60) / 2 - w / 2;
          const ty = b.top + Math.min(b.height, 80) / 2 - w * 0.8;
          const rot = (Math.random() - 0.5) * 40;
          c.style.left = `${sx}px`;
          c.style.top = `${sy}px`;
          const anim = c.animate(
            [
              { transform: 'translate(0,0) rotate(-20deg) scale(0.7)', opacity: 0.4 },
              { transform: `translate(${(tx - sx) * 0.55}px, ${(ty - sy) * 0.55 - 40}px) rotate(${rot + 360}deg) scale(1.05)`, opacity: 1, offset: 0.55 },
              { transform: `translate(${tx - sx}px, ${ty - sy}px) rotate(${rot + 720}deg) scale(1)`, opacity: 1 },
            ],
            { duration: 420, easing: 'cubic-bezier(.3,.7,.4,1)' },
          );
          play('deal');
          anim.onfinish = () => {
            c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = () => c.remove();
          };
        }, i * gap);
      });
    },
  };
}
