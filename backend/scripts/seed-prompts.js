/* AI 프롬프트 공유 게시판에 편집 프롬프트 3편을 넣는다.

     node scripts/seed-prompts.js           # 없는 글만 넣는다 (여러 번 돌려도 안전)
     node scripts/seed-prompts.js --force   # 이미 있는 글의 본문·원문을 덮어쓴다

   ── 왜 스크립트로 넣나 (seed-insights.js 와 같은 이유) ──
   글은 게시판(insight_posts)의 진짜 행이라 작성자가 필요하다(user_id NOT NULL).
   화면에서 손으로 쓰면 문구를 고칠 때마다 다시 써야 하고, 새 DB 를 만들 때마다
   같은 일을 반복한다. 정의는 src/insight-prompt-seed.js 하나에 있다.

   ── 기본 프롬프트는 --force 로 다시 돌려야 한다 ──
   그 글의 원문은 `draft-coach.defaultRules()` 에서 읽어 온다. 엔진의 규칙을 고치면
   **게시판 글은 저절로 안 바뀐다** — 이미 들어간 행이기 때문이다. 규칙을 고쳤으면
   이 스크립트를 `--force` 로 한 번 돌려야 게시판이 따라온다. 안 돌리면 담아 간
   사람이 **옛 규칙으로 초안을 쓰게 되고, 화면 어디에도 그 사실이 안 나온다.**

   ── 글쓴이 계정 ──
   `croad` 를 seed-insights.js 와 **공유한다.** 편집 글이라 사람 이름이 아니라
   서비스 이름으로 나가야 하고, 계정을 둘로 나누면 게시판에 C:road 가 두 명이 된다.
   비밀번호는 없다(password_hash NULL) — 이 계정으로는 로그인할 수 없다. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { nanoid } = require('nanoid');
const { query, queryOne, assertConnection, pool } = require('../src/mysql');
const { PROMPTS, CATEGORY } = require('../src/insight-prompt-seed');
const { normalizePrompt } = require('../src/insight-prompt');

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
  for (const p of PROMPTS) {
    /* 원문은 함수다 — 기본 프롬프트를 엔진에서 읽어 오기 때문이다. */
    const text = typeof p.promptText === 'function' ? p.promptText() : p.promptText;

    /* **올리기 전에 화면과 같은 검사를 통과시킨다.** 여기서 안 걸러진 글은 게시판에
       들어간 뒤 담을 때 잘리거나 거절된다 — 그때는 원인이 안 보인다. */
    const v = normalizePrompt(CATEGORY, text);
    if (!v.ok) {
      console.error(`  거절   — ${p.title}\n           ${v.error}`);
      continue;
    }

    const found = await queryOne('SELECT id FROM insight_posts WHERE title=?', [p.title]);
    if (found && !FORCE) {
      skipped++;
      console.log(`  건너뜀 — ${p.title}`);
      continue;
    }

    if (found) {
      await query('UPDATE insight_posts SET body=?, category=?, prompt_text=? WHERE id=?',
        [p.body, CATEGORY, v.value, found.id]);
      updated++;
      console.log(`  갱신   — ${p.title} (원문 ${v.value.length}자)`);
      continue;
    }

    await query(
      `INSERT INTO insight_posts (id, user_id, category, title, body, prompt_text)
       VALUES (?,?,?,?,?,?)`,
      [nanoid(), userId, CATEGORY, p.title, p.body, v.value]);
    added++;
    console.log(`  추가   — ${p.title} (원문 ${v.value.length}자)`);
  }

  console.log(`\n완료: 추가 ${added} · 갱신 ${updated} · 건너뜀 ${skipped}`);
  if (skipped) console.log('이미 있는 글의 원문까지 다시 넣으려면 --force 를 주세요.');
  /* pool 은 게으른 팩토리다 — 값이 아니라 함수다(src/mysql.js). `pool.end()` 로
     쓰면 글은 다 들어간 뒤 마지막 줄에서 죽어서, 성공했는데 '시드 실패' 가 찍힌다. */
  await pool().end();
})().catch(async e => {
  console.error('시드 실패:', e.message);
  try { await pool().end(); } catch { /* 이미 닫혔으면 그만 */ }
  process.exit(1);
});
