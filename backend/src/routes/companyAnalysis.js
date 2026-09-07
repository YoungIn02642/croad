/* GET /api/company/analysis?name=<회사명>
   기업분석 5단계 — 자소서 '지원동기' 문항의 근거를 한 번에 모아 준다.

   ── 왜 한 라우트로 묶는가 ──
   사업구조·재무·경쟁사(DART)와 최근이슈(뉴스)는 출처가 다르지만 학생이 쓰는
   문항은 하나다("왜 우리 회사인가"). 화면에서 두 번 부르게 하면 하나가 느릴 때
   반쪽만 그려지고, 무엇이 빠졌는지도 알 수 없다. 여기서 묶어 **단계마다 채워졌는지
   여부(status)를 명시**해 내려보낸다 — 빈칸을 숨기지 않는 것이 이 기능의 요점이다.

   ── 하나가 실패해도 나머지는 준다 ──
   DART 키가 없으면 재무·경쟁사만 빠지고, 뉴스가 실패하면 최근이슈만 빠진다.
   전부 실패했을 때만 502 다. 자소서는 근거가 하나라도 있으면 쓸 수 있다.

   ── 점수를 만들지 않는다 ──
   작업정리 11-1 의 원칙 그대로다. 뉴스와 재무를 하나의 '기업 매력도' 숫자로
   버무리지 않는다. 단위도 의미도 다른 데이터라 가중치를 정당화할 수 없고,
   결국 아무도 검증 못 하는 숫자가 된다. 각 칸은 자기 출처를 달고 따로 선다. */
const express = require('express');
const NEWS = require('../news');
const DART = require('../dart');
const REPORT = require('../dart-report');
const GUIDE = require('../cover-guide');
const SARAMIN = require('../saramin-jobs');
const WORKNET = require('../worknet-jobs');
const ALIO = require('../alio-jobs');
const WORK24 = require('../work24-jobs-cache');
const LOGO = require('../company-logo');
const SECTORS = require('../company-sectors');
const JOB = require('../job-industry');
const CAREER = require('../career-pages');
const KSIC = require('../ksic');

const router = express.Router();

/* 억 단위로 접는다. 원 단위 12자리 숫자는 화면에서 읽히지 않고, 자소서에
   쓸 때도 "매출 3조 1,200억" 처럼 말하지 "3120000000000원" 이라고 쓰지 않는다. */
function readableAmount(won) {
  if (won === null || won === undefined) return null;
  const abs = Math.abs(won);
  if (abs >= 1e12) return `${(won / 1e12).toFixed(1)}조원`;
  if (abs >= 1e8) return `${Math.round(won / 1e8).toLocaleString()}억원`;
  return `${won.toLocaleString()}원`;
}

/* 3년 추이를 '늘었다/줄었다'로 요약한다. 자소서에서 쓸 수 있는 말은 액수 자체보다
   방향이다("역성장 구간에서 무엇을 하려는 회사인가"가 지원동기의 재료가 된다).
   전년 대비만 본다 — 3년 평균 성장률은 한 해 적자로 뒤집혀 오해를 만든다. */
function trend(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const [now, prev] = series;
  if (now?.amount == null || prev?.amount == null || prev.amount === 0) return null;
  const pct = ((now.amount - prev.amount) / Math.abs(prev.amount)) * 100;
  return {
    pct: Math.round(pct * 10) / 10,
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    from: prev.year, to: now.year,
  };
}

function summarizeFinancials(fin) {
  if (!fin) return null;
  const out = { baseYear: fin.baseYear, fsDiv: fin.fsDiv, accounts: {} };
  for (const [key, series] of Object.entries(fin.series || {})) {
    out.accounts[key] = {
      series: series.map(s => ({ ...s, readable: readableAmount(s.amount) })),
      trend: trend(series),
    };
  }
  return out;
}

const LABELS = { revenue: '매출액', operating: '영업이익', net: '당기순이익' };

/* ── 5단계 틀 ────────────────────────────────────────────────
   단계마다 '무엇을 확인하는 칸인지'와 '지금 채워졌는지'를 같이 준다.
   비어 있는 칸은 숨기지 않고 "직접 확인하라"고 남긴다 — careerly 가 못 채우는
   칸을 안 보여주면, 학생은 그 칸이 필요 없다고 오해한다. */
