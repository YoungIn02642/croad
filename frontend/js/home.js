/* ════════════════════════════════════════════════════════════
   C:road · Home interactions + Tweaks (Wanted-style landing)
   ════════════════════════════════════════════════════════════ */

/* ── 멘토링 계열 화면도 이제 같은 라우터를 쓴다. 기존 호출부 호환용 별칭. ── */
function openMentoring(sub) { navigate(sub || 'dashboard'); }
window.openMentoring = openMentoring;

/* ── job carousel ───────────────────────────────────────── */
function railScroll(dir) {
  const rail = document.getElementById('job-rail');
  if (!rail) return;
  rail.scrollBy({ left: dir * 332, behavior: 'smooth' });
}
window.railScroll = railScroll;

/* ── scroll to insights ─────────────────────────────────── */
function goInsights() {
  const go = () => {
    const el = document.getElementById('insights-sec');
    if (el) window.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' });
  };
  const main = document.getElementById('page-main');
  if (main && main.classList.contains('active')) { go(); }
  else { navigate('main'); setTimeout(go, 60); }
}
window.goInsights = goInsights;

/* ════════════════════════════════════════════════════════════
   REVEAL — 홈 전체 등장 효과 (스크롤 진입 시 페이드업)
   ════════════════════════════════════════════════════════════
   섹션마다 '무엇을 하나씩 띄울지'가 다르다. 히어로는 문구 줄 단위로,
   퀵링크는 아이콘 하나씩, 나머지는 섹션 통째로 띄운다.
   여기 없는 섹션은 fallback 으로 섹션 전체가 한 덩어리로 뜬다. */
const REVEAL_PARTS = {
  'home-hero':      ['.home-hero-copy > *', '.home-hero-visual'],
  'home-hero-dark': [':scope > *'],
  'home-quick':     ['.ql'],
  'home-pill-wrap': ['.home-pill'],
};

/* 가로 스크롤 레일(job rail)은 건드리지 않는다 — 화면 밖으로 나가 있는
   카드까지 숨겼다가 띄우면, 스크롤해서 꺼낸 카드가 비어 보인다. */

function revealTargets(section) {
  for (const cls in REVEAL_PARTS) {
    if (!section.classList.contains(cls)) continue;
    const found = REVEAL_PARTS[cls]
      .flatMap(sel => Array.from(section.querySelectorAll(sel)));
    if (found.length) return found;
  }
  return [section];
}

let revealObserver = null;
/* 홈을 떠났다 돌아왔을 때만 처음부터 다시 재생한다. 이 값이 false 면
   이미 뜬 요소는 그대로 두고, 아직 안 뜬 요소만 다시 관찰한다.
   (첫 로드 때 DOMContentLoaded 와 showPage('main') 이 각각 replayReveal 을
    부르는데, 둘 다 리셋하면 모션이 두 번 보인다.) */
let revealPending = true;

function setupReveal() {
  const home = document.querySelector('#page-main .home');
  if (!home) return;

  /* 브라우저가 못 따라오거나 사용자가 모션을 줄여 달라고 했으면 효과를 아예 건다.
     여기서 그냥 넘기면 opacity:0 인 채로 남아 홈이 백지로 보인다. */
  const reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduced) {
    home.classList.add('reveal-off');
    return;
  }
  home.classList.remove('reveal-off');

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        en.target.classList.add('rv-in');
        revealObserver.unobserve(en.target);   // 한 번만. 오르내릴 때마다 깜빡이면 성가시다
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  }

  home.querySelectorAll(':scope > section').forEach(section => {
    revealTargets(section).forEach((el, i) => {
      /* 이미 다 뜬 요소를 되돌리면 같은 모션이 한 번 더 보인다.
         dir 을 바꿔 새로 나타난 요소는 rv-in 이 없으므로 아래로 내려간다. */
      if (!revealPending && el.classList.contains('rv-in')) return;
      el.classList.add('rv');
      el.classList.remove('rv-in');
      el.style.setProperty('--rv-i', String(Math.min(i, 6)));  // 계단은 6칸에서 멈춘다
      revealObserver.observe(el);
    });
  });
  revealPending = false;
}

/* 홈을 벗어날 때 호출된다(app.js showPage). 다음 진입에서 다시 처음부터 재생. */
function leaveHome() { revealPending = true; }
window.leaveHome = leaveHome;

/* SPA 라 홈을 떠났다 돌아오면 클래스가 남아 있어 효과가 한 번만 돌고 끝난다.
   showPage 가 renderHome 을 다시 부르므로 여기서 매번 새로 건다. */
