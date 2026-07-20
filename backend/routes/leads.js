const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'lost'];

const isValidId = (id) => /^\d+$/.test(id);

// GET /api/leads
// Optional query param: ?status=new|contacted|qualified|lost
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    let result;
    if (status) {
      result = await pool.query(
        'SELECT * FROM leads WHERE status = $1 ORDER BY created_at DESC',
        [status]
      );
    } else {
      result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    }

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, business_name, service_interest, message, source } = req.body;

    if (!name || typeof name !== 'string' || !name.trim() ||
        !email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const result = await pool.query(
      `INSERT INTO leads (name, email, phone, business_name, service_interest, message, source)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'website'))
       RETURNING *`,
      [name, email, phone || null, business_name || null, service_interest || null, message || null, source || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leads/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/follow-ups
router.post('/:id/follow-ups', async (req, res) => {
  try {
    const { id } = req.params;
    const { note, method, scheduled_at } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    if (!note || typeof note !== 'string' || !note.trim()) {
      return res.status(400).json({ error: 'Note is required' });
    }

    const leadResult = await pool.query('SELECT id FROM leads WHERE id = $1', [id]);

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const result = await pool.query(
      `INSERT INTO follow_ups (lead_id, note, method, scheduled_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, note, method || null, scheduled_at || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
