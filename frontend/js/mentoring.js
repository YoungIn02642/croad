/* ════════════════════════════════════════════════════════════
   C:road · Mentoring app — data + interactions
   ════════════════════════════════════════════════════════════ */

/* ── avatar palette ─────────────────────────────────────── */
const PALETTE = {
  purple: { bg:'#EEEDFE', ink:'#3C3489' },
  green:  { bg:'#E1F5EE', ink:'#085041' },
  orange: { bg:'#FAECE7', ink:'#712B13' },
  pink:   { bg:'#FBEAF0', ink:'#72243E' },
  blue:   { bg:'#E6F1FB', ink:'#0C447C' },
  teal:   { bg:'#E0F2F1', ink:'#0F5C57' },
};

/* ── 멘토 (멘토 찾기 · 멘토 상세) ────────────────────────────
   ── 예전에는 여기 가짜 멘토 102명이 박혀 있었다 (2026-08-22 걷어냄) ──
   손으로 쓴 6명 + 그걸 NCS 24분야로 불려 만든 96명이었고, 별점·후기·상담 횟수·
   예약 가능 일정까지 멘토 id 로 난수를 만들어 채웠다. 그래서 두 가지가 동시에 틀렸다.

     ① **멘토가 멘토 페이지를 채워도 목록에 안 떴다.** 화면이 서버를 보지 않았다
        (사용자 지적). 실제 회원과 화면이 아예 이어져 있지 않았던 것이다.
     ② 후배가 그 별점과 후기를 **진짜로 읽었다.** 4.8점·후기 12건은 화면을 채우려고
        만든 숫자인데, 멘토를 고르는 근거로 쓰인다.

   지금은 서버가 원본이다(GET /api/mentors → repo.mentors.list).
   **프로필을 채운 멘토만** 내려온다 — 소개글도 전문분야도 없는 카드를 눌러 봐야
   후배에게 아무것도 없기 때문이다.

   ── 없는 값은 만들지 않는다 (사용자 결정) ──
   별점·후기 수·상담 인원·학번·상담 주제는 채울 데이터가 없다(멘토링 신청 0건).
   0으로 채우거나 '아직 없음' 을 늘어놓는 대신 **칸 자체를 없앴다.** 카드에는
   근거가 있는 것만 남는다: 이름 · 직무 · 회사 · 경력 연차 · 전문분야 · 소개글. */
let MENTORS = [];
let mentorsLoaded = false;
let mentorsError = null;

async function loadMentors() {
  if (mentorsLoaded) return MENTORS;
  try {
    MENTORS = await DB.mentors();
    mentorsError = null;
  } catch (e) {
    MENTORS = [];
    mentorsError = e.message || '멘토 목록을 불러오지 못했어요.';
  }
  mentorsLoaded = true;
  return MENTORS;
}

/* 멘토가 새로 프로필을 채웠을 수 있으므로 다음에 들어올 때 다시 받는다.
   멘토 페이지에서 저장한 뒤 '멘토 찾기'로 가면 바로 보여야 한다. */
function invalidateMentors() { mentorsLoaded = false; }
window.invalidateMentors = invalidateMentors;

/* ── 분야 분류 ────────────────────────────────────────────────
   커리어 로드맵·스펙 입력과 **같은 KECO 1차 분류**를 쓴다(사용자 결정).
   예전에는 여기만 NCS 24분야였는데, 멘토 스펙에 실제로 저장되는 값은 KECO 라
   둘을 잇는 번역표가 필요했다. 분류를 하나로 모으면 그 자리가 사라진다.

   목록은 KECO.load() 가 받아 온다(비동기). 아직 안 왔으면 칩 없이 전체만 보여준다 —
   분류를 못 받았다고 멘토 목록까지 막을 이유는 없다. */
function mentorCategories() {
  return (window.KECO && KECO.MAJORS) ? KECO.MAJORS() : [];
}
function categoryName(code) {
  return mentorCategories().find(M => M.code === code)?.name || '';
}

/* 아바타 색 — 예전에는 시드 데이터에 pal 이 박혀 있었다. 실제 회원에는 그런 칸이
   없고 만들 이유도 없어서, 아이디에서 결정론적으로 고른다(같은 사람은 늘 같은 색). */
/* PAL_KEYS 는 아래 '내 멘토링' 쪽에서 이미 만들어 둔 것을 쓴다(같은 팔레트다).
   const 라 선언은 뒤에 있지만, 이 함수는 화면을 그릴 때 불리므로 문제되지 않는다. */
function palOf(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return PAL_KEYS[h % PAL_KEYS.length];
}

/* 예약 가능 일정 — 멘토가 멘토 페이지에서 연 날짜 그대로다(profiles.availability).
   예전에는 멘토 id 로 난수를 굴려 만들었다. 후배가 그 시간에 신청을 넣어도
   멘토는 그런 시간을 연 적이 없다. */
function availabilityFor(m) {
  const out = new Map();
  (m?.availability || []).forEach(s => {
    if (s?.date && Array.isArray(s.times) && s.times.length) out.set(s.date, [...s.times]);
  });
  return out;
}

/* ── my mentoring (seed) ────────────────────────────────── */
/* 시작 상태는 비어 있다.
   예전에는 예시 멘토링 내역(진행 2건·완료 5건·받은 요청 1건)을 넣어 뒀는데,
   내 것이 아닌 기록이 '내 멘토링' 에 남는 게 실제 데이터처럼 보였다.
   신청은 서버(mentoring_requests)에서 syncApplied() 가 받아 채운다. */
const SEED = {
  ongoing: [],
  completed: [],
  received: [],
  /* 내가 보낸 신청 — 멘토가 아직 수락/거절하지 않은 것. 서버가 원본이다. */
  applied: [],
};

/* ── persisted state ────────────────────────────────────── */
/* v1 → v2: 예시 데이터를 비우면서 키를 올린다.
   **키를 그대로 두면 아무 것도 안 바뀐다** — 이미 브라우저에 저장된 v1 에는
   옛 예시(진행 2건·완료 5건)가 들어 있어서, SEED 를 비워도 그쪽이 그대로 실린다. */
const LS_KEY = 'careerly_mentoring_v2';
let STATE = loadState();
/* 저장분에 목록 하나가 없으면 renderMentoring 이 STATE.received.length 에서 죽는다.
   예전 가드는 completed 만 봐서, received 가 생기기 전에 저장된 상태가 남아 있으면
   멘토링 페이지가 통째로 흰 화면이 됐다. 빠진 목록은 SEED 로 메운다. */
function loadState() {
  const seed = JSON.parse(JSON.stringify(SEED));
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (saved && typeof saved === 'object') {
      return {
        ongoing:   Array.isArray(saved.ongoing)   ? saved.ongoing   : seed.ongoing,
        completed: Array.isArray(saved.completed) ? saved.completed : seed.completed,
        received:  Array.isArray(saved.received)  ? saved.received  : seed.received,
        applied:   Array.isArray(saved.applied)   ? saved.applied   : seed.applied,
      };
    }
  } catch(e) {}
  return seed;
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); }

/* ── helpers ────────────────────────────────────────────── */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
function initial(name){ return name.charAt(0); }
/* 이름 가운데를 * 로 가린다: 황수아 → 황*아, 남궁도윤 → 남**윤, 김준 → 김* */
function maskName(name){
  if (!name) return '';
  if (name.length <= 2) return name.charAt(0) + '*';
  return name.charAt(0) + '*'.repeat(name.length-2) + name.charAt(name.length-1);
}
/* 경력 타임라인의 세부내용.
   주요내용(소속·직함 + 기간)과 세부내용(거기서 무엇을 했는가)이 예전에는 같은 굵기로
   세 줄 쌓여 있어서, 훑어볼 때 어디가 회사고 어디가 한 일인지 구분되지 않았다.
   세부내용은 목록으로 내린다.

   한 칸에 여러 건이 쉼표로 들어오는 경우가 있다("웹 서비스 2건 출시, 해커톤 수상").
   그건 항목을 나눠 각각 한 줄로 보여준다 — 나열된 성과는 세로로 읽어야 눈에 들어온다. */
function tlDetails(s){
  if (!s || !s.trim()) return '';
  const items = s.split(/\s*,\s*/).map(x=>x.trim()).filter(Boolean);
  return `<ul class="tl-detail">${items.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>`;
}
function avatarStyle(pal){ const p = PALETTE[pal]||PALETTE.purple; return `background:${p.bg};color:${p.ink};`; }
/* 멘토가 사진을 올렸으면 사진, 아니면 이름 첫 글자다.
   사진은 profiles.avatar 의 data: URI 라 따로 받아올 것이 없다. */
function avatarHtml(m, cls){
  if (m.avatar) {
    return `<img class="avatar ${cls} avatar--img" src="${escapeHTML(m.avatar)}" alt="" loading="lazy" />`;
  }
  return `<div class="avatar ${cls}" style="${avatarStyle(palOf(m.id))}">${escapeHTML(initial(m.name))}</div>`;
}
function starsHTML(n){
  let h = '<span class="stars">';
  for (let i=1;i<=5;i++) h += `<i class="ti ti-star-filled ${i<=Math.round(n)?'fill':''}"></i>`;
  return h+'</span>';
}
/* 기본 아이콘이 체크(성공) 표시다. **실패·취소·입력 안내에는 { icon: false } 를 줄 것** —
   "결제를 취소했어요" 옆에 초록 체크가 붙으면 결제가 된 것처럼 읽힌다. */
