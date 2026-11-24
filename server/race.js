import { randomBytes, randomInt } from 'node:crypto';

/*
 * 사내 경마 (가상 칩). 한국 경마의 마권·배당 규칙을 따른다.
 *  - 마권: 단승·연승·복승·쌍승·복연승·삼복승·삼쌍승
 *  - 배당: 파리뮤추얼(승식별 매출 × 환급률 ÷ 적중 마권 금액). 사람이 적어도 배당이 성립하도록
 *          NPC 기본 매출(모의 경주 확률에 비례)을 깔아 둔다. 최저 배당 1.0배.
 *  - 연승식: 출전 8두 이상 3착까지, 7두 이하 2착까지. 복연승식은 1~3착 중 2마리.
 *  - 출전 취소된 말이 들어간 마권은 환불.
 */

export const RACE_DEFAULTS = {
  maxPlayers: 20,
  startChips: 1000,
  bettingSec: 60, // 발매 시간 (출주표를 볼 수 있게 1분)
  resultMs: 12_000,
  minBet: 10, // 최소 구매 (실제 100원에 해당)
  takeout: 0.8, // 환급률 80%
  houseSeed: 30_000, // 승식별 NPC 기본 매출
  simRuns: 3000,
  scratchChance: 0.06, // 발주 직전 출전 취소 확률
  playbackMs: 22_000, // 화면에서 경주가 재생되는 대략적인 길이
  frameSec: 0.4, // 위치 기록 간격 (경주 시간 기준)
};

export const BET_TYPES = {
  win: { label: '단승식', size: 1, ordered: false, desc: '1착 말 맞히기' },
  place: { label: '연승식', size: 1, ordered: false, desc: '3착 안에 들 말 (7두 이하는 2착)' },
  quinella: { label: '복승식', size: 2, ordered: false, desc: '1·2착 두 마리 (순서 무관)' },
  exacta: { label: '쌍승식', size: 2, ordered: true, desc: '1착·2착 순서대로' },
  quinellaPlace: { label: '복연승식', size: 2, ordered: false, desc: '3착 안에 드는 두 마리 (순서 무관)' },
  trio: { label: '삼복승식', size: 3, ordered: false, desc: '1~3착 세 마리 (순서 무관)' },
  trifecta: { label: '삼쌍승식', size: 3, ordered: true, desc: '1·2·3착 순서대로' },
};

const NAME_POOL = [
  '칼퇴본능', '월급루팡', '커피수혈', '야근전사', '주말만세', '회식요정', '연차대기', '보고서킬러', '점심메뉴왕',
  '출근길마스터', '금요일밤', '월요병', '성과급', '재택근무', '탕비실습격', '번개결재', '마감요정', '회의실점령',
  '퇴근시계', '노트북전사', '슬리퍼질주', '사원증', '포스트잇', '정시퇴근', '법인카드', '워크숍', '사내식당',
];
/** 기수 캐릭터: 이름·주행 스타일·한 줄 소개·생김새(헬멧 무늬, 피부, 소품) */
export const JOCKEYS = [
  { name: '김질주', style: '선행형', intro: '출발 신호와 동시에 튀어 나가는 스피드광. 별명은 "게이트 탈출 장인".', look: { pattern: 'stripe', skin: '#f3c9a0', acc: 'none', hair: '#2a1c14' } },
  { name: '박채찍', style: '추입형', intro: '마지막 200m에서 눈빛이 바뀐다. 채찍 한 번에 순위가 바뀌는 남자.', look: { pattern: 'star', skin: '#e9b48a', acc: 'mustache', hair: '#1b1b1b' } },
  { name: '이바람', style: '자유형', intro: '바람 따라 달린다는 낭만파. 비 오는 날 유독 강하다.', look: { pattern: 'dots', skin: '#f6d2b4', acc: 'blush', hair: '#6b3f22' } },
  { name: '최선두', style: '선행형', intro: '이름값 하는 기수. 앞에 아무도 없어야 마음이 편하다.', look: { pattern: 'hoop', skin: '#f0c49c', acc: 'glasses', hair: '#2b2b2b' } },
  { name: '정추입', style: '추입형', intro: '뒤에서 조용히 기회를 엿보는 침착한 사냥꾼.', look: { pattern: 'cross', skin: '#e3a97c', acc: 'none', hair: '#1d140f' } },
  { name: '강막판', style: '추입형', intro: '"끝날 때까지 끝난 게 아니다"가 좌우명. 역전승 전문.', look: { pattern: 'stripe', skin: '#f2c8a4', acc: 'band', hair: '#3b2a20' } },
  { name: '윤직선', style: '선입형', intro: '코너보다 직선이 좋다. 직선 주로에서 속도가 한 단계 오른다.', look: { pattern: 'diamond', skin: '#f6d2b4', acc: 'none', hair: '#8a5a2b' } },
  { name: '한코너', style: '선입형', intro: '안쪽 코너를 파고드는 기술은 경마장 최고. 별명 "인코스의 마법사".', look: { pattern: 'half', skin: '#e9b993', acc: 'glasses', hair: '#2a1c14' } },
  { name: '조스퍼트', style: '추입형', intro: '평소엔 느긋하지만 스퍼트를 걸면 아무도 못 말린다.', look: { pattern: 'dots', skin: '#d9a27a', acc: 'mustache', hair: '#111' } },
  { name: '임결승', style: '선입형', intro: '결승선 사진 판정 승률 1위. 코 하나 차이에 강하다.', look: { pattern: 'hoop', skin: '#f3c9a0', acc: 'blush', hair: '#4a3020' } },
  { name: '서발주', style: '선행형', intro: '신인왕 출신 루키. 겁 없는 질주가 매력이자 약점.', look: { pattern: 'star', skin: '#f6d8bd', acc: 'band', hair: '#c98d4b' } },
  { name: '문역전', style: '자유형', intro: '꼴찌에서 1등까지, 드라마를 쓰는 기수. 팬클럽이 가장 많다.', look: { pattern: 'cross', skin: '#e6b08a', acc: 'none', hair: '#1b1b1b' } },
];

