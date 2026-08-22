/* 공공기관 채용공고 (잡알리오) — src/alio-jobs.js

   네트워크를 부르지 않는다. 캐시 파일을 읽어 회사명으로 고르고 마감·신입 조건으로
   거르는 순수 로직이라 여기서 전부 검증된다(company-sectors.test.js 와 같은 방식).

   필드 이름은 **실제 응답에서 확인한 것**을 쓴다(2026-08-15 실호출).
   추정한 이름으로 테스트를 짜면 테스트만 통과하고 실제로는 안 된다 — 공정위 API
   때 명세를 추정했다가 통째로 틀렸다(작업정리 3-1). */
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'backend', 'data', 'alio-jobs.json');
const BACKUP = CACHE + '.testbak';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* 진짜 캐시가 있으면 잠시 치워 둔다 — 테스트가 남의 데이터를 건드리지 않는다. */
const hadReal = fs.existsSync(CACHE);
if (hadReal) fs.renameSync(CACHE, BACKUP);

const ymd = offsetDays => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/* 실제 응답에서 본 필드만 쓴다 */
const rec = (o) => ({
  recrutPblntSn: o.id, instNm: o.inst, recrutPbancTtl: o.title,
  pbancBgngYmd: ymd(-10), pbancEndYmd: o.end,
  srcUrl: 'https://example.go.kr/notice', recrutSeNm: o.se ?? '신입',
  acbgCondNmLst: '학력무관', workRgnNmLst: '대전', hireTypeNmLst: '정규직',
  /* 실제 공고에서 뽑은 결의 문장을 쓴다. '결격사유 없는 자'·'장애인 우대' 같은
     정형문구를 넣으면 stripBoilerplate 가 걸러내서(그게 맞다) 픽스처가 비어 버린다. */
  ncsCdNmLst: '보건.의료',
  aplyQlfcCn: '임상병리사 면허 소지자로서 관련 분야 업무 경험이 있는 자',
  prefCn: '정보처리기사 등 관련 자격증 소지자 우대, 데이터 분석 업무 경험자 우대',
});

fs.writeFileSync(CACHE, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  count: 5,
  items: [
    rec({ id: 1, inst: '한국보훈복지의료공단', title: '전문의 공개채용', end: ymd(7) }),
    rec({ id: 2, inst: '한국보훈복지의료공단', title: '행정직 채용',    end: ymd(2) }),
    rec({ id: 3, inst: '한국보훈복지의료공단', title: '경력직 채용',    end: ymd(5), se: '경력' }),
    rec({ id: 4, inst: '(주)한국보훈복지의료공단', title: '법인격 표기 다름', end: ymd(3) }),
    rec({ id: 5, inst: '한국철도공사',        title: '마감된 공고',    end: ymd(-3) }),
  ],
}), 'utf8');

delete require.cache[require.resolve('../backend/src/alio-jobs.js')];
const ALIO = require('../backend/src/alio-jobs.js');

