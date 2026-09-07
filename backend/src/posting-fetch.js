/* ════════════════════════════════════════════════════════════
   채용공고 URL → 본문 텍스트

   ── 왜 필요한가 (사용자 지적 2026-08-21) ──
   자소서 코치는 공고 원문을 붙여넣어야 역량을 뽑는다. 그런데 요즘 공고는
   **복사를 막아 둔 곳이 많다.** 우클릭·드래그·선택 차단은 거의 전부 **클라이언트
   JS** 라, 서버가 그 페이지를 가져오면 애초에 존재하지 않는다. 주소만 받으면 된다.

   ── 크롤링이 아니다 ──
   사용자가 준 주소 **한 건**을 그 사람 대신 열어 주는 것이다. 목록을 훑거나 쌓아
   두지 않는다(그건 25-2 에서 안 하기로 한 것이다). 결과도 저장하지 않는다 —
   화면의 입력칸을 채우고 끝이다.

   ── 못 하는 것을 분명히 한다 ──
   로그인 벽 안의 공고, JS 로 그리는 페이지, 이미지로 된 공고는 못 가져온다.
   같은 '실패' 라도 사용자가 할 일이 달라서 **사유를 갈라서** 돌려준다(18-4 와 같은 원칙).

   ── 남의 서버로 우리 서버를 조종하지 못하게 한다 ──
   사용자가 준 주소를 서버가 그대로 여는 기능은 **SSRF** 의 정석이다. `127.0.0.1`,
   사설망, 클라우드 메타데이터(169.254.169.254) 를 넣으면 우리 내부를 대신 읽어 준다.
   그래서 주소를 **DNS 로 풀어 실제 IP 를 보고** 막고, 리다이렉트도 매 홉마다 다시 본다
   (한 번만 검사하면 첫 응답이 내부 주소로 넘겨 버린다).
   ════════════════════════════════════════════════════════════ */
const dns = require('dns').promises;

const TIMEOUT_MS = Number(process.env.POSTING_FETCH_TIMEOUT_MS || 12000);
const MAX_BYTES = Number(process.env.POSTING_FETCH_MAX_BYTES || 3 * 1024 * 1024);
const MAX_HOPS = 3;
/* 브라우저인 척하지 않는다. 우리가 누구인지 밝히고, 막을 곳은 막게 둔다 —
   막힌 것을 뚫는 기능이 아니라 복사 차단을 우회할 필요를 없애는 기능이다. */
const UA = 'Mozilla/5.0 (compatible; croad/1.0; +https://github.com/YoungIn02642/croad)';

/* ── 내부망 주소인가 ─────────────────────────────────────── */
function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)          // CGNAT
    || (a === 169 && b === 254)                    // 링크로컬 · 클라우드 메타데이터
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;                                   // 멀티캐스트 · 예약
}

function isPrivateIp(ip, family) {
  if (family === 4) return isPrivateV4(ip);
  const s = String(ip).toLowerCase();
  if (s === '::' || s === '::1') return true;
  /* ::ffff:10.0.0.1 처럼 v4 를 품은 v6 는 안쪽을 봐야 한다. */
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return /^(fc|fd)/.test(s)        // ULA
    || /^fe[89ab]/.test(s);        // 링크로컬
}

/* ── https:// 가 빠진 주소를 받아 준다 (사용자 지적 2026-08-21) ──
   브라우저 주소창에서 복사하면 스킴이 빠지는 일이 흔하다(크롬은 https:// 를 숨겨서
   보여준다). 실제로 `saramin.co.kr/zf_user/...` 를 붙여넣었더니 '주소 형식이
   아닙니다' 가 떴다 — 사용자 입장에서는 멀쩡한 주소를 거절당한 것이다.

   점이 있는 호스트꼴일 때만 https 를 붙인다. 아무 글자에나 붙이면 '안녕' 이
   `https://안녕` 이 되어 '주소를 찾을 수 없습니다' 로 엉뚱하게 흘러간다 —
   그건 형식 오류로 잡히는 편이 맞다.

   스킴이 이미 있으면 손대지 않는다. `file:` 은 아래 프로토콜 검사가 잡는다. */
