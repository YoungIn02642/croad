/* ════════════════════════════════════════════════════════════
   계열(업종)별 기업 목록 — 회사 찾기 첫 화면

   ── 왜 필요한가 ──
   예전 첫 화면은 손으로 적어 둔 8곳(삼성전자·카카오…)만 보여줬다. 이미 아는 회사라
   "골라서 시작"은 되지만 **몰랐던 회사를 만나지는 못한다.** 학생이 지원할 수 있는
   회사는 훨씬 많고, 대개 이름을 못 들어봐서 후보에서 빠진다.

   ── 무엇을 보여주나 ──
   DART 상장사 캐시(약 4,000곳) 중 **업종코드가 있는 상장사 전부**를 업종코드로 묶는다.
   한동안 공정위 대규모기업집단·고용24 공채기업 명단에 든 회사만 785곳으로 좁혔는데,
   그 명단에 **중소기업이 아예 없어** 회사 수도 적었다(사용자 지적 2026-08-26).
   그래서 필터를 걷고 상장사를 다 보여주되, 아는 회사(명단)를 앞에 정렬해 이름을
   아는 곳이 위에 오게 한다. 명단에 없는 상장사는 규모를 단정하지 않고
   '규모 미확인'(unknown)으로 둔다 — '중소'로 찍으면 실제 중견을 잘못 적는다(sizeOf 주석).

   ── 업종코드를 그대로 쓰지 않는 이유 ──
   KSIC 는 631가지나 되고 '264'(반도체) 같은 숫자라 화면에 못 올린다. 취업 시장에서
   쓰는 말로 15개 계열에 다시 묶는다. 표준분류의 대분류(제조업·정보통신업…)를 쓰지
   않은 것도 같은 이유다 — '제조업' 하나에 식품과 반도체가 같이 들어가서, 학생이
   자기 진로와 맞는지 판단할 수 없다.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const DART = require('./dart');
const CLASSIFY = require('./company-classify');
const JOB = require('./job-industry');

const DATA = path.join(__dirname, '..', 'data');

/* [계열 이름, KSIC 중분류 2자리 코드들]
   순서가 화면 순서다 — 지원자가 많은 계열을 앞에 둔다. */
const SECTORS = [
  ['반도체·디스플레이',   [26]],
  ['IT·소프트웨어',       [58, 62, 63]],
  ['자동차·운송장비',     [30, 31]],
  ['제약·바이오',         [21]],
  ['금융·보험',           [64, 65, 66]],
  ['화학·소재',           [20, 22, 23, 24, 25]],
  ['전자·전기장비',       [27, 28]],
  ['기계·정밀',           [29]],
  ['식품·생활소비재',     [1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 32, 33]],
  ['유통·물류',           [45, 46, 47, 49, 50, 51, 52]],
  ['통신·미디어',         [59, 60, 61]],
  ['건설·부동산',         [41, 42, 68]],
  ['전문서비스',          [70, 71, 72, 73, 74, 75, 76]],
  ['에너지·환경',         [5, 6, 7, 8, 35, 36, 37, 38, 39]],
  ['의료·교육·기타서비스', [55, 56, 85, 86, 87, 90, 91, 94, 95, 96]],
  /* ── 지주회사는 업종이 아니라 회사의 형태다 ────────────────────
     코드는 붙이지 않는다. 아래 holdingOf() 가 5자리 코드를 보고 따로 넣는다.

     ── 왜 빼내야 했나 (실측) ──
     KSIC 는 지주회사를 **금융업(64992)** 으로 분류한다. 통계 분류로는 맞지만,
     그대로 두면 '금융·보험' 68곳 중 33곳이 지주회사가 된다. 학생이 금융을 고르면
     농심홀딩스·오리온홀딩스·하림지주(식품) · 노루홀딩스(도료) · 코오롱(화학) ·
     한진칼(항공) · 롯데지주(유통)가 나온다. 순수 금융사는 29곳뿐이다.

     훑어보는 목록일 때는 칩 몇 개 섞인 정도였지만, **산업을 고르는 축이 되는 순간
     화면이 거짓말을 한다.** 지주회사라고 그대로 적고 따로 세운다 —
     '무엇을 하는 회사인지는 자회사에 있다' 는 것이 이 회사들에 대한 정확한 설명이다. */
  ['지주회사', []],
];

const SECTOR_OF = new Map();
for (const [name, codes] of SECTORS) for (const c of codes) SECTOR_OF.set(c, name);
const SECTOR_ORDER = new Map(SECTORS.map(([n], i) => [n, i]));

/* ── 한국표준산업분류(KSIC) 대분류 ────────────────────────────────
   위 SECTORS 는 **취업 시장의 말**로 묶은 15개 계열이고, 이건 **통계청 공식 분류**의
   대분류다. 둘 다 필요하다.

   ── 왜 대분류가 따로 필요한가 (사용자 지시) ──
   직업 하나가 어느 업종에 속하는지는 대개 **대분류 수준에서 자명하다** —
   '초·중·고등학교 교장' 은 교육 서비스업(P)이고 '금융관리자' 는 금융 및 보험업(K)이다.
   그걸 우리 계열 이름('의료·교육·기타서비스')으로 직접 적으면, 계열을 다시 묶을 때
   매핑을 통째로 손봐야 하고 근거도 남지 않는다. 공식 분류를 한 번 거치면 아래
   SECTIONS_BY_JOB 이 "이 직업은 KSIC 어디에 속하는가" 만 말하면 되고, 계열 이름은
   여기서 자동으로 따라온다.

   ── 2자리 코드는 우리 데이터에 실제로 있는 것 기준이다 ──
   DART 업종코드를 실측해 확인했다(01,03,06,10~33,35,38,41~52,55~66,68,70~76,85,87,
   90,91,95,96). 84(공공행정)·97~99 는 상장사가 없어 0곳인데, **그게 정상이고 그
   사실이 화면에 그대로 나가야 한다** — 공무원 직업에 억지로 민간 계열을 붙이지
   않기 위한 근거다. */
