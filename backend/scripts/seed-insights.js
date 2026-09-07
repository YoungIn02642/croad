/* 커리어 인사이트 편집 글 5편을 게시판에 넣는다.

     node scripts/seed-insights.js           # 없는 글만 넣는다 (여러 번 돌려도 안전)
     node scripts/seed-insights.js --force   # 이미 있는 글의 본문·카테고리를 덮어쓴다

   ── 왜 스크립트로 넣나 ──
   글은 게시판(insight_posts)의 진짜 행이라 작성자가 필요하다(user_id NOT NULL).
   화면에서 손으로 다섯 편을 쓰면 문구를 고칠 때마다 다시 써야 하고, 새 DB 를 만들
   때마다 같은 일을 반복한다. 정의는 src/insight-featured.js 하나에 있고 이 스크립트가
   그것을 옮겨 담는다.

   ── 글쓴이 계정 ──
   편집 글이라 사람 이름이 아니라 서비스 이름으로 나가야 한다. `croad` 계정을 만들어
   쓴다. **비밀번호를 넣지 않는다**(password_hash NULL) — 로그인 경로가 비밀번호를
   요구하므로 이 계정으로는 로그인할 수 없고, 글쓴이 이름만 빌려주는 자리다.
   소셜 가입 계정이 이미 password_hash NULL 로 존재하므로 스키마에도 맞는다.

   ── 제목이 키다 ──
   insight_posts 에는 '이 글이 어느 편집 글인가' 를 적을 칸이 없다(스키마를 늘리지
   않았다). 그래서 제목으로 찾는다. 제목을 바꿀 때는 insight-featured.js 의 그 글에
   `prevTitles: ['옛 제목']` 을 남긴다 — 그러면 이 스크립트가 새 글을 하나 더 만드는
   대신 이미 있는 행의 제목만 갈아 끼운다(달린 댓글과 조회수가 그대로 따라온다). */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { nanoid } = require('nanoid');
const { query, queryOne, assertConnection, pool } = require('../src/mysql');
const { ARTICLES, CATEGORY } = require('../src/insight-featured');

const FORCE = process.argv.includes('--force');

const AUTHOR = {
  username: 'croad',
  name: 'C:road',
  nickname: 'C:road',
  email: 'insight@croad.local',
};

async function ensureAuthor() {
  const found = await queryOne('SELECT id FROM users WHERE username=?', [AUTHOR.username]);
  if (found) return found.id;

  const id = nanoid();
  await query(
    `INSERT INTO users (id, username, password_hash, name, email, role, nickname)
     VALUES (?,?,NULL,?,?,NULL,?)`,
    [id, AUTHOR.username, AUTHOR.name, AUTHOR.email, AUTHOR.nickname]);
  console.log(`  글쓴이 계정 생성 — ${AUTHOR.username} (비밀번호 없음: 로그인 불가)`);
  return id;
}

(async () => {
  await assertConnection();
  const userId = await ensureAuthor();

  let added = 0, updated = 0, skipped = 0;
  for (const a of ARTICLES) {
    let found = await queryOne('SELECT id FROM insight_posts WHERE title=?', [a.title]);

    /* 제목이 바뀐 글은 옛 제목으로 한 번 더 찾아 **이름만 갈아 끼운다.** 이게 없으면
       같은 글이 두 편이 되고, 홈 카드는 새 글을 가리키는데 댓글은 옛 글에 남는다. */
    if (!found) {
      for (const prevTitle of a.prevTitles || []) {
        const prev = await queryOne('SELECT id FROM insight_posts WHERE title=?', [prevTitle]);
        if (!prev) continue;
        await query('UPDATE insight_posts SET title=? WHERE id=?', [a.title, prev.id]);
        console.log(`  제목변경 — ${prevTitle} → ${a.title}`);
        found = prev;
        break;
      }
    }

    if (found && !FORCE) { skipped++; console.log(`  건너뜀 — ${a.title}`); continue; }

    if (found) {
      await query('UPDATE insight_posts SET body=?, category=? WHERE id=?',
        [a.body, CATEGORY, found.id]);
      updated++;
      console.log(`  갱신   — ${a.title}`);
      continue;
    }

    await query(
      'INSERT INTO insight_posts (id, user_id, category, title, body) VALUES (?,?,?,?,?)',
      [nanoid(), userId, CATEGORY, a.title, a.body]);
    added++;
    console.log(`  추가   — ${a.title}`);
  }

  console.log(`\n완료: 추가 ${added} · 갱신 ${updated} · 건너뜀 ${skipped}`);
  if (skipped) console.log('이미 있는 글의 본문까지 다시 넣으려면 --force 를 주세요.');
  /* pool 은 게으른 팩토리다 — 값이 아니라 함수다(src/mysql.js). `pool.end()` 로
     쓰면 글은 다 들어간 뒤 마지막 줄에서 죽어서, 성공했는데 '시드 실패' 가 찍힌다. */
  await pool().end();
})().catch(async e => {
  console.error('시드 실패:', e.message);
  try { await pool().end(); } catch { /* 이미 닫혔으면 그만 */ }
  process.exit(1);
});
