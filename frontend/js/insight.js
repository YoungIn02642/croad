// ════════════════════════════════════════════════════════════
//  C:road — 커리어 인사이트 (정보를 주고받는 커뮤니티 게시판)
//   • 목록(카테고리·페이지) → 상세(본문+댓글) → 글쓰기, 세 화면을 한 페이지 안에서
//     전환한다. 다른 로드맵/자소서 페이지처럼 컨테이너 하나를 innerHTML 로 갈아끼운다.
//   • 카테고리 목록은 서버가 단일 출처다(routes/insight.js CATEGORIES) — 여기서는
//     한 번 받아 캐시해 두고 화면에 그대로 쓴다.
// ════════════════════════════════════════════════════════════
window.Insight = (() => {
  let categories = [];      // [{id,label}], onEnter 에서 한 번 받는다
  let view = 'list';        // 'list' | 'detail' | 'write'
  let category = '';        // '' = 전체
  let page = 1;
  const LIMIT = 20;
  let listData = { posts: [], total: 0 };
  /* 검색 — q 가 비면 평소 목록이다.
     검색 중에는 서버가 공지를 위로 고정하지 않는다(routes/insight.js 주석).

     ── 범위 목록은 서버와 짝이다 ──
     id 는 `routes/insight.js` 의 SEARCH_SCOPES 와 정확히 같아야 한다. 한쪽만
     늘리면 모르는 값이 들어와 **조용히 기본값으로 떨어진다** — 사용자는 범위를
     골랐는데 결과가 안 바뀌는 것으로 보인다.

     기본값이 'all'(제목+내용)인 이유: 처음 온 사람은 범위를 고를 생각을 안 하므로
     가장 넓게 잡아 두는 편이 "왜 안 나오지" 를 줄인다. */
  const SCOPES = [
    ['all',     '제목+내용'],
    ['title',   '제목'],
    ['body',    '내용'],
    ['author',  '글쓴이'],
    ['comment', '댓글'],
  ];
  const scopeLabel = id => (SCOPES.find(([s]) => s === id) || SCOPES[0])[1];

  let q = '';
  let scope = 'all';
  let currentPostId = null;
  let detailData = null;    // { post, comments }
  let writeError = '';
  /* 글쓰기 칸에 적던 값. 오류가 나면 화면을 다시 그리는데, 그때 사라지면 안 된다 —
     프롬프트 원문은 수천 자짜리라 다시 붙여넣게 하면 그 자리에서 포기한다. */
  let writeDraft = { category: '', title: '', body: '', promptText: '' };

  /* AI 프롬프트 카테고리 — 서버(routes/insight.js CATEGORIES)와 같은 id 여야 한다.
     라벨은 서버에서 받은 것을 쓰고, 여기서는 '이 글이 프롬프트인가' 만 본다. */
  const PROMPT_CAT = 'prompt';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = d => (d || '').slice(0, 16);
  const catLabel = id => categories.find(c => c.id === id)?.label || id;

  function root() { return document.getElementById('insight-root'); }

  /* 다른 화면이 "이 글을 열어라" 하고 넘길 때 쓰는 자리. 홈의 커리어 인사이트
     카드가 쓴다. 회사 찾기의 `careerly_company_open` 과 같은 규약이다 —
     navigate() 와 onEnter() 의 순서에 기대지 않으려고 키로 주고받는다. */
  const LS_OPEN = 'careerly_insight_open';

  async function onEnter() {
    if (!categories.length) {
      try { categories = (await DB.insightCategories()).categories; }
      catch { categories = []; }
    }
    view = 'list'; page = 1; category = ''; q = ''; scope = 'all';

    /* 넘겨받은 글이 있으면 목록 대신 그 글부터 연다. 키는 한 번 쓰고 지운다 —
       남겨 두면 다음에 인사이트를 눌렀을 때도 같은 글이 열려서, 목록으로
       돌아갈 수 없는 것처럼 보인다(회사 찾기에서 실제로 겪은 문제와 같다). */
    let handoff = null;
    try {
      handoff = localStorage.getItem(LS_OPEN);
      if (handoff) localStorage.removeItem(LS_OPEN);
    } catch { /* 프라이빗 모드 */ }

    if (handoff) { await openPost(handoff); return; }
    await loadList();
  }

  async function loadList() {
    const box = root();
    if (box) box.innerHTML = loadingHtml();
    try {
      listData = await DB.listInsights({ category, page, limit: LIMIT, q, scope });
    } catch (e) {
      if (box) box.innerHTML = errorHtml(e.message);
      return;
    }
    render();
  }

  function render() {
    const box = root();
    if (!box) return;
    if (view === 'detail') box.innerHTML = detailHtml();
    else if (view === 'write') box.innerHTML = writeHtml();
    else box.innerHTML = listHtml();
    bindEvents();
  }

  function loadingHtml() {
    return `<div class="insight-loading"><i class="ti ti-loader-2"></i> 불러오는 중…</div>`;
  }
  function errorHtml(msg) {
    return `<div class="insight-error"><i class="ti ti-alert-circle"></i> ${esc(msg)}</div>`;
  }

  // ── 목록 ────────────────────────────────────────────────────
  function listHtml() {
    const user = DB.currentUser();
    const tabs = [{ id: '', label: '전체' }, ...categories];
    const pages = Math.max(1, Math.ceil(listData.total / LIMIT));

    return `
      <div class="page-head">
        <div class="page-eyebrow">Career Insight</div>
        <h1 class="page-title">커리어 인사이트</h1>
        <p class="page-desc">취업·인턴·자격증처럼 <b>정보가 될 만한 것</b>을 서로 나누는 공간이에요.
          궁금한 걸 묻고, 아는 걸 나눠주세요.</p>
      </div>

      <div class="insight-toolbar">
        <div class="insight-tabs">
          ${tabs.map(t => `<button class="insight-tab ${category === t.id ? 'on' : ''}" data-cat="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
        </div>
        ${user
          ? `<button class="btn-brand insight-write-btn" id="insight-write-open"><i class="ti ti-pencil"></i> 글쓰기</button>`
          : `<span class="insight-login-hint">로그인하면 글을 쓸 수 있어요</span>`}
      </div>

      <!-- 검색 — 범위 · 검색어 · 버튼 순서다. 게시판에서 흔히 쓰는 배치라
           설명 없이도 어디를 고르고 어디에 치는지 바로 읽힌다.

           범위를 버튼 두 개(제목만 / 제목+내용)로 두었었는데, 늘려야 할 범위가
           다섯이라 버튼으로는 줄이 넘친다. 목록에서 하나를 고르는 일이므로
           <select> 가 맞다 — 모바일에서 기본 선택기가 뜨는 이점도 있다. -->
      <div class="insight-search">
        <label class="insight-scope-wrap">
          <span class="sr-only">검색 범위</span>
          <select id="insight-scope" class="insight-scope-select">
            ${SCOPES.map(([id, label]) =>
              `<option value="${id}" ${scope === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="insight-search-box">
          <input type="search" id="insight-q" value="${esc(q)}"
                 placeholder="검색어를 입력해주세요" aria-label="게시글 검색" />
        </label>
        <button class="insight-search-btn" id="insight-search-go">검색</button>
      </div>

      ${q ? `<div class="insight-search-note">
          <b>‘${esc(q)}’</b> ${esc(scopeLabel(scope))} 검색 결과 ${listData.total}건
          ${listData.total ? ' · 검색 중에는 공지를 위로 고정하지 않아요' : ''}
          <button class="insight-search-clear" id="insight-search-clear">
            <i class="ti ti-x"></i> 검색 해제</button>
        </div>` : ''}

      ${category === PROMPT_CAT ? promptIntroHtml() : ''}

      <div class="insight-list">
        ${listData.posts.length ? listData.posts.map(postRowHtml).join('') : emptyListHtml()}
      </div>

      ${pages > 1 ? pagerHtml(page, pages) : ''}
    `;
  }

  /* 공지는 카테고리 자리에 '공지' 배지를 놓고 줄 전체를 다르게 칠한다.
     같은 모양에 글자만 다르면 목록을 훑을 때 그냥 지나친다. */
  function postRowHtml(p) {
    return `
      <button class="insight-row ${p.isNotice ? 'is-notice' : ''}" data-open="${esc(p.id)}">
        <span class="insight-row-cat">${p.isNotice
          ? '<i class="ti ti-speakerphone"></i> 공지'
          : esc(catLabel(p.category))}</span>
        <span class="insight-row-body">
          <span class="insight-row-title">${esc(p.title)}
            ${p.commentCount ? `<span class="insight-row-cc">${p.commentCount}</span>` : ''}
          </span>
          <span class="insight-row-preview">${esc(p.preview)}</span>
        </span>
        <span class="insight-row-meta">
          <span>${esc(p.authorName)}</span>
          <span>${fmtDate(p.createdAt)}</span>
          <span><i class="ti ti-eye"></i> ${p.viewCount}</span>
          ${p.hasPrompt ? promptStatsHtml(p) : ''}
        </span>
        ${p.hasPrompt ? promptRowActionsHtml(p) : ''}
      </button>`;
  }

  /* ── 프롬프트 글의 숫자 세 개 (2026-09-07, 사용자 지시) ────────
     담기 · 북마크 · 평점. **0은 안 그린다** — 새 글마다 '0 0 0' 이 붙어 있으면
     목록이 실패한 것들의 나열처럼 보인다.

     평점은 **평가가 모자라면 별을 안 그린다.** 1명이 별 5개를 준 글에 '5.0' 을
     달면 실제보다 훨씬 단단한 숫자로 읽힌다 — 서버가 그 판단을 해서 ratingAvg 를
     null 로 준다(insight.js RATING_MIN_VOTES). 그때는 '평가 N명' 만 적는다. */
  function promptStatsHtml(p) {
    const bits = [];
    if (p.copyCount) bits.push(
      `<span title="담아 간 사람"><i class="ti ti-download"></i> ${p.copyCount}</span>`);
    if (p.bookmarkCount) bits.push(
      `<span title="북마크"><i class="ti ti-bookmark"></i> ${p.bookmarkCount}</span>`);
    if (p.ratingAvg != null) bits.push(
      `<span title="평점 (${p.ratingCount}명)"><i class="ti ti-star-filled"></i> ${p.ratingAvg.toFixed(1)}</span>`);
    else if (p.ratingCount) bits.push(
      `<span title="아직 평균을 내기엔 평가가 적어요">평가 ${p.ratingCount}명</span>`);
    return bits.join('');
  }

  /* ── 목록에서 바로 담기 (사용자 지시) ────────────────────────
     예전에는 상세로 들어가야만 담을 수 있었다. 프롬프트는 제목·담긴 수만 보고
     고르는 일이 많아서, 한 단계를 없앤다.

     줄 전체가 `<button>` 이라 안쪽 버튼의 클릭이 위로 새면 상세가 같이 열린다.
     그래서 `<span role="button">` 으로 두고 핸들러에서 `stopPropagation` 한다. */
  function promptRowActionsHtml(p) {
    const taken = p.taken;
    return `<span class="insight-row-actions">
      <span role="button" tabindex="0" class="insight-row-take ${taken ? 'is-on' : ''}"
            data-take="${esc(p.id)}" title="${taken ? '이미 담았어요' : '내 프롬프트로 담기'}">
        <i class="ti ${taken ? 'ti-check' : 'ti-download'}"></i>${taken ? ' 담김' : ' 담기'}
      </span>
      <span role="button" tabindex="0" class="insight-row-bm ${p.bookmarked ? 'is-on' : ''}"
            data-bookmark="${esc(p.id)}" title="${p.bookmarked ? '북마크 해제' : '북마크'}">
        <i class="ti ${p.bookmarked ? 'ti-bookmark-filled' : 'ti-bookmark'}"></i>
      </span>
    </span>`;
  }

  /* 프롬프트 게시판이 무엇을 하는 곳인지 한 번 말해 준다. 다른 카테고리와 달리
     '글을 읽는 곳'이 아니라 **가져다 쓰는 곳**이라, 모르면 그냥 글로만 읽고 나간다. */
  function promptIntroHtml() {
    return `<div class="insight-prompt-intro">
      <b><i class="ti ti-sparkles"></i> AI 프롬프트 공유</b>
      <p>자소서 초안을 쓸 때 AI 에게 주는 <b>규칙</b>을 서로 나누는 칸이에요.
        마음에 드는 글에서 <b>내 프롬프트로 담기</b>를 누르면
        <b>회사·자소서 → 자소서 코치</b>의 ‘내 AI 프롬프트’ 목록에 그대로 들어가고,
        AI 초안이 그 규칙으로 나옵니다.</p>
    </div>`;
  }

  function emptyListHtml() {
    /* 검색 결과가 없는 것과 글이 아직 없는 것은 사용자가 할 일이 다르다. */
    if (q) {
      return `<div class="empty-block"><div class="empty-icon">🔍</div>
        <div class="empty-title">‘${esc(q)}’ 검색 결과가 없어요</div>
        <div class="empty-desc">${scope === 'all'
          ? '다른 낱말로 찾아보거나 검색을 해제해 보세요.'
          : `지금은 <b>${esc(scopeLabel(scope))}</b>만 찾고 있어요. <b>제목+내용</b>으로 넓혀 보세요.`}
        </div></div>`;
    }
    return `<div class="empty-block"><div class="empty-icon">📭</div>
      <div class="empty-title">아직 글이 없어요</div>
      <div class="empty-desc">이 카테고리에 첫 글을 남겨보세요.</div></div>`;
  }

  function pagerHtml(cur, pages) {
    const nums = [];
    for (let n = Math.max(1, cur - 2); n <= Math.min(pages, cur + 2); n++) nums.push(n);
    return `<div class="pager">
      <button class="pg-arrow" ${cur === 1 ? 'disabled' : ''} data-page="${cur - 1}"><i class="ti ti-chevron-left"></i> 이전</button>
      ${nums.map(n => `<button class="pg-num ${n === cur ? 'on' : ''}" data-page="${n}">${n}</button>`).join('')}
      <button class="pg-arrow" ${cur === pages ? 'disabled' : ''} data-page="${cur + 1}">다음 <i class="ti ti-chevron-right"></i></button>
    </div>`;
  }

  // ── 상세 ────────────────────────────────────────────────────
  async function openPost(id) {
    currentPostId = id;
    view = 'detail';
    const box = root();
    if (box) box.innerHTML = loadingHtml();
    try {
      detailData = await DB.getInsight(id);
    } catch (e) {
      if (box) box.innerHTML = errorHtml(e.message);
      return;
    }
    render();
  }

  function detailHtml() {
    const { post, comments } = detailData;
    const user = DB.currentUser();
    const mine = user && user.id === post.authorId;

    return `
      <button class="insight-back" id="insight-back"><i class="ti ti-arrow-left"></i> 목록으로</button>
      <article class="insight-post">
        <div class="insight-post-cat">${esc(catLabel(post.category))}</div>
        <h1 class="insight-post-title">${esc(post.title)}</h1>
        <div class="insight-post-meta">
          <span>${esc(post.authorName)}</span>
          <span>${fmtDate(post.createdAt)}</span>
          <span><i class="ti ti-eye"></i> ${post.viewCount}</span>
        </div>
        <!-- 본문은 마크다운이다(사용자 지시). Markdown.render 가 **escape 를 먼저 하고**
             아는 문법만 태그로 바꾼다 — 여기서 esc() 를 한 번 더 씌우면 태그가 글자로 보인다.
             안전성의 근거는 test/markdown.test.js 의 XSS 절이다. -->
        <div class="insight-post-body insight-md">${Markdown.render(post.body)}</div>
        ${promptBoxHtml(post, user)}
        ${mine ? `<div class="insight-post-actions">
          <button class="topbar-link" id="insight-delete-post"><i class="ti ti-trash"></i> 삭제</button>
        </div>` : ''}
      </article>

      <!-- 댓글 — 숫자와 적는 칸만 둔다 (사용자 지시 2026-09-05).
           빼기로 한 두 줄:
             · '아직 댓글이 없어요' — 빈 목록은 이미 '댓글 0' 이 말한다. 같은 말을
               두 번 하면서 적는 칸을 아래로 밀어낸다.
             · '로그인하면 댓글을 남길 수 있어요' — 안 그래도 로그인은 눌러 보면
               안다. 비로그인에게 칸을 아예 안 보여주면 "여기서 뭘 할 수 있는지"가
               사라지므로, 칸은 그대로 두고 누르는 순간 로그인으로 보낸다. -->
      <div class="insight-comments">
        <div class="section-title">댓글 ${comments.length}</div>
        ${comments.length ? `<div class="insight-comment-list">
          ${comments.map(c => commentHtml(c, user)).join('')}
        </div>` : ''}
        <div class="insight-comment-form" id="insight-comment-form">
          <i class="ti ti-message-2" aria-hidden="true"></i>
          <textarea id="insight-comment-input" maxlength="1000"
            placeholder="댓글을 남겨주세요."></textarea>
          <button class="insight-comment-send" id="insight-comment-submit">등록</button>
        </div>
      </div>
    `;
  }

  /* ── 프롬프트 원문 상자 ────────────────────────────────────────
     본문(설명)과 **다른 칸**이다. 여기 있는 글자가 그대로 AI 규칙이 되므로
     마크다운으로 그리지 않고 원문 그대로 보여준다 — `**굵게**` 가 굵어져 버리면
     담아 간 규칙과 화면에 보이던 글이 달라진다.

     담기는 로그인한 사람만 — 담아 간 수를 '사람 수'로 세기 때문이다
     (routes/insight.js /copy 주석). 비로그인은 복사만 한다. */
  function promptBoxHtml(post, user) {
    if (!post.promptText) return '';
    return `
      <section class="insight-prompt-box">
        <div class="insight-prompt-head">
          <b><i class="ti ti-terminal-2"></i> 프롬프트 원문</b>
          <span class="insight-prompt-count">${post.promptText.length.toLocaleString()}자${
            post.copyCount ? ` · ${post.copyCount}명이 담아 갔어요` : ''}</span>
        </div>
        <pre class="insight-prompt-text" id="insight-prompt-text">${esc(post.promptText)}</pre>
        <div class="insight-prompt-actions">
          ${user
            ? `<button class="btn-brand" id="insight-prompt-take">
                 <i class="ti ${post.taken ? 'ti-check' : 'ti-download'}"></i>
                 ${post.taken ? '다시 담기' : '내 프롬프트로 담기'}</button>`
            : `<span class="insight-login-hint">로그인하면 내 프롬프트로 담을 수 있어요</span>`}
          <button class="topbar-link" id="insight-prompt-copy"><i class="ti ti-copy"></i> 복사</button>
          ${user
            ? `<button class="topbar-link ${post.bookmarked ? 'is-on' : ''}" id="insight-prompt-bm">
                 <i class="ti ${post.bookmarked ? 'ti-bookmark-filled' : 'ti-bookmark'}"></i>
                 ${post.bookmarked ? '북마크됨' : '북마크'}${
                   post.bookmarkCount ? ` ${post.bookmarkCount}` : ''}</button>`
            : ''}
        </div>
        ${ratingHtml(post, user)}
        <p class="insight-prompt-note">담으면 <b>지금부터 쓰는 모든 자소서 초안</b>에 이 규칙이 적용돼요
          (자소서 코치 사이드바에서 언제든 끄거나 바꿀 수 있어요).</p>
      </section>`;
  }

  /* ── 평점 (2026-09-07, 사용자 지시) ──────────────────────────
     별 다섯 개. 내가 준 점수는 채워서 보여주고, 같은 별을 다시 누르면 취소된다
     (서버가 그렇게 처리한다 — 잘못 눌렀을 때 무를 길이 있어야 한다).

     **평가가 모자라면 평균을 안 그린다.** 1명이 별 5개를 준 글에 '5.0' 을 달면
     실제보다 훨씬 단단한 숫자로 읽힌다. 서버가 그 판단을 해서 ratingAvg 를 null 로
     주고(RATING_MIN_VOTES), 화면은 '평가 N명 · 평균은 N명부터' 로 물러난다.

     **자기 글에는 못 매긴다** — 서버도 막지만 버튼을 아예 안 그려서, 눌러 보고
     거절당하는 일이 없게 한다. */
  function ratingHtml(post, user) {
    const mine = post.myRating || 0;
    const own = user && user.id === post.authorId;

    const summary = post.ratingAvg != null
      ? `<b><i class="ti ti-star-filled"></i> ${post.ratingAvg.toFixed(1)}</b>
         <span class="insight-rating-n">${post.ratingCount}명</span>`
      : post.ratingCount
        ? `<span class="insight-rating-n">평가 ${post.ratingCount}명 ·
             평균은 ${post.ratingMinVotes || 3}명부터 보여드려요</span>`
        : `<span class="insight-rating-n">아직 평가가 없어요</span>`;

    const stars = user && !own
      ? [1, 2, 3, 4, 5].map(n => `
          <button class="insight-star ${n <= mine ? 'is-on' : ''}" data-rate="${n}"
                  title="${n}점${n === mine ? ' (다시 누르면 취소)' : ''}">
            <i class="ti ${n <= mine ? 'ti-star-filled' : 'ti-star'}"></i>
          </button>`).join('')
      : '';

    return `<div class="insight-rating">
      <span class="insight-rating-sum">${summary}</span>
      ${stars ? `<span class="insight-rating-stars">${stars}</span>` : ''}
      ${!user ? '<span class="insight-login-hint">로그인하면 평가할 수 있어요</span>' : ''}
      ${own ? '<span class="insight-rating-n">내 글에는 평점을 매길 수 없어요</span>' : ''}
    </div>`;
  }

  function commentHtml(c, user) {
    const mine = user && user.id === c.authorId;
    return `
      <div class="insight-comment" data-comment="${esc(c.id)}">
        <div class="insight-comment-head">
          <b>${esc(c.authorName)}</b><span>${fmtDate(c.createdAt)}</span>
          ${mine ? `<button class="insight-comment-del" data-del-comment="${esc(c.id)}"><i class="ti ti-x"></i></button>` : ''}
        </div>
        <div class="insight-comment-body">${esc(c.body)}</div>
      </div>`;
  }

  // ── 글쓰기 ──────────────────────────────────────────────────
  function openWrite() {
    if (!DB.currentUser()) return;
    view = 'write';
    writeError = '';
    /* 지금 보고 있던 카테고리로 시작한다 — 프롬프트 탭에서 글쓰기를 누른 사람은
       프롬프트를 올리려는 것이다. '전체'였으면 목록의 첫 카테고리로 떨어진다. */
    writeDraft = { category: category || (categories[0]?.id || ''), title: '', body: '', promptText: '' };
    render();
  }

  /* 화면에 적힌 값을 state 로 걷어 온다. 다시 그리기 전에 부른다 —
     안 그러면 오류 한 번에 쓰던 글이 통째로 사라진다. */
  function readWriteForm() {
    const g = id => document.getElementById(id);
    writeDraft = {
      category: g('insight-write-cat')?.value || writeDraft.category,
      title: g('insight-write-title')?.value ?? writeDraft.title,
      body: g('insight-write-body')?.value ?? writeDraft.body,
      promptText: g('insight-write-prompt')?.value ?? writeDraft.promptText,
    };
    return writeDraft;
  }

  function writeHtml() {
    return `
      <button class="insight-back" id="insight-back"><i class="ti ti-arrow-left"></i> 목록으로</button>
      <div class="page-head">
        <h1 class="page-title">글쓰기</h1>
      </div>
      <div class="insight-write">
        <select id="insight-write-cat">
          ${categories.map(c => `<option value="${esc(c.id)}" ${
            writeDraft.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select>
        <input type="text" id="insight-write-title" maxlength="200" placeholder="제목"
               value="${esc(writeDraft.title)}" />
        <textarea id="insight-write-body" rows="10"
          placeholder="${writeDraft.category === PROMPT_CAT
            ? '이 프롬프트를 왜 만들었는지, 어떤 문항에 잘 듣는지 적어주세요. (원문은 아래 칸에)'
            : '내용을 적어주세요'}">${esc(writeDraft.body)}</textarea>
        ${writeDraft.category === PROMPT_CAT ? promptFieldHtml() : ''}
        <!-- 쓸 수 있는 문법을 적어 둔다. 마크다운이 되는지 모르면 아무도 안 쓰고,
             모르고 쓴 별표가 굵게로 바뀌면 그건 그것대로 놀란다. -->
        <p class="insight-md-hint">
          <b>마크다운</b>으로 쓸 수 있어요 —
          <code>## 제목</code> · <code>**굵게**</code> · <code>- 목록</code> ·
          <code>&gt; 인용</code> · <code>---</code> · <code>[글자](https://…)</code>
        </p>
        ${DB.currentUser()?.isAdmin ? `
          <label class="insight-notice-toggle">
            <input type="checkbox" id="insight-write-notice" />
            <span><b>공지로 올리기</b> — 목록 맨 위에 고정되고 다른 색으로 표시됩니다. 관리자만 보이는 항목이에요.</span>
          </label>` : ''}
        ${writeError ? `<div class="error-box">${esc(writeError)}</div>` : ''}
        <div class="insight-write-actions">
          <button class="btn-save" id="insight-write-submit">등록</button>
          <button class="btn-cancel" id="insight-write-cancel">취소</button>
        </div>
      </div>
    `;
  }

  /* 프롬프트 원문 칸. 본문과 가르는 이유는 insight-prompt.js 머리주석에 있다 —
     여기 적은 글자가 그대로 AI 규칙이 되므로 설명과 섞이면 안 된다.

     ── 내 것부터 꺼내 오게 한다 ──
     공유하려면 자기 프롬프트를 어딘가에서 복사해 와야 하는데, 그것은 자소서 코치
     사이드바에 있다(localStorage). 목록에서 골라 채우면 그 왕복이 없어진다. */
  function promptFieldHtml() {
    const mine = (window.JdCoach?.myPrompts?.() || []);
    const max = window.JdCoach?.PROMPT_LEN_MAX || 8000;
    return `
      <div class="insight-prompt-field">
        <div class="insight-prompt-field-h">
          <b>프롬프트 원문</b>
          ${mine.length ? `
            <select id="insight-prompt-mine" class="insight-prompt-mine">
              <option value="">내 프롬프트에서 불러오기…</option>
              ${mine.map((p, i) => `<option value="${i}">${esc(p.name)}${p.active ? ' (지금 켜짐)' : ''}</option>`).join('')}
            </select>` : ''}
        </div>
        <textarea id="insight-write-prompt" rows="12" maxlength="${max}"
          placeholder="AI 가 초안을 쓸 때 지킬 규칙을 그대로 붙여넣어 주세요.">${esc(writeDraft.promptText)}</textarea>
        <p class="insight-md-hint">이 칸은 <b>있는 그대로</b> 보이고, 담아 가는 사람의
          ‘내 AI 프롬프트’에 그대로 들어갑니다 — 마크다운으로 꾸미지 않아도 돼요.</p>
      </div>`;
  }

  async function submitPost() {
    const d = readWriteForm();
    const isNotice = Boolean(document.getElementById('insight-write-notice')?.checked);
    try {
      const { post } = await DB.createInsight({
        category: d.category,
        title: d.title.trim(),
        body: d.body.trim(),
        isNotice,
        promptText: d.promptText.trim(),
      });
      await openPost(post.id);
    } catch (e) {
      writeError = e.message;
      render();
    }
  }

  /* ── 담기 ────────────────────────────────────────────────────
     localStorage 는 JdCoach 가 소유한다 — 여기서 키를 직접 만지지 않는다
     (jd-coach.js addPrompt 머리주석). 서버에는 '가져간 사람'만 적는다.

     세는 것이 실패해도 담기는 성공이다. 담긴 건 이미 브라우저에 들어갔는데
     '실패' 라고 말하면 사용자가 한 번 더 누른다. */
  /* 로그인이 필요한 동작 앞에서 부른다. **bindEvents 안의 지역 const 였다가
     모듈 스코프로 올렸다** — 목록의 '담기'(takePromptById)가 밖에서 부르는데
     안쪽 변수라 ReferenceError 가 났고, 핸들러가 통째로 죽어서 **눌러도 아무 일도
     안 일어났다.** 에러가 콘솔에만 남는 부류라 화면만 봐서는 원인이 안 보인다. */
  const needLogin = () => {
    if (DB.currentUser()) return false;
    if (typeof navigate === 'function') navigate('login');
    return true;
  };

  /* ── 담기의 알맹이 (목록·상세가 함께 쓴다) ─────────────────
     실제 담기는 브라우저(JdCoach.addPrompt)가 하고, 서버는 '가져간 사람 수'만
     센다. 목록에서 부를 때는 원문을 안 갖고 있으므로(목록 응답에 안 실린다 —
     8,000자짜리가 스무 줄이면 목록이 그것만으로 수십만 자다) **그 글만 따로**
     받아서 원문을 꺼낸다. */
  async function takePromptById(id, title, text) {
    if (needLogin()) return null;
    if (!window.JdCoach?.addPrompt) {
      alert('지금은 담을 수 없어요. 새로고침한 뒤 다시 시도해 주세요.');
      return null;
    }
    let name = title, body = text;
    if (!body) {
      try {
        const r = await DB.getInsight(id);
        name = r.post?.title || title;
        body = r.post?.promptText || '';
      } catch { body = ''; }
    }
    if (!body) { alert('이 글에는 담아 갈 프롬프트가 없어요.'); return null; }

    const r = window.JdCoach.addPrompt({ name, text: body });
    if (!r.ok) {
      alert(r.reason === 'full'
        ? `내 프롬프트는 ${r.max}개까지예요. 자소서 코치에서 안 쓰는 것을 지우고 다시 담아주세요.`
        : '담지 못했어요.');
      return null;
    }
    const msg = r.reason === 'exists'
      ? `이미 담아 둔 프롬프트예요 — ‘${r.name}’ 을 켰습니다.`
      : `‘${r.name}’ 으로 담았어요. 지금부터 AI 초안이 이 규칙으로 나옵니다.`;
    if (typeof toast === 'function') toast(msg, { icon: false });
    else alert(msg);

    try { return await DB.copyInsightPrompt(id); }
    catch { return null; }               // 세는 데 실패해도 담긴 건 담긴 것이다
  }

  async function takePrompt() {
    const post = detailData?.post;
    if (!post?.promptText) return;
    const r = await takePromptById(post.id, post.title, post.promptText);
    if (r) {
      detailData.post.copyCount = r.copyCount;
      detailData.post.taken = true;
      render();
    }
  }

  // ── 이벤트 위임 ─────────────────────────────────────────────
  function bindEvents() {
    const box = root();
    if (!box) return;

    box.querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
      category = btn.dataset.cat; page = 1; loadList();
    }));

    // ── 검색 ──
    const qInput = box.querySelector('#insight-q');
    const scopeSel = box.querySelector('#insight-scope');
    /* 범위는 **검색을 누를 때 함께 읽는다.** 고르자마자 다시 찾으면, 검색어를
       치기도 전에 범위만 바꾼 사용자에게 같은 목록을 다시 받아오게 된다.
       고른 값은 화면을 다시 그려도 남아야 하므로 state 에도 즉시 반영한다. */
    scopeSel?.addEventListener('change', () => { scope = scopeSel.value; });
    const runSearch = () => {
      if (scopeSel) scope = scopeSel.value;
      q = (qInput?.value || '').trim();
      page = 1;
      loadList();
    };
    /* Enter 로도 검색된다. 한글 조합 중 Enter 는 글자를 확정하는 키라 넘긴다 —
       '취업'을 확정하려던 순간에 '취어'로 검색되면 안 된다. */
    qInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) runSearch();
    });
    box.querySelector('#insight-search-go')?.addEventListener('click', runSearch);
    /* 검색 해제는 검색어만 지운다 — 고른 범위는 남긴다. 같은 범위로 다른 낱말을
       찾는 흐름이 흔한데, 범위까지 되돌리면 매번 다시 골라야 한다. */
    box.querySelector('#insight-search-clear')?.addEventListener('click', () => {
      q = ''; page = 1; loadList();
    });
    box.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => {
      const n = Number(btn.dataset.page);
      if (n >= 1) { page = n; loadList(); }
    }));
    box.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => openPost(btn.dataset.open)));

    /* ── 목록에서 바로 담기·북마크 ────────────────────────────
       줄 전체가 `<button data-open>` 이라 **클릭이 위로 새면 상세가 같이 열린다.**
       stopPropagation 을 빠뜨리면 담기를 누를 때마다 화면이 넘어가서, 담았는지
       확인할 새도 없이 상세로 튄다. 키보드(Enter/Space)도 같은 처리를 해 준다. */
    const onActivate = (el, fn) => {
      el.addEventListener('click', e => { e.stopPropagation(); fn(); });
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); fn();
      });
    };

    box.querySelectorAll('[data-take]').forEach(el => onActivate(el, async () => {
      const id = el.dataset.take;
      const r = await takePromptById(id);
      if (!r) return;
      const post = (listData.posts || []).find(x => x.id === id);
      if (post) { post.copyCount = r.copyCount; post.taken = true; }
      render();
    }));

    box.querySelectorAll('[data-bookmark]').forEach(el => onActivate(el, async () => {
      if (needLogin()) return;
      const id = el.dataset.bookmark;
      try {
        const r = await DB.bookmarkInsight(id);
        const post = (listData.posts || []).find(x => x.id === id);
        if (post) { post.bookmarked = r.bookmarked; post.bookmarkCount = r.bookmarkCount; }
        render();
      } catch (e) { alert(e.message); }
    }));

    /* 카테고리를 바꾸면 화면이 바뀐다(프롬프트 칸이 생기고 사라진다). 다시 그리기
       전에 적던 값을 걷어 온다 — 카테고리를 잘못 골랐다가 되돌릴 때 제목·본문이
       사라지면 안 된다. 프롬프트 원문은 칸이 없어져도 state 에 남겨 두고, 프롬프트가
       아닌 카테고리로 저장하면 서버가 버린다(normalizePrompt). */
    box.querySelector('#insight-write-cat')?.addEventListener('change', () => {
      readWriteForm();
      render();
    });

    /* 내 프롬프트에서 불러오기 — 적어 둔 것이 있으면 덮기 전에 묻는다. */
    box.querySelector('#insight-prompt-mine')?.addEventListener('change', e => {
      const mine = window.JdCoach?.myPrompts?.() || [];
      const pick = mine[Number(e.target.value)];
      e.target.value = '';
      if (!pick) return;
      const ta = document.getElementById('insight-write-prompt');
      if (!ta) return;
      if (ta.value.trim() && !confirm('프롬프트 칸에 적어 둔 글이 있어요. 불러온 것으로 바꿀까요?')) return;
      ta.value = pick.text;
      /* 제목이 비어 있으면 프롬프트 이름을 넣어 준다 — 제목을 안 적어 저장이
         막히는 일이 흔하고, 이름이 곧 그 프롬프트를 부르는 말이다. */
      const title = document.getElementById('insight-write-title');
      if (title && !title.value.trim()) title.value = pick.name;
      readWriteForm();
    });

    box.querySelector('#insight-prompt-take')?.addEventListener('click', takePrompt);

    box.querySelector('#insight-prompt-bm')?.addEventListener('click', async () => {
      if (needLogin()) return;
      try {
        const r = await DB.bookmarkInsight(detailData.post.id);
        detailData.post.bookmarked = r.bookmarked;
        detailData.post.bookmarkCount = r.bookmarkCount;
        render();
      } catch (e) { alert(e.message); }
    });

    /* 별을 누르면 그 점수로 매긴다. 같은 별을 다시 누르면 서버가 취소한다. */
    box.querySelectorAll('[data-rate]').forEach(btn => btn.addEventListener('click', async () => {
      if (needLogin()) return;
      try {
        const r = await DB.rateInsight(detailData.post.id, Number(btn.dataset.rate));
        Object.assign(detailData.post, {
          ratingAvg: r.ratingAvg, ratingCount: r.ratingCount,
          ratingMinVotes: r.ratingMinVotes, myRating: r.myRating,
        });
        render();
      } catch (e) { alert(e.message); }
    }));
    box.querySelector('#insight-prompt-copy')?.addEventListener('click', async () => {
      const text = detailData?.post?.promptText || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        if (typeof toast === 'function') toast('프롬프트를 복사했어요', { icon: false });
      } catch {
        /* 클립보드를 막아 둔 브라우저(비 HTTPS·권한 거부)가 있다. 조용히 실패하면
           눌러도 아무 일이 없는 것으로 보이므로, 직접 고를 수 있게 선택해 준다. */
        const pre = document.getElementById('insight-prompt-text');
        if (pre) {
          const r = document.createRange();
          r.selectNodeContents(pre);
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(r);
        }
        alert('브라우저가 복사를 막았어요. 선택해 둔 글을 Ctrl+C 로 복사해 주세요.');
      }
    });

    document.getElementById('insight-write-open')?.addEventListener('click', openWrite);
    document.getElementById('insight-write-cancel')?.addEventListener('click', () => { view = 'list'; loadList(); });
    document.getElementById('insight-write-submit')?.addEventListener('click', submitPost);
    document.getElementById('insight-back')?.addEventListener('click', () => { view = 'list'; loadList(); });

    document.getElementById('insight-delete-post')?.addEventListener('click', async () => {
      if (!confirm('이 글을 삭제할까요? 되돌릴 수 없어요.')) return;
      try {
        await DB.deleteInsight(currentPostId);
        view = 'list'; loadList();
      } catch (e) { alert(e.message); }
    });

    /* ── 댓글 칸 ────────────────────────────────────────────────
       칸은 로그인 여부와 상관없이 늘 보인다. 비로그인 사용자가 쓰기 시작하면
       그때 로그인으로 보낸다 — 안내문을 대신하는 자리다. */
    const cInput = document.getElementById('insight-comment-input');
    const cForm = document.getElementById('insight-comment-form');
    cInput?.addEventListener('focus', () => { if (needLogin()) cInput.blur(); });
    /* 적기 시작해야 '등록' 이 나온다. 빈 칸 옆에 늘 떠 있으면 한 줄짜리 입력칸이
       두 칸으로 보인다(사용자가 원한 모양은 '적는 칸' 하나다). */
    cInput?.addEventListener('input', () => {
      cForm?.classList.toggle('has-text', Boolean(cInput.value.trim()));
    });
    /* Ctrl+Enter 로도 등록된다. Enter 는 줄바꿈이다 — 한글 조합 중 Enter 는
       글자를 확정하는 키라서, 그걸 등록으로 쓰면 쓰다 만 댓글이 올라간다. */
    cInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById('insight-comment-submit')?.click();
      }
    });

    document.getElementById('insight-comment-submit')?.addEventListener('click', async () => {
      if (needLogin()) return;
      const input = document.getElementById('insight-comment-input');
      const body = input.value.trim();
      if (!body) return;
      try {
        await DB.addInsightComment(currentPostId, body);
        await openPost(currentPostId);
      } catch (e) { alert(e.message); }
    });

    box.querySelectorAll('[data-del-comment]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('댓글을 삭제할까요?')) return;
      try {
        await DB.deleteInsightComment(currentPostId, btn.dataset.delComment);
        await openPost(currentPostId);
      } catch (e) { alert(e.message); }
    }));
  }

  return { onEnter, LS_OPEN };
})();
