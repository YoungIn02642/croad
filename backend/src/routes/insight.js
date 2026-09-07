/* 커리어 인사이트 — 정보를 주고받는 커뮤니티 게시판.
   글쓴이는 로그인한 회원 누구나(멘토·멘티 구분 없음). 읽기는 비로그인도 된다 —
   가격표(mentoring.js FORMATS)처럼 카테고리도 여기가 단일 출처다. 프론트는
   같은 목록을 보여주기 위한 사본을 갖지만, 저장을 막는 건 여기 검사뿐이다. */
const express = require('express');
const { nanoid } = require('nanoid');
const { query, queryOne } = require('../mysql');
const FEATURED = require('../insight-featured');
const PROMPT = require('../insight-prompt');

const router = express.Router();

const CATEGORIES = [
  { id: 'free',    label: '자유' },
  { id: 'jobinfo', label: '취업정보' },
  { id: 'review',  label: '후기' },
  { id: 'qna',     label: '질문' },
  /* AI 프롬프트 공유 (사용자 지시 2026-09-05). 다른 카테고리와 달리 글이
     **프롬프트 원문**을 같이 싣고, 읽는 사람은 그것을 자소서 코치의
     '내 AI 프롬프트'로 바로 담아 간다 — insight-prompt.js 머리주석. */
  { id: PROMPT.PROMPT_CATEGORY, label: 'AI 프롬프트' },
];
const categoryIds = new Set(CATEGORIES.map(c => c.id));

/* ── 평점을 언제 보여줄 것인가 ─────────────────────────────
   **평가가 3명 미만이면 평균을 내지 않는다.** 1명이 별 5개를 준 글에 '5.0' 을
   달면 실제보다 훨씬 단단한 숫자로 읽힌다. 이 저장소는 같은 이유로 CAS 백분위를
   표본 5명 미만에서 접고(17장), 직무 트렌드도 30건 미만이면 배지를 안 붙인다.
   대신 '평가 N명' 은 그대로 보여준다 — 아직 아무도 안 써 봤다는 것도 정보다. */
const RATING_MIN_VOTES = 3;

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

/* express 4 는 async 핸들러의 예외를 자동으로 못 잡는다(server.js ah() 주석과
   같은 이유) — 여기서도 같은 문제가 생기지 않도록 똑같이 감싼다. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const displayName = r => r.author_nickname || r.author_name || '탈퇴한 회원';

function toPostSummary(r) {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    preview: (r.body || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    authorId: r.user_id,
    authorName: displayName(r),
    viewCount: r.view_count,
    commentCount: Number(r.comment_count || 0),
    isNotice: Boolean(r.is_notice),
    /* 목록에서는 원문을 안 보낸다 — 8,000자짜리 규칙이 스무 줄이면 목록 응답이
       그것만으로 수십만 자가 된다. '프롬프트 글인가'와 '몇 사람이 담아 갔나'만
       실어서 줄에 배지를 붙인다. */
    hasPrompt: Boolean(r.prompt_text),
    copyCount: Number(r.copy_count || 0),
    ...promptStats(r),
    createdAt: r.created_at,
  };
}

/* 담기·북마크·평점을 한 곳에서 만든다. 목록과 상세가 같은 모양이어야 화면이
   두 벌의 코드를 갖지 않는다. */
function promptStats(r) {
  const votes = Number(r.rating_count || 0);
  return {
    bookmarkCount: Number(r.bookmark_count || 0),
    ratingCount: votes,
    /* 표본이 모자라면 **평균을 아예 안 내려보낸다.** null 을 주면 화면이 별점을
       안 그리고 '평가 N명' 으로 물러난다 — 화면이 0.0 을 그리게 두면 안 된다. */
    ratingAvg: votes >= RATING_MIN_VOTES ? Math.round(Number(r.rating_avg) * 10) / 10 : null,
    ratingMinVotes: RATING_MIN_VOTES,
    /* 로그인한 사람이 이미 담았는지·북마크했는지·몇 점을 줬는지. 비로그인이면
       전부 없는 값이다(로그인 유도는 화면이 한다). */
    taken: r.taken != null ? Boolean(Number(r.taken)) : undefined,
    bookmarked: r.bookmarked != null ? Boolean(Number(r.bookmarked)) : undefined,
    myRating: r.my_rating != null ? Number(r.my_rating) : undefined,
  };
}

