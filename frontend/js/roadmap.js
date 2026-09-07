/* ════════════════════════════════════════════════════════════
   커리어 로드맵 — 흐름 상태 (C:road)

   로드맵은 화면 하나가 아니라 **네 화면을 가로지르는 흐름**이다.

     ① 직무 찾기(#career) → ② 지금 내 위치(#dashboard·CAS)
       → ③ 지원할 회사(#company) → ④ 자소서 코치(#jd)

   ②에서 부족한 것이 보이면 스펙 채우기(#mypage/spec)로 갔다가 ②로 돌아온다.
   앞으로 가는 단계가 아니라 **되돌아오는 곁가지**라 스텝바에 칸을 주지 않는다 —
   칸을 주면 "스펙을 채워야 다음으로 갈 수 있다"로 읽힌다.

   ── 이 파일이 필요한 이유 ──
   네 화면이 각자 자기 상태만 들고 있으면 흐름이 성립하지 않는다. 실제로 지금까지
   career.js 의 고른 직무를 CAS 가 몰랐고, CAS 는 자기 나름의 '비교 직무' 를 따로
   골랐다. 같은 사람이 같은 순간에 두 직무를 목표로 갖는 셈이라, 두 화면의 숫자가
   왜 다른지 설명할 수 없었다. **고른 직무를 한 곳에 두는 것**이 이 파일의 전부다.

   ── 저장 위치가 둘인 이유 ──
   | 무엇 | 어디에 | 왜 |
   |---|---|---|
   | 1차·2차 분류 (목표 직무) | **서버** (`spec.jobMajor` / `jobMiddles`) | 기기를 바꿔도 목표는 남아야 한다. 스펙 입력 폼과 같은 칸이라 새 컬럼이 필요 없다 |
   | 직업 코드·이름, 고른 회사 | 브라우저 (localStorage) | 화면 이동 중의 문맥이다. 통계·집계에 쓰이지 않으므로 서버에 둘 이유가 없다 |

   ── 해상도를 속이지 않는다 ──
   직무 찾기는 직업 461개 단위지만, **선배 스펙 통계와 CAS 벤치마크는 2차 분류
   (35개) 단위**다. 461개로 쪼개면 표본이 한 자릿수로 내려가 평균이 뜻을 잃는다
   (career.js renderRoadmap 주석과 같은 판단). 그래서 bench() 는 2차 분류로 집계하고,
   화면은 "○○ 직무군 기준" 이라고 그대로 적는다.
   ════════════════════════════════════════════════════════════ */
