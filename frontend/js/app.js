// ════════════════════════════════════════════════════════════
//  C:road — App Bootstrap (라우터 + 인증)
// ════════════════════════════════════════════════════════════
const PAGES = [
  'main', 'login', 'signup', 'onboarding', 'mypage', 'career', 'backoffice',
  'dashboard', 'search', 'profile', 'mentoring',   // ← 구 mentoring.html
  'specup',                                        // 스펙 채우기 (js/specup.js) — 로드맵 2단계의 곁가지
  'jd',                                            // 자소서 코치 (js/jd-coach.js)
  'write',                                          // 자소서 작성 (js/jd-coach.js renderWrite) — 역량 분석 뒤 전용 작성 화면
  // 보관함(#drafts)은 페이지에서 **모달**로 바뀌었다(2026-09-01) — PAGES 에서 뺀다. Drafts.open()
  'donate',                                        // 내 합격 자소서 기증 (js/donate.js) — 동의 기반 코퍼스
  'company',                                       // 회사 검색 (js/company-cover.js) — 자소서 코치의 앞 단계
  'mentor-profile',                                // 멘토 소개 입력 (js/mentor-profile.js)
  'insight',                                       // 커리어 인사이트 — 커뮤니티 게시판 (js/insight.js)
];

/* navbar 에서 밑줄로 강조할 페이지 (data-nav 값과 일치) */
const NAV_HIGHLIGHT = ['career', 'dashboard', 'specup', 'jd', 'search', 'mentoring', 'insight'];

/* 멘토링 계열 화면 — mentoring.js 가 렌더를 담당 */
const MENTORING_PAGES = ['dashboard', 'search', 'profile', 'mentoring'];

/* 지금 보이는 페이지. popstate 가 "같은 페이지 안에서의 이동인가"를 이걸로 가른다. */
let _activePage = null;
/* 방금 연 페이지의 onEnter 가 끝나는 시점. 하위 화면은 그 뒤에 열어야 덮이지 않는다. */
let _enterDone = Promise.resolve();

function showPage(page) {
  _activePage = page;
  /* 로그인 후 되돌아갈 후보 — 이어서 작업할 수 있는 화면에 머물 때만 갱신한다
     (RESUMABLE_PAGES 주석 참고). 하위 경로(#company/… 등)까지 담아 자리를 살린다. */
  if (RESUMABLE_PAGES.includes(page)) {
    _lastResumableHash = window.location.hash.replace(/^#/, '') || page;
  }
  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (!el) return;
    if (p === page) {
      el.classList.add('active');
      if (p === 'career') el.style.display = 'flex';
    } else {
      el.classList.remove('active');
      if (p === 'career') el.style.display = 'none';
    }
  });
  document.getElementById('global-navbar').style.display = 'flex';
  /* 멘토 프로필은 "멘토 찾기"의, 회사 검색은 "자소서 코치"의 하위 화면이므로 같은 메뉴를
     강조한다.

     ── 스펙UP 은 자기 메뉴를 강조한다 (사용자 지시 2026-08-21) ──
     예전에는 CAS 를 강조했다. 스펙UP 이 CAS(2단계)에서 갈라지는 곁가지라, 별도 메뉴를
     만들면 "스펙을 채워야 다음으로 갈 수 있다" 로 읽힌다고 봤기 때문이다.
     지금은 상단바에 자기 자리가 생겼으므로 자기를 강조한다 — 눌러서 들어왔는데 다른
     메뉴에 불이 들어오면 어디에 있는지 알 수 없다. 곁가지라는 사실은 화면 머리의
     '2단계 · 스펙UP' 이 여전히 말해 준다. */
  /* 회사 검색·보관함은 '자소서 코치' 의 하위 화면이라 같은 메뉴를 강조한다 —
     눌러서 들어왔는데 아무 메뉴에도 불이 없으면 어디에 있는지 알 수 없다. */
  const navKey = page === 'profile' ? 'search'
    : (page === 'company' || page === 'write') ? 'jd' : page;
  updateNavActive(NAV_HIGHLIGHT.includes(navKey) ? navKey : '');

  if (page === 'mypage')     initMypage();
  if (page === 'mentor-profile') initMentorProfile();
  if (page === 'onboarding') enterOnboarding();
  if (page === 'login')      showLoginError();
  if (page === 'career')     { CareerPage.refreshUser(); CareerPage.render(); }
  /* 주소창에 #backoffice 를 직접 쳐서 들어올 수 있으므로 여기서도 막는다.
     서버가 404 로 막아 화면이 비긴 하지만, '들어가지긴 했는데 아무것도 없는'
     상태는 고장으로 읽힌다. */
  if (page === 'backoffice') {
    const me = DB.currentUser();
    if (!me?.isAdmin) { navigate(me ? 'main' : 'login'); return; }
    Backoffice.render(document.querySelector('#page-backoffice .bo-wrap'));
  }
  if (page === 'main')       { if (window.renderHome) renderHome(); }
  else if (window.leaveHome) leaveHome();   // 홈을 떠났으니 다음 진입 때 등장 효과를 다시 재생
  if (page === 'specup')     SpecUp.onEnter();
  if (page === 'jd')         JdCoach.onEnter();
  if (page === 'write')      JdCoach.onEnterWrite();
  if (page === 'company')    _enterDone = Promise.resolve(CompanyCover.onEnter());
  if (page === 'donate')     Donate.onEnter();
  /* ── onEnter 가 끝난 뒤에 하위 화면을 연다 (실측 2026-09-10) ────────────────
     Insight.onEnter 는 비동기다. #insight/post/12 로 바로 들어오면 routeSub 가 글을
     여는 사이에 **뒤늦게 끝난 onEnter 가 목록으로 덮어썼다** — 링크를 받은 사람에게는
     글이 안 열리는 것으로 보인다. 끝나는 시점을 잡아 두고 그 뒤에 연다. */
  if (page === 'insight')    _enterDone = Promise.resolve(Insight.onEnter());
  if (MENTORING_PAGES.includes(page)) Mentoring.onEnter(page);

  if (page !== 'main') window.scrollTo({ top: 0 });
  updateNavAuth();
}

