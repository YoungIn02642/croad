#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   합격 자소서 표본 구조 통계 (A) — question-prompts.js 상수의 실측 근거

   ── 무엇을 확인하려고 만들었나 ──────────────────────────────
   question-prompts.js 의 숫자들(덩이별 share%, 문장 환산 상수 SENT, 분량 하한 90%)은
   **모델을 움직이려고 고른 값**이지 합격 자소서를 재서 나온 값이 아니다. 주석에도
   "실측한 평균 63~78자의 아래쪽" 처럼 어림으로 적혀 있다. 이 스크립트는 그 값들을
   실제 합격 자소서 72편에 대 본다. 틀렸으면 바꿀 근거가 되고, 맞으면 근거가 생긴다.

   ── 재는 것과 재지 못하는 것 ────────────────────────────────
   잴 수 있다: 길이 · 문장 수 · 문장당 글자 수 · 문단 수와 문단별 배분 · 숫자 밀도 ·
              소제목 사용률 · 첫 문장이 두괄식인지 · 유형 분류가 먹히는지.
   못 잰다:   덩이별 share(%). ①기준 ②계기 ③접점 ④포부가 어디서 갈리는지는 규칙으로
              나눌 수 없다. 문단 경계로 근사할 뿐이라 **문단 배분까지만** 내놓는다.
              share 를 실측으로 바꾸려면 사람이 72편을 덩이로 표시해야 한다 — 그건
              이 스크립트가 하는 일이 아니고, 하는 척해서도 안 된다.

     node backend/scripts/analyze-samples.js
   ════════════════════════════════════════════════════════════ */
const path = require('path');
const QP = require('../src/question-prompts.js');
const QF = require('../../frontend/js/question-frames.js');

const CORPUS = path.join(__dirname, '..', 'data', 'sample-corpus.json');

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = n => Math.round(n * 10) / 10;
const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);

function bar(n, max, width = 24) {
  const w = max ? Math.round(n / max * width) : 0;
  return '█'.repeat(w) + '·'.repeat(width - w);
}

