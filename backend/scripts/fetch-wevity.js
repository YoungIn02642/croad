/* 공모전·대외활동 수집 → data/wevity.json  (하루 1회)
   스펙업(#specup)의 공모전·대외활동 탭이 쓰는 캐시. 파싱은 src/wevity-crawl.js 가 한다.

   ── 왜 이 소스인가 ──
   공모전을 전국 단위로 모아 주는 공공 API 도 공공 사이트도 없다(42-1 에서 후보를
   전부 실호출해 확인했다). 지금 쓰는 온통청년은 **청년정책** 목록이라 지자체·공공
   것뿐이고 기업 공모전이 한 건도 없다(22-6). 그래서 민간 집계 사이트를 하루 한 번
   받기로 했다 — **약관·데이터베이스제작자 권리를 사용자에게 알리고 받은 결정**이다
   (2026-09-06). 지키기로 한 선은 src/wevity-crawl.js 머리주석에 적어 뒀다.

   ── 목록은 매일, 상세는 처음 보는 것만 ──
   목록만으로도 카드가 선다(제목·주최·분야·D-day·원문 링크). 상세는 **접수기간·
   주최사 홈페이지·상금**을 더해 주는데, 매일 전부 다시 열면 수백 건을 두드리게 된다.
   그래서 **캐시에 없는 항목만** 열고, 한 번에 여는 수도 막아 둔다. 못 연 것은
   다음 날 열린다 — 그동안에도 카드는 목록 값으로 정상 동작한다.

     node scripts/fetch-wevity.js --probe          # 1페이지만 받아 파서가 맞는지 본다
     node scripts/fetch-wevity.js                  # 목록 + 새 항목 상세
     node scripts/fetch-wevity.js --max-detail=0   # 목록만 (상세는 건너뛴다)
     node scripts/fetch-wevity.js --if-possible    # 빌드·자동갱신용. 실패해도 0 으로 끝난다
*/
const fs = require('fs');
const { cachePath } = require('../src/cache-dir');
const path = require('path');
const CRAWL = require('../src/wevity-crawl');

const OUT = cachePath('wevity.json');
const TIMEOUT_MS = Number(process.env.WEVITY_TIMEOUT_MS || 20000);
/* robots 가 GPTBot 에게 `Crawl-delay: 3` 을 건다. 우리는 GPTBot 이 아니지만
   **그 사이트가 밝힌 속도를 지키는 것이 맞다.** 하루 한 번이라 서두를 이유도 없다. */
const GAP_MS = Number(process.env.WEVITY_GAP_MS || 3000);
const MAX_PAGES = Number(process.env.WEVITY_MAX_PAGES || 30);
/* 접수 중이 하나도 없는 페이지가 이만큼 이어지면 과거로 들어간 것이다. */
const STALE_STOP = 2;

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const has = n => process.argv.includes(`--${n}`);

