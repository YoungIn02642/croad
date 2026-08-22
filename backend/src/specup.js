/* ══════════════════════════════════════════════════════════════
   스펙업 — "무엇을 채울까" 에 **지금 실제로 신청할 수 있는 것**을 붙인다

   ── 이 모듈이 하지 않는 일 ──
   무엇이 부족한지는 여기서 정하지 않는다. 그건 선배 스펙 집계와 CAS GAP 이
   이미 하고 있고(프론트 mentoring.js `window.Gap`), 기준이 두 벌이 되면
   "CAS 는 3개라는데 스펙업은 5개" 처럼 갈린다. 여기는 **부족 목록을 받아
   일정·모집공고를 붙이는 일만** 한다.

   ── 두 갈래의 외부 데이터 ──
   | 무엇 | 소스 | 키 |
   |---|---|---|
   | 국가자격 시험일정 | data.go.kr 15074408 `B490007/qualExamSchd` | `DATA_GO_KR_SERVICE_KEY` (**해당 API 활용신청 필요**) |
   | 공모전·대외활동   | 온통청년 청년정책 `youthcenter.go.kr/go/ythip/getPlcy` | `YOUTH_API_KEY` (**별도 발급**) |

   둘 다 **없어도 서버는 뜨고 화면도 동작한다.** 없으면 그 칸만 "무엇을 하면
   열리는지" 를 적어 내려보낸다 — 다른 라우트가 키 없을 때 503 + 안내를 주는 것과
   같은 규약이다(ai-provider.js·news.js).

   ── 실호출로 바로잡은 것 (2026-08-16 활용승인 직후) ──
   승인 전에 명세서만 보고 짠 코드가 **세 군데 틀렸다.** `check-specup-api.js` 가
   원본 item 을 찍게 해 둔 덕에 첫 호출에서 다 드러났다.

   | 넘겨짚은 것 | 실제 |
   |---|---|
   | 응답에 종목코드·종목명(`jmCd`/`jmNm`)이 들어온다 | **안 들어온다.** 한 줄은 '자격구분 × 회차' 다 (`국가기술자격 기사 (2026년도 제2회)`) |
   | 그러니 한 해치를 통째로 받아 종목코드로 나눠 쓰면 된다 | 나눌 종목코드가 없다. 대신 **요청에 `jmCd` 를 주면 그 종목의 회차만** 걸러 준다 |
   | `numOfRows` 를 크게 잡아 페이지를 줄이면 된다 | **상한 50.** 넘기면 `resultCode 930` 인데 **HTTP 200** 이라, 안 잡으면 '일정 없음' 으로 조용히 둔갑한다 |

   그래서 **종목 단위로 부르고 종목 단위로 캐시한다.** 자격증 6개면 6번 부르지만,
   12시간 캐시라 같은 목록을 다시 열 때는 0번이다(개발계정 1,000건/일).

   ── 한 줄에 필기와 실기가 같이 온다 ──
   `doc*`(필기)·`prac*`(실기) 가 한 회차 안에 함께 있고, 한쪽만 채워진 줄도 흔하다.
   또 같은 회차가 **두 줄**로 오기도 한다 — 정기접수와 빈자리접수다(실측: 기사 제3회가
   `0720~0723` 과 `0801~0802` 두 줄). 둘 다 진짜라 버리지 않고, '지금 접수 중 → 가장
   가까운 예정' 순으로 하나만 골라 보여준다.
   ══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const QNET_PATH = path.join(__dirname, '..', 'data', 'qnet-certs.json');
const DISQ_PATH = path.join(__dirname, '..', 'data', 'qnet-disq.json');

const EXAM_API = 'https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList';
const EXAM_APPLY_URL = 'https://www.data.go.kr/data/15074408/openapi.do';

const YOUTH_API = 'https://www.youthcenter.go.kr/go/ythip/getPlcy';
const YOUTH_APPLY_URL = 'https://www.youthcenter.go.kr/myPage/openapi';

const TIMEOUT_MS = Number(process.env.SPECUP_TIMEOUT_MS || 8000);

/* 시험일정은 하루에 한 번이면 충분하다 — 원서접수 기간은 몇 주 단위라 분 단위로
   다시 부를 이유가 없고, 개발계정 트래픽이 1,000건/일 이다. */
