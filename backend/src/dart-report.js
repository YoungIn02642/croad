/* ══════════════════════════════════════════════════════════════
   사업보고서 원문에서 '무엇을 하는 회사인가' 를 줄글로 가져온다

   ── 왜 정형 API 로 안 되나 ──
   DART 오픈API 가 주는 것은 **숫자와 표**다(재무·직원수·출자현황). "이 회사가
   무슨 일을 해서 돈을 버는가" 는 어느 엔드포인트에도 없다. 그 문장은 사업보고서
   본문 「II. 사업의 내용」 에만 글로 적혀 있고, 그 본문을 주는 창구는
   document.xml 하나뿐이다.

   그래서 화면이 오래 **키워드만** 보여 줬다 — '도료 212명 · 50%' 같은 칩. 학생이
   알고 싶은 것은 배치 인원이 아니라 "무엇을 만들어 누구에게 파는 회사인가" 다.

   ── 왜 요약하지 않고 원문 문장을 그대로 쓰나 ──
   이 저장소의 규칙이다(작업정리 6장·9장): AI 는 분류·추출에만 쓴다. 사업 내용을
   모델에게 다시 쓰게 하면 **회사가 한 말이 아니라 우리가 지어낸 말**이 되는데,
   화면에는 '사업보고서에서' 라고 적혀 있다. 그건 출처를 빌려 쓴 창작이다.
   원문 문단을 자르지 않고 그대로 옮기고, 어느 보고서 어느 절인지 함께 적는다.

   ── 표는 버린다 ──
   본문에는 표가 섞여 있는데, HTML 로 옮기면 카드 밖으로 넘치고(실측: 재무 표에서
   같은 일이 있었다) 모바일에서는 읽을 수 없다. 표가 있던 절에는 "표는 원문에서"
   링크를 붙여 DART 뷰어로 보낸다 — 우리가 못 담는 것을 없는 것처럼 두지 않는다.

   ── 왜 따로 부르나 (라우트가 /analysis 와 별개다) ──
   보고서 원문 ZIP 이 5~14MB 다(실측: 강남제비스코 5.5M · 카카오 13.7M). 기업분석
   한 방에 얹으면 리포트 전체가 그만큼 늦어진다. 화면은 먼저 그리고 이 칸만
   나중에 채운다.
   ══════════════════════════════════════════════════════════════ */
const fs = require('fs');
/* 이 파일에는 이미 cachePath(접수번호) 가 있다 — 이름이 겹치므로 별칭으로 받는다. */
const { cachePath: volumePath } = require('./cache-dir');
const path = require('path');
const zlib = require('zlib');
const dart = require('./dart');

const BASE = 'https://opendart.fss.or.kr/api';
const TIMEOUT_MS = 30000;                 // 십수 MB 를 받는다 — 다른 호출보다 길게 잡는다
const CACHE_DIR = volumePath('dart-report');

/* 한 절에서 화면에 올릴 최대 분량. 넘치면 뒤는 원문 링크로 보낸다.
   사업보고서는 한 절이 수천 자인 회사가 있는데(삼성전자 사업의 개요 6문단),
   카드 하나에 논문을 붙여 두면 아무도 읽지 않는다. */
const MAX_CHARS = 1100;
const MAX_PARAS = 4;

/* 문단으로 칠 최소 길이. 이보다 짧은 줄은 표 머리글·각주·'(단위: 백만원)' 같은
   부스러기라 줄글에 섞이면 문장이 끊긴 것처럼 보인다. */
const MIN_PARA = 40;

/* ── 표 각주는 버린다 ────────────────────────────────────────
   표를 들어내면 그 표에 달려 있던 주석만 남는다. 길이는 40자를 넘어서 문단으로
   걸리는데, 정작 앞의 표가 없으니 무슨 말인지 알 수 없다. 실측:
     현대자동차 → "※ 차량부문은 내부거래조정과 관련된 영업이익을 포함하고 있음."
     카카오     → "참고 1: 당기중 ㈜카카오헬스케어와 그 종속기업으로 구성된…"
     CJ제일제당 → "(*1) 부문간 내부매출액 제외기준입니다. (연결 기준)"
   셋 다 그 절의 **첫 문단**으로 올라와서, 회사 소개가 각주로 시작했다.
   각주만 남는 절은 문단이 0개가 되어 통째로 빠진다 — 부스러기를 보여 주느니
   그 칸이 없는 편이 낫다. */
