/* ════════════════════════════════════════════════════════════
   C:road — 자소서 코치 (직무기술서 → 요구역량 → 작성 가이드)

   화면 규칙 두 개만 지키면 이 페이지는 신뢰를 잃지 않는다:
     1) 역량마다 **공고 원문 근거 문장**을 같이 보여준다. 자동 추출은 반드시
        오탐이 섞이는데, 근거가 보이면 사용자가 스스로 걸러낼 수 있다.
     2) 완성된 자소서 문장을 주지 않는다는 것을 화면에 적어 둔다(서버가 문구를 준다).
        대필로 오해하면 그대로 베껴 쓰고, 유사도 검사에 걸린다.

   ── 화면 구조 ──────────────────────────────────────────────
   입력부는 **문서형**이다. rows 를 고정하지 않고 내용만큼 자라며, 다 쓴 칸은
   접힌다. 접힌 칸도 첫 두 줄과 글자수를 남겨서 "내가 뭘 넣었는지"를 펼치지 않고
   확인할 수 있다. 왼쪽 사이드바가 '입력 항목' 목록이자 확인 표시(점)를 겸하고,
   그 아래 '분석 준비' 막대 하나가 전체가 얼마나 찼는지를 말한다.

   결과부는 **좌우 2단**이다. 왼쪽은 요구 역량 하나로 합친 목록(예전에는 요구역량
   카드와 문항별 직무역량 카드가 따로 나와 같은 말을 두 번 읽어야 했다), 오른쪽은
   자소서 초안 에디터. 둘 다 화면에 남아 있어서, 역량을 보면서 그 자리에서 쓴다.
   왼쪽 맨 위 키워드 칩을 누르면 그 역량으로 바꿔 가며 볼 수 있다.
   ════════════════════════════════════════════════════════════ */
/* cas.js 와 같은 이중 노출 — 브라우저에서는 window.JdCoach, node 에서는 module.exports.
   문항 분류 규칙(classifyQuestion)을 화면 없이 테스트하기 위해서다. DOM 은 함수 안에서만
   건드리므로 로드 시점에는 document 가 없어도 된다. */
