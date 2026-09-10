/* ════════════════════════════════════════════════════════════
   회사 로고 — 공고 카드에 붙일 이미지

   ── 사용자 지시 (2026-09-06) ────────────────────────────────
   "카드에 이미지도 어떻게 크롤링하거나 그냥 복사붙여넣기로 가져와서 넣어줄래?"
   → **회사 도메인의 로고를 자동으로** 가져오기로 정했다.

   ── 도메인은 이미 갖고 있다 ─────────────────────────────────
   새로 찾을 필요가 없었다. DART 회사개황이 `hm_url`(홈페이지)을 주고, 회사 리포트가
   이미 그것을 화면에 쓰고 있다(`analysis.dart.profile.homepage`). 그 주소 하나만
   넘겨받으면 된다 — **회사명으로 도메인을 추측하지 않는다.** `삼성전자.com` 같은
   추측은 맞을 때도 있지만 틀리면 **남의 회사 로고**를 우리 화면에 띄운다.
   그건 404 보다 나쁘다(25-3 에서 채용페이지를 손으로 채운 것과 같은 이유).

   ── 왜 브라우저가 직접 안 받고 서버가 받아 두나 ─────────────
   1. 학생 브라우저가 회사 사이트로 직접 요청을 보내면, **누가 어느 회사를 보고
      있는지**가 그 회사 서버 로그에 남는다. 우리가 대신 받아 우리 주소로 준다
   2. 외부 로고 서비스(구글 파비콘 등)에 도메인을 넘기지 않는다 — 같은 이유다
   3. 한 번 받으면 디스크에 두고 다시 안 받는다. 회사 로고는 자주 안 바뀐다

   ── 못 가져오는 것을 숨기지 않는다 ──────────────────────────
   홈페이지가 없는 회사(비상장·미공시)가 많고, 있어도 로고를 못 찾는 사이트가 있다.
   그때는 **빈 이미지를 주지 않고 204** 를 준다 — 화면이 이니셜 카드를 그린다.
   깨진 이미지 아이콘을 띄우면 학생은 우리 화면이 고장 난 줄 안다.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { cachePath } = require('./cache-dir');
const path = require('path');
const { urlProblem, normalizeUrl } = require('./posting-fetch');

const DIR = cachePath('logos');
const TIMEOUT_MS = Number(process.env.LOGO_TIMEOUT_MS || 8000);
const MAX_BYTES = Number(process.env.LOGO_MAX_BYTES || 512 * 1024);
/* 못 찾은 도메인을 매번 다시 두드리지 않는다. 하루 지나면 다시 본다
   (사이트 개편으로 생기기도 한다). */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

const UA = 'Mozilla/5.0 (compatible; croad/1.0; +https://github.com/YoungIn02642/croad)';

const TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/webp': 'webp',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};

const misses = new Map();          // host → 마지막으로 못 찾은 시각

/* ── 회사명 → 홈페이지 호스트 ────────────────────────────────
   **화면이 주소를 보내지 않는다.** 브라우저가 "이 주소의 로고를 가져와" 라고 시킬 수
   있으면 그건 우리 서버를 남의 주소로 조종하는 통로가 된다(posting-fetch.js 머리주석
   의 SSRF 와 같은 이야기). 그래서 화면은 **회사명만** 보내고, 주소는 서버가 DART
   회사개황(hm_url)에서 이미 받아 둔 것을 쓴다.

   회사 리포트를 그릴 때 remember() 로 적어 두고, 로고 라우트가 hostFor() 로 찾는다.
   재시작하면 사라지므로 파일에도 남긴다 — 없으면 리포트를 다시 열기 전까지 로고가
   안 뜬다. */
const HOSTS = cachePath('company-logo-hosts.json');
let _hosts = null;

function hosts() {
  if (_hosts) return _hosts;
  try { _hosts = JSON.parse(fs.readFileSync(HOSTS, 'utf8')); }
  catch { _hosts = {}; }
  return _hosts;
}

const key = name => String(name || '').trim();

/* 회사명과 홈페이지를 짝지어 둔다. 값이 바뀌지 않으면 파일을 다시 쓰지 않는다 —
   리포트를 열 때마다 디스크에 쓰면 조회 한 번이 쓰기 한 번이 된다. */
function remember(name, homepage) {
  const k = key(name);
  const host = hostOf(homepage);
  if (!k || !host) return null;
  const map = hosts();
  if (map[k] === host) return host;
  map[k] = host;
  try {
    fs.mkdirSync(path.dirname(HOSTS), { recursive: true });
    fs.writeFileSync(HOSTS, JSON.stringify(map), 'utf8');
  } catch { /* 못 써도 이번 요청은 산다 — 메모리에는 남아 있다 */ }
  return host;
}

const hostFor = name => hosts()[key(name)] || null;

/* 주소에서 호스트만 남긴다. 캐시 파일 이름이자 우리가 부를 대상이다.
   호스트를 그대로 파일 이름에 쓰면 안 된다 — `..` 이나 `/` 가 섞이면 경로를 벗어난다. */
