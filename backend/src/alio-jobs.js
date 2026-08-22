/* ════════════════════════════════════════════════════════════
   공공기관 채용공고 (잡알리오 · 공공데이터포털 15125273)

   ── 왜 이 소스가 들어왔나 ────────────────────────────────────
   사람인은 승인이 나지 않았고(심사), 워크넷 채용정보(고용24 210L01)는 **개인회원이
   호출할 수 없다**(10-7, 2026-08 재확인). 그래서 회사 리포트의 '채용공고' 칸이
   대부분 빈 채로 나갔다. 잡알리오는 공공데이터포털 **자동승인**이라 이미 가진
   `DATA_GO_KR_SERVICE_KEY` 로 열린다.

   ── 다른 두 소스와 다른 점: 미리 받아 둔다 ──────────────────
   사람인·워크넷은 회사명을 넣어 **그때그때 검색**한다. 잡알리오 목록 API 에는
   회사명 검색이 없거나 있어도 기관명 표기가 제각각이라, **하루 한 번 전량을 받아
   캐시**하고 대조는 우리가 한다(`fetch-alio-jobs.js`). 공공기관 공고는 전량이라야
   수천 건이라 이 방식이 감당된다. 다른 `fetch-*` 수집기와 같은 규약이다.

   ── 커버리지를 숨기지 않는다 ────────────────────────────────
   **공공기관 공고만 들어 있다.** 삼성전자를 넣으면 0건이 나오는데 그건 "삼성이
   채용을 안 한다"가 아니라 **이 자료에 민간이 없다**는 뜻이다. 그래서 0건일 때
   `reason` 에 그 사실을 적어 내려보낸다 — 화면이 그대로 보여준다.

   같은 이유로 **'채용 중' 배지를 회사 목록에 붙이지 않는다.** 공공기관에만 배지가
   뜨면 민간 기업이 "지금 안 뽑는다"로 읽힌다. 에러도 안 나는 오해라 6-3 부류다.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { sameCompany, dday } = require('./company-name');

const CACHE = path.join(__dirname, '..', 'data', 'alio-jobs.json');
const MAX_ITEMS = 8;

let _cache = null;
let _mtime = 0;

/* 파일이 바뀌면 다시 읽는다 — 수집 스크립트를 돌린 뒤 서버를 재시작하지 않아도
   새 공고가 보여야 한다(수집은 하루 한 번이고 서버는 계속 떠 있다). */
function load() {
  let stat;
  try { stat = fs.statSync(CACHE); } catch { return null; }
  if (_cache && stat.mtimeMs === _mtime) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    _mtime = stat.mtimeMs;
    return _cache;
  } catch {
    return null;                       // 손상된 캐시는 없는 것으로 본다(서버를 죽이지 않는다)
  }
}

const isConfigured = () => Boolean(load());

/* ── 공고 정형문구를 걷어낸다 ────────────────────────────────
   `aplyQlfcCn`(지원자격)·`prefCn`(우대사항)에는 직무 요건보다 **법정 가점 안내와
   전형 절차 안내**가 훨씬 많다. 532건에서 문장 빈도를 세어 확인한 것들:

     "취업지원 대상자(「국가유공자 등 예우 및 지원에 관한 법률」…)"   33회
     "※ 자세한 사항은 첨부파일의 채용공고문을 참조하시기 바랍니다."    31회
     "1차 전형 점수 만점의 범위 내에서 10% 가산"                     27회
     "장애인: 장애인의 가점은 만점의 3%를 적용"                       19회
     "우리 기관은 정부의 블라인드 채용 가이드라인에 따라…"            13회

   안 거르면 역량 추출이 이런 문장을 근거로 집어 든다. 실측에서 '결격사유에 해당되지
   않는 자'가 `process` 역량의 근거로, '블라인드 채용 가이드라인'이 또 `process` 의
   근거로 뽑혔다. 학생 화면에는 **역량 카드에 엉뚱한 인용문이 붙는 형태**로 나타난다 —
   에러가 안 나고 그럴듯해서 더 나쁘다(6-3 부류).

   news.js 의 NEWS_STOP 과 같은 방식이다. 다만 **이 소스에만 적용한다** — 사람인 공고에
   같은 잣대를 대면 멀쩡한 문장이 날아간다.

   ── 지우는 것이 아니라 넘기지 않는 것이다 ──
   원문은 srcUrl 로 언제든 볼 수 있다. 우리가 하는 일은 '역량 추출에 넣을 문장'을
   고르는 것이고, 못 고르겠으면 아예 안 넘긴다(그러면 화면이 '본문을 붙여넣으라'고 한다).

   ── 너무 세게 걸면 신호까지 지운다 (실측) ──
   처음에는 `우대` 가 든 줄을 통째로 버렸다. 그랬더니 "관련 자격증 소지자 우대" 같은
   **진짜 우대사항**이 같이 날아가, 역량 0개인 공고가 110 → 222건으로 늘었다.
   지금은 **법정 가점·전형 안내만** 겨냥한다. 애매하면 남긴다 — 남은 노이즈는 근거
   문장으로 한 번 보이고 말지만, 지운 신호는 되찾을 방법이 없다. */
