// ════════════════════════════════════════════════════════════
//  C:road — CAS (Career Asset Score) 점수 엔진 · 정량 파트
//
//  설계 근거: docs/notes/2026.06.23 아이디어 회의(CAS점수내는법 개발).docx
//             docs/notes/2026년 7월 5일 회의.docx
//
//  CAS 총점 1,000점 = 정량 400점(40%) + 정성 600점(60%)
//  실무 역량(정성)을 더 높게 본다는 팀 결정에 따른 비율이다.
//  정량 400점은 이 파일 위쪽, 정성 600점은 아래쪽에서 다룬다.
//  정성 배점은 설문(구글폼)의 활동 구조(유형·기간·역할·성과)에 맞춰
//  '기본 참여 점수 × 성과/기간/역할 가산' 형태로 구현했다(computeQual).
//
//  ── 정량 400점의 구성 ──
//  학점 40% · 어학 35% · 자격증 25%   (사기업 일반 기준)
//
//  가중치는 다음 두 조건에 따라 조정되고, 조정 후 항상 합이 1이 되도록
//  재정규화한다.
//    1) 지원처가 공기업·공공  → 학점을 보지 않으므로 학점 가중치 0
//    2) 전공과 직무가 무관    → 학점 가중치 ×0.5
//
//  ── 점수화 원칙 ──
//  절대 기준이 아니라 "같은 직무 합격자(선배) 대비 상대 위치"로 채점한다.
//  회의록의 "해당 직무 취업자 평균 학점은 3.85" 벤치마킹 방식을 따른다.
//  합격자 평균과 같으면 만점의 80%, 평균의 1.25배 이상이면 만점.
// ════════════════════════════════════════════════════════════
(function (root) {

  const TOTAL_QUANT = 400;           // 정량 만점 (CAS 1000점 중 40%)
  const PAR_RATIO   = 0.80;          // 합격자 평균과 동률일 때 받는 비율
  const CAP_RATIO   = 1.25;          // 평균의 몇 배부터 만점인지

  // ── 지원처별 기본 가중치 ────────────────────────────────────
  //  gpaBlind: 학점을 보지 않는 지원처 (공기업 블라인드 채용)
  const TARGETS = {
    private: { label: '사기업',      weights: { gpa: 0.40, lang: 0.35, cert: 0.25 } },
    public:  { label: '공기업·공공', weights: { gpa: 0.40, lang: 0.35, cert: 0.25 }, gpaBlind: true },
    startup: { label: '스타트업',    weights: { gpa: 0.30, lang: 0.30, cert: 0.40 } },
  };

  const OFF_MAJOR_GPA_FACTOR = 0.5;  // 전공-직무 무관 시 학점 가중치 배율

  // ── 어학 환산표 ─────────────────────────────────────────────
  //  회의록 기준점: OPIc IH ≈ TOEIC 850 ≈ 토익스피킹 IM3 ≈ '상(Upper-Intermediate)'
  //  이 셋이 모두 80 이 되도록 맞췄다. 서로 다른 시험을 하나의 0~100 지수로 환산한다.
  const TOEIC_CURVE = [[400, 20], [600, 45], [700, 60], [800, 75], [850, 80], [900, 88], [950, 94], [990, 100]];
  const TOEFL_CURVE = [[40, 30], [60, 55], [80, 75], [100, 88], [120, 100]];
  const OPIC_INDEX  = { NL: 20, NM: 30, NH: 40, IL: 50, IM1: 58, IM2: 64, IM3: 70, IH: 80, AL: 92 };
  const TS_INDEX    = { NL: 20, NM: 30, NH: 42, IL: 55, IM: 72, IH: 85, AL: 95 };
  const TOPIK_INDEX = { '1급': 25, '2급': 40, '3급': 55, '4급': 70, '5급': 85, '6급': 100 };
  /* TEPS 는 2018 개편 후 600점 만점. 공식 대응표가 없어 TEPS 관리위원회가 공개한
     등급 구간(1+급 ≈ 상위권)을 기준점 삼아 TOEIC 곡선과 같은 자리에 맞췄다.
     G-TELP 는 채용에서 사실상 Level 2 만 쓰이므로 100점 만점 기준 하나만 둔다. */
  const TEPS_CURVE  = [[200, 20], [300, 45], [327, 60], [364, 75], [387, 80], [419, 88], [453, 94], [600, 100]];
  const GTELP_CURVE = [[30, 20], [50, 45], [65, 60], [72, 75], [77, 80], [85, 88], [92, 94], [100, 100]];

  function interpolate(curve, x) {
    if (x <= curve[0][0]) return curve[0][1];
    const last = curve[curve.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < curve.length - 1; i++) {
      const [x0, y0] = curve[i], [x1, y1] = curve[i + 1];
      if (x >= x0 && x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
    return 0;
  }

  /* 어학 성적 묶음 → 0~100 지수. 여러 시험을 냈다면 가장 높은 환산값을 쓴다.
     (합격자들은 보통 자기에게 유리한 시험 하나를 제출한다) */
  function langIndex(scores) {
    if (!scores) return null;
    const vals = [];
    if (typeof scores.toeic === 'number') vals.push(interpolate(TOEIC_CURVE, scores.toeic));
    if (typeof scores.toefl === 'number') vals.push(interpolate(TOEFL_CURVE, scores.toefl));
    if (typeof scores.teps  === 'number') vals.push(interpolate(TEPS_CURVE,  scores.teps));
    if (typeof scores.gtelp === 'number') vals.push(interpolate(GTELP_CURVE, scores.gtelp));
    if (scores.opic          && OPIC_INDEX[scores.opic]          != null) vals.push(OPIC_INDEX[scores.opic]);
    if (scores.toeicSpeaking && TS_INDEX[scores.toeicSpeaking]   != null) vals.push(TS_INDEX[scores.toeicSpeaking]);
    if (scores.topik         && TOPIK_INDEX[scores.topik]         != null) vals.push(TOPIK_INDEX[scores.topik]);
    return vals.length ? Math.max(...vals) : null;
  }

  /* ── 어학 시험 카탈로그 ───────────────────────────────────────
     스펙 입력 화면이 어떤 시험을 보여줄지, 어떤 입력 위젯을 쓸지의 단일 출처.
     여기 없는 시험은 langIndex() 도 못 읽으므로 둘을 같이 고쳐야 한다.
     kind: 'score' = 숫자 입력(만점 max), 'level' = 등급 선택(levels). */
  const LANG_TESTS = [
    { id: 'toeic',         label: 'TOEIC',            kind: 'score', max: 990, placeholder: '예: 920' },
    { id: 'opic',          label: 'OPIc',             kind: 'level', levels: Object.keys(OPIC_INDEX) },
    { id: 'toeicSpeaking', label: 'TOEIC Speaking',   kind: 'level', levels: Object.keys(TS_INDEX) },
    { id: 'toefl',         label: 'TOEFL (iBT)',      kind: 'score', max: 120, placeholder: '예: 105' },
    { id: 'teps',          label: 'TEPS',             kind: 'score', max: 600, placeholder: '예: 387' },
    { id: 'gtelp',         label: 'G-TELP (Level 2)', kind: 'score', max: 100, placeholder: '예: 77' },
    { id: 'topik',         label: 'TOPIK (한국어능력시험)', kind: 'level', levels: Object.keys(TOPIK_INDEX) },
  ];

  /* 제2외국어 — 점수가 아니라 등급으로만 받는다.
     CAS 어학 점수는 영어 기준(langIndex)이라 여기 값은 **점수에 반영되지 않는다**.
     프로필·비교 화면에 보여주기 위한 기록용이며, 반영하려면 별도 배점 설계가 필요하다. */
  /* ── 시험마다 받는 모양이 다르다 (사용자 지적 2026-09-11) ────────────────────
     처음에는 전부 등급제로 두고 `levels` 만 받았다. 그런데 **JPT 는 990점 만점 점수제**라
     등급 목록을 만들 수가 없다. 그래서 LANG_TESTS 와 같은 `kind` 를 둔다 —
       kind:'level'  → levels 중에서 고른다 (없으면 기본값이 'level' 이다)
       kind:'score'  → max 까지의 점수를 적는다
     회화시험(SJPT·TSC·OPIc)은 영어 OPIc 과 같은 NH~AL 등급 체계를 쓴다. */
  const OPIC_LEVELS = ['NL', 'NM', 'NH', 'IL', 'IM1', 'IM2', 'IM3', 'IH', 'AL'];

  const FOREIGN_TESTS = [
    // 일본어
    { id: 'jlpt',    label: 'JLPT (일본어)',        levels: ['N5', 'N4', 'N3', 'N2', 'N1'] },
    { id: 'jpt',     label: 'JPT (일본어)',         kind: 'score', max: 990, placeholder: '예: 800' },
    { id: 'sjpt',    label: 'SJPT (일본어 말하기)', levels: OPIC_LEVELS },
    { id: 'opicJa',  label: 'OPIc 일본어',          levels: OPIC_LEVELS },
    // 중국어
    { id: 'hsk',     label: 'HSK (중국어)',         levels: ['1급', '2급', '3급', '4급', '5급', '6급'] },
    { id: 'hskk',    label: 'HSKK (중국어 회화)',   levels: ['초급', '중급', '고급'] },
    { id: 'tsc',     label: 'TSC (중국어 말하기)',  levels: ['1급', '2급', '3급', '4급', '5급', '6급', '7급', '8급', '9급', '10급'] },
    { id: 'opicZh',  label: 'OPIc 중국어',          levels: OPIC_LEVELS },
    // 그 밖
    { id: 'delf',    label: 'DELF·DALF (프랑스어)', levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
    { id: 'dele',    label: 'DELE (스페인어)',      levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
    { id: 'goethe',  label: 'Goethe-Zertifikat (독일어)', levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
    { id: 'torfl',   label: 'TORFL (러시아어)',     levels: ['기초', '1단계', '2단계', '3단계', '4단계'] },
  ];

  // ── 상대 채점 ───────────────────────────────────────────────
  /* 내 값과 합격자 평균의 비율로 0~1 을 낸다.
       평균과 같음        → 0.80
       평균의 1.25배 이상 → 1.00
       0                  → 0
     평균 미만 구간은 원점~평균을 0~0.8 로 선형 매핑한다. */
  function relativeScore(mine, benchmarkAvg) {
    if (mine == null || !benchmarkAvg) return null;
    const r = mine / benchmarkAvg;
    if (r >= CAP_RATIO) return 1;
    if (r >= 1) return PAR_RATIO + (1 - PAR_RATIO) * ((r - 1) / (CAP_RATIO - 1));
    return Math.max(0, PAR_RATIO * r);
  }

  // ── 자격증 ──────────────────────────────────────────────────
  /* 회의록: "단순 목록이 아니라 취업자 중 보유 비율을 파악해 우선순위를 준다"
     → 내가 가진 자격증의 '합격자 보유율' 합을, 상위 3개 보유율 합으로 나눈다.
       해당 직무 합격자가 잘 갖지 않는 자격증(= 직무 무관)은 보유율이 낮으므로
       점수에 거의 기여하지 못한다. 목록을 사람이 관리할 필요가 없다.

     다만 표본이 아주 적으면 보유율이 요동친다(1명이 가지면 100%).
     그래서 표본이 MIN_N 미만이면 자격증 카탈로그를 사전 확률로 쓴다. */
  const MIN_N_FOR_RATE = 5;
  const PRIOR_IN_CATALOG  = 60;   // 카탈로그에 있는 자격증의 가정 보유율(%)
  const PRIOR_OFF_CATALOG = 5;    // 카탈로그에 없는 자격증

  function certScore(myCerts, benchmark, catalogIds) {
    const mine = myCerts || [];
    if (!mine.length) return 0;

    const useRates = benchmark && benchmark.count >= MIN_N_FOR_RATE && benchmark.certs?.length;
    const rateOf = id => {
      if (useRates) return benchmark.certs.find(c => c.id === id)?.pct ?? PRIOR_OFF_CATALOG;
      return (catalogIds || []).includes(id) ? PRIOR_IN_CATALOG : PRIOR_OFF_CATALOG;
    };

    // 만점 기준: 이 직무에서 가장 흔한 자격증 3개를 모두 보유한 상태
    const pool = useRates
      ? benchmark.certs.map(c => c.pct)
      : (catalogIds || []).map(() => PRIOR_IN_CATALOG);
    const top3 = pool.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    if (!top3) return 0;

    const earned = mine.map(rateOf).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    return Math.min(1, earned / top3);
  }

  // ── 가중치 결정 ─────────────────────────────────────────────
  /* gpaBlind 이면 학점을 빼고, 전공 무관이면 학점을 절반으로 깎는다.
     어느 경우든 남은 가중치를 어학·자격증에 원래 비율대로 재분배해 합을 1로 만든다. */
  function resolveWeights(targetKey, majorRelevant) {
    const target = TARGETS[targetKey] || TARGETS.private;
    const base = { ...target.weights };

    if (target.gpaBlind) base.gpa = 0;
    else if (!majorRelevant) base.gpa *= OFF_MAJOR_GPA_FACTOR;

    const sum = base.gpa + base.lang + base.cert;
    return {
      gpa:  base.gpa  / sum,
      lang: base.lang / sum,
      cert: base.cert / sum,
      gpaBlind: !!target.gpaBlind,
      majorRelevant,
    };
  }

  // ── 메인 ────────────────────────────────────────────────────
  /*  spec       : 내 스펙 { gpa, gpaMax, scores, certs }
      benchmark  : Aggregator.compute() 결과 (같은 NCS 중분류 합격자)
      target     : 'private' | 'public' | 'startup'
      majorRelevant : 전공이 이 직무와 관련 있는가 (boolean)
      catalogIds : 이 직무의 자격증 카탈로그 id 목록 (표본 부족 시 사용)

      반환: { total, max, parts: { gpa, lang, cert }, weights, sampleSize, reliable }
      각 part 는 { ratio, points, max, mine, benchmark } — 화면에서 근거를 보여주기 위함 */
  function computeQuant({ spec, benchmark, target = 'private', majorRelevant = true, catalogIds = [] }) {
    const w = resolveWeights(target, majorRelevant);
    const n = benchmark?.count || 0;

    // 학점 — 4.5 만점으로 환산해 비교
    const myGpa = (spec?.gpa != null && spec?.gpaMax) ? (spec.gpa / spec.gpaMax) * 4.5 : null;
    const benchGpa = benchmark?.gpa?.avg ?? null;
    const gpaRatio = w.gpa > 0 ? relativeScore(myGpa, benchGpa) : null;

    // 어학 — 환산 지수끼리 비교
    const myLang = langIndex(spec?.scores);
    const benchLang = langIndex(benchmarkScores(benchmark));
    const langRatio = relativeScore(myLang, benchLang);

    // 자격증 — 보유율 기반
    const certRatio = certScore(spec?.certs, benchmark, catalogIds);

    const part = (ratio, weight, mine, bench) => ({
      ratio,                                   // null = 채점 불가 (데이터 없음)
      max: Math.round(TOTAL_QUANT * weight),
      points: ratio == null ? 0 : Math.round(TOTAL_QUANT * weight * ratio),
      mine, benchmark: bench,
    });

    const parts = {
      gpa:  part(gpaRatio,  w.gpa,  round2(myGpa),  round2(benchGpa)),
      lang: part(langRatio, w.lang, round2(myLang), round2(benchLang)),
      cert: part(certRatio, w.cert, (spec?.certs || []).length, n),
    };

    return {
      total: parts.gpa.points + parts.lang.points + parts.cert.points,
      max: TOTAL_QUANT,
      parts,
      weights: w,
      sampleSize: n,
      // 표본이 적으면 점수는 내되 화면에서 신뢰도를 함께 알린다
      reliable: n >= MIN_N_FOR_RATE,
    };
  }

  /* 벤치마크의 어학 평균을 langIndex() 가 먹을 수 있는 형태로 되돌린다.
     Aggregator 는 시험별 평균을 따로 내주므로, 그중 가장 높은 환산값을 기준선으로 삼는다. */
  function benchmarkScores(benchmark) {
    if (!benchmark?.scores) return null;
    const s = benchmark.scores;
    return {
      toeic: s.toeic?.avg ?? undefined,
      toefl: s.toefl?.avg ?? undefined,
      opic: s.opic?.avg ?? undefined,
      toeicSpeaking: s.toeicSpeaking?.avg ?? undefined,
      topik: s.topik?.avg ?? undefined,
    };
  }

  const round2 = n => (n == null ? null : Math.round(n * 100) / 100);

  // ════════════════════════════════════════════════════════════
  //  정성 600점 (CAS 1000점 중 60%)
  //
  //  설문(구글폼)에서 선배들이 남기는 "대표 활동"은 다음 4가지 축으로
  //  구조화되어 있다:  유형 · 기간 · 역할(또는 연구 단계) · 성과
  //  이 4축을 배수로 곱해 활동 1건의 원점수를 낸다.
  //
  //  ── 유형별 기본 배점(활동 1건 기준) — 팀 결정 우선순위 ──
  //  인턴십을 가장 높게, 그다음 공모전·대외활동(서포터즈/기자단)에 비중을
  //  크게 준다. 나머지(프로젝트·연구·동아리·교환·봉사·기타)는 규모·기간·
  //  성과로 변별하므로 기본 배점 차이는 완만하게 둔다.
  //
  //  ── 채점 원칙 ──
  //  정량과 동일하게 "같은 직무 합격자(선배) 평균 대비 상대 위치"로 채점한다.
  //  합격자 평균 원점수와 같으면 만점의 80%, 1.25배 이상이면 만점.
  //  (relativeScore 곡선을 그대로 재사용한다.)
  // ════════════════════════════════════════════════════════════
  const TOTAL_QUAL = 600;

  //  roleKind: 역할 축의 성격 — team(팀장/팀원/개인) · exec(임원진/일반) ·
  //            stage(연구 단계) · free(자유서술) · none(역할 없음)
  const ACTIVITY_TYPES = [
    { id: 'internship',     label: '인턴십',                 icon: '💼', base: 100, roleKind: 'team',  tier: 1,
      help: '대부분 직무에서 가장 강력한 차별화 — 전환·정규직 합격에 직결' },
    { id: 'competition',    label: '공모전·대회',            icon: '🏆', base: 78,  roleKind: 'team',  tier: 2,
      help: '문제해결·성과를 직접 증명 — 수상 시 가산이 크다' },
    /* 대외활동 배점은 원래 74 였다. 공모전(78) 바로 아래라 "대외활동 1건 = 동아리
       회장 1년"이 되어 과대평가였다 → 56 으로 내렸다. 교내 프로그램·비교과는
       모집 경쟁과 대외 노출이 대외활동보다 낮아 별도 유형(42)으로 분리했다. */
    { id: 'extracurricular',label: '대외활동(서포터즈·기자단)', icon: '🌐', base: 58, roleKind: 'free', tier: 3,
      help: '분야 관심도·꾸준함·협업 — 자기소개서 소재로 강력' },
    { id: 'project',        label: '프로젝트',               icon: '🛠️', base: 62,  roleKind: 'team',  tier: 3,
      help: '캡스톤·해커톤·팀 프로젝트 — 실무 역량 직접 증명' },
    { id: 'research',       label: '학부연구생·석사·박사',   icon: '🎓', base: 58,  roleKind: 'stage', tier: 3,
      help: 'R&D·연구직 핵심 경로 — 논문·상위 학위일수록 가산' },
    /* 동아리는 원래 46 이라 교환학생(40)보다 높았다. 서열 기준(인턴십 > 공모전 ≥ 대외활동 >
       교내활동 > 어학연수 > 동아리·봉사)에 맞춰 34 로 내렸다. */
    { id: 'club',           label: '동아리·학회',            icon: '🏫', base: 34,  roleKind: 'exec',  tier: 5,
      help: '리더십·지속성 — 임원진 경험은 인성 평가에 유리' },
    { id: 'campus',         label: '교내활동·비교과',        icon: '🏛️', base: 44,  roleKind: 'free',  tier: 4,
      help: '교내 프로그램·비교과 과정 — 성실성 보조 지표(대외활동보다 낮게 반영)' },
    { id: 'exchange',       label: '교환학생·어학연수',      icon: '✈️', base: 40,  roleKind: 'none',  tier: 4,
      help: '글로벌 역량·자기주도성 — 외국계·해외영업 가산' },
    { id: 'volunteer',      label: '봉사활동',               icon: '🤝', base: 30,  roleKind: 'none',  tier: 5,
      help: '인성·지속성 보조 지표' },
    { id: 'other',          label: '기타',                   icon: '✨', base: 24,  roleKind: 'none',  tier: 5,
      help: '위 유형에 속하지 않는 경험' },
  ];
  const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITY_TYPES.map(t => [t.id, t]));

  // 기간 배수 — 규모·지속성의 대리 지표. 길수록(특히 인턴십) 가치가 크다.
  const DURATION_MULT = {
    '1개월 미만': 0.6, '1~3개월': 0.8, '3개월~6개월': 1.0, '6개월~1년': 1.2, '1년이상': 1.35,
  };
  // 역할 배수 — 주도성. 팀장·임원진 > 개인 > 팀원·일반
  const ROLE_MULT = {
    '팀장': 1.2, '임원진': 1.2, '리더': 1.2,
    '개인': 1.05,
    '팀원': 1.0, '동아리원, 일반학회원': 1.0, '일반': 1.0,
  };
  // 성과 배수 — 결과의 강도(설문 '성과 또는 결과물' 선택지와 1:1)
  const OUTCOME_MULT = {
    '전환, 정규직 합격': 1.4, '수상': 1.3, '논문': 1.3,
    '발표 또는 산출물 공개(깃헙 등)': 1.15, '산출물 공개(깃헙 등)': 1.15,
    '결과물 없음': 1.0,
  };
  // 연구 단계 배수 (research 전용)
  /* 원래 1.0 / 1.15 / 1.3 이라 석사(90) · 박사(102)가 대기업 인턴 3개월(96)에도
     못 미쳤다. "석사는 웬만한 대기업 인턴십, 박사는 그보다 위"라는 기준에 맞춰 넓혔다.
     1년이상 기준 — 학부연구생 78 · 석사 125(≈ 대기업 인턴 3~6개월 120) · 박사 172(> 대기업 인턴 1년 162). */
  const STAGE_MULT = { '학부연구생': 1.0, '석사': 1.6, '박사': 2.2 };

  /* 기업 규모 배수 (internship 전용) — 같은 3개월이라도 대기업 인턴과 소규모 인턴의
     시장 가치가 다르다. activity.companyTier 는 백엔드 company-classify 가 활동명에서
     회사를 찾아 넣어준다(찾지 못하면 없음 → ×1.0). 저장된 옛 스펙에는 이 값이
     없으므로 기본 1.0 이 적용되어 점수가 바뀌지 않는다.
     'public'(공공기관)은 채용 선호도상 대기업과 같이 본다. */
  const COMPANY_MULT = { large: 1.2, public: 1.2, mid: 1.1, small: 1.0 };

  const DEFAULT_QUAL_BENCH = 295;  // 합격자 평균 정성 원점수 기본값(선배 데이터가 없을 때)
  const MAX_ACTIVITIES     = 6;    // 상위 몇 건까지 합산할지 (설문 대표활동 최대 9건)

  const mult = (map, key, dflt = 1) => (key != null && map[key] != null ? map[key] : dflt);

  /* 활동 1건의 원점수 = 기본배점 × 기간 × 역할(또는 단계) × 성과 */
  function scoreActivity(a) {
    if (!a || !a.type) return 0;
    const t = ACTIVITY_BY_ID[a.type];
    if (!t) return 0;
    let s = t.base;
    s *= mult(DURATION_MULT, a.duration);
    s *= (t.roleKind === 'stage') ? mult(STAGE_MULT, a.stage) : mult(ROLE_MULT, a.role);
    s *= mult(OUTCOME_MULT, a.outcome);
    if (a.type === 'internship') s *= mult(COMPANY_MULT, a.companyTier);
    return s;
  }

  /* 활동 배열 → 원점수 합 (상위 MAX_ACTIVITIES 건만) */
  function qualRaw(activities) {
    if (!Array.isArray(activities) || !activities.length) return 0;
    return activities.map(scoreActivity).sort((x, y) => y - x)
      .slice(0, MAX_ACTIVITIES).reduce((a, b) => a + b, 0);
  }

  /* 옛 스펙(boolean qual)도 활동 배열로 환산해 대략적으로라도 채점되게 한다.
     기간·역할·성과가 없으므로 배수는 모두 1로 두어 기본 배점만 반영된다. */
  const LEGACY_QUAL_MAP = {
    internship: 'internship', projects: 'project', extracurricular: 'extracurricular',
    oncampus: 'club', exchange: 'exchange', langStudy: 'exchange', gradSchool: 'research',
    coreCourses: null,
  };
  function normalizeActivities(spec) {
    if (Array.isArray(spec?.activities)) return spec.activities.filter(a => a && a.type);
    const q = spec?.qual;
    if (!q) return [];
    const acts = [];
    Object.keys(q).forEach(k => { if (q[k] && LEGACY_QUAL_MAP[k]) acts.push({ type: LEGACY_QUAL_MAP[k] }); });
    return acts;
  }

  /* 정성 CAS. benchRaw(합격자 평균 원점수) 대비 상대 위치로 채점.
       반환: { total, max, raw, benchRaw, ratio, count, byType } */
  function computeQual({ spec, benchRaw } = {}) {
    const acts = normalizeActivities(spec);
    const raw = qualRaw(acts);
    const bench = (benchRaw && benchRaw > 0) ? benchRaw : DEFAULT_QUAL_BENCH;
    const ratio = relativeScore(raw, bench) ?? 0;

    const byType = {};
    acts.forEach(a => {
      const s = scoreActivity(a);
      if (s > 0) byType[a.type] = (byType[a.type] || 0) + s;
    });

    return {
      total: Math.round(TOTAL_QUAL * ratio),
      max: TOTAL_QUAL,
      raw: Math.round(raw),
      benchRaw: Math.round(bench),
      ratio,
      count: acts.length,
      byType,
    };
  }

  // ── 정량:정성 동적 비율 ───────────────────────────────────────
  /* 기본은 4:6(정량 0.4)이지만, 어느 쪽이 상대적으로 더 강하냐에 따라 비중을
     4:6 중심으로 양방향 이동시킨다. 정성이 우세하면 최대 3:7(정량 0.3),
     정량이 우세하면 최대 5:5(정량 0.5). "정성 내용이 더 풍부하고 좋으면
     정량 비중이 3:7이 될 수도 있어야 한다"는 요구를 이 곡선으로 구현한다.

     성취도(perf) = 달성 점수 / 만점. 두 축을 같은 0~1 척도로 비교한다.
       d = qualPerf − quantPerf ∈ [−1, 1]
       d ≥ +SENS → 정성 완전 우세 → 정량 0.3 (3:7)
       d ≤ −SENS → 정량 완전 우세 → 정량 0.5 (5:5)
     SENS(민감도)만큼 벌어지면 한쪽 끝에 닿는다. */
  const SPLIT_BASE = 0.4;    // 기본 정량 비중 (4:6)
  const SPLIT_SWING = 0.1;   // 한쪽으로 최대 이동폭 (→ 0.3 또는 0.5)
  const SPLIT_SENS = 0.2;    // 이 성취도 차이에서 이동이 포화된다
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* 두 성취도를 받아 {quant, qual} 비중(합=1)을 낸다. quant ∈ [0.3, 0.5]. */
  function resolveSplit(quantPerf, qualPerf) {
    const d = (qualPerf || 0) - (quantPerf || 0);
    const quant = SPLIT_BASE - SPLIT_SWING * clamp(d / SPLIT_SENS, -1, 1);
    return { quant, qual: 1 - quant };
  }

  /* 정량 + 정성 통합 (CAS 1000점, 동적 비율).
       반환에 quantWeight/qualWeight(적용된 비율)와 각 축의 성취도를 함께 담아
       화면에서 "정성이 좋아 3:7이 적용됨" 같은 근거를 보여줄 수 있게 한다. */
  const CAS_TOTAL = TOTAL_QUANT + TOTAL_QUAL;  // 1000
  function computeTotal({ quant, qual } = {}) {
    const quantPerf = quant?.max ? (quant.total || 0) / quant.max : 0;
    const qualPerf  = qual?.max  ? (qual.total  || 0) / qual.max  : 0;
    const w = resolveSplit(quantPerf, qualPerf);

    const quantPts = Math.round(CAS_TOTAL * w.quant * quantPerf);
    const qualPts  = Math.round(CAS_TOTAL * w.qual  * qualPerf);

    return {
      total: quantPts + qualPts,
      max: CAS_TOTAL,
      quant: quantPts,
      qual: qualPts,
      quantWeight: Math.round(w.quant * 100) / 100,   // 예: 0.3
      qualWeight:  Math.round(w.qual  * 100) / 100,   // 예: 0.7
      quantPerf:   Math.round(quantPerf * 100) / 100,
      qualPerf:    Math.round(qualPerf  * 100) / 100,
    };
  }

  // ── 전공-직무 관련성 ────────────────────────────────────────
  /* 스펙의 학과(dept)를 전공명으로 바꾼 뒤, NCS 중분류의 '관련 전공' 목록과
     대조한다. ncs.js 는 '컴퓨터공학', '소프트웨어학' 처럼 학과의 '과'를 뗀
     이름을 쓰므로 부분 일치로 본다. 관련 전공이 비어 있는 중분류(전공 무관
     직무)는 학점을 깎을 이유가 없으므로 관련 있음으로 취급한다. */
  const DEPT_MAJOR = {
    business: '경영학', economics: '경제학', accounting: '회계학',
    cs: '컴퓨터공학', stat: '통계학', law: '법학',
    psych: '심리학', media: '미디어학',
  };

  function isMajorRelevant(dept, middleMajors) {
    if (!middleMajors || !middleMajors.length) return true;
    const mine = DEPT_MAJOR[dept];
    if (!mine) return true;               // 학과 정보가 없으면 불이익을 주지 않는다
    return middleMajors.some(m => m.includes(mine) || mine.includes(m));
  }

  /* ── 스펙을 '입력했다' 고 볼 수 있는가 ──────────────────────
     예전에는 화면들이 `spec.dept` 하나로 판단했다. 그런데 dept 는 **학과명에서
     자동으로 정하는 집계 분류**이고, 우리 통계는 8개 계열뿐이라 **간호·기계·어문
     같은 학과는 애초에 비어 있다**(spec-form.js 는 그래서 저장을 막지 않는다).

     그 결과 학점·어학·자격증·활동을 다 채운 사람에게 화면이 **"아직 스펙을 입력하지
     않았어요"** 라고 말했다(실측 2026-08-21, 사용자 지적 — JLPT·정보처리산업기사·
     정성스펙 2개를 넣었는데도 그렇게 떴다). 저장은 됐는데 없다고 하는 것이라,
     사용자는 자기가 뭘 잘못했는지 찾게 된다.

     '입력했다' 는 **본인이 채운 값이 하나라도 있는가**로 본다. dept 는 우리가 정하는
     값이지 사용자가 넣는 값이 아니다. */
  function hasAnySpec(s) {
    if (!s) return false;
    return Boolean(
      s.major
      || s.gpa != null
      || (s.certs && s.certs.length)
      || (s.scores && Object.keys(s.scores).length)
      || (s.activities && s.activities.length),
    );
  }

  const api = {
    computeQuant, resolveWeights, langIndex, relativeScore, certScore,
    isMajorRelevant, hasAnySpec, DEPT_MAJOR,
    TARGETS, TOTAL_QUANT, MIN_N_FOR_RATE,
    LANG_TESTS, FOREIGN_TESTS,
    // 정성
    computeQual, computeTotal, resolveSplit, scoreActivity, qualRaw, normalizeActivities,
    ACTIVITY_TYPES, TOTAL_QUAL, DURATION_MULT, ROLE_MULT, OUTCOME_MULT, STAGE_MULT,
    COMPANY_MULT, DEFAULT_QUAL_BENCH,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;  // node 테스트용
  root.CAS = api;

})(typeof window !== 'undefined' ? window : globalThis);
