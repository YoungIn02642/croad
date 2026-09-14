/* 문항별 분량 상한 (사용자 지시 2026-09-03)

   자소서 문항은 회사마다 상한이 다르다 — "1,000자 이내"·"2,000 byte" 처럼 공고에
   적혀 있다. 예전에는 초안 요청이 `limit: 600` 으로 고정이라, 1,000자짜리 문항에
   600자 초안이 나오고 사용자가 다시 늘려 써야 했다.

   여기서 지키는 것은 셋이다.
     1) byte 를 **한글 2byte**(EUC-KR 관행)로 센다. UTF-8(3byte)로 세면 같은 글이
        1.5배로 잡혀 쓸 수 있는 분량을 깎아먹는다.
     2) 안 정하면 1,000자. 부르는 쪽마다 기본값을 따로 적으면 화면과 초안이 갈린다.
     3) byte 상한은 초안 요청에서 **글자 수로 환산**된다(서버 프롬프트는 글자로 센다). */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
globalThis.document = { querySelector: () => null };

const JD = require('../frontend/js/jd-coach.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS ' : '  FAIL '), name, extra); };

console.log('── 1. byte 는 한글 2byte 로 센다 ──');
ok('한글 1자 = 2byte', JD.byteLen('가') === 2);
ok('영문 1자 = 1byte', JD.byteLen('a') === 1);
ok('숫자·공백 = 1byte', JD.byteLen('1 ') === 2);
ok('섞이면 합친다', JD.byteLen('가a1') === 4, '2+1+1');
/* UTF-8 로 셌으면 '가' 가 3 이 됐을 것이다 — 국내 자소서 관행은 2 다. */
ok('UTF-8(3byte)로 세지 않는다', JD.byteLen('가나다') === 6, 'UTF-8 이면 9');
ok('빈 값은 0', JD.byteLen('') === 0 && JD.byteLen(null) === 0);

console.log('\n── 2. 안 정하면 1,000자 ──');
const d = JD.limitOf('문항1');
ok('기본 1,000', d.n === JD.LIMIT_DEFAULT && d.n === 1000, `→ ${d.n}`);
ok('기본 단위는 자', d.unit === 'char');
/* custom 이 false 여야 화면이 입력칸을 비우고 placeholder 로 기본값을 보여준다. */
ok('사용자가 정한 값이 아니라고 표시', d.custom === false);

console.log('\n── 3. 정하고 꺼낸다 ──');
JD.setLimit('문항1', 1500, 'char');
ok('글자 상한이 저장된다', JD.limitOf('문항1').n === 1500);
ok('custom 으로 바뀐다', JD.limitOf('문항1').custom === true);
JD.setLimit('문항2', 2000, 'byte');
ok('byte 상한이 저장된다', JD.limitOf('문항2').n === 2000 && JD.limitOf('문항2').unit === 'byte');
ok('문항마다 따로 남는다', JD.limitOf('문항1').n === 1500 && JD.limitOf('문항2').n === 2000);
ok('안 정한 문항은 기본값', JD.limitOf('문항9').n === 1000);

console.log('\n── 4. 비우면 기본값으로 돌아간다 ──');
/* 0 을 저장해 두면 다음에 못 고친다 — 지워야 한다. */
JD.setLimit('문항1', '', 'char');
ok('비우면 기본 1,000', JD.limitOf('문항1').n === 1000 && JD.limitOf('문항1').custom === false);
JD.setLimit('문항2', 0, 'byte');
ok('0 도 기본값으로', JD.limitOf('문항2').custom === false);

console.log('\n── 5. 터무니없는 값은 자른다 ──');
JD.setLimit('문항3', 999999, 'char');
ok('글자 상한 최대 3,000', JD.limitOf('문항3').n === 3000, `→ ${JD.limitOf('문항3').n}`);
JD.setLimit('문항4', 999999, 'byte');
ok('byte 상한 최대 6,000', JD.limitOf('문항4').n === 6000, `→ ${JD.limitOf('문항4').n}`);
JD.setLimit('문항5', 10, 'char');
ok('최소 200 아래로는 안 내려간다', JD.limitOf('문항5').n === 200, `→ ${JD.limitOf('문항5').n}`);

