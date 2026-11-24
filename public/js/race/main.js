/* global io */
import { $, el, fmt, toast, hideToast, session, storage, hueOf, initial } from '../util.js';
import { createTrack } from './track.js';
import { jockeyPortrait, GEARS, GEAR_LABEL } from './sprites.js';
import { modal } from '../panels.js';
import { createSidePanel } from '../sidepanel.js';
import { isMuted, setMuted, play, stopRaceAmbience } from '../sound.js';

// ───────── 플레이어 토큰 (탭마다 다른 플레이어) ─────────
function makeToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}
let token = session.get('race.token');
if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
  token = makeToken();
  session.set('race.token', token);
}

const socket = io('/race', { transports: ['websocket', 'polling'] });
const send = (event, payload = {}) =>
  new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: '서버 응답이 없어요' } : res || {})));

let state = null;
let lanUrls = [];
let receivedAt = 0;
const track = createTrack($('#trackWrap'));

// 마권 고르기 상태
let betType = 'win';
let picks = [];
let amount = storage.get('race.amount', 100);
let quoteOdds = null;
let quoteKey = '';
let raceDoneLocally = false;
let resultShownFor = 0;
let lastPhase = '';

const LIGHT = ['#f4f1e8', '#f2c230', '#5fc4d9', '#9aa3ad'];
const ink = (c) => (LIGHT.includes(c) ? '#111' : '#fff');
const noBadge = (h, cls = '') => el('span', { class: `no-badge ${cls}`, style: { background: h?.color ?? '#555', color: ink(h?.color) } }, String(h?.no ?? '?'));
const horseOf = (no) => state?.card?.horses.find((h) => h.no === Number(no));
/** 마체중 증감: ▲증가 / ▼감소 / 변화 없음, 10kg 이상이면 주의 */
function weightChange(d) {
  if (!d) return el('span', { class: 'wchg same' }, '변화 없음');
  const big = Math.abs(d) >= 10;
  return el('span', { class: `wchg ${d > 0 ? 'up' : 'down'}${big ? ' big' : ''}`, title: big ? '체중 변화가 커서 컨디션에 영향이 있을 수 있어요' : '' }, `${d > 0 ? '▲' : '▼'}${Math.abs(d)}kg ${d > 0 ? '증가' : '감소'}`, big ? ' ⚠' : '');
}
const gearOf = (h) => GEAR_LABEL[GEARS[(h.no - 1) % GEARS.length]];

/** 말·기수 소개 창 */
function openProfile(h) {
  const winRate = h.jockeyRecord ? Math.round((h.jockeyRecord.wins / h.jockeyRecord.rides) * 1000) / 10 : 0;
  const body = el(
    'div',
    { class: 'profile' },
    el(
      'div',
      { class: 'pf-horse' },
      el('div', { class: 'pf-title' }, noBadge(h), el('div', {}, el('b', {}, h.name), el('div', { class: 'pf-nick' }, `“${h.nickname}”`))),
      el('p', { class: 'pf-intro' }, h.intro),
      el(
        'div',
        { class: 'pf-stats' },
        el('span', {}, el('small', {}, '성별·나이'), `${h.sex} ${h.age}세`),
        el('span', {}, el('small', {}, '부담중량'), `${h.weight}kg`),
        el('span', {}, el('small', {}, '마체중'), `${h.body}kg `, weightChange(h.delta)),
        el('span', {}, el('small', {}, '최근 3전'), h.recent.join('-') + '착'),
        el('span', {}, el('small', {}, '오늘의 소품'), gearOf(h)),
      ),
    ),
    el(
      'div',
      { class: 'pf-jockey' },
      jockeyPortrait(h),
      el(
        'div',
        {},
        el('div', { class: 'pf-jname' }, `기수 ${h.jockey}`, el('span', { class: 'pf-style' }, h.jockeyStyle)),
        el('p', { class: 'pf-intro' }, h.jockeyIntro),
        el('div', { class: 'muted small' }, `통산 ${fmt(h.jockeyRecord?.rides ?? 0)}전 ${fmt(h.jockeyRecord?.wins ?? 0)}승 · 승률 ${winRate}%`),
      ),
    ),
  );
  const closeBtn = el('button', { class: 'btn ghost' }, '닫기');
  const m = modal(`${h.no}번 ${h.name}`, el('div', {}, body, el('div', { class: 'modal-actions' }, closeBtn)));
  closeBtn.addEventListener('click', () => m.close());
}
const comboText = (type, combo) => {
  const nos = String(combo).split('-');
  return nos.join(state.betTypes[type].ordered ? ' → ' : ' · ');
};

