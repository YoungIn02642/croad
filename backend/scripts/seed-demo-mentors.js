/* 멘토 찾기·내 멘토링을 시연할 수 있을 만큼 채운다.

     node scripts/seed-demo-mentors.js                # 빈 칸만 채운다 (여러 번 돌려도 안전)
     node scripts/seed-demo-mentors.js --force        # 이 스크립트가 만든 값을 다시 만든다
     node scripts/seed-demo-mentors.js --profiles     # 멘토 프로필만
     node scripts/seed-demo-mentors.js --requests     # 멘토링 신청 내역만
     node scripts/seed-demo-mentors.js --random 120   # 새 DB — 회원부터 만들고 채운다

   ── 왜 필요했나 ──
   멘토 계정은 124개인데 '멘토 찾기'에는 1명만 떴다. `repo.mentors.list()` 가
   **소개글이나 전문분야 중 하나라도 있는 멘토만** 내보내기 때문이다(그 판단은
   옳다 — 빈 카드를 눌러 봐야 후배에게 아무것도 없다). 무작위 시드
   (`POST /api/admin/seed-random`)는 스펙만 만들고 프로필은 안 만들어서, 계정을
   아무리 늘려도 목록은 계속 1명이었다.

   백오피스의 '데모 데이터 추가'(`POST /api/admin/seed`)가 같은 일을 하지만
   **관리자 계정이 있어야** 누를 수 있다(`ADMIN_USERNAMES`). 새 DB 를 받은 팀원은
   그 계정부터 만들어야 하므로, 스크립트로도 같은 결과에 닿게 둔다.

   ── 지어내지 않는 값 ──
   프로필은 그 사람의 **user_specs 에서 끌어온다** — 회사·직무·기업유형·경력은
   이미 DB 에 있는 값이고, 여기서는 그것을 사람이 읽는 문장으로 바꿀 뿐이다.
   스펙에 없는 회사나 경력을 프로필이 새로 지어내면, 같은 사람의 CAS 통계와
   멘토 카드가 서로 다른 말을 하게 된다.

   ── 여러 번 돌려도 같은 값이 나온다 ──
   난수를 user.id 로 고정한다(mulberry32). 그냥 Math.random 을 쓰면 돌릴 때마다
   같은 멘토의 소개글이 바뀌어서, 보고서에 넣은 화면과 다음에 띄운 화면이 달라진다.

   ── 예약 가능 일정은 날짜를 박지 않는다 ──
   '오늘로부터 며칠 뒤' 로 적고 넣는 순간에 날짜로 바꾼다(demo-seed.js
   availabilityIn 과 같은 규칙). 박아 두면 며칠 뒤부터 전부 지난 날짜가 되어
   달력이 빈다. 그래서 이 스크립트는 **며칠 지나면 다시 돌려야** 한다. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const { query, queryOne, assertConnection, pool } = require('../src/mysql');
const repo = require('../src/repo');
const { DEMO_SEED, generateRandom } = require('../src/demo-seed');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY = argv.includes('--profiles') ? 'profiles'
  : argv.includes('--requests') ? 'requests'
    : 'all';
/* 새로 만든 DB 에는 멘토 계정 자체가 없다(스키마만 올린 상태). 그때 쓴다 —
   백오피스의 '무작위 N명 추가'와 **같은 생성기**를 부르므로, 버튼을 누른 것과
   같은 회원이 들어온다. 이미 회원이 있으면 줄 필요가 없다. */
const RANDOM = (() => {
  const i = argv.indexOf('--random');
  if (i < 0) return 0;
  return Math.min(Math.max(parseInt(argv[i + 1], 10) || 120, 1), 300);
})();

/* ── 결정론적 난수 (mulberry32) ────────────────────────────────
   같은 user.id 는 언제 돌려도 같은 프로필을 낳는다. 위 머리주석의 이유. */
function rngFrom(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function rnd() {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* JSON 컬럼은 드라이버가 파싱해 주지만, 옛 데이터나 수동 입력으로 문자열이 올 수
   있다(repo.js 의 asJson 과 같은 이유·같은 규칙). JSON.parse 를 그냥 부르면
   이미 객체인 값에서 'Unexpected end of JSON input' 으로 죽는다. */
const asJson = v => {
  if (v == null) return undefined;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return undefined; } }
  return v;
};

const rint = (rnd, lo, hi) => Math.floor(rnd() * (hi - lo + 1)) + lo;
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const sampleN = (rnd, arr, n) => {
  const a = [...arr], out = [];
  while (out.length < n && a.length) out.push(a.splice(rint(rnd, 0, a.length - 1), 1)[0]);
  return out;
};