/** 능력치로 말 별명과 소개 만들기 */
function profileOf(h) {
  const traits = [
    [h.speed > 17.0, '번개 다리', '타고난 스피드가 출전마 중 손꼽힌다'],
    [h.kick > 0.75, '막판의 사나이', '직선 주로에서 무섭게 치고 올라온다'],
    [h.stamina > 0.85, '지치지 않는 심장', '긴 거리에서도 속도가 잘 떨어지지 않는다'],
    [h.breakAbility > 0.8, '게이트 로켓', '출발이 빨라 초반 자리를 잘 잡는다'],
    [h.mud > 0.8, '진흙탕의 제왕', '비 온 뒤 무른 주로를 좋아한다'],
    [h.steady > 0.85, '꾸준함의 아이콘', '컨디션 기복이 적어 믿을 만하다'],
    [h.steady < 0.55, '변덕쟁이', '컨디션에 따라 결과가 크게 달라진다'],
    [h.stamina < 0.65, '단거리 전문', '짧은 거리에서 진가를 발휘한다'],
  ].filter(([ok]) => ok);
  if (!traits.length) traits.push([true, '다크호스', '아직 보여 준 게 많지 않은 숨은 실력자']);
  const [, nick, desc] = traits[randomInt(traits.length)];
  return { nickname: nick, intro: `${desc}.` };
}
// 번호별 모자 색 (1~12)
const COLORS = ['#f4f1e8', '#2b2d33', '#d23a3a', '#2f6fd6', '#f2c230', '#2fa266', '#ef7d2b', '#e26aa8', '#8c5bd6', '#5fc4d9', '#8a6a3c', '#9aa3ad'];
const TRACKS = [
  { key: 'dry', label: '건조', mod: 1.0 },
  { key: 'good', label: '양호', mod: 0.995 },
  { key: 'wet', label: '다습', mod: 0.985 },
  { key: 'heavy', label: '불량', mod: 0.97 },
];
const DISTANCES = [1000, 1200, 1300, 1400, 1600, 1800];

const newId = () => randomBytes(6).toString('hex');
const crand = () => randomInt(0, 1_000_000_000) / 1_000_000_000;
const gauss = (r) => {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr) => arr[randomInt(arr.length)];

/** 경주 조건과 출주마 만들기 */
export function makeCard() {
  const field = 8 + randomInt(5); // 8~12두
  const distance = pick(DISTANCES);
  const track = TRACKS[Math.min(3, Math.floor(crand() * crand() * 4.6))]; // 건조·양호가 흔하게
  const names = [...NAME_POOL];
  const jockeys = [...JOCKEYS];
  const horses = [];
  for (let i = 0; i < field; i++) {
    const weight = 52 + randomInt(7); // 부담중량 52~58kg
    const body = 440 + randomInt(80); // 마체중
    const delta = randomInt(-12, 13); // 체중 증감
    horses.push({
      no: i + 1,
      name: names.splice(randomInt(names.length), 1)[0],
      jockeyProfile: jockeys.splice(randomInt(jockeys.length), 1)[0],
      color: COLORS[i],
      age: 3 + randomInt(4),
      sex: pick(['수', '암', '거']),
      weight,
      body,
      delta,
      speed: 16.7 + crand() * 0.45, // m/s (실제 경주처럼 능력 차이는 작게)
      stamina: 0.6 + crand() * 0.35, // 지구력: 이 비율 이후 지침
      kick: crand(), // 막판 스퍼트
      steady: 0.45 + crand() * 0.55, // 안정성
      breakAbility: crand(), // 출발
      mud: crand(), // 무른 주로 적성
      recent: Array.from({ length: 3 }, () => 1 + randomInt(field)), // 최근 3전 착순(참고용)
      scratched: false,
    });
  }
  for (const h of horses) {
    h.jockey = h.jockeyProfile.name;
    Object.assign(h, profileOf(h));
    // 기수 통산 성적 (참고용)
    const rides = 120 + randomInt(600);
    h.jockeyRecord = { rides, wins: Math.round(rides * (0.06 + crand() * 0.14)) };
  }
  return { field, distance, track, horses };
}

/**
 * 경주 중 돌발 이벤트. 확률은 말 한 마리가 한 경주에서 겪을 확률.
 *  mul: 속도 배율, dur: 지속 시간(경주 초)
 */
export const EVENTS = {
  boost: { chance: 0.16, dur: [2.2, 3.2], mul: 1.2, kinds: ['커피 부스트', '로켓 부스트', '방귀 부스트'] },
  fall: { chance: 0.045, dur: [1.4, 2.0], mul: 0.15, kinds: ['바나나 껍질', '발 헛디딤'] },
  bump: { chance: 0.09, dur: [1.0, 1.4], mul: 0.82, kinds: ['충돌'] },
  sleep: { chance: 0.04, dur: [1.6, 2.4], mul: 0.55, kinds: ['졸음'] },
  reverse: { chance: 0.018, dur: [0.9, 1.2], mul: -0.25, kinds: ['역주행'] },
};