const FOOTNOTE = /^\s*(※|주\s*\d*\s*[).:]|참고\s*\d*\s*[.:]|\(\s*[*주]\s*\d*\s*\)|\(\s*\*|\*+\s*\d*\s*[).]|\*+\s|출처\s*[:：]|\(?단위\s*[:：])/;

/* ── ZIP ─────────────────────────────────────────────────────
   DART 는 **스트리밍 ZIP** 으로 준다 — 로컬 헤더의 압축 크기가 0 이고 실제 크기는
   데이터 뒤 descriptor 에 있다(실측). 그래서 로컬 헤더만 훑으면 첫 파일에서
   길이 0 을 읽고 멈춘다. 끝의 중앙 디렉터리에서 크기를 읽어야 한다.
   외부 패키지를 넣지 않은 이유: 우리가 여는 ZIP 은 DART 가 만든 이 한 종류뿐이고,
   deflate 는 zlib 에 이미 있다. */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 형식이 아닙니다');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize  = buf.readUInt32LE(p + 20);
    const nlen   = buf.readUInt16LE(p + 28);
    const elen   = buf.readUInt16LE(p + 30);
    const clen   = buf.readUInt16LE(p + 32);
    const lho    = buf.readUInt32LE(p + 42);
    const name   = buf.slice(p + 46, p + 46 + nlen).toString('latin1');
    const start  = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    files.push({ name, method, data: buf.slice(start, start + csize) });
    p += 46 + nlen + elen + clen;
  }
  return files;
}

/* ── 어느 문서를 읽을 것인가 ─────────────────────────────────
   제출 하나에 문서가 여러 개 들어 있다. `{접수번호}.xml` 이 본문이고, `_00760`
   처럼 꼬리가 붙은 것은 첨부(감사보고서 등)다.
   ── 여기서 한 번 틀렸다 ──
   첫 엔트리를 본문으로 알고 읽었더니 감사보고서가 나왔고, 「사업의 내용」 을
   못 찾아 "본문이 없다" 고 판단할 뻔했다. 이름으로 고른다. */
function mainDocument(files, rceptNo) {
  const exact = files.find(f => f.name === `${rceptNo}.xml`);
  const pick = exact || files.slice().sort((a, b) => b.data.length - a.data.length)[0];
  if (!pick) return null;
  const raw = pick.method === 8 ? zlib.inflateRawSync(pick.data) : pick.data;
  return raw.toString('utf8');
}

/* ── 절 목차 ─────────────────────────────────────────────────
   <TITLE> 이 절의 경계다. 제목의 끝 ~ 다음 제목의 시작이 그 절의 본문이다. */
function titlesOf(xml) {
  const out = [];
  const re = /<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/g;
  let m;
  while ((m = re.exec(xml))) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, at: m.index, end: re.lastIndex });
  }
  return out;
}

