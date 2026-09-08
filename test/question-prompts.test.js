/* 빈출 문항 6유형 — 프롬프트 사양 테스트

   이 파일이 지키는 것은 두 가지다.
     1) question-frames.js(분류·골격)와 question-prompts.js(프롬프트 사양)가 **id 1:1** 인가.
        갈라지면 조용히 틀린다 — 문항이 분류는 됐는데 사양이 없으면 유형 규칙이 통째로
        빠진 채 초안이 나가고, 화면에는 아무 에러도 안 뜬다.
     2) 사양이 **자기 규칙을 스스로 지키는가.** share 합이 100 이 아니거나 한 덩이가 절반을
        넘으면, 프롬프트가 모델에게 "절반을 넘기지 마라"라고 시키면서 스스로는 어기는 표를
        건네게 된다. */
const QF = require('../frontend/js/question-frames.js');
const QP = require('../backend/src/question-prompts.js');
const GUIDE = require('../backend/src/cover-guide.js');
const DRAFT = require('../backend/src/draft-coach.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS ' : '  FAIL '), name, extra); };

console.log('── 1. question-frames 와 id 가 1:1 인가 ──');
const frameIds = QF.TYPES.map(t => t.id).sort();
const specIds = Object.keys(QP.SPECS).sort();
ok('유형 6개', frameIds.length === 6, `→ ${frameIds.length}`);
ok('사양 6개', specIds.length === 6, `→ ${specIds.length}`);
ok('id 집합이 같다', JSON.stringify(frameIds) === JSON.stringify(specIds),
  `\n     frames: ${frameIds.join(',')}\n     specs : ${specIds.join(',')}`);
QF.TYPES.forEach(t => ok(`${t.id.padEnd(11)} 사양 있음`, Boolean(QP.specFor(t.id))));

console.log('\n── 2. 사양의 모양 ──');
Object.entries(QP.SPECS).forEach(([id, spec]) => {
  const parts = spec.parts || [];
  ok(`${id.padEnd(11)} 덩이 2개 이상`, parts.length >= 2, `→ ${parts.length}`);
  ok(`${id.padEnd(11)} 덩이마다 must·bad`, parts.every(p => Array.isArray(p.must) && p.must.length && p.bad));
  ok(`${id.padEnd(11)} 유형 규칙 1개 이상`, Array.isArray(spec.rules) && spec.rules.length >= 1);
  ok(`${id.padEnd(11)} 나쁜 예 있음`, Boolean(spec.badExample?.text) && (spec.badExample.missing || []).length >= 2);
  ok(`${id.padEnd(11)} starMode 유효`, ['core', 'support', 'none'].includes(spec.starMode), `→ ${spec.starMode}`);
});

console.log('\n── 3. 분량 배분이 스스로 규칙을 지키는가 ──');
Object.entries(QP.SPECS).forEach(([id, spec]) => {
  const sum = spec.parts.reduce((a, p) => a + p.share, 0);
  ok(`${id.padEnd(11)} share 합 = 100`, sum === 100, `→ ${sum}`);
  const max = Math.max(...spec.parts.map(p => p.share));
  /* 프롬프트가 "한 덩이가 절반을 넘으면 틀린 답" 이라고 시킨다. 표가 먼저 지켜야 한다. */
  ok(`${id.padEnd(11)} 최대 덩이 < 50%`, max < 50, `→ ${max}%`);
  ok(`${id.padEnd(11)} 0% 덩이 없음`, spec.parts.every(p => p.share > 0));
});

console.log('\n── 4. 지원동기: 포부가 접점보다 크게 배분됐는가 (사용자 지적의 핵심) ──');
/* 배포에서 받은 초안은 경험(③ 접점)이 문단을 다 먹고 ④ 포부가 한 줄이었다.
   규칙으로 "④가 ③보다 짧으면 틀린 답" 이라고 걸었으니, 배분표도 같은 방향이어야 한다. */
