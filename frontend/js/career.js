// ════════════════════════════════════════════════════════════
//  C:road — Career Roadmap (임금직업정보 · 한국고용직업분류 KECO 2018 기반)
//   • 사이드바      : 1차 분류 10개 (js/keco.js · 임금직업정보시스템)
//   • STEP 01       : 2차 분류 선택    (미용·여행…경비·청소직 → 경호·경비직)
//   • STEP 02       : 직업 선택        (경호·경비직 → 경호원) · 9개씩 페이지로 나눈다
//   • STEP 03       : 커리어 로드맵 — 기업 유형 → 정량/정성 스펙
//   • 정량/정성 스펙 섹션은 Aggregator.compute() 결과로 동적 생성
//   • 데이터가 없으면 "데이터 없음" 빈 상태 표시
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
  let specTab = 'quant';
  let loadError = null;
  let jobPage = 1; // 직업 목록 페이지 (2차 분류를 바꾸면 1로 되돌린다)
  /* 지금 펼쳐 본 직업 묶음(job-groups.js 의 id). null 이면 묶음 전체를 편다.
     묶음 정의가 없는 2차 분류에서는 쓰이지 않는다. */
  let currentGroup = null;

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
        currentMajor = el.dataset.id;
        currentMiddle = null;
        currentJob = null;
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

  /* ── 다시 그려도 보던 자리에 있게 한다 ──────────────────────
     render() 는 #career-main 의 innerHTML 을 통째로 갈아 끼운다. 그러면 브라우저가
     스크롤 위치를 **0 으로 되돌린다**. 직업 카드를 누르면 화면이 맨 위로 튀어서
     방금 고른 카드도, 아래에 새로 열린 로드맵도 보이지 않았다 — 눌렀는데 아무 일도
     안 일어난 것처럼 보인다.

     그래서 다시 그리기 전 위치를 기억했다가 되돌린다. 다만 **분야를 통째로 바꾸는
     이동**(왼쪽 사이드바 · 01 단계로 되돌아가기)은 화면 내용이 전부 갈리므로
     맨 위가 맞다. 그때만 `toTop` 으로 부른다.

     여기 한 곳으로 모으는 이유: render() 에는 중간에 빠져나가는 갈래가 넷이라
     각자 innerHTML 을 쓰면 한두 곳을 빠뜨린다. */
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
        ${phaseBar()}
        ${majorHero(major)}
        ${middleSelect(major)}
        ${middle ? jobSelect(middle) : ''}
        ${job ? renderRoadmap(major, middle, job) : ''}
      </div>
    `, { toTop, anchor });
    animateBars();
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

  /* ── 이 화면 안의 작은 단계 ──────────────────────────────────
     위에 로드맵 전체 스텝바(Roadmap.stepBar)가 있으므로, 여기는 **1단계 안의
     세 칸**이라는 것이 보여야 한다. 예전 라벨은 'STEP 01 직무 찾기 / STEP 03
     내 로드맵' 이었는데, 바깥 스텝바가 생기면서 같은 말이 두 줄에서 서로 다른
     범위를 가리키게 됐다 — 바깥의 '직무 찾기'는 이 화면 전체이고 바깥의
     '커리어 로드맵'은 네 화면 전부다. 안쪽은 안쪽 일만 말하게 바꿨다. */
  function phaseBar() {
    return `
      <div class="phase-bar">
        <div class="phase-tab ${!currentMiddle ? 'active' : ''}" onclick="CareerPage.gotoPhase(1)">
          <div class="pt-num">01</div><div class="pt-label">세부 분야 고르기</div>
        </div>
        <div class="phase-tab ${currentMiddle && !currentJob ? 'active' : ''}" onclick="CareerPage.gotoPhase(2)">
          <div class="pt-num">02</div><div class="pt-label">직무 고르기</div>
        </div>
        <div class="phase-tab ${currentJob ? 'active' : ''}" onclick="CareerPage.gotoPhase(3)">
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
       정의가 없는 분류는 아래 연봉순 목록 그대로다 — 2차 분류 76개에 전부 묶음을
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

    const rows = g.jobs

      .map((def, i) => {

        const job = middle.jobs.find(

          (j) => JobGroups.norm(j.name) === JobGroups.norm(def.name),

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

  // ── STEP 03 · 커리어 로드맵 ───────────────────────────────
  function renderRoadmap(major, middle, job) {
    /* 스펙 레코드는 아직 학과(dept) 스키마다. 2차 분류에 얹힌 legacy 조건으로 집계한다.
       집계 범위는 좁은 것부터 넓은 순으로 시도한다:
         2차 분류+기업유형 → 2차 분류 전체 → 1차 분류 전체
       4분류로 쪼개면 표본이 크게 줄어 빈 유형이 흔하다. 그때 빈 화면을 주는 대신
       2차 분류 전체 통계로 물러서고, 무엇을 보고 있는지 scope 태그로 밝힌다.

       ── 집계 단위는 '직업'이 아니라 '2차 분류'다 ──
       직업 461개 단위로 선배 스펙을 나누면 표본이 한 자릿수로 쪼개져 평균이 의미를
       잃는다. 임금은 직업 단위로 보여주되, 스펙 통계는 2차 분류 단위로 낸다.
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

    /* ── 여기서 연봉을 다시 보여주지 않는다 (사용자 지시) ──
       직업 카드(STEP 02)에 이미 평균연봉이 붙어 있어서 고른 직후에 같은 숫자를
       크게 한 번 더 띄우면, 이 화면의 주제인 '선배 스펙'보다 연봉이 먼저 읽힌다.
       임금 정보의 출처·한계(전체 재직자 기준·신입 초봉 아님)는 직업 카드 쪽으로
       남겨 둔다. */
    const head = `
      ${jobSwitcher(middle, job)}
      ${corpTabBar(corpCounts)}
      <div class="section-title">${esc(middle.name)} 선배 스펙
        ${agg.empty ? '' : `<span class="scope-tag">${esc(scope)} · n = ${agg.count}명</span>`}
      </div>
      <div class="roadmap-grid">
        <div class="roadmap-card">
          <div class="roadmap-card-title">관련 전공</div>
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

    if (agg.empty) {
      return `<div class="roadmap-section">${head}${emptySpecBlock(middle)}${nextStepBlock(middle, job, agg)}</div>`;
    }

    return `
      <div class="roadmap-section">
        ${head}
        ${tabBar()}
        <div id="spec-quant" class="spec-tab-content ${specTab === 'quant' ? 'active' : ''}">${renderQuant(agg)}</div>
        <div id="spec-qual"  class="spec-tab-content ${specTab === 'qual' ? 'active' : ''}">${renderQual(agg)}</div>
        ${nextStepBlock(middle, job, agg)}
      </div>
    `;
  }

  /* ── 1단계의 결론 → 2단계로 ──────────────────────────────────
     위에서 본 정량·정성은 **선배들의 평균**이다. 학생이 다음에 알고 싶은 것은
     하나뿐이다 — "그래서 나는 지금 어디쯤인가". 그 질문을 화면에 그대로 적고
     누르면 CAS 로 넘긴다.

     선배 표본이 없으면(agg.empty) 비교 자체가 성립하지 않으므로 그렇게 적는다.
     '계산해 준다' 고 해 놓고 빈 화면을 주는 것이 이 프로젝트가 피해 온 실패다. */
  function nextStepBlock(middle, job, agg) {
    const comparable = !agg.empty && agg.count > 0;
    return `
      <div class="rm-next">
        <div class="rm-next-body">
          <div class="rm-next-eyebrow">커리어 로드맵 2단계</div>
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
      ${tabBar()}
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

  function tabBar() {
    return `
      <div class="spec-tab-bar">
        <div class="spec-tab ${specTab === 'quant' ? 'active' : ''}" onclick="CareerPage.switchTab('quant')">
          <div class="st-icon"><i class="ti ti-chart-bar"></i></div><div class="st-label">정량 스펙</div>
        </div>
        <div class="spec-tab ${specTab === 'qual' ? 'active' : ''}" onclick="CareerPage.switchTab('qual')">
          <div class="st-icon"><i class="ti ti-medal"></i></div><div class="st-label">정성 스펙</div>
        </div>
      </div>`;
  }

  // ── 정량 ─────────────────────────────────────────────────
  function renderQuant(agg) {
    return `
      <div class="spec-panel">
        <div class="spec-card">
          <div class="spec-card-header"><i class="ti ti-school"></i><div class="spec-card-title">학점 (GPA / 4.5 환산)</div></div>
          <div class="spec-card-body">
            ${
              agg.gpa
                ? `
              <div class="gpa-display"><span class="gpa-num">${agg.gpa.avg}</span><span class="gpa-max">/ 4.5</span></div>
              <div class="gpa-label">합격자 평균 학점 (n=${agg.gpa.n})</div>
              <div class="gpa-bar-bg"><div class="gpa-bar-fill" data-target="${((agg.gpa.avg / 4.5) * 100).toFixed(1)}%" style="width:0%"></div></div>
              <div class="gpa-range"><span>최저 ${agg.gpa.min}</span><span>최고 ${agg.gpa.max}</span></div>
            `
                : noDataInline('학점 데이터 없음')
            }
          </div>
        </div>

        <div class="spec-card">
          <div class="spec-card-header"><i class="ti ti-certificate"></i><div class="spec-card-title">자격증 보유율</div></div>
          <div class="spec-card-body">
            ${
              agg.certs.length
                ? `
              <div class="cert-list">
                ${agg.certs
                  .map(
                    (c, i) => `
                  <div class="cert-item" style="animation-delay:${i * 0.06}s">
                    <div class="cert-bar-wrap">
                      <div class="cert-name">${esc(c.name)} ${c.desc ? `<span class="cert-desc">— ${esc(c.desc)}</span>` : ''}</div>
                      <div class="cert-track"><div class="cert-fill" data-target="${c.pct}%" style="width:0%;background:#1a1814"></div></div>
                    </div>
                    <div class="cert-pct">${c.pct}%</div>
                  </div>`,
                  )
                  .join('')}
              </div>
            `
                : noDataInline('자격증 데이터 없음')
            }
          </div>
        </div>

        <div class="spec-card full">
          <div class="spec-card-header"><i class="ti ti-language"></i><div class="spec-card-title">어학 성적</div></div>
          <div class="spec-card-body">
            <div class="lang-list">
              ${langRow('TOEIC', agg.scores.toeic, '점')}
              ${langRow('TOEFL', agg.scores.toefl, '점')}
              ${langRow('TOEIC Speaking', agg.scores.toeicSpeaking, '레벨')}
              ${langRow('OPIc', agg.scores.opic, '레벨')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function langRow(name, data, unit) {
    if (!data) {
      return `
        <div class="lang-item lang-item--empty">
          <div class="lang-name">${name}</div>
          <div class="lang-score-wrap"><div class="lang-avg lang-avg--empty">데이터 없음</div></div>
        </div>`;
    }
    const avg = data.avg + (typeof data.avg === 'number' ? unit : '');
    const range =
      data.min != null
        ? `합격자 범위 ${data.min} ~ ${data.max}`
        : `n = ${data.n}명`;
    return `
      <div class="lang-item">
        <div class="lang-name">${name}</div>
        <div class="lang-score-wrap">
          <div class="lang-avg">${avg}</div>
          <div class="lang-range">${range}</div>
        </div>
        <span class="lang-badge opt">n=${data.n}</span>
      </div>`;
  }

  // ── 정성 ─────────────────────────────────────────────────
  /* 정성 스펙은 CAS 가중치가 큰 유형(인턴십 → 공모전·대외활동 → …)부터 보여준다.
     각 유형 옆의 '가중치' 칩은 CAS 정성 점수에서 그 활동이 갖는 비중(tier)을 뜻한다. */
  const QUAL_TIER = {
    1: { label: '최상', cls: 't1' },
    2: { label: '높음', cls: 't2' },
    3: { label: '중상', cls: 't3' },
    4: { label: '보통', cls: 't4' },
    5: { label: '보조', cls: 't5' },
  };
  function renderQual(agg) {
    const rows = [...agg.qual].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9));
    const benchNote = agg.qualBenchRaw
      ? `합격자 평균 정성 원점수 <b>${agg.qualBenchRaw}점</b> 기준 · 인턴십 &gt; 공모전·대외활동 순으로 가중`
      : `CAS 정성 점수는 인턴십 &gt; 공모전·대외활동 순으로 가중됩니다`;
    return `
      <div class="qual-grid">
        <div class="qual-card full">
          <div class="qual-card-header"><i class="ti ti-medal"></i><div class="qual-card-title">정성 스펙 보유율 — 합격자 기준</div></div>
          <div class="qual-weight-note">${benchNote}</div>
          <div class="qual-card-body">
            <div class="activity-list">
              ${rows
                .map((q) => {
                  const t = QUAL_TIER[q.tier] || QUAL_TIER[5];
                  return `
                <div class="activity-item">
                  <div class="activity-icon">${q.icon}</div>
                  <div class="activity-body">
                    <div class="activity-name">${esc(q.label)}
                      <span class="qual-tier ${t.cls}">가중치 ${t.label}</span>
                    </div>
                    <div class="activity-desc">${esc(q.help)}</div>
                  </div>
                  <div class="activity-right">
                    <div class="activity-pct">${q.pct}%</div>
                    <div class="activity-n">${q.n}명</div>
                  </div>
                </div>`;
                })
                .join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── helpers ───────────────────────────────────────────────
  function welcomeBlock() {
    const c = KECO.counts();
    return `
      <div class="welcome">
        <div class="welcome-icon">🗺️</div>
        <h2>관심 있는 직무를 골라 보세요</h2>
        <p>여기가 커리어 로드맵의 <b>첫 단계</b>예요. 직무를 고르면
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
  function animateBars() {
    requestAnimationFrame(() => {
      document.querySelectorAll('.gpa-bar-fill').forEach((el) =>
        setTimeout(() => {
          el.style.width = el.dataset.target;
        }, 100),
      );
      document.querySelectorAll('.cert-fill').forEach((el, i) =>
        setTimeout(
          () => {
            el.style.width = el.dataset.target;
          },
          150 + i * 60,
        ),
      );
    });
  }

  // ── 외부 인터페이스 ──────────────────────────────────────
  return {
    init,
    refreshUser,
    render,
    /* 2차 분류를 바꾸면 고른 직업은 그 분류에 없는 코드가 되므로 반드시 같이 비운다.
       안 비우면 breadcrumb 에 남의 갈래 직업 이름이 남는다. */
    /* 2차 분류를 고르면 아래 로드맵이 사라져 내용이 짧아진다 — 자리를 지키려 해도
       브라우저가 끌어올린다(paint 의 anchor 주석). 방금 열린 직업 목록으로 보낸다. */
    selectMiddle(code) {
      currentMiddle = code;
      currentJob = null;
      jobPage = 1;
      currentGroup = null;      // 분류가 바뀌면 남의 갈래 묶음이 열려 있으면 안 된다
      specTab = 'quant';
      render({ anchor: '.job-grid, .empty-block' });
    },
    /* 직업을 고르는 순간이 로드맵 1단계의 결론이다. 여기서 흐름 상태에 심어 두면
       CAS·회사 찾기·자소서 코치가 같은 직무를 본다(roadmap.js 머리주석). */
    selectJob(code) {
      currentJob = code;
      specTab = 'quant';
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
      render();
    },
    /* 묶음 칩. 같은 칩을 다시 누르면 전체로 돌아간다 — 좁힌 것을 푸는 길이
       칩 줄 안에 있어야 '전체' 를 찾아 헤매지 않는다. */
    selectGroup(id) {
      currentGroup = currentGroup === id ? null : id;
      render({ anchor: '.jg-chips, .job-grid' });
    },
    /* 로드맵에서 직업 목록으로 되돌아간다. 묶음은 그대로 둔다 — 방금 보던 갈래를
       다시 찾게 하면 고른 이유를 잃는다. */
    backToJobs() {
      currentJob = null;
      render({ anchor: '.jg-chips, .job-grid' });
    },
    goToCas() { navigate('dashboard'); },
    goJobPage(n) {
      jobPage = Math.max(1, n);
      render({ anchor: '.job-grid' });
    },
    /* 01 로 되돌아가는 것은 '처음부터 다시' 라서 맨 위로 올린다.
       02·03 은 지금 보던 목록 위에서 범위만 좁히는 이동이라 자리를 지킨다. */
    gotoPhase(n) {
      if (n === 1) {
        currentMiddle = null;
        currentJob = null;
      }
      if (n === 2) {
        currentJob = null;
      }
      if (n === 1) currentGroup = null;
      render({ toTop: n === 1 });
    },
    switchTab(t) {
      specTab = t;
      render();
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