function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (!/^[^\s/?#]+\.[^\s/?#]/.test(s)) return s;
  return `https://${s}`;
}

/* 주소가 열어도 되는 것인지. 통과하면 null, 아니면 사유 문자열. */
async function urlProblem(raw) {
  let u;
  try { u = new URL(normalizeUrl(raw)); } catch { return '주소 형식이 아닙니다.'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'http · https 주소만 열 수 있습니다.';
  if (!u.hostname) return '주소에 호스트가 없습니다.';

  let addrs;
  try { addrs = await dns.lookup(u.hostname, { all: true }); }
  catch { return '주소를 찾을 수 없습니다. 오타가 없는지 확인해 주세요.'; }
  /* 하나라도 내부 주소면 막는다 — 여러 개 중 골라 붙는 것이라 하나만 안전해도 소용없다. */
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address, a.family))) {
    return '내부망 주소는 열 수 없습니다.';
  }
  return null;
}

/* ── HTML → 사람이 읽는 글 ───────────────────────────────
   DOM 파서를 넣지 않았다(프론트에 빌드가 없고 서버도 의존성을 늘리지 않는다는
   기존 판단과 같은 결). 대신 **덜어내는 순서**를 지킨다 — 스크립트를 먼저 지우지
   않으면 그 안의 문자열이 본문으로 딸려 온다. */
function extractText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|head|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
  /* 머리·꼬리·메뉴는 회사마다 같은 말이 들어 있어 역량 추출을 어지럽힌다. */
  s = s.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  /* 줄바꿈이 사라지면 문단이 한 줄로 붙어 근거 문장을 못 가른다. */
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|table)>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, '\t');
  s = s.replace(/<[^>]+>/g, ' ');

  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
       .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

  return s.split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line, i, arr) => line || (arr[i - 1] || '').length)   // 빈 줄 연속은 하나로
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleOf(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? extractText(m[1]).slice(0, 120) : null;
}

/* 본문이라 부를 만한 분량인가. 공고는 아무리 짧아도 자격요건 몇 줄은 된다.
   이보다 적으면 JS 로 그리는 페이지이거나 이미지 공고다. */
const MIN_CHARS = 200;

/* ── 공고다운가 (실측 2026-08-21) ──────────────────────────
   사람인 공고 주소를 넣었더니 **1,280자를 가져왔는데 전부 메뉴와 개인정보 안내문**
   이었다. 상세 내용이 iframe 안에 있어서다. 길이만 보면 성공이라 그대로 넘겼을 텐데,
   그러면 "구직자의 개인정보는 채용 활동 외의 목적으로 사용하지 않습니다" 가 역량의
   근거로 붙는다 — 18-7 에서 겪은 그대로다. 에러가 안 나서 더 나쁘다.

   그래서 **공고에만 나오는 말**이 있는지 본다. 사이트별 파서를 만들지는 않는다
   (25-2 에서 안 하기로 한 것이다). 없다고 버리지도 않는다 — 가져온 것은 주되
   화면이 '확인하라' 고 다르게 말하게 flag 만 세운다. 지우는 것보다 의심하게 하는 게 낫다. */
const POSTING_WORDS = /담당업무|주요업무|자격\s?요건|지원\s?자격|우대\s?사항|모집\s?분야|모집\s?부문|근무\s?조건|전형\s?절차|접수\s?기간|지원\s?방법/g;

function postingHits(text) {
  return new Set(String(text).match(POSTING_WORDS) || []).size;
}

/* 머리쪽 메뉴를 걷어낸다. 공고 낱말이 처음 나오는 자리부터가 본문일 확률이 높다 —
   그 앞이 짧으면 굳이 손대지 않는다(제목까지 날릴 수 있다). */
function trimLead(text) {
  const m = text.match(POSTING_WORDS);
  if (!m) return text;
  const at = text.indexOf(m[0]);
  if (at < 120) return text;
  /* 낱말이 든 줄부터 살린다 — 줄 중간에서 자르면 첫 줄이 반토막 난다. */
  const lineStart = text.lastIndexOf('\n', at) + 1;
  return text.slice(lineStart).trim();
}

