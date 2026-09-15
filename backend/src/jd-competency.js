/* ══════════════════════════════════════════════════════════════
   직무기술서(JD) → 요구역량 → "자소서에 이렇게 녹여라" 가이드

   ── 왜 이렇게 만들었나 (중요) ──
   요구는 "AI가 문장으로 적어주는 것"이었지만, 자소서 문장 자체를 로컬 8B 에게
   쓰게 하면 안 된다. 이유가 셋이다:
     1) 지금까지 AI 를 쓴 곳(CAS 스펙 분석)은 전부 "짧은 JSON 추출"이라 서버에서
        enum 교정·재채점으로 틀린 것을 걸러낼 수 있었다. 산문 생성은 검증 수단이 없다.
     2) 실측(CAS-작업정리 6-2)에서 8B 는 줄글 파싱조차 놓쳤다. 생성 품질은 그보다 낮다.
     3) CPU 추론에서 출력 토큰이 곧 대기시간이다. 분류는 num_predict 512 로 끝나지만
        역량 6개 × 문장 가이드는 그 열 배라 3~5분이 된다.

   그래서 역할을 갈랐다 — AI 는 JD 에서 **역량을 뽑는 일(짧은 JSON)** 만 하고,
   "이렇게 적어라" 문장은 아래 ARCHETYPES 의 검증된 문구를 조립해 만든다.
   cas.js 의 rescore 와 같은 원칙이다: 모델에겐 분류만, 결과물은 코드가 만든다.

   또 하나 — 완성된 자소서 문장을 뱉지 않는다. 대필이 되고, 표절·AI 검출에
   그대로 걸린다. 우리가 주는 건 **작성 지침**(무엇을 어떤 순서로 쓸지)이다.
   ══════════════════════════════════════════════════════════════ */

/* 역량 원형(archetype) 사전.
   NCS 공식 데이터에는 직무별 역량 서술이 없다(ncs-taxonomy.json 은 분류 이름뿐).
   그래서 채용공고에서 반복적으로 등장하는 역량을 원형으로 묶어 직접 정리했다.

   각 항목의 뜻:
     keywords : JD 원문에서 이 역량을 찾아내는 표현들(규칙 추출용)
     reads    : 기업이 이 역량으로 무엇을 보려 하는지 (자소서 방향의 근거)
     frame    : 자소서에 녹이는 문장 골격 — 완성문이 아니라 순서·구성 지침
     openers  : 첫 문장을 여는 방식 예시 (그대로 베끼지 말라는 전제)
     evidence : 이 역량의 근거로 쓰기 좋은 CAS 활동 유형(cas.js ACTIVITY_TYPES id)
     numbers  : 반드시 숫자로 바꿔 써야 하는 것들 — 자소서에서 가장 자주 비어 있는 칸
     avoid    : 이 역량에서 특히 흔한 감점 표현
     followup : 이렇게 썼을 때 면접에서 들어올 질문(써 놓고 대비가 안 되면 못 쓴 것과 같다) */
