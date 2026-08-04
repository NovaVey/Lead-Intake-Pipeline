const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Tests need a known admin password; fall back to a fixed test value if
// the environment doesn't already provide one (e.g. local `npm test`
// without a .env, or CI). This must be set before requiring the app so
// backend/middleware/auth.js picks it up.
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-suite-admin-password';

const app = require('../backend/server');
const { pool } = require('../backend/routes/leads');

async function resetDb() {
  await pool.query('TRUNCATE follow_ups, leads RESTART IDENTITY CASCADE');
}

async function loginAgent() {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ password: process.env.ADMIN_PASSWORD })
    .expect(200);
  return agent;
}

async function createLead(overrides) {
  const res = await request(app)
    .post('/api/leads')
    .send(Object.assign({ name: 'Seed Lead', email: 'seed@example.com' }, overrides || {}))
    .expect(201);
  return res.body;
}

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await pool.end();
});

// ---------- POST /api/leads (public, no auth) ----------

test('POST /api/leads - creates a lead with defaults, no auth required', async () => {
  const res = await request(app)
    .post('/api/leads')
    .send({ name: 'Jane Smith', email: 'jane@smithplumbing.com', phone: '715-555-1234' })
    .expect(201);

  assert.ok(res.body.id);
  assert.equal(res.body.name, 'Jane Smith');
  assert.equal(res.body.email, 'jane@smithplumbing.com');
  assert.equal(res.body.status, 'new');
  assert.equal(res.body.source, 'website');
  assert.ok(res.body.created_at);
  assert.ok(res.body.updated_at);
});

test('POST /api/leads - 400 when name is missing', async () => {
  const res = await request(app).post('/api/leads').send({ email: 'x@example.com' }).expect(400);
  assert.ok(res.body.error);
});

test('POST /api/leads - 400 when email is missing', async () => {
  const res = await request(app).post('/api/leads').send({ name: 'X' }).expect(400);
  assert.ok(res.body.error);
});

test('POST /api/leads - 400 on empty body', async () => {
  await request(app).post('/api/leads').send({}).expect(400);
});

// ---------- Auth ----------

test('POST /api/auth/login - 401 on wrong password', async () => {
  const res = await request(app).post('/api/auth/login').send({ password: 'nope' }).expect(401);
  assert.ok(res.body.error);
});

test('POST /api/auth/login - 200 and sets a session cookie on correct password', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ password: process.env.ADMIN_PASSWORD })
    .expect(200);
  assert.ok(res.headers['set-cookie']);
});

test('GET /api/auth/me - reports unauthenticated with no cookie', async () => {
  const res = await request(app).get('/api/auth/me').expect(200);
  assert.equal(res.body.authenticated, false);
});

test('GET /api/auth/me - reports authenticated after login', async () => {
  const agent = await loginAgent();
  const res = await agent.get('/api/auth/me').expect(200);
  assert.equal(res.body.authenticated, true);
});

test('POST /api/auth/logout - clears the session so protected routes 401 again', async () => {
  const agent = await loginAgent();
  await agent.get('/api/leads').expect(200);
  await agent.post('/api/auth/logout').expect(200);
  await agent.get('/api/leads').expect(401);
});

// ---------- Auth-gating on /api/leads (everything except POST /) ----------

test('GET /api/leads - 401 without auth', async () => {
  await request(app).get('/api/leads').expect(401);
});

test('GET /api/leads/:id - 401 without auth', async () => {
  const lead = await createLead();
  await request(app).get(`/api/leads/${lead.id}`).expect(401);
});

test('PATCH /api/leads/:id/status - 401 without auth', async () => {
  const lead = await createLead();
  await request(app).patch(`/api/leads/${lead.id}/status`).send({ status: 'contacted' }).expect(401);
});

test('POST /api/leads/:id/follow-ups - 401 without auth', async () => {
  const lead = await createLead();
  await request(app).post(`/api/leads/${lead.id}/follow-ups`).send({ note: 'x' }).expect(401);
});

test('DELETE /api/leads/:id - 401 without auth', async () => {
  const lead = await createLead();
  await request(app).delete(`/api/leads/${lead.id}`).expect(401);
});

// ---------- GET /api/leads (authenticated) ----------

test('GET /api/leads - 200 array, and ?status= filters correctly', async () => {
  const agent = await loginAgent();
  const a = await createLead({ name: 'A', email: 'a@example.com' });
  const b = await createLead({ name: 'B', email: 'b@example.com' });
  await agent.patch(`/api/leads/${b.id}/status`).send({ status: 'contacted' }).expect(200);

  const all = await agent.get('/api/leads').expect(200);
  assert.equal(all.body.length, 2);

  const newOnly = await agent.get('/api/leads?status=new').expect(200);
  assert.equal(newOnly.body.length, 1);
  assert.equal(newOnly.body[0].id, a.id);

  const contactedOnly = await agent.get('/api/leads?status=contacted').expect(200);
  assert.equal(contactedOnly.body.length, 1);
  assert.equal(contactedOnly.body[0].id, b.id);
});

