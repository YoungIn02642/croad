// ════════════════════════════════════════════════════════════
//  C:road — CAS 히어로 (내 CAS 점수 / 백분위 / 등급)
//
//  cas.js 의 1000점 엔진을 화면에 처음으로 꽂는 자리다. 이전에는 careerly.html
//  에 87/100 이 하드코딩돼 있어 누가 로그인하든 같은 점수가 떴다.
//
//  ── 점수 ──
//    정량(400) + 정성(600) = 1000. 다만 두 축의 비중은 고정이 아니라
//    잘한 쪽에 더 실린다(4:6 기본, 3:7 ~ 5:5). CAS.computeTotal() 이 계산한다.
//
//  ── 백분위 ──
//    같은 조건 선배들에게 같은 채점을 돌려 나보다 낮은 사람의 비율을 센다.
//    "상위 12%" 는 그 여집합이다. 선배가 너무 적으면(MIN_PEERS 미만)
//    숫자가 요동쳐 오해를 부르므로 백분위를 아예 감춘다.
//
//  cas-radar.js 와 같은 벤치마크(좁게 → 넓게)를 쓴다. 두 화면이 다른 기준으로
//  계산되면 "레이더는 좋은데 점수는 낮다" 같은 설명 불가능한 상태가 된다.
// ════════════════════════════════════════════════════════════
window.CASHero = (() => {

  /* 이 인원 미만이면 백분위를 숨긴다. 3명 중 2등을 '상위 33%' 라고
     보여주는 건 정보가 아니라 착시다. */
  const MIN_PEERS = 5;

  const GRADES = [
    { min: 90, label: '탁월' },
    { min: 70, label: '우수' },
    { min: 40, label: '보통' },
    { min: 0,  label: '미흡' },
  ];

  const $ = id => document.getElementById(id);

  /* 스펙의 기업유형 → CAS 채점 타깃(private/startup/public).
     기업유형별로 무엇을 중시하는지가 달라 가중치가 갈린다. */
  function targetOf(spec) {
    const t = (Aggregator.CORP_TYPES || []).find(c => c.id === spec?.corpType);
    return t?.cas || 'private';
  }

  /* 한 스펙의 CAS 총점. 나와 선배 모두 같은 기준으로 매겨야 비교가 성립하므로
     벤치마크(agg)와 자격증 카탈로그를 공유한다. */
  function scoreOf(spec, agg, catalogIds) {
    const quant = CAS.computeQuant({
      spec,
      benchmark: agg,
      target: targetOf(spec),
      majorRelevant: true,   // 전공 적합성은 로드맵에서 따로 다룬다
      catalogIds,
    });
    const qual = CAS.computeQual({ spec, benchRaw: agg?.qualBenchRaw });
    return CAS.computeTotal({ quant, qual });
  }

  /* 나보다 점수가 낮은 선배의 비율(0~100). 동점은 절반만 센다 —
     같은 점수인데 한쪽이 일방적으로 앞선다고 보이지 않게. */
  function percentileOf(myTotal, peerTotals) {
    if (!peerTotals.length) return null;
    const below = peerTotals.filter(t => t < myTotal).length;
    const same  = peerTotals.filter(t => t === myTotal).length;
    return Math.round(((below + same / 2) / peerTotals.length) * 100);
  }

  const gradeOf = pct => (GRADES.find(g => pct >= g.min) || GRADES[GRADES.length - 1]).label;

  /* 적용된 비중을 사람 말로. computeTotal 이 이미 비중을 돌려주므로
     "왜 내 점수가 이렇게 나왔는지" 를 그대로 설명할 수 있다. */
  function splitText(t) {
    const q = Math.round(t.quantWeight * 10);
    const l = Math.round(t.qualWeight * 10);
    const ratio = `${q}:${l}`;
    if (q < 4) return `경험 스펙이 더 강해 <b>숫자 ${ratio} 경험</b> 비중이 적용됐어요.`;
    if (q > 4) return `숫자 스펙이 더 강해 <b>숫자 ${ratio} 경험</b> 비중이 적용됐어요.`;
    return `두 스펙이 고르게 있어 기본 비중 <b>숫자 ${ratio} 경험</b>이 적용됐어요.`;
  }

  /* 점수를 못 내는 상태(비로그인·스펙없음·선배없음)를 한 자리에서 처리한다.
     빈칸에 0 을 띄우면 "0점" 으로 오해하므로 무엇을 하면 되는지를 말해준다. */
  function showEmpty(msg, help) {
    if (window.CASCompare) CASCompare.render(null, null);
    /* 맨 위 띠도 함께 비운다. 안 비우면 직전 사용자의 점수가 그대로 남는다. */
    renderTwoScores(null);
    $('cas-score-num').textContent = '—';
    $('cas-rank').innerHTML = `<i class="ti ti-info-circle"></i>${msg}`;
    $('cas-split').innerHTML = '';
    $('cas-dist-label').textContent = '백분위 분포';
    $('cas-grade').textContent = '—';
    $('cas-dist-help').textContent = help || '';
    const fill = document.querySelector('.cas-bar-fill');
    const mark = document.querySelector('.cas-bar-marker');
    if (fill) fill.style.width = '0%';
    if (mark) mark.style.left = '0%';
    /* 점수를 못 내도 갈림길은 남는다 — 로그인·스펙 입력이 곧 '스펙 채우기' 쪽
       가지이고, 그 안내가 사라지면 여기서 흐름이 끊긴다.
       GAP 도 같이 비운다. 안 비우면 직전 사용자의 부족 항목이 남는다. */
    if (typeof window.renderGap === 'function') window.renderGap(window.currentGapType || 'cert');
    if (typeof window.renderRoadmapNext === 'function') window.renderRoadmapNext(null);
  }

  /* 저장된 값은 'cs' · 'backend' 같은 id 라 그대로 쓰면 화면에 영문이 노출된다.
     라벨은 스펙 입력 폼의 목록이 단일 출처다. */
  function labelOf(spec) {
    const SF = window.SpecForm || {};
    const dept = (SF.DEPTS || []).find(d => d.id === spec.dept)?.label || '내 전공';
    const jobPairs   = (SF.JOB_OPTIONS   || {})[spec.field] || [];
    const fieldPairs = (SF.FIELD_OPTIONS || {})[spec.dept]  || [];
    const job   = jobPairs.find(([id]) => id === spec.job)?.[1];
    const field = fieldPairs.find(([id]) => id === spec.field)?.[1];
    const sub = job || field;
    return sub ? `${dept} · ${sub} 기준` : `${dept} 기준`;
  }

  /* ── 비교 직무 셀렉트 ─────────────────────────────────────────
     이 칸은 **오랫동안 비어 있었다.** 원인은 하나가 아니라 셋이었다.

     | 상황 | 예전 결과 |
     |---|---|
     | 비로그인 · 스펙 없음 | showEmpty() 로 먼저 빠져나가 셀렉트를 아예 안 칠했다 → 빈 칸 |
     | 로드맵 직무 없음 | 옛 학과 기반 `SpecForm.JOB_OPTIONS[spec.field]` 인데 그 표가 비면 옵션 0개 |
     | 같은 1차 분류에 형제가 없음 | `Roadmap.siblings()` 결과 하나 → 고를 수 없는 셀렉트 |

     ── 무엇을 보여줄 것인가 ──
     비교의 단위는 **KECO 2차 분류(직무군) 35개**다. CAS 벤치마크·로드맵 STEP 03·
     GAP 이 전부 이 단위로 집계하므로(roadmap.js '해상도를 속이지 않는다'),
     셀렉트도 같은 단위여야 화면끼리 말이 맞는다. 1차 분류로 묶어 optgroup 에
     담으면 35개도 한눈에 들어온다.

     ── 어떻게 고르게 할 것인가 ──
     옵션마다 **그 직무군의 선배 표본 수**를 같이 적는다. 이게 이 화면의 핵심인데,
     선배가 0명인 직무군은 점수를 내도 비교가 성립하지 않기 때문이다. 고르기 전에
     보이면 "왜 계산이 안 되지" 가 "표본이 없구나" 로 바뀐다.

     고른 값은 `Roadmap.setJob()` 으로 흐름 상태에 심는다. CAS 만의 별도 선택을
     두면 로드맵과 CAS 가 서로 다른 직무를 목표라고 말하게 된다 — roadmap.js 를
     만든 이유가 바로 그 상태를 없애는 것이었다. */
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 분류를 한 번만 받아 온다. 실패해도 화면은 살아 있어야 하므로(점수는 학과 기준으로
     계속 낼 수 있다) 셀렉트에만 실패를 적고 넘어간다. */
  let kecoTried = false;
  let loadError = false;
  function ensureKeco() {
    if (KECO.ready() || kecoTried) return;
    kecoTried = true;
    KECO.load()
      .then(() => { loadError = false; render(); })
      .catch(() => { loadError = true; paintJobSelect(); });
  }

  /* 2차 분류별 선배 표본 수.
     Aggregator.compute() 를 35번 부르면 선배 1,000여 명의 정성 원점수를 그때마다
     다시 채점한다(compute 가 qualBenchRaw 를 만든다) — 여기서 필요한 건 개수뿐이라
     matcher 로 세기만 한다. */
  function peerCounts() {
    const specs = (typeof DB !== 'undefined' && DB.getAllSpecs()) || [];
    const out = {};
    KECO.MAJORS().forEach(m => (m.middles || []).forEach(mid => {
      const fn = KECO.middleMatcher(m.code, mid.code);
      out[`${m.code}:${mid.code}`] = fn ? specs.filter(fn).length : 0;
    }));
    return out;
  }

  /* 값은 `1차:2차` 다. 2차 분류 코드만 담으면 다른 1차 분류의 직무군으로는 옮겨갈 수
     없고(예전 siblings 방식의 한계), 학과 기반 화면에서 넘어온 사람은 시작점이 없다. */
  function paintJobSelect() {
    const select = $('cas-job-select');
    if (!select) return;

    if (!KECO.ready()) {
      select.innerHTML = `<option value="">${loadError ? '직무 목록을 불러오지 못했어요' : '직무 목록 불러오는 중…'}</option>`;
      select.disabled = true;
      return;
    }

    const rm = Roadmap.get();
    const cur = rm ? `${rm.major}:${rm.middle}` : '';
    const counts = peerCounts();

    const groups = KECO.MAJORS().map(m => {
      const opts = (m.middles || []).map(mid => {
        const key = `${m.code}:${mid.code}`;
        const n = counts[key] || 0;
        return `<option value="${key}"${key === cur ? ' selected' : ''}>`
             + `${esc(mid.name)} · 선배 ${n}명</option>`;
      }).join('');
      return `<optgroup label="${esc(`${m.emoji} ${m.name}`)}">${opts}</optgroup>`;
    }).join('');

    select.disabled = false;
    select.innerHTML = (cur ? '' : `<option value="" selected>직무군을 골라 주세요</option>`) + groups;
  }

  /* ── 로드맵 직무 기준 벤치마크 ────────────────────────────────
     career.js STEP 03 과 **같은 matcher·같은 certKey** 를 쓴다(Roadmap.bench()).
     로드맵에서 "선배 n명" 을 보고 넘어왔는데 여기서 다른 n 이 뜨면, 학생은 어느
     숫자를 믿어야 할지 알 수 없다.

     표본이 0이면 넓히지 않고 null 을 돌려준다 — 옛 학과 기준으로 조용히 물러서면
     화면은 '이 직무 점수' 라고 적힌 채 다른 모집단의 점수를 보여주게 된다. */
  function roadmapBenchmark() {
    const b = Roadmap.bench();
    if (!b) return null;
    const agg = Aggregator.compute({ where: b.where, certKey: b.certKey });
    return { ...b, agg: agg.empty ? null : agg };
  }

  /* ── 지금 무엇과 비교하고 있는가 ──────────────────────────────
     화면을 그리지 않고 **모집단만 정한다.** CAS 화면과 스펙업 화면이 각자 이 판단을
     하면 "CAS 는 정보통신 직무군 기준인데 스펙업은 컴퓨터공학과 기준" 같은, 사용자가
     설명할 수 없는 상태가 생긴다. 한 함수에서 정하고 둘 다 그걸 쓴다.

     성공하면 `{ ok:true, ctx }`, 못 하면 **왜 못 하는지**를 돌려준다. 빈 화면만
     주면 '부족한 게 없다' 로 읽히기 때문이다(mentoring.js gapContext 와 같은 원칙).

     ── 어느 직무로 채점할 것인가 ────────────────────────────
     목표 직무가 있으면 **그 직무가 이긴다.** 없을 때만 스펙에 저장된 학과·직무로
     채점하고, 화면에도 "○○학과 기준" 이라고 적는다.

     ── 조용히 다른 모집단으로 물러서지 않는다 ──
     예전에는 목표 직무의 선배 표본이 0명이면 말없이 학과 기준으로 내려갔다.
     위쪽 목표 칩은 '○○ 직무군' 이라고 적혀 있는데 점수는 다른 집단에서 나온
     셈이라, 숫자가 왜 그런지 설명할 수 없었다(작업정리 6-3 '조용히 틀리는 곳').
     이제는 계산을 접고 왜 접었는지 적는다. 셀렉트에 직무군마다 선배 수가 붙어
     있으므로 바로 그 자리에서 표본이 있는 직무군으로 옮겨갈 수 있다. */
  function resolveContext() {
    const user = DB.currentUser();
    if (!user) {
      return { ok: false, reason: 'login', msg: '로그인하면 내 CAS 점수를 볼 수 있어요.',
        help: '로그인 후 스펙을 입력하면 선배 데이터와 비교해 점수를 계산해 드려요.' };
    }
    const savedSpec = DB.getSpec(user.username);
    /* dept 로 판단하지 않는다 — 그건 우리가 학과명에서 자동으로 정하는 집계 분류라
       간호·어문처럼 계열 통계가 없는 학과는 애초에 비어 있다(cas.js hasAnySpec). */
    if (!CAS.hasAnySpec(savedSpec)) {
      return { ok: false, reason: 'spec', msg: '아직 스펙을 입력하지 않았어요.',
        help: '마이페이지에서 학점·어학·경험을 입력하면 점수가 계산됩니다.' };
    }

    const rm = Roadmap.get();

    /* 목표 직무가 있으면 **dept 없이도 채점된다** — roadmapBenchmark 는 로드맵이 정한
       모집단만 쓴다. 그래서 dept 검사는 이 뒤에 둔다. 앞에 두었더니 계열 통계가 없는
       학과 사람이 목표 직무를 골라 놓고도 "스펙을 입력하지 않았어요" 를 봤다. */
    if (rm && KECO.ready()) {
      const b = roadmapBenchmark();
      if (!b || !b.agg) {
        const label = rm.middleName || rm.jobName || '이 직무군';
        return { ok: false, reason: 'no-peers', msg: `${label} 선배 데이터가 아직 없어요.`,
          help: '위 ‘비교 직무’ 에서 선배 수가 있는 직무군을 고르면 그 기준으로 계산해 드려요. '
              + '이 직무군은 데이터가 쌓이는 대로 열립니다.' };
      }
      return { ok: true, ctx: {
        spec: savedSpec, agg: b.agg,
        scopeLabel: b.label,                              // '○○ 직무군'
        catalogIds: (Aggregator.CERT_CATALOG[b.certKey] || []).map(c => c.id),
        roadmap: rm, source: 'roadmap',
      } };
    }

    /* 여기부터는 **저장된 학과 기준**이다. 계열 통계가 없으면 낼 수 없는데, 그건
       스펙이 없는 것과 다른 상황이라 다르게 말한다 — 저장은 됐다고 분명히 알린다. */
    if (!savedSpec.dept) {
      return { ok: false, reason: 'no-dept', msg: '이 학과는 아직 계열 통계가 없어요.',
        help: '스펙은 저장돼 있어요. 위 ‘비교 직무’ 에서 목표 직무군을 고르면 '
            + '그 직무 선배들과 비교해 점수를 내 드립니다.' };
    }

    /* 벤치마크는 좁은 조건부터(직무 → 분야 → 학과) 넓혀 간다.
       레이더는 '비어 있을 때만' 넓히지만 여기서는 MIN_PEERS 를 채울 때까지 넓힌다 —
       백분위는 모집단이 곧 신뢰도라, 같은 직무 1명과 비교한 순위는 의미가 없다.
       끝까지 못 채우면 가장 넓은 집계를 쓴다 — 어차피 백분위를 못 낼 상황이면
       1명짜리 평균보다 학과 전체 평균이 점수 기준으로 덜 흔들린다. */
    const steps = [
      { dept: savedSpec.dept, field: savedSpec.field, job: savedSpec.job },
      { dept: savedSpec.dept, field: savedSpec.field },
      { dept: savedSpec.dept },
    ];
    const aggs = steps.map(q => Aggregator.compute(q)).filter(a => !a.empty);
    if (!aggs.length) {
      return { ok: false, reason: 'no-peers', msg: '비교할 선배 데이터가 아직 없어요.',
        help: '같은 학과·직무 선배 데이터가 쌓이면 점수와 백분위가 표시됩니다. '
            + '위 ‘비교 직무’ 에서 다른 직무군을 골라 볼 수도 있어요.' };
    }
    /* 저장된 직무 데이터가 한 명이라도 있으면 그 직무를 그대로 쓴다.
       예전처럼 5명을 채우려고 분야·학과로 넓히면 직무를 바꿔도 점수가 같아진다. */
    return { ok: true, ctx: {
      spec: savedSpec, agg: aggs[0],
      scopeLabel: labelOf(savedSpec).replace(' 기준', ''),
      catalogIds: (Aggregator.CERT_CATALOG[savedSpec.dept] || []).map(c => c.id),
      roadmap: rm, source: 'spec',
    } };
  }

  // ── 진입점 ──────────────────────────────────────────────────
  function render() {
    if (!$('cas-hero')) return;
    window.CASDashboardContext = null;
    Roadmap.mount('rm-bar-dashboard', 'me');

    /* 직무 분류(200KB)는 로드맵을 열 때만 받는다. #dashboard 로 바로 들어오면
       아직 없다. 예전에는 '로드맵 직무가 있을 때만' 받았는데, 이제는 **비교 직무
       셀렉트 자체가 이 분류로 만들어지므로** 이 화면에 들어오면 늘 받아 온다.
       받는 동안 셀렉트는 '불러오는 중' 이고, 오면 다시 그린다. */
    ensureKeco();

    /* 직무 적합도 칸 — 선배 비교와 다른 질문에 답하는 자리라, 아래 화면의
       성공·실패와 무관하게 늘 그린다(선배가 0명이어도 적합도는 나온다). */
    if (window.CASFit) CASFit.render();

    /* 셀렉트는 점수를 못 내는 상태에서도 반드시 칠한다 — 아래 showEmpty 갈래로
       빠져나가면서 이걸 건너뛴 것이 '비교 직무가 빈 칸' 의 직접 원인이었다. */
    paintJobSelect();

    const resolved = resolveContext();
    if (!resolved.ok) {
      if (resolved.reason === 'no-peers') renderNext(null);
      return showEmpty(resolved.msg, resolved.help);
    }

    const { spec, agg, scopeLabel, catalogIds } = resolved.ctx;
    window.CASDashboardContext = resolved.ctx;

    const mine = scoreOf(spec, agg, catalogIds);
    renderTwoScores(mine);

    /* 아래 비교 카드도 같은 벤치마크로 그린다 — 모집단이 다르면
       "상위 30% 인데 전 항목이 평균 이하" 같은 모순이 생긴다. */
    if (window.CASCompare) CASCompare.render(spec, agg);
    if (typeof window.renderGap === 'function') window.renderGap(window.currentGapType || 'cert');

    // 점수 + 구성
    $('cas-score-num').textContent = mine.total;
    $('cas-split').innerHTML =
      `숫자 스펙 <b>${mine.quant}</b> + 경험 스펙 <b>${mine.qual}</b><br>${splitText(mine)}`;

    /* 백분위 — 조건에 걸린 스펙 전체를 모집단으로 둔다.
       /api/specs 는 익명화돼 userId 가 없어서 내 스펙만 골라 빼낼 수단이 없다.
       분포에 자기 자신을 포함하는 건 백분위의 표준 정의이기도 하다. */
    const peerTotals = (agg.specs || []).map(s => scoreOf(s, agg, catalogIds).total);
    $('cas-dist-label').textContent = scopeLabel + ' 백분위 분포';

    if (peerTotals.length < MIN_PEERS) {
      $('cas-rank').innerHTML = '';
      $('cas-grade').textContent = '—';
      $('cas-dist-label').textContent = scopeLabel + ' CAS 점수';
      $('cas-dist-help').textContent = '';
      document.querySelector('.cas-bar-fill').style.width = '0%';
      document.querySelector('.cas-bar-marker').style.left = '0%';
      renderNext(mine);
      return;
    }

    const pct = percentileOf(mine.total, peerTotals);
    const top = Math.max(1, 100 - pct);
    $('cas-rank').innerHTML = `<i class="ti ti-trophy"></i>${scopeLabel} 상위 ${top}%`;
    $('cas-grade').textContent = gradeOf(pct) + ' 등급';
    $('cas-dist-help').innerHTML =
      `나와 같은 길을 준비한 선배 <b>${peerTotals.length}명</b>을 점수 낮은 순으로 줄 세웠을 때 내 위치예요.`;

    renderNext(mine, pct);

    requestAnimationFrame(() => setTimeout(() => {
      document.querySelector('.cas-bar-fill').style.width = pct + '%';
      document.querySelector('.cas-bar-marker').style.left = pct + '%';
    }, 80));
  }

  /* ── 맨 위 두 점수 띠 (#cas-two) ────────────────────────────
     2026-08-22, 사용자 지시. 아래에 적합도 카드와 CAS 카드가 따로 있는데도
     "둘 다 보여 달라" 는 말이 나온 이유는, 적합도가 직업을 골라야 계산되는 값이라
     보통은 안내문 한 칸이고 그래서 **화면에 점수가 하나뿐인 것으로 읽히기** 때문이다.

     ── 숫자를 여기서 다시 계산하지 않는다 ──
     적합도는 CASFit.summary(), CAS 는 이 파일의 scoreOf() 결과를 받아 적기만 한다.
     띠가 따로 계산하면 위아래 숫자가 갈리고, 학생은 어느 쪽이 맞는지 알 수 없다.

     ── 두 점수는 다른 질문에 답한다 ──
     한 줄에 나란히 두면 합계처럼 읽힐 수 있어서, 칸마다 무엇에 답하는 점수인지
     한 줄로 적는다(cas-fit.js 머리주석의 구분과 같은 말). */
  let _lastMine = null;        // 마지막으로 계산한 CAS 점수. 띠만 다시 그릴 때 쓴다

  function renderTwoScores(mine) {
    _lastMine = mine;
    const host = $('cas-two');
    if (!host) return;

    const fit = window.CASFit ? CASFit.summary() : null;
    const fitVal =
      !fit                ? { num: '—', sub: '직업을 고르면 계산돼요' }
      : fit.loading       ? { num: '…',  sub: '계산 중이에요' }
      : fit.error         ? { num: '—', sub: '계산하지 못했어요' }
      : { num: fit.total, sub: `${fit.jobName} 기준${fit.grade ? ` · ${fit.grade}` : ''}` };

    const casVal = mine
      ? { num: mine.total, sub: `숫자 스펙 ${mine.quant} + 경험 스펙 ${mine.qual}` }
      : { num: '—', sub: '스펙을 입력하면 계산돼요' };

    host.innerHTML = `
      <div class="cas-two-item">
        <div class="cas-two-lab">직무 적합도</div>
        <div class="cas-two-num">${esc(fitVal.num)}<span>/ 1000</span></div>
        <div class="cas-two-sub">${esc(fitVal.sub)}</div>
        <div class="cas-two-q">이 일에 내가 맞나</div>
      </div>
      <div class="cas-two-item">
        <div class="cas-two-lab">CAS 점수</div>
        <div class="cas-two-num">${esc(casVal.num)}<span>/ 1000</span></div>
        <div class="cas-two-sub">${esc(casVal.sub)}</div>
        <div class="cas-two-q">선배들 사이에서 내가 어디쯤인가</div>
      </div>`;
  }

  /* 2단계의 갈림길은 mentoring.js 가 그린다(GAP 계산과 같은 자리에 있어야
     '무엇이 부족한지' 와 '그래서 어디로 갈지' 가 어긋나지 않는다). */
  function renderNext(mine, pct) {
    if (typeof window.renderRoadmapNext === 'function') window.renderRoadmapNext(mine, pct);
  }

  /* 셀렉트 값은 `1차:2차` 다. 고른 직무군을 **흐름 상태에 심는다** — CAS 만의 별도
     선택으로 두면 회사 찾기·자소서 코치가 여전히 옛 직무를 본다. 갈아 끼우는 규칙
     (직업 단위 선택을 비운다 · 같은 것을 다시 고르면 그대로 둔다)은 흐름 상태를
     가진 쪽이 안다 — Roadmap.switchMiddle 하나만 쓴다. */
  function selectJob(value) {
    const [major, middle] = String(value || '').split(':');
    if (!major || !middle || !KECO.ready()) return;

    Roadmap.switchMiddle(middle, major);

    /* 직무가 바뀌면 적합도는 통째로 다른 직업의 점수가 된다 — 캐시를 버린다. */
    if (window.CASFit) CASFit.reset();
    render();
    if (window.CASRadar) CASRadar.render();
    if (typeof window.animateDashboard === 'function') window.animateDashboard();
  }

  /* 적합도는 서버 응답을 기다렸다 늦게 채워진다. 그때 맨 위 띠만 다시 그리라고
     cas-fit.js 가 이걸 부른다 — render() 를 통째로 다시 부르면 아래 카드가
     전부 다시 그려지고, 적합도 안에서 CASHero.render 를 부르면 서로 물린다. */
  function paintTwo() { renderTwoScores(_lastMine); }

  return { render, selectJob, scoreOf, percentileOf, resolveContext, ensureKeco, paintTwo };
})();
