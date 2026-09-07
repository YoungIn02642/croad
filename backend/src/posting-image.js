/* ════════════════════════════════════════════════════════════
   이미지로 된 채용공고 → 글자  (Gemini 비전)

   ── 왜 이제 하나 (26-8 을 뒤집는다) ──
   26-8 에 "이미지 공고(OCR)는 아직 안 한다" 고 적어 뒀다. 이유는 셋이었는데 그중
   결정적인 것이 **"Groq 에 비전 모델이 없다"** 였다. 2026-08-28 에 자소서 초안용으로
   Gemini 를 붙이면서 그 전제가 사라졌다 — 키도 모델도 이미 돌고 있고, 비전은 같은
   엔드포인트다. 새 계정도, 새 비용 항목도, 새 의존성도 없다.
   (나머지 두 이유 — 프론트 OCR 라이브러리 · 별도 OCR API — 는 지금도 안 한다.)

   ── 무엇을 하고 무엇을 안 하나 ──
   사용자가 준 공고 주소에서 **글이 안 나올 때만** 이미지를 본다. 글이 멀쩡한 공고는
   이미지를 건드리지 않는다 — 돈과 시간을 쓰면서 이미 있는 것을 다시 읽을 이유가 없다.
   이미지를 저장하지 않는다. 받아서 모델에 넘기고 버린다(26-1 과 같은 원칙).

   ── 읽은 글을 바로 분석에 넘기지 않는다 (26-8 에서 미리 정해 둔 규칙) ──
   OCR 은 본문 추출보다 더 깨진다. 그래서 라우트는 읽은 글을 **입력칸에 채우고 멈춘다.**
   화면이 "이미지에서 읽었으니 확인하라" 고 다른 색으로 말한다.

   ── 지어내기가 최악이다 ──
   이 기능의 실패는 '못 읽음' 이 아니라 **'그럴듯하게 지어냄'** 이다(18-7 과 같은 모드).
   그래서 temperature 0, "보이는 글자만", "공고가 아니면 없음" 을 못박는다.

   env: GEMINI_API_KEY (없으면 이 기능은 통째로 꺼진다) ·
        POSTING_OCR_MAX_IMAGES · POSTING_OCR_TIMEOUT_MS
   ════════════════════════════════════════════════════════════ */
const { urlProblem, normalizeUrl } = require('./posting-fetch');
const GEMINI = require('./ai-gemini');

/* 한 번에 보는 장수. 공고 한 장이 이미지 둘로 잘려 있는 일이 흔해서 1장은 모자란다.
   그렇다고 많이 볼 수도 없다 — **옮겨 적기는 글자 수만큼 시간이 든다.** 한 장에
   최대 76초가 걸린 실측(아래 OCR_TIMEOUT_MS 주석)이 있어서, 석 장을 한 번에 넘기면
   상한(120초) 안에 못 끝나 잘 읽고 있던 것까지 통째로 버리게 된다.
   그래서 2장이 기본이고, 느긋하게 기다려도 되는 환경에서는 env 로 올린다. */
const MAX_IMAGES = Number(process.env.POSTING_OCR_MAX_IMAGES || 2);
/* 받아 보는 후보 수 — 이름만으로는 장식과 본문을 못 가르므로 몇 장 더 열어 보고 고른다. */
const MAX_TRIES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 9 * 1024 * 1024;        // Gemini 인라인 요청 상한(20MB) 안쪽
const FETCH_TIMEOUT_MS = 8000;
/* ── 상한은 45초로는 모자랐다 (실측 2026-09-07) ───────────────────────
   1024×2980 짜리 공고 이미지 한 장(1,600자 남짓)을 같은 조건으로 네 번 읽어 봤더니
   **9.7초 · 31.9초 · 61.2초 · 76.5초** 로 편차가 컸다. 45초를 상한으로 뒀을 때
   실제로 타임아웃이 났다 — 잘 읽고 있는데 우리가 끊은 것이다. 옮겨 적기는 글자 수만큼
   시간이 드는 일이라 초안(25초)과 성격이 다르다. 그래서 120초로 둔다.
   대신 화면이 6초쯤에서 "이미지를 읽고 있다" 고 말해 준다(jd-coach.js). */
const OCR_TIMEOUT_MS = Number(process.env.POSTING_OCR_TIMEOUT_MS || 120000);

/* posting-fetch.js 와 같은 UA — 브라우저인 척하지 않는다. */
const UA = 'Mozilla/5.0 (compatible; croad/1.0; +https://github.com/YoungIn02642/croad)';

/* Gemini 가 받는 형식만. gif·svg 는 애초에 후보에서 빠진다(posting-fetch imageUrls). */
const OK_MIME = /^image\/(png|jpeg|jpg|webp)$/;

