/* POST /api/jd/coach
   직무기술서(채용공고) 원문 → 요구역량 목록 + 역량별 "자소서에 이렇게 적어라" 가이드

   ── 역할 분담 (jd-competency.js 머리주석과 같은 이야기) ──
     1단계 규칙 추출 : JD 문장에서 키워드로 역량을 찾는다. 대부분 여기서 끝난다.
     2단계 AI 보강   : 규칙이 3개 미만으로 잡았을 때만 부른다. AI 가 하는 일은
                      "역량 id 를 고르는 것"뿐 — 짧은 JSON 이라 CPU 8B 도 감당한다.
     3단계 가이드 조립: 문장은 전부 코드가 만든다. AI 는 문장을 쓰지 않는다.

   AI 가 죽어도 규칙 결과로 화면이 완성된다(casAnalyze.js 와 같은 정책).
   활동(activities)은 프론트가 자기 스펙에서 보내온다 — 남의 데이터가 아니라
   본인 것을 본인 화면에 되돌려주는 용도라 서버 세션까지 뒤질 이유가 없다. */
const express = require('express');
const { callModel, modelLabel, PROVIDER, callDraftModel, draftModel, draftProvider } = require('../ai-provider');
const JD = require('../jd-competency');
const TRENDS = require('../job-trends');
const GUIDE = require('../cover-guide');
const DRAFT = require('../draft-coach');
/* 문항 유형 분류 — 400 판정이 '유형이 걸리는 문항인가' 를 재료로 친다(2026-09-01). */
const QF = require('../../../frontend/js/question-frames.js');

const router = express.Router();

/* 규칙이 이만큼 잡았으면 AI 를 부르지 않는다. 공고 한 장에서 역량 4개면 충분하고,
   부르지 않는 만큼 응답이 즉시 끝난다. */
const ENOUGH = 4;
/* 화면에 한 번에 보여줄 역량 수. 8개를 넘기면 사용자가 우선순위를 못 잡는다. */
const MAX_ITEMS = 7;
/* JD 원문이 아주 길 때(공고 전문 + 회사 소개) 프롬프트 길이가 곧 대기시간이므로 자른다. */
const MAX_JD_CHARS = 6000;

/* ── 화면 전체에 걸리는 안내·기준 ────────────────────────────
   역량 목록과 달리 **입력이 무엇이든 똑같은** 값들이다. /coach 안에 인라인으로
   적혀 있던 것을 함수로 뽑았다 — 공고 없이 회사 근거만으로 시작하는 경로(/guide)가
   같은 문구를 써야 하는데, 프론트에 복사하면 한쪽만 고쳐진다.

   특히 disclaimer 는 "문장을 대신 써 주지 않는다" 를 말하는 문구다. 경로마다
   다르게 적히면 그게 바로 오해의 출발점이 된다. */
function guidePayload({ company, competencies = [] } = {}) {
  return {
    disclaimer: '완성된 자소서 문장을 대신 써 드리지는 않습니다. 무엇을 어떤 순서로 쓸지에 대한 작성 지침이며, '
      + '첫 문장은 빈칸이 있는 틀로만 드립니다 — [대괄호]는 본인 사실로 채우셔야 합니다 '
      + '(대필 문장은 유사도·AI 검출에 걸립니다).',
    /* ── 문항 전체에 걸리는 작성 기준 ──
       역량 카드마다 반복하지 않고 응답에 한 번만 싣는다. STAR 를 카드마다 붙이면
       역량별 frame 과 골격이 두 개로 보여 어느 쪽을 따를지 알 수 없게 된다. */
    star: GUIDE.STAR,
    /* 칸을 실제로 어떻게 채우는가(질문·나쁜 예·고친 예). STAR 입력 도우미가 쓰고,
       AI 초안 프롬프트도 같은 표를 읽는다 — 둘이 갈리면 화면이 시킨 것과 AI 가 쓴 것이
       달라진다(cover-guide.js STAR_WRITE 머리주석). */
    starWrite: GUIDE.STAR_WRITE,
    checklist: GUIDE.SUBMIT_CHECKLIST,
    /* 검사 목록을 값으로 내려보낸다 — 화면이 초안을 서버로 보내지 않고 그 자리에서
       검사할 수 있게 하려는 것이다. 자소서 초안은 남의 서버에 안 보내는 편이 낫다. */
    cliches: GUIDE.CLICHES,
    aiTells: GUIDE.AI_TELLS,
    /* 회사명은 프론트가 입력칸에서 보내온다. 없으면 '지원 회사'로 나간다. */
    interview: GUIDE.interviewQuestions({
      company,
      hasNews: false,                    // 뉴스는 /api/company/analysis 쪽 책임이다
      competencies,
    }).filter(q => q.from === 'competency'),
  };
}