// ---------- GET /api/leads/:id (authenticated) ----------

test('GET /api/leads/:id - includes a nested follow_ups array', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  const res = await agent.get(`/api/leads/${lead.id}`).expect(200);
  assert.ok(Array.isArray(res.body.follow_ups));
  assert.equal(res.body.follow_ups.length, 0);
});

test('GET /api/leads/:id - 400 on non-numeric id', async () => {
  const agent = await loginAgent();
  await agent.get('/api/leads/abc').expect(400);
});

test('GET /api/leads/:id - 404 on a well-formed but nonexistent id', async () => {
  const agent = await loginAgent();
  await agent.get('/api/leads/999999').expect(404);
});

// ---------- PATCH /api/leads/:id/status (authenticated) ----------

test('PATCH /api/leads/:id/status - 200 on a valid status', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  const res = await agent.patch(`/api/leads/${lead.id}/status`).send({ status: 'qualified' }).expect(200);
  assert.equal(res.body.status, 'qualified');
});

test('PATCH /api/leads/:id/status - 400 on an invalid status value', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  await agent.patch(`/api/leads/${lead.id}/status`).send({ status: 'deleted' }).expect(400);
});

test('PATCH /api/leads/:id/status - 400 on non-numeric id', async () => {
  const agent = await loginAgent();
  await agent.patch('/api/leads/abc/status').send({ status: 'new' }).expect(400);
});

test('PATCH /api/leads/:id/status - 404 on nonexistent id', async () => {
  const agent = await loginAgent();
  await agent.patch('/api/leads/999999/status').send({ status: 'new' }).expect(404);
});

// ---------- POST /api/leads/:id/follow-ups (authenticated) ----------

test('POST /api/leads/:id/follow-ups - 201 on a valid note', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  const res = await agent
    .post(`/api/leads/${lead.id}/follow-ups`)
    .send({ note: 'Called, left voicemail', method: 'Phone' })
    .expect(201);
  assert.equal(res.body.note, 'Called, left voicemail');
  assert.equal(res.body.lead_id, lead.id);
});

test('POST /api/leads/:id/follow-ups - 400 when note is missing', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  await agent.post(`/api/leads/${lead.id}/follow-ups`).send({ method: 'Email' }).expect(400);
});

test('POST /api/leads/:id/follow-ups - 404 when the parent lead does not exist', async () => {
  const agent = await loginAgent();
  await agent.post('/api/leads/999999/follow-ups').send({ note: 'x' }).expect(404);
});

// ---------- DELETE /api/leads/:id (authenticated) ----------

test('DELETE /api/leads/:id - 200 and removes the lead', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  const res = await agent.delete(`/api/leads/${lead.id}`).expect(200);
  assert.equal(res.body.deleted, true);
  await agent.get(`/api/leads/${lead.id}`).expect(404);
});

test('DELETE /api/leads/:id - 404 on nonexistent id', async () => {
  const agent = await loginAgent();
  await agent.delete('/api/leads/999999').expect(404);
});

test('DELETE /api/leads/:id - 400 on non-numeric id', async () => {
  const agent = await loginAgent();
  await agent.delete('/api/leads/abc').expect(400);
});

test('DELETE /api/leads/:id - cascades to delete its follow_ups', async () => {
  const agent = await loginAgent();
  const lead = await createLead();
  await agent.post(`/api/leads/${lead.id}/follow-ups`).send({ note: 'will be cascaded' }).expect(201);

  await agent.delete(`/api/leads/${lead.id}`).expect(200);

  const remaining = await pool.query('SELECT * FROM follow_ups WHERE lead_id = $1', [lead.id]);
  assert.equal(remaining.rows.length, 0);
});

// ---------- Data-level constraints ----------

test('leads.status CHECK constraint rejects an invalid value written directly via SQL', async () => {
  const lead = await createLead();
  await assert.rejects(
    pool.query("UPDATE leads SET status = 'not-a-real-status' WHERE id = $1", [lead.id]),
    /violates check constraint/
  );
});

test('follow_ups.lead_id foreign key rejects an orphan reference', async () => {
  await assert.rejects(
    pool.query("INSERT INTO follow_ups (lead_id, note) VALUES (999999, 'orphan')"),
    /violates foreign key constraint/
  );
});