(function (root) {

  const LS_KEY = 'careerly_roadmap_v1';

  /* ── 기업분류(대·중견·중소·공)는 직무와 **다른 키**에 둔다 ─────────
     1단계에서 직무와 함께 고르는 값이지만, 흐름 안에서의 성격이 다르다.

     · 직무를 바꿔도 "대기업에 가고 싶다" 는 안 바뀐다. 같은 객체에 넣으면
       setJob 이 회사를 버릴 때 같이 휩쓸리기 쉽다(실제로 company 가 그렇게 버려진다).
     · read() 는 middle 이 없으면 상태 자체를 null 로 본다 — 집계를 못 하니까.
       기업분류만 먼저 고른 상태는 그 규칙에 걸려 저장되지 않는다.

     서버가 아니라 localStorage 인 이유는 company 와 같다(17-3) — 스펙 스키마의
     corpType 은 **선배가 다닌 회사의 규모**라서 목표를 적을 칸이 아니다. 목표를
     서버에 남기려면 컬럼이 하나 필요한데, 그건 이 작업의 범위가 아니다. */
  const LS_CORP = 'careerly_roadmap_corptype_v1';

  /* id 는 Aggregator.CORP_TYPES · company-classify.js 의 CORP_TYPE_ID 와 같은 값이다.
     화면은 'public' 을 '공기업' 으로 부르고 회사 목록은 '공공기관' 으로 부르는데,
     둘 다 같은 것을 가리킨다(공공기관 명단이 공기업·준정부기관·기타공공기관을 다 담는다). */
  const CORP_TYPES = [
    { id: 'large',  label: '대기업' },
    { id: 'mid',    label: '중견기업' },
    { id: 'small',  label: '중소기업' },
    { id: 'public', label: '공공기관' },
  ];
  const CORP_LABEL = new Map(CORP_TYPES.map(c => [c.id, c.label]));

  /* 스텝바의 칸. page 는 app.js 의 PAGES 값이다. */
  const STEPS = [
    { id: 'job',     no: 1, label: '직무 찾기',    page: 'career',    hint: '관심 직무를 고르고 필요한 스펙을 봅니다' },
    { id: 'me',      no: 2, label: '지금 내 위치', page: 'dashboard', hint: '그 직무 선배와 비교한 내 CAS 점수' },
    { id: 'company', no: 3, label: '지원할 회사',  page: 'company',   hint: '그 직무를 뽑는 계열에서 회사를 고릅니다' },
    { id: 'cover',   no: 4, label: '자소서 코치',  page: 'jd',        hint: '고른 회사·공고로 자소서를 씁니다' },
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── 조사 ────────────────────────────────────────────────────
     직무·회사 이름을 문장에 끼워 넣는 자리가 여럿이다. '을(를)' 로 적어 두면
     **'응용소프트웨어개발자을(를)'** 처럼 읽힌다 — 데이터로 문장을 만드는 화면에서
     이 표기가 남아 있으면 만든 티가 그대로 난다.

     받침(종성)으로 고른다. 한글 음절은 0xAC00 부터 28개씩 묶여 있어서
     (코드 - 0xAC00) % 28 이 0이면 받침이 없다. 8은 'ㄹ' — '(으)로' 만 예외로
     'ㄹ' 받침을 받침 없는 것처럼 다룬다('서울로', '개발로').

     한글로 끝나지 않으면(영문 사명 'SK', 숫자) 받침을 알 수 없으므로 둘 다 적는다 —
     찍어서 틀리느니 '(를)' 을 남기는 편이 낫다. */
  const JOSA = {
    을: ['를', '을'], 은: ['는', '은'], 이: ['가', '이'], 과: ['와', '과'], 로: ['로', '으로'],
  };
  function josa(word, kind) {
    const pair = JOSA[kind];
    if (!pair) return '';
    const ch = String(word ?? '').trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (!(code >= 0xac00 && code <= 0xd7a3)) return `${pair[0]}(${pair[1]})`;
    const jong = (code - 0xac00) % 28;
    const hasBatchim = kind === '로' ? (jong !== 0 && jong !== 8) : jong !== 0;
    return pair[hasBatchim ? 1 : 0];
  }
  /* 이름 + 조사를 한 덩어리로. 호출부가 esc 를 잊지 않게 여기서 같이 한다. */
  const withJosa = (word, kind) => `${esc(word)}${josa(word, kind)}`;

  // ── 상태 ────────────────────────────────────────────────────
  let state = null;

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY));
      return raw && raw.middle ? raw : null;     // 2차 분류가 없으면 집계를 못 한다 = 없는 것과 같다
    } catch { return null; }
  }
  function write(next) {
    state = next;
    try {
      if (next) localStorage.setItem(LS_KEY, JSON.stringify(next));
      else localStorage.removeItem(LS_KEY);
    } catch { /* 사파리 프라이빗 모드 등 — 이번 세션 동안은 메모리로 버틴다 */ }
  }

  const get = () => (state !== null ? state : (state = read()));
  const hasJob = () => Boolean(get());
  const company = () => get()?.company || null;

  /* 직무를 고른다. 로드맵 1단계의 결론이자 나머지 세 단계 전부의 입력이다.

     회사는 같이 지우는데, 직무가 바뀌면 예전 직무를 보고 고른 회사는 근거를 잃기
     때문이다. 남겨 두면 4단계에서 "왜 이 회사지?" 가 된다. */
  function setJob({ major, middle, job, majorName, middleName, jobName, avgWage }) {
    if (!middle) return get();
    const prev = get();
    const changedJob = !prev || prev.middle !== middle || prev.job !== job;
    write({
      major: String(major ?? ''), middle: String(middle), job: job ? String(job) : null,
      majorName: majorName || '', middleName: middleName || '', jobName: jobName || '',
      avgWage: avgWage ?? null,
      company: changedJob ? null : (prev?.company ?? null),
      at: Date.now(),
    });
    syncGoalToSpec();
    return state;
  }

  function setCompany(name) {
    const cur = get();
    if (!cur) return null;                        // 직무 없이 회사만 있는 상태는 만들지 않는다
    write({ ...cur, company: name || null });
    return state;
  }

  function clear() { write(null); }

  /* ── 기업분류 ────────────────────────────────────────────────
     1단계(직무 찾기)가 고른 값을 3단계(지원할 회사)가 읽는다. 지금은 1단계에
     그 칸이 없어서 늘 null 이고, **null 이면 3단계는 지금까지처럼 전체를 보여준다** —
     팀원 작업이 붙기 전에도 화면이 멀쩡히 돌아가야 한다.

     1단계에서는 `Roadmap.setCorpType('large')` 한 줄만 부르면 된다.
     모르는 값은 받지 않는다 — 오타 하나가 '아무 회사도 안 나오는 목록' 이 되고,
     그건 화면만 봐서는 필터 탓인지 데이터 탓인지 알 수 없다. */
  let corpState;                       // undefined = 아직 안 읽음 (null 은 '고르지 않음')

  function corpType() {
    if (corpState === undefined) {
      let raw = null;
      try { raw = localStorage.getItem(LS_CORP); } catch { /* 프라이빗 모드 */ }
      corpState = CORP_LABEL.has(raw) ? raw : null;
    }
    return corpState;
  }

  function setCorpType(id) {
    const next = CORP_LABEL.has(id) ? id : null;
    corpState = next;
    try {
      if (next) localStorage.setItem(LS_CORP, next);
      else localStorage.removeItem(LS_CORP);
    } catch { /* 이번 세션 동안은 메모리로 버틴다 */ }
    return next;
  }

  const corpLabel = () => CORP_LABEL.get(corpType()) || null;

  /* ══ 담은 근거 ══════════════════════════════════════════════
     3단계(회사 리포트)에서 담고 4단계(자소서 코치)가 쓴다. 딱 흐름 상태라 여기 둔다 —
     예전에는 두 화면이 같은 localStorage 키를 **각자 파싱**했다. 키 이름이나 모양을
     한쪽에서 바꾸면 다른 쪽은 조용히 빈 목록을 보게 되는 배치였다.

     ── 종류를 붙이는 것이 이 구조의 핵심이다 ──
     예전에도 담기가 기사·실적·직원수에 다 있었는데 없앴다. 담은 것들이 서로 다른
     종류인 채로 한 통에 들어가서, 4단계로 넘어가면 **무엇을 어느 문항에 쓰라는
     것인지 알 수 없었기** 때문이다(company-cover.js 옛 주석).

     그래서 이번에는 담을 때 종류를 같이 적고, 종류마다 **어느 문항에 쓰는지**를
     화면이 말한다. 담는 대상을 넓히는 것과 쓰임을 밝히는 것은 한 몸이다 —
     쓰임 없이 넓히면 예전 상태로 되돌아간다. */
  const LS_EVIDENCE = 'careerly_company_evidence_v1';

  const EVIDENCE_KINDS = {
    /* ── use 는 자소서 **문항 유형** 이름이다 ─────────────────────
       값은 jd-coach.js 의 QUESTION_TYPES[].label 과 **글자까지 같아야 한다** —
       4단계가 그 이름으로 대조해서 "이 문항에는 이 근거" 를 고른다. 한 글자만
       달라도 에러 없이 '해당 근거 없음' 으로만 보인다.
       ('입사 후 포부' 는 따로 두지 않는다 — QUESTION_TYPES 의 '지원동기' 규칙이
        `입사\s*후|포부` 까지 같이 잡아서, 별도 이름을 만들면 아무 문항에도 안 붙는다.) */
    job:  { label: '채용공고',  use: ['직무역량'], hint: '이 공고가 요구하는 역량으로 분석합니다' },
    biz:  { label: '사업 내용', use: ['지원동기'], hint: '회사가 무엇으로 버는지 — "왜 우리 회사인가" 의 바탕' },
    fact: { label: '회사 숫자', use: ['지원동기'], hint: '규모·실적처럼 자소서에 그대로 인용할 수 있는 값' },
    news: { label: '최근 기사', use: ['지원동기'], hint: '지금 이 회사가 하고 있는 일 — 입사 후 포부의 재료이기도 하다' },
  };
  const EVIDENCE_ORDER = ['job', 'biz', 'fact', 'news'];

  function allEvidence() {
    try { return JSON.parse(localStorage.getItem(LS_EVIDENCE)) || {}; } catch { return {}; }
  }

  /* 옛 항목에는 kind 가 없다 — 그때는 담는 대상이 채용공고 하나뿐이었다.
     지우지 않고 'job' 으로 읽는다. 담아 둔 공고가 갱신 한 번에 사라지면
     사용자는 우리가 지운 줄 모르고 자기가 잘못한 줄 안다. */
  const withKind = e => (e && !e.kind ? { ...e, kind: 'job' } : e);

  function evidenceOf(company) {
    if (!company) return [];
    return (allEvidence()[company] || []).filter(Boolean).map(withKind);
  }

  /* 종류별로 나눠 준다. 화면 셋(3단계 게이지·4단계 근거 칸·초안 탭)이 전부
     이 모양을 쓴다 — 각자 groupBy 를 쓰면 순서가 갈린다. */
  function evidenceByKind(company) {
    const list = evidenceOf(company);
    return EVIDENCE_ORDER
      .map(kind => ({ kind, ...EVIDENCE_KINDS[kind], items: list.filter(e => e.kind === kind) }))
      .filter(g => g.items.length);
  }

  /* 문항 유형 하나에 쓸 근거만. 4단계가 "이 문항에는 이걸 쓰세요" 를 말하는 데 쓴다. */
  function evidenceFor(company, questionType) {
    return evidenceOf(company)
      .filter(e => (EVIDENCE_KINDS[e.kind]?.use || []).includes(questionType));
  }

  function saveEvidence(company, list) {
    const all = allEvidence();
    if (list.length) all[company] = list; else delete all[company];
    try { localStorage.setItem(LS_EVIDENCE, JSON.stringify(all)); } catch { /* 프라이빗 모드 */ }
    return list;
  }

  /* 같은 것을 두 번 담지 않는다. id 는 담는 쪽이 만든다(기사 URL·계정 이름처럼
     그 항목을 가리키는 값). */
  function addEvidence(company, item) {
    if (!company || !item?.id) return evidenceOf(company);
    const list = evidenceOf(company);
    if (list.some(e => e.id === item.id)) return list;
    const next = [...list, { kind: 'job', ...item }];
    saveEvidence(company, next);
    return next;
  }

  function removeEvidence(company, id) {
    const next = evidenceOf(company).filter(e => e.id !== id);
    saveEvidence(company, next);
    return next;
  }

  /* ── 목표 직무를 스펙에 반영 ──────────────────────────────────
     로그인·스펙이 없으면 조용히 건너뛴다(로드맵은 비로그인도 돌아간다).

     ── 남이 고른 것을 말없이 지우지 않는다 ──
     스펙 입력 폼의 '세부직무' 는 다중선택이다. 로드맵에서 고른 하나로 통째로
     덮어쓰면 거기서 고른 나머지가 사라지는데, 에러가 안 나서 다시 열어 볼 때까지
     모른다(6-3 '조용히 틀리는 곳'과 같은 부류). 그래서
       · 같은 1차 분류 안이면 → 기존 목록에 **더한다**
       · 1차 분류가 바뀌면    → 그건 진짜 목표 변경이므로 교체하고 **화면에 알린다**
     둘 다 되돌리는 곳(마이페이지)을 함께 안내한다. */
  async function syncGoalToSpec() {
    const cur = get();
    const me = root.DB?.currentUser?.();
    if (!cur || !me) return;

    const spec = root.DB.getSpec(me.username);
    const sameMajor = spec?.jobMajor && String(spec.jobMajor) === cur.major;
    const prevMids = Array.isArray(spec?.jobMiddles) ? spec.jobMiddles.map(String) : [];

    if (sameMajor && prevMids.includes(cur.middle)) return;   // 이미 목표에 들어 있다

    const nextMids = sameMajor ? [...new Set([...prevMids, cur.middle])] : [cur.middle];
    try {
      await root.DB.upsertSpec({ jobMajor: cur.major, jobMiddles: nextMids });
      const label = cur.middleName || '이 직무';
      if (typeof root.toast === 'function') {
        root.toast(sameMajor
          ? `목표 직무에 '${label}' 을(를) 추가했어요.`
          : `목표 직무를 '${label}' 으로 바꿨어요. 마이페이지 > 스펙에서 되돌릴 수 있어요.`);
      }
    } catch {
      /* 저장에 실패해도 이번 세션의 흐름은 그대로 간다(localStorage 에는 남았다).
         알리기는 한다 — 조용히 실패하면 기기를 바꿨을 때 목표가 사라진 이유를 모른다. */
      if (typeof root.toast === 'function') {
        root.toast('목표 직무를 저장하지 못했어요. 이 브라우저에서는 그대로 이어집니다.', { icon: false });
      }
    }
  }

  /* ── 집계 기준 ────────────────────────────────────────────────
     career.js STEP 03 과 **같은 함수**로 같은 선배 표본을 고른다. 두 화면이 다른
     모집단을 쓰면 "로드맵에서는 평균 이상인데 CAS 는 낮다" 같은 설명 불가능한
     상태가 된다(cas-hero.js 가 레이더와 벤치마크를 맞춰 둔 것과 같은 이유).

     KECO 트리를 아직 안 받았으면 null. 호출부는 KECO.load() 를 먼저 하거나,
     null 일 때의 화면(옛 학과 기준)을 그대로 쓰면 된다. */
  function bench() {
    const cur = get();
    if (!cur || !root.KECO?.ready?.()) return null;
    const where = root.KECO.middleMatcher(cur.major, cur.middle);
    if (!where) return null;                       // legacy 매핑이 없는 2차 분류 — 집계 대상이 없다
    return {
      where,
      certKey: `keco:${cur.major}:${cur.middle}`,
      middle: cur.middle,
      middleName: cur.middleName,
      jobName: cur.jobName,
      label: `${cur.middleName} 직무군`,
    };
  }

  /* 목표 직무군을 갈아 끼운다. 직업 단위 선택은 비운다 — '반도체공학기술자' 를 고른
     채 직무군만 금융으로 바꾸면 이름이 거짓말이 된다.

     ── majorCode 를 받는 이유 ──
     CAS 의 '비교 직무' 셀렉트는 같은 1차 분류의 형제만이 아니라 **35개 직무군 전부**를
     담는다. 형제만 담으면 형제가 하나뿐인 분류에서는 고를 것이 없고(그게 그 칸이
     비어 보이던 원인 중 하나였다), 목표 직무가 아직 없는 사람은 시작점조차 없다.
     그래서 1차 분류까지 옮길 수 있게 하고, 안 주면 예전처럼 지금 1차 분류 안에서만
     바꾼다. */
  function switchMiddle(middleCode, majorCode) {
    const cur = get();
    if (!root.KECO?.ready?.()) return cur;
    const majorId = majorCode || cur?.major;
    if (!majorId) return cur;

    const maj = root.KECO.byId(majorId);
    const m = root.KECO.middleById(majorId, middleCode);
    if (!maj || !m) return cur;
    /* 고른 것을 다시 고른 경우 — 그냥 통과시키면 아래 setJob 이 직업 선택을 비워서
       목표 칩의 '백엔드 개발자' 가 조용히 '정보통신 연구개발직' 으로 뭉개진다. */
    if (cur && cur.major === majorId && cur.middle === m.code) return cur;

    return setJob({
      major: maj.code, middle: m.code, job: null,
      majorName: maj.name, middleName: m.name, jobName: '',
      avgWage: m.wageRange?.avg ?? null,
    });
  }

  // ── 스텝바 ──────────────────────────────────────────────────
  /* 네 화면 맨 위에 같은 줄이 뜬다. 어디에 있든 흐름 안의 위치가 보이는 것이
     '유기적으로 이어진다' 의 실체다.

     ── 앞 단계를 잠그지 않는다 ──
     직무를 안 골랐어도 다음 칸을 누를 수 있다. 상단 네비에 CAS·회사 찾기가 그대로
     있어서, 스텝바만 막으면 "네비로는 되는데 여기서는 안 되는" 화면이 된다.
     대신 흐릿하게 두고, 각 화면이 "직무를 고르면 이 직무 기준으로 계산해 드려요"
     라고 스스로 안내한다. */
  /* 어느 칸에 체크를 붙일지 — **추측하지 않고 남은 흔적으로만** 정한다.
     "회사를 골랐으니 2단계도 지났겠지" 같은 추론을 넣으면, 네비로 3단계에 바로
     들어온 사람에게 하지도 않은 일이 완료로 찍힌다.

     | 단계 | 완료의 근거 |
     |---|---|
     | 1 직무 찾기 | 고른 직무가 있다 |
     | 2 지금 내 위치 | 내 스펙이 입력돼 있다(= 점수를 낼 수 있는 상태) |
     | 3 지원할 회사 | 고른 회사가 있다 |
     | 4 자소서 코치 | **아직 근거가 없다** — 초안 저장이 붙으면 그때(B19) */
  function doneMap(cur) {
    let hasSpec = false;
    try {
      const me = root.DB?.currentUser?.();
      hasSpec = Boolean(me && root.DB.getSpec(me.username)?.dept);
    } catch { /* DB 가 아직 없으면 미완료로 둔다 */ }
    return { job: Boolean(cur), me: hasSpec, company: Boolean(cur?.company), cover: false };
  }

  function stepBar(activeId) {
    const cur = get();
    const activeNo = (STEPS.find(s => s.id === activeId) || {}).no || 0;
    const isDone = doneMap(cur);

    const cells = STEPS.map(s => {
      const done = isDone[s.id] && s.no < activeNo;
      const cls = [
        'rm-step',
        s.id === activeId ? 'is-active' : '',
        done ? 'is-done' : '',
        !cur && s.no > 1 ? 'is-waiting' : '',
      ].filter(Boolean).join(' ');
      return `
        <button type="button" class="${cls}" onclick="navigate('${s.page}')" title="${esc(s.hint)}">
          <span class="rm-step-no">${done ? '<i class="ti ti-check"></i>' : s.no}</span>
          <span class="rm-step-label">${esc(s.label)}</span>
        </button>`;
    }).join('<span class="rm-step-sep" aria-hidden="true"></span>');

    return `
      <nav class="rm-bar" aria-label="진행 단계">
        <div class="rm-bar-inner">
          <div class="rm-steps">${cells}</div>
          ${goalChip(cur, activeId)}
        </div>
      </nav>`;
  }

  /* 지금 목표가 무엇인지 스텝바 오른쪽에 붙인다. 네 화면 어디서든 같은 문장이
     보여야 "이 화면이 그 직무 얘기를 하고 있다" 가 성립한다.

     ── '바꾸기' 는 직무 찾기 화면에서는 뺀다 (사용자 지시) ──
     그 링크가 하는 일이 navigate('career') 인데, 직무 찾기(#career)에서 누르면
     지금 보고 있는 화면으로 다시 온다. 아무 일도 안 일어나는 버튼이라 "눌렀는데
     안 되네" 로 읽히고, 바로 아래에 분류를 고르는 격자가 이미 깔려 있어서 안내로도
     필요 없다. 나머지 세 화면(CAS·회사·자소서)에서는 여기가 유일한 되돌아가는
     길이므로 그대로 둔다. */
  function goalChip(cur, activeId) {
    const onJobPage = activeId === 'job';
    if (!cur) {
      return `<span class="rm-goal rm-goal--empty">
        <i class="ti ti-target"></i> 목표 직무 없음
        ${onJobPage ? '' : `<a onclick="navigate('career')">고르기</a>`}
      </span>`;
    }
    const name = cur.jobName || cur.middleName;
    const sub = cur.jobName && cur.middleName && cur.jobName !== cur.middleName
      ? `<span class="rm-goal-sub">${esc(cur.middleName)} 직무군</span>` : '';
    return `<span class="rm-goal">
      <i class="ti ti-target"></i>
      <b>${esc(name)}</b>${sub}
      ${cur.company ? `<span class="rm-goal-co">· ${esc(cur.company)}</span>` : ''}
      ${onJobPage ? '' : `<a onclick="navigate('career')">바꾸기</a>`}
    </span>`;
  }

  /* 페이지 맨 위에 스텝바를 끼운다. 화면마다 `<div class="rm-bar-host">` 하나만
     두면 되고, 페이지를 다시 그릴 때마다 호출해도 안전하다(통째로 교체한다). */
  function mount(hostId, activeId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = stepBar(activeId);
  }

  /* 다음 단계로 가는 버튼의 문구 — 화면마다 손으로 적으면 흐름 이름이 갈린다. */
  function nextLabel(fromId) {
    const i = STEPS.findIndex(s => s.id === fromId);
    const n = STEPS[i + 1];
    return n ? `${n.label}(으)로 →` : null;
  }
  function goNext(fromId) {
    const i = STEPS.findIndex(s => s.id === fromId);
    const n = STEPS[i + 1];
    if (n && typeof root.navigate === 'function') root.navigate(n.page);
  }

  const api = {
    STEPS, LS_KEY, LS_CORP, LS_EVIDENCE, CORP_TYPES, EVIDENCE_KINDS, EVIDENCE_ORDER,
    get, hasJob, company, setJob, setCompany, clear,
    corpType, setCorpType, corpLabel,
    evidenceOf, evidenceByKind, evidenceFor, addEvidence, removeEvidence, allEvidence,
    bench, switchMiddle, syncGoalToSpec,
    stepBar, mount, goalChip, nextLabel, goNext,
    josa, withJosa,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // node 테스트용
  root.Roadmap = api;

})(typeof window !== 'undefined' ? window : globalThis);
