/* ════════════════════════════════════════════════════════════
   비슷한 합격 자소서의 **구조**를 찾아 준다 (B)

   ── 왜 문장이 아니라 구조인가 ───────────────────────────────
   합격 자소서 20편으로 파인튜닝을 검토했다가 접었다(사유는 build-sample-corpus.js 머리말).
   남은 길은 "비슷한 문항의 합격 답을 예시로 보여 준다" 인데, **문장을 보여 주면 안 된다.**
   draft-coach.js 가 이미 그 사고를 겪었다 — cover-guide 의 good 예시를 프롬프트에 넣었더니
   모델이 그것을 양식이 아니라 **내용으로 읽고 통째로 베꼈고**, 사용자가 하지도 않은
   '화면 정의서'·'2주차 중간 점검' 이 자소서에 사실처럼 나갔다. 그래서 good 을 뺐고,
   copiedFromExample() 로 베낌을 검사까지 한다. 남의 합격 자소서를 넣으면 같은 사고가
   **더 나쁜 형태로**(남의 실제 경험이 사용자 자소서에 박힌 채) 재발한다.

   그래서 이 모듈은 문장을 갖고 있지 않다. sample-corpus.json 에 애초에 본문이 없다 —
   문장 수·문단 배분·숫자 개수 같은 **셀 수 있는 값**뿐이다. 베낄 것이 없다.

   ── 분량표와 겹치지 않는 것만 말한다 ────────────────────────
   question-prompts.js 의 frameBlock 이 이미 덩이별 글자 수·문장 수를 못 박고 있다.
   여기서 문장 수를 또 말하면 모델이 **서로 다른 두 목표**를 동시에 받는다. 이 저장소가
   반복해서 기록한 실패가 정확히 그것이다(규칙 6 이 지원동기의 포부와 부딪힌 건 등).
   그래서 분량표가 다루지 않는 것만 준다: **문단을 몇 개로 끊는가 · 숫자를 몇 개 박는가 ·
   소제목을 다는가 · 첫 문장에 숫자를 넣는가.**

   ── 표본이 없으면 조용히 빠진다 ─────────────────────────────
   sample-corpus.json 은 원문(남의 저작물)이 있어야 만들어진다. 없는 환경에서도 서버는
   그대로 떠야 하므로 null 을 돌려주고 초안은 예전대로 나간다.
   ════════════════════════════════════════════════════════════ */
const path = require('path');
const QF = require('../../frontend/js/question-frames.js');

const CORPUS = path.join(__dirname, '..', 'data', 'sample-corpus.json');

let cache;
function corpus() {
  if (cache !== undefined) return cache;
  try { cache = require(CORPUS); }
  catch { cache = null; }        // 표본이 없는 환경(원문 미보유·배포 서버) — 정상이다
  return cache;
}

/* ── 문항 정규화 ────────────────────────────────────────────
   글자 수 안내('(500자 이내)')와 작성 가이드는 문항의 내용이 아니라 서식이라 뺀다.
   회사명은 굳이 지우지 않는다 — 어차피 두 문항이 같은 회사일 확률이 낮아서
   유사도에 거의 기여하지 않고, 지우려면 회사명 사전이 필요하다. */
