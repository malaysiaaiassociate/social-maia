const { server } = require('../app');

module.exports = (req, res) => {
  // Enable CORS for Socket.IO polling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // Preflight request
    return res.status(200).end();
  }

  // Ensure Server keeps listening in serverless
  if (!server.listening) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Socket.IO server listening on port ${PORT} (serverless mode)`);
    });
  }

  // Forward HTTP request to Express
  server.emit('request', req, res);
};
