/* global io */
import { $, el, toast, session, storage, hueOf, initial, fmt, short } from '../util.js';
import { modal } from '../panels.js';
import { copyInvite, pagesInvite } from '../invite.js';
import { createSidePanel } from '../sidepanel.js';
import { isMuted, setMuted, play, speak, isVoiceOn, setVoice } from '../sound.js';
import { cardEl, backEl, groupCaptured, loadSkin } from './card.js';
import { createDealer } from './dealer.js';
import { snapshot, animateTurn, animateDeal, finishAll, shake } from './motion.js';
import { card, SEOTDA_TABLE, SEOTDA_SPECIAL_TABLE, evalSeotda } from '/shared/hwatu.js';

/** null·false 를 빼고 자식을 바꾼다 (replaceChildren 은 null 을 글자로 넣는다) */
const put = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// ───────── 연결 ─────────
function makeToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}
let token = session.get('hwatu.token');
if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
  token = makeToken();
  session.set('hwatu.token', token);
}
const socket = io('/hwatu', { transports: ['websocket', 'polling'] });
const send = (event, payload = {}) =>
  new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: '서버 응답이 없어요' } : res || {})));
const call = async (ev, payload) => {
  const r = await send(ev, payload);
  if (r.error) toast(r.error, 'error');
  return r;
};

const dealer = createDealer();
$('#dealer').append(dealer.root);
loadSkin().then(() => state && render());

let state = null;
let prev = null;
let receivedAt = 0;
let lastFx = null;
let pendingPlay = null; // 고스톱: 바닥 패 고르기·흔들기·폭탄 확인 중인 손패

const nameOf = (id) => state?.players.find((p) => p.id === id)?.name ?? '나간 사람';
const isHost = () => state?.hostId === state?.me;
const G = () => state?.game;
const live = () => G() && G().phase !== 'result';

