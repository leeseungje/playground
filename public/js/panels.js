// 옆 패널(채팅·기록·순위·딜러 로그), 방 설정 창, 토너먼트 우승 축하
import { el, fmt, toast, hueOf, initial } from './util.js';
import { miniCard } from './cards.js';
import { play } from './sound.js';

export function createPanels(root, { send }) {
  let state = null;
  let tab = 'chat';
  let unread = 0;
  const tabs = [
    ['chat', '채팅'],
    ['history', '기록'],
    ['rank', '순위'],
    ['log', '딜러'],
  ];
  const tabBtns = new Map();
  const bodies = new Map();
  const tabBar = el(
    'div',
    { class: 'tabs', role: 'tablist' },
    tabs.map(([k, t]) => {
      const b = el('button', { class: 'tab', role: 'tab', onclick: () => select(k) }, t, el('span', { class: 'badge' }));
      tabBtns.set(k, b);
      return b;
    }),
  );

  // 채팅
  const chatList = el('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const chatInput = el('input', { class: 'chat-input', maxlength: 100, placeholder: '메시지 보내기 (Enter)', 'aria-label': '채팅 메시지' });
  const emojiRow = el('div', { class: 'emoji-row' });
  const sendChat = async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    const r = await send('chat', { text });
    if (r.error) return toast(r.error, 'error');
    chatInput.value = '';
  };
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) sendChat();
    e.stopPropagation();
  });
  bodies.set(
    'chat',
    el('div', { class: 'panel-body chat' }, chatList, emojiRow, el('div', { class: 'chat-form' }, chatInput, el('button', { class: 'btn small', onclick: sendChat }, '보내기'))),
  );
  const historyList = el('ol', { class: 'history-list' });
  bodies.set('history', el('div', { class: 'panel-body' }, historyList));
  const rankBody = el('div', { class: 'rank' });
  bodies.set('rank', el('div', { class: 'panel-body' }, rankBody));
  const logList = el('ol', { class: 'log-list' });
  bodies.set('log', el('div', { class: 'panel-body' }, logList));

  root.replaceChildren(tabBar, ...bodies.values());

  function select(k) {
    tab = k;
    for (const [key, b] of tabBtns) {
      b.classList.toggle('on', key === k);
      b.setAttribute('aria-selected', key === k ? 'true' : 'false');
    }
    for (const [key, b] of bodies) b.classList.toggle('hidden', key !== k);
    if (k === 'chat') {
      unread = 0;
      tabBtns.get('chat').querySelector('.badge').textContent = '';
      chatList.scrollTop = chatList.scrollHeight;
    }
  }
  select('chat');

  let lastChatId = 0;
  let emojiSig = '';
  function renderChat() {
    const items = state.chat;
    const newest = items.at(-1)?.id ?? 0;
    if (newest !== lastChatId) {
      const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
      chatList.replaceChildren(
        ...items.map((m) =>
          el(
            'li',
            { class: m.pid === state.me ? 'mine' : '' },
            el('span', { class: 'chat-avatar', style: { '--hue': hueOf(m.name) } }, initial(m.name)),
            el('div', {}, el('div', { class: 'chat-name' }, m.name), el('div', { class: 'chat-text' }, m.text)),
          ),
        ),
      );
      if (atBottom || items.at(-1)?.pid === state.me) chatList.scrollTop = chatList.scrollHeight;
      if (tab !== 'chat' && lastChatId) {
        unread += items.filter((m) => m.id > lastChatId).length;
        tabBtns.get('chat').querySelector('.badge').textContent = unread ? String(unread) : '';
      }
      lastChatId = newest;
    }
    if (!items.length && !chatList.children.length) chatList.replaceChildren(el('li', { class: 'empty' }, '아직 대화가 없어요. 인사해 보세요!'));
    const sig = state.reactionList.join();
    if (sig !== emojiSig) {
      emojiSig = sig;
      emojiRow.replaceChildren(
        ...state.reactionList.map((e) =>
          el('button', { class: 'emoji-btn', 'aria-label': `${e} 보내기`, onclick: async () => { const r = await send('react', { emoji: e }); if (r.error) toast(r.error, 'error'); } }, e),
        ),
      );
    }
  }

  let historySig = '';
  function renderHistory() {
    const sig = state.history.map((h) => h.no).join();
    if (sig === historySig) return;
    historySig = sig;
    if (!state.history.length) {
      historyList.replaceChildren(el('li', { class: 'empty' }, '끝난 판이 여기에 쌓여요'));
      return;
    }
    historyList.replaceChildren(
      ...state.history.map((h) =>
        el(
          'li',
          { class: 'hist' },
          el('div', { class: 'hist-head' }, el('b', {}, `#${h.no}`), el('span', {}, `팟 ${fmt(h.pot)}`), el('span', { class: 'muted' }, `${fmt(h.blinds[0])}/${fmt(h.blinds[1])}`)),
          h.board.length ? el('div', { class: 'hist-board' }, h.board.map(miniCard)) : el('div', { class: 'hist-board muted' }, '플롭 전에 끝남'),
          el(
            'div',
            { class: 'hist-win' },
            h.winners.map((w) => el('div', {}, '🏆 ', el('b', {}, w.name), ` +${fmt(w.amount)}`, w.hand ? el('span', { class: 'muted' }, ` · ${w.hand}`) : null)),
          ),
          h.shown.length
            ? el(
                'div',
                { class: 'hist-shown' },
                h.shown.map((s) => el('div', {}, el('span', { class: 'hist-name' }, s.name), s.cards.map(miniCard), s.hand ? el('span', { class: 'muted' }, s.hand) : null)),
              )
            : null,
        ),
      ),
    );
  }

  function renderRank() {
    const t = state.tourney;
    const list = [...state.players].sort((a, b) => (a.place && b.place ? a.place - b.place : b.chips - a.chips || b.stats.net - a.stats.net));
    const head = t.active
      ? el('div', { class: 'rank-note' }, `토너먼트 레벨 ${t.level} · ${t.entrants}명 참가`)
      : t.winnerName
        ? el('div', { class: 'rank-note gold' }, `🏆 지난 토너먼트 우승: ${t.winnerName}`)
        : el('div', { class: 'rank-note' }, '칩이 많은 순서예요. 손익은 받은 칩 대비예요.');
    rankBody.replaceChildren(
      head,
      el(
        'table',
        { class: 'rank-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '이름'), el('th', {}, '칩'), el('th', {}, '손익'), el('th', { title: '이긴 판 / 참여한 판' }, '승'))),
        el(
          'tbody',
          {},
          list.map((p, i) =>
            el(
              'tr',
              { class: p.id === state.me ? 'me' : '' },
              el('td', {}, p.place ? `${p.place}위` : i + 1),
              el('td', {}, el('span', { class: 'chat-avatar', style: { '--hue': hueOf(p.name) } }, initial(p.name)), p.name),
              el('td', {}, fmt(p.chips)),
              el('td', { class: p.stats.net > 0 ? 'up' : p.stats.net < 0 ? 'down' : '' }, `${p.stats.net > 0 ? '+' : ''}${fmt(p.stats.net)}`),
              el('td', {}, `${p.stats.wins}/${p.stats.hands}`),
            ),
          ),
        ),
      ),
      el('div', { class: 'rank-foot muted' }, `가장 큰 팟: ${(() => { const b = [...state.players].sort((a, c) => c.stats.biggestPot - a.stats.biggestPot)[0]; return b && b.stats.biggestPot ? `${b.name} ${fmt(b.stats.biggestPot)}` : '-'; })()}`),
    );
  }

  let logSig = '';
  function renderLog() {
    const sig = state.log.join('\n');
    if (sig === logSig) return;
    logSig = sig;
    logList.replaceChildren(...state.log.map((t) => el('li', {}, t)));
    logList.scrollTop = logList.scrollHeight;
  }

  return {
    render(s) {
      const prevChat = state?.chat?.at(-1)?.id ?? null;
      state = s;
      renderChat();
      renderHistory();
      renderRank();
      renderLog();
      if (prevChat !== null && (s.chat.at(-1)?.id ?? 0) > prevChat) play('pop');
    },
    focusChat() {
      select('chat');
      chatInput.focus();
    },
  };
}

