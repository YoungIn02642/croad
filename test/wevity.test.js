/* 공모전·대외활동 — 파서(src/wevity-crawl.js) 와 캐시 조회(src/wevity.js)

   네트워크를 부르지 않는다. 아래 HTML 은 **2026-09-06 실제 응답에서 그대로 옮긴
   구조**다(제목·번호만 줄였다). 구조를 지어내면 테스트만 통과하고 실제로는 안 된다.

   ── 이 테스트가 지키는 것 ──
   1) **중첩된 div 에 속지 않는가.** 분야줄(`div.sub-tit`)이 제목칸(`div.tit`) 안에
      들어 있어서, 바깥을 통째로 집으면 비탐욕 `</div>` 가 안쪽에서 닫힌다.
      처음에 그렇게 짰다가 **목록을 통째로 못 읽었다 — 에러 없이 0건이었다.**
   2) **배너 슬롯을 목록 행으로 세지 않는가.** 페이지 맨 위 광고 슬롯도 상세 링크를
      갖고 있다. 그것까지 후보로 세면 `dropped` 가 늘 12쯤 되어 파서 건강 신호로
      쓸 수 없게 된다.
   3) **어제 받은 D-day 를 오늘 그대로 쓰지 않는가.** 하루 한 번 받는 캐시라
      날짜가 지나면 D-day 가 하루씩 틀린다.
   4) **마감된 것이 목록에 남지 않는가.**
*/
const fs = require('fs');
const path = require('path');
const CRAWL = require('../backend/src/wevity-crawl.js');

const CACHE = path.join(__dirname, '..', 'backend', 'data', 'wevity.json');
const BACKUP = CACHE + '.testbak';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* 목록 한 줄 — 실제 마크업 그대로. `div.sub-tit` 이 `div.tit` **안**에 있다. */
const row = (o) => `<li ${o.bg ? "class='bg'" : ''}><!--class="bg" -->
  <div class="tit">
    <a href="?c=find&s=1&gbn=view&gp=1&ix=${o.ix}">${o.name}${o.special ? " <span class='stat spec'>SPECIAL</span> " : ''}</a>
    <div class="sub-tit">분야 : ${o.fields}</div>
  </div>
  <div class="organ">${o.org}</div>
  <div class="day">
    ${o.state === '마감' ? '마감' : `D-${o.dday}`}   <span class="dday ${o.state === '마감임박' ? 'soon' : 'ing'}">${o.state}</span>
  </div>
  <div class="read">1,234</div>
</li>`;

/* 페이지 맨 위 배너 슬롯 — 상세 링크는 있지만 목록 행이 아니다(`div.organ` 이 없다). */
const banner = (ix, name) => `<li>
  <a href="?c=find&s=1&gbn=view&gp=1&ix=${ix}"><img src="/upload/contest/x.jpg" alt="${name}"></a>
  <div class="hide-info">
    <div class="hide-dday">D-7</div>
    <div class="hide-tit"><a href="?c=find&s=1&gbn=view&gp=1&ix=${ix}">${name}</a></div>
    <div class="hide-cat">기획/아이디어, 대외활동/서포터즈</div>
  </div>
</li>`;

const page = (rows) => `<html><body>
  <ul class="banner">${banner(109883, '제8회 오티콘챌린지 공모전')}</ul>
  <nav><ul><li><a href="/">홈</a></li></ul></nav>
  <ul class="list">
    <li class="top"><div class="tit">공모전명</div><div class="organ">주최사</div></li>
    ${rows.join('\n')}
  </ul>
</body></html>`;

const HTML = page([
  row({ ix: 110678, name: '2026년 스포츠토토 숏폼 공모전', special: true, org: '국민체육진흥공단',
        fields: '광고/마케팅, 영상/UCC/사진, 대외활동/서포터즈, 기타', dday: 22, state: '접수중' }),
  row({ ix: 110675, name: '[과학기술정보통신부] 제3회 미래융합인재 발굴 소프트웨어 챌린지', org: '과학기술정보통신부',
        fields: '기획/아이디어, 웹/모바일/IT, 과학/공학', dday: 31, state: '접수중', bg: true }),
  row({ ix: 110623, name: '[CJ올리브네트웍스] AI 서비스 기획자 교육 과정 참여자 모집', org: 'CJ올리브네트웍스',
        fields: '기획/아이디어, 취업/창업', dday: 7, state: '마감임박' }),
  row({ ix: 109000, name: '지난 공모전', org: '어딘가', fields: '기타', dday: 0, state: '마감' }),
]);

