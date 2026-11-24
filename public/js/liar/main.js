/* global io */
import { $, el, toast, hideToast, session, storage, hueOf, initial } from '../util.js';
import { modal } from '../panels.js';
import { isMuted, setMuted, play } from '../sound.js';

function makeToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}
let token = session.get('liar.token');
if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
  token = makeToken();
  session.set('liar.token', token);
}
const socket = io('/liar', { transports: ['websocket', 'polling'] });
const send = (event, payload = {}) =>
  new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: '서버 응답이 없어요' } : res || {})));

let state = null;
let prev = null;
let receivedAt = 0;
let lanUrls = [];
let cardFlipped = false; // 카드를 앞면으로 뒤집었는지
let sideTab = 'chat';
let lastChatId = null;
let unread = 0;

const nameOf = (id) => state?.players.find((p) => p.id === id)?.name ?? '나간 사람';
const me = () => state?.players.find((p) => p.id === state.me);
const isHost = () => state?.hostId === state?.me;

socket.on('hello', (info) => (lanUrls = info?.lanUrls || []));
socket.on('connect', () => {
  $('#offline').classList.add('hidden');
  const code = session.get('liar.code');
  if (code) joinRoom(code, true);
});
socket.on('disconnect', () => $('#offline').classList.remove('hidden'));
socket.on('state', (s) => {
  prev = state;
  state = s;
  receivedAt = performance.now();
  showGame();
  sounds();
  render();
});

/** 단계가 바뀔 때 소리 */
function sounds() {
  if (!prev) return;
  const ph = state.phase;
  if (ph !== prev.phase) {
    if (ph === 'reveal') {
      play('deal');
      cardFlipped = false;
    }
    if (ph === 'hint' || ph === 'discuss') play('bell');
    if (ph === 'vote' || ph === 'revote') play('turn');
    if (ph === 'guess') play('allin');
    if (ph === 'result') {
      cardFlipped = true; // 결과 때는 카드를 앞면으로
      const r = state.round?.result;
      const iLiar = r?.liars.includes(state.me);
      const iWon = r && (r.winner === 'liar') === iLiar;
      play(iWon ? 'fanfare' : 'pot');
    }
  }
  if (state.round?.turn && state.round.turn !== prev.round?.turn && state.round.turn === state.me) play('turn');
  if ((state.round?.hints.length ?? 0) > (prev.round?.hints.length ?? 0)) play('pop');
}

