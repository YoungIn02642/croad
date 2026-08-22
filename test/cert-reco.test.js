/* 자격증 추천 — src/cert-reco.js

   네트워크도 DB 도 부르지 않는다. 자격 카탈로그는 인자로 받고, 채용공고는 캐시
   파일만 읽는 순수 로직이라 여기서 전부 검증된다(alio-jobs.test.js 와 같은 방식).

   ── 무엇을 지키는 테스트인가 ──
   이 모듈이 답하는 질문은 "이 직무에서 실제로 보는 자격증인가" 다. 그래서
   **틀린 추천이 나가지 않는 것**을 주로 본다. 실제로 겪은 두 가지가 회귀 대상이다:
     · 금융·보험 직무에 포장기술사·공장관리기술사가 떴다 ('경영.회계.사무' 한 칸)
     · 여행·숙박 직무 추천 8칸이 전부 '관광통역안내사(언어별)' 였다 */
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'backend', 'data', 'alio-jobs.json');
const BACKUP = CACHE + '.certrecobak';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* 진짜 캐시가 있으면 잠시 치워 둔다 — 테스트가 남의 데이터를 건드리지 않는다.
   그리고 **집계 결과가 실제 공고 수에 따라 흔들리지 않아야** 한다. */
const hadReal = fs.existsSync(CACHE);
if (hadReal) fs.renameSync(CACHE, BACKUP);

const ymd = offsetDays => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/* 실제 잡알리오 응답에서 확인한 필드만 쓴다(2026-08-15 실호출). */
const posting = (o) => ({
  recrutPblntSn: o.id, instNm: o.inst, recrutPbancTtl: o.title || '채용 공고',
  pbancBgngYmd: ymd(-10), pbancEndYmd: o.end ?? ymd(14),
  srcUrl: 'https://example.go.kr/notice', recrutSeNm: o.se ?? '신입',
  acbgCondNmLst: '학력무관', workRgnNmLst: '대전', hireTypeNmLst: '정규직',
  ncsCdNmLst: o.ncs,
  aplyQlfcCn: o.qual || '',
  prefCn: o.pref || '',
});

fs.writeFileSync(CACHE, JSON.stringify({
  fetchedAt: '2026-08-15T14:12:47.337Z',
  source: 'test',
  total: 3,
  count: 3,
  items: [
    posting({ id: 1, inst: '한국전력공사', ncs: '정보통신',
              pref: '정보처리기사 자격증 소지자 우대' }),
    posting({ id: 2, inst: '한국조폐공사', ncs: '정보통신',
              qual: '정보처리기사 소지자' }),
    posting({ id: 3, inst: '국민건강보험공단', ncs: '경영.회계.사무',
              pref: '컴퓨터활용능력 1급 소지자 우대' }),
  ],
}, null, 1));

/* 캐시를 바꿔 끼웠으므로 모듈을 새로 읽는다(집계를 한 번만 하고 담아 두기 때문). */
delete require.cache[require.resolve('../backend/src/cert-reco.js')];
const R = require('../backend/src/cert-reco.js');

/* 카탈로그 픽스처 — 실제 DB 가 주는 모양 그대로(catalog-db.certCatalog).
   국가전문자격은 field 가 **빈 값**이다. 그게 이 모듈이 보정하는 대상이다. */