(async () => {
  console.log('── 1. 캐시가 곧 설정이다 ──');
  ok('캐시가 있으면 configured', ALIO.isConfigured() === true);

  console.log('\n── 2. 회사명으로 고른다 ──');
  const r = await ALIO.companyJobs('한국보훈복지의료공단');
  ok('그 기관 공고만 나온다', r.items.every(j => j.company.includes('한국보훈복지의료공단')));
  /* '(주)' 표기 차이로 같은 기관을 놓치면 안 된다 — company-name.js 와 규칙을 공유한다. */
  ok('법인격 표기가 달라도 같은 기관으로 본다', r.items.some(j => j.id === '4'),
     `→ ${r.items.map(j => j.id).join(',')}`);
  ok('다른 기관은 섞이지 않는다', !r.items.some(j => j.company.includes('철도')));

  console.log('\n── 3. 마감된 공고는 보여주지 않는다 ──');
  const rail = await ALIO.companyJobs('한국철도공사');
  ok('마감 공고는 목록에서 빠진다', rail.items.length === 0);
  /* 0건의 이유를 갈라 말해야 학생이 할 일을 안다. */
  ok('"있었지만 마감됐다"고 말한다', /마감/.test(rail.reason || ''), `→ ${rail.reason}`);
  ok('찾은 건수는 그대로 알려준다', rail.matched === 1);

  console.log('\n── 4. 없는 회사와 마감된 회사를 구분한다 ──');
  const priv = await ALIO.companyJobs('삼성전자');
  ok('민간 기업은 0건', priv.items.length === 0);
  /* 이 화면이 제일 조심해야 할 오해 — "삼성이 채용을 안 한다"로 읽히면 안 된다. */
  ok('민간이 없는 자료임을 밝힌다', /공공기관 공고만/.test(priv.reason || ''), `→ ${priv.reason}`);

  console.log('\n── 5. 신입 필터 ──');
  const all = await ALIO.companyJobs('한국보훈복지의료공단');
  const newbie = await ALIO.companyJobs('한국보훈복지의료공단', { newcomerOnly: true });
  ok('필터 없으면 경력 공고도 포함', all.items.some(j => j.career === '경력'));
  ok('필터를 켜면 경력 전용은 빠진다', !newbie.items.some(j => j.career === '경력'));
  /* 값이 비어 있는 것을 '경력직'으로 단정하면 실제 기회를 지운다. */
  ok('구분이 비어 있으면 거르지 않는다', ALIO.newcomerOk({ career: null }) === true);
  ok("'신입+경력'은 통과", ALIO.newcomerOk({ career: '신입+경력' }) === true);

  console.log('\n── 6. 마감 임박 순 ──');
  ok('D-day 오름차순', all.items.every((j, i) => i === 0 || all.items[i - 1].dday <= j.dday),
     `→ ${all.items.map(j => j.dday).join(',')}`);

  console.log('\n── 7. 다른 소스와 같은 모양 ──');
  /* 화면(company-cover.js)이 사람인·워크넷·잡알리오를 구분하지 않고 그린다.
     한 필드라도 이름이 다르면 그 칸만 조용히 빈다. */
  const j = all.items[0];
  for (const k of ['id', 'title', 'company', 'url', 'closeDate', 'dday', 'career', 'edu', 'region', 'jobType']) {
    ok(`공통 필드 ${k}`, k in j);
  }
  ok('source 를 밝힌다', all.source === 'alio');
  /* 자소서 코치가 공고 칸을 채우는 재료. 다만 이것만으로 역량이 다 잡히지는
     않는다 — 8장 참고. */
  ok('지원자격·우대사항도 실어 보낸다', Boolean(j.qualification && j.preference));

  console.log('\n── 8. 공고 정형문구 걸러내기 ──');
  /* 공공기관 공고의 지원자격·우대사항에는 직무 요건보다 **법정 가점·전형 안내**가
     많다. 안 거르면 역량 추출이 그걸 근거로 집어 든다 — 화면에는 '역량 카드에
     엉뚱한 인용문'으로 나타나고, 에러가 안 나서 더 나쁘다(6-3 부류).

     ⚠ 이 필터로도 절반은 역량이 안 잡힌다(532건 실측). 저 필드는 애초에 **응시
     요건**이지 역량 서술이 아니다 — 화면 문구가 그 사실을 그대로 말한다. */
  const strip = ALIO.stripBoilerplate;

  // 실제 응답에서 반복 횟수를 세어 고른 것들 (532건 기준)
  ok('취업지원대상자 가점 안내를 버린다',
     strip('「국가유공자 등 예우 및 지원에 관한 법률」에 따른 취업지원 대상자는 가점을 받습니다') === null);
  ok('장애인 가점 안내를 버린다',
     strip('장애인: 장애인의 가점은 만점의 3%를 적용하며 전형마다 반영합니다') === null);
  ok('첨부파일 참조 안내를 버린다',
     strip('※ 자세한 사항은 첨부파일의 채용공고문을 참조하시기 바랍니다.') === null);
  ok('블라인드 채용 안내를 버린다',
     strip('우리 기관은 정부의 블라인드 채용 가이드라인에 따라 응시절차 및 방법을 준수하고 있습니다') === null);
  ok('결격사유 조항을 버린다',
     strip('공단 인사규정 제18조(결격사유 및 임용취소)에 해당하지 않는 자여야 합니다') === null);
  ok('연령 제한 안내를 버린다',
     strip('입사지원서 접수 마감일 현재 만 18세 이상이면서 60세 미만인 자에 한합니다') === null);

  /* ── 여기가 핵심이다 ──
     처음 필터는 '우대' 가 든 줄을 통째로 버려서 **진짜 우대사항까지 날렸다.**
     역량 0개인 공고가 110 → 222건으로 늘어난 것으로 확인하고 되돌렸다.
     애매하면 남긴다 — 남은 노이즈는 한 번 보이고 말지만 지운 신호는 못 되찾는다. */
  const real = strip('정보처리기사 등 관련 자격증 소지자 우대하며 데이터 분석 경험자를 찾습니다');
  ok('진짜 우대사항은 남긴다', real !== null && real.includes('자격증'), `→ ${JSON.stringify(real)}`);
  ok('직무 요건은 남긴다', strip('빅데이터분석 기사 취득 후 관련분야 7년 이상 종사한 자') !== null);

  ok('빈 값은 null', strip('') === null && strip(null) === null);

  // 노이즈와 신호가 섞인 줄글에서 신호만 남는지
  const mixed = strip([
    '- 컴퓨터공학 전공자로 SQL 활용이 가능한 자',
    '- 「국가유공자 등 예우 및 지원에 관한 법률」에 따른 취업지원 대상자는 가점 부여',
    '※ 자세한 사항은 첨부파일의 채용공고문을 참조',
  ].join('\n'));
  ok('섞여 있으면 신호만 남긴다',
     mixed !== null && mixed.includes('SQL') && !mixed.includes('국가유공자') && !mixed.includes('첨부파일'),
     `→ ${JSON.stringify(mixed)}`);

  /* ── 직무로 찾는 공고 (2026-08-22 신규) ─────────────────────
     회사가 아니라 **고른 직무**로 찾는다. CAS 화면이 "이 직무 적합도" 옆에
     "그래서 지금 어디서 뽑는가" 를 붙이는 데 쓴다.
     픽스처 공고는 전부 ncsCdNmLst='보건.의료' 다 → KECO 30(보건·의료직)에 걸린다. */
  console.log('\n── 8-1. 직무로 찾는 공고 ──');
  const health = ALIO.jobPostings({ jobMiddles: ['30'] });
  ok('직무 분야로 공고를 찾는다', health.items.length > 0, `→ ${health.items.length}건`);
  ok('무슨 분야로 찾았는지 알려준다', health.fields.includes('보건.의료'), `→ ${health.fields}`);
  ok('마감 공고는 빠진다', !health.items.some(j => j.id === '5'));
  ok('기본은 신입만', !health.items.some(j => j.id === '3'), `→ ${health.items.map(j => j.id)}`);
  ok('경력도 보려면 끌 수 있다',
    ALIO.jobPostings({ jobMiddles: ['30'], newcomerOnly: false }).items.some(j => j.id === '3'));
  ok('마감 임박 순', health.items.every((j, i, a) => i === 0 || a[i - 1].dday <= j.dday),
    `→ ${health.items.map(j => j.dday)}`);

  /* 매핑에 없는 분야는 0건이다. 그때 "이 직무는 채용이 없다" 로 읽히지 않게
     **공공기관 공고만 들어 있다는 사실**을 사유에 적는다. */
  const farm = ALIO.jobPostings({ jobMiddles: ['90'] });      // 농림어업직
  ok('안 걸리면 0건', farm.items.length === 0);
  ok('공공기관 자료라는 걸 밝힌다', /공공기관/.test(farm.reason || ''), `→ ${farm.reason}`);

  const noJob = ALIO.jobPostings({});
  ok('직무가 없으면 무엇을 하면 되는지 말한다', /직무를 고르면/.test(noJob.reason || ''),
    `→ ${noJob.reason}`);

  /* 세부직무가 없으면 진출분야로 넓힌다 — 자격증 추천과 같은 규칙이다. */
  const byMajor = ALIO.jobPostings({ jobMajor: '3' });        // 보건·의료직
  ok('진출분야만으로도 찾는다', byMajor.items.length > 0, `→ ${byMajor.items.length}건`);

  console.log('\n── 9. 캐시가 없을 때 ──');
  fs.unlinkSync(CACHE);
  delete require.cache[require.resolve('../backend/src/alio-jobs.js')];
  const FRESH = require('../backend/src/alio-jobs.js');
  const none = await FRESH.companyJobs('한국보훈복지의료공단');
  ok('죽지 않는다', Array.isArray(none.items) && none.items.length === 0);
  ok('configured=false', none.configured === false);
  ok('무엇을 하면 되는지 알려준다', /fetch-alio-jobs/.test(none.reason || ''), `→ ${none.reason}`);

  // 정리 — 진짜 캐시를 되돌린다
  try { if (fs.existsSync(CACHE)) fs.unlinkSync(CACHE); } catch {}
  if (hadReal) fs.renameSync(BACKUP, CACHE);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