function replayReveal() {
  if (revealObserver) revealObserver.disconnect();
  setupReveal();
}

/* ══ 커리어 인사이트 카드 ══════════════════════════════════════
   ── 예전에는 HTML 에 제목 네 개가 박혀 있었다 ──
   그리고 **누를 수도 없었다** — 읽을 글이 애초에 없었기 때문이다. 제목에는
   '합격자 71%가 경험한 인턴십', 'TOEIC 900 vs 850' 처럼 출처 없는 수치까지
   들어 있었는데, 화면을 채우려고 넣은 값을 학생은 사실로 읽는다.

   지금은 커리어 인사이트 게시판의 **실제 글**로 이어진다. 카드 정의(제목·커버·
   소요시간)의 단일 출처는 서버다(backend/src/insight-featured.js) — 사진과 글이
   짝지어져 있어서 한쪽만 고치면 사진과 제목이 어긋난다.

   ── 못 받아 와도 홈은 멀쩡해야 한다 ──
   서버가 죽었거나 시드를 안 돌린 DB 면 카드가 안 나오는데, 그러면 홈 한가운데에
   빈 칸이 생긴다. 그때는 이 칸을 통째로 감춘다 — 제목만 있고 안 열리는 카드를
   보여 주느니 없는 편이 낫다. */
const ART_ACCENTS = ['acc-a', 'acc-b'];