console.log('\n── 6. 카운터가 상한 대비로 센다 ──');
JD.setLimit('문항6', 10, 'char');
let u = JD.usageOf('가나다', JD.limitOf('문항6'));
ok('자 단위로 센다', u.used === 3 && u.unitLabel === '자');
ok('상한 안이면 over 아님', u.over === false);
u = JD.usageOf('가'.repeat(300), JD.limitOf('문항6'));
ok('넘으면 over', u.over === true, '200자 상한에 300자');
JD.setLimit('문항7', 200, 'byte');
u = JD.usageOf('가나다', JD.limitOf('문항7'));
ok('byte 단위로 센다', u.used === 6 && u.unitLabel === 'byte', `→ ${u.used}`);

console.log('\n── 7. 초안 요청은 글자 수로 환산해 보낸다 ──');
/* 서버 프롬프트(question-prompts.js frameBlock)는 글자로 센다. byte 상한을 그대로
   보내면 2,000자짜리 초안을 요구하게 된다. */
ok('자 상한은 그대로', JD.charTarget({ n: 1200, unit: 'char' }) === 1200);
ok('byte 상한은 절반', JD.charTarget({ n: 2000, unit: 'byte' }) === 1000, '한글 2byte 기준');
ok('기본값도 환산된다', JD.charTarget(JD.limitOf('문항404')) === 1000);

console.log('\n── 8. 서버 clamp 가 프론트와 같은 범위인가 ──');
/* 갈리면 화면이 말한 분량과 실제 초안이 어긋난다. */
const SRC = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'backend', 'src', 'routes', 'jdCoach.js'), 'utf8');
ok('서버 기본값도 1000', SRC.includes('Number(req.body?.limit) || 1000'));
ok('서버 상한도 3000', SRC.includes('), 3000)'));
ok('서버 하한도 200', SRC.includes('|| 1000, 200)'));

console.log('\n── 9. 상한을 절대 넘기지 않는가 (사용자 지시 2026-09-05) ──');
/* 모자란 것은 사용자가 채우면 되지만 넘친 것은 제출이 막힌다 — 자소서 입력칸이
   글자 수로 자르기 때문에 뒤가 통째로 날아간다. 그래서 상한만 단단히 지킨다. */
const DRAFT = require('../backend/src/draft-coach.js');
const long = '첫 문장입니다. 두 번째 문장입니다. 세 번째 문장은 조금 더 깁니다. 네 번째입니다.';

[1000, 47, 40, 20, 8, 5, 1].forEach(lim => {
  const r = DRAFT.fitToLimit(long, lim);
  ok(`상한 ${String(lim).padStart(4)} 를 넘지 않는다`, DRAFT.lenOf(r.draft) <= lim,
     `→ ${DRAFT.lenOf(r.draft)}자`);
});
ok('상한 안이면 손대지 않는다', DRAFT.fitToLimit(long, 1000).draft === long);
ok('상한 안이면 trimmed 가 false', DRAFT.fitToLimit(long, 1000).trimmed === false);
ok('넘치면 trimmed 가 true', DRAFT.fitToLimit(long, 20).trimmed === true);