const ARCHETYPES = [
  {
    id: 'problem-solving',
    label: '문제해결력',
    keywords: ['문제해결', '문제 해결', '문제를 해결', '문제 정의', '문제를 정의', '이슈', '트러블',
               '장애 대응', '원인 분석', '개선', '최적화', '병목', '리스크 관리'],
    reads: '답이 정해지지 않은 상황에서 원인을 좁혀가는 순서를 갖고 있는지를 봅니다. 결과보다 과정의 논리를 읽습니다.',
    frame: '① 문제를 한 문장으로 정의 → ② 원인 후보를 어떻게 좁혔는지(무엇을 확인해 무엇을 배제했는지) → ③ 선택한 해결책과 그것을 고른 이유 → ④ 숫자로 확인된 변화 → ⑤ 지금 다시 하면 무엇을 다르게 할지',
    openers: ['문제 상황을 수치로 먼저 제시하고 시작', '내가 세운 가설과 그것이 틀렸던 지점부터 제시'],
    evidence: ['project', 'internship', 'competition', 'research'],
    numbers: ['개선 전/후 수치', '소요 기간', '영향 범위(인원·건수·비용)'],
    avoid: ['"열심히 노력해서 해결했습니다" — 과정이 없으면 문제해결력이 아니라 성실성 서술입니다', '원인 분석 없이 해결책만 적는 구성'],
    followup: '그 원인이 아닐 가능성은 어떻게 배제했나요?',
  },
  {
    id: 'data-analysis',
    label: '데이터 분석력',
    keywords: ['데이터', '분석', 'sql', '지표', 'kpi', '통계', '시각화', '대시보드', '엑셀', '파이썬', '리포트', '인사이트'],
    reads: '숫자를 다룰 수 있는지가 아니라, 숫자에서 의사결정을 끌어낸 적이 있는지를 봅니다.',
    frame: '① 어떤 판단이 필요했는지(질문) → ② 어떤 데이터를 어디서 얼마나 모았는지 → ③ 어떻게 다뤘는지(도구는 한 번만 언급) → ④ 발견한 사실 → ⑤ 그 발견으로 무엇이 바뀌었는지',
    openers: ['답을 알아내야 했던 질문 한 줄로 시작', '통념과 달랐던 발견을 먼저 제시'],
    evidence: ['project', 'internship', 'research', 'competition'],
    numbers: ['데이터 규모(행·기간·표본)', '발견한 차이의 크기(%)', '의사결정에 반영된 결과'],
    avoid: ['도구 나열("파이썬, SQL, 태블로를 활용해") — 도구는 역량이 아니라 수단입니다', '분석만 하고 그래서 무엇이 바뀌었는지가 없는 구성'],
    followup: '그 데이터로 그 결론을 내리기에 표본이 충분했다고 보나요?',
  },
  {
    id: 'collaboration',
    label: '협업·팀워크',
    keywords: ['협업', '팀워크', '커뮤니케이션', '유관부서', '이해관계자', '조율', '소통', '크로스펑셔널', '팀 단위'],
    reads: '사이 좋게 지냈는지가 아니라, 의견이 갈렸을 때 어떻게 합의를 만들었는지를 봅니다.',
    frame: '① 팀 구성과 내 역할(몇 명 중 무엇을 맡았는지) → ② 실제로 부딪힌 지점 → ③ 내가 한 구체적 행동(중재·역할 재분배·기준 제시 등) → ④ 합의된 결론 → ⑤ 팀 성과',
    openers: ['갈등 상황을 한 문장으로 제시하고 시작', '내가 맡은 역할의 경계를 먼저 밝히고 시작'],
    evidence: ['project', 'club', 'extracurricular', 'internship', 'competition'],
    numbers: ['팀 규모', '조율에 걸린 기간', '팀 산출물의 결과'],
    avoid: ['"팀원들과 소통하며 원만하게" — 아무 정보가 없는 문장입니다', '갈등을 "제가 양보했습니다"로 끝내는 구성(합의가 아니라 회피로 읽힙니다)'],
    followup: '그때 상대방 입장에서는 무엇이 불만이었다고 생각하나요?',
  },
  {
    id: 'ownership',
    label: '주도성·오너십',
    keywords: ['주도', '주도적', '오너십', '자율', '책임감', '리드', '스스로', '적극', '제안'],
    reads: '지시받지 않은 일을 한 적이 있는지, 그리고 그것을 끝까지 책임졌는지를 봅니다.',
    frame: '① 아무도 시키지 않았던 상황 → ② 내가 그것을 문제로 인식한 계기 → ③ 설득해야 했던 대상과 설득 방법 → ④ 끝까지 맡은 범위 → ⑤ 남은 결과(내가 떠난 뒤에도 남았는지)',
    openers: ['"당시 그 일은 담당자가 없었습니다" 류의 공백 제시로 시작'],
    evidence: ['internship', 'project', 'club', 'extracurricular'],
    numbers: ['혼자 판단한 범위', '설득한 인원', '지속된 기간'],
    avoid: ['직급·권한이 있어서 한 일을 주도성으로 쓰는 것(회장이라 했다면 주도성 근거가 약합니다)', '제안만 하고 실행이 없는 구성'],
    followup: '그 제안이 거절당했다면 어떻게 했을 것 같나요?',
  },
  {
    id: 'learning',
    label: '학습 민첩성',
    keywords: ['학습', '빠르게 습득', '새로운 기술', '트렌드', '자기개발', '성장', '적응', '변화 대응'],
    reads: '무엇을 배웠는지가 아니라, 모르는 것을 만났을 때의 접근 순서를 봅니다.',
    frame: '① 마감이 있는 상황에서 몰랐던 것 → ② 학습 경로를 어떻게 정했는지(무엇을 먼저 버렸는지 포함) → ③ 며칠/몇 주 만에 어디까지 → ④ 실제로 만들어낸 결과물 → ⑤ 그 뒤로 유지하는 학습 습관',
    openers: ['기한과 모르는 범위를 함께 제시하며 시작'],
    evidence: ['project', 'internship', 'research', 'competition'],
    numbers: ['학습에 쓴 기간', '결과물의 규모', '전후 숙련도의 객관적 지표(자격증·성능 등)'],
    avoid: ['"새로운 것을 배우는 데 두려움이 없습니다" — 근거 없는 자기평가입니다', '강의 수강 이력만 나열하는 구성'],
    followup: '그 기간에 일부러 공부하지 않고 넘긴 부분은 무엇이었나요?',
  },
  {
    id: 'customer',
    label: '고객지향',
    keywords: ['고객', '사용자', 'ux', 'cs', '니즈', '만족도', '유저', '클라이언트', '민원', '현장'],
    reads: '고객을 생각했다는 태도가 아니라, 고객에게 직접 확인한 절차가 있는지를 봅니다.',
    frame: '① 내가 짐작했던 고객의 요구 → ② 직접 확인한 방법(인터뷰·설문·현장·데이터, 몇 명) → ③ 짐작과 달랐던 지점 → ④ 그에 맞춰 바꾼 것 → ⑤ 고객 반응의 변화(수치)',
    openers: ['"처음 세운 가정이 틀렸습니다"로 시작해 확인 절차로 넘어가기'],
    evidence: ['extracurricular', 'internship', 'project', 'competition', 'volunteer'],
    numbers: ['접촉한 고객 수', '만족도·재방문·전환율 변화', '반영된 요구사항 건수'],
    avoid: ['"고객의 입장에서 생각했습니다" — 확인 절차가 없으면 짐작입니다', '설문 결과를 숫자 없이 "긍정적이었다"로 적는 구성'],
    followup: '그 인원의 의견을 전체 고객의 의견으로 봐도 됐다고 생각하나요?',
  },
  {
    id: 'planning',
    label: '기획력',
    /* '사업'·'설계' 는 단독으로는 너무 넓다("사업 데이터 분석"이 기획으로 잡힌다) → 결합형만 쓴다. */
    keywords: ['기획', '전략', '로드맵', '사업계획', '사업 계획', '제안서', '보고서 작성', '아이디어', '컨셉'],
    reads: '아이디어의 참신함보다, 그 기획을 왜 그렇게 했는지의 근거와 우선순위 판단을 봅니다.',
    frame: '① 배경 상황과 제약(예산·기간·인원) → ② 후보안 여러 개와 각각의 장단점 → ③ 무엇을 기준으로 하나를 골랐는지 → ④ 실행한 결과 → ⑤ 검증된 것과 검증되지 않은 것',
    openers: ['제약 조건을 먼저 못 박고 시작(제약이 없으면 기획이 아니라 상상입니다)'],
    evidence: ['competition', 'project', 'internship', 'extracurricular'],
    numbers: ['예산·기간·인원', '후보안 개수', '실행 결과 지표'],
    avoid: ['버려진 후보안을 안 적는 구성(선택의 근거가 사라집니다)', '"창의적인 아이디어를 제안했습니다" 같은 자기평가 형용사'],
    followup: '두 번째로 좋았던 안은 무엇이었고 왜 떨어졌나요?',
  },
  {
    id: 'execution',
    label: '실행력·추진력',
    keywords: ['실행', '추진', '납기', '일정', '마감', '성과 창출', '목표 달성', '끝까지', '실행력'],
    reads: '의욕이 아니라, 계획이 어긋났을 때 무엇을 포기하고 무엇을 지켰는지를 봅니다.',
    frame: '① 목표와 기한을 숫자로 → ② 중간에 어긋난 지점 → ③ 우선순위를 다시 잡은 기준(무엇을 버렸는지) → ④ 최종 결과와 기한 준수 여부 → ⑤ 남은 아쉬움',
    openers: ['목표 수치와 남은 기간을 함께 제시하며 시작'],
    evidence: ['internship', 'project', 'competition', 'extracurricular'],
    numbers: ['목표 대비 달성률', '기한', '축소·포기한 범위'],
    avoid: ['모든 것을 다 지켜냈다는 서술(트레이드오프가 없으면 실행 경험으로 읽히지 않습니다)', '"밤을 새워" 류의 투입량 강조 — 시간은 성과가 아닙니다'],
    followup: '기한을 지키려고 포기한 것 때문에 나중에 문제가 생기지는 않았나요?',
  },
  {
    id: 'expertise',
    label: '전공지식·기술 숙련',
    /* '자격' 은 넣지 않는다 — 거의 모든 공고에 "[자격요건]" 머리말이 있어 전부 걸린다. */
    keywords: ['전공', '지식', '기술 스택', '역량 보유', '경험자', '숙련', '기사 자격', '이해도', '전문성', '전공자'],
    reads: '보유 목록이 아니라, 그 지식을 실제 상황에 적용해 본 적이 있는지를 봅니다.',
    frame: '① 어떤 지식·기술인지 한 번만 명시 → ② 그것을 적용한 구체적 과제 → ③ 교과서와 실제가 달랐던 지점 → ④ 산출물 → ⑤ 이 직무에서 이어서 쓸 부분',
    openers: ['수업에서 배운 개념과 실제 과제의 간극을 제시하며 시작'],
    evidence: ['research', 'project', 'internship', 'competition'],
    numbers: ['적용 과제의 규모', '성능·정확도·처리량 등 결과 지표', '자격·성적 등 객관 지표'],
    avoid: ['자격증·수강과목 나열(이력서에 이미 있는 정보를 자소서에서 반복하는 것)', '적용 경험 없이 "이해하고 있습니다"로 끝내는 구성'],
    followup: '그 방법의 한계는 무엇이었나요?',
  },
  {
    id: 'communication',
    label: '설득·커뮤니케이션',
    keywords: ['설득', '발표', '프레젠테이션', '보고', '협상', '문서화', '전달', '브리핑', '대응'],
    reads: '말솜씨가 아니라, 상대가 무엇을 걱정하는지 파악하고 그것에 맞춰 근거를 고른 능력을 봅니다.',
    frame: '① 설득해야 했던 상대와 그 사람의 이해관계 → ② 처음 거절/반대된 이유 → ③ 근거를 어떻게 바꿨는지(자료·시연·수치) → ④ 합의 결과 → ⑤ 그 뒤 관계',
    openers: ['상대의 반대 논리를 먼저 정확히 요약하며 시작'],
    evidence: ['competition', 'internship', 'project', 'club', 'extracurricular'],
    numbers: ['설득 대상의 규모·직위', '시도 횟수·기간', '합의로 바뀐 결과'],
    avoid: ['"적극적으로 소통하여 설득했습니다" — 설득의 내용이 없습니다', '상대의 반대 이유를 안 적는 구성'],
    followup: '끝까지 설득되지 않은 사람은 없었나요?',
  },
  {
    id: 'resilience',
    label: '도전·회복탄력성',
    keywords: ['도전', '실패', '어려움', '극복', '끈기', '열정', '역경', '위기'],
    reads: '실패 경험 자체가 아니라, 실패의 원인을 자기 몫으로 정확히 나눠 볼 수 있는지를 봅니다.',
    frame: '① 목표와 실패한 결과를 먼저 인정 → ② 원인 중 내 판단 문제였던 부분 → ③ 통제할 수 없었던 부분 → ④ 그 뒤 바꾼 행동 → ⑤ 그 변화가 통했음을 보여주는 다음 사례',
    openers: ['실패한 결과를 첫 문장에서 그대로 밝히며 시작'],
    evidence: ['competition', 'project', 'internship', 'club'],
    numbers: ['재도전 횟수·기간', '다음 시도의 결과'],
    avoid: ['남·환경 탓으로 끝나는 구성', '실패를 "값진 경험이었습니다"로 마무리하는 문장 — 배운 것의 내용이 없습니다'],
    followup: '같은 상황이 다시 오면 어느 단계에서 다르게 판단하나요?',
  },
  {
    id: 'global',
    label: '글로벌·외국어',
    keywords: ['글로벌', '해외', '영어', '외국어', '수출', '현지', '무역', '바이어', '영문', '해외사업'],
    reads: '어학 점수가 아니라, 언어를 써서 실제로 일을 진행시킨 경험을 봅니다.',
    frame: '① 어떤 상황에서 외국어로 일해야 했는지 → ② 언어 때문에 막힌 지점 → ③ 해결 방식(자료 준비·문서화·현지 확인) → ④ 성사된 결과 → ⑤ 현재 수준의 객관 지표',
    openers: ['업무 상황을 먼저 제시하고 언어는 수단으로 배치'],
    evidence: ['exchange', 'internship', 'extracurricular', 'project'],
    numbers: ['어학 성적', '응대·협업한 상대 국가·인원', '성사된 건수·금액'],
    avoid: ['교환학생 사실만 적고 무엇을 했는지가 없는 구성', '어학 점수를 자소서 본문에서 반복하는 것(이력서에 이미 있습니다)'],
    followup: '그 일을 한국어로 했다면 결과가 달랐을까요?',
  },
  {
    id: 'process',
    label: '꼼꼼함·품질/규정 준수',
    keywords: ['정확', '꼼꼼', '검증', '품질', '규정', '준수', '컴플라이언스', '감사', '안전', '오류', '재무', '회계', '결산'],
    reads: '실수를 안 하는 사람인지가 아니라, 실수를 잡아내는 장치를 만들어 본 적이 있는지를 봅니다.',
    frame: '① 실수가 났을 때의 대가가 큰 업무였음을 제시 → ② 실제로 발견한 오류 → ③ 재발을 막기 위해 만든 절차(체크리스트·이중확인·자동화) → ④ 그 뒤 오류율 변화 → ⑤ 남에게 인계 가능했는지',
    openers: ['한 건의 오류가 어떤 결과로 이어질 수 있었는지 제시하며 시작'],
    evidence: ['internship', 'project', 'research'],
    numbers: ['처리 건수·금액 규모', '발견한 오류 수', '오류율 변화'],
    avoid: ['"꼼꼼한 성격입니다" 같은 성격 서술 — 성격은 검증할 수 없습니다', '절차를 만들지 않고 "더 신경 썼습니다"로 끝내는 구성'],
    followup: '그 절차가 일을 느리게 만들지는 않았나요?',
  },
  {
    id: 'service',
    label: '책임감·공공성',
    keywords: ['공익', '봉사', '윤리', '사회적 가치', '공공', '지역사회', 'esg', '상생', '신뢰'],
    reads: '선한 태도가 아니라, 개인의 편의를 포기하면서 지킨 기준이 있는지를 봅니다.',
    frame: '① 편법이 더 쉬웠던 상황 → ② 지킨 기준과 그렇게 판단한 이유 → ③ 그로 인해 감당한 손실(시간·관계) → ④ 결과 → ⑤ 이 조직에서 같은 기준이 필요한 지점',
    openers: ['선택지 두 개를 제시하고 무엇을 택했는지로 시작'],
    evidence: ['volunteer', 'extracurricular', 'internship', 'club'],
    numbers: ['활동 기간·규모', '수혜 인원', '감당한 비용'],
    avoid: ['봉사시간 나열', '"사회에 기여하고 싶습니다" 같은 포부만의 문장'],
    followup: '그 기준을 지키는 것이 조직에 손해였다면 어떻게 했을까요?',
  },
];