const EXAM_TTL_MS  = Number(process.env.SPECUP_EXAM_TTL_MS  || 12 * 60 * 60 * 1000);
const YOUTH_TTL_MS = Number(process.env.SPECUP_YOUTH_TTL_MS || 60 * 60 * 1000);

const key = name => (process.env[name] || '').trim();

// ── 공통 ──────────────────────────────────────────────────────
async function getText(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/* data.go.kr 게이트웨이는 인증 실패를 **HTTP 200 으로도** 내려보낸다. status 만
   보면 "성공했는데 데이터가 없다" 로 읽혀서, 활용신청을 안 한 것이 '표본 없음'
   으로 둔갑한다 — 이 저장소가 제일 경계하는 '조용히 틀리는 값' 이다.
   그래서 본문의 오류 코드까지 읽고 사용자가 **무엇을 하면 되는지**로 갈라 준다. */
function gatewayError(status, body) {
  const b = String(body || '').replace(/\s+/g, ' ');
  if (/SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은 서비스키|<returnReasonCode>30/.test(b)) {
    return { code: 503, reason: 'not-approved',
      error: '이 API 는 아직 활용신청이 안 돼 있어요.',
      how: `공공데이터포털에서 활용신청하면 바로 열립니다 — ${EXAM_APPLY_URL}` };
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|일일 트래픽|<returnReasonCode>22/.test(b)) {
    return { code: 429, reason: 'quota',
      error: '오늘 호출 한도를 다 썼어요. 내일 다시 시도하거나 운영계정으로 전환해 주세요.' };
  }
  if (/SERVICE_ACCESS_DENIED|<returnReasonCode>2[0-9]/.test(b)) {
    return { code: 503, reason: 'denied',
      error: '서비스 접근이 거부됐어요. 키와 활용신청 상태를 확인해 주세요.', how: EXAM_APPLY_URL };
  }
  if (status >= 400) {
    return { code: 502, reason: 'upstream', error: `시험일정 서버가 ${status} 를 돌려줬어요.` };
  }

  /* ── 200 인데 실패한 경우 (실측으로 잡았다) ──────────────────
     `numOfRows` 를 51 이상 주면 <resultCode>930</resultCode> '한 페이지당 조회 가능한
     최대 목록 수는 50개를 넘을 수 없습니다' 가 **HTTP 200 으로** 온다. items 는 없다.
     여기서 안 걸러내면 파서가 0건을 돌려주고, 화면은 '남은 회차가 없어요' 라고
     적는다 — 우리 코드가 틀렸는데 사용자에게는 '시험이 없다' 로 보인다.

     그래서 resultCode 가 00 이 아니면 전부 서버 잘못(500)으로 올린다. 사용자가 할
     수 있는 일이 없는 오류라 위의 안내 문구들과 성격이 다르다. */
  const rc = b.match(/<resultCode>\s*(\d+)\s*<\/resultCode>/);
  if (rc && rc[1] !== '00' && rc[1] !== '0') {
    const msg = (b.match(/<resultMsg>\s*([^<]*)<\/resultMsg>/) || [])[1] || '';
    return { code: 500, reason: 'bad-request',
      error: `시험일정 요청이 거절됐어요 (코드 ${rc[1]}).`,
      how: `${msg.trim()} — 서버 쪽 문제입니다. backend/src/specup.js 의 요청 파라미터를 확인하세요.` };
  }
  return null;
}

// ── XML → item 배열 (중첩 없는 평평한 목록. 다른 fetch-*.js 와 같은 방식) ──
function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const row = {};
    const fre = /<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fre.exec(m[1]))) row[f[1]] = f[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    items.push(row);
  }
  return items;
}

// ── 날짜 ──────────────────────────────────────────────────────
/* 'YYYYMMDD' 와 'YYYY-MM-DD' 둘 다 온다고 보고 하나로 맞춘다. 못 읽으면 null 을
   주고, 호출부는 그 회차를 **판정 대상에서 뺀다** — 0000-00-00 같은 값을 그대로
   비교하면 '접수중' 으로 잘못 뜬다. */