const KSIC_SECTIONS = {
  A: { label: '농업, 임업 및 어업',                     codes: [1, 2, 3] },
  B: { label: '광업',                                   codes: [5, 6, 7, 8] },
  C: { label: '제조업',                                 codes: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34] },
  D: { label: '전기·가스·증기 및 공기조절 공급업',      codes: [35] },
  E: { label: '수도·하수 및 폐기물 처리, 원료 재생업',  codes: [36, 37, 38, 39] },
  F: { label: '건설업',                                 codes: [41, 42] },
  G: { label: '도매 및 소매업',                         codes: [45, 46, 47] },
  H: { label: '운수 및 창고업',                         codes: [49, 50, 51, 52] },
  I: { label: '숙박 및 음식점업',                       codes: [55, 56] },
  J: { label: '정보통신업',                             codes: [58, 59, 60, 61, 62, 63] },
  K: { label: '금융 및 보험업',                         codes: [64, 65, 66] },
  L: { label: '부동산업',                               codes: [68] },
  M: { label: '전문·과학 및 기술 서비스업',             codes: [70, 71, 72, 73] },
  N: { label: '사업시설 관리·사업 지원 및 임대 서비스업', codes: [74, 75, 76] },
  O: { label: '공공행정·국방 및 사회보장 행정',         codes: [84] },
  P: { label: '교육 서비스업',                          codes: [85] },
  Q: { label: '보건업 및 사회복지 서비스업',            codes: [86, 87] },
  R: { label: '예술·스포츠 및 여가관련 서비스업',       codes: [90, 91] },
  S: { label: '협회 및 단체, 수리 및 기타 개인 서비스업', codes: [94, 95, 96] },
};

/* KSIC 대분류 → 우리 계열 이름. 화면 순서(SECTORS)를 따라 정렬해서 돌려준다. */
function sectorsOfSections(letters) {
  const names = new Set();
  for (const L of letters || []) {
    for (const c of KSIC_SECTIONS[L]?.codes || []) {
      const n = SECTOR_OF.get(c);
      if (n) names.add(n);
    }
  }
  return [...names].sort((a, b) => SECTOR_ORDER.get(a) - SECTOR_ORDER.get(b));
}

/* ── 직무(KECO 2차 분류) → 그 직무를 주로 뽑는 계열 ──────────────
   커리어 로드맵 4단계('지원할 회사')가 쓴다. 직무를 골라 온 학생에게 785곳을
   가나다순으로 통째로 보여주면 고를 근거가 없다.

   ── 왜 여기(백엔드)에 두는가 ──
   계열 이름의 단일 출처가 위의 SECTORS 다. 매핑을 프론트에 복사하면 계열 하나를
   고치는 순간 둘이 갈리고, 갈린 것은 에러 없이 '빈 목록'으로만 보인다.

   ── 이건 채용공고가 아니다 ──
   "이 계열 회사가 그 직무를 뽑고 있다"가 아니라 **"이 직무는 주로 이 계열에 있다"**
   는 업종 수준의 연결이다. 실제 채용 여부는 회사 리포트의 공고 칸에서 확인한다
   (사람인 키가 들어오면 그 칸이 채워진다 — saramin-jobs.js).

   ── universal ──
   경영·사무직과 영업·판매직은 **모든 업종이 뽑는다.** 여기에 계열 몇 개를 억지로
   적으면 나머지 업종을 후보에서 지워 버린다. 그래서 좁히지 않고, 좁히지 않는다는
   사실을 화면이 그대로 말하게 한다(3-1 공정위 API 때처럼 추정해서 박지 않는다).

   값이 빈 배열인 것은 '민간 계열로 이어지지 않는 직무'다(공무원·군인). 이때도
   칸을 지우지 않고 왜 비었는지 적는다(16-5 와 같은 원칙). */
const UNIVERSAL_MIDDLES = new Set(['01', '02', '61']);

const SECTORS_BY_MIDDLE = {
  '01': [],                                             // 관리직(임원) — 전 업종이지만 신입 자리가 아니다
  '02': [],                                             // 경영·행정·사무직 — universal
  '03': ['금융·보험'],
  '11': ['전문서비스', '의료·교육·기타서비스'],
  '12': ['제약·바이오', '화학·소재', '에너지·환경'],
  '13': ['IT·소프트웨어', '통신·미디어', '반도체·디스플레이', '전자·전기장비'],
  '14': ['건설·부동산', '에너지·환경'],
  '15': ['자동차·운송장비', '기계·정밀', '반도체·디스플레이', '전자·전기장비', '화학·소재'],
  '21': ['의료·교육·기타서비스'],
  '22': ['전문서비스'],
  '23': ['의료·교육·기타서비스'],
  '24': [],                                             // 경찰·소방·교도 — 공무원 채용이라 민간 계열이 없다
  '25': [],                                             // 군인 — 같은 이유
  '30': ['의료·교육·기타서비스', '제약·바이오'],
  '41': ['통신·미디어', 'IT·소프트웨어'],
  '42': ['의료·교육·기타서비스'],
  '51': ['식품·생활소비재', '의료·교육·기타서비스'],
  '52': ['의료·교육·기타서비스', '유통·물류'],
  '53': ['식품·생활소비재', '의료·교육·기타서비스'],
  '54': ['전문서비스'],
  '55': ['의료·교육·기타서비스'],
  '56': ['전문서비스', '의료·교육·기타서비스'],
  '61': [],                                             // 영업·판매직 — universal
  '62': ['유통·물류'],
  '70': ['건설·부동산'],
  '81': ['기계·정밀', '자동차·운송장비'],
  '82': ['화학·소재', '기계·정밀'],
  '83': ['전자·전기장비', '반도체·디스플레이'],
  '84': ['통신·미디어', 'IT·소프트웨어'],
  '85': ['화학·소재', '에너지·환경'],
  '86': ['식품·생활소비재'],
  '87': ['식품·생활소비재'],
  '88': ['식품·생활소비재'],
  '89': ['식품·생활소비재', '기계·정밀'],
  '90': ['식품·생활소비재', '에너지·환경'],
};

/* 매핑에 적힌 계열 이름이 SECTORS 에 실제로 있는지는 테스트가 지킨다 —
   오타 하나가 '해당 계열 0곳' 으로만 보이고 에러는 안 난다. */
const SECTOR_NAMES = new Set(SECTORS.map(([n]) => n));