const BY_ID = Object.fromEntries(ARCHETYPES.map(a => [a.id, a]));

/* CAS 활동 유형 id → 사람이 읽는 이름. cas.js 를 직접 require 하면 프론트 파일을
   백엔드가 또 끌어오게 되는데, 이미 casAnalyze.js 가 그렇게 쓰고 있으므로 같은
   방식을 따른다(단일 출처 유지). */
const CAS = require('../../frontend/js/cas.js');
const ACT_LABEL = Object.fromEntries(CAS.ACTIVITY_TYPES.map(t => [t.id, t.label]));

/* ── 규칙 추출 ─────────────────────────────────────────────────
   JD 원문에서 키워드로 역량을 찾는다. AI 보다 먼저 돌고, 여기서 충분히 잡히면
   AI 호출 자체를 건너뛴다(casAnalyze.js 와 같은 전략 — 정확도도 속도도 낫다).
   근거로 쓴 JD 원문 문장을 함께 남긴다: 화면에서 "이 역량은 공고의 이 문장 때문에
   뽑혔습니다"를 보여줘야 사용자가 오탐을 스스로 걸러낼 수 있다. */
/* "[자격요건]", "◆ 우대사항" 같은 구역 머리말은 역량 근거가 아니다. 근거 문장으로
   화면에 인용해도 아무 정보가 없고, 머리말 단어 때문에 오탐이 생긴다 → 버린다. */
