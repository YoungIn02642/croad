/* ══════════════════════════════════════════════════════════════
   DART(전자공시) — 기업분석의 '사업구조 · 재무 · 경쟁사' 칸

   news.js 가 "이 회사가 지금 무엇을 하고 있는지"(최근 이슈)를 채운다면,
   여기는 "이 회사가 어떤 회사인지"(업종 · 규모 · 실적 추이 · 같은 판의 경쟁자)를
   채운다. 자소서 지원동기에서 뉴스만으로는 못 하는 말이 하나 있다 —
   "이 회사가 이 시장에서 어디쯤 서 있는가".

   ── 키가 없어도 서버는 죽지 않는다 ──
   job-trends 와 같은 정책이다. DART_API_KEY 가 없으면 조용히 null 을 돌려주고
   화면에서 카드만 빠진다. 자소서 코치의 본체(역량 카드)는 DART 와 무관하게
   완성되므로, 키 하나 때문에 기능 전체가 멈추면 안 된다.

   ── 비상장사는 '개황까지' 된다 (한계를 숨기지 않는다) ──
   재무(사업보고서)는 상장사만 있다. 하지만 **기업개황은 비상장 공시대상 법인도
   전부 열려 있다** — 업종·설립연도·대표·본사·홈페이지. 예전에는 캐시를 상장사로만
   만들어 놓아서 캐논코리아 같은 비상장 자회사가 통째로 "공시 자료 없음" 이었다.
   지금은 공시대상 전체를 캐시하고, 재무가 없는 회사는 note 로 그 사실을 밝힌다.
   없는 것을 추정해서 채우면 학생이 그 숫자를 자소서에 쓴다.

   ── 경쟁사는 왜 캐시가 필요한가 ──
   DART 에는 "이 업종의 회사 목록" API 가 없다. 업종코드(induty_code)는 기업개황을
   회사마다 한 번씩 불러야 알 수 있어서, 상장사 목록을 미리 훑어 캐시로 만들어 둔다.
     1) node scripts/fetch-dart-corps.js     — 고유번호 목록(corpCode.xml)
     2) node scripts/build-dart-industry.js  — 업종코드 채우기
   캐시가 없으면 경쟁사만 빠지고 재무는 그대로 나온다.

   env: DART_API_KEY
   ══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { cachePath } = require('./cache-dir');
const path = require('path');
const { normalize } = require('./company-classify');

const API_KEY = (process.env.DART_API_KEY || '').trim();
const TIMEOUT_MS = Number(process.env.DART_TIMEOUT_MS || 8000);
const BASE = 'https://opendart.fss.or.kr/api';
const CORPS_PATH = cachePath('dart-corps.json');
/* 업종코드는 이름 색인과 **다른 파일**에 있다. 만드는 값이 다르기 때문이다.
     이름 색인(6MB) — DART 가 통째로 주는 원본. 받으면 그만이라 깃에 안 넣고 빌드에서 받는다
     업종코드(72KB) — 회사마다 기업개황을 한 번씩 불러 채운 값(호출 3,981번). 깃에 넣는다
   한 파일에 뒀다가 색인을 깃에서 빼면서 업종코드가 같이 사라졌다. 배포에서
   계열별 둘러보기가 0곳이 되고 경쟁사가 빈 채로 나갔다 — 그래서 갈랐다. */
const INDUSTRY_PATH = path.join(__dirname, '..', 'data', 'dart-industry.json');

/* 사업보고서. 분기·반기(11012·11013·11014)를 섞으면 연도별 비교가 깨진다
   — 3년 매출 추이를 보려면 같은 종류의 보고서만 써야 한다. */
const REPORT_ANNUAL = '11011';

/* 연결재무제표(CFS)를 먼저 본다. 지주·대기업은 개별(OFS)만 보면 실체가 안 잡힌다.
   연결이 없는 회사(단일 법인)는 개별로 떨어진다. */
const FS_DIVS = ['CFS', 'OFS'];

const isConfigured = () => Boolean(API_KEY);

/* ── 고유번호·업종 캐시 ───────────────────────────────────────
   두 파일을 읽어 하나로 합친다. 색인이 없으면 업종코드만 있어도 소용없다(false). */
function readJson(file, what) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch (e) {
    console.warn(`[dart] ${what} 를 읽지 못했습니다:`, e.message);
    return null;
  }
}