const motive = QP.SPECS.motive;
const share = k => motive.parts.find(p => p.key === k)?.share;
ok('④ 포부 > ③ 접점', share('포부') > share('접점'), `→ 포부 ${share('포부')}% vs 접점 ${share('접점')}%`);
ok('③ 접점 ≤ 25% (경험이 1/4을 넘지 않는다)', share('접점') <= 25, `→ ${share('접점')}%`);
ok('starMode = support (경험은 근거일 뿐)', motive.starMode === 'support');

console.log('\n── 5. frameBlock 렌더 ──');
const block = QP.frameBlock('motive', { label: '지원동기·입사 후 포부', limit: 600 });
ok('라벨이 들어간다', block.includes('지원동기·입사 후 포부'));
ok('목표 글자 수가 들어간다', block.includes('600자 기준'));
ok('퍼센트를 글자 수로 환산한다', block.includes('[약 35%, 210자'), '→ 포부 35% of 600');
/* ── 모델은 한국어 글자를 못 센다. 문장 수는 센다 (실측 2026-09-01) ── */
/* 210 ÷ 54 = 3.9 → 4문장. SENT 가 65 였을 때는 3문장이었다 — 합격 자소서 72편의
   실측 평균이 54자라 2026-09-08 에 상수를 내렸다(question-prompts.js SENT 주석). */
ok('덩이마다 목표 문장 수를 준다', block.includes('210자 · **4문장**'), '→ 210자 ÷ 54');
ok('전체 문장 수를 준다', /전체 \*\*\d+문장\*\*/.test(block));
ok('문장 수를 먼저 맞추라고 시킨다', block.includes('문장 수를 먼저 맞추고'));
ok('덩이가 전부 들어간다', motive.parts.every(p => block.includes(p.key)));
ok('덩이마다 나쁜 예가 붙는다', motive.parts.every(p => block.includes(p.bad)));
ok('절반 상한을 못 박는다', block.includes('절반을 넘어도 틀린 답'));
/* ── 하한이 없으면 배분표가 상한표로 읽혀 여섯 유형 전부가 짧아졌다 (실측 2026-09-01) ── */
ok('합계 하한(목표의 90%)을 못 박는다', block.includes('540자 미만이면 틀린 답'), '→ 600자의 90%');
ok('글자 수가 상한이 아니라 목표치임을 밝힌다', block.includes('상한이 아니라 목표치'));
ok('빈칸이 분량을 대신하지 못한다고 못 박는다', block.includes('대괄호는 분량을 대신하지 못한다'));
ok('덩이당 대괄호 1개 상한', block.includes('한 덩이에 대괄호는 **1개까지**'));
/* ── 상대 조건만으로는 깎아서도 통과한다 (심사 지적 2026-09-01) ── */
ok('덩이마다 절대 하한(70%)을 건다', block.includes('70% 아래로 내려가면 안 된다'));
ok('깎아서 비율 맞추기를 금지한다', block.includes('다른 덩이를 깎아서 비율을 맞추지 마라'));
ok('하한은 목표 글자 수를 따라간다', QP.frameBlock('trait', { limit: 400 }).includes('360자 미만'), '→ 400자의 90%');
ok('없는 유형은 null', QP.frameBlock('없는유형') === null);
/* 목표 글자 수를 안 주면 600 을 기본으로 쓴다 — 라우트가 limit 을 안 넘겨도 표가 깨지지 않아야 한다. */
ok('limit 없으면 600 기본', QP.frameBlock('trait', {}).includes('600자 기준'));

console.log('\n── 6. typeRules / badExampleRule ──');
ok('typeRules(motive) 3개 이상', QP.typeRules('motive').length >= 3);
ok('typeRules 는 복사본', QP.typeRules('motive') !== QP.SPECS.motive.rules);
ok('없는 유형은 빈 배열', QP.typeRules('없는유형').length === 0);
ok('badExampleRule 에 빠진 것 목록', QP.badExampleRule('trait').includes('빠진 것:'));
ok('badExampleRule 없는 유형은 null', QP.badExampleRule('없는유형') === null);

console.log('\n── 7. STAR 글자가 cover-guide 와 어긋나지 않는가 ──');
/* 실제로 어긋나 있었다: 직무경험 골격이 역할(R)·결과(T) 로 뒤집혀 있어서, 모델이 그 골격을
   따르면 coach 의 key 가 화면의 엉뚱한 STAR 칸에 붙었다(2026-09-01 수정). */
