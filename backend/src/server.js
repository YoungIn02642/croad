require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const repo = require('./repo');
const { query, assertConnection } = require('./mysql');
const { DEMO_SEED, generateRandom } = require('./demo-seed');
const { CORP_TYPE_ID } = require('./company-classify');
/* 카탈로그 조회는 DB 에서 한다. 파일 기반 모듈(cert-catalog·major-catalog·
   company-classify·wage-jobs)은 수집·이관 전용으로 남는다 — catalog-db.js 머리주석 참고. */
const catalog = require('./catalog-db');
const certReco = require('./cert-reco');
/* 공공기관 채용공고 캐시. 회사 리포트(routes/companyAnalysis.js)도 같은 모듈을 쓴다. */
const ALIO = require('./alio-jobs');
const sectors = require('./company-sectors');
const POSTING = require('./posting-fetch');
const OAuth = require('./oauth');
const NiceAuth = require('./nice-auth');
const recommendationsRouter = require("./routes/recommendations");
const casAnalyzeRouter = require("./routes/casAnalyze");
const casFitRouter = require("./routes/casFit");
const jdCoachRouter = require("./routes/jdCoach");
const companyAnalysisRouter = require("./routes/companyAnalysis");
const { router: mentoringRouter } = require("./routes/mentoring");
const { router: paymentsRouter } = require("./routes/payments");
const { router: insightRouter } = require("./routes/insight");
const specupRouter = require("./routes/specup");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'careerly_session';
const ONE_DAY = 24 * 60 * 60 * 1000;
/* 멘토⇄멘티 전환 신청 — 가입 후 최소 대기 기간과, 신청 뒤 실제로 바뀌기까지의 유예.
   너무 자주 오가면 멘토 검색·통계가 흔들려서 가입 직후 신청, 신청 직후 취소·재신청을
   못 하게 막는다. */
const ROLE_CHANGE_MIN_ACCOUNT_AGE_MS = 10 * ONE_DAY;
const ROLE_CHANGE_EFFECTIVE_DELAY_MS = 7 * ONE_DAY;

/* origin:true 는 모든 출처에 쿠키 실은 요청을 허용해 CSRF 에 노출된다.
   운영에서는 ALLOWED_ORIGINS 로 배포 도메인만 허용한다.
   프론트를 같은 서버가 서빙하므로(same-origin) 평소엔 CORS 자체가 필요 없다. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.set('trust proxy', 1);   // Render/Railway 등 프록시 뒤에서 secure 쿠키가 동작하려면 필요
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false)
    : true,
  credentials: true,
}));
/* 기본 한도는 100KB 다. 프로필 사진을 base64 로 받으므로(파일 서버가 없다 —
   profiles.avatar 주석 참고) 그 한도로는 **정상적인 사진도 못 올라간다.**
   그런데 본문 파서가 먼저 걸러 버려서, 화면에는 '서버에서 문제가 생겼습니다'(500)만
   뜨고 용량 때문이라는 것을 알 수 없다.
   2MB 로 올려 두고, 실제 사진 한도(1MB)는 /api/profile 이 판단해 413 으로 돌려준다. */
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

// 프론트엔드는 careerly.html 단일 문서 SPA (해시 라우팅). / 로 들어오면 그걸 준다.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(FRONTEND_DIR, 'careerly.html'));
});

/* ── 정적 파일: 'no-cache' 는 캐시를 끄는 게 아니라 '매번 물어보고 쓰라'는 뜻이다 ──
   기본값(지시 없음)이면 브라우저가 Last-Modified 로 유효기간을 **자기 마음대로 추정**해서
   js/css 를 몇 분씩 안 물어보고 쓴다. 실제로 화면을 고쳐도 Ctrl+F5 를 눌러야만 보이는
   일이 반복됐다. no-cache 를 붙이면 ETag 로 재검증해서, 안 바뀌었으면 304(본문 없음)로
   끝나고 바뀌었을 때만 새로 받는다 — 대역폭은 거의 그대로면서 갱신은 즉시 된다.
   (/api/jobs 가 같은 이유로 같은 헤더를 쓴다.) */
app.use(express.static(FRONTEND_DIR, {
  setHeaders: res => res.set('Cache-Control', 'no-cache'),
}));
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/cas", casAnalyzeRouter);
/* 직무 적합도 — 업무특성 기준 채점. AI 는 매칭만 하고 점수는 cas-fit.js 가 낸다. */
app.use("/api/cas", casFitRouter);
app.use("/api/jd", jdCoachRouter);

/* 기업분석(뉴스+DART)은 /api/company/analysis 하나다. 같은 접두사의 classify·suggest 는
   아래쪽에 app.get 으로 따로 있는데, 경로가 겹치지 않아 순서 문제가 생기지 않는다. */
app.use("/api/company", companyAnalysisRouter);
/* 스펙업 — 자격증 시험일정·공모전 모집. 로그인은 필요 없다. 부족 판정은 프론트가
   자기 스펙으로 하고, 여기는 공개 데이터만 되돌려 준다. */
app.use("/api/specup", specupRouter);
/* 멘토링·결제·인사이트는 라우터 안에서 req.user 를 보므로 세션을 먼저 붙여 준다
   (전역 requireAuth 는 아니다 — 가격표·게시판 읽기는 비로그인도 본다). */
app.use(["/api/mentoring", "/api/payments", "/api/insights"], async (req, res, next) => {
  try { req.user = await getCurrentUser(req); next(); }
  catch (e) { next(e); }
});
app.use("/api/mentoring", mentoringRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/insights", insightRouter);

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role || null,        // 'mentor' (졸업 선배) | 'mentee' (재학 후배)
    nickname: user.nickname ?? null,
    provider: user.provider || null,          // 'naver' | 'kakao' | null(일반 가입)
    /* 소셜 가입 직후엔 역할이 없다. 화면이 추가입력으로 보낼지 판단하는 값이라
       명시적으로 내려준다 — role 이 null 인 것을 화면마다 따로 해석하면 어긋난다. */
    needsOnboarding: !user.role,
    /* 본인확인 **여부만** 내려준다. ci·phone 은 개인식별정보라 절대 나가면 안 된다 —
       이 함수가 허용 목록인 이유가 그것이다. 필드를 늘릴 때 spread(...user) 로
       바꾸지 말 것. */
    verified: !!user.ci,
    /* 본인인증한 번호를 **가린 형태로만** 내보낸다(010-****-5678).
       마이페이지가 연락처 기본값으로 쓰고, 백오피스에서 계정을 구분하는 데도 쓴다.
       원본 phone·ci 는 절대 나가지 않는다 — 이 함수가 허용 목록인 이유다. */
    phoneMasked: NiceAuth.maskPhone(user.phone) || null,
    /* 화면이 백오피스 버튼을 보일지 판단하는 값. 이건 **표시용일 뿐**이고
       실제 차단은 서버의 requireAdmin 이 한다 — 화면에서 숨기는 것만으로는
       주소를 직접 쳐서 들어오는 것을 못 막는다. */
    isAdmin: !!user.isAdmin,
    /* 멘토⇄멘티 전환 신청 상태. pendingRole 이 있으면 화면이 "예정일" 을 보여주고,
       없으면 신청 가능일(가입 10일 후)을 보여준다 — 계산은 여기서 한 번만 한다.
       프론트가 createdAt 으로 다시 계산하게 하면 서버·화면의 판단이 어긋날 수 있다. */
    pendingRole: user.pendingRole || null,
    roleChangeEffectiveAt: user.roleChangeEffectiveAt || null,
    roleChangeAvailableAt: new Date(new Date(user.createdAt).getTime() + ROLE_CHANGE_MIN_ACCOUNT_AGE_MS),
  };
}

/* 세션 조회는 DB 왕복이라 비동기다. 예전에는 파일을 통째로 읽어 동기였다.
   호출부가 await 를 빠뜨리면 Promise 가 그대로 user 로 들어가 "로그인된 것처럼"
   보이므로(빈 객체는 truthy), 여기서만 쓰고 라우트는 requireAuth 를 통과시킨다.

   여기서 finalizeRoleChangeIfDue 를 같이 태운다 — 예정일이 지난 전환 신청은
   스케줄러 없이 '다음에 이 사람이 아무 요청이나 보내는 순간' 반영된다. */