function toast(msg, opts){
  const icon = (opts && opts.icon === false) ? '' : '<i class="ti ti-circle-check-filled"></i>';
  const t = $('#toast'); t.innerHTML = `${icon}${msg}`;
  t.classList.add('on'); clearTimeout(t._tm);
  t._tm = setTimeout(()=>t.classList.remove('on'), 2600);
}

/* ── navigation ─────────────────────────────────────────────
   라우팅은 app.js 의 전역 navigate() 하나가 담당한다. 이 파일은 화면을
   그리는 훅(onEnter)만 제공하고, 링크는 그대로 navigate('search') 처럼 부른다. */
function onEnterMentoringPage(page){
  // #profile 로 직접 진입/새로고침하면 그릴 멘토가 없다 → 목록으로 되돌린다.
  if (page==='profile' && !currentMentor) { navigate('search'); return; }
  if (page==='dashboard') {
    /* 스텝바는 로그인 게이트보다 먼저 건다. 게이트는 .wrap 만 가리므로 그 위의
       스텝바는 그대로 보이는데, CASHero.render() 안에서만 그리면 로그아웃 상태에서
       2단계 화면만 스텝바가 없는 화면이 된다. (CASHero 쪽 mount 는 직무를 바꿀 때
       목표 칩을 다시 그리기 위한 것이라 둘 다 필요하다 — 통째로 교체라 겹쳐도 된다.) */
    Roadmap.mount('rm-bar-dashboard', 'me');
    // 내 CAS 점수·비교·부족항목은 전부 '내 스펙' 기반이라 로그인이 없으면 보여줄 게 없다.
    if (!ensureLoginGate('page-dashboard', {
      title: '로그인하고 내 CAS 점수를 확인하세요',
      desc:  '스펙을 입력하면 같은 길을 간 선배 데이터와 비교해 역량 점수와 백분위를 계산해 드려요.',
    })) return;
    if (window.CASHero)  CASHero.render();     // 점수·백분위 (막대도 여기서 채운다)
    if (window.CASRadar) CASRadar.render();
    animateDashboard();
  }
  if (page==='search')    enterSearch();
  if (page==='mentoring') {
    // 내 멘토링 내역·메모·평점은 개인 데이터다. 비로그인 상태에서 예시(SEED)가
    // 마치 내 기록처럼 보이던 문제 → 로그인 게이트로 가린다.
    if (!ensureLoginGate('page-mentoring', {
      title: '로그인하고 내 멘토링 내역을 확인하세요',
      desc:  '신청한 멘토링과 메모·평점은 로그인 후 내 계정에서 볼 수 있어요.',
    })) return;
    renderMentoring();
    /* 먼저 그리고 나서 서버 것으로 덮는다. 기다렸다 그리면 페이지가 잠깐 비어
       깜빡인다. 실패해도 화면은 이미 떠 있다. */
    syncApplied();
  }
}

/* '내가 신청' 목록을 서버에서 가져온다.
   신청은 POST /api/mentoring/requests 로 DB 에 잘 들어가는데, 화면은
   localStorage 만 보고 있어서 방금 보낸 신청이 목록에 안 뜨는 문제가 있었다.
   기기를 바꾸면 아예 사라지기도 했다. 이 목록의 진실은 서버다 — 결제·상태가
   서버에서 바뀌기 때문이다. 받아온 것으로 통째로 교체한다. */
async function syncApplied(){
  try {
    const { requests } = await api('GET', '/api/mentoring/requests');
    STATE.applied = requests.filter(r => OPEN_ON_SCREEN.includes(r.status)).map(toCard);
    saveState();
    renderMentoring();
  } catch (e) {
    /* 로그인이 풀렸거나 네트워크가 끊긴 경우다. 마지막으로 받아 둔 목록을
       그대로 두는 편이 빈 화면보다 낫다. */
    console.warn('[mentoring] 신청 목록을 가져오지 못했습니다:', e.message);
  }
}

/* 멘토 응답을 기다리는 동안만 이 목록에 있다. 완료·취소된 것은 빼야
   '신청 취소' 버튼이 이미 끝난 건에도 붙지 않는다. */
const OPEN_ON_SCREEN = ['pending', 'paid'];
const PAL_KEYS = Object.keys(PALETTE);

function toCard(r){
  return {
    id:     r.id,
    status: r.status,
    mentor: r.mentorName || '멘토',
    /* 이름마다 색을 고정한다. 매번 랜덤이면 새로고침할 때 아바타 색이 바뀐다. */
    pal:    PAL_KEYS[[...(r.mentorName || '')].reduce((a,c)=>a+c.charCodeAt(0),0) % PAL_KEYS.length],
    sub:    r.formatName || '',
    topic:  r.message ? '' : '멘토링 신청',
    want:   r.formatName || '',
    cost:   r.amount ? `${Number(r.amount).toLocaleString()}원` : '',
    when:   (r.createdAt || '').slice(0, 10),
    msg:    r.message || '',
  };
}

/* 로그인 게이트 — 개인 데이터 페이지(내 CAS·내 멘토링)를 비로그인 시 블러 처리하고
   가운데에 로그인 버튼을 띄운다. 로그인 상태면 블러·오버레이를 걷어내고 true 를 준다.
   showPage 가 진입할 때마다 부르므로 상태가 바뀌면 스스로 정리된다. */
function ensureLoginGate(pageId, opts){
  const page = document.getElementById(pageId);
  if (!page) return true;
  const wrap = page.querySelector('.wrap');
  const loggedIn = !!(window.DB && DB.currentUser());

  if (loggedIn){
    if (wrap) wrap.classList.remove('login-locked');
    const ov = page.querySelector('.login-gate');
    if (ov) ov.remove();
    return true;
  }

  if (wrap) wrap.classList.add('login-locked');
  if (!page.querySelector('.login-gate')){
    const ov = document.createElement('div');
    ov.className = 'login-gate';
    ov.innerHTML = `
      <div class="login-gate-card">
        <div class="login-gate-ic"><i class="ti ti-lock"></i></div>
        <div class="login-gate-title">${opts.title}</div>
        <div class="login-gate-desc">${opts.desc}</div>
        <button class="login-gate-btn" onclick="navigate('login')"><i class="ti ti-login"></i>로그인하러 가기</button>
      </div>`;
    page.appendChild(ov);
  }
  return false;
}

/* ════════════ DASHBOARD ════════════ */
/* 백분위 막대는 CASHero 가 실제 점수로 채운다 — 여기서 건드리면 덮어써진다.
   아래 비교 막대(.cmp-me)는 아직 careerly.html 의 하드코딩 값(data-w)이다. */
function animateDashboard(){
  requestAnimationFrame(()=>{
    setTimeout(()=>{
      $$('.cmp-me').forEach(el=>{ el.style.width = el.dataset.w+'%'; });
    }, 80);
  });
}

/* ════════════════════════════════════════════════════════════
   GAP — 목표 직무까지 나에게 부족한 항목

   ── 목업이었다 ──
   여기는 원래 하드코딩 배열이라 **누가 로그인하든 정보처리기사·SQLD·AWS SAA** 가
   떴다. 취업 준비 순서를 이 목록을 보고 정하는 학생에게는 단순 미완성이 아니라
   틀린 정보였다(8장 CEO 공개 선행조건 1번 · B4).

   ── 무엇을 '부족' 이라 부르는가 (사용자 결정) ──
   선배 데이터로만 판정한다. 우리가 중요하다고 생각하는 것이 아니라
   **같은 직무로 간 선배들이 실제로 갖고 있는 것** 중 내게 없는 것이다.

   | 탭 | 부족 판정 |
   |---|---|
   | 자격증 | 선배 보유율 ≥ 40% 인데 내 목록에 없다 |
   | 활동·경험 | 선배 보유율 ≥ 40% 인 활동 유형인데 내 활동에 한 건도 없다 |
   | 수상 경력 | 선배 보유율 ≥ 25% 인 성과 종류인데 내 활동 어디에도 그 성과가 없다 |

   ── 표본이 적으면 판정하지 않는다 ──
   3명 중 2명이 가졌다고 '67% 필수' 라고 적으면 실제보다 단단한 숫자로 읽힌다.
   CAS 백분위(5명)·직무 트렌드(30건) 와 같은 원칙으로 **5명 미만이면 판정을 접고
   왜 접었는지 적는다.** 성과는 문턱을 25% 로 낮추는데, 수상은 보유율 자체가
   낮아서 40% 를 걸면 어느 직무에서도 아무것도 안 뜬다(그러면 '부족 없음' 으로
   잘못 읽힌다).
   ════════════════════════════════════════════════════════════ */
const GAP_MIN_PEERS = 5;
const GAP_RATE = { cert: 40, activity: 40, award: 25 };
const GAP_MAX_ROWS = 6;

/* 성과(outcome)는 활동에 붙는 배수라 유형별 보유율과 축이 다르다 — 따로 센다.
   라벨은 CAS.OUTCOME_MULT 의 키와 1:1 이어야 한다(설문 선택지와 같은 말). */
