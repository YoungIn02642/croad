#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   합격 자소서 표본 → 구조 지표 (backend/data/sample-corpus.json)

   ── 왜 만들었나 (사용자 요청 2026-09-08) ────────────────────
   합격 자소서 20편을 받아 놓고 "이걸로 딥러닝을 시킬 수 있나" 를 검토한 결과,
   **파인튜닝은 안 된다**는 결론이 났다. 이유는 양(문항 70개)이 아니라 구조다.
     · 학습에 필요한 입력(지원자 스펙)이 없다. 답변만 있다.
     · 스펙을 구해 붙여도, 스펙에 없는 값(댓글 60개·후원사 반응)이 답변에는 있다.
       그 격차를 맞추라고 시키는 것이 곧 **지어내기를 학습시키는 것**이다.
     · 합격 자소서에는 대괄호가 하나도 없다. 그걸로 학습시키면 모델은
       **빈칸을 남기지 않는 법**을 배운다 — 이 프로젝트의 유일한 안전장치가 지워진다.
   그래서 문장을 배우게 하는 대신 **구조를 재서** 쓴다. 이 스크립트가 그 자를 만든다.

   ── 원문은 저장하지 않는다 ──────────────────────────────────
   남의 저작물이다. .gitignore 가 이미 로고·포스터·공고에 같은 규칙을 적어 뒀고
   여기도 따른다. 이 파일이 내놓는 것은 **셀 수 있는 값뿐이다** — 문장 수, 글자 수,
   문단 배분, 숫자 밀도. 답변 본문은 한 글자도 JSON 에 들어가지 않는다.
   문항(질문)은 남는다. 그건 합격자가 쓴 글이 아니라 회사가 낸 문제이고,
   B(비슷한 문항 찾기)가 그것 없이는 동작하지 않는다.

   ── 실행 ────────────────────────────────────────────────────
     node backend/scripts/build-sample-corpus.js [표본폴더] [--merge]
   기본 폴더는 저장소 루트의 '자소서 코치 딥러닝 합격자소서' 다(있을 때만 돈다).

   ── --merge 가 왜 필요한가 (실측 2026-09-10) ────────────────
   원문은 깃에 없다(남의 저작물). 그래서 **폴더에 지금 있는 파일이 곧 전부**가 되고,
   그냥 다시 돌리면 예전에 재 둔 것이 통째로 사라진다. 실제로 그랬다 — 표본 10편을
   더 받았는데 폴더에는 새 10개만 있었고, 그대로 빌드했으면 **먼저 잰 20편(72문항)이
   날아갔다.** 다시 잴 방법이 없다(원문이 없으니).
   --merge 는 이미 있는 지표를 남기고 새로 잰 것만 더한다. 같은 답변인지는
   **문항 + 글자 수 + 문장 수**로 본다 — 본문을 저장하지 않으므로 이것이 우리가 가진
   가장 좁은 지문이고, 서로 다른 답변이 셋 다 같을 확률은 사실상 없다.
   원문을 전부 갖고 있다면 --merge 없이 도는 편이 낫다(그때가 진짜 전수 집계다).
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const QF = require('../../frontend/js/question-frames.js');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, '자소서 코치 딥러닝 합격자소서');
const OUT = path.join(__dirname, '..', 'data', 'sample-corpus.json');

/* 원문에 섞여 있는 사이트 UI 부스러기. 문항과 답변 사이에 그대로 들어 있다. */
const NOISE = /^(보기|답변|접기|펼치기|더보기|글자수|자소서 항목)\s*$/;

/* ── 문항 줄 판정 ────────────────────────────────────────────
   '1. …' 로 시작하는 줄이 문항이다. 그런데 **답변 본문 안에서도 번호를 매긴다**
   (합격 자소서 8: 현대차 핵심가치 답변이 "1. 주저하지 않고 도전하기 / 2. 최고가 된다는
   목표로" 로 나열하고, 다음 문항이 3. 으로 이어진다). 번호만 보면 그 나열이 문항으로
   잡혀서 답변이 토막 난다.
   그래서 **직전 문항 번호 + 1 일 때만** 문항으로 본다. 나열은 1 로 되돌아가므로 걸러진다. */
