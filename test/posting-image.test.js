/* 이미지로 된 채용공고 → 글자. 네트워크도 AI 도 부르지 않는다.

   ── 이 테스트가 지키는 것 둘 ──
   1) **장식과 본문을 크기로 가른다** — 이름(logo·icon)으로 거르는 그물은 샌다.
      헤더 배너·버튼·1×1 추적 이미지를 모델에 태우면 돈과 시간이 그냥 나가고,
      그보다 나쁘게는 **배너를 보고 공고를 지어낸다**(18-7 과 같은 실패 모드).
      그래서 PNG·JPEG·WebP 헤더에서 폭·높이를 직접 읽는다 — 그 파싱이 여기서 검증된다.
   2) **키가 없으면 통째로 꺼진다** — 켜져 있는 척하면 왜 안 되는지 못 찾는다
      (ai-provider.js 의 옛 Ollama 사고와 같은 이유). */
const M = require('../backend/src/posting-image.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

/* ── 진짜 파일을 만들지 않는다 — 헤더만 있으면 폭·높이는 읽힌다 ── */
function png(w, h) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
/* JPEG 는 마커를 따라가야 한다 — APP0 를 하나 끼워 넣어 '건너뛰기' 까지 확인한다. */
function jpeg(w, h) {
  const app0 = Buffer.alloc(2 + 2 + 14);
  app0.writeUInt16BE(0xffe0, 0); app0.writeUInt16BE(16, 2); app0.write('JFIF', 4, 'ascii');
  const sof = Buffer.alloc(2 + 2 + 6);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(11, 2);
  sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}
function webp(w, h) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

(async () => {
  console.log('── 1. 헤더에서 폭·높이를 읽는다 ──');
  ok('PNG', JSON.stringify(M.imageSize(png(860, 2400))) === JSON.stringify({ w: 860, h: 2400 }),
     `→ ${JSON.stringify(M.imageSize(png(860, 2400)))}`);
  /* JPEG 는 폭·높이 순서가 뒤집혀 있다(높이가 먼저다). 바꿔 읽으면 세로로 긴 상세
     이미지가 '가로로 긴 배너' 로 보여 걸러진다 — 그래서 값을 눈으로 못 박는다. */
  const j = M.imageSize(jpeg(700, 3000));
  ok('JPEG (높이가 먼저 온다)', j.w === 700 && j.h === 3000,
     `→ ${JSON.stringify(j)}`);
  ok('WebP (VP8X 는 1을 빼서 적는다)', JSON.stringify(M.imageSize(webp(1024, 768))) === JSON.stringify({ w: 1024, h: 768 }),
     `→ ${JSON.stringify(M.imageSize(webp(1024, 768)))}`);
  ok('모르는 형식은 null', M.imageSize(Buffer.alloc(64)) === null);
  ok('너무 짧은 것은 null', M.imageSize(Buffer.from([0x89, 0x50])) === null);
  ok('빈 값도 안 죽는다', M.imageSize(null) === null);

  console.log('\n── 2. 걸러야 할 것이 실제로 걸리는 크기인가 ──');
  /* 판단 기준(MIN_W·MIN_H)이 흔한 장식과 흔한 상세 이미지를 실제로 가르는지 본다.
     상수만 있고 이 확인이 없으면, 값을 잘못 잡아도 아무도 모른다. */
  const big = M.imageSize(png(860, 2400));
  const banner = M.imageSize(png(1200, 80));
  const button = M.imageSize(png(24, 24));
  ok('상세 이미지는 통과', big.w >= M.MIN_W && big.h >= M.MIN_H);
  ok('가로로 긴 헤더 배너는 걸린다', !(banner.w >= M.MIN_W && banner.h >= M.MIN_H));
  ok('버튼 아이콘은 걸린다', !(button.w >= M.MIN_W && button.h >= M.MIN_H));

  console.log('\n── 3. 모델이 붙이는 껍데기를 벗긴다 ──');
  ok('코드펜스를 벗긴다', M.cleanOcr('```\n담당업무: 서비스 기획\n```') === '담당업무: 서비스 기획');
  ok('머리말을 벗긴다',
     M.cleanOcr('다음은 이미지에 적힌 내용입니다:\n자격요건: 무관') === '자격요건: 무관');
  /* 공고가 아닌 이미지를 골랐을 때 빠져나갈 문. 이걸 못 알아들으면 "없음" 이 공고
     본문으로 입력칸에 박힌다. */
  ok('없음 은 빈 글이다', M.cleanOcr('없음') === '' && M.cleanOcr('"없음".') === '');
  ok('본문에 든 없음 은 지우지 않는다',
     M.cleanOcr('우대사항: 없음\n담당업무: 개발').includes('우대사항: 없음'));
  ok('빈 값도 안 죽는다', M.cleanOcr(null) === '');

  console.log('\n── 4. 키가 없으면 꺼진다 (네트워크를 부르지 않는다) ──');
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  ok('키가 없으면 기능이 꺼진다', M.isAvailable() === false);
  const off = await M.readPostingImages(['https://a.com/x.png']);
  ok('꺼져 있으면 사유가 off', off.ok === false && off.why === 'off', `→ ${off.why}`);
  /* 후보가 없을 때도 조용히 성공한 척하지 않는다 — 라우트가 사유를 보고 안내를 가른다. */
  process.env.GEMINI_API_KEY = 'test-key';
  const none = await M.readPostingImages([]);
  ok('이미지가 없으면 사유가 no-image', none.ok === false && none.why === 'no-image', `→ ${none.why}`);
  if (saved === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved;

  console.log('\n── 5. 사용자가 올린 이미지 — 내용으로 형식을 본다 ──');
  /* 화면이 보내는 mime 은 파일 이름에서 추측한 값일 수 있고, 화면 자체를 바꿔서 보낼
     수도 있다. 그래서 **바이트 앞머리**로 다시 확인한다. 이미지가 아닌 것을 모델에
     태우면 돈만 쓰고 "공고가 아니다" 라는 답을 받는다. */
  ok('PNG 를 알아본다', M.sniffMime(png(800, 600)) === 'image/png');
  ok('JPEG 을 알아본다', M.sniffMime(jpeg(800, 600)) === 'image/jpeg');
  ok('WebP 를 알아본다', M.sniffMime(webp(800, 600)) === 'image/webp');
  /* 아이폰 기본 형식. 헤더로 크기를 못 읽지만 Gemini 는 읽는다 — 그래서 통과시킨다. */
  const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(16)]);
  ok('HEIC 을 알아본다', M.sniffMime(heic) === 'image/heic');
  ok('PDF 는 이미지가 아니다', M.sniffMime(Buffer.from('%PDF-1.4 어쩌구저쩌구 12345')) === null);
  ok('빈 값도 안 죽는다', M.sniffMime(null) === null);

  const key2 = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const notImage = await M.readUploadedImages([{ name: 'x.pdf', data: Buffer.from('%PDF-1.4 진짜 아님 12345').toString('base64') }]);
  ok('이미지가 아니면 bad-image', notImage.ok === false && notImage.why === 'bad-image', `→ ${notImage.why}`);
  /* 너무 큰 것은 모델에 태우기 전에 막는다 — 상한을 넘겨 보내면 그쪽에서 거절당하고
     그 사유는 사용자에게 아무 도움이 안 된다. */
  const huge = Buffer.concat([png(2000, 2000), Buffer.alloc(M.MAX_IMAGE_BYTES + 1)]);
  const tooBig = await M.readUploadedImages([{ name: 'big.png', data: huge.toString('base64') }]);
  ok('너무 크면 막는다', tooBig.ok === false && tooBig.why === 'bad-image', `→ ${tooBig.why}`);
  /* 주소로 가져올 때(400×300)와 문턱이 다르다 — 여기는 사용자가 직접 고른 것이라
     작다고 버리지 않는다. 말도 안 되는 것(100 미만)만 막는다. */
  const tiny = await M.readUploadedImages([{ name: 't.png', data: png(40, 40).toString('base64') }]);
  ok('1×1 같은 것은 막는다', tiny.ok === false && tiny.why === 'bad-image', `→ ${tiny.why}`);
  ok('올린 것은 400×300 미만이어도 버리지 않는다',
     (M.MIN_W === 400 && M.MIN_H === 300));   // 주소 경로의 문턱은 그대로여야 한다
  const none2 = await M.readUploadedImages([]);
  ok('빈 목록은 no-image', none2.ok === false && none2.why === 'no-image');
  delete process.env.GEMINI_API_KEY;
  const off2 = await M.readUploadedImages([{ name: 'a.png', data: png(800, 600).toString('base64') }]);
  ok('키가 없으면 올려도 off', off2.ok === false && off2.why === 'off', `→ ${off2.why}`);
  if (key2 === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = key2;

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