function buildSteps({ news, dart, jobs }) {
  const fin = dart?.financials;
  const prof = dart?.profile;

  return [
    /* ── '사업 구조' 를 '개요' 로 바꾼 이유 (2026-08 조사) ────────────────
       원래 이 칸은 "무엇을 팔아 돈을 버는가"(부문별 매출 비중)를 보여주려 했다.
       공개 API 로 그 값을 받을 수 있는지 확인했고, **없다**:
         · OPEN DART 오픈API 6개 그룹(공시정보·정기보고서 주요정보·정기보고서 재무정보·
           지분공시·주요사항보고서·증권신고서) 어디에도 '사업의 내용'이나 부문별 매출
           비중을 주는 엔드포인트가 없다. 그 내용은 사업보고서 **본문(원문 XML)** 에만
           있고, 서식이 회사마다 달라 일괄 파싱이 안 된다.
         · 공공데이터포털도 마찬가지다. 기업 관련 개방 API 는 공정위 기업집단포털의
           '대규모기업집단 소속회사 참여업종' 정도라 업종 나열이지 매출 비중이 아니다.
       그래서 지어내지 않고, 실제로 열려 있는 값(개황 + 직원 수)으로 '개요'를 만든다.
       부문별 매출은 "직접 확인하라"고 남긴다 — 빈칸을 숨기면 필요 없는 항목으로 오해한다. */
    {
      no: 1, key: 'overview', label: '개요',
      asks: '어떤 회사이고 규모가 어느 정도인가',
      status: prof ? 'ok' : 'todo',
      note: prof
        ? [SECTORS.sectorOfCode(prof.industryCode),
           prof.established && `${prof.established.slice(0, 4)}년 설립`,
           prof.market].filter(Boolean).join(' · ') || '공시 개황'
        : '회사 홈페이지의 회사 소개에서 사업 영역을 직접 확인하세요.',
      link: prof?.homepage || null,
    },
    {
      no: 2, key: 'financial', label: '재무·실적',
      asks: '최근 3년 실적이 어느 방향인가',
      status: fin ? 'ok' : 'todo',
      note: fin
        ? `${fin.baseYear}년 사업보고서 기준 (${fin.fsDiv === 'CFS' ? '연결' : '개별'})`
        : (dart?.note || 'DART 에서 사업보고서를 직접 확인하세요. 비상장사는 공시 자료가 없습니다.'),
    },
    {
      no: 3, key: 'issue', label: '최근 이슈',
      asks: '지금 이 회사가 무엇을 하고 있는가',
      status: news?.items?.length ? 'ok' : 'todo',
      note: news?.items?.length
        ? '아래 기사 중 하나를 골라 지원동기의 근거로 삼으세요.'
        : '최근 6개월 기사를 직접 찾아 3건만 정리하세요.',
    },
    /* '인재상' 을 '채용공고' 로 바꿨다. 인재상은 회사 홈페이지의 캐치프레이즈라
       모든 회사가 비슷하고("도전·소통·열정") 자소서에 쓰면 오히려 감점이다.
       실제로 필요한 건 그 회사가 **지금 올린 공고의 자격요건**이라, 공고를 찾는
       경로와 붙여넣는 자리로 연결한다. */
    {
      no: 4, key: 'recruit', label: '채용공고',
      asks: '이 직무에 무엇을 요구하는가',
      status: jobs?.items?.length ? 'ok' : 'link',
      /* 여기도 '워크넷' 이 박혀 있었다. 소스가 넷이라 어디서 왔는지는 jobs.source 가
         말한다 — 박아 두면 소스를 하나 더 붙일 때마다 조용히 틀린다. */
      note: jobs?.items?.length
        ? `${SOURCE_LABEL[jobs.source] || '채용 정보'}에 열려 있는 공고입니다. 공고 본문을 자소서 코치에 붙여넣으면 요구 역량이 나옵니다.`
        : '채용 사이트에서 이 회사 공고를 찾아 자소서 코치에 붙여넣으면 요구 역량과 작성 지침이 나옵니다.',
    },
    {
      no: 5, key: 'competitor', label: '경쟁사',
      asks: '같은 시장의 다른 회사와 무엇이 다른가',
      status: dart?.competitors?.length ? 'ok' : 'todo',
      note: dart?.competitors?.length
        ? '업종코드가 같은 상장사입니다. 실제 경쟁 관계인지는 직접 확인하세요.'
        : '경쟁사를 2~3곳 정해 같은 항목으로 비교표를 만들어 보세요.',
    },
  ];
}

