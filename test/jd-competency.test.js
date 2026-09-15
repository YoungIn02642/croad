/* 자소서 코치 — 역량 추출·소재 배분 테스트
   AI 는 여기서 다루지 않는다(호출하지 않으므로 결정론적이다). 이 파일이 지키는 것은
   "같은 공고를 넣으면 같은 가이드가 나온다"와 "약한 근거로 역량을 지어내지 않는다"다. */
const JD = require('../backend/src/jd-competency');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS ' : '  FAIL '), name, extra); };

const JD_TEXT = `[주요업무]
- 채널별 마케팅 성과 데이터 분석 및 리포트 작성
- 유관부서와 협업하여 프로모션 기획 및 실행
[자격요건]
- 데이터를 근거로 문제를 정의하고 개선안을 제안할 수 있는 분
- 엑셀, SQL 등 데이터 도구 활용 가능자
[우대사항]
- 고객 니즈 파악 및 UX 개선 경험
- 영어 커뮤니케이션 가능자`;

const ACTS = [
  { type: 'internship',     name: '카카오 데이터팀 인턴', duration: '3개월~6개월', role: '팀원', outcome: '결과물 없음' },
  { type: 'competition',    name: '교내 마케팅 공모전',   duration: '1개월 미만',  role: '팀장', outcome: '수상' },
  { type: 'extracurricular',name: '네이버 서포터즈',      duration: '6개월~1년',   role: '팀원', outcome: '결과물 없음' },
  { type: 'exchange',       name: '교환학생(캐나다)',     duration: '6개월~1년',   role: null,   outcome: '결과물 없음' },
];

const build = (found, acts, hasSpec = true) =>
  JD.spreadMaterials(found.map(e => JD.buildGuide({ ...e, source: 'rule' }, acts, hasSpec)));

console.log('── 1. 구역 머리말을 근거로 세지 않는가 ──');
const heads = JD.splitSentences('[자격요건]\n주요업무\n우대사항 :\n데이터 분석 경험자');
ok('머리말만 있는 줄은 버린다', heads.length === 1 && heads[0].includes('데이터'), `→ ${JSON.stringify(heads)}`);
ok('"[자격요건]" 때문에 전공지식이 잡히지 않는다',
   !JD.ruleExtract('[자격요건]\n성실한 분').found.some(f => f.id === 'expertise'));

console.log('\n── 2. 역량 추출 ──');
const r = JD.ruleExtract(JD_TEXT);
const ids = r.found.map(f => f.id);
ok('데이터 분석력이 1순위', ids[0] === 'data-analysis', `→ ${ids.join(', ')}`);
ok('협업이 잡힌다',   ids.includes('collaboration'));
ok('고객지향이 잡힌다', ids.includes('customer'));
ok('글로벌이 잡힌다(우대사항도 읽는다)', ids.includes('global'));
ok('기획력이 잡힌다("기획"은 업무 이름이라 약하게 세지 않는다)', ids.includes('planning'));
// 약한 키워드 하나(=0.4)만 걸린 역량은 근거로 보지 않는다
ok('"실행" 하나로 실행력을 만들지 않는다', !ids.includes('execution'));
ok('"제안" 하나로 주도성을 만들지 않는다', !ids.includes('ownership'));
ok('근거 문장을 원문 그대로 남긴다',
   r.found[0].quotes.some(q => JD_TEXT.includes(q)), `→ ${r.found[0].quotes[0]}`);
ok('공고에 없는 역량은 만들지 않는다', !ids.includes('service') && !ids.includes('resilience'));

console.log('\n── 3. 소재 배분 (같은 활동을 모든 역량에 추천하지 않는가) ──');
const items = build(r.found.slice(0, 6), ACTS);
const tops = items.map(i => i.mine[0]?.name).filter(Boolean);
const uniqueTops = new Set(tops);
ok('배점 1위 활동이 모든 카드를 차지하지 않는다', uniqueTops.size >= 3, `→ ${[...uniqueTops].join(' / ')}`);
ok('소재가 겹치면 겹침을 밝힌다',
   items.filter(i => i.reuse).every(i => i.lead.includes('겹치지 않게')));
ok('처음 배정된 카드는 겹침 문구가 없다',
   items.filter(i => i.mine.length && !i.reuse).every(i => i.lead.includes('가장 강한 소재')));
ok('결정론 — 같은 입력이면 같은 결과',
   JSON.stringify(build(JD.ruleExtract(JD_TEXT).found.slice(0, 6), ACTS)) === JSON.stringify(items));

console.log('\n── 4. 스펙이 없을 때도 화면이 성립하는가 ──');
const guest = build(r.found.slice(0, 3), [], false);
ok('비로그인도 골격 가이드를 받는다', guest.every(i => i.frame && i.frame.includes('①')));
ok('비로그인에는 스펙 입력 안내를 준다', guest.every(i => /스펙을 입력하면/.test(i.gap || '')));
const onlyVolunteer = build(r.found.slice(0, 1), [{ type: 'volunteer', name: '봉사', duration: '6개월~1년', role: '팀원', outcome: '결과물 없음' }]);
ok('근거 활동이 없으면 무엇이 근거가 되는지 알려준다',
   /근거로 쓸 활동이 아직 없습니다/.test(onlyVolunteer[0].gap || ''), `→ ${onlyVolunteer[0].gap}`);