// ───────── 입장 ─────────
const params = new URLSearchParams(location.search);
$('#nameInput').value = storage.get('name', '');
if (params.get('room')) $('#codeInput').value = params.get('room').toUpperCase().slice(0, 4);
const lobbyError = (m) => ($('#lobbyError').textContent = m || '');
const myName = () => {
  const n = $('#nameInput').value.trim();
  if (n) storage.set('name', n);
  return n;
};
async function joinRoom(code, silent = false) {
  const res = await send('join', { code, name: myName() || storage.get('name', ''), token });
  if (res.error) {
    if (silent) {
      session.set('liar.code', null);
      showLobby();
    }
    return lobbyError(res.error);
  }
  session.set('liar.code', res.code);
  history.replaceState(null, '', `/liar/?room=${res.code}`);
}
$('#createBtn').addEventListener('click', async () => {
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  const res = await send('create', { name: myName(), token });
  if (res.error) return lobbyError(res.error);
  session.set('liar.code', res.code);
  history.replaceState(null, '', `/liar/?room=${res.code}`);
});
$('#joinBtn').addEventListener('click', () => {
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  if (code.length !== 4) return lobbyError('초대 코드 4자리를 입력해 주세요');
  joinRoom(code);
});
$('#codeInput').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
$('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
$('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && ($('#codeInput').value.trim() ? $('#joinBtn') : $('#createBtn')).click());
function showLobby() {
  state = null;
  $('#lobby').classList.remove('hidden');
  $('#game').classList.add('hidden');
}
function showGame() {
  if (!$('#game').classList.contains('hidden')) return;
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  if (!storage.get('liar.rulesSeen', false)) setTimeout(openRules, 500);
}

// ───────── 상단 버튼 ─────────
function inviteUrl() {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const base = local && lanUrls.length ? lanUrls[0] : location.origin;
  return `${base}/liar/?room=${state.code}`;
}
$('#copyBtn').addEventListener('click', async () => {
  const link = inviteUrl();
  try {
    if (window.isSecureContext && navigator.clipboard) await navigator.clipboard.writeText(link);
    else {
      const f = $('#copyFallback');
      f.value = link;
      f.select();
      if (!document.execCommand('copy')) throw new Error('copy');
    }
    toast('초대 링크를 복사했어요. Teams 채팅방에 붙여 넣으세요!');
  } catch {
    window.prompt('이 링크를 복사해 주세요', link);
  }
});
const call = async (ev, payload) => {
  const r = await send(ev, payload);
  if (r.error) toast(r.error, 'error');
  return r;
};
$('#startBtn').addEventListener('click', () => call('start'));
$('#skipBtn').addEventListener('click', () => call('skip'));
$('#soundBtn').addEventListener('click', () => {
  setMuted(!isMuted());
  $('#soundBtn').textContent = isMuted() ? '🔇' : '🔊';
});
$('#leaveBtn').addEventListener('click', async () => {
  if (state?.round && state.phase !== 'result' && state.round.order.includes(state.me) && !window.confirm('게임 중에 나가면 이번 라운드에서 빠져요. 나갈까요?')) return;
  await send('leave');
  session.set('liar.code', null);
  history.replaceState(null, '', '/liar/');
  showLobby();
});
$('#rulesBtn').addEventListener('click', openRules);
$('#settingsBtn').addEventListener('click', openSettings);

function openRules() {
  storage.set('liar.rulesSeen', true);
  const body = el(
    'div',
    { class: 'rules' },
    el('h3', {}, '게임 방법'),
    el(
      'ol',
      {},
      el('li', {}, '모두에게 같은 ', el('b', {}, '제시어'), '가 주어지는데, ', el('b', {}, '라이어'), '만 제시어를 몰라요 (카테고리만 알아요).'),
      el('li', {}, '정해진 순서대로 한 명씩 ', el('b', {}, '힌트'), '를 한 마디 말해요. 너무 쉬우면 라이어가 눈치채고, 너무 어려우면 라이어로 의심받아요!'),
      el('li', {}, '힌트는 글로 써도 되고, 화상회의에서 말로 하고 「말로 했어요」를 눌러도 돼요. 제시어를 그대로 쓰면 안 돼요.'),
      el('li', {}, '힌트가 다 모이면 ', el('b', {}, '자유 토론'), ' 후 ', el('b', {}, '투표'), '로 라이어를 지목해요. 동표면 한 번 더 투표해요.'),
      el('li', {}, '지목된 사람이 라이어면, 라이어에게 ', el('b', {}, '마지막 기회'), '! 12개 보기 중 제시어를 맞히면 라이어의 역전승이에요.'),
    ),
    el('h3', {}, '점수'),
    el('ul', {}, el('li', {}, '시민이 이기면 시민 모두 +1점'), el('li', {}, '라이어가 이기면 (못 찾았거나, 엉뚱한 사람을 지목했거나, 제시어를 맞히면) 라이어 +3점')),
    el('h3', {}, '바보 모드'),
    el('p', { class: 'muted' }, '라이어도 다른 제시어를 받아서 자기가 라이어인 줄 몰라요. 남들과 힌트가 어긋나는 걸 눈치채야 해요!'),
  );
  const ok = el('button', { class: 'btn primary' }, '알겠어요');
  const m = modal('🕵️ 라이어 찾기 규칙', el('div', {}, body, el('div', { class: 'modal-actions' }, ok)));
  ok.addEventListener('click', () => m.close());
}

function openSettings() {
  if (!state) return;
  const s = state.settings;
  const locked = !isHost() || (state.phase !== 'lobby' && state.phase !== 'result');
  const sel = (name, value, options) => el('select', { name, disabled: locked, class: 'sel' }, options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
  const num = (name, value, [min, max]) => el('input', { type: 'number', name, value, min, max, disabled: locked });
  const form = el(
    'form',
    { class: 'settings-form' },
    el(
      'div',
      { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, '카테고리'), sel('category', s.category, [['random', '무작위'], ...Object.entries(state.categories)])),
      el('label', { class: 'field' }, el('span', {}, '모드'), sel('mode', s.mode, [['normal', '일반 (라이어는 카테고리만)'], ['fool', '바보 모드 (라이어도 다른 제시어)']])),
      el('label', { class: 'field' }, el('span', {}, '라이어 수'), sel('liarCount', String(s.liarCount), [['1', '1명'], ['2', '2명 (6명 이상일 때)']])),
      el('label', { class: 'field' }, el('span', {}, '힌트 바퀴 수'), num('hintRounds', s.hintRounds, state.limits.hintRounds)),
      el('label', { class: 'field' }, el('span', {}, '힌트 제한 시간 (초)'), num('hintSec', s.hintSec, state.limits.hintSec)),
      el('label', { class: 'field' }, el('span', {}, '토론 시간 (초, 0이면 없음)'), num('discussSec', s.discussSec, state.limits.discussSec)),
      el('label', { class: 'field' }, el('span', {}, '투표 시간 (초)'), num('voteSec', s.voteSec, state.limits.voteSec)),
    ),
    locked ? el('p', { class: 'muted' }, isHost() ? '라운드가 끝난 뒤에 바꿀 수 있어요.' : '방장만 바꿀 수 있어요.') : null,
    el('div', { class: 'modal-actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => m.close() }, '닫기'), locked ? null : el('button', { type: 'submit', class: 'btn primary' }, '저장')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await call('settings', Object.fromEntries(new FormData(form)));
    if (!r.error) {
      toast('설정을 저장했어요');
      m.close();
    }
  });
  const m = modal('방 설정', form);
}

// ───────── 렌더 ─────────
const PHASE = { lobby: '대기 중', reveal: '카드 확인', hint: '힌트', discuss: '자유 토론', vote: '투표', revote: '재투표', guess: '정답 맞히기', result: '결과' };

(function tick() {
  if (state) {
    const left = Math.max(0, state.phaseMsLeft - (performance.now() - receivedAt));
    const sec = Math.ceil(left / 1000);
    const text = state.phaseMsLeft ? `${PHASE[state.phase]} · ${sec}초` : PHASE[state.phase];
    const chip = $('#phaseChip');
    if (chip.textContent !== text) chip.textContent = text;
    chip.className = `phase-chip ${state.phaseMsLeft && sec <= 5 ? 'urgent' : 'open'}`;
    const bar = document.querySelector('.timer-bar > i');
    if (bar && state.phaseMsLeft) bar.style.width = `${(left / (state.phaseTotal || state.phaseMsLeft)) * 100}%`;
  }
  requestAnimationFrame(tick);
})();

let lastHost = '';
function render() {
  const s = state;
  // 단계나 힌트 차례가 바뀌면 타이머 막대를 새로 시작
  if (prev?.phase !== s.phase || prev?.round?.turn !== s.round?.turn) s.phaseTotal = s.phaseMsLeft;
  else s.phaseTotal = prev?.phaseTotal ?? s.phaseMsLeft;
  $('#roomCode').textContent = s.code;
  $('#roundInfo').replaceChildren(...(s.round ? [el('b', {}, `${s.round.no}라운드`), ` · ${s.round.category}${s.round.mode === 'fool' ? ' · 바보 모드' : ''}${s.round.liarCount > 1 ? ' · 라이어 2명' : ''}`] : ['게임 준비 중']));
  const canStart = isHost() && (s.phase === 'lobby' || s.phase === 'result');
  $('#startBtn').classList.toggle('hidden', !canStart);
  $('#startBtn').textContent = s.phase === 'result' ? '다음 라운드' : '게임 시작';
  $('#skipBtn').classList.toggle('hidden', !isHost() || !['reveal', 'discuss', 'hint'].includes(s.phase));
  $('#skipBtn').textContent = s.phase === 'discuss' ? '토론 끝내고 투표' : s.phase === 'hint' ? '이 차례 넘기기' : '바로 시작';
  $('#soundBtn').textContent = isMuted() ? '🔇' : '🔊';
  if (s.host !== lastHost) {
    lastHost = s.host;
    const b = $('#hostLine');
    b.textContent = s.host;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }
  renderCard();
  renderAction();
  renderPlayers();
  renderSide();
}

let cardSig = '';
function renderCard() {
  const c = state.card;
  const wrap = $('#cardWrap');
  const sig = JSON.stringify([c, state.round?.no, state.phase === 'result']);
  if (sig === cardSig) return;
  cardSig = sig;
  if (!c) {
    wrap.replaceChildren(el('div', { class: 'word-card hidden-side' }, el('div', { class: 'wc-face wc-front' }), el('div', { class: 'wc-face wc-back' }, el('div', { class: 'wc-q' }, '?'), el('div', {}, state.round ? '이번 라운드는 구경 중이에요' : '게임이 시작되면 카드가 나와요'))));
    return;
  }
  const front = c.liar
    ? el('div', { class: 'wc-face wc-front liar' }, el('div', { class: 'wc-cat' }, `카테고리 · ${c.category}`), el('div', { class: 'wc-word' }, '🤫 당신은 라이어!'), el('div', { class: 'wc-sub' }, state.phase === 'result' && c.foolWord ? `내가 받았던 제시어: ${c.foolWord}` : '제시어를 모르는 척… 아니, 아는 척하세요!\n다른 사람 힌트로 제시어를 추리해요.'))
    : el('div', { class: 'wc-face wc-front' }, el('div', { class: 'wc-cat' }, `카테고리 · ${c.category}`), el('div', { class: 'wc-word' }, c.word), el('div', { class: 'wc-sub' }, '라이어에게 들키지 않게\n살짝 돌려서 힌트를 주세요'));
  const card = el('div', { class: `word-card${cardFlipped ? '' : ' hidden-side'}`, role: 'button', tabindex: 0, 'aria-label': '내 카드 뒤집기' }, front, el('div', { class: 'wc-face wc-back' }, el('div', { class: 'wc-q' }, '?'), el('div', {}, '눌러서 내 카드 확인')));
  const flip = () => {
    cardFlipped = !cardFlipped;
    card.classList.toggle('hidden-side', !cardFlipped);
    play('flip');
  };
  card.addEventListener('click', flip);
  card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), flip()));
  wrap.replaceChildren(card, el('div', { class: 'wc-hint' }, '카드를 누르면 앞뒤가 바뀌어요. 옆 사람이 보지 않게 조심!'));
}