async function getCurrentUser(req) {
  const user = await repo.sessions.userByToken(req.cookies[SESSION_COOKIE]);
  return user ? repo.users.finalizeRoleChangeIfDue(user) : null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

/* express 4 는 async 라우트 핸들러가 던진 예외를 자동으로 못 잡는다 — 라우트 안에서
   직접 try/catch 해서 next(e) 를 부르지 않으면, 실패한 Promise 가 그대로 버려져
   **아래의 에러 핸들러(app.use((err,...)))에도 닿지 못하고 unhandledRejection 이 된다.**
   그러면 Node 가 프로세스 전체를 죽인다 — 카탈로그 테이블 하나가 없어서
   서버 전체가 재시작 루프에 빠졌던 사고(2026-08-05, universities 테이블 누락)가 이 경로였다.
   매 라우트에 try/catch 를 반복해 적는 대신, 이 한 겹으로 감싸 next(e) 로 흘려보낸다. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{4,20}$/.test(username);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* 영문·숫자는 필수, 특수문자는 허용하되 강제하지 않는다.
   frontend/js/app.js 의 PASSWORD_REGEX 와 같은 규칙이어야 한다 — 한쪽만 고치면
   프론트 검증을 통과한 값이 여기서 400 으로 떨어져 원인을 찾기 어렵다. */
function isValidPassword(password) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]{8,20}$/.test(password);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'careerly-backend' });
});

/* ── 본인확인 ────────────────────────────────────────────────
   '한 사람 = 한 계정' 을 위한 것이다. 자세한 배경은 src/nice-auth.js 머리주석.

   흐름: 화면이 /request 로 팝업 URL 을 받아 열고 → 인증을 마치면 /result 로
   결과를 보내 **단명 토큰**을 받는다 → 가입/온보딩 요청에 그 토큰을 함께 보낸다.
   CI 를 화면에 내려보내지 않으려고 토큰을 한 겹 두었다. */
const verifyTickets = new Map();          // token → { ci, phone, name, expiresAt }
const TICKET_TTL_MS = 10 * 60 * 1000;

function issueTicket(result) {
  const token = nanoid();
  verifyTickets.set(token, { ...result, expiresAt: Date.now() + TICKET_TTL_MS });
  /* 만료된 것을 같이 걷어낸다. 안 하면 서버가 오래 뜰수록 계속 쌓인다. */
  if (verifyTickets.size > 500) {
    const now = Date.now();
    for (const [k, v] of verifyTickets) if (v.expiresAt < now) verifyTickets.delete(k);
  }
  return token;
}

/* 한 번 쓰면 버린다 — 같은 인증으로 계정을 두 개 만들 수 없게. */
function consumeTicket(token) {
  const t = verifyTickets.get(token);
  if (!t) return null;
  verifyTickets.delete(token);
  return t.expiresAt < Date.now() ? null : t;
}

app.get('/api/verify/status', (req, res) => {
  res.json({
    configured: NiceAuth.isConfigured(),
    devMode: NiceAuth.devModeAllowed(),
    /* 운영인데 키가 없으면 본인인증을 쓸 수 없다. 화면이 '인증' 버튼을 띄우고
       누를 때마다 503 을 보여주는 것보다, 아예 상태를 알려주는 편이 낫다. */
    available: NiceAuth.isConfigured() || NiceAuth.devModeAllowed(),
  });
});

