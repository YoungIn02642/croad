/* ════════════════════════════════════════════════════════════
   고용24 채용공고 캐시 조회 (하루 1회 수집한 것을 회사명으로 고른다)

   ── 왜 이 파일이 worknet-jobs.js 옆에 따로 있나 ──────────────
   `worknet-jobs.js` 는 워크넷 **OPEN-API** 를 그때그때 부르는 경로다. 그 API 는
   개인회원이라 막혀 있고(10-7), 열리면 그대로 살아난다 — 지우지 않았다.
   이 파일은 **공개 화면을 하루 한 번 긁어 둔 캐시**를 읽는다. 둘은 데이터도 갱신
   주기도 다르므로 한 파일에 섞지 않는다.

   ── 커버리지를 숨기지 않는다 ────────────────────────────────
   수집을 **대졸**로 좁혀서 받는다(work24-crawl.js 머리주석의 용량 계산).
   그래서 0건이 세 가지 뜻을 가진다 — 갈라서 말한다(18-4 와 같은 원칙):
     · 이 회사 공고가 캐시에 없다      → 고용24 에 안 올라왔거나, 대졸 조건 밖이다
     · 있었는데 전부 마감됐다          → 다음 공고를 기다리면 된다
     · 어제 받은 것이라 오래됐다       → 언제 받은 것인지 함께 내려보낸다

   ── 하루 지난 값이라는 것을 화면이 말할 수 있게 한다 ─────────
   API 는 부를 때가 최신이지만 크롤링은 **어제 것**이다. 공고는 마감이 생명이라
   (25-2 에서 크롤링을 접었던 이유 중 하나가 이것이다) `fetchedAt` 을 그대로 넘기고,
   마감이 지난 공고는 여기서 거른다.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { cachePath } = require('./cache-dir');
const path = require('path');
const { sameCompany, dday } = require('./company-name');
const { unescapeEntities } = require('./work24-crawl');

const CACHE = cachePath('work24-jobs.json');
const MAX_ITEMS = 8;

let _cache = null;
let _mtime = 0;

/* 파일이 바뀌면 다시 읽는다 — 수집은 하루 한 번이고 서버는 계속 떠 있다.
   서버를 재시작하지 않아도 새 공고가 보여야 한다(alio-jobs.js 와 같은 규약). */
function load() {
  let stat;
  try { stat = fs.statSync(CACHE); } catch { return null; }
  if (_cache && stat.mtimeMs === _mtime) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    _mtime = stat.mtimeMs;
    return _cache;
  } catch {
    return null;                       // 손상된 캐시는 없는 것으로 본다(서버를 죽이지 않는다)
  }
}

const isConfigured = () => Boolean(load());

/* 캐시 → 화면 공통 모양. 사람인·잡알리오·워크넷과 **같은 필드**여야 한다 —
   company-cover.js 가 소스를 구분하지 않고 그린다. */
function normalizeJob(r) {
  return {
    id: String(r.id ?? ''),
    /* 읽을 때도 엔티티를 푼다. 수집기가 이미 풀어서 담지만(work24-crawl.parseRow),
       **그 전에 받아 둔 캐시**에는 `&#039;26년 …` 이 그대로 들어 있다. 다음 수집
       때까지 화면이 깨져 있을 이유가 없다 — 이미 풀린 글자에는 아무 일도 안 한다. */
    title: unescapeEntities(r.title).trim(),
    company: unescapeEntities(r.company).trim(),
    url: r.url || null,
    closeDate: r.closeDate || null,
    /* 상시채용은 마감일이 있어도 D-day 를 띄우지 않는다 — 고용24 화면이 '채용시까지'
       로 그리는 것과 같게 맞춘다. 화면은 dday === null 을 '상시' 로 그린다. */
    dday: r.always ? null : dday(r.closeDate),
    career: r.career || null,
    edu: r.edu || null,
    region: r.region || null,
    pay: r.pay || null,
    /* 이 소스에만 있는 값. 공통 모양에는 없으니 쓰는 쪽에서만 꺼내 쓴다. */
    always: Boolean(r.always),
    labels: Array.isArray(r.labels) ? r.labels : [],
    provider: r.provider || null,
    titleTruncated: Boolean(r.titleTruncated),
  };
}

/* 아직 지원할 수 있는 공고. 상시채용은 마감이 없으므로 항상 살린다.
   마감일이 지난 것을 섞으면 학생이 그걸 보고 준비한다. */
const isOpen = j => j.always || j.dday != null;

/* 캐시를 언제 받았나. 하루가 넘었으면 화면이 그렇게 말할 수 있게 한다. */
function ageHours(data) {
  const t = Date.parse(data?.fetchedAt || '');
  return Number.isNaN(t) ? null : (Date.now() - t) / 3600000;
}

/* 회사 하나의 공고. 사람인·잡알리오·워크넷과 시그니처가 같다 —
   companyAnalysis.js 의 fetchJobs() 가 넷을 같은 방식으로 부른다.

   `newcomerOnly` 는 받는다. 수집 단계에서 이미 신입으로 좁혔으므로 여기서 더 거를
   것이 없지만, **부르는 쪽이 넷을 구분하지 않아야** 하므로 시그니처를 맞춘다. */
async function companyJobs(companyName, { newcomerOnly = false } = {}) {   // eslint-disable-line no-unused-vars
  const company = String(companyName || '').trim();
  const base = { items: [], source: 'work24', configured: isConfigured(), reason: null };
  if (company.length < 2) return base;

  const data = load();
  if (!data) {
    return { ...base, configured: false,
      reason: '고용24 채용공고 캐시가 없습니다. backend 에서 node scripts/fetch-work24-jobs.js 를 실행하세요.' };
  }

  const all = (data.items || []).map(normalizeJob).filter(j => j.title && j.company);
  const mine = all.filter(j => sameCompany(j.company, company));
  const open = mine.filter(isOpen);
  /* 마감 임박 순. 상시채용(dday null)은 뒤로 — 급한 것이 위에 있어야 한다. */
  const shown = [...open].sort((a, b) => (a.dday ?? 9999) - (b.dday ?? 9999));

  let reason = null;
  if (!shown.length) {
    if (!mine.length) {
      reason = `고용24 채용정보에 '${company}' 공고가 없습니다. `
             + '이 자료는 대졸 조건으로 받아 둔 것이라, 학력무관 공고나 자사 사이트에만 '
             + '올라온 공채는 여기서 조회되지 않습니다.';
    } else {
      reason = `'${company}' 공고 ${mine.length}건이 있지만 모두 접수가 마감됐습니다.`;
    }
  }

  return {
    ...base,
    items: shown.slice(0, MAX_ITEMS),
    matched: mine.length,
    open: open.length,
    scanned: all.length,
    fetchedAt: data.fetchedAt || null,
    ageHours: ageHours(data),
    filter: data.filter || null,
    reason,
  };
}

module.exports = {
  companyJobs, isConfigured, normalizeJob, isOpen, ageHours,
  MAX_ITEMS, CACHE_PATH: CACHE,
  _load: load,
};