function toPostDetail(r) {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    authorId: r.user_id,
    authorName: displayName(r),
    viewCount: r.view_count,
    isNotice: Boolean(r.is_notice),
    /* 원문은 상세에서만 내려간다. null 이면 화면이 '담기' 칸을 아예 안 그린다 —
       프롬프트 카테고리인데 원문이 없는 글은 만들 수 없지만(normalizePrompt),
       옛 글이나 카테고리를 고친 글에서 빈 상자를 그리지 않게 하는 값이 이거다. */
    promptText: r.prompt_text || null,
    copyCount: Number(r.copy_count || 0),
    ...promptStats(r),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toComment(r) {
  return {
    id: r.id,
    postId: r.post_id,
    authorId: r.user_id,
    authorName: displayName(r),
    body: r.body,
    createdAt: r.created_at,
  };
}

// 카테고리 목록 — 화면이 이 순서·라벨 그대로 탭을 그린다
router.get('/categories', (req, res) => res.json({ categories: CATEGORIES }));

/* GET /api/insights/featured
   홈 첫 화면의 '커리어 인사이트' 카드 칸.

   ── 왜 목록 API 를 안 쓰나 ──
   `/api/insights` 는 최신순이라 누가 글을 쓰면 편집 글이 밀려난다. 홈 카드는
   **정해진 다섯 편**이고 커버 사진이 글마다 짝지어져 있어서, 순서가 바뀌면
   사진과 제목이 어긋난다.

   ── 글이 아직 없으면 id 만 null 로 나간다 ──
   시드를 안 돌린 DB 에서도 홈이 멀쩡히 떠야 한다. 그때 화면은 카드를 그대로
   보여주되 인사이트 목록으로 보낸다 — 카드를 통째로 숨기면 홈에 빈 칸이 생기고,
   보는 사람은 그게 오류인지 원래 없는 건지 알 수 없다.

   제목으로 찾는 이유는 insight_posts 에 '어느 편집 글인가' 를 적을 칸이 없기
   때문이다(scripts/seed-insights.js 머리주석). */
router.get('/featured', ah(async (req, res) => {
  const titles = FEATURED.ARTICLES.map(a => a.title);
  const rows = titles.length
    ? await query(
      `SELECT id, title FROM insight_posts WHERE title IN (${titles.map(() => '?').join(',')})`,
      titles)
    : [];
  const idByTitle = new Map(rows.map(r => [r.title, r.id]));

  res.json({
    /* 본문은 안 보낸다 — 카드에 쓰지 않는 값이고, 다섯 편이면 수십 KB다.
       글은 눌러서 게시판 상세로 들어가면 거기서 받는다. */
    articles: FEATURED.ARTICLES.map(a => ({
      key: a.key, cover: a.cover, chip: a.chip, minutes: a.minutes, title: a.title,
      postId: idByTitle.get(a.title) || null,
    })),
    seeded: rows.length === titles.length,
  });
}));

/* 검색 범위. 제목만 볼지, 본문까지 볼지 사용자가 고른다.
   본문까지 뒤지면 원하는 글이 더 잘 걸리지만 엉뚱한 글도 같이 걸린다 —
   어느 쪽이 나은지는 찾는 사람이 안다. */
/* ── 검색 범위 ──────────────────────────────────────────────────
   게시판 검색은 "어디를 뒤질지" 를 사용자가 고르는 게 기본이다. 제목만 보면
   정확하고, 본문까지 보면 놓치지 않는다. 글쓴이·댓글은 찾는 방식 자체가 다르다
   ("그 사람 글 모아 보기" · "댓글에서 언급된 글 찾기").

   기본값은 `all`(제목+내용)이다 — 처음 온 사람은 범위를 고를 생각을 안 하므로,
   가장 넓게 잡아 두는 편이 "왜 안 나오지" 를 줄인다. 예전 기본값은 `title` 이었다.

   값을 바꾸면 화면(insight.js SCOPES)과 반드시 같이 고쳐야 한다 — 한쪽만 고치면
   모르는 값이 들어와 조용히 기본값으로 떨어진다. */
const SEARCH_SCOPES = new Set(['all', 'title', 'body', 'author', 'comment']);

/* LIKE 검색이라 % 와 _ 를 그대로 넣으면 와일드카드가 된다. '100%' 를 검색하면
   '100' 으로 시작하는 글이 전부 걸리는 식이라, 사용자가 친 글자는 글자로만 쓴다. */
const escapeLike = s => s.replace(/[\\%_]/g, m => `\\${m}`);

/* 목록. 카테고리로 거르고(선택), 검색어로 거르고(선택), 최신순 페이지네이션.
   본문은 미리보기만 잘라 보낸다 — 목록에서 전체 본문까지 실어 보낼 이유가 없다.

   ── 공지는 항상 맨 위 ──
   운영방침 같은 글은 몇 페이지 뒤로 밀리면 없는 것과 같다. is_notice 를 먼저
   정렬해 페이지 1의 맨 위에 둔다. 다만 **검색 중에는 고정하지 않는다** —
   검색은 "이 말이 들어간 글"을 찾는 일이라, 상관없는 공지가 맨 위에 있으면
   결과를 잘못 읽게 된다. */
router.get('/', ah(async (req, res) => {
  const category = String(req.query.category || '').trim();
  if (category && !categoryIds.has(category)) {
    return res.status(400).json({ error: '올바르지 않은 카테고리입니다.' });
  }
  const q = String(req.query.q || '').trim().slice(0, 100);
  const scope = SEARCH_SCOPES.has(req.query.scope) ? req.query.scope : 'all';

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = (page - 1) * limit;

  const conds = [];
  const params = [];
  if (category) { conds.push('p.category=?'); params.push(category); }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    /* 글쓴이는 닉네임과 이름을 둘 다 본다 — 목록에 보이는 것은 닉네임이지만,
       닉네임을 안 정한 회원은 이름이 표시된다(toPostSummary 와 같은 규칙).
       한쪽만 뒤지면 화면에 보이는 이름으로 찾았는데 안 나오는 일이 생긴다.

       댓글은 EXISTS 로 본다 — JOIN 하면 댓글이 여러 개 걸린 글이 그만큼 중복돼
       total 과 목록이 어긋난다. */
    switch (scope) {
      case 'title':
        conds.push('p.title LIKE ?'); params.push(like); break;
      case 'body':
        conds.push('p.body LIKE ?'); params.push(like); break;
      case 'author':
        conds.push('(u.nickname LIKE ? OR u.name LIKE ?)'); params.push(like, like); break;
      case 'comment':
        conds.push('EXISTS (SELECT 1 FROM insight_comments c2 WHERE c2.post_id = p.id AND c2.body LIKE ?)');
        params.push(like); break;
      default:      // all — 제목+내용
        conds.push('(p.title LIKE ? OR p.body LIKE ?)'); params.push(like, like);
    }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const order = q ? 'p.created_at DESC' : 'p.is_notice DESC, p.created_at DESC';

  /* 목록과 **같은 JOIN** 을 쓴다. 글쓴이 검색이 u.nickname 을 보는데 여기에만
     JOIN 이 없으면 그 조건에서 쿼리가 깨진다. users 는 FK 라 INNER JOIN 이어도
     건수가 달라지지 않는다(작성자가 없는 글은 존재할 수 없다). */
  const [{ n: total }] = await query(
    `SELECT COUNT(*) AS n FROM insight_posts p JOIN users u ON u.id = p.user_id ${where}`, params);

  /* 로그인했으면 '내가 이미 담았는지·북마크했는지·몇 점 줬는지' 를 같이 받는다.
     비로그인이면 빈 문자열을 넣는다 — 어차피 어떤 user_id 와도 안 맞아 0 이 되고,
     쿼리를 두 벌로 나누지 않아도 된다. */
  const me = req.user?.id || '';

  const rows = await query(
    `SELECT p.*, u.nickname AS author_nickname, u.name AS author_name,
            (SELECT COUNT(*) FROM insight_comments c WHERE c.post_id = p.id) AS comment_count,
            (SELECT COUNT(*) FROM insight_prompt_copies pc WHERE pc.post_id = p.id) AS copy_count,
            (SELECT COUNT(*) FROM insight_bookmarks bm WHERE bm.post_id = p.id) AS bookmark_count,
            (SELECT COUNT(*) FROM insight_ratings rt WHERE rt.post_id = p.id) AS rating_count,
            (SELECT AVG(rt.score) FROM insight_ratings rt WHERE rt.post_id = p.id) AS rating_avg,
            (SELECT COUNT(*) FROM insight_prompt_copies pc WHERE pc.post_id = p.id AND pc.user_id = ?) AS taken,
            (SELECT COUNT(*) FROM insight_bookmarks bm WHERE bm.post_id = p.id AND bm.user_id = ?) AS bookmarked,
            (SELECT rt.score FROM insight_ratings rt WHERE rt.post_id = p.id AND rt.user_id = ?) AS my_rating
       FROM insight_posts p
       JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY ${order}
       LIMIT ${limit} OFFSET ${offset}`,
    /* **내 상태 세 개가 앞이다.** 그 `?` 들이 SELECT 목록 안에 있어서 WHERE 의
       것보다 먼저 온다. 뒤에 붙였다가 목록이 통째로 비었다 — `total` 은 맞는데
       `posts` 만 빈 응답이라 화면에서는 '글이 없다' 로만 보였다(에러 없음). */
    [me, me, me, ...params]);

  res.json({
    posts: rows.map(toPostSummary), total: Number(total), page, limit,
    q, scope,
  });
}));

/* 상세. 볼 때마다 조회수를 올린다 — 좋아요 같은 별도 집계가 없어서
   '읽혔다'를 나타내는 값이 이거 하나다. 댓글은 오래된 순으로 같이 준다. */
router.get('/:id', ah(async (req, res) => {
  const me = req.user?.id || '';
  const row = await queryOne(
    `SELECT p.*, u.nickname AS author_nickname, u.name AS author_name,
            (SELECT COUNT(*) FROM insight_prompt_copies pc WHERE pc.post_id = p.id) AS copy_count,
            (SELECT COUNT(*) FROM insight_bookmarks bm WHERE bm.post_id = p.id) AS bookmark_count,
            (SELECT COUNT(*) FROM insight_ratings rt WHERE rt.post_id = p.id) AS rating_count,
            (SELECT AVG(rt.score) FROM insight_ratings rt WHERE rt.post_id = p.id) AS rating_avg,
            (SELECT COUNT(*) FROM insight_prompt_copies pc WHERE pc.post_id = p.id AND pc.user_id = ?) AS taken,
            (SELECT COUNT(*) FROM insight_bookmarks bm WHERE bm.post_id = p.id AND bm.user_id = ?) AS bookmarked,
            (SELECT rt.score FROM insight_ratings rt WHERE rt.post_id = p.id AND rt.user_id = ?) AS my_rating
       FROM insight_posts p JOIN users u ON u.id = p.user_id
      WHERE p.id=?`, [me, me, me, req.params.id]);
  if (!row) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  await query('UPDATE insight_posts SET view_count = view_count + 1 WHERE id=?', [req.params.id]);
  row.view_count += 1;

  const comments = await query(
    `SELECT c.*, u.nickname AS author_nickname, u.name AS author_name
       FROM insight_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id=? ORDER BY c.created_at ASC`, [req.params.id]);

  res.json({ post: toPostDetail(row), comments: comments.map(toComment) });
}));

router.post('/', requireAuth, ah(async (req, res) => {
  const { category, title, body } = req.body || {};
  if (!categoryIds.has(category)) {
    return res.status(400).json({ error: '카테고리를 선택해주세요.' });
  }
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t || t.length > 200) {
    return res.status(400).json({ error: '제목은 1~200자여야 합니다.' });
  }
  if (!b) {
    return res.status(400).json({ error: '내용을 입력해주세요.' });
  }

  /* 'AI 프롬프트' 글은 프롬프트 원문을 같이 받는다. 다른 카테고리면 null 로 떨어진다
     — 검사와 문구는 insight-prompt.js 한 곳에 있다(만들기·고치기가 같은 말을 해야 한다). */
  const p = PROMPT.normalizePrompt(category, req.body?.promptText);
  if (!p.ok) return res.status(400).json({ error: p.error });

  /* 공지는 관리자만. 일반 회원이 isNotice 를 보내도 조용히 무시한다 —
     막았다고 오류를 돌려주면 "공지로 올릴 수 있는데 권한만 없다"는 정보를 주게 되고,
     화면에는 그 선택지가 아예 없어서 정상 경로로는 올 수 없는 값이다. */
  const isNotice = Boolean(req.user.isAdmin && req.body?.isNotice);

  const id = nanoid();
  await query(
    'INSERT INTO insight_posts (id, user_id, category, title, body, is_notice, prompt_text) VALUES (?,?,?,?,?,?,?)',
    [id, req.user.id, category, t, b, isNotice, p.value]);

  const row = await queryOne(
    `SELECT p.*, u.nickname AS author_nickname, u.name AS author_name
       FROM insight_posts p JOIN users u ON u.id = p.user_id WHERE p.id=?`, [id]);
  res.status(201).json({ post: toPostDetail(row) });
}));

