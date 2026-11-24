// 작은 DOM·형식 도우미

export const $ = (sel, root = document) => root.querySelector(sel);

/** el('div', { class: 'x', onclick }, child, '텍스트', [배열도 가능]) */
export function el(tag, attrs = {}, ...children) {
  const n = tag.includes(':') ? document.createElementNS('http://www.w3.org/2000/svg', tag.split(':')[1]) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      // CSS 변수(--x)는 style 속성 대입으로 안 들어가므로 setProperty 로 넣는다
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith('--')) n.style.setProperty(prop, String(val));
        else n.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const svg = (tag, attrs, ...children) => el(`svg:${tag}`, attrs, ...children);

export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

/** 1,250 → 1.2K 처럼 좁은 자리용 */
export function short(n) {
  n = Number(n || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return fmt(n);
}

let toastTimer;
export function hideToast() {
  clearTimeout(toastTimer);
  const t = $('#toast');
  if (t) t.className = 'toast';
}
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}

/** 이름 → 고정 색상 (아바타용) */
export function hueOf(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

export const initial = (name) => [...String(name || '?').trim()][0]?.toUpperCase() ?? '?';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const storage = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(`holdem.${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`holdem.${k}`, JSON.stringify(v));
    } catch {
      /* 저장 불가 환경 */
    }
  },
};

/** 탭마다 다른 플레이어가 되도록 sessionStorage */
export const session = {
  get(k) {
    try {
      return sessionStorage.getItem(`holdem.${k}`);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) sessionStorage.removeItem(`holdem.${k}`);
      else sessionStorage.setItem(`holdem.${k}`, v);
    } catch {
      /* 무시 */
    }
  },
};
