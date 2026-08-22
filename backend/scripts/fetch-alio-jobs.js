/* 공공기관 채용공고 수집 → data/alio-jobs.json
   회사 리포트의 '채용공고' 칸이 쓰는 캐시 (src/alio-jobs.js).

   ── 왜 이 소스인가 ──
   사람인은 승인이 심사라 나지 않았고, 워크넷 채용정보(고용24 210L01)는 **개인회원이
   호출할 수 없다**(10-7, 2026-08 재확인 — 지금도 같은 응답). 잡알리오는 공공데이터포털
   **자동승인**이라 이미 가진 DATA_GO_KR_SERVICE_KEY 로 열린다.

   ── 확인된 것 / 확인 안 된 것 ──
   ✔ 인증: 파라미터 이름은 `serviceKey`, 값은 **URL 인코딩한 것**을 쓴다.
     (Encoding/Decoding 키를 잘못 고르면 '키가 틀린 것처럼' 보인다 — 실측으로 갈랐다)
   ✔ 응답 봉투: { resultCode, resultMsg, result }
   ✔ 항목 필드(상세 응답에서 실측):
       recrutPblntSn(일련번호) · instNm(기관명) · recrutPbancTtl(공고제목) ·
       pbancBgngYmd / pbancEndYmd(접수기간) · srcUrl(원문) · recrutSeNm(신입/경력) ·
       acbgCondNmLst(학력) · workRgnNmLst(근무지) · hireTypeNmLst(고용형태) ·
       ncsCdNmLst(NCS 분류) · aplyQlfcCn(지원자격) · prefCn(우대사항)
   ? 목록 응답의 `result` 가 배열인지, totalCount 를 어디에 담는지는 **응답을 보고 맞춘다.**
     그래서 아래 파서는 모양을 박지 않고 배열을 찾아 쓴다. 규격을 추정해 박았다가
     통째로 틀린 적이 있다(공정위 API — fetch-ftc-groups.js 머리주석, 작업정리 3-1).

   ── 전량을 받아 두는 이유 ──
   사람인·워크넷은 회사명으로 그때그때 검색하지만, 이 API 에는 기관명 검색이 없다.
   공공기관 공고는 전량이라야 수천 건이라 하루 한 번 받아 두고 대조는 우리가 한다.
   일일 한도(개발계정 1,000건)에 견줘 수십 회 호출이라 여유가 크다.

     node scripts/fetch-alio-jobs.js --probe     # 1페이지 원문을 그대로 덤프(먼저 이것부터)
     node scripts/fetch-alio-jobs.js             # 전량 수집 → data/alio-jobs.json
     node scripts/fetch-alio-jobs.js --pages=3   # 앞 3페이지만 (시험용)
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const RAW_KEY = (process.env.DATA_GO_KR_SERVICE_KEY || '').trim();
/* .env 에 인코딩 키가 들어 있을 수도 있다. 한 번 풀었다가 다시 인코딩하면
   어느 쪽이 들어 있든 같은 값이 된다(이중 인코딩 방지). */
const KEY = encodeURIComponent(RAW_KEY.includes('%') ? decodeURIComponent(RAW_KEY) : RAW_KEY);

/* 엔드포인트는 활용신청 뒤 마이페이지에만 적혀 있어 저장소에 박아 둘 수 없다.
   .env 의 ALIO_API_URL 로 받는다 — 주소가 바뀌어도 코드를 안 고친다.

   ── 붙여넣기 사고를 여기서 막는다 ──
   안내문의 자리표시자(`<...>`)를 꺾쇠째 붙여넣거나, 포털에서 복사할 때 따옴표·
   뒷공백이 딸려 오는 일이 잦다. 그대로 두면 fetch 가 'Invalid URL' 로 죽는데,
   그 메시지만 봐서는 **주소가 틀린 건지 키가 틀린 건지 알 수 없다**(실제로 겪었다).
   그래서 걷어낼 수 있는 것은 걷어내고, 안 되면 무엇이 잘못됐는지 말한다. */