/* ── 직업 단위 보정 — KECO 직업코드 → KSIC 대분류 ─────────────────
   ── 왜 필요한가 (사용자 지적) ──
   '초·중·고등학교 교장 및 교감' 을 고르면 **"업종을 가리지 않는 직무"** 라는 안내가
   뜨고 회사가 하나도 안 떴다. 교장이 갈 곳은 학교뿐인데 말이다.

   원인은 매핑의 **해상도**였다. 위 SECTORS_BY_MIDDLE 은 2차 분류 단위인데, 관리직
   (01)에는 성격이 전혀 다른 직업 24개가 같이 들어 있다 — 기업 임원·금융관리자·
   교장·유치원 원장·정부 고위공무원이 한 칸이다. 그 칸 전체로 보면 '전 업종' 이
   맞아서 universal 로 두었고, 그 판단이 개별 직업에는 틀렸다.

   ── 그래서 직업 단위로 내려간다 ──
   여기 적힌 직업은 **이름 자체가 업종을 말한다.** '○○ 관련 관리자' 는 그 ○○ 업종의
   회사에만 있다. 그래서 추측이 아니라 확인이다. 이름으로 업종을 알 수 없는 직업
   (기업 대표·경영 지원 관리자·마케팅 관리자·영업 관리자·연구관리자)은 **여기에 넣지
   않는다** — 그건 진짜 universal 이고, 억지로 계열을 붙이면 나머지 업종의 회사를
   후보에서 지운다.

   ── 값은 계열 이름이 아니라 KSIC 대분류다 ──
   계열 이름을 직접 적으면 계열을 다시 묶을 때 여기까지 손봐야 하고, "왜 그 계열인가"
   의 근거도 사라진다. 공식 분류를 한 번 거치면 근거가 남는다(KSIC_SECTIONS 주석).

   ── 빈 배열은 '민간 경로 없음' 이다 ──
   공무원 직업(O 공공행정)은 상장사가 없다. 억지로 붙이지 않고 빈 값으로 두면
   sectorFocus 가 '민간 계열로 이어지지 않는 직무' 로 답한다. */
const SECTIONS_BY_JOB = {
  // ── 관리직(01) — 이름에 업종이 박혀 있는 것만 ──
  K000000895: ['F', 'B'],        // 건설 및 광업 관련 관리자
  K000001210: ['K'],             // 금융관리자
  K000007471: ['K'],             // 보험관리자
  K000000990: ['P'],             // 대학교 총장 및 대학학장
  K000000838: ['P'],             // 초·중·고등학교 교장 및 교감  ← 사용자가 짚은 그 직업
  K000001171: ['P'],             // 유치원 원장 및 원감
  K000000931: ['Q'],             // 보건 의료 관련 관리자
  K000000833: ['Q'],             // 사회복지 관련 관리자
  K000001032: ['J'],             // 정보 통신 관련 관리자
  /* J(정보통신업)를 같이 넣었더니 IT·소프트웨어 회사가 딸려 왔다 — 방송사를 넣으려다
     소프트웨어까지 끌어온 셈이라 뺐다. 대분류는 이럴 때 너무 넓다. */
  K000000969: ['R'],             // 문화·예술 관련 관리자
  K000001018: ['D', 'E'],        // 전기·가스 및 수도 관련 관리자
  K000000989: ['E', 'N'],        // 환경·청소 및 경비 관련 관리자
  K000001094: ['H'],             // 운송 관련 관리자
  K000000991: ['I'],             // 여행·숙박(호텔)관리자
  K000000950: ['I'],             // 음식 서비스 관련 관리자
  K000001173: ['C'],             // 제품 생산 관련 관리자 (제조업 전반)
  /* 공무원 — 상장사가 없는 대분류라 계열이 비고, 그 사실을 화면이 그대로 말한다 */
  K000001081: ['O'],             // 정부 행정 관리자
  K000000933: ['O'],             // 행정부고위공무원
  K000000910: ['O'],             // 법률·경찰·소방 및 교도 관리자

  // ── 경영·행정·사무직(02) 중 업종이 자명한 전문직 ──
  K000007449: ['M'],             // 회계사
  K000007525: ['M'],             // 세무사
  K000007500: ['M'],             // 관세사
  K000007562: ['M'],             // 노무사
  K000007514: ['M'],             // 감정평가사
  K000007524: ['M'],             // 행정사

  // ── 영업·판매직(61) 중 업종이 자명한 것 ──
  K000007536: ['L'],             // 부동산 컨설턴트 및 중개사
};

/* 직무 하나의 계열 초점.
     matched   : 아는 직무인가 (모르는 코드에 빈 배열을 주면 universal 과 구분되지 않는다)
     universal : 전 업종 공통이라 일부러 좁히지 않았다
     sectors   : 좁힐 계열 (universal 이거나 민간 경로가 없으면 빈 배열) */
function sectorFocus(middleCode, jobCode) {
  const code = String(middleCode || '').trim();
  const job = String(jobCode || '').trim();

  /* ── 직업이 아는 것이 있으면 2차 분류보다 먼저다 ────────────────
     '초·중·고등학교 교장' 은 관리직(01) 안에 있고 그 칸은 universal 이지만, 이
     직업만 보면 교육 서비스업이 확실하다. 좁은 쪽이 이긴다.

     sections 를 같이 돌려주는 이유: 화면이 "왜 이 계열인가" 를 말할 수 있어야 한다.
     '교육 서비스업' 이라고 근거를 대면 학생이 맞는지 스스로 판단할 수 있지만,
     계열 이름만 던지면 우리가 어떻게 골랐는지 알 수 없다. */
  const sections = SECTIONS_BY_JOB[job];
  if (sections) {
    const names = sectorsOfSections(sections);
    return {
      middle: code,
      job,
      matched: true,
      universal: false,
      /* KSIC 대분류는 아는데 그 업종에 상장사가 없다(공무원 O 등). 좁힐 계열이
         없는 것과 '전 업종' 은 다른 말이라 by 로 구분해 둔다. */
      by: 'job',
      /* codes 를 같이 주는 이유: 화면이 계열 버킷(15개, 넓다) 대신 **이 업종의 회사만**
         골라 보여줄 수 있어야 한다(build() 의 ksic 주석). */
      sections: sections.map(L => ({
        code: L, label: KSIC_SECTIONS[L]?.label || L, codes: KSIC_SECTIONS[L]?.codes || [],
      })),
      sectors: names,
    };
  }

  const list = SECTORS_BY_MIDDLE[code];
  if (!list) return { middle: code, job, matched: false, universal: false, sectors: [] };
  return {
    middle: code,
    job,
    matched: true,
    universal: UNIVERSAL_MIDDLES.has(code),
    by: 'middle',
    sectors: list.filter(n => SECTOR_NAMES.has(n)),
  };
}

