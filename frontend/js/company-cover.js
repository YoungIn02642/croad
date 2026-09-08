/* ════════════════════════════════════════════════════════════
   회사 찾기 (#page-company)

   한 페이지가 상태 두 개를 쓴다.
     · 아직 회사를 안 골랐을 때 — 화면 가운데 검색창 하나(사이드바 없음).
       예전에는 짙은 사이드바가 286px 을 먹으면서 검색창 하나만 담고 있었고,
       본문에는 회사를 바꿔도 안 바뀌는 안내문 4칸이 있었다. 둘 다 없앴다.
     · 회사를 고른 뒤 — 왼쪽 목록 + 오른쪽 기업 리포트.

   ── 이 화면이 존재하는 이유를 숫자로 세운다 ──
   리포트 우상단의 '지원동기 근거 n/5' 게이지가 그것이다. 기사·실적을 읽는 것이
   목적이 아니라 **자소서에 인용할 사실을 담는 것**이 목적이라, 담은 개수를 센다.
   담은 근거는 자소서 코치 1번 칸(#jd-evidence)에 그대로 나타난다.

   ── 없는 값을 지어내지 않는다 ──
   사원수·채용중 공고 수 같은 건 지금 API 에 없다. 화면을 채우자고 만들어 넣으면
   학생이 그걸 자소서에 쓴다. 있는 것(DART 재무·업종코드, 뉴스)만 보여주고,
   없는 칸은 왜 없는지를 적는다.
   ════════════════════════════════════════════════════════════ */
