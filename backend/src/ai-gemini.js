/* ══════════════════════════════════════════════════════════════
   LLM 프로바이더 — Google Gemini (자소서 AI 초안 전용)

   ── 왜 Groq 옆에 하나 더 두나 ──────────────────────────────────
   역량 추출·스펙 분류는 "짧은 JSON" 이라 속도가 전부고, 거기선 Groq(gpt-oss-120b)가
   빠르고 일일 한도도 넉넉하다. 그대로 둔다(ai-provider.js).
   유일하게 갈아 끼우는 곳은 **자소서 AI 초안**이다 — 여기만 산문 품질이 곧 결과라,
   한국어 문장이 더 자연스러운 Gemini 2.5 Flash 를 쓴다(사용자 선택 2026-08-28).

   ── 옛 Ollama 사고를 되풀이하지 않는다 ─────────────────────────
   프로바이더가 둘이 되면 "환경변수가 안 읽혀 조용히 엉뚱한 데로 떨어지는" 실패 모드가
   되살아난다(ai-provider.js 머리주석). 그래서 라우팅은 **명시적**이다:
     · GEMINI_API_KEY 가 있으면 초안은 Gemini.
     · 없으면 초안도 Groq 로 **되돌아가되(fallback)**, 그건 안 켜진 로컬 도구가 아니라
       이미 설정된 다른 프로바이더라 오류가 아니라 정상 경로다. 응답의 provider·model
       필드에 무엇으로 썼는지 실어 화면이 구분한다.
   (이 라우팅은 ai-provider.js 의 callDraftModel 이 한다. 이 파일은 Gemini 호출만.)

   ── SDK 를 안 쓴다 ─────────────────────────────────────────────
   Node 24 는 전역 fetch 가 있고, Gemini 는 REST 한 방이면 된다. 의존성을 늘리지 않는다
   (이 저장소는 groq-sdk 말고는 LLM SDK 가 없다). 인증키는 **URL 이 아니라 헤더**로 보낸다
   — 쿼리스트링에 키를 실으면 로그·프록시에 남는다.

   env: GEMINI_API_KEY (필수) · GEMINI_MODEL · CAS_AI_TIMEOUT_MS (Groq 와 공유)
   ══════════════════════════════════════════════════════════════ */
const PROVIDER = 'gemini';

/* 모델은 env 로 뺀다 — Google 도 모델을 예고 후 폐기하고, 그때 코드를 고치지 않고
   갈아끼울 수 있어야 한다(Groq 쪽과 같은 이유). 기본값도 살아 있는 모델이어야 한다. */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/* Groq 와 같은 상한을 공유한다 — 사용자가 CAS_AI_TIMEOUT_MS 하나만 만지면 둘 다 걸린다. */
const TIMEOUT_MS = Number(process.env.CAS_AI_TIMEOUT_MS || 60000);

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const modelLabel = () => GEMINI_MODEL;
const isConfigured = () => Boolean((process.env.GEMINI_API_KEY || '').trim());

/* 오류 문구를 학생용(message)과 운영자용(detail·로그)으로 가른다 —
   이유는 ai-provider.js 의 같은 자리 주석에 적어 뒀다(사용자 지시 2026-09-04). */
const AI_OFF_MSG = 'AI 기능을 지금 쓸 수 없어요. 잠시 후 다시 시도해 주세요.';

function aiError(status, userMsg, detail) {
  if (detail) console.error(`[ai:gemini] ${detail}`);
  const e = new Error(userMsg);
  e.status = status;
  e.detail = detail || '';
  return e;
}
function cfgError(detail) { throw aiError(503, AI_OFF_MSG, detail); }