/* 회사명 대조는 법인격 표기와 공백을 걷어내고 본다 — 같은 회사가 '(주)토스',
   '토스 주식회사' 로 제각각 올라온다(company-name.js 와 같은 규칙). */
const norm = s => String(s || '')
  .replace(/\(주\)|\(유\)|\(재\)|\(사\)|주식회사|유한회사/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return null; }
}
const asArray = j => (Array.isArray(j) ? j
  : (j && (j.companies || j.groups || Object.values(j).find(Array.isArray))) || []);

/* ── 지주회사 판정 ──────────────────────────────────────────
   ── 코드로 아는 것과 이름으로 짐작하는 것을 갈라 둔다 ──
   · 64992 는 KSIC 상 **지주회사** 세분류다. 실측 29곳이 전부 지주회사였다(롯데지주·
     농심홀딩스·한진칼·코오롱…). 코드가 그렇다고 말하므로 그대로 쓴다.
   · 649 로 **3자리만 온 회사**가 6곳 있다. '기타 금융업' 이라는 뜻이라 지주회사인지
     아닌지 코드로는 알 수 없다 — 실제로 그 안에 미래에셋벤처투자(벤처캐피탈)가 섞여
     있다. 이때만 이름을 본다(홀딩스·지주로 끝나는 4곳).

   **이름 규칙을 전체에 적용하지 않는 것이 요점이다.** '효성' 처럼 이름에 흔적이 없는
   지주회사는 금융·보험에 남지만, 그건 우리가 모르는 것이라 모른 채로 두는 편이 맞다.
   이름으로 다 훑으면 '○○홀딩스' 라는 이름의 사업회사까지 같이 옮긴다. */
const HOLDING_CODE = '64992';
const HOLDING_NAME = /(홀딩스|지주)$/;

function holdingOf(corp) {
  const code = String(corp?.industry || '');
  if (code === HOLDING_CODE) return '지주회사';
  if (code === '649' && HOLDING_NAME.test(String(corp?.name || '').trim())) return '지주회사';
  return null;
}

/* ── 회사 하나의 기업규모 ────────────────────────────────────
   1단계에서 고른 기업분류(대·중견·중소·공)로 이 목록을 거르려면, 목록의 회사마다
   같은 축의 값이 있어야 한다. company-classify.js 가 이미 그 판정을 한다 —
   여기서 기준을 새로 세우면 스펙 저장 때 붙는 분류와 목록의 분류가 갈린다.

   ── 명단에 잡힌 것만 규모를 붙이고, 나머지는 '규모 미확인' (사용자 결정 2026-08-26) ──
   한때 명단에 없는 상장사를 전부 '중소'로 표시했는데, 실제로는 중견인데 중소로
   잘못 찍히는 경우가 있었다(리노공업 — 나무위키 대조상 중견, 매출 2,556억). 그래서
   대기업·중견·공공 명단(company-classify 의 matched)에 잡힌 회사만 그 규모를 붙이고,
   명단에 없는 상장사는 **'unknown'(규모 미확인)** 으로 둔다. 회사는 그대로 다 보여주되
   틀린 규모를 단정하지 않는다. (참고: 현재 어느 명단에도 '중소' 라벨이 없어서 —
   공정위=대기업, 고용24=대기업·중견·공공 — 사실상 대부분이 '규모 미확인'이 된다.) */
/* ── 명단 밖 상장사의 규모를 채우는 두 표 (있으면 읽는다) ──────────
   · listed-sizes.json  : DART 매출 → 'small' | 'mid' | 'none'
     (scripts/build-listed-sizes.js 가 만든다)
   · venture-companies.json : 벤처인증 기업 이름 (scripts/fetch-venture.js 가 만든다)
   둘 다 없으면 명단 밖 상장사는 '규모 미확인'(unknown) 그대로다.

   **'none' 과 '표에 없음' 은 다르다.** 'none' 은 3년치 재무를 물어봤는데 매출이 없는
   회사(상장폐지·휴면·SPAC·선박투자회사)이고, 표에 아예 없으면 아직 안 물어본 것이다.
   둘 다 여기서는 unknown 이 되어 목록에서 빠지지만, 스크립트가 이 둘을 섞은 탓에
   멀쩡한 상장사 1,400여 곳이 '폐지'로 사라진 적이 있다(작업정리 37장). */
let _listedSizes, _ventureSet;
function listedSizes() {
  if (_listedSizes) return _listedSizes;
  _listedSizes = readJson('listed-sizes.json') || {};
  return _listedSizes;
}
function ventureSet() {
  if (_ventureSet) return _ventureSet;
  const j = readJson('venture-companies.json');
  const names = Array.isArray(j) ? j : (j?.companies || []);
  _ventureSet = new Set(names.map(x => CLASSIFY.normalize(typeof x === 'string' ? x : (x?.name || ''))).filter(Boolean));
  return _ventureSet;
}

function sizeOf(name) {
  const r = CLASSIFY.classify(name);
  if (r.matched) return CLASSIFY.CORP_TYPE_ID[r.type] || 'unknown';
  /* 명단(대기업·중견·공공)에 없는 상장사 — 두 표로 규모를 채운다.
     ① DART 매출 기준(가장 신뢰) → 중소/중견 ② 벤처명단(벤처인증 = 대부분 중소) → 중소
     둘 다 없으면 '규모 미확인'. 매출이 벤처보다 정확하므로 매출이 먼저다. */
  const key = CLASSIFY.normalize(name);
  const byRevenue = listedSizes()[key];
  if (byRevenue === 'mid' || byRevenue === 'small') return byRevenue;
  if (ventureSet().has(key)) return 'small';
  return 'unknown';
}

/* 규모별 곳수. 화면이 필터 칩에 숫자를 달고, **0곳인 칩은 아예 안 만든다** —
   눌러 봤자 빈 목록이 나오는 칩은 고장으로 읽힌다. */
function countSizes(list) {
  const out = {};
  for (const c of list) if (c.size) out[c.size] = (out[c.size] || 0) + 1;
  return out;
}

let _cache = null;

/* 캐시를 한 번 만들고 재사용한다. 파일 셋을 매 요청마다 읽고 785곳을 다시 묶을 이유가
   없다(수집 스크립트를 돌리기 전에는 내용도 안 바뀐다). */
