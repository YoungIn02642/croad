/* 합격 자소서 표본 — 구조 지표(A)와 비슷한 문항 찾기(B) 검사.

   가장 중요한 검사는 **"본문이 새어 나가지 않는가"** 다. 이 기능의 존재 이유가
   "남의 문장을 모델에 보여 주지 않는다" 이므로, 그게 깨지면 기능이 해로워진다.
   표본 파일이 없는 환경(원문 미보유)에서도 서버가 떠야 하므로 그쪽도 같이 본다. */
const CORPUS = require('../backend/src/sample-corpus.js');
const QF = require('../frontend/js/question-frames.js');
const QP = require('../backend/src/question-prompts.js');
const BUILD = require('../backend/scripts/build-sample-corpus.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

/* ── 1. 파서 ──────────────────────────────────────────────── */
{
  /* 답변 본문 안의 번호 나열이 문항으로 잡히면 답변이 토막 난다(합격 자소서 8 의
     현대차 핵심가치 답변이 실제로 그랬다). 번호가 이전+1 일 때만 문항이다. */
  ok('문항 번호는 이어질 때만 문항', !!BUILD.questionAt('3. 지원동기를 쓰시오', 2));
  ok('답변 속 번호 나열은 문항이 아니다', BUILD.questionAt('1. 도전하기', 2) === null);
  ok('번호 없는 줄은 문항이 아니다', BUILD.questionAt('저는 팀장을 맡았습니다.', 0) === null);

  ok('소제목을 알아본다', BUILD.isSubhead('"눈길과 손길 모두 사로잡는 인재"'));
  ok('본문 문장은 소제목이 아니다', !BUILD.isSubhead('저는 광고 동아리에서 영상부장을 맡았습니다.'));

  /* 소수점에서 문장이 끊기면 문장 수가 부풀고, 문장당 글자 수(SENT 상수의 근거)가 망가진다. */
  ok('소수점에서 문장을 끊지 않는다', BUILD.sentences('전환율이 3.5%에서 7.2%로 올랐습니다.').length === 1);
  ok('마침표에서 문장을 끊는다', BUILD.sentences('첫째입니다. 둘째입니다.').length === 2);

  /* 연도는 성과가 아니라 시점이라 '확인 가능한 숫자'에서 뺀다. */
  ok('연도는 숫자로 세지 않는다', BUILD.numbers('2024년에 시작했습니다').length === 0);
  ok('성과 수치는 숫자로 센다', BUILD.numbers('댓글 60개를 받았습니다').length === 1);
}

/* ── 2. 분류 (A 로 메운 구멍) ─────────────────────────────────
   실측에서 걸리지 않았던 실제 문항들이다. 다시 빠지면 골격·분량표가 통째로 안 붙는다. */
{
  const cases = [
    ['해당회사 및 직무에 지원하는 동기에 대해 기술해 주시기 바랍니다.', 'motive'],
    ['한국장학재단에 입사 지원을 해야겠다고 결심하게 된 계기는 무엇인지 기술해 주십시오.', 'motive'],
    ['넥센타이어에 입사한다면 이루고자 하는 목표를 서술해주세요.', 'motive'],
    ['입사 5년 후, 회사에서 내가 듣고 싶은 나의 평판은 무엇인지 서술해주세요.', 'motive'],
    ['귀하가 생각하는 소통과 협력은 무엇인지 서술해주세요.', 'collab'],
    ['공동과제 수행 시 타인과의 협력으로 큰 성과를 거두었던 경험을 기술해 주십시오.', 'collab'],
    ['핵심역량', 'competency'],
    ['재단의 직무를 수행함에 있어 본인이 가지고 있는 차별화된 경쟁력이 무엇인지 기술해 주십시오.', 'competency'],
    ['지원하신 직무를 수행하기 위해 필요한 역량을 기르고자 어떤 노력을 했는지 서술해주세요.', 'competency'],
  ];
  for (const [q, want] of cases) {
    const got = QF.classify(q)?.id || null;
    ok(`분류: ${q.slice(0, 26)}…`, got === want, `→ ${got}`);
  }
  /* 기존 분류가 새 정규식에 밀려나지 않았는지. 특히 collab 에 '소통' 을 넣었으므로
     성격 장단점이 협업으로 새지 않는지 본다(좁은 유형이 먼저라는 순서 규칙). */
  ok('성격 장단점은 그대로', QF.classify('본인 성격의 장단점을 서술하여 주십시오')?.id === 'trait');
  ok('성장과정은 그대로', QF.classify('본인의 성장과정을 기술하시기 바랍니다')?.id === 'growth');
  ok('문제해결은 그대로', QF.classify('도전적인 목표를 정하고 추진했던 경험을 기술해 주십시오')?.id === 'challenge');
}

/* ── 3. SENT 상수 (A 의 실측 반영) ───────────────────────────
   65 → 54 로 내렸다. 문장 수를 더 요구하게 되는 방향이 맞는지 확인한다. */
{
  const block = QP.frameBlock('motive', { label: '지원동기', limit: 600 });
  ok('분량표가 나온다', typeof block === 'string' && block.includes('문장'));
  const m = /전체 \*\*(\d+)문장\*\*/.exec(block || '');
  const sents = m ? Number(m[1]) : 0;
  /* 600자 / 54자 ≈ 11문장. 65자 시절에는 9문장이었다. */
  ok('600자 문항에 11문장 안팎을 요구한다', sents >= 10 && sents <= 12, `→ ${sents}문장`);
}

/* ── 4. 비슷한 문항 찾기 (B) ────────────────────────────────── */
{
  if (!CORPUS.isLoaded()) {
    /* 원문을 갖고 있지 않은 환경(배포 서버·다른 팀원)에서는 이게 정상 경로다. */
    ok('표본이 없어도 죽지 않는다', CORPUS.structureBlock('지원동기를 쓰시오', { limit: 600 }) === null);
    console.log('  (표본 파일이 없어 B 검사는 건너뜁니다 — node backend/scripts/build-sample-corpus.js)');
  } else {
    const q = '해당 회사에 지원하게 된 동기를 구체적으로 기술해 주십시오.';
    const hits = CORPUS.nearest(q);
    ok('비슷한 문항을 찾는다', hits.length > 0, `→ ${hits.length}편`);
    ok('같은 유형에서만 찾는다', hits.every(h => h.typeId === 'motive'));

    const block = CORPUS.structureBlock(q, { limit: 600 });
    ok('구조 블록이 나온다', typeof block === 'string' && block.includes('문단'));

    /* ── 이 검사가 이 파일의 핵심이다 ────────────────────────────────
       표본의 본문이 한 글자도 프롬프트로 새어 나가면 안 된다. JSON 자체에 본문이
       없어야 하고(구조 지표만), 블록에도 문항 문구가 그대로 실리면 안 된다. */
    const doc = require('../backend/data/sample-corpus.json');
    const fields = new Set();
    for (const s of doc.samples) Object.keys(s).forEach(k => fields.add(k));
    const allowed = new Set(['id', 'typeId', 'typeLabel', 'question', 'chars', 'sents',
      'charsPerSent', 'paras', 'perPara', 'numbers', 'numberDensity', 'subheads',
      'firstSentChars', 'firstSentHasNumber', 'brackets']);
    const extra = [...fields].filter(f => !allowed.has(f));
    ok('표본 JSON 에 구조 지표 말고는 없다', extra.length === 0, extra.length ? `→ ${extra}` : '');
    ok('표본 JSON 에 답변 본문이 없다',
      doc.samples.every(s => typeof s.chars === 'number' && !('text' in s) && !('body' in s)));

    /* ── '대괄호 0개' 는 표본이 늘자 너무 빡빡해졌다 (실측 2026-09-10) ──────────
       원래 뜻은 "우리가 쓰는 빈칸 대괄호가 섞여 들어오면 파싱이 틀린 것" 이었다.
       그런데 102편으로 늘리니 **지원자가 직접 쓴 대괄호**가 나왔다 —
       합격자소서 25 의 "[TENG 제작]과 [살균] 두 가지 주제로 나누어" 처럼 문장 한가운데
       말머리로 쓴 것이다. 파싱 오류가 아니라 원문 그대로다.
       그래서 '하나도 없어야 한다' 대신 **드물어야 한다**로 바꾼다. 파싱이 통째로
       틀어지면(우리 템플릿이 섞여 들어오면) 비율과 편당 개수가 같이 튀므로 여전히 걸린다. */
    const withBrackets = doc.samples.filter(s => s.brackets > 0);
    ok('대괄호가 있는 표본은 드물다(파싱 건전성)',
      withBrackets.length / doc.samples.length < 0.05,
      `→ ${withBrackets.length}/${doc.samples.length}편`);
    ok('한 편에 대괄호가 몰려 있지 않다',
      doc.samples.every(s => s.brackets <= 3),
      `→ 최대 ${Math.max(0, ...doc.samples.map(s => s.brackets))}개`);

    /* 블록은 숫자와 지시문만이어야 한다 — 표본 문항이 통째로 실리면 그것도 유출이다. */
    const sampleQs = doc.samples.map(s => s.question).filter(t => t.length > 20);
    ok('구조 블록에 표본 문항이 실리지 않는다',
      sampleQs.every(t => !block.includes(t.slice(0, 20))));

    ok('분량표가 우선임을 명시한다', block.includes('분량 배분표가 우선'));

    /* ── 실측 회귀 (2026-09-08) ────────────────────────────────────────────
       실제 프롬프트를 뽑아 보니 600자 문항에 "문단: 6개로 끊는다" 가 나갔다.
       직무역량 표본이 평균 835자짜리 긴 글이라 문단이 많았을 뿐인데 그 개수를
       짧은 문항에 그대로 시킨 것이다. 600자를 6문단으로 끊으면 문단이 아니라 줄바꿈이다.
       숫자처럼 문단도 밀도로 환산해야 한다. */
    const paraOf = b => Number(/문단: (\d+)개/.exec(b || '')?.[1] || 0);
    const short = paraOf(CORPUS.structureBlock(q, { limit: 400 }));
    const long = paraOf(CORPUS.structureBlock(q, { limit: 1200 }));
    ok('문단 수를 목표 분량으로 환산한다', short < long, `→ 400자 ${short}문단 · 1200자 ${long}문단`);
    ok('짧은 문항에 문단을 잘게 쪼개지 않는다', short >= 2 && short <= 3, `→ ${short}문단`);
    ok('긴 문항이라도 5문단을 넘지 않는다', long <= 5, `→ ${long}문단`);

    /* 유사도가 낮으면 아무것도 주지 않는 편이 낫다 — 엉뚱한 구조를 시키느니. */
    ok('안 닮은 문항에는 아무것도 주지 않는다',
      CORPUS.structureBlock('좋아하는 음식과 그 이유를 쓰시오', { typeId: 'trait' }) === null);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
