// ════════════════════════════════════════════════════════════
//  CAREERLY — 직업 소분류 묶기 + 직업별 예시 벤치마크
//
//  ── 왜 있나 ──
//  KECO 2차 분류 하나에 직업이 37개까지 들어간다(경영·행정·사무직). 이름만
//  연봉순으로 깔면 회계사 옆에 속기사가 서고, 학생은 "이 중 내가 갈 만한 갈래가
//  어디냐"를 못 고른다. 비슷한 직업끼리 묶어 그룹으로 먼저 좁히게 한다.
//
//  ── 직업을 이름으로 맞추는 이유 ──
//  직업 코드(K000007549)로 묶으면 임금 데이터를 다시 수집할 때 코드가 바뀌면
//  조용히 매칭이 깨진다(그룹이 통째로 빈다). **정규화한 이름**으로 맞추면
//  표기가 조금 달라져도(중점·괄호·공백·쉼표) 계속 붙는다.
//  이름은 backend/data/wage-jobs.json 의 표기를 그대로 쓴다.
//
//  ── bench 는 실측이 아니라 예시다 ──
//  선배 스펙 집계(aggregation.js)는 **2차 분류 단위**다. 직업 461개로 쪼개면
//  표본이 한 자릿수가 되어 평균이 의미를 잃기 때문이다. 그래서 '직업별' 평균은
//  지금 구조에서 나오지 않는다.
//  여기 bench 는 그 자리를 채우는 **시연용 예시 수치**이고, 화면에서 이 값을 쓸 때는
//  반드시 '예시' 라벨을 붙인다(career.js compareCard). 실측이 있으면 실측이 이긴다.
//
//    gpa       4.5 만점 환산 학점
//    toeic     TOEIC 점수
//    cert      자격증 개수
//    external  대외활동 횟수 (인턴십·교외 공모전·프로젝트)
//    internal  대내활동 횟수 (동아리·학회·연구·교내 비교과)
//    volunteer 봉사활동 횟수 (봉사·서포터즈·기자단)
//
//  external·internal·cert·gpa·toeic 은 옛 프로토타입에서 그대로 옮겼고,
//  volunteer 는 그 프로토타입에 없던 축이라 그룹 성격에 맞춰 새로 정했다
//  (수험 위주인 전문 자격사는 낮게, 응대·홍보 계열은 높게).
//
//  ── 다른 2차 분류에 그룹을 추가하려면 ──
//  GROUPS 에 '<1차코드>:<2차코드>' 키로 배열을 하나 더 넣으면 된다. 정의가 없는
//  분류는 지금까지처럼 연봉순 목록 그대로 나온다(career.js 가 알아서 갈라진다).
// ════════════════════════════════════════════════════════════
window.JobGroups = (() => {
  /* 키는 '<1차 분류 코드>:<2차 분류 코드>'. '0:02' = 경영·사무·금융·보험직 › 경영·행정·사무직 */
  const GROUPS = {
    '0:02': [
    {
      no: 1, id: 'g1', name: '전문 자격사', sub: '회계·세무·평가·노무',
      desc: '국가전문자격을 기반으로 독립 개업이 가능한 직업군입니다. 합격 자체가 핵심 스펙이라 학점·자격 비중이 매우 높습니다.',
      road: ['1차 시험 과목(회계·세법·법학) 기초 정리', '수험 사이클 1회전 + 모의고사 성적 관리', '합격 후 수습기관(법인) 지원 준비'],
      skills: ['회계원리·세법', '법률 문서 독해', '수리·계산 정확도', '장기 수험 관리'],
      jobs: [
        { name: '회계사', bench: { gpa: 4.05, toeic: 860, cert: 2.4, external: 1.4, internal: 1.6, volunteer: 0.6 } },
        { name: '세무사', bench: { gpa: 3.9, toeic: 780, cert: 2.2, external: 1.2, internal: 1.5, volunteer: 0.6 } },
        { name: '관세사', bench: { gpa: 3.85, toeic: 830, cert: 2.3, external: 1.2, internal: 1.6, volunteer: 0.6 } },
        { name: '감정평가사', bench: { gpa: 3.8, toeic: 760, cert: 2, external: 1.1, internal: 1.4, volunteer: 0.6 } },
        { name: '노무사', bench: { gpa: 3.82, toeic: 770, cert: 2.1, external: 1.3, internal: 1.8, volunteer: 0.6 } },
        { name: '행정사', bench: { gpa: 3.6, toeic: 700, cert: 1.8, external: 1, internal: 1.6, volunteer: 0.6 } },
      ],
    },

    {
      no: 2, id: 'g2', name: '경영·정책 분석 전문가', sub: '진단·조사·HR·상품기획',
      desc: '조직·시장·정책을 분석해 전략을 설계하는 직업군입니다. 데이터 해석력과 리서치 결과물이 평가의 중심입니다.',
      road: ['산업 리서치 노트와 통계 분석 도구 익히기', '공모전·학회에서 분석 리포트 1편 완성', '컨설팅/기획 인턴으로 실무 사례 확보'],
      skills: ['시장·데이터 분석', '가설 수립과 검증', '보고서 스토리라인', 'Excel·SQL·통계'],
      jobs: [
        { name: '경영 및 진단 전문가', bench: { gpa: 3.95, toeic: 870, cert: 1.8, external: 3.4, internal: 3.2, volunteer: 1 } },
        { name: '정부·공공행정전문가', bench: { gpa: 3.9, toeic: 820, cert: 1.6, external: 2.8, internal: 3, volunteer: 1 } },
        { name: '조사전문가', bench: { gpa: 3.8, toeic: 800, cert: 1.5, external: 3.2, internal: 2.8, volunteer: 1 } },
        { name: '인적자원전문가', bench: { gpa: 3.75, toeic: 810, cert: 2, external: 2.4, internal: 2.9, volunteer: 1 } },
        { name: '상품 기획 전문가', bench: { gpa: 3.7, toeic: 790, cert: 1.4, external: 3.6, internal: 3.4, volunteer: 1 } },
      ],
    },

    {
      no: 3, id: 'g3', name: '회계·경리 사무원', sub: '자금·전표·결산',
      desc: '돈의 흐름을 기록하고 검증하는 사무직입니다. 전산회계·재경 관련 자격증 보유 여부가 채용을 크게 좌우합니다.',
      road: ['전산회계 2급 → 1급 순서로 자격 취득', 'ERP(더존·SAP) 실습으로 실무 감각 확보', '중소·중견기업 경리 인턴으로 결산 경험'],
      skills: ['전산회계·ERP', 'Excel 함수·피벗', '증빙·전표 처리', '세금계산서 실무'],
      jobs: [
        { name: '회계사무원', bench: { gpa: 3.55, toeic: 690, cert: 2.6, external: 1.2, internal: 1.8, volunteer: 0.7 } },
        { name: '경리사무원', bench: { gpa: 3.45, toeic: 640, cert: 2.4, external: 1, internal: 1.6, volunteer: 0.7 } },
        { name: '감사사무원', bench: { gpa: 3.7, toeic: 730, cert: 2.5, external: 1.4, internal: 2, volunteer: 0.7 } },
      ],
    },

    {
      no: 4, id: 'g4', name: '기획·인사·총무 사무원', sub: '조직 내부 운영·관리',
      desc: '회사 내부의 사람과 자원을 굴리는 사무직입니다. 문서 작성력과 조직 운영 경험이 강점이 됩니다.',
      road: ['기획서·품의서 등 실무 문서 양식 익히기', '조직 운영 경험(학생회·동아리 임원) 만들기', '인턴에서 채용·평가·복리후생 프로세스 경험'],
      skills: ['문서·기획서 작성', '노동법 기초', '커뮤니케이션·조율', 'Excel·협업툴'],
      jobs: [
        { name: '경영 기획 사무원', bench: { gpa: 3.85, toeic: 820, cert: 1.6, external: 2.8, internal: 3, volunteer: 1.1 } },
        { name: '인사·교육·훈련사무원', bench: { gpa: 3.7, toeic: 780, cert: 1.9, external: 2, internal: 2.8, volunteer: 1.1 } },
        { name: '총무사무원', bench: { gpa: 3.55, toeic: 720, cert: 1.7, external: 1.4, internal: 2.2, volunteer: 1.1 } },
        { name: '영업기획·관리·지원사무원', bench: { gpa: 3.6, toeic: 750, cert: 1.5, external: 2, internal: 2.6, volunteer: 1.1 } },
      ],
    },

    {
      no: 5, id: 'g5', name: '광고·홍보·행사 기획', sub: '대외 커뮤니케이션',
      desc: '메시지와 이벤트로 브랜드를 알리는 직업군입니다. 학점보다 포트폴리오·공모전 수상 실적의 비중이 큽니다.',
      road: ['서포터즈·기자단으로 콘텐츠 결과물 쌓기', '광고 공모전 출품 및 수상 이력 만들기', '캠페인 성과를 지표로 정리한 포트폴리오 완성'],
      skills: ['카피라이팅', '콘텐츠 기획', '성과 지표 분석', '디자인 툴 기초'],
      jobs: [
        { name: '광고 및 홍보 전문가', bench: { gpa: 3.6, toeic: 800, cert: 1.2, external: 4.6, internal: 4.2, volunteer: 1.6 } },
        { name: '광고·홍보·마케팅사무원', bench: { gpa: 3.5, toeic: 760, cert: 1.3, external: 3.8, internal: 3.8, volunteer: 1.6 } },
        { name: '행사·전시 및 회의 기획자', bench: { gpa: 3.45, toeic: 740, cert: 1.4, external: 3.4, internal: 4, volunteer: 1.6 } },
      ],
    },

    {
      no: 6, id: 'g6', name: '무역·물류 사무원', sub: '수출입·자재 관리',
      desc: '재화의 국내외 이동을 관리하는 사무직입니다. 어학 점수와 무역/물류 자격증이 가장 확실한 가산점입니다.',
      road: ['무역영어·국제무역사·물류관리사 중 1개 취득', '어학 점수(TOEIC/OPIc) 목표치까지 끌어올리기', '포워더·제조사 수출입팀 인턴 경험'],
      skills: ['무역 실무(인코텀즈·L/C)', '영어 이메일·회화', 'ERP·재고 관리', 'Excel 데이터 처리'],
      jobs: [
        { name: '무역 사무원', bench: { gpa: 3.55, toeic: 860, cert: 2, external: 1.6, internal: 2.4, volunteer: 0.8 } },
        { name: '자재관리 사무원(물류사무원)', bench: { gpa: 3.4, toeic: 720, cert: 1.9, external: 1.3, internal: 1.9, volunteer: 0.8 } },
      ],
    },

    {
      no: 7, id: 'g7', name: '운송 사무원', sub: '항공·해운·도로·철도',
      desc: '운송수단의 운항·운행을 지원하는 사무직입니다. 교대 근무 적응력과 어학, 관련 기관 인턴 경험이 중요합니다.',
      road: ['운송·항공 관련 전공 지식 및 자격 확인', '공항·항만·철도 공사 인턴 지원', 'NCS 및 직무 면접 대비'],
      skills: ['운항·운송 규정 이해', '영어 커뮤니케이션', '돌발 상황 대응', '전산 예약·운영 시스템'],
      jobs: [
        { name: '수상 및 항공운송 사무원', bench: { gpa: 3.6, toeic: 830, cert: 1.6, external: 1.4, internal: 2.4, volunteer: 0.7 } },
        { name: '도로 및 철도운송 사무원', bench: { gpa: 3.5, toeic: 720, cert: 1.8, external: 1.2, internal: 2, volunteer: 0.7 } },
      ],
    },

    {
      no: 8, id: 'g8', name: '생산·품질관리 사무원', sub: '제조 현장 관리',
      desc: '생산 일정과 품질 기준을 관리하는 사무직입니다. 품질경영기사 등 기술 자격과 통계 도구 활용 능력이 핵심입니다.',
      road: ['품질경영기사·산업안전기사 등 기사 자격 취득', 'Minitab·SPC 등 통계 품질 도구 학습', '제조 기업 생산관리 인턴으로 현장 경험'],
      skills: ['품질경영(6시그마)', '생산 계획·재고 관리', '통계 분석 툴', '현장 커뮤니케이션'],
      jobs: [
        { name: '생산 및 품질관리 사무원', bench: { gpa: 3.65, toeic: 720, cert: 2.3, external: 2.2, internal: 2, volunteer: 0.8 } },
      ],
    },

    {
      no: 9, id: 'g9', name: '행정 공무원', sub: '공공부문 행정',
      desc: '법령에 따라 공공 행정업무를 수행하는 직업군입니다. 학점·어학보다 공채 시험 점수와 준비 기간이 결정적입니다.',
      road: ['직렬 선택 및 필수 과목 기본서 1회독', '기출 5개년 반복 + 모의고사 성적 관리', '면접 대비 및 관련 기관 봉사·인턴 경험'],
      skills: ['행정법·행정학', '국어·영어·한국사', '공문서 작성', '민원 응대'],
      jobs: [
        { name: '일반행정공무원(조세, 관세, 병무 제외)', bench: { gpa: 3.6, toeic: 700, cert: 1.2, external: 1, internal: 2.2, volunteer: 1.3 } },
        { name: '조세행정사무원', bench: { gpa: 3.65, toeic: 720, cert: 1.8, external: 1, internal: 1.8, volunteer: 1.3 } },
        { name: '관세 행정 사무원', bench: { gpa: 3.65, toeic: 780, cert: 1.9, external: 1, internal: 1.8, volunteer: 1.3 } },
        { name: '병무행정사무원', bench: { gpa: 3.55, toeic: 690, cert: 1.1, external: 0.9, internal: 1.9, volunteer: 1.3 } },
      ],
    },

    {
      no: 10, id: 'g10', name: '고객응대·지원 사무원', sub: '상담·안내·비서',
      desc: '사람을 직접 응대하거나 특정인을 보좌하는 사무직입니다. 학점·어학 문턱은 낮은 편이고 응대 경험과 태도가 평가의 중심입니다.',
      road: ['서비스·상담 아르바이트로 응대 경험 쌓기', 'CS리더스관리사·비서 자격 등 실무 자격 취득', '롤플레이 면접(상황 대응) 집중 준비'],
      skills: ['경청·공감 화법', '불만 응대(컴플레인) 처리', '전산 상담 시스템', '일정·문서 관리'],
      jobs: [
        { name: '고객상담원', bench: { gpa: 3.3, toeic: 620, cert: 1.2, external: 0.8, internal: 2, volunteer: 1.4 } },
        { name: '안내·접수원', bench: { gpa: 3.25, toeic: 600, cert: 1, external: 0.7, internal: 1.8, volunteer: 1.4 } },
        { name: '의료코디네이터', bench: { gpa: 3.35, toeic: 610, cert: 1.6, external: 0.9, internal: 1.9, volunteer: 1.4 } },
        { name: '비서', bench: { gpa: 3.5, toeic: 720, cert: 1.7, external: 1, internal: 2.2, volunteer: 1.4 } },
      ],
    },

    {
      no: 11, id: 'g11', name: '문서·기록 사무원', sub: '편집·입력·속기',
      desc: '정보를 기록하고 가공하는 사무직입니다. 타자·문서작성 속도와 정확도 자격이 곧바로 채용 요건이 됩니다.',
      road: ['컴퓨터활용능력·워드프로세서 자격 취득', '속기/타자 속도 목표치까지 훈련', '편집·교정 아르바이트로 결과물 축적'],
      skills: ['문서 편집·교정', '한글·MS Office', '타자·속기 속도', '맞춤법·표기 규정'],
      jobs: [
        { name: '속기사', bench: { gpa: 3.35, toeic: 600, cert: 2.2, external: 0.8, internal: 1.4, volunteer: 0.9 } },
        { name: '출판·자료편집사무원', bench: { gpa: 3.45, toeic: 680, cert: 1.4, external: 1.6, internal: 2, volunteer: 0.9 } },
        { name: '전산자료입력원 및 사무보조원', bench: { gpa: 3.2, toeic: 560, cert: 1.5, external: 0.6, internal: 1.4, volunteer: 0.9 } },
      ],
    },    ],
  };

  /* 표기 흔들림을 흡수한다 — '수상 및 항공운송 사무원' 과 '수상및항공운송사무원',
     '일반행정공무원(조세, 관세, 병무 제외)' 과 '…(조세·관세·병무 제외)' 를 같게 본다. */
  const norm = s => String(s ?? '').replace(/[\s·ㆍ,()（）]/g, '').toLowerCase();

  const keyOf = (majorCode, middleCode) => `${majorCode}:${middleCode}`;

  /* 이 2차 분류에 그룹 정의가 있나. 없으면 null 을 돌려주고, 화면은 예전대로 간다. */
  function forMiddle(majorCode, middleCode) {
    return GROUPS[keyOf(majorCode, middleCode)] || null;
  }

  /* 직업 하나가 속한 그룹. 정의에 없는 직업(데이터가 새로 추가된 경우)은 null 이다 —
     화면에서 '미분류' 로 따로 모아 보여준다. 조용히 빠뜨리면 목록에서 사라진다. */
  function groupOfJob(majorCode, middleCode, jobName) {
    const groups = forMiddle(majorCode, middleCode);
    if (!groups) return null;
    const k = norm(jobName);
    return groups.find(g => g.jobs.some(j => norm(j.name) === k)) || null;
  }

  /* 그 직업의 예시 벤치마크. 없으면 null — 호출부가 '예시도 없음' 을 구분할 수 있어야 한다. */
  function benchOf(majorCode, middleCode, jobName) {
    const g = groupOfJob(majorCode, middleCode, jobName);
    if (!g) return null;
    const k = norm(jobName);
    return g.jobs.find(j => norm(j.name) === k)?.bench || null;
  }

  return { forMiddle, groupOfJob, benchOf, norm };
})();