/* 글쓴이 본인만 고친다 — 남의 글 수정은 존재 자체를 감춘다(404). */
router.put('/:id', requireAuth, ah(async (req, res) => {
  const row = await queryOne('SELECT * FROM insight_posts WHERE id=?', [req.params.id]);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  }
  const { title, body } = req.body || {};
  const t = String(title ?? row.title).trim();
  const b = String(body ?? row.body).trim();
  if (!t || t.length > 200) return res.status(400).json({ error: '제목은 1~200자여야 합니다.' });
  if (!b) return res.status(400).json({ error: '내용을 입력해주세요.' });

  /* 공지 여부는 관리자만 바꾼다. 안 보내면 지금 값을 그대로 둔다 —
     글만 고치려고 저장했는데 공지가 풀리면 안 된다. */
  const isNotice = (req.user.isAdmin && req.body?.isNotice !== undefined)
    ? Boolean(req.body.isNotice)
    : Boolean(row.is_notice);

  /* 카테고리는 여기서 안 바꾼다(원래도 못 바꿨다) — 지금 글의 카테고리로 검사한다.
     안 보내면 지금 원문을 그대로 둔다: 제목만 고치려다 프롬프트가 날아가면 안 된다. */
  const p = PROMPT.normalizePrompt(row.category,
    req.body?.promptText === undefined ? row.prompt_text : req.body.promptText);
  if (!p.ok) return res.status(400).json({ error: p.error });

  await query('UPDATE insight_posts SET title=?, body=?, is_notice=?, prompt_text=? WHERE id=?',
    [t, b, isNotice, p.value, req.params.id]);
  const updated = await queryOne(
    `SELECT p.*, u.nickname AS author_nickname, u.name AS author_name
       FROM insight_posts p JOIN users u ON u.id = p.user_id WHERE p.id=?`, [req.params.id]);
  res.json({ post: toPostDetail(updated) });
}));