/* GET /api/jd/guide?company=
   공고 없이 **회사 근거만으로** 4단계를 시작할 때 쓴다.

   ── 왜 이 경로가 필요한가 ──
   공고를 못 구하는 것이 예외가 아니라 보통이다 — 대기업 공채는 자사 채용 사이트로만
   올라와서 워크넷·잡알리오 어느 쪽에도 안 잡힌다. 그런데 /coach 는 공고 30자를
   필수로 걸고 있어서, 3단계에서 회사를 골라 와도 대부분 여기서 막혔다.

   ── 역량은 주지 않는다 ──
   역량은 공고에서 나온다. 공고가 없는데 "이 직무는 보통 이런 역량을 요구합니다" 를
   지어서 주면 근거 없는 목록이 된다(직무 트렌드 집계는 워크넷 목록 API 가 막혀 있어
   캐시가 비어 있다 — job-trends.js 머리주석). 여기서는 **작성 기준과 검사 사전만**
   주고, 역량 칸은 "공고를 넣으면 나온다" 고 화면이 그대로 말한다. */
/* GET /api/jd/prompt-template
   '내 프롬프트' 를 만들 때 출발점으로 주는 **기본 규칙 전문**(사용자 지시 2026-09-05).
   빈 칸에서 시작하면 무엇을 적어야 할지도, 무엇을 지우는지도 알 수 없다.
   Context(회사·문항·내 STAR)와 Output(JSON 계약)은 코드가 늘 붙이므로 여기 없다 —
   편집할 수 있는 것은 규칙뿐이다(draft-coach.js buildPrompt 머리주석). */
router.get('/prompt-template', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query?.limit) || 1000, 200), 3000);
  const type = String(req.query?.type || 'competency');
  res.json({ rules: DRAFT.defaultRules({ limit, questionType: type }), limit, type });
});

router.get('/guide', (req, res) => {
  res.json({
    mode: 'company',
    provider: 'guide',
    items: [],
    jdSentences: 0,
    market: null,
    ...guidePayload({ company: req.query.company }),
  });
});

const SYSTEM = `한국 채용공고에서 요구 역량을 골라 JSON 만 출력한다.
아래 목록의 id 중에서만 고른다. 목록에 없는 요건은 custom 으로 넘긴다.
${JD.ARCHETYPES.map(a => `${a.id}: ${a.label}`).join('\n')}

규칙:
- 공고에 근거 문장이 있는 역량만 고른다. 일반적으로 좋은 역량이라고 넣지 말 것.
- 각 역량마다 근거가 된 공고 원문 문장을 quote 에 그대로 옮긴다(요약·수정 금지).
- 최대 6개. 중요한 순서대로.
- 점수·자소서 문장·조언을 쓰지 말 것. 역량 선택만 한다.

출력: {"competencies":[{"id":<위 id 중 하나 또는 "custom">,"label":<custom 일 때만 역량 이름>,"quote":<공고 원문 문장>}]}`;

/* AI 응답을 규칙 결과와 같은 모양으로 맞춘다. 모르는 id 는 버린다
   (그럴듯한 이름을 지어내 가이드를 붙이면 사용자가 검증할 수 없다). */
function coerceAi(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const id = String(c?.id || '').trim();
    const quote = String(c?.quote || '').trim();
    if (id === 'custom') {
      const label = String(c?.label || '').trim();
      if (label) out.push({ id: 'custom', label, quotes: quote ? [quote] : [], source: 'ai' });
      continue;
    }
    if (JD.BY_ID[id]) out.push({ id, quotes: quote ? [quote] : [], matched: [], source: 'ai' });
  }
  return out;
}

