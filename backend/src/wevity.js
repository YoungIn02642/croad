/* ════════════════════════════════════════════════════════════
   공모전·대외활동 캐시 조회 (하루 1회 받아 둔 것을 탭으로 나눈다)

   ── 온통청년과 어떻게 나눠 쓰나 ─────────────────────────────
   둘 다 살린다. 겹치는 데이터가 아니다:

   · 온통청년 : **청년정책**이라 지자체·공공 것뿐이다(22-6). 대신 **지역**이 붙어 와서
     "내 동네 것인가"를 카드에서 바로 가른다. 실측 38건
   · 위비티   : 기업·대학·부처 공모전이 들어온다. 대신 지역 정보가 없다. 실측 193건

   합칠 때 **한쪽을 다른 쪽으로 번역하지 않는다.** 같은 모양(specup.toActivity 의
   결과)으로 맞추되, 어디서 온 것인지 `source` 를 남긴다 — 화면이 출처를 밝혀야
   하고(위비티 자료를 우리가 모은 것처럼 보이면 안 된다), 한쪽이 죽었을 때
   어느 쪽이 빈 것인지 알 수 있어야 한다.

   ── 겹치는 공고를 두 번 보여주지 않는다 ─────────────────────
   부처 공모전은 양쪽에 다 올라올 수 있다. 이름을 정규화해 대조한다. 겹치면
   **온통청년 것을 남긴다** — 지역이 붙어 있어 카드가 더 쓸모 있기 때문이다.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { cachePath } = require('./cache-dir');
const path = require('path');
const CRAWL = require('./wevity-crawl');

const CACHE = cachePath('wevity.json');

let _cache = null;
let _mtime = 0;

/* 파일이 바뀌면 다시 읽는다 — 수집은 하루 한 번이고 서버는 계속 떠 있다. */
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

/* 오늘 기준 D-day. **목록이 준 dday 를 그대로 쓰지 않는다** — 어제 받아 둔 값이라
   하루가 지나면 하루씩 틀린다. 접수기간을 아는 것은 날짜로 다시 세고, 모르는 것만
   받아 둔 값에서 지난 날짜만큼 뺀다. 그 사실을 화면이 말할 수 있게 `stale` 을 준다. */
function ddayOf(item, fetchedAt, today = new Date()) {
  const end = item.detail?.endDate;
  if (end) {
    const [y, m, d] = end.split('-').map(Number);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const t1 = new Date(y, m - 1, d);
    const days = Math.round((t1 - t0) / 86400000);
    return days >= 0 ? days : null;                   // 지난 것은 null (걸러진다)
  }
  if (item.dday == null) return null;
  const aged = Math.floor((Date.now() - Date.parse(fetchedAt || '')) / 86400000);
  const left = item.dday - (Number.isFinite(aged) ? aged : 0);
  return left >= 0 ? left : null;
}

/* 캐시 항목 → 화면 공통 모양. specup.js 의 toActivity 가 만드는 것과 **같은 필드**여야
   한다 — 화면(specup.js actCard)이 출처를 구분하지 않고 그린다. */
function toActivity(item, fetchedAt, today) {
  const dday = ddayOf(item, fetchedAt, today);
  const d = item.detail || {};
  return {
    id: `wv-${item.id}`,
    name: item.name,
    topic: CRAWL.topicOf(item.fields),
    /* **목록의 주최사를 먼저 쓴다.** 상세의 '주최/주관' 은 둘을 이어 붙여 와서
       '한국문화정보원 / (주)스튜디오프리윌루전, AI-Kive' 처럼 길다 — 카드 한 줄에
       안 들어가고, 로고를 찾는 이름으로도 못 쓴다. 목록은 대표 한 곳만 준다. */
    org: item.org || d.org || '',
    /* 요약을 지어내지 않는다. 목록에는 본문이 없고 우리는 본문을 가져오지 않는다
       (그건 원문 사이트가 할 일이다). 대신 **분야**를 적는다 — 카드에서 실제로
       읽히는 값이고, 그 사이트가 붙여 준 분류 그대로다. */
    summary: (item.fields || []).join(' · '),
    keywords: (item.fields || []).slice(0, 4),
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    dday,
    /* 온통청년 항목에는 지역이 붙지만 여기는 없다. **모르는 것을 '전국' 이라고
       적지 않는다** — 그러면 학생이 지원 자격을 잘못 읽는다. null 로 두면 화면이
       분야로 물러난다. */
    region: null,
    period: null,
    prize: d.prize || null,
    /* 카드 표지의 주관기관 로고를 여기서 가져온다(사용자 결정 2026-09-06).
       상세를 아직 못 연 항목은 null 이고, 화면이 이모지로 물러난다. */
    homepage: d.homepage || null,
    /* 모집 포스터가 있으면 표지를 그것으로 채운다(사용자 지시 2026-09-07).
       **주소를 화면에 그대로 주지 않는다** — 우리 주소로 바꿔 준다(아래 withLogo).
       포스터 > 로고 > 이모지 순으로 물러난다. */
    hasPoster: Boolean(d.poster),
    url: item.url,
    source: 'wevity',
  };
}