/* 호출 한 겹. 반환값은 모델이 낸 JSON 문자열 — Groq 의 callModel 과 같은 계약이라
   호출부(parseDraft)가 어느 프로바이더든 똑같이 읽는다.

   ── 사고(thinking) 예산을 못박아 지연을 잡는다 (실측 2026-08-28) ──
   Gemini 2.5+ 는 답 전에 '사고' 토큰을 먼저 쓰는데 그 몫도 maxOutputTokens 에서 나간다
   (gpt-oss 에서 본문이 빈 채 끝나던 그 사고 — ai-provider.js reasoningOpt 주석).
   초안은 추론이 필요 없어 사고를 끄려 thinkingBudget:0 을 넣었더니 gemini-3.6-flash 가
   400 INVALID_ARGUMENT 로 거절했다 — 이 세대는 사고를 **완전히는** 못 끈다.
   그런데 실측하면 **0만 거절이고 낮은 양수는 받는다.** 게다가 지연이 예산에 정비례한다:
     thinkingBudget 무제한(기본) → 25~32초 · 512 → 5초 · 128 → 14초 (마지막이 더 느린 건
     예산이 모자라 다시 사고하기 때문으로 보인다). 512 면 초안 품질은 그대로면서 빠르다.
   그래서 512 로 못박고, maxOutputTokens 는 사고 몫(THINK_BUDGET)+본문(num_predict)을
   함께 덮게 준다 — 안 그러면 사고가 예산을 먹어 본문이 빈 채 끝난다. */
const THINK_BUDGET = 512;

/* ── 스트리밍은 쓰지 않는다 — 실측 2026-09-04 ──────────────────────────────
   화면 작성률을 실제 글자 수로 그리려고 `:streamGenerateContent?alt=sse` 를 붙여 봤는데,
   `responseMimeType: application/json` + thinkingConfig 조합에서 **본문 없이 끝났다**
   (조각이 하나도 안 온 채 스트림이 닫힘 → 25초 뒤 타임아웃). Groq 쪽도 같은 이유로
   막혔다(ai-provider.js callModel 머리주석). 그래서 진행률은 시간을 재서 그린다. */
/* timeoutMs 는 호출하는 쪽이 더 짧게 줄 수 있다 — 초안은 Gemini 가 실패하면 Groq 로
   넘어가므로(ai-provider.js callDraftModel), 60초를 다 기다릴 이유가 없다. */
/* 한 번의 호출. body 를 만드는 쪽(글/이미지)이 갈리므로 **보내고 읽는 부분만** 여기 둔다.
   두 벌로 두면 오류 분기(키·쿼터·모델 폐기)가 한쪽만 고쳐진다 — 이 파일이 처음부터
   피하려던 실패 모드다. */
