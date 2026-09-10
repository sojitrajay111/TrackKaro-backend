const main = require('../dist/main');

module.exports = async (req, res) => {
  const handler = main.default || main;
  return handler(req, res);
};