/* 지원동기 공식 — 세 조각이 다 있어야 문단이 선다. 어느 조각이 비었는지
   화면에서 바로 보이게 조각별로 내려보낸다. */
function motiveFormula({ news, dart }) {
  return [
    { part: '내 경험·인사이트', from: 'spec', filled: null,
      how: '아래 역량 카드에서 배정된 활동 하나를 고릅니다.' },
    { part: '기업의 전략·이슈', from: 'analysis',
      filled: Boolean(news?.items?.length || dart?.financials),
      how: '위 기사나 실적 추이에서 사실 하나를 고릅니다. 홈페이지의 비전·연혁은 쓰지 마세요.' },
    { part: '내가 기여할 지점', from: 'jd', filled: null,
      how: '공고의 담당업무 중 그 사실과 맞닿는 항목 하나를 짚습니다.' },
  ];
}

/* ── 채용공고: 사람인 → 고용24 → 잡알리오 → 워크넷 ──────────────
   넷 다 companyJobs(회사명) 한 가지 모양이라 순서대로 부르고 **처음 잡히는 것**을 쓴다.
   전부 부르면 느려지기만 하고 같은 공고가 두 번 나올 수도 있다.

   ── 이 순서인 이유 ──
   · 사람인  : 민간 공고가 실제로 여기 올라온다. 다만 **승인이 심사**라 키가 없을 수 있다
   · 고용24  : 공개 화면을 **하루 한 번** 받아 둔 캐시(work24-crawl.js). 민간·공공이
               같이 들어오고 대기업 공채도 잡힌다. 대신 **어제 값**이고 대졸·신입으로 좁혔다
   · 잡알리오: 공공데이터포털 **자동승인**. **공공기관 공고만** 담지만 그 안에서는 최신이다
   · 워크넷  : 발급 키가 개인회원이면 목록 API 자체가 막힌다(10-7). 열리면 보조로 산다

   ── 왜 고용24 를 잡알리오보다 위에 두나 ──
   커버리지가 넓어서다. 다만 **공공기관 하나만 놓고 보면 잡알리오가 낫다** — 고용24 는
   대졸·신입으로 좁혀 받아 두어 그 밖의 공고가 빠져 있고, 잡알리오는 접수 중 전량이다.
   그래서 고용24 가 **0건이면 그대로 잡알리오로 내려간다**(아래 for 문이 그렇게 돈다).

   회사를 넣었는데 어느 소스에서도 안 나오는 일이 흔하다. 그게 "채용을 안 한다"로
   읽히면 안 되므로 사유를 합쳐 내려보내고 화면이 그대로 보여준다(alio-jobs.js 머리주석). */
const SOURCES = [
  ['사람인', 'saramin', SARAMIN],
  ['고용24', 'work24', WORK24],
  ['공공기관(잡알리오)', 'alio', ALIO],
  ['워크넷', 'worknet', WORKNET],
];

/* 소스 id → 화면에 적을 이름. **SOURCES 에서 만든다** — 이름표를 따로 손으로 두면
   소스를 하나 더 붙였을 때 한쪽만 고쳐지고, 그건 '워크넷 기준' 처럼 조용히 틀린
   문구로 나간다(실제로 그랬다). */
const SOURCE_LABEL = Object.fromEntries(SOURCES.map(([label, id]) => [id, label]));

