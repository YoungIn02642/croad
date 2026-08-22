/* ════════════════════════════════════════════════════════════
   데모 시드 데이터 — 백오피스의 '데모 데이터 추가' 버튼에서 사용.
   개발/시연용이며 운영 환경에서는 /api/admin/* 자체가 막혀 있다.

   스펙의 dept/field/job 은 옛 학과 기반 스키마다.
   커리어 로드맵(NCS 분류)에서는 frontend/js/ncs.js 의 legacy 매핑을 통해
   해당 NCS 중분류로 집계된다.
   ════════════════════════════════════════════════════════════ */

// ── 무작위 시드 생성기 ───────────────────────────────────────
//  백오피스의 '무작위 N명 추가' 에서 사용. dept/field/job 은 ncs.js 의
//  legacy 매핑에 맞는 조합만 쓴다(그래야 NCS 커리어 로드맵에 집계된다).
//  각 원형(archetype)은 학과·직무와 어울리는 자격증 풀·어학 성향을 가진다.

/* corps: 이 원형이 주로 가는 기업 유형 풀. 같은 값을 여러 번 넣어 비중을 준다.
   (예: 컨설팅은 대기업 편중, 법무는 공기업 비중이 큼) */
const ARCHETYPES = [
  { dept: 'cs', field: 'service', jobs: ['backend', 'frontend', 'mobile', 'ai'],
    certs: ['정보처리기사', 'SQLD', 'ADsP', 'AWS SAA', 'CKA', '정보보안기사'],
    gpa: [3.2, 4.3], toeic: [780, 970], names: '개발',
    corps: ['large', 'large', 'mid', 'small', 'small', 'public'] },
  { dept: 'business', field: 'finance', jobs: ['ib', 'bank', 'am'],
    certs: ['금융투자분석사', '투자자산운용사', 'CFA Level 1', '재무위험관리사(FRM)', '은행FP(AFPK)'],
    gpa: [3.3, 4.2], toeic: [820, 980], names: '금융',
    corps: ['large', 'large', 'mid', 'public', 'public'] },
  { dept: 'business', field: 'consulting', jobs: ['strategy', 'operation'],
    certs: ['재경관리사', 'ADsP', '컴퓨터활용능력 1급'],
    gpa: [3.6, 4.4], toeic: [880, 990], names: '컨설팅',
    corps: ['large', 'large', 'large', 'mid'] },
  { dept: 'business', field: 'marketing', jobs: ['brand', 'digital', 'perf'],
    certs: ['구글애널리틱스', 'ADsP', 'GTQ 1급'],
    gpa: [3.0, 4.1], toeic: [750, 950], names: '마케팅',
    corps: ['large', 'mid', 'mid', 'small', 'small'] },
  { dept: 'business', field: 'corp', jobs: ['plan', 'hr', 'finance'],
    certs: ['경영지도사', '컴퓨터활용능력 1급', '재경관리사'],
    gpa: [3.2, 4.2], toeic: [800, 960], names: '경영',
    corps: ['large', 'large', 'mid', 'public'] },
  { dept: 'economics', field: 'finance', jobs: ['research', 'bank'],
    certs: ['CFA Level 1', '투자자산운용사', '재경관리사'],
    gpa: [3.4, 4.3], toeic: [830, 980], names: '경제',
    corps: ['large', 'mid', 'public', 'public'] },
  { dept: 'accounting', field: 'audit', jobs: ['cpa', 'tax'],
    certs: ['CPA', '재경관리사', 'TAT'],
    gpa: [3.5, 4.4], toeic: [780, 940], names: '회계',
    corps: ['large', 'mid', 'mid', 'small'] },
  { dept: 'stat', field: 'data', jobs: ['analyst', 'scientist'],
    certs: ['ADsP', 'SQLD', '데이터분석 준전문가'],
    gpa: [3.3, 4.3], toeic: [800, 970], names: '통계',
    corps: ['large', 'mid', 'small', 'public'] },
  { dept: 'psych', field: 'hr', jobs: ['hr', 'recruit'],
    certs: ['공인노무사', '경영지도사(인적자원)'],
    gpa: [3.2, 4.1], toeic: [770, 930], names: '인사',
    corps: ['large', 'mid', 'mid', 'small', 'public'] },
  { dept: 'psych', field: 'clinical', jobs: ['counsel'],
    certs: ['임상심리사', '청소년 상담사'],
    gpa: [3.4, 4.2], toeic: [720, 900], names: '상담',
    corps: ['small', 'small', 'mid', 'public', 'public'] },
  { dept: 'law', field: 'lawfirm', jobs: ['paralegal', 'legaltech'],
    certs: ['공인노무사', '법무사'],
    gpa: [3.5, 4.4], toeic: [820, 970], names: '법무',
    corps: ['large', 'mid', 'small', 'public', 'public'] },
  { dept: 'media', field: 'marketing', jobs: ['brand', 'content'],
    certs: ['GTQ 1급', 'ADsP', '구글애널리틱스'],
    gpa: [3.0, 4.0], toeic: [760, 940], names: '미디어',
    corps: ['mid', 'small', 'small', 'large'] },
  { dept: 'media', field: 'media', jobs: ['pd', 'editor'],
    certs: ['GTQ 1급', '웹디자인기능사'],
    gpa: [2.9, 3.9], toeic: [730, 910], names: '방송',
    corps: ['large', 'mid', 'small', 'small', 'public'] },
];