/* ── 직무 한 칸이 만드는 것 ────────────────────────────────────
   title  — 프로필의 '현재 직무'(profiles.current_job)
   field  — 멘토링 가능 분야(KECO 1차 코드). job_majors 표의 code 다:
            0 경영·사무·금융·보험 · 1 연구/공학 · 2 교육·법률·복지 · 4 예술·디자인·방송
   spec   — 전문 분야 칩 후보. 멘토 찾기의 '전문 분야' 필터가 이 값으로 거른다
   tasks  — 타임라인의 세부 한 줄 후보
   helps  — 소개글 뒷문장('무엇을 도와주는가')

   ── 이 표는 앱의 진실이 아니다 ──
   화면이 쓰는 직무 이름표는 `frontend/js/spec-form.js` 의 JOB_OPTIONS 다. 여기 것은
   **데모 문구를 만들기 위한 재료**이고, 무작위 시드가 쓰는 직무(operation·perf·
   recruit·tax 등)까지 덮어야 해서 그쪽보다 넓다. 둘이 어긋나도 앱은 영향받지 않는다 —
   이 파일은 서버가 require 하지 않는다. */
const JOB_COPY = {
  backend:   { firm: 'tech', title: '백엔드 엔지니어', field: '1', spec: ['백엔드', '기술면접', '코딩테스트', '포트폴리오'], tasks: ['결제 서버 개발', '트래픽 대응과 캐시 설계', '사내 API 게이트웨이 개선'], helps: '신입 포트폴리오와 기술면접 준비' },
  frontend:  { firm: 'tech', title: '프론트엔드 엔지니어', field: '1', spec: ['프론트엔드', 'React', '포트폴리오', '기술면접'], tasks: ['디자인 시스템 구축', '웹 성능 개선', '접근성 개선 프로젝트'], helps: '포트폴리오 구조와 기술면접 준비' },
  mobile:    { firm: 'tech', title: '모바일 엔지니어', field: '1', spec: ['모바일', 'Android', 'iOS', '포트폴리오'], tasks: ['앱 리뉴얼 개발', '푸시·알림 인프라 구축'], helps: '앱 포트폴리오와 기술면접 준비' },
  ai:        { firm: 'tech', title: 'AI/ML 엔지니어', field: '1', spec: ['AI/ML', '데이터', '논문리뷰', '기술면접'], tasks: ['추천 모델 개선', '사내 LLM 파이프라인 구축'], helps: '모델링 경험 정리와 연구·개발 직무 선택' },
  analyst:   { firm: 'tech', title: '데이터 분석가', field: '1', spec: ['데이터분석', 'SQL', '지표설계', '직무전환'], tasks: ['지표 체계 정리와 대시보드 구축', 'A/B 테스트 설계'], helps: 'SQL 과제 전형과 분석 포트폴리오' },
  scientist: { firm: 'tech', title: '데이터 사이언티스트', field: '1', spec: ['데이터사이언스', '머신러닝', '통계', '포트폴리오'], tasks: ['이탈 예측 모델 운영', '실험 설계와 인과추론'], helps: '분석 프로젝트를 채용 포트폴리오로 바꾸기' },

  ib:        { firm: 'finance', title: 'IB 애널리스트', field: '0', spec: ['IB', '재무모델링', '금융권 자소서', '인적성'], tasks: ['ECM · 인수합병 자문', '기업가치 평가 모델링'], helps: '금융권 자소서와 재무모델링 과제' },
  bank:      { firm: 'finance', title: '기업금융 담당자', field: '0', spec: ['시중은행', 'NCS 필기', '금융권 자소서', '면접'], tasks: ['중견기업 여신 심사', '기업 고객 자금관리 제안'], helps: '은행 필기와 자소서 준비' },
  am:        { firm: 'finance', title: '자산운용 리서치', field: '0', spec: ['자산운용', '산업분석', '금융권 자소서', 'CFA'], tasks: ['섹터 리서치와 종목 분석', '운용역 보조와 리포트 작성'], helps: '산업분석 리포트 쓰기와 운용사 전형' },
  research:  { firm: 'finance', title: '리서치 애널리스트', field: '0', spec: ['리서치', '산업분석', '보고서작성', '자소서첨삭'], tasks: ['산업 전망 보고서 작성', '거시지표 모니터링'], helps: '리서치 직무 지원 전략과 보고서 첨삭' },

  strategy:  { firm: 'consulting', title: '전략 컨설턴트', field: '0', spec: ['전략컨설팅', '케이스면접', '문제해결', '자소서첨삭'], tasks: ['대기업 신사업 전략 프로젝트', '시장 진입 전략 수립'], helps: '케이스 면접과 문제 정의 프레임' },
  operation: { firm: 'consulting', title: '운영 컨설턴트', field: '0', spec: ['운영컨설팅', '케이스면접', '프로세스개선', '문제해결'], tasks: ['공급망 최적화 프로젝트', '업무 프로세스 진단'], helps: '케이스 면접과 컨설팅 지원 전략' },

  brand:     { firm: 'marketing', title: '브랜드 마케터', field: '0', spec: ['브랜드마케팅', '공모전', '포트폴리오', '자소서첨삭'], tasks: ['신제품 캠페인 기획', '브랜드 리뉴얼 프로젝트'], helps: '마케팅 공모전과 포트폴리오 정리' },
  digital:   { firm: 'marketing', title: '디지털 마케터', field: '0', spec: ['디지털마케팅', 'GA', '퍼포먼스', '포트폴리오'], tasks: ['채널별 캠페인 운영', '전환율 개선 실험'], helps: '광고 실무 경험 없이 지원서 쓰는 법' },
  perf:      { firm: 'marketing', title: '퍼포먼스 마케터', field: '0', spec: ['퍼포먼스마케팅', '데이터', 'GA', '면접'], tasks: ['매체 예산 집행과 성과 분석', 'ROAS 개선 실험'], helps: '숫자로 말하는 마케팅 자소서' },
  content:   { firm: 'marketing', title: '콘텐츠 기획자', field: '0', spec: ['콘텐츠기획', '포트폴리오', '공모전', '자소서첨삭'], tasks: ['자사 채널 콘텐츠 기획', '브랜디드 콘텐츠 제작'], helps: '콘텐츠 포트폴리오 구성' },

  plan:      { firm: 'corp', title: '경영기획 담당자', field: '0', spec: ['경영기획', '인적성', '자소서첨삭', '대기업'], tasks: ['중기 사업계획 수립', '경영 실적 분석'], helps: '대기업 일반직 자소서와 인적성' },
  hr:        { firm: 'corp', title: 'HR 담당자', field: '0', spec: ['인사', '면접', '자소서첨삭', '직무분석'], tasks: ['채용 전형 설계와 운영', '조직문화 진단'], helps: '채용 담당자 눈으로 본 서류 통과 기준' },
  recruit:   { firm: 'corp', title: '채용 담당자', field: '0', spec: ['채용', '면접', '자소서첨삭', '직무분석'], tasks: ['신입 공채 운영', '면접관 교육과 평가표 설계'], helps: '실제 평가표 기준으로 자소서 보기' },
  finance:   { firm: 'corp', title: '재무 담당자', field: '0', spec: ['재무', '회계', '대기업', '자소서첨삭'], tasks: ['자금 계획과 자금 집행', '결산과 재무제표 작성'], helps: '재무·회계 직무 선택과 자격증 순서' },
  cpa:       { firm: 'accounting', title: '회계법인 회계사', field: '0', spec: ['회계법인', 'CPA', '회계', '진로상담'], tasks: ['상장사 외부감사', '재무실사(FDD) 수행'], helps: 'CPA 이후 진로와 법인 선택' },
  tax:       { firm: 'accounting', title: '세무 담당자', field: '0', spec: ['세무', '회계', '자격증', '진로상담'], tasks: ['법인세 신고 대리', '세무조사 대응 지원'], helps: '세무 직무 진입 경로와 자격증' },

  counsel:   { firm: 'care', title: '임상심리사', field: '2', spec: ['임상심리', '수련', '대학원', '진로상담'], tasks: ['심리평가와 보고서 작성', '개인 상담 진행'], helps: '수련 기관 선택과 대학원 진학' },
  paralegal: { firm: 'law', title: '로펌 어시스턴트', field: '2', spec: ['로펌', '법무', '자소서첨삭', '진로상담'], tasks: ['송무 자료 조사와 정리', '계약서 검토 보조'], helps: '로펌 지원과 법무 직무 진입' },
  legaltech: { firm: 'law', title: '리걸테크 기획자', field: '2', spec: ['리걸테크', '서비스기획', '법무', '포트폴리오'], tasks: ['법률 검색 서비스 기획', '계약 자동화 프로덕트 운영'], helps: '법학 전공으로 기획 직무 가기' },

  pd:        { firm: 'media', title: '방송 PD', field: '4', spec: ['방송', 'PD', '포트폴리오', '공모전'], tasks: ['교양 프로그램 연출', '디지털 오리지널 제작'], helps: '연출 포트폴리오와 언론사 전형' },
  editor:    { firm: 'media', title: '콘텐츠 에디터', field: '4', spec: ['에디터', '글쓰기', '포트폴리오', '자소서첨삭'], tasks: ['기획 기사 작성과 편집', '뉴스레터 운영'], helps: '글 포트폴리오 만들기' },
};
/* 스펙에 직무가 안 적힌 멘토용. 이름을 지어내는 대신 분야만 말한다. */
const FALLBACK_COPY = { firm: 'corp', title: '현직자', field: '0', spec: ['진로상담', '자소서첨삭', '면접'], tasks: ['현업 실무'], helps: '진로 선택과 지원 서류' };

