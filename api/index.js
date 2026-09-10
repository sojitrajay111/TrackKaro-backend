const main = require('../dist/main');

module.exports = async (req, res) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && matchedPath !== '/api') {
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex !== -1 ? req.url.slice(queryIndex) : '';
    req.url = matchedPath + query;
  } else if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4);
  }

  const handler = main.default || main;
  return handler(req, res);
};
