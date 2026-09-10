/* ════════════════════════════════════════════════════════════
   하루 1회 갱신 — 채용공고 캐시를 서버가 스스로 다시 받는다

   ── 왜 생겼나 (사용자 지시 2026-09-06) ──────────────────────
   "채용공고 API 승인을 계속 못 받으니 그냥 하루 1회 크롤링해서 업데이트."

   그전까지 갱신 장치는 **배포뿐**이었다. 34-1 에서 루트 `build` 에 잡알리오 수집을
   넣어 "배포 주기가 곧 갱신 주기" 로 만들었는데, 배포가 뜸하면 공고가 그만큼 낡는다.
   **공고는 마감이 생명이라** 그 사이가 그대로 손해다(25-2 에서 크롤링을 접었던
   이유 중 하나가 이 시의성 부담이었다 — 이제 우리가 진다).

   ── 크론이 아니라 서버 안에 둔 이유 ─────────────────────────
   배포 환경(Railway)에 크론이 따로 없고, 있어도 **저장소 하나에 장치가 둘**이 된다.
   서버가 계속 떠 있으므로 여기서 재면 배포 방식이 바뀌어도 같이 산다.
   빌드 단계(`npm run build`)의 수집은 **그대로 둔다** — 새로 뜬 인스턴스가
   첫날부터 자료를 갖고 시작해야 한다. 둘은 겹쳐도 손해가 없다(같은 파일을 덮는다).

   ── 지키는 것 ───────────────────────────────────────────────
   · **부팅을 막지 않는다.** 자식 프로세스로 돌리고 결과를 기다리지 않는다
   · **캐시가 아직 싱싱하면 안 받는다.** 재시작할 때마다 남의 서버를 부르면 안 된다
   · **겹쳐 돌지 않는다.** 앞의 수집이 안 끝났으면 건너뛴다
   · **실패해도 서버를 죽이지 않는다.** 수집기가 --if-possible 로 0 을 내고 끝난다
   · **끌 수 있다.** DAILY_REFRESH=off — 개발 중에 남의 서버를 자꾸 부르지 않게
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const { CACHE_DIR } = require('./cache-dir');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const DATA = CACHE_DIR;

/* 하루 한 번. 캐시가 이보다 젊으면 부팅 때 받지 않는다. */
const PERIOD_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = Number(process.env.DAILY_REFRESH_FRESH_HOURS || 20) * 3600 * 1000;
/* 부팅 직후에 바로 돌리지 않는다 — 뜨는 순간이 가장 바쁘다. */
const BOOT_DELAY_MS = Number(process.env.DAILY_REFRESH_BOOT_DELAY_MS || 30000);

/* 하루 한 번 받는 캐시들. 잡알리오는 18-6 에서 "배포에서는 빌드나 크론에 얹는다"가
   미결로 남아 있던 것이라 여기서 같이 닫는다. */
const JOBS = [
  { id: 'work24', script: 'fetch-work24-jobs.js', cache: 'work24-jobs.json', label: '고용24 채용공고' },
  { id: 'alio', script: 'fetch-alio-jobs.js', cache: 'alio-jobs.json', label: '공공기관 채용공고(잡알리오)' },
  /* 스펙업의 공모전·대외활동. 온통청년(API)은 화면이 그때그때 부르고, 이쪽만
     받아 둔다 — 목록은 매일, 상세는 처음 보는 것만 연다(fetch-wevity.js). */
  { id: 'wevity', script: 'fetch-wevity.js', cache: 'wevity.json', label: '공모전·대외활동(위비티)' },
  /* ── DART 기업 색인 (2026-09-10) ────────────────────────────────────────
     예전에는 빌드(`npm run build`)에서만 받았다. 배포 시간을 줄이려고 빌드에서
     수집을 통째로 뺐으므로(볼륨 도입), **여기가 유일한 공급 경로다** — 빠지면
     기업분석의 개요·재무·경쟁사 칸이 영영 빈다.
     다른 셋과 성격이 조금 다르다: 공시대상 전체 11만여 건이라 6MB 이고, 매일
     바뀌는 자료가 아니다. 그래도 같은 자리에 두는 편이 낫다 — 장치가 하나면
     "언제 갱신되나" 를 한 곳만 보면 된다(캐시가 싱싱하면 어차피 안 받는다). */
  { id: 'dart', script: 'fetch-dart-corps.js', cache: 'dart-corps.json', label: 'DART 기업 색인' },
];

const running = new Set();

/* 캐시가 얼마나 됐나. 파일이 없으면 null — '오래됐다'와 '없다'는 다르다. */
function ageMs(cache) {
  try { return Date.now() - fs.statSync(path.join(DATA, cache)).mtimeMs; }
  catch { return null; }
}

function run(job, why) {
  if (running.has(job.id)) {
    console.log(`[갱신] ${job.label} — 앞의 수집이 아직 돌고 있어 건너뜁니다.`);
    return;
  }
  running.add(job.id);
  console.log(`[갱신] ${job.label} 수집을 시작합니다 (${why}).`);

  /* --if-possible: 소스가 죽어 있어도 0 으로 끝난다. 서버는 그대로 산다. */
  const child = spawn(process.execPath, [path.join(SCRIPTS, job.script), '--if-possible'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /* 자식의 출력을 삼키지 않는다. 갱신이 조용히 실패하면 며칠 뒤 학생 화면에서야
     발견된다 — 마지막 줄만이라도 서버 로그에 남긴다. */
  let last = '';
  const keep = buf => { const s = String(buf).trim(); if (s) last = s.split('\n').pop(); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  child.on('error', e => {
    running.delete(job.id);
    console.warn(`[갱신] ${job.label} 을 실행하지 못했습니다: ${e.message}`);
  });
  child.on('close', code => {
    running.delete(job.id);
    if (code === 0) console.log(`[갱신] ${job.label} 완료 — ${last || '(출력 없음)'}`);
    else console.warn(`[갱신] ${job.label} 실패 (종료코드 ${code}) — ${last || '(출력 없음)'}`);
  });
}

function tick(job, boot) {
  const age = ageMs(job.cache);
  /* 부팅 때만 '아직 싱싱하면 건너뛴다'를 본다. 재시작이 잦아도 남의 서버를
     그때마다 부르지 않기 위해서다. 주기 타이머는 하루가 지난 것이 확실하다. */
  if (boot && age != null && age < FRESH_MS) {
    console.log(`[갱신] ${job.label} — ${(age / 3600000).toFixed(1)}시간 전 자료라 그대로 씁니다.`);
    return;
  }
  run(job, boot ? (age == null ? '캐시 없음' : `${(age / 3600000).toFixed(0)}시간 지남`) : '하루 주기');
}

function start() {
  if (String(process.env.DAILY_REFRESH || '').toLowerCase() === 'off') {
    console.log('[갱신] DAILY_REFRESH=off — 채용공고 자동 갱신을 켜지 않습니다.');
    return null;
  }

  const timers = [];
  const boot = setTimeout(() => JOBS.forEach(j => tick(j, true)), BOOT_DELAY_MS);
  timers.push(boot);
  const daily = setInterval(() => JOBS.forEach(j => tick(j, false)), PERIOD_MS);
  timers.push(daily);

  /* 타이머가 프로세스를 붙잡지 않게 한다 — 테스트나 스크립트가 이 모듈을 불러도
     끝나지 않는 프로세스가 되면 안 된다. */
  timers.forEach(t => t.unref?.());
  return () => timers.forEach(t => (clearTimeout(t), clearInterval(t)));
}

module.exports = { start, JOBS, ageMs, PERIOD_MS, FRESH_MS };