app.post('/api/verify/request', (req, res) => {
  try {
    res.json(NiceAuth.buildRequest({ returnUrl: req.body?.returnUrl }));
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.post('/api/verify/result', (req, res) => {
  try {
    const result = NiceAuth.parseResult(req.body);
    res.json({
      token: issueTicket(result),
      name: result.name,
      /* 번호는 가려서 준다. 화면에는 '어떤 번호로 인증했는지'만 보이면 된다. */
      phoneMasked: NiceAuth.maskPhone(result.phone),
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.post('/api/auth/signup', ah(async (req, res) => {
  const { username, password, name, email, role, nickname } = req.body || {};

  if (!username || !password || !name || !email) {
    return res.status(400).json({ error: '필수 입력값이 누락되었습니다.' });
  }
  if (!['mentor', 'mentee'].includes(role)) {
    return res.status(400).json({ error: '회원 유형(멘토/멘티)을 선택해주세요.' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: '아이디는 영문, 숫자, 밑줄 포함 4~20자여야 합니다.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: '비밀번호는 8~20자이며 영문과 숫자를 모두 포함해야 합니다.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
  }
  /* 별명은 선택. 안 보내면 null 로 두고 화면이 이름을 가려서 쓴다.
     화면 곳곳에 이름 대신 들어가는 값이라 길이만 막아둔다. */
  const trimmedNickname = typeof nickname === 'string' ? nickname.trim() : '';
  if (trimmedNickname && (trimmedNickname.length < 2 || trimmedNickname.length > 20)) {
    return res.status(400).json({ error: '별명은 2~20자여야 합니다.' });
  }

  const normalizedUsername = username.trim();
  const normalizedEmail = email.trim().toLowerCase();

  /* 본인확인 — 같은 사람이 계정을 여러 개 만들지 못하게 한다.
     인증을 아직 쓸 수 없는 환경(운영인데 키 미설정)에서는 가입 자체를 막지 않는다.
     막아 버리면 키 하나 때문에 서비스가 멈춘다. */
  let verified = null;
  if (NiceAuth.isConfigured() || NiceAuth.devModeAllowed()) {
    verified = consumeTicket(req.body?.verifyToken);
    if (!verified) {
      return res.status(400).json({ error: '본인인증을 먼저 완료해 주세요.' });
    }
    if (await repo.users.ciTaken(verified.ci)) {
      return res.status(409).json({
        error: '이미 가입된 계정이 있어요. 기존 계정으로 로그인해 주세요.',
      });
    }
  }

  if (await repo.users.usernameTaken(normalizedUsername)) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  }
  if (await repo.users.emailTaken(normalizedEmail)) {
    return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await repo.users.create({
      id: nanoid(),
      username: normalizedUsername,
      passwordHash,
      name: name.trim(),
      email: normalizedEmail,
      role,
      nickname: trimmedNickname || null,
      ci: verified?.ci || null,
      phone: verified?.phone || null,
    });
    res.status(201).json({ message: '회원가입이 완료되었습니다.', user: publicUser(user) });
  } catch (e) {
    /* uk_ci 가 최종 방어선이다. 위 ciTaken 검사와 INSERT 사이에 같은 사람의 두 번째
       요청이 끼어들면 앱 검사만으로는 둘 다 통과한다(TOCTOU). DB 가 막아 준 것을
       500 으로 흘리지 않고 위와 같은 안내로 바꾼다. */
    if (e.code === 'ER_DUP_ENTRY' && /uk_ci/.test(e.message || '')) {
      return res.status(409).json({
        error: '이미 가입된 계정이 있어요. 기존 계정으로 로그인해 주세요.',
      });
    }
    throw e;
  }
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const user = await repo.users.byUsername(username.trim());
  if (!user) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  /* 소셜 계정은 passwordHash 가 없다. 그대로 bcrypt.compare 에 넘기면 예외가 나
     500 이 떨어진다. 어느 방식으로 가입했는지 알려주는 편이 사용자에게도 낫다. */
  if (!user.passwordHash) {
    const label = OAuth.PROVIDERS[user.provider]?.label || '소셜';
    return res.status(401).json({ error: `${label} 로그인으로 가입한 계정이에요. ${label} 버튼으로 로그인해 주세요.` });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  await startSession(res, user);
  res.json({ message: '로그인 성공', user: publicUser(user) });
}));

/* ── 소셜 로그인 ─────────────────────────────────────────────
   흐름과 보안 판단은 src/oauth.js 머리주석에 있다.

   콜백은 화면을 직접 그리지 않고 프론트로 리다이렉트한다. SPA 라서 서버가 HTML 을
   따로 만들면 화면이 두 벌이 된다. 결과는 해시로만 알린다.
     #onboarding  — 가입은 됐고 멘토/멘티·닉네임을 아직 안 받음
     #main        — 기존 계정으로 로그인 완료
     #login?error= — 실패 (사유를 화면이 보여준다) */
async function startSession(res, user) {
  const token = nanoid(48);
  /* 세션은 DB 에서 24시간 뒤 만료된다(로그인한 채로 하루가 지나면 자동 로그아웃) —
     이 값은 그대로 둔다. 쿠키 쪽 maxAge 는 **일부러 안 준다.** maxAge 가 있으면
     디스크에 저장되는 영구 쿠키가 되어, 24시간 안이면 컴퓨터를 껐다 켜도 로그인이
     유지된다. maxAge 를 빼면 브라우저 세션 쿠키가 되어 브라우저를 완전히 종료하면
     (컴퓨터 재부팅 포함) 즉시 로그아웃된다 — "탭 복원" 설정을 켜 둔 브라우저는
     예외일 수 있다. */
  await repo.sessions.create(token, user.id, Date.now() + ONE_DAY);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

// 화면이 어떤 소셜 버튼을 보여줄지 — 키가 없는 제공자는 버튼도 띄우지 않는다
app.get('/api/auth/providers', (req, res) => res.json({ providers: OAuth.enabledProviders() }));

/* 아이디 중복확인 — 가입 버튼을 누르기 전에 알려준다.
   아래 `/api/auth/:provider` 보다 **먼저** 선언한다. 그 라우트가 모르는 이름을
   next() 로 흘려보내긴 하지만, 순서에 기대지 않는 편이 안전하다.

   이 엔드포인트는 "이 아이디가 존재하는가"를 그대로 알려주므로 계정 목록을 긁을 수
   있다. 회원가입 화면에서 사람이 누르는 빈도(분당 몇 번)만 허용한다. */
const usernameCheckHits = new Map();   // ip → { count, resetAt }
const CHECK_WINDOW_MS = 60 * 1000;
const CHECK_MAX_PER_WINDOW = 20;

function checkRateLimited(ip) {
  const now = Date.now();
  const hit = usernameCheckHits.get(ip);
  if (!hit || now > hit.resetAt) {
    usernameCheckHits.set(ip, { count: 1, resetAt: now + CHECK_WINDOW_MS });
    /* 만료된 항목을 같이 걷어낸다. 안 하면 IP 마다 항목이 쌓여 메모리가 샌다. */
    if (usernameCheckHits.size > 1000) {
      for (const [k, v] of usernameCheckHits) if (now > v.resetAt) usernameCheckHits.delete(k);
    }
    return false;
  }
  hit.count += 1;
  return hit.count > CHECK_MAX_PER_WINDOW;
}

/* ── 채용공고 주소 → 본문 ────────────────────────────────────
   자소서 코치는 공고 원문이 있어야 역량을 뽑는데, 요즘 공고는 **복사를 막아 둔 곳이
   많다**(사용자 지적). 그 차단은 거의 전부 클라이언트 JS 라 서버가 열면 없는 것과
   같다 — 주소만 받으면 된다.

   ── 왜 라우터가 아니라 여기 있나 ──
   **로그인을 요구해야 하기 때문**이다. 사용자가 준 주소를 서버가 대신 여는 기능은
   열어 두면 우리 서버가 남의 요청을 대신 보내 주는 통로가 된다(익명 프록시·스캐너).
   requireAuth 는 이 파일에 있고 라우터로 넘기면 순환 참조가 된다.
   라우터 등록(app.use)에서 멀리 떨어져 있는 이유는 ah 가 const 라 그 아래에서만
   쓸 수 있기 때문이다 — 위에 두면 서버가 뜨다가 죽는다.
   내부망 차단은 posting-fetch.js 가 따로 한다(SSRF).

   횟수도 제한한다. 사람이 공고를 붙여넣는 빈도는 몇 분에 몇 번이다. */
const postingHits = new Map();            // userId → { count, resetAt }
const POSTING_WINDOW_MS = 5 * 60 * 1000;
const POSTING_MAX_PER_WINDOW = 15;

function postingRateLimited(key) {
  const now = Date.now();
  const hit = postingHits.get(key);
  if (!hit || now > hit.resetAt) {
    postingHits.set(key, { count: 1, resetAt: now + POSTING_WINDOW_MS });
    if (postingHits.size > 1000) {
      for (const [k, v] of postingHits) if (now > v.resetAt) postingHits.delete(k);
    }
    return false;
  }
  hit.count += 1;
  return hit.count > POSTING_MAX_PER_WINDOW;
}

app.post('/api/jd/posting', requireAuth, ah(async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) return res.status(400).json({ error: '공고 주소를 입력해 주세요.', kind: 'bad-url' });

  if (postingRateLimited(req.user.id)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', kind: 'error' });
  }

  const r = await POSTING.fetchPosting(url);
  /* 실패 사유를 그대로 올린다 — 로그인 벽·이미지 공고·본문 못 찾음은 사용자가 할 일이
     다르다(18-4 와 같은 원칙). 화면이 사유별로 다른 안내를 붙인다. */
  if (!r.ok) return res.status(422).json({ error: r.message, kind: r.kind, title: r.title || null });
  res.json({ ok: true, text: r.text, title: r.title, url: r.url, weak: r.weak });
}));

app.get('/api/auth/check-username', ah(async (req, res) => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: '아이디는 영문, 숫자, 밑줄 포함 4~20자여야 합니다.' });
  }
  if (checkRateLimited(req.ip)) {
    return res.status(429).json({ error: '확인 요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
  }

  const taken = await repo.users.usernameTaken(username);
  res.json({ available: !taken });
}));

/* :provider 는 /api/auth/me · /api/auth/providers 까지 삼킨다.
   **모르는 이름이면 반드시 next() 로 흘려보내야** 로그인 상태 조회가 살아남는다.
   (여기서 404 를 돌려주면 GET /api/auth/me 가 죽어 로그인이 통째로 깨진다.) */
app.get('/api/auth/:provider', (req, res, next) => {
  const name = req.params.provider;
  if (!OAuth.PROVIDERS[name]) return next();
  if (!OAuth.isEnabled(name)) {
    return res.redirect('/#login?error=' + encodeURIComponent(
      `${OAuth.PROVIDERS[name].label} 로그인이 아직 설정되지 않았어요.`));
  }
  const state = OAuth.issueState(res);
  res.redirect(OAuth.buildAuthUrl(name, req, state));
});

app.get('/api/auth/:provider/callback', async (req, res, next) => {
  const name = req.params.provider;
  if (!OAuth.PROVIDERS[name]) return next();
  const fail = msg => res.redirect('/#login?error=' + encodeURIComponent(msg));

  if (!OAuth.isEnabled(name)) return fail('지원하지 않는 로그인 방식입니다.');
  if (req.query.error) return fail('로그인이 취소되었습니다.');
  if (!OAuth.verifyState(req, res)) return fail('로그인 요청이 만료되었어요. 다시 시도해 주세요.');
  if (!req.query.code) return fail('인증 코드를 받지 못했습니다.');

  try {
    const token = await OAuth.exchangeCode(name, req, req.query.code, req.query.state);
    const profile = await OAuth.fetchProfile(name, token);

    let user = await repo.users.byProvider(name, profile.id);

    if (!user) {
      /* 같은 이메일의 일반 계정이 있으면 자동으로 잇지 않는다 — 이유는 oauth.js 주석.
         연결 기능을 만들기 전까지는 안내로 막는다. */
      const email = (profile.email || '').toLowerCase();
      if (await repo.users.emailTaken(email)) {
        return fail('이미 같은 이메일로 가입된 계정이 있어요. 아이디로 로그인해 주세요.');
      }

      user = await repo.users.create({
        id: nanoid(),
        /* 소셜 계정은 아이디·비밀번호가 없다. username 은 화면·조회에서 키로 쓰이므로
           겹치지 않게 만들어 둔다. passwordHash 가 없으므로 일반 로그인은 통과하지 못한다. */
        username: `${name}_${profile.id}`,
        passwordHash: null,
        provider: name,
        providerId: profile.id,
        name: profile.name || `${OAuth.PROVIDERS[name].label} 사용자`,
        email: email || null,
        role: null,              // 멘토/멘티는 다음 화면에서 받는다
        nickname: null,
      });
    }

    await startSession(res, user);

    // 역할이 없으면 추가입력 화면으로 — 역할 없이는 스펙 폼도 통계도 성립하지 않는다
    res.redirect(user.role ? '/#main' : '/#onboarding');
  } catch (e) {
    console.warn('소셜 로그인 실패:', e.message);
    fail(e.message || '로그인에 실패했습니다.');
  }
});

/* 소셜 가입 직후 받는 값. 이미 역할이 정해진 계정은 여기서 바꾸지 못하게 한다 —
   역할이 바뀌면 그동안 쌓인 스펙이 어느 통계에 속하는지 흔들린다. */
app.post('/api/auth/onboarding', requireAuth, ah(async (req, res) => {
  const { role, nickname } = req.body || {};
  if (!['mentor', 'mentee'].includes(role)) {
    return res.status(400).json({ error: '회원 유형(멘토/멘티)을 선택해주세요.' });
  }
  const nick = typeof nickname === 'string' ? nickname.trim() : '';
  if (nick && (nick.length < 2 || nick.length > 20)) {
    return res.status(400).json({ error: '별명은 2~20자여야 합니다.' });
  }

  /* 역할이 이미 있으면 바꾸지 못하게 한다 — 바뀌면 그동안 쌓인 스펙이 어느 통계에
     속하는지 흔들린다. */
  if (req.user.role) return res.status(409).json({ error: '이미 회원 유형이 정해진 계정입니다.' });

  const patch = { role };
  if (nick) patch.nickname = nick;

  /* 소셜 가입도 같은 관문을 지난다. 여기서 안 받으면 네이버·카카오로 계정을
     얼마든지 더 만들 수 있어서 일반가입에만 인증을 붙인 의미가 사라진다.
     이미 인증된 계정(재진입)이면 다시 받지 않는다. */
  if (!req.user.ci && (NiceAuth.isConfigured() || NiceAuth.devModeAllowed())) {
    const verified = consumeTicket(req.body?.verifyToken);
    if (!verified) return res.status(400).json({ error: '본인인증을 먼저 완료해 주세요.' });

    /* CI 가 다른 계정에 이미 있으면 **계정을 잇지 않고 안내로 막는다.**
       자동 병합은 하지 않는다 — 이메일 중복 정책(위 소셜 콜백)과 같은 결이다.
       여기서 조용히 이어 버리면 어느 계정으로 로그인했는지에 따라 다른 데이터가 보인다. */
    const owner = await repo.users.byCi(verified.ci);
    if (owner && owner.id !== req.user.id) {
      return res.status(409).json({
        error: '이미 가입된 계정이 있어요. 기존 계정으로 로그인해 주세요.',
      });
    }
    patch.ci = verified.ci;
    patch.phone = verified.phone;
    patch.verifiedAt = new Date();
  }
  const user = await repo.users.update(req.user.id, patch);
  res.json({ message: '가입이 완료되었습니다.', user: publicUser(user) });
}));

/* ── 회원 탈퇴 ────────────────────────────────────────────────
   본인이 자기 계정을 지운다(백오피스의 강제 삭제와는 다른 길이다).

   프로필·세션·스펙·자격증·활동은 외래키 CASCADE 로 함께 지워진다.
   **되돌릴 수 없다.** 그래서 두 겹으로 확인한다.
     ① 비밀번호 재확인 — 자리를 비운 사이 남이 누르는 것을 막는다
     ② 화면에서 '탈퇴하겠습니다' 를 직접 입력 (프론트)

   소셜 가입자는 비밀번호가 없다(passwordHash null). 그때는 아이디를 받아 대조한다 —
   비밀번호가 없다고 확인 없이 지우면 가장 위험한 동작이 가장 쉬워진다. */
app.post('/api/auth/withdraw', requireAuth, ah(async (req, res) => {
  const { password, username } = req.body || {};

  if (req.user.passwordHash) {
    if (!password) return res.status(400).json({ error: '비밀번호를 입력해 주세요.' });
    if (!await bcrypt.compare(password, req.user.passwordHash)) {
      return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
    }
  } else {
    if (String(username || '').trim() !== req.user.username) {
      return res.status(400).json({ error: '아이디가 일치하지 않습니다.' });
    }
  }

  /* 관리자가 스스로 지우면 백오피스에 들어갈 사람이 없어질 수 있다.
     ADMIN_USERNAMES 로 다시 만들 수는 있지만, 모르고 벌어지면 한참 헤맨다. */
  if (req.user.isAdmin) {
    return res.status(409).json({
      error: '관리자 계정은 탈퇴할 수 없어요. 다른 관리자에게 권한 해제를 요청해 주세요.',
    });
  }

  await repo.users.deleteByUsername(req.user.username);
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: '탈퇴가 완료되었습니다.' });
}));

/* 비밀번호 변경 — 로그인한 본인이 스스로 바꾼다.
   현재 비밀번호를 다시 받는 이유는 자리를 비운 사이(로그인된 채로 남은 화면)
   남이 비밀번호를 바꿔 계정을 통째로 가져가는 것을 막기 위해서다.
   세션은 유지한다 — 방금 본인 확인을 마친 사람이라 다시 로그인시킬 이유가 없고,
   sessions.create 가 한 계정당 세션을 하나만 두므로 남은 다른 기기도 없다. */
app.post('/api/auth/password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  /* 소셜 가입자는 passwordHash 가 없다. 여기서 비밀번호를 새로 만들어 주면
     소셜 로그인과 아이디 로그인이 뒤섞여 '어느 쪽으로 들어왔는지' 를 알 수 없게 된다. */
  if (!req.user.passwordHash) {
    return res.status(400).json({
      error: '소셜 계정은 비밀번호가 없어요. 가입할 때 쓴 소셜 서비스에서 관리해 주세요.',
    });
  }
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.' });
  }
  if (!await bcrypt.compare(currentPassword, req.user.passwordHash)) {
    return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: '비밀번호는 8~20자이며 영문과 숫자를 모두 포함해야 합니다.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: '지금 쓰는 비밀번호와 다른 것으로 정해 주세요.' });
  }

  await repo.users.updatePassword(req.user.id, await bcrypt.hash(newPassword, 10));
  res.json({ message: '비밀번호가 변경되었습니다.' });
}));

app.post('/api/auth/logout', ah(async (req, res) => {
  await repo.sessions.deleteByToken(req.cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: '로그아웃되었습니다.' });
}));

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/profile', requireAuth, ah(async (req, res) => {
  res.json({ profile: await repo.profiles.get(req.user.id) });
}));