(root => {
  const $ = sel => document.querySelector(sel);

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* lead 문구에만 **강조** 를 쓴다(서버가 활동 이름을 그렇게 감싼다).
     escape 를 먼저 하고 나서 강조를 풀어야 XSS 가 되지 않는다. */
  const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  /* 로그인 여부 — 역량 분석 게이트와 화면 안내가 같이 읽는다. DB 는 브라우저 전역이라
     node 테스트(window 없음)에서는 부르지 않는다(run 은 화면에서만 돈다). */
  const isLoggedIn = () => !!(root.DB && DB.currentUser && DB.currentUser());

  let _last = null;         // 마지막 결과 — 다시 그릴 때 재요청하지 않는다
  let _lastCompany = '';    // _last 를 뽑은 회사 — 작성 화면(#write)에서 회사가 바뀌면 역량 참고를 끈다
  let _focused = 0;         // 지금 펼친 역량 index
  let _tab = 0;             // 지금 쓰고 있는 초안 탭 index
  let _lastTabs = [];       // 지금 그려진 초안 탭 — AI 초안이 문항 문구를 같이 보낸다
  /* 지금 작업 화면이 어디에 그려졌나 — 분석(#jd-result)이냐 작성(#write-root)이냐.
     focusItem 이 역량 상세를 다시 그릴 때 그 화면 안에서만 찾게 한다(둘 다 DOM 에 살아 있어서
     document 전체로 찾으면 숨은 화면의 요소를 건드린다). */
  let _wsHost = null;

  /* ── 내가 쓴 자소서 초안 보관 ────────────────────────────────
     가이드를 보면서 바로 쓰고, 다음에 같은 회사로 들어오면 이어 쓰게 하는 게 목적.

     저장 위치는 localStorage 다. 서버에 두면 계정·동기화·삭제 정책이 따라붙는데
     아직 그 설계가 없고, 초안은 남에게 보일 물건도 아니다. 기기를 옮기면
     안 따라온다는 한계는 화면에 적어 둔다.

     키는 '회사명 + 항목 이름'. 회사명을 안 적었으면 공용 칸(기본)으로 떨어진다 —
     회사를 적어야 회사별로 따로 쌓인다.

     ── 저장소는 drafts.js 가 들고 있다 (2026-08-28) ──
     보관함이 자기 페이지로 나가면서(js/drafts.js) 초안 저장소도 그쪽으로 옮겼다.
     **여기서 localStorage 를 직접 파싱하지 않는다** — 같은 키를 두 파일이 각자 읽으면
     저장 형식을 바꿀 때 한쪽만 고쳐진다(문자열 → { text, at } 로 바꾼 전례가 있다). */
  const draftStore = () => (root.Drafts ? root.Drafts.store : null);

  function draftScope() {
    return ($('#jd-company')?.value || '').trim() || '(회사 미지정)';
  }

  function getDraft(label) {
    return draftStore()?.get(draftScope(), label) || '';
  }
  function saveDraft(label, text) {
    draftStore()?.set(draftScope(), label, text);
    paintLibCount();
  }

  /* 사이드바의 '내 자소서 보관함' 아래 한 줄 — 몇 건이 쌓였는지. 목록 자체는
     보관함 페이지가 그린다(여기서 또 그리면 같은 목록이 두 곳에 생긴다). */
  function paintLibCount() {
    const el = $('#jd-lib-count');
    if (!el) return;
    const n = draftStore()?.count() || 0;
    el.textContent = n ? `저장된 초안 ${n.toLocaleString()}건` : '아직 저장된 초안이 없어요';
  }

  /* ── STAR 입력 보관 ──────────────────────────────────────────
     사용자가 S/T/A/R 칸에 직접 적은 경험. 초안과 같은 규약(localStorage · 회사별)이되
     **문항마다 따로** 담는다 — 문항이 셋이면 보통 다른 경험 셋을 쓰기 때문이다.
     한 벌만 두면 문항 2를 쓰다가 문항 1의 경험을 덮어쓴다.

     이 값은 AI 초안의 재료가 된다. 활동 목록(이름·기간·역할)만으로는 '무슨 일이
     있었는지' 를 알 수 없어서 모델이 그 자리를 관용구로 메웠고, 그래서 "노력했고 잘
     마무리했습니다" 같은 문단이 나왔다(draft-coach.js 주석). */
  const LS_STAR = 'careerly_jd_star_v1';
  const STAR_KEYS = ['S', 'T', 'A', 'R'];

  function loadStars() {
    try { return JSON.parse(localStorage.getItem(LS_STAR)) || {}; } catch { return {}; }
  }
  const starSlot = tabKey => `${draftScope()}::${tabKey}`;

  function getStar(tabKey) {
    const v = loadStars()[starSlot(tabKey)];
    return (v && typeof v === 'object') ? v : {};
  }
  function saveStar(tabKey, key, text) {
    const all = loadStars();
    const slot = starSlot(tabKey);
    const cur = (all[slot] && typeof all[slot] === 'object') ? all[slot] : {};
    if (text.trim()) cur[key] = text;
    else delete cur[key];                       // 비우면 흔적을 남기지 않는다(초안과 같은 규칙)
    if (Object.keys(cur).length) all[slot] = cur;
    else delete all[slot];
    localStorage.setItem(LS_STAR, JSON.stringify(all));
  }

  /* AI 초안이 재료로 쓰는 STAR — **고른 정성스펙 중 대표(맨 앞)** 것이다.
     한 칸도 안 썼으면 null 을 준다. 빈 객체를 보내면 서버가 "STAR 가 있다" 고 보고
     활동 목록 쪽 안내를 끈다.

     ── 여러 개를 골랐는데 왜 하나만 쓰나 ──
     서버 초안 API 가 STAR 를 하나만 받는다(POST /api/jd/draft). 네 칸을 여러 경험에서
     섞어 보내면 "한 경험을 끝까지 푼 문단" 이 아니라 짜깁기가 나온다. 그래서 대표
     하나를 쓰고, **무엇이 쓰이는지 화면에 적는다**(renderSpecStar 의 머리줄). */
  /* 대표 정성스펙의 STAR. 없으면 빈 객체 — 화면은 '미작성' 으로 그린다. */
  function leadStar() {
    const lead = picks()[0];
    return lead ? starOfPick(lead.actKey) : {};
  }

  function currentStar() {
    const lead = picks()[0];
    if (!lead) return null;
    const v = starOfPick(lead.actKey);
    return STAR_KEYS.some(k => (v[k] || '').trim()) ? v : null;
  }


  /* 회사 리포트 화면(company-cover.js)에서 담은 근거를 같은 키로 읽는다.
     지원동기 문항은 공고가 아니라 이 사실들로 쓴다. */
  /* 담은 근거는 Roadmap 이 들고 있다(흐름 상태). 예전에는 이 파일이 localStorage
     키를 직접 파싱했는데, 3단계에서 모양을 바꾸면 여기는 조용히 빈 목록을 봤다. */
  function evidenceFor(company) {
    return Roadmap.evidenceOf(company);
  }
  /* 채용공고만 — 아래 applyPickedJob 은 '지원할 공고' 하나를 쓴다.
     사업 내용·기사까지 섞여 들어오면 공고 칸에 기사 제목이 들어간다. */
  const pickedJobs = company => evidenceFor(company).filter(e => e.kind === 'job');

  const SAMPLE = `[주요업무]
- 채널별 마케팅 성과 데이터 분석 및 리포트 작성
- 유관부서와 협업하여 프로모션 기획 및 실행
[자격요건]
- 데이터를 근거로 문제를 정의하고 개선안을 제안할 수 있는 분
- 엑셀·SQL 등 데이터 도구 활용 가능자
[우대사항]
- 고객 니즈 파악 및 UX 개선 경험
- 영어 커뮤니케이션 가능자`;

  const SAMPLE_QUESTIONS = `1. 지원 동기와 입사 후 포부를 기술해 주십시오.
2. 직무 수행에 필요한 역량을 갖추기 위해 노력한 경험을 서술해 주십시오.
3. 팀으로 일하며 갈등을 해결한 경험을 기술해 주십시오.`;

  /* ── 자소서 문항 칸 (번호 없이 내용만, 기본 3개 · 추가 상한) ───────────
     사용자가 '1. …' 처럼 번호를 직접 치던 것을 없앤다(사용자 지시). 칸마다 하나씩
     내용만 적고, 번호는 '문항 N' 라벨로 화면이 붙인다. 기본 3칸, '문항 추가'로
     Q_MAX 까지 늘린다. 값은 개행으로 합쳐 숨은 #jd-questions 에 넣어, 분석·진행도·
     초안 탭 등 기존 코드가 그대로 읽게 한다(parseQuestions 는 손대지 않는다). */
  const Q_MAX = 10;          // 문항 상한
  const Q_DEFAULT = 3;       // 처음 보이는 칸 수
  const Q_PLACEHOLDERS = [
    '예) 지원 동기와 입사 후 포부를 기술해 주십시오.',
    '예) 직무 수행에 필요한 역량을 갖추기 위해 노력한 경험을 서술해 주십시오.',
    '예) 팀으로 일하며 갈등을 해결한 경험을 기술해 주십시오.',
  ];
  let _qBoxes = Array(Q_DEFAULT).fill('');   // 문항 내용(번호 없음)

  /* ── 문항마다 정성스펙 + STAR (사용자 지시 2026-08-28) ──────────────
     분석을 돌리기 전에 **문항마다** ① 어떤 정성스펙(활동)으로 쓸지 고르고
     ② 그 경험을 STAR 로 적게 한다. 둘 다 없으면 '역량 분석하기'가 안 눌린다.

     ── 왜 분석 앞으로 옮겼나 ──
     예전에는 분석 결과 화면에서 STAR 를 받았다. 그런데 그 자리에서는 이미 AI 초안
     버튼이 눈앞에 있어서, STAR 를 비워 둔 채 초안부터 누르는 흐름이 자연스러웠다.
     그렇게 만든 초안은 활동 이름만 알고 내용을 몰라서 "노력했고 잘 마무리했습니다"
     류의 관용구로 채워진다(draft-coach.js 주석의 실측). 재료를 먼저 받는다.

     ── 문항이 아니라 **활동** 단위다 (사용자 지시 2026-08-28, 두 번째 개편) ──
     처음에는 문항마다 정성스펙을 하나씩 붙였다. 그런데 자소서를 쓸 때 사람은 문항을
     먼저 나눠 놓고 경험을 배정하지 않는다 — **쓸 경험을 먼저 고르고** 그걸 문항에
     맞춰 푼다. 한 경험이 두 문항에 들어가기도 한다. 그래서 지금은 정성스펙을 카드로
     늘어놓고 **하나 또는 여럿을 고르는** 방식이다. 문항을 안 적어도 고를 수 있다.

     ── 무엇을 저장하나 ──
     · 고른 활동 + 그대로/고쳐쓰기 → LS_PICK (회사별)
     · STAR 본문 → 기존 LS_STAR 를 그대로 쓰되 슬롯 키가 **활동키**다.
       (저장소를 새로 파지 않는다. 결과 화면 STAR 띠·AI 초안이 같은 함수로 읽는다.) */
  const LS_PICK = 'careerly_jd_pick_v1';

  /* 활동의 신원. spec_activities 는 화면으로 나올 때 id 를 안 싣는다(repo.toActivity).
     그래서 유형·이름·기관·기간을 이어 키로 쓴다 — 사람이 그 넷을 똑같이 두 번 적는
     일은 사실상 없고, 순번을 키로 쓰면 활동 하나를 지웠을 때 문항의 소재가 조용히
     옆 활동으로 바뀐다. */
  const actKeyOf = a => ['type', 'name', 'org', 'duration']
    .map(k => String(a?.[k] || '').trim()).join('|');

  const myActs = () => (window.DB ? DB.myActivities() : []) || [];
  const actByKey = key => myActs().find(a => actKeyOf(a) === key) || null;

  /* 고른 활동들. **순서가 뜻을 가진다** — 맨 앞이 '대표' 이고, AI 초안이 그 STAR 를
     재료로 쓴다(서버 초안 API 가 STAR 를 하나만 받는다). 카드에서 순서를 바꿀 수 있다. */
  function loadPicks() {
    try { return JSON.parse(localStorage.getItem(LS_PICK)) || {}; } catch { return {}; }
  }
  function picks() {
    const v = loadPicks()[draftScope()];
    return Array.isArray(v) ? v.filter(x => x && x.actKey) : [];
  }
  function savePicks(list) {
    const all = loadPicks();
    const scope = draftScope();
    if (list.length) all[scope] = list; else delete all[scope];
    localStorage.setItem(LS_PICK, JSON.stringify(all));
  }
  const pickOf = key => picks().find(x => x.actKey === key) || null;

  /* STAR 본문의 슬롯 키 — 활동 하나당 하나다. 같은 활동을 여러 문항에 써도 STAR 는
     하나면 된다(같은 경험이니까). 'act:' 를 붙여 옛 문항키(문항1…)와 섞이지 않게 한다. */
  const starKeyOf = actKey => `act:${actKey}`;

  /* 고른 활동의 STAR 를 그 활동의 STAR 칸으로 복사한다. '그대로 쓰기'는 그릴 때마다
     다시 복사한다 — 스펙 관리에서 원본을 고치면 여기도 따라 바뀌어야 '그대로'다. */
  function copyStarFromAct(act) {
    const key = starKeyOf(actKeyOf(act));
    for (const K of STAR_KEYS) saveStar(key, K, (act?.star?.[K.toLowerCase()] || '').trim());
  }

  /* STAR 한 벌이 다 찼는지. 규칙만 떼어 둔다 — 저장소·DOM 없이 검사할 수 있어야
     테스트가 붙는다(test/jd-questions.test.js).

     **이 규칙은 막는 데 쓰지 않는다.** 비어 있어도 분석은 돌아간다(사용자 지시).
     화면은 "무엇이 비었는지" 를 말하는 데만 쓴다. */
  function starGate(star) {
    const missing = STAR_KEYS.filter(K => !((star || {})[K] || '').trim());
    if (missing.length === STAR_KEYS.length) return { ok: false, empty: true, missing, why: 'STAR 를 적어주세요' };
    if (missing.length) return { ok: false, empty: false, missing, why: `${missing.join('·')} 칸이 비었어요` };
    return { ok: true, empty: false, missing, why: '' };
  }

  const starOfPick = key => getStar(starKeyOf(key));

  /* ── 문항마다 고른 정성스펙 (0~3개) (사용자 지시 2026-08-31) ──────────────
     모든 문항을 STAR 로 쓰지 않는다. 문항마다 이 자소서에 쓸 경험을 **0~3개** 고르고,
     고른 게 있을 때만 그 STAR 를 초안 재료로 쓴다(2개↑면 서버가 공통점으로 묶는다).
     0개면 STAR 없이 문항 골격만으로 쓴다 — 지원동기·포부가 성취담이 되던 문제를 끊는다.
     저장은 회사(scope)별·문항키별 활동키 목록이다. */
  const LS_QPICK = 'careerly_jd_qpick_v1';
  const Q_PICK_MAX = 3;
  function loadQPicks() {
    try { return JSON.parse(localStorage.getItem(LS_QPICK)) || {}; } catch { return {}; }
  }
  function qPicks(qKey) {
    const v = loadQPicks()[draftScope()]?.[qKey];
    return Array.isArray(v) ? v.filter(Boolean).slice(0, Q_PICK_MAX) : [];
  }
  /* 고르거나 뺀다. 상한(3개)에 걸리면 false 를 돌려 화면이 알린다. */
  function toggleQPick(qKey, actKey) {
    const all = loadQPicks();
    const scope = draftScope();
    const byQ = all[scope] || (all[scope] = {});
    const cur = Array.isArray(byQ[qKey]) ? byQ[qKey] : [];
    const at = cur.indexOf(actKey);
    if (at >= 0) cur.splice(at, 1);
    else { if (cur.length >= Q_PICK_MAX) return false; cur.push(actKey); }
    if (cur.length) byQ[qKey] = cur; else delete byQ[qKey];
    if (!Object.keys(byQ).length) delete all[scope];
    localStorage.setItem(LS_QPICK, JSON.stringify(all));
    return true;
  }
  /* ── 문항마다 쓸 역량을 사용자가 고른다 (사용자 지시 2026-09-01) ──────────────
     ── 무엇이 문제였나 ──
     역량은 `competenciesFor` 가 자동으로 붙였다. 공고 요구 강도 순으로 앞에서 3개인데
     (jd-competency.js 가 score 내림차순으로 준다), **문항과의 관련도는 안 본다.**
     그래서 지원동기에 '협업' 이 붙었다(사용자 지적).

     ── 그런데 자동 매핑을 없애면 안 된다 (심사 지적) ──
     그 정렬이 이 화면에서 "공고가 무엇을 요구했는가" 를 붙잡는 **유일한 객관 앵커**다.
     선택권만 주면 사람은 초록 점(내 근거 있음)을 누르고 회색 점(갭)을 피한다 —
     화면이 이미 어느 쪽이 쉬운지 색으로 알려주고 있다. 그래서 **기본값으로 남긴다.**

     ── 상한은 2개다 (심사 지적, 산술) ──
     600자면 배분표가 8~9문장으로 쪼갠다. 가장 큰 행동 덩이가 4문장인데 규칙 10이 거기에
     '무엇을·누구에게·어떤 기준으로·어떤 순서로' 4요소를 요구한다 → **역량 1개 = 문장당
     1요소**가 사양이 상정한 값이다. 3개면 역량당 1.33문장(지원동기·성격은 0.67문장)이라
     '1문장 이하 = 사실상 빠짐' 에 바로 걸린다. 2개까지가 문장이 성립하는 경계다.

     ── 저장 규약 ──
     키가 **없으면 기본값**을 쓰고, 있으면(빈 배열이어도) 사용자가 고른 것이다.
     "아직 안 골랐다" 와 "0개를 골랐다" 를 갈라야 지원동기에서 0개가 뜻을 갖는다. */
  const LS_CPICK = 'careerly_jd_cpick_v1';
  const C_PICK_MAX = 2;

  /* ══ 내 AI 프롬프트 (사용자 지시 2026-09-05) ══════════════════════════════
     기본 규칙 대신 쓸 규칙을 사용자가 직접 만든다. 여러 개를 이름 붙여 저장해 두고
     그중 **하나만 켠다**(전역 — 모든 자소서·문항에 적용).

     저장 위치는 초안·정성스펙과 같은 localStorage 다. 서버에 두면 계정·동기화·삭제
     정책이 따라붙는데, 이건 그 사람의 글쓰기 취향이지 서비스가 들고 있을 데이터가 아니다.
     (기기를 옮기면 안 따라온다는 것은 사이드바가 이미 적어 두고 있다.)

     ── 켠 프롬프트가 없으면 기본 규칙 ──
     activeId 가 null 이거나 가리키는 것이 지워졌으면 customRules 를 안 보낸다.
     서버는 빈 값이면 기본 규칙을 쓴다(draft-coach.js buildPrompt). */
  const LS_PROMPTS = 'careerly_jd_prompts_v1';
  const PROMPT_MAX = 20;               // 목록이 길어지면 고르는 것이 일이 된다
  const PROMPT_LEN_MAX = 8000;         // 서버가 자르는 길이와 같게 — 갈리면 조용히 잘린다
  /* '기본 프롬프트' 줄의 자리표. 저장되는 값은 여전히 activeId=null 이다 — 화면에만
     한 줄로 세운다. 저장값을 이 문자열로 바꾸면 옛 저장(null)과 두 가지가 되어,
     "무엇이 기본인가" 를 읽는 곳마다 갈린다. */
  const DEFAULT_PROMPT_ID = '__default__';

  function loadPrompts() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_PROMPTS));
      return {
        items: Array.isArray(v?.items) ? v.items.filter(p => p && p.id) : [],
        activeId: v?.activeId || null,
      };
    } catch { return { items: [], activeId: null }; }
  }
  function savePrompts(state) {
    try { localStorage.setItem(LS_PROMPTS, JSON.stringify(state)); } catch { /* 용량 초과 */ }
  }
  /* 지금 켜 둔 규칙 본문. 없으면 빈 문자열 → 서버가 기본 규칙을 쓴다. */
  function activeRules() {
    const { items, activeId } = loadPrompts();
    return items.find(p => p.id === activeId)?.text || '';
  }
  /* 이름을 안 적으면 '내 프롬프트 1, 2, 3…'. 이미 쓴 번호는 건너뛴다. */
  function nextPromptName(items) {
    const used = new Set(items.map(p => p.name));
    for (let i = 1; i <= PROMPT_MAX + 1; i++) {
      const name = `내 프롬프트 ${i}`;
      if (!used.has(name)) return name;
    }
    return '내 프롬프트';
  }

  /* ── 남이 공유한 프롬프트를 내 목록에 담는다 (사용자 지시 2026-09-05) ────────
     커리어 인사이트의 'AI 프롬프트' 게시판이 부른다.

     ── 왜 게시판이 localStorage 를 직접 안 만지나 ──
     저장 형식(items/activeId·이름 규칙·개수 상한)을 아는 곳은 여기 하나여야 한다.
     같은 키를 두 파일이 각자 파싱하면 형식을 바꿀 때 한쪽만 고쳐진다 —
     초안 저장소를 drafts.js 로 옮길 때 겪은 그대로다(draftStore 머리주석).

     ── 같은 글을 두 번 담아도 하나다 ──
     본문이 똑같으면 이미 있는 것을 켜고 끝낸다. 목록에 같은 규칙이 여러 줄 쌓이면
     어느 것이 무엇인지 알 수 없게 된다.

     ── 담으면 켠다 ──
     담는 이유가 '쓰려고' 라서다(만들기와 같은 규칙). 다만 프롬프트는 **전역**이라
     모든 자소서에 걸린다 — 부르는 쪽이 그 사실을 사용자에게 말해야 한다. */
  function addPrompt({ name, text } = {}) {
    const body = String(text || '').trim();
    if (!body) return { ok: false, reason: 'empty' };

    const state = loadPrompts();
    const same = state.items.find(p => p.text.trim() === body.slice(0, PROMPT_LEN_MAX).trim());
    if (same) {
      state.activeId = same.id;
      savePrompts(state);
      paintPrompts();
      return { ok: true, reason: 'exists', id: same.id, name: same.name };
    }
    if (state.items.length >= PROMPT_MAX) return { ok: false, reason: 'full', max: PROMPT_MAX };

    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const label = String(name || '').trim().slice(0, 40) || nextPromptName(state.items);
    state.items.push({ id, name: label, text: body.slice(0, PROMPT_LEN_MAX) });
    state.activeId = id;
    savePrompts(state);
    /* 작성 화면이 떠 있으면 사이드바를 그 자리에서 고쳐 그린다. 없으면 아무 일도
       안 한다(paintPrompts 가 host 없으면 그냥 나간다) — 다음에 들어갈 때 그려진다. */
    paintPrompts();
    return { ok: true, reason: 'added', id, name: label };
  }

  /* 지금 내가 가진 프롬프트 목록(이름·본문). 게시판의 '내 프롬프트 불러오기' 가
     읽는다 — 공유하려면 먼저 자기 것을 꺼내 와야 한다. */
  function myPrompts() {
    const { items, activeId } = loadPrompts();
    return items.map(p => ({ id: p.id, name: p.name, text: p.text, active: p.id === activeId }));
  }

  function loadCPicks() {
    try { return JSON.parse(localStorage.getItem(LS_CPICK)) || {}; } catch { return {}; }
  }
  /* 고른 역량 이름 목록. **안 골랐으면 null** — 빈 배열(0개 선택)과 구별해야 한다. */
  function cPicks(qKey) {
    const v = loadCPicks()[draftScope()]?.[qKey];
    return Array.isArray(v) ? v.filter(Boolean).slice(0, C_PICK_MAX) : null;
  }
  /* 고르거나 뺀다. 상한에 걸리면 false 를 돌려 화면이 알린다.
     한 번이라도 누르면 그 문항은 '사용자가 정한 문항' 이 되어 기본값을 더는 안 쓴다. */
  function toggleCPick(qKey, label, shownLabels) {
    const all = loadCPicks();
    const scope = draftScope();
    const byQ = all[scope] || (all[scope] = {});
    /* 처음 누를 때의 출발점은 **지금 화면에 보이는 목록**(=기본값)이다. 화면에 A 가
       붙어 있는데 B 를 누르면 [A, B] 가 되어야지 [B] 가 되면 사용자가 놀란다. */
    const cur = Array.isArray(byQ[qKey]) ? byQ[qKey].slice()
      : (Array.isArray(shownLabels) ? shownLabels.slice(0, C_PICK_MAX) : []);
    const at = cur.indexOf(label);
    if (at >= 0) cur.splice(at, 1);
    else { if (cur.length >= C_PICK_MAX) return false; cur.push(label); }
    byQ[qKey] = cur;                       // 빈 배열도 그대로 남긴다(0개 선택이 뜻을 갖는다)
    localStorage.setItem(LS_CPICK, JSON.stringify(all));
    return true;
  }
  /* ── 문항마다 분량 상한을 사용자가 정한다 (사용자 지시 2026-09-03) ──────────────
     자소서 문항은 회사마다 상한이 다르다 — "1,000자 이내", "2,000 byte" 처럼 공고에
     적혀 있다. 지금까지는 초안 요청이 `limit: 600` 으로 **고정**이라, 1,000자짜리
     문항에 600자짜리 초안이 나오고 사용자가 다시 늘려 써야 했다.

     ── 글자와 byte 를 다 받는다 ──
     국내 자소서 상한은 두 가지로 적힌다. byte 로 적는 곳은 관행적으로 **한글 2byte**
     (EUC-KR 기준)로 센다 — UTF-8(한글 3byte)이 아니다. 잡코리아·사람인 계열이 그렇다.
     UTF-8 로 세면 같은 글이 1.5배로 잡혀 사용자가 쓸 수 있는 분량을 깎아먹는다.

     ── 안 정하면 1,000자 ──
     사용자 지정 기본값이다. 예전 기본(600자)보다 크다 — 실제 공고에서 가장 흔한 상한이고,
     모자란 초안을 늘리는 것보다 긴 초안을 줄이는 편이 사용자에게 쉽다. */
  const LS_LIMIT = 'careerly_jd_limit_v1';
  const LIMIT_DEFAULT = 1000;
  const LIMIT_MIN = 200;
  const LIMIT_MAX_CHAR = 3000;          // 서버 clamp 와 맞춘다
  const LIMIT_MAX_BYTE = LIMIT_MAX_CHAR * 2;

  /* 한글·전각은 2byte, 나머지는 1byte. 국내 자소서 byte 상한의 관행이다. */
  function byteLen(str) {
    let n = 0;
    for (const ch of String(str || '')) n += /[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? 2 : 1;
    return n;
  }

  function loadLimits() {
    try { return JSON.parse(localStorage.getItem(LS_LIMIT)) || {}; } catch { return {}; }
  }
  /* 이 문항의 상한. 안 정했으면 기본값(1,000자)을 돌려준다 — null 을 돌려주면
     부르는 쪽마다 기본값을 따로 적게 되고, 그러면 화면과 초안이 갈린다. */
  function limitOf(qKey) {
    const v = loadLimits()[draftScope()]?.[qKey];
    const unit = v?.unit === 'byte' ? 'byte' : 'char';
    const max = unit === 'byte' ? LIMIT_MAX_BYTE : LIMIT_MAX_CHAR;
    const n = Number(v?.n);
    if (!Number.isFinite(n) || n <= 0) return { n: LIMIT_DEFAULT, unit: 'char', custom: false };
    return { n: Math.min(Math.max(Math.round(n), LIMIT_MIN), max), unit, custom: true };
  }
  function setLimit(qKey, n, unit) {
    const all = loadLimits();
    const scope = draftScope();
    const byQ = all[scope] || (all[scope] = {});
    const num = Number(n);
    /* 비우면 '기본값으로 돌아간다' 는 뜻이다 — 0 을 저장해 두면 다음에 못 고친다. */
    if (!Number.isFinite(num) || num <= 0) delete byQ[qKey];
    else byQ[qKey] = { n: Math.round(num), unit: unit === 'byte' ? 'byte' : 'char' };
    if (!Object.keys(byQ).length) delete all[scope];
    localStorage.setItem(LS_LIMIT, JSON.stringify(all));
    return limitOf(qKey);
  }
  /* 지금 글이 상한 대비 얼마인지. 화면 카운터와 초과 판정이 같은 함수를 본다. */
  function usageOf(text, lim) {
    const used = lim.unit === 'byte' ? byteLen(text) : String(text || '').length;
    return { used, over: used > lim.n, unitLabel: lim.unit === 'byte' ? 'byte' : '자' };
  }
  /* 서버에 넘길 목표 글자 수. byte 상한은 한글 2byte 기준이라 절반이 대략의 글자 수다. */
  const charTarget = lim => (lim.unit === 'byte' ? Math.round(lim.n / 2) : lim.n);

  /* ── 역량 분석 결과를 자소서(회사)마다 보관한다 (사용자 지시 2026-09-01) ──────
     ── 무엇이 문제였나 ──
     역량 분석 결과는 `_last` 라는 **메모리 변수**에만 있었다. 그래서 보관함에서
     '이어쓰기'로 들어오거나 새로고침하면 `_last` 가 비어 있고, 작성 화면이
     `r = { items: [] }` 로 그려진다. 역량이 없으니 **AI 초안 넣기가 동작하지 않는다**
     (초안은 item.label·quotes·reads·frame 을 재료로 쓴다). 사용자가 겪은 그대로다.

     초안 본문·STAR·고른 스펙은 이미 회사별 localStorage 에 있었는데 **분석만 안 남겼다.**
     같은 규약으로 맞춘다 — 키는 draftScope()(회사), 저장소는 이 파일이 단일 출처다.

     ── 문항 문구도 같이 남긴다 ──
     탭은 `parseQuestions()` 가 `#jd-questions` 텍스트에서 만든다. 분석만 되살리고
     문항을 안 되살리면 탭이 역량 단위로 바뀌어 **저장 키가 달라지고**, 이어쓰기로
     들어온 사람이 자기 글을 못 찾는다.

     ── 회사 수를 제한한다 ──
     결과 하나가 수십 KB 라 무한정 쌓으면 localStorage 가 찬다. 오래된 것부터 버린다.
     지워져도 분석을 다시 돌리면 그만이다(초안 본문은 다른 키라 안 지워진다). */
  const LS_ANALYSIS = 'careerly_jd_analysis_v1';
  const ANALYSIS_MAX = 10;

  function loadAnalyses() {
    try { return JSON.parse(localStorage.getItem(LS_ANALYSIS)) || {}; } catch { return {}; }
  }
  /* 저장은 '역량이 하나라도 있을 때만' 한다 — 빈 결과를 덮어 쓰면 멀쩡히 저장돼 있던
     분석이 사라진다(공고 없이 guideJd 로 들어온 경우가 실제로 그렇다). */
  function saveAnalysis(company, r, questions) {
    const scope = String(company || '').trim();
    if (!scope || !r?.items?.length) return false;
    const all = loadAnalyses();
    /* 시각(at)으로 정렬해 버렸더니 **같은 밀리초에 저장된 것들의 순서가 불안정**했다
       (테스트에서 잡혔다). 객체의 키 순서를 쓴다 — 지웠다 다시 넣으면 맨 뒤로 가므로
       키 순서가 곧 '오래된 것 → 최근 것' 이고, JSON 왕복에도 그 순서가 남는다. */
    delete all[scope];
    all[scope] = { r, questions: String(questions || ''), at: Date.now() };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - ANALYSIS_MAX))) delete all[k];
    try {
      localStorage.setItem(LS_ANALYSIS, JSON.stringify(all));
      return true;
    } catch {
      /* 용량이 찼다. 이번 것만 남기고 다시 시도한다 — 그래도 안 되면 조용히 포기한다.
         분석은 다시 돌릴 수 있는 값이라, 여기서 실패했다고 사용자를 막지는 않는다. */
      try { localStorage.setItem(LS_ANALYSIS, JSON.stringify({ [scope]: all[scope] })); return true; }
      catch { return false; }
    }
  }
  function analysisOf(company) {
    const v = loadAnalyses()[String(company || '').trim()];
    return v?.r?.items?.length ? v : null;
  }
  function forgetAnalysis(company) {
    const all = loadAnalyses();
    delete all[String(company || '').trim()];
    localStorage.setItem(LS_ANALYSIS, JSON.stringify(all));
  }

  /* 고른 활동의 STAR — 코치에서 적은 것(starOfPick) 우선, 없으면 스펙 관리 원본(a.star). */
  function starForAct(actKey) {
    const s = starOfPick(actKey);
    if (STAR_KEYS.some(K => (s[K] || '').trim())) return s;
    const a = actByKey(actKey);
    if (a?.star) return { S: a.star.s || '', T: a.star.t || '', A: a.star.a || '', R: a.star.r || '' };
    return {};
  }
  /* 서버로 보낼 재료 — 고른 활동들의 {name, star}. STAR 가 빈 것은 뺀다. */
  function qPickList(qKey) {
    return qPicks(qKey).map(k => {
      const a = actByKey(k);
      return { name: a ? actTitle(a) : '', star: starForAct(k) };
    }).filter(p => STAR_KEYS.some(K => (p.star[K] || '').trim()));
  }

  /* 고른 정성스펙의 준비 상태 — 사이드바 한 줄과 카드 머리가 같이 읽는다. */
  function picksReady() {
    const list = picks();
    const done = list.filter(p => starGate(starOfPick(p.actKey)).ok).length;
    return { total: list.length, done, ok: list.length > 0 && done === list.length };
  }

  /* 칸 값을 개행으로 합쳐 숨은 textarea 에 넣고 input 을 쏜다 — 기존 입력 핸들러
     (진행도·역량 배분·peek)가 그 이벤트로 갱신된다. */
  function syncQuestions() {
    const ta = $('#jd-questions');
    if (!ta) return;
    ta.value = _qBoxes.map(s => s.trim()).filter(Boolean).join('\n');
    ta.dispatchEvent(new Event('input'));
  }

  /* 활동 한 줄 이름 — 고르는 목록과 고른 뒤 표시에 같은 문구를 쓴다. */
  function actLabel(a) {
    const bits = [ACT_TYPE_LABEL[a.type] || a.type || '활동', actTitle(a)];
    if (a.org && a.org !== a.name) bits.push(a.org);
    if (a.duration) bits.push(a.duration);
    return bits.filter(Boolean).join(' · ');
  }

  const STAR_FIELDS = [
    { k: 'S', lab: '상황', hint: '어떤 상황·배경이었나요?' },
    { k: 'T', lab: '과제', hint: '맡은 목표·과제는 무엇이었나요?' },
    { k: 'A', lab: '행동', hint: '직접 무엇을 했나요?' },
    { k: 'R', lab: '결과', hint: '결과는 어땠나요? 되도록 수치로.' },
  ];

  /* 문항 칸 — 문항 내용만 받는다. 예전에는 문항마다 정성스펙(0~3개)·STAR 를 여기서
     골랐는데, **정성스펙 선택은 초안 작성 화면으로 옮겼다**(사용자 지시 2026-09-01).
     역량 분석 전에는 문항과 STAR(아래 정성스펙 STAR 자리)만 적고, 어떤 경험을 어느 문항에
     쓸지는 초안을 쓰면서 고른다. */
  function renderQBoxes() {
    const host = $('#jd-q-boxes');
    if (!host) return;
    host.innerHTML = _qBoxes.map((v, i) => `
      <div class="jd-q-box">
        <div class="jd-q-line">
          <span class="jd-q-num">문항 ${i + 1}</span>
          <textarea class="jd-q-in" data-q="${i}" rows="2"
            placeholder="${esc(Q_PLACEHOLDERS[i] || '자소서 문항 내용을 붙여넣거나 적어주세요 (번호 없이)')}">${esc(v)}</textarea>
          ${_qBoxes.length > 1
            ? `<button type="button" class="jd-q-del" data-q-del="${i}" aria-label="문항 ${i + 1} 삭제"><i class="ti ti-x"></i></button>`
            : ''}
        </div>
      </div>`).join('');
    const add = $('#jd-q-add');
    if (add) {
      add.disabled = _qBoxes.length >= Q_MAX;
      add.style.display = _qBoxes.length >= Q_MAX ? 'none' : '';
    }
    bindQBoxes(host);
  }

  /* ── 정성스펙 카드 한 장 ────────────────────────────────────────
     활동 하나를 카드로 보여주고, 누르면 고른다(복수 선택). 고른 카드만 STAR 칸이
     펼쳐진다 — 안 고른 카드까지 네 칸씩 열려 있으면 화면이 활동 수만큼 길어진다. */
  function specCardHtml(act, order) {
    const key = actKeyOf(act);
    const pick = pickOf(key);
    const on = Boolean(pick);
    const srcHasStar = actHasStar(act);
    const mode = srcHasStar ? (pick?.mode === 'edited' ? 'edited' : 'as-is') : 'edited';
    /* '그대로 쓰기' 는 그릴 때마다 원본을 다시 복사한다. 스펙 관리에서 STAR 를 고친
       뒤 여기로 돌아왔을 때 옛 내용이 남아 있으면 '그대로' 가 거짓말이 된다. */
    if (on && mode === 'as-is' && srcHasStar) copyStarFromAct(act);
    const star = starOfPick(key);
    const g = starGate(star);
    const filled = STAR_KEYS.length - g.missing.length;

    return `
      <div class="jd-sc ${on ? 'is-on' : ''}" data-sc="${esc(key)}">
        <button type="button" class="jd-sc-h" data-sc-pick="${esc(key)}" aria-pressed="${on}">
          <span class="jd-sc-check"><i class="ti ti-${on ? 'check' : 'plus'}"></i></span>
          <span class="jd-sc-t">
            <b>${esc(actTitle(act))}</b>
            <small>${esc([ACT_TYPE_LABEL[act.type] || act.type || '활동',
                          act.org && act.org !== act.name ? act.org : '',
                          act.duration || ''].filter(Boolean).join(' · '))}</small>
          </span>
          <span class="jd-sc-star ${g.ok ? 'is-ok' : filled ? 'is-part' : ''}">${
            srcHasStar || filled ? `STAR ${filled}/4` : 'STAR 없음'}</span>
          ${on && order === 0 ? '<span class="jd-sc-lead">대표</span>' : ''}
        </button>

        ${on ? `
          <div class="jd-sc-body">
            ${srcHasStar
              ? `<div class="jd-q-mode" role="group" aria-label="가져온 STAR 를 고칠지 고르기">
                   <span class="jd-q-mode-lab">스펙 관리의 STAR 를</span>
                   <button type="button" class="jd-q-mode-b ${mode === 'as-is' ? 'is-on' : ''}"
                           data-sc-mode="${esc(key)}" data-mode="as-is">그대로 쓰기</button>
                   <button type="button" class="jd-q-mode-b ${mode === 'edited' ? 'is-on' : ''}"
                           data-sc-mode="${esc(key)}" data-mode="edited">여기서 고쳐 쓰기</button>
                 </div>`
              : `<p class="jd-q-hint">스펙 관리에 STAR 가 없는 활동이에요 — 여기서 적으면 됩니다.
                   (여기 적은 내용은 이 자소서에만 저장돼요.)</p>`}

            <div class="jd-q-star ${mode === 'as-is' ? 'is-locked' : ''}">
              <div class="jd-q-star-h">
                <b>STAR</b>
                <span>${filled}/4 칸${mode === 'as-is' ? ' · 스펙 관리 내용 그대로' : ''}</span>
                ${order > 0 ? `<button type="button" class="jd-sc-lead-b" data-sc-lead="${esc(key)}">대표로</button>` : ''}
              </div>
              ${STAR_FIELDS.map(f => `
                <label class="jd-q-star-cell">
                  <span class="jd-q-star-tag">${f.k} · ${f.lab}</span>
                  <textarea class="jd-q-star-in" data-sc-star="${esc(key)}" data-star-key="${f.k}" rows="2"
                    ${mode === 'as-is' ? 'readonly' : ''}
                    placeholder="${esc(f.hint)}">${esc(star[f.k] || '')}</textarea>
                </label>`).join('')}
            </div>
          </div>` : ''}
      </div>`;
  }

  /* ── 정성스펙 카드 칸 (문항과 무관하게 언제나 쓴다) ───────────────────
     문항별로 하나씩 붙이던 것을 **카드 목록 + 복수 선택**으로 바꿨다
     (사용자 지시 2026-08-28). 사람은 문항을 먼저 나눠 놓고 경험을 배정하지 않는다 —
     쓸 경험을 먼저 고르고 그걸 문항에 맞춰 푼다. 한 경험이 두 문항에 들어가기도 한다.

     고른 순서에서 **맨 앞이 대표**다. AI 초안이 그 STAR 를 재료로 쓴다(서버 초안 API 가
     STAR 를 하나만 받는다). 여러 개를 골랐을 때 무엇이 쓰이는지 화면에 적어 둔다 —
     안 적으면 "두 개 골랐는데 왜 하나만 반영되지" 가 된다. */
  /* ── 정성스펙 선택은 문항마다로 옮겼다 (사용자 지시 2026-08-31 · 두 번째) ──────
     예전에는 여기(별도 카드 칸)에서 자소서 한 벌에 쓸 경험을 고르고 '대표'를 정했다.
     이제는 **각 문항 칸 아래에서** 그 문항에 쓸 경험(0~3개)과 STAR 를 바로 고른다.
     '대표' 개념도 없앴다. 이 자리는 그 사실을 알리는 안내 한 줄만 남긴다. */
  /* ── 정성스펙 STAR — 역량 분석 **전에** 여기서 적는다 (사용자 지시 2026-09-01) ──────
     문항마다 고르던 것을 없애고, 내 활동(정성스펙)마다 STAR 를 이 자리에서 적는다.
     여기 적은 STAR 는 초안 작성 화면에서 문항마다 경험을 고를 때 AI 초안 재료로 쓰인다.
     '스펙에 저장하기'를 누르면 이 STAR 를 **내 스펙 관리에도** 저장할지 스스로 정한다 —
     안 누르면 이 자소서 작성에만(브라우저) 남고, 누르면 스펙 관리의 활동 STAR 가 된다. */
  function actMeta(a) {
    return [ACT_TYPE_LABEL[a.type] || a.type || '활동',
      a.org && a.org !== a.name ? a.org : '', a.duration || ''].filter(Boolean).join(' · ');
  }

  function specStarCardHtml(a) {
    const key = actKeyOf(a);
    const star = starForAct(key);                        // 코치에 적은 것 우선, 없으면 스펙 관리 원본
    const filled = STAR_KEYS.filter(K => (star[K] || '').trim()).length;
    /* 처음엔 제목만 보이고, 눌러야 STAR 칸이 펼쳐진다(사용자 지시 2026-09-01). 활동마다
       네 칸씩 열려 있으면 화면이 길어져 '무엇을 적어야 하는지'가 안 보였다. */
    return `<div class="jd-ss-card" data-ss-card="${esc(key)}">
      <button type="button" class="jd-ss-card-h" data-ss-toggle="${esc(key)}" aria-expanded="false">
        <span class="jd-ss-card-t"><b>${esc(actTitle(a))}</b><small>${esc(actMeta(a))}</small></span>
        <span class="jd-ss-count ${filled === 4 ? 'is-ok' : filled ? 'is-part' : ''}" data-ss-count="${esc(key)}">STAR ${filled}/4</span>
        <i class="ti ti-chevron-down jd-ss-caret"></i>
      </button>
      <div class="jd-ss-body" hidden>
        <div class="jd-ss-star">
          ${STAR_FIELDS.map(f => `<label class="jd-ss-cell">
            <span class="jd-ss-tag">${f.k} · ${f.lab}</span>
            <textarea class="jd-ss-in" data-ss-star="${esc(key)}" data-star-key="${f.k}" rows="2"
              placeholder="${esc(f.hint)}">${esc(star[f.k] || '')}</textarea>
          </label>`).join('')}
        </div>
        <div class="jd-ss-foot">
          <span class="jd-ss-state" data-ss-state="${esc(key)}"></span>
          <button type="button" class="wf-btn wf-btn--sm" data-ss-save="${esc(key)}">
            <i class="ti ti-device-floppy"></i> 스펙에 저장하기</button>
        </div>
      </div>
    </div>`;
  }

  function renderSpecStar() {
    const host = $('#jd-spec-star');
    if (!host) return;
    const acts = myActs();
    if (!acts.length) {
      host.innerHTML = `<div class="jd-ss-empty"><i class="ti ti-info-circle"></i>
        쓸 <b>정성스펙</b>(인턴·공모전 등)이 없어요.
        <button type="button" class="jd-q-link" data-ss-go>스펙 관리에서 추가하기</button>
        <span class="co-src">STAR 는 안 적어도 분석은 됩니다 — 적어 두면 초안이 내 경험으로 나와요.</span></div>`;
      host.querySelectorAll('[data-ss-go]').forEach(el => el.addEventListener('click', () => {
        if (typeof navigateTo === 'function') navigateTo('mypage', 'spec');
        else if (typeof navigate === 'function') navigate('mypage');
      }));
      return;
    }
    host.innerHTML = `
      <div class="jd-ss-h">
        <span class="wf-eyebrow">정성스펙 STAR</span>
        <p>인턴·공모전 등 경험을 <b>STAR</b> 로 적어 두면, 초안 작성에서 문항마다 골라 <b>AI 초안 재료</b>로 씁니다.</p>
      </div>
      <div class="jd-ss-cards">${acts.map(specStarCardHtml).join('')}</div>`;
    bindSpecStarSection(host);
  }

  function bindSpecStarSection(host) {
    /* 제목 줄을 누르면 STAR 칸이 펼쳐진다. 접힌 동안 textarea 는 높이를 못 재므로
       펼치는 순간 autoGrow 로 다시 맞춘다. */
    host.querySelectorAll('[data-ss-toggle]').forEach(el =>
      el.addEventListener('click', () => {
        const card = el.closest('.jd-ss-card');
        const body = card?.querySelector('.jd-ss-body');
        if (!body) return;
        const open = body.hidden;
        body.hidden = !open;
        card.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', String(open));
        if (open) body.querySelectorAll('.jd-ss-in').forEach(autoGrow);
      }));
    /* STAR 입력 — 활동키로 저장한다. 타이핑 중 다시 그리지 않는다(커서를 잃는다):
       저장만 하고 칸 크기·개수 배지만 갱신한다. */
    host.querySelectorAll('[data-ss-star]').forEach(el => {
      autoGrow(el);
      el.addEventListener('input', () => {
        saveStar(starKeyOf(el.dataset.ssStar), el.dataset.starKey, el.value);
        autoGrow(el);
        paintSsCount(el.dataset.ssStar);
      });
    });
    host.querySelectorAll('[data-ss-save]').forEach(el =>
      el.addEventListener('click', () => saveStarToSpec(el.dataset.ssSave)));
  }

  /* 개수 배지만 다시 칠한다(카드를 통째로 다시 그리지 않는다). */
  function paintSsCount(key) {
    const badge = $(`[data-ss-count="${CSS.escape(key)}"]`);
    if (!badge) return;
    const star = getStar(starKeyOf(key));
    const filled = STAR_KEYS.filter(K => (star[K] || '').trim()).length;
    badge.className = `jd-ss-count ${filled === 4 ? 'is-ok' : filled ? 'is-part' : ''}`;
    badge.textContent = `STAR ${filled}/4`;
    badge.dataset.ssCount = key;
  }

  /* '스펙에 저장하기' — 코치에 적은 STAR 를 **내 스펙 관리의 활동 STAR** 로 저장한다.
     저장 위치는 스펙입력의 'STAR 저장' 과 같은 API(saveActivityStar). 로그인 필요. */
  async function saveStarToSpec(key) {
    const stateEl = $(`[data-ss-state="${CSS.escape(key)}"]`);
    const btn = $(`[data-ss-save="${CSS.escape(key)}"]`);
    if (!isLoggedIn()) { if (stateEl) stateEl.textContent = '로그인 후 저장할 수 있어요'; return; }

    const idx = myActs().findIndex(a => actKeyOf(a) === key);
    const a = myActs()[idx];
    if (idx < 0 || !a) { if (stateEl) stateEl.textContent = '활동을 찾지 못했어요'; return; }

    const coach = getStar(starKeyOf(key));                       // { S,T,A,R }
    if (!STAR_KEYS.some(K => (coach[K] || '').trim())) {
      if (stateEl) stateEl.textContent = 'STAR 를 한 칸이라도 적어주세요'; return;
    }
    const star = { s: coach.S || '', t: coach.T || '', a: coach.A || '', r: coach.R || '' };

    if (btn) btn.disabled = true;
    if (stateEl) stateEl.textContent = '스펙 관리에 저장 중…';
    try {
      await DB.saveActivityStar(idx, star, a.type);
      if (stateEl) stateEl.textContent = '스펙 관리에 저장했어요';
    } catch (e) {
      if (stateEl) stateEl.textContent = e.message || '저장하지 못했어요';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* 카드 칸의 손잡이들. 문항 칸(bindQBoxes)과 나눠 둔다 — 두 칸이 서로 다른 때에
     다시 그려지므로, 한 함수에서 둘 다 묶으면 없어진 요소에 다시 묶게 된다. */
  function bindSpecStar(host) {
    /* 카드를 눌러 고르거나 뺀다(복수 선택). 고를 때 원본에 STAR 가 있으면 기본이
       '그대로 쓰기' 다 — 이미 적어 둔 것을 다시 적게 하지 않는다. */
    host.querySelectorAll('[data-sc-pick]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.scPick;
        const list = picks();
        const at = list.findIndex(x => x.actKey === key);
        if (at >= 0) {
          /* 뺄 때 STAR 본문은 지우지 않는다 — 잘못 눌렀다가 다시 고르면 그대로
             돌아와야 한다. 손으로 쓴 글을 클릭 한 번으로 날리지 않는다. */
          list.splice(at, 1);
        } else {
          const act = actByKey(key);
          list.push({ actKey: key, mode: actHasStar(act) ? 'as-is' : 'edited' });
          if (actHasStar(act)) copyStarFromAct(act);
        }
        savePicks(list);
        renderSpecStar();
        paintProgress();
      });
    });

    /* '그대로 쓰기 ↔ 여기서 고쳐 쓰기'. 그대로로 되돌리면 원본을 다시 복사한다 —
       그게 '그대로' 의 뜻이고, 고쳐 둔 내용을 남겨 두면 어느 쪽이 진짜인지 알 수 없다. */
    host.querySelectorAll('[data-sc-mode]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.scMode;
        const mode = el.dataset.mode;
        const act = actByKey(key);
        const cur = pickOf(key);
        if (mode === 'as-is' && cur?.mode === 'edited') {
          const star = starOfPick(key);
          const changed = STAR_KEYS.some(K => (star[K] || '').trim()
            !== (act?.star?.[K.toLowerCase()] || '').trim());
          if (changed && !confirm('여기서 고친 내용을 버리고 스펙 관리의 STAR 로 되돌릴까요?')) return;
          copyStarFromAct(act);
        }
        savePicks(picks().map(x => (x.actKey === key ? { ...x, mode } : x)));
        renderSpecStar();
      });
    });

    /* 대표 바꾸기 — 그 카드를 맨 앞으로. AI 초안이 대표의 STAR 를 재료로 쓴다. */
    host.querySelectorAll('[data-sc-lead]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.scLead;
        const list = picks();
        const at = list.findIndex(x => x.actKey === key);
        if (at < 0) return;
        list.unshift(list.splice(at, 1)[0]);
        savePicks(list);
        renderSpecStar();
        paintProgress();
      });
    });

    /* 활동이 하나도 없으면 스펙 관리로 보낸다. 탭까지 지정한다 — navigate('mypage')
       만 하면 직전에 보던 탭이 열려서 계정 화면이 뜬다(app.js navigateTo 주석). */
    host.querySelectorAll('[data-q-spec-go]').forEach(el => {
      el.addEventListener('click', () => {
        if (typeof navigateTo === 'function') navigateTo('mypage', 'spec');
        else if (typeof navigate === 'function') navigate('mypage');
      });
    });

    /* STAR 칸. 저장은 결과 화면의 STAR 띠와 같은 저장소를 쓴다(활동키). */
    host.querySelectorAll('[data-sc-star]').forEach(el => {
      autoGrow(el);
      el.addEventListener('input', () => {
        const key = el.dataset.scStar;
        saveStar(starKeyOf(key), el.dataset.starKey, el.value);
        autoGrow(el);
        paintPickState(key);
      });
    });
  }

  /* 카드 머리의 숫자만 다시 칠한다. 타이핑 중에 카드를 통째로 다시 그리면 커서를
     잃는다 — 저장은 이미 끝났으니 표시만 갱신하면 된다. */
  function paintPickState(key) {
    const card = $('#jd-spec-star')?.querySelector(`[data-sc="${CSS.escape(key)}"]`);
    if (!card) { paintProgress(); return; }
    const g = starGate(starOfPick(key));
    const filled = STAR_KEYS.length - g.missing.length;
    const badge = card.querySelector('.jd-sc-star');
    if (badge) {
      badge.className = `jd-sc-star ${g.ok ? 'is-ok' : filled ? 'is-part' : ''}`;
      badge.textContent = `STAR ${filled}/4`;
    }
    const head = card.querySelector('.jd-q-star-h span');
    if (head) {
      const asIs = card.querySelector('.jd-q-star')?.classList.contains('is-locked');
      head.textContent = `${filled}/4 칸${asIs ? ' · 스펙 관리 내용 그대로' : ''}`;
    }
    paintProgress();
  }

  function bindQBoxes(host) {
    host.querySelectorAll('.jd-q-in').forEach(el => {
      el.addEventListener('input', () => {
        /* 문항은 이제 아래 카드 칸과 **엮이지 않는다**(사용자 지시 2026-08-28).
           정성스펙은 문항이 아니라 자소서 한 벌에 붙으므로, 여기서는 값만 반영한다. */
        _qBoxes[+el.dataset.q] = el.value;
        autoGrow(el);
        syncQuestions();
      });
      el.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      });
      autoGrow(el);
    });
    host.querySelectorAll('[data-q-del]').forEach(el => {
      el.addEventListener('click', () => {
        _qBoxes.splice(+el.dataset.qDel, 1);
        if (!_qBoxes.length) _qBoxes.push('');
        renderQBoxes();
        syncQuestions();
      });
    });
  }

  /* 문항 값을 통째로 갈아끼운다(샘플·기본 문항 채우기에서 쓴다). */
  function setQBoxes(list) {
    _qBoxes = (list && list.length) ? list.slice(0, Q_MAX) : Array(Q_DEFAULT).fill('');
    while (_qBoxes.length < Q_DEFAULT) _qBoxes.push('');   // 최소 기본 칸 수는 유지
    renderQBoxes();
    syncQuestions();
  }

  /* ══ 입력부 — 문서형 에디터 ═══════════════════════════════ */

  const STEPS = [
    { id: 'jd-step-company',     label: '지원 회사',   input: '#jd-company',   optional: true  },
    { id: 'jd-step-posting',     label: '채용공고',    input: '#jd-text',      optional: false },
    { id: 'jd-step-description', label: '직무기술서',  input: '#jd-jd',        optional: true  },
    { id: 'jd-step-questions',   label: '자소서 문항', input: '#jd-questions', optional: true  },
  ];

  const valueOf = sel => ($(sel)?.value || '').trim();

  /* 내용만큼 자란다. scrollHeight 를 그대로 쓰면 지울 때 줄어들지 않으므로
     먼저 auto 로 되돌린 뒤 잰다. 전체화면일 때는 CSS 가 높이를 맡는다. */
  function autoGrow(el) {
    if (!el || el.closest('.jd-block')?.classList.contains('is-full')) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function blockOf(step) { return document.getElementById(step.id); }

  /* 접힌 칸의 미리보기 — 두 줄까지. CSS 가 line-clamp 로 자른다. */
  function paintPeek(step) {
    const block = blockOf(step);
    const peek = block?.querySelector('[data-peek]');
    if (!peek) return;
    const v = valueOf(step.input);
    if (v) {
      peek.textContent = v.replace(/\s+/g, ' ').slice(0, 300);
      peek.classList.remove('jd-block-peek--empty');
    } else {
      peek.textContent = step.optional ? '아직 비어 있어요 (선택 항목)' : '아직 비어 있어요';
      peek.classList.add('jd-block-peek--empty');
    }
  }

  function paintBlock(step) {
    const block = blockOf(step);
    if (!block) return;
    const v = valueOf(step.input);
    block.classList.toggle('is-filled', Boolean(v));

    const count = block.querySelector('[data-count]');
    if (count) count.textContent = v ? `${v.length.toLocaleString()}자` : '';

    const stat = block.querySelector('[data-stat]');
    if (stat) {
      const lines = v ? v.split(/\r?\n/).filter(s => s.trim()).length : 0;
      /* 문단 수까지 세는 건 붙여넣기가 제대로 됐는지 확인하는 자리라서다 —
         공고를 통째로 복사하면 문단이 여러 개 잡히고, 한 줄만 들어오면 1개로 나온다. */
      const paras = v ? v.split(/\n\s*\n/).filter(s => s.trim()).length : 0;
      stat.textContent = v
        ? `${v.length.toLocaleString()}자 · ${lines}줄${paras > 1 ? ` · 문단 ${paras}개 인식됨` : ''}`
        : '아직 비어 있어요';
    }

    /* 1번 칸은 글자수가 의미 없다(회사명 한 개다). 대신 채웠는지 여부를 배지로 말한다. */
    const badge = block.querySelector('[data-badge]');
    if (badge) {
      badge.textContent = v ? '입력됨' : '선택';
      badge.className = v ? 'wf-badge wf-badge--ok' : 'wf-badge wf-badge--mute';
    }

    const toggleLabel = block.querySelector('[data-toggle-label]');
    if (toggleLabel) toggleLabel.textContent = block.classList.contains('is-open') ? '접기' : '펼치기';

    paintPeek(step);
  }

  /* 진행도 — 사이드바의 '입력 항목' 목록이 겸한다. 각 칸은 채웠나/비었나 두 상태뿐이라
     퍼센트 막대를 그리지 않고 **체크 표시**로 둔다(55% 가 무슨 뜻인지 설명할 수 없다). */
  function paintProgress() {
    const box = $('#jd-progress-steps');
    if (!box) return;
    box.innerHTML = STEPS.map((s, i) => {
      const v = valueOf(s.input);
      const open = blockOf(s)?.classList.contains('is-open');
      const cls = v ? 'is-done' : open ? 'is-active' : '';
      const meta = v
        ? (i === 0 ? esc(v) : `${v.length.toLocaleString()}자`)
        : '비어 있음';
      return `<button type="button" class="jd-pstep ${cls}" data-goto="${i}">
        <span class="jd-pstep-mark"></span>
        <span class="jd-pstep-t"><b>${i + 1} ${esc(s.label)}</b><small>${meta}</small></span>
      </button>`;
    }).join('');

    box.querySelectorAll('[data-goto]').forEach(btn =>
      btn.addEventListener('click', () => openStep(Number(btn.dataset.goto), true)));

    /* 분석 준비 — 항목별 점이 '이 칸을 채웠나'라면, 이 막대는 '전체가 얼마나 찼나'다.
       분석을 돌릴 수 있는지도 같이 알린다. 버튼을 눌러 보고 나서 "공고를 넣으세요"를
       만나면 늦다. */
    const done = STEPS.filter(s => valueOf(s.input)).length;
    /* ── '공고 필수' 를 풀었다 ────────────────────────────────────
       예전에는 공고 30자가 없으면 아무것도 못 했다. 그런데 **공고를 못 구하는 것이
       보통이다** — 대기업 공채는 자사 채용 사이트로만 올라와서 워크넷·잡알리오에
       안 잡히고, 3단계에서 회사를 골라 와도 넘어오는 것은 회사 이름뿐인 일이 많다.
       그 상태로 입구를 잠가 두면 로드맵 3→4 가 대부분의 경우 거기서 끊긴다.

       대신 **무엇으로 시작했는지에 따라 나오는 것이 다르다**고 화면이 말한다.
       공고가 있으면 역량까지, 회사 근거만 있으면 지원동기까지. 같은 버튼이 같은
       결과를 낸다고 믿게 두면 안 된다. */
    const hasPosting = valueOf('#jd-text').length >= 30;
    const evCount = evidenceFor(valueOf('#jd-company')).length;
    const hasSource = hasPosting || evCount > 0;
    /* ── 정성스펙·STAR 는 **권장이지 조건이 아니다** (사용자 지시 2026-08-28) ──
       있으면 초안이 내 경험으로 채워지고, 없으면 분석까지만 나온다. 그 차이를 문장으로
       말하되 버튼은 잠그지 않는다 — 공고를 붙여넣고 요구 역량부터 보는 것이 이 화면의
       첫 용도다. */
    const canRun = hasSource;

    const bar = $('#jd-ready-fill');
    if (bar) {
      bar.style.width = `${(done / STEPS.length) * 100}%`;
      bar.parentElement.classList.toggle('is-ready', canRun);
    }
    /* 로그인 안 했으면 누르기 전에 알린다 — 눌러 보고 나서 로그인 화면을 만나면 늦다.
       버튼은 잠그지 않는다(누르면 run 이 로그인으로 안내하고, 로그인 후 여기로 돌아온다). */
    const loggedIn = isLoggedIn();
    const runBtn = $('#jd-run');
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.title = !loggedIn ? '역량 분석은 로그인 후 이용할 수 있어요'
        : canRun ? '' : '채용공고나 회사 근거가 필요해요';
    }
    const ready = $('#jd-ready');
    if (ready && !loggedIn) {
      ready.innerHTML = '역량 분석은 <b>로그인 후</b> 이용할 수 있어요 — '
        + '공고·문항은 지금 적어 두면 로그인 후 그대로 이어집니다.';
    } else if (ready) {
      /* 채울 게 다 채워졌으면(분석 가능) 버튼 위 안내는 지운다(사용자 지시 2026-09-01) —
         '몇 개 입력됨·정성스펙' 설명이 버튼 바로 위에서 화면을 어지럽혔다. 아직 근거가
         없을 때만 무엇을 넣어야 하는지 한 줄로 남긴다. */
      ready.innerHTML = hasSource
        ? ''
        : `<b>채용공고</b>를 넣거나, 회사 리포트에서 <b>근거를 담아</b> 오세요.`;
    }
  }

  function openStep(i, scroll) {
    const step = STEPS[i];
    const block = blockOf(step);
    if (!block) return;
    block.classList.add('is-open');
    paintBlock(step);
    paintProgress();
    if (scroll) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const el = $(step.input);
    if (el) { autoGrow(el); el.focus({ preventScroll: true }); }
  }

  function toggleBlock(block) {
    block.classList.toggle('is-open');
    if (block.classList.contains('is-open')) {
      const ta = block.querySelector('[data-grow]');
      if (ta) autoGrow(ta);
    }
    const step = STEPS[Number(block.dataset.step)];
    if (step) paintBlock(step);          // '펼치기 ↔ 접기' 문구를 같이 바꾼다
    paintProgress();
  }

  /* 넓게 보기 — 긴 공고를 통째로 확인하는 자리. Esc 로 닫힌다. */
  function setFull(block, on) {
    document.querySelectorAll('.jd-block.is-full').forEach(b => {
      if (b !== block) b.classList.remove('is-full');
    });
    block.classList.toggle('is-full', on);
    block.classList.add('is-open');
    const scrim = $('#jd-scrim');
    if (scrim) scrim.hidden = !on;
    const btn = block.querySelector('[data-full]');
    if (btn) btn.textContent = on ? '닫기' : '전체화면';
    const ta = block.querySelector('[data-grow]');
    if (ta) { if (on) ta.style.height = ''; else autoGrow(ta); ta.focus({ preventScroll: true }); }
  }

  function closeFull() {
    const open = document.querySelector('.jd-block.is-full');
    if (open) setFull(open, false);
  }

  /* 회사 리포트에서 담아 온 **공고** — 1번 칸 안에 그대로 보여준다.
     예전에는 기사·실적을 담았는데, 담은 것들이 서로 다른 종류라 여기 와서 무엇에
     쓰라는 것인지 알 수 없었다. 지금은 '지원할 공고' 하나만 담긴다. */
  function paintEvidence() {
    const box = $('#jd-evidence');
    if (!box) return;
    const company = ($('#jd-company')?.value || '').trim();
    const list = evidenceFor(company);

    if (!company) {
      box.innerHTML = `<p class="jd-hint" style="padding:0 16px 16px">회사명을 적으면 초안이 회사별로 나뉘어 저장돼요.
        회사 리포트에서 근거를 담아 오면 여기에 나타나고, 아래 채용공고 칸도 함께 채워집니다.</p>`;
      return;
    }

    /* ── 종류별로 나눠 보여준다 ──────────────────────────────────
       한 통에 섞어 놓으면 "담긴 건 알겠는데 무엇을 어디에 쓰라는 거지" 가 된다 —
       담기를 한 번 좁혔던 이유가 정확히 그것이었다. 종류마다 **어느 문항에 쓰는지**를
       같이 적는 것이 넓히기의 전제 조건이다. */
    const groups = Roadmap.evidenceByKind(company);
    box.innerHTML = `
      <div style="padding:0 16px 16px">
        <span class="wf-eyebrow">${esc(company)} · 담은 근거 ${list.length}건</span>
        ${groups.length ? `
          <div class="jd-ev-groups">
            ${groups.map(g => `
              <div class="jd-ev-group">
                <div class="jd-ev-h">
                  <b>${esc(g.label)}</b>
                  <span class="wf-badge wf-badge--mute">${g.items.length}건</span>
                  <span class="jd-ev-use">${esc(g.use.join(' · '))} 문항에 씁니다</span>
                </div>
                <div class="co-picked">
                  ${g.items.map(e => `<div class="co-picked-item"><span>
                    <b>${esc(e.text.length > 160 ? e.text.slice(0, 160) + '…' : e.text)}</b>
                    ${e.qualification || e.preference
                      ? ` <span class="wf-badge wf-badge--ok">지원자격 포함</span>` : ''}
                    ${[e.source, ...[e.region, e.career, e.edu]].filter(Boolean).length
                      ? `<br><span style="color:var(--wf-mute)">${[e.source, e.region, e.career, e.edu].filter(Boolean).map(esc).join(' · ')}</span>`
                      : ''}
                    ${e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">원문 열기</a>` : ''}
                  </span></div>`).join('')}
                </div>
              </div>`).join('')}
          </div>`
          : `<p class="jd-hint">아직 없어요. <b>회사 리포트</b>의 개요·재무·최근 이슈·채용공고 칸에서
               <b>자소서에 담기</b>를 누르면 여기로 넘어옵니다.</p>`}
      </div>`;
  }

  /* ── 담아 온 공고를 채용공고 칸에 적용한다 ───────────────────
     회사명만 넘겨받던 것을 공고까지 넘겨받도록 바꿨다. 다만 **본문은 못 받는다** —
     사람인·워크넷 API 둘 다 제목·근무지·경력·학력만 주고 공고 본문은 주지 않는다.
     그래서 받은 것만 적어 두고, 본문은 링크를 열어 붙여넣게 안내한다.

     이미 입력한 내용이 있으면 덮지 않는다. 사용자가 직접 붙여넣은 공고가
     자동 입력으로 지워지면 되돌릴 방법이 없다. */
  /* 담아 온 공고로 '채용공고' 칸을 채운다.

     ── 소스에 따라 채워지는 정도가 다르다 (B20) ──
     사람인·워크넷 목록 API 는 제목·조건만 준다. 그것만으로 분석을 돌리면 역량이
     빈약하게 나오는데, 그걸 '분석 결과'로 믿으면 안 되므로 본문을 붙여넣으라고 알린다.

     공공기관 채용정보(잡알리오)는 **지원자격·우대사항이 구조화돼서 온다.** 그 공고는
     복사·붙여넣기 없이 바로 분석이 된다 — `jd-competency.js` 가 읽는 것이 정확히
     이런 자격요건·우대사항 문장이다.

     반환값으로 '어디까지 채웠는지'를 알려준다. 호출부가 안내 문구를 고르는 데 쓴다 —
     본문이 들어갔는데도 "본문을 붙여넣으세요"라고 하면 안 된다. */
  function applyPickedJob(company) {
    const job = pickedJobs(company)[0];
    const ta = $('#jd-text');
    if (!job || !ta || ta.value.trim()) return null;

    const head = [
      `[모집분야] ${job.text}`,
      job.region ? `[근무지] ${job.region}` : null,
      job.career ? `[경력] ${job.career}` : null,
      job.edu ? `[학력] ${job.edu}` : null,
    ].filter(Boolean);

    /* 원문을 그대로 싣는다 — 요약하지 않는다. 요약은 없는 사실을 만들고, 학생은
       그걸 자소서에 쓴다(11-2 와 같은 원칙). */
    const body = [
      job.qualification ? `[자격요건]\n${job.qualification}` : null,
      job.preference ? `[우대사항]\n${job.preference}` : null,
    ].filter(Boolean);

    const tail = job.url ? [`[공고 주소] ${job.url}`] : [];

    ta.value = [...head, ...body, ...tail].join('\n');
    return body.length ? 'full' : 'head';
  }

  /* ── 공고 주소로 본문 가져오기 ──────────────────────────────
     복사를 막아 둔 공고 때문에 있다(사용자 지적). 그 차단은 브라우저에서만 걸리므로
     서버가 열면 원문이 그대로 온다.

     ── 가져온 글을 바로 분석하지 않는다 ──
     입력칸에 **채워 넣기만** 하고 멈춘다. 페이지에는 공고 말고도 회사 소개·푸터가
     섞여 들어오는데, 그대로 AI 에 넘기면 엉뚱한 문장이 역량의 근거로 붙는다
     (18-7 에서 겪은 실패 모드 — 에러가 안 나고 그럴듯해서 더 나쁘다).
     사람이 보고 지운 뒤 누르게 한다.

     이미 적어 둔 것이 있으면 덮어쓰기 전에 묻는다. */
  function urlMsg(kind, text) {
    const box = $('#jd-url-msg');
    if (!box) return;
    box.hidden = !text;
    box.className = `jd-url-msg${kind ? ` jd-url-msg--${kind}` : ''}`;
    box.textContent = text || '';
  }

  /* 실패 사유마다 사용자가 할 일이 다르다 — 같은 '안 됨' 으로 뭉치지 않는다(18-4). */
  const URL_HELP = {
    /* 서버 메시지가 이미 사유를 말한다(로그인 벽인지, 사이트가 우리 서버를 막은
       것인지). 여기서는 **할 수 있는 일**만 덧붙인다 — 사유를 두 번 말하면 서로
       어긋난다. 어느 쪽이든 브라우저로는 열리므로 복사해 오면 된다. */
    blocked: '그 페이지를 브라우저에서 열고 Ctrl+A → Ctrl+C 로 복사해 붙여넣어 주세요.',
    /* 이미지 공고는 서버가 Gemini 비전으로 읽어 본다(26-8 → 2026-09-07). 여기까지
       왔다는 건 그것마저 안 됐다는 뜻이라, 남은 길만 말한다 — 왜 안 됐는지는 서버가 말한다. */
    image:   '직접 옮겨 적거나, 사이트의 텍스트 공고를 찾아 주세요.',
    empty:   '화면에서 그려지는 공고 같아요. 그 페이지에서 Ctrl+A → Ctrl+C 로 복사해 붙여넣어 주세요.',
    gone:    '마감돼 내려간 공고일 수 있어요. 주소를 다시 확인해 주세요.',
  };

  async function fetchPostingUrl() {
    const input = $('#jd-url');
    const btn = $('#jd-url-go');
    const ta = $('#jd-text');
    if (!input || !ta) return;

    const url = input.value.trim();
    if (!url) { urlMsg('warn', '공고 주소를 붙여넣어 주세요.'); input.focus(); return; }
    if (ta.value.trim() && !confirm('공고 칸에 적어 둔 글이 있어요. 가져온 내용으로 바꿀까요?')) return;

    if (btn) { btn.disabled = true; btn.textContent = '가져오는 중…'; }
    urlMsg('', '');
    /* 글이 없는 공고는 서버가 이미지를 읽는다 — 실측으로 한 장에 30초쯤 걸린다.
       아무 말 없이 그 시간을 기다리게 하면 사용자는 멈춘 줄 알고 새로고침한다.
       실측 편차가 커서(9.7~76.5초) 초 단위로 약속하지 않는다. */
    const slow = setTimeout(() => urlMsg('', '글로 된 공고가 아니라서 공고 이미지를 읽고 있어요 — 1분 남짓 걸립니다.'), 6000);
    try {
      const r = await DB.jdPosting(url);
      clearTimeout(slow);
      ta.value = r.text;
      autoGrow(ta);
      STEPS.forEach(paintBlock);
      paintProgress();
      paintStepComps();      // 칸마다 '여기서 뽑힌 역량' 을 붙인다
      /* 확인하고 지우라고 분명히 말한다 — 그대로 분석을 누르면 푸터까지 근거가 된다.
         weak 는 "가져오긴 했는데 공고 같지 않다" 다. 사람인처럼 상세가 iframe 안에 있으면
         메뉴·안내문만 1,000자 넘게 딸려 온다 — 길이만 보면 성공이라 더 위험하다. */
      const head = r.title ? `“${r.title}” ` : '';
      const size = r.text.length.toLocaleString();
      /* 이미지에서 읽은 글은 **더 의심하게** 말한다. OCR 은 본문 추출보다 깨지고,
         26-8 에서 "읽은 것을 그대로 분석에 넘기지 않는다" 고 미리 정해 뒀다. */
      if (r.fromImage) {
        urlMsg('warn', `${head}글이 없어 공고 이미지 ${r.fromImage}장을 읽었어요 (${size}자). `
          + '잘못 읽은 글자가 있을 수 있으니 반드시 확인하고 고친 뒤 분석해 주세요.');
        ta.focus();
        return;
      }
      if (r.weak) {
        urlMsg('warn', `${head}페이지는 가져왔는데(${size}자) 공고 본문이 아닌 것 같아요 — `
          + '메뉴·안내문만 담겼을 수 있습니다. 내용을 확인하시고, 아니면 그 페이지에서 '
          + 'Ctrl+A → Ctrl+C 로 복사해 붙여넣어 주세요.');
      } else {
        urlMsg('ok', `${head}본문을 가져왔어요 (${size}자). `
          + '공고와 상관없는 부분(회사 소개·메뉴)은 지우고 분석해 주세요.');
      }
      ta.focus();
    } catch (e) {
      urlMsg('warn', `${e.message}${URL_HELP[e.kind] ? ` ${URL_HELP[e.kind]}` : ''}`);
    } finally {
      clearTimeout(slow);
      if (btn) { btn.disabled = false; btn.textContent = '가져오기'; }
    }
  }

  /* ── 고용24 직무별 자소서 작성가이드에서 채우기 (사용자 지시 2026-09-05) ──
     3번 칸은 늘 비어 있었다. 직무기술서를 따로 공개하는 회사가 드물어서, 사용자가
     "구해 오라" 는 말을 들어도 구할 데가 없었기 때문이다. 고용24 가 공채 기업의
     직무 소개·주요 업무·필요 역량·우대 사항을 직무별로 공개해 두었으니 그걸 찾아 넣는다.

     ── 공고 가져오기(fetchPostingUrl)와 다른 점 ──
     저건 사용자가 주소를 안다는 전제다. 여기는 **주소를 모른다** — 그래서 검색이 먼저
     오고, 고른 뒤에 채운다. 대신 가져온 뒤의 규칙은 같다: 채워 넣고 멈춘다(분석은
     사람이 확인하고 누른다), 적어 둔 것이 있으면 묻고 덮는다. */
  let _w24 = [];              // 지금 그려진 검색 결과 — 고를 때 번호를 여기서 찾는다

  /* 링크를 붙일 수 있다는 것만 jd-url-msg 와 다르다 — 가져온 가이드의 원문 주소를
     같이 줘야 "여기서 왔다" 를 사용자가 확인할 수 있다(근거를 보여주는 화면 규칙). */
  function w24Msg(kind, text, link) {
    const box = $('#jd-w24-msg');
    if (!box) return;
    box.hidden = !text;
    box.className = `jd-url-msg${kind ? ` jd-url-msg--${kind}` : ''}`;
    box.innerHTML = text
      ? esc(text) + (link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">고용24 원문 열기</a>` : '')
      : '';
  }

  function paintW24(total = 0, q = '') {
    const host = $('#jd-w24-list');
    if (!host) return;
    host.hidden = !_w24.length;
    if (!_w24.length) { host.innerHTML = ''; return; }

    /* 몇 건 중 몇 건을 보여주는지 적는다 — 검색어가 넓으면 원하는 회사가 아래에
       있을 수 있는데, 목록만 보면 "없다" 고 오해한다. */
    const more = total > _w24.length
      ? `<p class="jd-w24-more">‘${esc(q)}’ 로 ${total.toLocaleString()}건 중 ${_w24.length}건. 회사명을 더 정확히 적으면 좁혀집니다.</p>`
      : '';
    host.innerHTML = _w24.map((r, i) => `
      <button type="button" class="jd-w24-row" data-w24="${i}">
        <b>${esc(r.company)}</b>
        <span class="jd-w24-job">${esc(r.job)}</span>
        <small>${esc([r.year, r.half].filter(Boolean).join(' '))}${r.open ? ' · 진행중' : ''}</small>
      </button>`).join('') + more;
  }

  async function searchW24() {
    const input = $('#jd-w24-q');
    const btn = $('#jd-w24-go');
    if (!input) return;
    const q = input.value.trim();
    if (!q) { w24Msg('warn', '기업명이나 직무명을 적어 주세요.'); input.focus(); return; }

    if (btn) { btn.disabled = true; btn.textContent = '찾는 중…'; }
    w24Msg('', '');
    try {
      const r = await DB.jdGuideSearch(q);
      _w24 = r.rows || [];
      paintW24(r.total || 0, q);
      if (!_w24.length) {
        w24Msg('warn', `‘${q}’ 로 나온 가이드가 없어요. 고용24에는 공채를 등록한 기업만 올라옵니다 — `
          + '회사명 대신 직무명(예: 경영기획)으로도 찾아보세요.');
      }
    } catch (e) {
      _w24 = [];
      paintW24();
      w24Msg('warn', e.message || '고용24를 부르지 못했어요.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '찾기'; }
    }
  }

  /* 고른 가이드를 칸에 채운다.

     ── 무엇까지 채우나 ──
     직무기술서는 늘 채운다(이 칸을 채우려고 부른 것이다). 회사명과 자소서 문항은
     **비어 있을 때만** 채운다 — 사용자가 이미 적어 둔 것을 자동 입력이 지우면
     되돌릴 방법이 없다(applyPickedJob 과 같은 규칙).

     문항별 작성 가이드와 주요 Tip 은 가져오지 않는다. 저건 고용24 가 쓴 '작성 요령'
     이라 직무기술서에 섞이면 이 회사의 요구 역량으로 잡힌다. 원문은 링크로 연다. */
  async function applyW24(i) {
    const row = _w24[i];
    const ta = $('#jd-jd');
    if (!row || !ta) return;
    if (ta.value.trim() && !confirm('직무기술서 칸에 적어 둔 글이 있어요. 가져온 내용으로 바꿀까요?')) return;

    w24Msg('', '');
    try {
      const g = await DB.jdGuide(row);
      ta.value = g.jdText;

      const filled = ['직무기술서'];
      const co = $('#jd-company');
      if (co && !co.value.trim() && g.company) { co.value = g.company; filled.push('회사'); }
      /* 문항은 그 회사가 실제로 낸 문항이다 — 공고에서 못 얻는 것이라 값이 크다. */
      if (!parseQuestions().length && g.questions?.length) {
        setQBoxes(g.questions.map(q => q.text));
        filled.push(`자소서 문항 ${g.questions.length}개`);
      }

      /* 채운 칸은 펼쳐서 보여준다 — 접힌 채로 "채웠다" 고만 하면 무엇이 들어갔는지
         확인할 수 없다. */
      STEPS.forEach(s => { if (filled.length) blockOf(s)?.classList.add('is-open'); paintBlock(s); });
      document.querySelectorAll('#jd-doc [data-grow]').forEach(autoGrow);
      paintProgress();
      paintStepComps();

      _w24 = [];
      paintW24();
      w24Msg('ok', `${g.company} ${g.job} 가이드에서 ${filled.join(' · ')}을(를) 채웠어요. `
        + '내용을 확인하고 분석해 주세요. 문항별 작성 요령은 고용24 원문에 있습니다.', g.url);
    } catch (e) {
      w24Msg('warn', e.message || '가이드를 가져오지 못했어요.');
    }
  }

  function init() {
    const runBtn = $('#jd-run');
    if (runBtn) runBtn.addEventListener('click', run);

    const urlBtn = $('#jd-url-go');
    if (urlBtn) urlBtn.addEventListener('click', fetchPostingUrl);
    const urlInput = $('#jd-url');
    /* 주소를 붙여넣고 Enter 를 누르는 게 자연스럽다. 폼이 아니라 submit 이 없으므로
       직접 잡아 준다. */
    if (urlInput) urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); fetchPostingUrl(); }
    });

    /* 고용24 가이드 찾기 — 검색은 Enter 로도 돈다(검색칸의 기본 기대). 결과 줄은
       그릴 때마다 다시 생기므로 목록 자체에 한 번만 위임한다. */
    const w24Btn = $('#jd-w24-go');
    if (w24Btn) w24Btn.addEventListener('click', searchW24);
    const w24Input = $('#jd-w24-q');
    if (w24Input) w24Input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); searchW24(); }
    });
    const w24List = $('#jd-w24-list');
    if (w24List) w24List.addEventListener('click', e => {
      const row = e.target.closest('[data-w24]');
      if (row) applyW24(Number(row.dataset.w24));
    });

    const sampleBtn = $('#jd-sample');
    if (sampleBtn) sampleBtn.addEventListener('click', () => {
      $('#jd-text').value = SAMPLE;
      /* 샘플 문항은 '1. …' 문자열이라 번호를 떼어 내용만 칸에 넣는다. */
      setQBoxes(SAMPLE_QUESTIONS.split(/\r?\n/)
        .map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean));
      STEPS.forEach(s => { blockOf(s)?.classList.add('is-open'); paintBlock(s); });
      document.querySelectorAll('#jd-doc [data-grow]').forEach(autoGrow);
      paintProgress();
      $('#jd-text').focus();
    });

    /* '문항 추가' — 상한(Q_MAX)까지 빈 칸을 하나 더 연다. */
    const qAdd = $('#jd-q-add');
    if (qAdd) qAdd.addEventListener('click', () => {
      if (_qBoxes.length >= Q_MAX) return;
      _qBoxes.push('');
      renderQBoxes();
      /* 방금 추가한 칸으로 커서를 옮긴다 — 어디에 적어야 하는지 바로 보이게. */
      $('#jd-q-boxes')?.querySelector(`[data-q="${_qBoxes.length - 1}"]`)?.focus();
    });

    /* 처음 진입 시 기본 3칸과 정성스펙 카드를 그린다. */
    renderQBoxes();
    renderSpecStar();

    // 접기·펼치기
    document.querySelectorAll('#jd-doc [data-toggle]').forEach(btn =>
      btn.addEventListener('click', () => toggleBlock(btn.closest('.jd-block'))));

    // 넓게 보기
    document.querySelectorAll('#jd-doc [data-full]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const block = btn.closest('.jd-block');
        setFull(block, !block.classList.contains('is-full'));
      }));
    const scrim = $('#jd-scrim');
    if (scrim) scrim.addEventListener('click', closeFull);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFull(); });

    /* ── 프롬프트 모달의 버튼 (사용자 지시 2026-09-05) ──────────────────────
       모달은 작성 화면 바깥(careerly.html 맨 아래)에 있어서 bindWriteSide 의
       위임이 닿지 않는다. 여기서 한 번만 건다 — 본문은 열 때마다 새로 그려지므로
       버튼 하나하나가 아니라 모달 상자에 위임한다. */
    const pm = document.getElementById('jd-prompt-modal');
    pm?.addEventListener('click', e => {
      if (e.target.closest('[data-prompt-save]')) { savePromptFromModal(); return; }
      if (e.target.closest('[data-prompt-close]')) { closePromptModal(); return; }
      /* 바깥(어둡게 깔린 곳)을 누르면 닫는다 — 다른 모달과 같은 규약이다. */
      if (e.target === pm) closePromptModal();
    });

    // 자라는 입력칸 + 진행도 갱신
    STEPS.forEach(step => {
      const el = $(step.input);
      if (!el) return;
      el.addEventListener('input', () => {
        autoGrow(el);
        paintBlock(step);
        paintProgress();
        /* 칸을 고치면 그 칸에서 뽑힌 역량도 달라진다(문항을 지우면 그 문항 줄이
           사라져야 한다). 이미 돌린 결과 안에서 다시 맞추는 것뿐이라 서버를 부르지 않는다. */
        paintStepComps();
      });
      /* 입력칸 안에서 Ctrl+Enter 로 바로 분석. 칸 아래에 그렇게 적어 뒀으므로
         실제로 되게 해 둔다 — 안 되는 안내를 띄우면 그 화면 전체를 못 믿게 된다. */
      el.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      });
    });

    /* 회사명을 고치면 앞 회사의 결과를 지운다. 남겨 두면 새 회사의 자료인 줄 알고
       그 기사를 지원동기에 쓴다. 초안 저장 칸(scope)도 회사명을 따라가므로 같이 다시 그린다. */
    const companyEl = $('#jd-company');
    if (companyEl) {
      let t = null;
      companyEl.addEventListener('input', () => {
        const box = $('#jd-result');
        if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
        paintEvidence();
        clearTimeout(t);
        t = setTimeout(() => fillCompanyOptions(companyEl.value), 250);
      });
    }

    /* 회사 리포트로 넘어갈 때 지금 적은 회사명을 들고 간다 —
       이름을 다시 치게 하지 않는다. (인라인 onclick 대신 여기서 묶는다) */
    document.querySelectorAll('#jd-step-company .wf-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const name = ($('#jd-company')?.value || '').trim();
        if (name) localStorage.setItem('careerly_company_open', name);
        navigate('company');
      }));
  }

  async function fillCompanyOptions(q) {
    const dl = $('#jd-company-options');
    if (!dl) return;
    const query = (q || '').trim();
    if (query.length < 2) { dl.innerHTML = ''; return; }
    const items = await DB.suggestCompanies(query).catch(() => []);
    if (dl.dataset.q && dl.dataset.q !== query) return;   // 늦게 온 응답으로 덮지 않는다
    dl.dataset.q = query;
    dl.innerHTML = items.map(i => `<option value="${esc(i.name)}"></option>`).join('');
  }

  /* 페이지에 들어올 때마다 — 지난번 분석 결과를 지우고 들어온다. 안 지우면 다른 회사를
     보러 다시 들어와도 이전 회사의 역량·문항이 그대로 남아 새 결과인 줄 알고 읽게 된다. */
  function onEnter() {
    Roadmap.mount('rm-bar-jd', 'cover');
    const result = $('#jd-result');
    if (result) { result.hidden = true; result.innerHTML = ''; }
    /* 결과 화면만 비우고 _last 를 남겨 두면 입력 칸 아래 역량 칩(paintStepComps)이
       지난 회사의 결과를 계속 보여준다 — 지우는 김에 같이 지운다. */
    _last = null;
    _lastCompany = '';
    _wsHost = null;
    _stepOpen.clear();
    const status = $('#jd-status');
    if (status) status.textContent = '';
    closeFull();

    /* 3단계에서 회사를 골라 왔으면 그것을 쓰고, 아니면 로드맵에 남아 있는 회사를
       되살린다 — 자소서를 며칠에 걸쳐 쓰는 동안 회사 칸이 매번 비어 있으면
       흐름이 화면을 나갈 때마다 끊긴다. */
    const picked = localStorage.getItem('careerly_selected_company') || Roadmap.company();
    let applied = null;        // null | 'head'(제목·조건만) | 'full'(자격요건까지)
    if (picked && $('#jd-company')) {
      $('#jd-company').value = picked;
      localStorage.removeItem('careerly_selected_company');
      /* 담아 온 공고가 있으면 채용공고 칸까지 채운다 — 회사만 넘기면 여기서
         공고를 다시 찾아야 해서, 담기를 한 의미가 없다. */
      applied = applyPickedJob(picked);
    }

    /* 정성스펙 카드는 **로그인한 사람의 활동**이라 화면에 들어올 때마다 달라진다
       (스펙 관리에서 활동을 추가하고 돌아오는 흐름이 흔하다). 한 번만 그려 두면
       방금 적은 활동이 카드에 없다. */
    renderQBoxes();
    renderSpecStar();
    STEPS.forEach(paintBlock);
    document.querySelectorAll('#jd-doc [data-grow]').forEach(autoGrow);
    paintEvidence();
    paintProgress();
    paintStepComps();
    paintLibCount();

    /* 어디까지 채워졌는지에 따라 다르게 알린다.
         head — 제목·조건만
         full — 지원자격·우대사항까지 들어왔다
       둘 다 '본문을 이어붙이라'고 말하는 것은 같다. 공공기관 공고의 지원자격은
       **응시 요건**이지 역량 서술이 아니라, 그것만으로는 역량이 잘 안 잡힌다(실측
       532건 중 절반이 0개). 채워졌다고 다 된 것처럼 말하지 않는다. */
    if (applied) {
      openStep(1, true);
      if (typeof toast === 'function') {
        toast(applied === 'full'
          ? '공고를 지원자격까지 불러왔어요 — 역량까지 보려면 본문을 이어붙이세요'
          : '공고를 불러왔어요 — 본문을 복사해 이어붙이면 역량이 정확해져요', { icon: false });
      }
    }
  }

  /* 공고와 직무기술서를 합쳐 하나의 분석 입력으로 만든다.
     둘을 나눠 받는 건 사용자가 헷갈리지 않게 하기 위해서고, 역량 추출은 두 문서를
     같이 읽어야 정확해진다(공고에만 있는 우대사항, JD 에만 있는 업무 상세가 있다).
     구분선을 넣어 서버 문장 분리가 두 문서를 한 문장으로 잇지 않게 한다. */
  function analysisText() {
    const jd = valueOf('#jd-jd');
    const ad = valueOf('#jd-text');
    return [ad, jd].filter(Boolean).join('\n\n');
  }

  /* '1. …' / '- …' / 빈 줄로 나뉜 문항을 한 줄씩 끊는다. 번호는 표시할 때
     우리가 다시 붙이므로 떼어낸다. */
  function parseQuestions() {
    return ($('#jd-questions')?.value || '')
      .split(/\r?\n/)
      .map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
      .filter(s => s.length >= 5);
  }

  async function run() {
    const btn = $('#jd-run');
    const statusEl = $('#jd-status');
    const resultEl = $('#jd-result');
    const text = analysisText();

    /* ── 로그인해야 분석한다 (사용자 지시 2026-08-28) ─────────────────
       로그인 없이도 돌던 것을 막는다. 로그인 화면으로 보내되, 이유를 그 화면에 적어
       "왜 갑자기 로그인이지?"가 안 되게 한다. 로그인하면 app.js 의 복귀 기능이
       작성 중이던 이 자소서로 그대로 돌려보낸다(입력·고른 스펙·STAR 는 남아 있다). */
    if (!isLoggedIn()) {
      if (typeof navigate === 'function') navigate('login');
      const box = document.getElementById('login-error');
      if (box) {
        box.textContent = '역량 분석은 로그인 후 이용할 수 있어요. 로그인하면 작성 중이던 자소서로 돌아옵니다.';
        box.style.display = 'block';
      }
      return;
    }

    /* 정성스펙·STAR 는 **막지 않는다**(사용자 지시 2026-08-28, 같은 날 두 번째 지시).
       한 번은 없으면 못 돌리게 했었다. 그런데 공고를 막 붙여넣고 "무슨 역량을 요구하나"
       부터 보고 싶은 것이 이 화면의 첫 용도인데, 거기서 STAR 넉 줄을 먼저 요구하면
       화면이 시작부터 잠긴다. 재료가 없으면 초안이 얕아질 뿐 분석은 돌아간다 —
       그 사실은 STAR 칸 쪽에 적어 두고, 여기서는 길을 막지 않는다. */

    /* 공고가 없으면 담아 온 회사 근거로 간다. 서버는 역량 추출을 건너뛰고
       안내 문구(disclaimer·checklist)만 준다 — 그 문장들의 단일 출처가 서버라
       프론트에 복사해 두면 한쪽만 고쳐진다. */
    if (text.length < 30) {
      const company = valueOf('#jd-company');
      if (!evidenceFor(company).length) {
        statusEl.textContent = company
          ? '채용공고를 30자 이상 넣거나, 회사 리포트에서 근거를 담아 오세요.'
          : '채용공고를 30자 이상 넣어 주세요.';
        openStep(1, true);
        return;
      }
      return runFromEvidence(company);
    }

    btn.disabled = true;
    /* AI 보강은 항상 켠다(끄는 토글을 없앴다). 규칙만 쓰면 즉시 끝나지만
       AI 보강이 붙으면 로컬 모델에서 1분 이상 걸릴 수 있어 그 이유를 적어둔다 —
       안 그러면 사용자가 멈춘 줄 안다. */
    statusEl.textContent = '공고를 읽고 있어요… (1분 이상 걸릴 수 있어요)';
    resultEl.hidden = true;

    try {
      _last = await DB.coachJd(text, { useAi: true, company: valueOf('#jd-company') });
      _lastCompany = valueOf('#jd-company');
      /* 이 자소서(회사)에 분석 결과를 남긴다 — 보관함에서 이어쓰기로 돌아왔을 때
         역량이 없어 AI 초안이 안 되던 문제를 여기서 끊는다(사용자 지시 2026-09-01). */
      saveAnalysis(draftScope(), _last, $('#jd-questions')?.value || '');
      statusEl.textContent = '';
      _focused = 0; _tab = 0;
      /* 분석이 끝나면 **바로 작성 화면(#write)** 으로 넘어간다(사용자 지시 2026-09-01).
         예전에는 여기서 '이제 자소서를 씁니다' 안내 화면을 한 번 더 거쳤는데, 한 단계
         군더더기였다. 요구 역량은 작성 화면 오른쪽에 그대로 붙어 있다. */
      STEPS.forEach(s => blockOf(s)?.classList.remove('is-open'));
      navigate('write');
    } catch (e) {
      statusEl.textContent = '';
      resultEl.hidden = false;
      resultEl.innerHTML = `<div class="jd-err">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  /* ── 공고 없이 시작하기 ──────────────────────────────────────
     담아 온 회사 근거만으로 지원동기부터 쓴다. 서버는 작성 기준만 주고 역량은
     주지 않는다 — 역량은 공고에서 나오는 값이라, 없는데 지어 주면 근거 없는
     목록이 된다(routes/jdCoach.js /guide 주석).

     ── 문항이 없으면 하나를 깔아 준다 ──
     문항 칸이 비어 있으면 탭이 없어서 "쓸 문항이 없어요" 만 뜬다. 회사 근거를
     담아 온 사람에게 그건 막다른 길이라, 지원동기 문항 하나를 기본으로 깐다.
     사용자가 자기 문항을 넣으면 그것으로 바뀐다. */
  const DEFAULT_MOTIVE_Q = '지원 동기와 입사 후 포부를 기술해 주십시오.';

  async function runFromEvidence(company) {
    const btn = $('#jd-run');
    const statusEl = $('#jd-status');
    const resultEl = $('#jd-result');

    btn.disabled = true;
    statusEl.textContent = '담아 온 근거로 작성 기준을 준비하는 중…';
    resultEl.hidden = true;

    try {
      _last = await DB.guideJd(company);
      _lastCompany = company;
      /* 공고 없이 시작하면 역량이 안 온다(items 가 비어 있다). saveAnalysis 가
         빈 결과를 거르므로, 예전에 저장해 둔 분석을 덮어 쓰지 않는다. */
      saveAnalysis(draftScope(), _last, $('#jd-questions')?.value || '');
      statusEl.textContent = '';
      _focused = 0; _tab = 0;
      /* 문항 칸이 비어 있으면 기본 문항을 실제로 **써 넣는다**. 화면에만 띄우고
         입력칸을 비워 두면, 사용자가 문항을 고치려 할 때 어디를 고쳐야 할지 모른다. */
      if (!parseQuestions().length && $('#jd-questions')) {
        setQBoxes([DEFAULT_MOTIVE_Q]);
        paintBlock(STEPS[3]);
      }
      /* 공고 없이 시작한 경우도 바로 작성 화면으로 — 지원동기부터 쓰면 된다. */
      STEPS.forEach(s => blockOf(s)?.classList.remove('is-open'));
      navigate('write');
    } catch (e) {
      statusEl.textContent = '';
      resultEl.hidden = false;
      resultEl.innerHTML = `<div class="jd-err">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  /* ── 문항별 키워드 ───────────────────────────────────────────
     문항 문장과 역량을 맞춰 "이 문항에는 이 역량을, 내 경험 중 이걸로" 를 정리한다.

     **AI 를 부르지 않는다.** 문항 유형은 회사가 달라도 몇 가지로 수렴하고(지원동기·
     직무역량·협업·도전·성장), 유형만 맞히면 어떤 역량을 붙일지는 규칙으로 정해진다.
     AI 에 시키면 문항마다 다른 말이 나와서 같은 문항을 두 번 분석하면 답이 달라지고,
     학생은 어느 쪽이 맞는지 알 수 없게 된다. 지어낸 소재를 자소서에 쓰는 위험도 같다.

     역량 매칭은 서버가 이미 뽑아준 items(공고 근거가 붙어 있는 것)에서만 고른다 —
     화면에 없는 역량을 문항에 붙이면 근거를 추적할 수 없다.

     ── 순서가 규칙의 일부다 ──
     첫 번째로 걸리는 유형을 쓴다. 그래서 **좁은 유형을 먼저, 넓은 유형을 뒤에** 둔다.
     '직무역량'은 단어가 넓어서 앞에 두면 협업·도전 문항까지 다 삼킨다.

     ── '기술' 을 단어로 쓰면 안 된다 ──
     처음에 직무역량 규칙에 '기술' 을 넣었다가 테스트에서 걸렸다. 자소서 문항은 대부분
     "~을 기술하시오 / 기술해 주십시오" 로 끝나서, 협업·도전·성장 문항이 전부 직무역량으로
     분류됐다. 기술(技術)을 뜻하려면 뒤에 오는 말까지 같이 봐야 한다. */
  const QUESTION_TYPES = [
    { id: 'motive', label: '지원동기', match: /지원\s*(동기|이유)|왜\s*우리|입사\s*후|포부|비전|기여/,
      pick: 'news',
      how: '회사 최근 소식에서 사실 하나를 고르고 → 그 일이 왜 어려운지 → 내 경험과 맞닿는 지점 → 맡고 싶은 일 순서로 씁니다.' },
    { id: 'collab', label: '협업·갈등', match: /협업|갈등|팀|소통|설득|의견\s*차이|함께/,
      pick: 'soft',
      how: '갈등의 원인을 먼저 정의하고, 내가 한 행동과 그 결과를 숫자로 씁니다. 상대를 탓하면 감점입니다.' },
    { id: 'challenge', label: '도전·실패', match: /도전|실패|어려움|극복|한계|위기|문제\s*해결/,
      pick: 'top',
      how: '무엇이 왜 어려웠는지를 먼저 쓰고, 시도한 것 중 안 된 것까지 씁니다. 성공만 쓰면 도전이 아닙니다.' },
    { id: 'growth', label: '성장과정·가치관', match: /성장\s*과정|가치관|영향을\s*준|좌우명|인생/,
      pick: 'soft',
      how: '사건 하나만 씁니다. 그 사건이 지금 지원 직무의 어떤 태도로 이어졌는지로 닫습니다.' },
    /* 성격 장단점 — STAR 가 아니라 '단점→불편→개선→변화' 골격이라 따로 둔다(빈출 문항 표 ⑥).
       직무역량(강점)보다 앞에 둬야 "강점과 약점" 문항이 직무역량으로 새지 않는다. */
    { id: 'trait', label: '성격의 장단점', match: /성격|장단점|장점\s*과\s*단점|단점|약점|보완할\s*점/,
      pick: 'soft',
      how: '단점 → 그로 인한 불편 → 개선 노력 → 변화 순서로 씁니다. 단점은 관리 가능한 것으로, 개선의 결과까지 씁니다.' },
    /* 가장 넓은 규칙이라 맨 뒤에 둔다 — 위에서 안 걸린 문항의 기본값 역할을 겸한다. */
    { id: 'competency', label: '직무역량',
      match: /역량|직무|전문성|준비\s*과정|노력한\s*경험|강점|스킬|전문\s*지식|기술\s*(스택|력|적\s*역량)/,
      pick: 'top',
      how: '공고가 가장 많이 요구하는 역량부터 씁니다. 역량 이름을 쓰지 말고 그 역량을 쓴 상황을 씁니다.' },
  ];

  const SOFT_HINT = /협업|소통|커뮤니케이션|리더|조율|설득|책임|주도|갈등/;

  function classifyQuestion(q) {
    return QUESTION_TYPES.find(t => t.match.test(q)) || null;
  }

  /* 문항 유형 → 붙일 역량. 서버가 준 items 안에서만 고른다. */
  /* ── 기본값은 1개다 (사용자 지시·심사 2026-09-01) ─────────────────────────
     예전에는 soft 문항 2개·그 외 3개를 붙였다. 그런데 **초안이 실제로 쓰는 역량은
     언제나 하나**였고(서버가 `competency` 문자열 하나를 받는다), 화면만 3개라고
     말하고 있었다. 자동 매핑의 병은 '자동' 이 아니라 개수와 문항 무관함이었다.
       · 개수 → 1개로 줄인다. 사용자가 문항마다 0~2개로 조정한다.
       · 문항 무관 → 지원동기는 **기본 0개**다. 그 문항의 축은 역량이 아니라 회사 근거다.
     items 는 jd-competency.js 가 공고 요구 강도(score) 내림차순으로 준다 —
     기본값 1개는 곧 '공고가 가장 세게 요구한 역량' 이다. 그 앵커를 버리지 않는다. */
  function competenciesFor(type, items) {
    if (!items?.length) return [];
    /* 지원동기·포부는 회사 근거로 쓴다(question-prompts.js motive: starMode 'support').
       역량 축을 걸면 "왜 이 회사인가" 자리에 직무 이야기가 들어간다. */
    if (type?.pick === 'news') return [];
    if (type?.pick === 'soft') {
      const soft = items.filter(it => SOFT_HINT.test(it.label));
      return (soft.length ? soft : items).slice(0, 1);
    }
    return items.slice(0, 1);
  }

  /* 이 문항에 실제로 쓸 역량 — 사용자가 고른 게 있으면 그것, 없으면 기본값(자동 매핑).
     화면과 초안이 **같은 함수**를 봐야 "문항마다 이 역량으로 씁니다" 가 거짓말이 안 된다. */
  function resolveComps(type, qKey, items) {
    if (!items?.length) return [];
    const picked = cPicks(qKey);
    if (!picked) return competenciesFor(type, items);
    const byLabel = new Map(items.map(it => [it.label, it]));
    return picked.map(l => byLabel.get(l)).filter(Boolean).slice(0, C_PICK_MAX);
  }

  /* ── 공고 원문은 역량과 함께 꺼지면 안 된다 (심사 지적 2026-09-01) ──────────
     초안 호출이 `quotes: item.quotes` 로 **역량 항목에 매달아** 보내고 있었다.
     그래서 역량을 0개로 고르면 프롬프트에서 `채용공고에 적힌 이 직무가 하는 일` 이
     통째로 사라지고, 남는 사실이 회사명·직무명·문항 문구뿐이 된다. 그 상태에서
     분량 하한을 지키려면 모델이 갈 곳은 사전지식뿐이다(실측으로 겪은 지어내기다).
     그래서 역량이 0개여도 **공고 문장은 상위 역량들에서 모아 늘 보낸다.** */
  function quotesFor(comps, r) {
    const from = (comps?.length ? comps : (r?.items || []).slice(0, 3));
    const out = [];
    for (const it of from) for (const q of (it?.quotes || [])) {
      if (q && !out.includes(q)) out.push(q);
    }
    return out.slice(0, 4);
  }

  /* 문항 초안의 저장 키. **문항 문구가 아니라 순번**을 쓴다.
     문구를 키로 잡으면 오타 하나만 고쳐도 저장된 초안을 못 찾아 사라진 것처럼 보인다.
     자소서는 문항을 다듬어 가며 쓰는 물건이라 그 일이 실제로 자주 일어난다.
     대신 문항 순서를 바꾸면 초안이 자리에 남는데, 그건 화면에 적어 알린다. */
  const questionDraftKey = i => `문항${i + 1}`;

  /* ══ 결과부 — 좌우 2단 작업 화면 ═══════════════════════════ */

  /* 초안 탭. 문항을 넣었으면 문항이 탭이 되고(제출 단위가 문항이니까),
     안 넣었으면 역량이 탭이 된다. 어느 쪽이든 오른쪽 칸 하나에서 쓴다. */
  function tabsOf(r) {
    const questions = parseQuestions();
    if (questions.length) {
      return questions.map((q, i) => {
        const type = classifyQuestion(q);
        const key = questionDraftKey(i);
        return {
          kind: 'question', text: q, type,
          label: `문항 ${i + 1}`, key,
          /* 사용자가 고른 게 있으면 그것, 없으면 기본값. **화면 칩과 초안이 같은 값을
             보게** 하려고 여기서 한 번에 정한다(예전에는 칩은 comps, 초안은 전역
             _focused 를 봐서 서로 달랐다 — 심사에서 잡혔다). */
          comps: resolveComps(type, key, r.items),
        };
      });
    }
    return r.items.map(it => ({
      kind: 'item', text: it.label, type: null,
      label: it.label, key: it.label, comps: [it],
    }));
  }

  const RARITY_TEXT = {
    common: '지원자 대부분이 쓰는 역량입니다. <b>안 쓰면 감점</b>이니 반드시 넣되, 여기서 차별화되긴 어렵습니다.',
    normal: '절반 이하의 공고가 요구합니다. 근거가 있다면 <b>비중 있게</b> 쓰세요.',
    rare:   '요구하는 공고가 드뭅니다. 근거가 있다면 <b>가장 강한 차별점</b>이 됩니다.',
  };

  const hasMine = it => Boolean(it.mine?.length) && !it.gap;

  /* 역량 키워드 칩 — 왼쪽 맨 위. 눌러서 역량을 바꿔 가며 본다. */
  function keysHtml(r) {
    const ok = r.items.filter(hasMine).length;
    return `<div class="jd-comp-keys">
      <div class="jd-comp-keys-h">
        <b>요구 역량 ${r.items.length}가지</b>
        <span>내 근거 있음 ${ok} · 없음 ${r.items.length - ok}</span>
      </div>
      <div class="jd-keys">
        ${r.items.map((it, i) => `
          <button type="button" class="jd-key ${i === _focused ? 'is-on' : ''}" data-key="${i}">
            <span class="jd-key-dot ${hasMine(it) ? 'jd-key-dot--ok' : 'jd-key-dot--gap'}"></span>
            ${esc(it.label)}
            ${it.market ? `<span class="jd-key-n">${it.market.pct}%</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`;
  }

  /* 칩 설명은 **고정 머리 바깥**에 둔다. 안에 두면 두 줄짜리 안내가 화면에 계속
     붙어 있어(머리 183px) 정작 역량 카드가 보일 자리를 먹었다. 목록 맨 위에 두면
     처음 한 번은 읽히고, 카드를 읽기 시작하면 같이 밀려 올라간다. */
  const keysLegendHtml = () => `<p class="jd-hint jd-keys-legend">점이 <b>초록</b>이면 내 활동에
    쓸 소재가 있고, <b>빨강</b>이면 아직 없습니다. 옆 숫자는 같은 직군 공고 중
    이 역량을 요구한 비율이에요.</p>`;

  /* ── 요구 역량 — 좁은 목록 + 고른 것 상세 (레퍼런스 A, 사용자 선택 2026-09-01) ──────
     예전에는 7개 역량이 통째로 큰 카드로 세로로 쌓여 스크롤이 길고 무엇을 보는지 어려웠다.
     이제 **점+이름+비율만 한 줄씩** 압축해 목록으로 두고, 누른 역량 하나만 아래에 상세
     (공고 근거·작성 순서·내 소재)를 펼친다. AI 초안 버튼은 오른쪽 초안 영역으로 옮겼다. */
  function reqListHtml(r, qMap) {
    const ok = r.items.filter(hasMine).length;
    const f = r.items[_focused];
    /* ── 이 문항에 쓸 역량을 여기서 고른다 (사용자 지시 2026-09-01·04) ──────────────
       줄을 누르면 상세가 열리면서 **지금 보고 있는 문항**에 넣거나 빠진다 — 골랐다는
       표시는 별도 버튼이 아니라 줄 색(.is-picked)이다. 초안은 이 선택을 그대로
       쓴다(tabsOf → resolveComps). */
    const tab = (_lastTabs || [])[_tab];
    const onQ = tab?.kind === 'question';
    const picked = new Set((onQ ? (tab.comps || []) : []).map(c => c.label));
    const shown = [...picked];
    return `<div class="jd-reqs">
      <div class="jd-reqs-h">
        <b>요구 역량</b><span class="jd-reqs-n">${r.items.length}</span>
        <span class="jd-reqs-sub">근거 ${ok} · 없음 ${r.items.length - ok}</span>
      </div>
      ${onQ ? `<p class="jd-reqs-pick-note">${tab.label}에 쓸 역량 <b>${picked.size}</b>/${C_PICK_MAX}
        — 역량을 눌러 고르세요. ${picked.size ? '' : '<b>0개</b>면 문항 골격만으로 씁니다.'}</p>` : ''}
      <div class="jd-reqs-list">
        ${r.items.map((it, i) => `
          <div class="jd-req-row">
            <button type="button" class="jd-req ${i === _focused ? 'is-on' : ''} ${onQ && picked.has(it.label) ? 'is-picked' : ''}"
              data-key="${i}" data-cshown="${esc(shown.join('|'))}"
              ${onQ ? `aria-pressed="${picked.has(it.label)}"` : ''}>
              <span class="jd-req-dot ${hasMine(it) ? 'is-ok' : 'is-gap'}"></span>
              <span class="jd-req-name">${esc(it.label)}</span>
              ${(qMap[i] || []).length ? `<span class="jd-req-q">문항 ${(qMap[i]).join('·')}</span>` : ''}
              ${it.market ? `<span class="jd-req-n">${it.market.pct}%</span>` : ''}
            </button>
          </div>`).join('')}
      </div>
      ${f ? reqDetailHtml(f) : ''}
    </div>`;
  }

  /* 고른 역량 하나의 상세 — 공고 근거 한 줄, 기업이 보는 것, 작성 순서, 내 소재/공백. */
  function reqDetailHtml(item) {
    return `<div class="jd-req-detail">
      <div class="jd-req-detail-h">
        <b>${esc(item.label)}</b>
        ${hasMine(item)
          ? `<span class="wf-badge wf-badge--ok">내 소재 ${item.mine.length}</span>`
          : `<span class="wf-badge wf-badge--error">소재 없음</span>`}
        ${item.market ? `<span class="jd-req-detail-n">${item.market.pct}% 요구</span>` : ''}
      </div>
      ${item.quotes?.length ? `<div class="jd-req-quote">“${esc(item.quotes[0])}”</div>` : ''}
      <p class="jd-req-reads">${esc(item.reads)}</p>
      <div class="jd-req-frame">
        <span class="wf-eyebrow">이 순서로 쓰세요</span>
        ${frameHtml(item.frame)}
      </div>
      ${item.gap
        ? `<div class="jd-gap"><i class="ti ti-alert-triangle"></i> ${esc(item.gap)}</div>`
        : mineHtml(item)}
    </div>`;
  }

  /* ── 사이드바의 '내 AI 프롬프트' 칸 (사용자 지시 2026-09-05) ────────────────
     ── '기본 프롬프트' 도 목록의 한 줄이다 (사용자 지시) ──────────────────────
     예전에는 기본이 **목록에 없는 상태**(아무것도 안 켠 것)였다. 그래서 지금 무엇으로
     쓰는지 알려면 아래 안내문을 읽어야 했고, 기본으로 돌아가려면 켜 둔 것을 '다시 눌러
     끄는' 숨은 동작을 알아야 했다. 기본을 첫 줄로 올려 **라디오처럼 하나를 고르는**
     목록으로 만든다 — 무엇이 켜져 있는지가 목록만 봐도 보이고, 되돌아갈 길도 보인다.

     기본 줄은 고치기·삭제가 없다. 우리가 들고 있는 규칙이라 지울 수 있는 물건이 아니고,
     고치고 싶으면 `+` 가 그 내용을 그대로 복사해 새 프롬프트로 만들어 준다.

     ── 고른 것은 그대로 유지된다 ──
     activeId 는 localStorage 에 남아 있고 이 변경은 **그리는 방법만** 바꾼다.
     쓰던 프롬프트가 있으면 그것이 계속 켜진 채로 보인다(기본으로 되돌리지 않는다). */
  function paintPrompts() {
    const host = document.getElementById('write-prompts');
    if (!host) return;
    const { items, activeId } = loadPrompts();
    /* activeId 가 지워진 것을 가리키면 기본이 켜진 것으로 본다 — 화면과 실제가 갈리지 않게. */
    const active = items.find(p => p.id === activeId) || null;
    const onDefault = !active;

    const row = (on, id, name, builtin) => `
      <div class="wp-item ${on ? 'is-on' : ''} ${builtin ? 'wp-item--builtin' : ''}">
        <button type="button" class="wp-pick" data-prompt-pick="${esc(id)}"
          title="${on ? '지금 이 프롬프트로 씁니다' : '이 프롬프트로 쓰기'}"
          aria-pressed="${on}">
          <i class="ti ti-${on ? 'circle-check-filled' : 'circle'}"></i>
          <span class="wp-name">${esc(name)}</span>
        </button>
        ${builtin ? '' : `
          <button type="button" class="wp-edit" data-prompt-edit="${esc(id)}" title="고치기">
            <i class="ti ti-pencil"></i></button>
          <button type="button" class="wp-del" data-prompt-del="${esc(id)}" title="삭제">
            <i class="ti ti-x"></i></button>`}
      </div>`;

    host.innerHTML = `
      <div class="wp-head">
        <span class="wf-eyebrow">AI 프롬프트</span>
        <button type="button" class="wp-add" data-prompt-new title="기본 프롬프트를 복사해 새로 만들기">
          <i class="ti ti-plus"></i></button>
      </div>
      <div class="wp-list">
        ${row(onDefault, DEFAULT_PROMPT_ID, '기본 프롬프트', true)}
        ${items.map(p => row(p.id === activeId, p.id, p.name, false)).join('')}
      </div>
      <p class="wp-note">${onDefault
        ? '<b>+</b> 를 누르면 기본 프롬프트를 복사해 내 규칙을 만들 수 있어요.'
        : `<b>${esc(active.name)}</b> 로 초안을 씁니다.`}</p>`;
  }

  /* ── 프롬프트 만들기·고치기 모달 ────────────────────────────────────────────
     빈 칸에서 시작하면 무엇을 적어야 할지도, 무엇을 지우는지도 알 수 없다. 그래서
     새로 만들 때는 **기본 규칙 전문**을 서버에서 받아 미리 채운다.
     받지 못하면(오프라인·서버 오류) 빈 칸으로 열되 그 사실을 적는다 — 조용히 빈
     칸을 주면 사용자는 원래 그런 줄 안다. */
  let _promptEditId = null;

  async function openPromptModal(id) {
    _promptEditId = id || null;
    const { items } = loadPrompts();
    const cur = id ? items.find(p => p.id === id) : null;
    const body = document.getElementById('jd-prompt-body');
    const title = document.getElementById('jd-prompt-title');
    if (!body) return;
    if (title) title.textContent = cur ? '내 AI 프롬프트 고치기' : '내 AI 프롬프트 만들기';

    body.innerHTML = `<div class="sf-hint-inline">기본 규칙을 불러오는 중…</div>`;
    if (typeof openModal === 'function') openModal('jd-prompt-modal');

    let base = cur?.text || '';
    let failed = false;
    if (!base) {
      try { base = (await DB.jdPromptTemplate({ limit: 1000 }))?.rules || ''; }
      catch { failed = true; }
    }

    body.innerHTML = `
      <label class="wp-field">
        <span class="wp-label">이름</span>
        <input type="text" id="jd-prompt-name" maxlength="40"
          placeholder="${esc(nextPromptName(items))}" value="${esc(cur?.name || '')}">
        <span class="field-hint">안 적으면 <b>${esc(nextPromptName(items))}</b> 로 저장돼요.</span>
      </label>
      <label class="wp-field">
        <span class="wp-label">규칙</span>
        <textarea id="jd-prompt-text" rows="18" maxlength="${PROMPT_LEN_MAX}"
          placeholder="AI 가 초안을 쓸 때 지킬 규칙을 적어주세요.">${esc(base)}</textarea>
        <span class="field-hint"><span id="jd-prompt-count">0</span> / ${PROMPT_LEN_MAX}자</span>
      </label>
      ${failed ? `<div class="co-note co-note--tight"><i class="ti ti-info-circle"></i>
        기본 규칙을 불러오지 못했어요. 빈 칸에서 직접 적으셔도 됩니다.</div>` : ''}
      <div class="wp-actions">
        <button type="button" class="wf-btn" data-prompt-close>취소</button>
        <button type="button" class="wf-btn wf-btn--primary" data-prompt-save>
          <i class="ti ti-device-floppy"></i> 저장하기</button>
      </div>`;

    const ta = document.getElementById('jd-prompt-text');
    const cnt = document.getElementById('jd-prompt-count');
    const paint = () => { if (cnt) cnt.textContent = (ta?.value || '').length.toLocaleString(); };
    paint();
    ta?.addEventListener('input', paint);
    document.getElementById('jd-prompt-name')?.focus();
  }

  function closePromptModal() {
    _promptEditId = null;
    if (typeof closeModal === 'function') closeModal('jd-prompt-modal');
  }

  function savePromptFromModal() {
    const name = (document.getElementById('jd-prompt-name')?.value || '').trim();
    const text = (document.getElementById('jd-prompt-text')?.value || '').trim();
    if (!text) {
      if (typeof toast === 'function') toast('규칙을 적어주세요', { icon: false });
      return;
    }
    const state = loadPrompts();
    if (_promptEditId) {
      const p = state.items.find(x => x.id === _promptEditId);
      if (p) { p.name = name || p.name; p.text = text.slice(0, PROMPT_LEN_MAX); }
    } else {
      if (state.items.length >= PROMPT_MAX) {
        if (typeof toast === 'function') toast(`프롬프트는 ${PROMPT_MAX}개까지예요`, { icon: false });
        return;
      }
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      state.items.push({ id, name: name || nextPromptName(state.items), text: text.slice(0, PROMPT_LEN_MAX) });
      /* 방금 만든 것을 바로 켠다 — 만들어 놓고 다시 골라야 하면 만든 뜻이 없다. */
      state.activeId = id;
    }
    savePrompts(state);
    closePromptModal();
    paintPrompts();
    if (typeof toast === 'function') toast('저장했어요', { icon: false });
  }

  /* 이 문항에 고른 역량 칩 한 줄 (사용자 지시 2026-09-04).
     '이 문항 경험' 과 같은 모양으로 **고른 것만** 보여 준다 — 예전에는 "AI 초안 기준
     역량 X — 왼쪽 목록에서 다른 역량을 누르면 바뀝니다" 라는 문장 한 줄이었는데,
     ① 한 개만 말하면서 실제로는 두 개까지 쓰이고 ② 바꾸는 법을 매번 설명했다.
     고르고 빼는 일은 오른쪽 요구 역량 목록에서 하므로 여기는 **표시만** 한다. */
  function qCompChipsHtml(tab) {
    if (tab?.kind !== 'question') return '';
    const comps = (tab.comps || []).filter(Boolean);
    if (!comps.length) return '';
    return `<div class="jd-dspec">
      <span class="jd-dspec-lab">이 문항 역량</span>
      ${comps.map(c => `<span class="jd-dspec-chip is-on is-static">${esc(c.label)}</span>`).join('')}
    </div>`;
  }

  /* 초안 영역의 정성스펙 칩 한 줄 — 이 문항에 고른 경험(0~3)을 압축해 보이고, 눌러 바꾼다.
     STAR 편집은 위 문항 칸에서(레퍼런스 A: 초안 옆엔 칩만). */
  function qSpecChipsHtml(qKey) {
    const acts = myActs();
    if (!acts.length) return '';
    const picked = qPicks(qKey);
    return `<div class="jd-dspec">
      <span class="jd-dspec-lab">이 문항 경험</span>
      ${acts.map(a => {
        const k = actKeyOf(a);
        const on = picked.includes(k);
        const full = !on && picked.length >= Q_PICK_MAX;
        return `<button type="button" class="jd-dspec-chip ${on ? 'is-on' : ''}"
          data-dqpick="${esc(k)}" data-dqkey="${esc(qKey)}" ${full ? 'disabled' : ''}>
          <i class="ti ti-${on ? 'check' : 'plus'}"></i>${esc(actTitle(a))}</button>`;
      }).join('')}
    </div>`;
  }

  function frameHtml(frame) {
    const raw = String(frame || '').trim();
    if (!raw) return '';
    const steps = raw.split('→').map(s => s.trim()).filter(Boolean);
    if (steps.length < 2) return `<div class="jd-frame">${esc(raw)}</div>`;
    /* 원문의 ①②③ 은 뗀다 — 번호는 CSS 가 다시 매기므로 두면 '① 1' 이 된다. */
    return `<ol class="jd-steps">${steps
      .map(s => `<li>${esc(s.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, ''))}</li>`).join('')}</ol>`;
  }

  function mineHtml(item) {
    if (item.gap) return `<div class="jd-gap"><i class="ti ti-alert-triangle"></i> ${esc(item.gap)}</div>`;
    if (!item.mine?.length) return '';
    return `<ul class="jd-mine">
      ${item.mine.map((m, i) => `
        <li class="${i === 0 ? 'is-top' : ''}">
          <div class="jd-mine-name">${esc(m.name)}${i === 0
            ? ' <span class="wf-badge wf-badge--ok">1순위</span>' : ''}</div>
          <div class="jd-mine-meta">${esc(m.typeLabel)}${m.duration ? ' · ' + esc(m.duration) : ''}${
            m.role ? ' · ' + esc(m.role) : ''}${
            m.outcome && m.outcome !== '결과물 없음' ? ' · ' + esc(m.outcome) : ''}</div>
        </li>`).join('')}
    </ul>`;
  }

  /* 한 역량의 상세. 펼친 것만 보이고 나머지는 머리줄만 남는다 —
     예전에는 7개가 통째로 세로로 쌓여 카드 하나가 화면보다 길었다. */
  function compHtml(item, i, qMap) {
    const m = item.market;
    const badges = qMap[i] || [];

    return `<div class="jd-comp ${i === _focused ? 'is-open' : ''}" id="jd-comp-${i}">
      <button type="button" class="jd-comp-h" data-comp="${i}">
        <span class="jd-comp-rank">${i + 1}</span>
        <span class="jd-comp-h-t">
          <b>${esc(item.label)}</b>
          <span class="jd-comp-h-meta">
            ${m ? `<span class="jd-freq jd-freq--${esc(m.rarity)}">
                     <span class="jd-freq-bar"><i style="width:${Math.min(100, m.pct)}%"></i></span>
                     <span class="jd-freq-t">${m.pct}% 요구</span>
                   </span>` : ''}
            ${hasMine(item)
              ? `<span class="wf-badge wf-badge--ok">내 소재 ${item.mine.length}건</span>`
              : `<span class="wf-badge wf-badge--error">소재 없음</span>`}
            ${badges.map(n => `<span class="wf-badge wf-badge--mute">문항 ${n}</span>`).join('')}
            <!-- 어디서 뽑았는지는 카드를 **읽을 때** 필요한 정보다. 접힌 줄에서는
                 CSS 로 숨긴다 — 훑을 때 배지가 넷이면 정작 '소재 없음'이 안 보인다. -->
            <span class="wf-badge wf-badge--mute jd-comp-src">${item.source === 'ai' ? 'AI 추출' : '공고 키워드'}</span>
          </span>
        </span>
      </button>

      <div class="jd-comp-body">
        ${m ? `<div class="jd-comp-sec">
          <span class="wf-eyebrow">시장 빈도</span>
          <p class="jd-comp-p">${esc(m.bucket)} 공고 <b>${m.sample}건</b> 중 ${m.count}건이 요구 —
            ${RARITY_TEXT[m.rarity] || ''}</p>
        </div>` : ''}

        <div class="jd-comp-sec">
          <span class="wf-eyebrow">기업이 보는 것</span>
          <p class="jd-comp-p">${esc(item.reads)}</p>
        </div>

        ${item.quotes?.length ? `<div class="jd-comp-sec">
          <span class="wf-eyebrow">공고 근거</span>
          ${item.quotes.map(q => `<div class="jd-quote">${esc(q)}</div>`).join('')}
        </div>` : ''}

        <div class="jd-comp-sec jd-comp-sec--do">
          <span class="wf-eyebrow">이 순서로 쓰세요</span>
          ${frameHtml(item.frame)}
          <p class="jd-hint">${bold(item.lead)}</p>
          <div class="jd-ai-row">
            <button type="button" class="wf-btn wf-btn--sm wf-btn--primary" data-ai="${i}">
              <i class="ti ti-sparkles"></i> AI 초안 넣기
            </button>
            <span class="jd-ai-state" data-ai-state="${i}"></span>
          </div>
          <p class="jd-hint">내 활동·공고 근거·이 역량을 같이 읽고 문단을 만들어 오른쪽 작성칸에 넣습니다.
            <b>모르는 수치는 [대괄호]로 남습니다</b> — 그 자리는 본인 사실로 채우셔야 해요.</p>
        </div>

        ${(item.mine?.length || item.gap) ? `<div class="jd-comp-sec">
          <span class="wf-eyebrow">소재로 쓸 내 경험</span>
          ${mineHtml(item)}
        </div>` : ''}

        ${item.openings?.length ? `<div class="jd-comp-sec">
          <span class="wf-eyebrow">첫 문장 틀 · ${esc(item.openings[0].basedOn)} 기준</span>
          ${item.openings[0].warn
            ? `<div class="jd-gap" style="margin-bottom:8px"><i class="ti ti-alert-triangle"></i> ${esc(item.openings[0].warn)}</div>` : ''}
          <ul class="jd-openings">
            ${item.openings.map(o => `<li>
              <div class="jd-opening-label">${esc(o.label)}</div>
              <p class="jd-opening-text">${esc(o.text)}</p>
            </li>`).join('')}
          </ul>
          <p class="jd-hint"><b>[대괄호]는 직접 채우세요.</b> 채우지 않으면 문장이 되지 않습니다 —
            남은 빈칸은 오른쪽 작성칸 아래가 세어 줍니다.</p>
        </div>` : ''}

        ${item.openers?.length ? `<div class="jd-comp-sec">
          <span class="wf-eyebrow">첫 문장 여는 방법</span>
          <ul class="jd-list">${item.openers.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        </div>` : ''}

        <div class="jd-comp-sec">
          <span class="wf-eyebrow">반드시 숫자로 바꿀 것</span>
          <ul class="jd-list">${item.numbers.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>

        <div class="jd-comp-sec">
          <span class="wf-eyebrow">이렇게 쓰면 감점</span>
          <ul class="jd-list jd-list--avoid">${item.avoid.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        </div>

        ${item.followup ? `<div class="jd-followup">
          이렇게 쓰면 면접에서 이걸 물어봅니다 — <b>“${esc(item.followup)}”</b>
        </div>` : ''}

        <!-- AI 초안이 같이 준 '채워야 할 빈칸'과 '약한 지점'이 여기에 들어온다 -->
        <div data-ai-notes="${i}"></div>
      </div>
    </div>`;
  }

  /* ══ 입력 칸 아래의 역량 미리보기 ═══════════════════════════
     분석 결과는 화면 **아래** 작업창에 있다. 그런데 공고를 고치거나 문항을 더
     넣으려고 입력 칸을 다시 열면 결과가 화면 밖으로 나가서, "내가 지금 고치는
     이 글에서 무엇이 뽑혔더라"를 확인하려면 오르내려야 했다.
     칸마다 그 칸에서 나온 역량을 칩으로 붙이고, 누르면 그 자리에서 펼친다.

     ── 어느 칸에 어느 역량을 붙이는가 (지어내지 않는다) ──
       1 지원 회사   — 붙지 않는다. 역량은 공고에서 나오지 회사명에서 나오지 않는다.
                       대신 지원동기의 근거가 어디서 오는지만 한 줄로 말한다.
       2 채용공고    — 역량의 **공고 근거 문장이 이 칸 원문에 있는** 것들
       3 직무기술서  — 같은 규칙. 두 칸에 다 있으면 양쪽에 다 뜬다(실제로 둘 다에 있다)
       4 자소서 문항 — 문항마다 배정된 역량. 배정 규칙은 결과부 탭(tabsOf)과 같은
                       것을 쓴다. 두 곳이 다른 답을 내면 어느 쪽을 믿을지 알 수 없다. */

  let _stepOpen = new Map();          // 입력 칸 index → 펼쳐 둔 역량 index

  /* 근거 문장이 그 칸에서 나왔는지 — 공백을 지우고 견준다. 서버가 문장을 다듬어
     주기 때문에(줄바꿈·들여쓰기 정리) 원문과 글자 그대로는 잘 안 맞는다. */
  const squash = s => String(s || '').replace(/\s+/g, '');

  function compsFromText(r, text) {
    const hay = squash(text);
    if (!hay) return [];
    return r.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => (it.quotes || []).some(q => q && hay.includes(squash(q))));
  }

  /* 칩 하나. 결과부 왼쪽 목록의 칩(.jd-key)과 같은 부품이다 — 같은 것을 가리키니
     같은 모양이어야 한다. 점 색(초록/빨강)의 뜻도 그대로다. */
  const stepKeyHtml = (it, i, step, on) => `
    <button type="button" class="jd-key ${on ? 'is-on' : ''}"
      data-step-key="${step}" data-step-key-i="${i}" aria-expanded="${on}">
      <span class="jd-key-dot ${hasMine(it) ? 'jd-key-dot--ok' : 'jd-key-dot--gap'}"></span>
      ${esc(it.label)}
    </button>`;

  function stepBriefHtml(item, i) {
    return `<div class="jd-step-brief" data-accent="${i % 5}">
      <div class="jd-comp-sec">
        <span class="wf-eyebrow">기업이 보는 것</span>
        <p class="jd-comp-p">${esc(item.reads)}</p>
      </div>
      ${item.quotes?.length ? `<div class="jd-comp-sec">
        <span class="wf-eyebrow">공고 근거</span>
        ${item.quotes.map(q => `<div class="jd-quote">${esc(q)}</div>`).join('')}
      </div>` : ''}
      <div class="jd-comp-sec">
        <span class="wf-eyebrow">이 순서로 쓰세요</span>
        ${frameHtml(item.frame)}
      </div>
      <button type="button" class="jd-step-more" data-step-more="${i}">
        이 역량 전체 가이드 보기 <i class="ti ti-arrow-narrow-right"></i>
      </button>
    </div>`;
  }

  function stepCompsHtml(step, r) {
    const open = _stepOpen.get(step);        // 펼쳐 둔 역량 index. 없으면 undefined
    const brief = () => (open == null ? '' : stepBriefHtml(r.items[open], open));

    /* 1 지원 회사 */
    if (step === 0) {
      const n = evidenceFor(valueOf('#jd-company')).length;
      return `<p class="jd-step-comps-note">지원동기 문항은 공고가 아니라 <b>회사 근거</b>로 씁니다 —
        지금 담아 둔 근거 ${n}건.</p>`;
    }

    /* 4 자소서 문항 — 문항마다 한 줄 */
    if (step === 3) {
      const tabs = tabsOf(r).filter(t => t.kind === 'question');
      if (!tabs.length) return '';
      return `<div class="jd-step-comps-in">
        <span class="wf-eyebrow">문항마다 이 역량으로 씁니다</span>
        ${tabs.map(t => `<div class="jd-step-q">
          <span class="jd-step-q-n">${esc(t.label)}</span>
          <span class="jd-step-q-keys">
            ${t.type?.pick === 'news'
              ? `<span class="wf-badge wf-badge--soft">회사 근거로 씁니다</span>`
              : t.comps.map(c => {
                  const i = r.items.indexOf(c);
                  return i < 0 ? '' : stepKeyHtml(c, i, step, i === open);
                }).join('')}
          </span>
        </div>`).join('')}
        ${brief()}
      </div>`;
    }

    /* 2 채용공고 · 3 직무기술서 */
    const found = compsFromText(r, valueOf(STEPS[step].input));
    if (!found.length) {
      return valueOf(STEPS[step].input)
        ? `<p class="jd-step-comps-note">이 칸의 문장에서는 역량 근거를 찾지 못했어요.
             ${step === 2 ? '공고 칸에서 뽑힌 역량은 위 2번 칸 아래에 있습니다.' : ''}</p>`
        : '';
    }
    return `<div class="jd-step-comps-in">
      <span class="wf-eyebrow">이 칸에서 뽑힌 역량 ${found.length}가지</span>
      <div class="jd-keys">${found.map(({ it, i }) => stepKeyHtml(it, i, step, i === open)).join('')}</div>
      ${brief()}
    </div>`;
  }

  function paintStepComps() {
    document.querySelectorAll('[data-step-comps]').forEach(host => {
      const step = Number(host.dataset.stepComps);
      if (!_last?.items?.length) { host.innerHTML = ''; return; }
      host.innerHTML = stepCompsHtml(step, _last);

      host.querySelectorAll('[data-step-key]').forEach(el =>
        el.addEventListener('click', () => {
          const i = Number(el.dataset.stepKeyI);
          /* 같은 칩을 다시 누르면 접는다. 칸마다 하나씩만 펼친다 — 넷을 다 펼치면
             입력 칸을 못 찾는다(이 화면의 주인공은 입력 칸이다). */
          if (_stepOpen.get(step) === i) _stepOpen.delete(step);
          else _stepOpen.set(step, i);
          paintStepComps();
        }));

      host.querySelectorAll('[data-step-more]').forEach(el =>
        el.addEventListener('click', () => {
          focusItem(Number(el.dataset.stepMore));
          $('#jd-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    });
  }

  /* 오른쪽 초안 칸. 지금 고른 탭 하나만 그린다. */
  /* ── 문항별 정성스펙 피커 (0~3개) + 인라인 STAR ────────────────────
     **역량 분석 전, 문항을 적을 때 한 자리에서** 이 문항에 쓸 경험을 고르고 STAR 를 적는다
     (사용자 지시 2026-08-31 · 두 번째). 고른 게 있으면 그 STAR 로 초안을 쓰고(2개↑면 공통점으로
     묶는다), 안 고르면 STAR 없이 문항 골격으로 쓴다. '대표' 개념은 없앴다 — 순서에 뜻이 없다.

     STAR 는 **활동 하나당 하나**로 저장한다(starKeyOf). 같은 활동을 두 문항에 골라도 STAR 는
     한 벌이라 한 곳에서 고치면 양쪽이 같이 바뀐다 — 같은 글을 두 번 쓰게 하지 않는다. */
  function qPickerHtml(qKey) {
    const acts = myActs();
    const picked = qPicks(qKey);
    if (!acts.length) {
      return `<div class="jd-qpick jd-qpick--empty"><i class="ti ti-info-circle"></i>
        쓸 <b>정성스펙</b>(인턴·공모전 등)이 없어요.
        <button type="button" class="jd-q-link" data-q-spec-go>스펙 관리에서 추가하기</button>
        <span class="co-src">안 골라도 문항 골격으로 초안은 나옵니다.</span></div>`;
    }
    return `<div class="jd-qpick" data-qkey="${esc(qKey)}">
      <div class="jd-qpick-h">이 문항에 쓸 정성스펙 <b>${picked.length}/${Q_PICK_MAX}</b>
        <span class="co-src">고르면 그 경험(STAR)으로 · 여러 개면 공통점으로 묶어서 · 안 고르면 문항 골격으로</span></div>
      <div class="jd-qpick-list">
        ${acts.map(a => {
          const k = actKeyOf(a);
          const on = picked.includes(k);
          const full = !on && picked.length >= Q_PICK_MAX;
          const star = on ? starForAct(k) : {};
          return `<div class="jd-qpick-item ${on ? 'is-on' : ''}">
            <button type="button" class="jd-qpick-chip ${on ? 'is-on' : ''}"
              data-qpick="${esc(k)}" ${full ? 'disabled title="3개까지 고를 수 있어요"' : ''} aria-pressed="${on}">
              <i class="ti ti-${on ? 'check' : 'plus'}"></i> ${esc(actLabel(a))}</button>
            ${on ? `<div class="jd-qpick-star">
              ${STAR_FIELDS.map(f => `<label class="jd-qpick-star-cell">
                <span class="jd-qpick-star-tag">${f.k} · ${f.lab}</span>
                <textarea class="jd-qpick-star-in" data-qstar="${esc(k)}" data-star-key="${f.k}" rows="2"
                  placeholder="${esc(f.hint)}">${esc(star[f.k] || '')}</textarea>
              </label>`).join('')}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function bindQPicks(host, qKey) {
    /* 칩을 눌러 고르거나 뺀다(0~3개). 누르면 그 자리만 다시 그린다. */
    host.querySelectorAll('[data-qpick]').forEach(el => el.addEventListener('click', () => {
      toggleQPick(qKey, el.dataset.qpick);
      repaintQPicker(host, qKey);
    }));
    /* STAR 입력 — 활동키로 저장한다(문항이 아니라 활동 단위). 타이핑 중에는 다시 그리지
       않는다(커서를 잃는다) — 저장만 하고 칸 크기만 맞춘다. */
    host.querySelectorAll('[data-qstar]').forEach(el => {
      autoGrow(el);
      el.addEventListener('input', () => {
        saveStar(starKeyOf(el.dataset.qstar), el.dataset.starKey, el.value);
        autoGrow(el);
      });
    });
    host.querySelectorAll('[data-q-spec-go]').forEach(el => el.addEventListener('click', () => {
      if (typeof navigateTo === 'function') navigateTo('mypage', 'spec');
      else if (typeof navigate === 'function') navigate('mypage');
    }));
  }

  /* 한 문항의 피커만 다시 그린다 — 다른 문항 칸/작성칸의 커서를 건드리지 않는다. */
  function repaintQPicker(host, qKey) {
    host.innerHTML = qPickerHtml(qKey);
    bindQPicks(host, qKey);
  }

  function draftHtml(r, tabs) {
    const tab = tabs[_tab] || tabs[0];
    if (!tab) {
      return `<div class="jd-draft-pane"><div class="jd-empty">쓸 문항이 없어요.
        위 <b>자소서 문항</b> 칸에 문항을 한 줄에 하나씩 넣으면 문항별로 쓸 수 있습니다.</div></div>`;
    }
    /* 이 문항의 분량 상한(사용자 지시 2026-09-03). 안 정했으면 기본 1,000자다. */
    const lim = limitOf(tab.key);

    const company = valueOf('#jd-company');
    /* 지원동기 문항은 공고가 아니라 **회사 근거**가 재료다. 담아 온 것 중 이 문항
       유형에 쓰는 것만 고른다 — 종류를 안 가리고 다 올리면 지원동기 칸에 채용공고
       제목이 섞여서, 담기를 넓힌 만큼 도리어 헷갈린다(3단계 담기의 옛 실패와 같은 부류).
       무엇이 어느 문항에 쓰이는지의 단일 출처는 Roadmap.EVIDENCE_KINDS 다. */
    const isMotive = tab.type?.pick === 'news';
    const ev = tab.type ? Roadmap.evidenceFor(company, tab.type.label) : [];

    /* 지원동기만 맥락 한 줄을 남긴다 — 담아 온 근거가 몇 건인지는 화면 어디에도 없다.
       그 밖의 문항에 있던 "AI 초안 기준 역량 X — 왼쪽 목록에서 다른 역량을 누르면
       바뀝니다" 는 지웠다(사용자 지시 2026-09-04). 고른 역량은 아래 칩 줄이
       '이 문항 경험' 과 같은 모양으로 보여 주므로, 같은 말을 문장으로 또 할 이유가 없다. */
    const ctx = isMotive
      ? `<div class="jd-qctx">${ev.length
           ? `담아 온 회사 근거 <b>${ev.length}건</b>으로 지원동기를 씁니다`
           : `<span class="jd-qctx-warn"><i class="ti ti-info-circle"></i> 회사 리포트에서 근거를 담으면 지원동기가 정확해져요</span>`}</div>`
      : '';

    const draft = getDraft(tab.key);

    return `<div class="jd-draft-pane">
      <!-- 문항 큰 탭 -->
      <div class="jd-qtabs">
        ${tabs.map((t, i) => {
          return `<button type="button" class="jd-qtab ${i === _tab ? 'is-on' : ''}" data-tab="${i}">
            <span class="jd-qtab-lab">${esc(t.label)}</span>
          </button>`;
        }).join('')}
      </div>

      <!-- 문항 제목(크게) + how + 정성스펙 칩 + 맥락 -->
      <div class="jd-qhead">
        <div class="jd-qprompt-q">${esc(tab.text)}</div>
        ${tab.kind === 'question' ? `<p class="jd-qprompt-how">${tab.type
          ? esc(tab.type.how)
          : '문항 유형을 알아보지 못했어요. 왼쪽 역량 중 이 문항과 가까운 것을 직접 고르세요.'}</p>` : ''}
        ${qCompChipsHtml(tab)}
        ${qSpecChipsHtml(tab.key)}
        ${isMotive ? '<div data-motive-notes></div>' : ''}
        ${ctx}
      </div>

      <!-- 초안 에디터 · AI 초안 넣기 + 저장하기는 여기 머리에(사용자 지시 2026-09-01).
           AI 버튼은 문항 종류와 무관하게 늘 보인다 — 지원동기는 담은 근거로, 그 밖은
           고른 역량으로 쓴다(분기는 bind 의 data-ai-draft 핸들러). -->
      <div class="jd-draft-editor">
        <div class="jd-draft-h">
          <b>내 초안</b>
          <span class="jd-draft-end">
            <!-- 분량 상한 — 공고에 적힌 값을 그대로 넣는다(1,000자 / 2,000 byte).
                 비우면 기본 1,000자. AI 초안이 이 값을 목표로 쓴다. -->
            <label class="jd-limit" title="공고에 적힌 분량을 넣으세요. 비우면 1,000자입니다">
              <span class="jd-limit-lab">분량</span>
              <input type="number" class="jd-limit-n" id="jd-limit-n" inputmode="numeric"
                min="${LIMIT_MIN}" step="100" placeholder="${LIMIT_DEFAULT}"
                value="${lim.custom ? lim.n : ''}" aria-label="분량 상한">
              <select class="jd-limit-u" id="jd-limit-u" aria-label="분량 단위">
                <option value="char"${lim.unit === 'char' ? ' selected' : ''}>자</option>
                <option value="byte"${lim.unit === 'byte' ? ' selected' : ''}>byte</option>
              </select>
            </label>
            <button type="button" class="wf-btn wf-btn--sm" data-ai-draft>
              <i class="ti ti-sparkles"></i> AI 초안 넣기</button>
            <button type="button" class="wf-btn wf-btn--sm wf-btn--primary" data-save-draft>
              <i class="ti ti-device-floppy"></i> 저장하기</button>
          </span>
          <!-- 상태·진행률은 버튼 줄 아래 한 줄을 통째로 쓴다 (사용자 지적 2026-09-04) -->
          <span class="jd-draft-state" id="jd-draft-state"></span>
        </div>
        <div class="jd-draft-wrap">
          <textarea class="jd-draft-text" id="jd-draft" data-key="${esc(tab.key)}"
            placeholder="여기에 씁니다 — 적는 대로 저장돼요. 위 ‘AI 초안 넣기’로 시작해도 좋아요.">${esc(draft)}</textarea>
        </div>
        <div class="jd-draft-foot">
          <span class="jd-draft-count" id="jd-draft-count"></span>
          <span>이 브라우저에만 저장${company ? ` · ${esc(company)} 기준` : ''}</span>
          <span class="jd-chk-row" id="jd-chk"></span>
        </div>
      </div>
    </div>`;
  }

  /* 활동 유형 id → 짧은 이름. 스펙입력(CAS.ACTIVITY_TYPES)과 같은 말이되, 코치에서는
     CAS 를 안 불러도 되게 필요한 것만 둔다. 없으면 유형 id 를 그대로 쓴다. */
  const ACT_TYPE_LABEL = {
    internship: '인턴십', competition: '공모전', extracurricular: '대외활동',
    project: '프로젝트', research: '연구', club: '동아리·학회',
    exchange: '교환학생', volunteer: '봉사',
  };
  /* 스펙입력에서 STAR 를 적은 활동만 가져올 수 있다(빈 활동은 채울 게 없다). */
  const actHasStar = a => a?.star && ['s', 't', 'a', 'r'].some(k => (a.star[k] || '').trim());
  const actTitle = a => a.name || a.org || ACT_TYPE_LABEL[a.type] || a.type || '활동';

  /* 결과 화면에서 STAR 를 고치러 가는 자리 — 고르고 적는 곳은 입력부의 정성스펙 카드
     하나뿐이다. 결과 화면의 STAR 띠·입력은 없앴다(사용자 지시 2026-08-28): 같은 네 칸이
     화면에 두 번(입력부 카드 + 결과 화면 띠) 떠서 어디에 적는지 헷갈렸다. 초안 되짚기가
     "이 칸을 더 적어라" 할 때는 그 카드로 데려간다.

     ── 왜 STAR 를 결과에서 없애도 되나 ──
     AI 초안은 STAR 를 currentStar()(정성스펙 카드 저장소)에서 읽는다. 결과 화면 띠는
     같은 저장소를 다른 자리에서 보여줬을 뿐이라, 없애도 초안 재료는 그대로다. */
  /* 정성스펙·STAR 를 고치러 가는 자리 — 이제 각 문항 칸 아래다(2026-08-31 · 두 번째).
     자소서 문항 칸을 열고 그리로 데려간다. */
  function goSpecStar() {
    openStep(3, true);
    document.querySelector('#jd-q-boxes .jd-qpick-star-in, #jd-q-boxes .jd-qpick-chip')
      ?.focus({ preventScroll: true });
  }

  function checklistHtml(r) {
    if (!r.checklist?.length) return '';
    return `<div class="co-sec">
      <div class="co-sec-h"><h2>제출 전 체크리스트</h2></div>
      <div class="wf-card">
        <ul class="jd-list">${r.checklist.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
        <p class="jd-hint">위에서부터 순서대로 봅니다 — 앞이 걸리면 뒤를 볼 필요가 없어요.
          상투 표현·AI 흔적은 작성칸 아래에서 검사합니다 — 초안은 <b>이 브라우저 밖으로 나가지 않아요</b>.</p>
      </div>
    </div>`;
  }

  function render(r) {
    const box = $('#jd-result');
    if (!box) return;
    box.hidden = false;

    /* 역량이 비는 경우가 둘인데 뜻이 정반대다.
         · 공고를 넣었는데 못 뽑았다      → 공고를 다시 넣어야 한다
         · 애초에 공고 없이 시작했다      → 정상이다. 지원동기부터 쓰면 된다
       빈 목록 하나로 두 경우를 같이 처리하면, 근거를 담아 온 사람이 "실패했다" 는
       화면을 보게 된다(16-5 · 17-5 와 같은 원칙 — 빈칸의 뜻을 갈라 적는다). */
    if (!r.items?.length && r.mode !== 'company') {
      box.innerHTML = `<div class="wf-card"><div class="jd-empty">공고에서 역량을 뽑아내지 못했어요.
        모집분야·자격요건이 들어간 본문을 넣어 주세요.</div></div>`;
      return;
    }

    _focused = Math.max(0, Math.min(_focused, r.items.length - 1));
    const tabs = tabsOf(r);
    _lastTabs = tabs;
    _tab = Math.min(_tab, Math.max(0, tabs.length - 1));

    /* 역량 → 그 역량이 배정된 문항 번호. 예전에는 문항 카드가 따로 한 벌 더 나와서
       같은 역량 설명을 두 번 읽어야 했다. 여기서는 역량 줄에 문항 번호만 붙인다. */
    const qMap = {};
    tabs.forEach((t, ti) => {
      if (t.kind !== 'question') return;
      t.comps.forEach(c => {
        const i = r.items.indexOf(c);
        if (i < 0) return;
        (qMap[i] = qMap[i] || []).push(ti + 1);
      });
    });

    const src = r.mode === 'company'
      ? '공고 없이 시작 — 담아 온 회사 근거 기준'
      : r.provider === 'rule'
        ? '공고 키워드로 직접 추출 (AI 미사용)'
        : `공고 키워드 + AI 보강 (${esc(r.model || r.provider)})`;

    box.innerHTML = `
      <div class="jd-workspace">
        <div class="jd-ws-bar">
          <h2>분석 결과</h2>
          <span class="jd-ws-src">${r.mode === 'company'
            ? src
            : `공고 문장 ${r.jdSentences}개를 읽었어요 · ${src}`}</span>
          <span class="jd-ws-end">
            ${r.notice ? `<span class="jd-notice">${esc(r.notice)}</span>` : ''}
            <button type="button" class="wf-btn wf-btn--sm" data-reopen>입력 다시 보기</button>
          </span>
        </div>

        <div class="jd-split">
          <div class="jd-comp-pane">
            ${r.items.length
              ? reqListHtml(r, qMap)
              : `<div class="jd-empty jd-empty--soft">
                   <b>요구 역량은 공고에서 나옵니다.</b>
                   <p>지금은 담아 온 회사 근거로 <b>지원동기</b>를 쓰는 중이에요.
                      위 <b>채용공고</b> 칸에 공고 본문을 붙여넣고 다시 누르면
                      이 자리에 요구 역량과 내 경험 배정이 나옵니다.</p>
                   <button type="button" class="wf-btn wf-btn--sm" data-reopen>공고 넣으러 가기</button>
                 </div>`}
          </div>
          ${writeCtaHtml(r, tabs)}
        </div>

        ${r.market ? `<p class="jd-hint" style="margin-top:10px">시장 비율은 워크넷
          <b>${esc(r.market.bucket)}</b> 채용공고 ${r.market.totalJobs.toLocaleString()}건을
          ${esc(r.market.basedOn)} 기준으로 집계한 값이에요. 공고 본문에 적혔지만 제목에 없는 요건은
          빠지므로 실제보다 낮게 나옵니다.</p>` : ''}

        <div class="co-sec">
          <div class="jd-disclaimer"><i class="ti ti-alert-circle"></i> ${esc(r.disclaimer)}</div>
        </div>

        ${checklistHtml(r)}
      </div>`;

    _wsHost = box;                      // 지금 작업 화면은 분석(#jd-result)
    bind(box, r, tabs);
  }

  /* ── 분석 결과 오른쪽: 작성 화면으로 넘어가는 자리 (2026-09-01) ──────────────
     예전에는 이 자리에 초안 에디터(draftHtml)가 바로 붙어 있었다. 링커리어처럼 작성을
     **별도 페이지(#write)** 로 뗐으므로(사용자 지시), 여기서는 "이제 쓴다" 는 안내와
     문항별 진척(글자수)만 보이고, 실제 작성은 버튼으로 #write 로 넘어간다. */
  function writeCtaHtml(r, tabs) {
    const rows = (tabs || []).map(t => {
      const len = getDraft(t.key).length;
      return `<div class="jd-wcta-row">
        <span class="jd-wcta-row-t">${esc(t.text || t.label)}</span>
        <span class="jd-wcta-row-n">${len ? len.toLocaleString() + '자' : '0자'}</span>
      </div>`;
    }).join('');
    return `<div class="jd-draft-pane jd-wcta">
      <div class="jd-wcta-in">
        <span class="wf-eyebrow">다음 단계</span>
        <h3>이제 자소서를 씁니다</h3>
        <p>요구 역량·공고 근거를 옆에 두고 문항마다 초안을 쓰는 <b>전용 작성 화면</b>으로 넘어갑니다.
          AI 초안·정성스펙·맞춤법 검사도 그 화면에 있어요.</p>
        ${rows ? `<div class="jd-wcta-list">${rows}</div>` : ''}
        <button type="button" class="wf-btn wf-btn--primary wf-btn--block" data-go-write>
          <i class="ti ti-pencil"></i> 자소서 작성하기</button>
        <button type="button" class="wf-btn wf-btn--sm wf-btn--block" data-open-lib>
          <i class="ti ti-folder"></i> 저장된 자소서 불러오기</button>
      </div>
    </div>`;
  }

  /* 탭 전환·정성스펙 토글 뒤 다시 그리기 — 지금 보이는 화면 쪽만 다시 그린다.
     bind() 은 분석·작성 두 화면이 공유하므로, 여기서 화면을 갈라 준다(안 그러면
     작성 화면에서 탭을 눌러도 숨은 #jd-result 만 다시 그려진다). */
  function rerender(r) {
    if (_wsHost && _wsHost.id === 'write-root') renderWrite();
    else render(r);
  }

  /* 역량 → 그 역량이 배정된 문항 번호. 분석 화면(render)·작성 화면(renderWrite)이 같이 쓴다. */
  function qMapOf(r, tabs) {
    const qMap = {};
    (tabs || []).forEach((t, ti) => {
      if (t.kind !== 'question') return;
      t.comps.forEach(c => {
        const i = r.items.indexOf(c);
        if (i < 0) return;
        (qMap[i] = qMap[i] || []).push(ti + 1);
      });
    });
    return qMap;
  }

  /* ══ 작성 화면(#write) — 역량 분석 뒤 전용 작성 페이지 (2026-09-01) ═══════════
     왼쪽=자소서 관리·불러오기, 가운데=문항 탭+에디터(draftHtml 그대로 재사용),
     오른쪽=요구 역량 참고(reqListHtml). 에디터·AI 초안·정성스펙·자동저장은 분석 화면과
     **같은 함수·같은 bind** 를 쓴다 — 두 곳에서 다른 코드로 그리면 한쪽만 고쳐진다. */
  function onEnterWrite() {
    /* 보관함 '이어쓰기'로 넘어왔으면 그 회사로 화면을 세운다 — 코치(onEnter)와 같은 키. */
    const picked = localStorage.getItem('careerly_selected_company');
    if (picked && $('#jd-company')) {
      $('#jd-company').value = picked;
      localStorage.removeItem('careerly_selected_company');
      /* ── 문항 1 부터 보여준다 (사용자 지시 2026-09-04) ──────────────────
         `_tab` 은 모듈 변수라 **다른 자소서에서 보던 탭 번호가 그대로 남는다.**
         renderWrite 는 탭 수에 맞게 자르기만 할 뿐(Math.min) 0 으로 되돌리지 않아서,
         문항 3 을 쓰다 보관함으로 나갔다가 다른 회사로 이어쓰기하면 그 회사의
         문항 3 이 열렸다 — 방금 고른 자소서를 처음부터 볼 것이라는 기대와 어긋난다.
         이어쓰기는 '이 자소서를 새로 편다' 는 뜻이므로 맨 앞으로 돌린다. */
      _tab = 0;
    }
    renderWrite();
  }

  function renderWrite() {
    const host = $('#write-root');
    if (!host) return;
    const company = valueOf('#jd-company');
    /* ── 보관함 '이어쓰기'·새로고침으로 들어오면 _last 가 비어 있다 (사용자 지시 2026-09-01) ──
       메모리에 없으면 이 회사로 저장해 둔 분석을 되살린다. 이게 없으면 역량이 0개라
       AI 초안 넣기가 동작하지 않는다. 문항 문구도 같이 되살려야 탭(=저장 키)이
       그대로여서 이어쓰기로 들어온 사람이 자기 글을 찾는다. */
    if (company && !(_last?.items?.length && _lastCompany === company)) {
      const saved = analysisOf(company);
      if (saved) {
        _last = saved.r;
        _lastCompany = company;
        const qEl = $('#jd-questions');
        if (qEl && !qEl.value.trim() && saved.questions) qEl.value = saved.questions;
      }
    }
    /* 오른쪽 역량 참고는 **지금 회사로 분석한 결과**가 있을 때만 보인다. 회사가 다르면
       남의 회사 역량을 보여주게 되므로 끈다(에디터는 회사별 저장이라 그대로 쓴다). */
    const hasAnalysis = !!(_last && _last.items && _last.items.length && _lastCompany === company);
    const r = hasAnalysis ? _last : { items: [] };
    let tabs = tabsOf(r);
    /* 문항도 분석도 없는데 이 회사로 저장해 둔 초안이 있으면(다른 날 쓰다 온 경우),
       그 저장 키를 탭으로 되살린다 — 안 그러면 이어쓰기로 들어와도 빈 화면만 보인다. */
    if (!tabs.length) {
      const saved = draftStore()?.all()[company] || {};
      const labels = Object.keys(saved);
      if (labels.length) tabs = labels.map(label => ({
        kind: 'question', text: label, type: null, label, key: label, comps: [],
      }));
    }
    _lastTabs = tabs;
    _focused = Math.max(0, Math.min(_focused, r.items.length - 1));
    _tab = Math.min(_tab, Math.max(0, tabs.length - 1));
    const qMap = qMapOf(r, tabs);

    host.innerHTML = `
      <div class="write-shell">
        <aside class="write-side" aria-label="자소서 관리">
          <button type="button" class="write-back" data-write-back>
            <i class="ti ti-arrow-left"></i> 역량 분석으로
          </button>
          <div class="write-side-doc">
            <span class="wf-eyebrow">작성 중</span>
            <b>${company ? esc(company) : '새 자소서'}</b>
          </div>
          <div class="write-side-acts">
            <button type="button" class="write-side-b" data-write-lib><i class="ti ti-folder"></i> 자소서 불러오기</button>
            <button type="button" class="write-side-b" data-write-new><i class="ti ti-plus"></i> 새 자소서 작성</button>
            <button type="button" class="write-side-b" data-write-export><i class="ti ti-download"></i> 내보내기</button>
          </div>
          <p class="write-side-note">이 브라우저에만 저장돼요. 기기를 옮기면 따라오지 않습니다.</p>

          <!-- 내 AI 프롬프트 (사용자 지시 2026-09-05) — 기본 규칙 대신 쓸 규칙을
               직접 만들어 두고 하나만 켠다. 켠 것이 모든 문항의 AI 초안에 적용된다. -->
          <div class="write-side-prompts" id="write-prompts"></div>
        </aside>

        <div class="write-main">${draftHtml(r, tabs)}</div>

        <aside class="write-ref" aria-label="요구 역량 참고">
          ${hasAnalysis
            ? reqListHtml(r, qMap)
            : `<div class="write-ref-empty">
                 <i class="ti ti-list-search"></i>
                 <b>요구 역량 참고</b>
                 <p>${company ? `<b>${esc(company)}</b> 공고로 ` : ''}역량 분석을 하면 이 자리에
                   요구 역량·공고 근거가 나와 옆에 두고 쓸 수 있어요.</p>
                 <button type="button" class="wf-btn wf-btn--sm wf-btn--primary" data-write-back>역량 분석하러 가기</button>
               </div>`}
        </aside>
      </div>`;

    _wsHost = host;                      // 지금 작업 화면은 작성(#write-root)
    bind(host, r, tabs);                 // 탭·AI 초안·정성스펙·역량 클릭·자동저장 — 분석 화면과 공유
    bindWriteSide(host);
  }

  function bindWriteSide(host) {
    host.querySelectorAll('[data-write-back]').forEach(el => el.addEventListener('click', () => navigate('jd')));
    host.querySelectorAll('[data-write-lib]').forEach(el => el.addEventListener('click', () => { if (window.Drafts) Drafts.open(); }));
    host.querySelectorAll('[data-write-new]').forEach(el => el.addEventListener('click', () => navigate('jd')));
    host.querySelectorAll('[data-write-export]').forEach(el => el.addEventListener('click', exportDrafts));

    /* ── 내 AI 프롬프트 (사용자 지시 2026-09-05) ────────────────────────────
       칸을 다시 그릴 때마다 버튼이 새로 생기므로 **바깥 상자에 한 번만** 위임한다. */
    paintPrompts();
    const box = host.querySelector('#write-prompts');
    box?.addEventListener('click', e => {
      if (e.target.closest('[data-prompt-new]')) { openPromptModal(null); return; }

      const edit = e.target.closest('[data-prompt-edit]');
      if (edit) { openPromptModal(edit.dataset.promptEdit); return; }

      const del = e.target.closest('[data-prompt-del]');
      if (del) {
        const state = loadPrompts();
        const p = state.items.find(x => x.id === del.dataset.promptDel);
        if (p && !confirm(`'${p.name}' 을 지울까요?`)) return;
        state.items = state.items.filter(x => x.id !== del.dataset.promptDel);
        /* 켜 둔 것을 지웠으면 기본 규칙으로 돌아간다 — 없는 것을 가리킨 채 두면
           화면은 '켜짐' 인데 초안은 기본으로 나가 서로 어긋난다. */
        if (state.activeId === del.dataset.promptDel) state.activeId = null;
        savePrompts(state);
        paintPrompts();
        return;
      }

      const pick = e.target.closest('[data-prompt-pick]');
      if (pick) {
        const state = loadPrompts();
        const id = pick.dataset.promptPick;
        /* 라디오처럼 하나만 켠다. '기본 프롬프트' 줄이 목록에 있으므로 **다시 눌러
           끄는 동작은 없앴다** — 되돌아갈 길이 화면에 보이는데 숨은 토글까지 두면,
           고른 것을 다시 눌렀을 때 꺼지는 것이 실수로 읽힌다. */
        state.activeId = id === DEFAULT_PROMPT_ID ? null : id;
        savePrompts(state);
        paintPrompts();
      }
    });
  }

  /* '내보내기' — 이 회사의 모든 문항 초안을 하나로 이어 클립보드에 복사한다.
     파일 저장 대신 복사로 둔다(브라우저 저장 대화상자를 띄우지 않아도 되고, 어디에든
     붙여넣을 수 있다). 비어 있으면 아무 일도 하지 않고 알린다. */
  function exportDrafts() {
    const company = valueOf('#jd-company');
    const parts = (_lastTabs || []).map(t => {
      const d = getDraft(t.key);
      return d.trim() ? `[${t.label}] ${t.text || ''}\n${d}` : '';
    }).filter(Boolean);
    if (!parts.length) {
      if (typeof toast === 'function') toast('내보낼 초안이 없어요', { icon: false });
      return;
    }
    const text = `${company || '자소서'}\n\n` + parts.join('\n\n──────────\n\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { if (typeof toast === 'function') toast('전체 초안을 클립보드에 복사했어요', { icon: false }); },
        () => { if (typeof toast === 'function') toast('복사에 실패했어요', { icon: false }); });
    }
  }

  function bind(box, r, tabs) {
    /* 역량 키워드 칩 · 역량 머리줄 — 둘 다 같은 역량을 연다.
       문항 화면의 요구 역량 줄(.jd-req)은 여기에 더해 **이 문항에 쓸지**도 같이
       정한다 — 예전엔 오른쪽 +/✓ 버튼이 따로 있었는데, 상세를 열 때 이미 줄
       색이 바뀌니 그 색 변화를 선택 표시로 그대로 쓴다(사용자 지시 2026-09-04).
       상한에 걸리면 알리고 화면을 다시 그린다 — comps 가 바뀌면 초안 머리의
       기준 역량 줄과 문항 배지가 같이 바뀌어야 한다. 에디터 내용은 회사별
       저장이라 다시 그려도 안 잃는다. */
    box.querySelectorAll('[data-key]').forEach(el => el.addEventListener('click', () => {
      const idx = Number(el.dataset.key);
      const tab = (_lastTabs || [])[_tab];
      if (tab?.kind === 'question' && el.classList.contains('jd-req')) {
        const it = r.items[idx];
        if (!it) return;
        const shown = (el.dataset.cshown || '').split('|').filter(Boolean);
        if (!toggleCPick(tab.key, it.label, shown)) {
          const s = document.getElementById('jd-draft-state');
          if (s) s.innerHTML = `한 문항에 역량은 <b>${C_PICK_MAX}개</b>까지예요 — 하나를 빼고 고르세요`;
          return;
        }
        _focused = idx;
        if (_wsHost) renderWrite(); else render(_last);
        return;
      }
      focusItem(idx);
    }));
    box.querySelectorAll('[data-comp]').forEach(el =>
      el.addEventListener('click', () => focusItem(Number(el.dataset.comp))));

    // 초안 탭 — 지금 화면(분석/작성)에 맞게 다시 그린다
    box.querySelectorAll('[data-tab]').forEach(el =>
      el.addEventListener('click', () => { _tab = Number(el.dataset.tab); rerender(r); }));

    // 'AI 초안 넣기' — 초안 머리의 버튼. 지원동기는 담은 회사 근거로, 그 밖은 고른(_focused)
    // 역량으로 문단을 만든다. 한 버튼에서 문항 종류를 보고 갈라 준다.
    const aiBtn = box.querySelector('[data-ai-draft]');
    if (aiBtn) aiBtn.addEventListener('click', () => {
      const tab = tabs[_tab];
      const isMotive = tab?.type?.pick === 'news';
      const ev = isMotive && tab?.type ? Roadmap.evidenceFor(valueOf('#jd-company'), tab.type.label) : [];
      if (isMotive && ev.length) { insertMotiveDraft(r, tabs); return; }
      /* ── 전역 포커스가 아니라 **이 문항에 고른 역량**을 쓴다 (심사 지적 2026-09-01) ──
         예전엔 `r.items[_focused]` 였다. _focused 는 render 마다 유효 범위로 고정돼
         (항상 값이 있고) tab.comps 폴백에는 도달하지 않았다. 그래서 화면은 "문항 1은
         A 로 씁니다" 라고 적어 놓고 초안은 마지막으로 누른 역량으로 썼다.
         이제 탭이 들고 있는 comps 가 곧 초안이 쓰는 역량이다. 0개면 0개로 부른다. */
      const comps = tab?.kind === 'question' ? (tab.comps || []) : (r.items[_focused] ? [r.items[_focused]] : []);
      if (comps.length || tab?.kind === 'question') {
        insertAiDraft(comps, r); return;
      }
      /* 지원동기인데 담은 근거도, 뽑힌 역량도 없다 — 무엇을 하면 되는지 상태줄에 적는다. */
      const s = document.getElementById('jd-draft-state');
      if (s) s.innerHTML = isMotive
        ? '회사 리포트에서 <b>근거를 담으면</b> 지원동기 AI 초안을 쓸 수 있어요'
        : '먼저 <b>역량 분석</b>을 하면 그 역량으로 AI 초안을 써 드려요';
    });

    // 문항 초안 영역의 정성스펙 칩 — 눌러 이 문항에 쓸 경험(0~3)을 바꾼다
    box.querySelectorAll('[data-dqpick]').forEach(el => el.addEventListener('click', () => {
      toggleQPick(el.dataset.dqkey, el.dataset.dqpick);
      rerender(r);
    }));

    // 지원동기 초안 — 담아 온 회사 근거로 문단을 만든다
    const motiveBtn = box.querySelector('[data-motive]');
    if (motiveBtn) motiveBtn.addEventListener('click', () => insertMotiveDraft(r, tabs));

    // '자소서 작성하기' — 전용 작성 화면(#write)으로. 저장·고른 스펙은 회사명 scope 로 이어진다.
    const goWrite = box.querySelector('[data-go-write]');
    if (goWrite) goWrite.addEventListener('click', () => navigate('write'));

    // '저장된 자소서 불러오기' — 보관함 모달을 연다(#drafts-modal)
    const openLib = box.querySelector('[data-open-lib]');
    if (openLib && root.Drafts) openLib.addEventListener('click', () => Drafts.open());

    const reopen = box.querySelector('[data-reopen]');
    if (reopen) reopen.addEventListener('click', () => {
      STEPS.forEach(s => blockOf(s)?.classList.add('is-open'));
      STEPS.forEach(paintBlock);
      document.querySelectorAll('#jd-doc [data-grow]').forEach(autoGrow);
      paintProgress();
      $('#jd-doc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    bindDraft(box);
  }

  /* 역량 바꿔 보기 — 다시 그리지 않고 클래스만 토글한다.
     innerHTML 로 새로 그리면 작성 중이던 초안이 날아간다(자동저장은 600ms 디바운스라
     방금 친 글자는 아직 저장 전이다). */
  /* 역량을 누르면: 목록 강조 + 아래 상세만 다시 그린다. 통째로 render 하지 않는다 —
     오른쪽 작성칸의 커서·스크롤을 잃지 않으려는 것이다
     (레퍼런스 A: 왼쪽은 목록+상세, 초안은 그대로).
     초안 머리의 'AI 초안 기준 역량' 줄을 같이 고치던 일은 없앴다 — 그 줄 자체를
     지웠고(2026-09-04), 고른 역량은 '이 문항 역량' 칩이 보여 준다. */
  function focusItem(i) {
    if (!Number.isInteger(i) || i < 0 || !_last) return;
    _focused = i;
    /* 분석 화면이면 #jd-result, 작성 화면이면 #write-root. _wsHost 가 지금 보이는 쪽을
       가리킨다(둘 다 DOM 에 살아 있어 id 로 못 가른다). */
    const box = _wsHost || document.getElementById('jd-result');
    if (!box) return;

    box.querySelectorAll('.jd-req').forEach(el =>
      el.classList.toggle('is-on', Number(el.dataset.key) === i));

    const item = _last.items[i];
    const detail = box.querySelector('.jd-req-detail');
    if (item && detail) {
      detail.replaceWith(document.createRange().createContextualFragment(reqDetailHtml(item)));
    }

    /* 예전에는 여기서 초안 머리의 '기준 역량' 문장 줄을 같이 고쳤다. 그 줄은 없앴고
       (사용자 지시 2026-09-04), 고른 역량은 '이 문항 역량' 칩이 보여 준다. 그 칩은
       고를 때마다 화면을 다시 그리므로(bind 의 data-key 핸들러) 여기서 손댈 것이 없다. */
  }

  /* ── AI 초안 진행률 (사용자 지시 2026-09-04) ──────────────────────────────
     처음 판은 시간만 보고 늘 같은 곡선으로 0→90% 를 기어갔다. 그래서 "고정값 같다"
     는 말이 나왔다 — 실제로 서버가 어디까지 했는지와 아무 관계가 없었으니 맞는 지적이다.

     ── 진짜 진행률(토큰 스트리밍)은 지금 모델로는 못 쓴다 (실측 2026-09-04) ──
     서버가 글자를 쓰는 대로 흘려보내게 만들어 봤는데, 두 프로바이더 다 막혔다:
       · Groq `openai/gpt-oss-120b` — `response_format: json_object` + `stream:true`
         조합에서 호출 자체가 깨진다(`Failed to generate JSON`). 같은 프롬프트로
         stream=false 는 2,190ms 성공, stream=true 는 502.
       · Gemini `:streamGenerateContent?alt=sse` — JSON 모드에서 **본문 없이** 스트림이
         닫힌다(조각 0개 → 25초 뒤 타임아웃).
     JSON 모드를 버리면 스트리밍은 되지만 초안 파이프라인 전체(parseDraft·빈칸 세기·
     coach 필드)가 그 계약 위에 서 있다. 막대 하나 때문에 버릴 것이 아니다.

     ── 그래서 '시간' 을 쓰되, **재서** 쓴다 ──
     고정 곡선 대신 **이 브라우저에서 실제로 걸린 시간**의 중앙값을 분모로 쓴다.
     Groq 로 끝나면 2초대, Gemini 로 가면 20초대라 사람마다·때마다 크게 다른데,
     지난 기록을 보면 그 차이가 막대에 그대로 반영된다. 예상보다 늦어지면 95% 에서
     기다린다 — **100% 는 초안이 실제로 도착했을 때만** 찍는다. */
  const LS_AI_MS = 'careerly_jd_ai_ms_v1';
  const AI_MS_KEEP = 7;                  // 최근 7번만 본다 — 모델을 바꾸면 금방 따라가야 한다
  const AI_MS_SEED = 12000;              // 기록이 없을 때의 첫 추정(Groq 2초 · Gemini 20초의 사이)

  function aiDurations() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_AI_MS));
      return Array.isArray(v) ? v.filter(n => Number.isFinite(n) && n > 0) : [];
    } catch { return []; }
  }
  /* 중앙값을 쓴다 — 한 번 크게 튄 값(재시도가 붙은 호출)이 평균을 끌고 가지 않게. */
  function expectedAiMs() {
    const all = aiDurations();
    if (!all.length) return AI_MS_SEED;
    const s = [...all].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  function noteAiDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    try {
      localStorage.setItem(LS_AI_MS, JSON.stringify([...aiDurations(), ms].slice(-AI_MS_KEEP)));
    } catch { /* 저장 못 해도 막대는 기본 추정으로 돈다 */ }
  }

  function startAiProgress(stateEl, label) {
    if (!stateEl) return () => {};
    const t0 = Date.now();
    const expected = expectedAiMs();
    let pct = 0;

    const paint = () => {
      stateEl.innerHTML = `<span class="jd-ai-prog"><span class="jd-ai-prog-bar" style="width:${pct}%"></span></span>`
        + `${esc(label)} <b class="jd-ai-prog-pct">${pct}%</b>`;
    };
    paint();

    const timer = setInterval(() => {
      /* 예상 시간까지는 그 비율대로, 넘어서면 95% 에 붙어 기다린다. */
      pct = Math.min(95, Math.round(((Date.now() - t0) / expected) * 100));
      paint();
    }, 200);

    /* 끝나면 걸린 시간을 기록해 **다음 번 분모**로 쓴다. 실패한 호출은 넘기지 않는다 —
       중간에 죽은 시간을 '보통 이만큼 걸린다' 로 배우면 막대가 거꾸로 부정확해진다. */
    return ok => {
      clearInterval(timer);
      if (ok) noteAiDuration(Date.now() - t0);
    };
  }

  /* ── AI 초안 ──────────────────────────────────────────────
     서버(draft-coach.js)가 인사담당자·현업 관점의 틀로 문단을 만들어 온다.
     받은 문단은 **덮어쓰지 않고 커서 자리에 끼워 넣는다** — 이미 쓰던 글이 있으면
     그게 사용자의 문장이고, 그걸 AI 문장으로 지우면 되돌릴 방법이 없다. */
  /* comps 는 이 문항에 고른 역량 **0~2개**다(사용자 지시 2026-09-01).
     0개면 역량 축 없이 문항 골격만으로 쓴다 — 지원동기가 그 경우다. */
  async function insertAiDraft(comps, r) {
    const list = Array.isArray(comps) ? comps.filter(Boolean) : (comps ? [comps] : []);
    const i = list.length ? r.items.indexOf(list[0]) : -1;
    const ta = $('#jd-draft');
    /* 버튼·상태 자리는 이제 초안 머리에 있다(레퍼런스 A) — 옛 역량 카드 버튼이 없으면 그리로 폴백. */
    const btn = document.querySelector(`[data-ai="${i}"]`) || document.querySelector('[data-ai-draft]');
    const stateEl = document.querySelector(`[data-ai-state="${i}"]`) || document.getElementById('jd-draft-state');
    if (!ta) return;

    const tabs = _lastTabs || [];
    const tab = tabs[_tab];

    /* 위 STAR 칸에 적은 것이 초안의 **재료**다. 비어 있으면 모델이 아는 것이 활동
       이름·기간·역할뿐이라 문단이 뻔해진다.

       ── 예전에는 여기서 confirm 으로 막았다 (사용자 지시로 걷어냄) ──
       "취소하면 STAR 부터 채웁니다" 라고 물었고 확인을 누르면 그대로 만들어졌으니
       기능상으로는 처음부터 됐다. 그런데 **팝업이 뜨는 것 자체가 막힌 것으로 읽힌다** —
       STAR 를 다 채우기 전에는 초안을 못 본다고 여기게 된다. 순서가 거꾸로다:
       초안을 한 번 보고 나서야 무엇을 적어야 할지 알게 되는 사람이 더 많다.

       그래서 **바로 만들고, 재료가 빠졌다는 말은 결과 옆에 남긴다.** 막지 않되
       모르게 하지도 않는다 — 21-5 에서 '공고 없이도 시작' 을 열어 둔 것과 같은 판단이다. */
    /* 이 문항에 고른 정성스펙(0~3개)의 STAR 가 초안 재료다(사용자 지시 2026-08-31).
       안 골랐으면 빈 배열 → 서버가 STAR 없이 문항 골격으로 쓴다(지원동기 성취담 문제 해결). */
    const picks = tab?.kind === 'question' ? qPickList(tab.key) : [];
    const hasStar = picks.length > 0;

    btn.disabled = true;
    const stopProgress = startAiProgress(stateEl, '초안을 쓰는 중');

    try {
      const out = await DB.draftJd({
        /* 역량 0~2개. 서버는 competencies 배열을 먼저 보고, 없으면 옛 competency 를 쓴다. */
        competencies: list.map(c => c.label),
        company: valueOf('#jd-company'),
        jobTitle: r?.market?.bucket || '',
        question: tab?.kind === 'question' ? tab.text : '',
        /* 공고 문장은 역량과 함께 꺼지면 안 된다 — 역량 0개여도 상위 역량에서 모아 보낸다. */
        quotes: quotesFor(list, r),
        reads: list.map(c => c.reads).filter(Boolean).join(' / '),
        frame: list[0]?.frame || '',
        picks,
        /* 사용자가 정한 분량 상한. byte 면 한글 2byte 기준으로 글자 수로 환산한다. */
        limit: charTarget(limitOf(tab?.key)),
        /* 켜 둔 '내 프롬프트' 가 있으면 그 규칙으로 쓴다. 없으면 빈 값 → 서버가 기본 규칙. */
        customRules: activeRules(),
      });

      const at = ta.selectionStart ?? ta.value.length;
      const pad = ta.value.trim() && at > 0 ? '\n\n' : '';
      const text = pad + out.draft;
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd ?? at);
      ta.focus();
      ta.setSelectionRange(at + text.length, at + text.length);
      ta.dispatchEvent(new Event('input'));

      stopProgress(true);
      if (stateEl) {
        const blanks = out.blankCount
          ? `<b>빈칸 ${out.blankCount}개</b>를 본인 사실로 채우세요`
          : '넣었어요';
        /* STAR 없이 만든 문단이 뻔하다는 것을 **결과를 보여준 뒤에** 말한다.
           만들기 전에 말하면 경고이고, 만든 뒤에 말하면 다음에 할 일이 된다. */
        const doneHtml = `<i class="ti ti-circle-check-filled jd-ai-done"></i> ` + (hasStar ? blanks
          : `${blanks} · 위 <b>자소서 문항</b> 칸에서 이 문항에 <b>정성스펙</b>을 고르면 내 경험(STAR)으로 더 구체적으로 나와요 `
            + '<button type="button" class="jd-inline-link" data-open-star>고르러 가기</button>');
        /* 위 dispatchEvent('input') 이 작성칸의 자동저장 표시줄(같은 stateEl)을 같이 켜서,
           600ms 뒤 '저장됨' 으로 이 완료 표시를 덮어쓴다. 그 시점이 지난 뒤 한 번 더
           그려서 완료 표시가 이기게 한다. */
        const paintDone = () => {
          stateEl.innerHTML = doneHtml;
          const goStar = stateEl.querySelector('[data-open-star]');
          if (goStar) goStar.addEventListener('click', () => {
            openStep(3, true);   // 자소서 문항 칸을 열고 그리로 스크롤한다
          });
        };
        paintDone();
        setTimeout(paintDone, 700);
      }
      paintAiNotes(i, out);
    } catch (e) {
      stopProgress();
      if (stateEl) stateEl.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ── 지원동기 초안 ────────────────────────────────────────────
     insertAiDraft 와 하는 일은 같지만(문단을 만들어 커서 자리에 끼운다) 재료가
     다르다 — 저기는 내 STAR, 여기는 담아 온 회사 근거다. 그래서 STAR 가 비었는지
     묻지 않는다. 지원동기는 STAR 없이도 쓰는 문항이다.

     덮어쓰지 않고 **커서 자리에 끼워 넣는 것**은 같다. 이미 쓰던 글이 있으면
     그게 사용자의 문장이고, AI 문장으로 지우면 되돌릴 방법이 없다. */
  async function insertMotiveDraft(r, tabs) {
    const ta = $('#jd-draft');
    /* 지원동기 초안도 이제 초안 머리의 'AI 초안 넣기' 버튼에서 부른다(전용 버튼을 없앴다).
       버튼·상태 자리는 그리로 폴백한다. */
    const btn = document.querySelector('[data-motive]') || document.querySelector('[data-ai-draft]');
    const stateEl = document.querySelector('[data-motive-state]') || document.getElementById('jd-draft-state');
    if (!ta || !btn) return;

    const company = valueOf('#jd-company');
    const tab = (tabs || _lastTabs || [])[_tab];
    const ev = tab?.type ? Roadmap.evidenceFor(company, tab.type.label) : [];
    if (!ev.length) {
      if (stateEl) stateEl.textContent = '담아 온 근거가 없어요.';
      return;
    }
    /* 이 문항에 고른 정성스펙(0~3개)의 STAR — 지원동기의 '내 경험' 재료다(사용자 지적 2026-09-01).
       안 골랐으면 빈 배열 → 서버가 회사 근거만으로 쓰고 안 고른 활동을 끌어들이지 않는다. */
    const picks = tab?.kind === 'question' ? qPickList(tab.key) : [];

    btn.disabled = true;
    const stopProgress = startAiProgress(stateEl, '담은 근거를 읽고 쓰는 중');

    try {
      const out = await DB.motiveJd({
        company,
        jobTitle: r?.market?.bucket || Roadmap.get()?.jobName || '',
        question: tab?.kind === 'question' ? tab.text : '',
        /* 서버가 필요한 것만 보낸다 — id·url 은 프롬프트에 쓸모가 없고,
           보내 봤자 프롬프트만 길어져 뒤쪽 규칙이 밀린다. */
        evidence: ev.map(e => ({ kind: e.kind, text: e.text, source: e.source || '' })),
        picks,
        /* 사용자가 정한 분량 상한. byte 면 한글 2byte 기준으로 글자 수로 환산한다. */
        limit: charTarget(limitOf(tab?.key)),
      });

      const at = ta.selectionStart ?? ta.value.length;
      const pad = ta.value.trim() && at > 0 ? '\n\n' : '';
      const text = pad + out.draft;
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd ?? at);
      ta.focus();
      ta.setSelectionRange(at + text.length, at + text.length);
      ta.dispatchEvent(new Event('input'));

      /* 빈칸 0개는 '완성됐다' 가 아니라 **그대로 내면 안 되는 상태**다.
         대괄호가 대필 방지 장치라, 없으면 그 장치가 안 걸린 문단이다(16-2).
         '넣었어요' 로 끝내면 학생은 다 됐다고 읽는다. */
      stopProgress(true);
      if (stateEl) {
        const doneHtml = `<i class="ti ti-circle-check-filled jd-ai-done"></i> ` + (out.blankCount
          ? `<b>빈칸 ${out.blankCount}개</b>를 본인 사실로 채우세요`
          : '<b>빈칸 없이 나왔어요</b> — 수치·상황을 본인 사실로 바꿔 쓰세요');
        /* insertAiDraft 와 같은 이유로 한 번 더 그린다 — 자동저장 '저장됨' 이 이 완료
           표시를 덮어쓰는 것을 이긴다. */
        stateEl.innerHTML = doneHtml;
        setTimeout(() => { stateEl.innerHTML = doneHtml; }, 700);
      }
      paintMotiveNotes(out);
    } catch (e) {
      stopProgress();
      if (stateEl) stateEl.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* 초안 옆에 '무엇을 채워야 하는지'·'약한 지점'과 **어느 근거로 썼는지**를 적는다.
     출처를 안 적으면 학생은 이 문단의 회사 이야기가 어디서 온 것인지 알 수 없고,
     그러면 면접에서 되물었을 때 답할 수 없다(3단계가 출처를 같이 담는 이유와 같다). */
  function paintMotiveNotes(out) {
    const host = document.querySelector('[data-motive-notes]');
    if (!host) return;
    const list = (arr, title) => arr?.length
      ? `<div class="jd-comp-sec"><span class="wf-eyebrow">${title}</span>
           <ul class="jd-list">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
      : '';
    const used = (out.usedEvidence || []).length
      ? `<div class="jd-comp-sec"><span class="wf-eyebrow">이 초안이 쓴 사실</span>
           <ul class="jd-list">${out.usedEvidence.map(e =>
             `<li>${esc(e.text.slice(0, 90))}${e.text.length > 90 ? '…' : ''}
              ${e.source ? `<span style="color:var(--wf-mute)"> — ${esc(e.source)}</span>` : ''}</li>`).join('')}</ul>
         </div>`
      : '';
    host.innerHTML = used + list(out.blanks, '채워야 할 빈칸') + list(out.review, '채용담당자가 볼 약한 지점');
  }

  /* 모델이 같이 준 '무엇을 채워야 하는지'와 '채용담당자가 볼 약한 지점'.
     초안만 주고 끝내면 학생은 그대로 낸다 — 고칠 지점을 같이 붙인다. */
  function paintAiNotes(i, out) {
    const host = document.querySelector(`[data-ai-notes="${i}"]`);
    if (!host) return;
    const list = (arr, title) => arr?.length
      ? `<div class="jd-comp-sec"><span class="wf-eyebrow">${title}</span>
           <ul class="jd-list">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
      : '';

    /* 칸별 되짚기는 목록이 아니라 **STAR 칸으로 돌려보내는 안내**다. 그래서 그냥
       나열하지 않고 해당 칸을 여는 버튼으로 만든다 — 읽고 나서 어디를 고쳐야 하는지
       다시 찾게 하면 대부분 안 고친다. */
    const coach = out.coach?.length
      ? `<div class="jd-comp-sec"><span class="wf-eyebrow">STAR 에서 더 적어야 할 것</span>
           <div class="jd-coach">${out.coach.map(c => `
             <button type="button" class="jd-coach-row" data-coach="${esc(c.key)}">
               <span class="jd-coach-key">${esc(c.key)}</span>
               <span class="jd-coach-t">
                 <b>${esc(c.missing || '더 적을 것이 있어요')}</b>
                 ${c.ask ? `<span>${esc(c.ask)}</span>` : ''}
               </span>
               <i class="ti ti-arrow-up-right"></i>
             </button>`).join('')}</div>
           <p class="jd-hint">누르면 <b>정성스펙 카드</b>로 이동합니다. 채운 뒤 <b>AI 초안 넣기</b>를 다시 누르면
             그 내용으로 다시 씁니다.</p>
         </div>`
      : '';

    host.innerHTML = coach + list(out.blanks, '채워야 할 빈칸') + list(out.review, '채용담당자가 볼 약한 지점');

    /* 되짚기 행을 누르면 STAR 를 고치는 자리(입력부 정성스펙 카드)로 데려간다.
       결과 화면 STAR 를 없앴으므로(사용자 지시 2026-08-28) 여기서 칸을 여는 대신 그리 보낸다. */
    host.querySelectorAll('[data-coach]').forEach(el => el.addEventListener('click', () => goSpecStar()));
  }


  /* 작성칸 자동 저장. 글자마다 localStorage 를 때리지 않도록 600ms 묶어서 쓴다.
     저장은 조용히 되면 사용자가 저장됐는지 모른다 — 상태 문구를 같이 갱신한다. */
  function bindDraft(box) {
    const ta = box.querySelector('#jd-draft');
    if (!ta) return;
    const stateEl = box.querySelector('#jd-draft-state');
    const countEl = box.querySelector('#jd-draft-count');
    const chkEl = box.querySelector('#jd-chk');
    const key = ta.dataset.key;
    let timer = null;

    /* 카운터는 **상한 대비**로 보여준다 — 자소서는 '몇 자 썼나' 보다 '넘었나' 가 중요하다.
       단위가 byte 면 byte 로 센다(한글 2byte, limitOf 주석 참고). */
    const paint = () => {
      const lim = limitOf(key);
      const u = usageOf(ta.value, lim);
      countEl.textContent = `${u.used.toLocaleString()} / ${lim.n.toLocaleString()}${u.unitLabel}`;
      countEl.classList.toggle('is-over', u.over);
      paintCheck(chkEl, ta.value);
    };
    paint();
    if (ta.value.trim()) stateEl.textContent = '저장된 초안을 불러왔어요';

    ta.addEventListener('input', () => {
      paint();
      stateEl.textContent = '작성 중…';
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveDraft(key, ta.value);
        stateEl.textContent = '저장됨';
      }, 600);
    });
    // 탭을 옮기거나 페이지를 뜨면 대기 중인 저장을 흘려보내지 않는다
    ta.addEventListener('blur', () => {
      clearTimeout(timer);
      saveDraft(key, ta.value);
      if (ta.value.trim()) stateEl.textContent = '저장됨';
    });

    /* '저장하기' — 자동저장(입력 600ms·blur)과 별개로 **지금 바로** 저장하는 버튼
       (사용자 지시 2026-09-01). 자동저장을 못 믿는 사람이 눌러 확인하는 자리라, 눌렀을 때
       분명히 '저장됨'을 보여준다. 탭 글자수도 같이 갱신한다. */
    /* ── 분량 상한 입력 (사용자 지시 2026-09-03) ────────────────────────────
       바꾸면 곧바로 저장하고 카운터를 다시 그린다. 화면을 통째로 다시 그리지 않는다 —
       입력 중인 초안의 커서·스크롤을 잃지 않으려는 것이다(focusItem 과 같은 판단). */
    const limN = box.querySelector('#jd-limit-n');
    const limU = box.querySelector('#jd-limit-u');
    const applyLimit = () => {
      const saved = setLimit(key, limN?.value, limU?.value);
      if (limN) {
        /* 상한을 지우면 기본값으로 돌아간다 — placeholder 가 그 값을 보여주므로 칸은 비운다. */
        if (!saved.custom) limN.value = '';
        /* 범위를 벗어난 값은 잘린다(200 미만·3,000자 초과). **잘린 값을 칸에 되돌려
           적는다** — 안 그러면 칸에는 100 이 보이는데 실제로는 200 으로 도는, 화면이
           거짓말하는 상태가 된다. */
        else if (String(saved.n) !== String(limN.value)) limN.value = saved.n;
      }
      if (limU) limU.value = saved.unit;
      paint();
    };
    limN?.addEventListener('change', applyLimit);
    limN?.addEventListener('blur', applyLimit);
    limU?.addEventListener('change', applyLimit);

    const saveBtn = box.querySelector('[data-save-draft]');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      clearTimeout(timer);
      saveDraft(key, ta.value);
      stateEl.textContent = '저장됨';
      if (typeof toast === 'function') toast('저장했어요', { icon: false });
    });
  }

  /* ── 초안 검사 (브라우저에서만 돈다) ──────────────────────────
     상투 표현·AI 흔적 검사는 서버로 보내지 않는다. 자소서 초안은 남의 서버에
     올릴 이유가 없는 글이고, 검사 자체가 단순 문자열 대조라 여기서 끝난다.
     서버는 '무엇을 찾을지'(사전)만 내려보낸다. */
  function checkDraft(text) {
    const body = String(text || '');
    const out = { cliches: [], aiTells: [], blanks: 0 };
    if (!body.trim() || !_last) return out;

    for (const c of _last.cliches || []) {
      if (body.includes(c.term)) out.cliches.push(c);
    }
    for (const t of _last.aiTells || []) {
      const parts = t.term.split('~').map(s => s.trim()).filter(Boolean);
      const counts = parts.map(p => body.split(p).length - 1);
      const n = parts.length > 1 ? Math.min(...counts) : counts[0];
      if (n > t.repeat) out.aiTells.push({ ...t, count: n });
    }
    out.blanks = (body.match(/\[[^\]]+\]/g) || []).length;
    return out;
  }

  function paintCheck(el, text) {
    if (!el) return;
    const r = checkDraft(text);
    const bits = [];
    if (r.blanks) bits.push(`<span class="jd-chk jd-chk--warn">빈칸 ${r.blanks}개</span>`);
    for (const c of r.cliches) bits.push(`<span class="jd-chk jd-chk--bad" title="${esc(c.why)}">${esc(c.term)}</span>`);
    for (const t of r.aiTells) bits.push(`<span class="jd-chk jd-chk--ai" title="${esc(t.why)}">${esc(t.term)} ×${t.count}</span>`);
    el.innerHTML = bits.length
      ? `<span class="jd-chk-h">고칠 것</span>${bits.join('')}`
      : (text.trim() ? '<span class="jd-chk jd-chk--ok">걸리는 표현 없음</span>' : '');
  }

  const api = {
    init, onEnter, onEnterWrite, focusItem,
    // 화면 없이 검증하는 규칙들 (test/jd-questions.test.js)
    classifyQuestion, competenciesFor, parseQuestions, questionDraftKey, QUESTION_TYPES,
    starGate, actKeyOf,
    checkDraft,
    /* 문항별 분량 상한 (test/draft-limit.test.js) */
    limitOf, setLimit, usageOf, byteLen, charTarget, LIMIT_DEFAULT,
    /* 문항별 역량 고르기 (test/comp-pick.test.js) */
    cPicks, toggleCPick, resolveComps, quotesFor, C_PICK_MAX,
    /* 회사별 분석 보관 (test/jd-analysis.test.js) */
    saveAnalysis, analysisOf, forgetAnalysis, ANALYSIS_MAX,
    /* 프롬프트 공유 게시판(insight.js)이 쓰는 두 개 — 저장 형식을 아는 곳은 여기뿐이다 */
    addPrompt, myPrompts, PROMPT_LEN_MAX,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // node 테스트용
  root.JdCoach = api;

})(typeof window !== 'undefined' ? window : globalThis);
