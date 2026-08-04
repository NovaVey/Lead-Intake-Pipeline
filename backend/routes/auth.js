const express = require('express');
const {
  checkPassword,
  issueSessionCookie,
  clearSessionCookie,
  isAuthenticated,
} = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin login is not configured' });
  }

  const { password } = req.body;

  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  issueSessionCookie(res);
  res.status(200).json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.status(200).json({ authenticated: isAuthenticated(req) });
});

module.exports = router;