app.put('/api/profile', requireAuth, ah(async (req, res) => {
  /* 예전에는 아무 키나 받아 파일에 그대로 넣었다. 테이블에는 컬럼이 있는 것만 넣는다
     — 없는 컬럼을 보내면 조용히 버려지는 대신 여기서 걸러진 것이 보인다. */
  /* **repo.profiles.update 의 map 과 함께 늘려야 한다.** 한쪽만 고치면 저장은
     성공했다고 나오는데 값이 조용히 사라진다. */
  const allowed = ['nickname', 'university', 'currentJob', 'tips',
                   'avatar', 'gender', 'birthdate', 'phone', 'address',
                   'intro', 'specialties', 'timeline', 'modes', 'availability'];
  const patch = {};
  allowed.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      patch[k] = typeof req.body[k] === 'string' ? req.body[k].trim() : req.body[k];
    }
  });

  /* 이름·이메일은 users 에 있고 여기로 안 받는다. 두 곳에 두면 어느 쪽이 맞는지
     알 수 없어진다 — 화면은 회원가입 때 받은 값을 그대로 보여 준다. */

  if (patch.avatar) {
    /* 브라우저가 256px 로 줄여 보내지만, 그 코드를 우회해 원본을 그대로 밀어 넣을 수
       있다. base64 는 원본의 약 4/3 이라 1MB 면 넉넉하고, 이걸 안 막으면
       MEDIUMTEXT 한도(16MB)까지 들어와 목록 조회가 통째로 느려진다. */
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(patch.avatar)) {
      return res.status(400).json({ error: '이미지 형식이 올바르지 않습니다.' });
    }
    if (patch.avatar.length > 1_000_000) {
      return res.status(413).json({ error: '사진 용량이 너무 큽니다. 더 작은 이미지를 올려주세요.' });
    }
  }
  if (patch.gender != null && patch.gender !== ''
      && !['male', 'female', 'other'].includes(patch.gender)) {
    return res.status(400).json({ error: '성별 값이 올바르지 않습니다.' });
  }
  if (patch.birthdate) {
    /* <input type="date"> 는 'YYYY-MM-DD' 를 준다. 형식이 어긋나면 MySQL 이
       0000-00-00 으로 넣거나 던지는데, 어느 쪽이든 원인이 안 보인다. */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.birthdate)) {
      return res.status(400).json({ error: '생년월일 형식이 올바르지 않습니다.' });
    }
    const d = new Date(patch.birthdate);
    if (Number.isNaN(d.getTime()) || d > new Date()) {
      return res.status(400).json({ error: '생년월일을 다시 확인해 주세요.' });
    }
  }
  /* 예약 가능 일정 — 멘티에게 "이 시간에 신청하세요"로 보여줄 값이라
     형식이 어긋나면 화면이 통째로 깨진다. 모양을 여기서 못 박는다. */
  if (patch.availability != null) {
    if (!Array.isArray(patch.availability)) {
      return res.status(400).json({ error: '예약 가능 일정 형식이 올바르지 않습니다.' });
    }
    if (patch.availability.length > 200) {
      return res.status(400).json({ error: '날짜는 200개까지 정할 수 있어요.' });
    }
    const clean = [];
    for (const slot of patch.availability) {
      const date = String(slot?.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
        return res.status(400).json({ error: `날짜 형식이 올바르지 않습니다: ${date}` });
      }
      const times = Array.isArray(slot?.times) ? slot.times.map(String) : [];
      const badTime = times.find(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
      if (badTime) {
        return res.status(400).json({ error: `시간 형식이 올바르지 않습니다: ${badTime}` });
      }
      /* 시간이 하나도 없는 날짜는 '열어두지 않은 날'이다. 남겨 두면 멘티 화면에
         누를 수 없는 빈 날짜가 뜬다. */
      if (!times.length) continue;
      clean.push({ date, times: [...new Set(times)].sort() });
    }
    /* 같은 날짜가 두 번 오면 뒤엣것이 이긴다 — 합치지 않으면 화면에 같은 날이
       두 줄로 보인다. */
    const byDate = new Map(clean.map(s => [s.date, s]));
    patch.availability = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /* 빈 문자열은 '지웠다'는 뜻이라 NULL 로 바꾼다. 안 그러면 ''(빈 값)이 저장돼
     화면이 '적혀 있는데 안 보이는' 상태가 된다. */
  ['gender', 'birthdate', 'phone', 'address', 'avatar'].forEach(k => {
    if (patch[k] === '') patch[k] = null;
  });

  const profile = await repo.profiles.update(req.user.id, patch);
  res.json({ message: '프로필이 저장되었습니다.', profile });
}));