function ymd(v) {
  const s = String(v ?? '').replace(/[^0-9]/g, '');
  if (s.length !== 8) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/* 한 단계(필기 또는 실기)가 지금 어느 상태인가. */
function phaseOf(round, today = todayStr()) {
  const { regStart, regEnd, examStart, examEnd } = round;
  if (regStart && regEnd) {
    if (today < regStart) return 'upcoming';        // 접수 예정
    if (today <= regEnd)  return 'open';            // 접수중 ← 가장 중요한 상태
  }
  const last = examEnd || examStart || regEnd;
  if (last && today <= last) return 'exam';         // 접수는 끝났고 시험을 기다리는 중
  return 'closed';
}

const PHASE_ORDER = { open: 0, upcoming: 1, exam: 2, closed: 3 };

/* 며칠 남았나. 접수 마감 임박을 화면에서 강조하는 데 쓴다. */
function daysUntil(dateStr, today = todayStr()) {
  if (!dateStr) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// ── 자격 종목 코드 ─────────────────────────────────────────────
/* 시험일정은 **종목코드(jmCd)** 단위로 온다. 학생이 입력한 자격증 이름
   ('정보처리기사')을 코드로 바꿔야 이어붙일 수 있다. 이 표는 이미 받아 둔
   data/qnet-certs.json (613종) 이 단일 출처다. */
let certIndex = null;
function certCodes() {
  if (certIndex) return certIndex;
  certIndex = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(QNET_PATH, 'utf8'));
    (raw.certs || []).forEach(c => {
      if (c.code) certIndex.set(normName(c.id), { code: String(c.code), name: c.id, kind: c.kind });
    });
  } catch {
    console.warn('[specup] data/qnet-certs.json 이 없습니다. '
      + '`node scripts/fetch-qnet-certs.js` 로 받아주세요. (자격증 시험일정만 빠집니다)');
  }
  return certIndex;
}

/* 이름 대조는 공백·괄호를 무시한다. 학생은 '정보처리 기사' 로도 적고
   'CPA (공인회계사)' 처럼 설명을 붙이기도 한다. */
function normName(s) {
  return String(s ?? '').replace(/[\s()（）·・]/g, '').toLowerCase();
}

function codeOf(certName) {
  return certCodes().get(normName(certName)) || null;
}

// ── 국가자격 시험일정 ──────────────────────────────────────────
/* 캐시 키는 `연도:종목코드` 다. 응답에 종목이 안 담기므로 한 해치를 받아 나눠 쓸 수가
   없고, 요청에 jmCd 를 실어 종목별로 받는다(머리주석 참고). */
const examCache = new Map();

/* numOfRows 상한이 50 이다. 실측 최대는 기능사 41건(연 41회)이라 한 장이면 되지만,
   상한이 바뀌거나 회차가 늘 수 있으니 두 장까지 받는다. */
const EXAM_PER_PAGE = 50;
const EXAM_MAX_PAGES = 2;

function noKey() {
  const e = new Error('DATA_GO_KR_SERVICE_KEY 가 없습니다.');
  e.payload = { code: 503, reason: 'no-key',
    error: '자격증 시험일정 키가 설정되지 않았어요.',
    how: `backend/.env 의 DATA_GO_KR_SERVICE_KEY 를 채우고 ${EXAM_APPLY_URL} 에서 활용신청하세요.` };
  return e;
}

async function fetchCert(jmCd, year) {
  const cacheKey = `${year}:${jmCd}`;
  const hit = examCache.get(cacheKey);
  if (hit && Date.now() - hit.at < EXAM_TTL_MS) return hit.rounds;

  const serviceKey = key('DATA_GO_KR_SERVICE_KEY');
  if (!serviceKey) throw noKey();

  const rows = [];
  for (let page = 1; page <= EXAM_MAX_PAGES; page++) {
    const url = `${EXAM_API}?serviceKey=${encodeURIComponent(serviceKey)}`
      + `&implYy=${encodeURIComponent(year)}&jmCd=${encodeURIComponent(jmCd)}`
      + `&numOfRows=${EXAM_PER_PAGE}&pageNo=${page}&dataFormat=xml`;
    const { status, body } = await getText(url);

    const err = gatewayError(status, body);
    if (err) { const e = new Error(err.error); e.payload = err; throw e; }

    const items = parseItems(body);
    rows.push(...items);
    if (items.length < EXAM_PER_PAGE) break;
  }

  const rounds = rows.map(toRound).filter(Boolean);
  examCache.set(cacheKey, { at: Date.now(), rounds });
  return rounds;
}