const norm = s => String(s || '').replace(/[\s[\]()·・,.-]/g, '').toLowerCase();

/* ── 카드 표지의 주관기관 로고 (사용자 결정 2026-09-06) ──────
   채용공고에 만든 company-logo.js 를 그대로 쓴다. 그 모듈의 규약이 여기서도 맞다:
   **화면은 주소를 고르지 못하고, 기관 이름만 보낸다.** 주소는 서버가 상세에서 읽어
   둔 홈페이지다(company-logo.js 머리주석의 SSRF 이야기와 같다).

   홈페이지를 모르는 항목은 `logo: null` 이고 화면이 이모지로 물러난다 — 상세를
   아직 못 연 항목이 그렇다(수집기가 하루에 여는 수를 막아 둔다).

   ── 주최사를 가리키지 않는 주소는 로고로 쓰지 않는다 ────────
   상세의 '홈페이지' 칸은 **접수처 주소**인 경우가 많다. 190건을 세어 보니:

     wevity.com 25 · instagram.com 8 · blog.naver.com 8 · cafe.daum.net 8 ·
     sotong.go.kr 7(국민생각함) · bhuntr.com 2 …

   그대로 쓰면 **국민체육진흥공단 공모전에 네이버 로고**가 붙고, 25장에는 위비티
   자기 로고가 붙는다. 로고는 "누가 여는 공모전인가"를 한눈에 주는 값인데, 저러면
   그 반대가 된다 — 없느니만 못하다. 그래서 **플랫폼 도메인은 아예 안 쓴다**
   (카드가 이모지로 물러난다).

   판정을 여기 두는 이유: '이 주소가 주최사를 가리키는가' 는 이 소스를 알아야 할 수
   있는 판단이다. company-logo.js 는 주소를 받으면 그 도메인의 로고를 가져오는 일만
   한다 — 거기에 섞으면 회사 리포트까지 이 목록에 끌려간다. */
const PLATFORM_HOSTS = [
  'wevity.com',                                   // 우리가 긁어 온 사이트 자신
  'naver.com', 'daum.net', 'kakao.com', 'tistory.com',
  'instagram.com', 'facebook.com', 'youtube.com', 'twitter.com', 'x.com',
  'google.com', 'gle', 'notion.site', 'notion.so', 'linktr.ee', 'litt.ly',
  'bhuntr.com', 'modoo.at', 'wixsite.com', 'campuspick.com', 'linkareer.com',
  'sotong.go.kr',                                 // 국민생각함 — 부처 공용 창구다
  '1365.go.kr', 'vms.or.kr',                      // 자원봉사 포털 — 접수처지 주최사가 아니다
];

/* 호스트가 위 목록에 속하는가. `blog.naver.com` 처럼 하위 도메인으로 오므로
   **끝자리가 맞는지**를 본다. `mynaver.com` 같은 남의 도메인이 걸리지 않게
   점 경계까지 확인한다. */
function isPlatform(host) {
  const h = String(host || '').toLowerCase();
  return PLATFORM_HOSTS.some(p => h === p || h.endsWith(`.${p}`));
}

