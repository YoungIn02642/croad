-- careerly MySQL 스키마
--
-- ── 설계 원칙 ──
-- 통계를 내는 데 쓰는 것은 테이블로 쪼갠다(JOIN·GROUP BY 로 집계해야 하므로),
-- 화면에서 통째로 읽고 쓰기만 하는 것은 JSON 컬럼에 둔다.
-- 전부 정규화하면 테이블이 15개를 넘고 저장 한 번에 트랜잭션이 길어진다.
-- 반대로 전부 JSON 이면 '자격증별 보유율' 같은 집계를 SQL 로 못 짠다.
--
-- ── 문자셋 ──
-- utf8mb4 가 아니면 이모지(🗂️·✂️)가 저장되지 않는다. careerly 는 분류 라벨에
-- 이모지를 쓰므로 utf8mb3 로 만들면 저장 시점에 깨진다.

SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════
--  회원
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR(32)  PRIMARY KEY,
  username       VARCHAR(64)  NOT NULL UNIQUE,
  -- 소셜 가입은 비밀번호가 없다. NULL 을 허용해야 하고, 로그인 쪽에서 걸러낸다.
  password_hash  VARCHAR(255) NULL,
  name           VARCHAR(64)  NOT NULL,
  -- 이메일은 카카오에서 선택 동의라 안 올 수 있다. UNIQUE 는 유지하되 NULL 허용
  -- (MySQL 은 NULL 을 중복으로 보지 않아 여러 건이 공존한다).
  email          VARCHAR(190) NULL UNIQUE,
  -- 소셜 가입 직후에는 역할이 없다. 추가입력 화면에서 채운다.
  role           ENUM('mentor','mentee') NULL,
  nickname       VARCHAR(32)  NULL,
  provider       VARCHAR(16)  NULL,          -- 'naver' | 'kakao' | NULL(일반 가입)
  provider_id    VARCHAR(64)  NULL,
  -- 본인확인 CI. 같은 사람이면 가입 경로(일반·네이버·카카오)가 달라도 같은 값이다.
  -- **'한 사람 = 한 계정' 을 실제로 강제하는 곳은 아래 uk_ci 하나다.** 앱에서만
  -- 검사하면 동시에 들어온 두 요청이 둘 다 통과한다.
  ci             VARCHAR(88)  NULL,
  phone          VARCHAR(20)  NULL,
  verified_at    DATETIME     NULL,
  -- 백오피스 접근 권한. 역할(role)과는 다른 축이다 — 관리자도 멘토이거나 멘티일 수 있고,
  -- role 에 'admin' 을 더하면 스펙·통계 화면이 전부 예외 처리를 해야 한다.
  -- 최초 관리자는 ADMIN_USERNAMES 환경변수로 지정한다(server.js 부팅 시 반영).
  is_admin       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 멘토⇄멘티 전환 신청. 가입 10일 후부터 신청할 수 있고, 신청 후 7일 뒤 실제로 바뀐다
  -- (server.js requestRoleChange 주석). 세 값은 항상 같이 채워지고 같이 비워진다 —
  -- 신청이 없으면 셋 다 NULL 이다.
  pending_role             ENUM('mentor','mentee') NULL,
  role_change_requested_at DATETIME NULL,
  role_change_effective_at DATETIME NULL,
  -- 소셜 로그인은 (제공자, 제공자 계정) 으로 회원을 찾는다. 매 로그인마다 조회된다.
  UNIQUE KEY uk_provider (provider, provider_id),
  -- 기존 회원 1,508명은 ci 가 NULL 이다. MySQL 은 NULL 을 중복으로 보지 않아
  -- 공존한다 — 옛 계정에 인증을 소급 강제하면 로그인이 통째로 막힌다.
  UNIQUE KEY uk_ci (ci),
  KEY idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  user_id        VARCHAR(32)  PRIMARY KEY,
  nickname       VARCHAR(32)  NULL,
  university     VARCHAR(128) NULL,
  current_job    VARCHAR(128) NULL,
  tips           TEXT         NULL,
  -- 계정 관리(마이페이지). 이름·이메일은 users 에 있으므로 여기 두지 않는다 —
  -- 두 곳에 두면 어느 쪽이 맞는지 알 수 없게 된다.
  -- avatar 는 브라우저에서 256px 로 줄인 data:image/... base64 다. 파일 서버가 없고,
  -- 디스크에 두면 Railway 재배포 때 사라져서 DB 에 넣는다.
  avatar         MEDIUMTEXT   NULL,
  gender         VARCHAR(16)  NULL,   -- male | female | other | (빈 값 = 안 밝힘)
  birthdate      DATE         NULL,
  -- 연락처. users.phone(본인인증으로 확인된 번호)과 **다른 값이다** —
  -- 인증은 신원 확인용이고 이건 연락받을 번호라 바꿀 수 있어야 한다.
  -- 비어 있으면 화면이 users.phone 을 기본값으로 채워 준다.
  phone          VARCHAR(20)  NULL,
  address        VARCHAR(255) NULL,
  -- 멘토 프로필. 멘티는 쓰지 않는다(스펙 입력만 한다).
  intro          TEXT         NULL,   -- 소개글
  specialties    JSON         NULL,   -- 전문 분야 ["백엔드", "이직"]
  timeline       JSON         NULL,   -- 경력 타임라인 [{t 제목, d 기간, s 세부}]
  modes          JSON         NULL,   -- 멘토링 가능 형식 ["화상", "채팅"]
  -- 멘토가 직접 정한 '멘토링 가능 분야'. 멘티가 멘토를 고를 때 이 목록에서 고른다.
  -- KECO 1차 코드 배열이다(예: ["0","1"]) — 멘토 자신의 진출분야(user_specs.job_major)와
  -- 별개다. 안 정한 멘토는 목록에서 '전체' 로만 잡힌다.
  mentor_fields  JSON         NULL,   -- 멘토가 정한 멘토링 가능 분야 (KECO 1차 코드 배열)
  -- 멘토가 직접 고른 예약 가능 일정.
  --   [{ "date": "2026-08-10", "times": ["10:00", "14:00"] }, ...]
  -- 요일 반복이 아니라 **날짜를 콕 집는 방식**이다. 멘토는 매주 같은 시간이 비지 않고
  -- (출장·야근), 반복으로 받으면 "이번 주만 안 됨"을 표현할 수가 없다.
  -- 지난 날짜는 화면이 걸러 보여준다 — 지우지는 않는다(언제 열어뒀는지 기록으로 남는다).
  availability   JSON         NULL,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token       VARCHAR(64) PRIMARY KEY,
  user_id     VARCHAR(32) NOT NULL,
  created_at  BIGINT      NOT NULL,
  expires_at  BIGINT      NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- 만료 세션 정리와 '이 회원의 기존 세션 제거'가 매 로그인마다 돈다
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
--  스펙 — 통계의 원천
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_specs (
  user_id     VARCHAR(32)  PRIMARY KEY,
  -- dept 는 집계를 묶는 키다. 화면에 보이는 학과명(major)은 자유 입력이라 따로 둔다.
  dept        VARCHAR(32)  NULL,
  major       VARCHAR(128) NULL,
  -- field/job 은 옛 하드코딩 분류('finance'·'backend' 등)다. 새로 입력하지 않지만
  -- **지우면 안 된다** — wage-jobs.js 의 legacy 매핑이 이 값으로 옛 스펙 1,188건을
  -- 커리어 로드맵에 연결한다. 지우는 순간 그 집계가 조용히 0 이 된다.
  field       VARCHAR(32)  NULL,
  job         VARCHAR(32)  NULL,
  -- 새 직무 분류 — 커리어 로드맵과 같은 한국고용직업분류(KECO) 코드를 그대로 쓴다.
  -- 1차는 하나, 2차(세부직무)는 여러 개 고를 수 있다.
  job_major   VARCHAR(8)   NULL,   -- KECO 1차 코드 (예: '0')
  job_middles JSON         NULL,   -- KECO 2차 코드 배열 (예: ["02","03"])
  -- 직무찾기 3단계(개별 직업)까지 고른 값. 집계는 2차 분류 단위라 여기 값은
  -- '내 선택' 저장·표시용이다(예: ["0212001","0212002"]).
  job_codes   JSON         NULL,   -- KECO 개별 직업 코드 배열
  company     VARCHAR(190) NULL,
  corp_type   VARCHAR(16)  NULL,
  gpa         DECIMAL(4,2) NULL,
  gpa_max     DECIMAL(4,2) NULL,
  -- 어학 점수는 시험 종류가 늘어날 때마다 컬럼을 추가하게 된다(TEPS·G-TELP·제2외국어를
  -- 실제로 그렇게 늘렸다). 통계는 '평균'만 내면 되므로 JSON 으로 두고 앱에서 계산한다.
  scores      JSON         NULL,
  -- 옛 스펙 호환 필드. 새로 쓰이지 않지만 기존 데이터를 버리지 않는다.
  qual        JSON         NULL,
  detail      JSON         NULL,
  -- 직접 입력한 자격증의 발급기관·취득일 { 이름: {issuer, date} }
  cert_meta   JSON         NULL,
  interest_companies JSON  NULL,   -- 멘티: 관심 기업 이름 배열
  careers     JSON         NULL,   -- 멘토: 경력 [{company,start,end,...}]
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_specs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- 커리어 로드맵이 dept/field/job 조합으로 집계한다(옛 스펙 경로)
  KEY idx_specs_dept (dept, field, job),
  KEY idx_specs_job_major (job_major),
  KEY idx_specs_corp (corp_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 자격증·활동은 **보유율 집계**에 쓰인다. JSON 에 두면 '이 학과에서 정보처리기사를
-- 가진 비율' 을 SQL 로 못 짠다. 그래서 이 둘만 테이블로 쪼갠다.
CREATE TABLE IF NOT EXISTS spec_certs (
  user_id   VARCHAR(32)  NOT NULL,
  cert_name VARCHAR(190) NOT NULL,
  PRIMARY KEY (user_id, cert_name),
  CONSTRAINT fk_spec_certs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_spec_certs_name (cert_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spec_activities (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(32)  NOT NULL,
  type         VARCHAR(32)  NOT NULL,     -- CAS.ACTIVITY_TYPES 의 id
  name         VARCHAR(190) NULL,
  org          VARCHAR(190) NULL,         -- 주최기관 (인턴십이면 회사)
  duration     VARCHAR(32)  NULL,
  role         VARCHAR(64)  NULL,
  stage        VARCHAR(32)  NULL,         -- 연구 단계 (research 전용)
  outcome      VARCHAR(64)  NULL,
  company_tier VARCHAR(16)  NULL,         -- 인턴십 기업규모 배수용
  company_name VARCHAR(190) NULL,
  -- 활동 내용을 STAR(상황·과제·행동·결과)로 적은 것. { s, t, a, r } 문자열 4개.
  star         JSON         NULL,
  CONSTRAINT fk_spec_acts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_spec_acts_user (user_id),
  KEY idx_spec_acts_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
--  멘토링 · 결제
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mentoring_requests (
  id           VARCHAR(32)  PRIMARY KEY,
  mentee_id    VARCHAR(32)  NOT NULL,
  mentor_id    VARCHAR(64)  NOT NULL,     -- 아직 시드 멘토라 users 를 참조하지 않는다
  mentor_name  VARCHAR(64)  NULL,
  format       VARCHAR(32)  NOT NULL,
  format_name  VARCHAR(64)  NULL,
  -- 금액은 서버가 정한 값이다. 결제 승인 때 이 값과 대조하므로 절대 화면 값을 넣지 않는다.
  amount       INT          NOT NULL,
  message      TEXT         NULL,
  -- 멘토가 연 일정(profiles.availability) 중 멘티가 고른 한 칸.
  -- 시간은 'HH:MM' 문자열이다 — DATETIME 하나로 합치면 시간대(UTC 변환) 때문에
  -- 저장할 때와 보여줄 때가 하루씩 밀린다.
  slot_date    DATE         NULL,
  slot_time    VARCHAR(5)   NULL,
  status       ENUM('pending','paid','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
  order_id     VARCHAR(128) NULL UNIQUE,  -- 결제 시도마다 새로 발급. 승인 때 이걸로 되찾는다
  payment      JSON         NULL,         -- 승인 응답(paymentKey·method·영수증 등)
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mreq_mentee FOREIGN KEY (mentee_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_mreq_mentee (mentee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
--  카탈로그 — 검색 대상
--  파일(JSON)에서 DB 로 옮긴다. LIKE 검색과 페이징을 SQL 로 처리하기 위해서다.
--  수집 스크립트(fetch-*.js)가 채운다.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS certs (
  name       VARCHAR(190) PRIMARY KEY,
  code       VARCHAR(32)  NULL,
  kind       VARCHAR(32)  NULL,           -- national-tech | national-pro | private
  kind_label VARCHAR(32)  NULL,
  grade      VARCHAR(16)  NULL,
  field      VARCHAR(64)  NULL,           -- 대직무분야
  mid_field  VARCHAR(64)  NULL,
  -- LIKE '검색어%' 는 이 인덱스를 탄다. '%검색어%' 는 못 타지만 643건이라 무방하다.
  KEY idx_certs_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS majors (
  name VARCHAR(128) PRIMARY KEY,
  -- careerly 집계 분류. NULL 이면 아직 통계를 내지 않는 계열이다.
  dept VARCHAR(32) NULL,
  KEY idx_majors_dept (dept)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 학교 자동완성용. 학과(majors)와 같은 구조다 — 이름이 곧 저장되는 값이라 PK.
CREATE TABLE IF NOT EXISTS universities (
  name   VARCHAR(128) PRIMARY KEY,
  gubun  VARCHAR(32)  NULL,          -- 전문대학 | 대학(4년제)
  region VARCHAR(64)  NULL,
  est    VARCHAR(32)  NULL,          -- 국립 | 사립 | 공립
  KEY idx_univ_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  -- 정규화명(공백·법인격 제거, 대문자)을 키로 쓴다. 같은 회사의 표기 흔들림을 합친다.
  norm_name  VARCHAR(190) PRIMARY KEY,
  name       VARCHAR(190) NOT NULL,       -- 화면에 보여줄 이름
  corp_type  VARCHAR(16)  NULL,           -- large | mid | small | public
  source     VARCHAR(190) NULL,
  KEY idx_companies_name (name),
  KEY idx_companies_norm (norm_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 직업 분류(KECO)는 3단계 트리다. 화면이 트리를 통째로 받아 쓰므로 계층을 유지한다.
CREATE TABLE IF NOT EXISTS job_majors (
  code  VARCHAR(8)   PRIMARY KEY,
  no    TINYINT      NOT NULL,            -- 화면 번호(1~10). 공식 코드와 다르다
  name  VARCHAR(128) NOT NULL,
  emoji VARCHAR(16)  NULL,
  descr VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_middles (
  code       VARCHAR(8)   PRIMARY KEY,
  major_code VARCHAR(8)   NOT NULL,
  name       VARCHAR(128) NOT NULL,
  majors     JSON         NULL,           -- 관련 전공 (화면 표시용)
  legacy     JSON         NULL,           -- 옛 스펙 매칭 조건 {dept, field}
  CONSTRAINT fk_jmid_major FOREIGN KEY (major_code) REFERENCES job_majors(code) ON DELETE CASCADE,
  KEY idx_jmid_major (major_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  code        VARCHAR(16)  PRIMARY KEY,
  middle_code VARCHAR(8)   NOT NULL,
  name        VARCHAR(190) NOT NULL,
  avg_wage    INT          NULL,          -- 만원. 0/없음은 NULL(자료 없음과 0원을 구분)
  outlook     VARCHAR(32)  NULL,          -- 화면에는 안 쓰지만 원본을 버리지 않는다
  summary     TEXT         NULL,
  CONSTRAINT fk_jobs_middle FOREIGN KEY (middle_code) REFERENCES job_middles(code) ON DELETE CASCADE,
  KEY idx_jobs_middle (middle_code),
  KEY idx_jobs_wage (avg_wage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
--  커리어 인사이트 — 정보를 주고받는 커뮤니티 게시판
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS insight_posts (
  id          VARCHAR(32)  PRIMARY KEY,
  user_id     VARCHAR(32)  NOT NULL,
  -- 카테고리는 코드에 고정 목록으로 둔다(frontend/js/insight.js CATEGORIES 가 단일 출처).
  -- ENUM 으로 박아 두면 카테고리 하나 늘릴 때마다 ALTER 가 필요해 VARCHAR 로 둔다.
  category    VARCHAR(16)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL,
  view_count  INT          NOT NULL DEFAULT 0,
  -- 공지글. 관리자만 올릴 수 있고 목록 맨 위에 고정된다.
  -- 카테고리와 별개다 — 운영방침은 '자유'에서도 '질문'에서도 보여야 한다.
  is_notice   BOOLEAN      NOT NULL DEFAULT FALSE,
  -- 'AI 프롬프트' 카테고리 글이 같이 싣는 **프롬프트 원문**. 본문(body)은 설명이고
  -- 이건 자소서 코치의 '내 AI 프롬프트'에 그대로 담기는 규칙이라 칸을 가른다
  -- (섞으면 담아 갔을 때 감상문이 AI 규칙의 한 줄이 된다 — insight-prompt.js).
  -- 다른 카테고리에서는 NULL 이다.
  prompt_text TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 글쓴이가 탈퇴하면 글도 같이 지운다. 남의 글만 남고 작성자가 사라지면
  -- '탈퇴한 회원' 처리를 화면마다 따로 해야 한다 — 다른 사용자 소유 데이터
  -- (스펙·멘토링 신청)와 같은 원칙이다.
  CONSTRAINT fk_ipost_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_ipost_category (category, created_at),
  KEY idx_ipost_user (user_id),
  -- 목록은 항상 '공지 먼저, 최신순'으로 읽는다
  KEY idx_ipost_notice (is_notice, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 프롬프트를 '내 프롬프트로 담아 간' 기록. 담아 간 수를 세는 데만 쓴다.
-- 왜 카운터 컬럼(+1)이 아니라 표인가 — 같은 사람이 여러 번 눌러도 한 번으로 세야
-- 목록의 숫자가 '몇 사람이 가져갔나'를 뜻한다. 컬럼 하나면 눌린 횟수일 뿐이다.
CREATE TABLE IF NOT EXISTS insight_prompt_copies (
  post_id     VARCHAR(32)  NOT NULL,
  user_id     VARCHAR(32)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_ipcopy_post FOREIGN KEY (post_id) REFERENCES insight_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ipcopy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 프롬프트 글을 '나중에 보려고 저장' 한 기록 (2026-09-07, 사용자 지시).
-- 담기(insight_prompt_copies)와 무엇이 다른가 — 담기는 **지금 쓰겠다**는 뜻이라
-- 누르면 그 규칙이 내 자소서 초안에 바로 적용된다. 북마크는 **아직 안 쓴다**는 뜻이다.
-- 둘을 한 숫자로 합치면 '몇 사람이 실제로 쓰는가'를 알 수 없게 된다.
CREATE TABLE IF NOT EXISTS insight_bookmarks (
  post_id     VARCHAR(32)  NOT NULL,
  user_id     VARCHAR(32)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_ibm_post FOREIGN KEY (post_id) REFERENCES insight_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ibm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 프롬프트 평점 (1~5). 한 사람이 한 번만 매기고, 다시 매기면 덮어쓴다.
-- PRIMARY KEY 가 (post_id, user_id) 라 그 규칙이 표 자체로 지켜진다.
CREATE TABLE IF NOT EXISTS insight_ratings (
  post_id     VARCHAR(32)  NOT NULL,
  user_id     VARCHAR(32)  NOT NULL,
  score       TINYINT      NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_irate_post FOREIGN KEY (post_id) REFERENCES insight_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_irate_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS insight_comments (
  id          VARCHAR(32)  PRIMARY KEY,
  post_id     VARCHAR(32)  NOT NULL,
  user_id     VARCHAR(32)  NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_icmt_post FOREIGN KEY (post_id) REFERENCES insight_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_icmt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_icmt_post (post_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
--  자소서 기증 (동의 기반 합격 코퍼스 · A 참조군)
--  합격한 사용자가 **본인 자소서를 직접, 동의 아래** 기증한다(남의 글을 긁지 않는다).
--  저장 전에 개인정보를 규칙으로 익명화한다(frontend/js/anonymize.js) — 여기 들어오는
--  본문은 이미 익명화된 것이다. 문장 복붙이 아니라 **직무·문항유형별 통계 참조군**으로만 쓴다.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cover_donations (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  -- 기증자. 탈퇴해도 코퍼스는 남되(익명이므로), 연결만 끊는다(SET NULL).
  user_id       VARCHAR(32)  NULL,
  job_field     VARCHAR(64)  NOT NULL,     -- 직무(대분류) — 통계 묶음 키
  question_type VARCHAR(32)  NOT NULL,     -- 문항유형(motive/competency/collab/challenge/growth)
  result        VARCHAR(16)  NOT NULL DEFAULT 'pass',
  -- 익명화된 STAR 본문 { s, t, a, r }. 원문(개인정보 포함)은 저장하지 않는다.
  star          JSON         NOT NULL,
  char_count    INT          NOT NULL DEFAULT 0,
  -- 결과(R)에 수치가 있는지 — "이 직무 합격 답의 N%는 R에 수치가 있다" 통계용.
  has_number_result TINYINT(1) NOT NULL DEFAULT 0,
  -- 무엇을 몇 개 가렸는지 [{type,count}] — 투명성(사용자·감사용).
  masked        JSON         NULL,
  -- 저장은 동의했을 때만 일어나므로 사실상 1이지만, 근거를 남긴다.
  consent       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cover_don_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_cover_don_job (job_field),
  KEY idx_cover_don_qtype (question_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