const letters = Object.fromEntries(GUIDE.STAR.map(s => [s.key, s.label]));
const compFrame = QF.frameFor('competency').frame;
ok('S = 상황', letters.S === '상황' && compFrame.includes('상황(S)'));
ok('T = 과제', letters.T === '과제' && compFrame.includes('과제(T)'));
ok('A = 행동', letters.A === '행동' && compFrame.includes('행동(A)'));
ok('R = 결과', letters.R === '결과' && compFrame.includes('결과(R)'));
/* ── 순서는 RSTA 다 (사용자 지시 2026-09-05) ────────────────────────────────
   글자가 뜻하는 것(S=상황·T=과제·A=행동·R=결과)은 그대로지만 **쓰는 순서**가 바뀌었다.
   결론을 맨 뒤에 두면 읽는 사람이 문단 끝까지 가야 무엇을 배웠는지 알 수 있어서,
   R 을 앞으로 빼고 S·T·A 를 그 근거로 쓴다.
   글자↔뜻이 어긋나면 coach 의 key 가 화면의 엉뚱한 STAR 칸에 붙으므로(위 네 줄) 그건
   여전히 지킨다 — 여기서 보는 것은 **네 글자가 다 있는가와 R 이 맨 앞인가** 다. */
const compKeys = QP.SPECS.competency.parts.map(p => p.key).join('');
ok('직무경험 사양의 덩이 키는 RSTA', compKeys === 'RSTA', `→ ${compKeys}`);
ok('결론(R)이 맨 앞', QP.SPECS.competency.parts[0].key === 'R');

console.log('\n── 8. draft-coach 가 사양을 실제로 끼우는가 ──');
const mk = (question, extra = {}) => DRAFT.buildPrompt({
  company: '테스트', jobTitle: '마케팅', competency: '문제해결',
  question, limit: 600, activities: [], picks: [], ...extra,
});
const pMotive = mk('지원 동기와 입사 후 포부를 기술해 주십시오.');
ok('지원동기에 분량표가 들어간다', pMotive.includes('분량 배분'));
ok('지원동기에 포부 배분이 들어간다', pMotive.includes('[약 35%, 210자'));
ok('지원동기에 유형 규칙이 들어간다', pMotive.includes('④ 포부가 ③ 접점보다 짧으면'));
ok('지원동기에 유형 나쁜 예가 들어간다', pMotive.includes('귀사의 성장 가능성에 매력을 느껴'));
/* STAR 를 안 골랐으면 성취담을 강요하지 않는다(27장·38장에서 세운 원칙). */
ok('STAR 0개면 STAR 규칙이 안 붙는다', !pMotive.includes('STAR 순서를 지키되'));

const pTrait = mk('본인의 성격의 장단점을 기술하시오.');
ok('성격 장단점에 유형 분량표', pTrait.includes('관리 가능한 단점'));
ok('성격 장단점에 STAR 강요 없음', pTrait.includes('STAR 로 풀지 않는다'));

/* ── starMode 가 draft-coach 에서 실제로 읽히는가 (심사 지적: 죽은 export 였다) ──
   support/none 유형에 정성스펙을 골라도 STAR 골격 규칙이 붙으면 안 된다. 붙으면 모델이
   문항 골격과 STAR 골격을 동시에 받아 어느 쪽도 못 채운다. */
const starPick = [{ name: '공모전', star: { S: '축제 홍보', T: '팀장', A: '설문 80명', R: '최우수상' } }];
const pMotiveStar = mk('지원 동기와 입사 후 포부를 기술해 주십시오.', { picks: starPick });
ok('지원동기(support)+스펙 → STAR 골격 규칙 안 붙음', !pMotiveStar.includes('STAR 순서를 지키되'));
ok('지원동기(support)+스펙 → coach 를 비운다', pMotiveStar.includes('"coach": [],'));
ok('지원동기+스펙 → STAR 값 보존 규칙은 붙는다', pMotiveStar.includes('반드시 문장에 살려라'));
const pTraitStar = mk('본인의 성격의 장단점을 기술하시오.', { picks: starPick });
ok('성격장단점(none)+스펙 → STAR 골격 규칙 안 붙음', !pTraitStar.includes('STAR 순서를 지키되'));
const pCompStar = mk('직무 수행에 필요한 역량을 갖추기 위해 노력한 경험을 서술하시오.', { picks: starPick });
ok('직무경험(core)+스펙 → STAR 골격 규칙이 붙는다', pCompStar.includes('STAR 순서를 지키되'));
ok('직무경험(core)+스펙 → coach 를 받는다', pCompStar.includes('"key": "S|T|A|R"'));