function main() {
  let doc;
  try { doc = require(CORPUS); }
  catch {
    console.log('표본 지표가 없습니다. 먼저 만드세요:');
    console.log('  node backend/scripts/build-sample-corpus.js');
    process.exit(1);
  }
  const S = doc.samples;
  /* doc.files 는 **마지막 빌드에 쓴 폴더**의 파일 수다. --merge 로 예전 표본을
     이어 붙이면 답변 수와 안 맞는다 — 그래서 '마지막 빌드' 라고 밝혀 적는다. */
  console.log(`합격 자소서 구조 통계 — 답변 ${S.length}편 (마지막 빌드 원문 ${doc.files}개 파일, ${doc.builtAt})\n`);

  /* ── 1. 분류가 먹히는가 ────────────────────────────────────
     프롬프트 사양은 유형이 걸려야 붙는다. 안 걸리면 골격도 분량표도 통째로 빠진
     채 초안이 나간다. 그래서 이 숫자가 다른 어떤 통계보다 먼저다. */
  console.log('── 1. 문항 분류 (question-frames.js) ──────────────────────');
  const miss = S.filter(s => !s.typeId);
  for (const t of QF.TYPES) {
    const n = S.filter(s => s.typeId === t.id).length;
    console.log(`  ${t.id.padEnd(11)} ${String(n).padStart(3)}편  ${bar(n, S.length)}  ${t.label}`);
  }
  console.log(`  ${'(미분류)'.padEnd(11)} ${String(miss.length).padStart(3)}편  ${bar(miss.length, S.length)}`
    + `  ← 골격·분량표가 통째로 빠진다`);
  console.log(`  분류 성공률 ${pct(S.length - miss.length, S.length)}%\n`);

  /* ── 2. 길이 ──────────────────────────────────────────────
     limit(목표 글자 수)은 사용자가 문항 제한을 넣어 정한다. 여기서 보는 것은
     "합격 자소서가 실제로 몇 문장짜리 글인가" 다. */
  console.log('── 2. 길이와 문장 ────────────────────────────────────────');
  const chars = S.map(s => s.chars), sents = S.map(s => s.sents);
  const cps = S.map(s => s.charsPerSent);
  console.log(`  글자 수      평균 ${Math.round(avg(chars))}자 · 중앙값 ${med(chars)}자`
    + ` · 범위 ${Math.min(...chars)}~${Math.max(...chars)}자`);
  console.log(`  문장 수      평균 ${r1(avg(sents))}문장 · 중앙값 ${med(sents)}문장`);
  console.log(`  문장당 글자  평균 ${Math.round(avg(cps))}자 · 중앙값 ${med(cps)}자`
    + ` · 범위 ${Math.min(...cps)}~${Math.max(...cps)}자`);
  /* ── 값을 하드코딩하지 않는다 (실측 2026-09-10) ────────────────────────
     '65자' 를 글로 박아 뒀는데, 2026-09-08 에 상수를 54 로 내리고도 이 줄은 그대로라
     **보고서가 "현재 65자" 라고 거짓말을 하고 있었다.** 실측을 대 보는 도구가 스스로
     낡은 값을 말하면 그 도구를 못 믿는다. 사양 파일에서 직접 읽는다. */
  const SENT = QP.SENT_CHARS;
  console.log(`               → question-prompts.js 의 SENT 상수는 현재 ${SENT}자`);
  const gap = Math.round(avg(cps)) - SENT;
  console.log(`               → 실측과 ${gap === 0 ? '일치' : `${Math.abs(gap)}자 ${gap > 0 ? '작다(문장 수를 과다 요구)' : '크다(문장 수를 과소 요구)'}`}\n`);

  /* ── 3. 문단 ──────────────────────────────────────────────
     덩이(share)를 직접 재지는 못하지만, **문단이 몇 개이고 얼마나 고른가**는 잴 수 있다.
     지금 사양은 유형마다 덩이가 4~5개인데, 합격 자소서가 실제로 그렇게 나누는지 본다. */
  console.log('── 3. 문단 구성 ──────────────────────────────────────────');
  const paras = S.map(s => s.paras);
  console.log(`  문단 수      평균 ${r1(avg(paras))}개 · 중앙값 ${med(paras)}개`
    + ` · 범위 ${Math.min(...paras)}~${Math.max(...paras)}개`);
  /* 가장 큰 문단이 전체의 몇 %인가 — 사양의 "한 덩이가 절반을 넘으면 틀린 답" 규칙이
     합격 자소서 기준으로 타당한지 확인한다. */
  const tops = S.map(s => {
    const total = s.perPara.reduce((a, p) => a + p.chars, 0) || 1;
    return Math.round(Math.max(...s.perPara.map(p => p.chars)) / total * 100);
  });
  const over50 = tops.filter(t => t > 50).length;
  console.log(`  최대 문단 비중 평균 ${Math.round(avg(tops))}% · 중앙값 ${med(tops)}%`);
  console.log(`               → 한 문단이 절반을 넘는 편: ${over50}편 (${pct(over50, S.length)}%)`);
  console.log(`               → 사양 규칙 "한 덩이가 절반을 넘으면 틀린 답" 과 대조할 것\n`);

  /* ── 4. 숫자 밀도 ─────────────────────────────────────────
     "결과에 숫자가 있는가" 는 제출 체크리스트 3번이고 사양이 덩이마다 요구하는 값이다.
     합격 자소서가 실제로 얼마나 박는지가 그 요구의 현실성을 정한다. */
  console.log('── 4. 숫자(확인 가능한 사실) ─────────────────────────────');
  const dens = S.map(s => s.numberDensity), nums = S.map(s => s.numbers);
  const zero = S.filter(s => s.numbers === 0).length;
  console.log(`  숫자 개수    평균 ${r1(avg(nums))}개 · 중앙값 ${med(nums)}개`);
  console.log(`  100자당      평균 ${r1(avg(dens))}개 · 중앙값 ${med(dens)}개`);
  console.log(`  숫자가 하나도 없는 편: ${zero}편 (${pct(zero, S.length)}%)`);
  console.log(`               → 400~600자 글이면 대략 ${r1(avg(dens) * 5)}~${r1(avg(dens) * 6)}개 수준\n`);

  /* ── 5. 두괄식·소제목 ─────────────────────────────────────
     competency 골격이 RSTA(결과 먼저)로 바뀐 근거는 "서류 심사가 앞에서 끊긴다" 였다.
     합격 자소서가 실제로 첫 문장에 결론을 놓는지, 소제목을 다는지 확인한다. */
  console.log('── 5. 도입부 ─────────────────────────────────────────────');
  const sub = S.filter(s => s.subheads > 0).length;
  const fnum = S.filter(s => s.firstSentHasNumber).length;
  console.log(`  소제목을 단 편        ${sub}편 (${pct(sub, S.length)}%)`);
  console.log(`  첫 문장에 숫자가 있는 편 ${fnum}편 (${pct(fnum, S.length)}%)`);
  console.log(`  첫 문장 길이 평균 ${Math.round(avg(S.map(s => s.firstSentChars)))}자`
    + ` (전체 문장 평균 ${Math.round(avg(cps))}자)\n`);

  /* ── 6. 유형별 ────────────────────────────────────────────
     유형마다 사양의 분량·문장 수 요구가 다르다. 표본이 적은 유형은 참고만 한다. */
  console.log('── 6. 유형별 ─────────────────────────────────────────────');
  console.log(`  ${'유형'.padEnd(12)} ${'편수'.padStart(4)} ${'글자'.padStart(6)} ${'문장'.padStart(5)}`
    + ` ${'문장당'.padStart(6)} ${'문단'.padStart(5)} ${'100자당숫자'.padStart(10)}`);
  for (const t of QF.TYPES) {
    const g = S.filter(s => s.typeId === t.id);
    if (!g.length) { console.log(`  ${t.id.padEnd(12)} ${String(0).padStart(4)}   (표본 없음)`); continue; }
    const spec = QP.specFor(t.id);
    const partN = spec ? spec.parts.length : 0;
    console.log(`  ${t.id.padEnd(12)} ${String(g.length).padStart(4)}`
      + ` ${String(Math.round(avg(g.map(s => s.chars)))).padStart(6)}`
      + ` ${String(r1(avg(g.map(s => s.sents)))).padStart(5)}`
      + ` ${String(Math.round(avg(g.map(s => s.charsPerSent)))).padStart(6)}`
      + ` ${String(r1(avg(g.map(s => s.paras)))).padStart(5)}`
      + ` ${String(r1(avg(g.map(s => s.numberDensity)))).padStart(10)}`
      + `   (사양 덩이 ${partN}개)`);
  }

  /* ── 7. 미분류 문항 ───────────────────────────────────────
     여기 남는 문항이 곧 할 일 목록이다. 정규식 구멍인지 없는 유형인지는 사람이 읽고
     판단한다 — 유형을 새로 만드는 것은 골격을 정하는 일이라 통계가 대신할 수 없다. */
  if (miss.length) {
    console.log(`\n── 7. 분류에 걸리지 않은 문항 ${miss.length}개 ────────────────────`);
    for (const m of miss) console.log(`  · ${m.question.slice(0, 78)}`);
  }
}

if (require.main === module) main();
