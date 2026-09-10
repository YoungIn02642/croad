/* 스펙업 — 자격증 시험일정 · 공모전/대외활동 모집
   계산은 src/specup.js 가 한다. 여기는 입력을 다듬고 실패를 사용자가 할 수 있는
   말로 바꾸는 얇은 껍데기다.

   ── 실패를 500 한 줄로 뭉개지 않는다 ──
   키 없음 · 활용신청 전 · 한도 초과는 사용자가 할 일이 전부 다르다. 예전에 AI
   라우트가 이걸 "AI 분석에 실패했습니다" 하나로 뭉개서 아무도 원인을 몰랐다
   (작업정리 2-3-1). 같은 실수를 반복하지 않으려고 specup.js 가 붙여 준
   `payload` 를 그대로 내려보낸다. */
const express = require('express');
const { cachePath } = require('../cache-dir');
const specup = require('../specup');
const LOGO = require('../company-logo');
const path = require('path');
const WEVITY = require('../wevity');

const router = express.Router();

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* specup.js 가 던지는 오류에는 payload(code·reason·error·how)가 붙어 있다.
   없으면 진짜 예상 못 한 오류이므로 502 로 올린다. */
function fail(res, err) {
  const p = err && err.payload;
  if (!p) {
    console.error('[specup]', err);
    return res.status(502).json({ error: '데이터를 불러오지 못했어요.', reason: 'unknown' });
  }
  return res.status(p.code || 502).json({ error: p.error, reason: p.reason, how: p.how });
}

/* GET /api/specup/exams?certs=정보처리기사,SQLD&year=2026
   부족한 자격증 이름을 받아 각각의 다음 회차를 돌려준다. */
router.get('/exams', ah(async (req, res) => {
  const certs = String(req.query.certs || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);   // 화면 한 장 분량이면 충분
  if (!certs.length) return res.json({ year: null, items: [] });

  const year = Number(req.query.year) || undefined;
  try {
    res.json(await specup.certSchedules(certs, { year }));
  } catch (err) {
    fail(res, err);
  }
}));

/* GET /api/specup/activities?topic=contest|activity&page=1 */
router.get('/activities', ah(async (req, res) => {
  try {
    res.json(await specup.youthActivities({
      topic: String(req.query.topic || 'contest'),
      page: Math.max(1, Number(req.query.page) || 1),
    }));
  } catch (err) {
    fail(res, err);
  }
}));

/* ── 캐시는 짧게 (2026-09-07) ──────────────────────────────
   처음에 `max-age=86400` 을 걸었다. "로고는 자주 안 바뀐다"는 이유였고 그 자체는
   맞다. 그런데 **끄는 순간 그 캐시가 발목을 잡는다** — 포스터를 껐는데도 엣지에
   남은 사본이 24시간 계속 나갔고, 껐는지 확인하러 찔러 본 응답조차 캐시된 것이라
   "아직 안 꺼졌다"고 잘못 읽었다. 실제로 겪었다.

   그림 하나 아끼자고 **되돌릴 수 없는 24시간**을 만들 이유가 없다. 5분이면 목록을
   오갈 때는 그대로 재사용되고, 꺼야 할 때는 5분 안에 사라진다.

   **204(없음)는 아예 저장하지 않는다.** 그걸 캐시하면 나중에 로고가 생겨도 한동안
   안 뜬다 — 없다는 답이 있다는 답을 가로막는다. */
const IMG_CACHE = 'public, max-age=300, must-revalidate';
const NONE_CACHE = 'no-store';

/* GET /api/specup/logo?name=<주관기관>
   공모전 카드 표지의 주관기관 로고(사용자 결정 2026-09-06).

   회사 리포트의 `/api/company/logo` 와 **같은 모듈**을 쓰지만 주소를 따로 둔다 —
   여기 오는 이름은 회사가 아니라 주최 기관('과학기술정보통신부'·'연암대학교')이고,
   주소가 나뉘어 있어야 어느 화면이 무엇을 부르는지 로그에서 갈린다.

   **주소가 아니라 이름을 받는다.** 화면이 주소를 고를 수 있으면 우리 서버를 남의
   주소로 조종하는 통로가 된다(company-logo.js 머리주석).
   못 찾으면 204 — 화면이 이모지 표지로 물러난다. */
router.get('/logo', ah(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '기관명을 입력해 주세요.' });

  const none = () => res.set('Cache-Control', NONE_CACHE).status(204).end();

  const host = LOGO.hostFor(name);
  if (!host) return none();

  let file = LOGO.cached(host);
  if (!file) {
    try { file = await LOGO.fetchLogo(host); } catch { file = null; }
  }
  if (!file) return none();

  res.set('Cache-Control', IMG_CACHE);
  res.type(file.type);
  res.sendFile(file.path);
}));

/* GET /api/specup/poster?id=wv-<번호>
   공모전 카드 표지의 **모집 포스터**(사용자 지시 2026-09-07).

   **주소가 아니라 id 를 받는다.** 주소를 받으면 우리 서버가 남의 주소를 대신 여는
   통로가 된다(company-logo.js 머리주석). 원본 주소는 서버가 캐시에서 찾는다.

   받아 두는 이유는 세 가지다 — ① 학생 브라우저가 원문 사이트를 직접 부르면 누가
   무엇을 보는지 그쪽 로그에 남고 ② 그쪽 대역폭을 쓰며 ③ 리퍼러 검사에 막히면
   카드가 통째로 깨진다.

   못 찾으면 204 — 화면이 주관기관 로고, 그것도 없으면 이모지로 물러난다. */
const POSTER_DIR = cachePath('posters');

router.get('/poster', ah(async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: '공고 id 가 필요합니다.' });

  const none = () => res.set('Cache-Control', NONE_CACHE).status(204).end();

  const url = WEVITY.posterUrlOf(id);
  if (!url) return none();

  /* 포스터는 로고보다 크다(세로로 긴 이미지가 많다). 상한을 따로 준다. */
  const file = await LOGO.cacheImage(url, POSTER_DIR, id, { maxBytes: 3 * 1024 * 1024 });
  if (!file) return none();

  res.set('Cache-Control', IMG_CACHE);
  res.type(file.type);
  res.sendFile(file.path);
}));

module.exports = router;