const OPIC_POOL = ['IM2', 'IM3', 'IH', 'IH', 'AL'];
const TS_POOL   = ['IM', 'IM', 'IH', 'AL'];
const SURNAMES  = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배白'.replace('白','백').split('');
const GIVEN     = ['민준','서연','도윤','하은','지호','수아','예준','지우','시우','하윤','주원','서준','지아','유진','건우','채원','현우','다은','준서','예은','윤서','지훈','서现','민서','재윤'].map(s=>s.replace('現','현'));

function rint(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function pick(arr)    { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p)    { return Math.random() < p; }
function sampleN(arr, n) {
  const a = [...arr];
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(rint(0, a.length - 1), 1)[0]);
  return out;
}

/* seq: 아이디 유일성을 위한 일련번호 */
function makeRandomEntry(seq) {
  const a = pick(ARCHETYPES);
  const gpa = Math.round((a.gpa[0] + Math.random() * (a.gpa[1] - a.gpa[0])) * 100) / 100;

  // 어학: 대부분 토익, 일부는 오픽/토스도 함께
  const scores = { toeic: rint(a.toeic[0], a.toeic[1]) - (rint(a.toeic[0], a.toeic[1]) % 5) };
  if (chance(0.5)) scores.opic = pick(OPIC_POOL);
  if (chance(0.25)) scores.toeicSpeaking = pick(TS_POOL);

  // 정성 스펙: 설문(구글폼)과 동일한 구조화된 대표 활동
  const activities = makeRandomActivities();

  const name = pick(SURNAMES) + pick(GIVEN);
  return {
    u: {
      username: `rand_${Date.now().toString(36)}_${seq}`,
      password: 'demo1234!',
      name,
      email: `rand_${Date.now().toString(36)}_${seq}@careerly.demo`,
      role: chance(0.8) ? 'mentor' : 'mentee',
    },
    s: {
      dept: a.dept, field: a.field, job: pick(a.jobs),
      corpType: pick(a.corps),
      gpa, gpaMax: 4.5,
      certs: sampleN(a.certs, rint(0, Math.min(3, a.certs.length))),
      scores,
      activities,
    },
  };
}

/* 대표 활동 1~4개를 그럴듯하게 생성 — CAS 정성 채점(유형·기간·역할·성과)의 입력.
   유형별 등장 확률은 CAS 가중치 우선순위(인턴십·공모전·대외활동)를 반영한다. */