const NOISE = [
  /국가유공자|취업지원\s*대상자|독립유공자|5\s*[·.]?\s*18|고엽제|보훈\s*(대상|보상)/,
  /장애인고용촉진|장애인의?\s*가점|장애인,?\s*보훈/,
  /가점|가산점|만점의\s*\d|전형\s*점수/,
  /결격사유|임용취소|채용비위|부정합격|저촉되지\s*않는/,
  /첨부파일|채용공고문을?\s*참조|자세한\s*사항은|홈페이지\s*참조|공고문\s*참조/,
  /블라인드\s*채용|전형\s*절차|면접위원|선발예정인원|응시절차|응시원서\s*마감일\s*기준/,
  /군복무|전역이?\s*가능|병역/,
  /만\s*\d+\s*세\s*이상.*\d+\s*세\s*미만/,          // 연령 제한 안내 — 역량이 아니다
  /^[○ㅇ0\-*※·\s]*$/,
  /(인사규정|시행령|국가공무원법|공무원법)\s*제\s*\d+\s*조/,
];

/* 문장 단위로 자른다. jd-competency 의 splitSentences 와 같은 결이지만, 여기서는
   줄바꿈이 곧 항목 구분인 공고문이라 줄을 먼저 살린다. */
function stripBoilerplate(text) {
  if (!text) return null;
  const kept = String(text)
    .split(/\r?\n|(?<=[.。])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 6 && !NOISE.some(re => re.test(s)));
  const out = kept.join('\n').trim();
  return out.length >= 20 ? out : null;      // 남은 게 너무 적으면 없는 것으로 본다
}

/* 잡알리오 레코드 → 사람인·워크넷과 **같은 모양**. 화면(company-cover.js)이 세
   소스를 구분하지 않고 그리므로 여기서 모양을 맞춰야 한다.

   원본 필드는 실제 응답에서 확인한 것만 쓴다(추정해서 박지 않는다 — 3-1). */
function normalizeJob(r) {
  return {
    id: String(r.recrutPblntSn ?? ''),
    title: String(r.recrutPbancTtl || '').trim(),
    company: String(r.instNm || '').trim(),
    url: r.srcUrl || null,
    closeDate: r.pbancEndYmd || null,
    dday: dday(r.pbancEndYmd),
    career: r.recrutSeNm || null,          // '신입' · '경력' · '신입+경력'
    edu: r.acbgCondNmLst || null,          // '학력무관' 등
    region: r.workRgnNmLst || null,
    jobType: r.hireTypeNmLst || null,      // '정규직' · '비정규직' 등
    /* 아래 둘은 이 소스에만 있다. 자소서 코치가 공고 본문 없이도 역량을 뽑을 수
       있게 하는 재료다(학생이 복사·붙여넣기를 건너뛴다). 화면 공통 모양에는
       없는 값이라 쓰는 쪽에서만 꺼내 쓴다.
       정형문구를 걷어내고 남은 것만 넘긴다 — 남는 게 없으면 null 이고, 그러면
       화면이 예전처럼 "본문을 복사해 붙여넣으세요"로 돌아간다(거짓말을 안 한다). */
    qualification: stripBoilerplate(r.aplyQlfcCn),
    preference: stripBoilerplate(r.prefCn),
    ncs: r.ncsCdNmLst || null,
  };
}

/* 아직 지원할 수 있는 공고만. 마감일이 지난 것을 섞으면 학생이 그걸 보고 준비한다. */
const isOpen = j => j.dday != null;

/* 신입이 지원할 수 있는가. 값이 '신입' · '신입+경력' 이면 통과, 비어 있으면
   **거르지 않는다** — 모르는 것을 '경력직'으로 단정하면 실제 기회를 지운다. */
function newcomerOk(j) {
  const s = String(j.career || '');
  if (!s) return true;
  return s.includes('신입');
}

/* 회사(기관) 하나의 공고. 사람인·워크넷과 시그니처가 같다 —
   companyAnalysis.js 의 fetchJobs() 가 셋을 같은 방식으로 부른다. */