/* 글자로 뚝 자르면 "…했습니" 처럼 말이 끊긴다. 문장 단위로 남겨야 한다. */
ok('문장 중간에서 끊지 않는다', /[.!?…]$/.test(DRAFT.fitToLimit(long, 40).draft));
/* split 으로 공백을 버리면 "첫 문장입니다.두 번째" 가 된다(실측). */
ok('문장 사이 공백이 살아 있다', !/[.!?]\S/.test(DRAFT.fitToLimit(long, 40).draft));
/* 종결 부호가 없는 한 문장짜리도 빈 초안을 주면 안 된다. */
const noStop = DRAFT.fitToLimit('종결부호가아예없는아주긴한문장', 10);
ok('종결 부호가 없어도 빈 초안이 아니다', noStop.draft.length > 0);
ok('그때도 상한을 넘지 않는다', DRAFT.lenOf(noStop.draft) <= 10, `→ ${DRAFT.lenOf(noStop.draft)}자`);
/* 이모지·서러게이트 쌍을 두 글자로 세면 상한 계산이 어긋난다. */
ok('서러게이트도 한 글자로 센다', DRAFT.lenOf('가나👍') === 3, `→ ${DRAFT.lenOf('가나👍')}`);

console.log('\n── 10. 라우트가 상한을 강제하는가 ──');
const RSRC = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'backend', 'src', 'routes', 'jdCoach.js'), 'utf8');
ok('넘치면 다시 부른다', /lenOf\(out\.draft\) > limit/.test(RSRC));
ok('마지막에 잘라낸다', RSRC.includes('DRAFT.fitToLimit(out.draft, limit)'));

console.log('\n── 11. 분량 하한 (사용자 지시 2026-09-14) ──');
/* 상한과 달리 하한은 **다시 부르는 기준일 뿐**이다. 못 채우면 그대로 내보낸다 —
   모자란 초안은 학생이 채울 수 있지만 지어낸 문장은 되돌릴 수 없다.
   여기서는 '다시 부른 것을 받아들일지' 판정을 본다(라우트가 이 함수를 쓴다). */
{
  const GUIDE = require('../backend/src/cover-guide.js');
  const ownStar = { S: '학생회 홍보팀에서 설명회 참여율이 40%대였다', T: '', A: '', R: '' };
  const short = '가'.repeat(300), longer = '가'.repeat(500);

  ok('더 길면 받아들인다', DRAFT.fillsBetter(short, longer, 600, ownStar));
  ok('더 짧으면 안 받는다', !DRAFT.fillsBetter(longer, short, 600, ownStar));
  ok('같은 길이면 안 받는다', !DRAFT.fillsBetter(short, short, 600, ownStar));
  /* 하한을 채우려다 상한을 넘기면 제출이 막힌다 — 고치려던 것보다 큰 사고다. */
  ok('상한을 넘기면 안 받는다', !DRAFT.fillsBetter(short, '가'.repeat(700), 600, ownStar));
  ok('없으면 안 받는다', !DRAFT.fillsBetter(short, null, 600, ownStar));

  /* 길이를 늘리는 가장 쉬운 길이 '안내 예시 베끼기' 다. 길다고 그걸 받으면
     지어내기를 막으려고 만든 검사를 하한이 우회하게 된다. */
  const stolen = short + ' ' + GUIDE.STAR_WRITE[0].good;
  ok('예시를 베꼈으면 길어도 안 받는다',
    !DRAFT.fillsBetter(short, stolen, 3000, ownStar),
    '하한이 베낌 검사를 우회하면 안 된다');

  /* 하한 값 자체 — 배포 실측(정상 80~99% · 실패 59~76%) 사이에 있어야 한다. */
  ok('하한은 0.5~0.8 사이', DRAFT.MIN_FILL >= 0.5 && DRAFT.MIN_FILL <= 0.8, `→ ${DRAFT.MIN_FILL}`);
  ok('라우트가 하한으로 다시 부른다', /lenOf\(out\.draft\) < floor/.test(RSRC));
  ok('하한 재요청이 상한 처리보다 뒤에 온다',
    RSRC.indexOf('lenOf(out.draft) > limit') < RSRC.indexOf('lenOf(out.draft) < floor'),
    '상한을 줄인 결과가 하한에 걸려야 한다');
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail) process.exit(1);
