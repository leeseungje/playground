// NPC 딜러 일러스트 + 말풍선
import { el, svg } from './util.js';

function figure() {
  const s = (tag, attrs) => svg(tag, attrs);
  return svg(
    'svg',
    { viewBox: '0 0 140 150', class: 'dealer-svg', 'aria-hidden': 'true' },
    svg(
      'defs',
      {},
      svg('linearGradient', { id: 'dl-vest', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', 'stop-color': '#2b2f3a' }), s('stop', { offset: '1', 'stop-color': '#12141a' })),
      svg('linearGradient', { id: 'dl-skin', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', 'stop-color': '#f6d2b4' }), s('stop', { offset: '1', 'stop-color': '#e9b993' })),
      svg('linearGradient', { id: 'dl-hair', x1: 0, y1: 0, x2: 1, y2: 1 }, s('stop', { offset: '0', 'stop-color': '#3b2a20' }), s('stop', { offset: '1', 'stop-color': '#1d140f' })),
      svg('radialGradient', { id: 'dl-gold', cx: 0.35, cy: 0.35, r: 0.8 }, s('stop', { offset: '0', 'stop-color': '#fff2b8' }), s('stop', { offset: '1', 'stop-color': '#c9952c' })),
    ),
    // 어깨와 팔(흰 셔츠 소매)
    s('path', { d: 'M8 150 C10 118 26 102 50 96 L90 96 C114 102 130 118 132 150Z', fill: '#f4f2ee' }),
    // 조끼
    s('path', { d: 'M22 150 C24 122 36 106 52 100 L70 128 L88 100 C104 106 116 122 118 150Z', fill: 'url(#dl-vest)' }),
    // 셔츠 V
    s('path', { d: 'M52 100 L70 128 L88 100 L80 96 L70 104 L60 96Z', fill: '#ffffff' }),
    // 조끼 단추
    s('circle', { cx: 70, cy: 136, r: 2.6, fill: 'url(#dl-gold)' }),
    s('circle', { cx: 70, cy: 146, r: 2.6, fill: 'url(#dl-gold)' }),
    // 명찰
    s('rect', { x: 92, y: 118, width: 18, height: 7, rx: 1.5, fill: 'url(#dl-gold)' }),
    // 목
    s('path', { d: 'M60 84 L80 84 L80 100 L70 106 L60 100Z', fill: '#e2ad87' }),
    // 나비넥타이
    svg(
      'g',
      { class: 'dl-bow' },
      s('path', { d: 'M70 104 L56 97 L56 111Z', fill: '#b3202b' }),
      s('path', { d: 'M70 104 L84 97 L84 111Z', fill: '#b3202b' }),
      s('rect', { x: 66.5, y: 100.5, width: 7, height: 7, rx: 2, fill: '#8e1520' }),
    ),
    // 귀
    s('ellipse', { cx: 41, cy: 58, rx: 6, ry: 9, fill: '#e9b993' }),
    s('ellipse', { cx: 99, cy: 58, rx: 6, ry: 9, fill: '#e9b993' }),
    // 얼굴
    s('ellipse', { cx: 70, cy: 56, rx: 29, ry: 33, fill: 'url(#dl-skin)' }),
    // 머리카락 (넘긴 머리)
    s('path', { d: 'M40 52 C38 26 54 14 72 15 C92 15 104 28 101 52 C98 40 90 33 80 31 C70 36 56 35 48 31 C44 36 41 43 40 52Z', fill: 'url(#dl-hair)' }),
    s('path', { d: 'M56 22 C66 18 80 18 90 24', stroke: '#5a4334', 'stroke-width': 1.5, fill: 'none', opacity: 0.7 }),
    // 눈썹
    s('path', { class: 'dl-brow', d: 'M52 46 Q58 42 64 45', stroke: '#2a1c14', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }),
    s('path', { class: 'dl-brow', d: 'M76 45 Q82 42 88 46', stroke: '#2a1c14', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }),
    // 눈 (평소)
    svg('g', { class: 'dl-eyes' }, s('ellipse', { cx: 58, cy: 55, rx: 3.2, ry: 4 }), s('ellipse', { cx: 82, cy: 55, rx: 3.2, ry: 4 })),
    // 눈 (기쁨)
    svg(
      'g',
      { class: 'dl-eyes-happy' },
      s('path', { d: 'M54 56 Q58 51 62 56', stroke: '#1d140f', 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' }),
      s('path', { d: 'M78 56 Q82 51 86 56', stroke: '#1d140f', 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' }),
    ),
    // 볼
    s('ellipse', { cx: 52, cy: 66, rx: 5, ry: 3, fill: '#e98f7a', opacity: 0.35 }),
    s('ellipse', { cx: 88, cy: 66, rx: 5, ry: 3, fill: '#e98f7a', opacity: 0.35 }),
    // 코
    s('path', { d: 'M70 58 Q67 66 70 68', stroke: '#c98d6a', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }),
    // 입 (미소 / 말하는 중)
    s('path', { class: 'dl-mouth-smile', d: 'M60 75 Q70 83 80 75', stroke: '#7a3326', 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' }),
    s('ellipse', { class: 'dl-mouth-talk', cx: 70, cy: 77, rx: 6, ry: 4.5, fill: '#7a3326' }),
    // 콧수염
    s('path', { d: 'M60 72 Q65 69 70 71 Q75 69 80 72 Q75 74 70 72.5 Q65 74 60 72Z', fill: '#3b2a20' }),
  );
}

export function createDealer() {
  const bubbleText = el('span', { class: 'bubble-text' });
  const bubble = el('div', { class: 'dealer-bubble', role: 'status', 'aria-live': 'polite' }, bubbleText);
  const avatar = el('div', { class: 'dealer-figure' }, figure());
  const root = el('div', { class: 'dealer' }, avatar, bubble);
  let last = '';
  let talkTimer = null;
  let moodTimer = null;

  return {
    root,
    /** 딜러 말풍선 내용 바꾸기 (같은 말이면 무시) */
    say(text) {
      if (!text || text === last) return;
      last = text;
      bubbleText.textContent = text;
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      avatar.classList.add('talking');
      clearTimeout(talkTimer);
      talkTimer = setTimeout(() => avatar.classList.remove('talking'), Math.min(2200, 300 + text.length * 45));
    },
    /** 'happy' 등 잠깐 표정 바꾸기 */
    mood(m, ms = 2500) {
      avatar.dataset.mood = m;
      clearTimeout(moodTimer);
      moodTimer = setTimeout(() => (avatar.dataset.mood = ''), ms);
    },
    /** 카드를 내보내는 위치(무대 좌표 기준 요소) */
    hand: avatar,
  };
}