router.delete('/:id', requireAuth, ah(async (req, res) => {
  const row = await queryOne('SELECT user_id FROM insight_posts WHERE id=?', [req.params.id]);
  if (!row || (row.user_id !== req.user.id && !req.user.isAdmin)) {
    return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  }
  await query('DELETE FROM insight_posts WHERE id=?', [req.params.id]);   // 댓글은 CASCADE
  res.json({ message: '삭제되었습니다.' });
}));

/* POST /:id/copy — '내 프롬프트로 담기'
   실제 담기는 **브라우저에서** 일어난다(자소서 코치의 프롬프트 목록은 localStorage 다).
   여기서 하는 일은 '몇 사람이 가져갔나'를 세는 것뿐이라, 원문을 돌려줄 필요도 없다
   (화면은 이미 상세에서 받아 들고 있다).

   ── 사람 단위로 센다 ──
   같은 사람이 다시 담아도 한 번이다(PK 가 post_id+user_id). 그래서 이 숫자는
   '눌린 횟수'가 아니라 '가져간 사람 수'다 — 목록에서 고르는 근거로 쓰려면 그래야 한다.
   로그인을 요구하는 이유도 이것이다. 비로그인 사용자는 화면에서 복사만 한다. */
router.post('/:id/copy', requireAuth, ah(async (req, res) => {
  const row = await queryOne('SELECT id, category, prompt_text FROM insight_posts WHERE id=?',
    [req.params.id]);
  if (!row) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (!row.prompt_text) {
    return res.status(400).json({ error: '이 글에는 담아 갈 프롬프트가 없어요.' });
  }

  await query('INSERT IGNORE INTO insight_prompt_copies (post_id, user_id) VALUES (?,?)',
    [req.params.id, req.user.id]);
  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM insight_prompt_copies WHERE post_id=?', [req.params.id]);
  res.json({ copyCount: Number(n) });
}));

