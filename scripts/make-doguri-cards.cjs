// 도구리(엔씨 캐릭터) 조커·뒷면 카드 SVG 를 만든다. 실행: node scripts/make-doguri-cards.cjs
// 카드 크기는 화투 비율(89.5 × 135.8)에 맞춘 90 × 136.5
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'img', 'hwatu');

const INK = '#4b2027';
const PINK = '#f5a3b1';
const PINK_D = '#e7889a';

/** 도구리 전신 (0 0 200 200 좌표) */
function doguri({ wave = true, wink = false, mouth = 'smile' } = {}) {
  const eye = (x, closed) =>
    closed
      ? `<path d="M${x - 10} 90 q10 -9 20 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`
      : `<circle cx="${x}" cy="90" r="12.5" fill="#fff"/><circle cx="${x}" cy="90" r="7.5" fill="${INK}"/><circle cx="${x + 3}" cy="86.5" r="2.6" fill="#fff"/>`;
  const m =
    mouth === 'open'
      ? `<path d="M93 121 q7 10 14 0 z" fill="#c2414f" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`
      : `<path d="M92 120 q4 5 8 0 q4 5 8 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  return `
  <g stroke-linejoin="round" stroke-linecap="round">
    <!-- 꼬리 -->
    <g transform="rotate(-28 158 160)">
      <ellipse cx="166" cy="160" rx="20" ry="34" fill="${PINK}" stroke="${INK}" stroke-width="5"/>
      <path d="M148 150 q18 -8 36 0" fill="none" stroke="${INK}" stroke-width="7"/>
      <path d="M148 168 q18 -8 36 0" fill="none" stroke="${INK}" stroke-width="7"/>
    </g>
    <!-- 몸 -->
    <path d="M52 150 q-6 44 48 44 q54 0 48 -44 q-6 -30 -48 -30 q-42 0 -48 30z" fill="${PINK}" stroke="${INK}" stroke-width="5"/>
    <ellipse cx="100" cy="164" rx="26" ry="20" fill="#fbd3da"/>
    <!-- 발 -->
    <ellipse cx="76" cy="192" rx="14" ry="7" fill="${PINK_D}" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="124" cy="192" rx="14" ry="7" fill="${PINK_D}" stroke="${INK}" stroke-width="4"/>
    <!-- 팔 -->
    ${wave ? "" : `<ellipse cx="148" cy="152" rx="11" ry="16" fill="${PINK}" stroke="${INK}" stroke-width="4.5" transform="rotate(-20 148 152)"/>`}
    <ellipse cx="52" cy="152" rx="11" ry="16" fill="${PINK}" stroke="${INK}" stroke-width="4.5" transform="rotate(20 52 152)"/>
    <!-- 귀 -->
    <circle cx="46" cy="44" r="21" fill="${PINK}" stroke="${INK}" stroke-width="5"/>
    <circle cx="46" cy="44" r="10" fill="${INK}"/>
    <circle cx="154" cy="44" r="21" fill="${PINK}" stroke="${INK}" stroke-width="5"/>
    <circle cx="154" cy="44" r="10" fill="${INK}"/>
    <!-- 머리 -->
    <ellipse cx="100" cy="90" rx="74" ry="56" fill="${PINK}" stroke="${INK}" stroke-width="5"/>
    <!-- 눈 테두리(도둑 가면) -->
    <path d="M40 92 q0 -26 30 -26 q18 0 30 12 q12 -12 30 -12 q30 0 30 26 q0 24 -30 22 q-18 -1 -30 -12 q-12 11 -30 12 q-30 2 -30 -22z" fill="${INK}"/>
    ${eye(72, false)}
    ${eye(128, wink)}
    <!-- 주둥이 -->
    <ellipse cx="100" cy="114" rx="24" ry="17" fill="#fff" stroke="${INK}" stroke-width="3.5"/>
    <ellipse cx="100" cy="106" rx="8" ry="5.5" fill="${INK}"/>
    ${m}
    <!-- 흔드는 팔 (머리 위에 그린다) -->
    ${wave ? `<path d="M146 150 q30 -8 36 -50" fill="none" stroke="${INK}" stroke-width="21"/><path d="M146 150 q30 -8 36 -50" fill="none" stroke="${PINK}" stroke-width="12"/><circle cx="182" cy="98" r="4" fill="${PINK}"/>` : ""}
    <!-- 볼 -->
    <ellipse cx="48" cy="118" rx="9" ry="5" fill="#ef6f86" opacity="0.55" stroke="none"/>
    <ellipse cx="152" cy="118" rx="9" ry="5" fill="#ef6f86" opacity="0.55" stroke="none"/>
  </g>`;
}

const W = 90;
const H = 136.5;
const svg = (body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}">${extra}${body}</svg>\n`;

// 조커 4장: 바탕색과 표정만 다르게
const JOKERS = [
  { bg: '#fff4d6', band: '#e23b4a', wave: true, wink: false, mouth: 'smile' },
  { bg: '#e6f3ff', band: '#2f63c9', wave: false, wink: true, mouth: 'open' },
  { bg: '#fdeaf0', band: '#d2577a', wave: true, wink: true, mouth: 'open' },
  { bg: '#eaf7e8', band: '#2e8a50', wave: false, wink: false, mouth: 'smile' },
];
JOKERS.forEach((j, i) => {
  const body = `
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${j.bg}"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g opacity="0.5">${[...Array(7)].map((_, k) => `<circle cx="${10 + k * 12}" cy="${H - 8}" r="3" fill="${j.band}"/>`).join('')}</g>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="4" fill="none" stroke="${j.band}" stroke-width="1.6"/>
  <g transform="translate(5 22) scale(0.4)">${doguri(j)}</g>
  <rect x="${W / 2 - 22}" y="7" width="44" height="13" rx="6.5" fill="${j.band}"/>
  <text x="${W / 2}" y="16.8" text-anchor="middle" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" font-weight="900" font-size="9" fill="#fff" letter-spacing="1">조커</text>
  <g transform="translate(${W / 2} ${H - 22})">
    <rect x="-20" y="-8" width="40" height="15" rx="7.5" fill="#fff" stroke="${INK}" stroke-width="1.4"/>
    <text y="3.4" text-anchor="middle" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" font-weight="900" font-size="9" fill="${INK}">쌍피</text>
  </g>`;
  fs.writeFileSync(path.join(out, `doguri-joker-${i + 1}.svg`), svg(body));
});

// 뒷면: 붉은 바탕 + 아치 창 안의 도구리 얼굴
const back = `
  <defs>
    <linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9263a"/><stop offset="1" stop-color="#8f0c1c"/></linearGradient>
    <pattern id="p" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="none"/><path d="M0 4.5h9" stroke="#fff" stroke-opacity="0.07" stroke-width="2"/></pattern>
    <clipPath id="arch"><path d="M22 92 V52 a23 23 0 0 1 46 0 V92 z"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#r)"/>
  <rect width="${W}" height="${H}" fill="url(#p)"/>
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="4" fill="none" stroke="#ffd58a" stroke-opacity="0.55" stroke-width="1.2"/>
  <path d="M22 92 V52 a23 23 0 0 1 46 0 V92 z" fill="#fff3dc" stroke="#ffd58a" stroke-width="2"/>
  <g clip-path="url(#arch)">
    <circle cx="58" cy="40" r="6" fill="#e23b4a" opacity="0.8"/><circle cx="30" cy="48" r="4" fill="#e23b4a" opacity="0.6"/>
    <g transform="translate(16.5 44) scale(0.285)">${doguri({ wave: true })}</g>
  </g>
  <rect x="20" y="92" width="50" height="17" rx="3" fill="#ffd58a"/>
  <text x="45" y="104.5" text-anchor="middle" font-family="'Noto Serif KR','Batang',serif" font-weight="900" font-size="10" fill="#7a1020">도구리화투</text>
  <circle cx="45" cy="121" r="2.2" fill="#ffd58a" opacity="0.8"/>`;
fs.writeFileSync(path.join(out, 'doguri-back.svg'), svg(back));
// 미리보기용 큰 도구리
fs.writeFileSync(path.join(out, 'doguri.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 205">${doguri({ wave: true })}</svg>\n`);
console.log('ok');