/** 방 설정 창 */
export function openSettings(state, { send }) {
  const isHost = state.hostId === state.me;
  const s = state.settings;
  const lim = state.limits;
  const locked = !isHost || (state.hand && state.hand.street !== 'done') || state.tourney.active;
  const field = (label, name, value, [min, max], hint) =>
    el(
      'label',
      { class: 'field' },
      el('span', {}, label),
      el('input', { type: 'number', name, value, min, max, step: name === 'bigBlind' ? 2 : 1, disabled: locked }),
      hint ? el('small', {}, hint) : null,
    );
  let mode = s.mode;
  const modeBtns = ['cash', 'tournament'].map((m) =>
    el(
      'button',
      {
        type: 'button',
        class: `seg${mode === m ? ' on' : ''}`,
        disabled: locked,
        onclick: () => {
          mode = m;
          modeBtns.forEach((b, i) => b.classList.toggle('on', ['cash', 'tournament'][i] === m));
          blindUp.classList.toggle('hidden', m !== 'tournament');
        },
      },
      m === 'cash' ? '자유 게임' : '토너먼트',
      el('small', {}, m === 'cash' ? '칩을 다 잃으면 다시 받기' : '블라인드가 오르고 최후의 1인이 우승'),
    ),
  );
  const blindUp = field('블라인드 상승 주기 (판)', 'blindUpHands', s.blindUpHands, lim.blindUpHands, '이 판 수마다 블라인드가 한 단계 올라요');
  blindUp.classList.toggle('hidden', mode !== 'tournament');
  const form = el(
    'form',
    { class: 'settings-form' },
    el('div', { class: 'seg-wrap' }, modeBtns),
    el(
      'div',
      { class: 'grid2' },
      field('시작 칩', 'startChips', s.startChips, lim.startChips),
      field('빅블라인드', 'bigBlind', s.bigBlind, lim.bigBlind, `스몰블라인드는 자동으로 절반이에요`),
      field('차례 제한 시간 (초)', 'turnSec', s.turnSec, lim.turnSec),
      blindUp,
    ),
    locked ? el('p', { class: 'muted' }, !isHost ? '방장만 바꿀 수 있어요.' : state.tourney.active ? '토너먼트가 끝난 뒤에 바꿀 수 있어요.' : '이번 판이 끝난 뒤에 바꿀 수 있어요.') : null,
    el('div', { class: 'modal-actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, '닫기'), locked ? null : el('button', { type: 'submit', class: 'btn primary' }, '저장')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const r = await send('settings', { ...data, mode });
    if (r.error) return toast(r.error, 'error');
    toast('설정을 저장했어요');
    close();
  });
  const { close } = modal('방 설정', form);
}

export function modal(title, body) {
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h2', {}, title), body);
  const back = el('div', { class: 'modal-back' }, box);
  const close = () => {
    back.classList.add('closing');
    setTimeout(() => back.remove(), 180);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  back.addEventListener('pointerdown', (e) => e.target === back && close());
  window.addEventListener('keydown', onKey, true);
  document.body.append(back);
  setTimeout(() => box.querySelector('input:not([disabled]), button')?.focus(), 30);
  return { close };
}

/** 토너먼트 우승 축하 (색종이) */
export function celebrate(name, isMe) {
  play('fanfare');
  const canvas = el('canvas', { class: 'confetti' });
  const card = el('div', { class: 'champ' }, el('div', { class: 'trophy' }, '🏆'), el('div', { class: 'champ-title' }, isMe ? '우승을 축하해요!' : '토너먼트 우승'), el('div', { class: 'champ-name' }, name));
  const wrap = el('div', { class: 'celebrate', onclick: () => end() }, canvas, card);
  document.body.append(wrap);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  const colors = ['#f1c04b', '#ff6b5e', '#7fe0a6', '#6aa8ff', '#ffffff', '#c792ea'];
  const parts = Array.from({ length: 180 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.6,
    w: (6 + Math.random() * 6) * dpr,
    h: (10 + Math.random() * 8) * dpr,
    vy: (2 + Math.random() * 3) * dpr,
    vx: (Math.random() - 0.5) * 2 * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  let raf;
  let running = true;
  const frame = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      if (p.y > canvas.height) p.y = -20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (running) raf = requestAnimationFrame(frame);
  };
  frame();
  const timer = setTimeout(() => end(), 7000);
  function end() {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 400);
  }
}