function hostOf(raw) {
  try { return new URL(normalizeUrl(raw)).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}
const safeName = host => host.replace(/[^a-z0-9.-]/g, '_');

function cachedIn(dir, key) {
  for (const ext of Object.values(TYPES)) {
    const p = path.join(dir, `${safeName(key)}.${ext}`);
    if (fs.existsSync(p)) return { path: p, type: Object.keys(TYPES).find(k => TYPES[k] === ext) };
  }
  return null;
}
const cached = host => cachedIn(DIR, host);

/* ── 그림 한 장을 받아 우리 쪽에 둔다 ────────────────────────
   로고 말고도 받아 둘 그림이 생겼다(공모전 포스터, 2026-09-07 사용자 지시).
   받는 규칙은 같아야 한다 — 내부망 차단, 이미지가 맞는지 확인, 크기 상한,
   확장자는 **응답이 말한 타입**에서 정한다(주소 끝만 보고 정하면 404 HTML 을
   .jpg 로 저장한다).

   `key` 는 파일 이름이 되므로 부르는 쪽이 정한다. 여기서 한 번 더 씻는다 —
   `..` 이나 `/` 가 섞이면 디렉터리를 벗어난다. */
async function cacheImage(url, dir, key, { maxBytes = MAX_BYTES } = {}) {
  const hit = cachedIn(dir, key);
  if (hit) return hit;
  if (await urlProblem(url)) return null;

  try {
    const res = await get(url, 'image/*');
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;

    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${safeName(key)}.${ext}`);
    fs.writeFileSync(out, buf);
    return { path: out, type };
  } catch {
    return null;
  }
}

/* ── 페이지에서 로고 후보를 고른다 ───────────────────────────
   순서가 곧 화질 순서다. 파비콘(16px)을 카드에 키워 놓으면 뭉개져서, 안 넣느니만
   못하다. 큰 것부터 본다:
     apple-touch-icon (180px) → og:image → link rel=icon → /favicon.ico
   og:image 는 로고가 아니라 대표 사진일 때가 있다. 그래도 카드 이미지로는 쓸 만해서
   남긴다 — 다만 apple-touch-icon 보다는 뒤다. */
function candidates(html, baseUrl) {
  const out = [];
  const push = u => { if (u) { try { out.push(new URL(u, baseUrl).href); } catch {} } };
  /* 속성 하나를 꺼낸다. 정규식을 **문자열로 조립하지 않는다** — 조립하면 `\s` 같은
     이스케이프가 조용히 풀려서 아무것도 안 걸린다. 실제로 그렇게 짰다가 삼성 페이지의
     `<link rel="shortcut icon">` 을 통째로 놓쳤다(에러는 안 났다 — 후보가 0개일 뿐). */
  const attrOf = (tag, name) => {
    const re = name === 'rel' ? /\brel\s*=\s*["']([^"']+)["']/i
      : name === 'href' ? /\bhref\s*=\s*["']([^"']*)["']/i
      : /\bcontent\s*=\s*["']([^"']*)["']/i;
    return re.exec(tag)?.[1] || '';
  };

  const links = [...String(html).matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const rel = re => links.filter(t => re.test(attrOf(t, 'rel')));

  rel(/apple-touch-icon/i).forEach(t => push(attrOf(t, 'href')));
  const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(String(html));
  if (og) push(attrOf(og[0], 'content'));
  /* `rel="shortcut icon"` 과 `rel="icon"` 을 함께 잡는다. 단어 경계로 끊지 않으면
     'apple-touch-icon' 이 여기 또 걸려 같은 주소를 두 번 본다. */
  rel(/(^|\s)(shortcut\s+)?icon(\s|$)/i).forEach(t => push(attrOf(t, 'href')));
  push('/favicon.ico');

  return [...new Set(out)];
}

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

/* 홈페이지 주소 → 로고 파일. 있으면 { path, type }, 없으면 null.
   **네트워크는 여기서만 한다.** 라우트는 파일을 내려보내기만 한다. */
async function fetchLogo(homepage) {
  const host = hostOf(homepage);
  if (!host) return null;

  const hit = cached(host);
  if (hit) return hit;

  const missedAt = misses.get(host);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

  /* 사용자가 준 주소를 서버가 여는 경로라 SSRF 를 막아야 한다.
     posting-fetch 의 검사를 그대로 쓴다 — 규칙이 두 군데 있으면 한쪽만 고쳐진다. */
  const base = normalizeUrl(homepage);
  if (await urlProblem(base)) { misses.set(host, Date.now()); return null; }

  let html = '';
  try {
    const res = await get(base, 'text/html');
    if (res.ok) html = (await res.text()).slice(0, 300 * 1024);   // <head> 만 보면 된다
  } catch { /* 홈페이지가 안 열려도 /favicon.ico 는 있을 수 있다 */ }

  for (const url of candidates(html, base)) {
    /* 로고를 받으러 다른 호스트로 가는 일이 흔하다(CDN). 매번 다시 검사한다. */
    if (await urlProblem(url)) continue;
    try {
      const res = await get(url, 'image/*');
      if (!res.ok) continue;
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = TYPES[type];
      if (!ext) continue;                                  // HTML 404 페이지를 이미지로 저장하지 않는다
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) continue;

      fs.mkdirSync(DIR, { recursive: true });
      const out = path.join(DIR, `${safeName(host)}.${ext}`);
      fs.writeFileSync(out, buf);
      return { path: out, type };
    } catch { /* 다음 후보 */ }
  }

  misses.set(host, Date.now());
  return null;
}

module.exports = {
  fetchLogo, hostOf, candidates, cached, cachedIn, cacheImage, remember, hostFor,
  DIR, HOSTS_PATH: HOSTS, TYPES, _misses: misses,
  _resetHosts: () => { _hosts = null; },
};