/* ── 회원 스펙 (커리어 로드맵 집계의 원천) ─────────────────────
   userSpecs: [{ userId, dept, field, job, company, corpType, gpa, gpaMax, certs, scores, qual, detail, activities }]
   activities: [{ type, name, duration, role, stage, outcome }] — 설문(구글폼) 대표활동 구조.
               CAS 정성 점수(computeQual)의 입력이다. 옛 스펙의 boolean qual 도 함께 호환.
   corpType: 'large' | 'mid' | 'small' | 'public' — 커리어 로드맵의 기업유형 4분류.
             옛 스펙에는 없다(undefined). 그런 스펙은 유형별 집계에서 빠지고
             중분류 전체 집계에만 잡힌다.
   company : 회사명. corpType 자동판정의 입력이다. 판정은 어디까지나 추천이고
             최종 corpType 은 회원이 고른 값을 그대로 저장한다(자동판정을
             덮어쓰지 않는다) — 명단에 없는 회사가 훨씬 많기 때문.
   회원당 1건. userId 가 PK. */

// 집계용 전체 조회. 누가 입력했는지는 내보내지 않는다 —
// 학점·자격증은 개인정보이고, 화면은 분포만 필요로 한다.
/* 집계용 전체 목록. userId·detail 은 남의 것이므로 빼고 준다(예전과 같은 규칙). */
app.get('/api/specs', ah(async (req, res) => {
  const all = await repo.specs.listAll();
  res.json({ specs: all.map(({ userId, detail, ...rest }) => rest) });
}));

// 내 스펙 조회 / 저장
app.get('/api/specs/me', requireAuth, ah(async (req, res) => {
  res.json({ spec: await repo.specs.byUser(req.user.id) });
}));

app.put('/api/specs/me', requireAuth, ah(async (req, res) => {
  /* 허용 목록 방식이라 **새 필드를 여기 추가하지 않으면 조용히 버려진다.**
     화면에서는 저장한 것처럼 보이는데 다시 열면 비어 있어 원인을 찾기 어렵다.
     스펙 입력 폼에 칸을 늘렸다면 여기와 repo.specs.upsert 의 컬럼 표를 함께 늘릴 것.
       major             — 학생이 적은 학과명(자유). dept 는 그걸 묶는 통계 분류다
       careers           — 멘토의 경력 [{company,start,end,current,position,job,desc}]
       interestCompanies — 멘티의 관심 기업 (이름 배열)
       certMeta          — 직접 입력한 자격증의 발급기관·취득일 { 이름: {issuer,date} }
       jobMajor          — KECO 1차 코드(커리어 로드맵과 같은 분류). field/job 은 옛 값이라 둘 다 남는다
       jobMiddles        — KECO 2차 코드 배열(세부직무 다중선택) */
  const allowed = [
    'dept', 'major', 'field', 'job', 'jobMajor', 'jobMiddles',
    'company', 'corpType', 'gpa', 'gpaMax',
    'certs', 'certMeta', 'scores', 'qual', 'detail', 'activities',
    'careers', 'interestCompanies',
  ];
  const patch = {};
  allowed.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) patch[k] = req.body[k];
  });

  /* 직무 코드는 카탈로그에 있는 것만 받는다. 걸러낸 분류(관리직·청소직 등)나
     오타가 들어오면 로드맵 집계에서 영영 안 잡히는 스펙이 되는데, 에러가 안 나서
     화면상으로는 저장에 성공한 것으로 보인다. */
  if (patch.jobMajor != null || patch.jobMiddles != null) {
    const tree = await catalog.jobCatalog();
    const validMajors = new Set(tree.majors.map(M => M.code));
    const validMiddles = new Set(tree.majors.flatMap(M => M.middles.map(m => m.code)));

    if (patch.jobMajor != null && patch.jobMajor !== '' && !validMajors.has(String(patch.jobMajor))) {
      return res.status(400).json({ error: '진출분야 값이 올바르지 않습니다.' });
    }
    if (patch.jobMiddles != null) {
      if (!Array.isArray(patch.jobMiddles)) {
        return res.status(400).json({ error: '세부직무는 목록이어야 합니다.' });
      }
      const bad = patch.jobMiddles.filter(c => !validMiddles.has(String(c)));
      if (bad.length) {
        return res.status(400).json({ error: `세부직무 값이 올바르지 않습니다: ${bad.join(', ')}` });
      }
      patch.jobMiddles = [...new Set(patch.jobMiddles.map(String))];
    }
  }

  const spec = await repo.specs.upsert(req.user.id, patch);
  res.json({ message: '스펙이 저장되었습니다.', spec });
}));

// 닉네임 등 회원 정보 수정
app.put('/api/users/me', requireAuth, ah(async (req, res) => {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'nickname')) {
    const n = req.body.nickname;
    patch.nickname = typeof n === 'string' ? n.trim() || null : null;
  }
  const user = await repo.users.update(req.user.id, patch);
  res.json({ message: '저장되었습니다.', user: publicUser(user) });
}));

/* 멘티→멘토 전환 신청. **멘토→멘티는 없다** — 후배로 돌아가는 방향은 만들지
   않기로 했다. 되돌리기 어려운 결정이라(스펙·통계가 새 역할 기준으로 다시
   쌓인다) 세 가지를 확인한다.
     ① 멘토는 애초에 신청 대상이 아니다 — 위 이유로 막는다
     ② 가입 10일 미만이면 막는다 — 가입 직후 뒤집는 것을 막기 위해서다
     ③ 이미 신청이 진행 중이면 또 받지 않는다 — 신청 두 번이 겹치면 예정일이 뭐가
        맞는지 알 수 없어진다 */