/* ── 공고가 아닌 것을 걷어낸다 (사용자 지적 2026-08-21) ────────
   가져오기가 되고 나서 본 진짜 문제. 사람인 공고 한 장에서 4,800자가 나오는데
   **뒤쪽 절반이 공고가 아니다.** 그중에는 그냥 지저분한 정도가 아니라 **위험한 것**이
   있다:

     경쟁자들의 역량 키워드 — 유연한 사고 · 웹디자인 · 피그마
     경쟁자들의 Skill      — 프로토 타이핑 · 그래픽/UI디자인 툴

   이건 **다른 지원자들의 스펙**이지 이 공고(PM)가 요구하는 역량이 아니다. 그대로
   분석에 넘기면 PM 공고에서 '피그마' 가 요구 역량으로 잡힌다. 기업리뷰의
   "전화선이 꼬인 사람은 즉시 해고" 같은 문장이 근거 문장으로 붙을 수도 있다.
   18-7 에서 겪은 실패 모드가 더 나쁜 얼굴로 돌아온 것이다.

   ── 어떻게 자르나 ──
   사이트별 선택자를 짜지 않는다(25-2). 취업 사이트가 공통으로 쓰는 **말**로 자른다.
     · 꼬리: '지원자 통계'·'기업리뷰'·'관련 태그' 처럼 **공고가 끝난 뒤**에 오는 칸
     · 덩어리: 'AI 서류 합격률' 처럼 중간에 끼어드는 광고·로그인 유도
     · 줄: '공유하기'·'지도보기'·'닫기' 처럼 버튼 글자만 남은 줄

   ── 본문을 자르지 않도록 못 박은 것 ──
   꼬리 표시가 **본문보다 앞에** 나오는 일이 있다(이 페이지도 'AI 서류 합격률' 이
   상세요강보다 위에 있다). 그래서 꼬리는 **마지막 공고 낱말 뒤에 나오는 것만** 자른다.
   덩어리 제거도 최대 줄 수를 정해 둔다 — 표시를 잘못 잡아도 본문을 통째로 먹지 않는다. */
const TAIL_MARKERS = /^(지원자 통계|경쟁력 분석|경쟁자들의|기업리뷰|면접후기|관련 태그|이어보는|이 기업의 다른 공고|구직자 개인정보 보호|로그인 이 필요한|마지막으로 필요한|이력서에 활용하기)/;
const NOISE_BLOCK = /^(AI 서류 합격률|AI 이력서 코칭|구직자 개인정보 보호|코칭 받을 이력서|최저임금계산에 대한 알림)/;
/* 덩어리를 끊는 줄 — 여기부터는 다시 본문이다. */
const BLOCK_END = /^(상세요강|모집요강|복리후생|근무조건|근무지위치|접수기간|담당업무|주요업무|자격요건|우대사항|채용절차|기업정보|급여|근무지역)/;
const BLOCK_MAX_LINES = 40;
/* 담당업무를 말하는 낱말. 이게 없으면 요약표만 온 것이다 — 본문이 딴 주소에 있다. */
const BODY_WORDS = /담당업무|주요업무|수행업무|직무내용|업무내용/;
/* 버튼·아이콘 글자만 남은 줄. **정확히 그 낱말일 때만** 지운다 — 부분일치로 지우면
   "지도 보기 편한 자료를 만들었습니다" 같은 본문이 날아간다. */
const NOISE_LINE = /^(닫기|TOP|공유하기|페이스북|트위터|URL복사|SMS발송|신고하기|인쇄하기|지도|지도보기|지도 보기|스카이뷰|지도초기화|크게보기|길찾기|이전공고|다음공고|도움말|내용 전체보기|기업정보 전체보기|기업정보 더보기|태그 더보기|나 님|경쟁자|더보기|목록|인근지하철|궁금해요|홈페이지 바로가기|남은기간|남은 기간)$/;
const NOISE_PREFIX = /^(조회수 |닫기 - |로그인\s*하(고|시고) |어떻게 .*분석됐나요|이 공고의 경쟁자|비교할 경쟁자|스토어 바로가기|막막한 취업준비|채용정보에 잘못된|마감일은 기업의 사정)/;
const NOISE_SUFFIX = /(상세보기|찾아오시는길)$/;