/* ── 그 규칙만으로는 부족했다 (실측 2026-09-10) ─────────────────────────────
   합격자소서 29 의 1번 답변(직무능력기술서)이 본문에서 다시 번호를 매긴다:
       1. 직무능력기술서 …                          ← 진짜 문항
       1. 자격(지식)                                ← 1 로 되돌아가 걸러짐(규칙이 먹힌다)
       2. 경험 - 지역신용보증재단 현장실습(2개월)      ← **이전+1 이라 문항으로 잡혔다**
       3. 경력 - 주택도시보증공사 인턴(6개월)         ← 마찬가지
       2. 공사 체험형 인턴 지원동기 …                 ← 진짜 문항인데 prevNo 가 3 이라 **버려졌다**
   가짜 둘이 들어오고 진짜 둘이 사라진다. 뒤엣것이 더 나쁘다 — 버려진 문항의 답변 글이
   앞 항목에 통째로 붙어 길이·문장 수를 오염시킨다.

   그래서 **이력서 항목의 생김새**를 걸러낸다. 좁은 규칙이라는 것을 알고 넣는다 —
   '자격(지식)'(소제목)과 '핵심역량'(진짜 문항)을 뜻으로 가르는 방법이 없기 때문이다.
   대신 걸러낸 줄을 빌드 로그에 남긴다. 새 표본에서 다른 모양이 나오면 눈에 띈다. */