/* ── 북마크 (2026-09-07, 사용자 지시) ─────────────────────────
   누를 때마다 켜고 끈다. 담기(/copy)와 **일부러 나눠 뒀다** — 담기는 '지금 쓰겠다'
   라 누르는 순간 내 자소서 초안에 규칙이 적용되고, 북마크는 '나중에 볼게' 다.
   둘을 한 숫자로 합치면 몇 사람이 **실제로 쓰는지**를 알 수 없게 된다. */
router.post('/:id/bookmark', requireAuth, ah(async (req, res) => {
  const row = await queryOne('SELECT id FROM insight_posts WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  const had = await queryOne(
    'SELECT 1 AS x FROM insight_bookmarks WHERE post_id=? AND user_id=?',
    [req.params.id, req.user.id]);
  if (had) {
    await query('DELETE FROM insight_bookmarks WHERE post_id=? AND user_id=?',
      [req.params.id, req.user.id]);
  } else {
    await query('INSERT IGNORE INTO insight_bookmarks (post_id, user_id) VALUES (?,?)',
      [req.params.id, req.user.id]);
  }
  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM insight_bookmarks WHERE post_id=?', [req.params.id]);
  res.json({ bookmarked: !had, bookmarkCount: Number(n) });
}));

/* ── 평점 (1~5) ──────────────────────────────────────────────
   한 사람이 한 번만 매기고, 다시 매기면 덮어쓴다(PK 가 그 규칙을 표로 지킨다).
   같은 점수를 다시 누르면 **취소**다 — 잘못 눌렀을 때 되돌릴 길이 있어야 한다.

   **자기 글에는 못 매긴다.** 막지 않으면 글쓴이가 자기 글에 5점을 주고 시작하는데,
   표본이 적을수록 그 한 표가 순위를 통째로 흔든다. */
