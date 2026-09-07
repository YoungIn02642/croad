// ════════════════════════════════════════════════════════════
//  C:road — CAS 직무역량 레이더
//
//  "이 직무가 요구하는 역량"(합격자 데이터)과 "내가 채운 정도"를 한 다각형
//  위에 겹쳐 보여준다. 요구 수준은 직무마다 다르므로(합격자 분포가 다름)
//  직무를 바꾸면 바깥 다각형의 모양이 달라진다.
//
//  6개 축: 학점 · 봉사활동 · 어학 · 자격증 · 대내활동 · 대외활동.
//  활동 분류와 복합 어학 계산은 cas-profile.js 를 단일 출처로 쓴다.
//
//  각 축은 0~100. me(내 수준)와 req(합격자/요구 수준)를 같은 척도로 둔다.
// ════════════════════════════════════════════════════════════
window.CASRadar = (() => {

  const AXES = CASProfile.GROUPS;

  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

  /* 모든 축을 '선배 평균=80'인 동일 상대척도로 변환한다. 활동을 한 번 했다는 이유로
     무조건 100점이 되던 기존 보유 여부 방식 대신 횟수·기간·성과를 함께 반영한다. */
  function buildValues(spec, agg) {
    const values = {};
    for (const ax of AXES) {
      const c = CASProfile.comparison(spec, agg, ax.key);
      values[ax.key] = { me: clamp((c.ratio || 0) * 100), req: c.peer > 0 ? 80 : 0 };
    }
    return values;
  }

  // ── SVG 렌더 ────────────────────────────────────────────────
  function polygon(cx, cy, R, ratios) {
    return AXES.map((_, i) => {
      const a = (Math.PI / 180) * (i * (360 / AXES.length) - 90);
      const r = R * clamp(ratios[i], 0, 100) / 100;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
  }

  function svg(values) {
    const size = 300, cx = size / 2, cy = size / 2, R = 108;
    const rings = [0.25, 0.5, 0.75, 1];

    // 격자
    let grid = rings.map(r =>
      `<polygon points="${polygon(cx, cy, R, AXES.map(() => r * 100))}"
        fill="none" stroke="var(--c-border, #e5e5e8)" stroke-width="1"/>`).join('');
    // 축선 + 라벨
    let axes = '', labels = '';
    AXES.forEach((ax, i) => {
      const a = (Math.PI / 180) * (i * (360 / AXES.length) - 90);
      const ex = cx + Math.cos(a) * R, ey = cy + Math.sin(a) * R;
      axes += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"
        stroke="var(--c-border, #e5e5e8)" stroke-width="1"/>`;
      const lx = cx + Math.cos(a) * (R + 22), ly = cy + Math.sin(a) * (R + 22);
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      const req = Math.round(values[ax.key].req ?? 0);
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}"
        dominant-baseline="middle" font-size="12" font-weight="600"
        fill="var(--c-ink, #080808)">${ax.label}</text>
        <text x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="${anchor}"
        dominant-baseline="middle" font-size="10"
        fill="var(--c-ink3, #8a8a8a)">요구 ${req}</text>`;
    });

    const reqPts = polygon(cx, cy, R, AXES.map(ax => values[ax.key].req ?? 0));
    const mePts  = polygon(cx, cy, R, AXES.map(ax => values[ax.key].me  ?? 0));

    // 라벨이 원(300×300) 밖으로 나가므로 좌우 위아래 여백을 둔 viewBox 를 쓴다.
    const pad = 54;
    return `
      <svg viewBox="${-pad} ${-20} ${size + pad * 2} ${size + 36}" width="100%"
        style="max-width:420px;display:block;margin:0 auto">
        ${grid}${axes}
        <polygon points="${reqPts}" fill="rgba(109,58,255,0.06)"
          stroke="var(--brand, #6d3aff)" stroke-width="1.5" stroke-dasharray="4 3"/>
        <polygon points="${mePts}" fill="rgba(0,168,58,0.16)"
          stroke="#00a83a" stroke-width="2"
          style="transition:none">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze"/>
        </polygon>
        ${labels}
      </svg>`;
  }

  function legendAndGaps(values) {
    // 요구 대비 가장 부족한 축을 짚어준다
    const gaps = AXES
      .map(ax => ({ label: ax.label, gap: (values[ax.key].req ?? 0) - (values[ax.key].me ?? 0) }))
      .filter(g => g.gap > 8)
      .sort((a, b) => b.gap - a.gap);
    const tip = gaps.length
      ? `가장 부족한 역량: <b>${gaps.slice(0, 2).map(g => g.label).join(', ')}</b> — 이 부분을 채우면 CAS 가 오릅니다.`
      : `요구 수준을 대부분 충족했어요. 정성 스펙의 깊이(성과·기간)로 차별화해 보세요.`;
    return `
      <div class="radar-legend">
        <span class="rl"><span class="rl-sw me"></span>내 역량</span>
        <span class="rl"><span class="rl-sw req"></span>이 직무 요구 수준 (합격자 기준)</span>
      </div>
      <div class="radar-tip">${tip}</div>`;
  }

  // ── 진입점 ──────────────────────────────────────────────────
  function render() {
    const card = document.getElementById('cas-radar-card');
    if (!card) return;

    const user = DB.currentUser();
    const spec = user ? (window.CASDashboardContext?.spec || DB.getSpec(user.username)) : null;

    const head = `<div class="radar-head"><i class="ti ti-radar-2"></i>직무역량 레이더</div>`;

    if (!user) {
      card.innerHTML = head + emptyState('로그인하고 스펙을 입력하면',
        '희망 직무가 요구하는 역량과 내가 채운 정도를 한눈에 볼 수 있어요.', 'login', '로그인하기');
      return;
    }
    /* dept 로 판단하지 않는다 — 그건 학과명에서 자동으로 정하는 집계 분류라
       계열 통계가 없는 학과(간호·어문…)는 비어 있다(cas.js hasAnySpec). */
    if (!CAS.hasAnySpec(spec)) {
      card.innerHTML = head + emptyState('아직 스펙을 입력하지 않았어요',
        '학점·어학·자격증과 경험을 입력하면 직무역량 레이더가 그려집니다.', 'mypage', '스펙 입력하기');
      return;
    }

    // 저장된 스펙의 직무(dept/field/job)로 같은 직무 합격자 벤치마크를 낸다.
    // 좁게 시작해 데이터가 없으면 넓힌다.
    let agg = window.CASDashboardContext?.agg;
    /* 위 CAS 카드가 목표 직무로 모집단을 정했으면 그걸 그대로 쓴다(dept 가 없어도 된다).
       그것도 없고 계열 통계도 없으면 그릴 기준이 없다 — '스펙이 없다' 와는 다른 말이다. */
    if (!agg && !spec.dept) {
      card.innerHTML = head + emptyState('이 학과는 아직 계열 통계가 없어요',
        '직무 찾기에서 목표 직무를 고르면 그 직무 기준으로 레이더가 그려집니다.', 'career', '목표 직무 고르기');
      return;
    }
    if (!agg) agg = Aggregator.compute({ dept: spec.dept, field: spec.field, job: spec.job });
    if (agg.empty) agg = Aggregator.compute({ dept: spec.dept, field: spec.field });
    if (agg.empty) agg = Aggregator.compute({ dept: spec.dept });

    if (agg.empty) {
      card.innerHTML = head + emptyState('비교할 선배 데이터가 아직 없어요',
        '같은 직무 합격자 데이터가 쌓이면 요구 역량이 표시됩니다.', 'career', '직무 찾기로 가기');
      return;
    }

    const values = buildValues(spec, agg);

    /* 어느 집단의 요구 수준인지는 히어로가 정한 것과 같은 말로 적는다. 로드맵에서
       넘어오면 '○○ 직무군', 아니면 저장된 스펙 기준이다 — 두 화면이 같은 모집단을
       쓰면서 이름만 다르게 부르면 학생은 서로 다른 통계로 읽는다. */
    const scope = window.CASDashboardContext?.scopeLabel;
    card.innerHTML = `
      ${head}
      <div class="radar-scope">${scope ? `${scope} ` : '같은 직무 '}합격자 <b>${agg.count}명</b> 기준${agg.count < CAS.MIN_N_FOR_RATE ? ' · <span class="radar-warn">표본이 적어 참고용</span>' : ''}</div>
      ${svg(values)}
      ${legendAndGaps(values)}`;
  }

  function emptyState(title, desc, page, cta) {
    return `
      <div class="radar-empty">
        <div class="radar-empty-ic">📊</div>
        <div class="radar-empty-title">${title}</div>
        <div class="radar-empty-desc">${desc}</div>
        <button class="radar-empty-cta" onclick="navigate('${page}')">${cta} →</button>
      </div>`;
  }

  return { render, AXES };
})();
