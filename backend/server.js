require('dotenv/config');

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const leadsRouter = require('./routes/leads');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD is not set. Admin login will be unavailable until it is configured.');
}

app.use(cors());
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
  app.listen(PORT, () => {
    console.log(`Lead Intake Pipeline server listening on port ${PORT}`);
  });
}

module.exports = app;
