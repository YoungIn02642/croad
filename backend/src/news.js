/* ══════════════════════════════════════════════════════════════
   회사 뉴스 — 자소서 '지원동기' 문항의 소재

   ── 왜 만들었나 ──
   자소서에서 학생이 가장 못 쓰는 문항이 "왜 우리 회사인가"다. 역량 사전
   (jd-competency.js)으로는 채울 수 없다 — 회사마다 답이 다르기 때문이다.
   그 빈칸을 "이 회사가 지금 무엇을 하고 있는지"로 채운다.

   ── AI 를 쓰지 않는다 ──
   기사를 요약시키지 않는다. 로컬 8B 는 요약에서 없는 사실을 지어내고(할루시네이션),
   자소서에 지어낸 사실을 쓰면 면접에서 그대로 무너진다. 그래서 **실제 기사 제목과
   링크를 그대로** 보여주고, 학생이 원문을 읽고 직접 판단하게 한다.
   "이렇게 쓰라"는 작성 지침만 코드가 조립한다(자소서 코치와 같은 원칙).

   ── 프로바이더 ──
   · ncp   : NCP NAVER API Hub 검색 (헤더 X-NCP-APIGW-API-KEY-ID)
   · naver : 개발자센터 검색 API   (헤더 X-Naver-Client-Id)
             ↑ 응답 형식이 같아 키 하나로 양쪽을 시도하고 통한 쪽을 기억한다
   · web   : 키 없이 동작하는 폴백. casAnalyze 가 이미 쓰던 방식과 같은 경로다.
             정확도는 낮지만 **키 발급 전에도 기능이 죽지 않는다**.
   env: NEWS_PROVIDER(ncp|naver|web) · NAVER_CLIENT_ID · NAVER_CLIENT_SECRET
   ══════════════════════════════════════════════════════════════ */
const TIMEOUT_MS = Number(process.env.NEWS_TIMEOUT_MS || 8000);
const MAX_ITEMS  = 5;

/* 한 번에 받아오는 기사 수. 주간 대표 기사를 뽑으려면 5주치가 표본에 들어와야 하고,
   같은 사건을 여러 언론사가 쓴 것도 세야 해서 넉넉히 받는다.
   네이버 검색 API 의 display 상한이 100 이라 그 값을 그대로 쓴다.
   (예전엔 15건만 받아서 이번 주 기사로 다 차면 지난주가 아예 안 보였다.) */
const FETCH_COUNT = 100;

const NAVER_ID     = (process.env.NAVER_CLIENT_ID || '').trim();
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').trim();

/* ── 네이버 뉴스 검색은 발급처가 둘이고, 응답 형식은 같다 ───────
   콘솔에 적힌 헤더 이름으로 어느 쪽인지 알 수 있다.
     · NCP NAVER API Hub : X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
                           GET https://naverapihub.apigw.ntruss.com/search/v1/news
     · 개발자센터         : X-Naver-Client-Id / X-Naver-Client-Secret
                           GET https://openapi.naver.com/v1/search/news.json
   응답 스키마(items[].title/originallink/description/pubDate)는 동일해서 파싱은 하나면 된다.
   그래서 **키 하나로 양쪽을 차례로 시도**하고, 통한 쪽을 기억한다(모델 자동 선택과 같은 방식).
   사용자가 어느 콘솔에서 발급받았는지 몰라도 그냥 동작하는 게 목적이다. */
/* ── 정렬은 sim(관련도) 하나만 쓴다 ──────────────────────────────────────────
   date(최신순)로 하면 회사가 스치듯 언급된 기사가 앞에 온다 — 실측으로
   '현대오토에버' 검색 1위가 LG이노텍 MSCI 편입 기사였다. 지원동기 소재로는
   '이 회사를 다룬 기사'가 필요하지 '이 회사를 언급한 최신 기사'가 아니다.

   ── 최신순 호출을 넣었다가 뺐다 (사용자 지시 2026-09-08) ────────────────────
   "최신 뉴스가 없다" 는 지적을 받고 sort=date 검색을 한 번 더 걸어 표본에 더했는데,
   사용자가 곧바로 **"관련 없는 기사가 많더라"** 고 했다. 위 실측이 그대로 재현된 것이다.
   최신순으로 따로 부르면, 이 화면이 원래 막으려던 기사를 '최신' 이라는 이름으로
   다시 들여놓게 된다.
   **최신 뉴스는 관련도 결과 안에서 고른다**(recentPicks). 회사명 검색에 주제 검색
   4가지(TREND_QUERIES)를 더해 관련도 상위 기사가 수백 건 모이므로, 그 안에서
   1주일치를 뽑으면 된다. '최신'을 얻자고 '관련도'를 버리지 않는다. */
const ENDPOINTS = [
  {
    id: 'ncp',
    url: 'https://naverapihub.apigw.ntruss.com/search/v1/news',
    label: 'NCP NAVER API Hub',
    headers: (id, secret) => ({ 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }),
    params: q => ({ query: q, display: String(FETCH_COUNT), sort: 'sim', format: 'json' }),
  },
  {
    id: 'naver',
    url: 'https://openapi.naver.com/v1/search/news.json',
    label: '네이버 개발자센터 검색 API',
    headers: (id, secret) => ({ 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret }),
    params: q => ({ query: q, display: String(FETCH_COUNT), sort: 'sim' }),
  },
];

let _resolvedEndpoint = null;      // 한 번 통한 쪽을 기억해 매번 두 번 부르지 않는다

/* 키가 있으면 네이버 계열, 없으면 웹 폴백. 명시적으로 고를 수도 있다. */
function provider() {
  const forced = (process.env.NEWS_PROVIDER || '').toLowerCase();
  if (['ncp', 'naver', 'web'].includes(forced)) return forced;
  if (!NAVER_ID || !NAVER_SECRET) return 'web';
  return _resolvedEndpoint || 'naver-auto';   // 아직 어느 쪽인지 모름 → 시도해서 정한다
}

/* 실체참조를 풀어준다. &#x27; 를 안 풀면 'x27' 이 자소서 키워드로 튀어나온다(실측).
   stripTags 뿐 아니라 tokenize 에서도 한 번 더 부른다 — 키워드 추출은 어떤 경로로
   불려도 이런 찌꺼기를 내보내면 안 되기 때문이다. */
const decodeEntities = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const stripTags = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ')
  .trim();

/* 웹 폴백은 제목 끝에 표시용 주소를 붙여 보낸다
   ("보도자료 | 현대오토에버 www.hyundai-autoever.com/kor…").
   그대로 두면 www·com·view 같은 조각이 '이 회사의 화두'로 집계돼 키워드를 통째로 망친다.
   → 주소를 문장에서 걷어낸 뒤에 키워드를 센다. */