/* ── 장식인지 본문인지는 '크기' 가 가른다 ────────────────────
   이름으로 거르는 것(logo·icon…)은 새는 그물이다. 진짜 기준은 **실제 픽셀 크기**다 —
   상세 공고 이미지는 못해도 폭 400·높이 300 은 된다. 헤더 배너(1200×80)·버튼(24×24)·
   추적용 1×1 은 여기서 걸린다. 바이트 수도 같이 본다(빈 이미지가 크게 잡힐 수 있다).

   크기를 알아내려고 라이브러리를 넣지 않는다. PNG·JPEG·WebP 는 헤더 몇 바이트에
   폭·높이가 그대로 적혀 있다 — 그것만 읽는다(디코딩하지 않는다). */
const MIN_W = 400;
const MIN_H = 300;
const MIN_BYTES = 8 * 1024;

function imageSize(buf) {
  if (!buf || buf.length < 24) return null;

  /* PNG — 시그니처 뒤 IHDR 에 폭·높이가 big-endian 으로 붙어 있다. */
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }

  /* JPEG — 마커를 따라가다 SOF(프레임 시작)에서 읽는다. 마커마다 길이가 달라
     건너뛰며 가야 한다. C4(허프만)·C8·CC 는 SOF 가 아니다. */
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p++; continue; }
      const marker = buf[p + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      const len = buf.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
      }
      if (len < 2) return null;
      p += 2 + len;
    }
    return null;
  }

  /* WebP — RIFF 컨테이너. 확장(VP8X)·손실(VP8 )·무손실(VP8L)이 각각 다르게 적는다. */
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
    if (chunk === 'VP8 ') {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buf.length > 25) {
      const bits = buf.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/* ── 이미지 한 장 받기 ────────────────────────────────────
   주소는 사용자가 준 페이지에서 나온 것이라 **여기도 SSRF 검사를 다시 한다** —
   페이지 안의 <img src="http://169.254.169.254/…"> 로 우리 내부를 읽게 할 수 있다.
   리다이렉트도 홉마다 다시 본다(posting-fetch 와 같은 규약). */
async function fetchImage(raw) {
  let url = normalizeUrl(raw);
  for (let hop = 0; hop <= 2; hop++) {
    const bad = await urlProblem(url);
    if (bad) return { ok: false, why: bad };

    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'image/*' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, why: String(e?.cause?.code || e?.message || '연결 실패').slice(0, 60) };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!OK_MIME.test(mime)) return { ok: false, why: `형식 ${mime || '알 수 없음'}` };

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) return { ok: false, why: '너무 큼' };

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return { ok: false, why: '너무 큼' };
    if (buf.length < MIN_BYTES) return { ok: false, why: '너무 작음' };

    const size = imageSize(buf);
    /* 크기를 못 읽으면 버린다 — 헤더가 이상한 것을 굳이 모델에 태울 이유가 없다. */
    if (!size) return { ok: false, why: '크기를 못 읽음' };
    if (size.w < MIN_W || size.h < MIN_H) return { ok: false, why: `${size.w}×${size.h}` };

    return {
      ok: true, url, bytes: buf.length, w: size.w, h: size.h,
      mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
      data: buf.toString('base64'),
    };
  }
  return { ok: false, why: '리다이렉트가 너무 많음' };
}

/* ── 모델에게 시키는 말 ───────────────────────────────────
   "옮겨 적어라" 지 "이해해라" 가 아니다. 요약·번역·보충을 막지 않으면 모델은
   반드시 그 셋 중 하나를 한다. 공고가 아닌 이미지를 골랐을 때 빠져나갈 문(없음)도
   준다 — 안 주면 회사 소개 배너를 보고 공고를 지어낸다. */
const SYSTEM = '너는 채용공고 이미지에 적힌 글자를 그대로 옮겨 적는 도구다. 읽는 사람이 아니라 옮기는 사람이다.';
const PROMPT = [
  '아래 이미지는 채용공고다. 이미지에 **보이는 글자만** 그대로 옮겨 적어라.',
  '',
  '- 원문 그대로. 요약·설명·번역·맞춤법 교정을 하지 마라.',
  '- 보이지 않는 내용을 채워 넣지 마라. 흐려서 못 읽는 글자는 그냥 빼라.',
  '- 위에서 아래로, 이미지 순서대로. 표는 "항목: 값" 한 줄씩으로 풀어라.',
  '- 제목·모집분야·담당업무·자격요건·우대사항·근무조건·전형절차·접수기간을 빠뜨리지 마라.',
  '- 로고·장식·버튼·사이트 메뉴 글자는 빼라.',
  /* 실측 — 이걸 안 막았더니 개인정보 반환 안내문에서 역량 근거가 나왔다(26-3 과 같은 실패). */
  '- 개인정보 처리방침·채용서류 반환 안내 같은 법적 고지문은 빼라.',
  '- 채용공고가 아닌 이미지면 다른 말 없이 "없음" 이라고만 답해라.',
  '',
  '설명 없이 옮겨 적은 글만 답한다.',
].join('\n');