const DURATIONS = ['1개월 미만', '1~3개월', '3개월~6개월', '6개월~1년', '1년이상'];
const OUTCOMES  = ['수상', '논문', '발표 또는 산출물 공개(깃헙 등)', '전환, 정규직 합격', '결과물 없음'];
const ACT_POOL = [
  { type: 'internship',     p: 0.6,  roleKind: 'team' },
  { type: 'competition',    p: 0.45, roleKind: 'team' },
  { type: 'extracurricular',p: 0.5,  roleKind: 'free' },
  { type: 'project',        p: 0.55, roleKind: 'team' },
  { type: 'research',       p: 0.15, roleKind: 'stage' },
  { type: 'club',           p: 0.4,  roleKind: 'exec' },
  { type: 'exchange',       p: 0.15, roleKind: 'none' },
  { type: 'volunteer',      p: 0.25, roleKind: 'none' },
];
function makeRandomActivities() {
  const out = [];
  for (const t of ACT_POOL) {
    if (out.length >= 4) break;
    if (!chance(t.p)) continue;
    const act = { type: t.type, duration: pick(DURATIONS), outcome: pick(OUTCOMES) };
    if (t.roleKind === 'team')  act.role  = pick(['팀장', '팀원', '개인']);
    if (t.roleKind === 'exec')  act.role  = pick(['임원진', '동아리원, 일반학회원']);
    if (t.roleKind === 'stage') act.stage = pick(['학부연구생', '석사', '박사']);
    if (t.roleKind === 'free')  act.role  = chance(0.5) ? '리더' : '';
    out.push(act);
  }
  if (!out.length) out.push({ type: 'project', duration: '3개월~6개월', role: '팀원', outcome: '결과물 없음' });
  return out;
}

/* 멘티(스펙 없음)는 s:null 로 만든다 */
function generateRandom(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = makeRandomEntry(i);
    if (e.u.role === 'mentee') e.s = null;   // 멘티는 스펙 미입력
    out.push(e);
  }
  return out;
}

/* ── 데모 멘토의 예약 가능 일정 ────────────────────────────────
   날짜를 시드 파일에 박아 두면 며칠 뒤부터 **전부 지난 날짜**가 되어 달력이 빈다.
   그래서 '오늘로부터 며칠 뒤' 로 적고, 넣는 순간에 날짜로 바꾼다.
   일요일은 건너뛴다 — 멘토 페이지의 기본 감각과 맞춘다. */