const DEPT_LABEL = {
  cs: '컴퓨터공학', business: '경영학', economics: '경제학', accounting: '회계학',
  stat: '통계학', law: '법학', psych: '심리학', media: '미디어학',
};
const CORP_LABEL = { large: '대기업', mid: '중견기업', small: '중소기업', public: '공공기관' };
/* ── 닉네임 ────────────────────────────────────────────────────
   이 저장소의 규칙은 **화면에 닉네임만 내보내고 실명은 내부 데이터로 둔다** 는
   것이다(demo-seed.js 의 DEMO_SEED 주석). 무작위 시드는 그 규칙대로 닉네임을
   만들어 넘기는데, 받는 쪽(`insertSeedUser`)이 `nickname: null` 로 박아 버려서
   **전부 버려진 채** 저장돼 있었다 — 그래서 '내 멘토링'의 신청 카드에 멘토 실명이
   찍혔다(멘토 카드 쪽은 mentoring.js 의 nickOf 가 id 로 하나 지어내 가려 줬다).

   여기서 채운다. 조각 조합이 150개뿐이라 **번호를 붙이고 중복도 막는다** —
   순위표에 같은 닉네임이 두 번 나오면 화면이 고장난 것으로 읽힌다. */
const NICK_HEAD = ['코드', '데이터', '기획', '숫자', '문서', '실험', '설계', '분석', '현장', '기록', '새벽', '주말', '구름', '바다', '노을'];
const NICK_TAIL = ['곰', '여우', '수달', '고래', '부엉이', '너구리', '펭귄', '두더지', '하마', '까치'];

