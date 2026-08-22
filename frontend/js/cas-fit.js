// ════════════════════════════════════════════════════════════
//  C:road — 직무 적합도 (CAS 2단계 상단)
//
//  ── 무엇을 보여주나 ──
//  "이 직업이 실제로 요구하는 것을 내가 갖췄는가" 를 1000점으로 보여준다.
//  기준은 임금직업정보시스템의 **업무특성**이다(재직자 설문으로 만든 항목별 0~100).
//
//  ── 아래 선배 비교 화면과 무엇이 다른가 ──
//  이 점수는 선배와 비교하지 않는다. 그래서 **선배가 0명인 직무에서도 답이 나온다** —
//  예전 CAS 가 가장 자주 막히던 자리다. 아래의 레이더·스펙 비교·부족 항목은 여전히
//  선배 데이터 기반이라 그대로 두었다. 둘은 다른 질문에 답한다:
//    이 칸  → "이 일에 내가 맞나"
//    아래   → "같은 길을 간 사람들 사이에서 내가 어디쯤인가"
//  섞어 읽지 않게 화면에도 그렇게 적는다.
//
//  ── 점수는 서버가 낸다 ──
//  AI 는 "내 활동이 이 특성을 뒷받침하는가" 매칭만 하고, 점수는 backend/src/cas-fit.js
//  가 가중치표로 계산한다(작업정리 6장·9장 원칙). 화면은 받은 숫자를 그리기만 한다 —
//  여기서 다시 계산하면 두 곳이 갈린다.
// ════════════════════════════════════════════════════════════
window.CASFit = (() => {

  let _state = null;          // { loading } | 서버 응답 | { error }
  /* 지금 담긴 결과가 **어느 직업 · 어느 스펙** 것인지.
     예전에는 직업 코드만 담았다. 그래서 스펙을 새로 넣어도 직업이 그대로면 캐시가
     살아 있어, 스펙이 없던 시절의 '아직 근거 없음' 이 계속 보였다(저장은 됐는데
     화면만 안 바뀐다 — 사용자에게는 채점이 고장난 것으로 보인다).
     스펙 지문은 db.js 가 만든다 — 서버로 보내는 필드와 같은 곳에 두어야 갈리지 않는다. */
  let _forKey = null;
  let _openAxis = null;       // 펼친 축

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const host = () => document.getElementById('cas-fit');

  /* 강도(0~3) → 화면 말. 0 은 '아직'이지 '못한다'가 아니다. */
  const STRENGTH_TEXT = {
    3: { label: '직접 경험', cls: 'is-3' },
    2: { label: '비슷한 경험', cls: 'is-2' },
    1: { label: '스친 정도', cls: 'is-1' },
    0: { label: '아직 근거 없음', cls: 'is-0' },
  };

  function render() {
    const el = host();
    if (!el) return;

    const rm = Roadmap.get();
    /* 직업까지 골라야 채점할 수 있다. 2차 분류만으로는 업무특성이 없다 —
       업무특성은 직업(461개) 단위 자료다. */
    if (!rm?.job) {
      el.innerHTML = card(`
        <div class="fit-empty">
          <div class="fit-empty-ic">🧭</div>
          <div class="fit-empty-t">직업을 고르면 적합도를 계산해요</div>
          <div class="fit-empty-d">커리어 로드맵 1단계에서 <b>직업</b>까지 고르면,
            그 직업이 요구하는 업무특성과 내 경험을 견줘 점수를 냅니다.
            2차 분류만으로는 계산할 수 없어요 — 업무특성은 직업 단위 자료입니다.</div>
          <button type="button" class="fit-btn" onclick="navigate('career')">직무 찾기로 →</button>
        </div>`);
      return;
    }

    if (_forKey !== keyOf(rm)) request(rm);

    if (!_state || _state.loading) {
      el.innerHTML = card(`<div class="fit-loading">
        <b>${esc(rm.jobName || '이 직업')}</b>의 업무특성과 내 경험을 맞춰 보는 중…
      </div>`);
      return;
    }
    if (_state.error) {
      el.innerHTML = card(`<div class="fit-note">
        <i class="ti ti-alert-triangle"></i>
        <div><b>${esc(_state.error)}</b>${_state.how ? `<br><span>${esc(_state.how)}</span>` : ''}</div>
      </div>`);
      /* 실패도 띠에 알려야 한다. 안 그러면 위쪽은 '계산 중' 인 채로 멈춰 있다. */
      if (window.CASHero?.paintTwo) CASHero.paintTwo();
      return;
    }

    el.innerHTML = card(head(_state) + axesHtml(_state) + gapsHtml(_state) + foot(_state));
    /* 맨 위 두 점수 띠에도 같은 값을 올린다. 적합도는 서버 응답을 기다렸다 늦게
       채워지므로, 여기서 알려주지 않으면 띠만 '계산 중' 인 채로 남는다. */
    if (window.CASHero?.paintTwo) CASHero.paintTwo();
    bind(el);
  }

  const card = inner => `<div class="card fit-card">${inner}</div>`;

  function head(r) {
    const pct = r.percent;
    return `
      <div class="fit-head">
        <div class="fit-score">
          <div class="fit-score-lab">직무 적합도 · ${esc(r.jobName)}</div>
          <div class="fit-score-row">
            <span class="fit-score-num">${r.total}</span><span class="fit-score-max">/ ${r.max}</span>
            <span class="fit-grade">${esc(r.grade)}</span>
          </div>
          <div class="fit-bar"><i style="width:${pct}%"></i></div>
          <div class="fit-score-sub">
            임금직업정보시스템의 <b>업무특성</b>을 기준으로, 내 활동·자격이 각 항목을
            얼마나 뒷받침하는지 계산했어요.
            ${r.matchCount ? `근거가 붙은 항목 <b>${r.matchCount}개</b>.` : ''}
          </div>
          ${r.notice ? `<div class="fit-notice">${esc(r.notice)}
            ${RETRYABLE.has(r.aiStatus) ? '<button type="button" class="fit-btn" data-retry>다시 시도</button>' : ''}
          </div>` : ''}
        </div>
      </div>`;
  }

  /* 축은 접어 둔다. 7축 × 5항목을 다 펴면 화면이 표가 되고, 학생이 볼 것은
     "어느 축이 약한가" 하나다. 누르면 그 축의 항목과 근거가 열린다. */
  function axesHtml(r) {
    return `<div class="fit-axes">${r.axes.map(a => {
      const on = _openAxis === a.key;
      return `
      <div class="fit-axis ${on ? 'is-open' : ''}">
        <button type="button" class="fit-axis-h" data-axis="${esc(a.key)}">
          <span class="fit-axis-t"><b>${esc(a.label)}</b><span>${esc(a.what || '')}</span></span>
          <span class="fit-axis-n">${a.points}<small>/${a.weight}</small></span>
          <span class="fit-axis-bar"><i style="width:${a.ratio}%"></i></span>
          <i class="ti ti-chevron-down"></i>
        </button>
        <div class="fit-axis-body">
          ${a.detail.map(d => {
            const st = STRENGTH_TEXT[d.strength] || STRENGTH_TEXT[0];
            return `
            <div class="fit-item">
              <div class="fit-item-h">
                <b>${esc(d.name)}</b>
                <span class="fit-imp" title="이 직업에서의 중요도">중요도 ${d.importance}</span>
                <span class="fit-str ${st.cls}">${st.label}</span>
              </div>
              ${d.evidence
                ? `<div class="fit-ev">${esc(d.evidence)}${d.from ? ` <span class="fit-from">— ${esc(d.from)}</span>` : ''}</div>`
                : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  /* 점수만 보여주면 학생이 할 수 있는 일이 없다. 중요도가 높은데 근거가 없는 것부터. */
  function gapsHtml(r) {
    if (!r.gaps?.length) return '';
    return `
      <div class="fit-gaps">
        <div class="fit-gaps-h">무엇부터 채우면 오를까</div>
        <div class="fit-gap-rows">
          ${r.gaps.map(g => `
            <div class="fit-gap">
              <span class="fit-gap-name">${esc(g.name)}</span>
              <span class="fit-gap-axis">${esc(g.axisLabel)}</span>
              <span class="fit-gap-imp">중요도 ${g.importance}</span>
            </div>`).join('')}
        </div>
        <p class="fit-hint">이 직업에서 중요도가 높은데 <b>아직 근거가 없는</b> 항목이에요.
          <a onclick="navigate('specup')">스펙UP</a>에서 무엇을 신청할지 고를 수 있어요.</p>
      </div>`;
  }

  function foot(r) {
    return `<p class="fit-src">
      업무특성 출처: 임금직업정보시스템(고용노동부·한국고용정보원) · 항목별 점수는 재직자 설문값이에요.
      ${r.model ? `매칭에 ${esc(r.model)} 를 썼고, <b>점수 계산은 코드가</b> 합니다 — 같은 입력이면 같은 점수가 나와요.` : ''}
    </p>`;
  }

  /* '다시 누르면 되는' 실패만 버튼을 준다 — 쿼터 초과(429)·시간 초과(504)·일시 오류(502).
     키 오타나 폐기된 모델(503)은 몇 번을 눌러도 같으므로 버튼을 만들지 않는다. 되지도
     않는 버튼을 주면 사용자가 원인을 찾는 대신 계속 누른다. */
  const RETRYABLE = new Set([429, 502, 504]);

  function bind(el) {
    const again = el.querySelector('[data-retry]');
    /* 캐시 키를 비우고 다시 그린다 — 직업도 스펙도 그대로라 키만으로는 다시 부르지
       않는다(그게 캐시의 목적이다). 실패한 결과를 들고 갇히지 않게 하는 유일한 통로다. */
    if (again) again.addEventListener('click', () => { _forKey = null; render(); });

    el.querySelectorAll('[data-axis]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.axis;
      _openAxis = _openAxis === k ? null : k;
      render();
    }));
  }

  /* 같은 직업 · 같은 스펙이면 다시 부르지 않는다. 매칭은 AI 호출이라 탭을 옮길 때마다
     부르면 느리고 돈이 든다(무료 쿼터도 여기서 샌다). 둘 중 하나라도 바뀌면 부른다. */
  const keyOf = rm => `${rm.job}|${DB.specFingerprint ? DB.specFingerprint() : ''}`;

  function request(rm) {
    _forKey = keyOf(rm);
    _state = { loading: true };
    DB.casFit(rm.job, rm.jobName || '')
      .then(res => { _state = res; render(); })
      .catch(e => { _state = { error: e.message }; render(); });
  }

  /* 직무가 바뀌면 다음 render 에서 다시 부른다. 스펙 변화는 키가 알아서 잡으므로
     여기서 따로 부를 필요가 없다. */
  function reset() { _forKey = null; _state = null; _openAxis = null; }

  /* 맨 위 두 점수 띠(#cas-two)가 이 값을 읽는다. 화면을 두 곳에서 그리게 되었지만
     **점수는 여전히 여기 하나뿐**이다 — 띠가 따로 계산하면 두 숫자가 갈린다.
       null            아직 계산 전이거나 직업을 안 골랐다
       { loading }     계산 중
       { error }       실패
       { total, max, grade, jobName } 계산됨 */
  function summary() {
    if (!_state) return null;
    if (_state.loading) return { loading: true };
    if (_state.error) return { error: _state.error };
    return { total: _state.total, max: _state.max, grade: _state.grade, jobName: _state.jobName };
  }

  return { render, reset, summary };
})();