async function companyJobs(companyName, { newcomerOnly = false } = {}) {
  const company = String(companyName || '').trim();
  const base = { items: [], source: 'alio', configured: isConfigured(), reason: null };
  if (company.length < 2) return base;

  const data = load();
  if (!data) {
    return { ...base, configured: false,
      reason: '공공기관 채용공고 캐시가 없습니다. backend 에서 node scripts/fetch-alio-jobs.js 를 실행하세요.' };
  }

  const all = (data.items || []).map(normalizeJob).filter(j => j.title && j.company);
  const mine = all.filter(j => sameCompany(j.company, company));
  const open = mine.filter(isOpen);
  const shown = (newcomerOnly ? open.filter(newcomerOk) : open)
    .sort((a, b) => a.dday - b.dday);                 // 마감 임박 순

  /* 0건의 이유를 갈라서 말한다. 셋 다 "0건" 이지만 학생이 할 일이 다르다.
       · 이 기관 공고가 아예 없다  → 민간이거나 지금 공고가 없다
       · 있었는데 전부 마감됐다    → 다음 공고를 기다리면 된다
       · 신입 조건으로 걸러졌다    → 필터를 풀면 보인다 */
  let reason = null;
  if (!shown.length) {
    if (!mine.length) {
      reason = `공공기관 채용정보(잡알리오)에 '${company}' 공고가 없습니다. `
             + '이 자료에는 공공기관 공고만 들어 있어, 민간 기업은 조회되지 않습니다.';
    } else if (!open.length) {
      reason = `'${company}' 공고 ${mine.length}건이 있지만 모두 접수가 마감됐습니다.`;
    } else {
      reason = `'${company}' 진행 중 공고 ${open.length}건이 있지만 신입 지원 가능 공고는 없습니다.`;
    }
  }

  return {
    ...base,
    items: shown.slice(0, MAX_ITEMS),
    matched: mine.length,
    open: open.length,
    scanned: all.length,
    fetchedAt: data.fetchedAt || null,
    reason,
  };
}

/* ── 직무로 찾는 공고 (2026-08-22 신규) ───────────────────────
   회사가 아니라 **고른 직무**로 지금 모집 중인 공고를 찾는다.

   한동안 CAS 화면이 이걸 썼는데, 2026-08-22 걷어냈다(작업정리 36장) — 공고는
   로드맵 3단계인 회사 찾기가 답할 질문이라는 판단이다. **지금은 부르는 화면이 없다.**
   신입 필터·마감 판정·커버리지 표기가 여기 모여 있어 라우트째로 남겨 둔다.

   ── 어떻게 잇나 ──
   공고에는 NCS 대분류가 붙어 있고(`ncsCdNmLst`), 우리 화면의 직무는 KECO 다.
   둘을 잇는 표는 cert-reco.js 하나뿐이다 — 자격증 추천과 **같은 표**를 쓴다.
   여기에 표를 하나 더 두면 같은 직무가 화면마다 다른 분야로 번역된다.

   ── 커버리지를 숨기지 않는다 ──
   위 머리주석 그대로 **공공기관 공고만** 있다. 0건이 "이 직무는 안 뽑는다" 로
   읽히지 않게, 몇 건 중에서 찾았는지와 자료의 성격을 함께 내보낸다. */
function jobPostings({ jobMajor, jobMiddles, newcomerOnly = true, limit = MAX_ITEMS } = {}) {
  const certReco = require('./cert-reco');
  const base = { items: [], source: 'alio', configured: isConfigured(), fields: [], reason: null };

  const middles = (jobMiddles || []).map(String);
  let fields = [...new Set(middles.flatMap(c => certReco.KECO_MIDDLE_TO_NCS[c] || []))];
  if (!fields.length && jobMajor != null && jobMajor !== '') {
    fields = certReco.KECO_MAJOR_TO_NCS[String(jobMajor)] || [];
  }
  if (!fields.length) {
    return { ...base, reason: '직무를 고르면 그 직무로 모집 중인 공고를 보여드려요.' };
  }

  const data = load();
  if (!data) {
    return { ...base, configured: false, fields,
      reason: '공공기관 채용공고 캐시가 없습니다. backend 에서 node scripts/fetch-alio-jobs.js 를 실행하세요.' };
  }

  const fieldSet = new Set(fields);
  const all = (data.items || []).map(normalizeJob).filter(j => j.title && j.company);
  const mine = all.filter(j =>
    String(j.ncs || '').split(',').some(n => fieldSet.has(certReco.ncs(n))));
  const open = mine.filter(isOpen);
  const shown = (newcomerOnly ? open.filter(newcomerOk) : open)
    .sort((a, b) => a.dday - b.dday);                 // 마감 임박 순

  /* 0건의 이유를 갈라서 말한다 — companyJobs 와 같은 규칙이다. */
  let reason = null;
  if (!shown.length) {
    if (!mine.length) {
      reason = '공공기관 채용정보(잡알리오)에 이 직무 분야의 공고가 없습니다. '
             + '이 자료에는 공공기관 공고만 들어 있어, 민간 기업은 조회되지 않습니다.';
    } else if (!open.length) {
      reason = `이 직무 분야 공고 ${mine.length}건이 있지만 모두 접수가 마감됐습니다.`;
    } else {
      reason = `진행 중 공고 ${open.length}건이 있지만 신입 지원 가능 공고는 없습니다.`;
    }
  }

  return {
    ...base,
    fields,
    items: shown.slice(0, limit),
    matched: mine.length,
    open: open.length,
    scanned: all.length,
    fetchedAt: data.fetchedAt || null,
    reason,
  };
}

module.exports = {
  companyJobs, jobPostings, isConfigured, normalizeJob, isOpen, newcomerOk,
  stripBoilerplate, NOISE,
  MAX_ITEMS, CACHE_PATH: CACHE,
  _load: load,
};