/* ── 포스터는 허락을 받기 전까지 끈다 (2026-09-07) ──────────
   목록의 사실(제목·주최·마감)을 인용하는 것과, **주최사의 저작물인 포스터를 받아
   우리 서버에서 다시 내보내는 것**은 무게가 다르다. 위비티 이용약관 제7조 2항도
   '제3자의 저작권을 침해하지 않아야 한다' 고 적고 있다.

   위비티에 인용 허락을 문의해 둔 상태라, **답이 오기 전에는 기본값이 꺼짐**이다.
   허락이 오면 `.env` 에 `WEVITY_POSTER=on` 한 줄이면 그대로 켜진다 — 기능을
   지우지 않고 스위치만 둔 이유다.

   꺼져 있으면 카드는 **주관기관 로고 → 이모지**로 물러난다. 화면 코드는 이미
   그렇게 되어 있어서 손댈 것이 없다(specup.js coverArt). */
const POSTER_ON = String(process.env.WEVITY_POSTER || '').toLowerCase() === 'on';

function withLogo(a) {
  /* 포스터 주소도 **id 로만** 준다. 화면이 남의 주소를 직접 부르지 않게 하려는 것이고
     (company-logo.js 머리주석), 서버가 캐시에서 그 id 의 주소를 찾아 받아 둔다. */
  const poster = (POSTER_ON && a.hasPoster) ? `/api/specup/poster?id=${encodeURIComponent(a.id)}` : null;

  if (!a.org || !a.homepage) return { ...a, poster, logo: null };
  const LOGO = require('./company-logo');
  const host = LOGO.hostOf(a.homepage);
  if (!host || isPlatform(host)) return { ...a, poster, logo: null };
  LOGO.remember(a.org, a.homepage);
  return { ...a, poster, logo: `/api/specup/logo?name=${encodeURIComponent(a.org)}` };
}

/* id(`wv-110452`) → 그 공고의 포스터 원본 주소. **라우트가 이걸로만 받는다.**
   꺼져 있으면 주소를 내주지 않는다 — 라우트가 이것 하나만 보므로 여기서 막으면
   받아 오는 경로 자체가 닫힌다. */
function posterUrlOf(id) {
  if (!POSTER_ON) return null;
  const data = load();
  if (!data) return null;
  const raw = String(id || '').replace(/^wv-/, '');
  const it = (data.items || []).find(x => String(x.id) === raw);
  return it?.detail?.poster || null;
}

/* 캐시 → 활동 목록. 마감이 지난 것은 여기서 뺀다(어제 받은 자료라 오늘 마감이
   지난 것이 섞인다 — 목록에 남기면 학생이 그걸 보고 준비한다). */
function activities({ topic = null, today } = {}) {
  const data = load();
  if (!data) {
    return { items: [], source: 'wevity', configured: false, fetchedAt: null,
      reason: '공모전 캐시가 없습니다. backend 에서 node scripts/fetch-wevity.js 를 실행하세요.' };
  }

  const all = (data.items || [])
    .map(x => toActivity(x, data.fetchedAt, today))
    .filter(a => a.name && a.dday != null)
    .map(withLogo);

  const items = topic ? all.filter(a => a.topic === topic) : all;
  return {
    items,
    source: 'wevity',
    configured: true,
    fetchedAt: data.fetchedAt || null,
    sourceName: data.source || null,
    sourceUrl: data.sourceUrl || CRAWL.ORIGIN,
    filter: data.filter || null,
    scanned: all.length,
    reason: null,
  };
}

/* 두 소스를 합친다. 이름이 같은 것은 **온통청년 쪽을 남긴다**(지역이 붙어 있다).
   `keep` 이 먼저 들어오는 쪽이다. */
function merge(keep, add) {
  const seen = new Set(keep.map(a => norm(a.name)));
  const out = [...keep];
  for (const a of add) {
    const k = norm(a.name);
    if (k && seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

module.exports = {
  activities, merge, toActivity, ddayOf, isConfigured, load, isPlatform, withLogo, posterUrlOf,
  POSTER_ON,
  CACHE_PATH: CACHE, PLATFORM_HOSTS, _norm: norm,
};
