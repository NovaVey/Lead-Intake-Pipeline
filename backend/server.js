require('dotenv/config');

const express = require('express');
const cors = require('cors');
const path = require('path');

const leadsRouter = require('./routes/leads');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const staticDir = path.join(__dirname, '..', 'frontend', 'public');
app.use(express.static(staticDir));

app.use('/api/leads', leadsRouter);

// Catch-all: serve the SPA's index.html for any non-API GET request
// so client-side routing survives a page refresh.
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Lead Intake Pipeline server listening on port ${PORT}`);
});