/* 응답 한 줄 → 회차 하나. 한 줄에 필기(doc*)와 실기(prac*)가 같이 오고, 한쪽만
   채워진 줄도 흔하다. 빈 태그(`<docRegStartDt/>`)는 ymd() 가 null 로 걸러 준다. */
function toRound(row) {
  const stage = (p) => {
    const regStart  = ymd(row[`${p}RegStartDt`]);
    const regEnd    = ymd(row[`${p}RegEndDt`]);
    const examStart = ymd(row[`${p}ExamStartDt`]);
    const examEnd   = ymd(row[`${p}ExamEndDt`]);
    const passDt    = ymd(row[`${p}PassDt`]);
    /* 날짜가 하나도 없으면 그 단계는 없는 것이다 — 빈 카드를 만들어 봐야
       학생이 할 수 있는 일이 없다. */
    if (!regStart && !regEnd && !examStart) return null;
    return { regStart, regEnd, examStart, examEnd, passDt };
  };

  const doc = stage('doc');
  const prac = stage('prac');
  if (!doc && !prac) return null;

  return {
    seq: row.implSeq || null,
    qualgbCd: row.qualgbCd || null,
    qualgbNm: row.qualgbNm || null,
    /* '국가기술자격 기사 (2026년도 제2회)' — 회차를 사람에게 보여줄 이름이다.
       응답에 종목명이 없으므로 이게 유일한 라벨이다. */
    label: row.description || null,
    doc, prac,
  };
}

/* 회차들 → 단계 목록. 학생이 실제로 하는 일은 '필기 접수' 와 '실기 접수' 라서,
   회차가 아니라 **단계**가 화면의 단위다. */
function stagesOf(rounds, today) {
  const out = [];
  rounds.forEach(r => {
    if (r.doc)  out.push({ ...r.doc,  stage: '필기', seq: r.seq, label: r.label, phase: phaseOf(r.doc, today) });
    if (r.prac) out.push({ ...r.prac, stage: '실기', seq: r.seq, label: r.label, phase: phaseOf(r.prac, today) });
  });
  return out;
}

/* 자격증 이름 목록 → 각 자격의 **지금 할 수 있는 단계 하나**.
   접수중 > 접수예정 > 시험대기 순으로 하나만 고른다. 회차를 다 늘어놓으면 화면이
   표가 되고, 학생이 지금 눌러야 할 것이 무엇인지 흐려진다.

   같은 회차가 정기접수·빈자리접수 두 줄로 오는 경우가 있는데(실측: 기사 제3회),
   이 정렬이 알아서 '지금 열려 있는 쪽' 을 먼저 집는다. */
/* ── 응시 결격사유 ────────────────────────────────────────────
   "이 시험, 내가 응시할 수는 있나" 에 답한다. `scripts/fetch-qnet-disq.js` 가
   받아 둔 캐시를 읽는다.

   ── 대부분의 자격에는 안 붙는다. 그게 맞다 ──
   결격사유가 있는 종목은 **80개뿐**이고 전부 국가전문자격이다(실측). 기사·기능사
   같은 국가기술자격에는 애초에 결격사유가 없다. 없는 자격에 "결격사유 없음" 을
   적지 않는다 — 있는 자격에서만 칸이 생겨야 그 칸이 뜻을 갖는다.

   ── 대학생에게 실제로 걸리는 건 하나다 ──
   나머지는 파산선고·금고 이상의 형 같은 **법정 결격사유**라 사실상 해당이 없다.
   실제로 걸릴 수 있는 유일한 항목이 **미성년자**(80종 중 17종)라, 그것만 따로
   표시해 화면이 강조할 수 있게 한다. 목록 전체는 접어 두고 원하면 펼치게 둔다 —
   여덟 줄짜리 법조문을 펼쳐 놓으면 정작 시험일정이 안 읽힌다.

   ── 캐시가 없어도 죽지 않는다 ──
   없으면 그 칸만 빠진다. 자격증 시험일정은 그대로 나온다. */