const stripUrls = s => String(s || '')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\b[\w-]+(\.[\w-]+)+(\/\S*)?/g, ' ')      // 맨몸 도메인 + 경로
  .replace(/\s+/g, ' ')
  .trim();

/* ── 네이버 뉴스 검색 (NCP / 개발자센터 공통) ───────────────── */
async function callEndpoint(ep, company) {
  const res = await fetch(`${ep.url}?${new URLSearchParams(ep.params(company))}`, {
    headers: ep.headers(NAVER_ID, NAVER_SECRET),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`${ep.label} 오류 ${res.status}: ${body.slice(0, 150)}`);
    err.status = res.status;
    /* 네이버는 사유를 본문에 적어 준다(errorCode/errorMessage). 상태 코드만으론
       '키가 틀림'과 '권한 없음'이 구분되지 않는 경우가 있어 같이 남긴다. */
    err.detail = body.replace(/\s+/g, ' ').slice(0, 120);
    err.authFailed = res.status === 401 || res.status === 403;
    throw err;
  }
  const data = JSON.parse(body);
  return (data.items || []).map(it => ({
    title: stripTags(it.title),
    summary: stripTags(it.description),
    url: it.originallink || it.link,
    date: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : null,
  }));
}

async function fromNaver(company, mode) {
  /* 어느 콘솔의 키인지 이미 알면 그것만, 모르면 둘 다 시도한다.
     인증 실패(401/403)일 때만 다음 후보로 넘어간다 — 쿼터 초과나 네트워크 오류에
     엉뚱한 엔드포인트를 또 때리지 않기 위해서다. */
  /* NEWS_PROVIDER 로 한쪽을 지정했더라도, 인증이 막히면 나머지도 시도한다.
     지정값이 실제 키와 안 맞는 일이 실제로 있었다(.env 에 naver 를 적어두고 NCP 키를
     넣은 경우). 설정을 존중하되 그것 때문에 기능이 죽지는 않게 하고, 대신 경고를 남긴다. */
  const preferred = (mode === 'ncp' || mode === 'naver')
    ? ENDPOINTS.filter(e => e.id === mode)
    : [];
  const candidates = [...preferred, ...ENDPOINTS.filter(e => !preferred.includes(e))];

  let lastErr = null;
  const tried = [];        // 어느 발급처가 어떤 응답을 줬는지 모아 둔다(진단용)
  for (const ep of candidates) {
    if (preferred.length && ep.id !== mode && !lastErr?.authFailed) break;
    try {
      const items = await callEndpoint(ep, company);
      if (_resolvedEndpoint !== ep.id) {
        console.log(`[news] ${ep.label} 로 뉴스를 가져옵니다.`);
        if (preferred.length && ep.id !== mode) {
          console.warn(`[news] .env 의 NEWS_PROVIDER=${mode} 는 이 키와 맞지 않습니다. `
            + `NEWS_PROVIDER=${ep.id} 로 바꾸거나 줄을 지우세요(자동 판별).`);
        }
        _resolvedEndpoint = ep.id;
      }
      return items;
    } catch (e) {
      lastErr = e;
      tried.push(`${ep.label}: ${e.status || '연결실패'} ${e.detail || ''}`.trim());
      console.warn(`[news] ${ep.label} 실패 — ${e.message}`);
      if (!e.authFailed) break;          // 인증 문제가 아니면 다른 발급처를 시도해도 소용없다
    }
  }

  /* 양쪽 다 거절당했을 때 '인증 실패'만 알려주면 다음에 뭘 고쳐야 할지 알 수 없다.
     실제로 배포에서 이 메시지만 보고 키를 세 번 갈아 끼웠다. 상태 코드가 사유를
     가른다 — 401 은 키가 틀린 것, 403 은 그 키에 검색 권한이 없는 것,
     404 는 주소가 맞지 않는 것이다. 응답 본문 앞부분까지 그대로 보여준다. */
  const err = new Error(lastErr?.authFailed
    ? '네이버 뉴스 검색 인증에 실패했습니다.\n' + tried.map(t => '  · ' + t).join('\n')
      + '\n  401=키가 틀림 · 403=그 키에 검색 권한 없음 · 404=주소 불일치'
    : (lastErr?.message || '네이버 뉴스 검색에 실패했습니다.'));
  err.status = lastErr?.authFailed ? 503 : 502;
  throw err;
}

/* ── 키 없는 폴백 ───────────────────────────────────────────
   DuckDuckGo HTML 결과를 긁는다. casAnalyze.js 가 활동 기간 추정에 쓰는 것과 같은
   경로다. 링크가 리다이렉트(/l/?uddg=…)로 감싸여 오므로 풀어서 원문 주소를 준다. */
async function fromWeb(company) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(`${company} 뉴스`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; careerly/1.0)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`웹 검색 실패 (${res.status})`);
    err.status = 502;
    throw err;
  }
  const html = await res.text();

  const blocks = [...html.matchAll(
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]*class="result__a"|$)/g
  )];

  return blocks.map(b => {
    let link = b[1];
    const uddg = link.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch { /* 원본 유지 */ } }
    const snippet = (b[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    return {
      title: stripUrls(stripTags(b[2])),
      summary: stripUrls(stripTags(snippet)),
      url: link,
      date: null,
    };
  });
}