function availabilityIn(dayOffsets, times) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const off of dayOffsets) {
    const d = new Date(today); d.setDate(d.getDate() + off);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      times: [...times],
    });
  }
  /* 일요일을 밀다 보면 같은 날짜가 겹칠 수 있다. 겹치면 뒤엣것이 이긴다 —
     profiles.availability 의 규칙(server.js PUT /api/profile)과 같게 맞춘다. */
  return [...new Map(out.map(s => [s.date, s])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* ── 데모 멘토 프로필 (2026-08-22 추가) ────────────────────────
   '멘토 찾기'가 프론트에 박힌 가짜 멘토 102명을 쓰던 것을 걷어내면서 넣었다.
   이제 목록은 **프로필을 채운 실제 회원**만 보여주므로(repo.mentors.list),
   데모 계정도 멘토 페이지를 채워야 화면에 나온다.

   가짜 멘토와 다른 점은 **관리자가 명시적으로 넣는 데이터**라는 것이다 —
   /api/admin/seed 는 운영에서 권한으로 막혀 있고, 앱 코드에는 남지 않는다. */
const DEMO_SEED = [
  { u: { username: 'demo_kim', password: 'demo1234!', name: '김민준', email: 'kim@careerly.demo', role: 'mentor' },
    p: { currentJob: '백엔드 엔지니어',
         intro: '비전공에서 시작해 카카오 백엔드로 왔어요. 신입 포트폴리오와 기술면접 준비를 같이 봐드립니다.',
         specialties: ['백엔드', '기술면접', '포트폴리오', '비전공 취업'],
         modes: ['video30', 'text'],
         timeline: [
           { t: '카카오 백엔드 엔지니어', d: '2024.03 ~ 현재', s: '커머스 결제 서버 개발' },
           { t: '카카오 백엔드 인턴', d: '2023.07 ~ 2023.08', s: '사내 API 게이트웨이 개선' },
           { t: '교내 알고리즘 학회 운영진', d: '2021.03 ~ 2022.12', s: '스터디 운영 · 교내 대회 기획' },
         ],
         availability: availabilityIn([2, 4, 6, 9, 11], ['10:00', '14:00', '20:00']) },
    s: { dept: 'cs', field: 'service', job: 'backend',
         company: '카카오', jobMajor: '1', jobMiddles: ['13'],
         careers: [{ company: '카카오', start: '2024-03', current: true, position: '백엔드 엔지니어' }],
         corpType: 'large',
         gpa: 3.85, gpaMax: 4.5,
         certs: ['정보처리기사', 'SQLD', 'AWS SAA'],
         scores: { toeic: 920, opic: 'IH', toeicSpeaking: 'IH' },
         qual: { extracurricular: true, projects: true, internship: true, oncampus: true,
                 coreCourses: true, langStudy: false, exchange: false, gradSchool: false },
         detail: { projectsText: '캡스톤 — 분산 채팅 백엔드 (3인, 팀장)',
                   internshipText: '카카오 백엔드 인턴 (2개월)',
                   activitiesText: '교내 알고리즘 학회 운영진 2년' } } },

  { u: { username: 'demo_lee', password: 'demo1234!', name: '이서연', email: 'lee@careerly.demo', role: 'mentor' },
    p: { currentJob: '프론트엔드 엔지니어',
         intro: '교환학생과 병행하며 프론트엔드로 취업했어요. 디자인 시스템·React 포트폴리오를 함께 정리해요.',
         specialties: ['프론트엔드', 'React', '교환학생', '포트폴리오'],
         modes: ['video30', 'onsite60'],
         timeline: [
           { t: '토스 프론트엔드 엔지니어', d: '2024.01 ~ 현재', s: '결제 화면 디자인 시스템' },
           { t: '알토대 교환학생', d: '2022.09 ~ 2023.01', s: '핀란드 · 웹 접근성 연구 프로젝트' },
         ],
         availability: availabilityIn([3, 5, 8, 12], ['11:00', '15:00', '19:00']) },
    s: { dept: 'cs', field: 'service', job: 'frontend',
         company: '토스', jobMajor: '1', jobMiddles: ['13'],
         careers: [{ company: '토스', start: '2024-01', current: true, position: '프론트엔드 엔지니어' }],
         corpType: 'mid',
         gpa: 3.95, gpaMax: 4.5,
         certs: ['정보처리기사', 'GTQ 1급'],
         scores: { toeic: 880, opic: 'AL' },
         qual: { extracurricular: true, projects: true, internship: false, oncampus: true,
                 coreCourses: true, langStudy: false, exchange: true, gradSchool: false },
         detail: { exchangeText: '핀란드 알토대 1학기' } } },

  { u: { username: 'demo_park', password: 'demo1234!', name: '박지훈', email: 'park@careerly.demo', role: 'mentor' },
    p: { currentJob: 'IB 애널리스트',
         intro: '증권사 IB본부에서 일합니다. 금융권 자소서와 재무모델링 과제 준비를 도와드려요.',
         specialties: ['IB', '재무모델링', '금융권 자소서', 'CFA'],
         modes: ['video30', 'onsite60', 'text'],
         timeline: [
           { t: '미래에셋증권 IB본부', d: '2023.01 ~ 현재', s: 'ECM · 인수합병 자문' },
           { t: '미래에셋증권 인턴', d: '2022.06 ~ 2022.08', s: 'IB본부 리서치 보조' },
           { t: 'CFA 한국지부 학회 총무', d: '2020.03 ~ 2022.05', s: '밸류에이션 스터디 운영' },
         ],
         availability: availabilityIn([2, 5, 7, 10, 14], ['09:00', '13:00', '21:00']) },
    s: { dept: 'business', field: 'finance', job: 'ib',
         company: '미래에셋증권', jobMajor: '0', jobMiddles: ['03'],
         careers: [{ company: '미래에셋증권', start: '2023-01', current: true, position: 'IB 애널리스트' }],
         corpType: 'large',
         gpa: 3.7, gpaMax: 4.5,
         certs: ['금융투자분석사', '투자자산운용사', 'CFA Level 1'],
         scores: { toeic: 950, toefl: 105, opic: 'AL' },
         qual: { extracurricular: true, projects: true, internship: true, oncampus: true,
                 coreCourses: true, langStudy: true, exchange: false, gradSchool: false },
         detail: { internshipText: '미래에셋증권 IB본부 인턴 (3개월)',
                   activitiesText: 'CFA 한국지부 학회 총무' } } },

  { u: { username: 'demo_choi', password: 'demo1234!', name: '최수아', email: 'choi@careerly.demo', role: 'mentor' },
    p: { currentJob: '전략 컨설턴트',
         intro: '전략 컨설팅펌에서 신사업 프로젝트를 합니다. 케이스 면접과 문제 정의 프레임을 잡아드려요.',
         specialties: ['전략컨설팅', '케이스면접', '자소서첨삭', '문제해결'],
         modes: ['onsite60', 'video30'],
         timeline: [
           { t: '전략 컨설팅펌 컨설턴트', d: '2022.07 ~ 현재', s: '대기업 신사업 전략 프로젝트' },
           { t: '경영전략 학회', d: '2019.03 ~ 2021.05', s: '케이스 스터디 운영 · 공모전 대상' },
         ],
         availability: availabilityIn([4, 6, 11, 13], ['19:00', '20:00', '21:00']) },
    s: { dept: 'business', field: 'consulting', job: 'strategy',
         company: '베인앤드컴퍼니', jobMajor: '0', jobMiddles: ['02'],
         careers: [{ company: '베인앤드컴퍼니', start: '2022-07', current: true, position: '컨설턴트' }],
         corpType: 'large',
         gpa: 4.1, gpaMax: 4.5,
         certs: [],
         scores: { toeic: 980, opic: 'AL', toeicSpeaking: 'AL' },
         qual: { extracurricular: true, projects: true, internship: true, oncampus: false,
                 coreCourses: true, langStudy: true, exchange: true, gradSchool: true },
         detail: { gradSchoolText: '서울대 경영전문대학원 (예정)' } } },

  { u: { username: 'demo_jung', password: 'demo1234!', name: '정도윤', email: 'jung@careerly.demo', role: 'mentor' },
    p: { currentJob: '기업금융 심사역',
         intro: '국책은행 기업금융에서 일합니다. 공기업·금융 공기업 필기와 자소서 준비를 도와드려요.',
         specialties: ['공기업', 'NCS 필기', '기업금융', '금융권 자소서'],
         modes: ['text', 'video30'],
         timeline: [
           { t: '한국산업은행 기업금융', d: '2023.03 ~ 현재', s: '중견기업 여신 심사' },
           { t: '금융공기업 취업 스터디', d: '2021.09 ~ 2022.12', s: 'NCS · 전공 필기 스터디 리드' },
         ],
         availability: availabilityIn([3, 7, 9, 15], ['20:00', '21:00']) },
    s: { dept: 'business', field: 'finance', job: 'ib',
         company: '한국산업은행', jobMajor: '0', jobMiddles: ['03'],
         careers: [{ company: '한국산업은행', start: '2023-03', current: true, position: '기업금융 심사역' }],
         corpType: 'public',
         gpa: 3.5, gpaMax: 4.5,
         certs: ['금융투자분석사'],
         scores: { toeic: 905 },
         qual: { extracurricular: true, projects: false, internship: true, oncampus: true,
                 coreCourses: true, langStudy: false, exchange: false, gradSchool: false },
         detail: {} } },

  // 멘티 — 스펙 없이 회원만
  { u: { username: 'mentee_a', password: 'demo1234!', name: '강하늘', email: 'a@careerly.demo', role: 'mentee' }, s: null },
  { u: { username: 'mentee_b', password: 'demo1234!', name: '윤서윤', email: 'b@careerly.demo', role: 'mentee' }, s: null },
  { u: { username: 'mentee_c', password: 'demo1234!', name: '임시우', email: 'c@careerly.demo', role: 'mentee' }, s: null },
];

module.exports = { DEMO_SEED, generateRandom };