function cleanUrl(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^<+|>+$/g, '');                 // <https://…> 처럼 꺾쇠째 붙여넣은 경우
  s = s.replace(/^["']|["']$/g, '');             // 따옴표로 감싼 경우
  s = s.replace(/[\s​]+/g, '');             // 줄바꿈·제로폭 공백(웹에서 복사하면 섞인다)
  return s;
}

/* ── 쿼리스트링은 떼어낸다 (중요) ────────────────────────────
   포털에서 복사하기 쉬운 것은 '요청주소'가 아니라 **Swagger 예제 URL** 이고, 거기에는
   예제용 필터가 통째로 붙어 있다(실측: recrutPbancTtl=보훈 · pblntInstCd=C0203 ·
   pbancBgngYmd=2023-07-01 …). 그걸 그대로 두고 우리 파라미터를 덧붙이면 같은 이름이
   두 번 실려 **서버가 앞의 것(예제 값)을 쓴다.**

   증상이 고약하다 — HTTP 200 에 resultCode 200 인데 결과만 0건이라, 트래픽 제한이나
   장애로 오해하게 된다(실제로 그렇게 한참 봤다). 그래서 주소에서 origin+path 만
   남기고, 떼어낸 게 있으면 **말해 준다.** 조용히 고치면 다음 사람이 같은 걸 또 겪는다. */
const RAW_API = cleanUrl(process.env.ALIO_API_URL);
let API = RAW_API;
let DROPPED = null;
try {
  const u = new URL(RAW_API);
  if (u.search) DROPPED = [...u.searchParams.keys()].filter(k => k !== 'serviceKey');
  API = `${u.origin}${u.pathname}`;
} catch { /* 주소가 아니면 아래 검증에서 걸린다 */ }

const OUT = path.join(__dirname, '..', 'data', 'alio-jobs.json');
const PER_PAGE = 100;
const MAX_PAGES = 60;                 // 6,000건. 넘으면 늘리되 일일 한도를 함께 본다
const TIMEOUT_MS = Number(process.env.ALIO_TIMEOUT_MS || 15000);

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const has = n => process.argv.includes(`--${n}`);

/* 빌드에서 부를 때 붙인다. 키가 없거나 잡알리오가 잠깐 죽어도 **배포를 막지 않는다** —
   공고 칸만 비고 나머지는 그대로 뜬다(fetch-dart-corps.js 와 같은 규약).
   사람이 손으로 돌릴 때는 붙이지 않는다. 그때는 실패가 보여야 한다. */
const SOFT = has('if-possible');
const bail = msg => {
  if (SOFT) { console.warn(`[alio] 건너뜁니다 — ${msg}`); process.exit(0); }
  console.error(msg);
  process.exit(1);
};

/* 파라미터 이름은 예제 URL 에서 확인한 것을 쓴다(추정 아님).
     resultType=json  — `type=json` 이 아니다
     ongoingYn=Y      — **접수 중인 공고만**. 이것 하나로 전체 112,920건이
                        수천 건으로 줄어 일일 한도·용량 문제가 같이 풀린다 */
function url(page, rows) {
  return `${API}?serviceKey=${KEY}&pageNo=${page}&numOfRows=${rows}`
       + '&resultType=json&ongoingYn=Y';
}

async function get(page, rows) {
  const res = await fetch(url(page, rows), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  let json;
  try { json = JSON.parse(body); }
  catch { throw new Error(`JSON 이 아닙니다: ${body.slice(0, 200)}`); }
  /* data.go.kr 은 오류도 200 으로 주고 본문에 코드를 싣는다. */
  if (json.resultCode != null && Number(json.resultCode) !== 200 && Number(json.resultCode) !== 0) {
    throw new Error(`resultCode ${json.resultCode}: ${json.resultMsg || ''}`);
  }
  return json;
}

/* 목록이 어디에 담겨 오는지 이름을 박지 않는다. 응답에서 **객체 배열**을 찾는다.
   (worknet 수집기가 항목 태그를 자동 인식하는 것과 같은 이유) */
function findItems(json) {
  const seen = [];
  const walk = (v, depth = 0) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && !Array.isArray(v[0])) seen.push(v);
      return;
    }
    if (typeof v === 'object') Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(json);
  if (!seen.length) {
    /* 상세 조회처럼 단건 객체로 오는 경우 — 목록 주소가 아닐 가능성이 크다. */
    const r = json.result;
    if (r && typeof r === 'object' && !Array.isArray(r) && r.recrutPblntSn) return [r];
    return [];
  }
  return seen.sort((a, b) => b.length - a.length)[0];      // 가장 큰 배열이 목록이다
}

