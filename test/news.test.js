/* 회사 뉴스 키워드 추출 테스트
   네트워크를 타지 않는다 — 가짜 기사를 함수에 직접 넣어 '무엇을 키워드로 보는가'만 검증한다.
   이 기능의 위험은 느린 것이 아니라 **엉뚱한 말을 자소서 키워드라고 내미는 것**이라,
   걸러내기가 제대로 도는지가 핵심이다. */
const NEWS = require('../backend/src/news');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS ' : '  FAIL '), name, extra); };

const items = [
  { title: '아주산업, 에스와이삼양과 특수콘크리트 기술협력 맞손',
    summary: '아주산업이 21일 서울 서초구 본사에서 전략적 파트너십 MOU를 체결했다고 밝혔다.',
    url: 'https://www.news1.kr/industry/123' },
  { title: '아주산업 특수콘크리트 사업 확대… 기술협력 잇는다',
    summary: '아주산업은 에스와이삼양과 MOU를 맺고 파트너십을 통해 77만원 규모 계약을 전개한다.',
    url: 'https://www.yna.co.kr/view/AKR123' },
  { title: '아주산업 보도자료 | Aju 홈페이지',
    summary: 'www.aju.co.kr/kor/about/news/view.do 보도자료 목록입니다.',
    url: 'https://www.aju.co.kr/kor/about/news/list.do' },
];

const kws = NEWS.newsKeywords(items, '아주산업');
const terms = kws.map(k => k.term);

console.log('── 1. 실제로 반복된 말을 뽑는가 ──');
ok('특수콘크리트', terms.includes('특수콘크리트'), `→ ${terms.join(', ')}`);
ok('에스와이삼양', terms.includes('에스와이삼양'));
ok('기술협력', terms.includes('기술협력'));
ok('MOU 같은 영문 약어도 남긴다', terms.includes('MOU'));

console.log('\n── 2. 자소서 키워드가 아닌 것을 걸러내는가 ──');
ok('회사명 자체는 키워드가 아니다', !terms.includes('아주산업'));
ok('주소 조각(www·view·about)이 섞이지 않는다',
   !terms.some(t => ['www', 'view', 'about', 'news', 'list', 'kr', 'co'].includes(t.toLowerCase())), `→ ${terms.join(', ')}`);
ok('기사 주소의 영문 사명(Aju)이 키워드로 남지 않는다', !terms.some(t => t.toLowerCase() === 'aju'));
ok('숫자로 시작하는 말(77만원·21일)은 뺀다', !terms.some(t => /^\d/.test(t)));
ok('서술어(밝혔다·체결했다)는 뺀다', !terms.some(t => t.length >= 3 && /다$/.test(t)));
ok('뉴스 관용어(보도자료)는 뺀다', !terms.includes('보도자료'));

console.log('\n── 3. 근거를 추적할 수 있는가 ──');
const one = kws.find(k => k.term === '특수콘크리트');
ok('키워드마다 등장한 기사 번호를 남긴다', Array.isArray(one.articles) && one.articles.length === one.count,
   `→ 기사 ${one.articles.join(',')} / ${one.count}건`);
ok('한 기사에 여러 번 나와도 1건으로 센다', kws.every(k => k.count <= items.length));
ok('기사 1건에만 나온 말은 버린다', kws.every(k => k.count >= 2));

console.log('\n── 4. HTML·주소 정리 ──');
ok('수치 실체참조(&#x27;)가 x27 로 남지 않는다',
   !NEWS.tokenize('맞손 &#x27; 기술협력').includes('x27'));
ok('빈 입력에도 죽지 않는다', NEWS.newsKeywords([], '아무회사').length === 0);

console.log('\n── 5. 지원동기 작성 지침 ──');
const g = NEWS.MOTIVE_GUIDE;
ok('작성 순서 골격이 있다', g.frame.includes('①') && g.frame.includes('⑤'));
ok('감점 표현을 알려준다', g.avoid.length >= 2 && g.avoid.some(a => a.includes('성장하는 기업')));
ok('면접 예상질문이 있다', !!g.followup);

console.log('\n── 6. 주간 대표 기사 ──');
/* 이 기능의 위험은 '엉뚱한 기사를 그 주의 대표라고 내미는 것' 과
   '같은 사건인데 말머리 때문에 안 묶여서 화제성이 1로 보이는 것' 두 가지다. */
