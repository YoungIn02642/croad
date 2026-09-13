#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   초안 실측 — RSTA 의 "첫 문장에 숫자를 붙여라" 가 실제로 좋은가

   ── 왜 재나 (사용자 지시 2026-09-13) ────────────────────────
   합격 자소서 102편을 재 보니 **첫 문장에 숫자가 있는 편은 15%뿐**이었다.
   그런데 `question-prompts.js` 의 competency(RSTA) 사양은 결론 덩이(R)에
   "그 선언에 **숫자나 사실 하나**를 같이 붙인다" 를 요구한다. 표본을 42% 늘려도
   결론이 같았으므로, 이 요구가 합격 자소서와 어긋난다는 의심이 든다.

   다만 **실측만으로 사양을 바꾸면 안 된다.** 합격자가 안 쓴다고 해서 그 지시가
   나쁜 초안을 만든다는 뜻은 아니다 — 사람이 쓴 글과 모델이 쓴 글은 실패하는 자리가
   다르다. 그래서 같은 입력으로 **두 사양을 각각 돌려** 결과를 재 본다.

   ── 무엇을 비교하나 ─────────────────────────────────────────
   A(지금)  : R 덩이에 '숫자나 사실 하나' 요구가 있다
   B(뺀 것) : 그 한 줄만 뺀다. 나머지는 전부 같다

   재는 값:
     · 첫 문장에 숫자가 있나        → 지시가 실제로 먹히는가
     · 빈칸(대괄호) 개수            → **지어내기 대신 비우는가가 핵심이다.**
                                      숫자를 요구하면 없는 수치를 만들어 낼 위험이 있다
     · STAR 에 없는 숫자가 나왔나   → 지어내기를 직접 센다(가장 중요한 값)
     · 길이·문장 수                 → 분량 규칙이 흔들리지 않았는지

   ── 이 스크립트가 판정하지 않는 것 ──────────────────────────
   "어느 쪽 문장이 더 좋은가" 는 재지 않는다. 그건 사람이 읽고 정할 일이고,
   숫자로 그런 척하면 잘못된 확신을 준다. 여기서는 **셀 수 있는 것만** 센다.

     node backend/scripts/check-draft-firstsent.js [--n 3]
   ════════════════════════════════════════════════════════════ */
require('dotenv').config();
const DRAFT = require('../src/draft-coach');
const QP = require('../src/question-prompts');
const { callDraftModel } = require('../src/ai-provider');

const arg = k => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const N = Number(arg('n') || 3);

/* 한 사람의 입력. 실제 화면에서 넘어오는 모양 그대로다(정성스펙 1개를 고른 경우). */
const INPUT = {
  company: '삼성전자',
  jobTitle: 'DX 데이터 마케팅',
  competencies: ['데이터 분석'],
  reads: '숫자를 다룰 줄 아는지가 아니라 무엇을 문제로 봤는지를 봅니다.',
  quotes: ['데이터를 근거로 문제를 정의하고 개선안을 제안할 수 있는 분'],
  question: '직무 수행에 필요한 역량을 갖추기 위해 노력한 경험을 구체적으로 서술해 주십시오.',
  limit: 600,
  activities: [{ name: '교내 마케팅 공모전', typeLabel: '대외활동', duration: '3개월', role: '팀장', outcome: '최우수상' }],
  picks: [{
    name: '교내 마케팅 공모전',
    star: {
      S: '동아리 홍보를 해도 신청자가 계속 줄었다',
      T: '신청자를 늘리는 것이 내 몫이었다',
      A: '학생 80명에게 설문해 안 오는 이유 상위 세 가지를 뽑고, 포스터 문구와 신청 동선을 바꿨다',
      R: '최우수상',
    },
  }],
};

/* STAR 에 적힌 숫자 — 초안에 이것 말고 다른 숫자가 나오면 지어낸 것이다.
   (대괄호 안의 값은 빈칸이므로 숫자로 세지 않는다.) */
const STAR_TEXT = Object.values(INPUT.picks[0].star).join(' ');
const numsIn = s => (String(s || '').replace(/\[[^\]]*\]/g, ' ')
  .match(/\d+(?:[.,]\d+)?/g) || []);

/* ── 한글 수사도 같은 숫자다 (실측 2026-09-13) ─────────────────────────────
   처음에는 아라비아 숫자만 셌다. 그랬더니 STAR 의 '상위 **세** 가지' 를 모델이
   '상위 **3**가지' 로 바꿔 쓴 것을 **지어낸 숫자로 잘못 잡았다.** 표현만 바꾼 것이지
   없는 값을 만든 게 아니다. STAR 에 있는 한글 수사를 숫자로도 인정한다. */
const KO_NUM = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  하나: 1, 둘: 2, 셋: 3, 넷: 4 };
const OWN_NUMS = new Set(numsIn(STAR_TEXT));
for (const [ko, n] of Object.entries(KO_NUM)) {
  if (STAR_TEXT.includes(ko)) OWN_NUMS.add(String(n));
}

const sentences = t => String(t || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 1);
const lenOf = t => String(t || '').replace(/\s/g, '').length;