function build() {
  /* 파일을 직접 읽지 않는다 — 업종코드는 다른 파일(dart-industry.json)에 있고
     그걸 붙이는 일은 dart.js 가 한다. 예전에는 여기서 dart-corps.json 을 직접 읽었는데,
     색인을 깃에서 빼면서 업종코드가 사라진 것을 이쪽만 모르고 0곳을 냈다. */
  const corps = DART.allCorps();
  if (!corps.length) return { sectors: [], total: 0, reason: 'DART 기업 색인이 없습니다. 저장소 루트에서 npm run build 를 실행하세요(깃에 넣지 않는 파일입니다).' };

  /* known = 대기업집단·공채기업 명단. 예전에는 이 명단에 든 회사만 785곳 남겼는데,
     그 명단에 중소기업이 아예 없어 '중소' 가 목록에 안 떴다. 이제는 **상장사 전체**를
     보여주고(사용자 결정 2026-08-26), known 은 필터가 아니라 **정렬**에만 쓴다 —
     아는 회사(명단)를 앞에 두고 그 뒤로 나머지 상장사를 붙인다. */
  const known = new Set([
    ...asArray(readJson('ftc-large-groups.json')).map(x => norm(x.name)),
    ...asArray(readJson('work24-companies.json')).map(x => norm(x.name)),
  ]);

  /* ── 같은 이름을 두 번 넣지 않는다 ──────────────────────────
     DART 에는 이름이 같은 법인이 둘씩 있다 — 합병 전후, 상장폐지된 옛 법인이
     그대로 남아 있어서다. 실측 7건: 삼성물산(000830·028260), 미래에셋증권,
     두산건설, 에스와이…

     그냥 두면 목록에 같은 이름이 두 번 뜨는데, **눌렀을 때 열리는 회사는 하나뿐**
     이다(dart.js findCorp 는 캐시에서 먼저 나온 것을 쓴다). 그래서 여기서도
     **먼저 나온 것만** 남긴다 — 목록에 보이는 것과 눌러서 열리는 것이 같아야 한다. */
  const buckets = new Map(SECTORS.map(([n]) => [n, []]));
  const taken = new Set();
  /* 공공 레인(publicOrgs)에 이미 있는 기관의 이름. 아래 두 루프가 같이 본다 —
     민간 목록과 공공 목록에 같은 기관이 두 번 나오면 "몇 곳인가"를 셀 수 없다. */
  const publicNames = new Set(publicOrgs().lanes.flatMap(l => l.companies.map(c => norm(c.name))));
  const isPublicOrg = name => publicNames.has(norm(name)) || publicNames.has(norm(CLASSIFY.displayName(name)));
  for (const c of corps) {
    const key = norm(c.name);
    /* 업종코드가 있는 상장사면 전부 넣는다(명단 여부는 정렬에만 쓴다). 업종코드가
       없는 회사(비상장 등)는 계열로 묶을 수가 없어 뺀다 — 예전과 같다. */
    if (!c.industry || taken.has(key)) continue;
    const sector = holdingOf(c) || SECTOR_OF.get(parseInt(String(c.industry).slice(0, 2), 10));
    if (!sector) continue;
    /* ── 상장폐지·휴면 회사는 뺀다 (사용자 지시 2026-08-28) ──────────
       sizeOf 가 unknown 이면 대기업·중견·공공 명단에도 없고 매출 표에도 답이 없는
       회사다. 매출 표(listed-sizes.json)가 'none' 으로 적어 둔 회사는 3년치 재무를
       실제로 물어봤는데 매출이 없는 곳 — 상장폐지·휴면·기업인수목적회사(SPAC)·
       선박투자회사다. 지원할 수 없으니 뺀다.

       **이 줄은 매출 표를 믿고 회사를 지운다.** 표가 틀리면 멀쩡한 회사가 조용히
       사라지고, 목록이 줄어든 것 말고는 아무 증상이 없다 — 실제로 표를 만드는
       스크립트가 API 한도 오류를 '매출 없음' 으로 적는 바람에 상장사 1,400여 곳이
       없어진 적이 있다(작업정리 37장). 목록 수가 갑자기 줄면 여기가 아니라
       **listed-sizes.json 부터** 본다. */
    let size = sizeOf(c.name);
    if (size === 'unknown') continue;
    /* 공공 레인에 있는 기관은 무슨 라벨이 붙어 있든 'public' 이다. 업종 트리는
       public 을 민간 쪽에서 건너뛰므로(industryTree) 이걸로 중복이 사라진다.
       실측: 안산도시개발이 고용24 명단에 **대기업**으로 올라와 있어서, 업종코드가
       생기자마자 민간 목록과 공공 목록에 두 번 나왔다. 명단 라벨보다 공공기관
       명단이 정확하다 — 그쪽은 기관 유형까지 들고 있다. */
    if (isPublicOrg(c.name)) size = 'public';
    const ksic = parseInt(String(c.industry).slice(0, 2), 10);
    taken.add(key);
    /* 회사마다 KSIC 중분류 2자리를 남긴다. 계열(15개)은 화면에 올리려고 넓게 묶은
       것이라, 직업 단위 보정처럼 **정확히 그 업종만** 보여줘야 할 때 되짚을 것이
       없으면 안 된다 — 실측: '교장' 이 교육(85)으로 좁혀졌는데도 계열 버킷을 통째로
       보여주는 바람에 강원랜드(카지노 91)가 같이 떴다. */
    /* code(원본 5자리)를 같이 남긴다. 취업 업종 분류(job-industry.js)가 5자리 규칙을
       쓴다 — 204(기타 화학제품) 안에서 2042(세제·화장품)만 '화장품' 으로 빠지는 식이라,
       2자리로 줄여 둔 ksic 만으로는 못 가른다. */
    buckets.get(sector).push({ name: c.name, stock: c.stock || null, ksic, code: String(c.industry), size, known: known.has(key) });
  }

  /* ── 비상장 공채기업 추가 (사용자 지시 2026-08-28) ─────────────────
     우리 목록은 DART 상장사 기반이라 배민·무신사 같은 **비상장 중견·대기업**이
     통째로 빠졌다. 고용24 공채기업 명단에는 이들이 있으므로(대기업·중견 라벨과 함께)
     위 DART 루프에서 안 잡힌 것을 여기서 더한다.
     업종코드가 없어 15개 계열로 못 묶으므로 '기타 공채기업' 한 계열로 모은다
     (industryTree 가 이들을 '기타 업종' 으로 내려보낸다). 규모는 고용24 라벨을
     그대로 쓴다(company-classify 가 이미 그 명단을 읽는다 → sizeOf 가 large/mid).
     공공기관·공기업은 공공 레인(buildPublic)에서 따로 다루므로 여기선 뺀다. */
  const OTHER_SECTOR = '기타 공채기업';
  const otherBucket = [];
  /* 공공 레인에 이미 있는 기관은 제외한다(위 isPublicOrg 와 같은 규칙). 규모 라벨만
     보고 거르면 샌다 — 고용24 명단은 지방출자출연기관을 '대기업' 으로 적어 온다. */
  for (const c of asArray(readJson('work24-companies.json'))) {
    const key = norm(c.name);
    if (!c.name || taken.has(key)) continue;
    if (isPublicOrg(c.name)) continue;
    /* 이름이 달라서 위 루프와 안 겹쳐 보이는 같은 회사를 거른다. 고용24 는 학생이
       쓰는 이름으로, DART 는 등기명으로 적는다 — 실측 8건: 네이버/NAVER,
       엔씨소프트/NC, 정식품/정·식품, 와이지원/와이지-원, 그리고 국세청 표기 오류가
       그대로 들어온 '스튜디오프리즘(국세청오류)' 같은 것들. 그냥 두면 같은 회사가
       업종 아래 한 번, '기타 공채기업' 에 또 한 번 나온다.
       (dart.js findCorp 가 그 이름 흔들림을 이미 알고 있다 — 규칙을 여기 또 두지 않는다.) */
    const corp = DART.findCorp(c.name);
    if (corp && taken.has(norm(corp.name))) continue;
    const size = sizeOf(c.name);
    if (size !== 'large' && size !== 'mid') continue;   // 비상장 중견·대기업만
    taken.add(key);
    otherBucket.push({ name: c.name, stock: null, ksic: null, code: null, size, known: true, offMarket: true });
  }

  /* 아는 회사(대기업집단·공채기업 명단)를 앞에, 그 뒤로 나머지 상장사를 가나다순으로.
     이래야 이름을 아는 회사가 위에 오고 모르는 소형주가 아래로 밀려, 목록이 길어져도
     고를 수 있다(매출 순이 더 좋겠지만 수천 곳의 재무를 받으면 첫 화면이 느려진다). */
  const sectors = SECTORS
    .map(([name]) => ({
      name,
      companies: buckets.get(name).sort((a, b) =>
        (b.known - a.known) || a.name.localeCompare(b.name, 'ko')),
    }))
    .filter(s => s.companies.length);

  /* 비상장 공채기업은 계열 맨 뒤에 '기타 공채기업' 으로 붙인다(업종코드가 없어
     15개 계열엔 못 들어간다). 이름순으로만 정렬한다. */
  if (otherBucket.length) {
    sectors.push({ name: OTHER_SECTOR, companies: otherBucket.sort((a, b) => a.name.localeCompare(b.name, 'ko')) });
  }

  const all = sectors.flatMap(s => s.companies);
  return { sectors, total: all.length, sizes: countSizes(all), reason: null };
}