router.post('/coach', async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, MAX_JD_CHARS);
  const activities = Array.isArray(req.body?.activities) ? req.body.activities : [];
  const hasSpec = activities.length > 0;
  /* 사용자가 AI 를 끄고 규칙만 쓸 수 있게 한다 — 로컬 8B 는 느리고, 규칙만으로도
     대부분의 공고는 충분히 읽힌다. */
  const useAi = req.body?.useAi !== false;

  if (text.length < 30) {
    return res.status(400).json({ error: '직무기술서(채용공고) 내용을 30자 이상 붙여넣어 주세요.' });
  }

  /* ── 자소서와 상관없는 구간은 규칙에도 AI 에도 넣지 않는다 (사용자 지시 2026-09-15) ──
     복리후생·결격사유·전형절차·근무조건이 섞여 들어와 역량 근거로 인용되고 키워드까지
     만들었다(실측: 근무조건의 '유관부서와 소통이 잦은 자리' 가 협업 역량으로 잡혔다).
     규칙 쪽은 ruleExtract 가 스스로 거르지만, **AI 에는 우리가 넣어 주는 글이 전부**라
     여기서 같이 걸러야 한다 — 한쪽만 거르면 규칙과 AI 가 서로 다른 글을 본다.
     구간을 못 가른 공고(머리말 없는 줄글)는 usefulText 가 원문을 그대로 돌려준다. */
  const useful = JD.usefulText(text);

  const rule = JD.ruleExtract(text);
  let entries = rule.found.map(f => ({ ...f, source: 'rule' }));
  let aiError = null;
  let usedAi = false;

  if (useAi && entries.length < ENOUGH) {
    try {
      const raw = await callModel(useful, SYSTEM, { num_ctx: 8192, num_predict: 700 });
      const aiEntries = coerceAi(JSON.parse(raw).competencies)
        .filter(a => !entries.some(e => e.id === a.id));      // 규칙이 이미 잡은 건 그대로 둔다
      entries = entries.concat(aiEntries);
      usedAi = true;
    } catch (e) {
      /* AI 가 없어도 규칙 결과로 화면은 완성된다. 규칙도 못 잡았을 때만 진짜 실패다. */
      aiError = e.message;
      if (!entries.length) {
        const status = e?.status || 502;
        return res.status(status).json({
          error: (status === 503 || status === 429) ? e.message : 'AI 분석에 실패했습니다.',
          detail: e.message,
        });
      }
      console.warn('JD coach — AI 보강 실패, 규칙 결과만 반환:', e?.message);
    }
  }

  if (!entries.length) {
    return res.status(422).json({
      error: '이 글에서 요구 역량을 찾지 못했어요. 채용공고의 "자격요건 · 우대사항 · 주요업무" 부분을 포함해 붙여넣어 주세요.',
    });
  }

  const items = JD.spreadMaterials(
    entries
      .slice(0, MAX_ITEMS)
      .map(e => (e.id === 'custom' ? JD.buildCustom(e) : JD.buildGuide(e, activities, hasSpec)))
      .filter(Boolean)
  );

  /* 시장 빈도 붙이기 — "이 직무 공고 N건 중 M% 가 요구".
     채용공고 캐시가 없으면(인증키 승인 전) 전부 null 이라 카드에서 조용히 빠진다.
     careerly 만 할 수 있는 말이 여기서 나온다: 흔한 요구인지 희소한 요구인지에 따라
     자소서 전략이 갈린다. */
  const bucket = TRENDS.pickBucket(text, req.body?.jobKeyword);
  for (const item of items) {
    item.market = item.custom ? null : TRENDS.marketFor(bucket, item.id);
    /* 첫 문장 틀 — 배정된 활동이 있을 때만 만든다. spreadMaterials 가 소재를
       나눠 배정한 **뒤**라야 카드마다 다른 활동으로 문장이 나온다. */
    item.openings = GUIDE.openingDrafts(item.mine, { reuse: item.reuse });
  }

  res.json({
    provider: usedAi ? PROVIDER : 'rule',
    model: usedAi ? modelLabel() : null,
    mode: 'posting',
    jdSentences: rule.sentenceCount,
    /* 트렌드 출처·기준을 함께 내려보낸다. 비율만 던지면 그게 어디서 나온 숫자인지
       화면에서 설명할 수 없다(제목 기준이라는 한계도 여기서 전달된다). */
    market: bucket ? { bucket, ...TRENDS.meta() } : null,
    items,
    ...guidePayload({ company: req.body?.company, competencies: items }),
    notice: aiError ? 'AI 보강은 실패해서, 공고에서 직접 찾아낸 역량만 정리했어요.' : undefined,
  });
});

/* ── POST /api/jd/draft ─────────────────────────────────────
   역량 하나에 대한 자소서 문단 초안. 역량 추출(/coach)과 분리한 이유는 셋이다:
     · 사용자가 역량 6개를 다 쓰지 않는다. 누른 역량만 만들면 되는데 한 번에 다
       만들면 안 쓸 문단까지 기다리게 된다.
     · 초안은 활동·문항이 바뀌면 다시 만들어야 한다. 그때마다 공고 분석을
       처음부터 돌릴 이유가 없다.
     · 실패해도 역량 카드는 살아 있어야 한다. 같은 응답에 묶으면 같이 죽는다.

   초안은 서버에 저장하지 않는다. 만들어서 돌려주고 끝이며, 보관은 브라우저가 한다
   (초안 검사와 같은 원칙 — 남의 서버에 둘 이유가 없는 글이다). */
/* STAR 입력을 S/T/A/R 네 키만 남기고 다듬는다. 화면이 보내는 값을 그대로 믿지 않는
   것은 다른 라우트와 같은 규약이고, 칸당 900자로 자르는 것은 한 칸에 소설을 붙여
   보냈을 때 프롬프트 뒤쪽 규칙(10~14번)이 잘려 나가는 것을 막기 위해서다. */