async function generate(body, limitMs) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    cfgError('GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급받아 '
           + 'backend/.env 의 GEMINI_API_KEY 에 넣으세요.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limitMs);

  let res, data;
  try {
    res = await fetch(`${API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    /* 네트워크·타임아웃은 사용자가 할 일(잠시 뒤 재시도)이 같아 하나로 묶는다. */
    const timedOut = e?.name === 'AbortError';
    throw aiError(timedOut ? 504 : 502,
      timedOut
        ? `AI 응답이 ${Math.round(limitMs / 1000)}초 안에 오지 않았어요. 잠시 뒤 다시 시도해 주세요.`
        : 'AI 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.',
      timedOut ? `타임아웃(${limitMs}ms)` : `연결 실패: ${String(e?.message || '').slice(0, 200)}`);
  }
  clearTimeout(timer);
  try { data = await res.json(); } catch { data = null; }

  /* 상태코드별로 사용자가 할 일이 다르므로 갈라 준다(Groq 쪽과 같은 정책). */
  if (!res.ok) {
    const detail = String(data?.error?.message || `HTTP ${res.status}`).slice(0, 200);
    let msg, out, log;
    if (res.status === 400 && /api.?key|api_key_invalid/i.test(detail)) {
      msg = AI_OFF_MSG;
      log = '인증 실패 — GEMINI_API_KEY 가 올바른지 확인하세요 (https://aistudio.google.com/apikey)';
      out = 503;
    } else if (res.status === 401 || res.status === 403) {
      msg = AI_OFF_MSG;
      log = `인증 실패(HTTP ${res.status}) — GEMINI_API_KEY 를 확인하세요`;
      out = 503;
    } else if (res.status === 429) {
      msg = '지금 요청이 몰려 있어요. 잠시 뒤 다시 시도해 주세요.';
      log = `무료 쿼터 초과(HTTP 429): ${detail}`;
      out = 429;
    } else if (res.status === 404 || /not found|not.*support|deprecated/i.test(detail)) {
      msg = AI_OFF_MSG;
      log = `모델 "${GEMINI_MODEL}" 을(를) 쓸 수 없습니다(${detail}). `
          + '.env 의 GEMINI_MODEL 을 현행 모델로 바꾸세요 (https://ai.google.dev/gemini-api/docs/models)';
      out = 503;
    } else {
      msg = 'AI 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      log = `호출 실패 (HTTP ${res.status}): ${detail}`;
      out = 502;
    }
    throw aiError(out, msg, log);
  }

  /* 안전필터에 막히면 candidates 가 비어 온다 — 빈 문자열로 넘기면 parseDraft 가
     "AI 응답을 읽지 못했습니다" 로 알린다. 사유(blockReason)를 detail 로 실어 둔다. */
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const outText = parts.map(p => p?.text || '').join('').trim();
  if (!outText) {
    const reason = data?.promptFeedback?.blockReason || cand?.finishReason || 'EMPTY';
    const err = new Error(`Gemini 가 빈 응답을 냈어요(${reason}). 다시 시도해 주세요.`);
    err.status = 502;
    throw err;
  }
  return outText;
}

async function callModel(text, system, { num_predict = 512, timeoutMs } = {}) {
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_MS;
  return generate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      temperature: 0.2,
      /* 상한은 사고 몫 + 본문을 함께 덮는다(위 주석). */
      maxOutputTokens: num_predict + THINK_BUDGET,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: THINK_BUDGET },
    },
  }, limitMs);
}

/* ── 이미지를 읽는다 (2026-09-07, 사용자 요청) ────────────────────────────
   이미지로 된 채용공고에서 글자를 옮겨 오는 데만 쓴다(posting-image.js). 26-8 에서
   "OCR 은 안 한다" 고 적었던 이유가 **Groq 에 비전 모델이 없다** 였는데, 초안용으로
   Gemini 를 붙이면서(2026-08-28) 그 전제가 사라졌다 — 키도 모델도 이미 있다.

   ── 글 호출과 다른 점 둘 ──
   · responseMimeType 을 주지 않는다. 받아 올 것은 **공고에 적힌 글 그대로**라 JSON 이
     아니다. JSON 을 요구하면 모델이 옮겨 적기를 요약으로 바꾼다.
   · temperature 0. 옮겨 적기에 창의성이 끼면 없는 글자가 생긴다 — 이 기능의 최악은
     못 읽는 것이 아니라 **그럴듯하게 지어내는 것**이다(18-7 과 같은 실패 모드).

   images = [{ mimeType, data(base64) }]. 한 번에 여러 장을 넘긴다 — 공고 한 장이
   이미지 여러 개로 잘려 있는 일이 흔해서, 따로 부르면 앞뒤 맥락이 끊긴다. */
async function callVision(images, prompt, system, { num_predict = 2048, timeoutMs } = {}) {
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_MS;
  const parts = [{ text: prompt }];
  for (const im of images) parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
  return generate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: num_predict + THINK_BUDGET,
      thinkingConfig: { thinkingBudget: THINK_BUDGET },
    },
  }, limitMs);
}

module.exports = {
  callModel, callVision, modelLabel, isConfigured,
  PROVIDER, GEMINI_MODEL, TIMEOUT_MS,
};