function makeNickname(userId, taken) {
  const rnd = rngFrom(`nick:${userId}`);
  const base = pick(rnd, NICK_HEAD) + pick(rnd, NICK_TAIL);
  for (let i = 0; i < 200; i++) {
    const n = `${base}${rint(rnd, 1, 99)}`;
    if (!taken.has(n)) { taken.add(n); return n; }
  }
  /* 200번을 돌려도 안 비면 조합이 정말로 말랐다는 뜻이다. 그때는 겹치는 닉네임을
     주느니 비워 둔다 — 화면(nickOf)이 id 로 하나 지어내 채운다. */
  return null;
}

const MODE_SETS = [
  ['video30', 'text'], ['video30', 'onsite60'], ['video30'],
  ['video30', 'onsite60', 'text'], ['text', 'video30'], ['onsite60', 'video30'],
];

/* ── 조사 ──────────────────────────────────────────────────────
   '법인 선택를', '대학원 진학를' 처럼 받침을 무시하면 한 문장 안에서 바로 눈에
   띈다. 마지막 한글 음절의 받침으로 고른다. 한글이 아닌 글자로 끝나면(영문 약어
   등) 판단할 수 없으므로 '를' 로 둔다 — 'CFA를' 은 읽히지만 'CFA을' 은 안 읽힌다. */
function hasBatchim(word) {
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}
const eulReul = w => `${w}${hasBatchim(w) ? '을' : '를'}`;
/* '로/으로' 는 받침이 ㄹ 이면 '로' 다 — '기업금융으로' 는 맞지만 '개발로' 는 틀리고
   '개발으로' 도 틀리다('개발로'가 맞다). 받침 인덱스 8 이 ㄹ 이다. */
function jongseong(word) {
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xAC00 || code > 0xD7A3) return -1;
  return (code - 0xAC00) % 28;
}
const ro = w => {
  const j = jongseong(w);
  return `${w}${j <= 0 || j === 8 ? '로' : '으로'}`;
};

/* 소개글 첫 문장 — '어디서 무엇을 하는가'. 회사가 없으면(중소기업은 시드가 회사명을
   비워 둔다) 기업 유형으로 대신한다. 없는 회사 이름을 지어내지 않는다.

   '~에서' 를 붙이는 문형과 안 붙이는 문형을 나눠 둔다. 하나로 뭉뚱그리면
   '중견기업에서 회계사입니다' 처럼 조사가 겉도는 문장이 나온다. */
function introOf(rnd, { company, corpType, job, dept }) {
  const c = JOB_COPY[job] || FALLBACK_COPY;
  const place = company || CORP_LABEL[corpType] || '현업';
  const major = DEPT_LABEL[dept];
  const opens = [
    `${place}에서 ${ro(c.title)} 일하고 있어요.`,
    `${major ? `${major} 전공으로 ` : ''}${place}에서 ${ro(c.title)} 일합니다.`,
    `${place} ${c.title}입니다.`,
  ];
  return `${pick(rnd, opens)} ${eulReul(c.helps)} 같이 봐드립니다.`;
}

/* 경력 타임라인 — user_specs.careers 를 사람이 읽는 줄로 바꾼다.
   careers 가 비어 있으면 타임라인도 비운다. 다닌 적 없는 회사를 만들지 않는다. */
function timelineOf(rnd, spec) {
  const c = JOB_COPY[spec.job] || FALLBACK_COPY;
  const careers = Array.isArray(spec.careers) ? spec.careers : [];
  const rows = careers
    .filter(cr => cr && (cr.company || spec.company))
    .map(cr => ({
      t: `${cr.company || spec.company} ${cr.position || c.title}`,
      d: `${String(cr.start || '').replace('-', '.')} ~ ${cr.current ? '현재' : String(cr.end || '').replace('-', '.')}`,
      s: pick(rnd, c.tasks),
    }));
  if (rows.length) return rows;
  if (!spec.company) return [];
  /* 경력 칸은 비었지만 회사는 있는 경우 — 시작 연도를 모르므로 기간을 '현재' 한
     칸으로만 적는다. 있지도 않은 입사 연월을 만들어 내면 연차 계산과 어긋난다. */
  return [{ t: `${spec.company} ${c.title}`, d: '현재', s: pick(rnd, c.tasks) }];
}

/* 예약 가능 일정. 오늘로부터 며칠 뒤 → 넣는 순간 날짜로. 일요일은 건너뛴다.
   demo-seed.js availabilityIn 과 같은 규칙이다(머리주석 참고). */
