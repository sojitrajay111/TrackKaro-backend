const main = require('../dist/main');

module.exports = async (req, res) => {
  // Strip /api prefix forwarded by Vercel so NestJS controllers receive standard paths
  if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4);
  } else if (req.url === '/api' || req.url === '/api/') {
    req.url = '/';
  }

  const handler = main.default || main;
  return handler(req, res);
};