/* ── 태그를 벗겨 문단으로 ──────────────────────────────────── */
const ENTITIES = { '&cr;': ' ', '&nbsp;': ' ', '&apos;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };

/* 같은 말을 두 번 싣지 않기 위한 지문. 회사가 절마다 회사 소개 문장을 되풀이해
   적는 일이 흔하다 — 강남제비스코는 '사업의 개요' 와 '주요 제품' 의 첫 문장이
   거의 같다. 공백·문장부호를 털고 앞머리만 본다(뒤에 몇 글자 덧붙은 것도 같은
   문장으로 친다). */
const fingerprint = s => s.replace(/[\s.,ㆍ·()[\]'"]/g, '').slice(0, 40);

function paragraphsOf(chunk, seen = new Set()) {
  const hadTable = /<TABLE\b/i.test(chunk);
  const lines = chunk
    .replace(/<TABLE[\s\S]*?<\/TABLE>/gi, '\n')
    .replace(/<BR\s*\/?>/gi, '\n')
    .replace(/<\/(P|TU|TITLE|SPAN|LIBRARY)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&cr;|&nbsp;|&apos;|&quot;|&amp;|&lt;|&gt;/g, e => ENTITIES[e])
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length >= MIN_PARA && !FOOTNOTE.test(s));

  const paragraphs = [];
  let chars = 0;
  let dropped = false;
  for (const line of lines) {
    if (paragraphs.length >= MAX_PARAS || chars >= MAX_CHARS) { dropped = true; break; }
    const fp = fingerprint(line);
    if (seen.has(fp)) { dropped = true; continue; }   // 앞 절에서 이미 보여 준 문장
    seen.add(fp);
    paragraphs.push(line);
    chars += line.length;
  }
  return { paragraphs, hadTable, truncated: dropped };
}

/* ── 「II. 사업의 내용」 안에서 필요한 절만 ────────────────────
   제목이 회사마다 다르다(실측):
     강남제비스코·삼성전자 → '1. 사업의 개요'
     카카오·현대자동차     → '1. (제조서비스업)사업의 개요'
   금융 겸업사는 '(금융업)사업의 개요' 가 뒤에 또 나온다. 그래서 **번호와 말머리로
   맞추지 않고**, 「사업의 내용」 과 그다음 대제목(III.) 사이에서 처음 걸리는 것을
   쓴다 — 겸업사에서도 본업 쪽이 앞에 온다. */
const WANTED = [
  { key: 'overview', match: /사업의\s*개요/,             title: '무엇을 하는 회사인가',   note: '사업보고서 「사업의 개요」' },
  { key: 'products', match: /주요\s*제품\s*(및|ㆍ)?\s*서비스/, title: '무엇을 팔아 버는가', note: '사업보고서 「주요 제품 및 서비스」' },
];

function blocksOf(xml) {
  const titles = titlesOf(xml);
  const start = titles.findIndex(t => /^\s*(II|Ⅱ|2)\s*[.．]\s*사업의\s*내용/.test(t.text));
  if (start < 0) return [];

  /* 다음 대제목(III. 재무에 관한 사항)까지가 「사업의 내용」 이다. */
  let stop = titles.findIndex((t, i) => i > start && /^\s*(III|Ⅲ|3)\s*[.．]/.test(t.text));
  if (stop < 0) stop = titles.length;

  const blocks = [];
  /* 절을 가로질러 공유한다 — 두 절이 같은 문장으로 시작하면 뒤엣것만 빠진다. */
  const seen = new Set();
  for (const want of WANTED) {
    const i = titles.findIndex((t, k) => k > start && k < stop && want.match.test(t.text));
    if (i < 0) continue;
    const chunk = xml.slice(titles[i].end, titles[i + 1]?.at ?? xml.length);
    const { paragraphs, hadTable, truncated } = paragraphsOf(chunk, seen);
    if (!paragraphs.length) continue;
    blocks.push({
      key: want.key,
      title: want.title,
      /* 원문의 절 이름도 같이 준다. 우리가 붙인 제목은 읽기 쉬우라고 바꾼 말이고,
         보고서에서 어디를 편 것인지는 학생이 확인할 수 있어야 한다. */
      section: titles[i].text,
      source: want.note,
      paragraphs,
      /* 표를 버렸거나 뒤를 잘랐으면 화면이 '원문에서 더 보기' 를 띄운다. */
      more: hadTable || truncated,
    });
  }
  return blocks;
}

/* ── 최근 사업보고서 ─────────────────────────────────────────
   분기·반기보고서에도 「사업의 내용」 이 있지만 사업보고서가 가장 두껍고 한 해를
   통으로 말한다. 사업보고서가 없으면(비상장·신규 상장) 반기·분기라도 쓴다 —
   비어 있는 것보다 낫고, 화면에 어느 보고서인지 적으니 오해도 없다. */
const REPORT_RANK = [/^\[?기재정정\]?\s*사업보고서|^사업보고서/, /반기보고서/, /분기보고서/];

async function latestReport(corpCode) {
  const today = new Date();
  const bgn = `${today.getFullYear() - 2}0101`;
  const end = `${today.getFullYear()}1231`;
  const d = await dart.callDart('list.json', {
    corp_code: corpCode, bgn_de: bgn, end_de: end, pblntf_ty: 'A', page_count: '50',
  });
  const list = (d?.list || []).filter(x => x.rcept_no && x.report_nm);
  for (const rank of REPORT_RANK) {
    /* 목록은 최신순이라 처음 걸리는 것이 가장 최근이다. */
    const hit = list.find(x => rank.test(x.report_nm.trim()));
    if (hit) return { rceptNo: hit.rcept_no, name: hit.report_nm.replace(/\s+/g, ' ').trim(), date: hit.rcept_dt };
  }
  return null;
}

async function documentXml(rceptNo) {
  /* 원문만 JSON 이 아니라 ZIP 이라 dart.callDart() 를 못 쓴다(그 함수는 본문을
     JSON 으로 판다). 키를 읽는 방법은 dart.js 와 같은 자리에서 같게 둔다. */
  const key = (process.env.DART_API_KEY || '').trim();
  const res = await fetch(`${BASE}/document.xml?crtfc_key=${key}&rcept_no=${rceptNo}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`DART 원문 오류 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  /* 실패하면 ZIP 대신 JSON 을 준다(키 오류 등). 앞 4바이트로 가른다 — 이 구분이
     없으면 "ZIP 형식이 아닙니다" 라는 엉뚱한 말이 사용자에게 간다. */
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    let msg = '원문을 받지 못했습니다';
    try { msg = JSON.parse(buf.toString('utf8')).message || msg; } catch { /* 본문이 JSON 도 아니면 기본 문구 */ }
    throw new Error(`DART 원문: ${msg}`);
  }
  return mainDocument(unzip(buf), rceptNo);
}

/* ── 캐시 ────────────────────────────────────────────────────
   푼 결과(수 KB)만 남긴다. 원문 XML(5~14MB)은 버린다 — 다시 필요하면 받으면
   되고, 회사마다 쌓으면 금세 기가바이트가 된다.
   접수번호를 파일명에 넣으므로 새 보고서가 나오면 저절로 새 파일이 된다. */
function cachePath(rceptNo) { return path.join(CACHE_DIR, `${rceptNo}.json`); }

function readCache(rceptNo) {
  try { return JSON.parse(fs.readFileSync(cachePath(rceptNo), 'utf8')); } catch { return null; }
}
function writeCache(rceptNo, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(rceptNo), JSON.stringify(data), 'utf8');
  } catch { /* 캐시는 있으면 좋은 것일 뿐 — 못 써도 조회는 된다 */ }
}