/* ── 회사 사실 금지가 이 경로에 아예 없었다 (심사 지적) ── */
ok('회사 사실 금지 규칙이 항상 붙는다', pMotive.includes('회사에 대한 사실을 주지 않았다'));
ok('공고 문장을 직무 내용으로 라벨한다', mk('아무 문항', { quotes: ['소비자 데이터를 분석'] }).includes('이 직무가 하는 일'));
ok('길이 하한이 셀 수 있게 적힌다', pMotive.includes('540~600자'));
ok('유형이 걸리면 포부로 닫는 것을 막지 않는다', !pMotive.includes('포부로 끝내지 말고'));
ok('미분류 문항은 예전 닫기 규칙을 유지한다',
  mk('여기에 자유롭게 적어 주세요.', { frame: '① 상황 → ② 행동' }).includes('포부로 끝내지 말고'));

const pFree = mk('여기에 자유롭게 적어 주세요.', { frame: '① 상황 → ② 행동' });
ok('미분류 문항은 예전 골격을 쓴다', pFree.includes('이 역량을 쓰는 순서'));
ok('미분류 문항엔 분량표가 없다', !pFree.includes('분량 배분'));

console.log('\n── 9. 일반 나쁜 예(14번)와 유형 나쁜 예가 겹치지 않는가 ──');
/* 둘 다 붙으면 프롬프트에 나쁜 예가 두 개가 되고, 모델이 그중 하나를 양식으로 읽는다.
   유형 사양이 있으면 유형 것만 쓴다. */
const star = { S: '3개월 프로젝트', T: '팀장', A: '설문을 돌렸다', R: '만족도가 올랐다' };
const pStarTyped = mk('가장 어려웠던 문제를 해결한 경험을 기술하시오.', { picks: [{ name: '공모전', star }] });
ok('유형이 걸리면 14번 일반 예는 빠진다', !pStarTyped.includes('14. 아래는 **절대로 내놓으면 안 되는'));
ok('대신 유형 나쁜 예가 들어간다', pStarTyped.includes('프로젝트 진행 중 문제가 발생했습니다'));
const pStarFree = mk('자유 문항입니다.', { picks: [{ name: '공모전', star }] });
ok('미분류 + STAR 면 14번이 살아 있다', pStarFree.includes('절대로 내놓으면 안 되는 답의 예'));

console.log('\n── 10. 지원동기 전용 프롬프트도 같은 사양을 쓰는가 ──');
const pm = DRAFT.buildMotivePrompt({
  company: '테스트', jobTitle: '마케팅', question: '지원동기 및 포부',
  evidence: [{ kind: 'biz', text: '도료 및 관련제품 제조', source: '사업보고서' }],
  picks: [], limit: 600,
});
ok('분량표가 들어간다', pm.includes('분량 배분'));
ok('포부 배분이 STAR 초안과 같다', pm.includes('[약 35%, 210자'));
ok('포부 > 접점 규칙이 들어간다', pm.includes('④ 포부가 ③ 접점보다 짧으면'));
ok('근거는 여전히 유일한 사실', pm.includes('유일한 사실'));
ok('빈칸 최소 1개 규칙이 살아 있다', pm.includes('빈칸이 하나도 없는 답은 틀린 답'));
/* ── 같은 규칙이 STAR 초안 경로에는 없어서 빈칸 0개가 나왔다 (실측 2026-09-01) ── */
ok('STAR 초안에도 빈칸 최소 1개 규칙이 붙는다', pMotive.includes('빈칸이 하나도 없는 답은 틀린 답'));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail) process.exit(1);