socket.on('connect', () => {
  $('#offline').classList.add('hidden');
  const code = session.get('hwatu.code');
  if (code) joinRoom(code, true);
});
socket.on('disconnect', () => $('#offline').classList.remove('hidden'));
socket.on('kicked', () => {
  session.set('hwatu.code', null);
  showLobby();
  toast('방에서 나가게 됐어요', 'error');
});
socket.on('state', (s) => {
  finishAll();
  const sameGostop = state?.game?.kind === 'gostop' && s.game?.kind === 'gostop' && state.gameNo === s.gameNo;
  const snap = sameGostop ? snapshot(s.me) : null;
  prev = state;
  state = s;
  receivedAt = performance.now();
  if (G()?.kind !== 'gostop' || G()?.turn !== s.me || G()?.phase !== 'play') pendingPlay = null;
  showGame();
  effects();
  render();
  if (snap) animateTurn(snap, prev.game, state.game);
});

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
      session.set('hwatu.code', null);
      showLobby();
    }
    return lobbyError(res.error);
  }
  session.set('hwatu.code', res.code);
  history.replaceState(null, '', `/hwatu/?room=${res.code}`);
}
$('#createBtn').addEventListener('click', async () => {
  if (!myName()) return lobbyError('닉네임을 입력해 주세요');
  const res = await send('create', { name: myName(), token });
  if (res.error) return lobbyError(res.error);
  session.set('hwatu.code', res.code);
  history.replaceState(null, '', `/hwatu/?room=${res.code}`);
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

// 입장 화면 장식 카드
(function deco() {
  const spots = [
    ['1-0', '8%', '14%', -14],
    ['3-0', '14%', '62%', 9],
    ['8-0', '82%', '12%', 12],
    ['9-0', '78%', '64%', -8],
    ['2-1', '4%', '40%', 6],
    ['6-1', '88%', '40%', -5],
  ];
  put($('#lobbyDeco'), ...spots.map(([id, x, y, r], i) => cardEl(id, { size: 'xl', attrs: { style: { left: x, top: y, '--r': `${r}deg`, animationDelay: `${-i * 1.3}s` } } })));
})();

function showLobby() {
  state = null;
  $('#lobby').classList.remove('hidden');
  $('#game').classList.add('hidden');
}
function showGame() {
  if (!$('#game').classList.contains('hidden')) return;
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  if (!storage.get('hwatu.rulesSeen', false)) setTimeout(openRules, 500);
}

// ───────── 상단 버튼 ─────────
$('#copyBtn').addEventListener('click', () => copyInvite(pagesInvite('hwatu', state.code)));
$('#startBtn').addEventListener('click', () => call('start'));
$('#pauseBtn').addEventListener('click', () => call('pause'));
$('#rebuyBtn').addEventListener('click', () => call('rebuy'));
$('#soundBtn').addEventListener('click', () => {
  setMuted(!isMuted());
  renderTopButtons();
});
$('#voiceBtn').addEventListener('click', () => {
  setVoice(!isVoiceOn());
  toast(isVoiceOn() ? '음성 콜을 켰어요 (고! 뻑! 따당!)' : '음성 콜을 껐어요');
  renderTopButtons();
});
$('#leaveBtn').addEventListener('click', async () => {
  const inIt = live() && G().order.includes(state.me);
  if (inIt && !window.confirm('판 도중에 나가면 이번 판은 다이(고스톱은 무효) 처리돼요. 나갈까요?')) return;
  await send('leave');
  session.set('hwatu.code', null);
  history.replaceState(null, '', '/hwatu/');
  showLobby();
});
$('#rulesBtn').addEventListener('click', openRules);
$('#settingsBtn').addEventListener('click', openSettings);

function renderTopButtons() {
  $('#soundBtn').textContent = isMuted() ? '🔇' : '🔊';
  $('#voiceBtn').classList.toggle('voice-off', !isVoiceOn());
}

function openRules() {
  storage.set('hwatu.rulesSeen', true);
  const seotda = el(
    'div',
    {},
    el('h3', {}, '🎴 섯다 (2~10명)'),
    el(
      'ol',
      {},
      el('li', {}, '모두 ', el('b', {}, '학교(기본금)'), '를 내고 한 장씩 받아요. 내 패는 나만 보여요.'),
      el('li', {}, '선부터 돌아가며 베팅: ', el('b', {}, '체크 · 삥'), '(기본금만큼) · ', el('b', {}, '콜 · 따당'), '(앞 베팅의 두 배) · ', el('b', {}, '하프'), '(콜하고 판돈의 절반 더) · ', el('b', {}, '다이')),
      el('li', {}, '한 장을 더 받고 마지막 베팅을 한 뒤, 남은 사람끼리 패를 까서 ', el('b', {}, '족보'), '가 높은 사람이 판돈을 가져가요.'),
      el('li', {}, '한 판에 걸 수 있는 칩은 참가자 중 가장 적은 칩까지예요. 같은 족보면 판돈을 나눠요.'),
      el('li', {}, '족보는 오른쪽 「족보」 탭에 있어요. 내 패가 어디쯤인지 표시돼요.'),
    ),
  );
  const gostop = el(
    'div',
    {},
    el('h3', {}, '🌸 고스톱 (2명 맞고 · 3명 이상)'),
    el(
      'ol',
      {},
      el('li', {}, '2명이면 손패 10장·바닥 8장·', el('b', {}, '7점'), '부터, 3명이면 손패 7장·바닥 6장·', el('b', {}, '3점'), '부터 날 수 있어요.'),
      el('li', {}, '4명 이상이면 3명이 치고 한 명은 ', el('b', {}, '광을 팔아요'), ' (받은 패의 광 1장마다 치는 사람이 점당 칩을 내요). 나머지는 쉬고, 판마다 자리를 돌려요.'),
      el('li', {}, '손패 한 장을 내고 더미에서 한 장을 뒤집어, 바닥의 ', el('b', {}, '같은 달'), '을 먹어요.'),
      el('li', {}, el('b', {}, '쪽'), '(낸 패를 뒤집은 패가 먹음) · ', el('b', {}, '따닥'), '(바닥 두 장 + 낸 패 + 뒤집은 패) · ', el('b', {}, '싹쓸이'), '는 상대마다 피 한 장씩 뺏어요.'),
      el('li', {}, el('b', {}, '뻑'), ': 낸 패로 짝을 맞췄는데 같은 달이 뒤집히면 세 장이 바닥에 쌓여요. 나중에 먹으면 피를 뺏고, 3뻑이면 바로 승리!'),
      el('li', {}, el('b', {}, '흔들기'), '(같은 달 3장을 보여 주고 내기) · ', el('b', {}, '폭탄'), '(3장 + 바닥 1장을 한 번에)은 점수 2배. 폭탄 뒤에는 두 번 「뒤집기만」 할 수 있어요.'),
      el('li', {}, '점수가 나면 ', el('b', {}, '고'), '(계속, +1점, 3고부터 2배씩) 또는 ', el('b', {}, '스톱'), '(끝내고 받기).'),
      el('li', {}, el('b', {}, '피박·광박·멍박'), '은 진 사람이 2배, 3명일 때 고를 부르고 진 사람은 ', el('b', {}, '고박'), '(혼자 다 냄), 아무도 못 나면 ', el('b', {}, '나가리'), '로 다음 판 2배. 손에 같은 달 4장이면 ', el('b', {}, '총통'), ' 승리.'),
      el('li', {}, '피박: 상대가 피로 점수를 냈는데 내 피가 1~7장 (0장이면 면제). 국진(9월 열끗)은 유리한 쪽으로 자동 계산해요.'),
      el('li', {}, el('b', {}, '조커'), '(보너스 쌍피, 방 설정에서 0~4장): 손에서 내면 바로 먹고 더미에서 한 장 받아 이어서 쳐요. 뒤집다 나오면 먹고 한 번 더 뒤집어요. 바닥에 깔리면 선이 가져가요.'),
    ),
  );
  const order = state?.settings.mode === 'gostop' ? [gostop, seotda] : [seotda, gostop];
  const ok = el('button', { class: 'btn primary' }, '알겠어요');
  const m = modal('화투 규칙', el('div', {}, el('div', { class: 'rules' }, ...order, el('h3', {}, '🔊 소리'), el('p', { class: 'muted' }, '🔊 효과음, 🗣 음성 콜(「고!」「뻑!」「따당!」)을 따로 켜고 끌 수 있어요.')), el('div', { class: 'modal-actions' }, ok)));
  ok.addEventListener('click', () => m.close());
}

function openSettings() {
  if (!state) return;
  const s = state.settings;
  const locked = !isHost() || live();
  const num = (name, value, [min, max], step = 10) => el('input', { type: 'number', name, value, min, max, step, disabled: locked });
  const modeSel = el('select', { name: 'mode', class: 'sel', disabled: locked }, [['seotda', '🎴 섯다 (2~10명)'], ['gostop', '🌸 고스톱 (2~3명 + 광팔기)']].map(([v, t]) => el('option', { value: v, selected: v === s.mode }, t)));
  const form = el(
    'form',
    { class: 'settings-form' },
    el(
      'div',
      { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, '게임'), modeSel),
      el('label', { class: 'field' }, el('span', {}, '차례 제한 시간 (초)'), num('turnSec', s.turnSec, state.limits.turnSec, 1)),
      el('label', { class: 'field' }, el('span', {}, '섯다 학교(기본금)'), num('ante', s.ante, state.limits.ante)),
      el('label', { class: 'field' }, el('span', {}, '고스톱 점당 칩'), num('pointChips', s.pointChips, state.limits.pointChips)),
      el('label', { class: 'field' }, el('span', {}, '시작 칩 (칩 다시 받기 금액)'), num('startChips', s.startChips, state.limits.startChips, 1000)),
      el('label', { class: 'field' }, el('span', {}, '고스톱 조커 (보너스 쌍피) 장수'), num('jokers', s.jokers, state.limits.jokers, 1)),
    ),
    locked ? el('p', { class: 'muted' }, isHost() ? '판이 끝난 뒤에 바꿀 수 있어요.' : '방장만 바꿀 수 있어요.') : null,
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

// ───────── 소리·음성·콜아웃 ─────────
const CALL = {
  jjok: ['쪽!', '쪽!'],
  ppeok: ['뻑!', '뻑!', 'blue'],
  ttadak: ['따닥!', '따닥!'],
  sseul: ['싹쓸이!', '싹쓸이!', 'gold'],
  bomb: ['폭탄!', '폭탄!', 'gold'],
  shake: ['흔들기!', '흔들었다!'],
  jappeok: ['자뻑!', '자뻑!', 'gold'],
  ppeokTake: ['뻑 먹기!', '뻑 먹었다!'],
  chongtong: ['총통!', '총통!', 'gold'],
  nagari: ['나가리', '나가리', 'blue'],
};
const BET_VOICE = { check: '체크', bbing: '삥', call: '콜', ttadang: '따당!', half: '하프!', max: '맥스!', die: '다이' };

function callout(text, sub = '', cls = '') {
  const box = $('#callout');
  const node = el('div', { class: `callout ${cls}` }, text, sub ? el('small', {}, sub) : null);
  put(box, node);
  setTimeout(() => node.isConnected && node.remove(), 1400);
}

function effects() {
  const list = state.fx ?? [];
  const newest = list.at(-1)?.seq ?? 0;
  if (lastFx === null) {
    lastFx = newest; // 처음 들어왔을 때 지난 소리는 틀지 않는다
    return;
  }
  const fresh = list.filter((f) => f.seq > lastFx);
  lastFx = Math.max(lastFx, newest);
  let delay = 0;
  for (const f of fresh) {
    const who = f.pid ? nameOf(f.pid) : '';
    switch (f.name) {
      case 'deal':
        // 화면이 다 그려진 뒤 자리 위치를 잡아 날린다
        requestAnimationFrame(() => dealAnimation(f));
        break;
      case 'bet':
        play(f.type === 'die' ? 'fold' : f.type === 'check' ? 'check' : 'chips', 0, f.type === 'max' || f.type === 'half' ? 6 : 3);
        if (f.type === 'max' || f.type === 'half' || f.type === 'ttadang') play('slap', 60, 0.7);
        speak(BET_VOICE[f.type]);
        break;
      case 'replay':
        play('bell');
        callout('재경기!', `${who}님의 ${f.label}`, 'blue');
        speak(`${f.label}. 재경기`);
        break;
      case 'jokbo': {
        const big = f.rank >= 801 || f.caught;
        dealer.mood(f.pid === state.me ? 'wink' : big ? 'happy' : 'happy', 2200);
        play(big ? 'big' : 'slap');
        if (big || f.rank >= 701) callout(f.name, f.caught ? `${who}님이 잡았다!` : `${who}님 승리`, f.rank >= 900 || f.caught ? 'gold' : '');
        speak(f.tie ? `${f.name} 동점` : f.name);
        break;
      }
      case 'pot':
        play('pot', 700);
        if (f.pid === state.me) play('jackpot', 900);
        break;
      case 'slap':
      case 'turnover':
      case 'take':
        break; // 패 모션(motion.js)이 부딪히는 순간에 소리를 낸다
      case 'steal':
        play('steal', 1300);
        break;
      case 'go':
        dealer.mood('happy');
        play('go', 0, f.n);
        callout(`${f.n}고!`, who, 'gold');
        speak(`${f.n}고!`);
        break;
      case 'stop':
        play('gong');
        callout('스톱!', who);
        speak('스톱!');
        break;
      case 'win':
        dealer.mood(f.pid === state.me ? 'wink' : 'happy', 2400);
        play(f.pid === state.me ? 'jackpot' : 'pot', 500);
        break;
      case 'joker':
        setTimeout(() => {
          callout('조커!', `${who} · 보너스 쌍피`, 'gold');
          speak('조커!');
        }, 300);
        play('big', 300);
        break;
      case 'gwangSale':
        play('chips', 0, 4);
        speak(`광 ${f.n}장 팝니다`);
        break;
      case 'join':
        play('join');
        break;
      case 'rebuy':
        play('chips', 0, 6);
        break;
      default:
        if (CALL[f.name]) {
          if (['jjok', 'ttadak', 'sseul', 'bomb', 'chongtong'].includes(f.name)) setTimeout(() => shake(document.querySelector('.hw-table'), 1.4), 950);
          const [text, voice, cls] = CALL[f.name];
          setTimeout(() => {
            callout(text, who, cls);
            speak(voice);
          }, f.name === 'shake' || f.name === 'chongtong' || f.name === 'nagari' ? 0 : 950);
          if (f.name === 'ppeok') play('ppeok', 1000);
          else if (f.name === 'nagari') play('gong');
          else play('big', 950);
        }
    }
  }
  // 내 차례 알림
  const g = G();
  const pg = prev?.game;
  if (g && g.turn === state.me && (pg?.turn !== state.me || pg?.phase !== g.phase) && g.phase !== 'result') play('turn', 300);
}

const rectFrom = (n) => {
  const r = n?.getBoundingClientRect();
  return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

/** 딜러 손에서 각 자리로 카드가 날아간다 */
function dealAnimation(f) {
  const g = G();
  if (!g) return;
  const seatOf = (id) => (id === state.me ? document.querySelector('#mine .me-hand') ?? document.querySelector(`.hseat[data-pid="${id}"]`) : document.querySelector(`.hseat[data-pid="${id}"] .hseat-cards`) ?? document.querySelector(`.hseat[data-pid="${id}"]`));
  const targets = [];
  if (g.kind === 'seotda') {
    for (const id of g.order) if (!g.folded.includes(id)) targets.push(seatOf(id));
  } else {
    // 고스톱: 상대에게는 뒷면을 날리고, 바닥과 내 손패는 한 장씩 깔며 뒤집는다
    for (let r = 0; r < 3; r++) for (const id of g.order) if (id !== state.me) targets.push(seatOf(id));
    if (g.sale) targets.push(document.querySelector(`.hseat[data-pid="${g.sale.seller}"]`));
    animateDeal(rectFrom(document.querySelector('.hd-deck')));
  }
  dealer.deal(targets.filter(Boolean), { gap: g.kind === 'seotda' ? 120 : 70 });
  if (g.kind === 'seotda') setTimeout(() => play('squeeze'), targets.length * 120 + 200);
}

// ───────── 타이머 ─────────
const PHASE_TEXT = { betting: '베팅', play: '패 내기', chooseFlip: '패 고르기', goStop: '고? 스톱?', result: '결과' };
(function tick() {
  if (state) {
    const left = Math.max(0, state.msLeft - (performance.now() - receivedAt));
    const sec = Math.ceil(left / 1000);
    const g = G();
    const base = !g ? (state.running ? '준비 중' : '대기 중') : g.phase === 'result' ? (state.running && state.msLeft ? '다음 판' : '결과') : PHASE_TEXT[g.phase] ?? '';
    const text = state.msLeft ? `${base} · ${sec}초` : base;
    const chip = $('#phaseChip');
    if (chip.textContent !== text) chip.textContent = text;
    chip.className = `phase-chip ${state.msLeft && sec <= 5 && g?.phase !== 'result' ? 'urgent' : 'open'}`;
    const pct = state.msTotal ? (left / state.msTotal) * 100 : 0;
    for (const bar of document.querySelectorAll('.turn-bar > i')) bar.style.width = `${pct}%`;
    for (const ring of document.querySelectorAll('.timer-ring')) {
      const c = ring.querySelector('circle');
      c.style.strokeDashoffset = String(113 * (1 - pct / 100));
      ring.classList.toggle('urgent', sec <= 5);
    }
    // 마지막 5초 째깍
    if (g && g.turn === state.me && g.phase !== 'result' && state.msLeft && sec <= 5 && sec !== tick.last) {
      tick.last = sec;
      if (sec > 0) play('tick');
    }
  }
  requestAnimationFrame(tick);
})();
const timerRing = () => el('svg:svg', { class: 'timer-ring', viewBox: '0 0 40 40' }, el('svg:circle', { cx: 20, cy: 20, r: 18, 'stroke-dasharray': 113, 'stroke-dashoffset': 0 }));

// ───────── 렌더 ─────────
function render() {
  const s = state;
  $('#roomCode').textContent = s.code;
  const g = G();
  const modeName = s.settings.mode === 'seotda' ? '🎴 섯다' : '🌸 고스톱';
  const stake = s.settings.mode === 'seotda' ? `학교 ${fmt(s.settings.ante)}` : `점당 ${fmt(s.settings.pointChips)} · 조커 ${s.settings.jokers}장`;
  put($('#modeInfo'), el('b', {}, modeName), ` · ${stake}${s.gameNo ? ` · ${s.gameNo}번째 판` : ''}`, s.settings.mode === 'gostop' && s.nagari > 1 ? el('span', { class: 'x2' }, ` · 나가리 ${s.nagari}배`) : null);
  const canStart = isHost() && !s.running;
  $('#startBtn').classList.toggle('hidden', !canStart);
  $('#startBtn').textContent = s.gameNo ? '이어서 시작' : '게임 시작';
  $('#pauseBtn').classList.toggle('hidden', !(isHost() && s.running));
  const me = s.players.find((p) => p.id === s.me);
  const need = s.settings.mode === 'seotda' ? s.settings.ante * 3 : s.settings.pointChips * 10;
  $('#rebuyBtn').classList.toggle('hidden', !me || me.chips >= need || (live() && g.order.includes(s.me)));
  renderTopButtons();
  renderSeats();
  renderCenter();
  renderMine();
  renderSide();
}

/** 자리 순서: 판에 들어간 사람(순서대로) → 나머지 */
function seatOrder() {
  const g = G();
  const ids = g ? [...g.order] : [];
  for (const p of state.players) if (!ids.includes(p.id)) ids.push(p.id);
  return ids;
}

function renderSeats() {
  const s = state;
  const g = G();
  put($('#seats'), 
    ...seatOrder().map((id) => {
      const p = s.players.find((x) => x.id === id);
      const inGame = g && g.order.includes(id);
      const name = p?.name ?? '나간 사람';
      const tags = [];
      if (s.hostId === id) tags.push(['방장', 'host']);
      if (g && g.order[0] === id) tags.push(['선', 'lead']);
      if (g?.kind === 'gostop' && g.sale?.seller === id) tags.push([`광 ${g.sale.cards.length}장 팜`, 'sell']);
      else if (g && !inGame && p) tags.push(['쉼', 'rest']);
      if (p && !p.connected) tags.push(['끊김', 'away']);
      const winner = g?.phase === 'result' && (g.kind === 'seotda' ? g.result.winners.includes(id) : g.result.winner === id);
      const cls = ['hseat', g?.turn === id ? 'turn' : '', id === s.me ? 'me' : '', g && !inGame ? 'out' : '', g?.kind === 'seotda' && g.folded.includes(id) ? 'folded' : '', winner ? 'winner' : ''].join(' ');
      const body = [];
      if (g?.kind === 'seotda' && inGame) body.push(...seotdaSeat(id));
      if (g?.kind === 'gostop' && inGame) body.push(...gostopSeat(id));
      if (g?.kind === 'gostop' && g.sale?.seller === id && g.sale.cards.length) body.push(el('div', { class: 'hseat-cards' }, g.sale.cards.map((c) => cardEl(c, { size: 'xs' }))));
      return el(
        'div',
        { class: cls, 'data-pid': id },
        el('div', { class: 'hseat-tags' }, tags.map(([t, c]) => el('span', { class: c }, t))),
        el('div', { class: 'hseat-head' }, el('div', { class: 'hseat-av', style: { '--hue': hueOf(name) } }, initial(name), g?.turn === id && g.phase !== 'result' ? timerRing() : null), el('div', { style: { minWidth: 0 } }, el('div', { class: 'hseat-name' }, name + (id === s.me ? ' (나)' : '')), el('div', { class: 'hseat-chips' }, `🪙 ${fmt(p?.chips ?? 0)}`))),
        ...body,
      );
    }),
  );
}

function seotdaSeat(id) {
  const g = G();
  const hand = g.hands[id] ?? [];
  const out = [];
  const shown = hand.length && hand.every(Boolean);
  out.push(el('div', { class: 'hseat-cards' }, hand.map((c) => (c && (id !== state.me || g.phase === 'result') ? cardEl(c, { size: 'sm', cls: g.phase === 'result' ? 'flipin' : '' }) : backEl({ size: 'sm' })))));
  const res = g.result?.results?.[id];
  if (g.phase === 'result' && res) {
    const top = res.eff >= 801 || res.caught;
    out.push(el('div', { class: `hseat-jokbo ${top ? 'top' : res.eff < 700 ? 'low' : ''}` }, res.caught ? `${res.name} (잡음!)` : res.name));
  } else if (g.phase === 'result' && shown && id !== state.me) out.push(el('div', { class: 'hseat-jokbo low' }, evalSeotda(hand).name));
  if (g.phase === 'result' && g.result.won?.[id]) out.push(el('div', { class: 'hseat-won' }, `+${fmt(g.result.won[id])}`));
  else if (g.phase === 'result' && !g.result.replay && g.contrib[id]) out.push(el('div', { class: 'hseat-lost' }, `−${fmt(g.contrib[id])}`));
  const act = g.lastActs[id];
  if (act && g.phase !== 'result') {
    const label = { check: '체크', bbing: '삥', call: '콜', ttadang: '따당', half: '하프', max: '맥스', die: '다이' }[act.type];
    out.push(el('div', { class: `hseat-act ${act.type === 'die' ? 'die' : ['ttadang', 'half', 'max', 'bbing'].includes(act.type) ? 'raise' : ''}` }, `${label}${act.amount ? ` ${short(act.amount)}` : ''}`));
  }
  if (g.contrib[id] && g.phase !== 'result') out.push(el('div', { class: 'muted', style: { fontSize: '11px' } }, `이번 판 ${fmt(g.contrib[id])} 걸음`));
  return out;
}

function captGroups(ids, size = 'xs', pid = '') {
  const gp = groupCaptured(ids);
  const labels = [['gwang', '광'], ['yeol', '열'], ['tti', '띠'], ['pi', '피']];
  return el(
    'div',
    { class: 'capt', 'data-cpid': pid },
    labels
      .filter(([k]) => gp[k].length)
      .map(([k, label]) => el('div', { class: 'capt-group' }, el('div', { class: 'hw-stack' }, gp[k].map((c) => cardEl(c, { size }))), el('label', {}, `${label} `, el('b', {}, k === 'pi' ? piLabel(gp.pi) : gp[k].length)))),
  );
}
const piLabel = (ids) => ids.reduce((s, c) => s + (card(c).kind === 'ssangpi' || card(c).joker ? 2 : 1), 0);

function gostopSeat(id) {
  const g = G();
  const out = [];
  const sc = g.scores[id];
  const chips = [el('span', { class: 'pts' }, `${sc.total}점`)];
  if (g.goCount[id]) chips.push(el('span', { class: 'go' }, `${g.goCount[id]}고`));
  if (g.shakes[id]) chips.push(el('span', {}, `흔들 ×${2 ** g.shakes[id]}`));
  if (g.ppeokCount[id]) chips.push(el('span', {}, `뻑 ${g.ppeokCount[id]}`));
  if (g.skips[id]) chips.push(el('span', {}, `뒤집기 ${g.skips[id]}`));
  out.push(el('div', { class: 'hseat-score' }, chips));
  if (id !== state.me) {
    const h = g.hands[id];
    out.push(el('div', { class: 'hseat-cards backs' }, typeof h === 'number' ? Array.from({ length: Math.min(h, 10) }, () => backEl({ size: 'xs' })) : h.map((c) => cardEl(c, { size: 'xs' })), typeof h === 'number' ? el('span', { class: 'muted', style: { fontSize: '11px', marginLeft: '4px' } }, `${h}장`) : null));
    out.push(captGroups(g.captured[id], 'xs', id));
  }
  if (g.phase === 'result' && g.result.winner) {
    const pay = g.result.payments.find((x) => x.from === id);
    if (g.result.winner === id) out.push(el('div', { class: 'hseat-won' }, `+${fmt(g.result.payments.reduce((a, x) => a + x.chips, 0))}`));
    else if (pay) out.push(el('div', { class: 'hseat-lost' }, `−${fmt(pay.chips)}${pay.tags.length ? ` (${pay.tags.join('·')})` : ''}`));
  }
  return out;
}

// ───────── 가운데 ─────────
function renderCenter() {
  const s = state;
  const g = G();
  dealer.say(s.dealer);
  const nodes = [];
  if (!g) {
    nodes.push(
      el(
        'div',
        { class: 'wait-box' },
        el('h2', {}, s.settings.mode === 'seotda' ? '🎴 섯다 한 판 어때요?' : '🌸 고스톱 한 판 어때요?'),
        el('p', {}, `지금 ${s.players.filter((p) => p.connected).length}명 접속 중 · 2명 이상이면 시작할 수 있어요.`),
        el('p', {}, isHost() ? '⚙에서 섯다/고스톱과 판돈을 고르고 「게임 시작」을 눌러 주세요.' : '방장이 시작하기를 기다리고 있어요.'),
        isHost() && !s.running ? el('button', { class: 'btn primary big', onclick: () => call('start') }, '게임 시작') : null,
      ),
    );
  } else if (g.kind === 'seotda') nodes.push(...seotdaCenter());
  else nodes.push(...gostopCenter());
  put($('#center'), ...nodes);
}

function chipPile(amount) {
  const colors = ['#c8312f', '#1f8a4c', '#23252b', '#6d3fa8', '#e0b23a', '#2b9fc8'];
  const n = Math.min(8, Math.max(1, Math.round(Math.log10(Math.max(10, amount)) * 2)));
  return el('div', { class: 'chip-pile' }, Array.from({ length: n }, (_, i) => el('i', { style: { '--c': colors[i % colors.length] } })));
}

function seotdaCenter() {
  const g = G();
  const out = [el('div', { class: 'pot-box' }, chipPile(g.pot), el('div', {}, el('div', { class: 'label' }, g.replayNo ? `판돈 · 재경기 ${g.replayNo}` : '판돈'), el('b', {}, fmt(g.pot))), el('small', {}, `한도 ${fmt(g.cap)}`))];
  if (g.phase === 'betting') out.push(el('div', { class: 'muted' }, `${g.stage}번째 장 베팅 · 현재 ${fmt(g.currentBet)}`));
  if (g.phase === 'result') {
    const r = g.result;
    if (r.replay) out.push(el('div', { class: 'result-card' }, el('h2', {}, '재경기!'), el('div', { class: 'calc' }, `${nameOf(r.replay.by)}님의 ${r.replay.key === 'meong' ? '멍텅구리 구사' : '구사'} · 판돈 ${fmt(r.pot)}을 걸고 다시 칩니다`)));
    else {
      const w = r.winners;
      const best = w.length && r.results?.[w[0]];
      out.push(
        el(
          'div',
          { class: 'result-card' },
          el('h2', {}, w.length ? (best ? `${best.name}${best.caught ? ' (잡았다!)' : ''}` : '모두 다이!') : '무승부'),
          el('div', { class: 'calc' }, w.length ? [el('b', {}, w.map(nameOf).join(', ')), `님이 ${fmt(r.pot)}칩을 가져가요${w.length > 1 ? ' (나눠 가짐)' : ''}`] : ''),
          state.running ? el('div', { class: 'muted' }, '곧 다음 판이 시작돼요') : isHost() ? el('button', { class: 'btn primary', onclick: () => call('start') }, '다음 판') : null,
        ),
      );
    }
  }
  return out;
}

function gostopCenter() {
  const g = G();
  // 바닥: 달별로 묶기
  const groups = new Map();
  for (const c of g.floor) {
    const m = card(c).month;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(c);
  }
  const selecting = pendingPlay?.choose ? new Set(pendingPlay.choose) : g.pending?.options ? new Set(g.pending.options) : null;
  const floor = el(
    'div',
    { class: 'floor' },
    groups.size
      ? [...groups.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([m, cs]) =>
            el(
              'div',
              { class: `floor-group${g.ppeok.includes(m) ? ' ppeok' : ''}`, 'data-month': m },
              cs.map((c) => {
                const sel = selecting?.has(c) && (g.turn === state.me);
                return cardEl(c, {
                  size: 'md',
                  cls: sel ? 'selectable' : '',
                  attrs: sel ? { onclick: () => pickFloor(c), role: 'button', tabindex: 0 } : {},
                });
              }),
            ),
          )
      : el('div', { class: 'floor-empty' }, '바닥이 비었어요'),
  );
  const deck = el('div', { class: 'deck-pile' }, g.deckCount ? [backEl({ size: 'md', attrs: { style: { transform: 'translate(3px,3px)' } } }), backEl({ size: 'md' })] : null, el('div', { class: 'cnt' }, `더미 ${g.deckCount}장`));
  const out = [el('div', { class: 'floor-wrap' }, deck, floor)];
  // 직전 차례
  if (g.last && g.phase !== 'result') {
    const L = g.last;
    out.push(
      el(
        'div',
        { class: 'last-move' },
        `${nameOf(L.pid)}: `,
        L.played.length ? ['낸 패', ...L.played.map((c) => cardEl(c, { size: 'xs' }))] : '뒤집기만',
        L.flipped ? [' · 뒤집은 패', cardEl(L.flipped, { size: 'xs' })] : null,
        L.took.length ? ` · ${L.took.length}장 먹음` : '',
        L.stolen?.length ? ` · 피 ${L.stolen.length}장 뺏음` : '',
      ),
    );
  }
  if (g.phase === 'chooseFlip' && g.turn === state.me) out.push(el('div', { class: 'choose-box' }, el('b', {}, '뒤집은 패로 먹을 바닥 패를 고르세요'), el('div', { class: 'row' }, cardEl(g.pending.flip, { size: 'md' }), '→', g.pending.options.map((c) => cardEl(c, { size: 'md', cls: 'selectable', attrs: { onclick: () => call('choose', { card: c }), role: 'button', tabindex: 0 } })))));
  else if (g.phase === 'chooseFlip') out.push(el('div', { class: 'muted' }, `${nameOf(g.turn)}님이 먹을 패를 고르는 중…`));
  if (pendingPlay?.choose) out.push(el('div', { class: 'choose-box' }, el('b', {}, '바닥에서 먹을 패를 고르세요 (반짝이는 패)'), el('button', { class: 'btn small ghost', onclick: () => ((pendingPlay = null), render()) }, '취소')));
  if (g.phase === 'goStop') {
    const mine = g.turn === state.me;
    const sc = g.scores[g.turn];
    out.push(
      mine
        ? el(
            'div',
            { class: 'gostop-box' },
            el('b', {}, `${sc.total}점! 계속할까요?`),
            el('div', { class: 'score-items' }, sc.items.map(([n, v]) => el('span', {}, n, el('b', {}, `${v}점`)))),
            el('div', { class: 'row' }, el('button', { class: 'btn go', onclick: () => call('goStop', { choice: 'go' }) }, `${(g.goCount[state.me] ?? 0) + 1}고!`), el('button', { class: 'btn stop', onclick: () => call('goStop', { choice: 'stop' }) }, '스톱')),
            el('div', { class: 'turn-bar', style: { width: '100%' } }, el('i', { style: { width: '100%' } })),
          )
        : el('div', { class: 'gostop-box' }, el('b', {}, `${nameOf(g.turn)}님 ${sc.total}점 — 고? 스톱?`)),
    );
  }
  if (g.phase === 'result') out.push(gostopResult());
  return out;
}

function gostopResult() {
  const g = G();
  const r = g.result;
  const next = state.running ? el('div', { class: 'muted' }, '곧 다음 판이 시작돼요') : isHost() ? el('button', { class: 'btn primary', onclick: () => call('start') }, '다음 판') : null;
  if (!r.winner) return el('div', { class: 'result-card' }, el('h2', {}, r.aborted ? '이번 판은 무효' : '나가리!'), el('div', { class: 'calc' }, r.aborted ? '참가자가 나가서 판을 무효로 했어요' : `아무도 못 났어요. 다음 판은 ${r.nextNagari}배!`), next);
  const parts = [`${r.score.total}점`];
  if (r.chongtong) parts[0] = `총통 (${r.chongtong}월)`;
  if (r.threePpeok) parts[0] = '3뻑';
  if (r.forfeit) parts[0] = `${nameOf(r.forfeit)}님 기권 · ${r.points}점`;
  if (r.go) parts.push(`+ ${r.go}고`);
  const muls = [];
  if (r.goMul > 1) muls.push(`${r.go}고 ×${r.goMul}`);
  if (r.shakeMul > 1) muls.push(`흔들기·폭탄 ×${r.shakeMul}`);
  if (r.nagariMul > 1) muls.push(`나가리 ×${r.nagariMul}`);
  return el(
    'div',
    { class: 'result-card' },
    el('h2', {}, `${nameOf(r.winner)}님 승리!`),
    el('div', { class: 'score-items' }, r.score.items.map(([n, v]) => el('span', {}, n, el('b', {}, `${v}점`)))),
    el('div', { class: 'calc' }, el('b', {}, parts.join(' ')), muls.length ? ` · ${muls.join(' · ')}` : '', ` = `, el('b', {}, `${r.points}점`), ` · 점당 ${fmt(state.settings.pointChips)}칩`),
    el(
      'div',
      { class: 'pay-list' },
      r.payments.map((p) => el('div', { class: 'pay-row' }, el('span', {}, nameOf(p.from), el('span', { class: 'tags' }, p.tags.map((t) => el('span', {}, t)))), el('span', {}, `${p.points}점 · `, el('b', {}, `${fmt(p.chips)}칩`), p.chips < p.want ? el('small', { class: 'muted' }, ` (칩 부족, ${fmt(p.want)} 중)`) : null))),
    ),
    next,
  );
}

// ───────── 내 자리 ─────────
let myHandSig = '';
function renderMine() {
  const g = G();
  const box = $('#mine');
  if (!g || !g.order.includes(state.me)) {
    myHandSig = '';
    const msg = !g ? '게임이 시작되면 여기에 내 패가 나와요.' : g.kind === 'gostop' && g.sale?.seller === state.me ? `이번 판은 광을 팔고 쉬어요 (광 ${g.sale.cards.length}장 · ${fmt(g.sale.paid.reduce((a, x) => a + x.chips, 0))}칩 받음). 다음 판에 들어가요.` : '이번 판은 구경 중이에요. 다음 판부터 같이해요.';
    put(box, el('div', { class: 'me-wait' }, msg));
    return;
  }
  if (g.kind === 'seotda') put(box, ...seotdaMine());
  else put(box, ...gostopMine());
}

function seotdaMine() {
  const g = G();
  const mh = g.myHand;
  const ids = mh?.ids ?? [];
  const sig = ids.join(',');
  const fresh = sig !== myHandSig;
  const prevIds = myHandSig ? myHandSig.split(',') : [];
  myHandSig = sig;
  const delay = `${0.15 + g.order.filter((x) => !g.folded.includes(x)).length * 0.12}s`;
  const hand = el('div', { class: 'me-hand' }, ids.map((c) => cardEl(c, { size: 'lg', cls: fresh && !prevIds.includes(c) ? 'flipin' : '', attrs: fresh && !prevIds.includes(c) ? { style: { animationDelay: delay } } : {} })));
  const info = [];
  if (mh?.jokbo) {
    const j = mh.jokbo;
    const top = j.rank >= 801;
    const special = j.special ? { amhaeng: '13·18광땡을 잡아요', ttaengjabi: '1~9땡을 잡아요', gusa: '상대가 알리 이하면 재경기', meong: '상대가 장땡 이하면 재경기' }[j.special] : '';
    info.push(el('div', { class: 'my-jokbo' }, el('b', { class: top ? 'top' : '' }, j.name), special ? el('span', { class: 'sp' }, `${special} · 아니면 ${j.plain}`) : null, el('small', {}, '내 족보')));
  } else if (mh?.one) info.push(el('div', { class: 'my-jokbo' }, el('b', {}, mh.one), el('small', {}, '첫 장 · 한 장 더 받아요')));
  if (g.folded.includes(state.me)) info.push(el('div', { class: 'me-wait' }, '다이했어요. 이번 판 결과를 기다려요.'));
  const o = g.options;
  if (o) {
    const btn = (type, label, cls) =>
      type in o
        ? el(
            'button',
            { class: `btn ${cls}`, onclick: () => call('bet', { type }) },
            el('span', { class: 'btn-col' }, label, o[type] ? el('small', {}, fmt(o[type])) : null),
          )
        : null;
    info.push(
      el('div', { class: 'hw-actions' }, btn('die', '다이', 'die'), btn('check', '체크', 'call'), btn('call', '콜', 'call'), btn('bbing', '삥', 'raise'), btn('ttadang', '따당', 'raise'), btn('half', '하프', 'raise'), btn('max', '맥스', 'raise')),
      el('div', { class: 'turn-bar' }, el('i', { style: { width: '100%' } })),
    );
  } else if (g.phase === 'betting' && !g.folded.includes(state.me)) info.push(el('div', { class: 'me-wait' }, `${nameOf(g.turn)}님 차례예요.`));
  return [el('div', { class: 'me-row' }, hand, el('div', { class: 'me-info' }, ...info))];
}

function gostopMine() {
  const g = G();
  const myTurn = g.turn === state.me && g.phase === 'play';
  const hand = el(
    'div',
    { class: 'me-hand gostop' },
    (g.myHand ?? []).map((c) => {
      const pl = g.playable?.[c];
      const node = cardEl(c, {
        size: 'lg',
        cls: `${myTurn ? 'playable' : ''} ${pl?.matches.length ? 'match' : ''} ${pendingPlay?.card === c ? 'match' : ''}`,
        attrs: myTurn ? { role: 'button', tabindex: 0, onclick: () => playCard(c) } : {},
      });
      if (myTurn) {
        // 손패에 올리면 바닥의 같은 달이 반짝인다
        node.addEventListener('mouseenter', () => document.querySelector(`.floor-group[data-month="${card(c).month}"]`)?.querySelectorAll('.hwc').forEach((n) => n.classList.add('hint-floor')));
        node.addEventListener('mouseleave', () => document.querySelectorAll('.hint-floor').forEach((n) => n.classList.remove('hint-floor')));
        node.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), playCard(c)));
      }
      return node;
    }),
  );
  const sc = g.scores[state.me];
  const info = [
    el('div', { class: 'my-jokbo' }, el('b', { class: sc.total >= g.rule.win ? 'top' : '' }, `${sc.total}점`), el('small', {}, `${g.rule.win}점부터 날 수 있어요`), g.goCount[state.me] ? el('span', { class: 'sp' }, `${g.goCount[state.me]}고 중`) : null),
    captGroups(g.captured[state.me], 'sm', state.me),
  ];
  const acts = [];
  if (g.canFlipOnly) acts.push(el('button', { class: 'btn raise', onclick: () => call('play', { flipOnly: true }) }, `🂠 뒤집기만 (${g.skips[state.me]}번 남음)`));
  if (pendingPlay?.ask) {
    const { card: c, ask } = pendingPlay;
    acts.push(
      el('b', {}, ask === 'bomb' ? `${card(c).month}월 세 장! 폭탄으로 한 번에 낼까요? (2배, 피 뺏기)` : `${card(c).month}월 세 장! 흔들고 낼까요? (2배)`),
      el('button', { class: 'btn raise', onclick: () => sendPlay(c, ask === 'bomb' ? { bomb: true } : { shake: true }) }, ask === 'bomb' ? '💣 폭탄!' : '🙌 흔들기'),
      el('button', { class: 'btn', onclick: () => sendPlay(c, {}) }, '그냥 한 장'),
      el('button', { class: 'btn ghost', onclick: () => ((pendingPlay = null), render()) }, '취소'),
    );
  }
  if (acts.length) info.push(el('div', { class: 'hw-actions' }, acts));
  if (myTurn || (g.turn === state.me && g.phase !== 'result')) info.push(el('div', { class: 'turn-bar' }, el('i', { style: { width: '100%' } })));
  else if (g.phase !== 'result') info.push(el('div', { class: 'me-wait' }, `${nameOf(g.turn)}님 차례예요.`));
  return [el('div', { class: 'me-row' }, hand), el('div', { class: 'me-info' }, ...info)];
}

function playCard(c) {
  const g = G();
  const pl = g.playable?.[c];
  if (!pl) return;
  if (pl.joker) return sendPlay(c, {});
  if (pl.bomb || pl.shake) {
    pendingPlay = { card: c, ask: pl.bomb ? 'bomb' : 'shake' };
    play('flip');
    return render();
  }
  if (pl.choose) {
    pendingPlay = { card: c, choose: pl.matches };
    play('flip');
    return render();
  }
  sendPlay(c, {});
}
function pickFloor(target) {
  const g = G();
  if (g.phase === 'chooseFlip') return call('choose', { card: target });
  if (pendingPlay?.choose) sendPlay(pendingPlay.card, { target });
}
async function sendPlay(c, opts) {
  const g = G();
  // 흔들기/그냥 내기 후에도 바닥 두 장 고르기가 필요하면 이어서 묻는다
  const pl = g.playable?.[c];
  if (!opts.target && !opts.bomb && pl?.choose) {
    pendingPlay = { card: c, choose: pl.matches, shake: opts.shake };
    return render();
  }
  const extra = pendingPlay?.shake ? { shake: true } : {};
  pendingPlay = null;
  const r = await call('play', { card: c, ...extra, ...opts });
  if (r.choose) {
    pendingPlay = { card: c, choose: r.choose };
    render();
  }
}

// ───────── 옆 패널 ─────────
const side = createSidePanel($('#sidePanel'), {
  tabs: [
    ['chat', '채팅'],
    ['jokbo', '족보'],
    ['rank', '순위'],
    ['hist', '기록'],
  ],
  send,
  emptyText: '한마디 던져 보세요! 「따당 간다」',
});
let jokboOpened = false;
function renderSide() {
  const s = state;
  const g = G();
  // 섯다에서 처음 패를 받으면 족보 탭을 한 번 열어 준다
  if (!jokboOpened && g?.kind === 'seotda' && g.order.includes(s.me)) {
    jokboOpened = true;
    side.select('jokbo');
  }
  const myKey = g?.kind === 'seotda' ? g.myHand?.jokbo?.key ?? null : null;
  side.update(s, {
    jokbo: [JSON.stringify([s.settings.mode, myKey, g?.kind === 'gostop' ? g.scores[s.me] : null]), () => (s.settings.mode === 'seotda' ? seotdaJokbo(myKey) : gostopTable(g?.kind === 'gostop' ? g.scores[s.me] : null))],
    rank: [
      JSON.stringify(s.players.map((p) => [p.id, p.name, p.chips, p.wins, p.played, p.rebuys])),
      () => {
        const list = [...s.players].sort((a, b) => b.chips - b.rebuys * s.settings.startChips - (a.chips - a.rebuys * s.settings.startChips));
        return el(
          'table',
          { class: 'rank-table' },
          el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '이름'), el('th', {}, '칩'), el('th', {}, '승/판'), el('th', {}, '손익'))),
          el(
            'tbody',
            {},
            list.map((p, i) => {
              const pl = p.chips - s.settings.startChips * (1 + p.rebuys);
              return el('tr', { class: p.id === s.me ? 'me' : '' }, el('td', {}, i + 1), el('td', {}, el('span', { class: 'chat-avatar', style: { '--hue': hueOf(p.name) } }, initial(p.name)), p.name), el('td', {}, fmt(p.chips)), el('td', {}, `${p.wins}/${p.played}`), el('td', { class: pl >= 0 ? 'up' : 'down' }, `${pl >= 0 ? '+' : ''}${short(pl)}`));
            }),
          ),
        );
      },
    ],
    hist: [
      JSON.stringify(s.history),
      () =>
        s.history.length
          ? el(
              'ol',
              { class: 'history-list' },
              s.history.map((h) => el('li', { class: 'hist-l' }, el('div', {}, el('b', {}, `${h.no}판`), ` · ${h.kind === 'seotda' ? '섯다' : '고스톱'}`), el('div', {}, h.winners.length ? [el('span', { class: 'win' }, h.winners.join(', ')), ` · ${h.hand}`] : h.hand), h.pot ? el('div', { class: 'muted' }, `${fmt(h.pot)}칩`) : null, h.tags?.length ? el('div', {}, h.tags.map((t) => el('span', { class: 'hw-tag' }, t))) : null)),
            )
          : el('p', { class: 'muted', style: { padding: '14px' } }, '끝난 판이 여기에 쌓여요'),
    ],
  });
}

