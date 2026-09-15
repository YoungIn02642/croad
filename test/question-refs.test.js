/* 문항에 붙이는 자료(뉴스·기타) — 초안 프롬프트에 실제로 들어가는지 (사용자 지시 2026-09-14)

   이 기능의 존재 이유는 '최근 이슈'·'존경하는 인물' 문항이다. 그 문항은 내 정성스펙보다
   바깥 사실이 재료인데, 역량·경험만 붙일 수 있으면 프롬프트에 사실이 없어서 모델이
   기사와 인물 이력을 지어낸다. 그래서 **자료가 프롬프트에 들어가는가** 와
   **'그건 네가 한 일이 아니다' 가 같이 나가는가** 를 본다.
   정규식을 쓰지 않고 문자열 포함으로만 본다 — 프롬프트 문장을 그대로 적어 두면
   문장을 고칠 때 이 검사가 같이 걸린다(그게 이 검사의 일이다). */
const D = require('../backend/src/draft-coach.js');
const NEWS = require('../backend/src/news.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + ' ' + extra); }
  else { fail++; console.log('  FAIL  ' + name + ' ' + extra); }
};
const count = (s, sub) => s.split(sub).length - 1;

const base = { company: '삼성전자', jobTitle: '마케팅', limit: 600,
               question: '최근 우리 회사의 사업 중 관심 있는 분야와 그 이유를 설명해 주세요.' };
const REF = { title: '삼성전자·SK하이닉스, 25조 전기료 선납 거절',
              summary: '정부의 전기료 선납 요청을 두 회사가 거절했다.',
              date: '2026-09-14', kind: 'news', url: 'https://example.com/a' };

console.log('── 1. 자료가 프롬프트에 들어간다 ──');
{
  const p = D.buildPrompt({ ...base, refs: [REF] });
  ok('자료 블록이 있다', p.includes('붙여 온 자료 1건'));
  ok('제목이 들어간다', p.includes('25조 전기료 선납 거절'));
  ok('요약이 들어간다', p.includes('정부의 전기료 선납 요청'));
  ok('날짜가 들어간다', p.includes('2026-09-14'));
  /* url 은 모델이 열어 볼 수 없다. 넣으면 길이만 먹어 뒤쪽 규칙을 밀어낸다. */
  ok('url 은 안 들어간다', !p.includes('example.com'));
}

console.log('');
console.log('── 2. 지어내기·대필을 막는 문장이 같이 나간다 ──');
{
  const p = D.buildPrompt({ ...base, refs: [REF] });
  ok('자료 밖으로 나가지 말라고 한다', p.includes('여기 적힌 것 밖의 사실을 보태지 마라'));
  /* 이 문항 유형에서 가장 흔한 사고 — 회사·인물이 한 일을 내 경험처럼 쓰는 것. */
  ok('자료는 내가 한 일이 아니라고 못 박는다', p.includes('지원자가 한 일이 아니다'));
  ok('출처를 본문에 넣지 말라고 한다', p.includes('본문에 넣지 마라'));
  ok('자료가 주재료라는 규칙이 붙는다', p.includes('1-5. **위 자료가 이 문항의 주재료다'),
    '규칙에 안 적으면 첫 문장이 자료 밖에서 시작한다(실측 3회 중 2회)');
}

console.log('');
console.log('── 3. 자료가 있으면 회사 사실 규칙이 바뀐다 ──');
{
  const withRef = D.buildPrompt({ ...base, refs: [REF] });
  const without = D.buildPrompt({ ...base });
  /* 자료를 줬는데도 '회사 사실을 주지 않았다' 가 나가면 서로 부딪힌다 —
     자료에 적힌 회사 사실은 **써야** 하기 때문이다. */
  ok('자료가 있으면 "사실을 주지 않았다" 가 아니다', !withRef.includes('회사에 대한 사실을 주지 않았다'));
  ok('  대신 "자료에 적힌 것만" 이 된다', withRef.includes('회사·인물에 대한 사실은 **위 자료에 적힌 것만**'));
  ok('규칙 1-3 이 두 번 나가지 않는다', count(withRef, '1-3.') === 1);
  ok('자료가 없으면 예전 문장 그대로', without.includes('회사에 대한 사실을 주지 않았다'));
  ok('  그때는 1-5 가 없다', !without.includes('1-5.'));
  ok('  그때는 자료 블록도 없다', !without.includes('붙여 온 자료'));
}

console.log('');
console.log('── 4. 프롬프트가 자료로 길어지지 않게 자른다 ──');
{
  const many = Array.from({ length: 9 }, (_, i) => ({ title: '기사' + i, summary: '요'.repeat(600) }));
  const p = D.buildPrompt({ ...base, refs: many });
  ok('4건까지만 쓴다', p.includes('붙여 온 자료 4건'), '자료가 늘면 뒤쪽 규칙이 밀린다');
  ok('  5번째는 안 들어간다', !p.includes('기사4'));
  ok('요약을 자른다', !p.includes('요'.repeat(300)));
  /* 제목이 없는 자료는 셀 것이 없다 — 요약만으로는 무슨 자료인지 모른다. */
  const p2 = D.buildPrompt({ ...base, refs: [{ title: '', summary: '요약만 있다' }, REF] });
  ok('제목 없는 자료는 뺀다', p2.includes('붙여 온 자료 1건'));
  ok('빈 배열이면 블록이 없다', !D.buildPrompt({ ...base, refs: [] }).includes('붙여 온 자료'));
  ok('refs 가 배열이 아니어도 죽지 않는다', !D.buildPrompt({ ...base, refs: 'x' }).includes('붙여 온 자료'));
}