function sectors() {
  if (!_cache) _cache = build();
  return _cache;
}

/* ══ 공공기관 ═══════════════════════════════════════════════
   ── 왜 계열 목록에 못 얹는가 (실측) ──
   위 build() 는 **업종코드가 있는 회사**만 계열에 넣는다. 업종코드는 상장사
   3,981곳에만 채워져 있고(16-9), 공공기관은 대부분 비상장이라 코드가 없다.
   공공기관 명단 1,667곳 중 계열에 들어간 곳은 **4곳뿐이다**
   (한국전력공사·강원랜드·한전KPS·한국가스공사).

   1단계에서 '공공기관' 을 고른 학생에게 4곳을 내미는 것은 목록이 아니라 사고다.
   그래서 공공기관은 계열(업종)이 아니라 **기관 유형**으로 묶어 따로 낸다 —
   지원자가 실제로 쓰는 구분이기도 하다(공기업 / 준정부기관 / 지방공기업…).

   ── 이 목록이 오히려 유리한 점 ──
   민간과 달리 공공기관은 채용공고를 잡알리오에서 정형으로 받아올 수 있다(18장).
   즉 여기서 고른 회사는 리포트의 '채용공고' 칸이 실제로 채워질 확률이 높다. */
const PUBLIC_LANES = [
  { name: '공기업',           match: raw => raw.startsWith('공기업') },
  { name: '준정부기관',       match: raw => raw.startsWith('준정부기관') },
  { name: '기타공공기관',     match: raw => raw.startsWith('기타공공기관') },
];

let _publicCache = null;

function buildPublic() {
  /* asArray 를 쓰지 않는다 — local-public-orgs.json 에는 organizations 말고
     sourceFiles(문자열 배열)도 있어서, "처음 걸리는 배열" 규칙이 **파일 이름 두 줄**을
     기관 목록으로 집어 왔다(실측: 1,312곳이 통째로 사라지고 예외도 안 났다).
     키를 아는 파일은 키로 읽는다. */
  const orgsOf = f => (readJson(f)?.organizations || []);
  const central = orgsOf('public-orgs.json');
  const local = orgsOf('local-public-orgs.json');
  if (!central.length && !local.length) {
    return { lanes: [], total: 0, reason: '공공기관 명단이 없습니다. backend/scripts/fetch-public-orgs.js 와 fetch-local-public-orgs.js 를 실행하세요.' };
  }

  const buckets = new Map();
  const taken = new Set();
  const put = (lane, item) => {
    const key = norm(item.name);
    /* 같은 기관이 중앙 명단과 지방 명단에 겹쳐 올라온 경우 — 먼저 온 쪽만 남긴다.
       계열 목록에서 동명 법인을 다루는 규칙과 같다(목록에 보이는 것과 눌러서
       열리는 것이 같아야 한다). */
    if (!key || taken.has(key)) return;
    taken.add(key);
    if (!buckets.has(lane)) buckets.set(lane, []);
    buckets.get(lane).push(item);
  };

  for (const o of central) {
    const raw = String(o.raw || '');
    const lane = PUBLIC_LANES.find(l => l.match(raw));
    if (!lane) continue;                       // 모르는 유형은 억지로 끼우지 않는다
    put(lane.name, {
      name: CLASSIFY.displayName(o.name), size: 'public',
      /* 유형 원문('공기업(시장형)')과 소관부처를 같이 남긴다. 레인 이름만으로는
         시장형·준시장형이 뭉개지는데, 지원자에게는 그 차이가 크다. */
      note: [raw, o.ministry].filter(Boolean).join(' · ') || null,
    });
  }

  for (const o of local) {
    const lane = o.kind === '지방공기업' ? '지방공기업' : '지방출자출연기관';
    put(lane, {
      name: CLASSIFY.displayName(o.name), size: 'public',
      note: [o.region, o.raw].filter(Boolean).join(' · ') || null,
    });
  }

  const order = [...PUBLIC_LANES.map(l => l.name), '지방공기업', '지방출자출연기관'];
  const lanes = order
    .map(name => ({ name, companies: (buckets.get(name) || []).sort((a, b) => a.name.localeCompare(b.name, 'ko')) }))
    .filter(l => l.companies.length);

  return { lanes, total: lanes.reduce((n, l) => n + l.companies.length, 0), reason: null };
}

