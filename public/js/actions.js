// 하단 행동 영역: 내 족보, 폴드/체크/콜/레이즈, 미리 선택, 단축키
import { el, fmt, toast } from './util.js';
import { miniCard } from './cards.js';
import { play } from './sound.js';

let currentHand = null;
import('/shared/hand-eval.js').then((m) => (currentHand = m.currentHand)).catch(() => {});

export function createActions(root, { send }) {
  let state = null;
  let pre = null; // { type: 'checkfold'|'check'|'call'|'callany', amount, handNo }
  let raiseTo = 0;
  let raiseKey = '';
  let busy = false;
  let allinArmedAt = 0;
  let autoTimer = null;

  const info = el('div', { class: 'my-hand' });
  const main = el('div', { class: 'act-main' });
  root.replaceChildren(info, main);

  async function act(type, amount) {
    if (busy) return;
    busy = true;
    pre = null;
    const r = await send('action', { type, amount });
    busy = false;
    if (r.error) toast(r.error, 'error');
  }

  const me = () => state?.players.find((p) => p.id === state.me);

  function presetValues(a) {
    const potAfterCall = a.pot + a.toCall;
    const clamp = (v) => Math.max(a.minTo, Math.min(a.maxTo, Math.round(v)));
    const list = [
      ['최소', a.minTo],
      ['½ 팟', a.currentBet + potAfterCall / 2],
      ['¾ 팟', a.currentBet + (potAfterCall * 3) / 4],
      ['팟', a.currentBet + potAfterCall],
      ['올인', a.maxTo],
    ];
    return list.map(([t, v]) => [t, clamp(v)]);
  }

  function renderInfo() {
    const p = me();
    const h = state.hand;
    const cards = p?.cards && p.cards[0] !== 'back' ? p.cards : null;
    if (!cards || !h) {
      info.replaceChildren(el('div', { class: 'mh-label' }, '내 패'), el('div', { class: 'mh-none' }, p?.spectator ? '구경 중이에요' : '아직 받은 카드가 없어요'));
      return;
    }
    const all = [...cards, ...(h.board || [])];
    const cur = currentHand ? currentHand(all) : null;
    // replaceChildren 에 null 을 넘기면 "null" 글자가 들어가므로 걸러 낸다
    info.replaceChildren(
      ...[
        el('div', { class: 'mh-label' }, p.folded ? '내 패 (폴드)' : '내 패'),
        el('div', { class: 'mh-cards' }, cards.map(miniCard)),
        cur ? el('div', { class: `mh-rank r${cur.score[0]}` }, cur.detail) : null,
      ].filter(Boolean),
    );
  }

  function renderMyTurn(a) {
    const h = state.hand;
    const key = `${h.no}-${h.street}-${a.minTo}-${a.maxTo}`;
    if (key !== raiseKey) {
      raiseKey = key;
      raiseTo = a.minTo;
    }
    const clamp = (v) => Math.max(a.minTo, Math.min(a.maxTo, Math.round(Number(v) || 0)));
    const bb = a.bigBlind || 1;

    // 공짜로 체크할 수 있을 때 폴드는 실수일 가능성이 커서 두 번 눌러야 접힌다
    let foldArmed = 0;
    const onFold = () => {
      if (!a.canCheck || Date.now() - foldArmed < 1800) return act('fold');
      foldArmed = Date.now();
      toast('지금은 체크할 수 있어요. 그래도 접으려면 한 번 더 누르세요');
    };
    const fold = el('button', { class: 'act fold', onclick: onFold }, el('b', {}, '폴드'), el('kbd', {}, 'F'));
    const checkCall = a.canCheck
      ? el('button', { class: 'act check', onclick: () => act('check') }, el('b', {}, '체크'), el('kbd', {}, 'C'))
      : el('button', { class: 'act call', onclick: () => act('call') }, el('b', {}, a.toCall >= me().chips ? `올인 ${fmt(a.toCall)}` : `콜 ${fmt(a.toCall)}`), el('kbd', {}, 'C'));

    const parts = [el('div', { class: 'act-row' }, fold, checkCall)];

    if (a.canRaise) {
      const label = a.isBet ? '벳' : '레이즈';
      const go = el('button', { class: 'act raise', onclick: () => act('raise', raiseTo) }, el('b', {}), el('kbd', {}, 'R'));
      const range = el('input', { type: 'range', class: 'raise-range', min: a.minTo, max: a.maxTo, step: 1, value: raiseTo, 'aria-label': `${label} 금액` });
      const num = el('input', { type: 'number', class: 'raise-num', min: a.minTo, max: a.maxTo, step: bb, value: raiseTo, inputmode: 'numeric', 'aria-label': `${label} 금액 입력` });
      const set = (v) => {
        raiseTo = clamp(v);
        range.value = raiseTo;
        num.value = raiseTo;
        const pct = a.maxTo > a.minTo ? ((raiseTo - a.minTo) / (a.maxTo - a.minTo)) * 100 : 100;
        range.style.setProperty('--pct', `${pct}%`);
        go.querySelector('b').textContent = raiseTo >= a.maxTo ? `올인 ${fmt(raiseTo)}` : `${label} ${fmt(raiseTo)}`;
        go.classList.toggle('allin', raiseTo >= a.maxTo);
        presets.forEach(([btn, v2]) => btn.classList.toggle('on', v2 === raiseTo));
      };
      range.addEventListener('input', () => set(range.value));
      num.addEventListener('change', () => set(num.value));
      num.addEventListener('keydown', (e) => e.key === 'Enter' && (set(num.value), act('raise', raiseTo)));
      const minus = el('button', { class: 'step', onclick: () => set(raiseTo - bb), 'aria-label': '빅블라인드만큼 줄이기' }, '−');
      const plus = el('button', { class: 'step', onclick: () => set(raiseTo + bb), 'aria-label': '빅블라인드만큼 늘리기' }, '+');
      const presets = presetValues(a).map(([t, v]) => [el('button', { class: 'preset', onclick: () => set(v) }, t), v]);
      parts[0].append(go);
      parts.push(el('div', { class: 'raise-row' }, el('div', { class: 'presets' }, presets.map(([b]) => b)), el('div', { class: 'slider' }, minus, range, plus, num)));
      set(raiseTo);
    }
    main.replaceChildren(el('div', { class: 'turn-flag' }, '내 차례예요'), ...parts);
    root.classList.add('my-turn');
  }

  function renderWaiting() {
    root.classList.remove('my-turn');
    const p = me();
    const h = state.hand;
    const live = h && h.street !== 'done';
    const nodes = [];

    if (live && p?.inHand && !p.folded && !p.allIn) {
      // 미리 선택
      if (pre && pre.handNo !== h.no) pre = null;
      const toCall = Math.max(0, h.currentBet - (p.bet || 0));
      const callAmt = Math.min(toCall, p.chips);
      if (pre?.type === 'call' && pre.amount !== callAmt) pre = null;
      if (pre?.type === 'check' && toCall > 0) pre = null;
      const opt = (type, text, amount) =>
        el(
          'button',
          {
            class: `pre${pre?.type === type ? ' on' : ''}`,
            'aria-pressed': pre?.type === type ? 'true' : 'false',
            onclick: () => {
              pre = pre?.type === type ? null : { type, amount, handNo: h.no };
              render(state);
            },
          },
          el('i', { class: 'box' }),
          text,
        );
      nodes.push(
        el('div', { class: 'pre-label' }, '미리 선택'),
        el(
          'div',
          { class: 'pre-row' },
          opt('checkfold', toCall > 0 ? '폴드' : '체크/폴드'),
          toCall > 0 ? opt('call', `콜 ${fmt(callAmt)}`, callAmt) : opt('check', '체크'),
          opt('callany', '무조건 콜'),
        ),
      );
      const who = state.players.find((x) => x.id === h.toActId);
      nodes.unshift(el('div', { class: 'wait-text' }, who ? `${who.name}님 차례예요` : '딜러가 카드를 여는 중이에요'));
    } else {
      let text = '';
      if (!h) text = state.hostId === state.me ? '모두 모이면 위의 「게임 시작」을 눌러 주세요' : '방장이 게임을 시작하기를 기다리고 있어요';
      else if (!live) text = state.running ? '잠시 뒤 다음 판이 시작돼요' : state.tourney?.winnerName ? `토너먼트 종료 · 우승 ${state.tourney.winnerName}님` : '게임이 멈춰 있어요';
      else if (p?.spectator) text = '토너먼트를 구경하고 있어요';
      else if (!p?.inHand) text = '이번 판이 끝나면 참여해요';
      else if (p.folded) text = '폴드했어요 · 결과를 기다리는 중';
      else if (p.allIn) text = '올인! 결과를 기다리는 중';
      nodes.push(el('div', { class: 'wait-text' }, text));
      if (state.canRebuy)
        nodes.push(
          el(
            'button',
            {
              class: 'act raise',
              onclick: async () => {
                const r = await send('rebuy');
                if (r.error) toast(r.error, 'error');
              },
            },
            el('b', {}, `칩 ${fmt(state.settings.startChips)}개 다시 받기`),
          ),
        );
    }
    main.replaceChildren(...nodes);
  }

  function maybeAutoAct() {
    const a = state.actions;
    if (!a || !pre) return;
    if (pre.handNo !== state.hand.no) {
      pre = null;
      return;
    }
    const p = pre;
    let type = null;
    if (p.type === 'checkfold') type = a.canCheck ? 'check' : 'fold';
    else if (p.type === 'check') type = a.canCheck ? 'check' : null;
    else if (p.type === 'call') type = a.canCall && a.toCall === p.amount ? 'call' : null;
    else if (p.type === 'callany') type = a.canCheck ? 'check' : 'call';
    pre = null;
    if (!type) {
      toast('상황이 바뀌어 미리 선택을 취소했어요');
      return;
    }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => act(type), 350);
  }

  let infoSig = '';
  let mainSig = '';
  function render(s) {
    state = s;
    const p = me();
    const h = state.hand;
    // 채팅 등으로 상태가 자주 와도, 바뀐 게 없으면 다시 그리지 않는다 (슬라이더 드래그가 끊기지 않게)
    const iSig = JSON.stringify([p?.cards, h?.board, p?.folded, p?.spectator, !!h, !!currentHand]);
    if (iSig !== infoSig) {
      infoSig = iSig;
      renderInfo();
    }
    const live = h && h.street !== 'done';
    const mSig = JSON.stringify([
      state.actions, pre, h?.no, h?.street, h?.toActId, h?.currentBet, p?.bet, p?.chips, p?.folded, p?.allIn, p?.inHand,
      p?.spectator, state.canRebuy, state.running, live, state.hostId === state.me, state.tourney?.winnerName, state.settings?.startChips,
    ]);
    if (mSig === mainSig) return;
    mainSig = mSig;
    if (state.actions) {
      renderMyTurn(state.actions);
      if (pre) maybeAutoAct();
    } else renderWaiting();
  }

  // 단축키
  window.addEventListener('keydown', (e) => {
    if (!state?.actions || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    const a = state.actions;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      if (a.canCheck) toast('지금은 체크할 수 있어요 (C)');
      else act('fold');
    } else if (k === 'c') act(a.canCheck ? 'check' : 'call');
    else if (k === 'r' && a.canRaise) act('raise', raiseTo);
    else if (k === 'a' && a.canRaise) {
      if (Date.now() - allinArmedAt < 1500) act('allin');
      else {
        allinArmedAt = Date.now();
        toast('올인하려면 A를 한 번 더 누르세요');
        play('pop');
      }
    } else if ((k === 'arrowup' || k === 'arrowdown') && a.canRaise) {
      const range = root.querySelector('.raise-range');
      if (!range) return;
      e.preventDefault();
      const bb = a.bigBlind || 1;
      range.value = Number(range.value) + (k === 'arrowup' ? bb : -bb);
      range.dispatchEvent(new Event('input'));
    } else return;
    e.preventDefault();
  });

  return { render };
}