app.post('/api/users/me/role-change', requireAuth, ah(async (req, res) => {
  const user = req.user;
  if (user.role !== 'mentee') {
    return res.status(400).json({ error: '멘티만 멘토로 전환을 신청할 수 있어요.' });
  }
  if (user.pendingRole) {
    return res.status(409).json({ error: '이미 멘토 전환 신청이 진행 중이에요.' });
  }
  const availableAt = new Date(user.createdAt).getTime() + ROLE_CHANGE_MIN_ACCOUNT_AGE_MS;
  if (Date.now() < availableAt) {
    return res.status(403).json({
      error: `가입 후 10일이 지나야 신청할 수 있어요. (${new Date(availableAt).toISOString().slice(0, 10)}부터)`,
    });
  }

  const effectiveAt = new Date(Date.now() + ROLE_CHANGE_EFFECTIVE_DELAY_MS);
  const updated = await repo.users.requestRoleChange(user.id, 'mentor', effectiveAt);
  res.json({ message: '멘토 전환이 신청되었습니다.', user: publicUser(updated) });
}));

// 멘토/멘티 회원 수 — 홈·백오피스의 통계 카드용. 개인정보는 내보내지 않는다.
app.get('/api/stats', ah(async (req, res) => {
  /* 예전에는 회원 배열을 전부 읽어 세었다. 이제 COUNT 로 센다 —
     회원이 늘어도 응답 크기와 시간이 그대로다. */
  const [counts, userCount, specCount] = await Promise.all([
    repo.users.countByRole(), repo.users.count(), repo.specs.count(),
  ]);
  res.json({
    counts,
    userCount,
    specCount,
  });
}));

/* ── 회사명 → 기업 규모 자동 분류 ──────────────────────────────
   공식 명단(공정위 대규모기업집단 / 공공기관 지정현황) 기반 조회.
   로컬 캐시만 보므로 외부 API 를 부르지 않는다 — 입력할 때마다 호출돼도 즉시 답한다.
   판정은 추천일 뿐이라 회원이 화면에서 고쳐 저장할 수 있다. */
app.get('/api/company/classify', ah(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '회사명이 필요합니다.' });

  const r = await catalog.classifyCompany(name);
  /* 판정에 실패했으면 corpType 을 주지 않는다.
     예전에는 matched:false 여도 'small' 을 내려보냈다. 지금 호출하는 화면은
     matched 를 보고 걸러내지만, 그걸 잊은 다음 호출자가 생기면 **회사를 못 찾은 것**과
     **중소기업으로 확인된 것**이 구분되지 않은 채 저장된다. 값 자체를 비워
     실수할 수 없게 만든다. */
  res.json({
    company: name,
    corpType: r.matched ? (CORP_TYPE_ID[r.type] || null) : null,
    label: r.matched ? r.type : null,
    source: r.source,
    matched: r.matched,        // false = 명단에 없다. 회원이 직접 골라야 한다.
    /* 못 찾았을 때 점수 계산에 실제로 쓰이는 값 — 화면에서 "×1.0 으로 계산됩니다" 를
       설명하려면 이게 필요하다. corpType 과 분리해 두어야 저장으로 새지 않는다. */
    fallbackCorpType: r.matched ? null : 'small',
  });
}));

/* 회사명 자동완성 — '삼성' → 삼성전자 · 삼성물산 …
   분류와 같은 로컬 캐시를 보므로 입력 중 타이핑마다 불러도 외부 API 를 타지 않는다. */
app.get('/api/company/suggest', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
  res.json({ query: q, items: q ? await catalog.suggestCompanies(q, limit) : [] });
}));

// 분류 캐시 상태 — 배치를 돌렸는지 확인용
app.get('/api/company/stats', ah(async (req, res) => res.json(await catalog.companyStats())));


/* ── 취업 업종 트리 — 회사 찾기 첫 화면이 실제로 쓰는 목록 ──────
   계열(company-sectors.js `sectors()`)과 무엇이 다른가: 저건 KSIC 중분류를 묶은
   '계열' 이고 여기는 **사람인·잡코리아가 쓰는 말**이다(게임·화장품·2차전지…).
   계열을 그대로 내보내던 라우트는 이 트리가 대신하면서 지웠다(작업정리 24-10).
   업종코드는 그대로 열쇠로 쓰되 화면에 나가는 이름만 바꾼 것이라, 근거는 그대로
   회사가 신고한 값이다(company-sectors.js industryTree · job-industry.js).

   민간·공공을 **한 번에** 준다. 옛 계열 목록은 공공기관을 따로 실어 날랐는데(업종코드가
   없어 계열에 4곳밖에 못 들어간다), 여기서는 '기관·공공' 이 대분류 하나로 들어가고 그
   아래를 기관 유형·소관부처로 나눠서 축이 어긋나지 않는다. 2,442곳 · 100KB 남짓이라
   한 번 받아 두면 단계를 오갈 때 서버를 다시 부를 일이 없다.

   ?middle=<KECO 2차 코드>[&job=<직업코드>] 를 주면 focus.minors 가 붙는다 —
   "이 직무를 주로 뽑는 업종" 에 추천 표시를 다는 데 쓴다. 목록을 잘라 보내지는
   않는다 — 좁힌 업종 밖에도 지원할 회사가 있다. 무엇을 왜 앞에 뒀는지는 화면이 밝히고,
   나머지를 볼 자유는 남긴다. */
app.get('/api/company/industry-tree', (req, res) => {
  res.set('Cache-Control', 'no-cache');   // 내용이 하루에 바뀌지 않는다 — ETag 재검증에 맡긴다
  const middle = String(req.query.middle || '').trim();
  const job = String(req.query.job || '').trim();
  const base = sectors.industryTree();
  res.json(middle ? { ...base, focus: sectors.industryFocus(middle, job) } : base);
});


/* ── 자격증 카탈로그 ────────────────────────────────────────────
   스펙 입력 화면의 자격증 선택 목록. 국가자격(큐넷 API 캐시) + 민간자격(수기).
   650종 남짓 · 60KB 정도라 페이징 없이 통째로 준다 — 프론트가 한 번 받아
   메모리에서 검색하면 입력 중 서버를 다시 부를 일이 없다.
   내용이 하루에도 바뀌는 데이터가 아니므로 캐시를 길게 잡는다. */
app.get('/api/certs', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');   // ETag 로 재검증 — 아래 /api/jobs 주석 참고
  res.json(await catalog.certCatalog());
}));

/* ── 직무로 모집 중인 공고 (2026-08-22 신규) ───────────────────
     GET /api/job-postings?jobMajor=0&jobMiddles=03

   CAS 화면이 쓰려고 만들었는데, 2026-08-22 그 띠를 걷어냈다(작업정리 36장).
   **지금 부르는 화면이 없다.** 신입 필터·마감 판정이 alio-jobs.js 에 모여 있고
   테스트가 붙어 있어, 직무 단위 목록이 다시 필요해질 때를 위해 남겨 둔다.

   ── 지금은 공공기관 공고뿐이다 ──
   사람인 키(SARAMIN_ACCESS_KEY)가 비어 있고 워크넷은 개인회원이 막혀 있다
   (작업정리 10-7). 응답에 그 사실이 reason 으로 실려 나가고, 화면이 그대로
   보여준다 — 0건을 "이 직무는 채용이 없다" 로 읽게 두지 않는다. */
