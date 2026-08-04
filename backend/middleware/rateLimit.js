const rateLimit = require('express-rate-limit');

// Disabled under the test suite: 43+ tests hit these routes back-to-back
// from the same IP (127.0.0.1 via supertest) well past any sane human
// threshold, and rate limiting isn't what those tests are checking.
const disabled = process.env.NODE_ENV === 'test';

const skip = () => disabled;

// Public intake form (POST /api/leads): no auth, so this is the only
// thing standing between the endpoint and someone scripting spam
// submissions. Generous enough for a real visitor retrying a typo.
const intakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: 'Too many submissions from this address. Please try again later.' },
});

// Admin login (POST /api/auth/login): the single shared password is
// the entire auth boundary, so brute-forcing it is the realistic
// threat this guards against.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: 'Too many login attempts. Please try again later.' },
});

module.exports = { intakeLimiter, loginLimiter };