const GAP_OUTCOMES = [
  { ic: '🏆', name: '공모전·대회 수상',      match: ['수상'],                                       help: '수상 이력은 CAS 성과 배수 ×1.3' },
  { ic: '📄', name: '논문·연구 성과',        match: ['논문'],                                       help: '연구 경험의 결과물' },
  { ic: '💼', name: '인턴 정규직 전환',      match: ['전환, 정규직 합격'],                          help: '가장 강한 성과 배수 ×1.4' },
  { ic: '📦', name: '산출물 공개(깃헙 등)',  match: ['발표 또는 산출물 공개(깃헙 등)', '산출물 공개(깃헙 등)'], help: '결과를 남긴 활동' },
];

let currentGapType = 'cert';
window.currentGapType = currentGapType;

const gapEsc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 내 활동 목록 — 옛 boolean qual 스펙도 CAS 가 환산해 준다(단일 출처). */
const myActivities = spec => (typeof CAS !== 'undefined' ? CAS.normalizeActivities(spec) : (spec?.activities || []));

/* 한 스펙이 그 성과를 하나라도 가졌는가 */
const hasOutcome = (spec, labels) =>
  myActivities(spec).some(a => labels.includes(a.outcome));

/* 중요도 칩 — 선배 보유율이 곧 중요도다. 우리가 '필수' 라고 정하는 게 아니라
   "선배 몇 %가 갖고 있는가" 를 말로 바꾼 것뿐이다. */
function gapPill(pct) {
  if (pct >= 70) return { cls: 'high', text: '대부분 보유' };
  if (pct >= 40) return { cls: 'mid',  text: '절반 이상' };
  return { cls: 'mid', text: '일부 보유' };
}

/* ── 탭별 부족 항목 계산 ────────────────────────────────────── */
function computeGaps(type, ctx) {
  const { spec, agg } = ctx;
  const min = GAP_RATE[type] ?? 40;

  if (type === 'cert') {
    const mine = new Set(spec?.certs || []);
    return (agg.certs || [])
      .filter(c => c.pct >= min && !mine.has(c.id))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, GAP_MAX_ROWS)
      .map(c => ({
        ic: '📜', name: c.name, pct: c.pct,
        desc: `선배 ${c.pct}%가 보유 (${c.n}명)${c.desc ? ` · ${c.desc}` : ''} · 나는 미보유`,
        stat: '미보유',
      }));
  }

  if (type === 'activity') {
    const mineCount = {};
    myActivities(spec).forEach(a => { mineCount[a.type] = (mineCount[a.type] || 0) + 1; });
    return (agg.qual || [])
      .filter(q => q.pct >= min && !mineCount[q.id])
      .sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || b.pct - a.pct)
      .slice(0, GAP_MAX_ROWS)
      .map(q => ({
        ic: q.icon || '✨', name: q.label, pct: q.pct,
        desc: `선배 ${q.pct}%가 경험 (${q.n}명) · ${q.help || ''} · 나는 없음`,
        stat: '없음',
      }));
  }

  // award — 성과 종류별
  const peers = agg.specs || [];
  return GAP_OUTCOMES
    .map(o => {
      const have = peers.filter(s => hasOutcome(s, o.match)).length;
      return { ...o, pct: Math.round((have / peers.length) * 100), n: have };
    })
    .filter(o => o.pct >= min && !hasOutcome(spec, o.match))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, GAP_MAX_ROWS)
    .map(o => ({
      ic: o.ic, name: o.name, pct: o.pct,
      desc: `선배 ${o.pct}%가 보유 (${o.n}명) · ${o.help} · 나는 없음`,
      stat: '없음',
    }));
}

/* 판정을 할 수 있는 상태인가. 못 하면 '왜 못 하는지' 를 돌려준다 —
   빈 목록만 보여주면 '부족한 게 없다' 로 읽힌다(정반대 뜻이다).

   ctx 를 받는 이유: 스펙업 화면(#specup)은 CAS 화면을 거치지 않고 바로 들어올 수
   있어서 window.CASDashboardContext 가 비어 있거나 직전 사용자의 것일 수 있다.
   그쪽은 CASHero.resolveContext() 로 자기 문맥을 직접 만들어 넘긴다. */
function gapContext(explicit) {
  const ctx = explicit || window.CASDashboardContext;
  if (!ctx || !ctx.agg) {
    return { ok: false, icon: '🔒', title: '아직 판정할 수 없어요',
             desc: DB.currentUser()
               ? '스펙을 입력하면 같은 직무 선배와 비교해 부족한 항목을 찾아드려요.'
               : '로그인하고 스펙을 입력하면 부족한 항목을 찾아드려요.' };
  }
  if (ctx.agg.count < GAP_MIN_PEERS) {
    return { ok: false, icon: '📉', title: `선배 표본이 ${ctx.agg.count}명뿐이에요`,
             desc: `${GAP_MIN_PEERS}명은 모여야 '몇 %가 갖고 있다'가 뜻을 가집니다. `
                 + '표본이 적을 때 비율을 보여주면 실제보다 단단한 숫자로 읽혀서, 판정을 접어 뒀어요.' };
  }
  return { ok: true, ctx };
}

function renderGap(type) {
  currentGapType = type;
  window.currentGapType = type;
  $$('.gap-tab').forEach(t => t.classList.toggle('on', t.dataset.gap === type));

  const host = $('#gap-list');
  const summary = $('#gap-summary');
  if (!host) return;

  const state = gapContext();
  if (!state.ok) {
    if (summary) summary.textContent = state.desc;
    host.innerHTML = `
      <div class="gap-empty">
        <div class="gap-empty-ic">${state.icon}</div>
        <div class="gap-empty-title">${gapEsc(state.title)}</div>
        <div class="gap-empty-desc">${gapEsc(state.desc)}</div>
      </div>`;
    return;
  }

  const { ctx } = state;
  const scope = ctx.scopeLabel || '내 직무';
  const rows = computeGaps(type, ctx);

  if (summary) {
    summary.innerHTML = `<b>${gapEsc(scope)}</b> 선배 ${ctx.agg.count}명과 비교했어요. `
      + `선배 보유율 ${GAP_RATE[type]}% 이상인 항목 중 내게 없는 것만 보여드립니다.`;
  }

  if (!rows.length) {
    host.innerHTML = `
      <div class="gap-empty gap-empty--ok">
        <div class="gap-empty-ic">✅</div>
        <div class="gap-empty-title">이 항목은 선배 평균만큼 채웠어요</div>
        <div class="gap-empty-desc">${gapEsc(scope)} 선배 ${ctx.agg.count}명 중
          ${GAP_RATE[type]}% 이상이 가진 것 가운데 빠진 게 없습니다.</div>
      </div>`;
    return;
  }

  host.innerHTML = rows.map(g => {
    const p = gapPill(g.pct);
    return `
    <div class="gap-item">
      <div class="gap-item-ic">${g.ic}</div>
      <div class="gap-item-body">
        <div class="gap-item-name">${gapEsc(g.name)} <span class="gap-pill ${p.cls}">${p.text}</span></div>
        <div class="gap-item-desc">${gapEsc(g.desc)}</div>
      </div>
      <div class="gap-item-stat">
        <div class="pct lack">${gapEsc(g.stat)}</div>
        <div class="lab">선배 ${g.pct}%</div>
      </div>
    </div>`;
  }).join('');
}

/* 세 탭을 통틀어 부족한 항목이 몇 개인지 — 아래 갈림길이 어느 쪽을 권할지 정한다. */
function totalGapCount(explicit) {
  const state = gapContext(explicit);
  if (!state.ok) return null;                       // 판정 불가 — '없다'와 구분한다
  return ['cert', 'activity', 'award']
    .reduce((n, t) => n + computeGaps(t, state.ctx).length, 0);
}

/* 스펙업 화면(js/specup.js)이 같은 판정을 다시 짜지 않게 내보낸다.
   '무엇이 부족한가' 의 기준이 두 벌이 되면 CAS 에서 3개라던 것이 스펙업에서 5개가
   되는 식으로 갈린다 — 판정 규칙은 여기가 단일 출처다. */
window.Gap = {
  computeGaps, gapContext, totalGapCount,
  TYPES: ['cert', 'activity', 'award'],
  RATE: GAP_RATE, MIN_PEERS: GAP_MIN_PEERS, OUTCOMES: GAP_OUTCOMES,
};

/* ════════════════════════════════════════════════════════════
   로드맵 2단계의 갈림길 — 스펙을 더 채울까, 지원할 회사를 찾을까

   ── 어느 쪽도 막지 않는다 ──
   부족한 항목이 있으면 '스펙 채우기' 를 주 버튼으로 두지만, '지원할 회사' 도
   같이 보여준다. 스펙이 완벽해질 때까지 지원하지 말라는 말이 되면 안 된다 —
   공고에는 마감일이 있고, 그 판단은 학생이 한다.
   ════════════════════════════════════════════════════════════ */
