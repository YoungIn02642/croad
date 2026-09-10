/* DART 공시대상 기업 고유번호 수집 → data/dart-corps.json
   기업분석의 '재무 · 경쟁사' 칸(src/dart.js)이 회사명을 고유번호로 바꿀 때 쓰는 색인.

   ── 왜 이 단계가 따로 필요한가 ──
   DART 의 모든 조회 API 는 회사명이 아니라 **고유번호(corp_code, 8자리)** 를 받는다.
   그 번호표를 주는 API 가 corpCode.xml 하나뿐이고, 전체 목록을 한 번에 내려준다.
   회사마다 검색을 부르는 API 는 없다 — 그래서 통째로 받아 캐시한다.

   ── 응답이 XML 이 아니라 ZIP 이다 (함정) ──
   이름은 corpCode.xml 인데 실제로는 **ZIP 바이너리**가 온다. 그대로 파싱하면
   깨진 글자만 나온다. 압축 해제 라이브러리를 새로 붙이지 않으려고 ZIP 중앙 디렉터리를
   직접 읽고 zlib 로 푼다(항목 1개짜리 단순 ZIP 이라 40줄이면 된다).
   → 의존성을 늘리지 않는 편이 낫다는 판단. 형식이 바뀌면 여기만 고치면 된다.

   ── 기본은 공시대상 전체다 (예전에는 상장사만이었다) ──
   처음에는 "대부분 자소서와 무관한 법인(펀드·SPC)이니 상장사 3,981건만" 이었다.
   그런데 학생이 실제로 지원하는 회사 중 **비상장 대기업 자회사**가 통째로 빠졌다.
   실측: 캐논코리아(00120580)는 DART 에 등록돼 있는데도 캐시에 없어서 화면이
   "공시 자료 없음" 이었다. 개황(업종·설립연도·대표·본사·홈페이지)은 비상장사도
   전부 열려 있다 — 없는 것은 재무(사업보고서)뿐이다. 그 하나 때문에 나머지를
   통째로 버리고 있었다.

   전체 118,000여 건 = 약 6MB. 자주 바뀌는 파일이 아니라 캐시로 들고 있어도 된다.
   상장사만 받고 싶으면 --listed-only.

   ── 업종코드는 여기 없다 ──
   업종코드는 `data/dart-industry.json` 에 따로 있다(build-dart-industry.js).
   회사마다 API 를 한 번씩 불러 만든 값이라 다시 만드는 비용이 크고, 그래서
   **깃에 넣는다.** 이 파일이 몇 번 다시 받히든 그쪽은 건드리지 않는다 —
   예전에 한 파일에 같이 뒀다가 이 파일을 깃에서 빼면서 업종코드가 같이 사라졌다.

   ── 결과 파일은 깃에 없다 ──
   `backend/data/dart-corps.json` 은 .gitignore 에 있다. 6MB 짜리가 받을 때마다
   히스토리에 쌓이는데, 우리가 만든 자료가 아니라 DART 가 매일 주는 원본이다.
   그래서 **빌드 단계에서 받는다**(루트 package.json 의 build → `npm run build`).

   빌드에서 부를 때는 --if-possible 을 붙인다. 키가 없거나 DART 가 잠깐 죽어도
   배포는 되어야 한다 — 캐시가 없으면 기업분석 칸만 "기업 캐시가 없습니다"로 비고
   나머지 기능은 멀쩡하다(dart.js 의 키 없음 정책과 같다).

   사용:
     node scripts/fetch-dart-corps.js               # 공시대상 전체
     node scripts/fetch-dart-corps.js --listed-only # 상장사만
     node scripts/fetch-dart-corps.js --if-possible # 실패해도 0 으로 끝난다(빌드용)
   env: DART_API_KEY (https://opendart.fss.or.kr 에서 무료 발급) */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { cachePath } = require('../src/cache-dir');
const path = require('path');
const zlib = require('zlib');