function navigate(page) {
  closeNavDrawer();
  toggleUserMenu(false);
  /* 로그인·가입 화면으로 떠나기 직전의 위치를 기억해 둔다 — 로그인에 성공하면
     그리로 되돌린다(goAfterLogin). SPA 라 페이지 DOM 은 숨겨질 뿐 살아 있어서,
     되돌아가기만 하면 자소서 입력·고른 스펙·STAR 가 그대로다. */
  if (page === 'login' || page === 'signup') rememberReturn();
  history.pushState({ page }, '', '#' + page);
  showPage(page);
}
window.navigate = navigate;

/* ── 로그인 후 되돌아갈 곳 ──────────────────────────────────────
   예전에는 로그인에 성공하면 무조건 홈(main)으로 갔다. 그래서 자소서 코치에서
   스펙/STAR 를 적다가 로그인하러 가면, 돌아왔을 때 홈이라 회사찾기부터 다시 해야 했다.
   떠나기 직전 위치를 기억했다가(rememberReturn) 성공 후 그리로 돌린다(goAfterLogin).

   저장은 sessionStorage 다 — 소셜 로그인은 제공자 사이트로 실제 이동했다가 서버가
   /#main 으로 되돌려보내므로(전체 리로드) 모듈 변수는 날아간다. 같은 탭·오리진으로
   돌아오니 sessionStorage 는 남는다. */
const RETURN_KEY = 'careerly_login_return';
const AUTH_PAGES = ['login', 'signup', 'onboarding'];

/* 되돌아갈 곳은 **로그아웃 상태로도 이어서 작업할 수 있는 화면**만이다.
   자소서 코치에서 STAR 를 적다 로그인하러 갈 때, 실제 경로는
   자소서(jd) → 스펙 관리(mypage, 로그인 필요) → 로그인 이라 중간에 mypage 를 거친다.
   mypage·백오피스는 로그인이 있어야 들어가는 곳이라 '출발지'가 될 수 없으므로 후보에서
   빼고, 마지막으로 머문 이어작업 화면(=자소서)을 기억한다. 그래서 로그인 후 자소서로
   돌아온다(입력·고른 스펙·STAR 는 SPA DOM·localStorage 에 그대로 남아 있다). */
const RESUMABLE_PAGES = ['jd', 'write', 'company', 'donate', 'specup', 'insight'];
let _lastResumableHash = '';

/* 저장은 sessionStorage 지만 접근이 막히는 환경이 있다(사생활 모드·샌드박스 iframe 은
   읽기만 해도 SecurityError 를 던진다). 던지면 로그인 이동 자체가 깨지므로 반드시
   try/catch 로 감싸고, 막혔을 때는 모듈 변수로 대체한다 — 앱 안에서 로그인하는 흐름은
   새로고침이 없어 대체 변수만으로도 되돌아온다(소셜 로그인의 전체 리로드만 못 살린다). */
let _returnFallback = null;
function setReturn(v) {
  _returnFallback = v || null;
  try { if (v) sessionStorage.setItem(RETURN_KEY, v); } catch {}
}
function getReturn() {
  try { const v = sessionStorage.getItem(RETURN_KEY); if (v != null) return v; } catch {}
  return _returnFallback;
}
function clearReturn() {
  _returnFallback = null;
  try { sessionStorage.removeItem(RETURN_KEY); } catch {}
}

function rememberReturn() {
  if (_lastResumableHash) setReturn(_lastResumableHash);
}

function consumeReturn() {
  const v = getReturn();
  clearReturn();
  const page = (v || '').split(/[/?]/)[0];
  return (page && PAGES.includes(page) && !AUTH_PAGES.includes(page)) ? v : null;
}

/* 기억해 둔 곳으로 실제 이동한다 — 하위 경로(#mypage/spec 의 탭)까지 살린다.
   navigate() 는 페이지 이름만 받으므로 여기서 해시를 직접 세팅하고 라우터를 부른다. */
function goAfterLogin() {
  const to = consumeReturn();
  if (!to) { navigate('main'); return; }
  const page = to.split(/[/?]/)[0];
  history.pushState({ page }, '', '#' + to);
  showPage(page);
}

/* 페이지 + 탭으로 한 번에 보낸다. 로드맵의 '스펙 채우기' 가지처럼 특정 탭이
   목적지인 이동이 있는데, navigate('mypage') 만 하면 initMypage() 가 직전에
   보던 탭을 열어서 엉뚱한 칸이 나온다. */
function navigateTo(page, tab) {
  navigate(page);
  if (tab && page === 'mypage') selectMypageTab(tab);
}
window.navigateTo = navigateTo;

