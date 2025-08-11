const { server } = require('../app');

module.exports = (req, res) => {
  // Allow CORS for Socket.IO polling and WebSocket upgrade
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // On Vercel, avoid calling server.listen() for every request
  // Only start the server if it hasn’t been started yet
  if (!server.listening) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`[Socket.IO] Listening on port ${PORT} (serverless)`);
    });
  }

  // Support WebSocket upgrade requests
  if (req.url.startsWith('/socket.io')) {
    // Let Socket.IO handle upgrade/polling
    return server.emit('request', req, res);
  }

  // Handle normal HTTP requests through Express
  return server.emit('request', req, res);
};
