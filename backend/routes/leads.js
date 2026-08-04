const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/auth');
const { intakeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// The public intake form is meant to be embeddable from any site (a
// small business's own website, a landing page builder, etc.), so it
// gets its own permissive CORS policy rather than inheriting one from
// the app as a whole — everything else in this router requires the
// admin session cookie, which browsers won't attach cross-site anyway
// (the cookie is issued with SameSite=Lax).
const publicCors = cors();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'lost'];
const VALID_FOLLOW_UP_METHODS = ['Email', 'Phone', 'Text'];

// Field length caps. The VARCHAR-backed fields match schema.sql exactly
// so an oversized value is rejected with a clean 400 here rather than
// surfacing as a generic 500 when Postgres rejects the INSERT. The TEXT
// fields (message, note) have no DB-level limit, so this is the only
// cap on how much a public, unauthenticated caller can submit at once.
const MAX_LENGTHS = {
  name: 255,
  email: 255,
  phone: 50,
  business_name: 255,
  service_interest: 255,
  message: 5000,
  note: 5000,
};

// A safety cap on GET /api/leads so the query can never return an
// unbounded number of rows as the table grows, without requiring
// full pagination controls at this app's realistic scale.
const MAX_LEADS_PER_REQUEST = 500;

// Postgres's `integer` (the type backing the SERIAL id columns) tops
// out at 2^31 - 1; anything past that can never be a real id, so treat
// it the same as a malformed one rather than letting it hit the DB and
// come back as an opaque 500.
const MAX_INT = 2147483647;
const isValidId = (id) => /^\d+$/.test(id) && Number(id) <= MAX_INT;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function isTooLong(field, value) {
  return typeof value === 'string' && typeof MAX_LENGTHS[field] === 'number' && value.length > MAX_LENGTHS[field];
}

// Wraps a route handler so every route gets the same try/catch -> 500
// JSON behavior, with request context in the server-side log, instead
// of repeating it in all eight handlers.
function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Validates req.params.id before the handler runs, for every route
// shaped /:id or /:id/...
function requireValidId(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  next();
}

// GET /api/leads
// Optional query params:
//   ?status=new|contacted|qualified|lost
//   ?search=<matches name, email, or business_name, case-insensitive>
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { status, search } = req.query;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (search && typeof search === 'string' && search.trim()) {
    params.push(`%${search.trim()}%`);
    const idx = params.length;
    conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR business_name ILIKE $${idx})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC LIMIT ${MAX_LEADS_PER_REQUEST}`,
    params
  );

  res.status(200).json(result.rows);
}));

// GET /api/leads/:id
router.get('/:id', requireAuth, requireValidId, asyncRoute(async (req, res) => {
  const { id } = req.params;

  const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);

  if (leadResult.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const followUpsResult = await pool.query(
    'SELECT * FROM follow_ups WHERE lead_id = $1 ORDER BY created_at DESC',
    [id]
  );

  const lead = leadResult.rows[0];
  lead.follow_ups = followUpsResult.rows;

  res.status(200).json(lead);
}));

// POST /api/leads (public — no auth required)
router.options('/', publicCors);
router.post('/', publicCors, intakeLimiter, asyncRoute(async (req, res) => {
  const name = trimmed(req.body.name);
  const email = trimmed(req.body.email);
  const phone = trimmed(req.body.phone) || null;
  const business_name = trimmed(req.body.business_name) || null;
  const service_interest = trimmed(req.body.service_interest) || null;
  const message = trimmed(req.body.message) || null;
  const source = req.body.source || null;

  if (!name || typeof name !== 'string' || !email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const fields = { name, email, phone, business_name, service_interest, message };
  for (const field of Object.keys(fields)) {
    if (isTooLong(field, fields[field])) {
      return res.status(400).json({ error: `${field} is too long (max ${MAX_LENGTHS[field]} characters)` });
    }
  }

  const result = await pool.query(
    `INSERT INTO leads (name, email, phone, business_name, service_interest, message, source)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'website'))
     RETURNING *`,
    [name, email, phone, business_name, service_interest, message, source]
  );

  res.status(201).json(result.rows[0]);
}));

// PATCH /api/leads/:id/status
router.patch('/:id/status', requireAuth, requireValidId, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = await pool.query(
    'UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  res.status(200).json(result.rows[0]);
}));

// POST /api/leads/:id/follow-ups
router.post('/:id/follow-ups', requireAuth, requireValidId, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const note = trimmed(req.body.note);
  const method = trimmed(req.body.method) || null;
  const scheduled_at = req.body.scheduled_at || null;

  if (!note || typeof note !== 'string') {
    return res.status(400).json({ error: 'Note is required' });
  }

  if (isTooLong('note', note)) {
    return res.status(400).json({ error: `note is too long (max ${MAX_LENGTHS.note} characters)` });
  }

  if (method && !VALID_FOLLOW_UP_METHODS.includes(method)) {
    return res.status(400).json({ error: 'Invalid method' });
  }

  const leadResult = await pool.query('SELECT id FROM leads WHERE id = $1', [id]);

  if (leadResult.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const result = await pool.query(
    `INSERT INTO follow_ups (lead_id, note, method, scheduled_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, note, method, scheduled_at]
  );

  res.status(201).json(result.rows[0]);
}));

// PATCH /api/leads/:id/follow-ups/:followUpId
// Body: { completed: true|false } — toggles completed_at on/off.
router.patch('/:id/follow-ups/:followUpId', requireAuth, requireValidId, asyncRoute(async (req, res) => {
  const { id, followUpId } = req.params;
  const { completed } = req.body;

  if (!isValidId(followUpId)) {
    return res.status(400).json({ error: 'Invalid follow-up id' });
  }

  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'completed (boolean) is required' });
  }

  const result = await pool.query(
    `UPDATE follow_ups SET completed_at = $1 WHERE id = $2 AND lead_id = $3 RETURNING *`,
    [completed ? new Date() : null, followUpId, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Follow-up not found' });
  }

  res.status(200).json(result.rows[0]);
}));

// DELETE /api/leads/:id
router.delete('/:id', requireAuth, requireValidId, asyncRoute(async (req, res) => {
  const { id } = req.params;

  const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  res.status(200).json({ id: result.rows[0].id, deleted: true });
}));

// Exposed for tests (setup/teardown) — the router itself remains the
// default export so `app.use('/api/leads', require('./routes/leads'))`
// in server.js keeps working unchanged.
router.pool = pool;

module.exports = router;