// ── 더보기 드로어 (좁은 화면에서 nav-links 를 대체) ───────────
function setNavDrawer(open) {
  const drawer  = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-drawer-overlay');
  const burger  = document.getElementById('nav-burger');
  if (!drawer) return;
  drawer.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
  document.body.classList.toggle('nav-drawer-open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
}
function openNavDrawer()   { setNavDrawer(true); }
function closeNavDrawer()  { setNavDrawer(false); }
function toggleNavDrawer() {
  setNavDrawer(!document.getElementById('nav-drawer').classList.contains('open'));
}
window.openNavDrawer   = openNavDrawer;
window.closeNavDrawer  = closeNavDrawer;
window.toggleNavDrawer = toggleNavDrawer;

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeNavDrawer(); toggleUserMenu(false); }
});
// 데스크톱 폭으로 넓히면 드로어가 숨겨지므로 상태도 함께 초기화한다.
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeNavDrawer();
});

/* 해시에는 하위 경로가 붙을 수 있다(#mypage/account — 마이페이지 탭).
   '/' 앞부분만 페이지 이름이다. 이걸 안 떼면 PAGES 에 없어서 홈으로 튕긴다.
   '?' 도 같이 떼는데, 소셜 로그인 실패가 #login?error=... 로 돌아오기 때문이다. */
function pageFromHash() {
  return (window.location.hash.replace('#', '').split(/[/?]/)[0]) || 'main';
}

/* ── 페이지 안에서 또 갈리는 화면 (사용자 지적 2026-09-10) ────────────────────
   커뮤니티 글을 열고 **마우스 옆 버튼으로 뒤로가기**를 누르면 목록이 아니라 그 전에
   보던 다른 페이지로 튀었다. 원인은 하나다 — 페이지 안에서 화면이 바뀔 때(목록→상세,
   회사 검색→리포트) 주소도 히스토리도 그대로라, 브라우저가 보기에는 **아무 일도
   일어나지 않은 것**이라서 뒤로가기가 페이지 자체를 떠난다.

   그래서 그런 화면은 하위 경로를 쌓는다(#insight/post/12 · #company/삼성전자).
   모듈은 두 가지만 지키면 된다:
     · 화면을 바꿀 때 navigateSub(page, sub) 를 부른다
     · onRoute(sub) 를 내보내 그 경로의 화면을 **히스토리를 쌓지 않고** 복원한다
   주소가 화면을 가리키게 되므로, 새로고침하거나 링크를 보내도 같은 자리가 열린다. */
const SUBVIEW_PAGES = {
  insight: () => window.Insight,
  company: () => window.CompanyCover,
};