/* ── 쓰는 필드만 남긴다 ──────────────────────────────────────
   원본에는 disqlfcRsn(결격사유 전문)·scrnprcdrMthdExpln(전형방법 전문)처럼 수천 자짜리
   본문이 붙어 온다. 공고가 수천 건이면 캐시가 수십 MB 가 되는데, 우리가 읽는 것은
   src/alio-jobs.js 의 normalizeJob 이 꺼내는 십여 개뿐이다.

   길이가 있는 것 중 aplyQlfcCn(지원자격)·prefCn(우대사항)만 남긴다 — 자소서 코치가
   공고 본문 없이 역량을 뽑는 재료라 실제로 쓴다. 상세 전문이 필요하면 srcUrl 로
   원문에 간다(요약해서 지어내지 않는다는 11-2 원칙과 같다). */
const KEEP = [
  'recrutPblntSn', 'instNm', 'recrutPbancTtl', 'srcUrl',
  'pbancBgngYmd', 'pbancEndYmd', 'ongoingYn',
  'recrutSeNm', 'acbgCondNmLst', 'workRgnNmLst', 'hireTypeNmLst',
  'ncsCdLst', 'ncsCdNmLst', 'recrutNope',
  'aplyQlfcCn', 'prefCn',
];
const CLIP = 1200;                    // 긴 텍스트 상한 — 역량 추출에는 이 정도면 충분하다

function slim(r) {
  const out = {};
  for (const k of KEEP) {
    if (r[k] == null || r[k] === '') continue;
    out[k] = typeof r[k] === 'string' && r[k].length > CLIP ? r[k].slice(0, CLIP) : r[k];
  }
  return out;
}

const totalOf = json => {
  for (const k of ['totalCount', 'totalcount', 'total', 'totCnt']) {
    if (json[k] != null) return Number(json[k]);
    if (json.result && json.result[k] != null) return Number(json.result[k]);
  }
  return null;
};

