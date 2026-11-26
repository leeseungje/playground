/* global io */
import { $, el, fmt, toast, session, storage } from './util.js';
import { createTable } from './table.js';
import { createActions } from './actions.js';
import { createPanels, openSettings, celebrate, modal } from './panels.js';
import { copyInvite, pagesInvite } from './invite.js';
import { isMuted, setMuted, play } from './sound.js';

// ───────── 플레이어 토큰 (탭마다 다른 플레이어, 새로고침하면 같은 자리) ─────────
function makeToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a); // http(비보안) 환경에서도 동작
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}
let token = session.get('token');
if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
  token = makeToken();
  session.set('token', token);
}

// ───────── 소켓 ─────────
const socket = io({ transports: ['websocket', 'polling'] });
function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: '서버 응답이 없어요' } : res || {}));
  });
}

let state = null;
let lastSeq = 0;
let lastChatId = 0;
let lastReactionId = 0;
let fresh = true; // 입장 직후 첫 상태는 연출 없이
let lanUrls = [];

const table = createTable($('#stageWrap'), { onSeatClick: (pid) => openKick(pid) });
const actions = createActions($('#actions'), { send });
const panels = createPanels($('#panel'), { send });

socket.on('hello', (info) => {
  lanUrls = info?.lanUrls || [];
  if (state) renderTop();
});
socket.on('connect', () => {
  $('#offline').classList.add('hidden');
  const code = session.get('code');
  if (code) joinRoom(code, true);
});
socket.on('disconnect', () => $('#offline').classList.remove('hidden'));
socket.on('kicked', () => {
  session.set('code', null);
  history.replaceState(null, '', '/');
  showLobby();
  lobbyError('투표로 테이블에서 내보내졌어요.');
  toast('투표로 테이블에서 내보내졌어요.', 'error');
});

socket.on('state', (s) => {
  s.receivedAt = performance.now();
  const evs = fresh ? [] : s.events.filter((e) => e.seq > lastSeq);
  lastSeq = Math.max(lastSeq, ...s.events.map((e) => e.seq), 0);
  const firstChat = fresh;
  state = s;
  fresh = false;
  showGame();
  table.render(s, evs);
  actions.render(s, evs);
  panels.render(s);
  renderTop();
  renderKick();

  // 좌석 위 말풍선 (채팅·이모지)
  for (const m of s.chat) if (m.id > lastChatId && !firstChat) table.bubble(m.pid, m.text, 'chat');
  lastChatId = Math.max(lastChatId, s.chat.at(-1)?.id ?? 0);
  for (const r of s.reactions)
    if (r.id > lastReactionId && !firstChat) {
      table.bubble(r.pid, r.emoji, 'emoji');
      play('pop');
    }
  lastReactionId = Math.max(lastReactionId, ...s.reactions.map((r) => r.id), 0);

  for (const e of evs) if (e.type === 'tourneyEnd' && s.tourney.winnerName) setTimeout(() => celebrate(s.tourney.winnerName, e.winnerId === s.me), 3000);
});

// ───────── 입장 ─────────
const params = new URLSearchParams(location.search);
$('#nameInput').value = storage.get('name', '');
if (params.get('room')) $('#codeInput').value = params.get('room').toUpperCase().slice(0, 4);
if (!$('#nameInput').value) $('#nameInput').focus();

const lobbyError = (m) => ($('#lobbyError').textContent = m || '');
function myName() {
  const n = $('#nameInput').value.trim();
  if (n) storage.set('name', n);
  return n;
}

async function joinRoom(code, silent = false) {
  fresh = true;
  const res = await send('join', { code, name: myName() || storage.get('name', ''), token });
  if (res.error) {
    if (silent) {
      session.set('code', null);
      showLobby();
    }
    lobbyError(res.error);
    return;
  }
  session.set('code', res.code);
  history.replaceState(null, '', `/?room=${res.code}`);
}