let _disq = null;
function disqOf(name) {
  if (_disq === null) {
    try { _disq = JSON.parse(fs.readFileSync(DISQ_PATH, 'utf8')).certs || {}; }
    catch { _disq = {}; }
  }
  const d = _disq[name];
  if (!d || !d.reasons?.length) return null;
  return { reasons: d.reasons, notes: d.notes || [], minorBlocked: !!d.minorBlocked };
}

async function certSchedules(certNames, { year, today = todayStr() } = {}) {
  const names = [...new Set((certNames || []).filter(Boolean))];
  const thisYear = Number(today.slice(0, 4));
  const yr = year || thisYear;
  if (!names.length) return { year: yr, items: [], source: null };

  if (!key('DATA_GO_KR_SERVICE_KEY')) throw noKey();

  const items = [];
  for (const name of names) {
    const meta = codeOf(name);
    if (!meta) {
      /* ── '국가자격이 아니다' 라고 단정하지 않는다 ────────────────
         못 찾는 이유가 두 가지인데 화면에서는 구분되지 않는다.
           ① 정말 국가자격이 아니다 — SQLD·AWS SAA·CFA 같은 민간·해외자격
           ② 국가자격인데 **우리 종목 목록에 구멍이 있다** — 큐넷 종목목록 API(613종)에
              정보보안기사·컴퓨터활용능력이 빠져 있다(cert-catalog.js 머리주석에 기록된
              기존 한계다). 실측으로 '정보보안기사' 가 여기 걸렸다.
         ②를 "국가자격이 아니에요" 라고 적으면 **틀린 말을 자신 있게 하는 것**이 된다.
         그래서 우리가 아는 사실(못 찾았다)만 적고 확인할 곳을 준다. */
      items.push({ name, code: null, matched: false,
        note: '종목 목록에서 못 찾아 일정을 붙이지 못했어요. 민간자격이거나 목록에 빠진 종목일 수 있어요 — 시행기관 공지를 확인하세요.' });
      continue;
    }

    /* 연말에는 올해 남은 회차가 없다. 그때 "없어요" 로 끝내면 내년 1월 접수를
       놓치므로 다음 해를 한 번 더 본다. 다음 해가 아직 미공개면(실측: 2027년
       0건) 그 사실을 그대로 적는다. */
    let picked = null, pickedYear = yr;
    for (const y of [yr, yr + 1]) {
      const rounds = await fetchCert(meta.code, y);
      const live = stagesOf(rounds, today)
        /* ── 실기는 빼고 필기만 본다 ─────────────────────────────
           실기 원서접수는 **필기 합격자만** 할 수 있다. 이 화면은 '아직 없는
           자격증을 채우자' 는 자리라, 실기 접수일을 보여주면 지금 신청할 수 있는
           일처럼 읽힌다 — 에러 없이 사람을 헛걸음시키는 부류다(작업정리 6-3).
           실측으로 걸렸다: 2026-08-16 기준 정보처리기사가 '실기 9/21 접수' 로
           떴는데, 정작 필기(제3회)는 접수가 이미 끝난 상태였다.
           국가전문자격의 1·2·3차는 전부 doc(필기) 로 오므로 그대로 남는다. */
        .filter(s => s.stage === '필기')
        .filter(s => s.phase !== 'closed')
        .sort((a, b) => (PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])
          || String(a.regStart || a.examStart || '').localeCompare(String(b.regStart || b.examStart || '')));
      if (live.length) { picked = live[0]; pickedYear = y; break; }
    }

    items.push({
      name, code: meta.code, matched: true,
      round: picked && {
        ...picked,
        year: pickedYear,
        daysToRegEnd:   daysUntil(picked.regEnd, today),
        daysToRegStart: daysUntil(picked.regStart, today),
      },
      /* 결격사유가 없는 종목이면 null 이다 — 화면은 그때 칸을 안 그린다. */
      disq: disqOf(name),
      note: picked ? null
        : `${yr}~${yr + 1}년에 남은 회차가 없어요. 다음 해 일정이 공개되면 표시됩니다.`,
    });
  }

  return { year: yr, items, source: '한국산업인력공단 국가자격 시험일정(data.go.kr)' };
}