/* 같은 기사가 언론사별로 여러 번 걸린다. 제목이 거의 같으면 한 건으로 본다. */
const titleKey = t => String(t || '').replace(/[\s\[\]()·…"'’“”]/g, '').slice(0, 25);

function dedupe(items) {
  const seen = new Set();
  return items.filter(it => {
    const k = titleKey(it.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── 같은 사건을 다룬 기사 묶기 ─────────────────────────────
   dedupe() 는 중복을 **버린다**. 그런데 여러 언론사가 같은 날 같은 사건을 쓴다는 것
   자체가 "이 회사에서 그 주에 가장 큰 일" 이라는 신호다. 그래서 버리는 대신 **센다**.

   ── 제목 앞부분 비교로는 안 묶인다 ──
   dedupe() 처럼 '앞 25자가 같으면 동일' 로 보면 언론사가 붙이는 말머리 때문에 갈라진다.
   실측: '삼성전자, HBM4 양산 시작' / '[단독] 삼성전자, HBM4 양산 시작한다' /
   '삼성전자 HBM4 양산 시작 — 종합' 이 전부 다른 묶음이 됐다. 말머리(단독·종합)와
   꼬리(한다)가 앞뒤로 붙어서 접두사가 어긋난다.

   그래서 **단어 집합이 얼마나 겹치는지**로 본다(자카드 0.6 이상이면 같은 사건).
   어순과 말머리에 흔들리지 않는다. 후보가 100건이라 전부 비교해도 부담이 없다.

   대표 기사는 묶음에서 제목이 가장 짧은 것을 쓴다. 긴 쪽은 대개 언론사가 덧붙인
   수식(부제·말머리)이 붙은 것이라 원 사건에서 멀어진다. */
const TITLE_MARKERS = /\[[^\]]*\]|【[^】]*】|<[^>]*>|\((단독|종합|속보|영상|사진|인터뷰)\)|(단독|종합|속보)\s*[:·-]/g;

function titleTokens(title) {
  return new Set(
    String(title || '')
      .replace(TITLE_MARKERS, ' ')
      .replace(/[^0-9A-Za-z가-힣]+/g, ' ')
      .split(' ')
      .map(w => w.replace(JOSA, ''))          // 조사를 떼야 '삼성전자가' == '삼성전자'
      .filter(w => w.length >= 2)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const SAME_EVENT = 0.6;

function cluster(items) {
  const groups = [];
  for (const it of items) {
    const toks = titleTokens(it.title);
    if (!toks.size) continue;

    const hit = groups.find(g => jaccard(g.tokens, toks) >= SAME_EVENT);
    if (!hit) {
      groups.push({ tokens: toks, item: { ...it, count: 1 } });
      continue;
    }
    hit.item.count += 1;
    // 날짜가 비어 있는 항목(웹 폴백)에는 다른 기사에서 얻은 날짜를 채워 준다
    if (!hit.item.date && it.date) hit.item.date = it.date;
    /* 대표를 짧은 제목으로 바꿀 때 요약·링크도 같이 옮긴다.
       따로 두면 A 기사 제목에 B 기사 링크가 붙어 엉뚱한 기사로 이동한다. */
    if (it.title.length < hit.item.title.length) {
      hit.item.title = it.title;
      hit.item.url = it.url;
      hit.item.summary = it.summary;
    }
  }
  return groups.map(g => g.item);
}

/* ── 목록용 중복 제거 ───────────────────────────────────────
   cluster() 와 목적이 다르다. cluster() 는 **세는** 쪽이라 "확실히 같은 기사"만 묶어야
   해서 문턱이 높다(0.6). 목록은 **보여주는** 쪽이라, 같은 사건이 두 번 뜨면 학생이
   쓸 소재가 5개인 줄 알고 열어봤다가 2개인 걸 알게 된다.

   ── 단어가 아니라 글자 2-gram 으로 잰다 ──
   단어 단위로는 한국어 복합어가 갈라져서 못 잡는다. 실측(삼성전자, 2026-08-09):
     '美 테일러팹 첫 인턴 뽑는다…가동 앞두고 인재 확보'
     '미국 테일러 파운드리 팹 첫 인턴십 모집'
   같은 사건인데 '테일러팹'≠'테일러'+'팹', '인턴'≠'인턴십' 이라 공통 단어가 **하나도**
   없다(자카드·포함률 모두 0). 띄어쓰기와 접미사가 매체마다 달라서 생기는 일이라
   단어를 아무리 정규화해도 남는다. 글자 2-gram 으로 재면 '테일', '일러', '인턴' 이
   겹쳐서 잡힌다.

   ── 신호를 둘 쓴다 (하나로는 안 갈린다) ──
   실측값을 실제 동작(먼저 남긴 대표와만 비교) 기준으로 재 보면 어느 한 지표로도
   같은 사건과 다른 사건이 안 갈린다:
     2-gram 자카드 → 같은 사건 최소 0.147 / 다른 사건 최대 0.136  (거의 붙어 있다)
     단어 포함률   → 같은 사건 최소 0.43  / 다른 사건 최대 0.33
   대신 **서로 다른 쌍에서 실패한다**. 2-gram 이 놓치는 '테일러팹 인턴'↔'테일러팹 인턴
   선발' 은 공통 단어가 3개(테일러팹·인턴·인재)라 단어 쪽이 잡고, 단어가 0인
   '테일러팹'↔'테일러 파운드리 팹' 은 2-gram 이 잡는다. 그래서 둘 중 하나만 넘으면
   같은 사건으로 본다. 각 문턱은 자기 지표의 실측 간격 사이에 둔다.

   포함률(교집합/작은 쪽)은 짧은 제목에서 값이 부풀지만, 2-gram 쪽이 함께 낮으면
   묶이지 않으므로 여기서는 안전하다.

   ── 회사명은 빼고 센다 ──
   relevant() 를 지난 기사는 전부 회사명을 갖고 있다. 그대로 두면 아무 관계 없는 두
   기사도 회사명 하나로 겹쳐 보인다.

   ── 어느 쪽으로 틀릴 것인가 ──
   덜 묶는 쪽으로 튼다. 잘못 묶으면 소재 하나가 화면에서 **사라지는데**, 학생은 그런
   기사가 있었다는 것조차 모른다. 중복이 한 건 남는 쪽이 낫고, 그건 '더 보기'가 받는다.

   ── 여기가 규칙의 한계다 (실측) ──
   제목만 보고 같은 사건인지 맞히는 데는 천장이 있다. 안 잡히는 두 부류를 확인했다:
     · 매체가 제목을 잘라 보내는 경우 — '…히트펌프 기술 ...' 처럼 뒷말이 날아가면
       2-gram 이 0.128 까지 떨어진다. 서로 다른 사건의 최대치(0.136)보다 낮아서,
       이걸 잡으려고 문턱을 내리면 남남을 묶기 시작한다.
     · 같은 사건을 전혀 다른 말로 쓰는 경우 — 카카오 임금협약(2026-08): '임금협약 최종
       타결'/'노사갈등 봉합'/'임금협상 타결' 은 2-gram 0.083~0.111, 단어 0.20~0.25 다.
   이 둘까지 잡으려면 제목이 아니라 본문을 봐야 하는데, 그건 기사 원문 수집이 필요하고
   지금 API 로는 못 한다. 그래서 **줄이되 0 이라고 말하지 않는다** — 화면에서도 '더 보기'로
   네이버 뉴스를 열어 둔다. */
const SAME_STORY_GRAM = 0.15;   // 글자 2-gram 자카드
const SAME_STORY_WORD = 0.40;   // 단어 포함률(교집합 / 작은 쪽)
/* 세 번째 신호 — 같은 고유명사를 공유하는 경우.
   실측(2026-08): 'KT 박윤영 대표, 데이터센터 방문' 과 '박윤영 KT 대표, 현장 경영 나서'
   는 같은 일정인데 위 두 지표로는 안 잡혔다(포함률 0.25, 2-gram 낮음). 사람 이름처럼
   **드문 말을 같이 쓰는지**를 보면 갈린다. 다만 이름 하나만으로는 부족하다 —
   포함률도 함께 넘어야 한다. 실측에서 이 둘을 같이 걸면:
     같은 사건 → 0.25 + 공통 특징어 있음 ('박윤영', '노사갈등')
     다른 사건 → 0.25 이지만 공통 특징어 없음 / 특징어는 있지만 포함률 0.17
   로 정확히 갈렸다. 특징어는 3글자 이상만 본다(2글자는 '대표·기술'처럼 흔하다). */
const SAME_STORY_NAME_WORD = 0.25;
const NAME_MIN_LEN = 3;
/* 언론사가 붙이는 말머리. 서로 다른 두 '단독' 기사가 이 말로 겹쳐 보이지 않게 뺀다. */
const TITLE_NOISE = /\[[^\]]*\]|【[^】]*】|<[^>]*>|단독|종합|속보|영상|사진|인터뷰/g;

function bigrams(title, company) {
  const s = String(title || '')
    .replace(TITLE_NOISE, ' ')
    .split(company || ' ').join(' ')       // 회사명 제거(정규식 특수문자 안전)
    .replace(/[^0-9A-Za-z가-힣]+/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function jaccardSet(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function containment(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

function dedupeStories(items, company) {
  const key = String(company || '').replace(/\s+/g, '');
  const drop = new Set(tokenize(key));
  const kept = [];
  for (const it of items) {
    const grams = bigrams(it.title, key);
    const words = new Set(tokenize(String(it.title || '').replace(TITLE_NOISE, ' '))
      .filter(w => !drop.has(w)));
    if (!grams.size) continue;
    const dup = kept.some(k => {
      if (jaccardSet(k.grams, grams) >= SAME_STORY_GRAM) return true;
      const near = containment(k.words, words);
      if (near >= SAME_STORY_WORD) return true;
      /* 고유명사를 공유하면서 어느 정도 겹치기도 하면 같은 사건으로 본다 */
      if (near < SAME_STORY_NAME_WORD) return false;
      return [...k.words].some(w => w.length >= NAME_MIN_LEN && words.has(w));
    });
    if (dup) continue;
    kept.push({ grams, words, item: it });
  }
  return kept.map(k => k.item);
}

/* 회사명이 제목·요약 어디에도 없으면 다른 회사 기사다. 지원동기 근거로 쓰면
   면접에서 그대로 들통나므로 걸러낸다. */
function relevant(items, company) {
  const key = company.replace(/\s+/g, '');
  return items.filter(it => (it.title + it.summary).replace(/\s+/g, '').includes(key));
}

/* ── 회사 이야기가 아닌 기사 걸러내기 ───────────────────────
   회사명이 들어 있어도 회사 이야기가 아닌 기사가 많다. 실측(2026-08, 'KT'):
   5건 중 3건이 프로야구 KT위즈 기사였고, 사용자가 본 화면에는 배우 결혼 기사가
   섞여 있었다(배우자 이름이 '케이티'). 그대로 두면 학생이 "이 회사는 요즘 뭘 하나"를
   야구 순위로 읽는다.

   ── AI 를 쓰지 않는다 ──
   기사마다 모델에 물으면 같은 회사를 두 번 검색했을 때 목록이 달라진다. 자소서
   근거는 재현되어야 하고(같은 회사 = 같은 사실), 무엇이 왜 빠졌는지도 설명할 수
   있어야 한다. 그래서 단어 목록으로 판단한다 — 이 파일이 키워드를 AI 로 안 뽑는
   것과 같은 이유다.

   ── 판정 규칙: 신호를 '세어서' 판단한다 ──
   처음에는 '스포츠 단어가 하나라도 있고 사업 단어가 없으면 뺀다'로 했는데 그대로
   새어 나왔다. 야구 기사에도 사업 단어가 우연히 하나쯤 들어가기 때문이다 —
   실측: '선두 KT, 폭염 방학도 바쁘다' 는 본문의 "순위 경쟁"의 **경쟁** 하나로 살아남았다.
   그래서 서로 다른 스포츠·연예 단어가 **몇 종류** 나왔는지를 센다:
     · 2종류 이상  → 뺀다. 우연히 겹칠 수 있는 수가 아니다.
     · 1종류       → 사업 단어가 같이 있어야 남긴다.
     · 0종류       → 그대로 둔다.
   애매한 쪽(0~1종류)은 남긴다 — 근거가 될 기사를 지우는 쪽이 잡음 한 건보다 나쁘다. */
const OFF_TOPIC = new RegExp([
  /* 프로스포츠 — 구단 이름이 회사명 그대로인 곳이 많아(KT위즈·LG트윈스·삼성라이온즈)
     이 걸러내기가 없으면 통신·전자 회사 뉴스가 야구 순위표가 된다. */
  '위즈', '이글스', '트윈스', '베어스', '라이온즈', '자이언츠', '다이노스', '히어로즈', '랜더스',
  '구단', '선두', '연승', '연패', '투수', '타자', '타선', '타율', '홈런', '득점', '실책',
  '감독', '코치진', '선수', '선발', '마운드', '불펜', '이닝', '수비', '주루', '타점',
  '리그', '시즌', '플레이오프', '포스트시즌', 'KBO', '프로야구', '축구단', '농구단', '배구단',
  '승점', '순위표', '홈경기', '원정', 'FA', '용병', '외국인\\s*투수', '스프링캠프',
  /* 연예 */
  '배우', '아이돌', '가수', '열애', '결혼식', '화보', '셀럽', '드라마', '예능', '비주얼',
  '팬미팅', '컴백', '앨범', '출연료', '스타일링', '몸매', '나들이', '근황',
].join('|'), 'g');

/* 사업 신호. '경쟁·고객·시장' 처럼 스포츠 기사에도 흔히 나오는 말은 뺐다 —
   그런 말이 판정을 뒤집으면 걸러내기가 무력해진다. */
const BUSINESS = new RegExp([
  '매출', '영업이익', '순이익', '실적', '적자', '흑자', '분기실적',
  '계약', '수주', '공급', '납품', '출시', '론칭', '특허', '연구개발',
  '투자', '인수', '합병', '지분', '상장', '공시', '주가', '배당',
  '채용', '공채', '신입', '임원', '선임', '취임', '조직\\s*개편',
  '사업', '전략', '진출', '증설', '공장', '설비', '생산', '점유율',
  '제휴', 'MOU', '플랫폼', '솔루션', '클라우드', '반도체', '요금제', '가입자',
].join('|'), 'g');

const countKinds = (text, re) => {
  re.lastIndex = 0;
  return new Set(text.match(re) || []).size;
};

function onTopic(items) {
  return items.filter(it => {
    const text = `${it.title} ${it.summary || ''}`;
    const off = countKinds(text, OFF_TOPIC);
    if (off === 0) return true;
    if (off >= 2) return false;
    return countKinds(text, BUSINESS) > 0;
  });
}

/* ── 기사에서 자소서에 쓸 키워드 뽑기 ───────────────────────
   AI 로 뽑지 않는다. 8B 에게 키워드를 시키면 기사에 없는 말을 만들어내는데,
   자소서에 지어낸 표현을 쓰면 면접에서 그대로 무너진다. 그래서 **기사 원문에 실제로
   있는 단어만** 세고, 각 키워드가 몇 번째 기사에서 나왔는지 추적 가능하게 남긴다
   (공고 근거 문장을 그대로 인용하는 것과 같은 원칙).

   형태소 분석기를 붙이지 않고 어절 단위로 센다. 대신 조사를 떼고, 뉴스 관용어와
   너무 흔한 말을 걸러낸다. 정밀하진 않지만 **틀린 걸 지어내지는 않는다**. */
const NEWS_STOP = new Set([
  '기자', '뉴스', '속보', '단독', '종합', '사진', '영상', '오늘', '내일', '올해', '작년',
  '이번', '지난', '관련', '위해', '대한', '통해', '따라', '밝혔다', '전했다', '말했다',
  '예정', '계획', '추진', '발표', '진행', '개최', '실시', '경우', '가운데', '대해',
  '기업', '회사', '그룹', '주식회사', '대표', '사장', '회장', '직원', '고객', '시장',
  '사업', '서비스', '제품', '기술', '투자', '매출', '실적', '전년', '동기', '억원', '조원',
  /* 웹 폴백에서 주소·페이지 이름이 새어 들어온다. AI·ESG·IT 같은 값어치 있는 약어는
     남겨야 하므로 영문을 통째로 버리지 않고 이 목록으로만 걸러낸다. */
  'www', 'http', 'https', 'com', 'net', 'org', 'kr', 'view', 'list', 'index', 'html',
  'about', 'home', 'page', 'detail', 'board', 'news', 'search', 'stock', 'code',
  '보도자료', '목표가', '기존', '위한', '전개', '기준', '이상', '이하', '최근', '현재',
]);

/* 조사를 떼어낸다. 3글자 이상일 때만 — "우리" 같은 짧은 말이 "우"가 되는 걸 막는다. */
const JOSA = /(으로써|으로서|이라고|라고|에서의|에게서|으로|에서|에게|와의|과의|보다|처럼|까지|부터|마다|이나|이란|라는|이며|하며|하고|한다|했다|의|를|을|는|은|이|가|와|과|도|만|에|로)$/;

function tokenize(text) {
  return decodeEntities(String(text))
    .split(/[^가-힣A-Za-z0-9]+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => (t.length >= 3 && /[가-힣]$/.test(t) ? t.replace(JOSA, '') : t))
    .filter(t => t.length >= 2)
    /* 숫자로 시작하는 말(77만원·2분기·21일)은 그 기사의 수치일 뿐 회사의 화두가 아니다. */
    .filter(t => !/^\d/.test(t))
    /* '낮췄다·밝혔다·있다' 같은 서술어. 명사가 '다'로 끝나는 경우는 드물어 이 정도로 충분하다. */
    .filter(t => !/다$/.test(t));
}

function newsKeywords(items, company) {
  const companyKey = company.replace(/\s+/g, '');

  /* 기사 주소(호스트)에 등장하는 말은 그 회사·언론사 이름이다.
     한글 회사명만 걸러내면 'Aju'·'autoever' 같은 영문 사명이 키워드로 남는다(실측). */
  const hostWords = new Set();
  for (const it of items) {
    const host = (String(it.url || '').match(/^https?:\/\/([^/]+)/) || [])[1] || '';
    for (const w of host.split(/[^A-Za-z0-9]+/)) {
      if (w.length >= 2) hostWords.add(w.toLowerCase());
    }
  }

  const hits = new Map();                   // term → Set(기사 index)

  items.forEach((it, i) => {
    const seen = new Set();                 // 한 기사에서 여러 번 나와도 1건
    for (const raw of tokenize(stripUrls(`${it.title} ${it.summary}`))) {
      const t = raw.trim();
      if (t.length < 2 || seen.has(t)) continue;
      if (NEWS_STOP.has(t)) continue;
      if (companyKey.includes(t) || t.includes(companyKey)) continue;   // 회사명 자체는 키워드가 아니다
      if (hostWords.has(t.toLowerCase())) continue;                     // 사이트·사명 영문 표기
      seen.add(t);
      if (!hits.has(t)) hits.set(t, new Set());
      hits.get(t).add(i);
    }
  });

  return [...hits.entries()]
    /* 기사 2건 이상에서 나온 말만 남긴다. 한 기사에만 나온 단어는 그 회사의
       '요즘 화두'라고 보기 어렵고, 대부분 그냥 그 기사의 문장 부스러기다. */
    .filter(([, arts]) => arts.size >= 2)
    .map(([term, arts]) => ({ term, count: arts.size, articles: [...arts] }))
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length)
    .slice(0, 12);
}

/* ── 3개월 주요 기사 ─────────────────────────────────────────
   최근 3개월을 5구간(구간당 약 18일 ≈ 2~3주)으로 끊어, 구간마다 기사 한 건씩
   최대 5건을 고른다(사용자 지시 2026-08-25). 예전에는 최근 5주(≈1개월)만 봐서
   같은 시기 기사 5건이 몰렸다 — 3개월로 넓혀 흐름을 보여준다.

   왜 '많이 나온 기사' 인가 — 지원동기에 쓸 소재는 '최신 기사' 가 아니라 '그 회사에
   실제로 일어난 큰 일' 이다. 여러 언론사가 같이 다뤘다는 게 그 대리 지표다.
   한 구간에 한 건으로 묶으면 큰 사건 하나에 기사가 몰려도 다른 구간이 밀리지 않아서,
   3개월 흐름(무엇을 하다가 무엇으로 옮겨갔는지)이 보인다.

   직무트렌드 가산 — 같은 구간에 후보가 여럿이면 채용·조직·기술처럼 취업 준비와
   맞닿은 기사를 올린다. 회사 홍보성 기사(신제품 출시, 사회공헌)보다 자소서에
   쓸 거리가 많다. 단어를 지어내지 않고 제목·요약에 실제로 있는 말만 본다. */
const PERIOD_DAYS = 90;                       // 최근 3개월
const PICKS = 5;                              // 5구간 = 대표 기사 5건
const BUCKET_DAYS = PERIOD_DAYS / PICKS;      // 18일 ≈ 2~3주 간격
const DAY = 24 * 60 * 60 * 1000;

/* ── 5주치를 실제로 받아오는 방법 ───────────────────────────
   회사명만으로 검색하면 5주를 못 채운다. 실측(삼성전자): display=100 을 date 순으로
   start=701 까지 넘겨도 전부 **같은 날** 기사였다. 큰 회사는 하루 기사량이 수백 건이라
   최신순으로는 어제조차 닿지 않고, start 상한(1000)을 다 써도 마찬가지다.

   대신 **검색어를 좁힌다**. '삼성전자 조직 인사' 처럼 주제를 붙이면 모집단이 줄어
   같은 100건이 5주에 걸쳐 퍼진다. 실측으로 삼성전자 기준:
     '삼성전자'          → 0주차만          (7/26~7/28)
     '삼성전자 채용'      → 0·1·2주차        (7/13~7/28)
     '삼성전자 조직 인사'  → 0~4주차 전부     (6/28~7/27)
     '삼성전자 투자 신사업' → 0~4주차 전부     (3/19~7/28)

   주제를 아무거나 고르지 않고 **취업 준비와 맞닿은 것**으로 골랐다. 신제품 출시나
   사회공헌보다 채용·조직·투자 기사가 자소서에 쓸 거리가 많다. 즉 이 방식은
   5주를 채우는 수단이면서 '직무트렌드 기사 모으기' 그 자체다. */
const TREND_QUERIES = ['채용', '조직 인사', '투자 신사업', '실적'];

const TREND_TERMS = [
  '채용', '공채', '신입', '인재', '조직', '개편', '인사', '연봉', '복지', '근무',
  '직무', '역량', '교육', '연수', '인턴', '워라밸', '재택', '사옥', '문화',
  '투자', '인수', '합병', '진출', '신사업', '전략', '조직문화', '리더십',
  'AI', 'DX', '디지털전환', '전환', '연구개발', 'R&D', '특허', '수주', '계약',
];

function trendScore(item) {
  const text = `${item.title} ${item.summary || ''}`;
  return TREND_TERMS.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
}

/* 기사 날짜 → 3개월을 18일씩 끊은 몇 번째 구간인가(0 = 가장 최근 구간).
   3개월(=PICKS 구간) 밖이면 null. */
function bucketIndex(dateStr, now) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  const diff = now - t;
  if (diff < 0) return 0;                       // 발행일이 미래로 찍힌 기사 — 가장 최근 구간으로 본다
  const b = Math.floor(diff / (BUCKET_DAYS * DAY));
  return b < PICKS ? b : null;
}

/* 기사 날짜 → '최근' / '약 N주 전'. 구간 번호가 아니라 실제 발행일에서 계산한다 —
   화면에 나가는 값이라 지어내지 않고 사실(발행일)에 맞춘다. */
function weeksAgoLabel(dateStr, now) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const w = Math.max(0, Math.round((now - t) / (7 * DAY)));
  return w === 0 ? '최근' : `약 ${w}주 전`;
}

/* 주별 대표 기사 목록. 날짜가 없는 항목(웹 폴백)은 주에 넣을 수 없으므로 제외한다.

   ── 제목에 회사가 있는 기사를 우선한다 ──
   relevant() 는 제목·요약 어디든 회사명이 있으면 통과시킨다. 목록으로 보여줄 때는
   그래도 괜찮았는데, 주간 대표로 한 건만 뽑으니 **스쳐 지나간 언급**이 헤드라인 자리를
   차지했다. 실측: '아주산업' 이번 주 대표가 "박춘원 전북은행장 무거운 발걸음 '왜'" 였다
   (본문에 회사명이 한 번 나온 남의 기사).
   제목에 회사명이 있으면 그 기사는 그 회사를 **다룬** 기사다. 그런 후보가 한 건이라도
   있으면 그 안에서만 고르고, 하나도 없을 때만 나머지로 내려간다. */
/* ── 최신 뉴스 (사용자 지적 2026-09-08) ──────────────────────────────────────
   "하루 한 번 API 를 가져오는데, 가져온 시간부터 1주일 내 뉴스도 필요하다."
   주간 대표(weeklyPicks)는 3개월을 18일씩 끊어 **한 구간에 한 건씩**만 고른다.
   그래서 이번 주에 기사가 열 건 나와도 화면에는 한 건만 뜬다 — 지원 직전에
   "요즘 무슨 일이 있나"를 보려는 사람에게는 그게 없는 것과 같다.

   기준 시각은 **호출 시각**이다. 캐시를 두지 않으므로 '가져온 시간'이 곧 지금이고,
   나중에 하루 한 번 받아 두게 바뀌어도 now 를 넘기면 그 시각이 기준이 된다.

   ── 표본은 관련도 검색 결과 그대로다 (사용자 지시 2026-09-08) ──────────────
   최신순(sort=date)으로 따로 부르지 않는다. 그러면 회사가 스치듯 언급된 기사가
   딸려 온다(ENDPOINTS 주석의 실측, 그리고 사용자 확인: "관련 없는 기사가 많더라").
   여기 들어오는 clustered 는 회사명 검색 + 주제 검색 4가지의 관련도 상위 결과라
   수백 건이다. **그 안에서 최근 것을 고른다** — 최신을 얻자고 관련도를 버리지 않는다.

   날짜가 없는 기사(웹 폴백)는 넣을 수 없다 — 1주일 안인지 판정할 수가 없다.
   여기서 억지로 넣으면 '최신'이라고 적힌 자리에 몇 년 전 기사가 앉는다. */
const RECENT_DAYS = 7;

/* ── 관련도순 목록 (사용자 지시 2026-09-09) ──────────────────────────────────
   화면이 '관련도순 / 최신순' 토글로 갈리면서, 관련도 쪽도 최신 쪽과 **같은 값**을 달고
   있어야 한다 — 언론사 수(화제성)와 '간접 언급' 표시가 한쪽에만 있으면 탭을 바꿀 때마다
   정보가 들쭉날쭉해진다.
   순서는 손대지 않는다. cluster() 가 입력 순서를 지키고 pool 은 관련도(sim) 순으로
   받아온 것이라, **그대로가 곧 관련도순**이다. 여기서 다시 정렬하면 그 순서를 잃는다. */
function topPicks(clustered, company = '') {
  const key = String(company).replace(/\s+/g, '');
  const inTitle = it => !!key && String(it.title).replace(/\s+/g, '').includes(key);

  return dedupeStories(clustered, company)
    .slice(0, MAX_ITEMS)
    .map(it => ({ ...it, outlets: it.count, looseMatch: !inTitle(it) }));
}

function recentPicks(clustered, now = Date.now(), company = '', days = RECENT_DAYS) {
  const key = String(company).replace(/\s+/g, '');
  const inTitle = it => !!key && String(it.title).replace(/\s+/g, '').includes(key);
  const from = now - days * DAY;

  const fresh = clustered.filter(it => {
    if (!it.date) return false;
    const t = Date.parse(it.date);
    return !Number.isNaN(t) && t >= from;
  });
  /* 주간 대표와 같은 규칙 — 제목에 회사가 있는 기사가 하나라도 있으면 그 안에서만
     고른다. 스쳐 지나간 언급이 '최신 뉴스' 머리에 앉는 것을 막는다. */
  const titled = fresh.filter(inTitle);
  const pool = titled.length ? titled : fresh;

  const ordered = pool
    /* 최신순이 먼저다 — 이 목록의 존재 이유가 '최근'이다. 같은 날이면 여러 언론사가
       함께 다룬 기사를, 그다음 취업과 맞닿은 기사를 올린다. */
    .sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      b.count - a.count ||
      trendScore(b) - trendScore(a)
    );

  /* ── 같은 사건을 한 번만 (실측 2026-09-08) ────────────────────────────────
     cluster() 만으로는 부족하다. 실측('아주산업'): 최신 5건이 전부 '아주그룹 AI 해커톤'
     한 사건이었다 — 말머리와 어미가 조금씩 달라 cluster 가 다섯으로 갈라 놨다.
     화면에는 5건이 뜨는데 학생이 쓸 소재는 **하나뿐**이다. 목록(items)에는 이미
     dedupeStories 를 걸어 두고 여기만 빠뜨렸다.
     최신순으로 세운 뒤에 거르므로, 같은 사건이면 **가장 최근 기사**가 남는다. */
  return dedupeStories(ordered, company)
    .slice(0, MAX_ITEMS)
    .map(it => ({
      ...it,
      outlets: it.count,
      daysAgo: Math.max(0, Math.round((now - Date.parse(it.date)) / DAY)),
      looseMatch: !inTitle(it),
    }));
}

function weeklyPicks(clustered, now = Date.now(), company = '') {
  const key = String(company).replace(/\s+/g, '');
  const inTitle = it => !!key && String(it.title).replace(/\s+/g, '').includes(key);

  const buckets = new Map();
  for (const it of clustered) {
    const b = bucketIndex(it.date, now);
    if (b == null) continue;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(it);
  }

  const picks = [];
  for (let b = 0; b < PICKS; b++) {
    const all = buckets.get(b);
    if (!all || !all.length) continue;

    const titled = all.filter(inTitle);
    const cands = titled.length ? titled : all;

    /* 언론사 중복 수 → 직무트렌드 관련도 → 최신순.
       중복 수가 1로 같은 구간이 많은데, 그때 트렌드 점수가 실제 순위를 가른다. */
    cands.sort((a, b2) =>
      b2.count - a.count ||
      trendScore(b2) - trendScore(a) ||
      String(b2.date).localeCompare(String(a.date))
    );
    const top = cands[0];
    picks.push({
      ...top,
      week: b,
      weekLabel: weeksAgoLabel(top.date, now),   // '최근' / '약 N주 전' — 실제 발행일 기준
      outlets: top.count,          // 같은 사건을 다룬 기사 수 = 그 구간의 화제성
      trendHit: TREND_TERMS.filter(t => `${top.title} ${top.summary || ''}`.includes(t)).slice(0, 4),
      alsoInWeek: all.length - 1,
      /* 제목에 회사가 없으면 '스쳐 지나간 언급'일 수 있다. 화면에서 조심하라고 알린다. */
      looseMatch: !inTitle(top),
    });
  }
  return picks;
}

async function companyNews(companyName) {
  const company = String(companyName || '').trim();
  if (company.length < 2) {
    const err = new Error('회사명을 2글자 이상 입력해 주세요.');
    err.status = 400;
    throw err;
  }

  const p = provider();
  let used = p;
  let raw = p === 'web' ? await fromWeb(company) : await fromNaver(company, p);
  let pool = onTopic(relevant(raw, company));
  /* dedupe() 로는 부족하다 — 앞 25자 비교라 말머리·꼬리가 다른 같은 사건이 갈라진다.
     실측(삼성전자): 5건 중 3건이 '영하 30도 히트펌프', 2건이 '테일러팹 인턴' 이었다.
     화면에는 5건이 뜨는데 실제 사건은 2개라, 학생이 쓸 소재는 두 개뿐인 셈이다.
     dedupeStories() 로 **서로 다른 사건 5개**를 내려보낸다. 화면 쪽에서 한 번 더 거르지
     않는다 — 같은 규칙이 두 곳에 있으면 어긋난다. */
  /* cluster() 를 거치면 같은 사건의 언론사 수(count)가 붙는다 — 화면의 '언론사 N곳'
     배지가 관련도 탭에서도 나오려면 이 경로여야 한다. 순서는 관련도 그대로다. */
  let items = topPicks(cluster(pool), company);

  /* 주간 정리를 만들려면 5주치 표본이 필요하다. 회사명 단독 검색으로는 안 되므로
     주제를 붙인 검색을 함께 돌려 표본을 넓힌다(TREND_QUERIES 주석 참고).
     이 검색들은 **표본을 넓히는 용도**라, 실패해도 위 items 는 그대로 간다. */
  if (p !== 'web') {
    const extra = await Promise.all(TREND_QUERIES.map(async topic => {
      try {
        return onTopic(relevant(await fromNaver(`${company} ${topic}`, p), company));
      } catch {
        return [];                 // 한 주제가 실패해도 나머지로 계속한다
      }
    }));
    pool = pool.concat(...extra);
  }

  /* ── 최신 뉴스도 이 표본에서 뽑는다 (사용자 지시 2026-09-08) ──────────────────
     한때 최신순(sort=date)으로 따로 불러서 표본에 더했다. **되돌렸다.**
     date 순은 회사가 스치듯 언급된 기사를 앞으로 끌어온다(위 ENDPOINTS 주석의
     현대오토에버 실측). 그 기사들이 '최신 뉴스' 칸에 앉으면, 이 화면이 원래 막으려던
     것을 최신이라는 이름으로 다시 들여놓는 셈이다.
     **관련도 결과 안에서 최신을 고른다** — 위 pool 은 회사명 검색 + 주제 검색
     4가지라 관련도 상위 기사가 수백 건 모여 있다. 그중 1주일 안을 뽑으면 된다. */

  /* 네이버가 회사와 무관한 기사만 준 경우 웹 검색으로 한 번 더 시도한다.
     실측: '아주산업' 처럼 기사가 적은 회사는 네이버가 검색어를 '아주'+'산업' 으로 쪼개
     우리銀·산업부 기사를 돌려준다(total 39만 건). relevant() 가 전부 걸러내 0건이 되는데,
     같은 회사를 웹에서 찾으면 '특수콘크리트 기술협력' 같은 진짜 기사가 나온다.
     중견·중소기업 지원자에게는 이 경로가 사실상 유일한 소재원이라 그냥 비워두지 않는다. */
  if (p !== 'web' && !items.length) {
    try {
      const webRaw = await fromWeb(company);
      const webPool = onTopic(relevant(webRaw, company));
      const webItems = topPicks(cluster(webPool), company);
      if (webItems.length) { items = webItems; pool = webPool; used = 'web-fallback'; }
    } catch { /* 폴백까지 실패하면 그냥 0건으로 둔다 — 화면에 안내가 나간다 */ }
  }

  /* 주간 대표 기사 — 날짜가 있는 경로(네이버)에서만 만들어진다.
     웹 폴백은 날짜를 못 주므로 빈 배열이 되고, 화면은 기존 목록만 보여준다. */
  const now = Date.now();
  const clustered = cluster(pool);
  const weekly = weeklyPicks(clustered, now, company);
  /* 최신 뉴스 — 지금부터 1주일 안. 주간 대표와 같은 표본에서 뽑되 기준이 다르다
     (저쪽은 '구간마다 한 건', 이쪽은 '최근 것부터'). 겹치는 기사가 있어도 그대로 둔다 —
     같은 기사가 '이번 주 최신'이면서 '이번 구간 대표'인 것은 모순이 아니다. */
  const latest = recentPicks(clustered, now, company);
  const keywords = newsKeywords(items, company);
  /* 실제로 어느 경로로 가져왔는지 — 시도 끝에 정해지므로 호출 뒤에 읽는다. */
  const finalProvider = used === 'web-fallback' ? 'web-fallback'
    : (used === 'web' ? 'web' : (_resolvedEndpoint || used));

  return {
    company,
    provider: finalProvider,
    items,
    /* ── 최신 / 주요를 나눠 내려보낸다 (사용자 지적 2026-09-08) ──────────────
       items 는 관련도 순이라 '주요 뉴스'이고, latest 는 1주일 안의 '최신 뉴스'다.
       한 목록으로 합치지 않는 이유는 정렬 기준이 다르기 때문이다 — 섞으면 화면에서
       어느 기준으로 줄 세운 것인지 알 수 없고, 최신 기사가 관련도에 밀려 사라진다. */
    latest,
    latestNote: latest.length
      ? `관련도가 높은 기사 중에서 ${RECENT_DAYS}일 안에 나온 것만 골랐어요. `
        + '지원 직전이라면 여기부터 보세요 — 면접에서 "최근 소식 아세요?" 를 물으면 이 범위에서 나옵니다.'
      : (finalProvider.startsWith('web')
        /* 화면이 '관련도순 / 최신순' 토글이라 '아래'라는 자리 안내는 더 이상 맞지 않는다
           (2026-09-09). 최신순 탭은 이때 눌리지 않게 막히므로 이 문구는 안내로만 남는다. */
        ? '웹 검색 결과에는 발행일이 없어 최신 기사를 가릴 수 없었어요. 관련도순으로 확인해 주세요.'
        : `최근 ${RECENT_DAYS}일 안에는 이 회사 기사가 없었어요. 관련도순으로 보세요.`),
    recentDays: RECENT_DAYS,
    weekly,
    weeklyNote: weekly.length
      ? '최근 3개월을 2~3주 간격으로 끊어, 그 구간에 여러 언론사가 함께 다룬 기사를 한 건씩 골랐어요. '
        + '기사가 몰린 시기 = 그 회사에 큰 일이 있었던 때입니다. 흐름을 보고 **한 건만** 골라 쓰세요.'
      : (finalProvider.startsWith('web')
          ? '웹 검색 결과에는 발행일이 없어 시기별 정리를 만들지 못했어요. 아래 목록에서 직접 골라 주세요.'
          : '최근 3개월 안에 발행된 기사를 찾지 못했어요.'),
    keywords,
    /* 키워드를 왜 쓰라는지까지 말해줘야 한다. 단어만 던지면 학생이 자소서에
       그냥 박아 넣고, 맥락 없는 단어는 오히려 감점이 된다. */
    keywordNote: keywords.length
      ? '기사 2건 이상에서 반복된 표현이에요. 이 회사가 요즘 무엇을 말하고 있는지를 보여줍니다. '
        + '단어만 옮겨 적지 말고, 그 표현이 나온 기사를 읽고 **내 경험과 연결되는 것 하나만** 골라 쓰세요.'
      : '',
    /* 화면에 그대로 띄우는 안내. 뉴스는 '읽고 판단할 재료'이지 '자소서 문장'이 아니다. */
    disclaimer: finalProvider === 'web'
      ? '네이버 뉴스 API 키가 없어 웹 검색 결과로 대신했어요. 날짜·언론사가 정확하지 않을 수 있으니 반드시 원문을 확인하세요.'
      : finalProvider === 'web-fallback'
        ? '네이버 뉴스에서는 이 회사 기사를 찾지 못해 웹 검색 결과로 대신했어요. '
          + '날짜가 없고 회사 홈페이지가 섞일 수 있으니 반드시 원문을 확인하세요.'
        : '기사 내용을 요약하거나 각색하지 않았습니다. 반드시 원문을 읽고 사실을 확인한 뒤 쓰세요.',
  };
}

/* ── 지원동기 작성 지침 ─────────────────────────────────────
   기사마다 다른 조언을 AI 로 만들지 않는다. 지원동기 문항의 구조는 회사가 달라도
   같기 때문에, 검증된 골격을 그대로 준다(jd-competency.js 의 frame 과 같은 방식). */
const MOTIVE_GUIDE = {
  frame: '① 기사에서 확인한 이 회사의 최근 움직임(사업·기술·시장) 한 가지 → '
       + '② 그것이 왜 어려운 일인지 또는 무엇이 걸려 있는지 → '
       + '③ 내 경험 중 그 일과 맞닿는 지점 → '
       + '④ 입사 후 그 일의 어느 부분을 맡고 싶은지 → '
       + '⑤ 그렇게 판단한 근거(원문에서 읽은 사실)',
  tips: [
    '기사 한 건만 고르세요. 여러 건을 나열하면 "찾아봤다"는 인상만 남습니다.',
    '회사 홈페이지에 있는 이야기(연혁·비전)는 쓰지 마세요. 누구나 쓸 수 있어 변별력이 없습니다.',
    '기사에 없는 내용을 추측해서 덧붙이지 마세요. 면접에서 그대로 물어봅니다.',
  ],
  avoid: [
    '"성장하는 기업이라 지원했습니다" — 어느 회사에나 붙는 문장입니다.',
    '"비전에 깊이 공감했습니다" — 무엇에 어떻게 공감했는지가 없으면 빈 문장입니다.',
    '기사 제목을 그대로 옮겨 적고 "인상 깊었습니다"로 잇는 구성.',
  ],
  followup: '그 사업이 지금 겪고 있는 어려움은 뭐라고 생각하나요?',
};

module.exports = {
  companyNews, provider, newsKeywords, tokenize, MOTIVE_GUIDE, MAX_ITEMS,
  // 테스트용 — 주간 묶기·목록 중복 제거는 외부 호출 없이 검증할 수 있어야 한다
  cluster, weeklyPicks, recentPicks, topPicks, RECENT_DAYS, bucketIndex, trendScore, PICKS, onTopic,
  dedupeStories, SAME_STORY_GRAM, SAME_STORY_WORD,
};