/* 전공분야·필요역량은 고용24 직무별 자소서 작성가이드를 옮겨 적을 때 붙는 머리말이다
   (work24-guide.js toJdText). 다른 머리말과 같은 이유로 근거에서 뺀다. */
const SECTION_HEAD = /^[\[\(【<]?\s*(주요\s*)?(업무|담당업무|자격요건|지원자격|우대사항|필수사항|자격|요건|모집분야|근무조건|전형절차|인재상|전공분야|필요역량)\s*[\]\)】>]?$/;

/* ── 인재상·회사소개 boilerplate 는 요구역량이 아니다 (사용자 확인 2026-09-01) ──
   "열정적이고 도전적인 인재를 찾습니다", "우리의 비전에 공감하는 분" 같은 문장은
   어느 공고에나 붙는 인재상 문구지 직무가 실제로 요구하는 역량이 아니다. 그런데 그 안의
   '도전·열정·책임감' 이 역량 키워드로 걸려 오탐이 됐다(실측: 도전·회복탄력성이 그렇게 잡혔다).
   → 이런 문장은 근거에서 통째로 뺀다. '~인재/사람/분 을 찾/모시/우대/환영' 꼴과, 회사가
   자기를 소개하는 '우리는/저희는 …' 꼴이 대상이다(직무 요건은 이렇게 쓰지 않는다). */
