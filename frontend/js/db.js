// ════════════════════════════════════════════════════════════
//  C:road  —  Data layer (백엔드 API)
//
//  이전에는 localStorage 를 저장소로 썼다. 그 구조에서는 회원마다 자기
//  브라우저의 데이터만 볼 수 있어 "선배 데이터 n명" 집계가 성립하지 않았고,
//  비밀번호가 평문으로 저장됐다. 지금은 모든 데이터가 서버에 있다.
//
//  ── 동기 읽기 / 비동기 쓰기 ──
//  currentUser(), getAllSpecs() 는 렌더 도중 동기적으로 호출된다
//  (career.js, aggregation.js, home.js …). 그래서 부팅 시 hydrate() 로
//  서버 상태를 메모리에 한 번 받아두고, 읽기는 캐시에서 동기로 준다.
//  데이터를 바꾸는 함수는 async 이며, 성공 후 캐시를 갱신한다.
// ════════════════════════════════════════════════════════════
window.DB = (() => {
  // ── 캐시 ───────────────────────────────────────────────────
  let _me     = null;   // 로그인한 회원 (publicUser) | null
  let _specs  = [];     // 전체 스펙 (익명 — 집계용)
  let _mySpec = null;   // 내 스펙 (detail 포함)
  let _users  = [];     // 백오피스 전용. refreshUsers() 로 채운다
  let _counts = { mentor: 0, mentee: 0, unknown: 0 };
  let _stats  = { userCount: 0, specCount: 0 };   // 홈 KPI. 회원 목록 없이도 총계를 안다

  // ── HTTP ───────────────────────────────────────────────────
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'include',                 // 세션 쿠키 동봉
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) {
      const e = new Error(data?.error || `요청에 실패했습니다. (${res.status})`);
      /* 상태코드와 서버가 갈라 준 사유를 살려 둔다. 메시지만 남기면 화면이
         "다시 시도하면 되는 것"과 "설정을 고쳐야 하는 것"을 구분할 수 없다
         (cas-fit 의 aiStatus 와 같은 이유). */
      e.status = res.status;
      if (data?.kind) e.kind = data.kind;
      throw e;
    }
    return data;
  }

  /* 로그인하지 않았을 때의 401 은 오류가 아니라 정상 상태다. */
  async function apiOrNull(path) {
    try { return await api('GET', path); }
    catch { return null; }
  }

  // ── 부팅 시 서버 상태를 캐시로 ─────────────────────────────
  async function hydrate() {
    const [me, specs, stats] = await Promise.all([
      apiOrNull('/api/auth/me'),
      apiOrNull('/api/specs'),
      apiOrNull('/api/stats'),
    ]);
    _me     = me?.user ?? null;
    _specs  = specs?.specs ?? [];
    if (stats) { _counts = stats.counts; _stats = { userCount: stats.userCount, specCount: stats.specCount }; }
    _mySpec = _me ? (await apiOrNull('/api/specs/me'))?.spec ?? null : null;
  }

  /* 스펙이 바뀐 뒤 집계 화면이 최신값을 보도록 다시 받는다. */
  async function refreshSpecs() {
    const [specs, stats] = await Promise.all([apiOrNull('/api/specs'), apiOrNull('/api/stats')]);
    _specs = specs?.specs ?? [];
    if (stats) { _counts = stats.counts; _stats = { userCount: stats.userCount, specCount: stats.specCount }; }
    _mySpec = _me ? (await apiOrNull('/api/specs/me'))?.spec ?? null : null;
  }

  async function refreshUsers() {
    _users = (await apiOrNull('/api/admin/users'))?.users ?? [];
    return _users;
  }

  // ── 읽기 (동기 · 캐시) ─────────────────────────────────────
  const currentUser = () => _me;
  const getAllSpecs = () => _specs;
  const getUsers    = () => _users;
  const countByRole = () => _counts;
  const stats       = () => _stats;

  /* 예전 시그니처 유지. 서버는 남의 스펙 상세를 주지 않으므로 본인 것만 반환한다. */
  function getSpec(username) {
    return _me && _me.username === username ? _mySpec : null;
  }

  /* 내 정성스펙 활동 목록(스펙입력에서 적은 것). 자소서 코치가 STAR 를 가져올 때 쓴다.
     로그인 안 했거나 스펙이 없으면 빈 배열. */
  function myActivities() {
    return _mySpec?.activities || [];
  }

  /* 회사명 → 기업 규모 자동 판정. 서버가 로컬 캐시만 보므로 입력 중 호출해도 빠르다.
     실패해도 화면이 멈추면 안 되므로 null 을 돌려주고, 호출부는 회원이 직접
     고르는 흐름으로 넘어간다. */
  async function classifyCompany(name) {
    if (!name || !name.trim()) return null;
    try {
      return await api('GET', `/api/company/classify?name=${encodeURIComponent(name.trim())}`);
    } catch {
      return null;
    }
  }

  /* 회사명 자동완성 — '삼성' → 삼성전자 · 삼성물산 …
     서버가 로컬 캐시만 보므로 입력 중 호출해도 빠르다. 실패는 빈 목록으로 삼켜서
     자동완성이 안 뜰 뿐 직접 입력은 계속되게 한다. */
  async function suggestCompanies(q, limit = 8) {
    if (!q || !q.trim()) return [];
    try {
      const r = await api('GET', `/api/company/suggest?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
      return r.items || [];
    } catch {
      return [];
    }
  }

  /* 직업 분류 카탈로그(한국고용직업분류 · 임금·전망 포함). 커리어 로드맵이 처음
     열릴 때 한 번만 받는다. 200KB 라 초기 로딩에 얹지 않는다. */
  let _jobsPromise = null;
  function jobCatalog() {
    if (!_jobsPromise) {
      _jobsPromise = api('GET', '/api/jobs')
        .catch(e => { _jobsPromise = null; throw e; });   // 실패하면 다시 시도할 수 있게
    }
    return _jobsPromise;
  }

  /* ── 스펙업 (자격증 시험일정 · 공모전/대외활동 모집) ────────────
     다른 조회 함수들과 달리 **실패를 삼키지 않는다.** 자동완성은 안 떠도 직접
     입력하면 되지만, 여기는 "왜 아무것도 안 뜨는지" 가 곧 화면 내용이다 —
     키가 없거나 활용신청 전이면 그 사실과 할 일을 그대로 보여줘야 한다.
     그래서 `{ ok, ... }` 로 성공·실패를 같은 모양으로 돌려준다. */
  async function specupFetch(path) {
    try {
      const res = await fetch(path, { credentials: 'include' });
      let data = null;
      try { data = await res.json(); } catch { /* 본문 없음 */ }
      if (res.ok) return { ok: true, ...(data || {}) };
      return {
        ok: false,
        reason: data?.reason || 'unknown',
        error: data?.error || `요청에 실패했습니다. (${res.status})`,
        how: data?.how || null,
      };
    } catch (e) {
      return { ok: false, reason: 'network', error: '연결하지 못했어요. 잠시 후 다시 시도해 주세요.', how: null };
    }
  }

  const specupExams = (certs, year) => specupFetch(
    `/api/specup/exams?certs=${encodeURIComponent((certs || []).join(','))}`
    + (year ? `&year=${year}` : ''));

  const specupActivities = topic => specupFetch(
    `/api/specup/activities?topic=${encodeURIComponent(topic || 'contest')}`);

  /* 학과 검색. 회사명(suggestCompanies)·자격증(suggestCerts)과 같은 규약이다 —
     입력할 때마다 부르고(호출부가 debounce), { items } 를 받아 드롭다운에 그린다.
     실패는 빈 목록으로 삼켜서 자동완성만 안 뜨고 직접 입력은 계속되게 한다. */
  async function suggestMajors(q, limit = 8) {
    if (!q || !q.trim()) return [];
    try {
      const r = await api('GET', `/api/majors/suggest?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
      return r.items || [];
    } catch {
      return [];
    }
  }

  /* 자격증 검색. 위와 같은 규약. */
  async function suggestCerts(q, limit = 8) {
    if (!q || !q.trim()) return [];
    try {
      const r = await api('GET', `/api/certs/suggest?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
      return r.items || [];
    } catch {
      return [];
    }
  }

  /* 멘토 목록 — 멘토 찾기 화면의 원본 (2026-08-22).
     그전에는 mentoring.js 에 가짜 멘토 102명이 박혀 있어서, 멘토가 멘토 페이지를
     채워도 목록에 안 떴다. 서버는 **프로필을 채운 멘토만** 내려준다.

     실패를 삼키지 않는다 — 목록이 비는 것과 못 받아 오는 것은 화면에서 다르게
     보여야 한다(mentoring.js renderSearch 의 빈 상태 두 가지). */
  async function mentors() {
    const r = await api('GET', '/api/mentors');
    return r.mentors || [];
  }

  /* 자격증 추천 — "이 직무에서 실제로 보는 자격증" (backend/src/cert-reco.js).

     ── 왜 서버에 묻나 ──
     예전에는 화면이 손으로 쓴 표(aggregation.js CERT_CATALOG)를 들고 있었다.
     근거로 쓰는 자료가 자격 카탈로그(DB)와 채용공고 캐시(파일)라 화면에 둘 수 없다.

     ── 실패해도 화면은 멀쩡해야 한다 ──
     추천은 있으면 좋은 길잡이지 스펙 입력의 전제가 아니다. 실패하면 추천 칸만
     비고 자격증 입력은 그대로 된다 — 검색·직접입력과 같은 규칙이다. */
  async function recommendCerts({ jobMajor, jobMiddles, dept } = {}) {
    const p = new URLSearchParams();
    if (jobMajor) p.set('jobMajor', jobMajor);
    if (jobMiddles && jobMiddles.length) p.set('jobMiddles', jobMiddles.join(','));
    if (dept) p.set('dept', dept);
    if (![...p.keys()].length) return null;
    try { return await api('GET', `/api/certs/recommend?${p}`); }
    catch { return null; }
  }

  /* 학교 검색. 학과·회사·자격증 검색과 같은 규약이다.
     실패는 빈 목록으로 삼킨다 — 카탈로그가 아직 비어 있어도(수집 전) 직접 입력은 되어야 한다. */
  async function suggestUniversities(q, limit = 8) {
    if (!q || !q.trim()) return [];
    try {
      const r = await api('GET', `/api/universities/suggest?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
      return r.items || [];
    } catch { return []; }
  }

  /* 목록에 없는 학과명 → 집계 분류. 규칙은 서버에 한 벌만 둔다
     (프론트에도 복사하면 둘이 어긋났을 때 통계가 조용히 갈린다). */
  async function classifyMajor(name) {
    if (!name || !name.trim()) return null;
    try {
      return await api('GET', `/api/majors/classify?name=${encodeURIComponent(name.trim())}`);
    } catch {
      return null;
    }
  }

  /* 반정형 스펙 텍스트 → AI 분석(활동 정규화·정성 채점).
     서버가 Gemini 로 처리한다. 키 미설정이면 503 → 에러 메시지를 그대로 던진다. */
  async function analyzeCas(text) {
    return api('POST', '/api/cas/analyze', { text });
  }

  /* 적합도 캐시를 언제 버려야 하는지 알려 주는 지문.
     ── 왜 필요한가 (실측) ──
     화면(cas-fit.js)은 AI 호출을 아끼려고 결과를 담아 두는데, 예전에는 **직업 코드만**
     보고 "같은 직업이면 그대로" 로 판단했다. 그래서 스펙을 새로 넣어도 직업이 그대로면
     다시 부르지 않았고, 스펙이 없던 시절에 계산한 '아직 근거 없음' 이 계속 떴다.
     저장은 됐는데 화면만 안 바뀌는 것이라, 사용자에게는 채점이 고장난 것으로 보인다.

     지문에 넣는 값은 **casFit 이 서버로 실제로 보내는 필드 그대로**다. 여기에 없는
     필드를 보내기 시작하면 그 변화는 캐시를 못 깨우므로, 아래 casFit 을 고칠 때
     이 함수도 같이 고친다. */
  function specFingerprint() {
    if (!_mySpec) return '';
    const a = (_mySpec.activities || [])
      .map(x => [x.name, x.type, x.typeLabel, x.duration, x.role, x.outcome].join(''));
    return JSON.stringify([_mySpec.dept, _mySpec.gpa, _mySpec.gpaMax,
                           _mySpec.scores || null, _mySpec.certs || [], a]);
  }

  /* 직무 적합도 — 이 직업의 업무특성과 내 스펙을 견줘 1000점으로 채점한다.
     내 스펙을 같이 보내야 매칭이 되고, 안 보내면 근거 없는 바닥 점수만 나온다. */
  async function casFit(jobCode, jobName) {
    return api('POST', '/api/cas/fit', {
      jobCode, jobName,
      spec: _mySpec || null,
    });
  }

  /* 직무기술서(채용공고) → 요구역량 + 자소서 작성 가이드.
     내 활동을 함께 보내면 역량마다 "이 경험으로 쓰라"까지 붙는다. 로그인하지 않았거나
     스펙이 없으면 활동 없이 호출되고, 가이드는 일반 골격만 나온다(빈 화면이 되지 않는다). */
  async function coachJd(text, { useAi = true, company = '' } = {}) {
    return api('POST', '/api/jd/coach', {
      text,
      activities: _mySpec?.activities || [],
      useAi,
      company,
    });
  }

  /* 역량 하나에 대한 AI 초안. 내 활동(_mySpec)을 같이 보내야 모델이 **내 경험으로**
     문장을 짠다 — 안 보내면 일반론이 나오고, 그건 자소서에 쓸 수 없다. */
  /* star 는 사용자가 STAR 입력칸에 직접 쓴 { S, T, A, R } 이다. 활동 목록은 분류일 뿐
     '무슨 일이 있었는지' 를 담지 못해서, 그게 없으면 모델이 빈자리를 관용구로 메운다. */
  /* competencies 는 이 문항에 고른 역량 **0~2개**의 이름이다(사용자 지시 2026-09-01).
     0개면 역량 축 없이 문항 골격만으로 쓴다. competency(단수)는 옛 호출 호환용으로 남긴다. */
  /* 보낼 몸통 한 벌. draftJd(한 번에)와 draftJdStream(진행률)이 **같은 것**을 보내야
     한다 — 두 곳에서 따로 만들면 스트리밍일 때만 재료가 빠지는 식으로 갈린다. */
  function draftBody({ competency, competencies = null, company = '', jobTitle = '', question = '',
                       quotes = [], reads = '', frame = '', limit = 600, star = null, picks = null,
                       customRules = '' } = {}) {
    /* 활동 목록은 고른 경험이 있을 때만 함께 보낸다 — 안 골랐는데 보내면 서버 프롬프트가
       그 활동을 끌어다 성취담을 지어냈다(사용자 지적 2026-09-01). 서버도 hasStar 로 한 번
       더 거르지만, 안 보내면 프롬프트가 짧아지고 의도도 분명해진다. */
    const hasExp = (Array.isArray(picks) && picks.length > 0)
      || (star && Object.keys(star).length > 0);
    return {
      competency,
      competencies: Array.isArray(competencies) ? competencies : undefined,
      company, jobTitle, question, quotes, reads, frame, limit,
      /* 문항마다 고른 정성스펙(0~3개)의 {name, star}. 0개면 서버가 STAR 없이 쓴다.
         star(단일)는 옛 호환용으로 남긴다(picks 가 있으면 서버가 그쪽을 쓴다). */
      picks: Array.isArray(picks) ? picks : undefined,
      star,
      activities: hasExp ? (_mySpec?.activities || []) : [],
      /* 사용자가 켜 둔 '내 프롬프트'. 없으면 서버가 기본 규칙을 쓴다. */
      customRules: customRules || undefined,
    };
  }

  /* '내 프롬프트' 를 만들 때 출발점으로 쓸 기본 규칙 전문. */
  async function jdPromptTemplate({ limit = 1000, type = 'competency' } = {}) {
    return api('GET', `/api/jd/prompt-template?limit=${encodeURIComponent(limit)}&type=${encodeURIComponent(type)}`);
  }

  async function draftJd(args = {}) {
    return api('POST', '/api/jd/draft', draftBody(args));
  }

  /* 공고 없이 시작할 때의 작성 기준. 역량은 안 온다(공고에서 나오는 값이라
     없는 걸 지어 줄 수 없다) — 대신 STAR·체크리스트·검사 사전은 그대로 온다. */
  async function guideJd(company = '') {
    return api('GET', '/api/jd/guide' + (company ? `?company=${encodeURIComponent(company)}` : ''));
  }

  /* 지원동기 문단 초안 — 3단계에서 담아 온 회사 근거로 쓴다.
     draftJd 와 나눠 둔 이유는 서버와 같다(routes/jdCoach.js /motive 주석):
     증명 대상이 내 경험이 아니라 "왜 이 회사인가" 라 프롬프트가 통째로 다르다. */
  async function motiveJd({ company = '', jobTitle = '', question = '',
                            evidence = [], limit = 600, picks = null } = {}) {
    return api('POST', '/api/jd/motive', {
      company, jobTitle, question, evidence, limit,
      /* 이 문항에 고른 정성스펙(0~3개)의 {name, star}. 0개면 서버가 회사 근거만으로 쓰고
         지원자 경험은 지어내지 않는다(안 고른 활동이 섞여 나오던 문제 — 사용자 지적). */
      picks: Array.isArray(picks) ? picks : undefined,
    });
  }

  /* 채용공고 주소 → 본문. 복사를 막아 둔 공고 때문에 있다 — 그 차단은 브라우저에서만
     걸리므로 서버가 열면 원문이 그대로 온다.
     실패는 422 로 오고 kind 로 사유가 갈린다(blocked·image·empty·gone·bad-url).
     화면이 사유마다 다른 안내를 붙여야 하니 kind 를 에러에 실어 던진다. */
  async function jdPosting(url) {
    return api('POST', '/api/jd/posting', { url });
  }

  /* 이미지로 된 공고를 **직접 올려서** 읽는다(2026-09-08). 주소가 없는 경우가 실제로
     흔하다 — 카톡으로 받았거나 화면을 캡처해 둔 공고다.
     images = [{ name, mime, data(base64, 접두사 없이) }]. 응답 모양은 jdPosting 과 같다
     (text·weak·fromImage) — 화면이 같은 코드로 칸을 채운다. */
  async function jdPostingImage(images) {
    return api('POST', '/api/jd/posting-image', { images });
  }

  /* ── 고용24 직무별 자소서 작성가이드 ─────────────────────────
     직무기술서 칸을 채우는 재료다. 검색은 기업명 또는 직무명 하나로 받는다 —
     고용24 검색칸이 그렇게 생겼고, 두 칸으로 나누면 어느 쪽에 넣을지 사용자가
     고민해야 한다. 상세는 목록 행이 들고 온 번호(epa·rcit·guid)로 부른다. */
  async function jdGuideSearch(q, { year = '', page = 1 } = {}) {
    const p = new URLSearchParams({ q: q || '' });
    if (year) p.set('year', year);
    if (page > 1) p.set('page', String(page));
    return api('GET', `/api/jd/work24/guides?${p}`);
  }
  async function jdGuide({ epa, rcit = '1', guid = '1' }) {
    const p = new URLSearchParams({ epa, rcit, guid });
    return api('GET', `/api/jd/work24/guide?${p}`);
  }

  /* ── 자소서 기증(동의 기반 합격 코퍼스) ────────────────────────
     저장되는 본문은 서버가 다시 익명화한 것이다(routes/donations.js). 화면은 보내기
     전에 같은 규칙(anonymize.js)으로 미리 보여줄 뿐이다. */
  async function donationMeta() { return api('GET', '/api/donations/meta'); }
  async function donate(payload) { return api('POST', '/api/donations', payload); }
  async function donationStats({ job = '', qtype = '' } = {}) {
    const q = new URLSearchParams();
    if (job) q.set('job', job);
    if (qtype) q.set('qtype', qtype);
    return api('GET', '/api/donations/stats' + (q.toString() ? `?${q}` : ''));
  }
  async function donationsMine() { return api('GET', '/api/donations/mine'); }

  /* 취업 업종 트리 — 회사 찾기 첫 화면이 쓰는 목록.
     계열(company-sectors.js sectors())과 축이 다르다: 저건 KSIC 를 묶은 '계열' 이고
     여기는 사람인·잡코리아가 쓰는 말(게임·화장품·2차전지…)이다. 공공기관도 한 덩이로
     온다 — 예전에는 규모 필터를 공공으로 돌릴 때만 따로 받아왔다.
     middle(KECO 2차 분류 코드)을 주면 "이 직무를 주로 뽑는 업종"이 focus.minors 로 온다. */
  async function companyIndustryTree(middle, job) {
    if (!middle) return api('GET', '/api/company/industry-tree');
    const qs = `?middle=${encodeURIComponent(middle)}`
      + (job ? `&job=${encodeURIComponent(job)}` : '');
    return api('GET', '/api/company/industry-tree' + qs);
  }

  /* 기업분석 5단계 — 개요·재무·경쟁사(DART) + 최근이슈(뉴스).
     자소서 코치와 **따로** 부른다. 공고 없이 회사만 정해도 지원동기는 준비할 수 있고,
     뉴스·DART 는 외부 API 라 느려서 역량 분석까지 같이 붙들고 있으면 안 된다. */
  async function companyAnalysis(name) {
    return api('GET', '/api/company/analysis?name=' + encodeURIComponent(name));
  }

  /* '무엇을 하는 회사인가' 줄글 — 사업보고서 원문에서 뽑는다. 위 analysis 와 따로
     부르는 이유는 원문 ZIP 이 5~14MB 라 같이 묶으면 리포트 전체가 그만큼 늦기
     때문이다(routes/companyAnalysis.js 의 /business 주석). */
  async function companyBusiness(name) {
    return api('GET', '/api/company/business?name=' + encodeURIComponent(name));
  }

  /* ── 커리어 인사이트(커뮤니티 게시판) ─────────────────────────
     읽기는 비로그인도 된다(가격표와 같은 원칙 — mentoring.js FORMATS 주석).
     글쓰기·댓글·삭제만 로그인이 필요하고, 그 판단은 서버가 401/404 로 한다. */
  async function insightCategories() {
    return api('GET', '/api/insights/categories');
  }
  /* 홈 첫 화면의 편집 글 다섯 편. 목록 API 와 따로 두는 이유는 순서 때문이다 —
     최신순으로 받으면 누가 글을 쓸 때마다 편집 글이 밀려나고, 커버 사진이 글마다
     짝지어져 있어서 순서가 바뀌면 사진과 제목이 어긋난다. */
  async function insightFeatured() {
    return api('GET', '/api/insights/featured');
  }
  /* q(검색어) · scope('title' | 'all') 은 없으면 안 보낸다 — 서버 기본값이 있고,
     빈 값을 실어 보내면 주소가 지저분해져 어디까지가 실제 조건인지 안 보인다. */
  async function listInsights({ category = '', page = 1, limit = 20, q = '', scope = 'title',
                                bookmarked = false, sort = 'latest' } = {}) {
    const qs = new URLSearchParams({ page, limit });
    if (category) qs.set('category', category);
    if (q) { qs.set('q', q); qs.set('scope', scope); }
    /* 내 북마크만 보기. 로그인이 필요해서 서버가 401 을 줄 수 있고, 그 401 은
       **삼키지 않는다** — 화면이 '북마크가 없다' 와 '로그인이 필요하다' 를 갈라
       말해야 한다. */
    if (bookmarked) qs.set('bookmarked', '1');
    /* 최신순은 서버 기본값이라 안 보낸다 — 주소에 기본값이 붙어 있으면 '고른 것'
       처럼 보인다. */
    if (sort && sort !== 'latest') qs.set('sort', sort);
    return api('GET', '/api/insights?' + qs.toString());
  }
  async function getInsight(id) {
    return api('GET', '/api/insights/' + encodeURIComponent(id));
  }
  /* isNotice 는 관리자만 의미가 있다 — 서버가 권한을 확인하고, 아니면 조용히 무시한다. */
  /* promptText 는 'AI 프롬프트' 카테고리에서만 뜻이 있다 — 서버가 다른 카테고리면
     버린다(insight-prompt.js normalizePrompt). */
  async function createInsight({ category, title, body, isNotice = false, promptText }) {
    return api('POST', '/api/insights', { category, title, body, isNotice, promptText });
  }
  async function updateInsight(id, { title, body, isNotice, promptText }) {
    return api('PUT', '/api/insights/' + encodeURIComponent(id), { title, body, isNotice, promptText });
  }
  /* '내 프롬프트로 담기' — 실제 담기는 브라우저(JdCoach.addPrompt)가 하고,
     서버는 '가져간 사람 수'만 센다. 같은 사람이 다시 담아도 한 번이다. */
  async function copyInsightPrompt(id) {
    return api('POST', '/api/insights/' + encodeURIComponent(id) + '/copy');
  }
  /* 북마크 — 누를 때마다 켜고 끈다. 서버가 바뀐 상태와 총수를 돌려준다. */
  async function bookmarkInsight(id) {
    return api('POST', '/api/insights/' + encodeURIComponent(id) + '/bookmark');
  }
  /* 평점(1~5). 같은 점수를 다시 보내면 취소된다 — 잘못 눌렀을 때 무를 길이다. */
  async function rateInsight(id, score) {
    return api('POST', '/api/insights/' + encodeURIComponent(id) + '/rating', { score });
  }
  async function deleteInsight(id) {
    return api('DELETE', '/api/insights/' + encodeURIComponent(id));
  }
  async function addInsightComment(postId, body) {
    return api('POST', '/api/insights/' + encodeURIComponent(postId) + '/comments', { body });
  }
  async function deleteInsightComment(postId, commentId) {
    return api('DELETE', '/api/insights/' + encodeURIComponent(postId) + '/comments/' + encodeURIComponent(commentId));
  }

  // ── 쓰기 (비동기) ──────────────────────────────────────────
  /* nickname 을 빠뜨리지 말 것. 화면·서버 양쪽 다 받는데 여기서만 안 실어
     보내서, 가입할 때 적은 닉네임이 조용히 사라지고 스펙 입력창에서 다시
     적어야 했다. 인자에서 흘리는 실수라 에러도 안 난다. */
  /* 아이디 중복확인. 여기서는 실패를 삼키지 않는다 — 자동완성과 달리 결과가
     "사용 가능" 으로 잘못 보이면 그대로 제출되고 서버에서 409 로 튕긴다. */
  async function checkUsername(username) {
    return api('GET', '/api/auth/check-username?username=' + encodeURIComponent(username));
  }

  /* 본인확인 — 쓸 수 있는 상태인지 먼저 묻는다. 운영인데 키가 없으면
     'available: false' 라 화면이 인증 단계를 통째로 건너뛴다. */
  async function verifyStatus() {
    try { return await api('GET', '/api/verify/status'); }
    catch { return { available: false }; }
  }
  async function verifyRequest() {
    return api('POST', '/api/verify/request', { returnUrl: location.href });
  }

  async function createUser({ username, password, name, nickname, email, role, verifyToken }) {
    const { user } = await api('POST', '/api/auth/signup',
      { username, password, name, nickname, email, role, verifyToken });
    return user;
  }

  /* 예전에는 authenticate() 로 검증하고 login() 으로 세션을 만들었다.
     서버에서는 한 번의 요청이다. */
  async function login(username, password) {
    const { user } = await api('POST', '/api/auth/login', { username, password });
    _me = user;
    await refreshSpecs();
    return user;
  }

  /* 소셜 가입 직후 멘토/멘티·닉네임을 채운다. 성공하면 캐시된 회원 정보도 갱신해야
     화면이 곧바로 로그인 상태(역할 포함)로 보인다. */
  async function completeOnboarding({ role, nickname, verifyToken }) {
    const { user } = await api('POST', '/api/auth/onboarding', { role, nickname, verifyToken });
    _me = user;
    await refreshSpecs();
    return user;
  }

  /* 결제 승인 — 결제창에서 돌아온 값을 서버로 넘겨 확정한다.
     승인은 반드시 서버가 한다(프론트에서 '성공' 이라고 말만 하면 통과하면 안 된다). */
  async function confirmPayment({ paymentKey, orderId, amount }) {
    return api('POST', '/api/payments/confirm', { paymentKey, orderId, amount });
  }

  /* 회원 탈퇴 — 되돌릴 수 없다. 성공하면 서버가 세션 쿠키를 지우므로
     여기서도 캐시를 비운다(안 비우면 로그인된 것처럼 보인다). */
  async function withdraw({ password, username }) {
    await api('POST', '/api/auth/withdraw', { password, username });
    _me = null;
    _mySpec = null;
  }

  /* 비밀번호 변경. 캐시(_me)에는 비밀번호가 없으므로 비울 것이 없고,
     서버가 세션을 유지하므로 로그인 상태도 그대로다. */
  async function changePassword({ currentPassword, newPassword }) {
    await api('POST', '/api/auth/password', { currentPassword, newPassword });
  }

  async function logout() {
    await api('POST', '/api/auth/logout');
    _me = null;
    _mySpec = null;
    /* 스펙 캐시도 다시 받는다. /api/specs 는 **로그인한 사람에게만 닉네임을 싣는데**,
       캐시를 그대로 두면 로그아웃한 뒤에도 화면(CAS 순위)에 닉네임이 남아 있는다.
       서버는 이미 안 주고 있는데 화면만 옛 데이터를 계속 보여주는 상태가 된다. */
    await refreshSpecs();
  }

  async function updateUser(patch) {
    const { user } = await api('PUT', '/api/users/me', patch);
    _me = user;
    return user;
  }

  /* 멘토⇄멘티 전환 신청. 실패하면(대기 기간 미충족·이미 신청 중) 서버 메시지를
     그대로 던진다 — 호출부(spec-form.js)가 상태 문구로 보여준다. */
  async function requestRoleChange() {
    const { user } = await api('POST', '/api/users/me/role-change');
    _me = user;
    return user;
  }

  async function upsertSpec(spec) {
    await api('PUT', '/api/specs/me', spec);
    await refreshSpecs();
  }

  /* 활동 하나의 STAR 만 저장한다(스펙 관리의 'STAR 저장' 버튼).
     upsertSpec 을 쓰지 않는 이유 — 그쪽은 **보낸 것으로 전체를 교체**해서, 지금 화면에
     안 들어 있는 값까지 덮는다. 저장 뒤 _mySpec 을 곧바로 갈아 끼운다: 자소서 코치가
     이 값을 읽는데, 새로고침해야 보이면 "적었는데 안 뜬다"가 된다(실제 지적). */
  async function saveActivityStar(index, star, type) {
    const r = await api('PUT', `/api/specs/me/activities/${index}/star`, { star, type });
    if (r?.spec) _mySpec = r.spec;
    return r;
  }

  /* 프로필(학교 등)은 스펙과 다른 테이블이다. 스펙 폼에서 함께 저장하지만
     통계에 쓰이는 값이 아니라 refreshSpecs 를 부르지 않는다. */
  async function getProfile() {
    try { return (await api('GET', '/api/profile')).profile || null; }
    catch { return null; }
  }
  async function updateProfile(patch) {
    const { profile } = await api('PUT', '/api/profile', patch);
    return profile;
  }

  // ── 백오피스 (개발 전용 — 운영에서는 서버가 404 로 막는다) ──
  async function seedDemo() { await api('POST', '/api/admin/seed');  await refreshSpecs(); await refreshUsers(); }
  async function seedRandom(count = 50) {
    const r = await api('POST', '/api/admin/seed-random', { count });
    await refreshSpecs(); await refreshUsers();
    return r;
  }
  async function clearAll() { await api('POST', '/api/admin/clear'); _me = null; _mySpec = null; await refreshSpecs(); await refreshUsers(); }
  async function deleteUser(username) {
    await api('DELETE', `/api/admin/users/${encodeURIComponent(username)}`);
    if (_me?.username === username) { _me = null; _mySpec = null; }
    await refreshSpecs(); await refreshUsers();
  }

  return {
    hydrate, refreshSpecs, refreshUsers,
    currentUser, getAllSpecs, getSpec, myActivities, getUsers, countByRole, stats,
    checkUsername, verifyStatus, verifyRequest,
    createUser, login, logout, withdraw, changePassword, completeOnboarding, confirmPayment, updateUser, requestRoleChange, upsertSpec, saveActivityStar, getProfile, updateProfile,
    classifyCompany, suggestCompanies, suggestCerts, recommendCerts, suggestMajors, suggestUniversities, classifyMajor, jobCatalog,
    mentors,
    analyzeCas, casFit, specFingerprint, coachJd, draftJd, motiveJd, guideJd, jdPromptTemplate, companyAnalysis, companyBusiness, companyIndustryTree, jdPosting, jdPostingImage, jdGuideSearch, jdGuide,
    donationMeta, donate, donationStats, donationsMine,
    specupExams, specupActivities,
    insightCategories, insightFeatured, listInsights, getInsight, createInsight, updateInsight, deleteInsight,
    copyInsightPrompt, bookmarkInsight, rateInsight,
    addInsightComment, deleteInsightComment,
    seedDemo, seedRandom, clearAll, deleteUser,
  };
})();