const NOW = Date.parse('2026-07-29');
const ago = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
/* 3개월(90일)을 18일씩 5구간으로 끊는다: 구간0=0~18일, 구간1=18~36일, 구간2=36~54일…
   구간마다 대표 한 건. ago(95)는 90일 밖이라 빠진다. */
const wItems = [
  { title: '삼성전자, HBM4 양산 시작', summary: '반도체 수주 계약', url: 'u1', date: ago(1) },   // 구간0
  { title: '[단독] 삼성전자, HBM4 양산 시작한다', summary: '', url: 'u2', date: ago(2) },
  { title: '삼성전자 HBM4 양산 시작 — 종합', summary: '', url: 'u3', date: ago(2) },
  { title: '삼성전자가 HBM4 양산을 시작했다', summary: '', url: 'u9', date: ago(3) },
  { title: '삼성전자 사회공헌 행사', summary: '봉사', url: 'u4', date: ago(3) },
  { title: '삼성전자 신제품 냉장고 출시', summary: '', url: 'u5', date: ago(20) },                // 구간1 (비트렌드)
  { title: '삼성전자 하반기 공채 시작, 신입 채용 확대', summary: '조직 개편', url: 'u6', date: ago(20) }, // 구간1 (트렌드)
  { title: '삼성전자 미국 진출 투자 발표', summary: '신사업 전략', url: 'u7', date: ago(40) },      // 구간2
  { title: '삼성전자 오래된 기사', summary: '', url: 'u8', date: ago(95) },                       // 90일 밖 → 제외
];
const clustered = NEWS.cluster(wItems);
const hbm = clustered.find(c => c.title.includes('HBM4'));
ok('말머리(단독·종합)와 어미가 달라도 같은 사건으로 묶는다', hbm.count === 4, `→ ${hbm.count}건`);
ok('대표 제목은 가장 짧은 것을 쓴다', hbm.title === '삼성전자, HBM4 양산 시작', `→ ${hbm.title}`);
ok('대표 제목과 링크가 같은 기사에서 온다', hbm.url === 'u1', `→ ${hbm.url}`);

const picks = NEWS.weeklyPicks(clustered, NOW);
ok('구간마다 한 건씩만 고른다', new Set(picks.map(p => p.week)).size === picks.length);
ok('3개월(90일) 밖 기사는 뺀다', !picks.some(p => p.title.includes('오래된')), `→ ${picks.map(p => p.week).join(',')}`);
ok('여러 언론사가 다룬 기사가 그 구간의 대표가 된다',
   picks[0].title.includes('HBM4') && picks[0].outlets === 4);
ok('화제성이 같으면 직무트렌드 기사를 올린다',
   picks.find(p => p.week === 1)?.title.includes('공채'),
   `→ ${picks.find(p => p.week === 1)?.title}`);
ok('시기 라벨을 붙인다(최근/약 N주 전)',
   picks[0].weekLabel === '최근' && picks.some(p => /주 전$/.test(p.weekLabel)));
ok('최대 5건을 넘지 않는다', picks.length <= NEWS.PICKS);
ok('날짜가 없으면(웹 폴백) 시기별 정리를 만들지 않는다',
   NEWS.weeklyPicks(NEWS.cluster([{ title: '삼성전자 무언가', summary: '', url: 'x', date: null }]), NOW).length === 0);

/* 실측 회귀: '아주산업' 이번 주 대표가 본문에 회사명이 한 번 스친 남의 기사
   ("박춘원 전북은행장 무거운 발걸음")로 뽑혔다. 제목에 회사가 있는 기사를 우선해야 한다. */
const loose = [
  { title: '박춘원 전북은행장 무거운 발걸음', summary: '아주산업 등 지역 기업과 협약', url: 'a', date: ago(1) },
  { title: '박춘원 전북은행장 무거운 발걸음은', summary: '아주산업 협약', url: 'b', date: ago(1) },
  { title: '아주산업, 특수콘크리트 기술 협력', summary: '', url: 'c', date: ago(2) },
];
const loosePick = NEWS.weeklyPicks(NEWS.cluster(loose), NOW, '아주산업')[0];
ok('제목에 회사명이 있는 기사를 대표로 올린다 (화제성이 낮아도)',
   loosePick.title.startsWith('아주산업'), `→ ${loosePick.title}`);
ok('제목 우선이라도 같은 주 기사 수는 전부 센다', loosePick.alsoInWeek === 1);
ok('제목에 회사가 있으면 looseMatch 가 아니다', loosePick.looseMatch === false);