let actionSig = '';
function renderAction() {
  const s = state;
  const r = s.round;
  const box = $('#actionBox');
  const sig = JSON.stringify([s.phase, r?.turn, r?.hintRound, r?.myVote, r?.voted?.length, r?.candidates, r?.guess, r?.result, s.players.length, isHost()]);
  if (sig === actionSig) return;
  actionSig = sig;
  const inRound = r && r.order.includes(s.me);
  const bar = () => el('div', { class: 'timer-bar' }, el('i', { style: { width: '100%' } }));
  let nodes = [];
  switch (s.phase) {
    case 'lobby':
      nodes = [
        el('h2', {}, '라이어를 찾아라!'),
        el('p', {}, `지금 ${s.players.filter((p) => p.connected).length}명 접속 중. 3명 이상이면 시작할 수 있어요.`),
        el('p', {}, isHost() ? '설정(⚙)에서 카테고리와 모드를 고른 뒤 「게임 시작」을 눌러 주세요.' : '방장이 게임을 시작하기를 기다리고 있어요.'),
        isHost() ? el('button', { class: 'btn primary big', onclick: () => call('start') }, '게임 시작') : null,
      ];
      break;
    case 'reveal':
      nodes = [el('h2', {}, '🤫 카드를 몰래 확인하세요'), el('p', {}, '왼쪽 카드를 눌러 내 제시어를 확인해요. 라이어라면… 들키지 않게 표정 관리!'), bar()];
      break;
    case 'hint': {
      const myTurn = r.turn === s.me;
      if (myTurn) {
        const input = el('input', { maxlength: 40, placeholder: '예: 여름에 자주 먹어요', 'aria-label': '힌트 입력' });
        const submit = async (text) => {
          const res = await call('hint', { text });
          if (!res.error) hideToast();
        };
        input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && submit(input.value));
        nodes = [
          el('h2', {}, '🎤 내 차례예요!'),
          el('p', {}, `제시어를 한 마디로 설명해 주세요 (${r.hintRound}/${r.hintRounds}바퀴). 제시어를 그대로 쓰면 안 돼요.`),
          el('div', { class: 'hint-form' }, input, el('button', { class: 'btn primary', onclick: () => submit(input.value) }, '제출')),
          el('button', { class: 'btn', onclick: () => submit('') }, '🗣 화상회의에서 말로 했어요'),
          bar(),
        ];
        setTimeout(() => input.focus(), 50);
      } else nodes = [el('h2', {}, `🎤 ${nameOf(r.turn)}님 차례`), el('p', {}, inRound ? '힌트를 잘 듣고 라이어를 찾아보세요. 내 차례가 오면 알려 드릴게요.' : '구경 중이에요.'), bar()];
      break;
    }
    case 'discuss':
      nodes = [el('h2', {}, '💬 자유 토론'), el('p', {}, '오른쪽 채팅이나 화상회의로 누가 수상한지 이야기해요. 시간이 끝나면 투표가 시작돼요.'), bar()];
      break;
    case 'vote':
    case 'revote':
      nodes = [
        el('h2', {}, s.phase === 'revote' ? '🗳 재투표!' : '🗳 라이어는 누구?'),
        el('p', {}, inRound ? (r.myVote ? `「${nameOf(r.myVote)}」님에게 투표했어요. 마감 전까지 바꿀 수 있어요.` : '아래 참가자 카드를 눌러 라이어를 지목하세요.') : '구경 중이에요.'),
        el('p', {}, `${r.voted.length} / ${r.order.length}명 투표 완료`),
        bar(),
      ];
      break;
    case 'guess': {
      const mine = r.guess?.by === s.me;
      nodes = mine
        ? [
            el('h2', {}, '😱 들켰다! 마지막 기회'),
            el('p', {}, '제시어를 맞히면 역전승이에요. 힌트를 떠올려 보세요!'),
            el('div', { class: 'guess-grid' }, (r.guess.options ?? []).map((w) => el('button', { onclick: () => call('guess', { word: w }) }, w))),
            bar(),
          ]
        : [el('h2', {}, `🎯 ${nameOf(r.guess?.by)}님이 라이어로 지목됐어요!`), el('p', {}, '라이어가 제시어를 고르고 있어요. 맞히면 라이어의 역전승!'), bar()];
      break;
    }
    case 'result': {
      const res = r.result;
      const iLiar = res.liars.includes(s.me);
      const won = (res.winner === 'liar') === iLiar;
      const why = {
        noVote: '아무도 투표하지 않았어요',
        tie: '재투표에서도 동표가 나왔어요',
        wrong: `${nameOf(r.accused)}님은 라이어가 아니었어요`,
        guessed: `라이어가 제시어를 맞혔어요`,
        caught: r.guess?.choice ? `라이어가 「${r.guess.choice}」를 골랐어요` : '라이어가 시간 안에 고르지 못했어요',
        liarLeft: '라이어가 도망갔어요',
      }[res.reason];
      const tally = Object.entries(r.tally ?? {}).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...tally.map(([, n]) => n));
      nodes = [
        el('div', { class: `result-banner ${res.winner}` }, el('div', { class: 'rb-title' }, res.winner === 'liar' ? '🤫 라이어 승리!' : '🎉 시민 승리!'), el('div', { class: 'rb-sub' }, `${why} · ${inRound ? (won ? '나는 이겼어요!' : '아쉽게 졌어요') : ''}`)),
        el(
          'div',
          { class: 'reveal-word' },
          el('span', {}, '제시어', el('b', {}, res.word)),
          el('span', {}, '라이어', el('b', {}, res.liars.map(nameOf).join(', '))),
          res.foolWord ? el('span', {}, '라이어 제시어', el('b', {}, res.foolWord)) : null,
        ),
        tally.length
          ? el(
              'div',
              { class: 'tally' },
              tally.map(([id, n]) => el('div', { class: `tally-row${res.liars.includes(id) ? ' liar' : ''}` }, el('span', {}, nameOf(id)), el('div', { class: 'bar' }, el('i', { style: { width: `${(n / max) * 100}%` } })), el('b', {}, n))),
            )
          : null,
        isHost() ? el('button', { class: 'btn primary big', onclick: () => call('start') }, '다음 라운드') : el('p', {}, '방장이 다음 라운드를 시작할 거예요.'),
      ];
      break;
    }
    default:
  }
  box.replaceChildren(...nodes.filter(Boolean));
}

