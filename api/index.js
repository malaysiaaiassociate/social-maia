const { server } = require('../app');

module.exports = (req, res) => {
  // Allow CORS for polling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Pass HTTP request into the Express+Socket.IO server
  server.emit('request', req, res);
};