function norm(q) {
  return String(q || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')          // (500자 이내) · [250~500자]
    .replace(/Guide>.*$/i, ' ')
    .replace(/[^가-힣a-zA-Z0-9]+/g, ' ')
    .trim();
}

/* 글자 2-gram 자카드. 한국어는 조사·어미가 붙어 어절이 잘 안 맞으므로 어절이 아니라
   글자로 자른다("지원동기" 와 "지원하는 동기" 가 어절로는 0, 2-gram 으로는 겹친다). */
function bigrams(s) {
  const t = s.replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}
function similarity(a, b) {
  const A = bigrams(norm(a)), B = bigrams(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/* 너무 안 닮은 것을 끌어오면 엉뚱한 구조를 시킨다. 표본이 72편뿐이라 문턱을 넘는
   문항이 없는 일이 흔하고, 그때는 아무것도 주지 않는 편이 낫다. */
const MIN_SIM = 0.12;
const TOP_N = 3;

/* ── 비슷한 표본 찾기 ───────────────────────────────────────
   같은 유형 안에서만 찾는다. 유형이 다르면 구조가 다른 것이 당연하고(성격 장단점과
   지원동기는 문단 구성이 다르다), 유형은 이미 분류기가 판정해 준다. */
function nearest(question, typeId) {
  const doc = corpus();
  if (!doc || !doc.samples?.length) return [];
  const type = typeId || QF.classify(question)?.id || null;
  /* ── 유형을 모르면 아무것도 주지 않는다 (검사에서 잡힘) ────────────────────
     처음엔 유형이 없으면 표본 전체에서 찾게 해 뒀다. 그러면 성격 장단점 문항에
     지원동기의 문단 구성이 붙을 수 있다 — 유형마다 구조가 다르다는 게 이 기능의
     전제인데 그 전제를 스스로 깬다. 게다가 미분류 문항에는 분량표도 없어서
     "분량표가 우선" 이라는 안내가 가리킬 곳이 없다. 유형이 있을 때만 돈다. */
  if (!type) return [];
  const pool = doc.samples.filter(s => s.typeId === type);
  if (!pool.length) return [];
  return pool
    .map(s => ({ s, sim: similarity(question, s.question) }))
    .filter(x => x.sim >= MIN_SIM)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, TOP_N)
    .map(x => x.s);
}

const med = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/* ── 프롬프트 블록 ──────────────────────────────────────────
   Context 에 들어간다. 값은 **중앙값**을 쓴다 — 표본이 3편 이하라 평균은 한 편이
   길면 통째로 끌려간다(범위가 169~2233자다).

   숫자 목표는 '개수' 가 아니라 '밀도 × 목표 글자수' 로 환산해서 준다. 표본은 500자,
   지금 문항은 900자일 수 있는데 개수를 그대로 주면 밀도가 절반이 된다. */
function structureBlock(question, { limit, typeId } = {}) {
  const hits = nearest(question, typeId);
  if (!hits.length) return null;

  const total = Number(limit) || 600;

  /* ── 문단 수도 분량으로 환산한다 (실측 프롬프트에서 잡음 2026-09-08) ──────────
     처음엔 표본의 문단 수를 그대로 옮겼다. 그랬더니 600자 문항에 **"문단: 6개로
     끊는다"** 가 나갔다 — 직무역량 표본이 평균 835자짜리 긴 글이라 문단이 많았던 것뿐인데,
     그 개수를 짧은 문항에 그대로 시킨 것이다. 600자를 6문단으로 끊으면 한 문단이
     두 문장이라 문단이 아니라 줄바꿈이 된다.
     숫자는 밀도(100자당)로 환산해 놓고 문단만 빠뜨렸다. 같은 방식으로 고친다 —
     **표본의 100자당 문단 수 × 목표 글자 수.**
     2~5로 가둔다: 1문단이면 구조가 없고, 6문단이면 위 증상이 돌아온다. */
  const paraDensity = hits.reduce((a, h) => a + h.paras / h.chars, 0) / hits.length;
  const paras = Math.min(5, Math.max(2, Math.round(paraDensity * total)));
  const density = hits.reduce((a, h) => a + h.numberDensity, 0) / hits.length;
  const nums = Math.max(1, Math.round(density * total / 100));
  const subhead = hits.filter(h => h.subheads > 0).length;
  const firstNum = hits.filter(h => h.firstSentHasNumber).length;

  const lines = [
    `실제 합격 자소서 중 **이 문항과 비슷한 문항** ${hits.length}편을 재 본 결과다.`
      + ` 문장은 주지 않는다(남의 글이다). **구조만 참고하고, 내용은 위 지원자 사실로만 써라.**`,
    `  · 문단: ${paras}개로 끊는다`
      + (paras <= 2 ? ' — 합격 자소서는 문단을 잘게 쪼개지 않는다' : ''),
    `  · 확인 가능한 숫자: 이 분량(${total}자)이면 **${nums}개** 정도가 실제 수준이다.`
      + ` 더 박으려고 없는 수치를 지어내지 마라 — 모르면 대괄호로 비운다`,
    `  · 소제목(따옴표로 묶은 한 줄 제목): ${subhead ? '단 편이 있다. 달아도 된다' : '달지 않는다'}`,
    `  · 첫 문장: ${firstNum ? '숫자로 시작하는 편이 있다' : '숫자로 시작하지 않는다. 결론·기준 선언으로 연다'}`,
    `  ※ 위 **분량 배분표가 우선이다.** 이 값과 부딪히면 분량표를 따르고, 이건 참고만 한다.`,
  ];
  return lines.join('\n');
}

module.exports = { nearest, structureBlock, similarity, norm, isLoaded: () => !!corpus() };
