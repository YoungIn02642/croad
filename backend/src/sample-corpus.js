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

/* 글자 2-gram. 한국어는 조사·어미가 붙어 어절이 잘 안 맞으므로 어절이 아니라
   글자로 자른다("지원동기" 와 "지원하는 동기" 가 어절로는 0, 2-gram 으로는 겹친다). */
function bigrams(s) {
  const t = s.replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

/* ── 흔한 말은 덜 세고, 짧은 쪽을 분모로 쓴다 (실측 2026-09-14) ────────────────
   ── 무엇이 문제였나 ──
   자카드였다: 겹친 2-gram ÷ 합집합. 그러면 **문항이 길수록 점수가 깎인다** — 분모가
   커지기 때문이다. 실제 공고 문항은 조건·가이드가 붙어 길고, 표본 문항은 짧은 것이
   섞여 있다. 표본끼리 재 보면 60자 넘는 문항의 적중이 38%로 떨어졌다(30자 미만은 75%).

   ── 두 가지를 바꾼다 ──
   ① 분모를 **짧은 쪽**으로 한다. 긴 문항이 짧은 문항을 담고 있으면 그건 닮은 것이다.
   ② 2-gram 마다 **idf** 로 무게를 준다. '경험' '기술해' '주세요' 는 거의 모든 문항에
      있어서 정보가 없고, 자카드에서는 그 흔한 조각들이 분모만 불렸다. 무게는 표본
      102편의 등장 빈도로 낸다 — 밖에서 가져오는 값이 없다.

   ── 얼마나 나아지나 (표본 leave-one-out) ──
   전체 적중 54/80 → 55/80, 100자 넘는 문항 0% → 100%, 그러면서 **다른 유형끼리 문턱을
   넘는 짝은 4.2% → 3.6% 로 줄었다**(더 붙는데 더 깐깐해졌다. idf 덕이다).

   ── 협업 유형은 이걸로도 안 붙는다 ──
   표본 11편이 서로 0.12~0.19 밖에 안 나온다. 같은 말을 다른 어휘로 묻기 때문이라
   (`소통과 협력` · `조직문화` · `공동과제`) 글자 겹침으로는 못 잡는다. 문턱을 낮춰
   붙이려다 **3-gram 짜리 표본('협업 경험')에 아무 문항이나 붙는 것**을 확인했다 —
   점수는 0.57 이 나오지만 신호가 아니라 잡음이다. 그래서 문턱을 낮추는 대신
   아래 structureBlock 이 **같은 유형의 중앙값**으로 답한다. */
let idfCache;
function idfTable() {
  if (!idfCache) {
    const samples = corpus()?.samples || [];
    const df = new Map();
    for (const s of samples) for (const g of bigrams(norm(s.question))) df.set(g, (df.get(g) || 0) + 1);
    idfCache = { df, n: samples.length };
  }
  return idfCache;
}

/* ── 상투어는 아예 안 센다 ──────────────────────────────────────────────
   idf 로 무게를 낮추는 것만으로는 **짧은 문항끼리** 가 안 걸러진다. '좋아하는 음식을
   기술해 주세요' 와 '직무 관련 경험을 기술해 주세요' 는 겹치는 것이 '기술해 주세요'
   뿐인데 0.29 가 나왔다(둘 다 짧아서 그 상투어가 내용의 대부분이다).
   그래서 표본 40% 넘게 나오는 2-gram 은 **없는 셈 친다.** 0.4 는 실측으로 골랐다 —
   적중 55/80 을 그대로 두면서 위 상투어 쌍이 0.21 로 내려가 문턱 아래가 되고,
   긴 문항↔짧은 문항은 0.42 로 남는다(0.3 까지 내리면 적중이 53 으로 떨어진다). */
const STOP_DF = 0.4;
const informative = g => {
  const { df, n } = idfTable();
  return n ? (df.get(g) || 0) / n <= STOP_DF : true;
};
const idfOf = g => {
  const { df, n } = idfTable();
  return Math.log((n + 1) / ((df.get(g) || 0) + 0.5));
};
const weight = set => { let w = 0; for (const g of set) if (informative(g)) w += idfOf(g); return w; };

function similarity(a, b) {
  const A = bigrams(norm(a)), B = bigrams(norm(b));
  if (!A.size || !B.size) return 0;
  const min = Math.min(weight(A), weight(B));
  if (!min) return 0;
  let hit = 0;
  for (const g of A) if (informative(g) && B.has(g)) hit += idfOf(g);
  return hit / min;
}

/* 너무 안 닮은 것을 끌어오면 엉뚱한 구조를 시킨다. 문턱은 표본으로 재서 잡았다 —
   0.25 에서 적중 55/80 · 다른 유형끼리 넘는 짝 3.6% 였고, 0.20 으로 내리면 적중이
   60/80 으로 늘지만 그 짝이 7.7% 로 뛴다(그 늘어난 적중의 대부분이 아래 MIN_GRAMS
   에 걸리는 짧은 표본이었다). 문턱을 못 넘어도 이제 빈손은 아니다 — 같은 유형의
   중앙값이 나간다(structureBlock). */
const MIN_SIM = 0.25;
const TOP_N = 3;

/* ── 검색 열쇠로 쓰기엔 너무 짧은 표본 ──────────────────────────────────
   '협업 경험'(2-gram 3개) 같은 문항이 표본에 있다. 짧은 쪽이 분모라, 이런 표본은
   **아무 협업 문항에나 0.5 넘게 붙는다**(실측). 겹친 것이 '협업' 하나뿐인데도 그렇다.
   그래서 **검색 후보에서만** 뺀다 — 그 편의 구조(문단·숫자)는 멀쩡한 자료라
   같은 유형 중앙값에는 그대로 들어간다. 8개면 한글 아홉 자쯤이다. */
const MIN_GRAMS = 8;

/* 유형 중앙값을 낼 최소 표본 수. 3편 이하면 중앙값이 한 편에 끌려다녀서,
   '합격 자소서가 이렇다' 고 말할 근거가 못 된다. 지금 유형별 표본은 7~30편이다. */
const MIN_POOL = 4;

/* ── 한 편만 잡히면 그 한 편을 따르지 않는다 (실측 2026-09-14) ────────────────
   이 파일은 이미 "표본이 3편 이하라 평균은 한 편이 길면 통째로 끌려간다" 고 적어
   두고 중앙값을 쓴다. 그런데 **잡힌 표본이 1편이면 중앙값도 그 한 편이다.**
   실제로 협업 800자에서 한 편만 잡혔을 때 '문단 5개 · 숫자 8개' 가 나왔다 —
   같은 유형 11편으로 재면 '문단 3개 · 숫자 4개' 다. 800자에 숫자 8개를 요구하면
   모델이 없는 수치를 지어내는 쪽으로 밀린다(이 저장소가 계속 막아 온 그 실패다).
   그래서 2편 미만이면 '비슷한 문항' 이라고 부르지 않고 유형 중앙값으로 간다. */
const MIN_HITS = 2;

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
    .filter(s => bigrams(norm(s.question)).size >= MIN_GRAMS)   // 짧은 표본은 열쇠로 못 쓴다
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
  const found = nearest(question, typeId);
  const hits = found.length >= MIN_HITS ? found : [];
  /* ── 문턱을 못 넘어도 빈손으로 두지 않는다 (사용자 지시 2026-09-14) ──────────
     ── 왜 필요한가 ──
     협업 유형은 표본이 11편이나 있는데 **문항끼리 말이 달라서** 하나도 안 붙는다
     (similarity 주석의 실측). 그 11편의 구조는 멀쩡한 자료인데, 검색이 못 찾았다는
     이유로 통째로 버리고 있었다 — 학생 화면에서는 '합격 자소서를 학습했다'고 해 놓고
     정작 협업 문항에는 아무것도 안 나가던 자리다.

     ── 무엇이 달라지나 ──
     비슷한 문항을 찾으면 그 3편의 중앙값(specific), 못 찾으면 **같은 유형 전체**의
     중앙값(type)이다. 둘은 근거의 세기가 다르므로 **블록이 스스로 어느 쪽인지 말한다** —
     "비슷한 문항 3편" 과 "같은 유형 11편" 은 학생이 읽었을 때 다른 무게여야 한다.

     ── 유형이 없으면 여전히 아무것도 안 준다 ──
     유형을 모르면 분량표도 없어서 "분량표가 우선" 이라는 안내가 가리킬 곳이 없다.
     표본이 너무 적은 유형(4편 미만)도 중앙값이 한 편에 끌려다니므로 그냥 뺀다. */
  const type = typeId || QF.classify(question)?.id || null;
  const doc = corpus();
  const pool = (hits.length || !type || !doc)
    ? hits
    : doc.samples.filter(s => s.typeId === type);
  if (!pool.length || (!hits.length && pool.length < MIN_POOL)) return null;

  const total = Number(limit) || 600;

  /* ── 문단 수도 분량으로 환산한다 (실측 프롬프트에서 잡음 2026-09-08) ──────────
     처음엔 표본의 문단 수를 그대로 옮겼다. 그랬더니 600자 문항에 **"문단: 6개로
     끊는다"** 가 나갔다 — 직무역량 표본이 평균 835자짜리 긴 글이라 문단이 많았던 것뿐인데,
     그 개수를 짧은 문항에 그대로 시킨 것이다. 600자를 6문단으로 끊으면 한 문단이
     두 문장이라 문단이 아니라 줄바꿈이 된다.
     숫자는 밀도(100자당)로 환산해 놓고 문단만 빠뜨렸다. 같은 방식으로 고친다 —
     **표본의 100자당 문단 수 × 목표 글자 수.**
     2~5로 가둔다: 1문단이면 구조가 없고, 6문단이면 위 증상이 돌아온다. */
  const paraDensity = pool.reduce((a, h) => a + h.paras / h.chars, 0) / pool.length;
  const paras = Math.min(5, Math.max(2, Math.round(paraDensity * total)));
  const density = pool.reduce((a, h) => a + h.numberDensity, 0) / pool.length;
  const nums = Math.max(1, Math.round(density * total / 100));
  const subhead = pool.filter(h => h.subheads > 0).length;
  const firstNum = pool.filter(h => h.firstSentHasNumber).length;
  /* 소제목·첫 문장은 '있다/없다' 가 아니라 **몇 편이 그랬나** 로 판단한다. 비슷한
     문항 3편일 때는 한 편만 달아도 '달아도 된다' 가 맞지만, 유형 전체 11편에서
     한 편이면 그건 예외다. 그래서 중앙값 갈래에서는 과반을 본다. */
  const many = n => (hits.length ? n > 0 : n * 2 > pool.length);

  const lines = [
    hits.length
      ? `실제 합격 자소서 중 **이 문항과 비슷한 문항** ${pool.length}편을 재 본 결과다.`
      : `이 문항과 비슷한 표본은 없었다. 대신 **같은 유형(${pool[0].typeLabel || type}) 합격 자소서 ${pool.length}편**을 재 본 결과다 — 문항별 특성은 못 담았으니 더 느슨하게 참고해라.`,
    `문장은 주지 않는다(남의 글이다). **구조만 참고하고, 내용은 위 지원자 사실로만 써라.**`,
    `  · 문단: ${paras}개로 끊는다`
      + (paras <= 2 ? ' — 합격 자소서는 문단을 잘게 쪼개지 않는다' : ''),
    `  · 확인 가능한 숫자: 이 분량(${total}자)이면 **${nums}개** 정도가 실제 수준이다.`
      + ` 더 박으려고 없는 수치를 지어내지 마라 — 모르면 대괄호로 비운다`,
    `  · 소제목(따옴표로 묶은 한 줄 제목): ${many(subhead) ? '단 편이 있다. 달아도 된다' : '달지 않는다'}`,
    `  · 첫 문장: ${many(firstNum) ? '숫자로 시작하는 편이 있다' : '숫자로 시작하지 않는다. 결론·기준 선언으로 연다'}`,
    `  ※ 위 **분량 배분표가 우선이다.** 이 값과 부딪히면 분량표를 따르고, 이건 참고만 한다.`,
  ];
  return lines.join('\n');
}

module.exports = {
  nearest, structureBlock, similarity, norm,
  MIN_SIM, MIN_GRAMS, MIN_POOL, MIN_HITS,
  isLoaded: () => !!corpus(),
};
