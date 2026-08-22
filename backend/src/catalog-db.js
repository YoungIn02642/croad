/* 카탈로그 조회 — DB 에서 읽는다.

   ── 왜 파일 모듈과 나눠 두는가 ──
   cert-catalog.js·major-catalog.js·company-classify.js·wage-jobs.js 는 여전히
   **수집·이관용**이다(fetch-*.js 가 만든 JSON 을 읽어 migrate-to-mysql.js 가 DB 로
   넣는다). 그 모듈이 DB 를 읽게 만들면 "DB 를 채우려고 DB 를 읽는" 순환이 된다.
   그래서 서빙은 이 파일이 맡는다.

   ── LIKE 검색 ──
   '검색어%'(접두사)는 인덱스를 타고 '%검색어%'(포함)는 못 탄다. 둘 다 필요하므로
   한 문장에서 포함으로 찾고 접두사를 위로 올린다. 카탈로그가 수천~수만 건이라
   이 정도면 충분하고, 더 커지면 전문검색(FULLTEXT)으로 바꿀 자리다.

   ── 사용자 입력의 % 와 _ 는 반드시 이스케이프한다 ──
   LIKE 에서 그 둘은 와일드카드다. '100%' 로 검색하면 '100' 으로 시작하는 게 아니라
   **모든 행**이 걸린다. 이스케이프를 빼먹으면 검색이 조용히 이상해진다. */
const { query, queryOne } = require('./mysql');
const { normalize, CORP_TYPE_ID, DEFAULT_TYPE } = require('./company-classify');
const { RULES } = require('./major-catalog');
/* 시행기관 매핑표. 자격 이름·구분만 보고 정해지는 값이라 DB 컬럼을 늘리지 않았다 —
   컬럼으로 두면 표를 고칠 때마다 배포 DB 에 이관을 돌려야 한다. */
const certReco = require('./cert-reco');

/* LIKE 특수문자 무력화. 백슬래시도 함께 막아야 '\%' 같은 입력이 새지 않는다. */
const esc = s => String(s || '').replace(/[\\%_]/g, c => '\\' + c);

/* 접두사 우선 정렬 — '삼성' 을 쳤을 때 '삼성전자' 가 '제일모직삼성' 보다 먼저 와야 한다.
   같은 순위 안에서는 짧은 이름을 올린다(모회사가 계열사보다 짧다). */
const RANK = 'ORDER BY (`name` LIKE ?) DESC, CHAR_LENGTH(`name`), `name`';
const limitOf = n => Math.min(Math.max(parseInt(n, 10) || 8, 1), 50);

// ── 자격증 ──────────────────────────────────────────────────
async function searchCerts(q, limit = 8) {
  const s = String(q || '').trim();
  if (!s) return [];
  const e = esc(s);
  const rows = await query(
    `SELECT name, kind, kind_label, field FROM certs
     WHERE name LIKE ? ESCAPE '\\\\' ${RANK} LIMIT ${limitOf(limit)}`,
    [`%${e}%`, `${e}%`]);
  return rows.map(r => ({
    name: r.name,
    sub: [r.kind_label, r.field].filter(Boolean).join(' · '),
    /* 시행기관. 큐넷 API 원본에는 이 필드가 아예 없어서 예전에는 늘 빈칸이었고,
       학생이 자격을 고를 때마다 직접 찾아 적어야 했다. 지금은 cert-reco.js 의
       매핑표가 **아는 것만** 채운다(모르면 null 이고 화면은 빈칸을 내준다).
       기관명을 지어내지 않는다는 규칙은 그대로다 — 표에 없으면 안 채운다. */
    issuer: certReco.issuerOf({ id: r.name, kind: r.kind }),
  }));
}

/* 화면이 전체 목록을 받아 갈 때(자격증 카탈로그 API). */
async function certCatalog() {
  const rows = await query(
    'SELECT name, code, kind, kind_label, field, mid_field, grade FROM certs ORDER BY name');
  return {
    count: rows.length,
    certs: rows.map(r => ({
      id: r.name, code: r.code, kind: r.kind, kindLabel: r.kind_label,
      grade: r.grade, field: r.field, midField: r.mid_field,
    })),
  };
}

// ── 학과 ────────────────────────────────────────────────────
async function searchMajors(q, limit = 8) {
  const s = String(q || '').trim();
  if (!s) return [];
  const e = esc(s);
  const rows = await query(
    `SELECT name, dept FROM majors
     WHERE name LIKE ? ESCAPE '\\\\' ${RANK} LIMIT ${limitOf(limit)}`,
    [`%${e}%`, `${e}%`]);
  return rows.map(r => ({ name: r.name, dept: r.dept }));
}