app.get('/api/job-postings', ah(async (req, res) => {
  const jobMiddles = String(req.query.jobMiddles || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
  res.json(ALIO.jobPostings({
    jobMajor: req.query.jobMajor,
    jobMiddles,
    /* 기본은 신입만. 이 화면을 보는 사람은 대학생이고, 경력 공고가 섞이면
       "지원할 수 있는 곳" 이 실제보다 많아 보인다. */
    newcomerOnly: req.query.newcomerOnly !== 'false',
    limit,
  }));
}));

/* ── 멘토 목록 (멘토 찾기) ─────────────────────────────────────
   2026-08-22 신규. 그전까지 멘토 찾기는 **프론트에 박아 둔 배열 102명**이었다
   (mentoring.js MENTORS + 자동 생성). 멘토가 멘토 페이지를 아무리 채워도 목록에
   안 뜨는 이유가 그것이었다 — 화면이 서버를 안 봤다.

   ── 로그인을 요구하지 않는다 ──
   가입 전에 "어떤 선배가 있는지" 를 보고 가입 여부를 정한다. 대신 내보내는 칸을
   repo.mentors.list() 가 이름으로 못 박아, 연락처·생년월일 같은 값이 새지 않는다. */
app.get('/api/mentors', ah(async (req, res) => {
  const mentors = await repo.mentors.list();
  res.json({ count: mentors.length, mentors });
}));

/* 자격증 추천 — "이 직무에서 실제로 보는 자격증" (2026-08-21 신규)
     GET /api/certs/recommend?jobMajor=0&jobMiddles=02,03&dept=business

   ── 왜 서버가 하나 ──
   예전에는 화면(aggregation.js CERT_CATALOG)이 손으로 쓴 표를 들고 있었다. 근거로
   쓰는 자료가 **자격 카탈로그(DB)와 채용공고 캐시(파일)** 라 화면에 둘 수가 없고,
   같은 판단을 스펙 채우기(#specup)에서도 쓸 참이라 한 곳에 둔다.

   ── 로그인을 요구하지 않는다 ──
   개인 정보가 들어가지 않는 계산이다(직무 코드만 받는다). 회원가입 전에 둘러보는
   사람에게도 같은 화면이 보여야 한다 — /api/certs·/api/jobs 와 같은 취급이다. */
app.get('/api/certs/recommend', ah(async (req, res) => {
  const jobMiddles = String(req.query.jobMiddles || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
  const { certs } = await catalog.certCatalog();
  res.json(certReco.recommend({
    certs,
    jobMajor: req.query.jobMajor,
    jobMiddles,
    dept: req.query.dept,
    limit,
  }));
}));

/* 자격증 검색 — /api/company/suggest · /api/majors/suggest 와 같은 규약(q · limit → items). */
app.get('/api/certs/suggest', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
  res.json({ query: q, items: q ? await catalog.searchCerts(q, limit) : [] });
}));

/* ── 직업 분류 (커리어 로드맵) ──────────────────────────────────
   한국고용직업분류 대분류 10 → 중분류 35 → 직업 461 (임금·전망 포함).
   200KB 남짓이라 초기 로딩에 얹지 않고, 로드맵 화면을 처음 열 때만 받아 간다.

   ── max-age 를 길게 주면 안 된다 (실측으로 데였다) ──
   처음엔 'public, max-age=86400' 을 줬다. 분류와 임금이 하루에 바뀌는 값이 아니라서
   맞다고 봤는데, **응답에 필드를 하나 추가했더니 화면에 undefined 가 떴다.**
   max-age 가 살아 있는 동안 브라우저는 서버에 묻지도 않고 옛 본문을 쓴다 —
   서버를 재시작해도, 코드를 고쳐도 하루 동안 반영되지 않는다.

   그래서 'no-cache' 로 둔다. 이름과 달리 '캐시 금지'가 아니라 **쓰기 전에 물어보라**는
   뜻이다. express 가 붙여 주는 ETag 로 재검증해서, 안 바뀌었으면 304(본문 없음)로
   끝나고 바뀌었을 때만 200KB 를 다시 받는다. 대역폭은 거의 그대로면서 갱신은 즉시 된다. */
app.get('/api/jobs', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await catalog.jobCatalog());
}));

/* ── 학과 카탈로그 ────────────────────────────────────────────
   스펙 입력의 '학과' 검색 목록. 지금은 손으로 추린 임시 목록이고,
   커리어넷 학과정보 키가 나오면 수집 스크립트로 교체한다(major-catalog.js 주석).

   dept 는 careerly 통계를 묶는 키다. 학과명만 저장하면 스펙이 수천 갈래로 흩어져
   합격자 평균이 무의미해지므로, 학과명과 함께 어느 분류로 묶이는지도 같이 준다. */
app.get('/api/majors', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await catalog.majorCatalog());
}));

/* 학과 검색 — 입력할 때마다 부른다(프론트가 debounce 로 묶는다).
   회사명 자동완성(/api/company/suggest)과 같은 규약이다: q · limit 을 받고
   { items: [...] } 를 돌려준다. 세 검색이 같은 모양이라야 프론트 부품 하나로 끝난다.

   지금 카탈로그는 193개라 목록을 통째로 내려도 되지만, 커리어넷 학과정보 키가 나오면
   수천 개가 된다. 그때 구조를 다시 바꾸지 않도록 처음부터 서버 검색으로 둔다. */
app.get('/api/majors/suggest', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
  res.json({ query: q, items: q ? await catalog.searchMajors(q, limit) : [] });
}));

/* 학교 검색 — 위 세 검색(회사·자격증·학과)과 같은 규약이다.
   카탈로그는 scripts/fetch-universities.js 가 커리어넷에서 받아 채운다.
   **비어 있어도 화면은 동작한다** — 자동완성만 안 뜨고 직접 입력은 계속된다.
   대학은 이름 표기가 비교적 일정해서(‘서울대학교’) 학과만큼 흔들리지 않는다. */
app.get('/api/universities/suggest', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
  res.json({ query: q, items: q ? await catalog.searchUniversities(q, limit) : [] });
}));

/* 목록에 없는 학과명을 직접 적었을 때 어느 분류로 묶일지 알려준다.
   못 맞추면 dept:null — 화면이 '직접 골라주세요'로 빠진다. */
app.get('/api/majors/classify', ah(async (req, res) => {
  const name = String(req.query.name || '').trim();
  res.json({ major: name, dept: await catalog.deptOfMajor(name) });
}));

/* ── 백오피스 (관리자 전용) ────────────────────────────────────
   회원 목록 조회·삭제, 데모 시드, 전체 초기화. 남의 계정을 지울 수 있는 곳이라
   **로그인 + 관리자 권한** 을 둘 다 본다.

   예전에는 NODE_ENV 로만 막았다(운영 404 / 개발은 무제한). 그러면 스테이징이나
   팀원 PC 에서는 아무나 회원 1,508명을 지울 수 있다. 이제 권한으로 막는다.

   관리자 지정은 users.is_admin 이고, 최초 관리자는 ADMIN_USERNAMES 로 만든다
   (아래 부팅 로직). 화면에서 버튼을 숨기는 것은 편의일 뿐 방어가 아니다 —
   막는 곳은 여기다. */
function requireAdmin(req, res, next) {
  /* 권한 없는 사람에게 '있는데 막혔다'를 알려줄 이유가 없어서 404 로 돌려준다.
     경로가 있다는 사실 자체가 정보다(계정 삭제 API 가 있다는 힌트). */
  if (!req.user?.isAdmin) {
    return res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다.' });
  }
  next();
}

/* requireAuth 를 먼저 태워야 req.user 가 채워진다. 순서를 바꾸면 항상 404 다. */
const adminOnly = [requireAuth, requireAdmin];

app.get('/api/admin/users', adminOnly, ah(async (req, res) => {
  const users = await repo.users.listAll();
  res.json({ users: users.map(u => ({ ...publicUser(u), hasSpec: u.hasSpec })) });
}));

app.delete('/api/admin/users/:username', adminOnly, ah(async (req, res) => {
  /* 프로필·세션·스펙·자격증·활동은 외래키 CASCADE 로 함께 지워진다.
     예전에는 배열마다 직접 걸러냈고, 새 컬렉션이 생길 때마다 빠뜨리기 쉬웠다. */
  const removed = await repo.users.deleteByUsername(req.params.username);
  if (!removed) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
  res.json({ message: '삭제되었습니다.' });
}));

app.post('/api/admin/clear', adminOnly, ah(async (req, res) => {
  // users 만 지우면 프로필·세션·스펙은 CASCADE 로 따라간다
  await query('DELETE FROM users');
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: '초기화되었습니다.' });
}));

app.post('/api/admin/seed', adminOnly, ah(async (req, res) => {
  // 고정 데모는 계정마다 비밀번호가 다를 수 있어 개별 해싱한다
  let added = 0, filled = 0;
  for (const { u, s, p } of DEMO_SEED) {
    const existing = await repo.users.byUsername(u.username);
    if (!existing) {
      await insertSeedUser(u, s, await bcrypt.hash(u.password, 10), p);
      added++;
      continue;
    }
    /* ── 이미 있는 데모 계정은 빈 칸만 채운다 (2026-08-22) ──
       예전에는 그냥 건너뛰었다. 그런데 멘토 프로필이 시드에 새로 생기면서,
       **데모 계정을 이미 만들어 둔 DB 에서는 그 프로필이 영영 안 들어간다** —
       버튼을 눌러도 '추가되었습니다' 만 뜨고 멘토 찾기는 계속 비어 있다.
       덮어쓰지는 않는다. 데모 계정으로 직접 적어 본 소개글을 지워 버리면
       시연 준비가 통째로 날아간다. */
    if (!p) continue;
    const cur = await repo.profiles.get(existing.id);
    if (cur?.intro || (cur?.specialties || []).length) continue;
    await repo.profiles.update(existing.id, p);
    /* 스펙에도 회사·직무가 새로 붙었다(멘토 찾기의 분야 필터가 이걸 쓴다).
       upsert 는 넘긴 키만 고치므로 학점·자격증은 그대로 남는다. */
    if (s) await repo.specs.upsert(existing.id, s);
    filled++;
  }
  res.json({ message: `데모 데이터가 추가되었습니다. (새 계정 ${added}명 · 프로필 보충 ${filled}명)` });
}));