const RESUME_LINE = [
  /[-–—]\s*\S.*\(\s*\d+\s*(개월|년|주|주간)\s*\)\s*$/,   // 경력 - 어디 인턴(6개월)
  /^(자격|지식|자격증|수상|어학)\s*[(（]/,                // 자격(지식)
  /^\d{4}[.\-/]\d{1,2}/,                                // 2019.09 ~ … (기간 줄)
];

function questionAt(line, prevNo) {
  const m = /^\s*(\d{1,2})\s*\.\s*(.+)$/.exec(line);
  if (!m) return null;
  const no = Number(m[1]);
  if (no !== prevNo + 1) return null;
  const text = m[2].trim();
  if (RESUME_LINE.some(re => re.test(text))) return { skip: true, text };
  return { no, text };
}

/* ── 소제목 ──────────────────────────────────────────────────
   합격 자소서는 문단 맨 앞에 따옴표로 묶은 한 줄 제목을 다는 일이 잦다
   ("눈길과 손길 모두 사로잡는 인재"). 본문 문장이 아니라 표제라서 문장 수에서 빼고
   따로 센다 — 이게 유형별로 얼마나 쓰이는지가 A 의 관찰 항목 중 하나다. */
const isSubhead = s => /^["'“”‘’<\[(].{2,40}["'“”‘’>\])]$/.test(s.trim());

/* 한국어 문장 나누기. 마침표·물음표·느낌표 뒤에서 끊는다. 소수점(3.5)과 줄임표에서
   끊기지 않게 '숫자.숫자' 와 연속 마침표는 피한다. */
function sentences(text) {
  return String(text || '')
    .replace(/(\d)\.(\d)/g, '$1$2')          // 3.5 → 임시 치환
    .split(/(?<=[.!?])\s+|(?<=다)\.\s*$/m)
    .map(s => s.replace(//g, '.').trim())
    .filter(s => s.length > 1);
}

/* 확인 가능한 사실의 대리 지표. 합격 자소서가 실제로 숫자를 얼마나 박는지를 잰다 —
   '구체적으로 써라' 대신 프롬프트에 넣을 수 있는 유일하게 셀 수 있는 값이다.
   연도(2024년)는 성과가 아니라 시점이라 뺀다. */
function numbers(text) {
  const hit = String(text || '').match(/\d+(?:[.,]\d+)?\s*(?:%|퍼센트|명|건|개|배|위|억|만|천|회|시간|일|주|개월|년)?/g) || [];
  return hit.filter(h => !/^(19|20)\d{2}\s*년?$/.test(h.trim()));
}

const countChars = s => String(s || '').replace(/\s/g, '').length;

/* ── 답변 한 편의 구조 지표 ──────────────────────────────────
   본문은 여기서만 보고 밖으로 내보내지 않는다. 나가는 것은 숫자뿐이다. */
function measure(question, bodyLines) {
  /* 빈 줄로 문단을 나눈다. 원문이 문단마다 빈 줄을 넣어 두었다. */
  const bodyParas = [];
  const subheads = [];
  let cur = [];
  const flushPara = () => { if (cur.length) { bodyParas.push(cur.join(' ')); cur = []; } };
  for (const ln of bodyLines) {
    const t = ln.trim();
    if (!t) { flushPara(); continue; }
    /* ── 소제목은 줄 단위로 잡는다 (실측 2026-09-08) ────────────────────────
       처음엔 문단을 만든 뒤 걸렀다. 그런데 원문이 소제목 뒤에 빈 줄을 안 넣는 일이
       있어서(합격 자소서 14), 소제목이 본문과 한 문단으로 붙어 버렸다. 그러면 표제가
       본문 문장으로 세어지고 대괄호 표제가 '빈칸' 으로 잡힌다. 줄에서 바로 가른다. */
    if (isSubhead(t)) { flushPara(); subheads.push(t); continue; }
    cur.push(t);
  }
  flushPara();
  if (!bodyParas.length) return null;

  const whole = bodyParas.join(' ');
  const allSents = sentences(whole);
  if (allSents.length < 2) return null;                 // 토막난 조각은 표본이 아니다

  const chars = countChars(whole);
  const nums = numbers(whole);
  const type = QF.classify(question);

  const perPara = bodyParas.map(p => {
    const s = sentences(p);
    return { sents: s.length, chars: countChars(p), numbers: numbers(p).length };
  });

  const first = allSents[0] || '';
  return {
    typeId: type ? type.id : null,
    typeLabel: type ? type.label : null,
    question,
    chars,
    sents: allSents.length,
    /* 문장당 글이 얼마나 긴가. question-prompts.js 의 SENT=65 상수가 여기서 검증된다. */
    charsPerSent: Math.round(chars / allSents.length),
    paras: bodyParas.length,
    perPara,
    numbers: nums.length,
    /* 100자당 숫자 개수. 유형끼리 길이가 달라 절대 개수로는 비교가 안 된다. */
    numberDensity: Number((nums.length / chars * 100).toFixed(2)),
    /* ── 대괄호 소제목 (실측 2026-09-08) ──────────────────────────────────
       원문 일부가 문단 머리에 **[지원 동기]·[성장 과정]** 처럼 대괄호로 표제를 단다.
       처음엔 이걸 brackets 로 세서 "합격 자소서에 빈칸이 있다" 는 이상한 값이 나왔다.
       우리가 쓰는 대괄호(채울 빈칸)와 생김새만 같고 뜻이 정반대다 — 표제로 센다. */
    subheads: subheads.length,
    /* 두괄식인가 — 첫 문장에 숫자나 결론 선언이 있는지. competency·challenge 골격이
       '결과를 먼저 선언' 을 요구하는데, 합격 자소서가 실제로 그러는지 확인하는 항목이다. */
    firstSentChars: countChars(first),
    firstSentHasNumber: numbers(first).length > 0,
    /* 표제를 뺀 나머지 대괄호. 합격 자소서는 완성된 글이라 채울 빈칸이 있을 리 없으므로
       0 이어야 한다 — 0 이 아니면 파싱이 틀렸다는 신호다(test/sample-corpus.test.js). */
    brackets: (whole.match(/\[[^\]]{1,40}\]/g) || []).length,
  };
}

/* 문항으로 오인될 뻔한 이력서 줄. 빌드 로그에 모아 찍는다 — 조용히 거르면
   새 표본에서 다른 모양이 나왔을 때 아무도 모른다. */
const skippedLines = [];

/* ── 파일 한 편 → 답변 여러 편 ───────────────────────────── */
function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const out = [];
  let q = null, body = [], prevNo = 0;

  const flush = () => {
    if (!q) return;
    const m = measure(q.text, body);
    if (m) out.push(m);
    q = null; body = [];
  };

  for (const ln of lines) {
    if (NOISE.test(ln)) continue;
    const hit = questionAt(ln, prevNo);
    /* 이력서 줄로 판정된 것은 **문항으로도 안 잡고 prevNo 도 안 올린다.** 올리면
       바로 뒤에 오는 진짜 문항이 번호가 안 맞아 통째로 버려진다(위 주석의 사고).
       본문의 일부이므로 답변에는 그대로 남긴다. */
    if (hit && hit.skip) {
      skippedLines.push(`${path.basename(file)}: ${hit.text}`);
      if (q) body.push(ln);
      continue;
    }
    if (hit) { flush(); q = hit; prevNo = hit.no; continue; }
    if (q) body.push(ln);
  }
  flush();
  return out;
}

/* 같은 답변인가. 본문이 없으므로 문항 + 길이 지표로 본다. */
const fingerprint = s => `${s.question}||${s.chars}||${s.sents}`;

function main() {
  const args = process.argv.slice(2);
  const merge = args.includes('--merge');
  const dir = args.find(a => !a.startsWith('--')) || DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    console.log(`표본 폴더가 없습니다: ${dir}`);
    console.log('원문은 저장소에 커밋하지 않으므로(남의 저작물), 폴더가 없으면 그냥 건너뜁니다.');
    console.log(`기존 ${path.relative(ROOT, OUT)} 는 그대로 둡니다.`);
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort();
  const samples = [];
  let skipped = 0;
  for (const f of files) {
    const got = parseFile(path.join(dir, f));
    if (!got.length) { skipped++; console.log(`  (문항을 못 찾음) ${f}`); continue; }
    /* 출처 파일명은 남기지 않는다 — 어느 회사 합격자의 글인지 되짚을 수 있으면
       '원문을 저장하지 않는다' 는 원칙이 반만 지켜진 것이다. 일련번호만 준다. */
    got.forEach((g, i) => samples.push({ id: `s${String(samples.length + 1).padStart(3, '0')}`, ...g }));
  }

  /* ── 이미 재 둔 것과 합친다 ────────────────────────────────────────────
     원문이 깃에 없어서, 합치지 않으면 이번 폴더에 없는 표본이 통째로 사라진다.
     새로 잰 쪽을 먼저 넣고, 예전 것 중 같은 지문이 없는 것만 뒤에 붙인다
     (같은 답변이면 새로 잰 값이 맞다 — 파서가 그새 고쳐졌을 수 있다). */
  let merged = samples;
  let kept = 0;
  if (merge) {
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { prev = null; }
    const seen = new Set(samples.map(fingerprint));
    const carry = (prev?.samples || []).filter(s => !seen.has(fingerprint(s)));
    kept = carry.length;
    merged = [...samples, ...carry]
      .map((s, i) => ({ ...s, id: `s${String(i + 1).padStart(3, '0')}` }));
  }

  const doc = {
    builtAt: new Date().toISOString().slice(0, 10),
    note: '합격 자소서 표본의 구조 지표만 담는다. 답변 본문은 들어 있지 않다(남의 저작물).',
    files: files.length,
    samples: merged,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  console.log(`파일 ${files.length}개 → 답변 ${samples.length}편${skipped ? ` (건너뜀 ${skipped})` : ''}`);
  if (skippedLines.length) {
    console.log(`문항이 아니라 이력서 줄로 보여 건너뛴 줄 ${skippedLines.length}개:`);
    for (const line of skippedLines) console.log(`  · ${line.slice(0, 76)}`);
  }
  if (merge) console.log(`이미 재 둔 표본 ${kept}편을 남겨 합쳤습니다 → 모두 ${merged.length}편`);
  else if (fs.existsSync(OUT)) {
    console.log('※ 이번 폴더에 없는 예전 표본은 사라집니다. 남기려면 --merge 를 붙이세요.');
  }
  const byAll = {};
  for (const s of merged) { const k = s.typeId || '(미분류)'; byAll[k] = (byAll[k] || 0) + 1; }
  console.log('유형별:', Object.entries(byAll).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log(`→ ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main();
module.exports = { parseFile, measure, sentences, numbers, questionAt, isSubhead };