(async () => {
  if (!RAW_KEY) bail('DATA_GO_KR_SERVICE_KEY 가 .env 에 없습니다.');
  if (!API) {
    console.error(
      'ALIO_API_URL 이 .env 에 없습니다.\n' +
      '  공공데이터포털 → 마이페이지 → 오픈API → 개발계정 →\n' +
      '  "재정경제부_공공기관 채용정보 조회서비스" → 상세기능정보의 목록 조회 요청주소를\n' +
      '  backend/.env 에 넣으세요. 꺾쇠·따옴표 없이 주소만 적습니다:\n' +
      '    ALIO_API_URL=https://apis.data.go.kr/1051000/…/…');
  }

  /* 주소가 주소 꼴인지 먼저 본다. fetch 의 'Invalid URL' 은 원인을 말해 주지 않아서,
     주소 문제인지 키 문제인지 구분하는 데 시간을 버린다. */
  let parsed;
  try {
    parsed = new URL(API);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('http/https 가 아닙니다');
  } catch (e) {
    console.error(`ALIO_API_URL 을 주소로 읽을 수 없습니다 (${e.message}).`);
    console.error(`  읽은 값: ${JSON.stringify(API)}`);
    if (/^</.test(String(process.env.ALIO_API_URL || '').trim())) {
      console.error("  ← 안내문의 꺾쇠 '<...>' 까지 같이 붙여넣으신 것 같아요. 주소만 남기세요.");
    }
    console.error('  예: ALIO_API_URL=https://apis.data.go.kr/1051000/recruitment/list');
    /* 주소가 틀린 것은 사람이 고쳐야 할 설정 문제다. 그래도 **배포를 막지는 않는다** —
       공고 칸 하나 때문에 서비스 전체가 안 올라가면 손해가 훨씬 크다. */
    bail('');
  }

  /* 상세 조회 주소를 넣으면 1건짜리 객체만 와서 '수집은 됐는데 1건'이 된다.
     끝 경로에 detail 류가 보이면 미리 짚어 준다 — 막지는 않는다(경로 이름은 기관 마음이다). */
  if (/detail|info$|view$/i.test(parsed.pathname)) {
    console.warn(`  ⚠ 경로가 상세 조회처럼 보입니다: ${parsed.pathname}`);
    console.warn('    목록(list) 오퍼레이션 주소가 맞는지 확인하세요. 상세 주소면 1건만 옵니다.');
  }
  console.log(`요청주소: ${parsed.origin}${parsed.pathname}`);
  if (DROPPED?.length) {
    console.log(`  ℹ 주소에 붙어 있던 예제 필터 ${DROPPED.length}개를 떼어냈습니다: ${DROPPED.join(', ')}`);
    console.log('    (포털의 Swagger 예제 URL 을 붙여넣으면 저 값들이 검색 조건으로 걸려 0건이 나옵니다)');
  }

  /* ── --probe : 규격을 눈으로 확인하고 시작한다 ── */
  if (has('probe')) {
    const json = await get(1, 3);
    console.log('[봉투]', Object.keys(json).join(' · '));
    console.log('[totalCount]', totalOf(json));
    const items = findItems(json);
    console.log('[찾은 항목 수]', items.length);
    if (items[0]) {
      console.log('[항목 필드]');
      for (const [k, v] of Object.entries(items[0])) {
        console.log('   ', k.padEnd(22), String(Array.isArray(v) ? `[배열 ${v.length}]` : v ?? '').slice(0, 60));
      }
    }
    const dump = path.join(__dirname, '..', 'data', '.alio-probe.json');
    fs.writeFileSync(dump, JSON.stringify(json, null, 2), 'utf8');
    console.log(`\n원문 저장: ${dump}  (확인 후 지우세요 — data/ 에 남기지 않는다)`);
    return;
  }

  /* ── 전량을 받지 않는다 ──────────────────────────────────────
     실측 totalCount 는 **112,920건**(서비스 개시 이후 전부)이다. 100건씩 1,130회는
     개발계정 일일 한도(1,000)를 넘고, 저장하면 120MB 가 넘는다.

     목록은 최신순으로 온다(1페이지 마감일이 2026-07~12월이었다). 우리가 쓰는 것은
     **아직 접수 중인 공고**뿐이므로, 마감된 것만 나오는 페이지가 이어지면 멈춘다.
     지난 공고를 들고 있어 봐야 화면에서 어차피 걸러낸다(alio-jobs.js isOpen). */
  const limitPages = Number(arg('pages') || MAX_PAGES);
  const today = new Date();
  const todayYmd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const isOpen = r => String(r.pbancEndYmd || '').replace(/\D/g, '').slice(0, 8) >= todayYmd;

  const byId = new Map();
  let total = null;
  let seen = 0;
  let staleStreak = 0;                 // 접수 중이 하나도 없던 페이지가 연달아 몇 번인지
  const STALE_STOP = 3;

  for (let page = 1; page <= limitPages; page++) {
    let json;
    try {
      json = await get(page, PER_PAGE);
    } catch (e) {
      console.error(`\n  ${page}페이지 실패: ${e.message}`);
      break;
    }
    if (total == null) total = totalOf(json);
    const items = findItems(json);

    /* 오류 없이 빈 응답이 오는 일이 있다(실측 2026-08-15 — resultCode 200 · totalCount 0).
       1페이지부터 비면 받을 게 없다는 뜻이고, 도중에 비면 거기서 끊는다.
       **빈 응답을 '수집 완료'로 넘기지 않는다** — 그게 캐시를 비우는 경로가 된다. */
    if (!items.length) {
      if (page === 1) {
        bail('\n1페이지가 비어 있습니다 (resultCode 는 정상).'
           + '\n  트래픽 제한이나 일시 장애일 수 있습니다 — 잠시 뒤 다시 시도하세요.'
           + '\n  --probe 로 원문을 확인할 수 있습니다.');
      }
      break;
    }

    seen += items.length;
    const open = items.filter(isOpen);
    for (const r of open) {
      const id = String(r.recrutPblntSn ?? '');
      if (id) byId.set(id, slim(r));            // 같은 공고가 페이지에 걸쳐 오면 하나로
    }

    staleStreak = open.length ? 0 : staleStreak + 1;
    process.stdout.write(`\r  ${page}페이지 · 훑은 ${seen}건 · 접수중 ${byId.size}건${total ? ` / 전체 ${total}` : ''}`);

    if (items.length < PER_PAGE) break;
    if (staleStreak >= STALE_STOP) break;       // 마감된 것만 이어지면 과거로 들어간 것이다
  }
  console.log('');

  if (!byId.size) {
    bail('접수 중인 공고를 하나도 찾지 못했습니다. --probe 로 응답을 먼저 확인하세요.');
  }

  /* ── 멀쩡한 캐시를 빈약한 결과로 덮지 않는다 ─────────────────
     API 가 도중에 빈 응답을 주기 시작하면 몇 건만 받고 '성공'으로 끝난다. 그대로
     쓰면 어제까지 보이던 공고가 오늘 사라지는데 **에러는 안 난다.**
     db.json 을 다룰 때와 같은 원칙이다(6-5) — 덮어쓰기 전에 이상함을 먼저 본다. */
  const prev = (() => {
    try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
  })();
  if (prev?.count && byId.size < prev.count * 0.3 && !has('force')) {
    bail(`\n이전 캐시는 ${prev.count}건인데 이번엔 ${byId.size}건뿐입니다 (30% 미만).`
       + '\n  API 가 일시적으로 빈 응답을 주는 중일 수 있어 덮어쓰지 않았습니다.'
       + '\n  그래도 덮어쓰려면 --force 를 붙이세요.');
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: '재정경제부_공공기관 채용정보 조회서비스 (공공데이터포털 15125273 · 잡알리오)',
    sourceUrl: 'https://www.data.go.kr/data/15125273/openapi.do',
    total: total ?? byId.size,
    count: byId.size,
    items: [...byId.values()],
  };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  /* 눈으로 확인할 수 있는 요약을 남긴다 — 수집이 '되긴 됐는데 이상한' 경우를
     숫자로 잡아내려는 것이다(뉴스 웹 폴백 때 겪은 부류).
     담긴 것은 전부 접수 중이므로(위에서 걸렀다) 여기서는 기관 수와 마감 분포를 본다. */
  const insts = new Set(out.items.map(r => r.instNm).filter(Boolean)).size;
  const ends = out.items.map(r => r.pbancEndYmd).filter(Boolean).sort();
  const newbie = out.items.filter(r => String(r.recrutSeNm || '').includes('신입')).length;

  console.log(`저장: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)}MB)`);
  console.log(`  접수 중 ${out.count}건 · 기관 ${insts}곳 · 신입 지원 가능 ${newbie}건`);
  console.log(`  마감일 ${ends[0]} ~ ${ends[ends.length - 1]} · 전체 공고 ${out.total}건 중 훑은 ${seen}건`);
  if (insts < 10) console.log('  ⚠ 기관이 너무 적습니다. 한 페이지만 받고 끊겼을 수 있어요.');
})();
