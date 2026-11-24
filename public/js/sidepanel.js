// 옆 패널 (채팅 + 다른 탭). 채팅 입력창은 한 번만 만들어서, 새 메시지가 와도 쓰던 글·포커스가 유지된다.
import { el, toast, hueOf, initial } from './util.js';
import { play } from './sound.js';

/**
 * @param root 패널을 넣을 요소
 * @param opts.tabs [[key, label], ...] — 첫 번째는 반드시 'chat'
 * @param opts.send (event, payload) => Promise<{error?}>
 * @param opts.emptyText 대화가 없을 때 문구
 */
export function createSidePanel(root, { tabs, send, emptyText = '아직 대화가 없어요' }) {
  let current = 'chat';
  let lastChatId = null;
  let unread = 0;
  let me = null;
  const tabBtns = new Map();
  const bodies = new Map();
  const sigs = new Map();

  const tabBar = el(
    'div',
    { class: 'tabs', role: 'tablist' },
    tabs.map(([key, label]) => {
      const b = el('button', { class: 'tab', role: 'tab', onclick: () => select(key) }, label, el('span', { class: 'badge' }));
      tabBtns.set(key, b);
      return b;
    }),
  );

  // 채팅 (고정)
  const list = el('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const input = el('input', { class: 'chat-input', maxlength: 100, placeholder: '메시지 보내기 (Enter)', 'aria-label': '채팅 메시지' });
  const sendBtn = el('button', { class: 'btn small' }, '보내기');
  const sendIt = async () => {
    const text = input.value.trim();
    if (!text) return;
    const r = await send('chat', { text });
    if (r.error) return toast(r.error, 'error');
    // 보내는 사이 새로 입력한 글은 지우지 않는다
    if (input.value.trim() === text) input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) sendIt();
    e.stopPropagation(); // 게임 단축키로 넘어가지 않게
  });
  sendBtn.addEventListener('click', sendIt);
  bodies.set('chat', el('div', { class: 'panel-body chat' }, list, el('div', { class: 'chat-form' }, input, sendBtn)));
  for (const [key] of tabs) if (key !== 'chat') bodies.set(key, el('div', { class: 'panel-body' }));
  root.replaceChildren(tabBar, ...bodies.values());

  function select(key) {
    current = key;
    for (const [k, b] of tabBtns) {
      b.classList.toggle('on', k === key);
      b.setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    for (const [k, b] of bodies) b.classList.toggle('hidden', k !== key);
    if (key === 'chat') {
      unread = 0;
      setBadge();
      list.scrollTop = list.scrollHeight;
    }
  }
  const setBadge = () => (tabBtns.get('chat').querySelector('.badge').textContent = unread ? String(unread) : '');
  select('chat');

  function renderChat(chat) {
    const newest = chat.at(-1)?.id ?? 0;
    if (newest === lastChatId && list.children.length) return;
    if (lastChatId !== null && newest > lastChatId) {
      const fresh = chat.filter((m) => m.id > lastChatId && m.pid !== me);
      if (fresh.length) {
        play('pop');
        if (current !== 'chat') {
          unread += fresh.length;
          setBadge();
        }
      }
    }
    lastChatId = newest;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(
      ...(chat.length
        ? chat.map((m) =>
            el(
              'li',
              { class: m.pid === me ? 'mine' : '' },
              el('span', { class: 'chat-avatar', style: { '--hue': hueOf(m.name) } }, initial(m.name)),
              el('div', {}, el('div', { class: 'chat-name' }, m.name), el('div', { class: 'chat-text' }, m.text)),
            ),
          )
        : [el('li', { class: 'empty' }, emptyText)]),
    );
    if (atBottom || chat.at(-1)?.pid === me) list.scrollTop = list.scrollHeight;
  }

  return {
    /**
     * @param state.me 내 id
     * @param state.chat 채팅 목록
     * @param others { key: [sig, () => Node] } — sig 가 바뀐 탭만 다시 그린다
     */
    update({ me: myId, chat }, others = {}) {
      me = myId;
      renderChat(chat);
      for (const [key, [sig, build]] of Object.entries(others)) {
        if (sigs.get(key) === sig) continue;
        sigs.set(key, sig);
        bodies.get(key)?.replaceChildren(build());
      }
    },
  };
}