const EXAMPLES = {
  38: ['3-0', '8-0'],
  gwang: ['1-0', '8-0'],
  jang: ['10-0', '10-1'],
  ttaeng: ['9-0', '9-1'],
  ali: ['1-1', '2-1'],
  doksa: ['1-1', '4-1'],
  gubbing: ['1-1', '9-1'],
  jangbbing: ['1-1', '10-1'],
  jangsa: ['10-1', '4-1'],
  seryuk: ['4-1', '6-1'],
  kkeut: ['2-1', '7-1'],
  mangtong: ['3-1', '7-1'],
  amhaeng: ['4-0', '7-0'],
  ttaengjabi: ['3-0', '7-0'],
  gusa: ['4-1', '9-1'],
  meong: ['4-0', '9-0'],
};
function seotdaJokbo(myKey) {
  const row = (r, i, special = false) =>
    el(
      'div',
      { class: `jk-row${r.key === myKey ? ' mine' : ''}${special ? ' special' : ''}` },
      el('span', { class: 'no' }, special ? '★' : i + 1),
      el('div', {}, el('div', { class: 'nm' }, r.name), el('div', { class: 'ds' }, r.desc)),
      el('div', { class: 'ex' }, EXAMPLES[r.key].map((c) => cardEl(c, { size: 'xs' }))),
      r.note ? el('div', { class: 'nt' }, r.note) : null,
    );
  return el(
    'div',
    { class: 'jokbo' },
    el('h3', {}, '섯다 족보 (위가 높음)'),
    SEOTDA_TABLE.map((r, i) => row(r, i)),
    el('h3', {}, '특수 족보'),
    SEOTDA_SPECIAL_TABLE.map((r) => row(r, 0, true)),
    el('p', { class: 'rule-note' }, '끗: 두 장의 달을 더한 끝자리 (예: 2+7=9 → 갑오, 3+7=10 → 망통). 같은 족보면 판돈을 나눠요. 광땡은 光 표시가 있는 1·3·8월 광끼리만이에요.'),
  );
}
function gostopTable(sc) {
  const rows = [
    ['오광', '광 5장', '15점'],
    ['사광', '광 4장', '4점'],
    ['삼광', '광 3장 (비광 없이)', '3점'],
    ['비삼광', '비광 포함 광 3장', '2점'],
    ['고도리', '2·4·8월 새 (열끗 3장)', '5점'],
    ['홍단', '1·2·3월 붉은 띠', '3점'],
    ['청단', '6·9·10월 파란 띠', '3점'],
    ['초단', '4·5·7월 띠', '3점'],
    ['열끗', '5장부터', '1점 + 1장당 1점'],
    ['띠', '5장부터', '1점 + 1장당 1점'],
    ['피', '10장부터 (쌍피 2장)', '1점 + 1장당 1점'],
  ];
  return el(
    'div',
    { class: 'jokbo' },
    sc ? [el('h3', {}, `내 점수 ${sc.total}점`), el('div', { class: 'score-items', style: { justifyContent: 'flex-start' } }, sc.items.length ? sc.items.map(([n, v]) => el('span', {}, n, el('b', {}, `${v}점`))) : el('span', {}, `광 ${sc.gwang} · 열 ${sc.yeol} · 띠 ${sc.tti} · 피 ${sc.pi}`))] : null,
    el('h3', {}, '점수 계산'),
    el('table', { class: 'score-rules' }, el('tbody', {}, rows.map(([a, b, c]) => el('tr', {}, el('td', {}, el('b', {}, a)), el('td', { class: 'muted' }, b), el('td', {}, c))))),
    el('h3', {}, '배수'),
    el('p', { class: 'rule-note' }, '고 1번마다 +1점, 3고부터 2배·4배… · 흔들기·폭탄 2배 · 피박·광박·멍박(열끗 7장 이상으로 남) 2배 · 나가리 다음 판 2배 · 3명일 때 고를 부르고 진 사람은 고박(혼자 다 냄)'),
  );
}