function availabilityOf(rnd) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slots = sampleN(rnd, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18], rint(rnd, 3, 6));
  const times = sampleN(rnd, ['10:00', '11:00', '14:00', '15:00', '19:00', '20:00', '21:00'], rint(rnd, 2, 4)).sort();
  const out = new Map();
  for (const off of slots.sort((a, b) => a - b)) {
    const d = new Date(today); d.setDate(d.getDate() + off);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.set(key, { date: key, times: [...times] });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function profileFor(user, spec) {
  const rnd = rngFrom(user.id);
  const c = JOB_COPY[spec.job] || FALLBACK_COPY;
  return {
    currentJob: c.title,
    intro: introOf(rnd, spec),
    specialties: sampleN(rnd, c.spec, rint(rnd, 3, Math.min(4, c.spec.length))),
    timeline: timelineOf(rnd, spec),
    modes: pick(rnd, MODE_SETS),
    availability: availabilityOf(rnd),
    /* 멘토가 직접 고르는 값이라 자기 직무와 꼭 같지는 않다. 대부분은 자기 분야를
       고르고, 일부는 인접 분야(경영·사무)를 같이 연다 — 필터에 폭이 생긴다. */
    mentorFields: c.field !== '0' && rnd() < 0.3 ? [c.field, '0'] : [c.field],
  };
}

/* ── A. 손으로 쓴 데모 멘토 5명 + 멘티 3명 ────────────────────
   /api/admin/seed 와 **같은 규칙**이다: 없으면 만들고, 있으면 빈 칸만 채운다.
   덮어쓰지 않는다 — 데모 계정으로 직접 적어 본 소개글을 지우면 시연 준비가
   통째로 날아간다. */
async function seedFixedAccounts() {
  let added = 0, filled = 0, skipped = 0;
  for (const { u, s, p } of DEMO_SEED) {
    const existing = await repo.users.byUsername(u.username);
    if (!existing) {
      const user = await repo.users.create({
        id: nanoid(), username: u.username, passwordHash: await bcrypt.hash(u.password, 10),
        name: u.name, email: u.email, role: u.role, nickname: u.nickname ?? null,
      });
      if (s) await repo.specs.upsert(user.id, s);
      if (p) await repo.profiles.update(user.id, p);
      added++;
      continue;
    }
    if (!p) { skipped++; continue; }
    const cur = await repo.profiles.get(existing.id);
    if (!FORCE && (cur?.intro || (cur?.specialties || []).length)) { skipped++; continue; }
    await repo.profiles.update(existing.id, p);
    if (s) await repo.specs.upsert(existing.id, s);
    filled++;
  }
  console.log(`  고정 데모 계정 — 새로 ${added}명 · 프로필 보충 ${filled}명 · 그대로 둠 ${skipped}명`);
}

/* ── A-0. 무작위 회원 (--random N) ────────────────────────────
   `POST /api/admin/seed-random` 과 같은 일이다 — 같은 생성기(generateRandom)를
   부르고, 비밀번호 해시도 한 번만 계산해 돌려 쓴다(전부 demo1234! 라 매번
   해싱하면 그것만으로 몇 초가 걸린다).

   여기서 만든 회원은 **스펙만** 있고 프로필은 없다. 그 뒤 B 단계가 프로필을
   채운다 — 그래서 새 DB 도 이 스크립트 한 번으로 멘토 찾기가 채워진다. */
async function seedRandomAccounts() {
  const sharedHash = await bcrypt.hash('demo1234!', 10);
  let added = 0;
  for (const { u, s: spec } of generateRandom(RANDOM)) {
    if (await repo.users.usernameTaken(u.username)) continue;
    if (await repo.users.emailTaken(u.email)) continue;
    const user = await repo.users.create({
      id: nanoid(), username: u.username, passwordHash: sharedHash,
      name: u.name, email: u.email, role: u.role,
      /* 생성기가 만든 닉네임을 그대로 쓴다. server.js 의 insertSeedUser 가
         이 값을 null 로 박아 버리던 것을 2026-09-18 에 같이 고쳤다. */
      nickname: u.nickname ?? null,
    });
    if (spec) await repo.specs.upsert(user.id, spec);
    added++;
  }
  console.log(`  무작위 회원 — 새로 ${added}명`);
}

/* ── 회사명 풀 ─────────────────────────────────────────────────
   **업종 × 기업유형**으로 고른다. demo-seed.js 의 COMPANY_POOL 은 기업유형만 보고
   골라서, 이 값이 화면에 나오자마자 '카카오 IB 애널리스트'·'한국철도공사 임상심리사'
   같은 카드가 나왔다. 후배가 멘토를 고르는 화면이라 회사와 직무가 어긋나면
   데이터 전체를 못 믿게 된다.

   ── 지어낸 이름은 넣지 않는다 ──
   전부 실재하는 기관 이름이다(demo-seed.js 의 '실제 존재하는 이름에서 고른다' 와
   같은 규칙). 없는 칸은 비워 둔다 — 채우려고 회사를 만들어 내지 않는다.
   빈 칸이면 그 사람은 회사 없이 남고, 멘토 카드는 직무만 보여준다. */
const FIRM_POOL = {
  tech: {
    large: ['네이버', '카카오', '삼성전자', 'LG전자', 'SK하이닉스', '쿠팡'],
    mid: ['토스', '당근', '우아한형제들', '야놀자'],
    public: ['한국전력공사', '한국철도공사', '국민건강보험공단'],
  },
  finance: {
    large: ['미래에셋증권', '삼성증권', '한국투자증권', 'KB국민은행', '신한은행'],
    mid: ['교보증권', '유진투자증권'],
    public: ['한국산업은행', 'IBK기업은행', '한국주택금융공사'],
  },
  consulting: {
    large: ['베인앤드컴퍼니', '삼일PwC컨설팅', '딜로이트컨설팅'],
    mid: ['엑센츄어코리아'],
    public: ['한국생산성본부'],
  },
  accounting: {
    large: ['삼일회계법인', '삼정KPMG', '한영회계법인', '안진회계법인'],
    mid: [],
    public: ['한국자산관리공사'],
  },
  marketing: {
    large: ['CJ제일제당', '아모레퍼시픽', 'LG생활건강', '오리온'],
    mid: ['오뚜기', '동원F&B', '휠라코리아', '한국콜마', '코웨이'],
    public: ['한국관광공사'],
  },
  corp: {
    large: ['현대자동차', '포스코', '삼성물산', 'LG전자'],
    mid: ['한샘', '코웨이', '오뚜기'],
    public: ['한국수자원공사', '한국공항공사', '한국전력공사'],
  },
  law: {
    large: ['김앤장 법률사무소', '법무법인 광장', '법무법인 태평양'],
    mid: ['법무법인 지평'],
    public: ['대한법률구조공단'],
  },
  care: {
    large: ['삼성서울병원', '서울아산병원'],
    mid: [],
    public: ['국립정신건강센터', '한국청소년상담복지개발원'],
  },
  media: {
    large: ['CJ ENM', 'SBS', 'MBC'],
    mid: ['스튜디오드래곤', '카카오엔터테인먼트'],
    public: ['한국방송공사(KBS)', '한국교육방송공사(EBS)'],
  },
};

/* ── B-0. 멘토 스펙의 진출분야·회사·경력 ──────────────────────
   무작위 시드(`makeRandomEntry`)는 corp_type 만 남기고 job_major·company·careers 를
   비워 둔 채로 이 DB 에 들어와 있었다(실측: 멘토 128명 중 회사가 적힌 사람 5명).
   그래서 멘토 카드 머리에 '분야 미정'이 뜨고, 회사도 연차도 안 보이고,
   '기업'·'경력' 필터는 눌러도 0명이었다.

   ── job_major 는 화면 두 곳이 서로 다른 값을 본다 ──
   분야 **필터**는 profiles.mentor_fields 를 보고(mentorFieldsOf), 카드 **머리**는
   user_specs.job_major 를 본다(categoryName(m.jobMajor)). 한쪽만 채우면 필터에는
   걸리는데 카드에는 '분야 미정'이라고 적힌다. 둘 다 같은 KECO 코드로 채운다.

   ── 기업 유형(corp_type)은 이미 있는 값이라 지킨다 ──
   대기업으로 저장된 사람에게 중소기업 이름을 붙이면 CAS 의 '선배들이 간 회사'
   집계가 유형과 어긋난다. 중소기업은 회사명을 비워 둔 채로 둔다 — 시드가 그렇게
   정했고(있지도 않은 중소기업 이름을 지어내지 않는다), 그 판단을 뒤집지 않는다. */
async function seedMentorSpecs() {
  const rows = await query(`
    SELECT u.id, s.company, s.corp_type, s.careers, s.job, s.job_major
      FROM users u
      JOIN user_specs s ON s.user_id = u.id
     WHERE u.role = 'mentor'
     ORDER BY u.created_at`);

  let filled = 0, skipped = 0, noCompany = 0;
  for (const r of rows) {
    const c = JOB_COPY[r.job] || FALLBACK_COPY;
    const hasCompany = r.company && String(r.company).trim();
    const hasCareers = (asJson(r.careers) || []).length;
    const hasMajor = r.job_major != null && String(r.job_major) !== '';
    /* 중소기업은 시드가 회사명을 비워 두기로 한 자리이고, 업종×유형 칸이 비어 있는
       경우(회계법인 중견 등)도 마찬가지로 비운다 — 채우려고 지어내지 않는다. */
    const pool = (FIRM_POOL[c.firm] || FIRM_POOL.corp)[r.corp_type] || [];
    /* '이 사람은 다 됐다' 의 기준에 **회사를 넣을 수 없는 사람**을 포함시킨다.
       hasCompany 만 보면 그 23명은 영영 '안 된 사람'이라, 돌릴 때마다 같은 행을
       다시 쓰면서 '채움 23명' 이라고 보고한다 — 두 번째 실행이 0건이어야
       무엇이 바뀌었는지 눈으로 알 수 있다. */
    const companyDone = !pool.length || (hasCompany && hasCareers);
    if (hasMajor && companyDone && !FORCE) { skipped++; continue; }

    const patch = {};
    /* 진출분야는 회사가 없어도 채운다 — 카드 머리의 '분야 미정'을 지우는 값이고,
       회사와 달리 직무만 있으면 정해진다. */
    if (!hasMajor || FORCE) patch.jobMajor = c.field;

    if (pool.length) {
      const rnd = rngFrom(`corp:${r.id}`);
      /* --force 는 '이 스크립트가 만든 값을 다시 만든다' 는 뜻이다. 기존 회사를
         그대로 두면, 업종을 안 보고 골랐던 옛 값(카카오 IB 애널리스트)이 --force
         를 줘도 영영 안 고쳐진다 — 실제로 그렇게 남아 있었다. */
      const company = (hasCompany && !FORCE) ? r.company : pick(rnd, pool);
      /* 입사 연월은 '몇 년 몇 개월 전' 으로 만든다. 연차(careerYears)가 이 값에서
         나오므로, 연도를 박아 두면 해가 바뀔 때마다 전원이 한 살씩 먹는다. */
      const months = rint(rnd, 12, 74);
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - months);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      patch.company = company;
      patch.careers = (hasCareers && !FORCE) ? asJson(r.careers)
        : [{ company, start, current: true, position: c.title }];
    } else {
      noCompany++;
    }

    await repo.specs.upsert(r.id, patch);
    filled++;
  }
  console.log(`  멘토 스펙 — 채움 ${filled}명 · 이미 있음 ${skipped}명 (그중 회사명 없이 둔 사람 ${noCompany}명)`);
}