let _corps = null;
function corps() {
  if (_corps !== null) return _corps;
  const file = readJson(CORPS_PATH, '기업 색인');
  if (!file || !Array.isArray(file.corps)) { _corps = false; return _corps; }

  const industry = (readJson(INDUSTRY_PATH, '업종코드') || {}).byCode || {};
  for (const corp of file.corps) {
    const code = industry[corp.code];
    if (code) corp.industry = code;
  }
  _corps = file;
  return _corps;
}

/* 계열별 목록(company-sectors)도 같은 것을 본다 — 업종코드를 붙이는 규칙이
   두 벌이 되면 한쪽만 고쳐진다. */
function allCorps() {
  const c = corps();
  return (c && Array.isArray(c.corps)) ? c.corps : [];
}

/* 회사명 → 고유번호. 정규화는 company-classify 의 것을 그대로 쓴다
   (표기 흔들림 규칙이 두 벌이 되면 한쪽만 고쳐지는 일이 생긴다 — 단일 출처).

   ── 동명이인은 상장사가 이긴다 ──
   캐시가 공시대상 전체로 바뀌면서(비상장 대기업 자회사를 넣기 위해) 이름이 겹치는
   회사가 7,957쌍 생겼다. 그중 419건은 **상장사와 같은 이름의 비상장 법인**이다
   ('신한'·'하나은행'·'쇼박스'…). 먼저 들어온 것을 쓰면 학생이 아는 회사 대신
   이름만 같은 소규모 법인의 개황이 뜬다 — 자소서에 남의 회사 재무를 쓰게 된다.
   상장사를 우선한다(그쪽이 학생이 검색하는 회사일 확률이 압도적으로 높다). */
let _byName = null;
function nameIndex() {
  if (_byName) return _byName;
  const c = corps();
  _byName = new Map();
  for (const corp of (c && c.corps) || []) {
    const key = normalize(corp.name);
    if (!key) continue;
    const prev = _byName.get(key);
    if (!prev || (!prev.stock && corp.stock)) _byName.set(key, corp);
  }
  return _byName;
}

/* ── 사람이 쓰는 이름 → DART 등록명 ──────────────────────────
   DART 는 법인 등기명으로 등록돼 있어서, 학생이 아는 이름과 다른 회사가 꽤 있다.
   실측(흔한 회사 29곳 중 9곳이 조회 실패):
     네이버 → NAVER · 포스코 → POSCO홀딩스 · KT → 케이티 · 엔씨소프트 → NC
   이 회사들은 캐시에 **있는데도** 이름이 달라서 못 찾았고, 화면에는 "공시 대상
   기업 목록에서 찾지 못했습니다" 가 떴다. 첫 화면 추천 목록에 네이버가 있으니
   눌러 보면 바로 깨진다.

   기계적으로 풀 방법이 없다(등기명은 규칙이 아니라 회사가 정한 이름이다).
   자주 쓰는 것만 손으로 적어 둔다 — 여기 없는 회사는 지금처럼 검색으로 찾는다.

   normalize() 는 대소문자를 건드리지 않으므로(company-classify.js) 여기서는
   소문자 키로 적고 찾을 때도 소문자로 맞춘다 — 'KT' 와 'kt' 가 갈리면 안 된다.

   캐시를 공시대상 전체로 넓히면서 비상장사(쿠팡·우아한형제들·컬리…)는 대부분
   저절로 잡히게 됐다. 남는 것은 **브랜드 이름과 법인명이 다른 회사**뿐이라
   여기 적는다 — 학생은 '토스'로 검색하지 '비바리퍼블리카'로 검색하지 않는다. */
const ALIASES = {
  '네이버': 'NAVER',
  '포스코': 'POSCO홀딩스',
  'kt': '케이티',
  '엔씨소프트': 'NC',
  '엔씨': 'NC',
  '기아자동차': '기아',
  '현대차': '현대자동차',
  '카카오톡': '카카오',
  '토스': '비바리퍼블리카',
  '배달의민족': '우아한형제들',
  '배민': '우아한형제들',
  '당근': '당근마켓',
  '한국타이어': '한국타이어앤테크놀로지',
  '마켓컬리': '컬리',
  '오늘의집': '버킷플레이스',
  '삼성sds': '삼성에스디에스',
  '올리브영': '씨제이올리브영',
  'cj올리브영': '씨제이올리브영',
  '스타벅스': '에스씨케이컴퍼니',
  '스타벅스코리아': '에스씨케이컴퍼니',
  '현대오일뱅크': '에이치디현대오일뱅크',
};