function publicOrgs() {
  if (!_publicCache) _publicCache = buildPublic();
  return _publicCache;
}

/* 회사 하나가 어느 계열인지 — 리포트 화면에서 업종코드(264) 대신 보여준다. */
function sectorOfCode(industryCode) {
  const div = parseInt(String(industryCode || '').slice(0, 2), 10);
  return SECTOR_OF.get(div) || null;
}

/* ══ 취업 업종 트리 ═══════════════════════════════════════════
   회사 찾기 화면이 실제로 쓰는 목록. 위 계열(SECTORS)은 KSIC 중분류를 묶은 것이라
   '반도체·디스플레이' 처럼 통계 분류 냄새가 남는데, 학생이 찾는 말은 '게임'·'화장품'
   ·'2차전지' 다. job-industry.js 가 업종코드를 열쇠로 그 말로 다시 묶는다.

   ── 깊이가 갈래마다 다르다 ──
   민간은 대분류 → 중분류 → 회사. 공공은 대분류 → 기관 유형 → 소관·지역 → 기관이다.
   공공기관 1,667곳을 유형 5개로만 나누면 지방출자출연기관 한 칸에 890곳이 들어간다.
   화면은 단계를 세지 않고 **배열을 만나면 회사** 로 읽는다. */
let _tree = null;

function industryTree() {
  if (_tree) return _tree;

  const base = sectors();
  /* 색인이 없을 때도 **모양은 같게** 돌려준다. codesOf 를 빠뜨렸더니 industryFocus 가
     Object.keys(undefined) 로 터졌다 — 배포 서버에만 색인이 없어서 여기서만 났다
     (로컬은 색인이 있어 이 가지를 한 번도 안 밟는다). 빈 값과 없는 값은 다르다. */
  if (!base.sectors.length) {
    return { order: [], tree: {}, total: 0, sizes: {}, codesOf: {}, reason: base.reason };
  }

  const tree = {};
  /* 중분류마다 그 안에 있는 KSIC 2자리를 모아 둔다. 로드맵이 넘겨준 직무를
     "이 직무를 주로 뽑는 업종" 으로 옮길 때 쓴다(industryFocus). */
  const codesOf = {};
  const all = [];

  for (const s of base.sectors) {
    for (const c of s.companies) {
      if (!c.size || c.size === 'public') continue;
      const hit = JOB.classify(c.name, c.code);
      /* 분류표가 못 받는 회사는 버리지 않고 **'기타 업종'** 으로 모은다(사용자 지시로
         상장사 전체를 보여주면서 생겼다 — 예전 785곳은 전부 분류됐다). 조용히 빠뜨리면
         목록에서 사라진 회사를 아무도 못 찾는다. 그래서 목록 맨 끝에 '기타 업종 › 기타'
         칸을 두어, 업종으로는 못 좁혀도 이름으로는 찾히게 한다. */
      const major = hit ? hit.major : '기타 업종';
      const minor = hit ? hit.minor : '기타';
      ((tree[major] ||= {})[minor] ||= []).push({ n: c.name, s: c.size });
      if (!hit) { all.push(c); continue; }
      /* 이름으로 옮긴 회사는 업종 추천의 근거에서 뺀다 — 그 회사의 업종코드는
         지금 사업과 어긋나서 옮긴 것이라, 대표로 세우면 엉뚱한 추천이 붙는다. */
      if (hit.by !== 'name') (codesOf[hit.minor] ||= new Set()).add(c.ksic);
      all.push(c);
    }
  }

  for (const lane of publicOrgs().lanes) {
    const hit = JOB.classifyPublic(lane.name);
    if (!hit) continue;
    const B = (tree[hit.major] ||= {})[hit.minor] ||= {};
    for (const o of lane.companies) {
      /* note 는 중앙이 "공기업(시장형) · 산업통상부", 지방이 "경기도 · 상수도" 꼴이다.
         중앙은 소관부처가, 지방은 시·도가 지원자가 실제로 쓰는 축이다. */
      const part = String(o.note || '').split('·').map(x => x.trim());
      const key = (lane.name.startsWith('지방') ? part[0] : part[1]) || '기타';
      (B[key] ||= []).push({ n: o.name, s: 'public' });
      all.push(o);
    }
  }

  (function sortLeaves(node) {
    for (const k of Object.keys(node)) {
      if (Array.isArray(node[k])) node[k].sort((a, b) => a.n.localeCompare(b.n, 'ko'));
      else sortLeaves(node[k]);
    }
  })(tree);

  /* 화면 순서는 분류표 순서다(지원자가 많은 쪽이 앞). 0곳인 칸은 애초에 안 생긴다. */
  const order = JOB.TAXONOMY
    .map(([major, minors]) => [major, minors.filter(m => tree[major] && tree[major][m])])
    .filter(([, minors]) => minors.length);
  /* 분류표에 없어 '기타 업종' 으로 모인 회사가 있으면 목록 맨 끝에 붙인다 —
     TAXONOMY 순서(지원자 많은 쪽 먼저) 다음에 온다. */
  if (tree['기타 업종']) order.push(['기타 업종', ['기타']]);

  _tree = {
    order, tree,
    total: all.length,
    sizes: countSizes(all),
    codesOf: Object.fromEntries(Object.entries(codesOf).map(([k, v]) => [k, [...v]])),
    reason: null,
  };
  return _tree;
}