$('#createBtn').addEventListener('click', async () => {
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  lobbyError('');
  fresh = true;
  const res = await send('create', { name: myName(), token });
  if (res.error) return lobbyError(res.error);
  session.set('code', res.code);
  history.replaceState(null, '', `/?room=${res.code}`);
});
$('#joinBtn').addEventListener('click', () => {
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  if (code.length !== 4) return lobbyError('초대 코드 4자리를 입력해 주세요');
  lobbyError('');
  joinRoom(code);
});
$('#codeInput').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
$('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
$('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && ($('#codeInput').value.trim() ? $('#joinBtn') : $('#createBtn')).click());

function showLobby() {
  state = null;
  $('#kickBar').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  $('#game').classList.add('hidden');
}
function showGame() {
  if (!$('#game').classList.contains('hidden')) return;
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  requestAnimationFrame(() => table.fit());
}

// ───────── 상단 ─────────
function inviteUrl() {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const base = local && lanUrls.length ? lanUrls[0] : location.origin;
  return `${base}/?room=${state.code}`;
}

function renderTop() {
  const s = state;
  $('#roomCode').textContent = s.code;
  const isHost = s.hostId === s.me;
  const live = s.hand && s.hand.street !== 'done';
  const [sb, bb] = s.blinds;
  const t = s.tourney;
  $('#blindInfo').replaceChildren(
    ...(t.active
      ? t.blindsFixed
        ? ['토너먼트 · 블라인드 고정 ', Object.assign(document.createElement('b'), { textContent: `${fmt(sb)}/${fmt(bb)}` }), ' · 칩을 다 쓰면 탈락']
        : [`토너먼트 · 레벨 ${t.level} · `, Object.assign(document.createElement('b'), { textContent: `${fmt(sb)}/${fmt(bb)}` }), ` · ${t.handsToNext ? `${t.handsToNext}판 뒤 ${fmt(t.nextBlinds[0])}/${fmt(t.nextBlinds[1])}` : `다음 판부터 ${fmt(t.nextBlinds[0])}/${fmt(t.nextBlinds[1])}`}`]
      : [s.settings.mode === 'tournament' ? '토너먼트 대기 · ' : '자유 게임 · ', '블라인드 ', Object.assign(document.createElement('b'), { textContent: `${fmt(sb)}/${fmt(bb)}` })]),
  );
  const startBtn = $('#startBtn');
  startBtn.classList.toggle('hidden', !isHost || s.running || live);
  startBtn.textContent = s.settings.mode === 'tournament' && !t.active ? (t.winnerName ? '새 토너먼트 시작' : '토너먼트 시작') : s.hand ? '게임 이어서 하기' : '게임 시작';
  $('#pauseBtn').classList.toggle('hidden', !isHost || !s.running);
  $('#soundBtn').textContent = isMuted() ? '🔇' : '🔊';
}

// ───────── 강퇴 투표 (과반이 찬성하면 내보낸다) ─────────
async function voteKick(pid) {
  const r = await send('voteKick', { target: pid });
  if (r.error) return toast(r.error, 'error');
  if (r.kicked) toast('과반이 찬성해서 내보냈어요');
  else toast(r.voted ? '강퇴에 찬성했어요' : '찬성을 취소했어요');
}

function openKick(pid) {
  if (!state || pid === state.me) return;
  const p = state.players.find((x) => x.id === pid);
  if (!p) return;
  const v = state.kickVotes?.find((x) => x.target === pid);
  const voters = state.players.filter((x) => x.connected && x.id !== pid).length;
  const need = v?.need ?? Math.floor(voters / 2) + 1;
  const body = el(
    'div',
    { class: 'kick-modal' },
    el('p', {}, v ? `강퇴 투표가 진행 중이에요: 찬성 ${v.count}/${need}명` : `접속해 있는 ${voters}명 중 ${need}명 이상이 찬성하면 ${p.name}님을 내보내요.`),
    el('p', { class: 'dim' }, '내보내진 사람은 같은 창으로 이 방에 다시 들어올 수 없어요. 판 중이면 폴드 처리돼요.'),
    el(
      'div',
      { class: 'modal-actions' },
      el('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, '닫기'),
      el('button', { type: 'button', class: `btn ${v?.mine ? '' : 'danger'}`, onclick: () => (close(), voteKick(pid)) }, v?.mine ? '찬성 취소' : v ? '강퇴 찬성' : '강퇴 투표 시작'),
    ),
  );
  const { close } = modal(`${p.name}님 강퇴`, body);
}

function renderKick() {
  const bar = $('#kickBar');
  const list = state?.kickVotes ?? [];
  bar.classList.toggle('hidden', !list.length);
  bar.replaceChildren(
    ...list.map((v) => {
      const sec = Math.max(0, Math.ceil((v.msLeft - (performance.now() - state.receivedAt)) / 1000));
      if (v.target === state.me) return el('div', { class: 'kick-row me' }, `⚠️ 나를 내보내자는 투표가 진행 중이에요 (찬성 ${v.count}/${v.need} · ${sec}초)`);
      return el(
        'div',
        { class: 'kick-row' },
        el('span', {}, `🗳️ ${v.name}님 강퇴 투표 · 찬성 ${v.count}/${v.need} · ${sec}초 남음`),
        el('button', { class: `btn small ${v.mine ? '' : 'danger'}`, onclick: () => voteKick(v.target) }, v.mine ? '찬성 취소' : '찬성'),
      );
    }),
  );
}

$('#copyBtn').addEventListener('click', () => copyInvite(pagesInvite('holdem', state.code)));
$('#startBtn').addEventListener('click', async () => {
  const r = await send('start');
  if (r.error) toast(r.error, 'error');
});
$('#pauseBtn').addEventListener('click', async () => {
  const r = await send('pause');
  if (r.error) toast(r.error, 'error');
});
$('#settingsBtn').addEventListener('click', () => state && openSettings(state, { send }));
$('#soundBtn').addEventListener('click', () => {
  setMuted(!isMuted());
  renderTop();
  if (!isMuted()) play('chips');
});
$('#panelBtn').addEventListener('click', () => {
  const p = $('#panel');
  p.classList.toggle('open');
  $('#panelBtn').classList.toggle('on', p.classList.contains('open'));
  setTimeout(() => table.fit(), 260);
});
$('#leaveBtn').addEventListener('click', async () => {
  const me = state?.players.find((p) => p.id === state.me);
  if (me?.inHand && !me.folded && !window.confirm('진행 중인 판은 폴드 처리돼요. 나갈까요?')) return;
  await send('leave');
  session.set('code', null);
  history.replaceState(null, '', '/');
  showLobby();
});

// 좁은 화면: 테이블을 누르면 서랍을 닫는다
$('.table-area').addEventListener('pointerdown', () => {
  if ($('#panel').classList.contains('open')) {
    $('#panel').classList.remove('open');
    $('#panelBtn').classList.remove('on');
  }
});

// 채팅 단축키: Enter 로 채팅창 열기
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (e.key === 'Enter' && state && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && !document.querySelector('.modal-back')) {
    $('#panel').classList.add('open');
    panels.focusChat();
  }
});

// 강퇴 투표 남은 시간 표시를 1초마다 줄인다
setInterval(() => {
  if (!state?.kickVotes?.length) return;
  renderKick();
}, 1000);