/* 해시의 '/' 뒷부분. #insight/post/12 → 'post/12' */
function subFromHash() {
  const h = window.location.hash.replace(/^#/, '').split('?')[0];
  const i = h.indexOf('/');
  return i === -1 ? '' : h.slice(i + 1);
}

/* 모듈이 부른다 — 페이지 안에서 화면을 바꿀 때 히스토리를 한 칸 쌓는다.
   같은 주소면 쌓지 않는다(같은 글을 두 번 열었을 때 뒤로가기가 헛도는 것을 막는다). */
function navigateSub(page, sub) {
  const hash = '#' + page + (sub ? '/' + sub : '');
  if (window.location.hash === hash) return;
  history.pushState({ page, sub: sub || '' }, '', hash);
}
window.navigateSub = navigateSub;

async function routeSub(page) {
  const mod = SUBVIEW_PAGES[page] && SUBVIEW_PAGES[page]();
  if (!mod || typeof mod.onRoute !== 'function') return;
  /* 페이지를 막 연 참이면 그 준비가 끝나기를 기다린다. 같은 페이지 안에서의 이동이면
     이미 끝나 있으므로 곧바로 통과한다. */
  try { await _enterDone; } catch { /* onEnter 가 실패해도 하위 화면은 시도한다 */ }
  /* 기다리는 사이에 사용자가 또 움직였을 수 있다. 지금 주소를 다시 읽는다 —
     들고 있던 값으로 열면 이미 떠난 화면이 뒤늦게 튀어나온다. */
  if (_activePage === page) mod.onRoute(subFromHash());
}

window.addEventListener('popstate', e => {
  const page = (e.state && PAGES.includes(e.state.page)) ? e.state.page : pageFromHash();
  const target = PAGES.includes(page) ? page : 'main';

  /* 같은 페이지 안에서의 이동이면 페이지를 다시 열지 않는다 — showPage 가 onEnter 를
     부르고, onEnter 는 목록을 처음부터 다시 받아 온다. 상세→목록으로 돌아가는 것뿐인데
     화면이 한 번 깜빡이고 스크롤도 잃는다. */
  if (target === _activePage && SUBVIEW_PAGES[target]) { routeSub(target); return; }

  showPage(target);
  routeSub(target);
});

// ── Nav auth state ───────────────────────────────────────────
function updateNavAuth() {
  const user = DB.currentUser();
  const navAuth = document.getElementById('nav-auth');
  const navUser = document.getElementById('nav-user');
  const navName = document.getElementById('nav-user-name');
  // 드로어 헤더도 같은 상태를 따라간다.
  const drawerAuth = document.getElementById('drawer-auth');
  const drawerUser = document.getElementById('drawer-user');
  const drawerName = document.getElementById('drawer-user-name');
  /* 백오피스는 관리자에게만 보인다. 로그아웃 상태에서도 반드시 숨긴다 —
     처음에 hidden 으로 두어도 로그아웃하면 다시 켜질 수 있어서 매번 계산한다. */
  const navBiz = document.getElementById('nav-biz');
  if (navBiz) navBiz.hidden = !user?.isAdmin;

  if (user) {
    const label = (user.nickname || user.name || user.username) + '님';
    navAuth.style.display = 'none';
    navUser.style.display = 'flex';
    navName.textContent = label;
    drawerAuth.style.display = 'none';
    drawerUser.style.display = 'flex';
    drawerName.textContent = label;
  } else {
    navAuth.style.display = 'flex';
    navUser.style.display = 'none';
    drawerAuth.style.display = 'flex';
    drawerUser.style.display = 'none';
  }
}
window.updateNavAuth = updateNavAuth;

// ── Nav active state (highlight current section) ──────────────
function updateNavActive(key) {
  document.querySelectorAll('#global-navbar .nav-link').forEach(l => {
    l.classList.toggle('on', !!key && l.dataset.nav === key);
  });
}
window.updateNavActive = updateNavActive;

// ════════════════════════════════════════════════════════════
//   SOCIAL LOGIN
// ════════════════════════════════════════════════════════════
/* 버튼은 서버에 키가 설정된 제공자만 그린다. 키 없이 버튼만 있으면 눌렀을 때
   에러 화면으로 떨어져서, 사용자는 서비스가 고장 난 줄 안다. */
const SOCIAL_STYLE = {
  naver: { label: '네이버로 시작하기', cls: 'naver', mark: 'N' },
  kakao: { label: '카카오로 시작하기', cls: 'kakao', mark: 'K' },
};

async function paintSocialButtons() {
  let providers = [];
  try {
    providers = (await (await fetch('/api/auth/providers')).json()).providers || [];
  } catch { return; }             // 서버가 안 뜬 상태 — 일반 로그인은 그대로 쓴다
  if (!providers.length) return;

  const html = providers.map(p => {
    const s = SOCIAL_STYLE[p.id] || { label: `${p.label}로 시작하기`, cls: '', mark: '' };
    /* 링크로 둔다. OAuth 는 브라우저가 제공자 사이트로 실제 이동해야 해서
       fetch 로는 안 된다(리다이렉트를 따라갈 수 없다). */
    return `<a class="social-btn ${s.cls}" href="/api/auth/${p.id}">
        <span class="social-mark">${s.mark}</span>${s.label}
      </a>`;
  }).join('');

  ['login', 'signup'].forEach(page => {
    const wrap = document.getElementById(`${page}-social`);
    const box  = document.getElementById(`${page}-social-btns`);
    if (!wrap || !box) return;
    box.innerHTML = html;
    wrap.hidden = false;
  });
}

/* 소셜 로그인 실패는 서버가 #login?error=... 로 알려준다(콜백은 SPA 밖에서 돌아온다). */
function showLoginError() {
  const m = window.location.hash.match(/[?&]error=([^&]+)/);
  if (!m) return;
  const box = document.getElementById('login-error');
  if (box) {
    box.textContent = decodeURIComponent(m[1]);
    box.style.display = 'block';
  }
  // 한 번 보여준 에러가 주소에 남아 새로고침 때마다 다시 뜨지 않게 지운다
  history.replaceState({ page: 'login' }, '', '#login');
}

function enterOnboarding() {
  const user = DB.currentUser();
  const greet = document.getElementById('ob-greeting');
  if (user && greet) {
    greet.textContent = `${user.name}님, 회원 유형만 골라주시면 시작할 수 있어요.`;
  }
  const err = document.getElementById('ob-error');
  if (err) err.style.display = 'none';
}

async function handleOnboarding() {
  const err  = document.getElementById('ob-error');
  const btn  = document.getElementById('ob-btn');
  const role = document.querySelector('input[name="ob-role"]:checked')?.value;
  const nickname = document.getElementById('ob-nickname').value.trim();
  err.style.display = 'none';

  if (verifyAvailable && !verifyTokens.ob) {
    err.textContent = '본인인증을 완료해주세요.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  try {
    await DB.completeOnboarding({
      role, nickname: nickname || null, verifyToken: verifyTokens.ob,
    });
    navigate('main');
  } catch (e) {
    verifyTokens.ob = null;                 // 서버가 토큰을 소모했다 — 다시 받아야 한다
    setVerifyState('ob', '다시 인증해 주세요', false);
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}
window.handleOnboarding = handleOnboarding;

// ════════════════════════════════════════════════════════════
//   PAYMENT RETURN
// ════════════════════════════════════════════════════════════
/* 결제창이 성공하면 토스가 successUrl 로 돌아오면서 paymentKey·orderId·amount 를
   쿼리에 붙여 준다. **그 시점은 아직 결제가 아니다** — 서버가 승인 API 를 불러야
   돈이 움직인다. 그래서 돌아오자마자 서버 승인을 요청한다.

   승인 결과를 기다리는 동안 사용자가 새로고침하면 같은 승인이 두 번 갈 수 있다.
   서버가 이미 결제된 주문을 성공으로 돌려주므로(payments.js) 중복은 안전하다. */
async function handlePaymentReturn() {
  const q = new URLSearchParams(location.search);
  const paymentKey = q.get('paymentKey');
  const orderId = q.get('orderId');
  const amount = q.get('amount');

  // 실패로 돌아온 경우 토스는 code·message 를 준다
  const failCode = q.get('code');
  if (failCode) {
    cleanPaymentQuery();
    alert(q.get('message') || '결제에 실패했어요.');
    return;
  }
  if (!paymentKey || !orderId || !amount) return;

  cleanPaymentQuery();
  try {
    await DB.confirmPayment({ paymentKey, orderId, amount: Number(amount) });
    alert('결제가 완료되었습니다. 멘토의 응답을 기다려 주세요.');
  } catch (e) {
    alert(e.message || '결제 승인에 실패했어요.');
  }
  navigate('mentoring');
}

/* 결제 정보가 주소창에 남으면 새로고침할 때마다 승인을 다시 시도한다. */
function cleanPaymentQuery() {
  history.replaceState(history.state, '', location.pathname + location.hash);
}

async function handleLogout() {
  toggleUserMenu(false);
  try { await DB.logout(); }
  catch (e) { console.error('로그아웃 실패', e); }
  updateNavAuth();
  navigate('main');
}
window.handleLogout = handleLogout;

/* ── 사용자 아이콘 드롭다운 (닉네임 옆) ─────────────────────────
   로그아웃 버튼을 아이콘 하나로 바꾸고, 누르면 마이페이지·계정관리·로그아웃을 연다
   (사용자 지시 2026-09-01). 밖을 누르거나 Esc·이동하면 닫힌다. */
function toggleUserMenu(force) {
  const menu = document.getElementById('nav-user-menu');
  const btn = document.getElementById('nav-user-btn');
  if (!menu) return;
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', String(open));
}
window.toggleUserMenu = toggleUserMenu;

function userMenuGo(page, tab) {
  toggleUserMenu(false);
  if (tab && typeof navigateTo === 'function') navigateTo(page, tab);
  else navigate(page);
}
window.userMenuGo = userMenuGo;

/* 메뉴 밖을 누르면 닫는다(아이콘·메뉴 안쪽 클릭은 제외). */
document.addEventListener('click', e => {
  const wrap = document.getElementById('nav-user');
  const menu = document.getElementById('nav-user-menu');
  if (menu && !menu.hidden && wrap && !wrap.contains(e.target)) toggleUserMenu(false);
});

// ── Boot ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  CareerPage.init();
  Mentoring.init();
  JdCoach.init();
  const target = PAGES.includes(pageFromHash()) ? pageFromHash() : 'main';
  document.getElementById('page-career').style.display = 'none';
  /* 주소는 원래 것을 그대로 둔다. '#'+target 으로 덮으면 #mypage/account 의
     탭 부분이 날아가, 링크로 들어와도 항상 첫 탭이 열린다. */
  const keep = PAGES.includes(pageFromHash()) ? location.hash : '#' + target;
  history.replaceState({ page: target }, '', keep);

  // 서버 상태(로그인 여부·스펙)를 먼저 받아야 첫 화면이 올바르게 그려진다.
  // 실패해도 게스트 상태로 화면은 띄운다.
  try { await DB.hydrate(); }
  catch (e) { console.error('서버 상태를 불러오지 못했습니다.', e); }

  /* 소셜 가입 직후 새로고침하면 역할이 없는 채로 다른 화면에 들어갈 수 있다.
     그 상태로는 스펙 폼도 통계도 성립하지 않으므로 추가입력으로 돌려보낸다. */
  const me = DB.currentUser();
  /* 소셜 로그인은 제공자 사이트를 거쳐 서버가 /#main 으로 되돌려보낸다. 로그인하러
     가기 전 화면(sessionStorage)이 남아 있으면 홈에 세우지 말고 그리로 마저 돌린다. */
  if (me && !me.needsOnboarding && target === 'main' && getReturn()) {
    goAfterLogin();
  } else {
    const first = me?.needsOnboarding ? 'onboarding' : target;
    showPage(first);
    /* 주소에 하위 경로가 붙어 있으면(#insight/post/12 — 새로고침·링크로 들어온 경우)
       그 화면까지 열어 준다. 안 하면 링크를 받은 사람은 목록만 보게 된다. */
    routeSub(first);
  }
  updateNavAuth();
  paintSocialButtons();
  initVerify();            // 본인인증을 쓸 수 있는 환경인지 확인하고 칸을 노출/숨김
  handlePaymentReturn();   // 결제창에서 돌아왔으면 승인까지 이어서 한다
});

