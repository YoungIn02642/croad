/* 고용24 채용정보 수집 → data/work24-jobs.json  (하루 1회)
   회사 리포트의 '채용공고' 칸이 쓰는 캐시. 파싱은 src/work24-crawl.js 가 한다.

   ── 왜 크롤링인가 ──
   고용24 채용정보 OPEN-API(210L01)는 **기업·기관 회원 전용**이라 개인회원 계정으로는
   승인이 나도 호출이 막힌다(10-7 · 34-2, 세 번 확인). 사람인 API 는 심사가 나지 않았다.
   그래서 **같은 데이터를 공개 화면에서 하루 한 번 읽는다**(사용자 지시 2026-09-06).
   지키는 선은 src/work24-crawl.js 머리주석에 적어 뒀다.

   ── 잡알리오와 무엇이 다른가 ──
   잡알리오는 **공공기관만** 담는다. 고용24 는 사람인·잡코리아·인크루트 공고까지
   함께 실어 **민간이 들어온다** — 회사 리포트에서 0건이던 자리가 이걸로 채워진다.

     node scripts/fetch-work24-jobs.js --probe    # 1페이지만 받아 파서가 맞는지 본다
     node scripts/fetch-work24-jobs.js            # 전량 수집 (대졸)
     node scripts/fetch-work24-jobs.js --pages=3  # 앞 3페이지만 (시험용)
     node scripts/fetch-work24-jobs.js --if-possible   # 빌드용. 실패해도 0 으로 끝난다
*/
const fs = require('fs');
const { cachePath } = require('../src/cache-dir');
const path = require('path');
const CRAWL = require('../src/work24-crawl');

const OUT = cachePath('work24-jobs.json');
const TIMEOUT_MS = Number(process.env.WORK24_TIMEOUT_MS || 30000);
/* 페이지 사이에 쉰다. 하루 한 번 40여 회라 서두를 이유가 없고, 남의 서버다. */
const GAP_MS = Number(process.env.WORK24_GAP_MS || 1200);
/* 실측 22,507건(대졸) = 226페이지. 여유를 두되 무한정 돌지는 않게 한다 —
   화면 개편으로 마지막 페이지를 못 알아채면 여기서 멈춘다. */
const MAX_PAGES = Number(process.env.WORK24_MAX_PAGES || 300);

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const has = n => process.argv.includes(`--${n}`);

/* 빌드에서 부를 때 붙인다. 고용24 가 잠깐 죽어도 **배포를 막지 않는다** —
   공고 칸만 비고 나머지는 그대로 뜬다(fetch-alio-jobs.js 와 같은 규약). */