function denoise(text) {
  let lines = String(text || '').split('\n');

  /* ① 꼬리 — 마지막 공고 낱말 뒤에 나오는 표시부터 통째로 버린다. */
  let lastWord = -1;
  lines.forEach((l, i) => { if (postingHits(l)) lastWord = i; });
  /* 공고 낱말이 하나도 없으면 본문이 어디까지인지 알 수 없다. 그때는 자르지 않는다 —
     잘못 자르면 남는 게 없고, 어차피 weak 로 "공고 같지 않다" 고 알려 준다. */
  if (lastWord >= 0) {
    const tail = lines.findIndex((l, i) => i > lastWord && TAIL_MARKERS.test(l));
    if (tail > 0) lines = lines.slice(0, tail);
  }

  /* ② 중간에 끼어드는 덩어리 — 다시 본문이 시작될 때까지, 최대 BLOCK_MAX_LINES 줄. */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (NOISE_BLOCK.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && j - i < BLOCK_MAX_LINES && !BLOCK_END.test(lines[j])) j++;
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }

  /* ③ 버튼 글자만 남은 줄 · 줄 끝에 붙은 버튼 글자.
     주소 끝의 '지도보기' 처럼 문장에 달라붙어 오는 것은 줄째로 지우면 주소까지 잃는다. */
  return out
    .map(l => l.replace(/\s*(지도\s?보기|길찾기|더보기)$/, ''))
    .filter(l => !(NOISE_LINE.test(l) || NOISE_PREFIX.test(l) || NOISE_SUFFIX.test(l)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── 진짜 공고 주소를 한 번 따라간다 (실측 2026-08-21) ──────────
   사용자가 준 사람인 주소(`jobs/relay/view?...`)는 열리기는 하는데 내용이 메뉴뿐이다
   — 본문이 iframe 안에 있다. 그런데 그 페이지가 스스로 진짜 주소를 알려 준다:

     <link rel="canonical" href="https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=…">

   canonical·og:url 은 **웹 표준**이라 사이트별 파서를 만드는 것과 다르다(25-2 에서
   안 하기로 한 것은 사이트마다 선택자를 손으로 짜는 쪽이다). 검색엔진이 중복 페이지를
   가릴 때 쓰는 그 값을 그대로 읽는다.

   따라간 쪽이 **더 나을 때만** 쓴다. 한 번만 따라간다(canonical 이 서로를 가리키면
   끝나지 않는다). 따라간 주소도 fetchPosting 이 처음부터 다시 검사하므로 SSRF 안전은
   그대로다. */
/* JS·HTML 안에 박힌 주소는 escape 돼 있다. 안 풀면 쿼리가 깨지거나 같은 주소를
   다른 주소로 보게 된다. canonicalOf 와 embedUrls 가 같은 규칙을 쓴다. */
const unescapeUrl = raw => String(raw)
  .replace(/\\u0026/gi, '&').replace(/&amp;/gi, '&').replace(/\\\//g, '/').trim();

function canonicalOf(html, base) {
  const s = String(html || '');
  const tag = s.match(/<link[^>]+rel=["']?canonical["']?[^>]*>/i)
    || s.match(/<meta[^>]+property=["']og:url["'][^>]*>/i);
  if (!tag) return null;
  const attr = tag[0].match(/(?:href|content)=["']([^"']+)["']/i);
  if (!attr) return null;
  /* HTML 속성이라 &amp; 로 escape 돼 있다. 안 풀면 같은 주소를 다른 주소로 보고
     같은 페이지를 한 번 더 받는다 — 실측으로 잡코리아가 여기서 멈췄다. */
  let u;
  try { u = new URL(unescapeUrl(attr[1]), base); } catch { return null; }
  const norm = x => String(x).replace(/#.*$/, '').replace(/\/$/, '');
  return norm(u) === norm(base) ? null : u.toString();
}

/* ── 본문이 딴 주소에 있을 때 (실측 2026-08-21) ────────────────
   잡코리아 공고를 열면 요약표(모집분야·경력·학력·마감일)만 온다. 정작 **담당업무와
   자격요건 상세는 `상세요강` 탭 안**에 있고, 그건 페이지가 따로 불러온다.

     GI_Read_Comt_Ifrm?...&Gno=49798770   ← 이 안에 [담당업무]·[자격요건] 이 있다

   canonical(위)과는 성격이 다르다. canonical 은 "이 페이지가 곧 저 페이지" 라 통째로
   **바꾸는** 것이고, 이건 "이 페이지의 일부" 라 **이어 붙이는** 것이다. 요약표도
   지원 가능 여부를 판단하는 데 쓰이므로 버릴 이유가 없다.

   ── 사이트별 파서가 아니다 ──
   선택자를 짜는 대신 **같은 사이트 안의 주소** 중 끼워 넣는 내용처럼 보이는 것
   (ifrm·iframe·embed·detail·content)을 후보로 본다. 표준 <iframe src> 가 있으면
   그것부터 본다. 낱말 목록으로 판단하는 것은 POSTING_WORDS 와 같은 결이다.

   ── 함부로 붙이지 않는다 ──
   후보를 최대 셋만 보고, **공고 낱말이 더 많이 든 것만** 채택한다. 길이로 재지
   않는다 — 잡코리아는 요약표(693자)보다 본문(516자)이 짧은데도 담당업무가 거기 있다.
   후보 주소도 fetchPosting 이 처음부터 다시 검사하므로 SSRF 안전은 그대로다. */
function embedUrls(html, base) {
  let host;
  try { host = new URL(base).host; } catch { return []; }
  const found = new Set();
  const push = raw => {
    if (!raw || found.size >= 3) return;
    /* JS 안에 박힌 주소는 \u0026 · &amp; 로 escape 돼 있다. 그대로 두면 쿼리가 깨진다. */
    const s = unescapeUrl(raw);
    try {
      const u = new URL(s, base);
      if (u.host === host && u.toString() !== base) found.add(u.toString());
    } catch { /* 주소가 아니면 버린다 */ }
  };

  for (const m of String(html).matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of String(html).matchAll(/["']([^"']*(?:ifrm|iframe|embed|detail|content)[^"']*\?[^"']{1,200})["']/gi)) push(m[1]);
  return [...found];
}

/* ── 이미지로 된 공고 (2026-09-07, 사용자 요청) ─────────────────
   26-8 에서 "OCR 은 안 한다" 고 적어 둔 그 칸이다. 이유가 **Groq 에 비전 모델이 없다**
   였는데, 초안용으로 Gemini 를 붙이면서(2026-08-28) 전제가 사라졌다. 읽는 것은
   posting-image.js 가 하고, **여기서는 후보 주소만 고른다** — 이 파일은 네트워크와
   HTML 만 알고 AI 는 모른다(테스트가 네트워크 없이 도는 이유이기도 하다).

   ── 사이트별 선택자를 짜지 않는다 (25-2 와 같은 판단) ──
   상세 이미지가 어느 <div> 안에 있는지는 사이트마다 다르다. 대신 **아닌 것을 뺀다**:
     · 이름에 logo·icon·btn·banner 가 든 것 — 어느 사이트든 장식이다
     · svg·gif·ico — 아이콘·스페이서다. Gemini 가 받는 형식도 아니다
     · data: URI — 인라인은 거의 아이콘이고, 크면 HTML 만 수 MB 가 된다
   진짜 거르기는 **받아 본 뒤 크기로** 한다(posting-image.js). 이름만으로는 못 가른다.

   lazy 로딩이면 src 에 1x1 placeholder 가 들어 있고 진짜 주소는 data-src 에 있다 —
   그래서 data-src 를 먼저 본다. */
const IMG_NOISE = /(logo|icon|btn|button|sprite|blank|spacer|banner|badge|avatar|profile|arrow|bullet|favicon|share|sns|kakao|facebook|instagram|twitter|placeholder|dummy|no[_-]?img)/i;
const IMG_SKIP_EXT = /\.(svg|gif|ico|bmp|tiff?)(\?|#|$)/i;
const IMG_MAX_CANDIDATES = 12;

/* 끼워 넣은 쪽에서 챙긴 이미지를 **앞에** 둔다 — 상세가 거기 있으니 먼저 읽어야 한다.
   바깥 페이지 것은 뒤에 붙여 후보로만 남긴다. 중복은 지운다. */
function pickImages(deep, html, base) {
  return [...new Set([...(deep || []), ...imageUrls(html, base)])].slice(0, IMG_MAX_CANDIDATES);
}

function imageUrls(html, base) {
  /* 머리·꼬리·메뉴의 이미지는 공고가 아니다. extractText 가 글에서 걷어내는 것과
     같은 자리를 여기서도 걷어낸다 — 안 그러면 후보 열두 개가 전부 헤더 배너다. */
  const body = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|head|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  const out = new Set();
  const push = raw => {
    if (!raw || out.size >= IMG_MAX_CANDIDATES) return;
    const s = unescapeUrl(raw);
    if (!s || /^data:/i.test(s) || IMG_SKIP_EXT.test(s) || IMG_NOISE.test(s)) return;
    try {
      const u = new URL(s, base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.toString());
    } catch { /* 주소가 아니면 버린다 */ }
  };

  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    /* data-src 가 있으면 그쪽이 진짜다(lazy 로딩). 없을 때만 src 를 본다. */
    const lazy = tag.match(/\sdata-(?:src|original|lazy(?:-src)?|echo)=["']([^"']+)["']/i);
    const src = tag.match(/\ssrc=["']([^"']+)["']/i);
    push(lazy ? lazy[1] : (src ? src[1] : null));
  }
  return [...out];
}

/* ── 막힌 사이트는 10초씩 기다리지 않는다 (실측 2026-08-21) ────
   잡코리아는 우리 서버 IP 를 네트워크 단에서 막는다. TCP 연결이 아예 안 맺어져
   `UND_ERR_CONNECT_TIMEOUT` 으로 떨어지는데, **그 판정에 10초가 걸린다.**
   공고를 여러 개 확인하는 학생은 그 10초를 매번 다시 기다린다.

   그래서 연결 단계에서 실패한 호스트를 잠깐 기억했다가 **즉시 안내로 넘긴다.**

   ── 짧게 기억한다 ──
   일시적인 장애를 영구 차단으로 오해하면 멀쩡해진 뒤에도 계속 막는다. 그래서 기본
   10분이고, **성공하면 바로 지운다.** 오래 기억할수록 틀렸을 때 손해가 크다.

   ── HTTP 응답이 온 실패는 기억하지 않는다 ──
   401·403·404 는 이미 빠르다(연결은 됐다는 뜻이다). 여기서 기억하는 것은 **연결
   자체가 안 되는 것**뿐이다. */
const UNREACHABLE_TTL_MS = Number(process.env.POSTING_UNREACHABLE_TTL_MS || 10 * 60 * 1000);
const unreachable = new Map();          // host → 다시 시도해도 되는 시각

function markUnreachable(host, now = Date.now()) {
  if (!host) return;
  unreachable.set(host, now + UNREACHABLE_TTL_MS);
  /* 만료된 것을 같이 걷어낸다 — 안 하면 호스트마다 항목이 쌓여 메모리가 샌다
     (server.js 의 usernameCheckHits 와 같은 규약). */
  if (unreachable.size > 200) {
    for (const [k, until] of unreachable) if (now > until) unreachable.delete(k);
  }
}

function recentlyUnreachable(host, now = Date.now()) {
  const until = unreachable.get(host);
  if (!until) return false;
  if (now > until) { unreachable.delete(host); return false; }
  return true;
}

/* 성공하면 잊는다. 막혔다가 풀리는 일이 실제로 있다(차단 목록은 갱신된다). */
const clearUnreachable = host => unreachable.delete(host);

/* ── 가져오기 ────────────────────────────────────────────
   실패를 kind 로 가른다. 같은 '안 됨' 이라도 사용자가 할 일이 다르다. */
async function fetchPosting(raw, deepTried = false) {
  const bad = await urlProblem(raw);
  if (bad) return { ok: false, kind: 'bad-url', message: bad };

  /* 한글이 든 쿼리는 URL 이 알아서 퍼센트 인코딩한다 — 원문을 그대로 fetch 에
     넘기면 서버에 따라 400 이 온다. */
  let url = new URL(normalizeUrl(raw)).toString();
  /* 최근에 연결 자체가 안 됐던 곳이면 10초를 다시 기다리지 않는다. 할 말은 같으니
     사용자에게는 즉시 안내가 뜬다. */
  if (recentlyUnreachable(new URL(url).host)) {
    return {
      ok: false, kind: 'blocked',
      message: '이 사이트가 우리 서버에서 오는 접속을 막고 있어요 (조금 전에도 연결되지 않았습니다).',
    };
  }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',          // 홉마다 다시 검사한다 — 리다이렉트로 내부망에 들어갈 수 있다
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      /* ── 왜 못 열었는지를 갈라서 말한다 (실측 2026-08-21) ────
         로컬에서는 잘 되던 잡코리아가 **배포 서버에서만** "공고 페이지를 열지
         못했습니다" 로 떨어졌다. 그 한 줄로는 사용자가 할 수 있는 게 없다 —
         우리 잘못인지, 사이트가 막은 것인지, 주소가 틀린 것인지 알 수 없다.

         취업 사이트는 데이터센터 IP 나 해외 접속을 막는 일이 흔하다. 그때는
         연결 자체가 끊기므로(ECONNRESET·ECONNREFUSED) 브라우저로 여는 것은
         멀쩡하다 — 그러니 **복사해 붙여넣으라고** 안내하는 편이 맞다.
         원인 코드도 같이 실어 준다. 안 그러면 다음에 또 추측만 하게 된다. */
      const code = String(e?.cause?.code || e?.code || '');
      if (/timeout|aborted/i.test(e.message)) {
        return { ok: false, kind: 'error', message: '공고 페이지가 제때 응답하지 않았습니다.' };
      }
      if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) {
        return { ok: false, kind: 'bad-url', message: '주소를 찾을 수 없습니다. 오타가 없는지 확인해 주세요.' };
      }
      if (/^(ECONNRESET|ECONNREFUSED|EPROTO|EHOSTUNREACH|ENETUNREACH|CERT_|ERR_TLS|UND_ERR)/.test(code)) {
        /* 연결 단계에서 끊긴 것이므로 같은 호스트는 한동안 다시 시도하지 않는다. */
        try { markUnreachable(new URL(url).host); } catch { /* 주소가 이상하면 그냥 넘어간다 */ }
        return {
          ok: false, kind: 'blocked',
          message: `이 사이트가 우리 서버에서 오는 접속을 막고 있어요 (${code}).`,
        };
      }
      return {
        ok: false, kind: 'error',
        message: `공고 페이지를 열지 못했습니다${code ? ` (${code})` : ''}.`,
      };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), url).toString();
      const problem = await urlProblem(next);
      if (problem) return { ok: false, kind: 'bad-url', message: problem };
      url = next;
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false, kind: 'blocked',
        message: '이 사이트는 로그인해야 보이거나 외부에서 여는 것을 막아 두었어요.',
      };
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: false, kind: 'gone', message: '공고를 찾을 수 없습니다 — 마감돼 내려갔을 수 있어요.' };
    }
    if (!res.ok) {
      return { ok: false, kind: 'error', message: `공고 페이지가 오류를 돌려줬어요 (HTTP ${res.status}).` };
    }

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (/^image\//.test(type)) {
      return {
        ok: false, kind: 'image', imageUrl: url,
        message: '이미지로 된 공고예요.',
      };
    }
    if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) {
      return { ok: false, kind: 'error', message: '이 주소는 웹페이지가 아니에요.' };
    }

    const size = Number(res.headers.get('content-length') || 0);
    if (size && size > MAX_BYTES) {
      return { ok: false, kind: 'error', message: '공고 페이지가 너무 큽니다.' };
    }

    /* 여기까지 왔으면 연결은 됐다 — 막혔다는 기억을 지운다(차단 목록은 갱신된다). */
    try { clearUnreachable(new URL(url).host); } catch { /* 무시 */ }

    const html = (await res.text()).slice(0, MAX_BYTES);
    const text = denoise(trimLead(extractText(html)));
    const weak = postingHits(text) < 2;

    /* 담당업무가 어디에도 없으면 본문이 딴 데 있다는 신호다. 요약표만 온 것이다. */
    const hasBody = BODY_WORDS.test(text);

    /* ── 이미지는 대개 **끼워 넣은 쪽**에 있다 (실측 2026-09-07) ───────────
       사람인은 상세가 iframe(`user_html`) 안에 있는데, 이미지로 만든 공고는 바로 그
       안에 <img> 한 장으로 들어 있다. 바깥 페이지의 <img> 만 보면 후보가 **0장**이라
       읽을 것이 없다고 답하게 된다 — 정작 공고가 거기 있는데.
       그래서 끼워 넣은 쪽을 열어 봤다면 그쪽 이미지도 챙겨 둔다. 글을 못 이어 붙였을
       때도 챙긴다 — 글이 없는 것이 바로 이미지 공고의 모습이다. */
    const deepImages = [];

    if (!deepTried && (text.length < MIN_CHARS || weak || !hasBody)) {
      /* ① canonical — "이 페이지가 곧 저 페이지" 라 통째로 바꾼다. */
      const canon = canonicalOf(html, url);
      if (canon) {
        const better = await fetchPosting(canon, true);
        if (better.ok && !better.weak) return better;
        if (better.images) deepImages.push(...better.images);
      }
      /* ② 끼워 넣는 내용 — "이 페이지의 일부" 라 이어 붙인다. 요약표(경력·학력·마감일)도
         지원 가능 여부를 판단하는 데 쓰이므로 버리지 않는다.
         길이로 재지 않는다 — 잡코리아는 요약표보다 본문이 짧은데 담당업무는 거기 있다. */
      if (!hasBody) {
        for (const cand of embedUrls(html, url)) {
          const part = await fetchPosting(cand, true);
          if (part.images) deepImages.push(...part.images);
          if (part.ok && BODY_WORDS.test(part.text) && postingHits(part.text) >= 2) {
            const merged = `${text}\n\n${part.text}`;
            return { ok: true, text: merged, title: titleOf(html), url, weak: false, images: pickImages(deepImages, html, url) };
          }
        }
      }
    }

    if (text.length < MIN_CHARS) {
      return {
        ok: false, kind: 'empty',
        title: titleOf(html),
        url,
        /* 글이 없다고 끝내지 않는다 — 상세가 이미지로 붙어 있는 공고가 흔하다.
           읽는 것은 라우트가 posting-image.js 로 한다(이 파일은 AI 를 모른다). */
        images: pickImages(deepImages, html, url),
        message: '페이지는 열렸는데 본문 글을 찾지 못했어요 — 공고가 이미지이거나, 화면에서 그려지는 방식일 수 있어요.',
      };
    }
    return { ok: true, text, title: titleOf(html), url, weak, images: pickImages(deepImages, html, url) };
  }

  return { ok: false, kind: 'error', message: '주소가 계속 다른 곳으로 넘겨서 멈췄어요.' };
}

module.exports = {
  fetchPosting, extractText, titleOf, urlProblem, normalizeUrl, canonicalOf, denoise, embedUrls, imageUrls,
  markUnreachable, recentlyUnreachable, clearUnreachable,
  postingHits, trimLead, _MIN_CHARS: MIN_CHARS,
};