function starOf(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of ['S', 'T', 'A', 'R']) {
    const s = String(v[k] || '').trim().slice(0, 900);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/* 초안 만들기. 라우트에서 떼어 둔 이유는 오류를 상태코드와 함께 **던져서** 한 곳에서
   받기 위해서다 — 예전에는 성공·400·502 가 함수 안 세 곳에서 각각 res 를 건드렸다. */
async function buildDraft(body) {
  const req = { body };
  /* ── 역량은 0~2개다 (사용자 지시 2026-09-01) ─────────────────────────────
     지원동기·성격 장단점처럼 역량 축이 필요 없는 문항이 있어서 0개를 연다.
     competency(단수)는 옛 호출 호환용으로 남긴다. */
  const competencies = (Array.isArray(req.body?.competencies) ? req.body.competencies : null)
    ?? (req.body?.competency ? [req.body.competency] : []);
  const comps = competencies.map(c => String(c || '').trim()).filter(Boolean).slice(0, 2);

  /* 문항 상한은 사용자가 정한다(프론트 limitOf). byte 로 적힌 공고는 한글 2byte 기준으로
     환산돼 오므로 3,000자까지 받는다 — 6,000byte 짜리 문항까지 덮는다.
     기본값 1,000 은 프론트와 같아야 한다. 갈리면 화면이 말한 분량과 초안이 어긋난다. */
  const limit = Math.min(Math.max(Number(req.body?.limit) || 1000, 200), 3000);
  /* ── 문항마다 고른 정성스펙(0~3개) (사용자 지시 2026-08-31) ────────────
     고른 게 있으면 그 STAR 가 본문 재료다. 0개면 STAR 를 강요하지 않고 문항 골격만 쓴다.
     2~3개면 draft-coach 가 공통점으로 묶는다. star(단일)는 옛 호환용으로 남겨 둔다.
     칸당 길이를 자르는 것은 프롬프트가 길어져 뒤쪽 규칙이 잘리는 것을 막기 위해서다. */
  const picks = (Array.isArray(req.body?.picks) ? req.body.picks : [])
    .slice(0, 3)
    .map(p => ({ name: String(p?.name || '').trim().slice(0, 120), star: starOf(p?.star) }))
    .filter(p => p.star);
  const star = starOf(req.body?.star);
  /* 예시 베낌 검사는 '사용자가 직접 쓴 것' 을 통과시킨다 — 고른 경험들의 STAR 를 칸별로
     합쳐 그 판정 재료로 쓴다(각 경험 문장이 다 사용자 것이다). */
  const ownStar = {};
  for (const p of (picks.length ? picks : (star ? [{ star }] : []))) {
    for (const k of ['S', 'T', 'A', 'R']) {
      if (p.star && p.star[k]) ownStar[k] = (ownStar[k] ? ownStar[k] + ' ' : '') + p.star[k];
    }
  }
  const quotes = Array.isArray(req.body?.quotes) ? req.body.quotes.slice(0, 4).map(String).filter(Boolean) : [];
  /* ── 문항에 붙여 온 자료 (사용자 지시 2026-09-14) ────────────────────────────
     '최근 이슈'·'존경하는 인물' 문항의 재료다. 화면이 검색해서 고른 것이 그대로 온다.
     **제목·요약·날짜만 받는다** — url 은 프롬프트에서 쓸모가 없고(모델이 열어 볼 수
     없다) 길이만 먹는다. 칸마다 자르는 것은 자료 넷이 붙었을 때 프롬프트가 통째로
     길어져 뒤쪽 규칙이 밀리는 것을 막기 위해서다(customRules 와 같은 이유). */
  const refs = (Array.isArray(req.body?.refs) ? req.body.refs : []).slice(0, 4).map(r => ({
    title: String(r?.title || '').trim().slice(0, 200),
    summary: String(r?.summary || '').trim().slice(0, 400),
    date: String(r?.date || '').trim().slice(0, 30),
    kind: String(r?.kind || '').trim().slice(0, 10),
  })).filter(r => r.title);
  const question = String(req.body?.question || '').trim();

  /* ── 400 이 막는 것은 '역량의 부재' 가 아니라 '재료의 부재' 다 (심사 지적 2026-09-01) ──
     예전에는 역량이 없으면 400 이었다. 역량 0개를 여는 김에 그 조건을 없애면 **재료가
     하나도 없는 호출**이 열린다 — 회사명·직무명·문항 문구만 남은 프롬프트다. 그러면
     모델이 분량 하한을 지키려고 사전지식에서 회사 이야기를 지어낸다(실측: 삼성전자에
     없는 '타깃 커스터마이징 전략'). /motive 가 근거 없이는 시작하지 않는 것과 같은 이유다.
     그래서 조건을 **'사실 출처가 하나라도 있는가'** 로 바꾼다:
       역량 · 공고 문장 · 고른 정성스펙 · 분류되는 문항 유형 중 하나는 있어야 한다.
     문항 유형을 재료로 치는 것은, 유형이 걸리면 question-prompts.js 의 골격과 덩이별
     조건이 프롬프트에 들어와 '무엇을 쓸지' 가 정해지기 때문이다. */
  const typed = Boolean(QF.classify(question));
  /* 붙여 온 자료도 **사실 출처**다(사용자 지시 2026-09-14). '최근 이슈' 문항에서
     역량·경험 없이 기사만 붙이는 것이 정상 사용이라, 자료가 있으면 400 이 아니다. */
  if (!comps.length && !quotes.length && !picks.length && !star && !typed && !refs.length) {
    throw Object.assign(
      new Error('무엇으로 쓸지 알려 주세요 — 역량을 고르거나, 자소서 문항을 넣어 주세요.'),
      { status: 400 });
  }

  /* ── 사용자가 만든 규칙 (사용자 지시 2026-09-05) ────────────────────────────
     '내 프롬프트' 를 켜 두면 기본 규칙 대신 이것이 들어간다. 안전장치를 지우는 것도
     사용자 책임이다(그렇게 정했다) — 다만 **분량 상한은 아래에서 코드가 다시 지킨다.**
     길이를 자른다: 프롬프트가 길어지면 뒤쪽 규칙이 모델 창에서 밀려 나가, 사용자가
     적은 것과 실제 적용된 것이 달라진다. 그건 조용히 틀리는 쪽이다. */
  const customRules = String(req.body?.customRules || '').trim().slice(0, 8000);

  const prompt = DRAFT.buildPrompt({
    customRules,
    refs,
    company: String(req.body?.company || '').trim(),
    jobTitle: String(req.body?.jobTitle || '').trim(),
    competencies: comps,
    quotes,
    reads: String(req.body?.reads || '').trim(),
    frame: String(req.body?.frame || '').trim(),
    activities: Array.isArray(req.body?.activities) ? req.body.activities.slice(0, 5) : [],
    question,
    picks,
    star,
    limit,
  });

  {
    /* num_predict 를 넉넉히 준다 — 문단 + 빈칸 안내 + 검토까지 한 응답에 담기므로
       기본값(512)이면 JSON 이 중간에 잘려서 파싱이 통째로 실패한다. */
    /* Gemini 가 죽으면 Groq 로 넘어간다(ai-provider callDraftModel). 무엇으로 썼는지를
       여기 담아 응답에 싣는다 — draftProvider() 는 '무엇으로 보내려 했나' 라서 폴백하면
       거짓말이 된다. 재시도마다 덮어써서 **마지막으로 쓴 것**이 남는다. */
    const used = {};
    const ask = async () => DRAFT.parseDraft(
      await callDraftModel(prompt, DRAFT.SYSTEM, { num_ctx: 8192, num_predict: 1100 }, used));

    let out = await ask();
    /* 한국어가 아닌 글자가 섞이면 한 번만 다시 부른다. 실측으로 8회 중 1회꼴이라
       (일본어·중국어·베트남어) 한 번 더 부르면 사실상 사라진다. Groq 는 1초대라
       재시도 비용이 사용자가 느낄 정도가 아니다. 두 번째도 섞이면 그대로 내보내되,
       화면의 검사기가 잡을 수 있게 flag 를 함께 준다. */
    if (DRAFT.hasForeign(out)) {
      const retry = await ask().catch(() => null);
      if (retry && !DRAFT.hasForeign(retry)) out = retry;
      else if (retry) out = { ...retry, foreignWarning: true };
      else out = { ...out, foreignWarning: true };
    }

    /* ── 예시를 베껴 왔으면 내보내지 않는다 ────────────────────────
       실측으로 한 번 겪었다: STAR 안내에 있던 예시 문장('화면 정의서'·'검색 결과
       정렬')이 초안에 통째로 들어왔다. 사용자가 겪지도 않은 일이 자소서에 사실처럼
       적히는 것이라, 외국어가 섞이는 것보다 훨씬 나쁘다 — 면접에서 바로 무너진다.
       한 번 다시 부르고, 그래도 베끼면 **초안을 주지 않는다.** 지어낸 문장을 주는
       것보다 "실패했다"고 말하는 편이 낫다(parseDraft 와 같은 원칙). */
    let copied = DRAFT.copiedFromExample(out.draft, ownStar);
    if (copied) {
      const retry = await ask().catch(() => null);
      if (retry && !DRAFT.copiedFromExample(retry.draft, ownStar)) { out = retry; copied = null; }
      else copied = DRAFT.copiedFromExample((retry || out).draft, ownStar);
    }
    if (copied) {
      throw Object.assign(
        new Error('AI 가 안내 예시를 그대로 베껴 와서 초안을 버렸어요. 다시 눌러 주세요.'),
        { status: 502, detail: `예시(${copied.key})와 겹침: ${copied.chunk}` });
    }

    /* ── 분량 상한은 절대 넘기지 않는다 (사용자 지시 2026-09-05) ────────────────
       모자란 것은 사용자가 채우면 되지만 **넘친 것은 제출이 막힌다** — 자소서 입력칸이
       글자 수로 자르기 때문에 뒤가 통째로 날아간다. 그래서 상한만 단단히 지킨다.

       ① 넘으면 얼마나 넘었는지 알려 주고 한 번 다시 부른다(모델이 스스로 줄이는 편이
          문단이 온전하다). ② 그래도 넘으면 문장 단위로 잘라낸다 — 자르기는 마지막 수단이다.
       하한은 걸지 않는다: 짧게 온 것을 다시 부르면 모델이 분량을 채우려고 지어낸다. */
    if (DRAFT.lenOf(out.draft) > limit) {
      const over = DRAFT.lenOf(out.draft) - limit;
      /* parseDraft 는 **Promise 가 아니다** — 값을 그대로 돌려준다. 예전에 여기에
         `.catch()` 를 붙였다가 초과가 났을 때만 TypeError 로 죽었다(실측 2026-09-05).
         초과는 늘 나는 일이 아니라 이 경로는 조용히 숨어 있었다. try 로 감싼다. */
      let shorter = null;
      try {
        shorter = DRAFT.parseDraft(await callDraftModel(
          `${prompt}\n\n# 다시\n방금 쓴 초안이 ${limit}자를 ${over}자 넘겼다.`
          + ` **${limit}자 안에 들어오게** 다시 써라 — 덩이를 지우지 말고 각 덩이를 고르게 줄인다.`
          + ` 모자라게 끝나는 것은 괜찮지만 넘기는 것은 안 된다.`,
          DRAFT.SYSTEM, { num_ctx: 8192, num_predict: 1100 }, used));
      } catch { shorter = null; }
      /* 다시 부른 것이 상한 안이면 그것을, 아니면 **둘 중 짧은 쪽**을 쓴다.
         어느 쪽이든 아래 fitToLimit 이 마지막으로 상한을 보장한다. */
      if (shorter && DRAFT.lenOf(shorter.draft) < DRAFT.lenOf(out.draft)) out = shorter;
    }
    /* ── 너무 짧게 오면 한 번만 더 부른다 (사용자 지시 2026-09-14) ──────────────
       위 상한과 짝이다. 상한은 제출이 막히는 사고라 단단히 막고, 하한은 **한 번만**
       권한다 — 짧게 온 것을 계속 다시 부르면 모델이 분량을 채우려고 지어낸다.

       다시 부를 때 "더 써라" 만 시키면 그 지어내기가 바로 나온다. 그래서 재료를
       못 박는다: **이미 준 사실만 더 풀고, 새 사건·새 수치는 만들지 말고, 모르면
       대괄호로 비운다.** 초안의 빈칸은 이 기능의 정상 출력이다(draft-coach 규칙).

       받아들이는 조건이 세 가지다 — 더 길고, 상한을 안 넘고, 예시를 안 베꼈다.
       하나라도 틀리면 **처음 것을 그대로 쓴다.** 다시 부른 쪽이 더 나쁠 수 있는데
       길다는 이유로 바꾸면, 고치려던 것보다 큰 것을 잃는다. */
    const floor = Math.round(limit * DRAFT.MIN_FILL);
    if (DRAFT.lenOf(out.draft) < floor) {
      const short = floor - DRAFT.lenOf(out.draft);
      let longer = null;
      try {
        longer = DRAFT.parseDraft(await callDraftModel(
          `${prompt}

# 다시
방금 쓴 초안이 ${limit}자 칸에 ${DRAFT.lenOf(out.draft)}자뿐이다.`
          + ` 최소 ${short}자를 더 채워 ${limit}자에 가깝게 다시 써라.`
          + ` **새 사건·새 수치를 만들지 마라** — 위에 준 지원자 사실을 더 자세히 풀고,`
          + ` 판단의 근거와 과정을 덧붙여 늘린다. 모르는 값은 지어내지 말고 대괄호로 비운다.`
          + ` ${limit}자를 넘기지는 마라.`,
          DRAFT.SYSTEM, { num_ctx: 8192, num_predict: 1100 }, used));
      } catch { longer = null; }
      if (longer && DRAFT.fillsBetter(out.draft, longer.draft, limit, ownStar)) out = longer;
    }

    const fit = DRAFT.fitToLimit(out.draft, limit);
    if (fit.trimmed) {
      /* 자른 뒤에는 빈칸 수가 달라진다 — 화면이 세는 숫자와 어긋나지 않게 다시 만든다. */
      out = { ...DRAFT.parseDraft(JSON.stringify({ ...out, draft: fit.draft })), trimmed: true };
    }

    return { ...out, model: used.model || draftModel(), provider: used.provider || draftProvider() };
  }
}

/* 오류를 화면에 내보낼 모양으로 바꾼다 — buildDraft 가 던진 것을 여기서 한 번에 받는다. */
function draftErrorBody(e) {
  const status = e?.status || 502;
  return {
    status,
    error: (status === 400 || status === 429 || status === 502 || status === 503 || status === 504)
      ? e.message
      : 'AI 초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
    detail: e?.detail || e?.message || '',
  };
}

router.post('/draft', async (req, res) => {
  try {
    res.json(await buildDraft(req.body));
  } catch (e) {
    const body = draftErrorBody(e);
    res.status(body.status).json({ error: body.error, detail: body.detail });
  }
});


/* POST /api/jd/motive
   지원동기 문단 초안 — 3단계에서 담아 온 회사 근거로 쓴다.

   ── /draft 와 왜 나눴는가 ──
   /draft 는 **역량 하나를 내 경험으로 증명하는** 문단이다(STAR). 지원동기는 축이
   다르다 — 증명 대상이 내 경험이 아니라 "왜 이 회사인가" 이고, 재료가 활동이 아니라
   회사 근거다. 한 라우트에 얹으면 프롬프트 분기가 함수 안에서 갈라져서, 어느 쪽
   규칙이 적용됐는지 응답만 봐서는 알 수 없게 된다.

   ── 근거가 없으면 부르지 않는다 ──
   근거 없이 부르면 모델이 회사 이야기를 통째로 지어낸다. 그건 "대괄호로 비운다"
   규칙으로도 못 막는데, 지어낼 재료가 프롬프트 밖(모델의 사전지식)에 있기 때문이다.
   빈손이면 400 으로 돌려보내고 화면이 "먼저 담아 오라"고 말한다. */
router.post('/motive', async (req, res) => {
  const company = String(req.body?.company || '').trim();
  const evidence = (Array.isArray(req.body?.evidence) ? req.body.evidence : [])
    .slice(0, 8)
    .map(e => ({
      kind: String(e?.kind || '').trim(),
      /* 사업보고서 문단은 통째로 수천 자다 — 프롬프트가 그만큼 길어지면 뒤쪽
         Restriction 이 밀려서 지어내기 금지 규칙이 잘린다. 앞부분만 보낸다. */
      text: String(e?.text || '').trim().slice(0, 700),
      source: String(e?.source || '').trim().slice(0, 120),
    }))
    .filter(e => e.text);

  if (!company) return res.status(400).json({ error: '어느 회사에 쓰는 자소서인지 알려 주세요.' });
  if (!evidence.length) {
    return res.status(400).json({
      error: '담아 온 회사 근거가 없어요. 회사 리포트에서 개요·재무·최근 이슈를 담아 오세요.',
    });
  }

  /* 문항 상한은 사용자가 정한다(프론트 limitOf). byte 로 적힌 공고는 한글 2byte 기준으로
     환산돼 오므로 3,000자까지 받는다 — 6,000byte 짜리 문항까지 덮는다.
     기본값 1,000 은 프론트와 같아야 한다. 갈리면 화면이 말한 분량과 초안이 어긋난다. */
  const limit = Math.min(Math.max(Number(req.body?.limit) || 1000, 200), 3000);
  /* 지원동기도 '고른 정성스펙(0~3개)' 을 재료로 받는다(사용자 지적 2026-09-01).
     안 고르면(0개) 회사 근거만으로 쓰고 지원자 경험은 지어내지 않는다. /draft 와 같은 규약. */
  const picks = (Array.isArray(req.body?.picks) ? req.body.picks : [])
    .slice(0, 3)
    .map(p => ({ name: String(p?.name || '').trim().slice(0, 120), star: starOf(p?.star) }))
    .filter(p => p.star);
  const prompt = DRAFT.buildMotivePrompt({
    company,
    jobTitle: String(req.body?.jobTitle || '').trim(),
    question: String(req.body?.question || '').trim(),
    evidence,
    picks,
    limit,
  });

  /* 폴백으로 프로바이더가 바뀔 수 있다 — 실제로 쓴 것을 담아 응답에 싣는다. */
  const used = {};
  try {
    const ask = async () => DRAFT.parseDraft(
      await callDraftModel(prompt, DRAFT.SYSTEM, { num_ctx: 8192, num_predict: 1100 }, used));

    let out = await ask();
    /* 외국어 혼입은 /draft 와 같은 규칙으로 막는다 — 같은 모델·같은 출력 형식이라
       여기만 안 걸면 지원동기 문단으로 새어 나온다. */
    if (DRAFT.hasForeign(out)) {
      const retry = await ask().catch(() => null);
      if (retry && !DRAFT.hasForeign(retry)) out = retry;
      else out = { ...(retry || out), foreignWarning: true };
    }

    /* 담아 온 근거를 그대로 돌려준다 — 화면이 "이 초안은 이 근거로 썼다" 를
       초안 옆에 적을 수 있어야 한다. 출처 없이 나온 문단은 검증할 방법이 없다. */
    res.json({ ...out, usedEvidence: evidence, model: used.model || draftModel(), provider: used.provider || draftProvider() });
  } catch (e) {
    const status = e?.status || 502;
    res.status(status).json({
      error: (status === 503 || status === 429)
        ? e.message
        : '지원동기 초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
      detail: e.message,
    });
  }
});

/* ── 고용24 직무별 자소서 작성가이드 (2026-09-05, 사용자 지시) ──
   3번 칸(직무기술서)을 사용자가 어디선가 구해 오지 않아도 되게 하는 경로다.
   무엇을 가져오고 무엇을 안 가져오는지는 work24-guide.js 머리주석에 있다.

   ── 왜 로그인을 안 걸었나 ──
   /api/jd/posting 은 **사용자가 준 주소**를 여는 기능이라 로그인을 건다(익명 프록시가
   된다). 여기는 주소를 우리가 만든다 — 호스트·경로가 코드에 박혀 있고 사용자가 주는
   것은 검색어와 숫자뿐이라 남의 서버를 부르게 만들 수 없다. 대신 횟수는 막는다.

   ── 응답을 캐시하지 않는다 ──
   공채는 시즌마다 바뀌고, 한 사람이 같은 가이드를 두 번 열 일이 드물다. 쌓아 두면
   '고용24 사본' 이 되는데 그건 25-2 에서 안 하기로 한 것이다. */
const W24 = require('../work24-guide');
/* 문항에 붙일 자료 검색(/refs)이 쓴다. 회사 리포트의 뉴스와 **같은 모듈**이라
   검색 통로가 한 곳이다 — 키·엔드포인트 판정이 두 곳으로 갈리지 않는다. */
const NEWS = require('../news');

const w24Hits = new Map();                     // ip → { count, resetAt }
const W24_WINDOW_MS = 5 * 60 * 1000;
const W24_MAX_PER_WINDOW = 40;                 // 검색은 타자 치듯 여러 번 누른다

function w24RateLimited(key) {
  const now = Date.now();
  const hit = w24Hits.get(key);
  if (!hit || now > hit.resetAt) {
    w24Hits.set(key, { count: 1, resetAt: now + W24_WINDOW_MS });
    if (w24Hits.size > 1000) {
      for (const [k, v] of w24Hits) if (now > v.resetAt) w24Hits.delete(k);
    }
    return false;
  }
  hit.count += 1;
  return hit.count > W24_MAX_PER_WINDOW;
}

const w24Limit = (req, res, next) => (w24RateLimited(req.ip)
  ? res.status(429).json({ error: '검색이 너무 잦아요. 잠시 후 다시 시도해 주세요.' })
  : next());

/* ── GET /api/jd/refs — 문항에 붙일 자료를 찾는다 (사용자 지시 2026-09-14) ────────
   ── 왜 필요한가 ──
   '최근 이슈', '존경하는 인물' 같은 문항은 **내 정성스펙보다 바깥 사실이 재료**다.
   역량·경험만 붙일 수 있으면 그 문항에서는 붙일 것이 없고, 모델은 재료 없이 쓰다가
   사전지식에서 지어낸다(이 저장소가 계속 막아 온 실패). 그래서 사용자가 기사·인물
   자료를 **직접 찾아 붙이는** 통로를 둔다.

   kind=news 는 뉴스 검색(네이버), kind=ref 는 웹 검색이다. 인물·개념은 기사로 안
   잡혀서(실측: '이순신' → 뉴스 0건, 웹 3건) 두 통로가 따로 있어야 한다.

   검색어는 **그대로 넘긴다.** 회사 리포트의 뉴스는 회사명으로 걸러내지만(relevant),
   여기서 무엇이 이 문항에 맞는지는 사용자가 안다 — 우리가 고르지 않는다.

   w24Limit 을 같이 쓴다. 같은 성격(외부 검색을 대신 부르는 통로)이고, 창·상한을
   따로 두면 둘 중 어느 쪽에 걸린 것인지 화면이 말할 수 없다. */
router.get('/refs', w24Limit, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const kind = String(req.query.kind || 'news').toLowerCase() === 'ref' ? 'ref' : 'news';
  if (!q) return res.status(400).json({ error: '무엇을 찾을지 적어 주세요.' });
  if (q.length > 100) return res.status(400).json({ error: '검색어가 너무 길어요.' });
  try {
    const items = kind === 'ref' ? await NEWS.searchRef(q) : await NEWS.searchNews(q);
    res.json({ kind, query: q, items });
  } catch (e) {
    /* 외부 검색이 막히면 그 사실을 그대로 말한다 — 빈 목록을 주면 '결과 없음' 으로
       읽혀서 사용자가 검색어를 계속 바꿔 본다. */
    res.status(e.status || 502).json({ error: e.message || '검색에 실패했어요.' });
  }
});

router.get('/work24/guides', w24Limit, async (req, res) => {
  const q = String(req.query.q || '').trim();
  /* 검색어 없이도 목록은 나온다(최근 공채 순). 다만 화면은 검색어를 받고 부른다 —
     1,853건을 한 장씩 넘겨 보게 하는 건 이 칸이 할 일이 아니다. */
  try {
    const r = await W24.search({ q, year: req.query.year, page: req.query.page, size: 30 });
    res.json({ ...r, query: q });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/work24/guide', w24Limit, async (req, res) => {
  try {
    const g = await W24.guide({ epa: req.query.epa, rcit: req.query.rcit, guid: req.query.guid });
    res.json(g);
  } catch (e) {
    /* 번호가 틀린 것(400)과 고용24가 안 되는 것(502)은 사용자가 할 일이 다르다. */
    res.status(/번호/.test(e.message) ? 400 : 502).json({ error: e.message });
  }
});

module.exports = router;