function renderRoadmapNext(mine, pct) {
  const host = $('#cas-next');
  if (!host) return;

  const rm = Roadmap.get();
  if (!rm) {
    host.innerHTML = `
      <div class="rm-next rm-next--muted">
        <div class="rm-next-body">
          <div class="rm-next-eyebrow">커리어 로드맵 1단계</div>
          <h3>목표 직무를 먼저 골라 주세요</h3>
          <p>직무를 고르면 그 직무 선배와 비교해 점수를 다시 계산하고,
             부족한 항목과 지원할 회사까지 이어서 안내해 드려요.</p>
        </div>
        <button type="button" class="rm-next-btn" onclick="navigate('career')">
          직무 찾기 <i class="ti ti-arrow-right"></i>
        </button>
      </div>`;
    return;
  }

  const gaps = totalGapCount();
  const goal = rm.jobName || rm.middleName;

  /* 판정 불가(로그인 전·스펙 없음·표본 부족)는 '부족 없음'과 다르다.
     그때는 무엇을 하면 판정이 되는지를 말하고, 지원 쪽 길도 열어 둔다. */
  const lacking = gaps == null ? null : gaps > 0;

  const headline = lacking === null
    ? '스펙을 입력하면 부족한 항목을 짚어드려요'
    : lacking
      ? `채우면 좋을 항목이 ${gaps}개 있어요`
      : '선배 평균만큼 채웠어요 — 지원해 볼 때예요';

  const desc = lacking === null
    ? `${gapEsc(goal)} 기준으로 무엇이 부족한지 알려면 내 스펙이 필요해요. 지금 바로 지원 준비로 넘어가도 됩니다.`
    : lacking
      ? `${gapEsc(goal)} 선배들이 갖고 있는데 내게 없는 항목이에요. 다만 준비가 끝나야 지원할 수 있는 건 아니니, 공고를 먼저 봐도 좋아요.`
      : `${gapEsc(goal)} 선배들이 가진 것 중 빠진 게 없어요. 이제 어느 회사에 쓸지 정할 차례입니다.`;

  /* ── '스펙 채우기' 의 목적지가 바뀌었다 ──────────────────────
     예전에는 마이페이지 스펙 입력 폼(navigateTo('mypage','spec'))으로 갔다.
     그런데 거기는 **이미 한 것을 적는 곳**이다. 방금 "채우면 좋을 항목이 3개 있어요"
     를 읽고 누른 사람에게 빈 입력 폼을 주면 흐름이 거기서 끊긴다.
     이제는 #specup 으로 간다 — 부족한 항목마다 지금 접수 중인 시험·모집 공고를
     붙여 보여주는 화면이다(js/specup.js). */
  const fillBtn = `
    <button type="button" class="rm-next-btn ${lacking ? '' : 'rm-next-btn--ghost'}"
            onclick="navigate('specup')">
      <i class="ti ti-pencil-plus"></i> 스펙UP
    </button>`;
  const applyBtn = `
    <button type="button" class="rm-next-btn ${lacking ? 'rm-next-btn--ghost' : ''}"
            onclick="Roadmap.goNext('me')">
      ${Roadmap.withJosa(goal, '로')} 지원하기 <i class="ti ti-arrow-right"></i>
    </button>`;

  host.innerHTML = `
    <div class="rm-next rm-next--fork">
      <div class="rm-next-body">
        <div class="rm-next-eyebrow">커리어 로드맵 · 다음 단계</div>
        <h3>${gapEsc(headline)}</h3>
        <p>${desc}</p>
      </div>
      <div class="rm-next-actions">
        ${lacking ? fillBtn + applyBtn : applyBtn + fillBtn}
      </div>
    </div>`;
}
window.renderRoadmapNext = renderRoadmapNext;

/* ════════════ MENTOR SEARCH ════════════ */
let searchFilter = '전체';
let searchQuery = '';

/* 멘토 찾기에 들어올 때 — 목록과 분류를 받아 오고 나서 그린다.
   예전에는 배열이 파일에 박혀 있어서 그냥 renderSearch() 만 부르면 됐다.

   ── 먼저 '불러오는 중'을 띄운다 ──
   기다리는 동안 아무것도 없으면 '멘토가 없는 화면' 과 구분되지 않는다.
   그 순간에 나가 버리는 사람이 생긴다. */