async function fetchJobs(name) {
  const tried = [];
  for (const [label, id, mod] of SOURCES) {
    const r = await mod.companyJobs(name).catch(e => ({
      items: [], configured: mod.isConfigured(), source: id, reason: e.message,
    }));
    if (r.items.length) return { ...r, source: id };
    tried.push({ label, ...r });
  }

  /* 전부 빈손 — 사유를 합쳐 준다. 한쪽만 보여주면 "키를 넣었는데 왜 안 되지" 가 된다. */
  const reasons = tried.filter(t => t.reason).map(t => `${t.label}: ${t.reason}`);
  return {
    items: [], source: null,
    configured: tried.some(t => t.configured),
    reason: reasons.join(' · ') || null,
  };
}

/* GET /api/company/business?name=<회사명>
   '무엇을 하는 회사인가' 를 사업보고서 원문에서 줄글로 가져온다.

   ── 왜 /analysis 에 합치지 않았나 ──
   위 라우트의 머리주석은 "화면에서 두 번 부르게 하면 하나가 느릴 때 반쪽만
   그려진다" 고 적어 뒀고 그 판단은 지금도 맞다. 그런데 이 값은 성격이 다르다 —
   보고서 원문 ZIP 이 회사마다 5~14MB 다(실측). /analysis 에 얹으면 재무도 뉴스도
   공고도 그 다운로드를 기다린다. **모두를 늦추느니 이 칸만 늦게 채운다.**
   화면은 이 칸이 오기 전에는 "사업보고서에서 가져오는 중" 을 보여준다 —
   빈칸을 숨기지 않는다는 규칙은 그대로다. */
router.get('/business', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '회사명을 입력해 주세요.' });
  try {
    res.json(await REPORT.business(name));
  } catch (e) {
    /* 실패를 200 으로 감싸지 않는다 — 화면이 '없음' 과 구별해서 다시 눌러 볼 수
       있어야 한다. 사업 내용이 없어도 리포트의 나머지는 이미 떠 있다. */
    res.status(e.status === 429 ? 429 : 502).json({
      ok: false, reason: 'fetch-failed',
      message: '사업보고서 원문을 가져오지 못했어요.',
      detail: e.message,
    });
  }
});

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

/* GET /api/company/logo?name=<회사명>
   공고 카드에 붙일 회사 로고. **주소가 아니라 회사명을 받는다** — 화면이 주소를
   고르게 하면 우리 서버가 남의 주소를 대신 여는 통로가 된다(company-logo.js 머리주석).
   주소는 리포트를 그릴 때 DART 회사개황에서 받아 서버가 적어 둔 것을 쓴다.

   못 찾으면 **204**. 빈 이미지나 기본 아이콘을 주지 않는다 — 화면이 그 회사
   이니셜로 카드를 그린다. 깨진 이미지 아이콘이 뜨면 학생은 고장으로 읽는다. */
router.get('/logo', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '회사명을 입력해 주세요.' });

  const none = () => res.set('Cache-Control', NONE_CACHE).status(204).end();

  const host = LOGO.hostFor(name);
  if (!host) return none();                      // 홈페이지를 모르는 회사

  let file = LOGO.cached(host);
  if (!file) {
    try { file = await LOGO.fetchLogo(host); } catch { file = null; }
  }
  if (!file) return none();

  res.set('Cache-Control', IMG_CACHE);
  res.type(file.type);
  res.sendFile(file.path);
});