// ── 공모전 · 대외활동 ──────────────────────────────────────────
/* ── 왜 '청년정책' 을 쓰는가 ──
   공모전·대외활동만 모아 주는 전국 단위 공개 API 는 없다(조사 결과는
   docs/외부API-연동구조.md 에 남겼다 — 다시 조사하지 말 것). 씽굿·위비티·링커리어는
   API 를 열지 않고, data.go.kr 에는 '해외인턴 공모전' 처럼 범위가 좁은 것만 있다.

   대신 온통청년(한국고용정보원)의 청년정책 목록에는 **대학생이 지원할 수 있는
   공모전·서포터즈·해외탐방·교육과정**이 지자체·부처 단위로 올라온다. 정책 데이터라
   잡음이 섞이므로 키워드로 거른다. 거른 결과를 '공모전 전체' 라고 부르지 않고
   화면에도 출처를 그대로 적는다. */
const ACTIVITY_TOPICS = {
  contest: {
    label: '공모전·대회',
    keywords: ['공모전', '경진대회', '해커톤', '아이디어', '창업경진', '경연'],
  },
  activity: {
    label: '대외활동·서포터즈',
    keywords: ['서포터즈', '대외활동', '기자단', '홍보단', '봉사단', '탐방', '멘토링단'],
  },
};

const youthCache = new Map();   // `${topic}:${page}` → { at, data }

