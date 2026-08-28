
const express = require('express');
const subscriptionRoutes = require('./routes/subscriptionRoutes');

const app = express();

app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = buffer; } }));
app.use('/api/subscriptions', subscriptionRoutes);
const testRoutes = require('./routes/testRoutes');
app.use('/api/_test', testRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

module.exports = app;
