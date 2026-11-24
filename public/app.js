/* global io */
(() => {
  'use strict';

  // ───────── 저장소 (탭마다 다른 플레이어가 되도록 sessionStorage) ─────────
  const store = {
    get(k) {
      try { return sessionStorage.getItem('holdem.' + k); } catch { return null; }
    },
    set(k, v) {
      try { v == null ? sessionStorage.removeItem('holdem.' + k) : sessionStorage.setItem('holdem.' + k, v); } catch { /* 저장 불가 환경 */ }
    },
  };
  const savedName = () => {
    try { return localStorage.getItem('holdem.name') || ''; } catch { return ''; }
  };
  const saveName = (n) => {
    try { localStorage.setItem('holdem.name', n); } catch { /* 무시 */ }
  };

  function makeToken() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a); // http(비보안) 환경에서도 동작
    return Array.from(a, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);
  }
  let token = store.get('token');
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    token = makeToken().slice(0, 40);
    store.set('token', token);
  }

  // ───────── DOM 도우미 ─────────
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const fmt = (n) => Number(n).toLocaleString('ko-KR');

  const RANK = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const sameCard = (a, b) => a && b && a.r === b.r && a.s === b.s;

  function cardEl(c, { small = false, win = false, dim = false } = {}) {
    if (c === 'back') return el('div', { class: `card back${small ? ' small' : ''}`, 'aria-label': '뒷면 카드' });
    if (!c) return el('div', { class: `card placeholder${small ? ' small' : ''}` });
    const red = c.s === 'h' || c.s === 'd';
    return el(
      'div',
      { class: `card${red ? ' red' : ''}${small ? ' small' : ''}${win ? ' win' : ''}${dim ? ' dim' : ''}`, 'aria-label': `${RANK[c.r] ?? c.r}${SUIT[c.s]}` },
      el('span', { class: 'rank' }, RANK[c.r] ?? c.r),
      el('span', { class: 'suit' }, SUIT[c.s]),
    );
  }

  // ───────── 소켓 ─────────
  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let lanUrls = [];

  function send(event, payload = {}) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) resolve({ error: '서버 응답이 없어요' });
        else resolve(res || {});
      });
    });
  }

  socket.on('hello', (info) => {
    lanUrls = info?.lanUrls || [];
    if (state) renderTop();
  });
  socket.on('connect', () => {
    const code = store.get('code');
    if (code) joinRoom(code, true);
  });
  socket.on('disconnect', () => toast('서버와 연결이 끊겼어요. 다시 연결하는 중…'));
  socket.on('state', (s) => {
    state = s;
    state.receivedAt = performance.now();
    showGame();
    render();
  });

  // ───────── 입장 ─────────
  const params = new URLSearchParams(location.search);
  $('nameInput').value = savedName();
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase().slice(0, 4);

  function lobbyError(msg) {
    $('lobbyError').textContent = msg || '';
  }
  function myName() {
    const n = $('nameInput').value.trim();
    if (n) saveName(n);
    return n;
  }

  async function joinRoom(code, silent = false) {
    const res = await send('join', { code, name: myName() || savedName(), token });
    if (res.error) {
      if (silent) {
        store.set('code', null);
        showLobby();
      }
      lobbyError(res.error);
      return;
    }
    store.set('code', res.code);
    history.replaceState(null, '', `/?room=${res.code}`);
  }

  $('createBtn').addEventListener('click', async () => {
    if (!myName()) return lobbyError('닉네임을 입력해 주세요');
    lobbyError('');
    const res = await send('create', { name: myName(), token });
    if (res.error) return lobbyError(res.error);
    store.set('code', res.code);
    history.replaceState(null, '', `/?room=${res.code}`);
  });
  $('joinBtn').addEventListener('click', () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (!myName()) return lobbyError('닉네임을 입력해 주세요');
    if (code.length !== 4) return lobbyError('코드 4자리를 입력해 주세요');
    lobbyError('');
    joinRoom(code);
  });
  $('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());
  $('nameInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    ($('codeInput').value.trim() ? $('joinBtn') : $('createBtn')).click();
  });

  function showLobby() {
    state = null;
    $('lobby').classList.remove('hidden');
    $('game').classList.add('hidden');
  }
  function showGame() {
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
  }

  // ───────── 상단 조작 ─────────
  function inviteUrl() {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const base = local && lanUrls.length ? lanUrls[0] : location.origin;
    return `${base}/?room=${state.code}`;
  }

  $('copyBtn').addEventListener('click', async () => {
    const link = $('inviteLink');
    try {
      if (window.isSecureContext && navigator.clipboard) await navigator.clipboard.writeText(link.value);
      else {
        link.select();
        document.execCommand('copy');
      }
      toast('초대 링크를 복사했어요. Teams 채팅방에 붙여 넣으세요!');
    } catch {
      link.select();
      toast('복사가 안 돼요. 선택된 링크를 Ctrl+C로 복사해 주세요');
    }
  });
  $('startBtn').addEventListener('click', async () => {
    const r = await send('start');
    if (r.error) toast(r.error);
  });
  $('pauseBtn').addEventListener('click', async () => {
    const r = await send('pause');
    if (r.error) toast(r.error);
  });
  $('leaveBtn').addEventListener('click', async () => {
    const inHand = state?.players.find((p) => p.id === state.me)?.inHand;
    if (inHand && !window.confirm('진행 중인 판은 폴드 처리돼요. 나갈까요?')) return;
    await send('leave');
    store.set('code', null);
    history.replaceState(null, '', '/');
    showLobby();
  });

  // ───────── 그리기 ─────────
  function render() {
    renderTop();
    renderTable();
    renderActions();
    renderLog();
  }

  function renderTop() {
    $('roomCode').textContent = state.code;
    $('blinds').textContent = `블라인드 ${state.blinds[0]}/${state.blinds[1]} · 시작 칩 ${fmt(state.startChips)}`;
    $('inviteLink').value = inviteUrl();
    const isHost = state.hostId === state.me;
    const handLive = state.hand && state.hand.street !== 'done';
    $('startBtn').classList.toggle('hidden', !isHost || state.running || handLive);
    $('startBtn').textContent = state.hand ? '게임 이어서 하기' : '게임 시작';
    $('pauseBtn').classList.toggle('hidden', !isHost || !state.running);
  }

  function seatPos(k, n) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n; // 나는 아래, 시계 방향(왼쪽)으로 진행
    return { x: 50 + 52 * Math.cos(a), y: 50 + 56 * Math.sin(a), cos: Math.cos(a), sin: Math.sin(a) };
  }

  function winningCards() {
    const r = state.hand?.results;
    if (!r || r.type !== 'showdown') return [];
    const ids = new Set(r.pots.flatMap((p) => p.winners));
    return [...ids].flatMap((id) => r.hands[id]?.cards ?? []);
  }

  function renderTable() {
    const h = state.hand;
    $('dealerLine').textContent = state.dealerLine;

    // 보드
    const wins = winningCards();
    const board = $('board');
    board.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const c = h?.board?.[i];
      board.append(cardEl(c, { win: c && wins.some((w) => sameCard(w, c)) }));
    }
    $('pot').textContent = h && h.pot > 0 ? `팟 ${fmt(h.pot)}` : '';

    // 좌석
    const seats = $('seats');
    seats.replaceChildren();
    const list = state.players;
    const n = list.length;
    const myIdx = Math.max(0, list.findIndex((p) => p.id === state.me));
    const r = h?.results;
    list.forEach((p, i) => {
      const k = (i - myIdx + n) % n;
      const pos = seatPos(k, n);
      const isTurn = h && h.toActId === p.id;
      const badges = el('div', { class: 'badges' });
      if (h && h.street !== 'done' || (h && r)) {
        if (h.buttonId === p.id) badges.append(el('span', { class: 'badge d', title: '딜러 버튼' }, 'D'));
        if (h.sbId === p.id) badges.append(el('span', { class: 'badge' }, 'SB'));
        if (h.bbId === p.id) badges.append(el('span', { class: 'badge' }, 'BB'));
      }
      if (state.hostId === p.id) badges.append(el('span', { class: 'badge host', title: '방장' }, '방장'));

      let status = '';
      let statusWin = false;
      if (r && r.payouts[p.id]) {
        status = `+${fmt(r.payouts[p.id])}${r.hands[p.id] ? ` · ${r.hands[p.id].name}` : ''}`;
        statusWin = true;
      } else if (r && r.hands[p.id]) status = r.hands[p.id].name;
      else if (p.folded) status = '폴드';
      else if (p.allIn) status = '올인';
      else if (p.lastAction) status = p.lastAction;
      else if (!p.cards && h && h.street !== 'done') status = '다음 판 대기';
      else if (p.chips === 0) status = '칩 없음';

      const cards = el('div', { class: 'cards' });
      if (p.cards) {
        const best = r?.hands?.[p.id]?.cards ?? [];
        for (const c of p.cards) cards.append(cardEl(c, { small: p.id !== state.me, win: statusWin && best.some((w) => sameCard(w, c)) }));
      }

      const timer = isTurn ? el('div', { class: 'timer' }, el('i', { 'data-timer': '1' })) : null;

      const seat = el(
        'div',
        {
          class: `seat${p.id === state.me ? ' me' : ''}${isTurn ? ' turn' : ''}${p.folded ? ' folded' : ''}${p.connected ? '' : ' away'}`,
          style: { left: `${pos.x}%`, top: `${pos.y}%` },
        },
        cards,
        el(
          'div',
          { class: 'plate' },
          badges,
          el('div', { class: 'name', title: p.name }, p.name + (p.id === state.me ? ' (나)' : '')),
          el('div', { class: 'chips' }, `칩 ${fmt(p.chips)}`),
          el('div', { class: `status${statusWin ? ' win' : ''}` }, status),
          timer,
        ),
      );
      if (p.bet > 0 && h && h.street !== 'done') {
        seat.append(
          el('div', { class: 'bet', style: { left: `calc(50% + ${-pos.cos * 110}px)`, top: `calc(50% + ${-pos.sin * 115}px)`, transform: 'translate(-50%, -50%)' } }, fmt(p.bet)),
        );
      }
      seats.append(seat);
    });
  }

  // 차례 타이머 막대
  function tick() {
    const bar = document.querySelector('[data-timer]');
    if (bar && state?.hand?.turnMsTotal) {
      const left = state.hand.turnMsLeft - (performance.now() - state.receivedAt);
      bar.style.width = `${Math.max(0, Math.min(100, (left / state.hand.turnMsTotal) * 100))}%`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  let raiseKey = '';
  let raiseValue = 0;

  function renderActions() {
    const box = $('actions');
    box.replaceChildren();
    const h = state.hand;
    const me = state.players.find((p) => p.id === state.me);

    if (h?.results && h.street === 'done') box.append(resultBox(h.results));

    const a = state.actions;
    if (a) {
      const btns = el('div', { class: 'btns' });
      btns.append(el('button', { class: 'danger', onclick: () => act('fold') }, '폴드'));
      if (a.canCheck) btns.append(el('button', { onclick: () => act('check') }, '체크'));
      if (a.canCall) btns.append(el('button', { class: 'primary', onclick: () => act('call') }, `콜 ${fmt(a.toCall)}`));
      box.append(el('div', { class: 'hint' }, a.canCall ? `내 차례예요. 콜하려면 ${fmt(a.toCall)}이 필요해요.` : '내 차례예요.'));
      box.append(btns);

      if (a.canRaise) {
        const key = `${h.no}-${h.street}-${a.minTo}-${a.maxTo}`;
        if (key !== raiseKey) {
          raiseKey = key;
          raiseValue = a.minTo;
        }
        const clamp = (v) => Math.max(a.minTo, Math.min(a.maxTo, Math.round(v)));
        const range = el('input', { type: 'range', min: a.minTo, max: a.maxTo, step: 1, value: raiseValue, 'aria-label': '레이즈 금액' });
        const num = el('input', { type: 'number', min: a.minTo, max: a.maxTo, value: raiseValue, 'aria-label': '레이즈 금액 입력' });
        const label = a.isBet ? '벳' : '레이즈';
        const go = el('button', { class: 'primary' }, `${label} ${fmt(raiseValue)}`);
        const setV = (v) => {
          raiseValue = clamp(v);
          range.value = raiseValue;
          num.value = raiseValue;
          go.textContent = raiseValue >= a.maxTo ? `올인 ${fmt(raiseValue)}` : `${label} ${fmt(raiseValue)}`;
        };
        range.addEventListener('input', () => setV(Number(range.value)));
        num.addEventListener('change', () => setV(Number(num.value)));
        go.addEventListener('click', () => act('raise', raiseValue));
        const potAfterCall = a.pot + a.toCall;
        const quick = [
          ['최소', a.minTo],
          ['½팟', a.currentBet + potAfterCall / 2],
          ['팟', a.currentBet + potAfterCall],
          ['올인', a.maxTo],
        ].map(([t, v]) => el('button', { onclick: () => setV(v) }, t));
        setV(raiseValue);
        box.append(el('div', { class: 'raise-row' }, range, num, go, ...quick));
      } else if (me && me.chips > a.toCall) {
        // 레이즈가 막힌 경우(불완전 올인 레이즈 뒤)에는 콜/폴드만 가능
      } else if (me && a.canCall) {
        box.append(el('div', { class: 'hint' }, '칩이 모자라 콜하면 올인이에요.'));
      }
      return;
    }

    const msg = el('div', { class: 'hint' });
    if (!h) msg.textContent = state.hostId === state.me ? '모두 들어오면 위의 「게임 시작」을 눌러 주세요.' : '방장이 게임을 시작하기를 기다리는 중이에요.';
    else if (h.street === 'done') msg.textContent = state.running ? '잠시 뒤 다음 판이 시작돼요.' : '게임이 멈춰 있어요. 방장이 다시 시작할 수 있어요.';
    else if (!me?.inHand) msg.textContent = '이번 판이 끝나면 참여해요.';
    else if (me.folded) msg.textContent = '폴드했어요. 이번 판 결과를 기다리는 중이에요.';
    else if (h.toActId) msg.textContent = `${state.players.find((p) => p.id === h.toActId)?.name ?? ''}님 차례예요.`;
    else msg.textContent = '딜러가 카드를 여는 중이에요.';
    box.append(msg);

    if (state.canRebuy) {
      box.append(
        el('div', { class: 'btns' },
          el('button', {
            class: 'primary',
            onclick: async () => {
              const r = await send('rebuy');
              if (r.error) toast(r.error);
            },
          }, `칩 ${fmt(state.startChips)}개 다시 받기`)),
      );
    }
  }

  function resultBox(r) {
    const name = (id) => state.players.find((p) => p.id === id)?.name ?? '나간 사람';
    const items = r.pots.map((pot, i) => {
      const label = r.pots.length > 1 ? (i === 0 ? '메인 팟' : `사이드 팟 ${i}`) : '팟';
      const who = pot.winners.map((id) => `${name(id)}${r.hands[id] ? `(${r.hands[id].name})` : ''}`).join(', ');
      return el('li', {}, `${label} ${fmt(pot.amount)} → ${who}${pot.winners.length > 1 ? ' 나눠 가짐' : ''}`);
    });
    return el('div', { class: 'result' }, el('h3', {}, r.type === 'fold' ? '이번 판 결과 (모두 폴드)' : '이번 판 결과 (쇼다운)'), el('ul', {}, items));
  }

  async function act(type, amount) {
    const r = await send('action', { type, amount });
    if (r.error) toast(r.error);
  }

  function renderLog() {
    const ol = $('log');
    ol.replaceChildren(...state.log.map((t) => el('li', {}, t)));
    ol.scrollTop = ol.scrollHeight;
  }
})();