function measure(draft) {
  const first = sentences(draft)[0] || '';
  const blanks = (String(draft).match(/\[[^\]]{1,30}\]/g) || []);
  const made = numsIn(draft).filter(n => !OWN_NUMS.has(n));
  return {
    firstHasNum: numsIn(first).length > 0,
    blanks: blanks.length,
    madeUpNums: made,
    chars: lenOf(draft),
    sents: sentences(draft).length,
    first: first.slice(0, 54),
  };
}

/* R 덩이의 '숫자나 사실 하나' 한 줄만 뺀 사양을 만든다. 원본을 건드리지 않으려고
   깊은 복사 후 되돌린다 — 같은 프로세스에서 A·B 를 번갈아 돌리기 때문이다. */
const NUM_RULE = /숫자나 \*\*|숫자나 사실 하나/;
function withoutNumberRule(fn) {
  const spec = QP.SPECS.competency;
  const R = spec.parts.find(p => p.key === 'R');
  const keep = R.must;
  R.must = keep.filter(m => !NUM_RULE.test(m));
  try { return fn(); } finally { R.must = keep; }
}

/* ── 실패는 건너뛴다. 다만 몇 번 실패했는지는 말한다 (실측 2026-09-13) ──────────
   실제로 겪었다: Gemini 무료 쿼터가 떨어져 Groq 로 넘어갔고(설계된 폴백), 그 Groq 가
   한 번 `Failed to generate JSON` 으로 400 을 냈다. 한 번 죽으면 그때까지의 호출이
   통째로 버려지므로 두 번까지 다시 부르고, 그래도 안 되면 그 회차만 뺀다.

   ── 어느 모델로 썼는지 같이 남긴다 ──
   폴백이 끼면 A 는 Gemini, B 는 Groq 로 재는 일이 생긴다. **다른 모델의 결과를 나란히
   놓으면 비교가 아니라 착각이다.** 그래서 회차마다 기록해 리포트에 찍는다. */
async function once(label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const used = {};
    try {
      const prompt = DRAFT.buildPrompt(INPUT);
      const out = DRAFT.parseDraft(
        await callDraftModel(prompt, DRAFT.SYSTEM, { num_ctx: 8192, num_predict: 1100 }, used));
      return { label, provider: used.provider || '?', model: used.model || '?',
        ...measure(out.draft), draft: out.draft };
    } catch (e) {
      if (attempt === 3) {
        console.log(`  (${label} 1회 실패로 건너뜀 — ${String(e.message).slice(0, 40)})`);
        return null;
      }
    }
  }
  return null;
}

function report(name, rows) {
  const n = rows.length;
  const pct = k => Math.round(rows.filter(k).length / n * 100);
  /* 어느 모델로 잰 것인지 제목에 박는다 — 폴백이 끼면 A·B 가 다른 모델일 수 있고,
     그걸 모르고 나란히 놓으면 비교가 아니라 착각이 된다. */
  const models = [...new Set(rows.map(r => `${r.provider}/${r.model}`))];
  console.log(`\n── ${name} (${n}회 · ${models.join(', ')}) ──`);
  console.log(`  첫 문장에 숫자   ${pct(r => r.firstHasNum)}%   (합격 자소서 실측 15%)`);
  console.log(`  빈칸 평균        ${(rows.reduce((a, r) => a + r.blanks, 0) / n).toFixed(1)}개`);
  console.log(`  빈칸 0개인 초안  ${rows.filter(r => r.blanks === 0).length}건  ← 0개는 대필이라 틀린 답이다`);
  const made = rows.filter(r => r.madeUpNums.length);
  console.log(`  지어낸 숫자      ${made.length}건` + (made.length ? ` — ${made.map(r => r.madeUpNums.join(',')).join(' / ')}` : ''));
  const avgChars = Math.round(rows.reduce((a, r) => a + r.chars, 0) / n);
  const avgSents = rows.reduce((a, r) => a + r.sents, 0) / n;
  console.log(`  길이 평균        ${avgChars}자 (목표 600자의 ${Math.round(avgChars / 600 * 100)}%)`
    + ` · ${avgSents.toFixed(1)}문장 (요구 11문장의 ${Math.round(avgSents / 11 * 100)}%)`);
  rows.forEach((r, i) => console.log(`   ${i + 1}) ${r.firstHasNum ? '숫자O' : '숫자X'} 빈칸${r.blanks} | ${r.first}…`));
}

(async () => {
  if (!process.env.GROQ_API_KEY) {
    console.log('GROQ_API_KEY 가 없습니다. backend/.env 를 확인하세요.');
    process.exit(1);
  }
  console.log(`같은 입력으로 ${N}회씩 두 사양을 돌립니다. 모델 응답이라 매번 다릅니다 —`);
  console.log('한 번만 보고 결론 내지 말 것.');

  const A = [];
  for (let i = 0; i < N; i++) { const r = await once('A'); if (r) A.push(r); }
  const B = [];
  for (let i = 0; i < N; i++) { const r = await withoutNumberRule(() => once('B')); if (r) B.push(r); }
  if (!A.length || !B.length) {
    console.log('\n한쪽이 전부 실패했습니다 — 비교할 수 없습니다.');
    return;
  }

  report('A · 지금 사양 (R 에 "숫자나 사실 하나" 요구)', A);
  report('B · 그 한 줄만 뺀 사양', B);
})();