router.post('/:id/rating', requireAuth, ah(async (req, res) => {
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ error: '평점은 1~5 사이여야 합니다.' });
  }

  const row = await queryOne('SELECT id, user_id, prompt_text FROM insight_posts WHERE id=?',
    [req.params.id]);
  if (!row) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (!row.prompt_text) {
    return res.status(400).json({ error: '이 글에는 평가할 프롬프트가 없어요.' });
  }
  if (row.user_id === req.user.id) {
    return res.status(400).json({ error: '자기 글에는 평점을 매길 수 없어요.' });
  }

  const mine = await queryOne(
    'SELECT score FROM insight_ratings WHERE post_id=? AND user_id=?',
    [req.params.id, req.user.id]);

  if (mine && Number(mine.score) === score) {
    /* 같은 점수를 또 누르면 취소 — 눌렀다 무르는 길을 남긴다. */
    await query('DELETE FROM insight_ratings WHERE post_id=? AND user_id=?',
      [req.params.id, req.user.id]);
  } else {
    await query(
      `INSERT INTO insight_ratings (post_id, user_id, score) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE score = VALUES(score)`,
      [req.params.id, req.user.id, score]);
  }

  const [agg] = await query(
    'SELECT COUNT(*) AS n, AVG(score) AS avg FROM insight_ratings WHERE post_id=?',
    [req.params.id]);
  const [now] = await query(
    'SELECT score FROM insight_ratings WHERE post_id=? AND user_id=?',
    [req.params.id, req.user.id]);

  const votes = Number(agg.n || 0);
  res.json({
    ratingCount: votes,
    /* 표본이 모자라면 평균을 안 준다 — 목록·상세와 같은 규칙이다(RATING_MIN_VOTES). */
    ratingAvg: votes >= RATING_MIN_VOTES ? Math.round(Number(agg.avg) * 10) / 10 : null,
    ratingMinVotes: RATING_MIN_VOTES,
    myRating: now ? Number(now.score) : null,
  });
}));

router.post('/:id/comments', requireAuth, ah(async (req, res) => {
  const post = await queryOne('SELECT id FROM insight_posts WHERE id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  const b = String((req.body || {}).body || '').trim();
  if (!b) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
  if (b.length > 1000) return res.status(400).json({ error: '댓글은 1000자를 넘을 수 없어요.' });

  const id = nanoid();
  await query('INSERT INTO insight_comments (id, post_id, user_id, body) VALUES (?,?,?,?)',
    [id, req.params.id, req.user.id, b]);
  const row = await queryOne(
    `SELECT c.*, u.nickname AS author_nickname, u.name AS author_name
       FROM insight_comments c JOIN users u ON u.id = c.user_id WHERE c.id=?`, [id]);
  res.status(201).json({ comment: toComment(row) });
}));

router.delete('/:id/comments/:commentId', requireAuth, ah(async (req, res) => {
  const row = await queryOne('SELECT user_id FROM insight_comments WHERE id=? AND post_id=?',
    [req.params.commentId, req.params.id]);
  if (!row || (row.user_id !== req.user.id && !req.user.isAdmin)) {
    return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
  }
  await query('DELETE FROM insight_comments WHERE id=?', [req.params.commentId]);
  res.json({ message: '삭제되었습니다.' });
}));

module.exports = { router, CATEGORIES };
