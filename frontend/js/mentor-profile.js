// ════════════════════════════════════════════════════════════
//  C:road — 멘토 프로필 (#mentor-profile)
//
//  멘토가 '후배에게 보여줄 소개'를 쓰는 화면. 스펙 입력(#mypage)과 나눈 이유는
//  성격이 다르기 때문이다 — 스펙은 채점되는 데이터고, 이건 사람이 읽는 글이다.
//
//  저장 위치는 profiles 테이블이다(user_specs 가 아니다). 통계에 들어가지 않는
//  값이라 스펙 집계·CAS 점수와 무관하다.
//
//  ── 입력 항목은 멘토 상세 화면이 실제로 그리는 것에 맞춘다 ──
//  mentoring.js 의 openProfile() 이 소개글·전문분야·타임라인·멘토링 형식을 쓴다.
//  거기서 안 쓰는 값을 받으면 적어도 보이지 않고, 반대면 빈 자리가 남는다.
// ════════════════════════════════════════════════════════════
window.MentorProfile = (() => {

  /* 멘토링 형식은 mentoring.js 의 FORMATS 와 같은 id 를 쓴다.
     여기서 새로 만들면 두 곳이 갈려 '고른 형식이 신청 화면에 없는' 일이 생긴다. */
  const MODES = [
    { id: 'video30',  label: '화상 30분' },
    { id: 'onsite60', label: '대면 60분' },
    { id: 'text',     label: '텍스트' },
  ];

  const INTRO_MAX = 500;

  /* 예약 가능 시간대 — 하루 전체(00:00~23:00)를 1시간 단위로 연다.
     새벽·심야를 막아 둘 이유가 없다(해외 거주 멘토, 교대 근무 등).
     30분 단위로 쪼개면 칸이 48개가 되어 고르기 힘들고, 실제 멘토링이
     30~60분이라 1시간 단위면 충분하다. */
  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
  /* ── 얼마나 앞까지 여나 (사용자 지시 2026-09-10) ────────────────────────────
     3개월이었다. "더 멀면 약속을 못 지킨다"는 이유였는데, 그러면 **해를 넘길 수가 없다** —
     9월에는 12월까지가 끝이라 내년 1월 일정을 아예 못 연다. 학생이 상담을 잡는 시기가
     하반기에 몰리는 것을 생각하면 연말에 막히는 쪽이 더 손해다. 6개월로 늘린다.
     달력·목록은 해가 바뀌면 연도를 같이 적는다(안 적으면 올해 1월인지 내년 1월인지 모른다).
     서버는 날짜 범위를 막지 않는다 — 형식과 200개 상한만 본다(server.js). */
  const MONTHS_AHEAD = 6;
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  let tlState = [];       // 타임라인 편집 상태 [{t, d, s}]
  let specState = [];     // 전문 분야 칩
  let mfState = [];       // 멘토링 가능 분야 (KECO 1차 코드 배열) — 멘티가 이걸로 멘토를 고른다
  let mfMajors = [];      // KECO 1차 분류 목록 (칩으로 그린다)
  let availState = new Map();   // 'YYYY-MM-DD' → Set(시간)
  let calCursor = null;         // 달력이 보고 있는 달 (매월 1일)
  /* ── 날짜를 여러 개 잡는다 (사용자 지시 2026-09-05) ────────────────────────────
     예전에는 `pickedDate` 하나였다. 그런데 멘토가 실제로 하는 일은 "이번 달 평일
     저녁을 다 연다" 처럼 **같은 시간대를 여러 날에 반복해 여는 것**인데, 날짜를 하나씩
     골라 시간을 매번 다시 찍어야 했다. 10일이면 같은 일을 10번 한다.
     이제 날짜를 여러 개 잡고 시간을 한 번만 찍으면 고른 날 전부에 적용된다.
     마지막으로 누른 날짜(anchor)는 Shift 로 범위를 잡을 때의 시작점이다. */
  let pickedDates = new Set();  // 시간대를 고르는 중인 날짜들 'YYYY-MM-DD'
  let anchorDate = null;        // Shift 범위 선택의 기준점 (날짜·시간 각각)
  let anchorTime = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 진입점 ──────────────────────────────────────────────────
  async function render(container, user) {
    /* 멘티에게는 뜻이 없는 화면이다. app.js 가 이미 되돌리지만, 여기서도
       한 번 막는다 — 라우터만 믿으면 새 진입 경로가 생겼을 때 새어 들어온다. */
    if (user?.role !== 'mentor') {
      container.innerHTML = `<div class="not-logged-in">
        <p>멘토 회원만 이용할 수 있는 화면이에요.</p>
        <span class="btn-go-login" onclick="selectMypageTab('spec')">스펙 관리로</span>
      </div>`;
      return;
    }

    container.innerHTML = `<div class="sf-hint-inline">불러오는 중…</div>`;
    const p = (await DB.getProfile()) || {};

    tlState = Array.isArray(p.timeline) && p.timeline.length ? p.timeline.map(t => ({ ...t })) : [{}];
    specState = Array.isArray(p.specialties) ? [...p.specialties] : [];
    const modes = Array.isArray(p.modes) ? p.modes : [];

    /* 멘토링 가능 분야 — 멘티가 멘토를 고를 때 쓰는 KECO 1차 분류다(직무찾기와 같은 트리).
       트리는 KECO.load() 가 /api/jobs 에서 받아 둔다. 못 받아도 프로필 저장 자체는
       되어야 하므로(분야는 선택 항목) 실패하면 칩을 안 그리고 넘어간다. */
    mfState = Array.isArray(p.mentorFields) ? [...p.mentorFields] : [];
    mfMajors = [];
    try {
      if (window.KECO) { await KECO.load(); mfMajors = KECO.MAJORS() || []; }
    } catch { mfMajors = []; }

    /* 지난 날짜는 화면에 올리지 않는다. 저장돼 있어도 이제 신청받을 수 없는 날이라
       그대로 두면 '왜 안 지워지지' 가 된다. 저장할 때 함께 정리된다. */
    availState = new Map();
    (Array.isArray(p.availability) ? p.availability : [])
      .filter(s => s?.date >= todayStr())
      .forEach(s => availState.set(s.date, new Set(s.times || [])));
    calCursor = firstOfMonth(new Date());
    pickedDates = new Set();
    anchorDate = anchorTime = null;

    container.innerHTML = `
      <div class="sf-head">
        <h1>멘토 페이지</h1>
        <p class="sf-sub">후배가 멘토 상세 화면에서 보게 될 내용이에요. 스펙과는 별개로 저장됩니다.</p>
      </div>

      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-tags"></i>전문 분야</div>
        <div class="form-group">
          <div class="sf-chip-input">
            <input type="text" id="mp-spec-input" placeholder="예: 백엔드, 이직, 포트폴리오 — 입력 후 Enter" />
            <button type="button" class="btn-inline" id="mp-spec-add">추가</button>
          </div>
          <div class="sf-chips" id="mp-spec-list"></div>
          <span class="field-hint">멘토 카드와 상세 화면에 태그로 보여요. 최대 8개.</span>
        </div>
      </div>

      <!-- 멘토링 가능 분야 — 멘토가 정하고, 멘티는 멘토 찾기에서 이 분야로 멘토를 고른다.
           전문분야(자유 태그)와 다르다: 이건 직무찾기와 같은 KECO 1차 분류다. -->
      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-briefcase"></i>멘토링 가능 분야</div>
        <p class="sf-sub">후배가 '멘토 찾기'에서 분야로 멘토를 좁힐 때 쓰는 값이에요. 상담해 줄 수 있는 분야를 골라주세요.</p>
        <div class="form-group">
          <div class="sf-chip-pick" id="mp-fields">
            ${mfMajors.length
              ? mfMajors.map(M => `
                <button type="button" class="chip${mfState.includes(M.code) ? ' on' : ''}"
                        data-field="${esc(M.code)}" aria-pressed="${mfState.includes(M.code)}">
                  ${esc(M.name)}
                </button>`).join('')
              : `<span class="sf-hint-inline">분야 목록을 불러오지 못했어요. 저장은 가능하고, 분야는 나중에 정해도 돼요.</span>`}
          </div>
          <span class="field-hint">고르지 않으면 후배가 분야로 좁힐 때 목록에 안 떠요. 여러 개 선택 가능.</span>
        </div>
      </div>

      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-timeline"></i>경력 타임라인</div>
        <div id="mp-tl-list"></div>
        <button type="button" class="sf-act-add" id="mp-tl-add"><i class="ti ti-plus"></i> 경력 추가</button>
      </div>

      <!-- 소개글은 경력 타임라인 **아래**에 둔다. 후배가 읽는 순서가 그렇다 —
           어떤 경력인지 먼저 보고, 그 사람이 하는 말을 읽는다. -->
      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-message-2"></i>소개글</div>
        <div class="form-group">
          <textarea id="mp-intro" rows="6" maxlength="${INTRO_MAX}"
            placeholder="어떤 일을 해왔고, 어떤 이야기를 나눌 수 있는지 적어주세요.&#10;위 경력에서 다 담지 못한 것을 적으면 좋아요."
          >${esc(p.intro || '')}</textarea>
          <span class="field-hint"><span id="mp-intro-count">0</span> / ${INTRO_MAX}자</span>
        </div>
      </div>

      <!-- 예약 가능 일정 — 멘토가 직접 날짜와 시간을 연다.
           요일 반복이 아니라 날짜를 콕 집는 방식이다(profiles.availability 주석 참고). -->
      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-calendar-event"></i>멘토링 가능 일정</div>
        <p class="sf-sub">날짜를 고르고 가능한 시간을 선택하세요. <b>여러 날·여러 시간을 한 번에</b>
          고를 수 있어요(Shift 로 범위 선택). 후배는 여기서 연 시간에만 신청할 수 있어요.</p>
        <div class="mp-sched">
          <div class="mp-cal" id="mp-cal"></div>
          <div class="mp-times" id="mp-times"></div>
        </div>
        <div class="mp-avail-summary" id="mp-avail-summary"></div>
      </div>

      <div class="sf-section">
        <div class="sf-section-title"><i class="ti ti-calendar-check"></i>멘토링 가능 형식</div>
        <!-- 체크박스를 쓰지 않는다 — 칩 자체가 눌린 상태를 색으로 보여주므로
             네모칸이 하나 더 붙으면 같은 말을 두 번 하는 셈이다.
             선택 상태는 aria-pressed 로 알린다(스크린리더는 색을 못 읽는다). -->
        <div class="sf-chip-pick" id="mp-modes">
          ${MODES.map(m => `
            <button type="button" class="chip${modes.includes(m.id) ? ' on' : ''}"
                    data-mode="${m.id}" aria-pressed="${modes.includes(m.id)}">
              ${m.label}
            </button>`).join('')}
        </div>
        <span class="field-hint">고르지 않으면 후배가 신청할 때 모든 형식이 보여요.</span>
      </div>

      <div class="success-box" id="mp-success">멘토 프로필을 저장했어요.</div>
      <div class="error-box"   id="mp-error"></div>

      <button class="btn-save"   id="mp-save">저장하기</button>
      <button class="btn-cancel" id="mp-cancel">취소</button>
    `;

    paintSpecs();
    paintTimeline();
    paintSchedule();
    bind(user);
    syncIntroCount();
  }

  // ── 날짜 도우미 ─────────────────────────────────────────────
  /* toISOString() 을 쓰면 안 된다 — UTC 로 바꾸면서 한국 시간 오전 9시 이전이
     전날로 밀린다. 로컬 기준으로 직접 만든다. */
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = () => ymd(new Date());
  const firstOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

  /* 열 수 있는 마지막 달. 이 달 + MONTHS_AHEAD 까지. */
  function lastMonth() {
    return addMonths(firstOfMonth(new Date()), MONTHS_AHEAD);
  }

  /* 지금 달력에서 고를 수 있는 날짜(오늘 이후)를 순서대로. Shift 범위가 이 목록을 쓴다 —
     달력에 안 보이는 날이 범위에 섞이면 선택 목록에만 남고 화면에는 안 나온다. */
  function calendarDates() {
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const today = todayStr();
    const out = [];
    for (let d = 1; d <= days; d++) {
      const date = ymd(new Date(y, m, d));
      if (date >= today) out.push(date);
    }
    return out;
  }

  // ── 달력 ────────────────────────────────────────────────────
  function paintCalendar() {
    const host = document.getElementById('mp-cal');
    if (!host) return;

    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayStr();
    const minMonth = firstOfMonth(new Date()), maxMonth = lastMonth();

    const cells = [];
    // 1일이 무슨 요일인지에 맞춰 앞을 비운다
    for (let i = 0; i < first.getDay(); i++) cells.push('<span class="mp-cal-pad"></span>');

    for (let d = 1; d <= daysInMonth; d++) {
      const date = ymd(new Date(y, m, d));
      const past = date < today;               // 지난 날짜는 열 수 없다
      const n = availState.get(date)?.size || 0;
      const cls = ['mp-cal-day'];
      if (past) cls.push('past');
      if (n) cls.push('has');
      if (pickedDates.has(date)) cls.push('on');
      /* 몇 시간 열었는지는 점 하나로만 알린다. 숫자를 겹쳐 쓰면 날짜와 섞여 읽힌다 —
         정확한 개수는 아래 '열어 둔 일정' 목록에서 본다.
         title 로는 남겨서 마우스를 올리면 알 수 있게 한다. */
      cells.push(`<button type="button" class="${cls.join(' ')}" data-date="${date}"
        ${past ? 'disabled' : ''}${n ? ` title="${n}개 시간 열림"` : ''}>${d}${n ? '<i class="mp-cal-dot"></i>' : ''}</button>`);
    }

    host.innerHTML = `
      <div class="mp-cal-head">
        <button type="button" class="mp-cal-nav" id="mp-cal-prev"
          ${calCursor <= minMonth ? 'disabled' : ''} aria-label="이전 달"><i class="ti ti-chevron-left"></i></button>
        <span class="mp-cal-title">${y}년 <b>${m + 1}월</b></span>
        <button type="button" class="mp-cal-nav" id="mp-cal-next"
          ${calCursor >= maxMonth ? 'disabled' : ''} aria-label="다음 달"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="mp-cal-grid">
        ${WEEKDAYS.map((w, i) => `<span class="mp-cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</span>`).join('')}
        ${cells.join('')}
      </div>`;
  }

  /* 표기는 24시간(00:00~23:00) 그대로다.
     예전에는 오전·오후로 나누고 12시간으로 보여줬는데, 그러면 목록에
     '10:00 · 11:00 · 8:00' 처럼 작은 수가 뒤에 오는 줄이 생겨 오전인지
     오후인지 매번 되짚어야 했다. 저장값과 화면이 같은 표기라 헷갈릴 일이 없다. */

  /* 오른쪽 시간 목록. 날짜를 고르기 전에는 안내만 띄운다. */
  function paintTimes() {
    const host = document.getElementById('mp-times');
    if (!host) return;

    if (!pickedDates.size) {
      host.innerHTML = `<div class="mp-times-empty">
        <i class="ti ti-calendar-plus"></i>
        <span>왼쪽 달력에서 날짜를 골라주세요. 여러 날을 함께 고를 수 있어요.</span>
      </div>`;
      return;
    }

    const dates = [...pickedDates].sort();
    /* 고른 날이 여럿이면 시간 칸은 세 상태다 — 전부 열림(on) · 일부만 열림(some) · 안 열림.
       'some' 을 'on' 으로 뭉개면 한 번 눌렀을 때 열리는지 닫히는지 알 수 없다. */
    const countOf = t => dates.filter(d => availState.get(d)?.has(t)).length;
    const label = dates.length === 1
      ? (() => { const d = new Date(dates[0]);
          return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; })()
      : `${dates.length}일 선택됨`;
    const openTotal = dates.reduce((n, d) => n + (availState.get(d)?.size || 0), 0);

    host.innerHTML = `
      <div class="mp-times-head">
        <b>${esc(label)}</b>
        <span class="mp-times-sep">|</span>
        <span class="mp-times-sub">${openTotal ? `시간 ${openTotal}칸 열림` : '시간을 선택해주세요'}</span>
        <button type="button" class="sf-link-btn" id="mp-times-clear"
          ${openTotal ? '' : 'hidden'}>전부 해제</button>
      </div>
      ${dates.length > 1
        ? `<p class="mp-times-note">고른 <b>${dates.length}일 전부</b>에 함께 적용돼요.</p>` : ''}
      <div class="mp-time-grid">
        ${HOURS.map(t => {
          const n = countOf(t);
          const cls = n === 0 ? '' : (n === dates.length ? ' on' : ' some');
          return `<button type="button" class="mp-time${cls}" data-time="${t}"
            ${n && n < dates.length ? `title="${n}/${dates.length}일 열림"` : ''}>${t}</button>`;
        }).join('')}
      </div>
      <p class="mp-times-tip">Shift 를 누른 채 누르면 범위로 한 번에 고를 수 있어요.</p>`;
  }

  /* 시간 하나를 고른 날짜 **전부**에 적용한다. 하나라도 안 열린 날이 있으면 전부 열고,
     전부 열려 있으면 전부 닫는다 — 부분 상태에서 한 번 눌렀을 때 '맞추는' 쪽이
     기대에 가깝다(체크박스 트리의 관행과 같다). */
  function applyTimes(times, dates = [...pickedDates]) {
    if (!dates.length || !times.length) return;
    const allOn = times.every(t => dates.every(d => availState.get(d)?.has(t)));
    for (const d of dates) {
      const set = availState.get(d) || new Set();
      for (const t of times) { if (allOn) set.delete(t); else set.add(t); }
      /* 시간이 하나도 안 남으면 날짜 자체를 지운다 — 빈 날짜가 남으면
         달력에 표시만 되고 신청은 못 하는 날이 된다(서버도 같은 규칙). */
      if (set.size) availState.set(d, set); else availState.delete(d);
    }
  }

  /* 두 값 사이(양끝 포함)를 목록 순서대로 잘라 준다 — Shift 범위 선택이 쓴다. */
  function rangeOf(list, a, b) {
    const i = list.indexOf(a), j = list.indexOf(b);
    if (i < 0 || j < 0) return [b].filter(Boolean);
    return list.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  /* 아래 요약 — 어느 날 몇 시간을 열어뒀는지 한눈에. 달력만으로는
     '이번 달 말고 다음 달에 뭘 열었더라' 를 알 수 없다. */
  function paintSummary() {
    const host = document.getElementById('mp-avail-summary');
    if (!host) return;
    const list = [...availState.entries()]
      .filter(([, ts]) => ts.size)
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (!list.length) {
      host.innerHTML = `<div class="sf-hint-inline">아직 연 일정이 없어요. 날짜를 골라 시간을 선택해 주세요.</div>`;
      return;
    }
    /* ── 쭉 늘어놓지 않는다 (사용자 지적 2026-09-10) ─────────────────────────
       한 줄에 하루씩 그리다 보니 39일을 열면 39줄이 됐고, 화면을 한참 굴려야
       아래 칸이 나왔다. 게다가 줄마다 '18:00 · 19:00 · 20:00 · 21:00' 이 반복돼
       **다른 정보가 없는데 자리만 넓게 먹었다.**
       두 가지로 줄인다:
         · 달로 묶는다 — 39일이 3~4덩이가 된다. 달마다 통째로 지우는 길도 생긴다
         · 이어지는 시간은 구간으로 압축한다 (18:00·19:00·20:00·21:00 → 18:00~21:00)
       그래서 하루가 한 줄이 아니라 **칩 하나**가 되고, 여러 개가 한 줄에 들어간다. */
    const total = list.reduce((n, [, ts]) => n + ts.size, 0);
    const thisYear = new Date().getFullYear();

    const months = new Map();
    for (const row of list) {
      const key = row[0].slice(0, 7);            // YYYY-MM
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(row);
    }

    host.innerHTML = `
      <div class="mp-avail-title">열어 둔 일정 <b>${list.length}일</b>
        <span class="mp-avail-sub">· 시간 ${total}개 · 시작 시간 기준</span></div>
      ${[...months.entries()].map(([key, rows]) => {
        const [my, mm] = key.split('-').map(Number);
        /* 해가 바뀌면 연도를 적는다. '1월' 만 적으면 올해 1월인지 내년 1월인지
           알 수 없다 — 일정은 연말에 다음 해로 넘어간다(사용자 지시 2026-09-10). */
        const label = my === thisYear ? `${mm}월` : `${my}년 ${mm}월`;
        return `<div class="mp-avail-month">
          <div class="mp-avail-mhead">
            <span class="mp-avail-mname">${label}</span>
            <span class="mp-avail-mcount">${rows.length}일</span>
            <button type="button" class="mp-avail-mclear" data-avail-month="${key}">이 달 비우기</button>
          </div>
          <div class="mp-avail-grid">
            ${rows.map(([date, ts]) => {
              const d = new Date(date);
              const all = [...ts].sort();
              return `<span class="mp-avail-chip" title="${all.join(', ')}">
                <b>${d.getMonth() + 1}/${d.getDate()}</b>
                <i class="mp-avail-wd">${WEEKDAYS[d.getDay()]}</i>
                <span class="mp-avail-time">${timeRanges(all)}</span>
                <button type="button" class="sf-chip-x" data-avail-remove="${date}" aria-label="삭제">
                  <i class="ti ti-x"></i>
                </button>
              </span>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}`;
  }

  /* 이어지는 정시(00분)를 구간으로 묶는다. 18·19·20·21 → '18:00~21:00'.
     ── 끝 시각을 22:00 으로 적지 않는다 ──
     여기 값은 전부 **시작 시간**이다. 21시 칸을 열었다고 22시에 끝난다고 단정할 수
     없고(모드마다 길이가 다르다), 22:00 으로 적으면 22시 칸도 연 것으로 읽힌다.
     그래서 마지막 시작 시간을 그대로 쓰고, 제목줄에 '시작 시간 기준' 을 밝힌다.
     정시가 아닌 값(:30 등)은 묶지 않고 그대로 둔다 — 서버는 허용하는 형식이다. */
  function timeRanges(times) {
    const out = [];
    let start = null, prevH = null;
    const flush = () => {
      if (start == null) return;
      out.push(start === hhmm(prevH) ? start : `${start}~${hhmm(prevH)}`);
      start = null; prevH = null;
    };
    for (const t of times) {
      const h = /^(\d{2}):00$/.test(t) ? Number(t.slice(0, 2)) : null;
      if (h == null) { flush(); out.push(t); continue; }
      if (start != null && h === prevH + 1) { prevH = h; continue; }
      flush();
      start = t; prevH = h;
    }
    flush();
    return out.join(', ');
  }
  const hhmm = h => `${String(h).padStart(2, '0')}:00`;

  function paintSchedule() { paintCalendar(); paintTimes(); paintSummary(); }

  // ── 전문 분야 칩 ────────────────────────────────────────────
  function paintSpecs() {
    const host = document.getElementById('mp-spec-list');
    if (!host) return;
    host.innerHTML = specState.length
      ? specState.map((s, i) => `
        <span class="sf-chip">${esc(s)}
          <button type="button" class="sf-chip-x" data-spec-remove="${i}" aria-label="삭제">
            <i class="ti ti-x"></i>
          </button>
        </span>`).join('')
      : `<span class="sf-hint-inline">아직 없어요.</span>`;
  }

  function addSpec() {
    const input = document.getElementById('mp-spec-input');
    const v = input.value.trim();
    if (!v) return;
    if (specState.length >= 8) { showErr('전문 분야는 8개까지 넣을 수 있어요.'); return; }
    if (specState.includes(v)) { input.value = ''; return; }   // 같은 걸 두 번 넣지 않는다
    specState.push(v);
    input.value = '';
    paintSpecs();
  }

  // ── 경력 타임라인 ───────────────────────────────────────────
  function paintTimeline() {
    const host = document.getElementById('mp-tl-list');
    if (!host) return;
    host.innerHTML = tlState.map((t, i) => `
      <div class="mp-tl-row">
        <div class="mp-tl-grid">
          <input type="text" data-tl="${i}" data-tl-f="t" value="${esc(t.t || '')}"
                 placeholder="직함·회사 (예: 카카오 백엔드 개발자)" />
          <input type="text" data-tl="${i}" data-tl-f="d" value="${esc(t.d || '')}"
                 placeholder="기간 (예: 2022.03 ~ 재직중)" />
          <button type="button" class="sf-act-remove" data-tl-remove="${i}" title="삭제">
            <i class="ti ti-x"></i>
          </button>
        </div>
        <input type="text" data-tl="${i}" data-tl-f="s" value="${esc(t.s || '')}"
               placeholder="한 일 (쉼표로 나누면 줄바꿈돼요)" />
      </div>`).join('');
  }

  // ── 이벤트 ──────────────────────────────────────────────────
  function bind(user) {
    document.getElementById('mp-intro').addEventListener('input', syncIntroCount);

    document.getElementById('mp-spec-add').addEventListener('click', addSpec);
    document.getElementById('mp-spec-input').addEventListener('keydown', e => {
      /* Enter 로 추가한다. 폼이 아니라 submit 은 없지만, 습관대로 눌렀을 때
         아무 일도 안 일어나면 입력이 사라진 줄 안다. */
      if (e.key === 'Enter') { e.preventDefault(); addSpec(); }
    });
    document.getElementById('mp-spec-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-spec-remove]');
      if (!btn) return;
      specState.splice(+btn.dataset.specRemove, 1);
      paintSpecs();
    });

    const tlHost = document.getElementById('mp-tl-list');
    /* 값은 즉시 상태에 넣는다 — 줄을 지우거나 더해서 다시 그려도 살아남게. */
    tlHost.addEventListener('input', e => {
      const i = e.target.dataset.tl;
      if (i == null) return;
      tlState[+i][e.target.dataset.tlF] = e.target.value;
    });
    tlHost.addEventListener('click', e => {
      const btn = e.target.closest('[data-tl-remove]');
      if (!btn) return;
      tlState.splice(+btn.dataset.tlRemove, 1);
      if (!tlState.length) tlState.push({});      // 한 줄은 남긴다 — 빈 화면이 되지 않게
      paintTimeline();
    });
    document.getElementById('mp-tl-add').addEventListener('click', () => {
      tlState.push({});
      paintTimeline();
      tlHost.querySelector(`[data-tl="${tlState.length - 1}"]`)?.focus();
    });

    /* ── 일정 ──
       달력·시간표는 누를 때마다 다시 그려지므로 개별 버튼이 아니라
       바깥 상자에 한 번만 위임한다. */
    const sched = document.getElementById('mp-cal').parentElement;
    sched.addEventListener('click', e => {
      if (e.target.closest('#mp-cal-prev')) {
        calCursor = addMonths(calCursor, -1); paintCalendar(); return;
      }
      if (e.target.closest('#mp-cal-next')) {
        calCursor = addMonths(calCursor, 1); paintCalendar(); return;
      }

      const day = e.target.closest('[data-date]');
      if (day && !day.disabled) {
        const date = day.dataset.date;
        /* Shift 는 기준점부터 여기까지를 한 번에 잡는다. 지난 날짜는 고를 수 없으므로
           범위 안에서도 걸러 낸다 — 안 그러면 달력에 없는 날이 선택 목록에 남는다. */
        if (e.shiftKey && anchorDate) {
          const all = calendarDates();
          for (const d of rangeOf(all, anchorDate, date)) pickedDates.add(d);
        } else if (pickedDates.has(date)) {
          /* 같은 날을 다시 누르면 선택에서 뺀다 — 시간표를 치우는 방법이 따로 없으면 답답하다. */
          pickedDates.delete(date);
        } else {
          pickedDates.add(date);
        }
        anchorDate = date;
        paintCalendar(); paintTimes();
        return;
      }

      const time = e.target.closest('[data-time]');
      if (time && pickedDates.size) {
        const t = time.dataset.time;
        applyTimes(e.shiftKey && anchorTime ? rangeOf(HOURS, anchorTime, t) : [t]);
        anchorTime = t;
        paintSchedule();
        return;
      }

      if (e.target.closest('#mp-times-clear') && pickedDates.size) {
        for (const d of pickedDates) availState.delete(d);
        paintSchedule();
      }
    });

    document.getElementById('mp-avail-summary').addEventListener('click', e => {
      /* 달 통째로 비우기 — 39일을 하나씩 지우게 두지 않는다(사용자 지적 2026-09-10).
         되돌릴 수 없으므로 몇 일이 지워지는지 세어서 묻는다. */
      const mbtn = e.target.closest('[data-avail-month]');
      if (mbtn) {
        const key = mbtn.dataset.availMonth;
        const hit = [...availState.keys()].filter(d => d.startsWith(key));
        const [my, mm] = key.split('-').map(Number);
        if (!hit.length) return;
        if (!confirm(`${my}년 ${mm}월에 열어 둔 ${hit.length}일을 모두 비울까요?`)) return;
        for (const d of hit) {
          availState.delete(d);
          pickedDates.delete(d);
          if (anchorDate === d) anchorDate = null;
        }
        paintSchedule();
        return;
      }

      const btn = e.target.closest('[data-avail-remove]');
      if (!btn) return;
      const date = btn.dataset.availRemove;
      availState.delete(date);
      pickedDates.delete(date);
      if (anchorDate === date) anchorDate = null;
      paintSchedule();
    });

    /* 형식 칩 — 체크박스가 아니라 버튼이라 눌린 상태를 직접 뒤집는다. */
    document.getElementById('mp-modes').addEventListener('click', e => {
      const chip = e.target.closest('[data-mode]');
      if (!chip) return;
      const on = chip.classList.toggle('on');
      chip.setAttribute('aria-pressed', String(on));
    });

    /* 멘토링 가능 분야 칩 — 상태(mfState)를 직접 뒤집는다. 여러 개 고를 수 있다. */
    const fieldsHost = document.getElementById('mp-fields');
    if (fieldsHost) fieldsHost.addEventListener('click', e => {
      const chip = e.target.closest('[data-field]');
      if (!chip) return;
      const code = chip.dataset.field;
      if (mfState.includes(code)) mfState = mfState.filter(c => c !== code);
      else mfState.push(code);
      const on = mfState.includes(code);
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
    });

    document.getElementById('mp-save').addEventListener('click', () => save(user));
    document.getElementById('mp-cancel').addEventListener('click', () => selectMypageTab('account'));
  }

  function syncIntroCount() {
    const el = document.getElementById('mp-intro');
    const out = document.getElementById('mp-intro-count');
    if (el && out) out.textContent = el.value.length;
  }

  function showErr(msg) {
    const el = document.getElementById('mp-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('mp-success').style.display = 'none';
  }

  // ── 저장 ────────────────────────────────────────────────────
  async function save(user) {
    const ok = document.getElementById('mp-success');
    const err = document.getElementById('mp-error');
    ok.style.display = err.style.display = 'none';

    const intro = document.getElementById('mp-intro').value.trim();

    /* 제목이 없는 줄은 버린다. 기간·내용만 있는 타임라인은 화면에서 빈 점으로만
       보여서 고장처럼 읽힌다. */
    const timeline = tlState
      .map(t => ({
        t: String(t.t || '').trim(),
        d: String(t.d || '').trim(),
        s: String(t.s || '').trim(),
      }))
      .filter(t => t.t);

    const modes = [...document.querySelectorAll('#mp-modes .chip.on[data-mode]')]
      .map(el => el.dataset.mode);

    const btn = document.getElementById('mp-save');
    btn.disabled = true;
    try {
      /* 지난 날짜는 보내지 않는다. 오래 열어 둔 화면에서 저장하면 어제 날짜가
         다시 올라갈 수 있는데, 그러면 서버는 받아들이고 화면은 안 보여줘서
         '저장했는데 없어졌다'가 된다. */
      const today = todayStr();
      const availability = [...availState.entries()]
        .filter(([date, ts]) => ts.size && date >= today)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, ts]) => ({ date, times: [...ts].sort() }));

      await DB.updateProfile({
        intro: intro || null,
        specialties: [...specState],
        timeline,
        modes,
        availability,
        mentorFields: [...mfState],
      });
      /* 멘토 찾기 목록은 이제 서버가 원본이고 한 번 받으면 캐시된다.
         방금 채운 프로필이 그 화면에 바로 보이려면 캐시를 버려야 한다 —
         안 그러면 "저장했는데 멘토 찾기에 안 뜬다" 가 그대로 재현된다. */
      if (typeof invalidateMentors === 'function') invalidateMentors();
      ok.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showErr('저장에 실패했어요. ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  return { render };
})();
