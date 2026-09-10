/* ══════════════════════════════════════════════════════════════
   직업 업무특성 — 임금직업정보시스템(워크피디아) 직업별 상세

   ── 무엇인가 ──
   직업 하나마다 "이 일은 어떤 일인가" 를 8가지 축으로 0~100 점수화한 자료다.
   한국고용정보원이 재직자 설문으로 만든 값이고, 직업 상세 페이지에 그대로 떠 있다.

     업무수행능력  조작 및 통제(99) · 시력(97) · 반응시간과 속도 …
     지식          운송(95) · 지리(86) · 기계(65) …
     업무환경      움직이는 기계(100) · 마감시간(100) …
     성격          신뢰성(45) · 자기통제(41) …
     흥미          현실형(100) · 사회형(79)
     가치관        일과 삶의 균형(59) · 사회적 공헌(56) …
     업무활동      차량·기계·장비 작동(100) · 기계장치 제어(99) …

   ── 왜 필요한가 (사용자 지시) ──
   CAS 점수를 **이 업무특성과 내 경험을 견줘서** 매기기로 했다. "선배 평균보다 높은가"
   가 아니라 "이 직업이 실제로 요구하는 것을 내가 갖췄는가" 로 축을 바꾼 것이다.
   그러려면 직업마다 무엇을 요구하는지가 데이터로 있어야 한다.

   ── 엔드포인트 (실호출로 확인) ──
   POST /pt/b/a/retrieveOccpNvgtChtr{Ablt|Knwg|Envr|Chrc|Ints|Osv|Act}Data.do
     body: konetOccpCd=<직업코드>
     헤더: X-Requested-With: XMLHttpRequest  (없으면 HTML 이 온다 — fetch-wage-jobs.js 와 같다)
     응답: { success, data: { chtrCode, chtrName, ipcrQtntList: [{ qsnrNm, qsnrCn, cnt }] } }
           qsnrNm 항목명 · qsnrCn 설명 · cnt 점수(0~100, **문자열로 온다**)

   ── 미리 다 받아 두지 않는다 ──
   직업이 461개고 축이 7개라 전량 수집이면 3,227회다. 남의 정부 사이트를 그렇게
   두드릴 이유가 없다 — 학생 한 명이 보는 직업은 한둘뿐이다. **고른 직업만 그때
   받아서 디스크에 캐시**한다. 두 번째부터는 호출이 0이다.
   (fetch-* 스크립트들이 '미리 장 봐두기' 인 것과 다른 판단이다. 저건 회사 6,600곳처럼
    전량이 필요하고 자주 안 바뀌는 자료였다.)
   ══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { cachePath } = require('./cache-dir');
const path = require('path');

const BASE = 'https://www.wagework.go.kr/pt/b/a/';
const CACHE_DIR = cachePath('wage-traits');
const TIMEOUT_MS = Number(process.env.WAGE_TRAITS_TIMEOUT_MS || 8000);

/* 축 7개. key 는 우리가 쓰는 이름, ep 는 엔드포인트 조각.
   ── 순서가 곧 채점 가중치의 근거다 ──
   앞의 넷(능력·지식·활동·환경)은 "무엇을 할 줄 알아야 하는가" 라 학생의 활동·자격으로
   증명할 수 있다. 뒤의 셋(성격·흥미·가치관)은 적성 검사의 영역이라 스펙으로 증명되지
   않는다 — 화면에는 보여주되 점수에는 낮게 반영한다(cas-fit.js WEIGHTS). */