const SOFT = has('if-possible');
const bail = msg => {
  if (SOFT) { console.warn(`[work24] 건너뜁니다 — ${msg}`); process.exit(0); }
  console.error(msg);
  process.exit(1);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 브라우저인 척하지 않는다. 우리가 누구인지 밝히고, 막을 곳은 막게 둔다
   (posting-fetch.js 와 같은 규약). */
const UA = 'Mozilla/5.0 (compatible; croad/1.0; +https://github.com/YoungIn02642/croad)';

async function getPage(page) {
  const res = await fetch(CRAWL.listUrl(page), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} (${body.length}바이트)`);
  /* 200 인데 로그인 화면이나 점검 안내가 오는 일이 있다. 그대로 파싱하면 0건이
     '수집 완료' 로 지나간다 — 목록 화면이 맞는지 먼저 본다. */
  if (!/검색건수/.test(body)) {
    throw new Error('목록 화면이 아닙니다 (점검 중이거나 주소가 바뀌었을 수 있습니다)');
  }
  return body;
}

/* 캐시에 남길 필드. 화면(src/work24-jobs.js)이 읽는 것만 남긴다 —
   원문이 필요하면 url 로 간다(alio 수집기와 같은 규칙). */
const slim = j => ({
  id: j.id, company: j.company, title: j.title, url: j.url,
  closeDate: j.closeDate, always: j.always, postedDate: j.postedDate,
  career: j.career, edu: j.edu, region: j.region, pay: j.pay, provider: j.provider,
  /* 기업규모 딱지(대기업·중견)와 '제목이 잘렸다' 표시. 파서는 읽는데 여기서 안 담아
     화면까지 못 갔던 적이 있다 — 캐시에 없으면 없는 값이 된다. */
  labels: j.labels?.length ? j.labels : undefined,
  titleTruncated: j.titleTruncated || undefined,
});

(async () => {
  /* ── --probe : 파서가 화면을 따라가고 있는지 먼저 본다 ──
     화면 개편은 예고 없이 온다. 전량을 받기 전에 1페이지로 확인한다. */
  if (has('probe')) {
    const html = await getPage(1);
    const r = CRAWL.parseList(html);
    console.log(`받은 HTML: ${(html.length / 1024).toFixed(0)}KB`);
    console.log(`검색건수(화면): ${r.total?.toLocaleString() ?? '?'} · 행 ${r.rows} · 읽음 ${r.items.length} · 버림 ${r.dropped}`);
    console.log('[결측률]', CRAWL.sanity(r.items));
    console.log('[첫 건]');
    for (const [k, v] of Object.entries(r.items[0] || {})) {
      console.log('   ', k.padEnd(12), String(v ?? '').slice(0, 70));
    }
    return;
  }

  const limitPages = Number(arg('pages') || MAX_PAGES);
  const byId = new Map();
  let total = null;
  let scanned = 0;

  for (let page = 1; page <= limitPages; page++) {
    let r;
    try {
      r = CRAWL.parseList(await getPage(page));
    } catch (e) {
      /* 1페이지가 안 되면 받을 게 없다. 도중이면 거기까지 쓴다 —
         **빈 응답을 '수집 완료' 로 넘기지 않는다**(18-5 와 같은 원칙). */
      if (page === 1) bail(`1페이지를 받지 못했습니다: ${e.message}`);
      console.error(`\n  ${page}페이지 실패: ${e.message} — 여기까지 씁니다`);
      break;
    }
    if (total == null) total = r.total;

    /* 행은 있는데 하나도 못 읽었다 = 파서가 화면 개편을 못 따라간 것이다.
       조용히 0건으로 끝내면 캐시가 지워진다. 여기서 멈추고 말한다. */
    if (r.rows && !r.items.length) {
      bail(`\n${page}페이지에서 행 ${r.rows}개를 하나도 읽지 못했습니다.`
         + '\n  화면이 개편된 것으로 보입니다 — src/work24-crawl.js 의 정규식을 확인하세요.'
         + '\n  --probe 로 원문을 확인할 수 있습니다.');
    }
    if (!r.items.length) break;                 // 마지막 페이지를 지났다

    scanned += r.rows;
    for (const j of r.items) if (j.id) byId.set(j.id, slim(j));
    process.stdout.write(`\r  ${page}페이지 · 읽은 ${byId.size}건${total ? ` / 검색건수 ${total.toLocaleString()}` : ''}`);

    if (r.items.length < CRAWL.QUERY.resultCnt) break;
    if (byId.size >= (total ?? Infinity)) break;
    await sleep(GAP_MS);
  }
  console.log('');

  const items = [...byId.values()];
  if (!items.length) bail('공고를 하나도 읽지 못했습니다. --probe 로 확인하세요.');

  /* 저장 전에 파서가 조용히 깨졌는지 본다. 필드가 빈 채로 저장되면 며칠 뒤
     학생 화면에서야 발견된다(6-3 부류). */
  const s = CRAWL.sanity(items);
  if (!s.ok && !has('force')) {
    bail(`\n읽기는 했는데 필드가 많이 비어 있습니다 — 파서가 화면을 못 따라간 것 같습니다.`
       + `\n  링크 ${(s.withUrl * 100).toFixed(0)}% · 마감(또는 상시) ${(s.withClose * 100).toFixed(0)}%`
       + '\n  src/work24-crawl.js 를 고치세요. 그래도 저장하려면 --force.');
  }

  /* 멀쩡한 캐시를 빈약한 결과로 덮지 않는다(18-5 · 6-5 와 같은 원칙). */
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  if (prev?.count && items.length < prev.count * 0.3 && !has('force')) {
    bail(`\n이전 캐시는 ${prev.count}건인데 이번엔 ${items.length}건뿐입니다 (30% 미만).`
       + '\n  고용24 가 일시적으로 이상할 수 있어 덮어쓰지 않았습니다. --force 로 덮어씁니다.');
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: '고용24 채용정보 (공개 화면 · 하루 1회)',
    sourceUrl: CRAWL.ORIGIN + CRAWL.LIST_PATH,
    /* 무엇으로 좁혀 받았는지 남긴다. 화면이 "대졸·신입 공고 중에서" 라고 말할 수
       있어야 0건이 "안 뽑는다" 로 읽히지 않는다(18-4 와 같은 이유). */
    filter: { academicGbn: CRAWL.QUERY.academicGbn, note: '학력 대졸(2~3년·4년)' },
    total: total ?? items.length,
    count: items.length,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  const companies = new Set(items.map(j => j.company)).size;
  const providers = {};
  for (const j of items) providers[j.provider || '?'] = (providers[j.provider || '?'] || 0) + 1;
  console.log(`저장: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)}MB)`);
  console.log(`  공고 ${out.count}건 · 회사 ${companies}곳 · 훑은 행 ${scanned}`);
  console.log(`  정보제공처: ${Object.entries(providers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (companies < 10) console.log('  ⚠ 회사가 너무 적습니다. 한 페이지만 받고 끊겼을 수 있어요.');
})().catch(e => bail(e.message));