// 무작위 N명 추가 — 커리어 로드맵·CAS 집계를 채우기 위한 대량 시드
app.post('/api/admin/seed-random', adminOnly, ah(async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 50, 1), 200);

  // 무작위 계정은 비밀번호가 모두 같으므로 해시를 한 번만 계산해 재사용한다
  const sharedHash = await bcrypt.hash('demo1234!', 10);
  let added = 0;
  for (const { u, s } of generateRandom(count)) {
    if (await repo.users.usernameTaken(u.username)) continue;
    if (await repo.users.emailTaken(u.email)) continue;
    await insertSeedUser(u, s, sharedHash);
    added++;
  }
  res.json({ message: `무작위 회원 ${added}명이 추가되었습니다.`, added });
}));

async function insertSeedUser(u, s, passwordHash, p) {
  const user = await repo.users.create({
    id: nanoid(),
    username: u.username, passwordHash,
    name: u.name, email: u.email, role: u.role, nickname: null,
  });
  if (s) await repo.specs.upsert(user.id, s);
  /* 멘토 프로필(소개글·전문분야·타임라인·가능 일정). 이게 있어야 '멘토 찾기'
     목록에 뜬다(repo.mentors.list 는 프로필을 채운 멘토만 낸다).
     예전에는 목록이 프론트에 박힌 가짜 멘토 102명이라 시드가 필요 없었다. */
  if (p) await repo.profiles.update(user.id, p);
}

/* 학과·직무 참조 자료는 회원 데이터가 아니라 정적 자료다(db-seed.json).
   테이블로 만들 이유가 없어 파일에서 그대로 읽는다. */
app.get('/api/departments', (req, res) => {
  res.json({ departments: repo.reference.departments() });
});

app.get('/api/career-specs', (req, res) => {
  const { departmentId, jobId } = req.query;
  let specs = repo.reference.careerSpecs();
  if (departmentId) specs = specs.filter(s => s.departmentId === departmentId);
  if (jobId) specs = specs.filter(s => s.jobId === jobId);
  res.json({ specs });
});

app.get('/api/jobs/:jobId/specs', (req, res) => {
  const spec = repo.reference.careerSpecs().find(s => s.jobId === req.params.jobId);
  if (!spec) return res.status(404).json({ error: '해당 직무 데이터를 찾을 수 없습니다.' });
  res.json({ spec });
});

app.use((req, res) => {
  res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다.' });
});

/* 라우트에서 던진 예외를 잡는다. 없으면 async 라우트의 실패가 응답 없이 매달려
   요청이 타임아웃될 때까지 브라우저가 기다린다. */
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.path, '-', err.message);
  if (res.headersSent) return next(err);

  /* 본문이 한도를 넘으면 express.json 이 여기로 던진다. 500 으로 뭉개면
     사용자는 '서버 장애'로 읽고 같은 사진을 계속 다시 올린다. */
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '보낸 내용이 너무 큽니다. 사진 용량을 줄여주세요.' });
  }
  /* 잘못된 JSON 도 서버 잘못이 아니다. */
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  }
  res.status(500).json({ error: '서버에서 문제가 생겼습니다.' });
});

/* DB 연결을 확인한 뒤에 포트를 연다. 연결이 안 되는데 서버만 떠 있으면
   모든 API 가 500 을 내면서 '살아있는 척' 해서 원인을 찾기 어렵다. */
assertConnection()
  .then(async () => {
    /* 최초 관리자 만들기. 백오피스는 관리자만 들어가는데, 관리자를 지정하는 화면도
       백오피스 안에 있다 — 그대로 두면 아무도 못 들어간다. 그 고리를 여기서 끊는다.
       **가입하지 않은 아이디는 무시된다**(UPDATE 라 대상이 없으면 0건). 먼저 가입한 뒤
       서버를 다시 띄우면 반영된다. */
    const adminNames = (process.env.ADMIN_USERNAMES || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (adminNames.length) {
      const promoted = await repo.users.promoteAdmins(adminNames);
      const missing = adminNames.filter(n => !promoted.includes(n));
      console.log(`[관리자] ${promoted.length}명 — ${promoted.join(', ') || '없음'}`);
      if (missing.length) {
        console.warn(`[관리자] 아직 가입하지 않은 아이디: ${missing.join(', ')} `
          + '— 가입 후 서버를 다시 띄우면 반영됩니다.');
      }
    } else {
      console.warn('[관리자] ADMIN_USERNAMES 가 비어 있습니다 — 백오피스에 들어갈 수 있는 사람이 없습니다.');
    }

    app.listen(PORT, () => {
      console.log(`Careerly backend running on http://localhost:${PORT}`);
      /* 선택 기능은 키가 없으면 조용히 꺼진 채로 돈다. 화면에서는 '되는 것 같은데
         이상한' 모습으로만 나타나서(뉴스가 웹 폴백으로 빠지는 식) 원인을 찾기
         어렵다. 무엇이 켜졌는지 부팅할 때 한 줄로 남긴다. 키 값은 찍지 않는다. */
      /* Raw Editor 에서 'KEY=값' 줄을 통째로 값 칸에 붙여넣는 실수가 실제로 있었다.
         TOSS_CLIENT_KEY 값이 'TOSS_CLIENT_KEY=test_ck_...' 가 돼서 결제창이 뜨지
         않았는데, 값이 비어 있지는 않아 화면상으로는 '켜짐'으로 보였다.
         키 값에 자기 이름이 들어갈 일은 없으므로 여기서 잡는다. */
      Object.entries(process.env).forEach(([k, v]) => {
        if (typeof v === 'string' && v.startsWith(k + '=')) {
          console.warn(`[설정] ${k} 값에 변수 이름이 같이 들어갔습니다. `
            + `'${k}=' 를 떼고 값만 넣으세요.`);
        }
      });

      const on = v => v ? '켜짐' : '꺼짐';
      console.log('[기능] '
        + `결제 ${on(process.env.TOSS_SECRET_KEY && process.env.TOSS_CLIENT_KEY)} · `
        + `네이버로그인 ${on(process.env.NAVER_LOGIN_CLIENT_ID)} · `
        + `카카오로그인 ${on(process.env.KAKAO_REST_API_KEY)} · `
        + `AI ${on(process.env.GROQ_API_KEY)} · `
        + `뉴스 ${require('./news').provider()} · `
        /* 기업 색인(dart-corps.json)은 깃에 없다 — 빌드에서 받는다(.gitignore 참고).
           클론만 하고 npm run build 를 안 돌리면 기업분석이 통째로 빈 채로 뜨는데,
           화면만 봐서는 "DART 가 자료를 안 준다"로 보인다. 그래서 여기서 밝힌다.
           파일을 읽지는 않는다 — 6MB 를 부팅에 파싱할 이유가 없다(첫 요청 때 읽는다). */
        + `기업분석 ${!process.env.DART_API_KEY ? '꺼짐(키 없음)'
            : require('fs').existsSync(require('./dart').CORPS_PATH) ? '켜짐'
            : '색인 없음 — npm run build'}`);
    });
  })
  .catch((e) => {
    /* 에러를 버리면 안 된다. 접속 정보 자체가 깨진 경우(URL 파싱 실패)는
       assertConnection 의 로그까지 가지도 못해서, 이 줄만 찍히고 원인이
       사라진다. 배포에서 그것 때문에 한참 헤맸다. */
    console.error('DB 에 연결하지 못해 서버를 시작하지 않습니다. 접속 정보를 확인하세요.');
    console.error(`        ${e.message}`);
    process.exit(1);
  });