router.get('/analysis', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '회사명을 입력해 주세요.' });

  /* 둘을 동시에 던진다. 뉴스는 외부 검색이라 느리고 DART 는 호출이 여러 번이라,
     순서대로 기다리면 대기시간이 그대로 더해진다. */
  const [newsResult, dartResult, jobsResult] = await Promise.allSettled([
    NEWS.companyNews(name),
    DART.analyze(name),
    fetchJobs(name),
  ]);

  const news = newsResult.status === 'fulfilled' ? newsResult.value : null;
  const dart = dartResult.status === 'fulfilled' ? dartResult.value : null;
  /* 공고는 없어도 리포트가 성립한다 — 실패하면 조용히 빈 목록으로 둔다. */
  const jobs = jobsResult.status === 'fulfilled'
    ? jobsResult.value
    : { items: [], configured: false, reason: '채용공고를 불러오지 못했습니다.' };

  if (!news && !(dart && dart.available)) {
    const reason = newsResult.reason;
    const status = reason?.status === 503 || reason?.status === 400 ? reason.status : 502;
    return res.status(status).json({
      error: status === 502
        ? '기업 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
        : reason?.message,
    });
  }

  /* 홈페이지를 알아냈으면 회사명과 짝지어 적어 둔다. 로고 라우트가 그것만 본다 —
     화면이 주소를 고르지 못하게 하려고 이렇게 나눴다(company-logo.js 머리주석). */
  const logoUrl = dart?.profile?.homepage && LOGO.remember(name, dart.profile.homepage)
    ? `/api/company/logo?name=${encodeURIComponent(name)}`
    : null;

  res.json({
    company: name,
    steps: buildSteps({ news, dart, jobs }),
    motiveFormula: motiveFormula({ news, dart }),

    news: news ? { ...news, provider: NEWS.provider(), guide: NEWS.MOTIVE_GUIDE } : null,
    newsError: newsResult.status === 'rejected' ? '뉴스를 불러오지 못했습니다.' : null,

    /* DART 는 '없음'과 '실패'를 구분해 내려보낸다. 키가 없어서 없는 것과 호출이
       실패한 것은 사용자가 할 일이 다르다(전자는 관리자 설정, 후자는 재시도). */
    dart: dart && dart.available ? {
      /* 업종코드(264)는 화면에 못 올린다 — 사람이 쓰는 계열 이름을 같이 붙인다. */
      profile: dart.profile && {
        ...dart.profile,
        sector: SECTORS.sectorOfCode(dart.profile.industryCode),
        /* 화면에 내보낼 업종 이름. 예전에는 '업종코드 212' 를 그대로 띄웠는데,
           그건 우리가 읽으라고 준 값이 아니라 신고 서식의 숫자다.
           ① 취업 업종(사람인·잡코리아가 쓰는 말)이 있으면 그것을 쓰고,
           ② 없으면 KSIC 공식 명칭으로 물러난다(회사 색인은 11만 곳이라 우리 목록
              밖의 회사도 리포트는 열린다),
           ③ 둘 다 없으면 null 이다 — 지어내지 않는다. 화면이 '—' 로 적는다. */
        industryLabel: (JOB.classify(name || dart.profile.name, dart.profile.industryCode) || {}).minor
          || (KSIC.deepest(dart.profile.industryCode) || {}).name
          || null,
      },
      financials: summarizeFinancials(dart.financials),
      employees: dart.employees,      // segments(사업부문)까지 들어 있다
      /* 관계사 — 사업부문과 짝이다. 여기 안 실으면 화면의 '무엇을 하는 회사인가' 가
         절반만 뜬다(실측으로 그렇게 됐다 — dart.js 에는 있는데 이 목록에서 빠졌었다). */
      affiliates: dart.affiliates,
      labels: LABELS,
      competitors: dart.competitors,
      note: dart.note,
    } : null,
    dartReason: dart && !dart.available ? dart.reason : null,

    /* 회사별 채용공고(워크넷). 대기업 공채는 자사 사이트로만 올라오는 일이 많아
       0건이 정상인 경우가 있다 — 그래서 사유(reason)도 같이 내려보낸다. */
    jobs,

    /* 공고 카드에 붙일 로고 주소. 홈페이지를 아는 회사만 준다 — 모르면 null 이고
       화면이 이니셜 카드를 그린다. 주소를 그대로 내려보내지 않고 **우리 주소**를
       주는 이유는 company-logo.js 머리주석에 있다(누가 어느 회사를 보는지 그 회사
       서버에 남기지 않는다). */
    logo: logoUrl,

    /* 자사 채용페이지 링크. 없으면 null 이고 화면은 검색 링크로 물러난다.
       바로 위 jobs 의 '0건이 정상' 인 경우에 특히 이게 답이다 — 공채가 여기 있다. */
    careerPage: CAREER.urlOf(name),

    interview: GUIDE.interviewQuestions({ company: name, hasNews: Boolean(news?.items?.length) }),
  });
});

module.exports = router;