const onlyLoose = NEWS.weeklyPicks(NEWS.cluster([loose[0]]), NOW, '아주산업')[0];
ok('제목 후보가 하나도 없으면 그때만 본문 언급을 쓰고 경고를 남긴다',
   onlyLoose && onlyLoose.looseMatch === true, `→ ${onlyLoose?.title}`);

console.log('\n── 6-1. 최신 뉴스 (1주일) ──');
/* 이 목록의 위험은 하나다 — '최신'이라고 적힌 자리에 옛날 기사가 앉는 것.
   주간 대표(구간마다 한 건)와 달리 **1주일 안이면 여러 건을 다 보여준다**. */
const recent = NEWS.recentPicks(clustered, NOW, '삼성전자');
ok('1주일 안 기사만 넣는다',
   recent.every(r => Date.parse(r.date) >= NOW - NEWS.RECENT_DAYS * 86400000),
   `→ ${recent.map(r => r.date).join(', ')}`);
ok('20일 전 기사는 최신이 아니다', !recent.some(r => r.title.includes('공채')));
ok('최신순으로 세운다',
   recent.every((r, i) => i === 0 || r.date <= recent[i - 1].date),
   `→ ${recent.map(r => r.date).join(' ≥ ')}`);
/* 주간 대표는 한 구간에서 한 건만 뽑는다. 같은 주에 사건이 둘이면 하나가 사라지는데,
   그게 사용자가 지적한 "최신 뉴스가 없음" 의 실체다. 최신 목록은 둘 다 보여준다. */
ok('같은 주의 다른 사건을 함께 보여준다 (주간 대표는 한 건만 뽑는다)',
   recent.length > 1 && NEWS.weeklyPicks(clustered, NOW).filter(p => p.week === 0).length === 1,
   `→ 최신 ${recent.length}건`);
ok('며칠 전인지 붙인다', recent.every(r => typeof r.daysAgo === 'number' && r.daysAgo >= 0));
ok('날짜가 없으면(웹 폴백) 최신 목록을 만들지 않는다',
   NEWS.recentPicks(NEWS.cluster([{ title: '삼성전자 무언가', summary: '', url: 'x', date: null }]), NOW).length === 0);
ok('최대 5건을 넘지 않는다', recent.length <= NEWS.MAX_ITEMS);
/* 제목 우선 규칙은 주간 대표와 같아야 한다 — 스쳐 지나간 언급이 '최신' 머리에 앉으면 안 된다. */
const looseRecent = NEWS.recentPicks(NEWS.cluster(loose), NOW, '아주산업');
ok('제목에 회사가 있는 기사를 먼저 올린다',
   looseRecent[0].title.startsWith('아주산업'), `→ ${looseRecent[0].title}`);

/* ── 목록용 중복 제거 (dedupeStories) ─────────────────────────
   회사 리포트의 '최근 기사 5건'이 실제로 서로 다른 사건 5개여야 한다.
   아래 제목들은 2026-08-09 삼성전자 실제 응답에서 그대로 가져온 것이다 —
   5건이 뜨는데 사건은 '히트펌프'와 '테일러팹 인턴' 둘뿐이었다. */
const story = (title, i) => ({ title, summary: '', url: `s${i}`, date: '2026-08-09' });
const realFive = [
  '삼성전자, 美 국립연구소와 영하 30도 극저온 차세대 히트펌프 기술 개발',
  '영하 30도에서 온수 콸콸…삼성전자, 美연구소와 기술 개발',
  '삼성전자, 영하 30도 견디는 난방기술 개발한다…알래스카서 실증',
  '삼성전자, 美 테일러팹 첫 인턴 뽑는다…가동 앞두고 인재 확보 속도',
  '삼성전자, 美 테일러팹 인턴 선발…대만 TSMC와 인재 쟁탈전',
].map(story);

const distinct = NEWS.dedupeStories(realFive, '삼성전자');
ok('같은 사건을 다룬 기사는 한 건으로 줄인다 (실측 5건 → 2건)',
   distinct.length === 2, `→ ${distinct.length}건`);
ok('대표는 먼저 온 기사다 (관련도 순서를 유지한다)',
   distinct[0].title.includes('국립연구소') && distinct[1].title.includes('첫 인턴'),
   `→ ${distinct.map(d => d.title.slice(0, 14)).join(' / ')}`);

/* 문턱을 낮추면 흔한 단어 두어 개만 겹쳐도 남남이 묶인다. 서로 다른 사건은
   반드시 남아 있어야 한다 — 소재를 하나 지우는 쪽이 중복보다 나쁘다. */
