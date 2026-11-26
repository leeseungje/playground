// 화투 카드 (전통 화투 그림은 art.js 의 SVG, 광 표시와 달 숫자를 위에 얹는다)
import { el } from '../util.js';
import { card, MONTHS } from '/shared/hwatu.js';
import { artSvg } from './art.js';

/*
 * 카드 스킨: public/img/doguri/ 에 그림 파일을 넣으면 자동으로 쓴다.
 *  - joker.png : 조커 카드 그림
 *  - back.png  : 카드 뒷면 가운데 그림
 */
export const skin = { joker: null, back: null };
export async function loadSkin() {
  for (const k of Object.keys(skin)) {
    try {
      const url = `/img/doguri/${k}.png`;
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) skin[k] = url;
    } catch {
      /* 스킨 없음 */
    }
  }
  document.body.classList.toggle('skin-back', !!skin.back);
  return skin;
}

/**
 * 카드 한 장
 * @param id '3-0' 같은 카드 id (null 이면 뒷면)
 * @param opts.size 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 * @param opts.cls 추가 class
 * @param opts.attrs 추가 속성 (onclick 등)
 */
export function cardEl(id, { size = 'md', cls = '', attrs = {} } = {}) {
  if (!id) return backEl({ size, cls, attrs });
  const c = card(id);
  const m = MONTHS[c.month];
  const art = el('div', { class: 'hwc-art' });
  if (c.joker && skin.joker) art.append(el('img', { src: skin.joker, alt: '', class: 'hwc-img' }));
  else art.innerHTML = artSvg(id, c); // 직접 만든 고정 SVG 문자열 (사용자 입력 없음)
  const parts = [art];
  if (c.kind === 'gwang') parts.push(el('div', { class: 'hwc-gwang' }, '光'));
  if (c.gukjin) parts.push(el('div', { class: 'hwc-mark gukjin', title: '국진 (쌍피로도 쓸 수 있음)' }, '국진'));
  if (c.kind === 'ssangpi') parts.push(el('div', { class: 'hwc-mark ssang' }, '쌍피'));
  return el(
    'div',
    {
      class: `hwc ${size} k-${c.kind} m${c.month} ${cls}`,
      'data-id': id,
      title: c.joker ? c.tag : `${c.month}월 ${m.name} · ${c.tag}`,
      'aria-label': c.joker ? c.tag : `${c.month}월 ${m.name} ${c.tag}`,
      ...attrs,
    },
    el('div', { class: 'hwc-face' }, ...parts),
  );
}

export function backEl({ size = 'md', cls = '', attrs = {} } = {}) {
  return el('div', { class: `hwc back ${size} ${cls}`, 'aria-label': '뒷면', ...attrs }, el('div', { class: 'hwc-face' }));
}

/** 먹은 패를 종류별로 묶는다 (광·열끗·띠·피) */
export function groupCaptured(ids) {
  const g = { gwang: [], yeol: [], tti: [], pi: [] };
  for (const id of ids) {
    const c = card(id);
    if (c.kind === 'gwang') g.gwang.push(id);
    else if (c.kind === 'yeol') g.yeol.push(id);
    else if (c.kind === 'tti') g.tti.push(id);
    else g.pi.push(id); // 피·쌍피·조커
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => card(a).month - card(b).month);
  return g;
}