/* ── B. 나머지 멘토 계정의 프로필 ────────────────────────────── */
async function seedRandomMentorProfiles() {
  const rows = await query(`
    SELECT u.id, u.username, u.name, p.nickname, p.intro, p.specialties,
           s.dept, s.job, s.company, s.corp_type, s.careers
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN user_specs s ON s.user_id = u.id
     WHERE u.role = 'mentor'
     ORDER BY u.created_at`);

  /* 이미 쓰이고 있는 닉네임(손으로 쓴 데모 멘토 5명 포함)을 먼저 담아 둔다. */
  const taken = new Set((await query(
    "SELECT nickname FROM profiles WHERE nickname IS NOT NULL AND nickname <> ''"))
    .map(x => x.nickname));

  let filled = 0, skipped = 0, noSpec = 0, nicks = 0;
  for (const r of rows) {
    const hasProfile = (r.intro && r.intro.trim())
      || (asJson(r.specialties) || []).length;
    if (hasProfile && !FORCE) { skipped++; continue; }
    /* 스펙이 없는 멘토는 건너뛴다. 프로필을 만들 재료가 없어서, 쓰면 전부
       지어낸 값이 된다 — 그럴 바에 목록에 안 나오는 편이 정직하다. */
    if (!r.dept && !r.job && !r.company) { noSpec++; continue; }

    const spec = {
      dept: r.dept, job: r.job, company: r.company, corpType: r.corp_type,
      careers: asJson(r.careers) || [],
    };
    const patch = profileFor({ id: r.id, name: r.name }, spec);
    /* 닉네임은 **덮어쓰지 않는다** — 본인이 정한 이름일 수 있다. --force 도 마찬가지다. */
    if (!r.nickname || !String(r.nickname).trim()) {
      const nick = makeNickname(r.id, taken);
      if (nick) { patch.nickname = nick; nicks++; }
    }
    await repo.profiles.update(r.id, patch);
    filled++;
  }
  console.log(`  멘토 프로필 — 새로 채움 ${filled}명 · 이미 있음 ${skipped}명 · 스펙 없어 건너뜀 ${noSpec}명 (닉네임 ${nicks}명)`);
}

