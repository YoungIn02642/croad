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
  /* 목록은 한 번에 24장까지만 그린다. 그전에는 **24장에서 그냥 끊겼고 넘길 길이
     없었다** — 146건 중 뒤쪽 공고는 아예 볼 수 없었다(사용자 지적 2026-09-07). */
  const ACT_PER_PAGE = 24;
  const actPage = {};                   // topic → 현재 페이지 (1부터)

  /* 외부 호출 상태는 탭마다 따로 들고 있다. 탭을 옮길 때마다 다시 부르면 개발계정
     하루 1,000건이 금방 닳는다(backend/src/specup.js 캐시와 같은 이유). */
  let examState = null;                 // { loading } | 서버 응답
  const actState = {};                  // topic → { loading } | 서버 응답
  let lastCertKey = '';                 // 어떤 자격증 목록으로 일정을 받았는지

  /* ── 자격증 둘러보기 (사용자 지시 2026-09-11) ────────────────────────────────
     이 탭은 '선배보다 부족한 자격증' 을 보여주는 자리였다. 그런데 **선배 스펙이 아직
     없어서 화면이 통째로 비었다** — 들어와 봐야 "데이터가 쌓이면 보여드릴게요" 한 줄뿐이라
     스펙업에 올 이유가 없었다.
     그래서 추천이 안 될 때는 **카탈로그를 그냥 펼쳐 둔다.** 643종을 분야로 추려 보고,
     하나 누르면 모달로 자세히 본다. 추천(어떤 자격이 이 직무에 필요한가)은 선배 데이터가
     쌓인 뒤에 붙일 일이고, 그때까지 빈 화면으로 둘 이유가 없다. */
  let catalog = null;                   // null=아직 안 받음 · { loading } · { ok, certs }
  let certField = null;                 // 직무분야 칩 (null = 전체)
  let certQuery = '';                   // 이름 검색
  const CERT_PER_PAGE = 24;
  let certPage = 1;
  /* 모달에서 보고 있는 자격증. 일정은 그때 따로 받는다(목록 전체를 미리 받으면
     개발계정 하루 1,000건이 한 화면에 날아간다). */
  let certModal = null;                 // null | { cert, exam: null|{loading}|응답 }
  /* 모달에서 고른 회차 탭. null 이면 '다가오는 회차' 를 자동으로 연다. */
  let certRound = null;
  let lastCtx = null;                   // 마지막으로 판정된 ctx (둘러보기 카드의 '보유' 배지용)

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

  /* 필터·정렬을 바꾸면 **1페이지로 돌아간다.** 3페이지에서 분야를 좁히면 결과가
     그보다 적어져 빈 화면이 되는데, 사용자는 "필터가 고장 났다"로 읽는다. */
  function setFilter(v) { actFilter = v || null; actPage[tab] = 1; render(); }
  function setSort(v)   { sortBy = v === 'latest' ? 'latest' : 'deadline'; actPage[tab] = 1; render(); }
  function setActPage(n) {
    actPage[tab] = Math.max(1, Number(n) || 1);
    render();
    /* 페이지를 넘기면 목록 맨 위로 올려 준다 — 안 그러면 넘긴 뒤에도 화면이
       그대로라 바뀐 줄 모른다. */
    document.querySelector('.sup-listhead')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
  /* ── 표지 그림 ────────────────────────────────────────────────
     세 겹으로 쌓고 **안 되는 것만 걷어낸다.** 순서는 뒤에서 앞으로:

       이모지(바닥) → 주관기관 로고 → 모집 포스터(맨 앞, 여백 없이 꽉)

     · 포스터 — 사용자 지시(2026-09-07) "사이트 안에 모집 사진을 넣어줘.
       여백없게 화면 맞춰서." `object-fit: cover` 로 표지를 덮는다
     · 로고 — 포스터가 없는 공고의 자리(2026-09-06 결정)
     · 이모지 — **넘겨줄 때만** 그린다

     ── 이모지를 '항상 그리는 바닥' 으로 두면 안 됐다 (2026-09-07, 사용자 지적) ──
     로고가 떠도 이모지가 **옆에 나란히** 남았다. `.sup-cover` 가 flex 라 둘이 형제로
     자리를 나눠 갖고, 그래서 로고가 가운데가 아니라 왼쪽으로 밀렸다. '쌓아서 덮는다'
     고 생각했지만 실제로 겹쳐 있던 것은 절대배치인 포스터뿐이었다.
     이모지는 **넘어온 경우에만** 그린다 — 공모전·대외활동 카드는 안 넘긴다.

     ── 왜 갈아끼우지 않고 쌓아서 걷어내나 ──
     처음에는 `onerror` 에서 `innerHTML` 을 통째로 바꿔치웠는데, 포스터→로고→이모지로
     **두 단계** 물러나야 하니 바꿔 넣을 HTML 안에 또 따옴표 붙은 핸들러가 들어간다.
     속성 안의 문자열 안의 속성이라 이스케이프가 세 겹이 되고, 한 겹만 어긋나도
     **에러 없이 표지만 빈 칸**이 된다. 쌓아 두고 실패한 것을 `remove()` 하면
     핸들러가 한 줄로 끝나고, 다음 겹이 저절로 드러난다.

     서버가 그림을 못 찾으면 204 를 준다. 몸통이 없으니 `error` 가 뜨지만 그것만
     믿지 않는다 — 0바이트가 200 으로 오면 `load` 가 뜨면서 아무것도 안 그려진다.
     둘 다 본다(company-cover.js 의 공고 카드와 같은 규칙). */
  function coverArt({ poster, logo, emoji }) {
    const drop = sel => `this.closest('${sel}').remove()`;
    const guard = sel => `onerror="${esc(drop(sel))}" onload="if(!this.naturalWidth){${esc(drop(sel))}}"`;

    return (poster
        ? `<img class="sup-cover-img" src="${esc(poster)}" alt="" loading="lazy" ${guard('.sup-cover-img')}>`
        : '')
      + (logo
        ? `<span class="sup-cover-logo"><img src="${esc(logo)}" alt="" loading="lazy" ${guard('.sup-cover-logo')}></span>`
        : '')
      + (emoji ? `<span class="sup-cover-emoji">${emoji}</span>` : '');
  }

  /* openCert 를 주면 **링크가 아니라 버튼**이 된다 — 눌러서 밖으로 나가는 대신
     모달을 연다(자격증 둘러보기, 2026-09-11). url 과 같이 주지 않는다. */
  function card({ emoji, poster, logo, coverTag, palKey, badges = [], title, org, foot, url, cta, openCert }) {
    const badgeHtml = badges.filter(Boolean)
      .map(b => `<span class="sup-badge ${b.cls || ''}">${esc(b.text)}</span>`).join('');
    const inner = `
      <div class="sup-cover" data-pal="${palOf(palKey ?? title)}">
        ${coverArt({ poster, logo, emoji })}
        ${coverTag ? `<span class="sup-cover-tag">${esc(coverTag)}</span>` : ''}
      </div>
      <div class="sup-card-body">
        ${badgeHtml ? `<div class="sup-badges">${badgeHtml}</div>` : ''}
        <h3 class="sup-card-title">${esc(title)}</h3>
        <div class="sup-card-org">${esc(org || '')}</div>
        <div class="sup-card-foot">${foot || ''}</div>
      </div>
      ${cta ? `<span class="sup-card-cta">${esc(cta)} <i class="ti ti-external-link"></i></span>` : ''}`;

    if (openCert) {
      return `<button type="button" class="sup-card sup-card--btn"
        onclick="SpecUp.openCert('${esc(openCert).replace(/'/g, '&#39;')}')">${inner}</button>`;
    }
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
    /* 둘러보기 카드가 '보유' 배지를 붙이려면 내 스펙이 필요하다. 판정이 안 되는
       상태에서는 ctx 가 없으므로 null 로 둔다 — 그때는 배지가 안 붙는다. */
    lastCtx = resolved.ok ? resolved.ctx : null;
    el.innerHTML = head(resolved) + deadlineRail() + tabBar()
      + `<div class="sup-body">${body(resolved)}</div>`;
    paintModal();
  }

  /* ── 자격증 상세 모달 (사용자 지시 2026-09-11) ────────────────────────────
     카드를 누르면 큐넷으로 나가 버리는 대신, 우리가 아는 것을 먼저 보여준다.

     ── 없는 것은 적지 않는다 ──
     요청받은 항목 중 **'자격증 내용 설명'과 '필요 주요 학과'는 우리 데이터에 없다.**
     큐넷 종목목록 API 가 주는 것은 이름·코드·자격구분·계열·대/중직무분야뿐이고,
     상세 설명 API 는 없다(실호출로 404 확인). 학과 매핑도 어디에도 없다.
     그래서 그 자리를 지어내지 않고 **직무분야**로 대신하며, 설명은 큐넷 원문으로 보낸다.
     빈 줄을 만들어 두고 "정보 없음" 을 적지도 않는다 — 알아볼 곳을 주는 편이 낫다. */
  /* ── 모달은 페이지 밖(body)에 그린다 (실측 2026-09-11) ──────────────────────
     처음에는 스펙업 화면 안에 같이 그렸다. 그런데 **열면 화면에 안 보이고 스크롤을
     내려야 나왔다.** 원인은 `.page` 에 걸린 등장 애니메이션이다 —
     `transform: matrix(1,0,0,1,0,8)` 이 걸린 조상이 있으면 `position: fixed` 가
     화면이 아니라 **그 조상 안에 갇힌다**(실측: 오버레이 높이가 뷰포트 900 이 아니라
     페이지 전체 3228px 로 잡혔다). 그래서 모달이 페이지 한가운데에 서 있었다.
     body 바로 아래에 따로 붙이면 transform 의 영향을 받지 않는다. */
  function modalHost() {
    let h = document.getElementById('sup-modal-host');
    if (!h) { h = document.createElement('div'); h.id = 'sup-modal-host'; document.body.appendChild(h); }
    return h;
  }

  function paintModal() {
    modalHost().innerHTML = certModalHtml();
    /* ── 고른 탭을 보이는 자리로 끌어온다 (실측 2026-09-11) ────────────────────
       상시시험 종목은 회차가 **41개**다(실측: 한식조리기능사·지게차운전기능사).
       탭을 가로로 흘려 두면 기본 선택인 '다가오는 회차' 가 오른쪽 끝에 있어서,
       열자마자 지난 회차만 보이고 스크롤해야 찾는다. 열 때 끌어와 둔다. */
    const on = document.querySelector('#sup-rtabs .sup-rtab.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    /* 모달이 떠 있는 동안 뒤 화면이 같이 스크롤되지 않게 잠근다. 안 그러면 모달 위에서
       휠을 굴렸을 때 뒤가 움직여서, 닫고 나면 엉뚱한 자리에 와 있다. */
    document.body.classList.toggle('sup-modal-open', !!certModal);
  }

  function certModalHtml() {
    if (!certModal) return '';
    const c = certModal.cert;
    const ex = certModal.exam;

    /* ── 민간·해외 자격은 시험일정 칸을 아예 안 그린다 (사용자 지시 2026-09-11) ──
       종목코드가 없는 30종(ADsP·AWS SAA·CFA·AFPK …)은 **국가자격이 아니다.**
       국가자격 시험일정 API 에 있을 수가 없고, 민간자격 시험일정을 모아 주는 공개
       API 도 없다(직능원 민간자격 정보는 등록정보만 주고 일정은 없다. 해외자격은
       국내 등록 자체가 없다). 그래서 "못 찾았어요" 를 띄우는 대신 칸을 안 만든다 —
       찾다 실패한 것처럼 보이는 문구는 사용자가 할 수 있는 일이 없는 말이다.
       같은 이유로 **큐넷 버튼도 안 붙인다.** 큐넷은 국가자격 창구라 민간자격
       지원자를 보내면 헛걸음시킨다. */
    const national = !!c.code;

    const rows = [
      ['시행기관', c.issuer || null],
      ['자격 구분', [c.kindLabel, c.grade].filter(Boolean).join(' · ') || null],
      ['직무 분야', [c.field, c.midField].filter(Boolean).join(' › ') || null],
    ].filter(([, v]) => v);

    return `
      <div class="modal-overlay on" id="sup-cert-modal">
        <div class="modal modal--wide" role="dialog" aria-modal="true" aria-label="${esc(c.id)}">
          <div class="modal-head">
            <div class="modal-head-l">
              <div class="modal-title">${esc(c.id)}</div>
              <div class="modal-sub">${esc(c.kindLabel || '')}${c.code ? ` · 종목코드 ${esc(c.code)}` : ''}</div>
            </div>
            <button type="button" class="modal-close" onclick="SpecUp.closeCert()" aria-label="닫기"><i class="ti ti-x"></i></button>
          </div>
          <div class="modal-body">
            <dl class="sup-deflist">
              ${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
            </dl>

            ${national ? `<div class="sup-modal-sec">
              <div class="modal-label">올해 시험 일정</div>
              ${examBlock(ex)}
            </div>` : ''}


            ${national ? `<div class="sup-modal-actions">
              <a class="btn-brand" href="https://www.q-net.or.kr/rcv001.do" target="_blank" rel="noopener">
                <i class="ti ti-external-link"></i> 신청하러 가기
              </a>
              <a class="wf-btn" href="https://www.q-net.or.kr" target="_blank" rel="noopener">큐넷에서 상세 보기</a>
            </div>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* 시험 일정 칸. 접수·시험·발표를 한 줄씩 보여준다.
     못 받은 이유마다 할 일이 다르므로 문구를 나눈다(specup.js 라우트와 같은 원칙). */
  function examBlock(ex) {
    if (!ex || ex.loading) return `<div class="sup-foot-muted">시험일정 확인 중…</div>`;
    if (!ex.ok) {
      return `<div class="sup-foot-muted">${esc(ex.error || '일정을 불러오지 못했어요.')}</div>`;
    }
    const item = (ex.items || [])[0];
    if (!item) return `<div class="sup-foot-muted">일정을 찾지 못했어요.</div>`;
    if (!item.matched) return `<div class="sup-foot-muted">${esc(item.note || '국가자격 일정표에 없는 종목이에요.')}</div>`;
    /* ── 회차 탭 + 단계 표 (사용자 지시 2026-09-11) ─────────────────────────
       네이버 자격증 일정과 같은 모양이다. 회차를 탭으로 고르고, 고른 회차의
       필기 접수 → 필기 → 필기 발표 → 실기 접수 → 실기 → 최종 발표를 한 표로 본다.
       예전에는 회차를 세로로 다 늘어놔서, 지난 회차가 위에 쌓이고 정작 다가오는
       회차가 한참 아래에 있었다.

       ── 기본으로 여는 탭은 '다가오는 회차' 다 ──
       1회가 끝났고 2회가 다가오면 2회가 열려 있어야 한다. 지난 회차를 먼저 보여주면
       "이미 끝난 시험" 을 화면 첫 줄에서 읽게 된다. 지난 회차는 탭으로 골라서
       볼 수 있고, 고르면 흐리게 + '지난 회차' 로 표시된다. */
    const rounds = item.rounds || [];
    if (!rounds.length) return `<div class="sup-foot-muted">올해 일정이 아직 공개되지 않았어요.</div>`;

    const liveIdx = rounds.findIndex(r => r.phase !== 'closed');
    const idx = Math.min(certRound ?? (liveIdx >= 0 ? liveIdx : rounds.length - 1), rounds.length - 1);
    const r = rounds[idx];
    const done = r.phase === 'closed';

    const tabs = rounds.map((x, i) => `<button type="button"
      class="sup-rtab${i === idx ? ' on' : ''}${x.phase === 'closed' ? ' is-done' : ''}"
      onclick="SpecUp.setCertRound(${i})">${esc(roundShort(x))}</button>`).join('');

    /* 값이 없는 줄은 그리지 않는다 — 한쪽만 오는 회차가 흔하다(필기만 · 실기만). */
    const row = (label, a, b, extra) => {
      const v = a && b && a !== b ? `${a} ~ ${b}` : (a || b || '');
      return v ? `<tr><th>${esc(label)}</th><td>${esc(v)}</td><td>${extra || ''}</td></tr>` : '';
    };
    const tag = st => st && st.phase === 'open'
      ? `<span class="sup-dday">${dday(daysTo(st.regEnd), { verb: '마감' })}</span>`
      : (st && st.phase === 'upcoming' ? `<span class="sup-dday is-wait">접수 예정</span>` : '');

    const d = r.doc, p = r.prac;
    return `
      <div class="sup-rtabs" id="sup-rtabs">${tabs}</div>
      <div class="sup-round${done ? ' is-done' : ''}">
        <div class="sup-round-head">${esc(r.label || '')}${done ? ' <span class="sup-sched-done">지난 회차</span>' : ''}</div>
        <table class="sup-schedtable">
          <tbody>
            ${row('필기시험 원서접수', d?.regStart, d?.regEnd, tag(d))}
            ${row('필기시험', d?.examStart, d?.examEnd)}
            ${row('필기시험 합격자발표', d?.passDt, null)}
            ${row('실기시험 원서접수', p?.regStart, p?.regEnd, tag(p))}
            ${row('실기시험', p?.examStart, p?.examEnd)}
            ${row('합격자발표', p?.passDt, null)}
          </tbody>
        </table>
      </div>`;
  }

  /* 탭에 붙일 짧은 이름. 회차 이름을 통째로 넣으면 한 줄에 하나도 못 들어간다.

     ── 자격 종류마다 '회차' 의 단위가 다르다 (실측 2026-09-11) ──
     국가기술자격: '국가기술자격 기사 (2026년도 제3회)'      → 3회
     국가전문자격: '전문자격 (2026년도 35회 1차)'            → 1차
     전문자격은 **한 회차 안에서 1·2·3차**로 나뉜다. 회차 번호(35)로 이름을 지으면
     탭 세 개가 전부 '35회' 가 되어 무엇을 고르는지 알 수 없다(실측: 공인노무사). */
  function roundShort(r) {
    const label = r.label || '';
    const round = /제\s*(\d+)\s*회/.exec(label);
    if (round) return `${round[1]}회`;
    const step = /(\d+)\s*차/.exec(label);
    if (step) return `${step[1]}차`;
    return r.seq ? `${r.seq}회` : '회차';
  }

  /* 서버가 준 daysTo* 는 '지금 눈여겨볼 단계' 기준이라, 표의 각 줄에는 맞지 않는다.
     줄마다 그 날짜로 다시 센다. */
  function daysTo(dateStr) {
    if (!dateStr) return null;
    const a = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const b = Date.parse(dateStr + 'T00:00:00Z');
    return Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
  }

  function openCertModal(name) {
    const all = (catalog && catalog.ok) ? catalog.certs : [];
    const cert = all.find(c => c.id === name);
    if (!cert) return;
    certModal = { cert, exam: { loading: true } };
    certRound = null;                            // 종목이 바뀌면 탭 선택도 처음으로
    render();

    const seq = ++examSeq;                       // 목록 쪽 요청과 같은 번호를 쓴다(늦은 답 버리기)
    DB.specupExams([name]).then(res => {
      if (seq !== examSeq || !certModal || certModal.cert.id !== name) return;
      certModal.exam = res;
      render();
    }).catch(e => {
      if (!certModal || certModal.cert.id !== name) return;
      certModal.exam = { ok: false, error: e.message };
      render();
    });
  }

  function closeCertModal() { certModal = null; render(); }

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
        <div class="page-eyebrow">2단계 · 스펙UP</div>
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
    /* ── 자격증은 로그인 전에도 둘러볼 수 있다 (2026-09-11) ──────────────────
       예전에는 판정이 안 되면(로그인 전·스펙 없음) 자물쇠 화면으로 막았다. 그런데
       **국가자격 목록은 누구에게나 공개된 자료**고, 처음 온 사람이 "여기 뭐가 있나"
       를 보는 자리이기도 하다. 추천(내게 부족한 것)만 로그인이 필요하다. */
    if (tab === 'cert') return certTab(resolved);
    /* 어학도 같다 — TOEIC·OPIc 네 칸은 고정 목록이고 공식 접수 페이지로 보내는 게
       전부라, 로그인 전에도 볼 수 있어야 한다. 내 점수·선배 평균만 로그인이 필요하다. */
    if (tab === 'lang') return langTab(resolved.ok ? resolved.ctx : { spec: {}, agg: {} });
    return blocked(resolved);
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
  function certTab(resolved) {
    /* 판정이 안 되는 상태(로그인 전·스펙 없음)에서는 둘러보기만 준다.
       추천을 보려면 스펙이 필요하다는 안내는 한 줄로 붙인다 — 자물쇠로 막지 않는다. */
    if (!resolved || !resolved.ok) { requestCatalog(); return certBrowse(); }
    const ctx = resolved.ctx;
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

    /* ── 빈 화면 대신 둘러보기 (사용자 지시 2026-09-11) ──────────────────────
       예전에는 여기서 "데이터가 쌓이면 보여드릴게요" 한 줄로 끝났다. 선배 스펙이
       아직 없어서 **모든 직무군이 이 경로로 떨어졌고**, 스펙업에 올 이유가 없었다.
       추천이 없다고 자격증까지 감출 이유는 없다 — 카탈로그를 펼쳐 둔다. */
    if (!rows.length) {
      requestCatalog();
      return certBrowse();
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

  /* ── 자격증 카탈로그 ──────────────────────────────────────────
     643종을 한 번만 받아 들고 있는다. 이름·구분·분야·시행기관만 담긴 목록이라
     가볍고, 탭을 옮길 때마다 다시 부를 이유가 없다. */
  function requestCatalog() {
    if (catalog) return;
    catalog = { loading: true };
    DB.certCatalog()
      .then(res => { catalog = { ok: true, certs: res.certs || [] }; if (tab === 'cert') render(); })
      .catch(e => { catalog = { ok: false, error: e.message }; if (tab === 'cert') render(); });
  }

  /* 지금 조건(분야·검색)에 맞는 자격증. 정렬은 이름순 그대로 둔다 —
     '인기순' 같은 것을 만들려면 근거가 있어야 하는데, 그 근거(선배 보유율)가
     없어서 이 화면이 생긴 것이다. 없는 기준을 지어내지 않는다. */
  /* ── 시험일정을 붙일 수 없는 자격은 목록에서 뺀다 (사용자 지시 2026-09-11) ──
     종목코드가 없는 30종(ADsP·AWS SAA·CFA·AFPK …)은 민간·해외 자격이라 국가자격
     시험일정 API 에 없고, 민간자격 시험일정을 모아 주는 공개 API 도 없다(직능원
     민간자격 정보는 등록정보만 주고 일정이 없다. 해외자격은 국내 등록 자체가 없다).
     그래서 눌러도 이름과 시행기관만 나온다 — 이 화면이 약속하는 '언제 신청하나' 에
     답하지 못한다. 카드가 섞여 있으면 눌러 보고 나서야 알게 되므로 아예 빼 둔다.
     (스펙 입력의 자격증 검색에는 그대로 남아 있다. 거기는 '내가 가진 것' 을 적는
      자리라 민간자격도 필요하다.) */
  const schedulable = c => !!c.code;

  function certsNow() {
    const all = (catalog && catalog.ok) ? catalog.certs.filter(schedulable) : [];
    const q = certQuery.trim().toLowerCase();
    return all.filter(c =>
      (!certField || c.field === certField) &&
      (!q || String(c.id).toLowerCase().includes(q)));
  }

  function certFields() {
    const all = (catalog && catalog.ok) ? catalog.certs.filter(schedulable) : [];
    const n = {};
    for (const c of all) if (c.field) n[c.field] = (n[c.field] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }

  /* 둘러보기 화면. 추천이 안 될 때 이 자리를 채운다. */
  function certBrowse() {
    if (!catalog || catalog.loading) {
      return notice('⏳', '자격증 목록을 불러오는 중…', '잠시만 기다려 주세요.');
    }
    if (!catalog.ok) {
      return notice('⚠️', '자격증 목록을 불러오지 못했어요', esc(catalog.error || ''));
    }

    const rows = certsNow();
    const pages = Math.max(1, Math.ceil(rows.length / CERT_PER_PAGE));
    const page = Math.min(certPage, pages);
    const shown = rows.slice((page - 1) * CERT_PER_PAGE, page * CERT_PER_PAGE);

    const chips = certFields().map(([f, n]) =>
      `<button type="button" class="sup-fchip${certField === f ? ' on' : ''}"
        onclick="SpecUp.setCertField('${esc(f).replace(/'/g, '&#39;')}')">${esc(f)} <b>${n}</b></button>`).join('');

    return `
      <div class="sup-certbar">
        <label class="sup-certsearch">
          <i class="ti ti-search"></i>
          <input type="search" id="sup-cert-q" value="${esc(certQuery)}" placeholder="자격증 이름으로 찾기"
            oninput="SpecUp.setCertQuery(this.value)" />
        </label>
        <div class="sup-chipbar">
          <button type="button" class="sup-fchip${certField ? '' : ' on'}" onclick="SpecUp.setCertField('')">전체 <b>${catalog.certs.filter(schedulable).length}</b></button>
          ${chips}
        </div>
      </div>
      ${rows.length
        ? listHead(rows.length) + grid(shown.map(browseCard)) + pager(page, pages)
        : notice('🔍', '조건에 맞는 자격증이 없어요', '검색어나 분야를 바꿔 보세요.')}`;
  }

  function pager(page, pages) {
    if (pages <= 1) return '';
    return `<div class="sup-pager">
      <button type="button" class="pg-arrow" onclick="SpecUp.setCertPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>
        <i class="ti ti-chevron-left"></i> 이전</button>
      <span class="sup-pager-now">${page} / ${pages}</span>
      <button type="button" class="pg-arrow" onclick="SpecUp.setCertPage(${page + 1})" ${page === pages ? 'disabled' : ''}>
        다음 <i class="ti ti-chevron-right"></i></button>
    </div>`;
  }

  /* 둘러보기 카드. 추천 카드(certCard)와 달리 **선배 보유율 배지가 없다** —
     그 값이 없어서 이 화면이 생겼으므로, 없는 숫자를 자리만 채우려고 적지 않는다.
     누르면 링크로 나가지 않고 모달을 연다(자세한 값은 그 안에 있다). */
  function browseCard(c) {
    const mine = (lastCtx?.spec?.certs || []).includes(c.id);
    return card({
      emoji: '📜',
      coverTag: c.kindLabel || '',
      palKey: c.id,
      badges: [
        c.grade ? { text: c.grade, cls: '' } : null,
        mine ? { text: '보유', cls: 'is-have' } : null,
      ],
      title: c.id,
      org: c.issuer || '',
      foot: `<span class="sup-foot-txt">${esc(c.midField || c.field || '')}</span>`,
      openCert: c.id,
      cta: '자세히',
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
  /* ── 목록은 CAS 가 단일 출처다 (사용자 지시 2026-09-11) ────────────────────
     예전에는 여기 네 줄을 따로 박아 뒀다. 그래서 **스펙 입력에는 있는 TEPS·G-TELP·
     TOPIK 과 제2외국어 7종이 이 화면에만 없었다** — 같은 목록이 두 벌이면 반드시 갈린다.
     `CAS.LANG_TESTS`(영어 등 7종)와 `CAS.FOREIGN_TESTS`(제2외국어 7종)를 그대로 쓴다.
     여기서 더하는 것은 **접수 페이지 주소뿐**이다. 주소를 모르는 시험은 안 적는다 —
     추측한 주소로 보내면 엉뚱한 데로 데려간다.

     ── 시험 일정 API 가 없다 ──
     시행기관(YBM·크레듀·ETS·일본국제교류기금 …)이 공개 API 를 열지 않는다. 국가자격
     시험일정에도 없다. 없는 것을 있는 척 정적 표로 박아 두면 다음 달에 조용히 틀린
     날짜가 된다 — 이 저장소가 제일 경계하는 부류라 넣지 않았다. 공식 페이지로 보낸다. */
  const LANG_URLS = {
    toeic:         'https://exam.toeic.co.kr',
    toeicSpeaking: 'https://exam.toeic.co.kr',
    opic:          'https://www.opic.or.kr',
    toefl:         'https://www.ets.org/toefl',
    teps:          'https://www.teps.or.kr',
    gtelp:         'https://www.gtelp.co.kr',
    topik:         'https://www.topik.go.kr',
    jlpt:          'https://www.jlpt.or.kr',
    /* JPT·SJPT·TSC 는 YBM 이 시행한다. 주소는 jpt.co.kr 공식 페이지의 링크에서
       확인했다(추측하지 않았다 — ybmsjpt / ybmtsc 로 따로 있다). */
    jpt:           'https://www.jpt.co.kr',
    sjpt:          'https://www.ybmsjpt.co.kr',
    opicJa:        'https://www.opic.or.kr',
    tsc:           'https://www.ybmtsc.co.kr',
    opicZh:        'https://www.opic.or.kr',
    hsk:           'https://www.hsk.or.kr',
    hskk:          'https://www.hsk.or.kr',
    /* DELF·DALF 는 확실한 공식 접수 주소를 못 찾았다(delfdalf.kr 는 응답 없음).
       추측한 주소로 보내면 엉뚱한 데로 데려가므로 **링크를 안 건다.** */
    dele:          'https://seul.cervantes.es',
    goethe:        'https://www.goethe.de/ins/kr/ko/sta/seo.html',
    torfl:         'https://www.torfl.kr',
  };

  function langTab(ctx) {
    const mine = ctx.spec?.scores || {};
    const peer = ctx.agg?.scores || {};

    /* 영어 등 점수·등급 시험. 선배 평균이 있으면 차이를 말하고, 없으면 내 기록만 둔다. */
    const langCards = (CAS.LANG_TESTS || []).map(t => {
      const p = peer[t.id];
      const m = mine[t.id];
      const unit = t.kind === 'score' ? '점' : '';
      const gap = (typeof p?.avg === 'number' && typeof m === 'number') ? p.avg - m : null;
      const status = m == null || m === ''
        ? { text: '미응시', cls: 'is-lack' }
        : gap == null
          ? { text: '보유', cls: 'is-have' }
          : gap > 0 ? { text: `${gap}${unit} 부족`, cls: 'is-lack' }
                    : { text: '평균 이상', cls: 'is-have' };

      return card({
        emoji: '🗣️',
        coverTag: '어학',
        palKey: t.label,
        badges: [status, p ? { text: `표본 ${p.n}명`, cls: 'is-peer' } : null],
        title: t.label,
        org: p ? `선배 평균 ${p.avg}${unit}` : '',
        foot: `<span class="sup-foot-txt">내 기록 <b>${m == null || m === '' ? '없음' : esc(String(m)) + unit}</b></span>`,
        url: LANG_URLS[t.id],
        cta: LANG_URLS[t.id] ? '접수' : null,
      });
    });

    /* ── 제2외국어 (사용자 지시 2026-09-11) ─────────────────────────────────
       스펙 입력에는 진작부터 있었는데(`scores.foreign`) 이 화면에만 없었다.
       점수가 아니라 **등급**으로만 받고, CAS 어학 점수에는 반영되지 않는다
       (cas.js FOREIGN_TESTS 주석 — 반영하려면 별도 배점 설계가 필요하다).
       그래서 '부족/평균 이상' 을 말하지 않는다. 있으면 등급을, 없으면 미응시를 둔다. */
    const myForeign = new Map((mine.foreign || [])
      .filter(x => x && x.test).map(x => [x.test, x.level || '']));

    const foreignCards = (CAS.FOREIGN_TESTS || []).map(t => {
      const v = myForeign.get(t.id);
      /* JPT 처럼 점수제인 시험이 섞여 있다 — 등급 범위를 적을 수 없으므로 만점을 적는다. */
      const scale = t.kind === 'score'
        ? `${t.max}점 만점`
        : `등급 ${t.levels[0]} ~ ${t.levels[t.levels.length - 1]}`;
      const shown = v ? (t.kind === 'score' ? `${v}점` : v) : '';
      return card({
        emoji: '🌏',
        coverTag: '제2외국어',
        palKey: t.label,
        badges: [shown ? { text: shown, cls: 'is-have' } : { text: '미응시', cls: 'is-lack' }],
        title: t.label,
        org: scale,
        foot: `<span class="sup-foot-txt">내 기록 <b>${shown ? esc(shown) : '없음'}</b></span>`,
        url: LANG_URLS[t.id],
        cta: LANG_URLS[t.id] ? '접수' : null,
      });
    });

    return listHead(langCards.length) + grid(langCards)
      + `<div class="sup-subhead">제2외국어</div>`
      + grid(foreignCards)
      + `<div class="sup-src">
        어학시험은 시행기관이 공개 API 를 열지 않아 접수 일정을 자동으로 가져오지 못합니다 —
        ‘접수’ 로 공식 페이지에서 확인하세요.${ctx.scopeLabel ? ` 목표치는 <b>${esc(ctx.scopeLabel)} 선배 평균</b>이에요.` : ''}
        제2외국어는 기록용이라 CAS 점수에는 반영되지 않습니다.
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

    /* ── 페이지 나누기 (2026-09-07, 사용자 지적) ────────────────
       예전에는 `slice(0, 24)` 로 잘라 놓고 **넘길 길이 없었다.** 146건 중 뒤쪽은
       아예 못 봤다. 페이지 번호는 탭마다 따로 기억한다 — 공모전에서 3페이지를
       보다 대외활동으로 갔다가 돌아왔을 때 1페이지로 튕기면 다시 찾아가야 한다. */
    const pages = Math.max(1, Math.ceil(sorted.length / ACT_PER_PAGE));
    /* 필터를 좁혀 결과가 줄면 지금 페이지가 범위를 넘을 수 있다. 그때는 빈 화면이
       아니라 마지막 페이지를 보여준다. */
    const cur = Math.min(Math.max(1, actPage[tab] || 1), pages);
    const from = (cur - 1) * ACT_PER_PAGE;

    return chipBar + listHead(sorted.length, { sortable: true })
      + grid(sorted.slice(from, from + ACT_PER_PAGE).map(actCard))
      + actPagerHtml(cur, pages, sorted.length)
      + srcLine(st);
  }

  /* ── 페이지 넘기기 ──────────────────────────────────────────
     한 페이지뿐이면 아예 안 그린다 — 늘 떠 있으면 배경이 되어 아무도 안 본다.
     번호는 현재 쪽 둘레만 보여준다(1 … 4 5 6 … 12). 146건이면 7쪽이라 지금은
     다 들어가지만, 데이터가 늘면 번호가 줄을 넘어간다. */
  function actPagerHtml(cur, pages, total) {
    if (pages <= 1) return '';
    const nums = [];
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - cur) <= 2) nums.push(n);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    const btn = (label, to, opt = {}) => opt.disabled
      ? `<span class="sup-page is-off">${label}</span>`
      : `<button type="button" class="sup-page ${opt.on ? 'on' : ''}"
                 onclick="SpecUp.setActPage(${to})">${label}</button>`;

    return `<div class="sup-pager">
      ${btn('‹', cur - 1, { disabled: cur === 1 })}
      ${nums.map(n => n === '…'
        ? '<span class="sup-page is-gap">…</span>'
        : btn(n, n, { on: n === cur })).join('')}
      ${btn('›', cur + 1, { disabled: cur === pages })}
      <span class="sup-pager-n">${total}건 중 ${cur}/${pages} 쪽</span>
    </div>`;
  }

  /* ── 출처 줄 ────────────────────────────────────────────────
     소스가 둘이 됐다(2026-09-06). **어디서 몇 건이 왔는지 적고 링크를 건다** —
     위비티가 모아 편집한 목록을 우리가 모은 것처럼 보이면 안 된다. 원문을 읽는
     자리도 그쪽이다.

     표지 설명도 바뀌었다. 예전에는 "포스터 이미지가 없어 색만 정해 그린다"고 적었는데,
     이제 주관기관 홈페이지에서 로고를 받아 붙인다. 다만 **여전히 없는 카드가 있다** —
     그걸 숨기지 않고 그대로 적는다. */
  function srcLine(st) {
    const list = (st.sources || []).length
      ? st.sources.map(x => x.url
          ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a> ${x.count}건`
          : `${esc(x.name)} ${x.count}건`).join(' · ')
      : esc(st.source || '');
    return `<div class="sup-src">출처: ${list} · 표지는 주관기관 로고이고,
      로고를 못 찾은 곳은 이름에서 색만 정해 그립니다(없는 그림을 지어내지 않습니다).</div>`;
  }

  function actCard(a) {
    const d = daysTo(a.endDate);
    const foot = a.endDate
      ? `${dday(d, { verb: '마감' })}<span class="sup-foot-txt">~${esc(a.endDate)}</span>`
      : (a.period ? `<span class="sup-dday is-wait">상시</span>` : '<span class="sup-foot-muted">기간 미상</span>');

    return card({
      /* **이모지를 안 넘긴다** (사용자 지시 2026-09-07 "트로피 이모지 다 빼줄래").
         로고와 나란히 찍혀 로고를 가운데에서 밀어냈다. 로고도 포스터도 없으면
         표지는 이름에서 정한 색만 남는다 — 그 편이 트로피가 반복되는 것보다 낫다.
         (마감 임박 줄의 🏆 는 그대로 둔다. 거기서는 자격증 📜 와 종류를 가르는
          표시라 지우면 뜻이 없어진다.) */
      poster: a.poster || null,
      logo: a.logo || null,
      /* ── 표지에는 지역을 올린다 (사용자 지시) ────────────────────
         예전에는 키워드 첫 개를 올렸는데, 그 값은 정책 분류라('보조금'·
         '장기미취업청년') 공모전 카드에서 읽을 것이 못 됐다. 게다가 아래 배지가
         같은 배열을 읽어서 **첫 키워드가 두 번 찍혔다**
         ('장기미취업청년 / 장기미취업청년 / 보조금').

         지금 잡히는 정책은 지자체 것에 몰려 있다(광주·울산·인천…). 지역을 안 적으면
         학생이 남의 동네 공고를 열어 보고 나서야 안다 — 표지에서 바로 걸러지게 한다.
         지역을 모르면 예전처럼 키워드로 물러선다(칸을 비우면 표지가 허전해진다).

         ── 물러설 때 배지도 한 칸 밀어야 한다 (2026-09-06) ──
         위비티 항목에는 지역이 없어서(그 사이트가 안 준다) 표지가 키워드로 물러나는데,
         배지가 같은 배열을 처음부터 읽어 **첫 키워드가 또 두 번 찍혔다**
         ('예체능/미술/음악 / 예체능/미술/음악'). 22-7 에서 고친 것과 똑같은 모양이
         새 소스에서 되살아났다 — 그때는 지역이 늘 있어서 안 드러났을 뿐이다.
         표지가 키워드를 가져갔으면 배지는 **그다음부터** 시작한다. */
      coverTag: a.region || (a.keywords || [])[0] || '',
      palKey: a.name,
      badges: (a.keywords || []).slice(a.region ? 0 : 1, a.region ? 2 : 3).map(k => ({ text: k })),
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

  /* 둘러보기 조작. 이 파일은 이벤트 위임 대신 onclick + 공개 메서드를 쓴다 —
     render 가 innerHTML 을 통째로 갈아끼우므로 붙여 둔 핸들러가 매번 날아간다. */
  function setCertField(v) { certField = v || null; certPage = 1; render(); }
  function setCertPage(p)  { certPage = Math.max(1, p); render(); }
  function setCertRound(i) { certRound = Math.max(0, i); render(); }
  /* 검색은 다시 그린 뒤 **커서를 되돌려 놓는다.** 안 그러면 한 글자 칠 때마다
     포커스가 빠져서 입력이 끊긴다. */
  function setCertQuery(v) {
    certQuery = v; certPage = 1; render();
    const box = document.getElementById('sup-cert-q');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }

  return { onEnter, switchTab, setFilter, setSort, setActPage, render,
           openCert: openCertModal, closeCert: closeCertModal,
           setCertField, setCertPage, setCertQuery, setCertRound };
})();