const SOFT = has('if-possible');
const bail = msg => {
  if (SOFT) { console.warn(`[wevity] 건너뜁니다 — ${msg}`); process.exit(0); }
  console.error(msg);
  process.exit(1);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 브라우저인 척하지 않는다. 우리가 누구인지 밝히고, 막을 곳은 막게 둔다. */
const UA = 'Mozilla/5.0 (compatible; croad/1.0; +https://github.com/YoungIn02642/croad)';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} (${body.length}바이트)`);
  return body;
}

(async () => {
  /* ── --probe : 파서가 화면을 따라가고 있는지 먼저 본다 ── */
  if (has('probe')) {
    const html = await get(CRAWL.listUrl(1));
    const r = CRAWL.parseList(html);
    console.log(`받은 HTML: ${(html.length / 1024).toFixed(0)}KB`);
    console.log(`목록행 ${r.rows} · 읽음 ${r.items.length} · 버림 ${r.dropped}`);
    console.log('[결측률]', CRAWL.sanity(r.items));
    for (const it of r.items.slice(0, 3)) console.log('   ', JSON.stringify(it));
    const d = CRAWL.parseDetail(await get(r.items[0].url));
    console.log('[상세 첫 건]', JSON.stringify(d, null, 1));
    return;
  }

  const maxDetail = arg('max-detail') != null ? Number(arg('max-detail')) : 80;
  const limitPages = Number(arg('pages') || MAX_PAGES);

  /* 이전 캐시 — 상세를 이미 받아 둔 항목은 다시 열지 않는다. */
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  const known = new Map((prev?.items || []).map(x => [String(x.id), x]));

  const byId = new Map();
  let scanned = 0;
  let staleStreak = 0;

  for (let page = 1; page <= limitPages; page++) {
    let r;
    try {
      r = CRAWL.parseList(await get(CRAWL.listUrl(page)));
    } catch (e) {
      if (page === 1) bail(`1페이지를 받지 못했습니다: ${e.message}`);
      console.error(`\n  ${page}페이지 실패: ${e.message} — 여기까지 씁니다`);
      break;
    }

    /* 행은 있는데 하나도 못 읽었다 = 파서가 화면 개편을 못 따라간 것이다.
       조용히 0건으로 끝내면 캐시가 지워진다(work24 수집기와 같은 규칙). */
    if (r.rows && !r.items.length) {
      bail(`\n${page}페이지에서 행 ${r.rows}개를 하나도 읽지 못했습니다.`
         + '\n  화면이 개편된 것으로 보입니다 — src/wevity-crawl.js 의 정규식을 확인하세요.');
    }
    if (!r.rows) {
      if (page === 1) bail('1페이지에 목록이 없습니다. --probe 로 확인하세요.');
      break;
    }

    scanned += r.rows;
    const open = r.items.filter(x => x.open);
    for (const x of open) byId.set(x.id, x);

    staleStreak = open.length ? 0 : staleStreak + 1;
    process.stdout.write(`\r  ${page}페이지 · 접수중 ${byId.size}건 (훑은 ${scanned})`);
    if (staleStreak >= STALE_STOP) break;      // 마감된 것만 이어지면 과거다
    await sleep(GAP_MS);
  }
  console.log('');

  if (!byId.size) bail('접수 중인 공고를 하나도 찾지 못했습니다.');

  const s = CRAWL.sanity([...byId.values()]);
  if (!s.ok && !has('force')) {
    bail(`\n읽기는 했는데 필드가 많이 비어 있습니다 — 파서가 화면을 못 따라간 것 같습니다.`
       + `\n  주최사 ${(s.withOrg * 100).toFixed(0)}% · 분야 ${(s.withField * 100).toFixed(0)}%`
       + '\n  src/wevity-crawl.js 를 고치세요. 그래도 저장하려면 --force.');
  }

  /* ── 상세: 처음 보는 항목만 ────────────────────────────────
     이미 아는 항목은 지난번에 받아 둔 상세를 그대로 얹는다. 목록 값(제목·주최·
     D-day)은 **오늘 것으로 덮는다** — 마감이 하루씩 줄어야 한다. */
  const items = [];
  const todo = [];
  for (const [id, row] of byId) {
    const old = known.get(id);
    /* **상세 규격이 올라가면 다시 연다.** 새 필드(포스터)를 넣었는데 이미 받아 둔
       항목을 건너뛰면, 그 항목에는 그 필드가 영영 안 생긴다 — 화면에서는 '왜 어떤
       카드만 표지가 없지' 로 나타나고 원인이 안 보인다. */
    const fresh = old?.detailAt && old.detailV === CRAWL.DETAIL_VERSION;
    if (fresh) items.push({ ...old, ...row, detail: old.detail, detailAt: old.detailAt, detailV: old.detailV });
    else todo.push(row);
  }

  let got = 0, failed = 0;
  for (const row of todo) {
    if (got >= maxDetail) { items.push(row); continue; }     // 남은 것은 다음 날 연다
    try {
      const d = CRAWL.parseDetail(await get(row.url));
      items.push({ ...row, detail: d, detailAt: new Date().toISOString(), detailV: CRAWL.DETAIL_VERSION });
      got++;
    } catch {
      /* 상세를 못 열어도 목록 값으로 카드는 선다. 다음 날 다시 시도된다
         (detailAt 이 안 붙었으므로 여전히 '처음 보는 항목' 이다). */
      items.push(row);
      failed++;
    }
    process.stdout.write(`\r  상세 ${got}/${Math.min(todo.length, maxDetail)}건${failed ? ` (실패 ${failed})` : ''}`);
    await sleep(GAP_MS);
  }
  if (todo.length) console.log('');

  /* 멀쩡한 캐시를 빈약한 결과로 덮지 않는다(18-5 · 6-5 와 같은 원칙). */
  if (prev?.count && items.length < prev.count * 0.3 && !has('force')) {
    bail(`\n이전 캐시는 ${prev.count}건인데 이번엔 ${items.length}건뿐입니다 (30% 미만).`
       + '\n  사이트가 일시적으로 이상할 수 있어 덮어쓰지 않았습니다. --force 로 덮어씁니다.');
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: '위비티(Wevity) 공모전·대외활동 목록',
    sourceUrl: CRAWL.ORIGIN,
    /* 무엇으로 좁혀 받았는지 남긴다 — 화면이 "대학생 응모 가능 공고 중에서"라고
       말할 수 있어야 0건이 '아무것도 없다' 로 읽히지 않는다(18-4 와 같은 이유). */
    filter: { target: '대학생', state: '접수중' },
    count: items.length,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  const withDetail = items.filter(x => x.detailAt).length;
  const withPoster = items.filter(x => x.detail?.poster).length;
  const byTopic = {};
  for (const x of items) {
    const t = CRAWL.topicOf(x.fields);
    byTopic[t] = (byTopic[t] || 0) + 1;
  }
  console.log(`저장: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  console.log(`  접수 중 ${out.count}건 · 상세 ${withDetail}건 · 포스터 ${withPoster}건 · 주최 ${new Set(items.map(x => x.org)).size}곳`);
  console.log(`  공모전 ${byTopic.contest || 0} · 대외활동 ${byTopic.activity || 0}`);
  if (todo.length > got) console.log(`  ℹ 상세 ${todo.length - got}건은 다음 실행에서 받습니다 (한 번에 ${maxDetail}건까지).`);
})().catch(e => bail(e.message));