console.log('\n── 5. 가이드 내용이 비어 있지 않은가 ──');
for (const arc of JD.ARCHETYPES) {
  const g = JD.buildGuide({ id: arc.id, quotes: [], matched: [] }, [], false);
  const full = g && g.frame.includes('①') && g.numbers.length && g.avoid.length && g.reads && g.followup;
  if (!full) { ok(`${arc.label} 가이드 완성`, false); break; }
}
ok(`역량 원형 ${JD.ARCHETYPES.length}종 모두 골격·숫자·감점·면접질문을 갖췄다`,
   JD.ARCHETYPES.every(arc => {
     const g = JD.buildGuide({ id: arc.id, quotes: [], matched: [] }, [], false);
     return g.frame.includes('①') && g.numbers.length > 0 && g.avoid.length > 0 && !!g.reads && !!g.followup;
   }));
ok('원형 id 에 중복이 없다', new Set(JD.ARCHETYPE_IDS).size === JD.ARCHETYPE_IDS.length);

console.log('\n── 6. AI 가 모르는 역량을 들고 왔을 때 ──');
const custom = JD.buildCustom({ label: '반도체 공정 이해', quotes: ['반도체 8대 공정 이해도 보유자'] });
ok('가이드를 지어내지 않고 직접 확인하라고 넘긴다',
   custom.custom === true && /역량 사전에 없는/.test(custom.lead));
ok('그래도 최소 골격은 준다', custom.frame.includes('①'));

console.log('');
console.log('── 자소서에 쓸 구간만 남긴다 (사용자 지시 2026-09-15) ──');
/* 공고 주소·이미지를 넣으면 복리후생·결격사유·전형절차까지 같이 들어와, 그 문장이
   역량 근거로 인용되고 키워드까지 만들었다(사용자 지적). 구간째로 뺀다. */
{
  const 설명 = '지원자는 담당 업무를 수행하며 성과를 관리합니다. 관련 도구를 활용해 자료를 정리합니다.';
  const posting = [
    '[회사소개]', '2015년 설립된 이커머스 플랫폼 기업입니다. ' + 설명,
    '[담당업무]', '- 신규 프로모션 기획 및 실행', '- 고객 데이터 분석을 통한 타깃 마케팅 제안',
    '[자격요건]', '- SQL 기초 활용 가능자',
    '[우대사항]', '- 데이터 시각화 도구 사용 경험',
    '[근무조건]', '- 근무시간: 주 5일. 유관부서와 소통이 잦은 자리입니다.',
    '[복리후생]', '- 자기계발비 연 100만원 지원, 열정적인 동료와 성장할 수 있는 환경',
    '[전형절차]', '서류전형 > 1차 실무면접 > 인성검사 > 최종합격',
    '[결격사유]', '- 병역 기피 사실이 있는 자',
    '[접수방법]', '채용 홈페이지로 지원서를 제출해 주세요. 문의: hr@example.com',
  ].join('\n');
  const kept = JD.usefulText(posting);

  ok('회사소개를 남긴다', kept.includes('이커머스 플랫폼 기업'));
  ok('담당업무를 남긴다', kept.includes('프로모션 기획'));
  ok('우대사항을 남긴다', kept.includes('시각화'));
  /* 사용자가 적어 준 목록에는 없지만 요구 역량 근거의 절반이 여기서 나온다. */
  ok('자격요건도 남긴다', kept.includes('SQL'), '빼면 이 기능의 재료가 사라진다');

  ok('복리후생을 뺀다', !kept.includes('자기계발비'));
  ok('결격사유를 뺀다', !kept.includes('병역'));
  ok('전형절차를 뺀다', !kept.includes('인성검사'));
  ok('근무조건을 뺀다', !kept.includes('근무시간'));
  ok('접수방법·문의처를 뺀다', !kept.includes('hr@example'));

  /* 이 문장이 실제로 협업 역량을 만들고 있었다 — 근무조건 안에 있던 문장이다. */
  ok('버린 구간의 문장이 역량 근거로 안 올라온다',
    !JD.ruleExtract(posting).found.some(f => (f.quotes || []).some(q => q.includes('소통이 잦은'))));
}

console.log('');
console.log('── 못 가른 공고는 건드리지 않는다 ──');
/* 잘못 잘라 재료를 통째로 없애는 것보다 잡음을 조금 남기는 편이 낫다. */
{
  const 줄글 = '저희 회사는 이커머스 플랫폼을 운영합니다. 이번에 마케팅 담당자를 모십니다. '
    + '프로모션을 기획하고 데이터를 분석해 성과를 개선하는 일을 맡습니다. 유관부서와 협업이 많습니다.';
  ok('머리말이 없으면 원문 그대로', JD.usefulText(줄글) === 줄글);

  const 전부버릴것 = ['[복리후생]', '식대와 자기계발비를 지원합니다.', '[전형절차]', '서류 후 면접을 봅니다.'].join('\n');
  ok('남는 게 거의 없으면 원문 그대로', JD.usefulText(전부버릴것) === 전부버릴것,
    '통째로 사라지는 것만 막는다');

  /* 본문 문장이 '근무'·'급여' 로 시작해도 구간이 뒤집히면 안 된다 — 머리말은 짧은 줄이다. */
  const 본문에근무 = ['[담당업무]', '- 근무 중 발생하는 이슈를 분석해 개선안을 제안합니다',
    '- 급여 정산 데이터를 검증하고 리포트를 작성합니다', '[우대사항]', '- 엑셀·SQL 활용 능력'].join('\n');
  ok('본문 문장을 머리말로 오인하지 않는다', JD.usefulText(본문에근무).includes('급여 정산 데이터'));

  ok('장식(■ ◆)·콜론 머리말도 알아본다',
    JD.headKind('■ 복리후생') === 'drop' && JD.headKind('담당업무 : 데이터 분석') === 'keep'
    && JD.headKind('◆ 우대사항') === 'keep' && JD.headKind('전형절차') === 'drop');
  ok('모르는 머리말은 건드리지 않는다', JD.headKind('[기타]') === null);
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
