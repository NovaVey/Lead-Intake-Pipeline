const crypto = require('crypto');

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Derive a signing key from ADMIN_PASSWORD rather than using the raw
// password as the HMAC key directly.
function getSigningKey() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return crypto.createHash('sha256').update(password).digest();
}

function base64UrlEncode(buf) {
  return buf.toString('base64url');
}

function sign(payloadObj) {
  const key = getSigningKey();
  if (!key) return null;
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(payloadObj)));
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  const key = getSigningKey();
  if (!key || !token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }

  if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
    return null;
  }

  return parsed;
}

function checkPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== 'string') return false;

  // Compare fixed-length SHA-256 digests rather than the raw strings so
  // this doesn't leak password length via early-exit timing, and so
  // Buffer lengths always match for timingSafeEqual regardless of input.
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function issueSessionCookie(res) {
  const token = sign({ exp: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

function isAuthenticated(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  return Boolean(verify(token));
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = {
  SESSION_COOKIE,
  checkPassword,
  issueSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAuth,
};