let playersSig = '';
function renderPlayers() {
  const s = state;
  const r = s.round;
  const sig = JSON.stringify([s.players, r?.hints, r?.turn, r?.voted, r?.myVote, r?.candidates, r?.tally, r?.result, r?.accused, s.phase, s.hostId]);
  if (sig === playersSig) return;
  playersSig = sig;
  const voting = (s.phase === 'vote' || s.phase === 'revote') && r?.order.includes(s.me);
  const ordered = r ? [...r.order.map((id) => s.players.find((p) => p.id === id)).filter(Boolean), ...s.players.filter((p) => !r.order.includes(p.id))] : s.players;
  $('#players').replaceChildren(
    ...ordered.map((p) => {
      const inR = r?.order.includes(p.id);
      const votable = voting && p.id !== s.me && inR && (!r.candidates || r.candidates.includes(p.id));
      const revealedLiar = s.phase === 'result' && r?.result?.liars.includes(p.id);
      const hints = r?.hints.filter((h) => h.pid === p.id) ?? [];
      const tags = [];
      if (s.hostId === p.id) tags.push(['방장', 'host']);
      if (r?.voted.includes(p.id) && (s.phase === 'vote' || s.phase === 'revote')) tags.push(['투표 ✓', 'voted']);
      if (r?.accused === p.id && (s.phase === 'guess' || s.phase === 'result')) tags.push(['지목됨', 'accused']);
      if (revealedLiar) tags.push(['라이어', 'liar']);
      if (!p.connected) tags.push(['끊김', '']);
      const node = el(
        'div',
        {
          class: `pcard-l${r?.turn === p.id ? ' turn' : ''}${votable ? ' votable' : ''}${r?.myVote === p.id ? ' myvote' : ''}${revealedLiar ? ' liar-revealed' : ''}${p.connected ? '' : ' away'}${r && !inR ? ' out' : ''}`,
          role: votable ? 'button' : null,
          tabindex: votable ? 0 : null,
          'aria-label': votable ? `${p.name}에게 투표` : null,
        },
        el('div', { class: 'pl-tags' }, tags.map(([t, c]) => el('span', { class: c }, t))),
        el('div', { class: 'pl-head' }, el('div', { class: 'pl-avatar', style: { '--hue': hueOf(p.name) } }, initial(p.name)), el('div', { style: { minWidth: 0 } }, el('div', { class: 'pl-name' }, p.name + (p.id === s.me ? ' (나)' : '')), el('div', { class: 'pl-score' }, `${p.score}점 · 라이어 ${p.liarTimes}회`))),
        el('div', { class: 'pl-hints' }, hints.map((h) => el('div', { class: `pl-hint${h.spoken ? ' spoken' : ''}` }, r.hintRounds > 1 ? el('small', {}, `${h.round}바퀴`) : null, h.text)), r && !inR ? el('div', { class: 'pl-score' }, '이번 라운드 구경 중') : null),
        r?.tally?.[p.id] ? el('div', { class: 'pl-vote-count' }, `${r.tally[p.id]}표`) : null,
      );
      if (votable) {
        const doVote = () => call('vote', { target: p.id }).then((res) => !res.error && play('check'));
        node.addEventListener('click', doVote);
        node.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), doVote()));
      }
      return node;
    }),
  );
}