// ════════════════════════════════════════════════════════════
//   LOGIN
// ════════════════════════════════════════════════════════════
async function handleLogin() {
  const errorBox = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  errorBox.style.display = 'none';

  if (!username || !password) {
    errorBox.textContent = '아이디와 비밀번호를 입력해주세요.';
    errorBox.style.display = 'block';
    return;
  }
  try {
    await DB.login(username, password);
    goAfterLogin();                 // 홈이 아니라 로그인하러 오기 전 화면으로 되돌린다
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.style.display = 'block';
    document.getElementById('login-password').value = '';
  }
}
window.handleLogin = handleLogin;

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('page-login').classList.contains('active'))
    handleLogin();
});

// ════════════════════════════════════════════════════════════
//   SIGNUP
// ════════════════════════════════════════════════════════════
/* 영문·숫자는 필수, 특수문자는 허용하되 강제하지 않는다.
   문자 클래스에서 특수문자를 빼면 기존 비밀번호로 가입이 막히므로 반드시 남긴다.
   backend/src/server.js 의 isValidPassword 와 같은 규칙이어야 한다 — 한쪽만 고치면
   프론트를 통과한 값이 서버에서 400 으로 떨어진다. */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]{8,20}$/;

function showFieldErr(id, msg) {
  const input = document.getElementById('su-' + id);
  const err = document.getElementById('err-su-' + id);
  if (input) input.classList.add('input-error');
  if (err) { err.textContent = msg; err.style.display = 'block'; }
}
function clearFieldErr(id) {
  const input = document.getElementById('su-' + id);
  const err = document.getElementById('err-su-' + id);
  if (input) input.classList.remove('input-error');
  if (err) err.style.display = 'none';
}
['username','password','password-confirm','name','nickname','email'].forEach(id => {
  document.addEventListener('input', e => {
    if (e.target.id === 'su-' + id) clearFieldErr(id);
  });
});