const differentEvents = [
  '삼성전자, HBM4 양산 라인 증설 검토',
  '삼성전자, 파운드리 2나노 수주 확대',
  '삼성전자, 인도 공장 가동률 상향',
].map(story);
ok('서로 다른 사건은 하나도 지우지 않는다',
   NEWS.dedupeStories(differentEvents, '삼성전자').length === 3);

/* 회사명을 빼고 세지 않으면, 모든 기사가 회사명 하나로 겹쳐 보인다. */
const twoWordTitles = [
  '삼성전자 실적 발표', '삼성전자 신규 채용',
].map(story);
ok('회사명만 겹치는 짧은 제목은 같은 사건으로 보지 않는다',
   NEWS.dedupeStories(twoWordTitles, '삼성전자').length === 2);

ok('제목이 비어 토큰이 없으면 목록에서 뺀다',
   NEWS.dedupeStories([story('', 0), ...differentEvents], '삼성전자').length === 3);

/* ── 회사 이야기가 아닌 기사 걸러내기 (onTopic) ─────────────
   실측(2026-08 'KT'): 5건 중 3건이 프로야구 KT위즈 기사였다. 구단 이름이 회사명과
   같은 회사가 많아서, 이 걸러내기가 없으면 '최근 이슈'가 야구 순위표가 된다. */
const art = (title, summary = '') => ({ title, summary, url: 'u', date: '2026-08-09' });

const sports = [
  art('선두 KT, ‘폭염 방학’도 바쁘다…후반기 선두 수성 준비',
      '최근 6연승을 달리며 선두로 치고 올라온 KT는 순위 경쟁에서… 새 외국인 투수 다니엘'),
  art('KT 타선 이끄는 98억 FA 듀오', '타선의 중심에 선 두 선수'),
  art('‘케이티♥’ 송중기, 어딜 봐서 40살?…로맨스 찍을 만하네', '배우 송중기의 근황 화보'),
];
ok('야구 기사는 뺀다 (사업 단어가 우연히 하나 있어도)',
   NEWS.onTopic([sports[0]]).length === 0);
ok('선수 관련 기사도 뺀다', NEWS.onTopic([sports[1]]).length === 0);
ok('연예 기사도 뺀다', NEWS.onTopic([sports[2]]).length === 0);

const corporate = [
  art('KT, 전국 매장 410곳 무더위 쉼터로 개방', 'KT가 전국 매장을 개방한다'),
  art('클라이온, KT클라우드 출신 김주성 신임 대표 선임…AX 확장 속도', '대표 선임 소식'),
  art('삼성전자, 美 테일러팹 첫 인턴 뽑는다', '인재 확보에 속도를 낸다'),
];
ok('회사 기사는 그대로 남긴다', NEWS.onTopic(corporate).length === 3);

/* 스포츠 단어가 하나만 있고 사업 내용이 같이 있으면 남긴다 — 기업 마케팅 기사가
   'KT스포츠 팝업' 처럼 스포츠를 소재로 쓰는 일이 있다. */
ok('스포츠 단어 1종 + 사업 내용이면 남긴다',
   NEWS.onTopic([art('KT, 프로야구 팬 대상 요금제 출시', '신규 요금제를 출시한다')]).length === 1);

/* ── 같은 사건 묶기 · 고유명사 신호 ────────────────────────── */
const sameEvent = [
  art('박윤영 KT 대표 "AIDC가 AX 핵심"…현장 경영 나서'),
  art('KT 박윤영 대표, 목동 데이터센터 방문…AI 인프라 운영 점검'),
].map((a, i) => ({ ...a, url: `same${i}` }));
ok('같은 사람이 주인공인 같은 일정은 한 건으로 줄인다',
   NEWS.dedupeStories(sameEvent, 'KT').length === 1,
   `→ ${NEWS.dedupeStories(sameEvent, 'KT').length}건`);

/* 특징어가 없으면 겹침이 비슷해도 묶지 않는다 — 실측에서 이 둘이 갈리는 지점이었다. */
const differentEvent = [
  art('KT, 전국 매장 410곳 무더위 쉼터로 개방'),
  art('박윤영 KT 대표 "AIDC가 AX 핵심"…현장 경영 나서'),
].map((a, i) => ({ ...a, url: `diff${i}` }));
ok('공통 고유명사가 없으면 다른 사건으로 둔다',
   NEWS.dedupeStories(differentEvent, 'KT').length === 2);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
