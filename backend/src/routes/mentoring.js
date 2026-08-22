/* 멘토링 신청 — 결제가 붙는 유일한 흐름.

   ── 왜 서버로 옮겼나 ──
   신청 내역이 브라우저 localStorage 에만 있었다. 결제를 붙이려면 반드시 서버에
   있어야 한다. 금액과 주문을 브라우저가 들고 있으면 개발자도구에서 20,000원을
   100원으로 바꿔 결제한 뒤 "결제했다" 고 주장할 수 있다.

   ── 금액은 절대 클라이언트에서 받지 않는다 ──
   요청 본문의 amount 를 그대로 쓰면 위 공격이 성립한다. 여기서는 **format 만 받고
   금액은 서버가 FORMATS 에서 찾아 정한다**. 결제 승인 때도 이 값과 대조한다.

   ── 멘토는 이제 실제 회원이다 (2026-08-22) ──
   그전에는 프론트 mentoring.js 의 가짜 멘토 배열이 원본이라 mentorId 를 검증할
   방법이 없었다. 지금은 GET /api/mentors 가 원본이므로, 신청이 **목록에 있는
   멘토에게만** 가도록 여기서 확인한다. 없는 멘토로 신청이 만들어지면 결제까지
   된 뒤에야 아무도 못 받는 건이라는 게 드러난다.
   mentorId 는 username 이다(repo.mentors.list 가 그렇게 내보낸다). */
const express = require('express');
const { nanoid } = require('nanoid');
const { query, queryOne } = require('../mysql');
/* 멘토가 실제로 있는지 확인하려고 쓴다. 목록을 내보내는 곳과 **같은 함수**를
   써야, 화면에 안 보이는 멘토에게 신청이 들어가는 일이 안 생긴다. */
const repo = require('../repo');

const router = express.Router();

/* 가격표의 단일 출처. 프론트에도 같은 목록이 있지만 화면 표시용이고,
   실제 청구 금액은 **여기 값만** 쓴다. 둘이 어긋나면 서버가 이긴다. */
const FORMATS = [
  { id: 'video30',  name: '화상 30분', amount: 20000 },
  { id: 'onsite60', name: '대면 60분', amount: 45000 },
  { id: 'text',     name: '텍스트',    amount: 12000 },
];
const formatById = id => FORMATS.find(f => f.id === id) || null;

/* 신청 상태
     pending  — 신청만 하고 아직 결제 전
     paid     — 결제 승인 완료 (멘토 응답 대기)
     accepted / rejected — 멘토가 답함
     cancelled — 멘티가 취소 */
const OPEN_STATUSES = ['pending', 'paid'];

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

// 가격표 — 화면이 서버 가격을 그대로 보여주도록
router.get('/formats', (req, res) => res.json({ formats: FORMATS }));

/* 내 신청 목록. 멘티는 자기가 보낸 것, 멘토는 자기가 받은 것을 본다.
   지금은 멘토가 시드라 받은 요청 조회는 아직 쓰이지 않는다. */
router.get('/requests', requireAuth, async (req, res) => {
  const rows = await query(
    'SELECT * FROM mentoring_requests WHERE mentee_id=? ORDER BY created_at DESC',
    [req.user.id]);
  res.json({ requests: rows.map(toRequest) });
});