/* ── 아이디 중복확인 ──────────────────────────────────────────
   확인에 통과한 '값 자체'를 기억한다. 통과 여부만 불리언으로 들고 있으면
   확인 후 아이디를 고쳐도 통과 상태가 남아, 이미 쓰이는 아이디로 제출된다. */
let checkedUsername = null;

function setUsernameNote(msg, ok) {
  const el = document.getElementById('su-username-note');
  if (!el) return;
  el.textContent = msg;
  el.className = 'field-note' + (msg ? (ok ? ' ok' : ' bad') : '');
}

async function checkUsernameDup() {
  const input = document.getElementById('su-username');
  const btn = document.getElementById('su-username-check');
  const u = input.value.trim();

  clearFieldErr('username');
  setUsernameNote('', false);
  checkedUsername = null;

  if (!u) { showFieldErr('username', '아이디를 입력해주세요.'); return; }
  if (u.length < 4 || u.length > 20) { showFieldErr('username', '아이디는 4~20자로 입력해주세요.'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) { showFieldErr('username', '아이디는 영문, 숫자, 밑줄(_)만 사용 가능합니다.'); return; }

  btn.disabled = true;
  try {
    const { available } = await DB.checkUsername(u);
    if (available) { checkedUsername = u; setUsernameNote('사용할 수 있는 아이디예요.', true); }
    else setUsernameNote('이미 사용 중인 아이디예요.', false);
  } catch (e) {
    setUsernameNote(e.message || '확인에 실패했어요. 잠시 후 다시 시도해주세요.', false);
  } finally {
    btn.disabled = false;
  }
}
window.checkUsernameDup = checkUsernameDup;

/* ── 본인확인 ────────────────────────────────────────────────
   서버가 준 단명 토큰만 들고 있는다. CI(개인식별값)는 화면으로 내려오지 않는다.
   회원가입(su)과 소셜 온보딩(ob) 두 화면이 같은 부품을 쓴다. */
const verifyTokens = { su: null, ob: null };
let verifyAvailable = false;          // 인증을 쓸 수 있는 환경인가 (서버가 판단)
let verifyPopup = null;

async function initVerify() {
  const { available } = await DB.verifyStatus();
  verifyAvailable = !!available;
  /* 쓸 수 없으면 칸을 통째로 숨긴다. 서버도 같은 조건에서 인증을 요구하지 않으므로
     '보이는데 눌러도 안 되는' 버튼이 남지 않는다. */
  ['su', 'ob'].forEach(p => {
    const g = document.getElementById(`${p}-verify-group`);
    if (g) g.hidden = !verifyAvailable;
  });
}

function setVerifyState(prefix, msg, ok) {
  const el = document.getElementById(`${prefix}-verify-state`);
  if (!el) return;
  el.textContent = msg;
  el.className = 'verify-state' + (ok ? ' ok' : '');
}

async function startVerify(prefix = 'su') {
  clearFieldErr('verify');
  try {
    const { popupUrl } = await DB.verifyRequest();
    /* 팝업이 차단되면 아무 일도 안 일어난 것처럼 보인다 — 반드시 알려준다. */
    verifyPopup = window.open(popupUrl, 'careerly-verify', 'width=440,height=560');
    if (!verifyPopup) {
      setVerifyState(prefix, '팝업이 차단됐어요. 허용 후 다시 눌러주세요.', false);
      return;
    }
    verifyPopup.__prefix = prefix;
  } catch (e) {
    setVerifyState(prefix, e.message || '본인인증을 시작하지 못했어요.', false);
  }
}
window.startVerify = startVerify;

/* 팝업이 postMessage 로 결과를 보낸다. **origin 을 반드시 확인한다** —
   확인하지 않으면 아무 사이트나 '인증됐다'고 보낼 수 있다. */
window.addEventListener('message', e => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type !== 'careerly:verified' || !e.data.token) return;

  const prefix = verifyPopup?.__prefix || 'su';
  verifyTokens[prefix] = e.data.token;
  setVerifyState(prefix, `${e.data.name || ''} · ${e.data.phoneMasked || ''} 인증 완료`.trim(), true);
  clearFieldErr('verify');
  verifyPopup = null;
});

/* 아이디를 고치면 직전 확인 결과는 무효다. */
document.addEventListener('input', e => {
  if (e.target.id !== 'su-username') return;
  if (e.target.value.trim() !== checkedUsername) { checkedUsername = null; setUsernameNote('', false); }
});