/* 계열 이름 → 그 계열이 담고 있는 KSIC 2자리들. sectorFocus 가 by:'middle' 일 때
   계열 이름만 주기 때문에, 업종으로 옮기려면 코드로 한 번 되돌려야 한다. */
const CODES_OF_SECTOR = new Map(SECTORS.map(([name, codes]) => [name, codes]));

/* ── 2자리로는 못 가르는 자리 (사용자 지적 2026-09-13) ──────────────────
   ── 무엇이 틀렸나 ──
   '응용소프트웨어개발자' 로 회사를 찾으면 **의료·제약·바이오**에 별이 붙었다.
   경로를 따라가면 이렇다: 중분류 13 → 계열 '전자·전기장비' → KSIC **27** →
   27 을 가진 회사가 들어 있는 업종을 전부 별로 찍는다 → 그 안에 **의료기기**(271)가
   같이 있다. 별 하나가 대분류까지 타고 올라가(company-cover.js 의 hasFocusUnder)
   대분류 전체에 별이 붙는다.

   ── 왜 생기나 ──
   **두 표의 해상도가 다르다.** 계열 표(SECTORS)는 KSIC 2자리인데, 취업 업종 분류
   (job-industry.js BY_CODE)는 3~5자리까지 내려간다. 그래서 2자리 하나가 업종 두
   칸으로 갈리는 자리가 생긴다 — 27 은 271 의료기기 / 272·273 계측·광학기기다.
   계열이 27 을 넣은 뜻은 계측·광학기기 쪽인데, 코드로만 되돌리면 그 뜻이 사라진다.

   ── 어디까지 고치나 ──
   갈리는 자리는 21곳인데, **대부분은 같은 대분류 안에서 갈린다**(26 이 반도체·전자부품
   과 컴퓨터·통신장비로 갈리는 식). 그건 별이 엉뚱한 곳에 안 붙으므로 그대로 둔다.
   여기 적는 것은 **대분류를 넘어가서 화면이 거짓말을 하는 5곳뿐이다.** 각 칸의 회사를
   세어 확인했다(주석의 회사가 그 칸에 실제로 들어 있는 회사다).

   58(소프트웨어 582·게임 5821 · 출판 581)도 대분류를 넘지만 **여기 넣지 않았다** —
   '문화·예술·디자인·방송직'(41)이 출판·인쇄에 닿는 유일한 길이 58 이라, 코드 하나로
   전역 규칙을 만들면 그 직무의 별이 사라진다. 계열 표를 손대야 풀리는 자리다. */
const FOCUS_MINORS_OF_CODE = {
  /* 27 → 계측·광학기기(47곳: 디아이·세코닉스) | 의료기기(71곳: 바텍·아이센스)
     '전자·전기장비' 계열이 의료기기를 뜻할 수는 없다. */
  27: ['계측·광학기기'],
  /* 45 → 도소매·유통(10곳: 도이치모터스) | 자동차·자동차부품(4곳: 케이씨씨오토모빌)
     '유통·물류' 계열의 45 는 자동차 **판매**다. 부품 제조가 아니다. */
  45: ['도소매·유통'],
  /* 71 → 광고·홍보(28곳) · 회계·법률·컨설팅(4곳) | 지주회사(26곳: 녹십자홀딩스)
     지주회사는 업종이 아니라 회사의 형태라 계열에서 일부러 빼낸 칸이다(SECTORS 주석).
     업종 추천으로도 같은 이유로 내보내지 않는다. */
  71: ['광고·홍보', '회계·법률·컨설팅'],
  /* 73 → 광고·홍보(4곳: 시공테크·오로라) | 바이오·진단(16곳) · 병원·보건(1곳)
     '전문서비스' 계열이 뜻한 건 732 전문 디자인이다. 바이오는 21(제약·바이오 계열)로
     닿으므로 여기서 빼도 길이 막히지 않는다. */
  73: ['광고·홍보'],
  /* 74 → 시설관리·보안(1곳) | 광고·홍보(6곳: 삼구아이앤씨)
     74 는 사업시설 관리·임대다. 광고·홍보는 71·73 으로 닿는다. */
  74: ['시설관리·보안'],
};

/* 오타 방지 — 위 표가 가리키는 중분류가 분류표에 없으면 바로 죽는다.
   이름이 하나 틀리면 '별 없음' 으로만 보이고 에러는 안 난다(SECTOR_NAMES 와 같은 이유). */
{
  const KNOWN = new Set(JOB.TAXONOMY.flatMap(([, minors]) => minors));
  for (const [code, minors] of Object.entries(FOCUS_MINORS_OF_CODE)) {
    for (const m of minors) {
      if (!KNOWN.has(m)) throw new Error(`FOCUS_MINORS_OF_CODE: 분류표에 없는 중분류 ${m} (${code})`);
    }
  }
}

/* 직무 → 그 직무를 주로 뽑는 **취업 업종 중분류**.
   sectorFocus 가 계열/KSIC 대분류로 답하던 것을 화면이 쓰는 말로 옮긴다.
   회사 데이터로 직접 센다 — 표를 하나 더 손으로 만들면 계열 표와 어긋난다. */
function industryFocus(middleCode, jobCode) {
  const f = sectorFocus(middleCode, jobCode);
  if (!f.matched || f.universal) return { ...f, minors: [] };

  const codes = new Set(f.by === 'job'
    ? (f.sections || []).flatMap(x => x.codes || [])
    : (f.sectors || []).flatMap(n => CODES_OF_SECTOR.get(n) || []));
  if (!codes.size) return { ...f, minors: [] };

  const { codesOf = {} } = industryTree();
  /* 코드가 맞아도, 그 코드가 **여러 업종으로 갈리는 자리**면 계열이 뜻한 칸만 남긴다. */
  const allows = (code, minor) => {
    const only = FOCUS_MINORS_OF_CODE[code];
    return !only || only.includes(minor);
  };
  const minors = Object.keys(codesOf).filter(m => codesOf[m].some(c => codes.has(c) && allows(c, m)));
  return { ...f, minors };
}

module.exports = {
  sectors, publicOrgs, sectorOfCode, sectorFocus, sectorsOfSections,
  industryTree, industryFocus,
  SECTORS, SECTORS_BY_MIDDLE, UNIVERSAL_MIDDLES,
  KSIC_SECTIONS, SECTIONS_BY_JOB,
  _build: build, _buildPublic: buildPublic,
};