/* ── C. 멘토링 신청 내역 ──────────────────────────────────────
   '내 멘토링'의 **보낸 요청** 탭이 이 행들을 읽는다(GET /api/mentoring/requests
   → syncApplied). pending·paid 만 화면에 남으므로 그 둘만 만든다.

   ── 진행 중·완료·받은 요청 탭은 여기서 못 채운다 ──
   그 세 탭은 서버가 아니라 **브라우저 localStorage**(`careerly_mentoring_v2`)에
   있다. DB 에 무엇을 넣어도 안 나온다 — mentoring.js 가 의도적으로 그렇게 두었다
   ("내 것이 아닌 기록이 '내 멘토링'에 남는 게 실제 데이터처럼 보였다").

   ── 금액과 슬롯은 규칙을 지킨다 ──
   금액은 라우트의 FORMATS 값 그대로다(화면 값을 믿지 않는다는 규칙과 같은 값을
   쓴다). 날짜·시간은 **그 멘토가 실제로 연 일정 중에서만** 고른다 — 멘토가 연
   적 없는 시간에 신청이 박혀 있으면 상세 화면과 어긋난다. */
const FORMATS = [
  { id: 'video30', name: '화상 30분', amount: 20000 },
  { id: 'onsite60', name: '대면 60분', amount: 45000 },
  { id: 'text', name: '텍스트', amount: 12000 },
];
const MESSAGES = [
  '안녕하세요! 비전공이라 포트폴리오를 어떻게 잡아야 할지 막막해서 여쭙고 싶습니다.',
  '하반기 공채 자소서를 쓰고 있는데 지원동기 쪽이 계속 막혀서 한 번 봐주셨으면 합니다.',
  '직무를 두 개 놓고 고민 중이라 현업에서 실제로 어떤 일을 하시는지 듣고 싶어요.',
  '서류에서 계속 떨어지는데 어디가 문제인지 스스로는 모르겠어서 신청드립니다.',
  '면접까지는 가는데 마지막에 떨어져서, 어떤 답변이 약했는지 짚어주시면 좋겠습니다.',
];

