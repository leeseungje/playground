// 초대 링크 복사. 사내 주소는 http 라서 navigator.clipboard 가 막히므로, 임시 입력칸을 써서 복사한다.
import { el, toast } from './util.js';
import { modal } from './panels.js';

/** 글자를 클립보드에 복사. 성공하면 true */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 아래 방법으로 다시 시도 */
    }
  }
  // execCommand('copy') 는 '포커스된' 입력칸의 선택 영역을 복사한다. 숨긴 칸에 포커스를 안 주면 아무것도 복사되지 않는다.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  document.body.append(ta);
  const prev = document.activeElement;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (prev && typeof prev.focus === 'function') prev.focus();
  return ok;
}

/** 초대 링크 복사. 브라우저가 막으면 링크를 선택해 둔 창을 띄워 직접 복사하게 한다 */
export async function copyInvite(link) {
  if (await copyText(link)) {
    toast('초대 링크를 복사했어요. Teams 채팅방에 붙여 넣으세요!');
    return;
  }
  const input = el('input', { value: link, readonly: true, class: 'invite-input', 'aria-label': '초대 링크' });
  const copyBtn = el('button', { class: 'btn primary' }, '복사');
  const closeBtn = el('button', { class: 'btn ghost' }, '닫기');
  const m = modal(
    '초대 링크',
    el(
      'div',
      { class: 'settings-form' },
      el('p', { class: 'muted' }, '브라우저가 자동 복사를 막았어요. 아래 링크가 선택돼 있으니 Ctrl+C 로 복사해 주세요.'),
      input,
      el('div', { class: 'modal-actions' }, closeBtn, copyBtn),
    ),
  );
  const selectAll = () => {
    input.focus();
    input.select();
  };
  setTimeout(selectAll, 60);
  input.addEventListener('focus', selectAll);
  copyBtn.addEventListener('click', () => {
    selectAll();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    toast(ok ? '복사했어요!' : 'Ctrl+C 를 눌러 복사해 주세요');
    if (ok) m.close();
  });
  closeBtn.addEventListener('click', () => m.close());
}

// GitHub Pages 입구 주소. 초대 링크는 이 주소로 만들고, 입구 페이지가 사내 게임 서버의 방으로 보내 준다.
export const PAGES_URL = 'https://leeseungje.github.io/TexasHoldem/';

/** 게임 종류(holdem/race/liar)와 방 코드로 GitHub 도메인 초대 링크를 만든다 */
export function pagesInvite(game, code) {
  const q = new URLSearchParams();
  if (game !== 'holdem') q.set('game', game);
  q.set('room', code);
  // 기본 포트(7777)가 아닌 서버에서 열었으면 포트도 알려 준다
  if (location.port && location.port !== '7777') q.set('port', location.port);
  return `${PAGES_URL}?${q}`;
}
