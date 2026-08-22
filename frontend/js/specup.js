// ════════════════════════════════════════════════════════════
//  C:road — 스펙업 (#specup) · 로드맵 2단계에서 갈라지는 곁가지
//
//  ── 왜 '스펙 입력' 과 다른 화면인가 ──
//  CAS 2단계의 '스펙 채우기' 버튼은 지금까지 마이페이지 **스펙 입력 폼**으로 갔다.
//  그런데 거기는 *이미 한 것을 적는* 곳이다. 부족한 항목을 보고 넘어온 학생에게
//  빈 입력 폼을 주면 "없는 걸 어디서 채우라는 거지" 로 끝난다.
//  이 화면은 그 자리를 대신해 **지금 실제로 신청할 수 있는 것**을 보여준다.
//
//  ── 무엇을 보여줄지 정하는 근거 (사용자 지시: 선배·직무 기준) ──
//    ① 부족한 것 우선 — CAS GAP 판정 그대로 (mentoring.js window.Gap)
//       "선배 보유율 40% 이상인데 내게 없는 것". 우리가 중요하다고 정한 게 아니라
//       **같은 직무로 간 선배들이 실제로 갖고 있는 것**이다.
//    ② 부족한 게 없으면 — 그 직무군 선배 보유율 상위 항목을 그대로 보여준다.
//       빈 화면 대신 "선배들이 많이 한 것" 이 남아야 다음에 할 일이 보인다.
//    ③ 거기에 '지금 접수 중' 을 덧붙인다 — 국가자격 시험일정 · 공모전 모집공고.
//
//  ── 판정 기준을 새로 만들지 않는다 ──
//  '부족' 의 정의는 mentoring.js 가 단일 출처고(window.Gap), 비교 모집단은
//  cas-hero.js 가 정한다(CASHero.resolveContext). 여기서 따로 계산하면 CAS 에서
//  3개라던 것이 여기서 5개가 되는 식으로 갈린다.
//
//  ── 외부 데이터가 없어도 화면은 살아 있다 ──
//  시험일정·공모전 API 는 각각 활용신청/키 발급이 필요하다(backend/src/specup.js).
//  둘 다 막혀 있어도 ①②는 우리 DB 로 나오고, ③ 자리에는 "무엇을 하면 열리는지"가
//  뜬다. 빈 칸을 남기면 고장으로 읽힌다.
// ════════════════════════════════════════════════════════════
window.SpecUp = (() => {

  const TABS = [
    { id: 'cert',     label: '자격증',           icon: 'ti-certificate' },
    { id: 'lang',     label: '어학',             icon: 'ti-language' },
    { id: 'contest',  label: '공모전·대회',      icon: 'ti-trophy' },
    { id: 'activity', label: '대외활동·서포터즈', icon: 'ti-users-group' },
  ];

  let tab = 'cert';
  let actFilter = null;                 // 활동분야 칩 (null = 전체)
  let sortBy = 'deadline';              // deadline | latest

  /* 외부 호출 상태는 탭마다 따로 들고 있다. 탭을 옮길 때마다 다시 부르면 개발계정
     하루 1,000건이 금방 닳는다(backend/src/specup.js 캐시와 같은 이유). */
  let examState = null;                 // { loading } | 서버 응답
  const actState = {};                  // topic → { loading } | 서버 응답
  let lastCertKey = '';                 // 어떤 자격증 목록으로 일정을 받았는지

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const host = () => document.getElementById('specup-wrap');

  /* ── 카드 커버 ────────────────────────────────────────────────
     참고한 취업 사이트(링커리어 등)의 카드는 **모집 포스터 이미지**가 절반을
     차지한다. 우리 데이터에는 그 이미지가 없다 — 국가자격 시험일정에도, 온통청년
     청년정책에도 썸네일 필드가 없다. 아무 이미지나 끌어다 붙이면 그 공고의 것이
     아닌 그림을 그 공고의 것처럼 보여주는 셈이라 넣지 않았다.

     대신 **이름에서 색을 정해** 카드마다 다른 표지를 만든다. 격자에 리듬이 생겨
     목록을 훑을 수 있고, 없는 정보를 지어내지도 않는다. 멘토 아바타 색을 이름 해시로
     고정한 것과 같은 방식이다(mentoring.js PAL_KEYS) — 매번 랜덤이면 새로고침할
     때마다 카드 색이 바뀐다. */
  const PALS = 6;
  const palOf = s => [...String(s ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % PALS;

  // ── 진입 ────────────────────────────────────────────────────
  function onEnter() {
    /* 직무 분류(200KB)가 없으면 목표 직무군 기준 집계를 못 한다. CAS 화면과 같은
       통로로 받아 온다 — 받아지면 CASHero 가 render 를 다시 부르지만 이 화면은
       그 대상이 아니므로 여기서도 한 번 더 그린다. */
    if (window.CASHero?.ensureKeco) CASHero.ensureKeco();
    render();
    if (!KECO.ready()) KECO.load().then(render).catch(() => { /* 학과 기준으로 간다 */ });
  }

  function switchTab(id) {
    tab = TABS.some(t => t.id === id) ? id : 'cert';
    actFilter = null;                   // 탭이 바뀌면 분야 칩도 처음으로
    render();
  }

  function setFilter(v) { actFilter = v || null; render(); }
  function setSort(v)   { sortBy = v === 'latest' ? 'latest' : 'deadline'; render(); }

  // ── 카드 조각 ───────────────────────────────────────────────
  /* D-day 배지. **마감이 코앞인 것만 빨갛게** 한다 — 전부 강조하면 무엇이 급한지
     안 보인다(잡코리아 '마감임박' 줄이 오늘 마감만 빨간 것과 같은 이유). */
  function dday(days, { verb = '마감' } = {}) {
    if (days == null) return '';
    if (days < 0) return `<span class="sup-dday is-done">${verb} 지남</span>`;
    if (days === 0) return `<span class="sup-dday is-today">오늘 ${verb}</span>`;
    const cls = days <= 7 ? 'is-soon' : '';
    return `<span class="sup-dday ${cls}">D-${days}</span>`;
  }

  /* 카드 하나. 네 탭이 담는 것이 다르지만(자격증·어학·공고) 격자에서 높이와 정보
     위치가 어긋나면 훑을 수가 없어서, 뼈대는 한 곳에서 만든다. */
  function card({ emoji, coverTag, palKey, badges = [], title, org, foot, url, cta }) {
    const badgeHtml = badges.filter(Boolean)
      .map(b => `<span class="sup-badge ${b.cls || ''}">${esc(b.text)}</span>`).join('');
    const inner = `
      <div class="sup-cover" data-pal="${palOf(palKey ?? title)}">
        <span class="sup-cover-emoji">${emoji}</span>
        ${coverTag ? `<span class="sup-cover-tag">${esc(coverTag)}</span>` : ''}
      </div>
      <div class="sup-card-body">
        ${badgeHtml ? `<div class="sup-badges">${badgeHtml}</div>` : ''}
        <h3 class="sup-card-title">${esc(title)}</h3>
        <div class="sup-card-org">${esc(org || '')}</div>
        <div class="sup-card-foot">${foot || ''}</div>
      </div>
      ${cta ? `<span class="sup-card-cta">${esc(cta)} <i class="ti ti-external-link"></i></span>` : ''}`;

    return url
      ? `<a class="sup-card" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`
      : `<article class="sup-card">${inner}</article>`;
  }

  const grid = cards => `<div class="sup-grid">${cards.join('')}</div>`;

  /* 목록 위 한 줄 — 몇 건인지와 정렬. 참고한 사이트의 '검색결과 N건 · 최신순' 자리다. */
  function listHead(count, { sortable = false } = {}) {
    return `<div class="sup-listhead">
      <span class="sup-count">검색결과 <b>${count}</b>건</span>
      ${sortable ? `
        <select class="sup-sort" onchange="SpecUp.setSort(this.value)">
          <option value="deadline"${sortBy === 'deadline' ? ' selected' : ''}>마감 임박순</option>
          <option value="latest"${sortBy === 'latest' ? ' selected' : ''}>최근 등록순</option>
        </select>` : ''}
    </div>`;
  }

  // ── 문맥 ────────────────────────────────────────────────────
  /* CAS 와 **같은 모집단**을 쓴다. 다르면 "CAS 에선 부족하다더니 여기선 없다" 가 된다. */
  function resolve() {
    const r = window.CASHero?.resolveContext?.();
    if (!r) return { ok: false, msg: '점수 엔진을 불러오지 못했어요.', help: '' };
    return r;
  }

  // ── 렌더 ────────────────────────────────────────────────────
  function render() {
    const el = host();
    if (!el) return;
    Roadmap.mount('rm-bar-specup', 'me');

    const resolved = resolve();
    el.innerHTML = head(resolved) + deadlineRail() + tabBar()
      + `<div class="sup-body">${body(resolved)}</div>`;
  }

  /* ── 🔥 마감임박 ─────────────────────────────────────────────
     탭과 무관하게 맨 위에 둔다. 이 화면에서 **되돌릴 수 없는 것은 마감뿐**이라,
     탭을 안 열어 봐서 놓치는 일이 없어야 한다. 자격증 접수 마감과 공고 마감을
     한 줄에 섞는 이유도 같다 — 학생에게는 둘 다 그냥 '이번 주에 해야 할 일' 이다.

     7일 이내만 담고, 없으면 줄 자체를 안 그린다. 늘 떠 있으면 배경이 되어 아무도
     안 본다. */
  function deadlineRail() {
    const soon = [];

    if (examState && examState.ok) {
      (examState.items || []).forEach(i => {
        const r = i.round;
        if (!r || r.phase !== 'open') return;
        if (r.daysToRegEnd == null || r.daysToRegEnd > 7) return;
        soon.push({ days: r.daysToRegEnd, emoji: '📜', title: i.name,
          sub: `${r.stage} 원서접수 ~${r.regEnd}`, url: 'https://www.q-net.or.kr' });
      });
    }

    Object.values(actState).forEach(st => {
      if (!st || !st.ok) return;
      (st.items || []).forEach(a => {
        const d = daysTo(a.endDate);
        if (d == null || d < 0 || d > 7) return;
        soon.push({ days: d, emoji: '🏆', title: a.name,
          sub: `${a.org || '주관 미상'} · 신청 ~${a.endDate}`, url: a.url });
      });
    });

    if (!soon.length) return '';
    soon.sort((a, b) => a.days - b.days);

    return `
      <section class="sup-rail-sec">
        <div class="sup-rail-head">
          <h2>🔥 마감 임박</h2>
          <span class="sup-rail-sub">7일 안에 접수가 끝나는 것만 모았어요</span>
        </div>
        <div class="sup-rail">
          ${soon.slice(0, 8).map(s => `
            ${s.url ? `<a class="sup-rail-card" href="${esc(s.url)}" target="_blank" rel="noopener">`
                    : `<div class="sup-rail-card">`}
              <div class="sup-rail-top">
                <span class="sup-rail-emoji">${s.emoji}</span>
                ${dday(s.days, { verb: '마감' })}
              </div>
              <div class="sup-rail-title">${esc(s.title)}</div>
              <div class="sup-rail-desc">${esc(s.sub)}</div>
            ${s.url ? '</a>' : '</div>'}`).join('')}
        </div>
      </section>`;
  }

  /* 'YYYY-MM-DD' 까지 며칠. 서버가 자격증에는 daysTo* 를 붙여 주지만 공고에는
     날짜만 온다. */
  function daysTo(dateStr) {
    if (!dateStr) return null;
    const a = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const b = Date.parse(dateStr + 'T00:00:00Z');
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function head(resolved) {
    const rm = Roadmap.get();
    const goal = rm ? (rm.jobName || rm.middleName) : null;
    const scope = resolved.ok ? resolved.ctx.scopeLabel : goal;
    const n = resolved.ok ? resolved.ctx.agg.count : null;

    const desc = resolved.ok
      ? `<b>${esc(scope)}</b> 선배 <b>${n}명</b>이 실제로 가진 것 가운데 내게 없는 항목부터 보여드려요.
         우리가 중요하다고 정한 목록이 아니라 <b>선배 보유율</b>로 고른 것이에요.`
      : `${esc(resolved.msg || '')} ${esc(resolved.help || '')}`;

    return `
      <div class="page-head">
        <div class="page-eyebrow">커리어 로드맵 2단계 · 스펙UP</div>
        <h1 class="page-title">무엇부터 채울까요</h1>
        <p class="page-desc">${desc}</p>
      </div>
      ${resolved.ok ? summary(resolved.ctx) : ''}`;
  }

  /* 세 갈래(자격증·활동·성과)의 부족 개수를 한 줄로. CAS 화면의 갈림길이 쓰는
     숫자와 같은 함수에서 나온다. */
  function summary(ctx) {
    const G = window.Gap;
    if (!G) return '';
    const state = G.gapContext(ctx);
    if (!state.ok) {
      return `<div class="sup-note sup-note--muted">
        <i class="ti ti-info-circle"></i>
        <div><b>${esc(state.title)}</b><br>${esc(state.desc)}</div>
      </div>`;
    }
    const rows = [
      ['cert',     '자격증'],
      ['activity', '활동·경험'],
      ['award',    '수상·성과'],
    ].map(([type, label]) => {
      const n = G.computeGaps(type, state.ctx).length;
      return `<div class="sup-kpi ${n ? '' : 'is-ok'}">
        <div class="sup-kpi-n">${n}</div><div class="sup-kpi-l">${label}</div></div>`;
    }).join('');

    return `<div class="sup-kpis">${rows}<div class="sup-kpi-note">
      선배 보유율 ${G.RATE.cert}%(수상은 ${G.RATE.award}%) 이상인 항목 중 내게 없는 것의 수예요.
    </div></div>`;
  }

  function tabBar() {
    return `<div class="sup-tabs">${TABS.map(t => `
      <button type="button" class="sup-tab ${tab === t.id ? 'on' : ''}"
              onclick="SpecUp.switchTab('${t.id}')">
        <i class="ti ${t.icon}"></i>${t.label}
      </button>`).join('')}</div>`;
  }

  function body(resolved) {
    if (tab === 'contest' || tab === 'activity') return activityTab(resolved, tab);
    if (!resolved.ok) return blocked(resolved);
    if (tab === 'lang') return langTab(resolved.ctx);
    return certTab(resolved.ctx);
  }

  /* 로그인·스펙이 없어 판정을 못 하는 상태. 공모전 탭은 이 상태에서도 볼 수 있으므로
     길을 막지 않고 두 갈래를 같이 준다. */
  function blocked(resolved) {
    return `
      <div class="sup-empty">
        <div class="sup-empty-ic">🔒</div>
        <div class="sup-empty-title">${esc(resolved.msg || '아직 판정할 수 없어요')}</div>
        <div class="sup-empty-desc">${esc(resolved.help || '')}</div>
        <div class="sup-empty-actions">
          <button type="button" class="btn-brand" onclick="navigateTo('mypage','spec')">
            <i class="ti ti-file-pencil"></i> 내 스펙 입력하기
          </button>
          <button type="button" class="sup-ghost" onclick="SpecUp.switchTab('contest')">
            지금 모집 중인 공모전 보기
          </button>
        </div>
      </div>`;
  }

  // ── ① 자격증 ────────────────────────────────────────────────
  function certTab(ctx) {
    const G = window.Gap;
    const state = G ? G.gapContext(ctx) : { ok: false };
    const gaps = state.ok ? G.computeGaps('cert', state.ctx) : [];

    /* 부족한 게 없어도 빈 화면을 주지 않는다 — 선배 보유율 상위를 그대로 보여준다.
       '더 할 게 없다' 와 '보여줄 게 없다' 는 다른 말이다.

       ── 이 목록에서도 '아직 없는 것' 이 먼저다 ──
       실측(정보통신 직무군)에서 상위 6개 중 3개가 이미 보유한 자격이라, 채울 것을
       찾으러 온 화면의 절반이 '보유' 배지로 찼다. 보유한 것을 지우지는 않는다 —
       "선배들이 많이 가진 것" 이라는 목록의 뜻이 달라지기 때문이다. 순서만 바꾼다. */
    const fallback = !gaps.length;
    const rows = fallback
      ? (ctx.agg.certs || []).filter(c => c.pct > 0)
          .map(c => ({ name: c.name, pct: c.pct, mine: (ctx.spec.certs || []).includes(c.id) }))
          .sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? 1 : -1) || b.pct - a.pct)
          .slice(0, 6)
      : gaps.map(g => ({ name: g.name, pct: g.pct, mine: false }));

    if (!rows.length) {
      return notice('📭', '이 직무군은 자격증 데이터가 아직 없어요',
        '선배 스펙이 쌓이면 어떤 자격증을 많이 갖고 있는지 보여드릴게요.');
    }

    requestExams(rows.map(r => r.name));

    const banner = fallback
      ? notice('✅', '선배 평균만큼 채웠어요',
          '부족한 자격증은 없어요. 아래는 이 직무군 선배들이 많이 가진 자격증이에요.', true)
      : '';

    return banner + listHead(rows.length) + grid(rows.map(certCard)) + disqFoot(rows) + examFoot();
  }

  /* ── 응시 결격사유 ────────────────────────────────────────────
     "이 시험, 내가 응시할 수는 있나" 를 알려준다(출처: 큐넷 종목 관련 정보).

     ── 카드 밖에 두는 이유 ──
     카드는 통째로 큐넷 링크(`<a>`)라 그 안에 펼침 상자를 넣을 수 없다.
     또 사유가 한 종목에 최대 11개고 대부분 법조문이라, 카드에 늘어놓으면
     정작 시험일정이 안 읽힌다. 그래서 **목록 아래에 접어서 한 번만** 둔다.

     ── 대부분의 자격에는 안 뜬다. 그게 맞다 ──
     결격사유가 있는 종목은 국가전문자격 80개뿐이다. 기사·기능사에는 애초에
     없으므로 "결격사유 없음" 을 적지 않는다 — 있는 자격에서만 칸이 생겨야
     그 칸이 뜻을 갖는다.

     ── 부풀리지 않는다 ──
     나머지는 파산선고·금고 이상의 형 같은 법정 결격사유라 대학생에게는 사실상
     해당이 없다. "못 딸 수도 있어요" 로 겁주지 않고, 실제로 걸릴 수 있는
     **미성년자** 만 카드 배지로 올린다(certCard). */
  function disqFoot(rows) {
    if (!examState || !examState.ok) return '';
    const withDisq = rows
      .map(r => (examState.items || []).find(i => i.name === r.name))
      .filter(i => i && i.disq && i.disq.reasons.length);
    if (!withDisq.length) return '';

    return `<details class="sup-disq">
      <summary>응시 결격사유가 있는 자격 ${withDisq.length}개 — 펼쳐보기</summary>
      <p class="sup-disq-lead">아래 조건에 해당하면 시험에 응시할 수 없어요.
        대부분 파산·형벌처럼 해당되는 사람이 드문 법정 요건이지만,
        <b>미성년자</b>는 실제로 걸릴 수 있어요.</p>
      ${withDisq.map(i => `
        <div class="sup-disq-item">
          <b>${esc(i.name)}</b>
          <ul>${i.disq.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          ${i.disq.notes.length
            ? `<p class="sup-disq-note">${i.disq.notes.map(esc).join(' · ')}</p>` : ''}
        </div>`).join('')}
      <p class="sup-disq-src">출처: 한국산업인력공단 국가자격 종목 관련 정보(data.go.kr)</p>
    </details>`;
  }

  function certCard(r) {
    const item = examState && examState.ok
      ? (examState.items || []).find(i => i.name === r.name) : null;
    const round = item && item.round;

    /* 커버 꼬리표는 자격구분('국가기술자격 기사 …' 의 앞부분)이다. 못 찾은 종목은
       우리가 구분을 모르므로 비워 둔다 — 추측해서 '민간자격' 이라 적으면 틀린다. */
    const kind = round && /^(국가기술자격|전문자격|과정평가형자격|일학습병행자격)/.exec(round.label || '');

    let foot = '<span class="sup-foot-muted">시험일정 확인 중…</span>';
    if (examState && !examState.loading) {
      /* 이번 응답이 이 자격증을 안 담고 있으면 **아직 안 물어본 것**이다.
         '일정 정보 없음' 이라고 적으면 확인해 봤는데 없다는 뜻이 되어 틀린다. */
      if (examState.ok && !item)          foot = '<span class="sup-foot-muted">시험일정 확인 중…</span>';
      else if (!examState.ok)             foot = '<span class="sup-foot-muted">일정을 불러오지 못함</span>';
      else if (!item.matched)             foot = '<span class="sup-foot-muted">국가자격 일정표에 없는 종목<sup>*</sup></span>';
      else if (!round)                    foot = '<span class="sup-foot-muted">남은 회차 없음</span>';
      else if (round.phase === 'open')    foot = `${dday(round.daysToRegEnd, { verb: '마감' })}<span class="sup-foot-txt"><b>${esc(round.stage)} 접수 중</b> ~${esc(round.regEnd)}</span>`;
      else if (round.phase === 'upcoming') foot = `<span class="sup-dday is-wait">${round.daysToRegStart}일 뒤</span><span class="sup-foot-txt">${esc(round.stage)} 접수 ${esc(round.regStart)} 시작</span>`;
      else                                foot = `<span class="sup-foot-muted">${esc(round.stage)} 접수 마감 · 시험 ${esc(round.examStart || '-')}</span>`;
    }

    return card({
      emoji: '📜',
      coverTag: kind ? kind[1] : (item && !item.matched ? '' : ''),
      palKey: r.name,
      badges: [
        { text: `선배 ${r.pct}%`, cls: 'is-peer' },
        r.mine ? { text: '보유', cls: 'is-have' } : null,
        /* 결격사유 중 대학생에게 **실제로 걸릴 수 있는 것은 미성년자 하나**다
           (80종 중 17종). 나머지 법정 요건까지 배지로 올리면 모든 전문자격에
           경고가 붙어 아무 뜻이 없어진다 — 자세한 목록은 아래 펼침 상자에 있다. */
        item?.disq?.minorBlocked ? { text: '만 19세 이상', cls: 'is-limit' } : null,
      ],
      title: r.name,
      org: round ? roundLabel(round) : '',
      foot,
      url: 'https://www.q-net.or.kr',
      cta: '큐넷',
    });
  }

  /* '국가기술자격 기사 (2026년도 제3회)' → '필기 2026년도 제3회'.
     자격구분(국가기술자격/전문자격)은 자격증 이름에서 이미 드러나므로 접고, 회차만
     남긴다 — 어느 회차인지가 안 보이면 날짜가 어디서 온 값인지 알 수 없다. */
  function roundLabel(r) {
    const inner = /\(([^)]+)\)\s*$/.exec(r.label || '');
    const seq = inner ? inner[1] : (r.label || '').replace(/^(국가기술자격|전문자격)\s*/, '');
    return [r.stage, seq].filter(Boolean).join(' ');
  }

  /* 일정을 못 받았을 때의 안내는 목록 아래에 **한 번만** 붙인다. 자격증마다 같은
     문구를 반복하면 화면이 경고문으로 덮인다. */
  function examFoot() {
    if (!examState || examState.loading) return '';

    if (examState.ok) {
      /* 못 찾은 종목이 있으면 그 이유를 여기서 **한 번만** 설명한다. */
      const missed = (examState.items || []).filter(i => !i.matched).map(i => i.name);
      return `<div class="sup-src">
        시험일정: ${esc(examState.source || '')} · ${examState.year}년 필기 기준
        (실기는 필기 합격자만 접수할 수 있어 보여주지 않아요)
        ${missed.length ? `<br><sup>*</sup> ${esc(missed.join(' · '))} 는 국가자격 시험일정에서 못 찾았어요 —
          민간자격이거나 종목 목록에 빠진 종목이라, 시행기관 공지를 확인해 주세요.` : ''}
      </div>`;
    }
    return `<div class="sup-note">
      <i class="ti ti-calendar-off"></i>
      <div><b>${esc(examState.error)}</b>
        ${examState.how ? `<br><span class="sup-note-how">${esc(examState.how)}</span>` : ''}
        <br><span class="sup-note-how">일정이 없어도 위 목록(선배 보유율)은 그대로예요.</span>
      </div>
    </div>`;
  }

  /* 같은 자격증 목록이면 다시 부르지 않는다. render() 는 탭을 옮길 때마다 돈다.

     ── 늦게 온 옛 응답이 새 응답을 덮지 않게 ──
     이 화면은 짧은 사이에 두 번 그려진다. 처음에는 학과 기준으로, 직무 분류(200KB)가
     도착하면 목표 직무군 기준으로 — 그때 자격증 목록이 통째로 바뀐다. 요청이 두 번
     나가는데 **먼저 보낸 것이 늦게 도착하면** 옛 목록의 일정이 새 카드에 얹힌다.
     실측으로 걸렸다: 카드에는 '데이터분석 준전문가' 가 있는데 각주는 이전 목록
     (정보보안기사·AWS SAA)을 말하고 있었다. 에러가 안 나서 눈에 잘 안 띈다.
     번호를 붙여 **마지막으로 보낸 요청의 답만** 받는다. */
  let examSeq = 0;
  function requestExams(names) {
    const key = names.slice().sort().join('|');
    if (key === lastCertKey) return;
    lastCertKey = key;

    const seq = ++examSeq;
    examState = { loading: true, names };
    DB.specupExams(names).then(res => {
      if (seq !== examSeq) return;                // 그사이 새 요청이 나갔다 — 이 답은 버린다
      examState = { ...res, names };
      if (tab === 'cert') render();
    });
  }

  // ── ② 어학 ──────────────────────────────────────────────────
  /* 어학은 '있다/없다' 가 아니라 **점수 차이**라 GAP 판정 대상이 아니다(성적은
     보유율로 세면 뜻이 흐려진다). 그래서 선배 평균과 내 점수를 나란히 놓고
     차이만 말한다.

     ── 시험 일정 API 가 없다 ──
     TOEIC·OPIc·TOEIC Speaking 은 시행기관(YBM·크레듀)이 공개 API 를 열지 않는다.
     국가자격 시험일정에도 없다. 없는 것을 있는 척 정적 표로 박아 두면 다음 달에
     조용히 틀린 날짜가 된다 — 이 저장소가 제일 경계하는 부류라 넣지 않았다.
     대신 공식 접수 페이지로 바로 보낸다. */
  const LANG_ROWS = [
    { key: 'toeic',         label: 'TOEIC',          unit: '점',   url: 'https://exam.toeic.co.kr' },
    { key: 'toeicSpeaking', label: 'TOEIC Speaking', unit: '',     url: 'https://exam.toeic.co.kr' },
    { key: 'opic',          label: 'OPIc',           unit: '',     url: 'https://www.opic.or.kr' },
    { key: 'toefl',         label: 'TOEFL',          unit: '점',   url: 'https://www.ets.org/toefl' },
  ];

  function langTab(ctx) {
    const mine = ctx.spec.scores || {};
    const peer = ctx.agg.scores || {};

    const cards = LANG_ROWS.map(l => {
      const p = peer[l.key];
      const m = mine[l.key];
      if (!p && m == null) return '';                 // 선배도 나도 없는 시험은 굳이 카드를 만들지 않는다

      const gap = (typeof p?.avg === 'number' && typeof m === 'number') ? p.avg - m : null;
      const status = m == null
        ? { text: '미응시', cls: 'is-lack' }
        : gap == null
          ? { text: '보유', cls: 'is-have' }
          : gap > 0 ? { text: `${gap}${l.unit} 부족`, cls: 'is-lack' }
                    : { text: '평균 이상', cls: 'is-have' };

      return card({
        emoji: '🗣️',
        coverTag: '어학',
        palKey: l.label,
        badges: [status, p ? { text: `표본 ${p.n}명`, cls: 'is-peer' } : null],
        title: l.label,
        org: p ? `선배 평균 ${p.avg}${l.unit}` : '선배 자료 없음',
        foot: `<span class="sup-foot-txt">내 점수 <b>${m == null ? '없음' : esc(String(m)) + l.unit}</b></span>`,
        url: l.url,
        cta: '접수',
      });
    }).filter(Boolean);

    if (!cards.length) {
      return notice('📭', '어학 데이터가 아직 없어요',
        '이 직무군 선배 중 어학 성적을 입력한 사람이 없어서 목표치를 낼 수 없어요.');
    }

    return listHead(cards.length) + grid(cards) + `
      <div class="sup-src">
        목표치는 <b>${esc(ctx.scopeLabel)} 선배 평균</b>이에요. 어학시험은 시행기관이 공개 API 를
        열지 않아 접수 일정을 자동으로 가져오지 못합니다 — ‘접수’ 로 공식 페이지에서 확인하세요.
      </div>`;
  }

  // ── ③ 공모전 · 대외활동 ─────────────────────────────────────
  /* 위쪽에는 **우리 데이터**(선배 보유율 기준 부족 활동), 아래쪽에 **모집 중인 공고**.
     공고만 늘어놓으면 "그래서 나한테 뭐가 필요한데" 가 빠진다. */
  function activityTab(resolved, topic) {
    const st = actState[topic];
    if (!st) requestActivities(topic);

    const guide = resolved.ok ? activityGuide(resolved.ctx, topic) : '';
    return guide + activityList(topic);
  }

  function activityGuide(ctx, topic) {
    const G = window.Gap;
    const state = G ? G.gapContext(ctx) : { ok: false };
    if (!state.ok) return '';

    /* 공모전 탭은 '공모전·대회' 유형만, 대외활동 탭은 나머지 참여형 활동을 본다.
       유형 id 는 CAS.ACTIVITY_TYPES 가 단일 출처다. */
    const want = topic === 'contest'
      ? ['competition']
      : ['extracurricular', 'club', 'campus', 'volunteer'];
    const gaps = G.computeGaps('activity', state.ctx);

    /* ── 이 탭과 무관한 유형으로 채우지 않는다 ────────────────────
       처음에는 해당 유형이 하나도 없으면 부족 활동 전체로 물러섰다. 그랬더니
       **'공모전·대회' 탭에 "인턴십 44% · 프로젝트 61%" 가 떴다**(실측). 탭 제목이
       말하는 것과 아래 내용이 다르면, 학생은 이 화면이 무엇을 근거로 고른 목록인지
       알 수 없게 된다. 이 유형이 부족하지 않으면 이 줄은 그냥 안 그린다 —
       아래 모집 공고는 그대로 보여주므로 화면이 비지 않는다. */
    const rows = gaps.filter(g => want.some(w => matchesType(g, w))).slice(0, 3);
    if (!rows.length) return '';

    return `<div class="sup-note sup-note--why">
      <i class="ti ti-target-arrow"></i>
      <div><b>${esc(ctx.scopeLabel)} 선배가 많이 한 활동 중 내게 없는 것</b><br>
        ${rows.map(g => `${esc(g.name)} <span class="sup-why-pct">선배 ${g.pct}%</span>`).join(' · ')}
      </div>
    </div>`;
  }

  /* GAP 행에는 유형 id 가 없고 라벨만 있다. 라벨은 CAS.ACTIVITY_TYPES 에서 오므로
     거기서 되짚는다 — 라벨 문자열을 여기에 박아 두면 배점표를 고칠 때 갈린다. */
  function matchesType(gapRow, typeId) {
    const t = (window.CAS?.ACTIVITY_TYPES || []).find(x => x.id === typeId);
    return Boolean(t && t.label === gapRow.name);
  }

  function activityList(topic) {
    const st = actState[topic];
    if (!st || st.loading) {
      return `<div class="sup-empty"><div class="sup-empty-ic">⏳</div>
        <div class="sup-empty-title">모집 공고를 불러오는 중…</div></div>`;
    }
    if (!st.ok) {
      return `<div class="sup-note">
        <i class="ti ti-plug-connected-x"></i>
        <div><b>${esc(st.error)}</b>
          ${st.how ? `<br><span class="sup-note-how">${esc(st.how)}</span>` : ''}
          <br><span class="sup-note-how">
            공모전·대외활동만 모아 주는 전국 단위 공개 API 는 없어서, 온통청년(한국고용정보원)
            청년정책 목록에서 골라 씁니다 — 자세한 조사 결과는 docs/외부API-연동구조.md 에 있어요.
          </span>
        </div>
      </div>`;
    }
    if (!st.items.length) {
      return notice('📭', '지금 걸린 공고가 없어요',
        '키워드로 걸러 낸 결과라 시기에 따라 비어 있을 수 있어요.');
    }

    /* ── 분야 칩은 **실제로 걸린 것만** 만든다 ────────────────────
       참고한 사이트처럼 분야를 미리 박아 두면(서포터즈·해외탐방·봉사단…) 우리 소스에
       없는 분야가 칩으로 떠서, 눌러도 0건인 칸이 생긴다. 받아 온 공고의 키워드에서
       실제로 있는 것만 세어 만든다 — 옆의 숫자가 곧 "눌렀을 때 나올 개수" 다. */
    const counts = new Map();
    st.items.forEach(a => (a.keywords || []).forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
    const chips = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const shown = actFilter
      ? st.items.filter(a => (a.keywords || []).includes(actFilter))
      : st.items;

    /* 기본은 마감 임박순 — 이 화면에서 되돌릴 수 없는 것은 마감뿐이다.
       마감일이 없는(상시) 공고는 뒤로 보낸다. */
    const sorted = [...shown].sort((a, b) => sortBy === 'latest'
      ? String(b.startDate || '').localeCompare(String(a.startDate || ''))
      : String(a.endDate || '9999-99-99').localeCompare(String(b.endDate || '9999-99-99')));

    const chipBar = chips.length ? `
      <div class="sup-chipbar">
        <button type="button" class="sup-fchip ${actFilter ? '' : 'on'}"
                onclick="SpecUp.setFilter('')">전체 <b>${st.items.length}</b></button>
        ${chips.map(([k, n]) => `
          <button type="button" class="sup-fchip ${actFilter === k ? 'on' : ''}"
                  onclick="SpecUp.setFilter('${esc(k).replace(/'/g, '&#39;')}')">
            ${esc(k)} <b>${n}</b></button>`).join('')}
      </div>` : '';

    return chipBar + listHead(sorted.length, { sortable: true })
      + grid(sorted.slice(0, 24).map(actCard))
      + `<div class="sup-src">출처: ${esc(st.source)} · 모집 공고에는 포스터 이미지가 없어
           카드 표지는 이름에서 색만 정해 그립니다(없는 그림을 지어내지 않습니다).</div>`;
  }

  function actCard(a) {
    const d = daysTo(a.endDate);
    const foot = a.endDate
      ? `${dday(d, { verb: '마감' })}<span class="sup-foot-txt">~${esc(a.endDate)}</span>`
      : (a.period ? `<span class="sup-dday is-wait">상시</span>` : '<span class="sup-foot-muted">기간 미상</span>');

    return card({
      emoji: '🏆',
      /* ── 표지에는 지역을 올린다 (사용자 지시) ────────────────────
         예전에는 키워드 첫 개를 올렸는데, 그 값은 정책 분류라('보조금'·
         '장기미취업청년') 공모전 카드에서 읽을 것이 못 됐다. 게다가 아래 배지가
         같은 배열을 읽어서 **첫 키워드가 두 번 찍혔다**
         ('장기미취업청년 / 장기미취업청년 / 보조금').

         지금 잡히는 정책은 지자체 것에 몰려 있다(광주·울산·인천…). 지역을 안 적으면
         학생이 남의 동네 공고를 열어 보고 나서야 안다 — 표지에서 바로 걸러지게 한다.
         지역을 모르면 예전처럼 키워드로 물러선다(칸을 비우면 표지가 허전해진다). */
      coverTag: a.region || (a.keywords || [])[0] || '',
      palKey: a.name,
      badges: (a.keywords || []).slice(0, 2).map(k => ({ text: k })),
      title: a.name,
      org: a.org || '주관 미상',
      foot,
      url: a.url,
      cta: a.url ? '신청' : '',
    });
  }

  function requestActivities(topic) {
    actState[topic] = { loading: true };
    DB.specupActivities(topic).then(res => {
      actState[topic] = res;
      if (tab === topic) render();
    });
  }

  // ── 조각 ────────────────────────────────────────────────────
  function notice(icon, title, desc, ok) {
    return `<div class="sup-empty ${ok ? 'sup-empty--ok' : ''}">
      <div class="sup-empty-ic">${icon}</div>
      <div class="sup-empty-title">${esc(title)}</div>
      <div class="sup-empty-desc">${esc(desc)}</div>
    </div>`;
  }

  return { onEnter, switchTab, setFilter, setSort, render };
})();
