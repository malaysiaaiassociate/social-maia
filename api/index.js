const { server } = require('../app');

module.exports = (req, res) => {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Start server only once in serverless
  if (!server.listening) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`[Socket.IO] Listening on port ${PORT} (serverless)`);
    });
  }

  // Handle Socket.IO upgrade or HTTP requests
  return server.emit('request', req, res);
};
