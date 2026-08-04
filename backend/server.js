require('dotenv/config');

const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const leadsRouter = require('./routes/leads');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway (and most PaaS hosts) put the app behind a single reverse-proxy
// hop that sets X-Forwarded-For. Without this, Express won't trust that
// header for req.ip, and express-rate-limit refuses to key off it —
// throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every rate-limited
// request instead of rate-limiting by real client IP. `1` trusts exactly
// one hop, matching Railway's setup, rather than the whole chain.
app.set('trust proxy', 1);

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD is not set. Admin login will be unavailable until it is configured.');
}

// No blanket CORS here: the frontend and API are served from the same
// origin, so the SPA needs none, and admin routes are protected by a
// SameSite=Lax session cookie browsers won't send cross-site anyway.
// The one route that does need to be reachable from other origins —
// the public intake form — sets its own scoped CORS policy in
// routes/leads.js.
// Quiet during the test suite — 43+ requests per run don't need a
// request log cluttering the test output.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}
app.use(express.json());
app.use(cookieParser());

const staticDir = path.join(__dirname, '..', 'frontend', 'public');
app.use(express.static(staticDir));

app.use('/api/auth', authRouter);
app.use('/api/leads', leadsRouter);

// Catch-all: serve the SPA's index.html for any non-API GET request
// so client-side routing survives a page refresh.
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Only start listening when run directly (node backend/server.js), not
// when required by the test suite, which needs the app without a live
// network listener.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Lead Intake Pipeline server listening on port ${PORT}`);
  });

  // Platforms like Railway send SIGTERM before killing the container on
  // a deploy or restart. Without this, in-flight requests get dropped
  // and the pg pool's connections are torn down uncleanly rather than
  // closed. Stop accepting new connections first, let existing ones
  // finish, then close the DB pool.
  const shutdown = (signal) => {
    console.log(`${signal} received: shutting down gracefully`);
    server.close(async (err) => {
      if (err) {
        console.error('Error while closing HTTP server:', err);
      }
      try {
        await leadsRouter.pool.end();
      } catch (poolErr) {
        console.error('Error while closing database pool:', poolErr);
      }
      process.exit(err ? 1 : 0);
    });

    // If something is still holding a connection open 10s in, exit
    // anyway rather than hang the platform's shutdown/restart forever.
    setTimeout(() => {
      console.error('Forcing shutdown after 10s timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
