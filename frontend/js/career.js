// ════════════════════════════════════════════════════════════
//  CAREERLY — Career Roadmap (임금직업정보 · 한국고용직업분류 KECO 2018 기반)
//   • 사이드바      : 1차 분류 10개 (js/keco.js · 임금직업정보시스템)
//   • STEP 01       : 2차 분류 선택    (미용·여행…경비·청소직 → 경호·경비직)
//   • STEP 02       : 직업 선택        — 비슷한 직업끼리 묶어서 보여준다(js/job-groups.js)
//   • STEP 03       : 커리어 로드맵    — **별도 화면**. 기업 유형 → 선배 평균 vs 내 스펙
//   • 데이터가 없으면 "데이터 없음" 빈 상태 표시
//
//   ── 정량/정성 스펙 탭을 뺀 이유 ──
//   '합격자 평균 학점 4.02'·'TOEIC 평균 901' 을 카드로 보여주던 탭이 있었는데,
//   바로 위 비교 카드(compareCard)가 같은 값을 막대로 이미 보여준다. 같은 숫자를
//   두 번 읽게 하는 자리라 걷어냈다.
//   **같이 사라진 것**: 자격증 종류별 보유율(정보처리기사 38% …)과 활동 유형별
//   보유율. 이건 겹치는 정보가 아니었으므로, 다시 살릴 거면 비교 카드 아래에
//   따로 붙이는 편이 맞다(옛 코드는 git 이력에 있다).
//
//   ── NCS 에서 갈아탄 이유 ──
//   NCS 는 '직무능력 표준' 이라 훈련 과정 단위로 쪼개져 있어서 학생이 아는 직업 이름
//   ('경호원')이 나오지 않는다. KECO 는 통계·고용 행정의 직업 분류라 실제 직업명으로
//   끝나고, 무엇보다 **직업마다 평균임금이 붙어 있다**.
//
//   ── 분류 트리는 비동기로 받는다 ──
//   200KB 라서 모든 페이지에 얹지 않는다(keco.js 머리주석). 로드맵을 처음 열 때
//   받아오므로 render() 가 '아직 안 왔음' 상태를 다룰 수 있어야 한다.
// ════════════════════════════════════════════════════════════
window.CareerPage = (() => {
  let currentMajor = null; // 1차 분류 **공식 코드** ('0'~'9'). 화면 번호(1~10)는 m.no 로 따로 있다
  let currentMiddle = null; // 2차 분류 코드 ('54' 등)
  let currentJob = null; // 직업 코드 ('K000007549' 등)
  let currentCorp = 'all'; // 기업 유형 ('all' | Aggregator.CORP_TYPES 의 id)
  let loadError = null;
  let jobPage = 1; // 직업 목록 페이지 (2차 분류를 바꾸면 1로 되돌린다)
  let currentGroup = null; // 직업 그룹 id ('g1' 등) · null = 전체 (js/job-groups.js)
  /* CAS 순위에서 고른 선배(닉네임)와 신청 입력값. 화면을 다시 그려도 남아야 해서
     모듈 상태로 둔다 — render() 가 innerHTML 을 통째로 갈아치운다. */
  let pickedMentor = null;
  let pickedFormat = 0;
  let pickedDate = '';
  let pickedTime = '';
  /* 사이드바 프로필 카드로 여는 '내 학과 맞춤' 보기. 분류를 고르면 자동으로 빠져나간다. */
  let majorView = false;
  /* 그 화면에서 대표직업을 펼쳐 둔 카드들('<1차>:<2차>'). 여러 갈래를 나란히
     펼쳐 놓고 비교하는 일이 흔해서 하나만 열리게 막지 않는다. */
  const openMajorCards = new Set();
  /* 그 화면 오른쪽 칸에 비교를 그릴 직업 { major, middle, job }. 대표직업을 누르면
     화면을 떠나지 않고 여기만 바뀐다 — 왼쪽 목록과 나란히 두고 갈아 가며 보라는 것.
     mmAuto: 아직 사용자가 고르지도 닫지도 않은 상태. 처음 열었을 때 오른쪽이 비지
     않도록 첫 직업을 자동으로 세우는데, **닫은 뒤에도 자동으로 세우면 닫히지 않는다.** */
  let mmJob = null;
  let mmAuto = true;

  /* 분류를 아직 안 받았으면 받아오고, 받고 나면 사이드바와 본문을 다시 그린다.
     페이지 부팅이 아니라 **로드맵에 처음 들어올 때** 호출된다. */
  function ensureLoaded() {
    if (KECO.ready() || loadError) return;
    KECO.load()
      .then(() => {
        loadError = null;
        paintSidebar();
        render();
      })
      .catch((e) => {
        loadError = e.message || '직업 분류를 불러오지 못했습니다.';
        render();
      });
  }

  function paintSidebar() {
    const list = document.getElementById('job-major-list');
    if (!list) return;
    /* data-id 에는 공식 코드(m.code)를, 눈에 보이는 번호는 m.no 를 쓴다.
       둘을 섞으면 클릭했을 때 조회가 깨진다 — wage-jobs.js 의 no 주석 참고. */
    list.innerHTML = KECO.MAJORS()
      .map(
        (m) => `
      <div class="dept-item job-major-item ${currentMajor === m.code ? 'active' : ''}" data-id="${m.code}">
        <span class="jm-code">${m.no}</span>
        <span class="dept-emoji">${m.emoji}</span>
        <div><div class="dept-label">${esc(m.name)}</div></div>
      </div>`,
      )
      .join('');

    list.querySelectorAll('.job-major-item').forEach((el) => {
      el.addEventListener('click', () => {
        list
          .querySelectorAll('.job-major-item')
          .forEach((d) => d.classList.remove('active'));
        el.classList.add('active');
        majorView = false;     // 분류를 고르면 '내 학과 맞춤' 보기에서 빠져나온다
        currentMajor = el.dataset.id;
        currentMiddle = null;
        currentJob = null;
        currentGroup = null;
        jobPage = 1;
        render({ toTop: true });   // 본문이 통째로 갈리므로 맨 위에서 다시 시작한다
      });
    });
  }

  /* 부팅 시에는 아무것도 받지 않는다 — 로드맵을 안 여는 사용자가 대부분이다. */
  function init() {
    /* 분류 로딩은 render() → ensureLoaded() 로 미룬다 */
  }

  function refreshUser() {
    const user = DB.currentUser();
    const nameEl = document.getElementById('career-username');
    const avatarEl = document.getElementById('career-avatar');
    if (user) {
      const name = user.nickname || user.name || user.username;
      nameEl.innerHTML = `${esc(name)} <span class="up-level">Lv.1</span>`;
      avatarEl.textContent = name.slice(0, 1);
    } else {
      nameEl.innerHTML = `게스트 <span class="up-level">Lv.0</span>`;
      avatarEl.textContent = '👤';
    }
  }

  /* 다시 그리면서 스크롤 자리를 지킨다. 로드맵은 한 화면 안에서 계속 좁혀 가는
     흐름이라, 누를 때마다 맨 위로 튀면 방금 고른 것이 화면 밖으로 나간다. */
  function paint(main, html, opts = {}) {
    const { toTop = false, anchor = null } = opts;
    const keep = toTop ? 0 : main.scrollTop;
    main.innerHTML = html;
    main.scrollTop = keep;

    /* ── 자리를 지키는 것만으로는 모자란 경우 ────────────────────
       '자리 지키기' 는 내용이 그대로거나 길어질 때만 성립한다. 내용이 **짧아지면**
       브라우저가 스크롤을 최대값으로 끌어내리는데, 화면에서는 그게 '페이지가 위로
       튄 것' 으로 보인다(실측: 2차 분류를 바꿀 때 2103 → 809).

       2차 분류를 바꾸면 아래 로드맵 섹션이 통째로 사라져서 항상 이렇게 된다.
       그때 어디에 있어야 하느냐면 **방금 나타난 직업 목록** 앞이다. 그래서 자리를
       지키는 대신 그 자리로 데려간다. */
    if (anchor) {
      const el = main.querySelector(anchor);
      if (el) {
        const delta = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
        main.scrollTop += delta - 8;       // 제목이 상단에 딱 붙지 않게 살짝 띄운다
      }
    }
  }

  function render(opts) {
    const main = document.getElementById('career-main');
    if (!main) return;
    const toTop = Boolean(opts && opts.toTop);
    const anchor = (opts && opts.anchor) || null;

    /* 스텝바는 어느 상태에서든 맨 위에 있어야 한다 — 직무를 고르기 전에도
       "여기가 4단계 중 1단계" 라는 것이 보여야 흐름으로 읽힌다. */
    const shell = inner => `${Roadmap.stepBar('job')}${inner}`;

    // 분류가 아직 없으면 받아오고, 그동안은 상태를 보여준다
    if (!KECO.ready()) {
      ensureLoaded();
      paint(main, shell(loadError ? loadErrorBlock() : loadingBlock()), { toTop: true });
      return;
    }
    /* 지난번에 고른 직무가 있으면 그 자리에서 다시 시작한다. 로드맵은 하루에
       끝나는 일이 아니라, 다시 들어올 때마다 1차 분류부터 고르게 하면 흐름이
       매번 처음으로 되감긴다. */
    restoreFromRoadmap();

    /* 사이드바는 아직 안 그렸거나, 강조된 분야가 지금 분야와 다를 때 다시 그린다.
       복원으로 currentMajor 가 바뀌었는데 안 그리면 **본문은 새 분야인데 왼쪽은
       옛 분야가 강조된** 상태가 된다. */
    const painted = document.querySelector('#job-major-list .job-major-item');
    const activeId = document.querySelector('#job-major-list .job-major-item.active')?.dataset.id ?? null;
    if (!painted || activeId !== (currentMajor ?? null)) paintSidebar();

    /* 내 학과 맞춤 보기는 분류 선택과 별개의 화면이다 — 1차 분류를 안 골랐어도 열린다. */
    if (majorView) {
      paint(main, `
        <div class="topbar">
          <div class="breadcrumb"><span class="active">🎓 내 학과 맞춤</span></div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <span class="topbar-link" onclick="CareerPage.closeMyMajor()">← 분류 둘러보기</span>
            <span class="topbar-link" onclick="navigate('main')">홈으로</span>
          </div>
        </div>
        <div class="content">${Roadmap.stepBar('job')}${myMajorBlock()}</div>`, { toTop, anchor });
      return;
    }

    if (!currentMajor) {
      paint(main, shell(welcomeBlock()), { toTop: true });
      return;
    }

    const major = KECO.byId(currentMajor);
    if (!major) {
      paint(main, placeholderBlock(), { toTop: true });
      return;
    }
    const middle = currentMiddle
      ? KECO.middleById(currentMajor, currentMiddle)
      : null;
    const job =
      middle && currentJob
        ? KECO.jobById(currentMajor, currentMiddle, currentJob)
        : null;

    /* 직업을 고르면 **화면이 바뀐다** — 로드맵이 목록 아래에 붙지 않는다.
       예전에는 한 화면에 STEP 01~03 이 세로로 쌓여서, 로드맵을 보려면 이미 다 고른
       분류 선택 화면을 매번 스크롤해서 지나가야 했다. 고르는 화면과 읽는 화면은
       하는 일이 다르므로 나눈다.
       대신 로드맵 화면 맨 위에 같은 묶음의 직업 목록을 얹어(jobSwitcher) 그 자리에서
       다른 직업으로 갈아탈 수 있게 한다. */
    const isRoadmap = Boolean(job);

    paint(main, `
      <div class="topbar">
        <div class="breadcrumb">
          <span>${major.emoji} ${esc(major.name)}</span>
          ${middle ? `<span class="sep">›</span><span class="${job ? '' : 'active'}">${esc(middle.name)}</span>` : ''}
          ${job ? `<span class="sep">›</span><span class="active">${esc(job.name)}</span>` : ''}
        </div>
        <div style="margin-left:auto;display:flex;gap:8px">
          <span class="topbar-link" onclick="navigate('main')">← 홈으로</span>
        </div>
      </div>
      <div class="content">
        ${Roadmap.stepBar('job')}
        ${
          isRoadmap
            ? `${jobSwitcher(middle, job)}
               ${renderRoadmap(major, middle, job)}`
            : `${phaseBar()}
               ${majorHero(major)}
               ${middleSelect(major)}
               ${middle ? jobSelect(middle) : ''}`
        }
      </div>
    `, { toTop, anchor });
  }

  /* 저장된 로드맵 직무를 화면 상태로 되돌린다.

     ── '한 번만' 이 아니라 '바뀌었을 때만' ──
     처음에는 한 번만 복원하게 뒀는데 그러면 **CAS 에서 비교 직무를 바꾸고 돌아왔을
     때 이 화면만 옛 직무를 계속 보여준다.** 로드맵 직무는 CAS 의 셀렉트에서도
     바뀌므로(Roadmap.switchMiddle), 이 화면이 그 변경을 모르면 같은 흐름 안에서
     두 화면이 다른 직무를 말하게 된다 — 이 작업이 없애려던 바로 그 상태다.

     그렇다고 매번 되돌리면 사용자가 여기서 다른 분류를 눌러 둘러보는 것을 방해한다
     (누르는 족족 저장된 직무로 튕겨 나간다). 그래서 **마지막으로 반영한 로드맵 값과
     달라졌을 때만** 손댄다. 화면 안에서의 둘러보기는 로드맵 값을 바꾸지 않으므로
     (2차 분류 선택·단계 이동) 방해받지 않는다. */
  let appliedRm = null;
  function restoreFromRoadmap() {
    const rm = Roadmap.get();
    const sig = rm ? `${rm.major}/${rm.middle}/${rm.job || ''}` : '';
    if (sig === appliedRm) return;
    appliedRm = sig;
    if (!rm || !KECO.byId(rm.major)) return;
    currentMajor = rm.major;
    currentMiddle = KECO.middleById(rm.major, rm.middle) ? rm.middle : null;
    currentJob = currentMiddle && rm.job && KECO.jobById(rm.major, rm.middle, rm.job) ? rm.job : null;
    /* 고른 직업이 목록 첫 페이지에 없을 수 있지만, 이미 고른 상태라 목록을 다시
       뒤질 일이 없다. 페이지는 1로 둔다. */
    jobPage = 1;
  }

  /* 상단 경로줄(.topbar)을 고정하고 스크롤하면 접던 코드는 없앴다 (사용자 지시).
     그 접기가 **화면이 위로 튀는 원인**이었다 — 직무를 고를 때마다 블록을 다시 그리고
     스크롤 위치를 되돌리는데, 그 직후 접기가 걸리며 높이가 12px 줄어 본문이 그만큼
     딸려 올라갔다(실측 809 → 797). 고정은 로드맵 스텝바로 옮겼다(main.css). */

  function phaseBar() {
    return `
      <div class="phase-bar">
        <div class="phase-tab ${!currentMiddle ? 'active' : ''}" onclick="CareerPage.gotoPhase(1)">
          <div class="pt-num">01</div><div class="pt-label">세부 분야 고르기</div>
        </div>
        <div class="phase-tab ${currentMiddle && !currentJob ? 'active' : ''}" onclick="CareerPage.gotoPhase(2)">
          <div class="pt-num">02</div><div class="pt-label">직무 고르기</div>
        </div>
        <!-- 03 은 이제 별도 화면이라 이 막대에서는 갈 수 없다(직무를 골라야 열린다).
             누르면 아무 일도 안 일어나는 탭을 그대로 두면 고장으로 읽히므로 잠근다. -->
        <div class="phase-tab is-locked" title="직무를 고르면 열립니다">
          <div class="pt-num">03</div><div class="pt-label">필요한 스펙 보기</div>
        </div>
      </div>`;
  }

  function majorHero(major) {
    const jobs = major.middles.reduce((n, m) => n + m.jobs.length, 0);
    return `
      <div class="job-hero">
        <div class="job-hero-icon">${major.emoji}</div>
        <div class="job-hero-body">
          <div class="job-hero-top">
            <h2>${esc(major.name)}</h2>
            <span class="job-hero-badge">직업 ${jobs}개</span>
          </div>
          <p>${esc(major.desc)}</p>
        </div>
      </div>`;
  }

  /* 2차 분류 카드에 임금 범위를 같이 보여준다. 직업을 고르기 전에도 "이 갈래가 대충
     얼마나 버는가"가 보여야 어느 갈래로 들어갈지 정할 수 있다. */
  function middleSelect(major) {
    return `
      <div class="section-title">2차 분류 선택</div>
      <div class="fields-grid">
        ${major.middles
          .map((m) => {
            const w = m.wageRange;
            return `
          <div class="field-card ${currentMiddle === m.code ? 'active' : ''}" onclick="CareerPage.selectMiddle('${m.code}')">
            <div class="fc-name">${esc(m.name)}</div>
            <div class="fc-desc">
              직업 ${m.jobs.length}개
              ${w ? ` · 평균 ${KECO.wageText(w.avg)}` : ''}
            </div>
          </div>`;
          })
          .join('')}
      </div>`;
  }

  /* STEP 02 — 직업 선택. 연봉 높은 순으로 세운다.
     '이 갈래에 어떤 직업이 있나'를 보는 화면이라 이름만 나열하면 고를 근거가 없다.
     하는 일과 평균연봉을 카드에 같이 실어 비교해서 고르게 한다.

     2차 분류 하나에 직업이 50개까지 들어간다(예술·디자인·방송직). 한 화면에 다 깔면
     스크롤만 길어지고 아래쪽 카드는 아무도 안 본다. 멘토 찾기와 같은 카드 격자에
     페이지를 나눠 담는다. */
  const JOBS_PER_PAGE = 9;

  function jobSelect(middle) {
    if (!middle.jobs.length) {
      return `<div class="section-title">직업 선택</div>
        <div class="empty-block"><div class="empty-icon">📭</div>
          <div class="empty-title">등록된 직업이 없습니다</div>
          <div class="empty-desc">이 2차 분류는 임금직업정보에 세부 직업이 올라와 있지 않아요.</div>
        </div>`;
    }

    /* 이 분류에 '비슷한 직업끼리 묶은' 정의가 있으면 그쪽으로 간다.
       정의가 없는 분류는 아래 연봉순 목록 그대로다 — 분류 76개에 전부 묶음을
       만들 수는 없고, 만들지 않은 곳이 고장 나 보이면 안 된다. */
    const groups = typeof JobGroups !== 'undefined'
      ? JobGroups.forMiddle(currentMajor, middle.code)
      : null;
    if (groups) return groupedJobSelect(middle, groups);

    const jobs = [...middle.jobs].sort(
      (a, b) => (b.avgWage ?? 0) - (a.avgWage ?? 0),
    );
    const pages = Math.max(1, Math.ceil(jobs.length / JOBS_PER_PAGE));
    /* 2차 분류를 바꾸면 페이지 수가 줄어 현재 페이지가 범위를 벗어날 수 있다 */
    const page = Math.min(jobPage, pages);
    const slice = jobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE);

    return `
      <div class="section-title">직업 선택
        <span class="scope-tag">연봉 높은 순 · ${jobs.length}개</span>
      </div>
      <div class="job-grid">
        ${slice
          .map(
            (j) => `
          <div class="job-card ${currentJob === j.code ? 'active' : ''}" onclick="CareerPage.selectJob('${j.code}')">
            <div class="jc-name">${esc(j.name)}</div>
            <div class="jc-summary">${esc(j.summary || '')}</div>
            <div class="jc-foot">
              <span class="jc-foot-label">평균연봉</span>
              <span class="jc-wage">${KECO.wageText(j.avgWage)}</span>
            </div>
          </div>`,
          )
          .join('')}
      </div>
      ${pager(page, pages)}`;
  }

  /* ── 그룹으로 묶은 직업 선택 ───────────────────────────────
     2차 분류 하나에 직업이 37개(경영·행정·사무직)까지 들어간다. 연봉순으로 한 줄에
     깔면 회계사 옆에 속기사가 서서, "이 중 내가 갈 만한 갈래"를 고를 수가 없다.
     비슷한 직업끼리 묶고 그룹 안에서 1..n 번호를 붙인다.

     페이지 나누기(pager)는 쓰지 않는다 — 묶음 자체가 이미 목록을 나눈 구조인데
     거기에 페이지까지 걸면 "2페이지에 있는 그룹"이 생겨서 전체가 한눈에 안 들어온다. */
  function groupedJobSelect(middle, groups) {
    /* 그룹 정의에 없는 직업(데이터가 나중에 추가된 경우)은 버리지 않고 따로 모은다.
       조용히 빠뜨리면 목록에서 사라진 것을 아무도 모른다. */
    const ungrouped = middle.jobs.filter(
      (j) => !JobGroups.groupOfJob(currentMajor, middle.code, j.name),
    );
    const shown = currentGroup
      ? groups.filter((g) => g.id === currentGroup)
      : groups;

    const chip = (id, label, on) =>
      `<button class="jg-chip ${on ? 'is-on' : ''}" onclick="CareerPage.selectGroup(${id === null ? 'null' : `'${id}'`})">${esc(label)}</button>`;

    return `
      <div class="section-title">직업 선택
        <span class="scope-tag">비슷한 직업끼리 ${groups.length}개 묶음 · 직업 ${middle.jobs.length}개</span>
      </div>
      <div class="jg-chips">
        ${chip(null, '전체', !currentGroup)}
        ${groups.map((g) => chip(g.id, `${g.no}. ${g.name}`, currentGroup === g.id)).join('')}
      </div>
      ${shown.map((g) => groupBlock(g, middle)).join('')}
      ${
        ungrouped.length && !currentGroup
          ? `<div class="jg-group">
               <div class="jg-group-h">
                 <span class="jg-group-no">–</span>
                 <div class="jg-group-t">
                   <div class="jg-group-name">그 밖의 직업</div>
                   <div class="jg-group-desc">아직 묶음에 넣지 않은 직업이에요. js/job-groups.js 에 추가하면 됩니다.</div>
                 </div>
                 <span class="jg-group-n">${ungrouped.length}개</span>
               </div>
               <div class="jg-jobs">${ungrouped.map((j, i) => jobRow(j, i + 1)).join('')}</div>
             </div>`
          : ''
      }`;
  }

  function groupBlock(g, middle) {
    /* 그룹 정의의 직업 순서를 그대로 쓴다(대체로 연봉·대표성 순). 번호는 그 순서다 —
       화면에서 매번 다시 정렬하면 "3번 직업"이 볼 때마다 달라진다. */
    /* jobs 항목은 이름 문자열이거나 { name, bench } 다(job-groups.js 머리주석).
       jobName() 으로 통일해서 꺼낸다 — .name 으로 바로 읽으면 문자열 쪽이 조용히 빠진다. */
    const rows = g.jobs
      .map((def, i) => {
        const name = JobGroups.jobName(def);
        const job = middle.jobs.find(
          (j) => JobGroups.norm(j.name) === JobGroups.norm(name),
        );
        return job ? jobRow(job, i + 1) : '';
      })
      .join('');

    return `
      <div class="jg-group ${currentGroup === g.id ? 'is-on' : ''}">
        <div class="jg-group-h">
          <span class="jg-group-no">${g.no}</span>
          <div class="jg-group-t">
            <div class="jg-group-name">${esc(g.name)}
              <span class="jg-group-sub">${esc(g.sub)}</span>
            </div>
            <div class="jg-group-desc">${esc(g.desc)}</div>
          </div>
          <span class="jg-group-n">${g.jobs.length}개</span>
        </div>
        <div class="jg-jobs">${rows}</div>
      </div>`;
  }

  /* ── 로드맵 화면의 머리 — 직업 갈아타기 + 돌아가기 ─────────
     화면을 나누면 "다른 직업을 보려면 어디로 가나"가 사라진다. 지금 직업이 속한
     묶음의 목록을 로드맵 위에 얹어 그 자리에서 갈아타게 하고, 묶음 칩 줄 끝의
     남는 자리에 돌아가기를 둔다(칩과 같은 줄이라 새 줄을 만들지 않는다).

     묶음 정의가 없는 2차 분류는 직업이 50개까지라 목록을 얹지 않는다 —
     로드맵을 보러 왔는데 목록이 화면을 다 덮는다. 돌아가기만 둔다. */
  function jobSwitcher(middle, job) {
    const back = `
      <button class="jg-back" onclick="CareerPage.backToJobs()">
        <i class="ti ti-arrow-left"></i> 직업 목록으로
      </button>`;

    const groups = typeof JobGroups !== 'undefined'
      ? JobGroups.forMiddle(currentMajor, middle.code)
      : null;
    if (!groups) return `<div class="jg-chips jg-chips--roadmap">${back}</div>`;

    /* 기본은 **지금 보고 있는 직업의 묶음**이다. 칩으로 다른 묶음을 누르면 그쪽
       목록으로 갈아탄다(로드맵은 직업을 고를 때까지 그대로 남는다). */
    const own = JobGroups.groupOfJob(currentMajor, middle.code, job.name);
    const shown =
      groups.find((g) => g.id === currentGroup) || own || groups[0];

    return `
      <div class="jg-chips jg-chips--roadmap">
        ${groups
          .map(
            (g) => `<button class="jg-chip ${g.id === shown.id ? 'is-on' : ''}"
              onclick="CareerPage.selectGroup('${g.id}')">${g.no}. ${esc(g.name)}</button>`,
          )
          .join('')}
        ${back}
      </div>
      ${groupBlock(shown, middle)}`;
  }

  function jobRow(job, no) {
    return `
      <button class="jg-job ${currentJob === job.code ? 'is-on' : ''}"
              onclick="CareerPage.selectJob('${job.code}')">
        <span class="jg-job-no">${no}.</span>
        <span class="jg-job-name">${esc(job.name)}</span>
        <span class="jg-job-wage">${KECO.wageText(job.avgWage)}</span>
      </button>`;
  }

  /* 페이지 번호 줄. 페이지가 많아지면 현재 위치 주변만 보여주고 양끝을 남긴다
     (1 … 4 5 6 … 12 형태) — 번호를 다 깔면 줄이 넘친다. */
  function pager(page, pages) {
    if (pages <= 1) return '';

    const nums = [];
    const push = (n) => {
      if (!nums.includes(n)) nums.push(n);
    };
    push(1);
    for (let n = page - 1; n <= page + 1; n++) if (n > 1 && n < pages) push(n);
    push(pages);
    nums.sort((a, b) => a - b);

    let html = '';
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) html += `<span class="pg-gap">…</span>`;
      html += `<button class="pg-num ${n === page ? 'on' : ''}" onclick="CareerPage.goJobPage(${n})">${n}</button>`;
      prev = n;
    }

    return `
      <div class="pager">
        <button class="pg-arrow" ${page === 1 ? 'disabled' : ''} onclick="CareerPage.goJobPage(${page - 1})">
          <i class="ti ti-chevron-left"></i> 이전
        </button>
        ${html}
        <button class="pg-arrow" ${page === pages ? 'disabled' : ''} onclick="CareerPage.goJobPage(${page + 1})">
          다음 <i class="ti ti-chevron-right"></i>
        </button>
      </div>`;
  }

  /* ── 선배 평균 vs 내 스펙 ──────────────────────────────────
     "평균이 4.2인데 나는 3.7" 을 **한 줄에 두 막대**로 보여준다. 숫자만 나열하면
     0.5 가 큰 차이인지 알 수 없고, 막대 하나에 평균선만 그으면(마이페이지 방식)
     내 값과 평균을 같은 자리에서 견주기 어렵다.

     ── 무엇을 비교하나 ──
     앱이 **실제로 저장하는 값**만 쓴다. 프로토타입에는 '실무경험 개월' 이 있었지만
     스펙 폼에 개월을 받는 칸이 없어서, 채울 수 없는 행이 된다.

     ── 평균값의 출처 (이 순서) ──
       1) 실측 — Aggregator 집계. 단, 집계 단위가 **2차 분류**라 직업별이 아니다.
       2) 예시 — job-groups.js 의 직업별 bench. 이때는 행마다 '예시' 를 붙인다.
     내 값도 같다. 로그인 전이거나 스펙을 안 넣었으면 예시 스펙으로 그려서
     시연은 되게 하되, 그것이 예시라는 것을 화면에 적는다. */
  const CMP_METRICS = [
    { key: 'gpa',       label: '학점',        hint: '4.5 만점 환산',                 max: 4.5, dec: 2, unit: '' },
    { key: 'toeic',     label: '어학(TOEIC)', hint: '공인 어학 점수',                max: 990, dec: 0, unit: '점' },
    { key: 'cert',      label: '자격증',      hint: '보유 개수',                     max: 6,   dec: 1, unit: '개' },
    { key: 'external',  label: '대외활동',    hint: '인턴십·교외 공모전·프로젝트',   max: 8,   dec: 1, unit: '회' },
    { key: 'internal',  label: '대내활동',    hint: '동아리·학회·연구·교내 비교과',  max: 8,   dec: 1, unit: '회' },
    { key: 'volunteer', label: '봉사활동',    hint: '봉사·서포터즈·기자단',          max: 8,   dec: 1, unit: '회' },
  ];

  /* 스펙을 안 넣은 사람에게도 화면이 무엇을 하는 곳인지 보여준다. 값은 예시이고,
     화면에 그렇게 적는다 — 자기 값인 줄 알면 "내 학점이 왜 3.7이지" 가 된다. */
  const DEMO_SPEC = { gpa: 3.7, toeic: 750, cert: 1, external: 2, internal: 2, volunteer: 1 };

  /* 평균을 어디서 가져올지. 기본은 실측이 먼저다 — 지어낸 수치를 실제 데이터보다
     앞세우면 안 된다.

     ── 대신 알아 둘 것 ──
     실측은 **2차 분류 단위**라(aggregation.js), 같은 분류의 직업 37개가 전부 같은
     평균을 쓴다. 회계사와 속기사의 '선배 평균'이 같게 나온다는 뜻이다. 그래서 화면에
     그 사실을 적어 둔다.
     직업마다 값이 달라지는 화면을 시연해야 하면 이 값을 'demo' 로 바꾼다 —
     그때도 '예시' 라벨은 그대로 붙는다. */
  const PEER_SOURCE = 'real'; // 'real' = 실측 우선 | 'demo' = 직업별 예시 우선

  function myValueOf(spec, key) {
    if (!spec) return null;
    if (key === 'gpa') return CASProfile.gpa45(spec);
    if (key === 'toeic') return spec.scores?.toeic ?? null;
    if (key === 'cert') return spec.certs?.length ?? 0;
    return CASProfile.activityCount(spec, key);
  }

  /* 선배 평균 — 집계가 준 값이 있으면 그걸, 없으면 스펙 배열에서 직접 센다.
     Aggregator 는 자격증을 '보유율(%)' 로만 주므로 개수 평균은 여기서 만든다. */
  function peerValueOf(agg, key) {
    if (!agg || agg.empty) return null;
    if (key === 'gpa') return agg.gpa?.avg ?? null;
    if (key === 'toeic') return agg.scores?.toeic?.avg ?? null;
    const specs = agg.specs || [];
    if (!specs.length) return null;
    const sum = specs.reduce(
      (n, s) => n + (key === 'cert' ? (s.certs?.length || 0) : CASProfile.activityCount(s, key)),
      0,
    );
    return sum / specs.length;
  }

  const fmtNum = (v, dec) =>
    dec === 0 ? Math.round(v).toLocaleString() : String(Number(v.toFixed(dec)));

  /* majorCode·middleCode 를 인자로 받는다 — 예전에는 모듈 상태(currentMajor)를 봤는데,
     '내 학과 맞춤' 화면은 지금 고른 분류와 **다른 갈래**의 비교를 그려야 해서
     상태를 보면 엉뚱한 갈래의 예시 벤치마크가 붙는다. */
  function compareCard(job, middle, agg, majorCode, middleCode) {
    const spec = DB.getSpec(DB.currentUser()?.username);
    const bench = typeof JobGroups !== 'undefined'
      ? JobGroups.benchOf(majorCode ?? currentMajor, middleCode ?? currentMiddle, job.name)
      : null;

    /* 평균도 내 값도 못 구하면 카드를 아예 내지 않는다 — 빈 막대 여섯 줄은
       "데이터가 없다" 가 아니라 "고장" 으로 읽힌다. */
    const hasPeer = CMP_METRICS.some((m) => peerValueOf(agg, m.key) != null) || bench;
    if (!hasPeer) return '';

    const short = [];
    const over = [];
    let usedDemoPeer = false;
    let usedRealPeer = false;

    const rows = CMP_METRICS.map((m) => {
      const real = PEER_SOURCE === 'demo' ? null : peerValueOf(agg, m.key);
      const demo = bench ? bench[m.key] : null;
      const peer = real != null ? real : demo;
      const demoPeer = real == null && peer != null;
      if (demoPeer) usedDemoPeer = true;
      if (real != null) usedRealPeer = true;

      const mine = spec ? myValueOf(spec, m.key) : DEMO_SPEC[m.key];
      if (peer == null || mine == null) {
        return `
          <div class="cmpx-row">
            <div class="cmpx-name">${esc(m.label)}<em>${esc(m.hint)}</em></div>
            <div class="cmpx-bars"><div class="cmpx-none">비교할 값이 없어요</div></div>
            <div class="cmpx-gap"></div>
          </div>`;
      }

      const diff = mine - peer;
      /* '동일' 로 볼 폭 — 학점 0.01 차이를 '부족' 이라고 하면 의미 없는 격차가 강조된다 */
      const eps = m.max * 0.005;
      const cls = Math.abs(diff) < eps ? 'eq' : diff > 0 ? 'up' : 'down';
      if (cls === 'down') short.push(`${m.label} ${fmtNum(Math.abs(diff), m.dec)}${m.unit}`);
      if (cls === 'up') over.push(m.label);

      const wPeer = Math.min(100, (peer / m.max) * 100);
      const wMine = Math.min(100, (mine / m.max) * 100);

      return `
        <div class="cmpx-row">
          <div class="cmpx-name">${esc(m.label)}<em>${esc(m.hint)}</em>
            ${demoPeer ? '<span class="cmpx-demo">예시</span>' : ''}
          </div>
          <div class="cmpx-bars">
            <div class="cmpx-bar">
              <span class="cmpx-tag">평균</span>
              <div class="cmpx-track"><div class="cmpx-fill avg" style="width:${wPeer.toFixed(1)}%"></div></div>
              <span class="cmpx-val">${fmtNum(peer, m.dec)}${esc(m.unit)}</span>
            </div>
            <div class="cmpx-bar">
              <span class="cmpx-tag">내 값</span>
              <div class="cmpx-track">
                <div class="cmpx-fill me ${cls}" style="width:${wMine.toFixed(1)}%"></div>
                <div class="cmpx-mark" style="left:${wPeer.toFixed(1)}%"></div>
              </div>
              <span class="cmpx-val">${fmtNum(mine, m.dec)}${esc(m.unit)}</span>
            </div>
          </div>
          <div class="cmpx-gap ${cls}">
            ${cls === 'eq' ? '±' : diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff), m.dec)}
            <em>${cls === 'down' ? '부족' : cls === 'up' ? '초과' : '동일'}</em>
          </div>
        </div>`;
    }).join('');

    const verdict = short.length
      ? `<b>${esc(job.name)}</b> 기준으로 <b>${esc(short.join(', '))}</b>이(가) 모자랍니다.${
          over.length ? ` 대신 <b>${esc(over.join(', '))}</b>은(는) 평균을 넘었어요.` : ''
        } 모자란 항목부터 채우는 편이 점수가 빨리 오릅니다.`
      : `<b>${esc(job.name)}</b> 선배 평균을 모든 항목에서 채웠어요. 이제 지원서와 면접 준비에 집중하세요.`;

    /* 무엇을 보고 있는지 밝힌다. 평균이 예시인지, 내 값이 예시인지는 서로 다른
       문제라 따로 적는다 — 둘을 뭉뚱그리면 어느 쪽이 내 값인지 흐려진다.

       실측을 쓸 때 **'이 직업의 평균'이 아니라는 것**을 반드시 적는다. 집계 단위가
       2차 분류라 같은 분류의 직업이 전부 같은 평균을 쓰는데, 제목만 보면 직업별
       평균으로 읽힌다. 그대로 두면 화면이 거짓말을 한다. */
    const notes = [];
    if (usedRealPeer) {
      notes.push(
        `평균은 <b>${esc(middle.name)} 선배 ${agg.count}명</b>의 값이에요 —
         직업 하나로 좁히면 표본이 한 자릿수라, 같은 분류의 직업은 같은 평균을 씁니다`,
      );
    }
    if (usedDemoPeer) {
      notes.push(
        usedRealPeer
          ? '<b>예시</b> 표시가 붙은 줄은 선배 데이터가 없어 직업별 예시 수치로 채웠어요'
          : '선배 평균은 <b>직업별 예시 수치</b>예요 — 아직 이 분류에 스펙을 넣은 선배가 없습니다',
      );
    }
    if (!spec) {
      notes.push(
        DB.currentUser()
          ? '내 값은 <b>예시</b>예요 — <a class="cmpx-link" onclick="navigate(\'mypage\')">스펙을 입력하면</a> 내 값으로 바뀝니다'
          : '내 값은 <b>예시</b>예요 — <a class="cmpx-link" onclick="navigate(\'login\')">로그인하면</a> 내 스펙으로 비교합니다',
      );
    }

    const scope = usedRealPeer
      ? `${esc(middle.name)} 선배 ${agg.count}명 평균`
      : '직업별 예시 수치';

    return `
      <div class="section-title">${esc(job.name)} — 선배 평균 vs 내 스펙
        <span class="scope-tag">${scope}</span>
        <span class="scope-tag scope-tag--mute">${spec ? '내 스펙' : '예시 스펙'}</span>
      </div>
      <div class="cmpx-card">
        <div class="cmpx-rows">${rows}</div>
        <div class="cmpx-verdict">${verdict}</div>
        ${notes.length ? `<div class="cmpx-notes">${notes.map((n) => `<div>· ${n}</div>`).join('')}</div>` : ''}
      </div>`;
  }

  /* ══ 이 갈래 선배들 — 어디로 갔나 · 점수가 어떻게 되나 ══════
     비교 카드가 "무엇이 부족한가"로 끝난다. 그 다음 질문 두 개("그래서 어디에
     지원하지?", "나는 몇 등쯤이지?")를 좌우로 나란히 둔다.

     ── 지어내지 않는다 ──
     두 카드 모두 **선배들이 실제로 넣은 값**만 센다. 회사는 spec.company 를,
     점수는 CAS 엔진(cas.js)이 매긴 것을 그대로 줄 세운다. 추천 알고리즘이
     회사를 골라 주지 않는다 — 근거를 댈 수 없는 추천은 이 화면의 나머지를
     같이 못 믿게 만든다.

     ── 이름 대신 닉네임 ──
     순위에 실명은 쓰지 않는다. 서버가 실명을 아예 내려보내지 않고(repo.js),
     닉네임조차 **로그인한 회원에게만** 준다(server.js /api/specs). 비로그인이면
     전부 '익명 선배' 로 보이고, 그 이유를 카드에 적는다. */
  function peerSection(agg) {
    if (!agg || agg.empty) return '';
    return `
      <div class="section-title">이 갈래 선배들
        <span class="scope-tag">선배가 직접 입력한 값만 셉니다</span>
      </div>
      <div class="peer-row">
        ${companyCard(agg)}
        ${rankCard(agg)}
      </div>`;
  }

  /* 왼쪽 — 인기 회사. 회사명을 적은 선배만 센다(중소기업은 대부분 비워 둔다).
     그래서 명단이 짧아도 정상이고, 몇 명이 적었는지를 같이 밝힌다. */
  function companyCard(agg) {
    const specs = agg.specs || [];

    const byName = new Map();
    specs.forEach((s) => {
      const c = String(s.company || '').trim();
      if (c) byName.set(c, (byName.get(c) || 0) + 1);
    });
    const list = [...byName.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);
    const named = [...byName.values()].reduce((n, v) => n + v, 0);

    const byType = {};
    specs.forEach((s) => {
      if (s.corpType) byType[s.corpType] = (byType[s.corpType] || 0) + 1;
    });
    const typed = Aggregator.CORP_TYPES.map((c) => ({ ...c, n: byType[c.id] || 0 })).filter((c) => c.n);
    const typeTotal = typed.reduce((n, c) => n + c.n, 0);
    const max = list.length ? list[0][1] : 1;

    return `
      <div class="peer-card">
        <div class="peer-card-h">
          <i class="ti ti-building"></i>
          <b>선배들이 간 회사</b>
          <span class="peer-card-n">${named}명이 회사명을 적었어요</span>
        </div>

        ${
          typeTotal
            ? `<div class="peer-types">
                 ${typed
                   .map(
                     (c) => `<div class="peer-type">
                       <span class="peer-type-ico">${c.icon}</span>
                       <span class="peer-type-label">${esc(c.label)}</span>
                       <span class="peer-type-pct">${Math.round((c.n / typeTotal) * 100)}%</span>
                     </div>`,
                   )
                   .join('')}
               </div>`
            : ''
        }

        ${
          list.length
            ? `<div class="peer-companies">
                 ${list
                   .map(
                     ([name, n]) => `
                   <button class="peer-company" onclick="CareerPage.openCompany('${esc(name).replace(/'/g, '&#39;')}')">
                     <span class="peer-company-name">${esc(name)}</span>
                     <span class="peer-company-bar"><i style="width:${Math.round((n / max) * 100)}%"></i></span>
                     <span class="peer-company-n">${n}명</span>
                   </button>`,
                   )
                   .join('')}
                 <p class="peer-note">회사를 누르면 뉴스·기업분석을 볼 수 있어요.
                   표본이 작아 <b>순위보다 어떤 회사가 나오는지</b>를 보는 편이 맞습니다.</p>
               </div>`
            : `<div class="peer-empty">아직 회사명을 적은 선배가 없어요.<br>
                 기업 유형만 보고 참고해 주세요.</div>`
        }
      </div>`;
  }

  /* 오른쪽 — CAS 점수 순위. 점수는 CASHero.scoreOf 를 그대로 쓴다.
     마이페이지의 내 점수와 **같은 함수**로 매겨야 "여기선 620점인데 저기선 580점"
     같은 어긋남이 생기지 않는다. */
  function rankCard(agg) {
    const specs = (agg.specs || []).filter(Boolean);
    if (!specs.length || typeof CASHero === 'undefined') return '';

    /* 자격증 카탈로그는 학과별로 다르다. 순위를 매기는 동안 사람마다 다른 자를
       쓰면 안 되므로, 이 갈래에서 가장 흔한 학과의 카탈로그 하나로 통일한다. */
    const deptCount = {};
    specs.forEach((s) => {
      if (s.dept) deptCount[s.dept] = (deptCount[s.dept] || 0) + 1;
    });
    const topDept = Object.entries(deptCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    const catalogIds = (Aggregator.CERT_CATALOG[topDept] || []).map((c) => c.id);

    const ranked = specs
      .map((s) => ({
        nick: s.nick || null,
        isMentor: Boolean(s.isMentor),
        total: CASHero.scoreOf(s, agg, catalogIds).total,
      }))
      .sort((a, b) => b.total - a.total);

    const mySpec = DB.getSpec(DB.currentUser()?.username);
    const myTotal = mySpec ? CASHero.scoreOf(mySpec, agg, catalogIds).total : null;
    const myRank = myTotal == null ? null : ranked.filter((r) => r.total > myTotal).length + 1;

    const anon = ranked.every((r) => !r.nick);
    const top = ranked.slice(0, 5);
    const max = top[0]?.total || 1;

    /* 고른 선배가 이번 목록에 없으면(분류를 옮겼다) 선택을 버린다 —
       안 버리면 다른 갈래 화면에 앞 갈래 선배 이름이 남는다. */
    const picked = top.find((r) => r.nick && r.nick === pickedMentor) || null;

    return `
      <div class="peer-card">
        <div class="peer-card-h">
          <i class="ti ti-trophy"></i>
          <b>CAS 점수 순위</b>
          <span class="peer-card-n">선배 ${ranked.length}명</span>
        </div>

        <div class="peer-ranks">
          ${top
            .map((r, i) => {
              const on = picked && picked.nick === r.nick;
              /* 멘토로 등록한 선배만 고를 수 있다. 멘티에게 신청하면 받을 사람이 없다.
                 고를 수 없는 줄은 버튼이 아니라 그냥 줄로 둔다 — 눌러도 반응이
                 없는 버튼은 고장으로 읽힌다. */
              const pickable = Boolean(r.nick && r.isMentor);
              const inner = `
                <span class="peer-rank-no r${i + 1}">${i + 1}</span>
                <!-- '멘토 아님' 은 **알 때만** 붙인다. 비로그인이면 서버가 멘토 여부를
                     아예 안 주므로(익명), 모르는 것을 아니라고 말하면 안 된다. -->
                <span class="peer-rank-nick">${r.nick ? esc(r.nick) : '익명 선배'}${
                  r.nick && !r.isMentor ? '<span class="peer-rank-tag">멘토 아님</span>' : ''
                }</span>
                <span class="peer-rank-bar"><i style="width:${Math.round((r.total / max) * 100)}%"></i></span>
                <span class="peer-rank-score">${Math.round(r.total)}</span>`;
              return pickable
                ? `<button type="button" class="peer-rank is-pickable ${on ? 'is-on' : ''}"
                     onclick="CareerPage.pickMentor('${esc(r.nick).replace(/'/g, '&#39;')}')">${inner}</button>`
                : `<div class="peer-rank">${inner}</div>`;
            })
            .join('')}
        </div>

        ${
          myTotal == null
            ? `<div class="peer-mine peer-mine--none">
                 ${
                   DB.currentUser()
                     ? `<a class="cmpx-link" onclick="navigate('mypage')">스펙을 입력하면</a> 내 순위도 같이 나와요`
                     : `<a class="cmpx-link" onclick="navigate('login')">로그인하면</a> 내 순위도 같이 나와요`
                 }
               </div>`
            : `<div class="peer-mine">
                 <span class="peer-rank-no me">나</span>
                 <span class="peer-rank-nick">${ranked.length}명 중 <b>${myRank}위</b></span>
                 <span class="peer-rank-bar"><i class="me" style="width:${Math.round((myTotal / max) * 100)}%"></i></span>
                 <span class="peer-rank-score">${Math.round(myTotal)}</span>
               </div>`
        }

        ${mentorPickBlock(picked, anon)}

        <p class="peer-note">${
          anon
            ? '<b>로그인하면</b> 선배 닉네임이 보여요. 실명은 어떤 경우에도 보이지 않습니다.'
            : '실명이 아니라 닉네임이에요. 점수는 마이페이지의 내 CAS 와 같은 기준으로 매깁니다.'
        }</p>
      </div>`;
  }

  /* ── 순위에서 고른 선배에게 멘토링 신청 ─────────────────────
     '나' 줄 아래 남던 자리를 쓴다. 멘토 찾기의 신청 화면을 그대로 끌어오지 않은
     이유: 그 화면은 시드 멘토 전용이라 경력 타임라인·후기·평점을 id 로 지어낸다.
     실제 회원에게 그걸 붙이면 없는 경력을 만들어 내는 셈이라, 여기서는 **우리가
     실제로 아는 것**(닉네임·CAS·형식·날짜·시간)만으로 신청을 만든다.

     신청은 멘토 찾기와 **같은 API**(POST /api/mentoring/requests)를 쓴다.
     금액은 서버가 정하고, 결제 키가 없으면 신청만 남는다 — 그쪽과 같은 규칙이다. */
  const PICK_FORMATS = [
    { id: 'video30', label: '화상 30분', price: '20,000원' },
    { id: 'onsite60', label: '대면 60분', price: '45,000원' },
    { id: 'text', label: '텍스트', price: '12,000원' },
  ];
  const PICK_TIMES = ['10:00', '11:00', '14:00', '15:00', '16:00', '19:00', '20:00'];

  function mentorPickBlock(picked, anon) {
    if (anon) return '';
    if (!picked) {
      return `<div class="peer-pick peer-pick--hint">
        위 순위에서 <b>선배를 누르면</b> 여기서 바로 멘토링을 신청할 수 있어요.
      </div>`;
    }

    /* 지난 날짜를 고를 수 없게 오늘을 최소값으로 준다 — 서버가 막지 않는 값이라
       화면에서 걸러야 한다. */
    const today = new Date();
    const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    return `
      <div class="peer-pick">
        <div class="peer-pick-h">
          <span class="peer-pick-nick">${esc(picked.nick)}</span>
          <span class="peer-pick-sub">CAS ${Math.round(picked.total)}점 선배에게 신청</span>
          <button type="button" class="peer-pick-x" onclick="CareerPage.pickMentor(null)"
                  aria-label="선택 해제"><i class="ti ti-x"></i></button>
        </div>

        <div class="peer-pick-formats">
          ${PICK_FORMATS.map(
            (f, i) => `
            <button type="button" class="peer-pick-fmt ${i === pickedFormat ? 'is-on' : ''}"
                    onclick="CareerPage.pickFormat(${i})">
              <span class="peer-pick-fmt-l">${esc(f.label)}</span>
              <span class="peer-pick-fmt-p">${esc(f.price)}</span>
            </button>`,
          ).join('')}
        </div>

        <div class="peer-pick-when">
          <input type="date" id="peer-pick-date" class="peer-pick-date" min="${min}" value="${esc(pickedDate)}"
                 onchange="CareerPage.setPickDate(this.value)">
          <select id="peer-pick-time" class="peer-pick-time" onchange="CareerPage.setPickTime(this.value)">
            <option value="">시간 선택</option>
            ${PICK_TIMES.map(
              (t) => `<option value="${t}" ${t === pickedTime ? 'selected' : ''}>${t}</option>`,
            ).join('')}
          </select>
        </div>

        <button type="button" class="peer-pick-send" onclick="CareerPage.sendMentorRequest()">
          <i class="ti ti-send"></i> 멘토링 신청 보내기
        </button>
        <div class="peer-pick-state" id="peer-pick-state"></div>
        <p class="peer-pick-note">신청은 <b>내 멘토링</b>에 저장됩니다. 선배에게 알림이 가는 기능은
          아직 없어요 — 멘토 찾기의 신청도 지금은 같은 상태입니다.</p>
      </div>`;
  }

  // ── STEP 03 · 커리어 로드맵 ───────────────────────────────
  function renderRoadmap(major, middle, job) {
    /* 스펙 레코드는 아직 학과(dept) 스키마다. 2차 분류에 얹힌 legacy 조건으로 집계한다.
       집계 범위는 좁은 것부터 넓은 순으로 시도한다:
         2차 분류+기업유형 → 2차 분류 전체 → 1차 분류 전체
       4분류로 쪼개면 표본이 크게 줄어 빈 유형이 흔하다. 그때 빈 화면을 주는 대신
       2차 분류 전체 통계로 물러서고, 무엇을 보고 있는지 scope 태그로 밝힌다.

       ── 집계 단위는 '직업'이 아니라 '2차 분류'다 ──
       직업 461개 단위로 선배 스펙을 나누면 표본이 한 자릿수로 쪼개져 평균이 의미를
       잃는다. 스펙 통계는 2차 분류 단위로 낸다.
       화면에도 그렇게 적어 둔다 — 무엇의 평균인지 헷갈리면 안 된다. */
    const midFn = KECO.middleMatcher(currentMajor, currentMiddle);
    const majFn = KECO.majorMatcher(currentMajor);
    const certKey = `keco:${major.code}:${middle.code}`;

    /* 유형별 실제 표본 수 — 폴백 전 숫자여야 어디에 데이터가 있는지 보인다 */
    const corpCounts = {};
    Aggregator.CORP_TYPES.forEach((c) => {
      corpCounts[c.id] = midFn
        ? Aggregator.compute({ where: midFn, corpType: c.id, certKey }).count
        : 0;
    });

    let agg = { empty: true },
      scope = '';
    if (midFn) {
      if (currentCorp === 'all') {
        agg = Aggregator.compute({ where: midFn, certKey });
        scope = '선배 데이터';
      } else {
        agg = Aggregator.compute({
          where: midFn,
          corpType: currentCorp,
          certKey,
        });
        scope = `${corpLabel(currentCorp)} 선배 데이터`;
        if (agg.empty) {
          agg = Aggregator.compute({ where: midFn, certKey });
          scope = '2차 분류 전체 (기업유형 미일치)';
        }
      }
    }
    if (agg.empty && majFn) {
      agg = Aggregator.compute({ where: majFn, certKey });
      scope = `${major.name} 전체 (2차 분류 미일치)`;
    }

    /* 표본 수(n)는 여기서 말하지 않는다 — 아래 비교 카드가 '선배 21명 평균' 이라고
       자기 출처를 밝히므로, 같은 말을 두 번 하면 어느 쪽이 무엇의 표본인지 흐려진다. */
    const head = `
      ${corpTabBar(corpCounts)}
      <div class="section-title">관련 전공</div>
      <div class="roadmap-grid">
        <div class="roadmap-card">
          <div class="roadmap-chips">
            ${
              middle.majors.length
                ? middle.majors
                    .map(
                      (m) => `<span class="chip chip--major">${esc(m)}</span>`,
                    )
                    .join('')
                : `<span class="chip chip--empty">전공 무관</span>`
            }
          </div>
        </div>
      </div>`;

    /* 비교 카드는 집계가 비어 있어도 낸다 — 예시 벤치마크로라도 "이 직업은 이 정도"를
       보여주는 것이 이 화면의 답이고, 빈 상태 안내만 있으면 답이 없다. */
    const compare = job ? compareCard(job, middle, agg) : '';

    if (agg.empty) {
      return `<div class="roadmap-section">${head}${compare}${emptySpecBlock(middle)}${nextStepBlock(middle, job, agg)}</div>`;
    }

    /* ── 정량/정성 스펙 탭을 걷어냈다 ──
       탭 안의 '합격자 평균 학점 4.02'·'TOEIC 평균 901' 은 바로 위 비교 카드가
       이미 같은 값을 막대로 보여준다. 같은 숫자를 두 번 읽게 하는 자리였다. */
    return `
      <div class="roadmap-section">
        ${head}
        ${compare}
        ${peerSection(agg)}
        ${nextStepBlock(middle, job, agg)}
      </div>
    `;
  }

  /* ── 1단계의 결론 → 2단계로 ──────────────────────────────────
     위에서 본 비교는 **선배들의 평균과 나의 차이**다. 학생이 다음에 알고 싶은 것은
     하나뿐이다 — "그래서 나는 지금 어디쯤인가". 그 질문을 화면에 그대로 적고
     누르면 CAS 로 넘긴다.

     선배 표본이 없으면(agg.empty) 비교 자체가 성립하지 않으므로 그렇게 적는다.
     '계산해 준다' 고 해 놓고 빈 화면을 주는 것이 이 프로젝트가 피해 온 실패다. */
  function nextStepBlock(middle, job, agg) {
    const comparable = !agg.empty && agg.count > 0;
    return `
      <div class="rm-next">
        <div class="rm-next-body">
          <div class="rm-next-eyebrow">2단계 · 지금 내 위치</div>
          <h3>현재 나의 위치는?</h3>
          <p>${comparable
            ? `${esc(middle.name)} 직무군 선배 <b>${agg.count}명</b>과 같은 기준으로 채점해
               내 CAS 점수와 부족한 항목을 보여드려요.`
            : `아직 이 직무군의 선배 데이터가 없어 비교는 못 해요.
               그래도 내 스펙만으로 계산한 CAS 점수는 볼 수 있어요.`}</p>
        </div>
        <button type="button" class="rm-next-btn" onclick="CareerPage.goToCas()">
          내 위치 확인하기 <i class="ti ti-arrow-right"></i>
        </button>
      </div>`;
  }

  function emptySpecBlock(middle) {
    return `
      <div class="empty-block">
        <div class="empty-icon">📭</div>
        <div class="empty-title">아직 데이터가 없습니다</div>
        <div class="empty-desc">
          ${esc(middle.name)} 직무의 스펙 데이터를 입력한 회원이 없어요.<br>
          <a class="empty-cta" onclick="navigate('mypage')">스펙 입력하기 →</a>
          <span class="empty-or">또는</span>
          <a class="empty-cta" onclick="navigate('backoffice')">백오피스에서 데모 시드 추가 →</a>
        </div>
      </div>`;
  }

  /* 기업 유형 선택 줄. '전체' 는 유형을 나누기 전 2차 분류 통계 — 기본값이다.
     각 유형 옆 숫자는 폴백 전 실제 표본 수라 0 이면 0 이라고 그대로 보여준다. */
  function corpTabBar(corpCounts) {
    const tab = (id, label, icon, n) => `
      <div class="corp-tab ${currentCorp === id ? 'active' : ''}" onclick="CareerPage.switchCorp('${id}')">
        <span class="ct-icon">${icon}</span>
        <span class="ct-label">${esc(label)}</span>
        ${n == null ? '' : `<span class="ct-count ${n === 0 ? 'zero' : ''}">${n}</span>`}
      </div>`;
    return `
      <div class="section-title">기업 유형</div>
      <div class="corp-tab-bar">
        ${tab('all', '전체', '📊', null)}
        ${Aggregator.CORP_TYPES.map((c) => tab(c.id, c.label, c.icon, corpCounts[c.id])).join('')}
      </div>`;
  }

  function corpLabel(id) {
    return (Aggregator.CORP_TYPES.find((c) => c.id === id) || {}).label || id;
  }

  /* ══ 내 학과 맞춤 — 관련 직무와 대표 회사 ═══════════════════
     사이드바 프로필 카드를 누르면 열린다. "내 학과로 갈 수 있는 데가 어디냐"는
     분류를 열 개씩 뒤져 봐야 알 수 있었는데, 그 답을 한 화면에 모은다.

     ── 관련 여부는 지어내지 않는다 ──
     2차 분류마다 '관련 전공'(middle.majors)이 데이터에 붙어 있다. 내 학과와
     맞는지는 **CAS 가 전공 적합성을 판정할 때 쓰는 같은 규칙**(CAS.isMajorRelevant)
     으로 본다 — 두 곳이 다른 답을 내면 "여기선 관련 있다는데 점수는 왜 깎이지"가 된다.
     단, isMajorRelevant 는 관련 전공 목록이 비어 있으면 true 를 준다(불이익 방지).
     여기서는 그걸 그대로 쓰면 전부 걸리므로, **목록이 있는 분류만** 대상으로 한다.

     대표 회사는 그 분류 선배들이 실제로 적은 회사명을 센다(peerSection 과 같은 규칙). */
  function myMajorBlock() {
    const spec = DB.getSpec(DB.currentUser()?.username);
    const dept = spec?.dept || null;
    const mine = dept ? CAS.DEPT_MAJOR[dept] : null;

    if (!mine) {
      return `
        <div class="empty-block">
          <div class="empty-icon">🎓</div>
          <div class="empty-title">학과를 아직 몰라요</div>
          <div class="empty-desc">
            스펙에 <b>학과</b>를 넣으면 그 학과로 갈 수 있는 직무와<br>
            선배들이 실제로 간 회사를 모아서 보여드려요.<br>
            <a class="empty-cta" onclick="navigate('${DB.currentUser() ? 'mypage' : 'login'}')">
              ${DB.currentUser() ? '스펙 입력하기' : '로그인하기'} →</a>
          </div>
        </div>`;
    }

    /* 관련 전공 목록이 있는 분류 중 내 학과와 맞는 것만 모은다 */
    const hits = [];
    KECO.MAJORS().forEach((M) => {
      M.middles.forEach((S) => {
        if (S.majors?.length && CAS.isMajorRelevant(dept, S.majors)) hits.push({ M, S });
      });
    });

    const head = `
      <div class="mj-hero">
        <div class="mj-hero-ico">🎓</div>
        <div>
          <h2>${esc(spec.major || mine)} 전공이면 여기부터</h2>
          <p>내 학과와 <b>관련 전공</b>이 겹치는 직무 ${hits.length}갈래예요.
            ${spec.major && spec.major !== mine ? `통계는 <b>${esc(mine)}</b> 분류로 묶여요.` : ''}</p>
        </div>
      </div>`;

    if (!hits.length) {
      return `${head}
        <div class="empty-block">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">아직 이어진 직무가 없어요</div>
          <div class="empty-desc">${esc(mine)} 과(와) 관련 전공이 연결된 분류가 없습니다.<br>
            왼쪽에서 직접 분류를 골라 둘러봐 주세요.</div>
        </div>`;
    }

    /* 처음 열었을 때 오른쪽이 비어 있지 않도록 첫 갈래의 대표 직업 하나를 미리 세운다.
       고를 때까지 빈 칸으로 두면 "여기 뭐가 나오는 자리인지" 알 수 없다.
       한 번이라도 직접 고르거나 닫았으면(mmAuto=false) 손대지 않는다. */
    const stale = mmJob && !hits.some(({ M, S }) => mmJob.major === M.code && mmJob.middle === S.code);
    if (stale) mmJob = null;                 // 학과가 바뀌어 없는 갈래를 가리키고 있다
    if (mmAuto && !mmJob) {
      const first = hits[0];
      const top = [...first.S.jobs].sort((a, b) => (b.avgWage ?? 0) - (a.avgWage ?? 0))[0];
      mmJob = top ? { major: first.M.code, middle: first.S.code, job: top.code } : null;
    }

    return `${head}
      <div class="section-title">관련 직무
        <span class="scope-tag">회사는 선배가 직접 적은 값만 셉니다</span>
      </div>
      <div class="mj-layout">
        <div class="mj-col">${hits.map(({ M, S }) => myMajorCard(M, S)).join('')}</div>
        <div class="mj-side">${mmCompareBlock()}</div>
      </div>`;
  }

  /* 오른쪽 칸 — 고른 대표 직업의 '선배 평균 vs 내 스펙'.
     로드맵 화면과 **같은 부품**(compareCard)을 쓴다. 같은 것을 두 번 만들면
     한쪽만 고쳐져서 두 화면이 다른 숫자를 말하게 된다. */
  function mmCompareBlock() {
    /* 닫아 둔 상태 — 빈 칸으로 두면 화면 절반이 죽는다. 무엇을 누르면 되는지 적는다. */
    if (!mmJob) {
      return `<div class="mj-side-hint">
        왼쪽에서 <b>대표직업을 누르면</b> 그 직업의 선배 평균과 내 스펙을 여기서 비교해 드려요.
      </div>`;
    }
    const M = KECO.byId(mmJob.major);
    const S = M && KECO.middleById(mmJob.major, mmJob.middle);
    const job = S && KECO.jobById(mmJob.major, mmJob.middle, mmJob.job);
    if (!job) return '';

    const fn = KECO.middleMatcher(mmJob.major, mmJob.middle);
    const agg = fn ? Aggregator.compute({ where: fn, certKey: `keco:${M.code}:${S.code}` }) : { empty: true };
    const card = compareCard(job, S, agg, mmJob.major, mmJob.middle);

    return `
      <div class="mj-side-in">
        ${
          card ||
          `<div class="empty-block"><div class="empty-icon">📊</div>
             <div class="empty-title">비교할 값이 없어요</div>
             <div class="empty-desc">${esc(job.name)} 갈래에 선배 데이터도 예시 수치도 아직 없습니다.</div>
           </div>`
        }
        <button class="mj-open" onclick="CareerPage.openMiddleJob('${mmJob.major}','${mmJob.middle}','${mmJob.job}')">
          ${esc(job.name)} 로드맵 열기 <i class="ti ti-arrow-narrow-right"></i>
        </button>
      </div>`;
  }

  function myMajorCard(M, S) {
    /* 대표 회사 — 그 분류로 집계한 선배 스펙에서 회사명을 센다. */
    const fn = KECO.middleMatcher(M.code, S.code);
    const agg = fn ? Aggregator.compute({ where: fn }) : { empty: true };
    const byName = new Map();
    (agg.specs || []).forEach((s) => {
      const c = String(s.company || '').trim();
      if (c) byName.set(c, (byName.get(c) || 0) + 1);
    });
    const cos = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    /* 대표 직업 — 연봉 높은 순 4개. **접어 둔다.**
       갈래가 세 개만 돼도 카드마다 직업이 깔려서 화면이 길어지고, 정작 비교해야 할
       '어떤 갈래가 있나'가 한눈에 안 들어왔다. 필요할 때만 펼친다.
       6개까지 늘리지 않는 건 이게 '전부 보기'가 아니라 맛보기라서다 — 전부는
       머리줄의 '이 갈래 직업 전부 보기' 가 맡는다. */
    const jobs = [...S.jobs].sort((a, b) => (b.avgWage ?? 0) - (a.avgWage ?? 0)).slice(0, 4);
    const w = S.wageRange;
    const key = `${M.code}:${S.code}`;
    const open = openMajorCards.has(key);

    return `
      <div class="mj-card">
        <div class="mj-card-h">
          <span class="mj-card-emoji">${M.emoji}</span>
          <div class="mj-card-t">
            <div class="mj-card-name">${esc(S.name)}</div>
            <div class="mj-card-sub">${esc(M.name)} · 직업 ${S.jobs.length}개${
              w ? ` · 평균 ${KECO.wageText(w.avg)}` : ''
            }</div>
          </div>
          <!-- 머리줄 오른쪽 빈자리 — 갈래 전체로 넘어가는 길은 여기에 둔다 -->
          <button class="mj-all" onclick="CareerPage.openMiddle('${M.code}','${S.code}')">
            이 갈래 직업 전부 보기 <i class="ti ti-arrow-narrow-right"></i>
          </button>
        </div>

        <div class="mj-block">
          <span class="mj-label">선배들이 간 회사</span>
          ${
            cos.length
              ? `<div class="mj-cos">
                   ${cos
                     .map(
                       ([name, n]) => `<button class="mj-co" onclick="CareerPage.openCompany('${esc(name).replace(/'/g, '&#39;')}')">
                         ${esc(name)}<span>${n}명</span>
                       </button>`,
                     )
                     .join('')}
                 </div>`
              : `<div class="mj-none">${
                  agg.empty ? '아직 이 갈래에 선배 데이터가 없어요' : '회사명을 적은 선배가 아직 없어요'
                }</div>`
          }
        </div>

        <button class="mj-more ${open ? 'is-on' : ''}"
                onclick="CareerPage.toggleMajorCard('${key}')" aria-expanded="${open}">
          <i class="ti ti-chevron-down mj-more-chev"></i> 대표직업 보기
          <span class="mj-more-n">${jobs.length}</span>
        </button>

        ${
          open
            ? `<div class="mj-jobs">
                 ${jobs
                   .map(
                     (j) => `<button class="mj-job ${
                       mmJob && mmJob.job === j.code ? 'is-on' : ''
                     }" onclick="CareerPage.previewJob('${M.code}','${S.code}','${j.code}')">
                       <span class="mj-job-l">
                         <span class="mj-job-name">${esc(j.name)}</span>
                         <span class="mj-job-meta">
                           <b>${KECO.wageText(j.avgWage)}</b>${
                             j.outlook ? ` · 전망 ${esc(j.outlook)}` : ''
                           }
                         </span>
                       </span>
                       <!-- 이름만으로는 '경영 및 진단 전문가' 가 무슨 일인지 알 수 없다.
                            임금직업정보의 직업 설명을 옆에 그대로 붙인다(282개 전부 있다). -->
                       <span class="mj-job-desc">${esc(j.summary || '설명이 아직 없어요')}</span>
                     </button>`,
                   )
                   .join('')}
               </div>`
            : ''
        }
      </div>`;
  }

  // ── helpers ───────────────────────────────────────────────
  function welcomeBlock() {
    const c = KECO.counts();
    return `
      <div class="welcome">
        <div class="welcome-icon">🗺️</div>
        <h2>관심 있는 직무를 골라 보세요</h2>
        <p>여기가 <b>첫 단계</b>예요. 직무를 고르면
          <b>지금 내 위치 → 채울 것 → 지원할 회사</b> 순으로 이어집니다.<br>
          왼쪽 분야 ${c.majors}개 중 하나를 고르면 세부 분류 → 직무 순으로 좁혀 가요.<br>
          <span class="welcome-sub">직무 ${c.jobs}개 · 한국고용직업분류(KECO) 기준 · 평균임금은 임금직업정보시스템</span></p>
      </div>`;
  }

  function loadingBlock() {
    return `
      <div class="welcome">
        <div class="welcome-icon">⏳</div>
        <h2>직업 분류를 불러오는 중…</h2>
        <p>직업 461개의 임금 정보를 받아오고 있어요. 처음 한 번만 걸립니다.</p>
      </div>`;
  }

  function loadErrorBlock() {
    return `
      <div class="welcome">
        <div class="welcome-icon">⚠️</div>
        <h2>직업 분류를 불러오지 못했어요</h2>
        <p>${esc(loadError)}<br>
          백엔드가 켜져 있는지 확인한 뒤 다시 시도해 주세요.</p>
        <p><a class="empty-cta" onclick="CareerPage.retry()">다시 시도 →</a></p>
      </div>`;
  }
  function placeholderBlock() {
    return `<div class="welcome"><div class="welcome-icon">🚧</div><h2>준비 중</h2><p>이 분류는 곧 추가될 예정이에요.</p></div>`;
  }
  function noDataInline(msg) {
    return `<div class="inline-empty">${msg}</div>`;
  }
  /* render() 가 innerHTML 을 갈아치우므로, 다시 그리기 전에 입력칸의 값을 상태로
     옮겨 둔다. 안 하면 형식을 바꾸는 순간 골라 둔 날짜가 사라진다. */
  function syncPickInputs() {
    const d = document.getElementById('peer-pick-date');
    const t = document.getElementById('peer-pick-time');
    if (d) pickedDate = d.value || '';
    if (t) pickedTime = t.value || '';
  }

  function esc(s) {
    return String(s ?? '').replace(
      /[&<>"']/g,
      (m) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[m],
    );
  }

  // ── 외부 인터페이스 ──────────────────────────────────────
  return {
    init,
    refreshUser,
    render,
    /* 2차 분류를 바꾸면 고른 직업은 그 분류에 없는 코드가 되므로 반드시 같이 비운다.
       안 비우면 breadcrumb 에 남의 갈래 직업 이름이 남는다.
       내용이 짧아지므로 방금 열린 직업 목록으로 데려간다(paint 의 anchor 주석). */
    selectMiddle(code) {
      currentMiddle = code;
      currentJob = null;
      jobPage = 1;
      currentGroup = null; // 분류가 바뀌면 앞 분류의 그룹 id 는 여기에 없다
      render({ anchor: '.jg-chips, .job-grid, .empty-block' });
    },
    /* 직업 묶음 고르기. null 이면 전체. 고른 직업은 그대로 둔다 —
       묶음은 목록을 좁혀 보는 장치일 뿐이라, 보던 로드맵이 닫히면 안 된다. */
    selectGroup(id) {
      currentGroup = id || null;
      render();
    },
    /* 직업을 고르는 순간이 로드맵 1단계의 결론이다. 여기서 흐름 상태에 심어 두면
       CAS·회사 찾기·자소서 코치가 같은 직무를 본다(roadmap.js 머리주석).
       화면이 로드맵으로 바뀌므로 맨 위에서 시작한다 — 목록 중간에서 눌렀는데
       새 화면이 그 높이에서 시작하면 로드맵 머리가 화면 밖에 있다. */
    selectJob(code) {
      currentJob = code;
      const major = KECO.byId(currentMajor);
      const middle = KECO.middleById(currentMajor, currentMiddle);
      const job = KECO.jobById(currentMajor, currentMiddle, code);
      if (major && middle) {
        Roadmap.setJob({
          major: major.code, middle: middle.code, job: job?.code || null,
          majorName: major.name, middleName: middle.name, jobName: job?.name || '',
          avgWage: job?.avgWage ?? null,
        });
        /* 방금 이 화면이 만든 변경이라 되돌릴 것이 없다. 표시해 두지 않으면
           restoreFromRoadmap 이 '바뀌었다'고 보고 페이지 번호를 1로 되감는다 —
           3페이지에서 고른 직업 목록이 눈앞에서 1페이지로 튄다. */
        appliedRm = `${major.code}/${middle.code}/${job?.code || ''}`;
      }
      render({ toTop: true });
    },
    goToCas() { navigate('dashboard'); },
    /* 로드맵 → 직업 목록. 고른 직업만 지우고 묶음 필터는 남긴다 —
       6번 묶음을 보다 들어왔으면 돌아갈 때도 6번 묶음이어야 한다. */
    backToJobs() {
      currentJob = null;
      render({ toTop: true });
    },
    /* 회사 리포트로 넘긴다 — 뉴스·기업분석 화면이 이미 있으므로 여기서 만들지 않고
       회사명만 넘겨준다(자소서 코치가 쓰는 것과 같은 열쇠). */
    openCompany(name) {
      if (name) localStorage.setItem('careerly_company_open', name);
      navigate('company');
    },

    /* ── 내 학과 맞춤 보기 ─────────────────────────────────── */
    showMyMajor() {
      majorView = true;
      render();
    },
    closeMyMajor() {
      majorView = false;
      render();
    },
    /* 대표직업 펼치기/접기. 화면 위치는 그대로 둔다 — 맨 위로 올리면
       아래쪽 카드를 펼쳤을 때 화면이 튀어 방금 누른 카드를 놓친다.
       (paint 가 기본으로 자리를 지키므로 옵션을 주지 않는다) */
    toggleMajorCard(key) {
      if (openMajorCards.has(key)) openMajorCards.delete(key);
      else openMajorCards.add(key);
      render();
    },
    /* 대표직업 누르기 — 화면을 떠나지 않고 오른쪽 비교만 갈아 끼운다.
       **같은 직업을 다시 누르면 닫는다.** 열기만 되고 닫히지 않으면 한번 연 창을
       치울 방법이 없다. 로드맵으로 넘어가는 건 오른쪽 칸의 '로드맵 열기' 가 맡는다. */
    previewJob(majorCode, middleCode, jobCode) {
      const same =
        mmJob && mmJob.major === majorCode && mmJob.middle === middleCode && mmJob.job === jobCode;
      mmJob = same ? null : { major: majorCode, middle: middleCode, job: jobCode };
      mmAuto = false;         // 이제부터는 자동으로 채우지 않는다 (닫은 것을 존중한다)
      render();
    },
    /* 맞춤 화면에서 분류·직업으로 바로 들어간다. 들어가는 순간 맞춤 보기는 닫는다 —
       안 닫으면 뒤로 나왔을 때 어느 화면에 있는지 알 수 없다. */
    openMiddle(majorCode, middleCode) {
      majorView = false;
      currentMajor = majorCode;
      currentMiddle = middleCode;
      currentJob = null;
      currentGroup = null;
      jobPage = 1;
      paintSidebar();
      render();
    },
    openMiddleJob(majorCode, middleCode, jobCode) {
      majorView = false;
      currentMajor = majorCode;
      currentMiddle = middleCode;
      currentGroup = null;
      currentJob = jobCode;
      paintSidebar();
      render();
    },

    /* ── CAS 순위에서 멘토 고르기 ──────────────────────────── */
    pickMentor(nick) {
      /* 같은 줄을 다시 누르면 선택을 푼다. 고칠 방법이 없는 선택은 갇힌 느낌을 준다. */
      pickedMentor = !nick || pickedMentor === nick ? null : nick;
      pickedFormat = 0;
      render();
    },
    pickFormat(i) {
      syncPickInputs();          // 다시 그리기 전에 적어 둔 날짜·시간을 살린다
      pickedFormat = i;
      render();
    },
    setPickDate(v) { pickedDate = v || ''; },
    setPickTime(v) { pickedTime = v || ''; },

    /* 신청은 멘토 찾기와 같은 API 를 쓴다 — 금액은 서버가 정하고, 결제 키가 없으면
       신청만 남는다. 여기서 금액을 보내지 않는 이유는 routes/mentoring.js 머리주석에
       적혀 있다(브라우저가 금액을 들고 있으면 20,000원을 100원으로 바꿔 보낼 수 있다). */
    async sendMentorRequest() {
      syncPickInputs();
      const state = document.getElementById('peer-pick-state');
      const say = (msg, cls = '') => {
        if (state) state.innerHTML = `<span class="${cls}">${esc(msg)}</span>`;
      };

      if (!DB.currentUser()) {
        say('로그인 후 신청할 수 있어요');
        setTimeout(() => navigate('login'), 700);
        return;
      }
      if (!pickedMentor) return say('선배를 먼저 골라 주세요', 'bad');
      if (!pickedDate) return say('날짜를 골라 주세요', 'bad');
      if (!pickedTime) return say('시간을 골라 주세요', 'bad');

      const fmt = PICK_FORMATS[pickedFormat] || PICK_FORMATS[0];
      say('보내는 중…');
      try {
        const res = await fetch('/api/mentoring/requests', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          /* 스펙은 익명이라 회원 id 가 없다. 닉네임으로 가리키고, 이름도 닉네임으로
             남긴다 — '내 멘토링' 에도 실명이 들어가면 안 된다. */
          body: JSON.stringify({
            mentorId: `nick:${pickedMentor}`,
            mentorName: pickedMentor,
            format: fmt.id,
            message: '',
            slotDate: pickedDate,
            slotTime: pickedTime,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
        say(`${pickedMentor} 선배에게 신청을 보냈어요 · 내 멘토링에서 확인하세요`, 'ok');
        pickedDate = '';
        pickedTime = '';
      } catch (e) {
        say(e.message, 'bad');
      }
    },
    goJobPage(n) {
      jobPage = Math.max(1, n);
      render({ anchor: '.job-grid' });
    },
    gotoPhase(n) {
      if (n === 1) {
        currentMiddle = null;
        currentJob = null;
      }
      if (n === 2) {
        currentJob = null;
      }
      render({ toTop: n === 1 });
    },
    switchCorp(id) {
      currentCorp = id;
      render();
    },
    retry() {
      loadError = null;
      render({ toTop: true });
    },
  };
})();