/* 화면이 전체 목록을 받아 갈 때. 193개라 통째로 줘도 부담이 없다. */
async function majorCatalog() {
  const rows = await query('SELECT name, dept FROM majors ORDER BY name');
  return { count: rows.length, majors: rows.map(r => ({ name: r.name, dept: r.dept })) };
}

// ── 학교 ────────────────────────────────────────────────────
/* 학과 검색과 같은 규약이다 — { items } 를 주고 화면이 드롭다운에 그린다.
   목록에 없는 학교도 직접 입력할 수 있으므로 못 찾는 것은 실패가 아니다. */
async function searchUniversities(q, limit = 8) {
  const s = String(q || '').trim();
  if (!s) return [];
  const e = esc(s);
  const rows = await query(
    `SELECT name, gubun, region FROM universities
     WHERE name LIKE ? ESCAPE '\\\\' ${RANK} LIMIT ${limitOf(limit)}`,
    [`%${e}%`, `${e}%`]);
  /* sub 는 드롭다운 오른쪽에 흐리게 붙는 설명이다. 같은 이름의 분교·캠퍼스를
     가릴 수 있게 지역을 함께 보여준다. */
  return rows.map(r => ({
    name: r.name,
    sub: [r.gubun, r.region].filter(Boolean).join(' · ') || '',
  }));
}

/* 학과명 → 통계 분류. 목록에 있으면 그 값을, 없으면 키워드 규칙으로 정한다.
   규칙은 데이터가 아니라 판단이라 코드(major-catalog.RULES)에 남겨 두고 여기서 쓴다. */
async function deptOfMajor(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  const row = await queryOne('SELECT dept FROM majors WHERE name=?', [s]);
  if (row) return row.dept;
  for (const [re, dept] of RULES) if (re.test(s)) return dept;
  return null;
}

// ── 기업 ────────────────────────────────────────────────────
/* 공정위 명단이 법인 등기명이라 대기업집단이 한글 음차로만 올라와 있다
   ('SK하이닉스' 가 아니라 '에스케이하이닉스'). 학생은 알파벳으로 치므로
   음차로도 한 번 더 찾는다. (company-classify 의 같은 표를 옮겨 왔다.) */
const QUERY_ALIASES = {
  SK: '에스케이', LG: '엘지', KT: '케이티', GS: '지에스', CJ: '씨제이',
  KB: '케이비', LS: '엘에스', HD: '에이치디', BGF: '비지에프', DL: '디엘',
  DB: '디비', OCI: '오씨아이', HMM: '에이치엠엠', KCC: '케이씨씨', NH: '엔에이치',
};

async function suggestCompanies(q, limit = 8) {
  const norm = normalize(q);
  if (!norm) return [];

  /* 정규화명으로 찾는다 — 사용자가 '에스케이 하이닉스' 라고 띄어 써도 걸리게. */
  const keys = [norm];
  for (const [abbr, kor] of Object.entries(QUERY_ALIASES)) {
    if (norm.startsWith(abbr)) keys.push(kor + norm.slice(abbr.length));
  }

  const where = keys.map(() => "norm_name LIKE ? ESCAPE '\\\\'").join(' OR ');
  const params = keys.map(k => `%${esc(k)}%`);
  const rows = await query(
    `SELECT name, corp_type, source FROM companies
     WHERE ${where}
     ORDER BY (norm_name LIKE ?) DESC, CHAR_LENGTH(name), name
     LIMIT ${limitOf(limit)}`,
    [...params, `${esc(keys[0])}%`]);

  return rows.map(r => ({ name: r.name, corpType: r.corp_type, source: r.source }));
}

/* 회사명 → 기업 규모. 정규화명이 곧 기본키라 정확히 한 번 조회한다.
   어떤 입력에도 예외를 던지지 않는다 — 분류 실패가 스펙 저장을 막으면 안 된다. */
async function classifyCompany(name) {
  try {
    const key = normalize(name);
    if (!key) return { type: DEFAULT_TYPE, source: '기본값(빈 회사명)', matched: false };
    const row = await queryOne('SELECT corp_type, source FROM companies WHERE norm_name=?', [key]);
    if (!row) return { type: DEFAULT_TYPE, source: '기본값(미등록)', matched: false };
    /* 저장은 우리 분류 id(large/mid/…)로 되어 있고, 호출부는 CORP_TYPE 라벨을 기대한다. */
    const type = Object.keys(CORP_TYPE_ID).find(k => CORP_TYPE_ID[k] === row.corp_type) || DEFAULT_TYPE;
    return { type, source: row.source, matched: true };
  } catch (e) {
    console.error('기업분류 실패:', name, e.message);
    return { type: DEFAULT_TYPE, source: '기본값(오류)', matched: false };
  }
}