function validateSignup() {
  let valid = true;
  const u  = document.getElementById('su-username').value.trim();
  const p  = document.getElementById('su-password').value;
  const pc = document.getElementById('su-password-confirm').value;
  const n  = document.getElementById('su-name').value.trim();
  const em = document.getElementById('su-email').value.trim();

  if (!u) { showFieldErr('username', '아이디를 입력해주세요.'); valid = false; }
  else if (u.length < 4 || u.length > 20) { showFieldErr('username', '아이디는 4~20자로 입력해주세요.'); valid = false; }
  else if (!/^[a-zA-Z0-9_]+$/.test(u)) { showFieldErr('username', '아이디는 영문, 숫자, 밑줄(_)만 사용 가능합니다.'); valid = false; }
  else if (u !== checkedUsername) { showFieldErr('username', '아이디 중복확인을 해주세요.'); valid = false; }

  if (!p) { showFieldErr('password', '비밀번호를 입력해주세요.'); valid = false; }
  else if (!PASSWORD_REGEX.test(p)) { showFieldErr('password', '비밀번호는 8~20자이며, 영문과 숫자를 모두 포함해야 합니다.'); valid = false; }

  if (!pc) { showFieldErr('password-confirm', '비밀번호를 다시 입력해주세요.'); valid = false; }
  else if (p !== pc) { showFieldErr('password-confirm', '비밀번호가 일치하지 않습니다.'); valid = false; }

  if (!n) { showFieldErr('name', '이름을 입력해주세요.'); valid = false; }

  /* 별명은 선택 — 비워두면 이름을 가려서 쓴다(maskName). 적었다면 길이만 본다.
     화면 곳곳에 이름 대신 들어가는 값이라 너무 길면 레이아웃이 깨진다. */
  const nick = document.getElementById('su-nickname').value.trim();
  if (nick && (nick.length < 2 || nick.length > 20)) {
    showFieldErr('nickname', '별명은 2~20자로 입력해주세요.'); valid = false;
  }

  if (!em) { showFieldErr('email', '이메일을 입력해주세요.'); valid = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { showFieldErr('email', '올바른 이메일 형식을 입력해주세요.'); valid = false; }

  /* 인증을 쓸 수 있는 환경일 때만 요구한다. 서버도 같은 조건이라 어긋나지 않는다. */
  if (verifyAvailable && !verifyTokens.su) {
    showFieldErr('verify', '본인인증을 완료해주세요.'); valid = false;
  }
  return valid;
}

async function handleSignup() {
  const serverError = document.getElementById('signup-server-error');
  serverError.style.display = 'none';
  if (!validateSignup()) return;
  const role = document.querySelector('input[name="role"]:checked')?.value;
  try {
    await DB.createUser({
      username: document.getElementById('su-username').value.trim(),
      password: document.getElementById('su-password').value,
      name:     document.getElementById('su-name').value.trim(),
      nickname: document.getElementById('su-nickname').value.trim() || null,
      email:    document.getElementById('su-email').value.trim(),
      role,
      verifyToken: verifyTokens.su,
    });
    alert(`${role === 'mentor' ? '멘토' : '멘티'}로 회원가입이 완료되었습니다. 로그인해 주세요.`);
    navigate('login');
  } catch (e) {
    /* 인증 토큰은 서버가 한 번 쓰면 버린다. 실패했으면 다시 받아야 하므로
       여기서 비워 준다 — 안 비우면 이미 쓴 토큰으로 계속 재시도하게 된다. */
    verifyTokens.su = null;
    setVerifyState('su', '다시 인증해 주세요', false);
    serverError.textContent = e.message;
    serverError.style.display = 'block';
  }
}
window.handleSignup = handleSignup;

// ════════════════════════════════════════════════════════════
//   MYPAGE
// ════════════════════════════════════════════════════════════
/* 마이페이지는 탭 두 개다 — 계정 관리 / 스펙 관리.
   탭은 해시 뒤에 붙여 둔다(#mypage/account). 새로고침하거나 링크를 공유해도
   보던 탭이 유지되고, 뒤로가기도 자연스럽게 동작한다. */
const MYPAGE_TABS = ['account', 'spec', 'mentor', 'withdraw'];
let mypageTab = 'account';

/* '멘토 페이지' 탭은 멘토만 쓴다. 멘티에게 보이면 눌러도 아무것도 없는 칸이 된다. */
const tabsFor = user => MYPAGE_TABS.filter(t => t !== 'mentor' || user?.role === 'mentor');

function initMypage() {
  const user = DB.currentUser();
  document.getElementById('mypage-not-logged-in').style.display = user ? 'none' : 'block';
  const body = document.getElementById('mypage-body');
  if (!user) { body.hidden = true; return; }
  body.hidden = false;

  const allowed = tabsFor(user);
  document.getElementById('mp-tab-mentor').hidden = !allowed.includes('mentor');

  /* 해시에 탭이 적혀 있으면 그걸 따른다. 없으면 직전에 보던 탭.
     멘티가 #mypage/mentor 를 직접 쳐도 허용 목록에 없으면 첫 탭으로 떨어진다. */
  const fromHash = (location.hash.split('/')[1] || '').trim();
  if (allowed.includes(fromHash)) mypageTab = fromHash;
  if (!allowed.includes(mypageTab)) mypageTab = 'account';

  paintMypageTab(user);
}

function paintMypageTab(user) {
  document.querySelectorAll('[data-mp-tab]').forEach(b => {
    const on = b.dataset.mpTab === mypageTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });

  const panes = {
    account: document.getElementById('mypage-account-container'),
    spec: document.getElementById('mypage-form-container'),
    mentor: document.getElementById('mypage-mentor-container'),
    withdraw: document.getElementById('mypage-withdraw-container'),
  };
  Object.entries(panes).forEach(([k, el]) => { el.hidden = mypageTab !== k; });

  /* 열 때마다 다시 그린다. 저장 후 다른 탭에 갔다 오면 방금 바꾼 값이
     화면에 남아 있어야 하는데, 한 번만 그리면 옛 값이 그대로 보인다.
     탈퇴 탭은 특히 그렇다 — 입력해 둔 확인 문구가 남아 있으면 안 된다. */
  if (mypageTab === 'account') Account.render(panes.account, user);
  else if (mypageTab === 'mentor') MentorProfile.render(panes.mentor, user);
  else if (mypageTab === 'withdraw') Account.renderWithdraw(panes.withdraw, user);
  else SpecForm.render(panes.spec, user);
}

function selectMypageTab(tab) {
  const user = DB.currentUser();
  if (!tabsFor(user).includes(tab)) return;
  mypageTab = tab;
  /* pushState 가 아니라 replaceState — 탭을 옮길 때마다 히스토리가 쌓이면
     뒤로가기를 여러 번 눌러야 이전 화면으로 나간다. */
  history.replaceState({ page: 'mypage' }, '', `#mypage/${tab}`);
  paintMypageTab(user);
}
window.selectMypageTab = selectMypageTab;

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-mp-tab]');
  if (btn) selectMypageTab(btn.dataset.mpTab);
});