/**
 * 경주 시뮬레이션 (실제 거리·m/s). record 면 화면용 위치 기록과 이벤트를 남긴다.
 */
export function simulate(card, r, record = false, frameSec = 0.4, step = 0.1) {
  const L = card.distance;
  const dt = step;
  const hs = card.horses.filter((h) => !h.scratched);
  const n = hs.length;
  const pos = new Array(n).fill(0);
  const fin = new Array(n).fill(null);
  const trackMud = card.track.key === 'wet' || card.track.key === 'heavy';
  const day = hs.map((h) => 1 + gauss(r) * 0.016 * (1.5 - h.steady)); // 그날 컨디션
  // 경주 중 돌발 이벤트 예약: 말마다 종류별로 확률에 따라 (거리 비율 지점에서 발생)
  const planned = []; // { i, type, at, dur, mul, kind }
  hs.forEach((h, i) => {
    for (const [type, e] of Object.entries(EVENTS)) {
      if (r() >= e.chance) continue;
      const at = type === 'boost' ? 0.3 + r() * 0.6 : 0.12 + r() * 0.76;
      planned.push({ i, type, at, dur: e.dur[0] + r() * (e.dur[1] - e.dur[0]), mul: e.mul, kind: e.kinds[Math.floor(r() * e.kinds.length)] });
    }
  });
  const active = hs.map(() => []); // 지금 걸려 있는 효과 { until, mul }
  const events = []; // 기록용 { t, no, type, kind, dur, partner }
  const frames = record ? [{ t: 0, p: pos.map(() => 0) }] : null;
  let t = 0;
  let next = frameSec;
  let done = 0;
  // 거리가 길수록 지구력 영향이 커진다
  const stamFactor = 0.05 + (L - 1000) / 9000;
  while (done < n && t < 300) {
    t += dt;
    for (let i = 0; i < n; i++) {
      if (fin[i] != null) continue;
      const h = hs[i];
      const p = pos[i] / L;
      let v = h.speed * day[i] * card.track.mod;
      v *= 1 - (h.weight - 55) * 0.0022; // 부담중량
      v *= 1 - Math.abs(h.delta) * 0.0003; // 급격한 체중 변화
      if (trackMud) v *= 1 + (h.mud - 0.5) * (card.track.key === 'heavy' ? 0.02 : 0.01);
      if (t < 2.5) v *= 0.45 + 0.4 * (t / 2.5) + h.breakAbility * 0.1; // 출발
      if (p > h.stamina) v *= 1 - (p - h.stamina) * stamFactor; // 지침
      if (p > 0.75) v *= 1 + h.kick * 0.03 * ((p - 0.75) / 0.25); // 막판 스퍼트
      v *= 1 + gauss(r) * 0.03 * (1.4 - h.steady); // 걸음마다 흔들림
      // 예약된 이벤트가 시작되는지 확인
      for (const ev of planned) {
        if (ev.i !== i || ev.started || p < ev.at) continue;
        ev.started = true;
        active[i].push({ until: t + ev.dur, mul: ev.mul });
        let partner = null;
        if (ev.type === 'bump') {
          // 가장 가까이 붙어 달리는 말과 부딪힌다 (3m 안에 없으면 혼자 비틀)
          let best = -1;
          for (let j = 0; j < n; j++) if (j !== i && fin[j] == null && Math.abs(pos[j] - pos[i]) < 3 && (best < 0 || Math.abs(pos[j] - pos[i]) < Math.abs(pos[best] - pos[i]))) best = j;
          if (best >= 0) {
            active[best].push({ until: t + ev.dur, mul: ev.mul });
            partner = hs[best].no;
          }
        }
        if (record) events.push({ t: Math.round(t * 100) / 100, no: h.no, type: ev.type, kind: ev.kind, dur: ev.dur, partner });
      }
      let mul = 1;
      active[i] = active[i].filter((a) => a.until > t);
      for (const a of active[i]) mul = a.mul < 0 ? a.mul : mul * a.mul;
      const moving = mul < 0 ? v * mul : Math.max(1, v * mul); // 역주행은 뒤로
      const np = Math.max(0, pos[i] + moving * dt);
      if (np >= L) {
        fin[i] = t - dt + ((L - pos[i]) / (np - pos[i])) * dt;
        pos[i] = L;
        done++;
      } else pos[i] = np;
    }
    if (record && t >= next - 1e-9) {
      frames.push({ t: Math.round(t * 100) / 100, p: pos.map((x) => Math.round(x * 10) / 10) });
      next += frameSec;
    }
  }
  if (record) frames.push({ t: Math.round(t * 100) / 100, p: pos.map((x) => Math.round(x * 10) / 10) });
  const order = hs.map((h, i) => ({ no: h.no, time: fin[i] ?? 999 })).sort((a, b) => a.time - b.time);
  return { order, frames, nos: hs.map((h) => h.no), events: record ? events : [] };
}