async function companyStats() {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM companies');
  return { cached: Number(n), sources: ['MySQL companies 테이블'] };
}

// ── 직업 분류 (커리어 로드맵) ───────────────────────────────
/* 트리 전체를 화면이 한 번에 받아 간다. 분류는 거의 바뀌지 않으므로 한 번 만들어
   메모리에 둔다 — 매 요청마다 500행을 조립할 이유가 없다.
   수집 스크립트를 다시 돌렸다면 서버를 재시작하면 된다. */
let _jobTree = null;

async function jobCatalog() {
  if (_jobTree) return _jobTree;

  const [majors, middles, jobs] = await Promise.all([
    query('SELECT * FROM job_majors ORDER BY no'),
    query('SELECT * FROM job_middles ORDER BY code'),
    query('SELECT * FROM jobs ORDER BY name'),
  ]);
  if (!majors.length) return { empty: true, counts: { majors: 0, middles: 0, jobs: 0 }, majors: [] };

  const asJson = v => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

  const jobsByMid = new Map();
  jobs.forEach(j => {
    if (!jobsByMid.has(j.middle_code)) jobsByMid.set(j.middle_code, []);
    jobsByMid.get(j.middle_code).push({
      code: j.code, name: j.name,
      avgWage: j.avg_wage == null ? null : Number(j.avg_wage),
      outlook: j.outlook, summary: j.summary,
    });
  });

  const midsByMajor = new Map();
  middles.forEach(m => {
    if (!midsByMajor.has(m.major_code)) midsByMajor.set(m.major_code, []);
    const list = jobsByMid.get(m.code) || [];
    midsByMajor.get(m.major_code).push({
      code: m.code, name: m.name,
      majors: asJson(m.majors) || [],
      ...(asJson(m.legacy) ? { legacy: asJson(m.legacy) } : {}),
      wageRange: wageRange(list),
      jobs: list,
    });
  });

  /* ── 분류를 거르지 않고 그대로 내보낸다 (2026-08-11, 사용자 결정) ──
     한동안 job-filter.js 로 '대학생 취업 선택지가 아닌' 분류를 빼고 내보냈다
     (10·35·461 → 7·19·282). 임원·청소·단순생산·농림어업 같은 칸이다.
     되돌린 이유는 그 판단이 careerly 가 대신할 일이 아니어서다 — 임금직업정보시스템이
     공식 분류로 주는 목록을 우리가 줄이면, 특성화고 출신·전과 준비생처럼 그 칸을
     실제로 고르는 사람이 **자기 직업이 목록에 없는** 화면을 보게 된다.

     거르는 판단은 job-filter.js 에 그대로 남겨 뒀다(지우지 않았다) — 다시 켜려면
     이 아래 객체를 jobFilter.filterTree(…) 로 감싸면 된다. 그 파일이 무엇을 왜
     뺐는지가 되살릴 때 필요한 기록이다.

     **여기 한 곳이 로드맵과 스펙 입력을 동시에 정한다.** 화면만 늘리고 저장 검증
     (server.js 의 jobMajor·jobMiddles 확인)이 예전 목록을 보면, 학생이 고를 수는
     있는데 저장은 400 으로 떨어진다. */
  _jobTree = {
    empty: false,
    counts: { majors: majors.length, middles: middles.length, jobs: jobs.length },
    wageUnit: '만원',
    majors: majors.map(M => ({
      code: M.code, no: M.no, name: M.name, emoji: M.emoji, desc: M.descr,
      middles: midsByMajor.get(M.code) || [],
    })),
  };
  return _jobTree;
}

/* 2차 분류 안의 임금 분포. 평균 하나만 주면 편차가 큰 갈래를 대표하지 못한다. */
function wageRange(list) {
  const w = list.map(j => j.avgWage).filter(n => typeof n === 'number' && n > 0);
  if (!w.length) return null;
  return {
    min: Math.min(...w), max: Math.max(...w),
    avg: Math.round(w.reduce((a, b) => a + b, 0) / w.length), n: w.length,
  };
}

module.exports = {
  searchCerts, certCatalog,
  searchMajors, majorCatalog, deptOfMajor,
  searchUniversities,
  suggestCompanies, classifyCompany, companyStats,
  jobCatalog,
};
