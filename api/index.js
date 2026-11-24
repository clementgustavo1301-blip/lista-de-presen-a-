if (!process.env.VERCEL) {
  require('dotenv').config();
}

let app;
let loadError = null;

try {
  app = require('../server/app');
} catch (err) {
  loadError = err;
  console.error('Erro ao carregar server/app:', err);
}

module.exports = (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Falha ao inicializar servidor', detail: loadError.message }));
    return;
  }
  return app(req, res);
};