console.log('');
console.log('── 5. 문항의 평가 포인트 (사용자 지시 2026-09-15) ──');
/* 고용24 자소서 작성가이드는 문항마다 '무엇을 보려는 문항인지' 를 달아 둔다.
   실측: 실제 공채 문항의 30%는 우리 6유형 분류에 안 걸리는데, 그때는 골격도
   분량표도 안 붙어 '무엇을 답해야 하는가' 가 프롬프트에 하나도 없었다. */
{
  const ask = '회사 이해도/가치관/조직 및 직무 적합성';
  const p = D.buildPrompt({ ...base, askPoint: ask });
  const none = D.buildPrompt({ ...base });

  ok('평가 포인트가 프롬프트에 들어간다', p.includes('이 문항으로 회사가 보려는 것'));
  ok('  슬래시를 가운뎃점으로 편다', p.includes('회사 이해도 · 가치관 · 조직 및 직무 적합성'));
  ok('없으면 그 줄이 없다', !none.includes('이 문항으로 회사가 보려는 것'));

  /* Context 한 줄만으로는 초안이 안 바뀌었다(실측: 같은 문항 2회 모두 경험만 늘어놓음).
     규칙 목록에 적어야 모델이 따른다 — 자료 1-5 에서 확인한 것과 같다. */
  ok('규칙에도 적는다', p.includes('1-6. 이 문항은'), 'Context 한 줄만으로는 안 따랐다');
  ok('  첫 문단에서 그 축을 건드리라고 한다', p.includes('첫 문단에서 그 축을 건드려라'));
  ok('없으면 1-6 도 없다', !none.includes('1-6.'));

  /* 평가 포인트는 채점 기준이지 사실이 아니다. 그대로 옮기면
     '저는 산업 이해도와 논리적 사고를 갖추었습니다' 가 된다. */
  ok('사실이 아니라 기준이라고 못 박는다', p.includes('채점 기준이지 사실이 아니다'));
  ok('  그 말을 옮기지 말라고 한다', p.includes('이 말을 문장에 그대로 옮기지 마라'));

  ok('길면 자른다', D.buildPrompt({ ...base, askPoint: '가'.repeat(400) }).split('가가가').length > 1
    && !D.buildPrompt({ ...base, askPoint: '가'.repeat(400) }).includes('가'.repeat(200)));
}

console.log('');
console.log('── 6. 화면이 평가 포인트를 담고 넘기는가 ──');
/* 작성 가이드 원문(700자)에는 회사 사실이 섞여 있다 — 화면에만 두고 AI 에는 안 보낸다. */
{
  const path = require('path');
  const FRONT = require('fs').readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'jd-coach.js'), 'utf8');
  const DBJS = require('fs').readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'db.js'), 'utf8');

  ok('가이드를 고를 때 평가 포인트를 저장한다', FRONT.includes('saveQMeta(g.questions)'));
  ok('  문항 글을 키로 쓴다', FRONT.includes('qMetaKey'),
    '순서(문항1)를 키로 쓰면 문항을 지웠을 때 남의 포인트가 따라붙는다');
  ok('화면에 이 문항으로 보는 것을 띄운다', FRONT.includes('qAskPointHtml'));
  ok('초안 호출에 평가 포인트를 싣는다', /askPoint: tab\?\.kind === 'question'/.test(FRONT));
  ok('작성 가이드 원문은 안 보낸다', !/askPoint:.*guide/.test(FRONT) && !DBJS.includes('guide:'),
    '700자에 회사 사실이 섞여 있다 — 뒤쪽 규칙이 밀리고 요령을 그대로 옮긴다');
  ok('서버가 받아 넘긴다', require('fs')
    .readFileSync(path.join(__dirname, '..', 'backend', 'src', 'routes', 'jdCoach.js'), 'utf8')
    .includes('req.body?.askPoint'));
}
console.log('');
console.log('── 7. 검색 통로 (네트워크 없이 되는 것만) ──');
/* 빈 검색어로는 외부를 부르지 않는다. 인물은 기사로 안 잡혀서(실측: 이순신 → 뉴스 0건,
   웹 3건) 통로가 둘이어야 한다 — 그 둘이 있는지까지 본다. */
Promise.all([NEWS.searchNews(''), NEWS.searchRef('   ')]).then(([a, b]) => {
  ok('뉴스: 빈 검색어 → 0건 (외부를 안 부른다)', Array.isArray(a) && a.length === 0);
  ok('기타: 빈 검색어 → 0건', Array.isArray(b) && b.length === 0);
  ok('통로가 뉴스·웹 둘이다',
    typeof NEWS.searchNews === 'function' && typeof NEWS.searchRef === 'function');
  console.log('');
  console.log('결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
});