router.post('/requests', requireAuth, async (req, res) => {
  const { mentorId, format, message, slotDate, slotTime } = req.body || {};
  const f = formatById(format);
  if (!mentorId || !f) {
    return res.status(400).json({ error: '멘토와 멘토링 형식을 선택해주세요.' });
  }

  /* 멘토는 서버가 확인한다. 이름도 **본문에서 받지 않고** 여기서 채운다 —
     화면이 보낸 이름을 그대로 저장하면 신청 목록에 아무 이름이나 남길 수 있다. */
  const mentor = await repo.mentors.byUsername(String(mentorId));
  if (!mentor) {
    return res.status(404).json({ error: '멘토를 찾을 수 없어요. 목록에서 다시 골라주세요.' });
  }
  /* 자기 자신에게는 신청할 수 없다. 멘토도 다른 멘토에게 신청할 수는 있다 —
     막을 이유가 없고, 실제로 선배에게 물을 것이 있는 경우가 있다. */
  if (mentor.id === req.user.username) {
    return res.status(400).json({ error: '자신에게는 멘토링을 신청할 수 없어요.' });
  }

  const msg = (message || '').trim();

  /* 날짜·시간은 화면에서 멘토가 연 일정 중에서만 고르게 되어 있지만,
     요청은 직접 만들어 보낼 수 있으므로 형식과 '지난 날짜인지'를 여기서 다시 본다.
     지난 날짜로 신청이 들어오면 결제까지 되고 나서야 문제가 드러난다. */
  const date = String(slotDate || '').trim();
  const time = String(slotTime || '').trim();
  if (!date || !time) {
    return res.status(400).json({ error: '멘토링 날짜와 시간을 선택해주세요.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    return res.status(400).json({ error: '날짜 형식이 올바르지 않습니다.' });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return res.status(400).json({ error: '시간 형식이 올바르지 않습니다.' });
  }
  /* 오늘은 허용한다 — 몇 시간 뒤 약속을 잡을 수 있어야 한다. 어제는 막는다. */
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(date) < today) {
    return res.status(400).json({ error: '지난 날짜로는 신청할 수 없어요.' });
  }

  /* 같은 멘토에게 결제 전 신청이 이미 있으면 새로 만들지 않고 그것을 갱신한다.
     아니면 결제창을 닫을 때마다 미결제 주문이 쌓인다. */
  const open = await queryOne(
    "SELECT id FROM mentoring_requests WHERE mentee_id=? AND mentor_id=? AND status='pending'",
    [req.user.id, mentorId]);

  let id;
  if (open) {
    id = open.id;
    await query(
      `UPDATE mentoring_requests
         SET format=?, format_name=?, amount=?, message=?, slot_date=?, slot_time=?
       WHERE id=?`,
      [f.id, f.name, f.amount, msg, date, time, id]);
  } else {
    id = nanoid();
    await query(
      `INSERT INTO mentoring_requests
         (id, mentee_id, mentor_id, mentor_name, format, format_name, amount, message,
          slot_date, slot_time, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
      [id, req.user.id, mentorId, mentor.name,
       f.id, f.name, f.amount, msg, date, time]);   // ← 금액은 서버가 정한 값. 클라이언트 값은 쓰지 않는다
  }

  const row = await queryOne('SELECT * FROM mentoring_requests WHERE id=?', [id]);
  res.status(201).json({ request: toRequest(row) });
});

router.post('/requests/:id/cancel', requireAuth, async (req, res) => {
  const row = await queryOne('SELECT * FROM mentoring_requests WHERE id=?', [req.params.id]);
  if (!row || row.mentee_id !== req.user.id) {
    return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
  }
  if (!OPEN_STATUSES.includes(row.status)) {
    return res.status(409).json({ error: '이미 처리된 신청입니다.' });
  }
  /* 결제까지 끝난 건은 환불이 따라야 하므로 여기서 그냥 지우지 않는다.
     환불 흐름을 만들기 전까지는 미결제 건만 취소할 수 있다. */
  if (row.status === 'paid') {
    return res.status(409).json({ error: '결제가 완료된 신청은 아직 취소할 수 없어요. 멘토에게 문의해 주세요.' });
  }

  await query("UPDATE mentoring_requests SET status='cancelled' WHERE id=?", [row.id]);
  const updated = await queryOne('SELECT * FROM mentoring_requests WHERE id=?', [row.id]);
  res.json({ message: '신청을 취소했습니다.', request: toRequest(updated) });
});

/* DB 는 snake_case, 화면은 camelCase 를 기대한다(예전 파일 DB 가 그랬다).
   변환을 여기서만 하고 화면 코드는 그대로 둔다. */
function toRequest(r) {
  if (!r) return null;
  const payment = typeof r.payment === 'string'
    ? (() => { try { return JSON.parse(r.payment); } catch { return null; } })()
    : r.payment;
  return {
    id: r.id, menteeId: r.mentee_id, mentorId: r.mentor_id, mentorName: r.mentor_name,
    format: r.format, formatName: r.format_name, amount: Number(r.amount),
    message: r.message, status: r.status, orderId: r.order_id, payment: payment ?? null,
    /* 약속 시각. dateStrings:true 라 'YYYY-MM-DD' 문자열로 온다 —
       Date 로 바꾸면 시간대 때문에 하루씩 밀린다(mysql.js 주석). */
    slotDate: r.slot_date ?? null, slotTime: r.slot_time ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = { router, FORMATS, formatById, toRequest };