async function seedRequests() {
  /* 신청을 보낼 멘티. 고정 데모 계정 셋을 쓴다 — 시연할 때 로그인해야 하므로
     비밀번호를 아는 계정이어야 한다(demo1234!). */
  const mentees = [];
  for (const username of ['mentee_a', 'mentee_b', 'mentee_c']) {
    const u = await repo.users.byUsername(username);
    if (u) mentees.push(u);
  }
  if (!mentees.length) {
    console.log('  멘토링 신청 — 데모 멘티 계정이 없어 건너뜁니다 (--profiles 먼저 돌리세요)');
    return;
  }

  /* 신청은 **목록에 실제로 뜨는 멘토에게만** 간다. 라우트가 그렇게 검증하므로
     (repo.mentors.byUsername), 같은 함수가 내보내는 목록에서 고른다. */
  const mentors = await repo.mentors.list();
  const bookable = mentors.filter(m => m.availability.length && m.modes.length);
  if (!bookable.length) {
    console.log('  멘토링 신청 — 예약 가능 일정이 있는 멘토가 없어 건너뜁니다');
    return;
  }

  let added = 0, kept = 0;
  for (const [mi, mentee] of mentees.entries()) {
    const rnd = rngFrom(`req:${mentee.id}`);
    const n = rint(rnd, 2, 3);
    /* 멘티마다 다른 멘토를 보게 어긋나게 고른다 — 셋이 같은 멘토만 고르면
       화면이 한 사람으로 도배된다. */
    const picked = sampleN(rnd, bookable, Math.min(n, bookable.length));

    for (const mentor of picked) {
      if (mentor.id === mentee.username) continue;
      const existing = await queryOne(
        'SELECT id FROM mentoring_requests WHERE mentee_id=? AND mentor_id=?',
        [mentee.id, mentor.id]);
      if (existing && !FORCE) { kept++; continue; }

      /* 형식은 그 멘토가 실제로 연 것 중에서 고른다. 안 여는 형식으로 신청이
         들어가면 상세 화면의 가격표와 어긋난다. */
      const f = pick(rnd, FORMATS.filter(x => mentor.modes.includes(x.id))) || FORMATS[0];
      const slot = pick(rnd, mentor.availability);
      const time = pick(rnd, slot.times);
      /* pending 과 paid 를 섞는다 — 결제 전/후 카드가 다르게 그려지는 것을
         한 화면에서 볼 수 있어야 한다. */
      const status = rnd() < 0.5 ? 'paid' : 'pending';
      const message = pick(rnd, MESSAGES);

      if (existing) {
        await query(
          `UPDATE mentoring_requests
              SET mentor_name=?, format=?, format_name=?, amount=?, message=?,
                  slot_date=?, slot_time=?, status=?
            WHERE id=?`,
          [mentor.nickname || mentor.name, f.id, f.name, f.amount, message,
            slot.date, time, status, existing.id]);
      } else {
        await query(
          `INSERT INTO mentoring_requests
             (id, mentee_id, mentor_id, mentor_name, format, format_name, amount,
              message, slot_date, slot_time, status, order_id, payment)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [nanoid(), mentee.id, mentor.id, mentor.nickname || mentor.name,
            f.id, f.name, f.amount, message, slot.date, time, status,
            /* 결제된 건에만 주문번호를 남긴다. 결제 응답(payment)은 비운다 —
               토스 승인 응답을 흉내 내면 영수증 링크가 죽은 채로 화면에 뜬다. */
            status === 'paid' ? `demo_${nanoid(12)}_${mi}` : null, null]);
      }
      added++;
    }
  }
  console.log(`  멘토링 신청 — 새로/갱신 ${added}건 · 이미 있음 ${kept}건`);
}

async function main() {
  await assertConnection();
  console.log('데모 데이터를 넣습니다' + (FORCE ? ' (--force: 다시 만듭니다)' : '') + '\n');

  if (RANDOM) await seedRandomAccounts();
  if (ONLY === 'all' || ONLY === 'profiles') {
    await seedFixedAccounts();
    /* 회사·경력을 먼저 채운다 — 프로필의 타임라인이 그 값을 읽어 만들어진다.
       순서를 바꾸면 타임라인이 빈 채로 굳는다(실측: 128명 중 123명이 빈 타임라인). */
    await seedMentorSpecs();
    await seedRandomMentorProfiles();
  }
  if (ONLY === 'all' || ONLY === 'requests') {
    await seedRequests();
  }

  const shown = (await repo.mentors.list()).length;
  const reqs = await queryOne('SELECT COUNT(*) AS n FROM mentoring_requests');
  console.log(`\n멘토 찾기에 뜨는 멘토 ${shown}명 · 멘토링 신청 ${reqs.n}건`);
  console.log('로그인: demo_kim / mentee_a / mentee_b / mentee_c  (비밀번호 demo1234!)');
}

main()
  .catch(e => { console.error('실패:', e.message); process.exitCode = 1; })
  .finally(async () => { try { await pool().end(); } catch { /* 이미 닫혔으면 그만 */ } });