const isAvailable = () => GEMINI.isConfigured();

/* 모델이 습관적으로 붙이는 껍데기를 벗긴다 — 코드펜스·"다음은 …입니다" 머리말. */
function cleanOcr(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  s = s.replace(/^(다음은|아래는)[^\n]{0,40}(입니다|습니다)[:.]?\s*\n/i, '').trim();
  if (/^["']?없음["']?[.。]?$/.test(s)) return '';
  return s.replace(/\n{3,}/g, '\n\n');
}

/* ── 여러 장을 한 번에 읽는다 ─────────────────────────────
   공고 한 장이 이미지 서넛으로 잘려 있는 일이 흔하다. 따로 부르면 "자격요건" 제목과
   그 아래 항목이 다른 호출로 갈려 앞뒤가 끊긴다. 한 번에 넘기면 그 순서가 유지된다.

   실패해도 던지지 않는다 — 이건 **덤으로 하는 일**이라, 여기서 던지면 공고 가져오기
   전체가 죽는다. 못 읽었으면 못 읽었다고 사유를 담아 돌려준다. */
async function readPostingImages(urls, { max = MAX_IMAGES } = {}) {
  if (!isAvailable()) return { ok: false, why: 'off', text: '', used: [] };
  const list = (urls || []).filter(Boolean).slice(0, MAX_TRIES);
  if (!list.length) return { ok: false, why: 'no-image', text: '', used: [] };

  const picked = [];
  const skipped = [];
  let total = 0;
  for (const u of list) {
    if (picked.length >= max) break;
    const got = await fetchImage(u);
    if (!got.ok) { skipped.push(`${u} — ${got.why}`); continue; }
    if (total + got.bytes > MAX_TOTAL_BYTES) { skipped.push(`${u} — 합계 초과`); continue; }
    total += got.bytes;
    picked.push(got);
  }
  if (skipped.length) console.log(`[공고이미지] 건너뜀 ${skipped.length}장 — ${skipped.slice(0, 4).join(' · ')}`);
  if (!picked.length) return { ok: false, why: 'no-image', text: '', used: [] };

  /* ── 과부하는 한 번 더 물어본다 (실측 2026-09-07) ─────────────────────
     검증 중에 Gemini 가 `HTTP 503 This model is currently experiencing high demand`
     를 냈다. 2026-09-03 에 자소서 초안을 통째로 죽였던 그 오류다. 초안은 Groq 로
     넘겨서 살렸는데(ai-provider.js callDraftModel) **여기는 넘어갈 데가 없다** —
     Groq 에는 비전 모델이 없다(26-8 에서 확인한 그대로다).
     남은 수단은 다시 묻는 것뿐이라 **한 번만** 다시 묻는다. 과부하는 대개 순간이고,
     두 번 이상 매달리면 사용자가 기다리는 시간만 늘어난다.
     쿼터 소진(429)·설정 오류(503 이지만 키 문제)는 다시 물어도 같은 답이다 —
     그래서 재시도는 '과부하·일시 오류' 로 보이는 502·503 에만 건다. */
  let out = null, lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(done => setTimeout(done, 1500));
    try {
      out = await GEMINI.callVision(
        picked.map(p => ({ mimeType: p.mimeType, data: p.data })),
        PROMPT, SYSTEM,
        { num_predict: 3000, timeoutMs: OCR_TIMEOUT_MS },
      );
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const again = (e?.status === 502 || e?.status === 503) && attempt === 0;
      console.warn(`[공고이미지] 읽기 실패${again ? ' — 한 번 더 시도합니다' : ''} —`,
        String(e?.detail || e?.message || e).slice(0, 160));
      if (!again) break;
    }
  }
  if (lastErr) return { ok: false, why: 'ai-failed', text: '', used: [], message: lastErr?.message || '' };

  const text = cleanOcr(out);
  if (!text) return { ok: false, why: 'not-posting', text: '', used: [] };
  console.log(`[공고이미지] ${picked.length}장 · ${Math.round(total / 1024)}KB → ${text.length}자`);
  return {
    ok: true, text, used: picked.map(p => p.url),
    count: picked.length,
    model: GEMINI.modelLabel(), provider: GEMINI.PROVIDER,
  };
}

module.exports = {
  readPostingImages, fetchImage, imageSize, cleanOcr, isAvailable,
  MAX_IMAGES, MIN_W, MIN_H, MIN_BYTES,
};