const API_KEY = (process.env.DART_API_KEY || '').trim();
const OUT_PATH = cachePath('dart-corps.json');
const ALL = !process.argv.includes('--listed-only');
const SOFT = process.argv.includes('--if-possible');

/* ── ZIP 풀기 ────────────────────────────────────────────────
   중앙 디렉터리(EOCD)부터 읽는다. 로컬 헤더의 크기 필드는 스트리밍으로 만든 ZIP 에서
   0 으로 비어 있을 수 있어(데이터 디스크립터 사용) 믿을 수 없다. */
function unzipFirstFile(buf) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('ZIP 형식이 아닙니다 (EOCD 를 찾지 못했습니다).');

  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리가 손상됐습니다.');

  const method    = buf.readUInt16LE(cdOffset + 10);
  const compSize  = buf.readUInt32LE(cdOffset + 20);
  const fnLen     = buf.readUInt16LE(cdOffset + 28);
  const extraLen  = buf.readUInt16LE(cdOffset + 30);
  const cmtLen    = buf.readUInt16LE(cdOffset + 32);
  const localOff  = buf.readUInt32LE(cdOffset + 42);
  const fileName  = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + fnLen);
  void extraLen; void cmtLen;

  if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('ZIP 로컬 헤더가 손상됐습니다.');
  const lFnLen    = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + lFnLen + lExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);

  console.log(`  ZIP 안의 파일: ${fileName} (${method === 8 ? 'deflate' : 'stored'}, ${compSize.toLocaleString()} bytes)`);
  return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
}

/* ── XML 파싱 ────────────────────────────────────────────────
   <list> 반복 구조가 단순해서 정규식으로 충분하다(XML 파서를 붙일 이유가 없다).
   회사명에 &amp; 같은 실체참조가 들어오므로 푼다 — 안 풀면 'AT&amp;S' 가 그대로 남아
   회사명 매칭에서 영원히 빗나간다(news.js 에서 &#x27; 로 같은 문제를 겪었다). */
const unescapeXml = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&')
  .trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? unescapeXml(m[1]) : '';
};

function parseCorps(xml) {
  const out = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const b = m[1];
    const code = pick(b, 'corp_code');
    const name = pick(b, 'corp_name');
    if (!code || !name) continue;
    /* 빈 값은 키 자체를 넣지 않는다. 11만 건 × `"stock":null,"industry":null` 이
       그대로 3MB 다. 읽는 쪽은 undefined 와 null 을 똑같이 취급한다. */
    const stock = pick(b, 'stock_code');
    const corp = { code, name };
    if (stock) corp.stock = stock;
    out.push(corp);
  }
  return out;
}