/* DART 뷰어 주소. 우리가 담지 못한 표·나머지 문단을 학생이 직접 볼 자리다. */
const viewerUrl = rceptNo => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`;

/* ── 화면이 부르는 함수 ──────────────────────────────────────
   찾지 못한 이유를 함께 돌려준다. '없음' 과 '못 가져옴' 은 학생이 할 일이 다르다 —
   전자는 원래 없는 것(비상장사는 사업보고서를 내지 않는다), 후자는 다시 눌러 볼 일. */
async function business(name) {
  if (!dart.isConfigured()) {
    return { ok: false, reason: 'no-key', message: 'DART 키가 없어 사업 내용을 가져오지 못했습니다.' };
  }
  const corp = dart.findCorp(name);
  if (!corp) {
    return { ok: false, reason: 'no-corp', message: '공시 대상 기업 목록에서 찾지 못했습니다.' };
  }

  const report = await latestReport(corp.code);
  if (!report) {
    return {
      ok: false, reason: 'no-report',
      message: '정기보고서가 없어요 — 사업보고서를 내지 않는 회사입니다.',
      help: '비상장사는 사업보고서 제출 의무가 없어요. 회사 홈페이지의 사업 소개를 보세요.',
    };
  }

  const cached = readCache(report.rceptNo);
  if (cached) return cached;

  const xml = await documentXml(report.rceptNo);
  const blocks = xml ? blocksOf(xml) : [];
  const result = blocks.length
    ? { ok: true, report, viewer: viewerUrl(report.rceptNo), blocks }
    : {
        ok: false, reason: 'no-section', report, viewer: viewerUrl(report.rceptNo),
        message: '이 보고서에서 「사업의 내용」을 찾지 못했습니다.',
        help: '원문에서 직접 볼 수 있어요.',
      };
  writeCache(report.rceptNo, result);
  return result;
}

module.exports = {
  business, latestReport, documentXml,
  unzip, mainDocument, titlesOf, paragraphsOf, blocksOf, viewerUrl,
  MAX_CHARS, MAX_PARAS, MIN_PARA,
};