async function paintArticles() {
  const box = document.getElementById('home-articles');
  if (!box || box.dataset.done === '1') return;   // 홈에 들를 때마다 다시 부르지 않는다

  let data = null;
  try { data = await DB.insightFeatured(); } catch { /* 아래에서 칸을 감춘다 */ }

  const list = data?.articles || [];
  const sec = document.getElementById('insights-sec');
  if (!list.length) { if (sec) sec.hidden = true; return; }
  if (sec) sec.hidden = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  box.innerHTML = list.map((a, i) => `
    <div class="art-card ${ART_ACCENTS[i % ART_ACCENTS.length]}" data-post="${esc(a.postId || '')}">
      <div class="art-cover art-cover--photo">
        <img src="img/insight/${esc(a.cover)}" alt="" loading="lazy" />
      </div>
      <div class="art-body">
        <span class="art-chip">${esc(a.chip)}</span>
        <div class="art-title">${esc(a.title)}</div>
        <div class="art-meta">커리어 인사이트 · ${a.minutes}분</div>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-post]').forEach(el => el.addEventListener('click', () => {
    /* 글이 아직 시드되지 않았으면 목록으로 보낸다. 아무 데도 안 가면 눌러도
       반응이 없는 카드가 되는데, 그건 고장으로 읽힌다. */
    const id = el.dataset.post;
    if (id) { try { localStorage.setItem(Insight.LS_OPEN, id); } catch { /* 프라이빗 모드 */ } }
    navigate('insight');
  }));

  box.dataset.done = '1';
}
window.paintArticles = paintArticles;

/* ── main page hook (called by app.js showPage) ─────────── */
function renderHome() { applyTweaks(); refreshStartFree(); paintArticles(); }
window.renderHome = renderHome;

/* ── "무료로 시작하기" — 로그인 상태별 동작 ───────────────── */
function currentUser() {
  try { return window.DB && DB.currentUser ? DB.currentUser() : null; } catch (e) { return null; }
}
function startFree() {
  if (currentUser()) navigate('mypage');   // 이미 로그인 → 내 대시보드(마이페이지)
  else navigate('signup');                 // 비로그인 → 회원가입
}
window.startFree = startFree;
function refreshStartFree() {
  const logged = !!currentUser();
  document.querySelectorAll('.js-start-free').forEach(b => {
    b.textContent = logged ? '내 대시보드 보기' : '무료로 시작하기';
  });
}
window.refreshStartFree = refreshStartFree;

/* ════════════════════════════════════════════════════════════
   NOTIFICATIONS — 종 아이콘 드롭다운 + 빨간점 (localStorage)
   ════════════════════════════════════════════════════════════ */
const NOTI_KEY = 'careerly_notifications_read';
const NOTIFICATIONS = [
  { ic: '🤝', title: '멘토링 신청이 승인되었습니다.', time: '10분 전', go: 'mentoring' },
  { ic: '✨', title: '새로운 추천 멘토가 도착했습니다.', time: '1시간 전', go: 'search' },
  { ic: '✍️', title: '작성하지 않은 멘토링 후기가 있습니다.', time: '어제', go: 'mentoring' },
  { ic: '🗺️', title: '직무 찾기가 업데이트되었습니다.', time: '2일 전', go: 'career' },
];
function notiIsRead() { return localStorage.getItem(NOTI_KEY) === 'true'; }
function syncNotiDot() {
  const dot = document.getElementById('noti-dot');
  if (dot) dot.classList.toggle('on', !notiIsRead());
}
function buildNotiPanel() {
  const panel = document.getElementById('noti-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="noti-head">
      <span class="noti-head-title">알림</span>
      <span class="noti-head-clear" onclick="markNotiRead()">모두 읽음</span>
    </div>
    <div class="noti-list">
      ${NOTIFICATIONS.map((n, i) => `
        <div class="noti-item ${notiIsRead() ? '' : 'unread'}" onclick="notiClick(${i})">
          <div class="noti-item-ic">${n.ic}</div>
          <div class="noti-item-body">
            <div class="noti-item-title">${n.title}</div>
            <div class="noti-item-time">${n.time}</div>
          </div>
        </div>`).join('')}
    </div>`;
}
function toggleNoti(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('noti-panel');
  if (!panel) return;
  const willOpen = !panel.classList.contains('on');
  if (willOpen) { buildNotiPanel(); markNotiRead(); }
  panel.classList.toggle('on', willOpen);
}
window.toggleNoti = toggleNoti;
function markNotiRead() {
  localStorage.setItem(NOTI_KEY, 'true');
  syncNotiDot();
  document.querySelectorAll('#noti-panel .noti-item').forEach(el => el.classList.remove('unread'));
}
window.markNotiRead = markNotiRead;
function notiClick(i) {
  document.getElementById('noti-panel').classList.remove('on');
  const n = NOTIFICATIONS[i];
  if (n && n.go) navigate(n.go);
}
window.notiClick = notiClick;
document.addEventListener('click', e => {
  const panel = document.getElementById('noti-panel');
  const wrap = e.target.closest('.noti-wrap');
  if (panel && panel.classList.contains('on') && !wrap) panel.classList.remove('on');
});

/* ════════════════════════════════════════════════════════════
   TWEAKS — home direction + accent
   ════════════════════════════════════════════════════════════ */
const TW = Object.assign({ homeDir: 'a', accent: 'both' }, window.TWEAKS || {});

function applyTweaks() {
  const b = document.body;
  b.classList.remove('dir-a', 'dir-b', 'dir-c', 'acc-purple', 'acc-blue');
  b.classList.add('dir-' + TW.homeDir);
  if (TW.accent === 'purple') b.classList.add('acc-purple');
  else if (TW.accent === 'blue') b.classList.add('acc-blue');
  // sync panel segmented controls
  syncSeg('tw-dir', TW.homeDir);
  syncSeg('tw-acc', TW.accent);
  /* dir 을 바꾸면 방금까지 display:none 이던 히어로가 나타난다. 그 요소는
     화면에 없는 동안 관찰되지 않아 .rv(opacity:0) 그대로라, 다시 걸어 주지 않으면
     투명한 채로 굳는다. 홈에 다시 들어올 때(renderHome)도 이 경로를 탄다. */
  replayReveal();
}
function syncSeg(id, val) {
  const seg = document.getElementById(id);
  if (!seg) return;
  seg.querySelectorAll('button').forEach(btn => btn.classList.toggle('on', btn.dataset.v === val));
}
function setTweak(key, val) {
  TW[key] = val;
  applyTweaks();
  try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*'); } catch (e) {}
}

/* panel show / hide */
function openTweaks()  { document.getElementById('tweaks-panel').classList.add('on'); }
function closeTweaks() {
  document.getElementById('tweaks-panel').classList.remove('on');
  try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {}
}
window.closeTweaks = closeTweaks;

/* host protocol — listener first, then announce */
window.addEventListener('message', e => {
  const t = e.data && e.data.type;
  if (t === '__activate_edit_mode')   openTweaks();
  if (t === '__deactivate_edit_mode') document.getElementById('tweaks-panel').classList.remove('on');
});

document.addEventListener('DOMContentLoaded', () => {
  applyTweaks();
  refreshStartFree();
  syncNotiDot();   // reveal 은 applyTweaks 안에서 함께 걸린다
  // wire segmented controls
  const dir = document.getElementById('tw-dir');
  const acc = document.getElementById('tw-acc');
  if (dir) dir.querySelectorAll('button').forEach(btn =>
    btn.addEventListener('click', () => setTweak('homeDir', btn.dataset.v)));
  if (acc) acc.querySelectorAll('button').forEach(btn =>
    btn.addEventListener('click', () => setTweak('accent', btn.dataset.v)));
  // announce availability
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
});