/* 멘토 프로필은 마이페이지 탭으로 옮겼다(#mypage/mentor).
   옛 주소로 들어오는 링크·북마크가 있으므로 그쪽으로 보내 준다. */
function initMentorProfile() {
  const user = DB.currentUser();
  if (!user) { navigate('login'); return; }
  if (user.role !== 'mentor') { navigate('mypage'); return; }
  mypageTab = 'mentor';
  navigate('mypage');
}

// ════════════════════════════════════════════════════════════
//   MAIN — KPI counters
// ════════════════════════════════════════════════════════════
function updateMainStats() {
  // 회원 목록은 관리자 전용이므로 총계는 /api/stats 에서 받은 값을 쓴다.
  const { userCount } = DB.stats();
  const specs = DB.getAllSpecs();
  const depts = new Set(specs.map(s => s.dept).filter(Boolean));
  const fields = new Set(specs.map(s => s.dept + '/' + s.field).filter(s => !s.endsWith('/null')));
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat-item"><div class="stat-num">${userCount}</div><div class="stat-label">전체 회원</div></div>
    <div class="stat-item"><div class="stat-num">${specs.length}</div><div class="stat-label">스펙 입력 데이터</div></div>
    <div class="stat-item"><div class="stat-num">${depts.size}</div><div class="stat-label">커버 학과 수</div></div>
    <div class="stat-item"><div class="stat-num">${fields.size}</div><div class="stat-label">진출 분야 데이터</div></div>
  `;

  // 멘토·멘티 카운트 스트립
  const rc = DB.countByRole();
  const total = rc.mentor + rc.mentee;
  const mentorPct = total ? Math.round(rc.mentor / total * 100) : 0;
  const menteePct = total ? Math.round(rc.mentee / total * 100) : 0;
  document.getElementById('mm-cards').innerHTML = `
    <div class="mm-card mm-card--mentor">
      <div class="mm-card-top">
        <div class="mm-card-emoji">👔</div>
        <div class="mm-card-title">
          <div class="mm-card-name">멘토</div>
          <div class="mm-card-sub">스펙·경험 공유</div>
        </div>
        <div class="mm-card-share">${mentorPct}%</div>
      </div>
      <div class="mm-card-num">${rc.mentor}<span class="mm-card-unit">명</span></div>
      <div class="mm-card-meta">
        <i class="ti ti-database"></i>
        <span>스펙 입력 완료 <b>${specs.length}건</b></span>
      </div>
      <div class="mm-card-cta" onclick="navigate('signup')">멘토로 가입하기 →</div>
    </div>

    <div class="mm-card mm-card--mentee">
      <div class="mm-card-top">
        <div class="mm-card-emoji">🎓</div>
        <div class="mm-card-title">
          <div class="mm-card-name">멘티</div>
          <div class="mm-card-sub">데이터로 커리어 설계</div>
        </div>
        <div class="mm-card-share">${menteePct}%</div>
      </div>
      <div class="mm-card-num">${rc.mentee}<span class="mm-card-unit">명</span></div>
      <div class="mm-card-meta">
        <i class="ti ti-map-2"></i>
        <span>탐색 가능한 학과 <b>${depts.size || 8}개</b></span>
      </div>
      <div class="mm-card-cta" onclick="navigate('signup')">멘티로 가입하기 →</div>
    </div>
  `;
}

// ── 사이드바 NCS 직업 분류 검색 (career page) ───────────────
function filterMajors(q) {
  const query = q.trim();
  let shown = 0;
  document.querySelectorAll('#job-major-list .job-major-item').forEach(el => {
    // 분류명("금융·보험")과 번호("03") 어느 쪽으로도 찾을 수 있게 한다.
    const name = el.querySelector('.dept-label').textContent;
    const num  = el.querySelector('.jm-code').textContent;
    const hit  = !query || name.includes(query) || num.includes(query);
    el.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  document.getElementById('job-major-list-empty').style.display = shown ? 'none' : 'block';
}
window.filterMajors = filterMajors;