window.CompanyCover = (() => {
  /* ── 무엇을 하는 회사인가 ────────────────────────────────────
     ── 왜 칩을 걷어내고 줄글로 바꿨나 (사용자 지시) ──
     예전에는 '도료 212명 · 50%' 같은 **키워드 칩**만 늘어놨다. 정형 API 로 받을 수
     있는 것이 그것뿐이었기 때문인데, 학생이 알고 싶은 것은 인력 배치가 아니라
     "무엇을 만들어 누구에게 팔아 돈을 버는 회사인가" 다. 칩을 아무리 읽어도 그
     문장이 안 나온다.

     그 문장은 사업보고서 본문 「II. 사업의 내용」 에만 글로 있고, 어느 정형 API 도
     주지 않는다. 그래서 원문(document.xml)을 직접 열어 문단을 가져온다 —
     backend/src/dart-report.js.

     ── 세 덩이로 나눈다 ──
       1) 무엇을 하는 회사인가 / 무엇을 팔아 버는가  ← 보고서 원문 줄글 (제목+본문)
       2) 사람을 어디에 두는가                      ← 직원현황 fo_bbm
       3) 밖으로 벌려 둔 사업                       ← 타법인 출자(경영 참여)
     2·3 도 칩 대신 문장으로 적는다. 다만 **우리가 만든 문장**이라는 것이 드러나게
     숫자 그대로만 말한다(모델에게 다시 쓰게 하지 않는다 — 작업정리 6장·9장).

     매출 비중이 아니라 인력과 지분이라는 것은 그대로 적는다. 비중처럼 읽히면
     우리가 없는 값을 지어낸 셈이 된다. */
  function businessHtml() {
    const emp = analysis?.dart?.employees;
    const affs = analysis?.dart?.affiliates || [];
    const segs = emp?.segments || [];
    const rep = businessText;

    if (!segs.length && !affs.length && !rep) return '';

    return `
      <div class="co-biz">
        ${bizReportHtml(rep)}
        ${bizSegmentHtml(emp, segs)}
        ${bizAffiliateHtml(affs)}
      </div>`;
  }

  /* 개요의 재무 스냅샷 — 매출·영업이익의 최근값 + 전년비 방향을 담기와 함께 보여준다
     (사용자 지시: 개요에 담을 만한 정보를 더). 상세 표는 '재무·실적' 칸에 그대로 있고,
     여기서는 지원동기에 가장 자주 쓰이는 두 줄만 개요 첫 화면에 올린다.
     **값이 아니라 방향이 재료다** — 그래서 담는 문장에 전년비를 같이 넣는다. */
  function financeSnapshotHtml() {
    const fin = analysis?.dart?.financials;
    if (!fin || !fin.accounts) return '';
    const keys = ['revenue', 'operating'].filter(k => fin.accounts[k]);
    if (!keys.length) return '';

    const rows = keys.map(key => {
      const acc = fin.accounts[key];
      const label = analysis.dart.labels?.[key] || key;
      const now = acc.series?.[0];
      const t = acc.trend;
      const text = t
        ? `${label} ${now?.readable || ''} · 전년비 ${t.direction === 'up' ? '+' : t.direction === 'down' ? '−' : ''}${Math.abs(t.pct)}%`
        : `${label} ${now?.readable || ''}`;
      return `<div class="co-fin-row">
        <div class="co-fin-t">
          <span class="co-fin-label">${esc(label)}</span>
          <span class="co-fin-val">${esc(now?.readable || '—')}</span>
          ${t ? `<span class="co-trend--${t.direction}">${arrowOf(t.direction)} ${Math.abs(t.pct)}%</span>` : ''}
        </div>
        ${pickBtn({
          id: `ov-fin-${key}`, kind: 'fact', text,
          source: `${fin.baseYear}년 사업보고서 · ${fin.fsDiv === 'CFS' ? '연결' : '개별'} 기준`,
        })}
      </div>`;
    }).join('');

    return `
      <div class="co-biz-block">
        <h4>최근 실적 한눈에</h4>
        <div class="co-fin-snap">${rows}</div>
        <div class="co-biz-from">${fin.baseYear}년 사업보고서 · ${fin.fsDiv === 'CFS' ? '연결' : '개별'} 기준 ·
          자세한 3년 추이는 <b>재무·실적</b> 칸에</div>
      </div>`;
  }

  /* 보고서 원문 줄글. 아직 안 왔으면 '가져오는 중' 을 보여준다 — 나중에 채워지는
     칸이라 아무것도 안 그리면 학생이 이 회사만 정보가 없는 줄 안다. */
  /* 이름 앞에 biz 를 붙인 이유: 이 파일에는 이미 화면 전체를 그리는 reportHtml()
     이 있다. 같은 이름으로 두면 나중 선언이 이겨서 businessHtml → reportHtml →
     businessHtml 로 무한 재귀가 된다(실측: Maximum call stack size exceeded 로
     리포트가 통째로 안 떴다). */
  function bizReportHtml(rep) {
    if (!rep) return `
      <div class="co-biz-block is-wait">
        <h4>무엇을 하는 회사인가</h4>
        <p>사업보고서 원문에서 가져오는 중이에요…</p>
      </div>`;

    if (!rep.ok) return `
      <div class="co-biz-block is-none">
        <h4>무엇을 하는 회사인가</h4>
        <p>${esc(rep.message || '사업 내용을 가져오지 못했어요.')}
          ${rep.help ? `<span>${esc(rep.help)}</span>` : ''}</p>
        ${rep.viewer ? `<a class="co-biz-more" href="${esc(rep.viewer)}" target="_blank" rel="noopener">
          사업보고서 원문 열기 <i class="ti ti-external-link"></i></a>` : ''}
      </div>`;

    /* 절마다 담기를 하나 둔다. 문단마다 두면 버튼이 글보다 많아지고, 절 전체를
       담아야 "무엇을 하는 회사인가" 한 덩어리가 온전히 넘어간다.
       담는 것은 **원문 그대로**다 — 요약하면 회사가 한 말이 아니라 우리가 지어낸
       말이 되는데 화면에는 '사업보고서에서' 라고 적힌다(20-5). */
    return rep.blocks.map((b, i) => {
      const source = `${rep.report.name} 「${b.section}」`;
      return `
      <div class="co-biz-block">
        <h4>${esc(b.title)}</h4>
        ${b.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}
        <div class="co-biz-from">
          ${esc(source)}
          ${b.more ? `<a class="co-biz-more" href="${esc(rep.viewer)}" target="_blank" rel="noopener">
            표·나머지 내용은 원문에서 <i class="ti ti-external-link"></i></a>` : ''}
        </div>
        ${pickBtn({
          id: `biz-${i}-${b.section}`, kind: 'biz',
          text: b.paragraphs.join(' '), source, url: rep.viewer || '',
        })}
      </div>`;
    }).join('');
  }

  /* '부문' 이 아니라 '안 나눴다' 는 뜻인 이름들.
     ── 왜 필요한가 (실측) ──
     카카오의 직원현황 fo_bbm 은 '전사' 한 줄이다. 이걸 부문으로 읽으면 화면이
     "직원 3,922명이 모두 전사 한 부문에 있어요. 사업을 한 갈래로 모아 둔 회사입니다"
     라고 말하는데, **바로 위 문단에서 회사가 플랫폼·콘텐츠 두 부문이라고 적어 뒀다.**
     신고 양식의 빈칸을 회사의 사업 구조로 착각한 것이라, 있는 그대로 "나누지
     않았다" 고 적는다. */
  const NO_SPLIT = /^(전사|전체|합계|계|공통|본사|본점|일반|해당없음|-)$/;

  /* 인력 배치 → 문장. 상위 세 부문까지만 말한다. 부문이 여덟 개인 회사에서
     전부 나열하면 문장이 표가 된다. */
  function bizSegmentHtml(emp, segs) {
    if (!segs.length) return '';
    const total = segs.reduce((n, g) => n + g.count, 0);
    const top = segs.slice(0, 3);
    const rest = segs.length - top.length;

    let body;
    if (segs.length === 1 && NO_SPLIT.test(segs[0].name.trim())) {
      body = `직원 ${total.toLocaleString()}명을 부문으로 나누지 않고
        '${esc(segs[0].name)}' 한 줄로만 신고했어요. 사람을 어느 사업에 얼마나 두고 있는지는
        이 표로는 알 수 없습니다 — 위의 사업 내용을 보세요.`;
    } else if (segs.length === 1) {
      body = `직원 ${total.toLocaleString()}명이 모두 <b>${esc(segs[0].name)}</b> 한 부문에 있어요.
        사업을 한 갈래로 모아 둔 회사입니다.`;
    } else {
      body = `직원 ${total.toLocaleString()}명 가운데 ${top.map((g, i) =>
          `${i ? '' : '가장 많은 '}<b>${esc(g.name)}</b>에 ${g.count.toLocaleString()}명(${g.pct}%)`
        ).join(', ')}이 있어요${rest > 0 ? `, 나머지 ${rest}개 부문에 남은 인원이 흩어져 있습니다` : ''}.
        회사가 사람을 어디에 몰아 뒀는지가 곧 지금의 주력 사업이에요.`;
    }

    /* 담기용 줄글(태그 없는 사실). 사업 구조는 지원동기에 실제로 인용된다
       ("인력의 절반을 X 부문에 둔 회사에서 …"). 그래서 담기를 붙인다(사용자 지시). */
    let pickText;
    if (segs.length === 1 && NO_SPLIT.test(segs[0].name.trim())) {
      pickText = `직원 ${total.toLocaleString()}명을 부문으로 나누지 않고 '${segs[0].name}' 한 줄로 신고 (${emp.year}년 기준)`;
    } else if (segs.length === 1) {
      pickText = `직원 ${total.toLocaleString()}명이 모두 ${segs[0].name} 부문에 있음 (${emp.year}년 기준)`;
    } else {
      pickText = `직원 ${total.toLocaleString()}명 중 ${top.map(g => `${g.name} ${g.count.toLocaleString()}명(${g.pct}%)`).join(', ')}`
        + `${rest > 0 ? ` 외 ${rest}개 부문` : ''} (${emp.year}년 기준)`;
    }
    const segSource = `${emp.year}년 사업보고서 「직원 현황」`;

    return `
      <div class="co-biz-block">
        <h4>사람을 어디에 두고 있나</h4>
        <p>${body}</p>
        <div class="co-biz-from">${emp.year}년 사업보고서 「직원 현황」 · 매출이 아니라 <b>인력</b> 기준</div>
        ${pickBtn({ id: `biz-seg-${emp.year}`, kind: 'biz', text: pickText, source: segSource, url: '' })}
      </div>`;
  }

  function bizAffiliateHtml(affs) {
    if (!affs.length) return '';
    const top = affs.slice(0, 5);
    const rest = affs.length - top.length;
    const names = top.map(a => `<b>${esc(a.name)}</b>${a.stake != null ? `(${a.stake}%)` : ''}`).join(', ');
    /* 담기용 줄글(태그 없는 사실). 계열 구조도 지원동기 소재가 된다. */
    const pickText = `경영에 참여하는 관계사 ${affs.length}곳 — `
      + top.map(a => `${a.name}${a.stake != null ? `(${a.stake}%)` : ''}`).join(', ')
      + `${rest > 0 ? ` 외 ${rest}곳` : ''}`;

    return `
      <div class="co-biz-block">
        <h4>밖으로 벌려 둔 사업</h4>
        <p>지분을 갖고 경영에 참여하는 회사가 ${affs.length}곳이에요 — ${names}${rest > 0 ? ` 외 ${rest}곳` : ''}.
          본체가 하는 일 말고 어디까지 손을 뻗어 뒀는지가 여기서 드러나요(해외 생산법인·소재 계열 등).</p>
        <div class="co-biz-from">사업보고서 「타법인 출자현황」 중 투자목적이 <b>경영 참여</b>인 곳 ·
          시세차익 목적 단순 투자는 뺐어요</div>
        ${pickBtn({ id: 'biz-aff', kind: 'biz', text: pickText, source: '사업보고서 「타법인 출자현황」', url: '' })}
      </div>`;
  }

  /* ── 스킴 없는 주소를 그대로 href 에 넣지 않는다 ─────────────
     DART 개황은 홈페이지를 'www.jevisco.com' 처럼 **스킴 없이** 준다. 그대로 넣으면
     브라우저가 상대경로로 읽어 http://localhost:3000/www.jevisco.com 으로 가고,
     우리 서버의 404 JSON 이 뜬다(실측). 스킴이 없으면 https 를 붙인다. */
  /* 주소에서 언론사 자리(호스트)만. www 는 뗀다. */
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function httpUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return 'https:' + s;
    return 'https://' + s.replace(/^\/+/, '');
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 디자인 시스템의 유채색 5종. 면을 채우는 용도로만 쓴다(버튼 배경으로 쓰지 않는다).
     회사명을 해시해 고르므로 같은 회사는 언제나 같은 색이다. */
  const ACCENTS = ['#7a3dff', '#ed52cb', '#3b89ff', '#ff6b00', '#00a83a'];
  function accentOf(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 9973;
    return ACCENTS[h % ACCENTS.length];
  }

  /* 검색 없이 들어와도 누를 것이 있게 두는 목록. 업종은 미리 적어 둔 값이고,
     그 밖의 회사는 카탈로그 검색(/api/company/suggest)에서 찾는다. */
  const FEATURED = [
    { name: '삼성전자',       industry: '전자·반도체' },
    { name: '카카오',         industry: 'IT·플랫폼' },
    { name: '네이버',         industry: 'IT·검색·콘텐츠' },
    { name: '현대자동차',     industry: '자동차·모빌리티' },
    { name: '토스',           industry: '핀테크' },
    { name: 'SK하이닉스',     industry: '반도체' },
    { name: 'LG에너지솔루션', industry: '배터리' },
    { name: 'CJ제일제당',     industry: '식품·바이오' },
  ];

  const LS_RECENT   = 'careerly_recent_companies_v1';

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };

  const recent = () => readJson(LS_RECENT, []).filter(Boolean);
  function pushRecent(name) {
    const list = [name, ...recent().filter(n => n !== name)].slice(0, 8);
    localStorage.setItem(LS_RECENT, JSON.stringify(list));
  }

  /* ── 담은 근거는 Roadmap 이 들고 있다 ────────────────────────
     3단계에서 담고 4단계가 쓰는 값이라 흐름 상태다. 예전에는 이 파일과 jd-coach.js
     가 같은 localStorage 키를 각자 파싱했다 — 한쪽에서 모양을 바꾸면 다른 쪽이
     조용히 빈 목록을 보게 되는 배치였다.

     ── 담는 대상을 다시 넓혔다 (사용자 지시) ──
     한동안 '지원할 공고' 하나만 담았다. 기사·실적·직원수에도 담기가 있던 시절에
     "담은 것들이 서로 다른 종류라 자소서에서 무엇에 쓸지 알 수 없다" 는 문제로
     걷어낸 것이다. 그런데 공고는 **대부분의 회사에서 0건이다** — 대기업 공채는
     자사 사이트로만 올라와서 워크넷·잡알리오에 안 잡힌다. 결국 리포트를 다 읽어도
     4단계에 빈손으로 넘어가는 일이 보통이 됐다.

     그래서 다시 넓히되, 옛 문제를 같이 고친다: 담을 때 **종류(kind)** 를 붙이고
     종류마다 **어느 문항에 쓰는지**를 화면이 말한다(Roadmap.EVIDENCE_KINDS).
     넓히기만 하고 쓰임을 안 밝히면 예전 상태로 돌아간다. */
  const evidenceOf = name => Roadmap.evidenceOf(name);

  let selected = null;      // { name, industry }
  let analysis = null;      // DB.companyAnalysis 결과
  /* 사업보고서 원문 줄글. analysis 와 따로 온다(원문이 5~14MB 라 같이 묶으면
     리포트 전체가 늦다). null = 아직 오는 중 · { ok:false } = 못 가져온 이유 있음. */
  let businessText = null;
  /* 지금 펼친 기업분석 단계 (카드 하나).
     ── 왜 '개요' 로 시작하나 (사용자 지시) ──
     예전 기본값은 '최근 이슈' 였다. 기사가 지원동기에 가장 자주 쓰이는 근거라
     거기서 시작하게 뒀는데, **회사를 처음 연 사람에게는 순서가 뒤집힌 화면**이었다.
     어떤 회사인지도 모르는 상태에서 그 회사의 8월 주가 기사부터 읽게 된다.
     카드 번호도 01 개요 → 03 최근 이슈 순인데 세 번째가 열려 있었다. */
  let step     = 'overview';
  let loading  = false;
  let error    = null;
  let query    = '';
  let suggestions = [];
  let reqSeq   = 0;         // 늦게 온 응답으로 지금 화면을 덮지 않기 위한 순번

  /* ── 취업 업종 트리 ────────────────────────────────────────
     첫 화면에서 한 번만 받는다. 민간·공공이 한 덩이로 오고(2,442곳), 단계를 오갈 때
     서버를 다시 부르지 않는다. 축은 사람인·잡코리아가 쓰는 말이다 —
     게임·화장품·2차전지처럼 학생이 실제로 찾는 이름(backend/src/job-industry.js). */
  let treeData = null;
  let treeErr = null;
  let treeFor = null;       // 어떤 직무로 받아 왔나 (focus 가 직무마다 다르다)

  /* ── 기업규모 필터 ────────────────────────────────────────────
     로드맵 1단계에서 고른 대·중견·중소·공을 여기서 받는다(Roadmap.corpType).
     **null 이면 지금까지처럼 전체를 보여준다** — 1단계에 그 칸이 아직 없어도
     이 화면은 멀쩡히 돌아가야 한다.

     이건 **단계가 아니라 필터다.** 목록 전체를 바꾸는 스위치라 단계에 끼우면
     되돌리기가 어렵고, 위에 걸어 두면 어느 단계에서든 바꿀 수 있다. */
  let sizeFilter = null;
  let sizeTouched = false;  // 화면에서 직접 바꿨나 — 그랬으면 로드맵 값으로 되돌리지 않는다

  /* ── 업종 고르기 (단계 토글) ──────────────────────────────────
     ── 왜 칩 두 줄을 단계로 바꿨나 (사용자 지시) ──
     예전에는 규모 칩 한 줄 + 계열 칩 한 줄을 지나면 바로 회사 칩이 쏟아졌다.
     '화학·소재' 는 144곳이라 이름만 늘어놓은 벽이 됐다. 사람인·잡코리아가 업종을
     여러 단으로 쪼개는 이유가 그것이다 — **마지막 칸이 눈으로 훑을 수 있는 크기**여야
     한다. 한 번에 한 단계만 열고, 고르면 접히면서 다음 단이 열린다.

     path 는 고른 업종 경로다(['제조·화학','반도체·전자부품']). 깊이를 세지 않는다 —
     민간은 3단, 공공은 소관부처가 한 단 더 붙어 4단이라, **회사 목록을 만나면
     거기가 끝**으로 읽는다. */
  let path = [];
  let skipped = {};         // 선택지가 하나뿐이라 자동으로 지나친 단계
  let lanePage = 0;         // '고른 업종 회사' 목록의 현재 페이지 (0부터)

  const root = () => document.getElementById('company-root');

  /* ── 검색 ────────────────────────────────────────────────── */
  /* ── 자동완성 ────────────────────────────────────────────────
     **화면을 다시 그리지 않는다.** 예전에는 글자마다 paint() 로 #company-root 를
     통째로 innerHTML 했는데, 그러면 입력창 DOM 이 매번 새로 만들어진다. 한글은
     조합 중(ㅅ→사→삼)에 input 이벤트가 계속 나오므로, 그 사이 입력창이 교체되면
     **조합이 깨져서 글자가 사라진다** — 영문은 멀쩡한데 한글만 안 되던 이유다.
     그래서 여기서는 드롭다운 목록만 갈아 끼우고 입력창은 손대지 않는다. */
  async function runSuggest(q) {
    query = q;
    const seq = ++reqSeq;
    if (q.trim().length < 1) { suggestions = []; paintSuggest(); return; }

    const hits = FEATURED.filter(c => c.name.includes(q.trim()));
    const found = await DB.suggestCompanies(q.trim(), 8).catch(() => []);
    if (seq !== reqSeq) return;                       // 그새 더 친 글자가 있다

    const rest = found
      .filter(it => !hits.some(c => c.name === it.name))
      .map(it => ({ name: it.name, industry: null }));
    suggestions = [...hits, ...rest].slice(0, 8);
    paintSuggest();
  }

  /* 드롭다운만 다시 그린다. 입력창·나머지 화면은 그대로 둔다. */
  function paintSuggest() {
    const box = document.querySelector('.co-suggest');
    if (!box) return;
    box.outerHTML = suggestHtml();
    const fresh = document.querySelector('.co-suggest');
    if (fresh) bindPick(fresh);
  }

  async function select(name) {
    const featured = FEATURED.find(c => c.name === name);
    selected = { name, industry: featured?.industry || null };
    analysis = null; error = null; loading = true;
    businessText = null;
    step = 'overview';        // 회사를 처음 열면 '어떤 회사인가' 부터 (위 주석)
    suggestions = []; query = '';
    pushRecent(name);
    paint();

    const seq = ++reqSeq;
    /* 업종은 리포트를 기다리게 하지 않는다 — 따로 받아 조용히 끼워 넣는다. */
    if (!selected.industry) {
      DB.classifyCompany(name).then(r => {
        if (seq === reqSeq && r?.matched && selected?.name === name) {
          selected.industry = r.label; paint();
        }
      }).catch(() => {});
    }

    /* 사업 내용 줄글도 같은 방식이다. 보고서 원문이 5~14MB 라 리포트 전체를
       붙들면 안 된다 — 먼저 그리고 오는 대로 채운다.
       실패해도 화면에 사유를 남긴다. 조용히 지우면 "왜 이 회사만 설명이 없지" 가
       되고, 그건 우리가 안 보여주는 것인지 회사가 안 낸 것인지 알 수 없다. */
    DB.companyBusiness(name)
      .then(r => { if (seq === reqSeq && selected?.name === name) { businessText = r; paint(); } })
      .catch(e => {
        if (seq !== reqSeq || selected?.name !== name) return;
        businessText = { ok: false, message: '사업 내용을 가져오지 못했어요.', help: e.message };
        paint();
      });

    try {
      const a = await DB.companyAnalysis(name);
      if (seq !== reqSeq || selected?.name !== name) return;
      analysis = a;
    } catch (e) {
      if (seq !== reqSeq || selected?.name !== name) return;
      error = e.message;
    } finally {
      if (seq === reqSeq) { loading = false; paint(); }
    }
  }

  /* 검색 화면으로. 뜨는 중이던 요청도 버려야 한다 — reqSeq 를 올리지 않으면
     늦게 도착한 응답이 selected 가 null 인 채로 화면을 다시 그린다.
     검색어·자동완성도 비운다. 남겨 두면 '회사 찾기' 를 눌렀는데 전에 치던 글자가
     그대로 있어서, 돌아온 것이 아니라 되돌아가지 못한 것처럼 보인다. */
  function back() {
    reqSeq++;
    selected = null; analysis = null; businessText = null; error = null;
    loading = false; query = ''; suggestions = [];
    paint();
  }

  /* 담기 버튼 한 벌. 종류마다 담는 자리가 다르지만 **버튼은 하나여야 한다** —
     칸마다 따로 만들면 담긴 표시나 문구가 칸마다 어긋난다.

     · id     : 그 항목을 가리키는 값. 같은 것을 두 번 담지 않는 기준이다
     · kind   : Roadmap.EVIDENCE_KINDS 의 키 — 4단계가 어느 문항에 쓸지 정하는 축
     · text   : 자소서에 인용할 문장 그대로
     · source : 어디서 온 말인지. **비워 두지 않는다** — 출처 없는 사실은 면접에서 무너진다 */
  function pickBtn({ id, kind, text, source, url }) {
    if (isPicked(id)) {
      return `<button type="button" class="co-take is-on" data-unpick="${esc(id)}">
        <i class="ti ti-check"></i> 담김
      </button>`;
    }
    return `<button type="button" class="co-take" data-take="${esc(id)}" data-kind="${esc(kind)}"
      data-text="${esc(text)}" data-source="${esc(source || '')}" data-url="${esc(url || '')}">
      <i class="ti ti-plus"></i> 자소서에 담기
    </button>`;
  }

  /* ── 근거 담기 ───────────────────────────────────────────── */
  function pick(item) {
    Roadmap.addEvidence(selected.name, item);
    paint();
  }
  function unpick(id) {
    Roadmap.removeEvidence(selected.name, id);
    paint();
  }
  const isPicked = id => evidenceOf(selected.name).some(e => e.id === id);

  /* ══ 그리기 ══════════════════════════════════════════════ */
  function paint() {
    const box = root();
    if (!box) return;
    /* 그리기 직전에 한 번. 선택지가 하나뿐인 단계를 지나쳐 두지 않으면 누를 것이
       하나만 있는 화면이 뜬다(settlePath 주석). */
    if (!selected) settlePath();
    box.innerHTML = selected ? reportHtml() : searchHtml();
    bind(box);
  }

  /* '고른 업종 회사' 페이지 넘김 줄. 한 장뿐이면 아무것도 그리지 않는다.
     페이지가 많아도(1,779곳 = 149장) 현재 앞뒤 두 장 + 처음·끝만 보이고 사이는 …로 접는다. */
  function lanePagerHtml(page, pages, total) {
    if (pages <= 1) return '';
    const btn = (p, label, cls = '', dis = false) =>
      `<button type="button" class="co-page ${cls}" data-lane-page="${p}" ${dis ? 'disabled' : ''}>${label}</button>`;
    const nums = [];
    let last = -1;
    for (let p = 0; p < pages; p++) {
      if (p === 0 || p === pages - 1 || Math.abs(p - page) <= 2) {
        if (last >= 0 && p - last > 1) nums.push('<span class="co-page-gap">…</span>');
        nums.push(btn(p, String(p + 1), p === page ? 'is-on' : ''));
        last = p;
      }
    }
    return `<div class="co-pager">
      ${btn(page - 1, '‹ 이전', 'co-page--nav', page === 0)}
      <span class="co-pager-nums">${nums.join('')}</span>
      ${btn(page + 1, '다음 ›', 'co-page--nav', page === pages - 1)}
    </div>`;
  }

  /* ── 상태 1 · 검색 우선 ──────────────────────────────────── */
  function searchHtml() {
    const rec = recent();
    const evAll = Roadmap.allEvidence();

    const tile = (c, sub) => `
      <button type="button" class="co-tile" data-pick="${esc(c.name)}">
        <span class="co-tile-h">
          <span class="wf-avatar wf-avatar--sm" style="--co-color:${accentOf(c.name)}">${esc(c.name.charAt(0))}</span>
          <b>${esc(c.name)}</b>
        </span>
        <span class="co-tile-sub">${esc(c.industry || sub || '기업 리포트 보기')}</span>
        <span class="co-tile-foot">${
          c.size && SIZE_LABEL[c.size]
            ? `<span class="co-tile-tag co-tile-tag--${esc(c.size)}">${SIZE_LABEL[c.size]}</span>` : ''}${
          (evAll[c.name] || []).length
            ? `<span class="wf-badge wf-badge--ok">근거 ${evAll[c.name].length}건 담김</span>`
            : `<span class="wf-badge wf-badge--mute">기업 리포트</span>`}</span>
      </button>`;

    const rm = Roadmap.get();
    return `
      <div class="co-search-page">
        <div class="co-search-head">
          <div class="wf-eyebrow wf-eyebrow--lg">Company research</div>
          <h1>${rm ? `${Roadmap.withJosa(rm.jobName || rm.middleName, '로')} 어디에 지원할까요?` : '어느 회사에 지원하세요?'}</h1>
        </div>

        <div class="co-searchbar">
          <div class="co-searchbar-in">
            <i class="ti ti-search"></i>
            <input id="co-q" type="search" autocomplete="off" placeholder="회사명을 입력하세요"
                   value="${esc(query)}" aria-label="회사명 검색" />
          </div>
          ${suggestHtml()}
        </div>

        <!-- 기업 형태 필터는 여기(맨 위 한 줄)에서 **마지막 단계(회사) 안**으로 옮겼다
             (사용자 지시 2026-09-04). 업종을 고르기도 전에 "대기업 545곳" 을 먼저 묻는
             것은 순서가 거꾸로다 — 어느 업종인지 정해야 그 안에서 규모가 뜻을 갖는다. -->
        <div class="co-lanes">
          <!-- 업종 고르기가 이 화면의 본 흐름이다. 최근 본 회사·많이 찾는 회사는
               **지름길**이라 그 아래로 내린다 — 위에 두면 목록을 고르러 온 사람이
               아는 회사 8곳만 보고 나간다. -->
          ${stepsHtml()}
          ${pickerHtml()}
          ${(() => {
            /* 고른 업종(+규모 필터) 아래 회사를 하단 레인으로 — 최근 본/많이 찾는 회사와
               같은 타일 모양이다(사용자 지시). 업종이나 규모를 하나라도 좁혔을 때만
               띄운다(아무것도 안 좁혔으면 3,900곳이라 레인이 의미가 없다). */
            const narrowed = path.length > 0 || sizeFilter;
            if (!narrowed) return '';
            const list = companiesUnder(path);
            if (!list.length) return '';
            /* 예전에는 앞 12곳만 보이고 "…외 N곳" 안내뿐이라 나머지를 볼 길이 없었다
               (사용자 지적). 한 장 12곳씩 페이지로 넘겨 전부 볼 수 있게 한다. */
            const PAGE = 12;
            const pages = Math.ceil(list.length / PAGE);
            if (lanePage >= pages) lanePage = 0;                 // 필터로 페이지 수가 줄면 되돌린다
            const start = lanePage * PAGE;
            const shown = list.slice(start, start + PAGE);
            const sizeTag = sizeFilter && SIZE_LABEL[sizeFilter] ? ` · ${SIZE_LABEL[sizeFilter]}` : '';
            return `
            <section>
              <div class="co-lane-h"><h2>고른 업종 회사</h2><span>${list.length.toLocaleString()}곳${sizeTag}</span></div>
              <div class="co-lane-grid">${shown.map(c => tile({ name: c.n, size: sizeFilter ? null : c.s })).join('')}</div>
              ${lanePagerHtml(lanePage, pages, list.length)}
            </section>`;
          })()}
          ${rec.length ? `
            <section>
              <div class="co-lane-h"><h2>최근 본 회사</h2><span>${rec.length}곳</span></div>
              <!-- 업종을 적는다 — '다시 열기' 는 타일을 누르면 되는 일이지 이 자리에
                   적을 정보가 아니다(사용자 지시 2026-09-04). -->
              <div class="co-lane-grid">${rec.slice(0, 4)
                .map(n => tile({ name: n, industry: industryOf(n) })).join('')}</div>
            </section>` : ''}
          <section>
            <div class="co-lane-h"><h2>많이 찾는 회사</h2>
              <!-- 이 8곳은 손으로 적어 둔 목록이라 규모 판정이 붙어 있지 않다.
                   규모 필터를 걸어 놓고 이 줄만 그대로 두면 '중견기업만 보는 중' 인데
                   삼성전자가 나란히 있는 화면이 되어, 필터가 고장 난 것처럼 읽힌다.
                   걸러 내지 않는 대신 **거르지 않았다고 적는다** — 이 줄은 목록이
                   아니라 '바로 시작하는 자리' 라서 지울 이유는 없다. -->
              <span>${sizeFilter ? '규모와 상관없이 · 골라서 바로 시작할 수 있어요' : '골라서 바로 시작할 수 있어요'}</span>
            </div>
            <div class="co-lane-grid">${FEATURED.slice(0, 8).map(c => tile(c)).join('')}</div>
          </section>
        </div>
      </div>`;
  }

  /* ══ 업종 고르기 ══════════════════════════════════════════════
     프로토타입 3안 중 **B안(단계 토글)** 을 옮겼다. 셋 중 이걸 고른 이유:
     세로로 쌓여서 모바일에서 레이아웃이 안 바뀌고, 칩이 가로로 넓어 업종 이름이
     한 줄에 들어가며, 지금 화면이 이미 칩 두 줄이라 옮기는 일이 가장 적었다.

     프로토타입과 다른 점이 하나 있다. 거기서는 마지막 단이 **체크박스(복수 선택)** 로
     지원 후보를 담았는데, 이 화면의 마지막 단은 **회사 칩 한 번 누르기**다.
     이 화면의 결론은 후보 목록이 아니라 **회사 한 곳의 리포트**이기 때문이다
     (로드맵 3단계 = '지원할 회사' 하나를 정하는 자리). 후보 담기를 넣으려면
     Roadmap 이 목록을 들어야 하는데 그건 이 작업의 범위가 아니다. */

  /* 트리 걷기. 배열을 만나면 회사 목록이고 거기가 끝이다. */
  function nodeAt(p) {
    let node = treeData?.tree;
    for (const k of p) {
      if (node == null || Array.isArray(node)) return null;
      node = node[k];
    }
    return node ?? null;
  }
  const isLeaf = node => Array.isArray(node);

  /* 규모 필터는 어느 단계에서든 걸린다. 곳수도 필터를 통과한 수여야 한다 —
     전체 곳수를 적어 두고 눌렀을 때 절반만 나오면 숫자를 믿을 수 없게 된다. */
  const keepSize = list => (list || []).filter(c => !sizeFilter || c.s === sizeFilter);
  function countAt(node) {
    if (node == null) return 0;
    if (isLeaf(node)) return keepSize(node).length;
    return Object.values(node).reduce((n, v) => n + countAt(v), 0);
  }

  /* 지금 자리에서 고를 수 있는 것들. **0곳인 칸은 만들지 않는다** —
     규모 필터를 걸면 통째로 비는 업종이 생기는데, 눌러도 빈 목록이면 고장으로 읽힌다. */
  function optionsAt(p) {
    const node = nodeAt(p);
    if (node == null || isLeaf(node)) return [];
    /* 1단계만 분류표 순서를 따른다(지원자가 많은 쪽이 앞). 아래는 곳수 순이 낫다 —
       '기타 제조 2곳' 이 '반도체·전자부품 49곳' 위에 있을 이유가 없다. */
    const keys = p.length === 0
      ? (treeData?.order || []).map(([m]) => m)
      : Object.keys(node);
    const out = keys.map(k => ({ id: k, n: countAt(node[k]) })).filter(o => o.n > 0);
    return p.length === 0 ? out : out.sort((a, b) => b.n - a.n);
  }
  const companiesAt = p => { const n = nodeAt(p); return isLeaf(n) ? keepSize(n) : []; };
  const atLeaf = () => isLeaf(nodeAt(path));

  /* ── 회사 이름 → 업종 (사용자 지시 2026-09-04) ────────────────────────────
     '최근 본 회사' 타일이 업종 자리에 '다시 열기' 라는 **행동 안내**를 적고 있었다.
     같은 타일의 다른 자리(많이 찾는 회사)는 거기에 업종을 적으니, 같은 모양의 칸이
     줄마다 다른 뜻이 됐다. 트리에 이미 업종이 있으므로 거기서 찾아 적는다.

     트리는 업종 대분류 → 업종 → [회사] 라, 회사가 든 리프의 **바로 위 키**가 업종이다.
     한 번 걸어 두고 Map 으로 들고 있는다(트리는 3,900곳이라 타일마다 걷으면 낭비다).
     트리를 다시 받으면(직무가 바뀌면) 캐시도 같이 버린다. */
  let industryMap = null;
  let industryMapFor = null;
  function industryOf(name) {
    if (!treeData?.tree) return '';
    if (!industryMap || industryMapFor !== treeFor) {
      industryMap = new Map();
      industryMapFor = treeFor;
      const walk = (node, label) => {
        if (Array.isArray(node)) {
          for (const c of node) if (c?.n && !industryMap.has(c.n)) industryMap.set(c.n, label);
          return;
        }
        if (!node) return;
        for (const k of Object.keys(node)) walk(node[k], k);
      };
      walk(treeData.tree, '');
    }
    return industryMap.get(name) || '';
  }

  /* 지금 고른 업종 경로 **아래 전체** 회사(하위 리프까지 모두), 규모 필터 적용.
     결과 레인(하단)이 쓴다 — 아직 리프까지 안 내려가도 지금까지 좁힌 회사를 보여준다. */
  function companiesUnder(p) {
    const node = nodeAt(p);
    if (node == null) return [];
    if (isLeaf(node)) return keepSize(node);
    const out = [];
    const walk = n => { if (isLeaf(n)) out.push(...n); else if (n) Object.values(n).forEach(walk); };
    walk(node);
    return keepSize(out);
  }

  /* ── 선택지가 하나뿐인 단계는 건너뛴다 ────────────────────────
     '외식·프랜차이즈' 는 1곳이고 공공 '기타공공기관 > 어느 부처' 도 한 칸뿐인 경우가
     있다. 누를 것이 하나만 있는 화면은 고르는 것이 아니라 확인 도장을 찍는 일이라,
     자동으로 정하고 **건너뛰었다는 사실만 남긴다**(진행 표시에 점선). */
  function settlePath() {
    skipped = {};
    let guard = 0;
    while (treeData && !atLeaf() && guard++ < 8) {
      const o = optionsAt(path);
      if (o.length !== 1) break;
      skipped[path.length] = true;
      path.push(o[0].id);
    }
  }

  /* 공공기관은 업종코드가 없어 축이 다르다. 단계 이름도 달라야 한다 —
     공공기관에 '업종' 을 물으면 답이 없다(company-sectors.js publicOrgs 주석). */
  /* 단계 이름만 둔다 — 이름 아래 설명 줄('어느 분야를 볼까요' 같은)은 지웠다
     (사용자 지시 2026-09-04). 단계 이름이 이미 그 말을 하고 있었다. */
  const STEPS_PRIVATE = [
    { t: '업종 대분류' },
    { t: '업종' },
    { t: '회사' },
  ];
  const STEPS_PUBLIC = [
    { t: '업종 대분류' },
    { t: '기관 유형' },
    { t: '소관·지역' },
    { t: '기관' },
  ];
  const stepsNow = () => (path[0] === '기관·공공' ? STEPS_PUBLIC : STEPS_PRIVATE);

  /* ── 기업 형태 필터는 여기 있었다 (사용자 지시로 이동 2026-09-04) ─────────────
     맨 위 한 줄에 "대기업 545 · 중견 1,982 …" 를 먼저 묻던 자리다. 업종을 고르기
     전의 전체 곳수라, 지금 보고 있는 목록과 축이 달라 고르는 데 도움이 되지 않았다.
     이제 마지막 단계(회사) 안에서 **그 업종의 곳수로** 고른다 — stepSizeChipsHtml. */

  /* 진행 표시 — 지금 어디까지 왔는지. 자동으로 건너뛴 단계는 점선으로 남긴다.
     지우면 "내가 안 골랐는데 정해져 있다" 가 되어 고장으로 읽힌다.

     ── 눌러서 그 단계로 돌아간다 (사용자 지시) ──
     이미 고른 단계(완료)나 지금 단계를 누르면 그 단계의 선택창이 열린다. 아코디언
     헤더와 같은 data-open 을 달아 같은 핸들러(path 를 그 단계까지 자른다)를 쓴다.
     아직 못 온 뒤 단계는 누를 수 없다 — 앞을 건너뛸 수는 없기 때문이다. */
  function stepsHtml() {
    if (!treeData) return '';
    const S = stepsNow();
    return `<div class="co-steps">${S.map((st, i) => {
      const v = i < S.length - 1 ? path[i] : null;
      const cls = v ? (skipped[i] ? 'is-done is-skip' : 'is-done') : (i === path.length ? 'is-on' : '');
      const label = v ? (skipped[i] ? `${v} (자동)` : v) : st.t;
      const nav = v != null || i === path.length;      // 완료됐거나 지금 단계면 누를 수 있다
      const tag = nav ? 'button type="button"' : 'span';
      return `<${tag} class="co-step ${cls}${nav ? ' co-step--nav' : ''}"
                ${nav ? `data-open="${i}"` : ''} title="${esc(label)}"><i>${i + 1}</i>${esc(label)}</${nav ? 'button' : 'span'}>${
        i < S.length - 1 ? '<span class="co-step-arw">›</span>' : ''}`;
    }).join('')}</div>`;
  }

  /* 이 화면의 본 흐름. 한 번에 한 단계만 열린다. */
  function pickerHtml() {
    if (treeErr) {
      return `<section><div class="co-note"><i class="ti ti-info-circle"></i> ${esc(treeErr)}</div></section>`;
    }
    if (!treeData) return `<section><div class="co-loading">업종 목록을 불러오는 중…</div></section>`;

    const S = stepsNow();
    const open = Math.min(path.length, S.length - 1);
    const focus = new Set(treeData.focus?.minors || []);
    /* 추천(focus)은 2차 분류(업종) 단위로 온다. 예전에는 그 단계에서만 별이 붙어서,
       **업종 대분류에는 추천 표시가 안 보였다**(사용자 지적 — 어느 대분류를 눌러야 할지 헷갈림).
       그래서 상위 단계도, 그 아래에 추천 업종이 하나라도 있으면 별을 붙인다. */
    const hasFocusUnder = node => {
      if (!node || isLeaf(node)) return false;
      return Object.keys(node).some(k => focus.has(k) || hasFocusUnder(node[k]));
    };
    const optFocus = (slice, id) => focus.has(id) || hasFocusUnder(nodeAt([...slice, id]));

    const acc = S.map((st, i) => {
      const locked = i > path.length;
      const isOpen = i === open;
      const isLast = i === S.length - 1;
      const chosen = isLast ? null : path[i];
      const done = chosen != null;

      let body = '';
      if (isOpen) {
        body = isLast
          ? companyStepHtml()
          : `<div class="co-indchips">${optionsAt(path.slice(0, i)).map(o => {
              const isFocus = optFocus(path.slice(0, i), o.id);
              return `<button type="button" class="co-indchip ${path[i] === o.id ? 'is-on' : ''} ${isFocus ? 'is-focus' : ''}"
                      data-go="${esc(o.id)}" data-depth="${i}">
                ${isFocus ? '<i class="ti ti-star-filled"></i>' : ''}${esc(o.id)}<b>${o.n.toLocaleString()}</b>
              </button>`; }).join('')}</div>`;
      }

      return `<div class="co-step-card ${isOpen ? 'is-open' : ''} ${locked ? 'is-locked' : ''} ${done ? 'is-done' : ''}">
        <button type="button" class="co-step-h" ${locked ? 'disabled' : `data-open="${i}"`}>
          <span class="co-step-n">${done && !isOpen ? '✓' : i + 1}</span>
          <span class="co-step-t"><b>${esc(st.t)}</b></span>
          <span class="co-step-pick">${chosen ? esc(skipped[i] ? `${chosen} (자동)` : chosen) : ''}</span>
        </button>
        ${body ? `<div class="co-step-b">${body}</div>` : ''}
      </div>`;
    }).join('');

    return `<section class="co-inds">
      ${focusNoteHtml()}
      <div class="co-steps-acc">${acc}</div>
    </section>`;
  }

  /* 직무로 좁힐 수 없는 경우를 말로 남긴다. 칸을 지우면 학생은 우리가 안 해 준 것인지
     원래 안 되는 것인지 알 수 없다(16-5 와 같은 원칙). */
  function focusNoteHtml() {
    const rm = Roadmap.get();
    const focus = treeData?.focus;
    if (!rm || !focus?.matched) return '';
    const name = rm.jobName || rm.middleName;
    const goalEun = Roadmap.withJosa(name, '은');
    const note = t => `<div class="co-note co-note--tight"><i class="ti ti-info-circle"></i> ${t}</div>`;

    if (focus.universal) {
      return note(`<b>${goalEun}</b> <b>업종을 가리지 않는 직무</b>예요.
        특정 업종으로 좁히면 나머지 업종의 회사를 후보에서 지우게 되니 추천을 붙이지 않았어요 —
        관심 있는 분야를 직접 골라 보세요.`);
    }
    if (!focus.minors?.length) {
      const why = focus.sections?.length
        ? `<b>${esc(focus.sections.map(x => x.label).join(' · '))}</b>이라 상장 기업 목록에 해당하는 회사가 없어요.`
        : '공무원·군인 채용 경로라 민간 기업 업종으로 이어지지 않아요.';
      return note(`<b>${goalEun}</b> ${why} 그래도 회사를 정해 자소서를 쓰려면 아래에서 직접 찾아 주세요.`);
    }
    /* 추천이 **붙은** 경우의 안내문은 지웠다(사용자 지시 2026-09-05). 별 표시가 무엇인지는
       칩 옆 범례가 말하고, "지금 뽑는다는 뜻은 아니다" 는 회사를 열면 나오는 채용공고 칸이
       스스로 답한다. 아래 두 갈래(추천을 못 붙인 경우)는 남긴다 — 그건 화면에 없는 것을
       설명하는 말이라, 지우면 학생이 우리가 안 해 준 것인지 원래 안 되는 것인지 알 수 없다. */
    return '';
  }

  /* 회사 칩 한 벌. 규모를 배지로 단다 — 이름만 늘어놓으면 학생이 고를 근거가 없다.
     **규모 필터가 켜져 있으면 배지를 뺀다.** 모든 칩에 '중견' 이 똑같이 붙어 있으면
     정보가 아니라 잡음이고, 그 말은 이미 필터 칩이 하고 있다.
     규모로 묶어 놓은 줄(companyStepHtml) 안에서도 같은 이유로 뺀다 — 묶음 제목이
     이미 '대기업' 이라고 적혀 있다. */
  const SIZE_LABEL = { large: '대기업', mid: '중견', small: '중소', public: '공공', unknown: '규모 미확인' };
  const companyChip = (c, hideSize) => `<button type="button" class="co-chip" data-pick="${esc(c.n)}">
      ${esc(c.n)}${!sizeFilter && !hideSize && c.s && SIZE_LABEL[c.s]
        ? `<em class="co-chip-size co-chip-size--${esc(c.s)}">${SIZE_LABEL[c.s]}</em>` : ''}
    </button>`;

  /* ── 마지막 단계(회사) — 규모로 묶어서 보여준다 (사용자 지시 2026-09-04) ─────────
     예전에는 회사 이름 칩이 규모와 상관없이 한 덩이로 쏟아졌다. 학생이 이 화면에서
     실제로 하는 일은 "이 업종에서 **내가 지원할 만한 규모**의 회사를 고르는 것"인데,
     대기업과 중소가 뒤섞여 있으면 그 판단을 이름 옆 작은 배지로만 해야 했다.

     그래서 위 '기업 형태' 필터를 걸지 않았을 때는 **대기업 · 중견 · 중소 · 공공**
     순으로 묶어 제목을 붙인다. 필터를 걸었으면 이미 한 종류만 남으므로 묶지 않는다
     — 제목이 하나뿐인 묶음은 줄만 늘린다. */
  const SIZE_ORDER = ['large', 'mid', 'small', 'public', 'unknown'];

  /* 기업 형태 고르기 — **이 업종 안에서** 고른다(사용자 지시 2026-09-04).
     맨 위 한 줄에 있던 것을 여기로 옮겼다. 숫자도 전체 5,337곳이 아니라 이 업종의
     곳수라, "게임에 대기업이 8곳" 처럼 지금 고르는 것과 같은 축의 값이 된다.
     0곳인 형태는 칩을 만들지 않는다 — 눌러도 빈 목록이면 고장으로 읽힌다. */
  function stepSizeChipsHtml() {
    const all = (() => { const n = nodeAt(path); return isLeaf(n) ? n : []; })();
    if (!all.length) return '';
    const counts = {};
    for (const c of all) counts[c.s] = (counts[c.s] || 0) + 1;
    const kinds = SIZE_ORDER.filter(s => counts[s] > 0);
    if (kinds.length < 2) return '';        // 한 종류뿐이면 고를 것이 없다

    const chip = (id, label, n) => `<button type="button"
        class="co-stepsize ${(sizeFilter || null) === id ? 'is-on' : ''}" data-size="${id || ''}">
        ${esc(label)}${n ? `<b>${n.toLocaleString()}</b>` : ''}</button>`;
    return `<div class="co-stepsizes">
      <span class="co-stepsizes-l">기업 형태</span>
      ${chip(null, '전체', all.length)}
      ${kinds.map(s => chip(s, SIZE_LABEL[s], counts[s])).join('')}
    </div>`;
  }

  function companyStepHtml() {
    const chips = stepSizeChipsHtml();
    const list = companiesAt(path);
    if (!list.length) return `${chips}<div class="co-indlist"></div>`;
    if (sizeFilter) return `${chips}<div class="co-indlist">${list.map(c => companyChip(c)).join('')}</div>`;

    const groups = SIZE_ORDER
      .map(s => ({ s, items: list.filter(c => c.s === s) }))
      .filter(g => g.items.length);
    /* 규모 판정이 아예 없는 회사(트리에 s 가 없는 옛 데이터)는 묶음 밖에 남는다.
       버리면 목록에서 회사가 조용히 사라진다 — 묶음 하나로 받아 준다. */
    const rest = list.filter(c => !SIZE_ORDER.includes(c.s));
    if (rest.length) groups.push({ s: null, items: rest });
    if (groups.length <= 1) return `${chips}<div class="co-indlist">${list.map(c => companyChip(c)).join('')}</div>`;

    return chips + groups.map(g => `
      <div class="co-sizegroup">
        <div class="co-sizegroup-h">
          <b>${esc(g.s ? SIZE_LABEL[g.s] : '그 밖')}</b><span>${g.items.length.toLocaleString()}곳</span>
        </div>
        <div class="co-indlist">${g.items.map(c => companyChip(c, true)).join('')}</div>
      </div>`).join('');
  }

  function suggestHtml() {
    if (!suggestions.length) return '<div class="co-suggest" hidden></div>';
    return `<div class="co-suggest">
      ${suggestions.map(c => `
        <button type="button" data-pick="${esc(c.name)}">
          <span class="wf-avatar wf-avatar--sm" style="--co-color:${accentOf(c.name)}">${esc(c.name.charAt(0))}</span>
          <span class="co-suggest-t">
            <b>${esc(c.name)}</b>
            ${c.industry ? `<small>${esc(c.industry)}</small>` : ''}
          </span>
        </button>`).join('')}
      <div class="co-suggest-hint">Enter 를 누르면 첫 번째 회사를 엽니다</div>
    </div>`;
  }

  /* ── 상태 2 · 기업 리포트 ────────────────────────────────── */
  function reportHtml() {
    return `<div class="co-report">
      ${sideHtml()}
      <div class="co-main">${mainHtml()}</div>
    </div>`;
  }

  function sideHtml() {
    const rec = recent();
    const evAll = Roadmap.allEvidence();
    const row = name => `
      <button type="button" class="co-side-item ${name === selected.name ? 'is-on' : ''}" data-pick="${esc(name)}">
        <span class="wf-avatar wf-avatar--sm" style="--co-color:${accentOf(name)}">${esc(name.charAt(0))}</span>
        <span class="co-side-t">
          <b>${esc(name)}</b>
          <small>${(evAll[name] || []).length ? `근거 ${(evAll[name] || []).length}건 담김` : '기업 리포트'}</small>
        </span>
      </button>`;

    const others = FEATURED.map(c => c.name).filter(n => !rec.includes(n)).slice(0, 6);

    return `<aside class="co-side">
      <!-- 리포트를 보는 중에도 같은 자동완성이 뜬다. 예전에는 이 칸이 Enter 로만
           동작해서(목록이 흔들리는 걸 피하려던 것) "자동완성이 안 된다"로 읽혔다.
           흔들림은 드롭다운을 띄우는 것으로 충분히 막을 수 있다 — 목록 자체는 그대로 둔다. -->
      <div class="co-side-search">
        <label class="co-side-srch">
          <i class="ti ti-search"></i>
          <input id="co-side-q" type="search" autocomplete="off" placeholder="회사명 검색" aria-label="회사명 검색" />
        </label>
        ${suggestHtml()}
      </div>
      ${rec.length ? `
        <div class="co-side-sec">
          <span class="wf-eyebrow">최근 본 회사</span>
          <div class="co-side-list">${rec.map(row).join('')}</div>
        </div>` : ''}
      ${others.length ? `
        <div class="co-side-sec">
          <span class="wf-eyebrow">많이 찾는 회사</span>
          <div class="co-side-list">${others.map(row).join('')}</div>
        </div>` : ''}
      <div class="co-side-sec">
        <button type="button" class="wf-btn wf-btn--sm wf-btn--block" data-back>다른 회사 검색</button>
      </div>
    </aside>`;
  }

  function mainHtml() {
    const ev = evidenceOf(selected.name);

    const head = `
      <!-- 돌아가는 길. 예전에도 '다른 회사 검색' 버튼이 있긴 했는데 **왼쪽 사이드바
           맨 아래**, 최근 본 회사·많이 찾는 회사 목록 뒤였다. 실측하니 화면 높이
           812px 에서 top 955px — 스크롤을 내려야 나온다. 회사를 한 번 고르면
           돌아갈 길이 없는 것처럼 보였고, 실제로 사용자가 그렇게 막혔다.
           리포트 맨 위, 회사 이름 바로 앞에 둔다. -->
      <button type="button" class="co-back" data-back>
        <i class="ti ti-arrow-left"></i> 회사 찾기
      </button>
      <div class="co-hero">
        <span class="wf-avatar wf-avatar--lg" style="--co-color:${accentOf(selected.name)}">${esc(selected.name.charAt(0))}</span>
        <div class="co-hero-t">
          <div class="wf-eyebrow">Company report</div>
          <h1>${esc(selected.name)}</h1>
          <div class="co-hero-meta">
            ${selected.industry ? `<span class="wf-badge wf-badge--mute">${esc(selected.industry)}</span>` : ''}
            ${analysis?.dart?.profile?.established
              ? `<span>${esc(String(analysis.dart.profile.established).slice(0, 4))}년 설립</span>` : ''}
            ${analysis?.dart?.profile?.industryLabel
              ? `<span>${esc(analysis.dart.profile.industryLabel)}</span>` : ''}
          </div>
        </div>
        <div class="co-gauge">
          <div class="co-gauge-h">
            <span class="wf-eyebrow">담은 근거</span>
            <b>${ev.length}<span>건</span></b>
          </div>
          <div class="co-bar ${ev.length ? 'co-bar--ok' : ''}"><i style="width:${ev.length ? 100 : 0}%"></i></div>
          <!-- ── 종류를 나눠 센다 ──────────────────────────────
               예전에는 '근거 n/5' 한 숫자였는데, 담은 것들의 종류가 섞여 있어서
               4단계로 넘어가도 무엇을 어디에 쓰라는 것인지 알 수 없었다(그래서
               한동안 공고만 담게 좁혔었다). 숫자 하나가 아니라 **종류와 쓰임**을
               보여주는 것이 그 문제의 답이다. -->
          ${ev.length ? `<div class="co-gauge-kinds">
            ${Roadmap.evidenceByKind(selected.name).map(g =>
              `<span class="co-gauge-kind"><b>${esc(g.label)}</b> ${g.items.length}</span>`).join('')}
          </div>` : ''}
          <p class="co-gauge-note">${ev.length
            ? `자소서 코치의 <b>${esc([...new Set(Roadmap.evidenceByKind(selected.name).flatMap(g => g.use))].join(' · '))}</b> 문항에 그대로 붙습니다.`
            : '아래 칸에서 <b>자소서에 담기</b>를 누르면 4단계로 그대로 넘어가요.'}</p>
          <!-- 다음 행동. 예전에는 5번 카드를 눌러야 나왔는데, 그 칸까지 가는 사람이
               드물어서 게이지 바로 아래로 올렸다 — 리포트 어디를 보고 있든 눈에 든다. -->
          <button type="button" class="wf-btn wf-btn--primary wf-btn--sm wf-btn--block"
                  style="margin-top:12px" data-tocoach>
            이 회사 자소서 쓰러 가기
          </button>
        </div>
      </div>`;

    if (loading) return head + `<div class="co-loading">기사와 공시 자료를 찾는 중…</div>`;
    if (error) {
      return head + `<div class="jd-err">${esc(error)}</div>
        <div class="co-sec"><button type="button" class="wf-btn" data-pick="${esc(selected.name)}">다시 시도</button></div>`;
    }
    if (!analysis) return head;

    return head + cardsHtml() + detailHtml();
  }

  /* ── 기업분석 5단계 카드 ─────────────────────────────────────
     카드 얼굴에는 그 칸의 '지금 값'을 하나만 올린다(매출·기사 수·경쟁사 수).
     자세한 내용은 눌러야 아래에 펼쳐진다 — 다섯 칸을 통째로 스크롤하지 않게. */
  /* 칸 이름만 둔다. 예전에는 이름 아래에 '어떤 회사이고 규모는 어느 정도인가' 같은
     질문 한 줄이 같이 있었는데, 칸 이름이 이미 같은 말을 해서 지웠다(사용자 지시 2026-09-04).

     '경쟁사' → '같은 업종 회사'. 이 목록은 **업종코드가 같은 상장사**지 실제 경쟁
     관계를 확인한 회사가 아니다(dart.js competitors 주석). 이름이 '경쟁사' 면
     학생이 그 말을 그대로 믿고 자소서에 "경쟁사 A 와 달리" 라고 쓰게 된다. */
  const STEP_META = {
    overview:   { label: '개요' },
    financial:  { label: '재무·실적' },
    issue:      { label: '최근 이슈' },
    recruit:    { label: '채용공고' },
    competitor: { label: '같은 업종 회사' },
  };

  /* 3년치 꺾은선. 값 자체보다 방향이 자소서 재료라 눈금은 그리지 않는다. */
  function sparkHtml(series, direction) {
    const pts = (series || []).map(s => s.amount).filter(v => typeof v === 'number').reverse();
    if (pts.length < 2) return '';
    const min = Math.min(...pts), max = Math.max(...pts);
    const span = max - min || 1;
    const w = 62, h = 24;
    const coords = pts.map((v, i) => [
      (i / (pts.length - 1)) * (w - 4) + 2,
      h - 3 - ((v - min) / span) * (h - 6),
    ]);
    const color = direction === 'up' ? '#00a83a' : direction === 'down' ? '#ee1d36' : '#898989';
    const last = coords[coords.length - 1];
    return `<svg class="co-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${coords.map(c => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ')}"
        fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="${color}"/>
    </svg>`;
  }

  const arrowOf = d => d === 'up' ? '▲' : d === 'down' ? '▼' : '—';

  /* 카드 얼굴의 지표. 없으면 '자료 없음' 이라고 적고 비워 두지 않는다 —
     빈 칸을 숨기면 그 칸이 필요 없다고 오해한다. */
  function metricOf(key) {
    const dart = analysis.dart;
    const fin = dart?.financials;

    if (key === 'overview') {
      /* 규모를 한 눈에 세우는 값으로 직원 수를 쓴다. 없으면 설립연도로 물러난다 —
         둘 다 없으면 지어내지 않고 '공시 자료 없음' 이라고 적는다. */
      const emp = dart?.employees;
      if (emp) {
        return `<div class="co-card-v">${emp.count.toLocaleString()}<small>명</small></div>
          <div class="co-card-d co-card-d--flat">${emp.year}년 사업보고서</div>`;
      }
      const est = dart?.profile?.established;
      if (!est && !dart?.profile?.industryCode) return `<div class="co-card-none">공시 자료 없음</div>`;
      return `<div class="co-card-v">${est ? esc(String(est).slice(0, 4)) : '—'}<small>년 설립</small></div>
        <div class="co-card-d co-card-d--flat">${dart.profile.listed ? '상장' : '비상장'}</div>`;
    }
    if (key === 'recruit') {
      const n = analysis.jobs?.items?.length || 0;
      /* 여기에 '워크넷' 이 박혀 있었다. 소스가 넷(사람인·고용24·잡알리오·워크넷)인데
         타일만 늘 워크넷이라고 말해서, 고용24 에서 온 공고를 워크넷 것으로 읽게 했다.
         **어디서 온 값인지는 데이터가 말한다** — 박아 두면 소스를 하나 더 붙일 때마다
         조용히 틀린다(cas.js 배점 상수를 한 곳에 둔 것과 같은 이유). */
      if (!n) return `<div class="co-card-none">열린 공고 없음<br>채용 사이트에서 직접 찾으세요</div>`;
      const soon = analysis.jobs.items.filter(j => j.dday !== null).sort((a, b) => a.dday - b.dday)[0];
      const from = SOURCE_SHORT[analysis.jobs?.source] || '채용 정보';
      return `<div class="co-card-v">${n}<small>건</small></div>
        <div class="co-card-d co-card-d--flat">${soon ? `가장 이른 마감 D-${soon.dday}` : `${esc(from)} 기준`}</div>`;
    }
    if (key === 'financial') {
      const rev = fin?.accounts?.revenue;
      if (!rev) return `<div class="co-card-none">실적 자료 없음</div>`;
      const t = rev.trend;
      return `<div class="co-card-v">${esc(rev.series?.[0]?.readable || '—')}</div>
        ${t ? `<div class="co-card-d co-card-d--${t.direction}">${arrowOf(t.direction)} ${Math.abs(t.pct)}%</div>` : ''}
        ${sparkHtml(rev.series, t?.direction)}`;
    }
    if (key === 'competitor') {
      const n = dart?.competitors?.length || 0;
      return n ? `<div class="co-card-v">${n}<small>곳</small></div>
        <div class="co-card-d co-card-d--flat">업종코드 동일</div>`
        : `<div class="co-card-none">확인된 곳 없음</div>`;
    }
    if (key === 'issue') {
      const n = newsItems().length;
      const kw = analysis.news?.keywords?.[0];
      return n ? `<div class="co-card-v">${n}<small>건</small></div>
        ${kw ? `<div class="co-card-d co-card-d--flat">${esc(kw.term)}</div>` : ''}`
        : `<div class="co-card-none">수집된 기사 없음</div>`;
    }
    return '';
  }

  function cardsHtml() {
    const steps = analysis.steps || [];
    return `<div class="co-sec">
      <div class="co-sec-h"><h2>이 회사에 대해 확인된 것</h2>
        <span class="co-src">칸을 누르면 아래에 자세히 나옵니다</span></div>
      <div class="co-cards">
        ${steps.map(s => {
          const meta = STEP_META[s.key] || { label: s.label };
          return `<button type="button" class="co-card ${s.key === step ? 'is-on' : ''}" data-step="${esc(s.key)}">
            <span class="co-card-top">
              <span class="co-card-n">0${s.no}</span>
              <span class="co-card-l">${esc(meta.label)}</span>
            </span>
            <span class="co-card-metric">${metricOf(s.key)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  /* ── 고른 칸의 자세한 내용 ───────────────────────────────── */
  function detailHtml() {
    const s = (analysis.steps || []).find(x => x.key === step);
    if (!s) return '';
    const meta = STEP_META[s.key] || { label: s.label };
    const body = {
      overview: overviewDetail, financial: financeDetail,
      issue: issueDetail, recruit: recruitDetail, competitor: competitorDetail,
    }[s.key];

    return `<div class="co-detail">
      <div class="co-detail-h">
        <h3>${esc(meta.label)}</h3>
      </div>
      ${body ? body(s) : ''}
    </div>`;
  }

  function overviewDetail(s) {
    const p = analysis.dart?.profile;
    const emp = analysis.dart?.employees;
    if (!p) return `<p class="co-step-note">${esc(s.note)}${s.link
      ? ` <a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">홈페이지 열기</a>` : ''}</p>`;

    const est = p.established
      ? `${p.established.slice(0, 4)}.${p.established.slice(4, 6)}.${p.established.slice(6, 8)}`
      : '—';
    /* 규모 지표는 위에 크게 세운다(A-1 안의 지표 카드와 같은 얼개) — 자소서에
       회사를 고를 때 규모를 가늠하는 값이다. **담기는 붙이지 않는다**(사용자 지시) —
       자소서에 인용할 말이 아니라 고를 때 보는 값이라, id·text 도 두지 않는다.
       안 쓰는 필드를 남겨 두면 다음 사람이 담기가 있었던 자리로 읽는다. */
    const won = n => n >= 1e8 ? `${(n / 1e8).toFixed(1)}억원`
      : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만원` : `${n.toLocaleString()}원`;

    const stats = [];
    if (emp) {
      stats.push({
        label: '직원 수', value: emp.count.toLocaleString(), unit: '명',
        sub: emp.regular ? `정규직 ${emp.regular.toLocaleString()}명` : `${emp.year}년 기준`,
      });
      if (emp.tenureYears) stats.push({
        label: '평균 근속연수', value: emp.tenureYears, unit: '년',
        sub: '길수록 이직이 적다는 뜻',
      });
      if (emp.avgPay) stats.push({
        label: '1인 평균 급여', value: won(emp.avgPay), unit: '',
        sub: `${emp.year}년 연간 기준`,
      });
    }

    const facts = [
      /* 날코드를 적지 않는다 — 읽는 사람에게 '212' 는 아무 뜻이 없다(hero 와 같은 판단). */
      ['업종', p.industryLabel || p.sector || '—'],
      ['설립일', est],
      ['대표자', p.ceo || '—'],
      ['상장', p.listed ? `${p.market || '상장'} ${p.stockCode || ''}`.trim() : '비상장'],
      ['결산월', p.settlementMonth ? `${p.settlementMonth}월` : '—'],
      ['본사', p.address || '—'],
    ];

    return `
      <!-- ── 여기에는 담기를 두지 않는다 (사용자 지시) ──────────────
           직원 수·근속연수·평균 급여는 **회사를 고를 때 보는 값**이지 자소서에 인용할
           말이 아니다. "직원 627명인 회사에 지원합니다" 는 지원동기가 되지 않는다.
           담을 만한 숫자는 재무 칸의 매출·영업이익 추이 쪽이고, 담기는 거기 있다. -->
      ${stats.length ? `<div class="co-stats">
        ${stats.map(x => `<div class="co-stat">
          <div class="co-stat-l">${esc(x.label)}</div>
          <div class="co-stat-v">${esc(String(x.value))}${x.unit ? `<small>${esc(x.unit)}</small>` : ''}</div>
          <div class="co-stat-sub">${esc(x.sub)}</div>
        </div>`).join('')}
      </div>` : ''}

      <div class="co-facts" style="margin-top:${stats.length ? '12px' : '0'}">
        ${facts.map(([l, v]) => `<div class="co-fact">
          <div class="co-fact-l">${esc(l)}</div><div class="co-fact-v">${esc(v)}</div></div>`).join('')}
        ${p.homepage ? `<div class="co-fact"><div class="co-fact-l">홈페이지</div>
          <div class="co-fact-v"><a href="${esc(httpUrl(p.homepage))}" target="_blank" rel="noopener noreferrer">바로가기</a></div></div>` : ''}
        ${p.irUrl ? `<div class="co-fact"><div class="co-fact-l">IR 자료</div>
          <div class="co-fact-v"><a href="${esc(p.irUrl)}" target="_blank" rel="noopener noreferrer">사업부문별 매출 보기</a></div></div>` : ''}
      </div>
      ${financeSnapshotHtml()}
      ${businessHtml()}`;
      /* 예전에는 여기에 "사업부별 매출 비중은 API 로 받을 수 없습니다 — DART 도
         공공데이터포털도 그 값을 열어두지 않았고…" 라는 문단이 있었다. 지웠다
         (사용자 지시 2026-09-04): **우리 쪽 사정**이지 학생이 할 일이 아니다.
         사업부문별 매출을 보러 갈 자리는 위 facts 의 'IR 자료' 링크가 이미 준다. */
  }

  /* 채용공고 — 우리가 회사별 공고를 들고 있지 않다. 있는 척하지 않고 찾는 경로를 준다.
     예전 '인재상' 칸을 이걸로 바꿨다: 인재상은 회사마다 비슷한 캐치프레이즈라
     자소서에 쓸 게 못 되고, 실제로 필요한 건 지금 열려 있는 공고의 자격요건이다. */
  /* ── 안내 문구는 소스마다 다르다 ────────────────────────────
     사람인·워크넷은 목록 API 가 **제목·조건만** 준다.
     잡알리오는 `aplyQlfcCn`(지원자격)·`prefCn`(우대사항)을 같이 준다.

     ── 다만 그것이 '역량'은 아니다 (실측) ──
     처음에는 "이제 복붙 없이 역량 분석이 된다"고 안내하려 했다. 532건에 돌려 보고
     접었다 — 공공기관 공고의 저 필드는 **응시 요건**이지 직무 역량 서술이 아니다.
     연령·학력·전공 제한, 마감일 기준, 법정 가점이 대부분이고, 정형문구를 걷어내도
     **절반은 역량이 하나도 안 잡힌다.** 민간 공고의 [자격요건]/[우대사항]과 성격이
     다르다.

     그래도 담는 값어치는 있다 — 학생이 **지원할 수 있는 공고인지**(연령·학력·자격증)
     판단하는 정보다. 그러니 있는 그대로 말한다: 자격 정보는 채워지고, 역량까지
     원하면 원문을 이어붙이라고. 되는 것처럼 말해 놓고 안 되면 그게 더 나쁘다. */
  const SOURCE_LABEL = {
    saramin: '사람인', worknet: '워크넷', alio: '공공기관 채용정보(잡알리오)',
    work24: '고용24 채용정보',
  };
  /* 요약 타일은 한 줄이 좁다 — 같은 소스를 짧게 부르는 이름을 따로 둔다.
     두 표가 갈리지 않게 키는 같은 것을 쓴다. */
  const SOURCE_SHORT = { saramin: '사람인', worknet: '워크넷', alio: '잡알리오', work24: '고용24' };

  /* ── 공고 카드의 회사 이미지 (2026-09-06, 사용자 지시) ──────
     로고는 서버가 회사 홈페이지에서 받아 우리 주소로 준다(`analysis.logo`).
     **없는 회사가 많다** — 홈페이지를 공시하지 않았거나(비상장) 로고를 못 찾은
     경우다. 그때는 회사 이니셜로 같은 크기의 칸을 그린다:

       · 깨진 이미지 아이콘을 띄우지 않는다. 학생은 그걸 고장으로 읽는다
       · 로고 있는 회사와 **자리·크기가 같아야** 목록의 줄이 흔들리지 않는다
       · 색을 회사명에서 만들어 같은 회사면 늘 같은 색이다. 무작위로 하면
         새로고침할 때마다 바뀌어서 딴 회사처럼 보인다

     로고를 못 받으면 서버가 204 를 준다. 몸통이 없으니 브라우저는 디코딩에 실패해
     `error` 를 쏘지만, **그 한 가지만 믿지 않는다** — 0바이트나 깨진 파일이 200 으로
     오면 `load` 가 뜨면서 아무것도 안 그려진다. 그래서 둘 다 본다:
     `error` 면 바로, `load` 면 실제로 픽셀이 있는지(naturalWidth) 확인하고 바꾼다. */
  function initialColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 42% 46%)`;
  }

  function jobLogo(companyName) {
    const initial = String(companyName || '?').trim().charAt(0) || '?';
    const box = `<div class="co-job-logo co-job-logo--txt" style="background:${initialColor(companyName)}">${esc(initial)}</div>`;
    /* 로고 주소는 우리가 보고 있는 회사 것이다. 공고의 회사명이 다르면(대조가
       느슨한 소스가 섞일 수 있다) 붙이지 않는다 — 남의 로고를 띄우는 쪽이 나쁘다. */
    const url = analysis.logo;
    if (!url || !sameName(companyName, selected.name)) return box;
    const swap = `this.closest('.co-job-logo').outerHTML=${JSON.stringify(box)}`;
    return `<div class="co-job-logo"><img src="${esc(url)}" alt=""
        onerror="${esc(swap)}"
        onload="if(!this.naturalWidth){${esc(swap)}}"></div>`;
  }

  /* 회사명이 같은가. 서버의 sameCompany 와 같은 규칙이다(법인격 표기·공백 무시).
     여기서 느슨하게 잡으면 '삼성전자로지텍' 공고에 삼성전자 로고가 붙는다. */
  function sameName(a, b) {
    const norm = x => String(x || '')
      .replace(/\(주\)|\(유\)|\(재\)|\(사\)|주식회사|유한회사|재단법인|사단법인/g, '')
      .replace(/\s+/g, '').toLowerCase();
    return Boolean(norm(a)) && norm(a) === norm(b);
  }

  /* 안내는 **학생이 할 일**만 적는다 — 어디서 받아 오는지, 그 경로가 무엇까지
     주는지는 우리 사정이다(사용자 지시 2026-09-04). */
  function jobsHint(jobs) {
    const label = SOURCE_LABEL[jobs.source] || '채용 정보';
    const withBody = (jobs.items || []).filter(j => j.qualification || j.preference).length;

    /* ── 고용24 만 '언제 받은 것인지' 를 적는다 (2026-09-06) ──
       다른 소스는 부를 때가 최신이지만, 고용24 는 공개 화면을 **하루 한 번** 받아 둔
       것이라 값이 하루까지 낡을 수 있다. 공고는 마감이 생명이라 그 차이를 숨기면
       안 된다 — 25-2 에서 크롤링을 접었던 이유 중 하나가 바로 이 시의성이었고,
       이제 우리가 그 부담을 졌으니 화면에서 말한다. */
    if (jobs.source === 'work24') {
      const h = jobs.ageHours;
      const when = h == null ? '' : h < 1 ? '방금 받은 자료예요.'
        : h < 24 ? `${Math.round(h)}시간 전 받은 자료예요.`
        : `${Math.round(h / 24)}일 전 받은 자료예요.`;
      return `<p class="jd-hint">${esc(label)} 기준입니다. ${esc(when)}
        하루에 한 번 새로 받으니 <b>마감일은 공고를 열어 확인하세요</b>.
        공고를 <b>담으면</b> 자소서 코치로 그대로 넘어가요.</p>`;
    }

    if (withBody) {
      return `<p class="jd-hint">${esc(label)} 기준입니다. 지원자격·우대사항이 함께 담겨 있어요.
        요구 역량까지 보려면 공고를 열어 <b>본문을 이어붙이세요</b>.</p>`;
    }
    return `<p class="jd-hint">${esc(label)} 기준입니다.
      공고를 <b>담으면</b> 자소서 코치로 그대로 넘어가요. 요구 역량까지 뽑으려면
      공고를 열어 <b>본문을 복사해 붙여넣으세요</b>.</p>`;
  }

  function recruitDetail(s) {
    const n = encodeURIComponent(selected.name);
    const jobs = analysis.jobs || {};
    const sites = [
      ['사람인', `https://www.saramin.co.kr/zf_user/search?searchword=${n}`],
      ['잡코리아', `https://www.jobkorea.co.kr/Search/?stext=${n}`],
      ['워크넷', `https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?searchWord=${n}`],
    ];

    /* 담기는 **여기에만** 있다. 예전에는 기사·실적·직원수에도 붙어 있었는데, 담은
       것들이 서로 다른 종류라 자소서 코치로 넘어가서 무엇에 쓰라는 것인지 알 수
       없었다. 지금은 담는 대상이 '지원할 공고' 하나로 정해져 있고, 넘어가면 그
       공고가 자소서 코치의 회사·공고 칸에 바로 들어간다. */
    const list = jobs.items?.length ? `
      <div class="co-jobs">
        ${jobs.items.map(j => {
          const id = `job-${j.id || j.title}`;
          return `<div class="co-job">
            ${jobLogo(j.company || selected.name)}
            <div class="co-job-t">
              ${j.url
                ? `<a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a>`
                : `<b>${esc(j.title)}</b>`}
              <small>${[j.company, ...(j.labels || []), j.region, j.career, j.edu]
                .filter(Boolean).map(esc).join(' · ')}</small>
            </div>
            ${j.dday !== null
              ? `<span class="wf-badge ${j.dday <= 7 ? 'wf-badge--error' : 'wf-badge--mute'}">D-${j.dday}</span>`
              : `<span class="wf-badge wf-badge--mute">상시</span>`}
            ${isPicked(id)
              ? `<button type="button" class="co-take is-on" data-unpick="${esc(id)}">
                   <i class="ti ti-check"></i> 담김</button>`
              /* 공고만 따로 dataset 이 길다 — 자격요건·우대사항까지 넘겨야 4단계가
                 공고 본문을 조립할 수 있기 때문이다(applyPickedJob). 나머지 종류는
                 text 한 줄이면 충분해서 pickBtn 을 쓴다. */
              : `<button type="button" class="wf-btn wf-btn--xs wf-btn--primary"
                   data-add="${esc(id)}" data-title="${esc(j.title)}" data-url="${esc(j.url || '')}"
                   data-career="${esc(j.career || '')}" data-edu="${esc(j.edu || '')}"
                   data-region="${esc(j.region || '')}" data-dday="${j.dday ?? ''}"
                   data-qual="${esc(j.qualification || '')}" data-pref="${esc(j.preference || '')}"
                   >이 공고로 자소서 쓰기</button>`}
          </div>`;
        }).join('')}
      </div>
      ${jobsHint(jobs)}`
      : `<div class="co-note"><i class="ti ti-info-circle"></i>
           ${esc(jobs.reason || '이 회사 이름으로 열린 공고가 없습니다.')}
           대기업 공채는 자사 채용 사이트로만 올라오는 일이 많아, 없는 것이 정상인 경우도 있어요.</div>`;

    /* ── 나가기 전에 담게 한다 ──────────────────────────────
       아래 링크를 누르면 학생은 우리 화면을 떠난다. 그전에 공고를 담아 두면 4단계가
       그것을 이어받으므로 **돌아올 이유**가 생긴다. 담긴 게 없을 때만 권하고, 담았으면
       다음 단계로 가는 길을 준다 — 같은 말을 두 번 하지 않는다. */
    const takenJobs = evidenceOf(selected.name).filter(e => e.kind === 'job').length;
    const nudge = takenJobs
      ? `<div class="co-nudge co-nudge--done">
           <i class="ti ti-check"></i>
           <span>공고 <b>${takenJobs}건</b> 담김 — 자소서 코치가 이어받습니다.</span>
           <button type="button" class="wf-btn wf-btn--sm wf-btn--primary" data-gonext>자소서 코치로 →</button>
         </div>`
      : jobs.items?.length
        ? `<div class="co-nudge">
             <i class="ti ti-bookmark"></i>
             <span>나가기 전에 — 지원할 공고를 <b>담아 두면</b> 자소서 코치가 회사·공고 칸을
               채운 채로 시작합니다.</span>
           </div>`
        /* 공고가 0건이어도 4단계는 시작할 수 있다(21-5). 여기서 길을 막으면 학생은
           "공고를 못 찾았으니 끝" 으로 읽는다. */
        : `<div class="co-nudge">
             <i class="ti ti-pencil"></i>
             <span>공고가 없어도 <b>회사만으로</b> 자소서를 시작할 수 있어요.</span>
             <button type="button" class="wf-btn wf-btn--sm" data-gonext>자소서 코치로 →</button>
           </div>`;

    /* ── 링크 순서: 자사 채용페이지가 먼저다 (팀 결정 2026-08-21) ──
       사람인·잡코리아는 우리와 기능이 겹치는 서비스다. 거기로 보내면 학생이 굳이
       돌아올 이유가 없다. 자사 채용페이지는 공고만 있고 자소서를 봐주지 않으니
       돌아올 이유가 남는다 — 게다가 대기업 공채는 실제로 자사 사이트에만 올라오는
       일이 많아 **학생에게도 그쪽이 더 정확하다.**

       다만 검색 링크를 없애지는 않는다. 표(career-pages.json)는 손으로 채우는 것이라
       대부분의 회사는 아직 비어 있고, 링크가 통째로 사라지면 학생은 공고를 찾을 길을
       잃는다. 자사 링크가 있으면 그것을 크게, 검색은 작게 뒤로 물린다. */
    /* ── 자사 링크: 검증된 채용페이지 → 공식 홈페이지 순 (사용자 지시) ──
       career-pages.json 은 손으로 검증한 **정확한 채용 URL** 만 담아 대부분 비어 있다.
       그래서 그 표에 없을 때는 DART 개황의 **공식 홈페이지**로 보낸다 — 이건 추측한
       /recruit 경로가 아니라 전자공시에 등록된 회사 실제 주소라, 어느 회사든
       "그 회사 사이트" 로 정확히 들어간다(팀이 금지한 것은 경로 추측이지 홈페이지가
       아니다). 홈페이지 첫 화면의 '채용·인재영입' 메뉴에 공고가 있다. */
    const own = analysis.careerPage;
    const homepage = analysis.dart?.profile?.homepage ? httpUrl(analysis.dart.profile.homepage) : '';
    const ownBlock = own
      ? `<div class="co-own">
          <a class="wf-btn wf-btn--primary" href="${esc(own)}" target="_blank" rel="noopener noreferrer">
            <i class="ti ti-external-link"></i> ${esc(selected.name)} 채용 사이트
          </a>
          <small>공채는 여기에만 올라오는 일이 많아요</small>
        </div>`
      : homepage
        ? `<div class="co-own">
            <a class="wf-btn wf-btn--primary" href="${esc(homepage)}" target="_blank" rel="noopener noreferrer">
              <i class="ti ti-external-link"></i> ${esc(selected.name)} 공식 홈페이지
            </a>
            <small>첫 화면의 <b>채용·인재영입</b> 메뉴에서 공고를 확인하세요 —
              공채는 자사 사이트에만 올라오는 일이 많아요.</small>
          </div>`
        : '';
    const hasOwn = own || homepage;
    return `
      ${list}
      ${nudge}
      ${ownBlock}
      <div class="co-kw" style="margin-top:${hasOwn ? '10' : '16'}px">
        ${hasOwn ? '<span class="co-more-label">그 외에서 찾기</span>' : ''}
        ${sites.map(([label, url]) =>
          `<a class="wf-btn wf-btn--sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${hasOwn ? '' : '에서 더 찾기'}</a>`).join('')}
      </div>
      <p class="jd-hint">회사 인재상 문구는 자소서에 쓰지 마세요 —
        어느 회사에나 있는 말이라 읽는 사람에게 아무 정보가 되지 않습니다.</p>`;
  }

  function financeDetail(s) {
    const fin = analysis.dart?.financials;
    if (!fin) {
      return `<div class="co-note"><i class="ti ti-info-circle"></i>
        재무 자료가 없습니다 — ${esc(analysis.dartReason || analysis.dart?.note || s.note)}</div>`;
    }
    /* 값 자체보다 **방향**이 자소서의 재료다("역성장 구간에서 무엇을 하려는
       회사인가"). 그래서 담는 문장에 전년비를 같이 넣는다 — 숫자 하나만 담아 가면
       4단계에서 그게 늘어난 값인지 줄어든 값인지 알 수 없다. */
    const rows = Object.entries(fin.accounts).map(([key, acc]) => {
      const t = acc.trend;
      const label = analysis.dart.labels[key] || key;
      const now = acc.series?.[0];
      const text = t
        ? `${label} ${now?.readable || ''} · 전년비 ${t.direction === 'up' ? '+' : t.direction === 'down' ? '−' : ''}${Math.abs(t.pct)}%`
        : `${label} ${now?.readable || ''}`;
      return `<tr>
        <th>${esc(label)}</th>
        ${acc.series.map(x => `<td>${x.readable ? esc(x.readable) : '—'}<span>${x.year}</span></td>`).join('')}
        <td class="co-trend--${t ? t.direction : 'none'}">${t ? `${arrowOf(t.direction)} ${Math.abs(t.pct)}%` : '—'}</td>
        <td class="co-tbl-take">${pickBtn({
          id: `fin-${key}`, kind: 'fact', text,
          source: `${fin.baseYear}년 사업보고서 · ${fin.fsDiv === 'CFS' ? '연결' : '개별'} 기준`,
        })}</td>
      </tr>`;
    }).join('');

    return `
      <div class="co-tblwrap">
        <table class="co-tbl">
          <thead><tr><th style="text-align:left">계정</th><th>당기</th><th>전기</th><th>전전기</th><th>전년비</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="jd-hint">${fin.baseYear}년 사업보고서 · ${fin.fsDiv === 'CFS' ? '연결' : '개별'} 기준.
        역성장 구간이면 "무엇을 하려는 회사인가"가, 성장 구간이면 "무엇을 더 키우려 하는가"가
        자소서의 재료가 됩니다.</p>`;
  }

  function competitorDetail(s) {
    const list = analysis.dart?.competitors;
    if (!list?.length) return `<p class="co-step-note">${esc(s.note)}</p>`;

    const mine = analysis.dart?.financials?.accounts?.revenue?.series?.[0]?.amount || null;
    const won = n => n >= 1e12 ? `${(n / 1e12).toFixed(1)}조원` : `${Math.round(n / 1e8).toLocaleString()}억원`;
    const sized = list.some(c => c.sized);

    return `
      <div class="co-rivals">
        ${list.map(c => {
          const ratio = c.revenue && mine ? c.revenue / mine : null;
          return `<div class="co-rival">
            <span class="wf-avatar wf-avatar--sm" style="--co-color:${accentOf(c.name)}">${esc(c.name.charAt(0))}</span>
            <div class="co-rival-t">
              <b>${esc(c.name)}</b>
              <small>${c.revenue
                ? `매출 ${won(c.revenue)}${ratio ? ` · 우리의 ${ratio >= 1 ? `${ratio.toFixed(1)}배` : `${Math.round(ratio * 100)}%`}` : ''}`
                : '매출 자료 없음 (신규 상장이거나 결산이 늦은 회사)'}</small>
            </div>
            <button type="button" class="wf-btn wf-btn--xs" data-pick="${esc(c.name)}">리포트 보기</button>
          </div>`;
        }).join('')}
      </div>
      <p class="jd-hint">${sized
        ? `표준산업분류가 같은 상장사 중 <b>매출이 0.3~3배 범위</b>인 회사만 남겼습니다 —
           업종코드만 보면 덩치가 수백 배 다른 회사가 섞여서, 그대로 믿고 쓰면 면접에서 무너집니다.`
        : `이 회사는 매출 자료가 없어 규모 비교를 못 했습니다. 아래는 <b>업종코드만 같은</b> 회사예요.`}
        그래도 <b>실제 경쟁 관계인지는 직접 확인하세요</b> — 같은 업종·비슷한 규모라도 파는 물건이 다를 수 있습니다.</p>`;
  }

  /* 기사 목록 — 중복 제거는 **서버가 한다**(news.js 의 cluster(): 같은 사건을 다룬
     기사를 단어 자카드로 묶어 대표 한 건만 내려보낸다). 여기서 또 거르면 같은 규칙이
     두 곳에 생겨 어긋나므로 그대로 쓴다. 6건째부터는 네이버 뉴스로 보낸다 —
     우리가 들고 있을 이유가 없다. */
  const newsItems = () => analysis?.news?.items || [];

  /* 기사 카드 한 장. 최신 뉴스와 주요 뉴스가 같은 모양을 써야 해서 함수로 뺐다 —
     두 곳에 같은 마크업을 두면 한쪽만 고쳐진다.

     제목과 링크만 담는다. 기사 본문을 요약해 담으면 지어낸 사실이 자소서로
     흘러간다 — 이 화면이 AI 에게 기사를 요약시키지 않는 것과 같은 이유
     (news.js 머리주석). 학생은 원문을 읽고 자기 말로 쓴다. */
  function newsCard(it, prefix) {
    const id = `news-${prefix}-${(it.url || it.title).slice(-40)}`;
    /* 시기 배지는 목록마다 다르다 — 최신은 '오늘/N일 전'(daysAgo), 주요는 '약 N주 전'
       (weekLabel). 폴백(웹 검색)에는 둘 다 없어서 아무것도 안 붙는다. */
    const when = it.weekLabel
      ? `<span class="co-news-when">${esc(it.weekLabel)}</span>`
      : (typeof it.daysAgo === 'number'
        ? `<span class="co-news-when">${it.daysAgo === 0 ? '오늘' : `${it.daysAgo}일 전`}</span>`
        : '');
    const buzz = it.outlets > 1 ? `<span class="co-news-buzz">언론사 ${it.outlets}곳</span>` : '';
    return `<div class="co-news-item">
      <div class="co-news-t">
        <div class="co-news-badges">${when}${buzz}</div>
        <a href="${esc(it.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
        <div class="co-news-meta">${[it.date, hostOf(it.url)].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      ${pickBtn({
        id, kind: 'news', text: it.title, url: it.url || '',
        /* 검색 API 는 언론사 이름을 안 준다. 주소의 호스트를 쓴다 — 지어낸 값이
           아니라 링크에 이미 들어 있는 사실이고, 날짜만 적힌 출처보다는
           "어디 기사인가" 를 알 수 있다. */
        source: [it.date, hostOf(it.url)].filter(Boolean).join(' · ') || '뉴스 검색',
      })}
    </div>`;
  }

  function issueDetail(s) {
    /* ── 최신 / 주요를 나눠 보여준다 (사용자 지적 2026-09-08) ──────────────────
       예전에는 weekly(3개월을 2~3주로 끊은 대표 기사) 하나만 보여줬다. 그러면 이번 주에
       기사가 열 건 나와도 **한 건만** 뜬다 — 지원 직전에 "요즘 무슨 일 있나"를 보려는
       사람에게는 없는 것과 같다(사용자: "최신 뉴스가 없음").
         · 최신 뉴스 — 지금부터 1주일 안, 최신순 (서버 news.latest)
         · 주요 뉴스 — 3개월 흐름, 구간별 대표 (서버 news.weekly)
       발행일이 없는 웹 폴백은 둘 다 비므로 그때만 기존 목록(items)으로 내려간다. */
    const latest = analysis?.news?.latest || [];
    const weekly = analysis?.news?.weekly || [];
    const items = weekly.length ? weekly : newsItems();
    if (!items.length && !latest.length) {
      return `<div class="co-note"><i class="ti ti-info-circle"></i>
        ${esc(analysis.newsError || s.note)}</div>`;
    }
    const kws = (analysis.news.keywords || []).slice(0, 8);
    const naver = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(selected.name)}`;

    return `
      ${latest.length ? `
        <div class="co-news-group">
          <span class="wf-eyebrow">최신 뉴스</span>
          ${analysis.news.latestNote ? `<p class="jd-hint" style="margin:4px 0 12px">${esc(analysis.news.latestNote)}</p>` : ''}
          <div class="co-news">${latest.map(it => newsCard(it, 'new')).join('')}</div>
        </div>` : `
        ${analysis.news.latestNote ? `<p class="jd-hint" style="margin:0 0 12px">${esc(analysis.news.latestNote)}</p>` : ''}`}

      ${items.length ? `
        <div class="co-news-group" style="margin-top:${latest.length ? '22px' : '0'}">
          <span class="wf-eyebrow">주요 뉴스</span>
          ${analysis.news.weeklyNote ? `<p class="jd-hint" style="margin:4px 0 12px">${esc(analysis.news.weeklyNote)}</p>` : ''}
          <div class="co-news">${items.map(it => newsCard(it, 'top')).join('')}</div>
        </div>` : ''}
      <div style="margin-top:14px">
        <a class="wf-btn wf-btn--sm" href="${esc(naver)}" target="_blank" rel="noopener noreferrer">
          네이버 뉴스에서 더 보기
        </a>
      </div>
      ${kws.length ? `
        <div style="margin-top:20px">
          <span class="wf-eyebrow">기사에서 반복된 말</span>
          <div class="co-kw">${kws.map(k =>
            `<span class="co-kw-item">${esc(k.term)}<b>${k.count}</b></span>`).join('')}</div>
          <p class="jd-hint">몇 건의 기사에서 나온 말인지를 같이 적었습니다.
            근거를 못 짚는 키워드는 자소서에 쓰지 마세요 — 면접에서 되물으면 답할 수 없습니다.</p>
        </div>` : ''}`;
  }


  /* '담은 공고' 칸은 없앴다 (사용자 지시) — 리포트 맨 위에 '이 회사 자소서 쓰러 가기'
     버튼이 이미 있어서, 같은 이동을 아래에서 한 번 더 묻는 칸이었다. 담는 동작 자체는
     채용공고 칸에 그대로 있고, 담으면 자소서 코치의 회사·공고 칸이 채워진다. */

  /* ── 이벤트 ──────────────────────────────────────────────── */
  /* 회사를 고르는 버튼만 따로 묶는다 — 드롭다운은 입력 도중 자기만 다시 그려서
     bind() 전체를 부를 수 없기 때문이다. */
  function bindPick(scope) {
    scope.querySelectorAll('[data-pick]').forEach(el =>
      el.addEventListener('click', () => select(el.dataset.pick)));
  }

  function bind(box) {
    bindPick(box);
    box.querySelectorAll('[data-unpick]').forEach(el =>
      el.addEventListener('click', () => unpick(el.dataset.unpick)));
    /* 공고 말고는 전부 이쪽이다(사업 내용·회사 숫자·기사). */
    box.querySelectorAll('[data-take]').forEach(el =>
      el.addEventListener('click', () => pick({
        id: el.dataset.take,
        kind: el.dataset.kind,
        text: el.dataset.text,
        source: el.dataset.source || '',
        url: el.dataset.url || '',
      })));

    /* 4단계로 넘어가는 유일한 버튼. 스텝바로도 갈 수 있지만, 공고를 담은 직후가
       가장 넘어가기 좋은 순간이라 그 자리에 길을 둔다. */
    box.querySelectorAll('[data-gonext]').forEach(el =>
      el.addEventListener('click', () => Roadmap.goNext('company')));

    box.querySelectorAll('[data-add]').forEach(el =>
      el.addEventListener('click', () => pick({
        id: el.dataset.add,
        kind: 'job',
        source: '채용공고',
        text: el.dataset.title,
        url: el.dataset.url || '',
        career: el.dataset.career || '',
        edu: el.dataset.edu || '',
        region: el.dataset.region || '',
        dday: el.dataset.dday === '' ? null : Number(el.dataset.dday),
        /* 있으면 같이 담는다 — 자소서 코치가 이걸로 공고 본문을 만든다(B20).
           없는 소스(사람인·워크넷)에서는 빈 값이라 예전과 똑같이 동작한다. */
        qualification: el.dataset.qual || '',
        preference: el.dataset.pref || '',
      })));

    // 기업규모 필터
    box.querySelectorAll('[data-size]').forEach(el =>
      el.addEventListener('click', () => setSize(el.dataset.size || null)));

    /* 업종 고르기 — 어느 단계에서 눌렀는지는 **버튼이 들고 있다**(data-depth).
       DOM 을 거슬러 올라가 순서로 알아내면 자동으로 건너뛴 단계가 끼었을 때 어긋난다. */
    box.querySelectorAll('[data-go]').forEach(el =>
      el.addEventListener('click', () => {
        const i = Number(el.dataset.depth);
        const was = path[i];
        path = path.slice(0, i);
        if (was !== el.dataset.go) path.push(el.dataset.go);
        lanePage = 0;                       // 업종이 바뀌면 목록 첫 장부터
        paint();
      }));

    // 접힌 단계를 다시 펼친다 — 그 단계부터 아래 선택은 푼다
    box.querySelectorAll('[data-open]').forEach(el =>
      el.addEventListener('click', () => { path = path.slice(0, Number(el.dataset.open)); lanePage = 0; paint(); }));

    // '고른 업종 회사' 페이지 넘김
    box.querySelectorAll('[data-lane-page]').forEach(el =>
      el.addEventListener('click', () => { lanePage = Number(el.dataset.lanePage); paint(); }));

    // 기업분석 5단계 카드 — 누른 칸만 아래에 펼친다
    box.querySelectorAll('[data-step]').forEach(el =>
      el.addEventListener('click', () => { step = el.dataset.step; paint(); }));

    /* 돌아가는 자리가 둘이다(리포트 맨 위 · 사이드바 아래). querySelector 로
       하나만 잡으면 위엣것만 살고 사이드바 버튼이 죽는다. */
    box.querySelectorAll('[data-back]').forEach(el => el.addEventListener('click', back));

    box.querySelectorAll('[data-tocoach]').forEach(el =>
      el.addEventListener('click', () => {
        localStorage.setItem('careerly_selected_company', selected.name);
        /* 로드맵 3단계의 결론 — 스텝바와 4단계가 이 회사 이름을 쓴다.
           직무 없이 회사만 고른 경우(네비로 바로 들어온 사용자)는 흐름 상태를
           만들지 않는다. Roadmap.setCompany 가 알아서 무시한다. */
        Roadmap.setCompany(selected.name);
        navigate('jd');
      }));

    /* 검색창은 두 자리(검색 화면 가운데 · 리포트 사이드바)에 있지만 규칙은 하나다.
       입력창은 화면이 그려질 때 한 번만 만들어지고 그 뒤로는 건드리지 않는다
       (자동완성이 입력창을 다시 만들면 한글 조합이 깨진다 — runSuggest 주석 참고). */
    bindSearch(box.querySelector('#co-q'));
    bindSearch(box.querySelector('#co-side-q'));
  }

  function bindSearch(q) {
    if (!q) return;
    let timer = null;
    let composing = false;

    /* IME 조합 중에는 검색을 보내지 않는다. '삼'을 치는 동안 ㅅ·사·삼 세 번이
       날아가는데, 중간 글자로 부른 결과는 어차피 버려진다. 조합이 끝날 때 한 번만. */
    q.addEventListener('compositionstart', () => { composing = true; });
    q.addEventListener('compositionend', e => {
      composing = false;
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => runSuggest(v), 180);
    });

    q.addEventListener('input', e => {
      if (composing) return;
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => runSuggest(v), 220);
    });

    q.addEventListener('keydown', e => {
      /* 조합 중 Enter 는 글자를 확정하는 키다. 여기서 회사를 열면 '삼성'을
         확정하려던 순간에 엉뚱한 회사로 들어간다(e.isComposing 으로 걸러낸다). */
      if (e.key !== 'Enter' || e.isComposing) return;
      const first = suggestions[0]?.name || e.target.value.trim();
      if (first) select(first);
    });

    /* 검색 화면에서만 값을 되살린다 — 리포트 사이드바는 늘 빈 칸으로 시작한다. */
    if (query && q.id === 'co-q') {
      q.value = query; q.focus(); q.setSelectionRange(query.length, query.length);
    }
  }

  /* 페이지 진입 — 자소서 코치에서 회사명을 들고 왔으면 그 회사를 연다. */
  /* 계열 목록은 화면을 막지 않는다 — 먼저 그리고, 도착하면 그 자리만 다시 그린다.

     로드맵 직무가 바뀌면 focus 도 달라지므로 다시 받는다. 캐시한 채로 두면
     직무를 바꿔도 예전 직무의 계열이 강조된 채 남는다(조용히 틀리는 쪽). */
  /* 취업 업종 트리 — 첫 화면에서 한 번 받는다.
     직무가 바뀌면 focus 가 달라지므로 그때는 다시 받는다(목록 자체는 같지만
     "이 직무를 주로 뽑는 업종" 표시가 직무마다 다르다). */
  async function loadTree() {
    const rm = Roadmap.get();
    const mid = rm?.middle || '';
    const job = rm?.jobCode || '';
    const key = `${mid}|${job}`;
    if ((treeData || treeErr) && treeFor === key) return;
    treeFor = key;
    try {
      treeData = await DB.companyIndustryTree(mid, job);
      treeErr = (!treeData.order?.length && treeData.reason) ? treeData.reason : null;
    } catch (e) {
      treeErr = e.message;
    }
    if (!selected) paint();
  }

  /* 규모를 고른다. 로드맵 1단계의 값과 이 화면의 칩이 같은 자리에 쓰인다.
     화면에서 고른 값은 로드맵에 되쓰지 않는다 — 1단계에서 정한 목표를 3단계의
     둘러보기가 조용히 바꿔 놓으면, 다음에 1단계로 돌아갔을 때 내가 고른 것이
     아닌 값이 선택돼 있다(17-9 ①과 같은 부류). 여기서는 보는 범위만 바꾼다. */
  function setSize(id) {
    sizeFilter = id || null;
    sizeTouched = true;
    lanePage = 0;                           // 규모 필터가 바뀌면 목록 첫 장부터
    /* 고른 업종에 그 형태의 회사가 한 곳도 없을 수 있다(민간 ↔ 공공을 오갈 때가
       특히 그렇다). 그대로 두면 "업종은 골랐는데 아무것도 없는" 화면이 되므로,
       **남을 수 있는 데까지만** 되돌린다 — 전부 푸는 것보다 덜 잃는다. */
    while (path.length && countAt(nodeAt(path)) === 0) path.pop();
    paint();
  }

  /* ── 이 화면으로 들어올 때 ──────────────────────────────────
     ── 왜 늘 검색 화면부터인가 (사용자 지시) ──
     예전에는 `if (selected) { paint(); return; }` 였다. 한 번 고른 회사를 기억해
     두는 편이 친절하다고 봤는데, **다른 회사로 바꿀 방법이 사실상 없어졌다.**
     CAS 에서 회사찾기를 눌러도 전에 보던 회사 리포트가 그대로 떴고, 사용자에게는
     "한번 회사선택해두면 안 바뀌는 오류" 로 보였다.

     잃는 것은 없다. 방금 보던 회사는 사이드바 '최근 본 회사' 맨 앞에 있어 한 번
     누르면 돌아가고, 로드맵이 쓰는 회사는 Roadmap.setCompany 로 따로 들고 있다.

     넘겨받은 회사(careerly_company_open)는 예외다 — 다른 화면이 "이 회사를 열어라"
     하고 보낸 것이라 그대로 연다. */
  function onEnter() {
    Roadmap.mount('rm-bar-company', 'company');
    /* 1단계에서 고른 기업분류를 받아 온다. 화면에서 직접 바꾼 적이 없을 때만 —
       바꿔 놓고 나갔다 돌아왔는데 원래대로 돌아가 있으면 고장으로 읽힌다. */
    if (!sizeTouched) sizeFilter = Roadmap.corpType();
    loadTree();
    const handoff = localStorage.getItem('careerly_company_open');
    if (handoff) {
      localStorage.removeItem('careerly_company_open');
      select(handoff);
      return;
    }
    back();
  }

  return { onEnter, select, evidenceOf };
})();
