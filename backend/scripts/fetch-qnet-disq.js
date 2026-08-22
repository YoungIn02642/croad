/* 국가자격 응시 결격사유 수집 → data/qnet-disq.json
   스펙UP 의 자격증 카드가 "이 시험, 내가 응시할 수는 있나" 를 알려주는 데 쓴다.

   출처: 한국산업인력공단_국가자격 종목 관련 정보 조회 (data.go.kr 15068022)
         `InquiryJmcdInfoSVC/getDisqList`
   실측 2026-08-22: **80종목 · 421건.** 전부 국가전문자격이다(기사·기능사 같은
   국가기술자격에는 결격사유가 없다 — 그래서 대부분의 자격에는 이 정보가 안 붙는다).

   ── 이 API 의 규격 (실호출로 확인) ──
   · 호스트가 큐넷이고 **HTTPS 를 지원하지 않는다.** fetch-qnet-certs.js 와 같다 —
     여기만 http 인 걸 이상하게 보고 고치지 말 것.
   · 페이징이 없다시피 하다. numOfRows 를 크게 주면 전 종목이 한 번에 온다(60KB).
   · **totalCount 가 응답에 없다.** 받은 item 수가 곧 전부다. 그래서 '몇 건 중
     몇 건' 을 검증할 수 없어, 대신 종목 수가 너무 적으면 경고한다.
   · 응답 XML: <item> 반복 · jmNm(종목명) · seriesNm(계열) · seq(순번) · disqRsn(사유)

   ── 결격사유와 안내문구가 섞여 온다 ──
   `※` 로 시작하는 줄은 결격사유가 아니라 **심사 기준일 안내**다
   ("※ 결격사유 심사기준일은 제3차 시험 합격자 발표일 기준임"). 섞어서 세면
   "결격사유 9개" 가 실제보다 부풀고, 화면에서 읽는 사람이 자기가 걸리는지
   판단하는 데 방해가 된다. 그래서 `notes` 로 갈라 담는다.

   ── 본문에 HTML 이 들어 있다 ──
   실측: `&lt;font color=red&gt;※ 상기 제한기간이…&lt;/font&gt;` (공인중개사).
   그대로 화면에 넣으면 태그가 글자로 보인다. 여기서 걷어낸다.

   ── 결과물은 깃에 커밋한다 (fetch-qnet-certs.js 와 같다) ──
   결격사유는 법령에서 나오는 값이라 몇 년에 한 번 바뀐다. 60KB 라 히스토리에
   부담도 없다. 그래서 배포 빌드에 넣지 않는다 — alio·DART 처럼 매일 바뀌는
   원본만 빌드에서 받는다(루트 package.json 주석). 법이 바뀌면 손으로 다시 돌린다.

     node scripts/fetch-qnet-disq.js
     node scripts/fetch-qnet-disq.js --if-possible   # 실패해도 0 으로 끝난다
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const KEY = (process.env.DATA_GO_KR_SERVICE_KEY || '').trim();
const API = 'http://openapi.q-net.or.kr/api/service/rest/InquiryJmcdInfoSVC/getDisqList';
const OUT = path.join(__dirname, '..', 'data', 'qnet-disq.json');
const MAX_RETRY = 5;

const SOFT = process.argv.includes('--if-possible');
const bail = msg => {
  if (SOFT) { console.warn(`[qnet-disq] 건너뜁니다 — ${msg}`); process.exit(0); }
  console.error(msg);
  process.exit(1);
};

function tag(xml, name) {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
}

/* 화면에 그대로 나갈 글이라 여기서 정리해 둔다 — 읽는 쪽마다 다시 하면 갈린다. */
function clean(s) {
  return String(s || '')
    .replace(/&lt;[^&]*?&gt;/g, '')            // &lt;font color=red&gt; 같은 이스케이프된 태그
    .replace(/<[^>]*>/g, '')                   // 혹시 날것으로 오는 태그
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* 큐넷 게이트웨이는 승인된 키로도 가끔 resultCode 99 를 준다(재시도하면 된다).
   fetch-qnet-certs.js 머리주석에 같은 기록이 있다. */
async function getXml() {
  for (let i = 1; i <= MAX_RETRY; i++) {
    const res = await fetch(`${API}?serviceKey=${encodeURIComponent(KEY)}&numOfRows=3000&pageNo=1`,
      { signal: AbortSignal.timeout(30000) });
    const xml = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${xml.slice(0, 200)}`);
    const code = tag(xml, 'resultCode');
    if (code === '00' || code === '0') return xml;
    if (code === '99') { console.warn(`  resultCode 99 — 재시도 ${i}/${MAX_RETRY}`); continue; }
    throw new Error(`resultCode ${code}: ${tag(xml, 'resultMsg') || ''}`);
  }
  throw new Error(`resultCode 99 가 ${MAX_RETRY}회 이어졌습니다.`);
}

(async () => {
  if (!KEY) bail('DATA_GO_KR_SERVICE_KEY 가 .env 에 없습니다.');

  let xml;
  try { xml = await getXml(); }
  catch (e) { bail(`수집 실패: ${e.message}`); }

  const byJm = new Map();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const name = clean(tag(m[1], 'jmNm'));
    const reason = clean(tag(m[1], 'disqRsn'));
    if (!name || !reason) continue;
    if (!byJm.has(name)) byJm.set(name, { reasons: [], notes: [] });
    /* ※ 로 시작하면 결격사유가 아니라 안내문구다(머리주석 참고). */
    byJm.get(name)[/^※/.test(reason) ? 'notes' : 'reasons'].push(reason.replace(/^※\s*/, ''));
  }

  if (!byJm.size) bail('결격사유를 하나도 파싱하지 못했습니다. 응답 형식이 바뀌었는지 확인하세요.');

  const certs = {};
  for (const [name, v] of [...byJm.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
    certs[name] = {
      reasons: [...new Set(v.reasons)],
      notes: [...new Set(v.notes)],
      /* 대학생에게 실제로 걸릴 수 있는 유일한 항목이다(실측: 나이·학력 관련 문구는
         '미성년자' 뿐이었다). 화면이 이것만 따로 눈에 띄게 쓸 수 있도록 미리 표시해 둔다. */
      minorBlocked: v.reasons.some(r => r.includes('미성년자')),
    };
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: '한국산업인력공단_국가자격 종목 관련 정보 조회 (공공데이터포털 15068022)',
    sourceUrl: 'https://www.data.go.kr/data/15068022/openapi.do',
    count: Object.keys(certs).length,
    certs,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

  const minor = Object.values(certs).filter(c => c.minorBlocked).length;
  console.log(`저장: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  console.log(`  종목 ${out.count}개 · 결격사유 ${Object.values(certs).reduce((n, c) => n + c.reasons.length, 0)}건`);
  console.log(`  그중 미성년자 응시 불가 ${minor}개`);
  /* 국가전문자격은 100종이고 그중 결격사유가 있는 것이 80종쯤이다(실측).
     크게 밑돌면 한 페이지만 받고 끊긴 것이다. */
  if (out.count < 40) console.log('  ⚠ 종목이 너무 적습니다. 응답이 잘렸을 수 있어요.');
})();