/** 승식별 적중 조합 (출전한 말만) */
export function winningCombos(type, order, field) {
  const o = order.map((x) => x.no);
  const key = (arr, ordered) => (ordered ? arr : [...arr].sort((a, b) => a - b)).join('-');
  const placeN = field >= 8 ? 3 : 2;
  switch (type) {
    case 'win':
      return [key([o[0]])];
    case 'place':
      return o.slice(0, placeN).map((n) => key([n]));
    case 'quinella':
      return [key([o[0], o[1]])];
    case 'exacta':
      return [key([o[0], o[1]], true)];
    case 'quinellaPlace':
      return [key([o[0], o[1]]), key([o[0], o[2]]), key([o[1], o[2]])];
    case 'trio':
      return [key([o[0], o[1], o[2]])];
    case 'trifecta':
      return [key([o[0], o[1], o[2]], true)];
    default:
      return [];
  }
}

const comboKey = (type, horses) => (BET_TYPES[type].ordered ? horses : [...horses].sort((a, b) => a - b)).join('-');

/** 모의 경주로 조합별 확률을 구한다 (NPC 기본 매출 배분용) */
function probabilities(card, runs) {
  const r = mulberry32(randomInt(0, 2 ** 31));
  const counts = Object.fromEntries(Object.keys(BET_TYPES).map((t) => [t, new Map()]));
  const field = card.horses.filter((h) => !h.scratched).length;
  for (let k = 0; k < runs; k++) {
    const { order } = simulate(card, r, false, 0.4, 0.25); // 배당 계산용은 거친 간격으로 빠르게
    for (const t of Object.keys(BET_TYPES))
      for (const c of winningCombos(t, order, field)) counts[t].set(c, (counts[t].get(c) || 0) + 1);
  }
  // 확률 (복수 적중 승식은 적중 조합 수로 나눠 '한 몫' 기준)
  const share = { place: field >= 8 ? 3 : 2, quinellaPlace: 3 };
  const prob = {};
  for (const t of Object.keys(BET_TYPES)) {
    prob[t] = new Map();
    for (const [c, n] of counts[t]) prob[t].set(c, n / runs / (share[t] || 1));
  }
  return prob;
}

/** 조합 목록 (말 번호들) */
function allCombos(type, nos) {
  const { size, ordered } = BET_TYPES[type];
  const out = [];
  const rec = (start, cur, used) => {
    if (cur.length === size) {
      out.push(cur.join('-'));
      return;
    }
    for (let i = ordered ? 0 : start; i < nos.length; i++) {
      if (used.has(nos[i])) continue;
      used.add(nos[i]);
      rec(i + 1, [...cur, nos[i]], used);
      used.delete(nos[i]);
    }
  };
  rec(0, [], new Set());
  return out;
}