async function main() {
  if (!API_KEY) {
    /* 빌드에서는 키가 없는 것이 배포를 막을 이유가 아니다 — 기업분석 칸만 빈다. */
    if (SOFT) {
      console.warn('DART_API_KEY 가 없어 기업 색인을 건너뜁니다. 기업분석의 개요·재무·경쟁사 칸이 빕니다.');
      console.warn('  키는 https://opendart.fss.or.kr 에서 무료로 즉시 발급됩니다.');
      return;
    }
    console.error('DART_API_KEY 가 없습니다. https://opendart.fss.or.kr 에서 발급받아 backend/.env 에 넣어 주세요.');
    process.exit(1);
  }

  /* ── 한 번 실패했다고 포기하지 않는다 (실측 2026-08-21) ──
     배포 빌드가 `The operation was aborted due to timeout` 으로 60초에 끊겨 색인 없이
     배포됐다. 같은 날 로컬에서 받으면 2.6~4.3초다 — 느린 것은 이 요청이 아니라 그때의
     경로다. 한 번 더 물어보면 될 일로 배포 한 판을 날린 셈이라 재시도를 넣는다.
     시간·횟수는 env 로 뺀다 — 빌더가 느린 날 코드를 고쳐 배포할 수는 없다. */
  const TIMEOUT_MS = Number(process.env.DART_FETCH_TIMEOUT_MS || 120000);
  const ATTEMPTS = Math.max(1, Number(process.env.DART_FETCH_ATTEMPTS || 3));
  const URL = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(API_KEY)}`;

  let buf = null, lastErr = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      console.log(`DART 고유번호 목록을 받는 중… (${i}/${ATTEMPTS}, 제한 ${TIMEOUT_MS / 1000}초)`);
      const res = await fetch(URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`요청 실패 ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      /* 여기서 걸리는 것은 네트워크·시간 초과라 다시 물어볼 값이 있다. 키가 틀린
         경우는 200 에 XML 본문이 와서 아래 PK 검사가 잡는다 — 그건 재시도해도 같다. */
      lastErr = e;
      console.warn(`  실패(${i}/${ATTEMPTS}): ${e.message}`);
      if (i < ATTEMPTS) await new Promise(r => setTimeout(r, i * 5000));
    }
  }
  if (!buf) throw lastErr;
  /* 키가 틀리면 ZIP 이 아니라 XML 에러 본문이 온다 — 그때는 사유를 그대로 보여준다. */
  if (buf.subarray(0, 2).toString() !== 'PK') {
    const text = buf.toString('utf8').slice(0, 300);
    throw new Error(`ZIP 이 아닙니다. 응답: ${text.replace(/\s+/g, ' ')}`);
  }
  console.log(`  받음: ${buf.length.toLocaleString()} bytes`);

  const all = parseCorps(unzipFirstFile(buf).toString('utf8'));
  const corps = ALL ? all : all.filter(c => c.stock);

  /* 상장사를 앞에 둔다. 이름이 겹치는 회사가 7,957쌍이나 되는데(비상장 동명이인),
     이름 색인은 먼저 나온 것을 쓴다 — 순서를 안 정하면 '신한'·'하나은행' 같은 이름이
     이름만 같은 소규모 법인으로 잡힌다. dart.js 도 색인을 만들 때 한 번 더 거른다. */
  corps.sort((a, b) => (b.stock ? 1 : 0) - (a.stock ? 1 : 0));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  /* 전체(6MB)를 들여쓰기까지 하면 10MB 다. 사람이 읽는 파일이 아니라 색인이다. */
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scope: ALL ? 'all' : 'listed',
    total: corps.length,
    listed: corps.filter(c => c.stock).length,
    corps,
  }, null, ALL ? 0 : 2));

  console.log(`\n공시대상 전체 ${all.length.toLocaleString()}건 중 ${ALL ? '전부' : '상장사'} ${corps.length.toLocaleString()}건 저장`);
  console.log(`→ ${OUT_PATH}`);

  /* 업종코드는 별도 파일이고 깃에 들어 있다. 이미 있으면 아무것도 더 할 게 없다 —
     예전 안내("다음: build-dart-industry.js")를 그대로 두면 매번 8분짜리 작업을
     다시 돌리게 된다. */
  const industryPath = path.join(__dirname, '..', 'data', 'dart-industry.json');
  if (fs.existsSync(industryPath)) {
    const n = (JSON.parse(fs.readFileSync(industryPath, 'utf8')) || {}).total || 0;
    console.log(`업종코드 ${n.toLocaleString()}건은 dart-industry.json 에 이미 있습니다(깃에 포함).`);
  } else {
    console.log('\n업종코드가 없습니다 — node scripts/build-dart-industry.js 를 실행하세요.');
    console.log('  (없으면 경쟁사 목록과 계열별 둘러보기가 빕니다)');
  }
}

main().catch(e => {
  /* 빌드 중이면 DART 가 잠깐 죽었다고 배포까지 막지 않는다. 사유는 로그에 남긴다. */
  if (SOFT) {
    console.warn(`기업 색인을 받지 못했습니다(${e.message}). 기업분석 칸만 비고 배포는 계속합니다.`);
    return;
  }
  console.error('실패:', e.message);
  process.exit(1);
});
