// 화투 카드: 실제 한국 화투(민화 화투) SVG 를 한 장씩 잘라 보여 준다.
// 그림 출처: Wikimedia Commons "Hwatu001~012.svg, Hwatu00X1.svg" by Pk0001, CC BY-SA 4.0
//   https://commons.wikimedia.org/wiki/Category:SVG_Hanafuda  (자세한 표기는 public/img/hwatu/LICENSE.md)
// 파일 하나에 같은 달 4장이 가로로 들어 있어서, SVG 조각 주소(#svgView(viewBox(...)))로 잘라 쓴다.
import { el } from '../util.js';
import { card, MONTHS } from '/shared/hwatu.js';

/** 파일별 카드 상자 [x, y, w, h] (브라우저에서 잰 값) */
const BOXES = {
  '001': [[6.94, 11.48, 89.53, 135.8], [113.88, 11.48, 89.53, 135.8], [220.83, 11.48, 89.53, 135.8], [327.77, 11.48, 89.53, 135.8]],
  '002': [[42.52, 46.83, 326.17, 494.71], [435.21, 46.83, 326.17, 494.71], [827.89, 46.83, 326.17, 494.71], [1220.58, 46.83, 326.17, 494.71]],
  '003': [[43.92, 52.4, 332, 503.56], [442.47, 53.85, 331.05, 502.11], [840.54, 53.85, 331.05, 502.11], [1238.61, 53.85, 331.05, 502.11]],
  '004': [[6.48, 13.14, 89.53, 135.8], [113.43, 13.14, 89.53, 135.8], [220.37, 13.14, 89.53, 135.8], [327.32, 13.14, 89.53, 135.8]],
  '005': [[7.24, 12.84, 89.53, 135.8], [114.18, 12.84, 89.53, 135.8], [221.13, 12.84, 89.53, 135.8], [328.07, 12.84, 89.53, 135.8]],
  '006': [[7.47, 12.79, 89.53, 135.8], [114.42, 13.19, 89.53, 135.8], [221.36, 13.19, 89.53, 135.8], [328.75, 12.9, 89.53, 135.8]],
  '007': [[27.13, 45.77, 338.39, 513.25], [431.48, 45.77, 338.39, 513.25], [835.83, 45.77, 338.39, 513.25], [1240.18, 45.77, 338.39, 513.25]],
  '008': [[25.13, 41, 338.39, 513.25], [431.5, 41, 338.39, 513.25], [837.86, 41, 338.39, 513.25], [1244.23, 41, 338.39, 513.25]],
  '009': [[28.81, 49.38, 338.39, 513.25], [433.06, 49.38, 338.39, 513.25], [837.31, 49.38, 338.39, 513.25], [1241.55, 49.38, 338.39, 513.25]],
  '010': [[29.29, 48.63, 338.39, 513.25], [433.38, 48.63, 338.39, 513.25], [837.48, 48.63, 338.39, 513.25], [1241.57, 48.63, 338.39, 513.25]],
  '011': [[29.09, 49.5, 338.39, 513.25], [432.73, 49.5, 338.39, 513.25], [836.38, 49.5, 338.39, 513.25], [1240.02, 49.5, 338.39, 513.25]],
  '012': [[25.59, 52, 338.39, 513.25], [431.5, 55.37, 338.39, 513.25], [837.42, 51.88, 338.39, 513.25], [1242.52, 51.9, 338.39, 513.25]],
  '00X1': [[7.75, 15.35, 89.53, 135.8], [115.11, 15.36, 89.53, 135.8], [220.2, 15.15, 89.53, 135.8], [327.57, 15.16, 89.53, 135.8]],
};

/** 카드 id → 잘라 낸 그림 주소 */
export function artUrl(id) {
  const c = card(id);
  const file = c.joker ? '00X1' : String(c.month).padStart(3, '0');
  const idx = c.joker ? Number(id.split('-')[1]) - 1 : Number(id.split('-')[1]);
  const [x, y, w, h] = BOXES[file][idx];
  return `/img/hwatu/Hwatu${file}.svg#svgView(viewBox(${x},${y},${w},${h}))`;
}

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
  const src = c.joker && skin.joker ? skin.joker : artUrl(id);
  const label = c.joker ? c.tag : `${c.month}월 ${m.name} · ${c.tag}`;
  return el(
    'div',
    { class: `hwc ${size} k-${c.kind} m${c.month} ${cls}`, 'data-id': id, title: label, 'aria-label': label, ...attrs },
    el('div', { class: 'hwc-face' }, el('img', { class: 'hwc-img', src, alt: '', draggable: 'false', decoding: 'async' })),
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