function findCorp(name) {
  const key = normalize(name);
  if (!key) return null;
  const idx = nameIndex();
  if (idx.has(key)) return idx.get(key);

  const alias = ALIASES[key.toLowerCase()];
  return (alias && idx.get(normalize(alias))) || null;
}

/* ── HTTP ────────────────────────────────────────────────────
   DART 는 실패도 200 으로 주고 본문 status 에 사유를 적는다. 그래서 res.ok 만
   보면 "키가 틀렸다"를 성공으로 읽는다 — 본문 status 를 반드시 확인한다.
     000 정상 · 013 조회 데이터 없음 · 020 한도 초과 · 100 키 오류 · 101 미등록 키 */
async function callDart(endpoint, params) {
  if (!API_KEY) return null;
  const qs = new URLSearchParams({ crtfc_key: API_KEY, ...params });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`DART ${endpoint} 오류 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(body);
  if (data.status === '013') return null;                 // 자료 없음 — 실패가 아니다
  if (data.status && data.status !== '000') {
    const err = new Error(`DART ${endpoint}: ${data.message || data.status}`);
    err.status = data.status === '020' ? 429 : 502;
    err.dartStatus = data.status;
    throw err;
  }
  return data;
}

/* ── 기업개황 ───────────────────────────────────────────────── */
async function profile(corpCode) {
  const d = await callDart('company.json', { corp_code: corpCode });
  if (!d) return null;
  /* 기업개황이 주는 값 중 예전에는 6개만 썼다. 나머지도 학생이 실제로 쓰는 정보라
     같이 올린다 — 특히 **IR 홈페이지**가 중요하다. 부문별 매출 비중은 오픈API 에
     없고(companyAnalysis.js 조사 주석) 사업보고서 본문에만 글로 있는데, IR 자료에는
     그 표가 거의 항상 있다. 우리가 못 채우는 칸을 "여기서 보라"로 연결할 수 있다. */
  const cls = { Y: '유가증권', K: '코스닥', N: '코넥스', E: '기타법인' };
  return {
    name: d.corp_name || null,
    nameEng: d.corp_name_eng || null,
    industryCode: d.induty_code || null,
    established: d.est_dt || null,          // YYYYMMDD
    stockCode: (d.stock_code || '').trim() || null,
    market: cls[d.corp_cls] || null,        // 유가/코스닥/코넥스/기타
    ceo: d.ceo_nm || null,
    address: d.adres || null,               // 본사 위치 — 근무지를 가늠하는 값
    homepage: d.hm_url || null,
    irUrl: d.ir_url || null,                // 사업부문별 매출·전략이 여기 있다
    settlementMonth: d.acc_mt || null,      // 결산월 — 채용 시기와 실적 발표 시기의 기준
    listed: Boolean((d.stock_code || '').trim()),
  };
}

/* ── 재무 3년 추이 ───────────────────────────────────────────
   fnlttSinglAcnt 한 번에 당기·전기·전전기가 같이 온다(3년치 = 호출 1회).
   연도를 바꿔가며 세 번 부르지 않는 이유이자, 이 API 를 고른 이유다. */
const ACCOUNTS = [
  { key: 'revenue',  match: ['매출액', '수익(매출액)', '영업수익'] },
  { key: 'operating', match: ['영업이익', '영업이익(손실)'] },
  { key: 'net',      match: ['당기순이익', '당기순이익(손실)'] },
];

/* 빈 값을 0 으로 만들면 안 된다 — Number('') 는 0 이다. 신규 상장사는 전전기가
   비어 있는데, 그걸 0 으로 읽으면 화면에 "0원"이 찍히고 "매출이 0이었다"로 읽힌다.
   자료가 없는 것과 실제로 0 인 것은 다른 사실이라 null 로 구분한다. */
const toNumber = v => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* 사업보고서는 회계연도 종료 후 3개월쯤 뒤에 올라온다. 그래서 '올해'를 물으면
   대개 비어 있다 — 최근 연도부터 내려가며 자료가 있는 해를 찾는다.
   3년을 훑는 것은 12월 결산이 아닌 회사(3월 결산 등)까지 잡기 위해서다. */
/* ── 재무 조회 결과를 잠깐 들고 있는다 ───────────────────────
   경쟁사 하나를 판정할 때마다 financials() 를 부르는데, 이 함수는 연도 3개 × 연결/개별
   2가지를 순서대로 시도하므로 회사 하나에 최대 6번 호출한다. 후보 12곳이면 72번이다.
   같은 회사를 두 번째 볼 때 그걸 또 하면 화면이 그만큼 늦어진다.
   공시는 하루에도 몇 번씩 바뀌는 자료가 아니라 30분이면 충분하다. */
const _finCache = new Map();
const FIN_TTL_MS = 30 * 60 * 1000;

async function financials(corpCode, opts) {
  const hit = _finCache.get(corpCode);
  if (hit && Date.now() - hit.at < FIN_TTL_MS) return hit.value;
  const value = await financialsUncached(corpCode, opts);
  _finCache.set(corpCode, { value, at: Date.now() });
  return value;
}

async function financialsUncached(corpCode, { year = new Date().getFullYear() } = {}) {
  for (let y = year - 1; y >= year - 3; y--) {
    for (const div of FS_DIVS) {
      const d = await callDart('fnlttSinglAcnt.json', {
        corp_code: corpCode, bsns_year: String(y), reprt_code: REPORT_ANNUAL, fs_div: div,
      });
      const rows = d && Array.isArray(d.list) ? d.list : [];
      if (!rows.length) continue;

      const out = { baseYear: y, fsDiv: div, unit: '원', series: {} };
      for (const acc of ACCOUNTS) {
        const row = rows.find(r => acc.match.includes(String(r.account_nm || '').trim()));
        if (!row) continue;
        /* 당기 → 전기 → 전전기 순으로 최근이 앞에 오게 담는다. null 은 남겨 둔다
           (신규 상장사는 전전기가 비어 있고, 그 사실 자체가 정보다). */
        out.series[acc.key] = [
          { year: y,     amount: toNumber(row.thstrm_amount) },
          { year: y - 1, amount: toNumber(row.frmtrm_amount) },
          { year: y - 2, amount: toNumber(row.bfefrmtrm_amount) },
        ];
      }
      if (Object.keys(out.series).length) return out;
    }
  }
  return null;
}

/* ── 직원 현황 ───────────────────────────────────────────────
   '개요' 칸에 올릴 실제 수치다. 예전에는 사업구조(무엇을 팔아 버는가)를 보여주려 했지만
   OPEN DART 에 그 API 가 없다 — 사업의 내용·부문별 매출 비중은 사업보고서 **본문**에만
   있고 구조화된 형태로 열려 있지 않다(조사 기록은 companyAnalysis.js 주석 참고).
   대신 열려 있는 것이 직원 현황이라, 규모를 사실로 보여주는 데 쓴다.

   합계만 낸다. 성별·고용형태별로 여러 줄이 오는데, 자소서에 쓸 말은 "이 회사는 몇 명
   규모인가" 하나다. 남녀 구분을 화면에 올릴 이유가 없다. */
/* ── 관계사 (타법인 출자 현황) ────────────────────────────────
   "무엇으로 돈을 버는가" 의 나머지 절반이다. 사업부문이 본체의 일이라면, 여기는
   **이 회사가 돈을 넣어 둔 다른 사업**이다. 투자목적이 '경영 참여' 인 곳은 사실상
   계열사라 그 회사의 사업이 곧 이 회사의 사업 범위다.
   실측: 강남제비스코 → 강남화성(주) 82.59% '경영 참여' 등 17건.

   단순 투자(시세차익)는 뺀다 — 취업생에게 "이 회사가 무슨 일을 하나" 를 말해 주지
   않고, 개수만 늘려 목록을 읽기 어렵게 만든다. */
async function affiliates(corpCode, year) {
  const d = await callDart('otrCprInvstmntSttus.json', {
    corp_code: corpCode, bsns_year: String(year), reprt_code: REPORT_ANNUAL,
  });
  const rows = d && Array.isArray(d.list) ? d.list : [];
  if (!rows.length) return [];

  return rows
    .map(r => ({
      name: String(r.inv_prm || '').trim(),
      /* 원문에 줄바꿈이 섞여 온다('경영
 참여') — 한 줄로 편다. */
      purpose: String(r.invstmnt_purps || '').replace(/\s+/g, ' ').trim(),
      stake: toNumber(r.bsis_blce_qota_rt),
      since: String(r.frst_acqs_de || '').trim(),
    }))
    .filter(a => a.name && /경영\s*참여/.test(a.purpose))
    .sort((a, b) => (b.stake || 0) - (a.stake || 0))
    .slice(0, 8);
}

/* ── 직원현황 응답 → 화면이 쓰는 값 ──────────────────────────
   순수 함수로 떼어 둔다. 아래 employees() 는 네트워크를 타서 테스트가 못 부르는데,
   실제로 틀렸던 것은 호출이 아니라 **이 접기 규칙**이었다(합계 줄 이중계산).
   고정 응답을 넣어 검증할 수 있어야 같은 실수를 다시 잡는다. */
function foldEmployees(all, year) {
  if (!Array.isArray(all) || !all.length) return null;

  /* ── 합계 줄을 걷어낸다 ─────────────────────────────────────
     회사에 따라 부문별 줄 **뒤에 합계 줄을 한 번 더** 붙여서 신고한다. 그대로 더하면
     인원이 정확히 두 배가 된다. 실측(삼성전자 2025):
       DX 남 38,119 · DX 여 12,698 · DS 남 56,154 · DS 여 21,910
       성별합계 남 94,273 · 성별합계 여 34,608   ← 위 넷의 합
     화면에는 257,762명(실제 128,881명의 두 배)이 떴고, 사업부문에도 '성별합계 50%'
     라는 없는 부문이 1위로 올라왔다.

     '전사'·'전체' 는 합계가 아니다 — 부문을 나누지 않은 회사가 쓰는 유일한 줄이라
     빼면 인원이 0이 된다(카카오·NAVER). 부문으로서 쓸모없다는 것은 화면이 따로
     말한다(company-cover.js NO_SPLIT).

     합계 줄만 온 회사에서는 걷어낼 것이 없으니 원본을 그대로 쓴다. */
  const TOTAL_ROW = /^(성별\s*)?(합계|총계|소계|계)$/;
  const detailed = all.filter(r => !TOTAL_ROW.test(String(r.fo_bbm || '').trim()));
  const rows = detailed.length ? detailed : all;

  /* 응답은 사업부문 × 성별로 여러 줄이 온다. 인원은 더하고, 근속연수·급여는
     **인원으로 가중평균** 한다 — 줄마다 단순평균하면 3명짜리 부문과 3만명짜리 부문이
     같은 무게가 되어 값이 엉뚱해진다. */
  let total = 0, regular = 0, contract = 0;
  let tenureW = 0, tenureN = 0, payW = 0, payN = 0;

  for (const r of rows) {
    const n = toNumber(r.sm);                    // sm = 합계 인원
    if (!n) continue;
    total += n;
    regular += toNumber(r.rgllbr_co) || 0;       // 정규직
    contract += toNumber(r.cnttk_co) || 0;       // 계약직

    const tenure = toNumber(r.avrg_cnwk_sdytrn); // 평균 근속연수
    if (tenure > 0) { tenureW += tenure * n; tenureN += n; }

    const pay = toNumber(r.jan_salary_am);       // 1인 평균 급여액(원)
    if (pay > 0) { payW += pay * n; payN += n; }
  }
  if (total <= 0) return null;

  /* ── 사업부문(fo_bbm)을 버리지 않는다 ────────────────────────
     여태 인원 합계만 쓰고 이 값을 흘렸는데, **"이 회사가 무엇을 하는가" 에 대해
     DART 가 실제로 주는 유일한 정형 값**이다(사업부별 매출은 본문에만 있다 —
     routes/companyAnalysis.js 의 2026-08 조사 기록). 회사가 인력을 어디에 두고
     있는지가 곧 주력 사업이다. 실측: 강남제비스코 → '도료' 627명.

     '〃'(같음 표시)로 오는 줄이 있어 앞 줄의 부문을 물려받게 한다 — 그대로 두면
     화면에 '〃 44명' 이 뜬다. */
  const segMap = new Map();
  let lastName = '';
  for (const r of rows) {
    const raw = String(r.fo_bbm || '').trim();
    const name = (!raw || raw === '〃' || raw === '"') ? lastName : raw;
    if (name) lastName = name;
    const n = toNumber(r.sm);
    if (!name || !n) continue;
    segMap.set(name, (segMap.get(name) || 0) + n);
  }
  const segments = [...segMap.entries()]
    .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);

  return {
    count: total,
    regular: regular || null,
    contract: contract || null,
    tenureYears: tenureN ? Math.round((tenureW / tenureN) * 10) / 10 : null,
    avgPay: payN ? Math.round(payW / payN) : null,
    /* 부문이 하나뿐이면 '단일 사업' 이라는 뜻이라 그것도 정보다. 그대로 넘긴다.
       다만 이름이 '전사' 처럼 나누지 않았다는 뜻일 수 있어, 그 판단은 화면이 한다. */
    segments,
    year,
  };
}

async function employees(corpCode, year) {
  const d = await callDart('empSttus.json', {
    corp_code: corpCode, bsns_year: String(year), reprt_code: REPORT_ANNUAL,
  });
  return foldEmployees(d && Array.isArray(d.list) ? d.list : [], year);
}

/* ── 경쟁사 ──────────────────────────────────────────────────
   같은 업종코드(표준산업분류)를 쓰는 상장사를 경쟁사로 본다. 완벽하지 않다 —
   업종코드가 같아도 사업이 다를 수 있다. 그래서 화면에 "업종코드가 같은 회사"라고
   그대로 적고 '경쟁사'라고 단정하지 않는다. 학생이 보고 걸러야 하는 목록이다. */
/* ── 매출 규모로 한 번 더 거른다 ─────────────────────────────
   업종코드만으로는 "같은 시장의 경쟁사"가 되지 않는다. 표준산업분류는 넓어서
   삼성전자 코드에 규모가 수백 배 다른 회사가 같이 잡힌다. 학생이 그 목록을 그대로
   믿고 "왜 경쟁사가 아니라 우리인가"를 쓰면 면접에서 바로 무너진다.

   그래서 **매출이 0.3~3배 범위**인 회사만 남긴다. 덩치가 비슷하면 채용 시장에서도
   실제로 맞붙는 회사일 확률이 훨씬 높다. 배수는 대칭이 되게 잡았다 — 3배까지 위를
   보면 아래로도 1/3까지 봐야 "비슷한 규모"라는 말이 한쪽으로 기울지 않는다.

   매출을 못 구한 회사는 **버리지 않고 뒤로 보낸다.** 신규 상장사나 결산이 늦은
   회사가 여기 걸리는데, 그게 경쟁사가 아니라는 뜻은 아니다. */
const SIZE_LOW = 0.3;
const SIZE_HIGH = 3;
/* 후보를 전부 조회하면 회사 하나 여는 데 DART 호출이 수십 번이 된다.
   앞에서부터 이만큼만 본다 — 4곳을 고르는 데 12곳이면 충분하다. */
const RIVAL_PROBE = 12;

function revenueOf(fin) {
  const series = fin?.series?.revenue;
  const amount = series?.[0]?.amount;
  return typeof amount === 'number' && amount > 0 ? amount : null;
}

async function competitors(corp, { limit = 4, baseRevenue = null } = {}) {
  if (!corp?.industry) return [];
  const c = corps();
  if (!c || !Array.isArray(c.corps)) return [];

  const pool = c.corps
    .filter(x => x.industry === corp.industry && x.code !== corp.code)
    .slice(0, RIVAL_PROBE);
  if (!pool.length) return [];

  /* 기준 매출이 없으면(비상장 등) 규모 비교 자체가 불가능하다. 예전처럼 업종코드만으로
     돌려주되, 화면이 그 사실을 말할 수 있게 sized:false 를 붙인다. */
  if (!baseRevenue) {
    return pool.slice(0, limit).map(x => ({ name: x.name, code: x.code, stock: x.stock || null, sized: false }));
  }

  const probed = await Promise.all(pool.map(async x => {
    try {
      const fin = await financials(x.code);
      return { x, revenue: revenueOf(fin) };
    } catch { return { x, revenue: null }; }
  }));

  const inRange = [];
  const unknown = [];
  for (const { x, revenue } of probed) {
    if (revenue === null) { unknown.push({ x, revenue: null }); continue; }
    const ratio = revenue / baseRevenue;
    if (ratio >= SIZE_LOW && ratio <= SIZE_HIGH) inRange.push({ x, revenue, ratio });
  }
  /* 규모가 가까운 순으로 — 1배(=같은 덩치)에서 얼마나 떨어졌는지로 잰다. */
  inRange.sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)));

  return [...inRange, ...unknown].slice(0, limit).map(({ x, revenue }) => ({
    name: x.name, code: x.code, stock: x.stock || null,
    revenue: revenue || null,
    sized: revenue !== null,
  }));
}

/* ── 묶음 조회 ───────────────────────────────────────────────
   화면이 부르는 단 하나의 입구. 어느 단계가 비어도 나머지는 돌려준다 —
   재무가 없다고 업종까지 숨기면 비상장사는 아무것도 못 보게 된다. */
async function analyze(name) {
  if (!isConfigured()) {
    return { available: false, reason: 'DART_API_KEY 가 없습니다.', profile: null, financials: null, competitors: [] };
  }
  const corp = findCorp(name);
  if (!corp) {
    return {
      available: false,
      reason: corps() ? '공시 대상 기업 목록에서 찾지 못했습니다(비상장이거나 표기가 다를 수 있습니다).'
                      : '기업 색인이 없습니다. 저장소 루트에서 npm run build 를 실행하세요(깃에 넣지 않는 파일입니다).',
      profile: null, financials: null, competitors: [],
    };
  }

  const [prof, fin] = await Promise.all([
    profile(corp.code).catch(e => { console.warn('[dart] 기업개황 실패:', e.message); return null; }),
    financials(corp.code).catch(e => { console.warn('[dart] 재무 실패:', e.message); return null; }),
  ]);

  /* 업종코드는 캐시보다 방금 받아온 개황이 정확하다(캐시는 만들어진 시점의 값). */
  const withIndustry = { ...corp, industry: prof?.industryCode || corp.industry };

  /* 직원 현황은 재무가 잡아낸 연도로 조회한다. 재무를 못 찾았으면 그 회사는 사업보고서
     자체가 없다는 뜻이라(비상장 등) 직원 수도 없다 — 헛되이 한 번 더 부르지 않는다. */
  const emp = fin
    ? await employees(corp.code, fin.baseYear)
        .catch(e => { console.warn('[dart] 직원현황 실패:', e.message); return null; })
    : null;

  return {
    available: true,
    corpCode: corp.code,
    profile: prof,
    financials: fin,
    employees: emp,
    /* 관계사 — 사업부문과 함께 '무엇을 하는 회사인가' 를 채운다. 실패해도 리포트는
       살아야 하므로 빈 배열로 떨어진다(경쟁사와 같은 규약). */
    affiliates: fin
      ? await affiliates(corp.code, fin.baseYear)
          .catch(e => { console.warn('[dart] 관계사 조회 실패:', e.message); return []; })
      : [],
    /* 우리 회사 매출을 기준으로 비슷한 덩치만 남긴다(competitors 주석 참고). */
    competitors: await competitors(withIndustry, { baseRevenue: revenueOf(fin) })
      .catch(e => { console.warn('[dart] 경쟁사 조회 실패:', e.message); return []; }),
    /* 비상장사는 재무가 없는 게 정상이다. 화면이 '실패'로 보이지 않게 이유를 준다. */
    note: !fin ? (prof && !prof.listed
      ? '비상장 법인이라 사업보고서 재무 자료가 공시되지 않습니다.'
      : '최근 3개 사업연도에서 재무 자료를 찾지 못했습니다.') : null,
  };
}

/* 캐시 상태 — 점검 스크립트와 백오피스에서 쓴다. */
function status() {
  const c = corps();
  return {
    configured: isConfigured(),
    cached: c && Array.isArray(c.corps) ? c.corps.length : 0,
    withIndustry: c && Array.isArray(c.corps) ? c.corps.filter(x => x.industry).length : 0,
    generatedAt: (c && c.generatedAt) || null,
  };
}

function reloadCache() { _corps = null; _byName = null; return status(); }

module.exports = {
  isConfigured, analyze, findCorp, profile, financials, competitors, employees, affiliates,
  foldEmployees,              // 직원현황 접기 규칙 — 테스트가 고정 응답으로 검증한다
  status, reloadCache, callDart, toNumber, allCorps, CORPS_PATH, INDUSTRY_PATH,
  SIZE_LOW, SIZE_HIGH,        // 경쟁사 규모 배수 — 테스트가 대칭인지 확인한다
};