// ───────── 소켓 ─────────
socket.on('hello', (info) => (lanUrls = info?.lanUrls || []));
socket.on('connect', () => {
  $('#offline').classList.add('hidden');
  const code = session.get('race.code');
  if (code) joinRoom(code, true);
});
socket.on('disconnect', () => $('#offline').classList.remove('hidden'));
socket.on('state', (s) => {
  const prev = state;
  state = s;
  receivedAt = performance.now();
  showGame();
  if (prev?.round !== s.round) {
    // 새 경주: 고른 말 초기화
    picks = [];
    quoteOdds = null;
    raceDoneLocally = false;
  }
  if (s.phase !== lastPhase) onPhase(s.phase, lastPhase);
  lastPhase = s.phase;
  render();
});

function onPhase(phase, before) {
  if (phase === 'betting' && before) play('bell');
  if (phase === 'racing') {
    raceDoneLocally = false;
    hideResult();
  }
  if (phase !== 'result') hideResult();
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
      session.set('race.code', null);
      showLobby();
    }
    return lobbyError(res.error);
  }
  session.set('race.code', res.code);
  history.replaceState(null, '', `/race/?room=${res.code}`);
}
$('#createBtn').addEventListener('click', async () => {
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  const res = await send('create', { name: myName(), token });
  if (res.error) return lobbyError(res.error);
  session.set('race.code', res.code);
  history.replaceState(null, '', `/race/?room=${res.code}`);
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
  track.idle();
  $('#lobby').classList.remove('hidden');
  $('#game').classList.add('hidden');
}
function showGame() {
  if (!$('#game').classList.contains('hidden')) return;
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  if (!storage.get('race.guideSeen', false)) setTimeout(openGuide, 600);
  requestAnimationFrame(() => track.fit());
}

// ───────── 마권 사는 법 안내 ─────────
function openGuide() {
  const ex = (type, combo, text) => el('tr', {}, el('th', {}, type), el('td', { class: 'g-ex' }, combo), el('td', {}, text));
  const body = el(
    'div',
    { class: 'guide' },
    el('h3', {}, '이렇게 사요'),
    el(
      'ol',
      { class: 'g-steps' },
      el('li', {}, el('b', {}, '승식 고르기'), ' — 오른쪽 위 「단승식」~「삼쌍승식」 중 하나를 눌러요. 처음이면 ', el('b', {}, '단승식'), '이 가장 쉬워요.'),
      el('li', {}, el('b', {}, '말 고르기'), ' — 아래 출주표에서 말 줄을 눌러요. 승식에 따라 1~3마리를 골라요. 순서가 중요한 승식은 누른 순서대로 1착·2착·3착이 돼요.'),
      el('li', {}, el('b', {}, '금액 정하기'), ' — +10, +50 같은 버튼이나 숫자 칸으로 정해요. 10칩 단위예요.'),
      el('li', {}, el('b', {}, '「마권 구매」 누르기'), ' — 여러 장을 사도 돼요. 발매 마감 전까지는 「내 마권」에서 ✕로 취소할 수 있어요.'),
      el('li', {}, el('b', {}, '경주 보기'), ' — 발매가 마감되면 바로 출발해요. 맞히면 경주가 끝날 때 칩이 자동으로 들어와요.'),
    ),
    el('h3', {}, '승식 7가지 (예: 1착 3번, 2착 7번, 3착 5번으로 들어왔을 때)'),
    el(
      'table',
      { class: 'g-table' },
      el('tbody', {},
        ex('단승식', '3', '1등할 말 한 마리. 가장 쉬워요.'),
        ex('연승식', '3 · 7 · 5 중 하나', '3등 안에만 들면 적중 (출전 7두 이하면 2등 안). 잘 맞지만 배당이 낮아요.'),
        ex('복승식', '3 · 7', '1·2등 두 마리, 순서는 상관없어요.'),
        ex('쌍승식', '3 → 7', '1등·2등을 순서까지 맞혀요.'),
        ex('복연승식', '3·7, 3·5, 7·5', '고른 두 마리가 모두 3등 안에 들면 적중, 순서 무관.'),
        ex('삼복승식', '3 · 7 · 5', '1~3등 세 마리, 순서는 상관없어요.'),
        ex('삼쌍승식', '3 → 7 → 5', '1·2·3등을 순서까지 다 맞혀요. 가장 어렵고 배당이 가장 커요.'),
      ),
    ),
    el('h3', {}, '배당 보는 법'),
    el(
      'ul',
      { class: 'g-tips' },
      el('li', {}, el('b', {}, '배당 4.0'), '은 100칩을 걸어 맞히면 ', el('b', {}, '400칩'), '을 돌려받는다는 뜻이에요 (건 돈 포함).'),
      el('li', {}, '배당은 실제 경마처럼 ', el('b', {}, '사람들이 많이 거는 말일수록 낮아지고'), ', 발매가 마감되는 순간 확정돼요. 표의 「인기」 1번이 가장 많이 걸린 말이에요.'),
      el('li', {}, '출주표의 ', el('b', {}, '부담중량'), '(가벼울수록 유리), ', el('b', {}, '마체중 증감'), '(▲▼가 크면 컨디션 주의), ', el('b', {}, '최근 3전'), ', ⓘ 버튼의 ', el('b', {}, '말·기수 소개'), '를 참고하세요.'),
      el('li', {}, '경주 중에는 부스트·넘어짐 같은 ', el('b', {}, '돌발 상황'), '이 있어서 인기마도 질 수 있어요!'),
      el('li', {}, '칩을 다 쓰면 「칩 다시 받기」로 처음 칩을 다시 받을 수 있어요. 가상 칩이라 실제 돈과는 상관없어요.'),
    ),
  );
  const closeBtn = el('button', { class: 'btn primary' }, '알겠어요');
  const m = modal('🎫 마권 사는 법', el('div', {}, body, el('div', { class: 'modal-actions' }, closeBtn)));
  closeBtn.addEventListener('click', () => m.close());
  storage.set('race.guideSeen', true);
}

// ───────── 상단 ─────────
function inviteUrl() {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const base = local && lanUrls.length ? lanUrls[0] : location.origin;
  return `${base}/race/?room=${state.code}`;
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
$('#startBtn').addEventListener('click', async () => {
  const r = await send('start');
  if (r.error) toast(r.error, 'error');
});
$('#pauseBtn').addEventListener('click', async () => {
  const r = await send('pause');
  if (r.error) toast(r.error, 'error');
});
$('#soundBtn').addEventListener('click', () => {
  setMuted(!isMuted());
  if (isMuted()) stopRaceAmbience();
  renderTop();
});
$('#leaveBtn').addEventListener('click', async () => {
  if (state?.myBets?.length && state.phase === 'racing' && !window.confirm('경주 중인 마권은 결과가 나오면 정산돼요. 나갈까요?')) return;
  await send('leave');
  session.set('race.code', null);
  history.replaceState(null, '', '/race/');
  showLobby();
});
$('#settingsBtn').addEventListener('click', () => {
  if (!state) return;
  const isHost = state.hostId === state.me;
  const input = el('input', { type: 'number', min: 15, max: 180, value: state.bettingSec, disabled: !isHost });
  const form = el(
    'form',
    { class: 'settings-form' },
    el('label', { class: 'field' }, el('span', {}, '마권 발매 시간 (초)'), input, el('small', {}, '경주마다 이 시간 동안 마권을 살 수 있어요 (15~180초)')),
    isHost ? null : el('p', { class: 'muted' }, '방장만 바꿀 수 있어요.'),
    el('div', { class: 'modal-actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, '닫기'), isHost ? el('button', { type: 'submit', class: 'btn primary' }, '저장') : null),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await send('settings', { bettingSec: input.value });
    if (r.error) return toast(r.error, 'error');
    toast('다음 경주부터 적용돼요');
    close();
  });
  const { close } = modal('경마장 설정', form);
});

function phaseText() {
  const left = Math.max(0, state.phaseMsLeft - (performance.now() - receivedAt));
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.ceil((ms % 60000) / 1000) % 60).padStart(2, '0')}`;
  switch (state.phase) {
    case 'betting':
      return { text: `발매 마감까지 ${mmss(left)}`, cls: left < 10_000 ? 'urgent' : 'open' };
    case 'racing':
      return { text: '경주 중', cls: 'live' };
    case 'result':
      return { text: `다음 경주까지 ${Math.ceil(left / 1000)}초`, cls: '' };
    default:
      return { text: '대기 중', cls: '' };
  }
}

function renderTop() {
  const s = state;
  $('#roomCode').textContent = s.code;
  const c = s.card;
  $('#raceInfo').replaceChildren(
    ...(c
      ? [el('b', {}, `제${s.round}경주`), ` ${fmt(c.distance)}m · 주로 `, el('span', { class: `track-cond ${c.trackKey}` }, c.track), ` · ${c.horses.filter((h) => !h.scratched).length}두`]
      : ['경주 준비 중']),
  );
  const isHost = s.hostId === s.me;
  $('#startBtn').classList.toggle('hidden', !isHost || s.running);
  $('#pauseBtn').classList.toggle('hidden', !isHost || !s.running);
  $('#soundBtn').textContent = isMuted() ? '🔇' : '🔊';
}

// 발매 남은 시간은 매 프레임 갱신
(function tick() {
  if (state) {
    const p = phaseText();
    const chip = $('#phaseChip');
    if (chip.textContent !== p.text) chip.textContent = p.text;
    chip.className = `phase-chip ${p.cls}`;
  }
  requestAnimationFrame(tick);
})();

// ───────── 렌더 ─────────
function render() {
  renderTop();
  $('#game').classList.toggle('racing', state.phase === 'racing');
  $('#casterText').textContent = state.caster;
  track.setCard(state.card);
  if ((state.phase === 'racing' || state.phase === 'result') && state.race) {
    track.playRace(state.race, receivedAt, {
      onDone: () => {
        raceDoneLocally = true;
        if (state.phase === 'result') showResult();
      },
    });
  } else track.idle();
  if (state.phase === 'result' && (raceDoneLocally || !state.race || state.race.msUntilStart < -60_000)) showResult();
  renderCard();
  renderSlip();
  renderPanel();
}

// 출주표 + 배당판
let cardSig = '';
function renderCard() {
  const s = state;
  const area = $('#cardArea');
  const c = s.card;
  const sig = JSON.stringify([c, s.odds?.win, s.odds?.place, picks, betType, s.phase]);
  if (sig === cardSig) return;
  cardSig = sig;
  if (!c) {
    area.replaceChildren(el('div', { class: 'empty-card' }, s.hostId === s.me ? '「경마 시작」을 누르면 첫 경주 출주표가 나와요.' : '방장이 경마를 시작하기를 기다리는 중이에요.'));
    return;
  }
  const win = s.odds?.win ?? {};
  const place = s.odds?.place ?? {};
  const rank = Object.entries(win)
    .filter(([no]) => !horseOf(no)?.scratched)
    .sort((a, b) => a[1] - b[1])
    .map(([no]) => Number(no));
  const canPick = s.phase === 'betting';
  const rows = c.horses.map((h) => {
    const sel = picks.indexOf(h.no);
    const pop = rank.indexOf(h.no) + 1;
    return el(
      'tr',
      {
        class: `${h.scratched ? 'scratched' : ''}${sel >= 0 ? ' picked' : ''}`,
        onclick: () => canPick && !h.scratched && togglePick(h.no),
        tabindex: canPick && !h.scratched ? 0 : null,
        onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && canPick && !h.scratched && (e.preventDefault(), togglePick(h.no)),
      },
      el('td', {}, noBadge(h), sel >= 0 ? el('span', { class: 'pick-mark' }, s.betTypes[betType].ordered ? `${sel + 1}착` : '✓') : null),
      el(
        'td',
        { class: 'hname' },
        el('b', {}, h.name),
        el('span', { class: 'nick' }, h.nickname),
        h.scratched ? el('span', { class: 'scr' }, '출전 취소') : null,
        el('small', {}, `${h.sex} ${h.age}세 · 기수 ${h.jockey} (${h.jockeyStyle}) · ${gearOf(h)}`),
      ),
      el('td', {}, `${h.weight}kg`),
      el('td', {}, el('div', {}, `${h.body}kg`), weightChange(h.delta)),
      el('td', { class: 'recent' }, h.recent.map((r) => el('span', { class: r <= 3 ? 'top' : '' }, r)).flatMap((x, i) => (i ? ['-', x] : [x]))),
      el('td', { class: 'odds' }, h.scratched ? '—' : el('b', { class: pop === 1 ? 'fav' : '' }, win[h.no]?.toFixed(1) ?? '—')),
      el('td', { class: 'odds' }, h.scratched ? '—' : place[h.no]?.toFixed(1) ?? '—'),
      el('td', { class: 'pop' }, h.scratched ? '' : `${pop}`),
      el('td', {}, el('button', { class: 'info-btn', title: '말·기수 소개', 'aria-label': `${h.name} 소개`, onclick: (e) => (e.stopPropagation(), openProfile(h)) }, 'ⓘ')),
    );
  });
  area.replaceChildren(
    el(
      'table',
      { class: 'race-card' },
      el(
        'thead',
        {},
        el('tr', {}, el('th', {}, '마번'), el('th', {}, '마명 / 기수'), el('th', {}, '부담'), el('th', {}, '마체중 (증감)'), el('th', {}, '최근 3전'), el('th', {}, '단승'), el('th', {}, '연승'), el('th', {}, '인기'), el('th', {}, '소개')),
      ),
      el('tbody', {}, rows),
    ),
    el('p', { class: 'card-note muted' }, `배당은 매출에 따라 바뀌고 발매 마감 때 확정돼요 (환급률 ${Math.round(s.takeout * 100)}%). 연승식은 ${c.placeN}착까지 적중이에요.`),
  );
}

function togglePick(no) {
  const size = state.betTypes[betType].size;
  const i = picks.indexOf(no);
  if (i >= 0) picks.splice(i, 1);
  else if (picks.length < size) picks.push(no);
  else picks[size - 1] = no;
  play('pop');
  refreshQuote();
  cardSig = '';
  render();
}

async function refreshQuote() {
  quoteOdds = null;
  const size = state.betTypes[betType].size;
  if (picks.length !== size) return;
  if (betType === 'win' || betType === 'place') {
    quoteOdds = state.odds?.[betType]?.[picks[0]] ?? null;
    return;
  }
  const key = `${betType}:${picks.join('-')}`;
  quoteKey = key;
  const r = await send('quote', { type: betType, horses: picks });
  if (quoteKey === key && !r.error) {
    quoteOdds = r.odds;
    slipSig = '';
    renderSlip();
  }
}
// 배당이 바뀌면 조합 배당도 다시 묻는다
setInterval(() => state?.phase === 'betting' && picks.length && refreshQuote().then(() => ((slipSig = ''), renderSlip())), 3000);

// 마권 구매 영역
let slipSig = '';
function renderSlip() {
  const s = state;
  const slip = $('#slip');
  const me = s.players.find((p) => p.id === s.me);
  const sig = JSON.stringify([betType, picks, amount, quoteOdds, s.phase, s.myBets, me?.chips, s.canRebuy, s.odds?.popular?.[betType], s.round]);
  if (sig === slipSig) return;
  slipSig = sig;
  const bt = s.betTypes[betType];
  const open = s.phase === 'betting' && s.card;
  const types = Object.entries(s.betTypes).map(([k, v]) =>
    el(
      'button',
      {
        class: `bt${k === betType ? ' on' : ''}`,
        title: v.desc,
        onclick: () => {
          betType = k;
          picks = picks.slice(0, v.size);
          refreshQuote();
          slipSig = '';
          cardSig = '';
          render();
        },
      },
      v.label,
    ),
  );
  const slotLabels = bt.ordered ? ['1착', '2착', '3착'] : ['선택', '선택', '선택'];
  const slots = Array.from({ length: bt.size }, (_, i) => {
    const h = horseOf(picks[i]);
    return el(
      'div',
      { class: `slot${h ? ' filled' : ''}`, onclick: () => h && togglePick(h.no) },
      el('small', {}, slotLabels[i]),
      h ? [noBadge(h), el('span', {}, h.name)] : el('span', { class: 'muted' }, '출주표에서 고르기'),
    );
  });
  const complete = picks.length === bt.size;
  const pay = complete && quoteOdds ? Math.floor(amount * quoteOdds) : null;
  const setAmt = (v) => {
    amount = Math.max(s.minBet, Math.min(me?.chips ?? 0, Math.round(v / s.minBet) * s.minBet || s.minBet));
    storage.set('race.amount', amount);
    slipSig = '';
    renderSlip();
  };
  const amtInput = el('input', { type: 'number', class: 'amt-input', min: s.minBet, step: s.minBet, value: amount, 'aria-label': '구매 금액' });
  amtInput.addEventListener('change', () => setAmt(Number(amtInput.value)));
  const buy = el(
    'button',
    {
      class: 'btn primary big buy',
      disabled: !open || !complete || (me?.chips ?? 0) < s.minBet,
      onclick: async () => {
        const r = await send('bet', { type: betType, horses: picks, amount });
        if (r.error) return toast(r.error, 'error');
        hideToast();
        play('ticket');
        toast(`${bt.label} ${comboText(betType, picks.join('-'))} ${fmt(amount)}칩 구매!`);
      },
    },
    !open ? (s.phase === 'racing' ? '경주 중 · 발매 마감' : '발매 시간이 아니에요') : complete ? `마권 구매 ${fmt(amount)}칩` : `말 ${bt.size - picks.length}마리 더 고르기`,
  );
  const popular = (s.odds?.popular?.[betType] ?? []).slice(0, 6);
  const myBets = s.myBets.map((b) =>
    el(
      'li',
      { class: 'ticket' },
      el('span', { class: 'tk-type' }, s.betTypes[b.type].label),
      el('span', { class: 'tk-combo' }, b.horses.map((n) => noBadge(horseOf(n), 'sm'))),
      el('span', { class: 'tk-amt' }, `${fmt(b.amount)}칩`),
      el('span', { class: 'tk-odds' }, b.odds ? `${b.odds.toFixed(1)}배 → ${fmt(Math.floor(b.amount * b.odds))}` : ''),
      open ? el('button', { class: 'tk-cancel', title: '취소', 'aria-label': '마권 취소', onclick: async () => { const r = await send('cancel', { id: b.id }); if (r.error) toast(r.error, 'error'); } }, '✕') : null,
    ),
  );
  // replaceChildren 에 null 을 넘기면 "null" 글자가 들어가므로 걸러 낸다
  slip.replaceChildren(
    ...[el('div', { class: 'slip-head' }, el('h2', {}, '마권 구매'), el('button', { class: 'guide-btn', onclick: openGuide }, '❓ 마권 사는 법'), el('div', { class: 'my-chips' }, '내 칩 ', el('b', {}, fmt(me?.chips ?? 0)))),
    el('div', { class: 'bt-row' }, types),
    el('p', { class: 'bt-desc' }, bt.desc),
    el('div', { class: 'slots' }, slots),
    el(
      'div',
      { class: 'quote' },
      complete ? (quoteOdds ? ['현재 배당 ', el('b', {}, `${quoteOdds.toFixed(1)}배`), pay ? ` · 적중 시 ${fmt(pay)}칩` : ''] : '배당 확인 중…') : '말을 고르면 배당이 보여요',
    ),
    el(
      'div',
      { class: 'amt-row' },
      amtInput,
      ...[10, 50, 100, 500].map((v) => el('button', { class: 'chip-btn', onclick: () => setAmt(amount + v) }, `+${v}`)),
      el('button', { class: 'chip-btn', onclick: () => setAmt(s.minBet) }, '초기화'),
      el('button', { class: 'chip-btn', onclick: () => setAmt(me?.chips ?? 0) }, '전부'),
    ),
    buy,
    popular.length && bt.size > 1
      ? el(
          'div',
          { class: 'popular' },
          el('small', { class: 'muted' }, '인기 조합'),
          el(
            'div',
            { class: 'pop-list' },
            popular.map(([combo, odds]) =>
              el(
                'button',
                {
                  class: 'pop-item',
                  disabled: !open,
                  onclick: () => {
                    picks = combo.split('-').map(Number);
                    refreshQuote();
                    slipSig = '';
                    cardSig = '';
                    render();
                  },
                },
                comboText(betType, combo),
                el('b', {}, `${odds.toFixed(1)}`),
              ),
            ),
          ),
        )
      : null,
    el('div', { class: 'tickets-head' }, el('h3', {}, `내 마권 ${s.myBets.length ? `(${s.myBets.length})` : ''}`), s.myBets.length ? el('span', { class: 'muted' }, `합계 ${fmt(s.myBets.reduce((a, b) => a + b.amount, 0))}칩`) : null),
    s.myBets.length ? el('ul', { class: 'tickets' }, myBets) : el('p', { class: 'muted small' }, open ? '아직 산 마권이 없어요.' : '이번 경주에 산 마권이 없어요.'),
    s.canRebuy ? el('button', { class: 'btn primary', onclick: async () => { const r = await send('rebuy'); if (r.error) toast(r.error, 'error'); else play('chips'); } }, `칩 ${fmt(s.startChips)}개 다시 받기`) : null,
  ].filter(Boolean));
}

// 옆 패널: 채팅 입력창은 고정, 경주 기록·순위 탭만 바뀔 때 다시 그린다
const side = createSidePanel($('#racePanel'), { tabs: [['chat', '채팅'], ['history', '경주 기록'], ['rank', '순위']], send, emptyText: '응원 한마디 남겨 보세요!' });
function renderPanel() {
  const s = state;
  side.update(s, {
    history: [
      JSON.stringify(s.history.map((h) => h.round)),
      () =>
        s.history.length
          ? el(
              'ol',
              { class: 'history-list' },
              s.history.map((h) =>
                el(
                  'li',
                  { class: 'hist' },
                  el('div', { class: 'hist-head' }, el('b', {}, `제${h.round}경주`), el('span', { class: 'muted' }, `${h.distance}m · ${h.track}`)),
                  el('div', { class: 'hist-podium' }, h.top3.map((x, i) => el('span', {}, el('small', {}, `${i + 1}착`), noBadge(x, 'sm'), x.name))),
                  el('div', { class: 'muted small' }, `단승 ${h.winOdds?.toFixed(1) ?? '-'}배 · 삼쌍승 ${h.trifecta?.toFixed(1) ?? '-'}배 · 적중 마권 ${h.hits}장`),
                ),
              ),
            )
          : el('p', { class: 'muted' }, '끝난 경주가 여기에 쌓여요'),
    ],
    rank: [
      JSON.stringify(s.players.map((p) => [p.id, p.name, p.chips, p.inPlay, p.net, p.stats])),
      () => {
        const list = [...s.players].sort((a, b) => b.chips + b.inPlay - (a.chips + a.inPlay));
        const best = [...s.players].sort((a, c) => c.stats.bestPayout - a.stats.bestPayout)[0];
        return el(
          'div',
          {},
          el(
            'table',
            { class: 'rank-table' },
            el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '이름'), el('th', {}, '칩'), el('th', {}, '손익'), el('th', { title: '적중 / 산 마권' }, '적중'))),
            el(
              'tbody',
              {},
              list.map((p, i) =>
                el(
                  'tr',
                  { class: p.id === s.me ? 'me' : '' },
                  el('td', {}, i + 1),
                  el('td', {}, el('span', { class: 'chat-avatar', style: { '--hue': hueOf(p.name) } }, initial(p.name)), p.name),
                  el('td', {}, fmt(p.chips)),
                  el('td', { class: p.net > 0 ? 'up' : p.net < 0 ? 'down' : '' }, `${p.net > 0 ? '+' : ''}${fmt(p.net)}`),
                  el('td', {}, `${p.stats.hits}/${p.stats.tickets}`),
                ),
              ),
            ),
          ),
          el('div', { class: 'rank-foot muted' }, `최고 적중: ${best?.stats.bestPayout ? `${best.name} ${fmt(best.stats.bestPayout)}칩` : '-'}`),
        );
      },
    ],
  });
}

// ───────── 결과 ─────────
function hideResult() {
  $('#resultLayer').classList.add('hidden');
}
function showResult() {
  const s = state;
  const r = s.results;
  if (!r || resultShownFor === s.round) {
    if (r && resultShownFor === s.round) $('#resultLayer').classList.remove('hidden');
    return;
  }
  resultShownFor = s.round;
  const myHits = r.hits.filter((h) => h.pid === s.me);
  const myPay = myHits.reduce((a, h) => a + h.pay, 0);
  const layer = $('#resultLayer');
  const typeOrder = ['win', 'place', 'quinella', 'exacta', 'quinellaPlace', 'trio', 'trifecta'];
  layer.replaceChildren(
    el(
      'div',
      { class: 'result-card' },
      el('button', { class: 'result-close', 'aria-label': '닫기', onclick: hideResult }, '✕'),
      el('h2', {}, `제${s.round}경주 결과 확정`),
      el(
        'div',
        { class: 'result-grid' },
        el(
          'table',
          { class: 'finish-table' },
          el('thead', {}, el('tr', {}, el('th', {}, '착순'), el('th', {}, '마번'), el('th', {}, '마명'), el('th', {}, '기수'), el('th', {}, '기록'), el('th', {}, '착차'), el('th', {}, '단승'))),
          el(
            'tbody',
            {},
            r.board.map((b) =>
              el(
                'tr',
                { class: b.rank <= 3 ? `r${b.rank}` : '' },
                el('td', {}, b.rank <= 3 ? ['🥇', '🥈', '🥉'][b.rank - 1] : b.rank),
                el('td', {}, noBadge(b, 'sm')),
                el('td', {}, b.name),
                el('td', { class: 'muted' }, b.jockey),
                el('td', {}, b.time),
                el('td', { class: 'muted' }, b.margin),
                el('td', {}, b.winOdds?.toFixed(1) ?? '-'),
              ),
            ),
          ),
        ),
        el(
          'div',
          { class: 'paid' },
          el('h3', {}, '확정 배당'),
          el(
            'table',
            { class: 'paid-table' },
            el(
              'tbody',
              {},
              typeOrder.map((t) =>
                el(
                  'tr',
                  {},
                  el('th', {}, s.betTypes[t].label),
                  el('td', {}, r.paid[t].map((p) => el('div', {}, el('span', { class: 'combo' }, comboText(t, p.combo)), el('b', {}, `${p.odds?.toFixed(1) ?? '-'}배`)))),
                ),
              ),
            ),
          ),
        ),
      ),
      r.scratched?.length ? el('p', { class: 'muted small' }, `${r.scratched.join(', ')}번 출전 취소 · 관련 마권 환불`) : null,
      el(
        'div',
        { class: `my-result${myPay ? ' hit' : ''}` },
        myHits.length
          ? [el('div', { class: 'my-total' }, '🎉 적중! ', el('b', {}, `+${fmt(myPay)}칩`)), el('ul', {}, myHits.map((h) => el('li', {}, `${s.betTypes[h.type].label} ${comboText(h.type, h.horses.join('-'))} · ${fmt(h.amount)}칩 × ${h.odds.toFixed(1)}배 = ${fmt(h.pay)}칩`)))]
          : el('div', {}, s.race?.refund ? `출전 취소로 ${fmt(s.race.refund)}칩이 환불됐어요.` : '이번 경주는 적중 마권이 없어요. 다음 경주를 노려 보세요!'),
      ),
      r.hits.length ? el('p', { class: 'muted small' }, `이번 경주 적중: ${[...new Set(r.hits.map((h) => h.name))].join(', ')}`) : null,
    ),
  );
  layer.classList.remove('hidden');
  play(myPay ? 'jackpot' : 'result');
}
$('#resultLayer').addEventListener('pointerdown', (e) => e.target === $('#resultLayer') && hideResult());