/* 상세 — `<li><span class="tit">이름</span> 값 </li>` 꼴 그대로 */
const DETAIL = `<ul class="cd-info">
  <li> <span class="tit">분야</span> 광고/마케팅, 영상/UCC/사진 </li>
  <li> <span class="tit">응모대상</span> 일반인, 대학생 </li>
  <li> <span class="tit">주최/주관</span> 국민체육진흥공단 </li>
  <li> <span class="tit">후원/협찬</span> </li>
  <li class="dday-area"> <span class="tit">접수기간</span> 2026-08-25 ~ 2026-09-28
    <span class="cil-dday">D-22</span> </li>
  <li> <span class="tit">총 상금</span> 1천만원이하 </li>
  <li> <span class="tit">1등 상금</span> 200만원 </li>
  <li> <span class="tit">홈페이지</span>
    <a href="https://www.sportstoto.co.kr/main.do" target="_blank">https://www.sportstoto.co.kr/main.do</a> </li>
  <li> <span class="tit">첨부파일</span> 파일없음 </li>
</ul>`;

const ymd = d => {
  const t = new Date(); t.setDate(t.getDate() + d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

(async () => {
  console.log('── 1. 목록을 읽는다 ──');
  const r = CRAWL.parseList(HTML);
  ok('목록 행 4개만 후보로 센다 (배너·네비 제외)', r.rows === 4, `→ ${r.rows}`);
  ok('전부 읽는다', r.items.length === 4 && r.dropped === 0, `→ 읽음 ${r.items.length} · 버림 ${r.dropped}`);

  const sports = r.items.find(x => x.id === '110678');
  ok('중첩된 sub-tit 에 속지 않는다 — 제목이 온전하다',
    sports?.name === '2026년 스포츠토토 숏폼 공모전', `→ ${sports?.name}`);
  ok('광고 딱지(SPECIAL)를 제목에서 뗀다', !/SPECIAL/.test(sports?.name || ''));
  ok('분야를 쉼표로 가른다', sports?.fields.length === 4, `→ ${sports?.fields.join('/')}`);
  ok('  라벨 "분야 :" 는 값에 안 들어간다', !/분야/.test(sports?.fields[0] || ''));
  ok('주최사를 읽는다', sports?.org === '국민체육진흥공단');
  ok('D-day 는 그 사이트가 센 값을 그대로 읽는다', sports?.dday === 22);
  ok('상세 주소를 만든다', /gbn=view/.test(sports?.url || '') && /ix=110678/.test(sports?.url || ''));

  console.log('\n── 2. 접수 상태를 셋으로 가른다 ──');
  ok('접수중은 열림', sports?.open === true);
  const soon = r.items.find(x => x.id === '110623');
  ok('마감임박도 열림이다', soon?.open === true && soon?.imminent === true);
  const done = r.items.find(x => x.id === '109000');
  ok('마감은 닫힘', done?.open === false);

  console.log('\n── 3. 분야로 탭을 가른다 (이름으로 추측하지 않는다) ──');
  ok('대외활동/서포터즈가 있으면 activity', CRAWL.topicOf(sports.fields) === 'activity');
  ok('없으면 contest', CRAWL.topicOf(['기획/아이디어', '웹/모바일/IT']) === 'contest');
  ok('봉사활동도 activity', CRAWL.topicOf(['봉사활동']) === 'activity');
  ok('분야가 비면 contest 로 둔다', CRAWL.topicOf([]) === 'contest');

  console.log('\n── 4. 상세를 읽는다 (자리가 아니라 라벨로) ──');
  const d = CRAWL.parseDetail(DETAIL);
  ok('접수기간 두 날짜', d.startDate === '2026-08-25' && d.endDate === '2026-09-28', `→ ${d.startDate}~${d.endDate}`);
  ok('주최/주관', d.org === '국민체육진흥공단');
  ok('응모대상', d.target === '일반인, 대학생');
  ok('총 상금', d.prize === '1천만원이하');
  ok('1등 상금을 총 상금과 헷갈리지 않는다', d.firstPrize === '200만원', `→ ${d.firstPrize}`);
  ok('비어 있는 칸은 null', d.sponsor === null);
  ok('홈페이지는 글자가 아니라 href 를 쓴다',
    d.homepage === 'https://www.sportstoto.co.kr/main.do', `→ ${d.homepage}`);
  ok('  홈페이지가 없으면 null', CRAWL.parseDetail('<li><span class="tit">주최/주관</span> 아무개 </li>').homepage === null);

  console.log('\n── 4-1. 모집 포스터를 찾는다 (2026-09-07) ──');
  /* 상세에는 포스터가 두 장 실린다 — 265×338 고정 썸네일(og:image)과 본문 원본.
     원본에만 `cursor: zoom-in` 이 붙는다. 썸네일을 쓰면 카드 표지(269px)에서
     뭉갠다(실측: 같은 공고가 34KB vs 177KB). */
  const TWO = `<meta property="og:image" content="https://www.wevity.com/upload/contest/thumb.jpg">
    <img src="/upload/contest/thumb.jpg" alt="제목">
    <img style="display: block;cursor: zoom-in;" src="/upload/contest/full.jpg">`;
  ok('썸네일이 아니라 본문 원본을 쓴다',
    CRAWL.posterOf(TWO) === 'https://www.wevity.com/upload/contest/full.jpg', `→ ${CRAWL.posterOf(TWO)}`);
  ok('  원본이 없으면 og:image 로 물러난다',
    CRAWL.posterOf('<meta property="og:image" content="https://www.wevity.com/upload/contest/thumb.jpg">')
      === 'https://www.wevity.com/upload/contest/thumb.jpg');

  ok('og:image 를 쓴다',
    CRAWL.posterOf('<meta property="og:image" content="https://www.wevity.com/upload/contest/a.jpg">')
      === 'https://www.wevity.com/upload/contest/a.jpg');
  ok('  속성 순서가 뒤바뀌어도 읽는다',
    CRAWL.posterOf('<meta content="https://www.wevity.com/upload/contest/b.jpg" property="og:image">')
      === 'https://www.wevity.com/upload/contest/b.jpg');
  ok('og:image 가 없으면 본문 업로드 이미지로 물러난다',
    CRAWL.posterOf('<img src="/upload/contest/c.png">') === 'https://www.wevity.com/upload/contest/c.png');
  ok('  상대경로를 절대주소로 바꾼다', /^https:\/\//.test(CRAWL.posterOf('<img src="/upload/contest/c.png">')));
  ok('둘 다 없으면 null', CRAWL.posterOf('<html><body>글만 있음</body></html>') === null);
  /* 로고·아이콘을 포스터로 착각하면 카드마다 같은 그림이 뜬다. `/upload/` 만 본다. */
  ok('업로드 폴더가 아닌 이미지는 포스터가 아니다',
    CRAWL.posterOf('<img src="/images/logo.png">') === null);

  console.log('\n── 5. 파서가 조용히 깨졌는지 본다 ──');
  ok('멀쩡하면 ok', CRAWL.sanity(r.items).ok === true);
  ok('주최사가 비면 ok 가 아니다', CRAWL.sanity([{ org: '', fields: ['x'], url: 'u' }]).ok === false);
  ok('빈 배열도 ok 가 아니다', CRAWL.sanity([]).ok === false);

  console.log('\n── 6. 캐시에서 읽는다 ──');
  const hadReal = fs.existsSync(CACHE);
  if (hadReal) fs.renameSync(CACHE, BACKUP);

  /* 로고 호스트 표도 치워 둔다. 조회가 `remember()` 를 부르므로, 안 치우면
     **테스트가 진짜 표에 '가기관' 을 적어 넣는다**(처음에 실제로 그랬다).
     테스트는 남의 데이터를 건드리지 않는다 — alio·work24 테스트와 같은 규칙. */
  const LOGO = require('../backend/src/company-logo.js');
  const HOSTS = LOGO.HOSTS_PATH;
  const HOSTS_BAK = HOSTS + '.testbak';
  const hadHosts = fs.existsSync(HOSTS);
  if (hadHosts) fs.renameSync(HOSTS, HOSTS_BAK);
  LOGO._resetHosts();

  try {
    /* 어제 받은 캐시라고 두고, D-day 가 하루 줄어드는지 본다. */
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(CACHE, JSON.stringify({
      fetchedAt: yesterday,
      source: '위비티(Wevity) 공모전·대외활동 목록',
      sourceUrl: 'https://www.wevity.com',
      count: 4,
      items: [
        /* 상세를 받아 둔 것 — 접수기간이 있으니 날짜로 다시 센다 */
        { id: '1', name: '접수기간 있는 공모전', org: '가기관', fields: ['기획/아이디어'], url: 'u1',
          dday: 11, open: true, detailAt: yesterday,
          detail: { endDate: ymd(10), startDate: ymd(-5), org: '가기관', homepage: 'https://www.lg.co.kr',
                    poster: 'https://www.wevity.com/upload/contest/p1.jpg' } },
        /* 상세를 아직 못 연 것 — 받아 둔 D-day 에서 지난 날짜만큼 뺀다 */
        { id: '2', name: '상세 없는 공모전', org: '나기관', fields: ['대외활동/서포터즈'], url: 'u2',
          dday: 5, open: true },
        /* 어제는 열려 있었지만 오늘 마감된 것 — 목록에서 빠져야 한다 */
        { id: '3', name: '어제 마감된 공모전', org: '다기관', fields: ['기타'], url: 'u3',
          dday: 0, open: true },
        { id: '4', name: '날짜로 이미 지난 공모전', org: '라기관', fields: ['기타'], url: 'u4',
          dday: 30, open: true, detailAt: yesterday, detail: { endDate: ymd(-1) } },
      ],
    }), 'utf8');

    delete require.cache[require.resolve('../backend/src/wevity.js')];
    const W = require('../backend/src/wevity.js');

    const all = W.activities({});
    ok('마감된 것은 목록에서 뺀다', all.items.length === 2, `→ ${all.items.map(x => x.name).join(', ')}`);

    const a1 = all.items.find(x => x.id === 'wv-1');
    ok('접수기간을 알면 날짜로 다시 센다', a1?.dday === 10, `→ D-${a1?.dday}`);
    const a2 = all.items.find(x => x.id === 'wv-2');
    ok('모르면 받아 둔 D-day 에서 지난 날만큼 뺀다', a2?.dday === 4, `→ D-${a2?.dday} (어제 D-5)`);

    ok('탭을 나눈다', W.activities({ topic: 'contest' }).items.length === 1
      && W.activities({ topic: 'activity' }).items.length === 1);

    ok('출처를 항목에 남긴다', a1?.source === 'wevity');
    ok('지역을 지어내지 않는다', a1?.region === null);
    ok('요약 대신 분야를 적는다', a1?.summary === '기획/아이디어', `→ ${a1?.summary}`);

    console.log('\n── 7. 표지 — 포스터 → 로고 → 이모지 ──');
    ok('홈페이지를 아는 기관은 로고 주소를 준다',
      a1?.logo === `/api/specup/logo?name=${encodeURIComponent('가기관')}`, `→ ${a1?.logo}`);
    ok('모르는 기관은 null (화면이 이모지로 물러난다)', a2?.logo === null);
    /* ── 포스터는 기본이 켜짐이다 (2026-09-07 꺼 둠 → 2026-09-14 사용자 결정) ──────
       주최사 저작물을 받아 우리 서버에서 다시 내보내는 일이라 처음에는 껐다.
       사용자 결정으로 켜되 **끄는 길을 남기는 것이 조건**이었다(wevity.js 주석) —
       문제 제기가 들어오면 `WEVITY_POSTER=off` 한 줄로 즉시 되돌려야 한다.
       그래서 이 검사가 지키는 것은 '켜져 있다' 가 아니라 **'끌 수 있다'** 다. */
    ok('기본값은 켜짐 — 포스터 주소를 준다', W.POSTER_ON === true && a1?.poster === '/api/specup/poster?id=wv-1',
      `→ POSTER_ON=${W.POSTER_ON} poster=${a1?.poster}`);
    ok('  원본 주소도 내준다 (서버가 받아 올 수 있다)',
      W.posterUrlOf('wv-1') === 'https://www.wevity.com/upload/contest/p1.jpg');
    ok('  캐시에는 그대로 있다', 
      W.load().items.find(x => x.id === '1')?.detail?.poster === 'https://www.wevity.com/upload/contest/p1.jpg');

    /* **끄는 스위치가 실제로 듣는가.** 모듈이 require 때 env 를 읽으므로 캐시를 비우고
       다시 들여온다 — 이 검사가 없으면 '되돌릴 수 있다' 는 주석만 남고 확인은 아무도
       안 한 것이 된다(되돌릴 일이 생겼을 때가 하필 급한 때다). */
    {
      const before = process.env.WEVITY_POSTER;
      process.env.WEVITY_POSTER = 'off';
      const path = require('path');
      const key = require.resolve('../backend/src/wevity.js');
      delete require.cache[key];
      const Woff = require('../backend/src/wevity.js');
      ok('  WEVITY_POSTER=off 로 끌 수 있다', Woff.POSTER_ON === false,
        `→ POSTER_ON=${Woff.POSTER_ON}`);
      ok('  껐을 때는 원본 주소도 안 내준다 (받아 오는 경로가 닫힌다)',
        Woff.posterUrlOf('wv-1') === null);
      delete require.cache[key];
      if (before === undefined) delete process.env.WEVITY_POSTER; else process.env.WEVITY_POSTER = before;
      require('../backend/src/wevity.js');
    }
    ok('포스터가 없는 항목도 null', a2?.poster === null);

    /* 상세의 '홈페이지' 칸은 접수처 주소인 경우가 많다. 실측 190건 중
       wevity.com 25 · instagram 8 · blog.naver 8 · cafe.daum 8 · sotong.go.kr 7.
       그대로 쓰면 국민체육진흥공단 공모전에 네이버 로고가 붙는다. */
    ok('  위비티 자기 도메인은 로고로 안 쓴다', W.isPlatform('www.wevity.com'));
    ok('  네이버 블로그도 안 쓴다', W.isPlatform('blog.naver.com'));
    ok('  국민생각함(부처 공용 창구)도 안 쓴다', W.isPlatform('sotong.go.kr'));
    ok('  진짜 기관 도메인은 쓴다', !W.isPlatform('arlico.co.kr') && !W.isPlatform('gsia-sw.kr'));
    ok('  이름만 비슷한 남의 도메인을 막지 않는다', !W.isPlatform('mynaver.com'));

    console.log('\n── 8. 두 소스를 합친다 ──');
    const youth = [{ name: '청년정책 제안 경연대회', region: '울산', source: 'youth' },
                   { name: '2026년 스포츠토토 숏폼 공모전', region: '전국', source: 'youth' }];
    const wv = [{ name: '2026년 스포츠토토 숏폼 공모전', region: null, source: 'wevity' },
                { name: '새 공모전', region: null, source: 'wevity' }];
    const merged = W.merge(youth, wv);
    ok('겹치면 하나만 남는다', merged.length === 3, `→ ${merged.length}`);
    ok('  겹칠 때 온통청년 것을 남긴다 (지역이 붙어 있다)',
      merged.find(x => /스포츠토토/.test(x.name))?.source === 'youth');
    ok('안 겹치는 것은 그대로 더한다', merged.some(x => x.name === '새 공모전'));
  } finally {
    try { if (fs.existsSync(CACHE)) fs.unlinkSync(CACHE); } catch {}
    try { if (fs.existsSync(HOSTS)) fs.unlinkSync(HOSTS); } catch {}
    if (hadHosts) fs.renameSync(HOSTS_BAK, HOSTS);
    LOGO._resetHosts();
  }

  console.log('\n── 9. 캐시가 없으면 무엇을 하면 되는지 말한다 ──');
  try {
    delete require.cache[require.resolve('../backend/src/wevity.js')];
    const FRESH = require('../backend/src/wevity.js');
    const gone = FRESH.activities({});
    ok('죽지 않는다', Array.isArray(gone.items) && gone.items.length === 0);
    ok('configured=false', gone.configured === false);
    ok('무엇을 하면 되는지 알려준다', /fetch-wevity/.test(gone.reason || ''), `→ ${gone.reason}`);
  } finally {
    if (hadReal) fs.renameSync(BACKUP, CACHE);
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