let sideSig = '';
function renderSide() {
  const s = state;
  const newest = s.chat.at(-1)?.id ?? 0;
  if (lastChatId !== null && newest > lastChatId) {
    if (sideTab !== 'chat') unread += s.chat.filter((m) => m.id > lastChatId && m.pid !== s.me).length;
    if (s.chat.at(-1).pid !== s.me) play('pop');
  }
  lastChatId = newest;
  const sig = JSON.stringify([sideTab, newest, s.history.length, s.players.map((p) => [p.name, p.score]), unread]);
  if (sig === sideSig) return;
  sideSig = sig;
  const tab = (k, t) => el('button', { class: `tab${sideTab === k ? ' on' : ''}`, onclick: () => ((sideTab = k), k === 'chat' && (unread = 0), renderSide()) }, t, k === 'chat' && unread ? el('span', { class: 'badge' }, String(unread)) : null);
  let body;
  if (sideTab === 'chat') {
    const list = el(
      'ol',
      { class: 'chat-list' },
      s.chat.length ? s.chat.map((m) => el('li', { class: m.pid === s.me ? 'mine' : '' }, el('span', { class: 'chat-avatar', style: { '--hue': hueOf(m.name) } }, initial(m.name)), el('div', {}, el('div', { class: 'chat-name' }, m.name), el('div', { class: 'chat-text' }, m.text)))) : el('li', { class: 'empty' }, '수상한 사람을 지목해 보세요!'),
    );
    const input = el('input', { class: 'chat-input', maxlength: 100, placeholder: '메시지 보내기 (Enter)', 'aria-label': '채팅 메시지' });
    const sendIt = async () => {
      const text = input.value.trim();
      if (!text) return;
      const r = await call('chat', { text });
      if (!r.error) input.value = '';
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && sendIt());
    body = el('div', { class: 'panel-body chat' }, list, el('div', { class: 'chat-form' }, input, el('button', { class: 'btn small', onclick: sendIt }, '보내기')));
    requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
  } else if (sideTab === 'score') {
    const list = [...s.players].sort((a, b) => b.score - a.score);
    body = el(
      'div',
      { class: 'panel-body' },
      el(
        'table',
        { class: 'rank-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '이름'), el('th', {}, '점수'), el('th', {}, '승'), el('th', {}, '라이어'))),
        el('tbody', {}, list.map((p, i) => el('tr', { class: p.id === s.me ? 'me' : '' }, el('td', {}, i + 1), el('td', {}, el('span', { class: 'chat-avatar', style: { '--hue': hueOf(p.name) } }, initial(p.name)), p.name), el('td', {}, p.score), el('td', {}, p.wins), el('td', {}, p.liarTimes)))),
      ),
    );
  } else {
    body = el(
      'div',
      { class: 'panel-body' },
      s.history.length
        ? el('ol', { class: 'history-list' }, s.history.map((h) => el('li', { class: 'hist-l' }, el('div', {}, el('b', {}, `${h.no}라운드`), ` · ${h.category} · 제시어 「${h.word}」`), el('div', {}, '라이어: ', el('b', {}, h.liars.join(', '))), el('div', {}, el('b', { class: h.winner }, h.winner === 'liar' ? '라이어 승리' : '시민 승리')))))
        : el('p', { class: 'muted' }, '끝난 라운드가 여기에 쌓여요'),
    );
  }
  $('#sidePanel').replaceChildren(el('div', { class: 'tabs', role: 'tablist' }, tab('chat', '채팅'), tab('score', '점수'), tab('hist', '기록')), body);
}