async function enterSearch(){
  const grid = $('#mentor-grid');
  if (grid && !MENTORS.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="t">멘토를 불러오는 중…</div></div>`;
  }
  /* 분류(KECO)는 200KB 라 다른 화면에서 이미 받았을 수 있다. KECO.load() 는
     두 번 불러도 한 번만 받는다(keco.js). 실패해도 목록은 그려야 한다. */
  await Promise.all([loadMentors(), (window.KECO ? KECO.load().catch(()=>{}) : null)]);
  initSearchFilters();
  renderSearch();
}

/* 필터 선택지는 **지금 있는 멘토에서 뽑는다.** 예전에는 가짜 멘토 102명에서
   뽑아서, 목록에 없는 회사·전문분야가 드롭다운에 가득했다(고르면 0명).
   분야 칩만 KECO 분류 전체를 깐다 — 아직 멘토가 없는 분야도 "여긴 없구나" 가
   보여야 하고, 칩이 멘토 수에 따라 늘었다 줄었다 하면 화면이 흔들린다. */
function initSearchFilters(){
  const chipBox = $('#filter-chips');
  if (chipBox){
    const cats = mentorCategories();
    chipBox.innerHTML = `<span class="chip on" data-cat="전체" onclick="setFilter('전체')">전체</span>` +
      cats.map(M=>`<span class="chip" data-cat="${M.code}" onclick="setFilter('${M.code}')"><span class="chip-no">${String(M.no).padStart(2,'0')}</span>${escapeHTML(M.name)}</span>`).join('');
    chipBox.addEventListener('scroll', updateChipsArrows);
    initChipsDrag();
    setTimeout(updateChipsArrows, 0);
  }
  const companies = [...new Set(MENTORS.map(m=>m.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const cSel = $('#f-company');
  if (cSel) cSel.innerHTML = `<option value="all">전체</option>` + companies.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  const specs = [...new Set(MENTORS.flatMap(m=>m.specialties||[]))].sort((a,b)=>a.localeCompare(b,'ko'));
  const sSel = $('#f-spec');
  if (sSel) sSel.innerHTML = `<option value="all">전체</option>` + specs.map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
}
let searchPage = 1;
const PER_PAGE = 9;

function onSearchInput(v){ searchQuery = (v||'').trim().toLowerCase(); searchPage = 1; renderSearch(); }
function expBucket(years){ if (years>=5) return 5; if (years>=3) return 3; return 1; }

function getFilteredMentors(){
  const fCompany = $('#f-company') ? $('#f-company').value : 'all';
  const fExp     = $('#f-exp') ? $('#f-exp').value : 'all';
  const fMode    = $('#f-mode') ? $('#f-mode').value : 'all';
  const fSpec    = $('#f-spec') ? $('#f-spec').value : 'all';
  const sortBy   = $('#sort-by') ? $('#sort-by').value : 'recommend';

  let list = MENTORS.filter(m=>{
    /* 분야는 멘토 스펙의 KECO 1차 코드로 거른다. 안 고른 멘토는 '전체' 에서만 보인다 —
       임의로 아무 분야에 넣으면 그 분야를 고른 후배에게 엉뚱한 선배가 뜬다. */
    if (searchFilter!=='전체' && m.jobMajor!==searchFilter) return false;
    if (fCompany!=='all' && m.company!==fCompany) return false;
    /* 경력을 안 적은 멘토(years=null)는 연차 필터를 걸면 빠진다. 1년차로 치면
       '경력 없음' 과 '1년차' 가 한 칸에 섞인다. */
    if (fExp!=='all' && (m.years==null || String(expBucket(m.years))!==fExp)) return false;
    if (fMode!=='all' && !(m.modes||[]).includes(fMode)) return false;
    if (fSpec!=='all' && !(m.specialties||[]).includes(fSpec)) return false;
    if (searchQuery){
      const hay = [m.name, m.company, m.role, categoryName(m.jobMajor),
                   ...(m.specialties||[]), m.intro].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });
  /* ── 정렬에서 평점·멘토링 횟수를 없앴다 (2026-08-22) ──
     그 두 값은 가짜 멘토에게만 있던 숫자다. 실제 멘토링 신청은 아직 0건이라
     정렬 기준으로 쓸 수 있는 것이 없다. 남은 것은 경력 연차와 기본 순서다. */
  list = list.slice().sort((a,b)=>{
    if (sortBy==='career') return (b.years||0) - (a.years||0);
    /* 기본순 — 프로필을 더 채운 사람이 위로 온다. 후배가 눌러서 읽을 게 많은
       카드가 먼저 보이는 것이고, 멘토에게는 채울수록 노출된다는 뜻이 된다. */
    return profileFill(b) - profileFill(a);
  });
  return list;
}

/* 프로필을 얼마나 채웠나. 정렬 기준으로만 쓴다(화면에 숫자로 나가지 않는다). */
function profileFill(m){
  return (m.intro ? 2 : 0) + Math.min(4, (m.specialties||[]).length)
       + Math.min(3, (m.timeline||[]).length) + ((m.availability||[]).length ? 2 : 0)
       + (m.company ? 1 : 0) + (m.role ? 1 : 0);
}

function renderSearch(){
  const list = getFilteredMentors();
  $('#search-count').textContent = list.length;

  const grid = $('#mentor-grid');
  if (!list.length){
    /* ── '아직 아무도 없다' 와 '필터에 안 걸린다' 를 구분한다 ──
       멘토가 0명인데 "필터를 바꿔 보세요" 라고 하면, 후배는 있지도 않은 조건을
       계속 바꿔 본다. 목록 자체가 비었을 때는 그렇게 말한다. */
    grid.innerHTML = mentorsError
      ? `<div class="empty-state" style="grid-column:1/-1"><div class="ic"><i class="ti ti-plug-connected-x"></i></div>
           <div class="t">멘토 목록을 불러오지 못했어요</div><div class="d">${escapeHTML(mentorsError)}</div></div>`
      : !MENTORS.length
      ? `<div class="empty-state" style="grid-column:1/-1"><div class="ic"><i class="ti ti-user-search"></i></div>
           <div class="t">아직 등록된 멘토가 없어요</div>
           <div class="d">멘토가 마이페이지의 <b>멘토 페이지</b>에서 소개글과 전문분야를 채우면 여기에 나타납니다.</div></div>`
      : `<div class="empty-state" style="grid-column:1/-1"><div class="ic"><i class="ti ti-search-off"></i></div><div class="t">조건에 맞는 멘토가 없어요</div><div class="d">필터를 바꿔 다시 시도해 보세요</div></div>`;
    $('#mentor-pager').innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(list.length / PER_PAGE);
  if (searchPage > totalPages) searchPage = totalPages;
  const start = (searchPage-1)*PER_PAGE;
  const pageItems = list.slice(start, start+PER_PAGE);

  /* 카드에는 **멘토가 실제로 적은 것만** 넣는다. 별점·후기·상담 인원·학번·상담 주제는
     예전 가짜 멘토에게만 있던 값이라 통째로 뺐다(2026-08-22, 사용자 결정).
     빈 값은 줄 자체를 그리지 않는다 — '—' 를 늘어놓으면 카드가 미완성으로 보인다. */
  grid.innerHTML = pageItems.map(m=>`
    <div class="mentor-card" onclick="openProfile('${escapeHTML(m.id)}')">
      <div class="mc-topic">${escapeHTML(categoryName(m.jobMajor) || '분야 미정')}</div>
      <div class="mc-body">
        <div class="mc-info">
          <div class="mc-name">${maskName(m.name)}</div>
          ${m.role ? `<div class="mc-line"><i class="ti ti-briefcase"></i>${escapeHTML(m.role)}</div>` : ''}
          ${m.years ? `<div class="mc-line"><i class="ti ti-stairs-up"></i>경력 ${m.years}년차</div>` : ''}
          ${m.company ? `<div class="mc-line mc-company"><i class="ti ti-building-skyscraper"></i>${escapeHTML(m.company)}</div>` : ''}
        </div>
        ${avatarHtml(m, 'mc-avatar')}
      </div>
      ${m.intro ? `<div class="mc-intro">${escapeHTML(m.intro)}</div>` : ''}
      <div class="mc-tagbox">
        ${(m.specialties||[]).slice(0,4).map(s=>`<span class="mc-hashtag"># ${escapeHTML(s)}</span>`).join('')}
      </div>
    </div>`).join('');

  renderPager(totalPages);
}

function renderPager(totalPages){
  const pager = $('#mentor-pager');
  if (!pager) return;
  if (totalPages <= 1){ pager.innerHTML = ''; return; }
  let btns = '';
  btns += `<button class="pg-btn nav" ${searchPage===1?'disabled':''} onclick="gotoPage(${searchPage-1})"><i class="ti ti-chevron-left"></i></button>`;
  for (let p=1; p<=totalPages; p++){
    btns += `<button class="pg-btn ${p===searchPage?'on':''}" onclick="gotoPage(${p})">${p}</button>`;
  }
  btns += `<button class="pg-btn nav" ${searchPage===totalPages?'disabled':''} onclick="gotoPage(${searchPage+1})"><i class="ti ti-chevron-right"></i></button>`;
  pager.innerHTML = btns;
}
function gotoPage(p){
  searchPage = p;
  renderSearch();
  const el = $('#page-search'); if (el) el.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setFilter(cat){ searchFilter = cat; searchPage = 1; $$('#filter-chips .chip').forEach(c=>c.classList.toggle('on', c.dataset.cat===cat)); renderSearch(); }

function updateChipsArrows(){
  const box = document.getElementById('filter-chips');
  const rail = document.getElementById('chips-rail');
  if (!box || !rail) return;
  const l = rail.querySelector('.chips-arrow--l');
  const r = rail.querySelector('.chips-arrow--r');
  if (l) l.classList.toggle('is-hidden', box.scrollLeft <= 2);
  if (r) r.classList.toggle('is-hidden', box.scrollLeft + box.clientWidth >= box.scrollWidth - 2);
}
function scrollChips(dir){
  const box = document.getElementById('filter-chips');
  if (!box) return;
  box.scrollBy({ left: dir * Math.max(220, box.clientWidth * 0.7), behavior: 'smooth' });
}
/* drag(그랩)으로 한 줄 직무 목록 좌우 이동 */
function initChipsDrag(){
  const box = document.getElementById('filter-chips');
  if (!box || box.__dragInit) return;
  box.__dragInit = true;
  box.style.cursor = 'grab';
  box.style.userSelect = 'none';
  let down = false, moved = false, startX = 0, startScroll = 0;
  box.addEventListener('pointerdown', e => {
    down = true; moved = false; startX = e.clientX; startScroll = box.scrollLeft;
    box.style.cursor = 'grabbing';
    /* 주의: setPointerCapture 를 쓰면 이어지는 click 이 칩이 아니라 컨테이너로
       전달돼 onclick="setFilter(...)" 가 실행되지 않는다. 캡처하지 않는다. */
  });
  box.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    box.scrollLeft = startScroll - dx;
  });
  const end = () => { if (!down) return; down = false; box.style.cursor = 'grab'; box.__justDragged = moved; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  /* 포인터가 컨테이너 밖에서 떼어져도 드래그 상태가 풀리도록 window 에서도 처리 */
  window.addEventListener('pointerup', end);
  /* 드래그로 끝난 클릭은 필터 선택으로 이어지지 않도록 차단 */
  box.addEventListener('click', e => {
    if (box.__justDragged) { e.stopPropagation(); e.preventDefault(); box.__justDragged = false; }
  }, true);
}

/* ════════════ MENTOR PROFILE ════════════ */
let currentMentor = null;
let selectedFormat = 0;
let reqAvail = new Map();      // 이 멘토가 연 일정 'YYYY-MM-DD' → [시간]
let reqCal = null;             // 달력이 보고 있는 달
let reqDate = null;            // 고른 날짜
let reqTime = null;            // 고른 시간
/* 화면 표시용. **청구 금액의 단일 출처는 서버**(routes/mentoring.js FORMATS)다.
   id 가 서버와 맞아야 신청이 만들어진다 — 여기 값을 바꿔도 결제 금액은 안 바뀐다. */
const FORMATS = [
  { id:'video30',  ic:'ti-video',     name:'화상 30분', price:'20,000원', cost:20000 },
  { id:'onsite60', ic:'ti-users',     name:'대면 60분', price:'45,000원', cost:45000 },
  { id:'text',     ic:'ti-message-2', name:'텍스트',    price:'12,000원', cost:12000 },
];
/* 타임라인 점 색깔. 위에서 아래로 옅어진다(최근이 진하다).
   예전에는 시드 데이터에 색이 박혀 있었는데, 멘토 페이지는 색을 받지 않는다. */
const TL_DOTS = ['#534AB7', '#AFA9EC', '#CECBF6', '#E0DCF7'];

/* 이 멘토가 열어 둔 멘토링 형식만 추린다. 하나도 안 골랐으면 전부 보여준다 —
   형식을 안 고른 것이지 '아무것도 안 한다' 는 뜻은 아니다. */
function offeredFormats(m){
  const all = FORMATS.map((f, i) => ({ f, i }));
  const picked = all.filter(({ f }) => (m.modes || []).includes(f.id));
  return picked.length ? picked : all;
}

async function openProfile(id){
  /* 주소로 바로 들어오면 목록을 아직 안 받았을 수 있다. 그때 여기서 받는다 —
     예전에는 배열이 파일에 박혀 있어서 이럴 일이 없었다. */
  await loadMentors();
  currentMentor = MENTORS.find(m=>m.id===id);
  const m = currentMentor;
  /* 기본 선택은 **이 멘토가 여는 첫 형식**이다. 늘 0(화상 30분)으로 두면
     화상을 안 하는 멘토에게 화상 신청이 만들어진다. */
  selectedFormat = m ? offeredFormats(m)[0].i : 0;
  if (!m){
    $('#profile-body').innerHTML = `
      <div class="back-bar" onclick="navigate('search')"><i class="ti ti-arrow-left"></i>멘토 찾기로 돌아가기</div>
      <div class="empty-state"><div class="ic"><i class="ti ti-user-off"></i></div>
        <div class="t">멘토를 찾을 수 없어요</div>
        <div class="d">프로필이 내려갔거나 주소가 바뀐 것 같아요.</div></div>`;
    navigate('profile');
    return;
  }
  $('#profile-body').innerHTML = `
    <div class="back-bar" onclick="navigate('search')"><i class="ti ti-arrow-left"></i>멘토 찾기로 돌아가기</div>
    <div class="card profile-hero">
      <div class="ph-top">
        ${avatarHtml(m, 'ph-avatar')}
        <div class="ph-id">
          <div class="ph-name-row">
            <span class="ph-name">${maskName(m.name)}</span>
            ${m.jobMajor ? `<span class="mc-tag">${escapeHTML(categoryName(m.jobMajor))}</span>` : ''}
          </div>
          <!-- 회사·직무·경력은 멘토가 적은 것만 잇는다. 안 적은 칸을 '—' 로 채우면
               적지 않은 것인지 없는 것인지 후배가 알 수 없다. -->
          <div class="ph-job">${[m.company, m.role, m.years ? `경력 ${m.years}년차` : null]
            .filter(Boolean).map(escapeHTML).join(' · ')}</div>
          <div class="ph-specs">${(m.specialties||[]).map(s=>`<span class="mc-spec">${escapeHTML(s)}</span>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="profile-grid">
      <div class="card pp-card">
        <!-- 타임라인을 안 적은 멘토도 있다. 빈 제목만 남기면 고장으로 읽힌다.
             점 색깔(t.c)은 예전 시드에만 있던 값이라 이제 순서로 정한다 —
             멘토 페이지(#mypage/mentor)는 색을 받지 않는다. -->
        ${(m.timeline||[]).length ? `
        <div class="pp-title">경력 타임라인</div>
        <div class="timeline">
          ${m.timeline.map((t,i)=>`
            <div class="tl-item">
              <div class="tl-dot" style="background:${TL_DOTS[Math.min(i, TL_DOTS.length-1)]}"></div>
              <div class="tl-main">
                <span class="tl-title">${escapeHTML(t.t||'')}</span>
                <span class="tl-date">${escapeHTML(t.d||'')}</span>
              </div>
              ${tlDetails(t.s)}
            </div>`).join('')}
        </div>` : ''}

        <!-- 소개글은 경력 아래에 둔다. 후배가 읽는 순서가 그렇다 —
             어떤 경력인지 먼저 보고, 그 사람이 하는 말을 읽는다.
             멘토 페이지(#mypage/mentor)의 입력 순서와도 같다.
             안 적은 멘토도 있으므로 있을 때만 그린다. -->
        ${m.intro ? `
        <div class="pp-intro">
          <div class="pp-title">멘토 소개</div>
          <p class="pp-intro-text">${escapeHTML(m.intro)}</p>
        </div>` : ''}
      </div>
      <div class="card pp-card">
        <div class="pp-title">멘토링 신청</div>
        <div class="field">
          <div class="field-lab">희망 분야</div>
          <div class="field-select"><span>${escapeHTML(m.role || categoryName(m.jobMajor) || '커리어')} 취업 준비</span><i class="ti ti-chevron-down"></i></div>
        </div>
        <!-- ① 날짜 → ② 시간 → ③ 형식 → ④ 하고 싶은 말 순서다.
             멘토가 연 날짜만 고를 수 있고, 날짜를 골라야 그 날의 시간이 나온다. -->
        <div class="field">
          <div class="field-lab">날짜 선택</div>
          <div class="mp-cal req-cal" id="req-cal"></div>
        </div>
        <div class="field" id="req-time-field" hidden>
          <div class="field-lab" id="req-time-lab">시간 선택</div>
          <div class="mp-time-grid" id="req-times"></div>
        </div>
        <!-- 멘토가 고른 형식만 보여준다. 멘토 페이지에서 '화상 30분' 만 열었는데
             후배가 대면 60분을 신청하면, 결제까지 하고 나서 거절당한다. -->
        <div class="field">
          <div class="field-lab">멘토링 형식 선택</div>
          <div class="format-opts" id="format-opts">
            ${offeredFormats(m).map(({ f, i }, k)=>`
              <div class="format-opt ${k===0?'on':''}" data-i="${i}" onclick="selectFormat(${i})">
                <div class="fo-ic"><i class="ti ${f.ic}"></i></div>
                <div class="fo-name">${f.name}</div>
                <div class="fo-price">${f.price}</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="field">
          <div class="field-lab">하고 싶은 말</div>
          <textarea id="req-msg" placeholder="${escapeHTML(
            m.company ? `${m.company}에 어떻게 합격하셨는지, 준비 과정에서 가장 도움이 된 경험이 무엇인지 듣고 싶습니다.`
                      : '어떤 준비 과정을 거치셨는지, 지금 제가 무엇부터 하면 좋을지 듣고 싶습니다.')}"></textarea>
        </div>
        <div class="cost-row">
          <span class="lab">예상 비용</span>
          <span class="val" id="req-cost">${FORMATS[selectedFormat].price}</span>
        </div>
        <button class="btn-brand btn-submit-req" onclick="submitRequest()"><i class="ti ti-send"></i>멘토 신청 보내기</button>
      </div>
    </div>`;
  /* innerHTML 을 넣은 뒤에 달력을 채운다 — 먼저 부르면 그릴 자리가 아직 없다. */
  initRequestPicker(m);
  navigate('profile');
}
function selectFormat(i){
  selectedFormat = i;
  $$('#format-opts .format-opt').forEach(o=>o.classList.toggle('on', +o.dataset.i===i));
  $('#req-cost').textContent = FORMATS[i].price;
}

/* ── 신청 달력 ────────────────────────────────────────────────
   멘토 페이지의 달력과 같은 클래스(.mp-cal*)를 쓴다. 다른 점은 **멘토가 연 날만
   고를 수 있다**는 것 — 나머지는 눌리지 않게 막는다. */
const REQ_WD = ['일','월','화','수','목','금','토'];
const reqYmd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function initRequestPicker(m){
  reqAvail = availabilityFor(m);
  reqDate = null; reqTime = null;
  /* 열린 날이 있는 첫 달을 보여준다. 이번 달에 아무것도 없으면 빈 달력만 보고
     '신청을 못 하는구나' 하고 나가 버린다. */
  const first = [...reqAvail.keys()].sort()[0];
  const base = first ? new Date(first) : new Date();
  reqCal = new Date(base.getFullYear(), base.getMonth(), 1);
  paintReqCal();
  paintReqTimes();
}

function paintReqCal(){
  const host = $('#req-cal');
  if (!host) return;

  const y = reqCal.getFullYear(), mo = reqCal.getMonth();
  const daysInMonth = new Date(y, mo+1, 0).getDate();
  const openDates = [...reqAvail.keys()].sort();
  /* 열린 날이 있는 달 사이에서만 이동한다 — 빈 달을 계속 넘기게 두지 않는다. */
  const minM = openDates.length ? new Date(openDates[0]) : new Date();
  const maxM = openDates.length ? new Date(openDates[openDates.length-1]) : new Date();
  const minMonth = new Date(minM.getFullYear(), minM.getMonth(), 1);
  const maxMonth = new Date(maxM.getFullYear(), maxM.getMonth(), 1);

  const cells = [];
  for (let i=0; i<new Date(y,mo,1).getDay(); i++) cells.push('<span class="mp-cal-pad"></span>');
  for (let d=1; d<=daysInMonth; d++){
    const date = reqYmd(new Date(y,mo,d));
    const open = reqAvail.has(date);
    const cls = ['mp-cal-day'];
    if (!open) cls.push('past');                 // 멘토가 안 연 날은 고를 수 없다
    if (open) cls.push('has');
    if (date === reqDate) cls.push('on');
    cells.push(`<button type="button" class="${cls.join(' ')}" data-reqdate="${date}"
      ${open?'':'disabled'}>${d}${open?'<i class="mp-cal-dot"></i>':''}</button>`);
  }

  host.innerHTML = `
    <div class="mp-cal-head">
      <button type="button" class="mp-cal-nav" data-reqnav="-1"
        ${reqCal<=minMonth?'disabled':''} aria-label="이전 달"><i class="ti ti-chevron-left"></i></button>
      <span class="mp-cal-title">${y}년 <b>${mo+1}월</b></span>
      <button type="button" class="mp-cal-nav" data-reqnav="1"
        ${reqCal>=maxMonth?'disabled':''} aria-label="다음 달"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="mp-cal-grid">
      ${REQ_WD.map((w,i)=>`<span class="mp-cal-wd${i===0?' sun':i===6?' sat':''}">${w}</span>`).join('')}
      ${cells.join('')}
    </div>
    ${openDates.length ? '' : '<div class="sf-hint-inline">멘토가 아직 일정을 열지 않았어요.</div>'}`;
}

function paintReqTimes(){
  const field = $('#req-time-field');
  const host = $('#req-times');
  const lab = $('#req-time-lab');
  if (!field || !host) return;

  /* 날짜를 안 골랐으면 칸 자체를 감춘다 — 빈 자리가 있으면 뭘 해야 할지 모른다. */
  if (!reqDate){ field.hidden = true; host.innerHTML = ''; return; }

  const d = new Date(reqDate);
  lab.textContent = `${d.getMonth()+1}월 ${d.getDate()}일 (${REQ_WD[d.getDay()]}) 시간 선택`;
  field.hidden = false;
  /* 시간은 24시간 표기 그대로 보여준다. 12시간으로 바꾸면 '10:00 · 11:00 · 8:00'
     처럼 작은 수가 뒤에 와서 오전인지 오후인지 매번 되짚어야 한다. */
  host.innerHTML = (reqAvail.get(reqDate)||[]).map(t=>`
    <button type="button" class="mp-time${reqTime===t?' on':''}" data-reqtime="${t}">${t}</button>
  `).join('');
}

/* 달력·시간은 다시 그려지므로 문서에 한 번만 위임한다. */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-reqnav]');
  if (nav && !nav.disabled){
    reqCal = new Date(reqCal.getFullYear(), reqCal.getMonth() + Number(nav.dataset.reqnav), 1);
    paintReqCal();
    return;
  }
  const day = e.target.closest('[data-reqdate]');
  if (day && !day.disabled){
    /* 날짜를 바꾸면 고른 시간은 뜻이 없어진다 — 다른 날의 시간이 남으면
       화면과 저장값이 어긋난다. */
    if (reqDate !== day.dataset.reqdate) reqTime = null;
    reqDate = day.dataset.reqdate;
    paintReqCal(); paintReqTimes();
    return;
  }
  const time = e.target.closest('[data-reqtime]');
  if (time){
    reqTime = time.dataset.reqtime;
    paintReqTimes();
  }
});
function submitRequest(){
  // 멘토 신청은 내 계정으로 남는 개인 행동이라 로그인이 필요하다.
  // 비로그인 상태에서 눌러도 그냥 신청돼 버리던 문제 → 로그인 페이지로 보낸다.
  if (!(window.DB && DB.currentUser())){
    toast('로그인 후 멘토링을 신청할 수 있어요', { icon: false });
    setTimeout(()=>navigate('login'), 700);
    return;
  }
  /* 날짜·시간을 안 고르고 보내면 서버가 400 으로 막는다. 그 전에 여기서 알려주고
     해당 칸으로 스크롤해 준다 — 카드가 길어서 어디가 비었는지 안 보인다. */
  if (!reqDate){
    toast('멘토링 날짜를 선택해주세요', { icon: false });
    $('#req-cal')?.scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }
  if (!reqTime){
    toast('멘토링 시간을 선택해주세요', { icon: false });
    $('#req-time-field')?.scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }
  payAndApply();
}

/* ── 신청 → 결제 ──────────────────────────────────────────────
   신청은 서버에 만들고(금액도 서버가 정한다), 결제창은 토스페이먼츠 SDK 가 띄운다.
   결제창이 성공해도 **그때는 아직 결제가 끝난 게 아니다** — 서버가 승인 API 를
   호출해야 돈이 움직인다. 그래서 성공 콜백에서 곧바로 서버 승인을 부른다.

   결제가 꺼져 있으면(키 미설정) 결제 없이 신청만 남긴다. 개발 중에 결제 키가 없다고
   멘토링 흐름 전체를 못 써 보면 곤란하다. */
async function payAndApply(){
  const m = currentMentor;
  const f = FORMATS[selectedFormat] || FORMATS[0];
  const msg = ($('#req-msg')?.value || '').trim();
  const btn = $('.btn-submit-req');
  if (btn) btn.disabled = true;

  try {
    const { request } = await api('POST', '/api/mentoring/requests', {
      /* mentorName 은 안 보낸다 — 서버가 목록에서 찾아 채운다(routes/mentoring.js). */
      mentorId: m.id, format: f.id, message: msg,
      slotDate: reqDate, slotTime: reqTime,
    });

    const cfg = await api('GET', '/api/payments/config');
    if (!cfg.enabled) {
      toast(`${maskName(m.name)} 멘토에게 신청을 보냈어요 (결제 미설정)`);
      return goApplied();
    }
    if (!window.TossPayments) {
      toast('결제 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.', { icon: false });
      return;
    }

    const order = await api('POST', '/api/payments/prepare', { requestId: request.id });

    /* successUrl/failUrl 대신 Promise 방식을 쓴다. 리다이렉트로 돌아오면 SPA 가
       상태를 잃어서 어느 신청의 결제였는지 다시 찾아야 한다. */
    const toss = TossPayments(cfg.clientKey);
    await toss.requestPayment('카드', {
      amount: order.amount,               // 서버가 정한 금액
      orderId: order.orderId,
      orderName: order.orderName,
      customerName: order.customerName,
      successUrl: location.origin + '/#mentoring',
      failUrl: location.origin + '/#mentoring',
    });
    /* 여기까지 왔다는 건 결제창이 닫혔다는 뜻이다. 승인은 successUrl 로 돌아온 뒤
       app.js 의 결제 복귀 처리(handlePaymentReturn)가 이어서 한다. */
  } catch (e) {
    /* 사용자가 결제창을 닫은 것은 오류가 아니다 — 에러 메시지를 띄우면 놀란다. */
    if (e?.code === 'USER_CANCEL') toast('결제를 취소했어요', { icon: false });
    else toast(e.message || '신청에 실패했어요', { icon: false });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function goApplied(){
  mentoringTab = 'applied';           // 신청 직후엔 그 목록을 보여준다
  setTimeout(()=>navigate('mentoring'), 600);
}

/* mentoring.js 는 DB 를 거치지 않고 직접 부른다 — 이 화면만 쓰는 엔드포인트라
   데이터 레이어에 올리면 db.js 가 화면별 함수로 불어난다. */
async function api(method, path, body){
  const res = await fetch(path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data;
}

/* ════════════ MY MENTORING ════════════ */
let mentoringTab = 'completed';
function totalCount(){ return STATE.ongoing.length + STATE.completed.length; }
function avgRating(){
  const rated = STATE.completed.filter(c=>c.rating);
  if (!rated.length) return '—';
  return (rated.reduce((a,c)=>a+c.rating,0)/rated.length).toFixed(1);
}
function totalCas(){ return STATE.completed.reduce((a,c)=>a+(c.casPlus||0),0); }

function renderMentoring(){
  // stats
  $('#stat-total').innerHTML = `${totalCount()}<small>회</small>`;
  const so = $('#stat-ongoing'); if (so) so.innerHTML = `${STATE.ongoing.length}<small>회</small>`;
  $('#stat-rating').innerHTML = `${avgRating()}<small> / 5.0</small>`;
  // tab counts
  $('#tabcnt-ongoing').textContent = STATE.ongoing.length;
  $('#tabcnt-completed').textContent = STATE.completed.length;
  $('#tabcnt-received').textContent = STATE.received.length;
  $('#tabcnt-applied').textContent = STATE.applied.length;

  /* 역할에 따라 탭이 다르다.
       멘티 — 진행 중 · 완료 · 보낸 요청   (남에게 신청하는 쪽)
       멘토 — 진행 중 · 완료 · 받은 요청   (신청을 받는 쪽)
     양쪽 다 보여주면 자기와 상관없는 빈 탭이 하나씩 남는다.
     역할을 모르면(비로그인·온보딩 전) 멘티 기준으로 둔다 — 대부분이 멘티다. */
  const role = (window.DB && DB.currentUser()?.role) || 'mentee';
  const allowed = role === 'mentor'
    ? ['ongoing', 'completed', 'received']
    : ['ongoing', 'completed', 'applied'];

  $$('#mentoring-tabs .tab').forEach(t => {
    t.hidden = !allowed.includes(t.dataset.tab);
    t.classList.toggle('on', t.dataset.tab === mentoringTab);
  });
  /* 숨긴 탭을 보고 있었으면(역할이 바뀌었거나 링크로 들어온 경우) 첫 탭으로 돌린다.
     안 그러면 탭은 하나도 안 눌린 채 남의 목록이 보인다. */
  if (!allowed.includes(mentoringTab)) {
    mentoringTab = allowed[0];
    $$('#mentoring-tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === mentoringTab));
  }

  const body = $('#mentoring-body');
  if (mentoringTab==='ongoing')   body.innerHTML = renderOngoing();
  if (mentoringTab==='completed') body.innerHTML = renderCompleted();
  if (mentoringTab==='applied')   body.innerHTML = renderApplied();
  if (mentoringTab==='received')  body.innerHTML = renderReceived();
}
function switchTab(tab){ mentoringTab = tab; renderMentoring(); }

function renderOngoing(){
  if (!STATE.ongoing.length) return emptyState('ti-calendar','진행 중인 멘토링이 없어요','멘토를 찾아 새로운 멘토링을 신청해 보세요');
  return `<div class="session-list">${STATE.ongoing.map(o=>`
    <div class="session-item">
      <div class="avatar si-avatar" style="${avatarStyle(o.pal)}">${initial(o.mentor)}</div>
      <div class="si-body">
        <div class="si-name-row"><span class="si-name">${maskName(o.mentor)} 멘토</span><span class="si-sub">· ${o.sub}</span></div>
        <div class="si-topic">${o.topic}</div>
      </div>
      <div class="si-right">
        <div class="badge ${o.badge}">${o.status}</div>
        <div class="si-when">${o.when}</div>
      </div>
    </div>`).join('')}</div>`;
}

function renderCompleted(){
  if (!STATE.completed.length) return emptyState('ti-check','완료된 멘토링이 없어요','');
  return `<div>${STATE.completed.map(c=>{
    const hasRating = !!c.rating;
    const hasMemo = !!(c.memo && c.memo.trim());
    return `
    <div class="done-card" data-id="${c.id}">
      <div class="done-main">
        <div class="avatar si-avatar" style="${avatarStyle(c.pal)}">${initial(c.mentor)}</div>
        <div class="dm-body">
          <div class="dm-head">
            <div class="si-name-row"><span class="si-name">${maskName(c.mentor)} 멘토</span><span class="si-sub">· ${c.sub}</span></div>
            <span class="si-when">${c.date} 완료</span>
          </div>
          <div class="dm-topic">${c.topic}</div>
          <div class="dm-actions">
            ${hasMemo
              ? `<button class="dm-link" onclick="toggleMemo('${c.id}')"><i class="ti ti-notes"></i>멘토 내역 · 메모 보기<i class="ti ti-chevron-down" id="chev-${c.id}"></i></button>`
              : `<button class="dm-link neutral" onclick="openMemo('${c.id}')"><i class="ti ti-pencil-plus"></i>메모 작성하기</button>`}
            ${hasRating
              ? `<span class="dm-rating-shown">${starsHTML(c.rating)} <b style="color:var(--gold);font-weight:700">${c.rating.toFixed(1)}</b></span>`
              : `<button class="dm-link gold" onclick="openRating('${c.id}')"><i class="ti ti-star"></i>평점 남기기</button>`}
          </div>
        </div>
      </div>
      <div class="memo-panel" id="memo-${c.id}">
        <div class="memo-inner">
          <div class="memo-box">
            <div class="memo-box-head">
              <span class="memo-box-title"><i class="ti ti-notes"></i>내가 작성한 메모</span>
              <span class="memo-edit-link" onclick="openMemo('${c.id}')">수정</span>
            </div>
            <div class="memo-text">${hasMemo?escapeHTML(c.memo):''}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* 내가 보낸 신청 — 멘토 응답 대기 상태. 받은 요청과 같은 카드 모양을 쓰되
   내가 할 수 있는 행동은 '신청 취소' 하나뿐이라 버튼도 하나만 둔다. */
function renderApplied(){
  if (!STATE.applied.length) {
    return emptyState('ti-send','보낸 멘토링 신청이 없어요','멘토를 찾아 신청하면 여기에서 진행 상태를 볼 수 있어요');
  }
  return STATE.applied.map((a,i)=>`
    <div class="req-card">
      <div class="done-main" style="padding:0">
        <div class="avatar si-avatar" style="${avatarStyle(a.pal)}">${initial(a.mentor)}</div>
        <div class="dm-body">
          <div class="si-name-row">
            <span class="si-name">${maskName(a.mentor)} 멘토</span><span class="si-sub">· ${a.sub}</span>
          </div>
          <div class="dm-topic">${escapeHTML(a.topic)}</div>
          <div class="si-topic" style="margin-top:6px;color:var(--color-text-tertiary)">
            ${escapeHTML(a.want)} · ${escapeHTML(a.cost)} · ${escapeHTML(a.when)}
          </div>
          ${a.msg ? `<div class="dm-topic" style="margin-top:6px">“${escapeHTML(a.msg)}”</div>` : ''}
          <div class="req-actions">
            <div class="badge amber">멘토 응답 대기</div>
            <button class="btn-reject" onclick="cancelApplied(${i})">신청 취소</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}
/* 서버에도 알려야 한다. 화면에서만 지우면 새로고침할 때 syncApplied 가 다시
   받아 와 되살아나고, 멘토 쪽에는 여전히 요청이 남는다. */
async function cancelApplied(i){
  const a = STATE.applied[i];
  if (!a) return;

  if (a.id) {
    try {
      await api('POST', `/api/mentoring/requests/${a.id}/cancel`);
    } catch (e) {
      /* 결제까지 끝난 건은 서버가 막는다(409). 그 사유를 그대로 보여준다 —
         화면에서만 지워 놓고 취소된 척하면 안 된다. */
      toast(e.message || '신청을 취소하지 못했어요', { icon: false });
      return;
    }
  }

  STATE.applied.splice(i,1);
  saveState(); renderMentoring();
  toast(`${maskName(a.mentor)} 멘토 신청을 취소했어요`, { icon: false });
}

function renderReceived(){
  if (!STATE.received.length) return emptyState('ti-inbox','받은 멘토링 요청이 없어요','');
  return STATE.received.map((r,i)=>`
    <div class="req-card">
      <div class="done-main" style="padding:0">
        <div class="avatar si-avatar" style="${avatarStyle(r.pal)}">${initial(r.mentee)}</div>
        <div class="dm-body">
          <div class="si-name-row"><span class="si-name">${maskName(r.mentee)} 멘티</span><span class="si-sub">· ${r.sub}</span></div>
          <div class="dm-topic">${r.topic}</div>
          <div class="si-topic" style="margin-top:6px;color:var(--color-text-tertiary)">희망 형식 ${r.want} · ${r.when}</div>
          <div class="req-actions">
            <button class="btn-brand btn-sm" onclick="acceptReq(${i})">수락하기</button>
            <button class="btn-reject" onclick="rejectReq(${i})">정중히 거절</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}
/* 수락은 '받은 요청' 에서 빼고 **'진행 중' 으로 옮긴다**.
   예전에는 splice 만 해서, 수락을 누르면 요청이 어느 목록에도 남지 않고
   통째로 사라졌다. 토스트만 뜨고 흔적이 없어서 거절과 구분이 안 됐다. */
function acceptReq(i){
  const r = STATE.received[i];
  if (!r) return;
  STATE.received.splice(i,1);
  STATE.ongoing.unshift({
    mentor: r.mentee, sub: r.sub, pal: r.pal, topic: r.topic,
    status: '일정 조율 중', badge: 'amber', when: r.when,
  });
  saveState(); renderMentoring();
  toast(`${maskName(r.mentee)} 멘티의 요청을 수락했어요`);
}
function rejectReq(i){
  const r = STATE.received[i];
  if (!r) return;
  STATE.received.splice(i,1);
  saveState(); renderMentoring();
  toast('요청을 거절했어요');
}

function emptyState(ic,t,d){ return `<div class="empty-state"><div class="ic"><i class="ti ${ic}"></i></div><div class="t">${t}</div>${d?`<div class="d">${d}</div>`:''}</div>`; }
function escapeHTML(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* memo expand/collapse */
function toggleMemo(id){
  const panel = $('#memo-'+id); const chev = $('#chev-'+id);
  const open = panel.classList.toggle('open');
  if (chev) chev.style.transform = open?'rotate(180deg)':'';
}

/* ════════════ MEMO MODAL ════════════ */
let memoTargetId = null;
function openMemo(id){
  memoTargetId = id;
  const c = STATE.completed.find(x=>x.id===id);
  $('#memo-modal-sub').textContent = `${c.mentor} 멘토 · ${c.topic.split(' · ')[0]}`;
  $('#memo-textarea').value = c.memo || '';
  $('#memo-modal-title').textContent = (c.memo&&c.memo.trim()) ? '메모 수정' : '멘토링 메모 작성';
  openModal('memo-modal');
  setTimeout(()=>$('#memo-textarea').focus(), 200);
}
function saveMemo(){
  const c = STATE.completed.find(x=>x.id===memoTargetId);
  c.memo = $('#memo-textarea').value;
  saveState(); closeModal('memo-modal'); renderMentoring();
  setTimeout(()=>{ const p=$('#memo-'+c.id); if(p && c.memo.trim()) p.classList.add('open'); }, 50);
  toast('메모를 저장했어요');
}

/* ════════════ RATING MODAL ════════════ */
let rateTargetId = null;
let rateValue = 0;
const RATE_CAPTIONS = ['','별로예요','아쉬워요','괜찮아요','좋았어요','최고예요!'];
function openRating(id){
  rateTargetId = id; rateValue = 0;
  const c = STATE.completed.find(x=>x.id===id);
  $('#rate-avatar').style.cssText = avatarStyle(c.pal);
  $('#rate-avatar').textContent = initial(c.mentor);
  $('#rate-name').textContent = `${maskName(c.mentor)} 멘토`;
  $('#rate-sub').textContent = `${c.sub} · ${c.topic.split(' · ')[0]}`;
  $('#rate-review').value = c.review || '';
  setStarUI(0); $('#star-caption').textContent = '별점을 선택해 주세요';
  openModal('rate-modal');
}
function setStarUI(n){
  $$('#star-input i').forEach((s,i)=>s.classList.toggle('fill', i<n));
}
function hoverStar(n){ setStarUI(n); $('#star-caption').textContent = RATE_CAPTIONS[n]; }
function leaveStar(){ setStarUI(rateValue); $('#star-caption').textContent = rateValue?RATE_CAPTIONS[rateValue]:'별점을 선택해 주세요'; }
function pickStar(n){ rateValue = n; setStarUI(n); $('#star-caption').textContent = RATE_CAPTIONS[n]; }
function saveRating(){
  if (!rateValue){ toast('별점을 선택해 주세요', { icon: false }); return; }
  const c = STATE.completed.find(x=>x.id===rateTargetId);
  c.rating = rateValue; c.review = $('#rate-review').value;
  saveState(); closeModal('rate-modal'); renderMentoring();
  toast(`${c.mentor} 멘토에게 평점을 남겼어요`);
}

/* ── modal helpers ──────────────────────────────────────── */
function openModal(id){ $('#'+id).classList.add('on'); }
function closeModal(id){ $('#'+id).classList.remove('on'); }

/* 알림(종 아이콘)은 전역 navbar 의 기능이므로 home.js 한 곳에서만 정의한다.
   여기에 다시 선언하면 같은 전역 스코프에서 const 가 중복돼 스크립트가 죽는다. */

/* ── init (app.js 부팅 시 1회 호출) ─────────────────────── */
function initMentoring(){
  // star input listeners
  $$('#star-input i').forEach((s,i)=>{
    s.addEventListener('mouseenter', ()=>hoverStar(i+1));
    s.addEventListener('click', ()=>pickStar(i+1));
  });
  $('#star-input').addEventListener('mouseleave', leaveStar);
  // close modal on overlay click
  $$('.modal-overlay').forEach(ov=>ov.addEventListener('click', e=>{ if(e.target===ov) ov.classList.remove('on'); }));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') $$('.modal-overlay').forEach(m=>m.classList.remove('on')); });
  renderGap('cert');
  /* 멘토 목록·분류는 '멘토 찾기' 에 들어갈 때 받는다(enterSearch). 부팅 때 받으면
     그 화면에 안 가는 사람에게도 요청이 나간다. */
}

window.Mentoring = { init: initMentoring, onEnter: onEnterMentoringPage };