const BOILERPLATE = /(인재|사람|분)\s*(을|를)?\s*(찾|모시|모집합|우대|환영|바랍|기다)|인재상|우리\s*(회사|팀)?\s*는|저희\s*(회사|팀)?\s*는|비전에\s*공감/;

/* ── 자소서에 쓸 구간만 남긴다 (사용자 지시 2026-09-15) ────────────────────────
   ── 무엇이 문제였나 ──
   공고 주소·이미지를 넣으면 본문을 잘 뽑아 오는데, **자소서와 상관없는 구간까지**
   같이 들어온다. 복리후생의 '자기계발비 지원', 결격사유의 '병역 기피 사실이 없는
   자', 전형절차의 '인성검사' 같은 문장이 역량 근거로 인용되고, 그 안의 낱말이
   키워드로 잡히기도 했다(사용자 지적).

   문장 단위로 거르는 장치는 이미 둘 있다 — 머리말(SECTION_HEAD)과 인재상 상투어
   (BOILERPLATE). 하지만 복리후생 본문은 멀쩡한 문장이라 그 그물에 안 걸린다.
   구간째로 빼는 수밖에 없다.

   ── 무엇을 남기고 무엇을 버리나 ──
   남긴다: 회사소개 · 담당업무 · 자격요건 · 우대사항 · 필요역량
   버린다: 복리후생 · 결격사유 · 전형절차 · 근무조건 · 급여 · 접수방법 · 문의처

   **자격요건은 남긴다.** 사용자가 적어 준 목록(회사소개·담당업무·우대사항)에는
   없지만, 요구 역량 근거의 절반 이상이 이 구간에서 나온다 — 빼면 이 기능의 재료가
   사라진다. 정말 빼야 한다면 KEEP_HEAD 에서 한 줄만 지우면 된다.

   ── 못 가른 글은 건드리지 않는다 ──
   머리말이 하나도 없는 공고(줄글로만 쓴 것)가 흔하다. 그때는 원문을 그대로 돌려준다.
   걸러낸 결과가 너무 짧아져도 마찬가지다 — 잘못 잘라 재료를 통째로 없애는 것보다
   잡음을 조금 남기는 편이 낫다. */