const AXES = [
  { key: 'ability',  ep: 'ChtrAblt', label: '업무수행능력', what: '이 일을 하려면 무엇을 할 줄 알아야 하는가' },
  { key: 'knowledge',ep: 'ChtrKnwg', label: '지식',         what: '어떤 분야를 알아야 하는가' },
  { key: 'activity', ep: 'ChtrAct',  label: '업무활동',     what: '실제로 하루에 무슨 일을 하는가' },
  { key: 'env',      ep: 'ChtrEnvr', label: '업무환경',     what: '어떤 환경에서 일하는가' },
  { key: 'character',ep: 'ChtrChrc', label: '성격',         what: '어떤 성향이 잘 맞는가' },
  { key: 'interest', ep: 'ChtrInts', label: '흥미',         what: '어떤 것에 흥미가 있는 사람에게 맞는가' },
  { key: 'value',    ep: 'ChtrOsv',  label: '가치관',       what: '무엇을 중요하게 여기는 사람에게 맞는가' },
];

const AXIS_BY_KEY = Object.fromEntries(AXES.map(a => [a.key, a]));

const cacheFile = code => path.join(CACHE_DIR, `${code}.json`);

function readCache(code) {
  try { return JSON.parse(fs.readFileSync(cacheFile(code), 'utf8')); }
  catch { return null; }
}

function writeCache(code, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(code), JSON.stringify(data, null, 1));
  } catch (e) {
    /* 캐시를 못 써도 기능은 돌아야 한다 — 읽기 전용 배포 디스크가 그럴 수 있다. */
    console.warn('[wage-traits] 캐시 저장 실패:', e.message);
  }
}

async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        /* 이게 없으면 JSON 대신 HTML 이 온다(fetch-wage-jobs.js 머리주석과 같은 함정). */
        'X-Requested-With': 'XMLHttpRequest',
      },
      body, signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* 축 하나. 실패해도 다른 축은 살린다 — 7개 중 하나가 없다고 화면을 통째로 비울 이유가
   없고, 없는 축은 채점에서 그냥 빠진다(가중치가 남은 축으로 다시 나뉜다). */
async function fetchAxis(code, axis) {
  const j = await postJson(`${BASE}retrieveOccpNvgt${axis.ep}Data.do`, `konetOccpCd=${encodeURIComponent(code)}`);
  const list = j?.data?.ipcrQtntList;
  if (!Array.isArray(list)) return null;

  return list
    .map(r => ({
      name: String(r.qsnrNm || '').trim(),
      desc: String(r.qsnrCn || '').trim(),
      /* cnt 가 문자열로 온다("97"). 숫자로 안 바꾸면 정렬이 사전순이 되어
         100 < 97 < 99 처럼 뒤집힌다. */
      score: Number(r.cnt),
    }))
    .filter(r => r.name && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score);
}

/* 직업 하나의 업무특성 전부. 캐시가 있으면 호출하지 않는다. */
async function traitsOf(code) {
  const id = String(code || '').trim();
  if (!id) return null;

  const hit = readCache(id);
  if (hit) return hit;

  const axes = {};
  let ok = 0;
  for (const axis of AXES) {
    try {
      const rows = await fetchAxis(id, axis);
      if (rows?.length) { axes[axis.key] = rows; ok++; }
    } catch {
      /* 한 축이 막혀도 나머지로 간다. 어느 축이 비었는지는 응답의 axes 키로 드러난다. */
    }
  }
  if (!ok) return null;                      // 하나도 못 받았으면 캐시하지 않는다(다음에 다시 시도)

  const data = { code: id, fetchedAt: new Date().toISOString(), axes };
  writeCache(id, data);
  return data;
}

/* 채점·프롬프트에 넣을 만큼만 추린다. 축마다 상위 N개면 충분하고, 전부 넣으면
   프롬프트가 길어져 뒤쪽 규칙이 잘린다(draft-coach.js 에서 겪은 것과 같은 문제). */
function topTraits(traits, perAxis = 5) {
  if (!traits?.axes) return [];
  return AXES
    .filter(a => traits.axes[a.key]?.length)
    .map(a => ({
      key: a.key, label: a.label, what: a.what,
      items: traits.axes[a.key].slice(0, perAxis),
    }));
}

module.exports = { traitsOf, topTraits, AXES, AXIS_BY_KEY, fetchAxis, CACHE_DIR };