const CERTS = [
  { id: '정보처리기사', kind: 'national-tech', kindLabel: '국가기술자격', grade: '기사', field: '정보통신' },
  { id: '정보관리기술사', kind: 'national-tech', kindLabel: '국가기술자격', grade: '기술사', field: '정보통신' },
  { id: '정보처리산업기사', kind: 'national-tech', kindLabel: '국가기술자격', grade: '산업기사', field: '정보통신' },
  { id: 'SQLD', kind: 'private', kindLabel: '민간·해외자격', grade: null, field: '정보통신' },
  { id: '컴퓨터활용능력 1급', kind: 'private', kindLabel: '민간·해외자격', grade: null, field: '경영.회계.사무' },
  { id: '포장기술사', kind: 'national-tech', kindLabel: '국가기술자격', grade: '기술사', field: '경영.회계.사무' },
  { id: '품질경영기사', kind: 'national-tech', kindLabel: '국가기술자격', grade: '기사', field: '경영.회계.사무' },
  { id: '금융투자분석사', kind: 'private', kindLabel: '민간·해외자격', grade: null, field: '경영.회계.사무' },
  { id: 'CFA Level 1', kind: 'private', kindLabel: '민간·해외자격', grade: null, field: '경영.회계.사무' },
  { id: 'CFA Level 2', kind: 'private', kindLabel: '민간·해외자격', grade: null, field: '경영.회계.사무' },
  { id: '공인노무사', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '변리사', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '사회복지사 1급', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '관광통역안내사(영어)', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '관광통역안내사(일본어)', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '관광통역안내사(중국어)', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '국내여행안내사', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
  { id: '국가유산수리기술자(단청)', kind: 'national-pro', kindLabel: '국가전문자격', grade: null, field: '' },
];

const reco = opts => R.recommend({ certs: CERTS, limit: 8, ...opts });
const names = r => r.items.map(i => i.name);

// ── 기준 고르기 ──────────────────────────────────────────────
{
  console.log('\n[기준]');
  const mid = reco({ jobMiddles: ['13'] });
  ok('세부직무가 있으면 그 기준', mid.basis === 'jobMiddle', `→ ${mid.basis}`);

  const maj = reco({ jobMajor: '1' });
  ok('세부직무가 없으면 진출분야 기준', maj.basis === 'jobMajor', `→ ${maj.basis}`);

  /* 학과는 **대비책**이다. 직무가 있으면 직무가 이겨야 한다 —
     같은 학과에서도 가는 직무가 갈리고, 자격증은 직무를 따라간다. */
  const both = reco({ jobMiddles: ['13'], dept: 'business' });
  ok('직무가 학과를 이긴다', both.basis === 'jobMiddle', `→ ${both.basis}`);
  ok('학과 자격이 안 섞인다', !names(both).includes('컴퓨터활용능력 1급'), `→ ${names(both)}`);

  const dept = reco({ dept: 'cs' });
  ok('직무가 없으면 학과 기준', dept.basis === 'dept', `→ ${dept.basis}`);

  const none = reco({});
  ok('아무것도 없으면 빈 결과', none.basis === null && none.items.length === 0);
  ok('빈 결과에도 죽지 않는다', Array.isArray(none.items) && none.fields.length === 0);

  /* 매핑에 없는 코드가 오면 아무것도 내지 않는다. 억지로 이어 붙이면 엉뚱한
     자격이 추천으로 나가는데, 그건 0개보다 나쁘다. */
  const unknown = reco({ jobMiddles: ['99'] });
  ok('모르는 직무 코드는 빈 결과', unknown.items.length === 0, `→ ${names(unknown)}`);
}

// ── 직무분야 보정 (실제로 틀렸던 자리) ───────────────────────
{
  console.log('\n[직무분야 보정]');
  const fin = reco({ jobMiddles: ['03'] });          // 금융·보험직
  ok('금융 직무에 금융 자격이 뜬다', names(fin).includes('금융투자분석사'), `→ ${names(fin)}`);
  ok('금융 직무에 포장기술사가 안 뜬다', !names(fin).includes('포장기술사'));
  ok('금융 직무에 품질경영기사가 안 뜬다', !names(fin).includes('품질경영기사'));

  const office = reco({ jobMiddles: ['02'] });        // 경영·행정·사무직
  ok('사무 직무에 컴활이 뜬다', names(office).includes('컴퓨터활용능력 1급'), `→ ${names(office)}`);
  ok('사무 직무에 공장·포장 계열이 안 뜬다',
    !names(office).some(n => /포장|품질경영|공장관리/.test(n)));
  ok('사무 직무에 공인노무사가 뜬다', names(office).includes('공인노무사'));

  /* 큐넷이 직무분야를 안 주는 국가전문자격 100종. 보정하지 않으면 통째로 빠진다. */
  const law = reco({ jobMiddles: ['22'] });           // 법률직
  ok('법률 직무에 변리사가 뜬다', names(law).includes('변리사'), `→ ${names(law)}`);

  const welfare = reco({ jobMiddles: ['23'] });       // 사회복지·종교직
  ok('복지 직무에 사회복지사가 뜬다', names(welfare).includes('사회복지사 1급'), `→ ${names(welfare)}`);

  /* 근거의 출처를 구분해 내보낸다 — 화면이 '큐넷 직무분야' 와 'C:road 분류' 를
     섞어 말하지 않게. */
  const it = reco({ jobMiddles: ['13'] });
  const 정처기 = it.items.find(i => i.name === '정보처리기사');
  ok('큐넷이 준 분야는 qnet', 정처기 && 정처기.fieldSource === 'qnet', `→ ${정처기?.fieldSource}`);
  const 노무사 = office.items.find(i => i.name === '공인노무사');
  ok('우리가 보정한 분야는 croad', 노무사 && 노무사.fieldSource === 'croad', `→ ${노무사?.fieldSource}`);
}

// ── 계열 묶기 ────────────────────────────────────────────────
{
  console.log('\n[계열 묶기]');
  const travel = reco({ jobMiddles: ['52'] });        // 여행·숙박·오락 서비스직
  const 관광 = names(travel).filter(n => n.startsWith('관광통역안내사'));
  ok('관광통역안내사는 하나만', 관광.length === 1, `→ ${관광}`);
  ok('다른 자격이 밀려나지 않는다', names(travel).includes('국내여행안내사'), `→ ${names(travel)}`);

  const it = reco({ jobMiddles: ['13'] });
  const 정처 = names(it).filter(n => n.startsWith('정보처리'));
  ok('정보처리 기사/산업기사도 하나만', 정처.length === 1, `→ ${정처}`);
  ok('남는 자리에 다른 자격이 들어온다', names(it).includes('SQLD'), `→ ${names(it)}`);
}

// ── 줄 세우기 ────────────────────────────────────────────────
{
  console.log('\n[정렬]');
  const it = reco({ jobMiddles: ['13'] });
  ok('공고에 뜬 자격이 맨 위', names(it)[0] === '정보처리기사', `→ ${names(it)[0]}`);

  /* 기술사는 실무 경력이 있어야 응시할 수 있다. 대학생 화면에서 위로 올라오면
     추천 목록이 통째로 '지금은 못 따는 것' 이 된다. */
  const 기술사 = names(it).indexOf('정보관리기술사');
  const sqld = names(it).indexOf('SQLD');
  ok('기술사가 SQLD 보다 아래', 기술사 > sqld, `→ 기술사 ${기술사} / SQLD ${sqld}`);
}

// ── 공고 근거 ────────────────────────────────────────────────
{
  console.log('\n[공고 근거]');
  const it = reco({ jobMiddles: ['13'] });
  const 정처기 = it.items.find(i => i.name === '정보처리기사');
  ok('공고 건수를 센다', 정처기.postings === 2, `→ ${정처기.postings}`);
  ok('근거 공고를 함께 준다', 정처기.samples.length > 0 && !!정처기.samples[0].url);
  ok('언급 없는 자격은 0건', it.items.find(i => i.name === 'SQLD').postings === 0);

  /* 전체 건수를 쓰면 어디서나 언급되는 자격이 모든 직무에서 1등이 된다.
     이 직무의 분야에서만 세야 한다. */
  const office = reco({ jobMiddles: ['02'] });
  const 컴활 = office.items.find(i => i.name === '컴퓨터활용능력 1급');
  ok('다른 분야 공고는 안 센다', 컴활.postings === 1, `→ ${컴활.postings}`);

  ok('표본 출처를 함께 준다', it.postings.total === 3 && /잡알리오/.test(it.postings.source),
    `→ ${it.postings.total}건 · ${it.postings.source}`);
  ok('언제 받은 자료인지 준다', it.postings.fetchedAt === '2026-08-15T14:12:47.337Z');
}

// ── 시행기관 ─────────────────────────────────────────────────
{
  console.log('\n[시행기관]');
  ok('국가기술자격은 산업인력공단', R.issuerOf({ id: '정보처리기사', kind: 'national-tech' }) === '한국산업인력공단');
  ok('국가전문자격도 산업인력공단', R.issuerOf({ id: '공인노무사', kind: 'national-pro' }) === '한국산업인력공단');
  /* ── 주관 부처를 시행기관으로 적지 않는다 (2026-08-22 정정) ──
     한때 국가유산수리기술자를 '국가유산청' 으로 넣어 뒀다. 주관은 국가유산청이지만
     **시험을 시행하는 곳은 한국산업인력공단**이다(산업인력공단 시험일정 API 가
     이 종목의 회차를 내준다 — cert-reco.js ISSUER_EXCEPTIONS 주석의 실측 기록).
     같은 착각이 다시 들어오는 것을 여기서 막는다. */
  ok('주관 부처가 따로여도 시행기관은 산업인력공단',
    R.issuerOf({ id: '국가유산수리기술자(단청)', kind: 'national-pro' }) === '한국산업인력공단',
    `→ ${R.issuerOf({ id: '국가유산수리기술자(단청)', kind: 'national-pro' })}`);
  ok('소방시설관리사도 마찬가지',
    R.issuerOf({ id: '소방시설관리사', kind: 'national-pro' }) === '한국산업인력공단');
  ok('민간자격은 발급기관표', R.issuerOf({ id: 'SQLD', kind: 'private' }) === '한국데이터산업진흥원');
  ok('대한상공회의소 시행분', R.issuerOf({ id: '컴퓨터활용능력 1급', kind: 'private' }) === '대한상공회의소');

  /* **모르는 것은 만들지 않는다.** 표에 없는 민간자격은 null 이고, 화면은 빈칸을
     내줘서 학생이 직접 적는다. 여기서 그럴듯한 기관명을 지어내면 틀린 값이
     조용히 저장된다. */
  ok('모르는 민간자격은 null', R.issuerOf({ id: '없는자격', kind: 'private' }) === null);

  const it = reco({ jobMiddles: ['13'] });
  ok('추천에 시행기관이 실린다',
    it.items.every(i => i.issuer === null || typeof i.issuer === 'string'));
  ok('정보처리기사에 기관이 붙는다',
    it.items.find(i => i.name === '정보처리기사').issuer === '한국산업인력공단');
}

// ── 분류 이름 정규화 ─────────────────────────────────────────
{
  console.log('\n[분류 정규화]');
  /* 큐넷과 잡알리오가 같은 분류를 다르게 적는다. 한쪽으로 모아야 대조가 된다. */
  ok('환경.에너지 → 환경.에너지.안전', R.ncs('환경.에너지') === '환경.에너지.안전');
  ok('안전관리 → 환경.에너지.안전', R.ncs('안전관리') === '환경.에너지.안전');
  ok('영업.판매 → 영업판매', R.ncs('영업.판매') === '영업판매');
  ok('모르는 이름은 그대로', R.ncs('정보통신') === '정보통신');
  ok('공백은 다듬는다', R.ncs('  보건.의료 ') === '보건.의료');
}

// ── 캐시가 없어도 죽지 않는다 ────────────────────────────────
{
  console.log('\n[캐시 없음]');
  fs.unlinkSync(CACHE);
  delete require.cache[require.resolve('../backend/src/cert-reco.js')];
  const FRESH = require('../backend/src/cert-reco.js');
  const r = FRESH.recommend({ certs: CERTS, jobMiddles: ['13'], limit: 8 });
  ok('추천은 그대로 나온다', r.items.length > 0, `→ ${r.items.length}개`);
  ok('공고 건수만 0', r.items.every(i => i.postings === 0));
  ok('표본 0건이라고 말한다', r.postings.total === 0);
}

// 정리 — 진짜 캐시를 되돌린다
try { if (fs.existsSync(CACHE)) fs.unlinkSync(CACHE); } catch { /* 이미 지웠다 */ }
if (hadReal) fs.renameSync(BACKUP, CACHE);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