const DROP_HEAD = /^(채용\s*)?결격\s*사유|^복리\s*후생|^복지(\s*제도)?$|^사내\s*복지|^혜택|^근무\s*(조건|시간|형태|지역|장소|환경|요일)|^급여|^연봉|^보수|^처우|^전형\s*(절차|방법|일정|단계)|^채용\s*(절차|방법|일정|전형)|^모집\s*기간|^접수|^지원\s*(방법|절차|서류|기간)|^제출\s*서류|^서류\s*접수|^유의\s*사항|^기타\s*사항|^참고\s*사항|^문의|^담당자|^취업\s*지원\s*대상자|^장애인/;
const KEEP_HEAD = /^(회사|기업)\s*(소개|개요)|^사업\s*소개|^담당\s*업무|^주요\s*업무|^수행\s*업무|^직무\s*(내용|소개|개요)|^업무\s*내용|^모집\s*(분야|부문)|^자격\s*(요건|조건)|^지원\s*자격|^필수\s*(사항|요건|자격|조건)|^우대\s*(사항|조건|요건)|^필요\s*역량|^전공\s*분야|^인재상/;

/* 머리말 장식(■ ◆ [ ] 1. 등)을 걷어낸 알맹이. 구간을 가르는 데만 쓴다. */
const bareHead = line => String(line)
  .replace(/^[\s\-–—*○◦▪>·•◆■□▶●▣☞#0-9.)\]]+/, '')
  .replace(/^[\[\(【<]/, '')
  .replace(/[\]\)】>:：]+\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim();

/* 이 줄이 구간 머리말인가. **짧은 줄이거나 콜론이 앞쪽에 있을 때만** 머리말로 본다 —
   그러지 않으면 '근무 중 배운 것을 …' 같은 본문 문장이 구간을 뒤집는다.
   24자는 실제 공고 머리말이 대개 10자 안쪽인 것을 감안한 여유값이다. */
function headKind(line) {
  const t = bareHead(line);
  if (!t) return null;
  const colonAt = Math.max(line.indexOf(':'), line.indexOf('：'));
  const looksHead = t.length <= 24 || (colonAt >= 0 && colonAt <= 20);
  if (!looksHead) return null;
  if (DROP_HEAD.test(t)) return 'drop';
  if (KEEP_HEAD.test(t)) return 'keep';
  return null;
}

function usefulText(jdText) {
  const src = String(jdText || '');
  const lines = src.split(/\r?\n/);
  let keeping = true;            // 첫 머리말 전까지는 남긴다 — 제목·회사소개가 대개 거기 있다
  let sawHead = false;
  const out = [];
  for (const line of lines) {
    const kind = headKind(line);
    if (kind === 'drop') { keeping = false; sawHead = true; continue; }
    if (kind === 'keep') { keeping = true; sawHead = true; }
    if (keeping) out.push(line);
  }
  const kept = out.join('\n').trim();
  if (!sawHead) return src;                                 // 구간을 못 가른 공고
  /* 많이 잘리는 것 자체는 정상이다 — 복리후생·전형절차가 공고의 절반인 경우가 흔하다.
     막으려는 것은 **통째로 사라지는 것**뿐이라 문턱을 낮게 잡는다(두 문장 남짓). */
  if (kept.replace(/\s/g, '').length < 60) return src;
  return kept;
}

function splitSentences(text) {
  return String(text)
    .split(/[\n·•]+|(?<=[.!?])\s+/)
    .map(s => s.replace(/^[\s\-–—*○◦▪️>]+/, '').trim())
    .filter(s => s.length >= 4)
    .filter(s => !SECTION_HEAD.test(s.replace(/[\s:]/g, ' ').trim()))
    .filter(s => !BOILERPLATE.test(s));
}

/* 어느 공고에나 들어 있는 일반 동사는 그것만 걸렸을 때 근거가 약하다.
   가중치를 주지 않으면 "프로모션 기획 및 실행" 한 문장이 기획력·실행력·주도성을
   동점으로 만들어, 정작 우대사항에 적힌 글로벌·고객지향을 밀어낸다(실측).
   → 약한 키워드는 0.4, 나머지는 1.0 으로 센다. */
const WEAK_KEYWORDS = new Set([
  '실행', '추진', '제안', '적극', '지식', '경험자', '대응', '개선',
  '전달', '보고', '소통', '성장', '열정', '자율', '신뢰', '현장',
  /* '책임감' 은 "성실하고 책임감 있는 분" 같은 일반 성격 문구로 흔히 쓰여, 그것만
     걸리면 주도성·오너십을 잘못 잡았다(사용자 확인 2026-09-01). 약하게 센다. */
  '책임감',
]);
/* '기획'·'분석' 은 일부러 강한 쪽에 둔다 — 공고에서 이 두 단어는 업무의 이름이지
   수식어가 아니다("프로모션 기획", "성과 분석"). 약하게 세면 실제 요구가 빠진다. */

function ruleExtract(jdText) {
  /* 자소서와 상관없는 구간(복리후생·결격사유·전형절차…)을 먼저 뺀다 — usefulText 주석. */
  const sentences = splitSentences(usefulText(jdText));
  const lower = s => s.toLowerCase();
  const hits = new Map();

  for (const s of sentences) {
    const ls = lower(s);
    for (const arc of ARCHETYPES) {
      /* 한 문장에서 여러 키워드가 걸리면 그만큼 근거가 강하다 — 전부 센다. */
      const kws = arc.keywords.filter(k => ls.includes(k));
      if (!kws.length) continue;

      if (!hits.has(arc.id)) hits.set(arc.id, { id: arc.id, quotes: [], score: 0, matched: [] });
      const h = hits.get(arc.id);
      for (const kw of kws) {
        h.score += WEAK_KEYWORDS.has(kw) ? 0.4 : 1;
        if (!h.matched.includes(kw)) h.matched.push(kw);
      }
      if (h.quotes.length < 2 && !h.quotes.includes(s)) h.quotes.push(s);
    }
  }

  return {
    /* 약한 키워드 하나만 걸린 역량(0.4)은 근거로 보기 어렵다 → 버린다. */
    found: [...hits.values()].filter(h => h.score >= 0.8).sort((a, b) => b.score - a.score),
    sentenceCount: sentences.length,
  };
}

/* ── 내 활동 연결 ───────────────────────────────────────────────
   로그인 사용자의 CAS activities 를 역량별 근거 후보로 붙인다. 이게 있어야
   "일반론"이 아니라 "네 인턴 경험을 이 역량에 이렇게 붙여라"가 된다.
   스펙이 없으면(비로그인·미입력) 조용히 빈 배열 — 가이드 자체는 그대로 쓸 수 있다. */
function matchMyActivities(arc, activities) {
  if (!Array.isArray(activities) || !activities.length) return [];
  return activities
    .filter(a => arc.evidence.includes(a.type))
    .map(a => ({
      name: a.name || ACT_LABEL[a.type] || a.type,
      typeLabel: ACT_LABEL[a.type] || a.type,
      duration: a.duration || null,
      role: a.stage || a.role || null,
      outcome: a.outcome || null,
      /* 배점이 높은 유형이 자소서에서도 강한 소재다(같은 서열을 쓴다 — cas.js 단일 출처). */
      weight: (CAS.ACTIVITY_TYPES.find(t => t.id === a.type) || {}).base || 0,
    }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3);
}

/* 소재가 하나도 없는 역량은 그 사실 자체가 가장 중요한 정보다.
   "이 역량은 공고가 요구하는데 네 스펙에 근거가 없다" → 지금 만들어야 할 경험. */
function gapNote(arc, mine, hasSpec) {
  if (!hasSpec) {
    return '스펙을 입력하면 이 역량에 쓸 수 있는 내 활동을 찾아 연결해 드려요.';
  }
  if (mine.length) return null;
  const wants = arc.evidence.map(id => ACT_LABEL[id]).filter(Boolean).slice(0, 3).join(' · ');
  return `이 역량의 근거로 쓸 활동이 아직 없습니다. 보통 ${wants} 경험이 근거가 됩니다.`;
}

/* ── 가이드 조립 ───────────────────────────────────────────────
   AI 가 문장을 쓰지 않는다. 검증된 문구를 사용자 상황(JD 근거 문장 + 내 활동)과
   엮어 조립한다. 그래서 같은 입력이면 항상 같은 결과가 나오고(결정론),
   틀린 문장이 생성될 여지가 없다. */
/* 골격 앞에 "무엇으로 쓸지"를 못박는 한 줄. 일반론과 맞춤 가이드를 가르는 지점이라
   소재 배분(spreadMaterials) 뒤에 다시 만들어야 한다 → 함수로 뺀다. */
function makeLead(item) {
  const top = item.mine[0];
  if (!top) {
    return `아래 순서를 골격으로 잡고, 그 순서에 맞는 경험을 하나만 골라 끝까지 서술하세요. `
      + `여러 경험을 나열하면 어느 것도 근거가 되지 않습니다.`;
  }
  const meta = `${top.typeLabel}${top.duration ? ` · ${top.duration}` : ''}`;
  if (item.reuse) {
    return `**${top.name}**(${meta})을 쓸 수 있지만, 이 경험은 앞의 다른 역량에도 배정돼 있어요. `
      + `자소서 문항이 여러 개라면 소재가 겹치지 않게 나눠 쓰세요.`;
  }
  return `가장 강한 소재는 **${top.name}**(${meta})입니다. 이 경험을 아래 순서로 풀어 쓰세요.`;
}

/* 역량마다 독립적으로 소재를 고르면 배점 1위 활동(보통 인턴십)이 모든 카드에서
   1순위가 된다 — 실측에서 역량 7개가 전부 같은 인턴을 추천했다. 자소서 문항은
   보통 3~4개인데 같은 소재를 일곱 번 쓰라는 건 나쁜 조언이다.
   → 중요한 역량부터 아직 안 쓴 소재를 하나씩 배정하고, 남는 게 없으면 겹침을 밝힌다. */
function spreadMaterials(items) {
  const used = new Set();
  for (const item of items) {
    if (!item || !item.mine?.length) continue;

    const freeIdx = item.mine.findIndex(m => !used.has(m.name));
    if (freeIdx === -1) {
      item.reuse = true;                       // 쓸 수는 있지만 이미 다른 역량에 배정됨
    } else {
      const [picked] = item.mine.splice(freeIdx, 1);
      item.mine.unshift(picked);               // 배정된 소재를 1순위로 올린다
      used.add(picked.name);
      item.reuse = false;
    }
    item.lead = makeLead(item);
  }
  return items;
}

function buildGuide(entry, activities, hasSpec) {
  const arc = BY_ID[entry.id];
  if (!arc) return null;
  const mine = matchMyActivities(arc, activities);
  const lead = makeLead({ mine, reuse: false });

  return {
    id: arc.id,
    label: arc.label,
    source: entry.source || 'rule',            // rule | ai — 화면에서 구분해 보여준다
    quotes: entry.quotes || [],                // JD 원문 근거 (오탐 판별용)
    matched: entry.matched || [],              // 걸린 키워드
    reads: arc.reads,
    lead,
    frame: arc.frame,
    openers: arc.openers,
    numbers: arc.numbers,
    avoid: arc.avoid,
    followup: arc.followup,
    mine,
    gap: gapNote(arc, mine, hasSpec),
  };
}

/* AI 가 원형에 없는 역량을 들고 왔을 때(예: 특정 도메인 지식). 원형이 없으니
   문구를 만들어 줄 수 없다 — 대신 "직접 확인해야 하는 항목"으로 정직하게 넘긴다.
   여기서 그럴듯한 가이드를 지어내면 이 기능 전체의 신뢰가 깨진다. */
function buildCustom(entry) {
  return {
    id: 'custom:' + entry.label,
    label: entry.label,
    source: 'ai',
    quotes: entry.quotes || [],
    matched: [],
    reads: entry.reads || '공고에서 직접 요구한 항목입니다.',
    lead: '이 항목은 careerly 의 역량 사전에 없는 직무 특수 요건이라, 작성 골격을 자동으로 드리지 못합니다.',
    frame: '① 이 요건과 관련해 내가 한 일 → ② 그 일의 규모를 숫자로 → ③ 결과 → ④ 이 직무에서 이어서 쓸 부분',
    openers: [],
    numbers: ['규모', '기간', '결과'],
    avoid: ['요건을 그대로 옮겨 쓰고 "관심이 많습니다"로 잇는 구성'],
    followup: null,
    mine: [],
    gap: '공고 원문을 다시 읽고, 이 요건을 증명할 수 있는 내 경험이 있는지 직접 확인해 주세요.',
    custom: true,
  };
}

module.exports = {
  ARCHETYPES, BY_ID, ARCHETYPE_IDS: ARCHETYPES.map(a => a.id),
  splitSentences, ruleExtract, buildGuide, buildCustom, matchMyActivities,
  usefulText, headKind, DROP_HEAD, KEEP_HEAD,
  spreadMaterials, makeLead, WEAK_KEYWORDS,
};