async function youthActivities({ topic = 'contest', page = 1, size = 30 } = {}) {
  const t = ACTIVITY_TOPICS[topic] ? topic : 'contest';
  const cacheKey = `${t}:${page}`;
  const hit = youthCache.get(cacheKey);
  if (hit && Date.now() - hit.at < YOUTH_TTL_MS) return hit.data;

  const apiKey = key('YOUTH_API_KEY');
  if (!apiKey) {
    const e = new Error('YOUTH_API_KEY 가 없습니다.');
    e.payload = { code: 503, reason: 'no-key',
      error: '공모전·대외활동 키가 설정되지 않았어요.',
      how: `온통청년에서 인증키를 발급받아 backend/.env 의 YOUTH_API_KEY 에 넣어주세요 — ${YOUTH_APPLY_URL}` };
    throw e;
  }

  /* 키워드를 하나씩 걸어 합친다. 이 API 는 OR 검색을 지원하지 않아서, 한 번에
     부르면 '공모전' 만 잡히고 '서포터즈' 가 통째로 빠진다.

     ── plcyKywdNm 이 아니라 plcyNm 이다 (키 발급 후 실측, 2026-08-18) ──
     명세서만 보고 `plcyKywdNm`(정책 키워드)에 '공모전' 을 넣어 뒀는데, 키를 받아
     불러 보니 **전부 0건**이었다. 에러가 아니라 `totCount: 0` 이라 조용히 빈 목록만
     나왔다(19-6-1 과 같은 부류다 — 명세서만 보고 짠 코드는 열쇠가 오기 전까지
     틀린 줄 모른다).

     `plcyKywdNm` 은 자유검색이 아니라 **정해진 어휘 17종**의 필드였다. 정책 2,715건을
     훑어 확인한 실제 어휘: 교육지원 902 · 보조금 752 · 맞춤형상담서비스 372 ·
     주거지원 234 · 인턴 215 … '공모전'·'서포터즈' 는 아예 없는 말이다.

     정책 **이름**으로 찾는 파라미터가 따로 있다 — `plcyNm`. 실측:
       plcyNm=서포터즈 → 17건 · plcyKywdNm=서포터즈 → 0건
     모르는 파라미터는 무시되고 전체(2,715건)가 그대로 오므로, 파라미터 이름이
     틀리면 **0건이 아니라 '전부'** 가 온다는 것도 같이 확인했다(srchWord·searchWord·
     pblancNm 전부 2,715건). 둘 다 조용히 틀리는 모양이라 이름을 못 박아 둔다. */
  const seen = new Map();
  for (const kw of ACTIVITY_TOPICS[t].keywords) {
    const url = `${YOUTH_API}?apiKeyNm=${encodeURIComponent(apiKey)}`
      + `&rtnType=json&pageNum=${page}&pageSize=${size}&plcyNm=${encodeURIComponent(kw)}`;
    let parsed;
    try {
      const { status, body } = await getText(url);
      if (status === 403 || /invalid api key/i.test(body)) {
        const e = new Error('온통청년 인증키가 거부됐습니다.');
        e.payload = { code: 503, reason: 'bad-key',
          error: '온통청년 인증키가 거부됐어요.', how: YOUTH_APPLY_URL };
        throw e;
      }
      parsed = JSON.parse(body);
    } catch (err) {
      if (err.payload) throw err;
      continue;                       // 키워드 하나가 실패해도 나머지는 살린다
    }
    (parsed?.result?.youthPolicyList || []).forEach(p => {
      const row = toActivity(p, t);
      if (row && !seen.has(row.id)) seen.set(row.id, row);
    });
  }

  /* ── 이미 끝난 모집은 빼고 준다 (실측) ──────────────────────────
     정책 목록에는 2025년에 끝난 공모전이 그대로 남아 있다. 화면은 지난 것에
     '마감 지남' 배지를 붙일 뿐 지우지 않으므로, 그대로 내보내면 목록의 절반이
     지난 공고가 된다 — 이 화면은 **지금 지원할 수 있는 것**을 보러 오는 곳이다.

     **마감일을 모르는 것은 남긴다.** 상시 모집이거나 신고 양식에 기간을 안 적은
     정책이 있는데(실측: '청년정책 서포터즈 2기' 는 aplyYmd 가 비어 있다), 모른다는
     이유로 지우면 열려 있는 모집이 사라진다. 아는 것만 판정한다. */
  const today = ymd(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const items = [...seen.values()]
    .filter(a => !a.endDate || a.endDate >= today)
    .sort((a, b) => String(a.endDate || '9999').localeCompare(String(b.endDate || '9999')));
  const data = { topic: t, label: ACTIVITY_TOPICS[t].label, items,
    source: '온통청년 청년정책(한국고용정보원)' };
  youthCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/* ── 지원 대상 지역 ────────────────────────────────────────────
   ── 왜 zipCd 인가 (후보 셋을 다 재 보고 골랐다) ──
   | 후보 | 문제 |
   |---|---|
   | `sprvsnInstCdNm` 주관기관 | 늘 차 있지만 **부서명만 오는 일이 잦다** — '복지국'·'지역경제과'·'정보통계담당관'. 지역이 안 나온다 |
   | `rgtrHghrkInstCdNm` 최상위등록기관 | 시·도 이름이 잘 오지만 **비어 있는 것이 있고**, 중앙부처('중소벤처기업부')는 지역이 아니다 |
   | `zipCd` | **1,300건 전부 차 있다.** 지원 대상 지역을 법정동코드 5자리 목록으로 준다 |

   ── 코드↔시도 대응은 추측하지 않고 데이터에서 뽑았다 ──
   한 시도만 대상인 정책의 zipCd 앞 2자리와 최상위등록기관을 짝지어 셌다(실측):

     11 서울특별시(8) · 12 광주시청(124)·전남광주통합특별시(59)·전라남도(20)
     27 대구(1) · 28 인천(160) · 30 대전(7) · 31 울산(102) · 36 행정중심복합도시건설청(2)
     41 경기(69) · 44 충남(90) · 47 경북(28) · 48 경남(28) · 50 제주(28)
     51 강원특별자치도(9) · 52 전북특별자치도(55)

   법정동코드 체계와 맞는데 **`12` 만 표준에 없는 값**이다 — '전남광주통합특별시'
   라는 통합 광역단체 코드로, 명세서에는 없고 실측으로만 알 수 있었다.
   관측되지 않은 코드(부산 26·충북 43 등)는 표준 법정동코드로 채웠다 — 아래 표에서
   어느 쪽인지 구분해 적어 둔다.

   ── 전국이냐 지역이냐로 갈린다 ──
   걸치는 시도 수 분포가 **1개 1,211건 · 2~8개 0건 · 9개 이상 89건** 이다.
   중간이 없다 — 지역 정책이거나 전국 정책이거나 둘 중 하나다. 그래서 규칙이 단순하다. */
const SIDO_BY_ZIP = {
  /* 실측으로 확인한 것 */
  11: '서울', 12: '광주·전남', 27: '대구', 28: '인천', 30: '대전', 31: '울산',
  36: '세종', 41: '경기', 44: '충남', 47: '경북', 48: '경남',
  50: '제주', 51: '강원', 52: '전북',
  /* 관측되지 않아 표준 법정동코드로 채운 것 — 옛 코드로 들어오는 자료를 위해 남긴다 */
  26: '부산', 29: '광주', 43: '충북', 45: '전북', 46: '전남', 42: '강원',
};

/* 시도가 이만큼 걸리면 전국 사업으로 본다. 실측상 9개 이상은 전부 전국 단위였고
   2~8개는 한 건도 없었다. */
const NATIONWIDE_MIN = 9;

function regionOf(zipCd) {
  const pres = [...new Set(String(zipCd || '').split(',')
    .map(s => s.trim().slice(0, 2)).filter(s => /^\d\d$/.test(s)))];
  if (!pres.length) return null;
  if (pres.length >= NATIONWIDE_MIN) return '전국';

  const names = [...new Set(pres.map(p => SIDO_BY_ZIP[Number(p)]).filter(Boolean))];
  if (!names.length) return null;          // 모르는 코드는 지어내지 않는다
  if (names.length === 1) return names[0];
  return names.length <= 2 ? names.join('·') : `${names[0]} 외 ${names.length - 1}곳`;
}

function toActivity(p, topic) {
  const id = p.plcyNo || p.bizId;
  if (!id) return null;
  const name = p.plcyNm || '';
  /* 키워드가 정책 설명 어딘가에만 걸린 것들이 섞인다. 제목이나 키워드에
     주제어가 들어간 것만 남긴다 — 지원금 정책이 '공모전' 칸에 있으면 안 된다. */
  const hay = `${name} ${p.plcyKywdNm || ''}`;
  if (!ACTIVITY_TOPICS[topic].keywords.some(k => hay.includes(k))) return null;

  const [start, end] = String(p.aplyYmd || '').split('~').map(s => ymd(s));
  return {
    id: String(id),
    name,
    org: p.sprvsnInstCdNm || p.operInstCdNm || '',
    summary: (p.plcyExplnCn || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    keywords: String(p.plcyKywdNm || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4),
    startDate: start, endDate: end,
    /* 어느 지역 사람이 지원할 수 있는지. 잡히는 정책이 지자체 것에 몰려 있어서
       (광주·울산·인천…) 이게 없으면 학생이 남의 동네 공고를 열어 보고 나서야 안다. */
    region: regionOf(p.zipCd),
    /* ── 신청기간 구분코드를 거꾸로 읽고 있었다 (키 발급 후 실측) ────────
       `0057001` 을 '상시' 로 적어 뒀는데, 정책 1,400건을 훑어 보니 정반대다:

         0057001  738건  **전부 aplyYmd 가 있다** = 기간이 정해진 모집
         0057002  437건  기간 없음 = 상시 (응시료 지원·면접정장 대여처럼 늘 열린 것)
         0057003  225건  기간 없음 = 기타 — 신청방법이 '별도 문의' 인 것이 대부분

       화면이 endDate 를 먼저 보기 때문에(specup.js actCard) 001 의 '상시' 는 가려져
       사고가 안 났고, 대신 **상시 배지가 아무 데도 안 떴다** — 진짜 상시인 002 는
       null 로 떨어져 '기간 미상' 으로 나갔다. 조용히 틀리는 쪽이었다.

       003 은 '상시' 라고 말하지 않는다. 기간을 안 적었을 뿐 늘 열려 있다는 뜻이
       아니라서, 아는 만큼만 적고 나머지는 화면의 '기간 미상' 으로 둔다. */
    period: p.aplyPrdSeCd === '0057002' ? '상시' : null,
    url: p.aplyUrlAddr || p.refUrlAddr1 || null,
  };
}

module.exports = {
  certSchedules, youthActivities,
  // 테스트·점검 스크립트가 쓰는 조각들
  phaseOf, daysUntil, ymd, toRound, stagesOf, toActivity, codeOf, parseItems, gatewayError, disqOf,
  regionOf, SIDO_BY_ZIP,
  ACTIVITY_TOPICS, EXAM_API, EXAM_APPLY_URL, YOUTH_APPLY_URL, EXAM_PER_PAGE,
};