const MARGINS = [
  [0.05, '코'], [0.1, '머리'], [0.2, '목'], [0.5, '½마신'], [0.75, '¾마신'], [1.25, '1마신'], [1.75, '1½마신'],
  [2.5, '2마신'], [3.5, '3마신'], [5, '4마신'], [7, '6마신'], [10, '8마신'],
];
/** 앞 말과의 시간 차 → 착차 (1마신 ≈ 2.4m) */
function margin(dtSec, speed) {
  const lengths = (dtSec * speed) / 2.4;
  for (const [lim, label] of MARGINS) if (lengths < lim) return label;
  return '대차';
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** 위치 기록으로 실황 멘트 (경주 시간 기준 초) */
function commentary(card, sim) {
  const { frames, nos, order } = sim;
  const L = card.distance;
  const nm = (i) => {
    const h = card.horses.find((x) => x.no === nos[i]);
    return `${h.no}번 ${h.name}`;
  };
  const lines = [{ t: 0, text: `출발! ${nos.length}두 일제히 게이트를 박차고 나갑니다!` }];
  let lastLeader = -1;
  let lastT = 0;
  const marks = [
    [0.12, (i) => `초반 자리싸움, ${nm(i)}가 앞으로 나섭니다!`],
    [0.45, (i) => `중간 지점, 선두는 여전히 ${nm(i)}!`],
    [0.72, (i) => `4코너를 돌아 직선 주로! ${nm(i)} 선두, 뒤에서 거세게 추격합니다!`],
    [0.9, (i) => `결승선 200미터 전! ${nm(i)}가 버텨낼 수 있을까요!`],
  ];
  let mk = 0;
  for (const f of frames.slice(1)) {
    let leader = 0;
    for (let i = 1; i < f.p.length; i++) if (f.p[i] > f.p[leader]) leader = i;
    const lp = f.p[leader] / L;
    if (mk < marks.length && lp >= marks[mk][0]) {
      lines.push({ t: f.t, text: marks[mk][1](leader) });
      lastT = f.t;
      mk++;
    } else if (lastLeader !== -1 && leader !== lastLeader && f.t - lastT > 5 && lp > 0.15 && lp < 0.97) {
      lines.push({ t: f.t, text: `${nm(leader)}, 선두로 치고 나옵니다!` });
      lastT = f.t;
    }
    lastLeader = leader;
  }
  for (const e of sim.events) {
    const h = card.horses.find((x) => x.no === e.no);
    const who = `${h.no}번 ${h.name}`;
    const text = {
      boost: { '커피 부스트': `☕ ${who}, 커피 원샷! 부스트 온!!`, '로켓 부스트': `🚀 ${who}, 로켓 부스트 점화!!`, '방귀 부스트': `💨 ${who}… 방, 방귀 부스트?! 엄청난 가속입니다!` }[e.kind],
      fall: e.kind === '바나나 껍질' ? `🍌 앗! ${who}, 바나나 껍질을 밟고 넘어졌습니다!` : `💥 ${who}, 발을 헛디뎌 넘어집니다! 다시 일어나요!`,
      bump: e.partner ? `💢 쿵! ${who}와 ${e.partner}번이 부딪혔습니다!` : `💢 ${who}, 펜스에 부딪혀 휘청!`,
      sleep: `😴 ${who}… 지금 졸고 있는 건가요?!`,
      reverse: `🔄 ${who} 역주행?! 정신 차려!!`,
    }[e.type];
    if (text) lines.push({ t: e.t, text, event: true });
  }
  lines.sort((a, b) => a.t - b.t);
  const w = card.horses.find((h) => h.no === order[0].no);
  const gap = order[1].time - order[0].time;
  lines.push({ t: order[0].time, text: gap < 0.06 ? `사진 판정! … ${w.no}번 ${w.name}, 코 차이로 1착입니다!` : `골인! 1착은 ${w.no}번 ${w.name}! 기수 ${w.jockey}!` });
  return lines.sort((a, b) => a.t - b.t);
}

/**
 * 경마장 방 하나. 진행(NPC 캐스터·발주·정산)은 이 클래스가 맡는다.
 * 경주 결과는 베팅 마감 순간에 처음 정해지고, 위치 기록은 그 뒤에만 보낸다.
 */
export class RaceRoom {
  constructor(code, { onChange = () => {}, schedule, now = () => Date.now(), options = {} } = {}) {
    this.code = code;
    this.opt = { ...RACE_DEFAULTS, ...options };
    this.onChange = onChange;
    this.now = now;
    this.schedule =
      schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.players = [];
    this.departed = new Map();
    this.hostId = null;
    this.running = false;
    this.phase = 'idle'; // idle → betting → racing → result → betting …
    this.phaseEndsAt = 0;
    this.round = 0;
    this.card = null;
    this.house = null; // 승식별 NPC 기본 매출 Map(조합 → 금액)
    this.bets = []; // { id, pid, type, horses, key, amount }
    this.race = null;
    this.results = null;
    this.history = [];
    this.chat = [];
    this.lastChatAt = new Map();
    this.seq = 0;
    this.caster = '어서 오세요! 방장이 시작하면 첫 경주 발매가 열립니다.';
    this.timer = null;
    this.lastActive = this.now();
  }

  // ───────── 공통 ─────────
  changed() {
    this.lastActive = this.now();
    this.onChange(this);
  }
  player(id) {
    return this.players.find((p) => p.id === id);
  }
  later(ms, fn) {
    this.timer?.();
    this.timer = this.schedule(() => {
      this.timer = null;
      fn();
      this.changed();
    }, ms);
  }
  clearTimer() {
    this.timer?.();
    this.timer = null;
  }
  hostConnected() {
    const h = this.player(this.hostId);
    return !!h && h.connected && !h.leaving;
  }
/** 끊긴 사람은 잠깐(새로고침 등) 기다렸다가 돌아오지 않으면 자리에서 뺀다 */
  scheduleDrop(p) {
    this.dropTimers ??= new Map();
    this.dropTimers.get(p.id)?.();
    const id = p.id;
    this.dropTimers.set(
      id,
      this.schedule(() => {
        this.dropTimers.delete(id);
        const x = this.player(id);
        if (x && !x.connected) {
          this.leave(id);
          this.changed();
        }
      }, this.opt.dropMs ?? 20_000),
    );
  }
  cancelDrop(p) {
    this.dropTimers?.get(p.id)?.();
    this.dropTimers?.delete(p.id);
  }

  pickHost() {
    const next = this.players.find((p) => p.connected && !p.leaving);
    this.hostId = next?.id ?? null;
  }
  say(text) {
    this.caster = text;
  }

  // ───────── 입장·퇴장 ─────────
  join({ token, name, socketId }) {
    let p = this.players.find((x) => x.token === token);
    if (p) {
      this.cancelDrop(p);
      p.socketId = socketId;
      p.connected = true;
      p.leaving = false;
      if (!this.hostConnected()) this.hostId = p.id;
      this.changed();
      return { player: p };
    }
    if (this.players.length >= this.opt.maxPlayers) {
      const idle = this.players.find((x) => !x.connected && !this.bets.some((b) => b.pid === x.id));
      if (idle) this.removePlayer(idle.id);
    }
    if (this.players.length >= this.opt.maxPlayers) return { error: `방이 가득 찼어요 (최대 ${this.opt.maxPlayers}명)` };
    const back = this.departed.get(token);
    this.departed.delete(token);
    const base = (name || '').trim().slice(0, 12) || `손님${this.players.length + 1}`;
    let finalName = base;
    for (let i = 2; this.players.some((x) => x.name === finalName); i++) finalName = `${base}${i}`;
    p = {
      id: newId(),
      token,
      name: finalName,
      chips: back?.chips ?? this.opt.startChips,
      bought: back?.bought ?? this.opt.startChips,
      rebuys: back?.rebuys ?? 0,
      stats: back?.stats ?? { tickets: 0, hits: 0, bestPayout: 0, totalBet: 0, totalWon: 0 },
      connected: true,
      leaving: false,
      socketId,
    };
    this.players.push(p);
    if (!this.hostConnected()) this.hostId = p.id;
    this.changed();
    return { player: p };
  }

  disconnect(socketId) {
    const p = this.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    if (this.hostId === p.id) this.pickHost();
    this.scheduleDrop(p);
    this.changed();
  }

  leave(playerId) {
    const p = this.player(playerId);
    if (!p) return;
    if (this.phase === 'betting') this.refundAll(playerId);
    if (this.phase === 'racing' && this.bets.some((b) => b.pid === playerId)) {
      // 이미 산 마권은 경주가 끝나면 정산해서 보관
      p.connected = false;
      p.leaving = true;
    } else this.removePlayer(playerId);
    if (this.hostId === playerId) this.pickHost();
    this.changed();
  }

  removePlayer(id) {
    const p = this.player(id);
    if (p) this.departed.set(p.token, { chips: p.chips, bought: p.bought, rebuys: p.rebuys, stats: p.stats });
    this.lastChatAt.delete(id);
    this.players = this.players.filter((x) => x.id !== id);
  }

  rebuy(playerId) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (p.chips >= this.opt.minBet || this.bets.some((b) => b.pid === playerId)) return { error: '칩이 남아 있거나 산 마권이 있을 때는 받을 수 없어요' };
    p.chips += this.opt.startChips;
    p.bought += this.opt.startChips;
    p.rebuys++;
    this.changed();
    return {};
  }

  sendChat(playerId, text) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    const clean = typeof text === 'string' ? Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 100).join('') : '';
    if (!clean) return { error: '메시지가 비어 있어요' };
    const now = this.now();
    if (now - (this.lastChatAt.get(playerId) ?? -Infinity) < 600) return { error: '조금 천천히 보내 주세요' };
    this.lastChatAt.set(playerId, now);
    this.chat.push({ id: ++this.seq, pid: p.id, name: p.name, text: clean, at: now });
    if (this.chat.length > 50) this.chat.shift();
    this.changed();
    return {};
  }

  // ───────── 진행 ─────────
  start(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 시작할 수 있어요' };
    this.running = true;
    if (this.phase === 'idle') this.openBetting();
    this.changed();
    return {};
  }

  pause(playerId) {
    if (playerId !== this.hostId) return { error: '방장만 멈출 수 있어요' };
    this.running = false;
    this.say(this.phase === 'idle' ? '경마장을 잠시 쉽니다.' : '이번 경주까지만 하고 쉴게요.');
    this.changed();
    return {};
  }

  setBettingSec(playerId, sec) {
    if (playerId !== this.hostId) return { error: '방장만 바꿀 수 있어요' };
    const v = Math.round(Number(sec));
    if (!Number.isFinite(v) || v < 15 || v > 180) return { error: '발매 시간은 15~180초예요' };
    this.opt.bettingSec = v;
    this.changed();
    return {};
  }

  openBetting() {
    this.round++;
    this.card = makeCard();
    const prob = probabilities(this.card, this.opt.simRuns);
    // NPC 기본 매출: 승식별 houseSeed 를 조합 확률에 비례해 배분 (확률 0 조합에도 아주 조금)
    const nos = this.card.horses.map((h) => h.no);
    this.house = {};
    for (const t of Object.keys(BET_TYPES)) {
      const combos = allCombos(t, nos);
      const m = new Map();
      const floor = 0.15 / combos.length;
      let total = 0;
      for (const c of combos) {
        const w = (prob[t].get(c) || 0) + floor;
        m.set(c, w);
        total += w;
      }
      for (const c of combos) m.set(c, (m.get(c) / total) * this.opt.houseSeed);
      this.house[t] = m;
    }
    this.bets = [];
    this.race = null;
    this.results = null;
    this.phase = 'betting';
    this.phaseEndsAt = this.now() + this.opt.bettingSec * 1000;
    const fav = this.favorite();
    this.say(
      `제${this.round}경주 ${this.card.distance}m, 주로 상태 ${this.card.track.label}. 출전 ${this.card.field}두, 마권 발매를 시작합니다! 1번 인기는 ${fav.no}번 ${fav.name}.`,
    );
    this.later(this.opt.bettingSec * 1000, () => this.startRace());
  }

  favorite() {
    const odds = this.liveOdds('win');
    return this.card.horses.filter((h) => !h.scratched).sort((a, b) => (odds[a.no] ?? 999) - (odds[b.no] ?? 999))[0];
  }

  /** 승식별 매출 (조합 → 금액): NPC 기본 매출 + 플레이어 마권 */
  pool(type) {
    const m = new Map(this.house[type]);
    for (const b of this.bets) if (b.type === type) m.set(b.key, (m.get(b.key) || 0) + b.amount);
    return m;
  }

  /** 지금 시점 배당 (조합 → 배당률). 단승·연승은 말 번호 키 */
  liveOdds(type) {
    const pool = this.pool(type);
    let total = 0;
    for (const v of pool.values()) total += v;
    const net = total * this.opt.takeout;
    const share = type === 'place' ? (this.card.field >= 8 ? 3 : 2) : type === 'quinellaPlace' ? 3 : 1;
    const out = {};
    for (const [c, amt] of pool) out[c] = Math.min(9999.9, Math.max(1, Math.floor((net / share / amt) * 10) / 10));
    return out;
  }

  placeBet(playerId, { type, horses, amount }) {
    const p = this.player(playerId);
    if (!p) return { error: '플레이어를 찾을 수 없어요' };
    if (this.phase !== 'betting') return { error: '지금은 마권 발매 시간이 아니에요' };
    const bt = BET_TYPES[type];
    if (!bt) return { error: '알 수 없는 승식이에요' };
    if (!Array.isArray(horses) || horses.length !== bt.size) return { error: `${bt.label}은 말 ${bt.size}마리를 골라야 해요` };
    const nos = horses.map(Number);
    if (new Set(nos).size !== nos.length) return { error: '같은 말을 두 번 고를 수 없어요' };
    if (nos.some((n) => !Number.isInteger(n) || !this.card.horses.some((h) => h.no === n))) return { error: '말 번호가 올바르지 않아요' };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < this.opt.minBet) return { error: `최소 ${this.opt.minBet}칩부터 살 수 있어요` };
    if (amt % this.opt.minBet !== 0) return { error: `${this.opt.minBet}칩 단위로 살 수 있어요` };
    if (amt > p.chips) return { error: '칩이 모자라요' };
    const key = comboKey(type, nos);
    p.chips -= amt;
    const same = this.bets.find((b) => b.pid === playerId && b.type === type && b.key === key);
    if (same) same.amount += amt;
    else this.bets.push({ id: ++this.seq, pid: playerId, type, horses: BET_TYPES[type].ordered ? nos : [...nos].sort((a, b) => a - b), key, amount: amt });
    this.changed();
    return {};
  }

  cancelBet(playerId, betId) {
    if (this.phase !== 'betting') return { error: '발매가 마감돼서 취소할 수 없어요' };
    const b = this.bets.find((x) => x.id === Number(betId) && x.pid === playerId);
    if (!b) return { error: '그런 마권이 없어요' };
    this.player(playerId).chips += b.amount;
    this.bets = this.bets.filter((x) => x !== b);
    this.changed();
    return {};
  }

  refundAll(playerId) {
    const p = this.player(playerId);
    for (const b of this.bets.filter((x) => x.pid === playerId)) p.chips += b.amount;
    this.bets = this.bets.filter((x) => x.pid !== playerId);
  }

  startRace() {
    // 발주 직전 출전 취소: 그 말이 들어간 마권은 환불하고 매출에서도 뺀다
    const scratched = [];
    if (crand() < this.opt.scratchChance) {
      const h = pick(this.card.horses);
      h.scratched = true;
      scratched.push(h.no);
    }
    const refunds = {};
    if (scratched.length) {
      for (const b of [...this.bets])
        if (b.horses.some((n) => scratched.includes(n))) {
          this.player(b.pid).chips += b.amount;
          refunds[b.pid] = (refunds[b.pid] || 0) + b.amount;
          this.bets = this.bets.filter((x) => x !== b);
        }
      for (const t of Object.keys(BET_TYPES))
        for (const c of [...this.house[t].keys()]) if (c.split('-').map(Number).some((n) => scratched.includes(n))) this.house[t].delete(c);
    }
    // 결과는 여기서 처음 정해진다 (베팅 마감 이후, 암호학적 난수)
    const sim = simulate(this.card, crand, true, this.opt.frameSec);
    const lines = commentary(this.card, sim);
    const raceSec = sim.order[sim.order.length - 1].time;
    const speedup = Math.max(1, raceSec / (this.opt.playbackMs / 1000));
    // 확정 배당 (마감 시점)
    const finalOdds = Object.fromEntries(Object.keys(BET_TYPES).map((t) => [t, this.liveOdds(t)]));
    this.race = { startAt: this.now() + 3500, speedup, sim, lines, finalOdds, scratched, refunds };
    this.phase = 'racing';
    const playMs = 3500 + (raceSec / speedup) * 1000 + 1500;
    this.phaseEndsAt = this.now() + playMs;
    const total = this.bets.reduce((a, b) => a + b.amount, 0);
    const sc = scratched.length ? ` ${scratched[0]}번 말이 출전 취소되어 관련 마권은 환불됩니다.` : '';
    this.say(`발매 마감! 총 ${total.toLocaleString('ko-KR')}칩.${sc} 각 마필 게이트에 들어갑니다…`);
    this.later(playMs, () => this.settle());
  }

  settle() {
    const { sim, finalOdds } = this.race;
    const order = sim.order;
    const field = order.length;
    const payouts = {};
    const hits = [];
    for (const b of this.bets) {
      const p = this.player(b.pid);
      if (!p) continue;
      p.stats.tickets++;
      p.stats.totalBet += b.amount;
      if (winningCombos(b.type, order, field).includes(b.key)) {
        const odds = finalOdds[b.type][b.key] ?? 1;
        const pay = Math.floor(b.amount * odds);
        p.chips += pay;
        p.stats.hits++;
        p.stats.totalWon += pay;
        p.stats.bestPayout = Math.max(p.stats.bestPayout, pay);
        payouts[b.pid] = (payouts[b.pid] || 0) + pay;
        hits.push({ pid: b.pid, name: p.name, type: b.type, horses: b.horses, amount: b.amount, pay, odds });
      }
    }
    // 착순표
    const horse = (no) => this.card.horses.find((h) => h.no === no);
    const board = order.map((o, i) => ({
      rank: i + 1,
      no: o.no,
      name: horse(o.no).name,
      jockey: horse(o.no).jockey,
      color: horse(o.no).color,
      time: fmtTime(o.time),
      margin: i === 0 ? '' : margin(o.time - order[i - 1].time, horse(o.no).speed),
      winOdds: finalOdds.win[String(o.no)] ?? null,
    }));
    // 승식별 확정 배당 (적중 조합)
    const paid = {};
    for (const t of Object.keys(BET_TYPES)) paid[t] = winningCombos(t, order, field).map((c) => ({ combo: c, odds: finalOdds[t][c] ?? null }));
    this.results = { board, paid, payouts, hits: hits.sort((a, b) => b.pay - a.pay), scratched: this.race.scratched };
    this.history.unshift({
      round: this.round,
      distance: this.card.distance,
      track: this.card.track.label,
      top3: board.slice(0, 3).map(({ no, name, color }) => ({ no, name, color })),
      winOdds: board[0].winOdds,
      trifecta: paid.trifecta[0]?.odds ?? null,
      hits: hits.length,
    });
    if (this.history.length > 20) this.history.pop();
    const w = board[0];
    const best = this.results.hits[0];
    this.say(`제${this.round}경주 확정! 1착 ${w.no}번 ${w.name} (${w.time}, 단승 ${w.winOdds}배).${best ? ` 최고 적중 ${best.name}님 ${best.pay.toLocaleString('ko-KR')}칩!` : ' 적중 마권이 없습니다.'}`);
    this.bets = [];
    this.phase = 'result';
    this.phaseEndsAt = this.now() + this.opt.resultMs;
    for (const p of [...this.players]) if (p.leaving) this.removePlayer(p.id);
    if (!this.hostConnected()) this.pickHost();
    this.later(this.opt.resultMs, () => {
      if (this.running && this.players.some((p) => p.connected)) this.openBetting();
      else {
        this.phase = 'idle';
        this.running = false;
        this.say('경마장을 잠시 쉽니다. 방장이 다시 시작할 수 있어요.');
      }
    });
  }

  // ───────── 화면용 상태 ─────────
  viewFor(playerId) {
    const now = this.now();
    const me = this.player(playerId);
    const c = this.card;
    const live = c && this.phase === 'betting';
    const odds = c ? (this.race ? this.race.finalOdds : Object.fromEntries(Object.keys(BET_TYPES).map((t) => [t, this.liveOdds(t)]))) : null;
    const myOpen = this.bets.filter((b) => b.pid === playerId);
    const showRace = (this.phase === 'racing' || this.phase === 'result') && this.race;
    return {
      code: this.code,
      me: playerId,
      hostId: this.hostId,
      running: this.running,
      phase: this.phase,
      phaseMsLeft: Math.max(0, this.phaseEndsAt - now),
      bettingSec: this.opt.bettingSec,
      minBet: this.opt.minBet,
      startChips: this.opt.startChips,
      takeout: this.opt.takeout,
      round: this.round,
      betTypes: BET_TYPES,
      card: c
        ? {
            field: c.field,
            distance: c.distance,
            track: c.track.label,
            trackKey: c.track.key,
            placeN: c.field >= 8 ? 3 : 2,
            horses: c.horses.map((h) => ({
              no: h.no,
              name: h.name,
              jockey: h.jockey,
              color: h.color,
              age: h.age,
              sex: h.sex,
              weight: h.weight,
              body: h.body,
              delta: h.delta,
              recent: h.recent,
              scratched: h.scratched,
              nickname: h.nickname,
              intro: h.intro,
              jockeyStyle: h.jockeyProfile.style,
              jockeyIntro: h.jockeyProfile.intro,
              jockeyLook: h.jockeyProfile.look,
              jockeyRecord: h.jockeyRecord,
            })),
          }
        : null,
      // 단승·연승은 전체, 조합 승식은 상위 몇 개만(인기순) 보낸다. 내 마권 조합은 따로.
      odds: odds
        ? {
            win: odds.win,
            place: odds.place,
            popular: Object.fromEntries(
              ['quinella', 'exacta', 'quinellaPlace', 'trio', 'trifecta'].map((t) => [
                t,
                Object.entries(odds[t])
                  .sort((a, b) => a[1] - b[1])
                  .slice(0, 8),
              ]),
            ),
          }
        : null,
      myBets: myOpen.map((b) => ({ id: b.id, type: b.type, horses: b.horses, amount: b.amount, odds: odds?.[b.type]?.[b.key] ?? null })),
      totalSales: live || showRace ? this.bets.reduce((a, b) => a + b.amount, 0) : 0,
      race: showRace
        ? {
            msUntilStart: this.race.startAt - now,
            speedup: this.race.speedup,
            distance: c.distance,
            frames: this.race.sim.frames,
            nos: this.race.sim.nos,
            lines: this.race.lines,
            events: this.race.sim.events,
            finishSec: this.race.sim.order[0].time,
            scratched: this.race.scratched,
            refund: this.race.refunds[playerId] ?? 0,
          }
        : null,
      results: this.phase === 'result' ? this.results : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        inPlay: this.bets.filter((b) => b.pid === p.id).reduce((a, b) => a + b.amount, 0),
        net: p.chips + this.bets.filter((b) => b.pid === p.id).reduce((a, b) => a + b.amount, 0) - p.bought,
        connected: p.connected,
        stats: p.stats,
      })),
      history: this.history,
      chat: this.chat.slice(-40),
      caster: this.caster,
      canRebuy: !!me && me.chips < this.opt.minBet && myOpen.length === 0,
    };
  }

  /** 특정 조합의 지금 배당 (조합 승식 선택 화면용) */
  quote(type, horses) {
    if (!this.card || !BET_TYPES[type] || !Array.isArray(horses) || horses.length !== BET_TYPES[type].size) return { error: '조합이 올바르지 않아요' };
    const key = comboKey(type, horses.map(Number));
    const odds = (this.race ? this.race.finalOdds[type] : this.liveOdds(type))[key];
    return { key, odds: odds ?? null };
  }
}

export const _test = { simulate, makeCard, winningCombos, allCombos, margin, probabilities, mulberry32 };
