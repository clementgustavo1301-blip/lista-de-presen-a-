const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db');
const authRoutes = require('./routes/auth');
const configRoutes = require('./routes/config');
const presencasRoutes = require('./routes/presencas');
const triagensRoutes = require('./routes/triagens');
const painelRoutes = require('./routes/painel');
const exportarRoutes = require('./routes/exportar');
const integracaoRoutes = require('./routes/integracao');

const app = express();

app.use(cors());

// Compatibilidade total com Vercel Serverless (@vercel/node pode pré-parsear req.body) e Express local
const jsonParser = express.json({ limit: '5mb' });
const urlencodedParser = express.urlencoded({ extended: true });

app.use((req, res, next) => {
  // Normaliza URL caso o roteador serverless reescreva query __pathname ou remova /api
  if (req.url && req.url.startsWith('/api?')) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const rewrittenPath = parsedUrl.searchParams.get('__pathname');
    if (rewrittenPath) {
      parsedUrl.searchParams.delete('__pathname');
      const restSearch = parsedUrl.searchParams.toString();
      req.url = rewrittenPath + (restSearch ? '?' + restSearch : '');
    }
  } else if (
    req.url &&
    !req.url.startsWith('/api') &&
    /^\/(presencas|triagens|integracao|painel|exportar|auth|config|state|health)(\/|\?|$)/.test(req.url)
  ) {
    req.url = '/api' + req.url;
  }

  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // segue com string caso não seja JSON
      }
    } else if (Buffer.isBuffer(req.body)) {
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        req.body = {};
      }
    }
    return next();
  }

  jsonParser(req, res, (err) => {
    if (err) return next(err);
    urlencodedParser(req, res, next);
  });
});

// Garante inicialização do banco antes das rotas /api
app.use(async (req, res, next) => {
  try {
    if (req.path.startsWith('/api')) {
      await db.init();
    }
    next();
  } catch (err) {
    console.error('Erro ao inicializar banco na requisição:', err);
    res.status(500).json({ error: 'Erro interno na conexão com o banco de dados.' });
  }
});

// Rotas da API REST Unificada
app.use('/api/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/presencas', presencasRoutes);
app.use('/api/triagens', triagensRoutes);
app.use('/api/painel', painelRoutes);
app.use('/api/exportar', exportarRoutes);
app.use('/api/integracao', integracaoRoutes);

// Rota legada de compatibilidade da Lista de Presença (/api/state)
app.all('/api/state', presencasRoutes.legacyStateHandler);

// Health check unificado
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    sistema: 'EcoSafety & EcoClinic — Plataforma Integrada v2.0.0',
    database: db.mode,
    modulos: ['portal', 'presenca', 'triagem'],
  });
});

// Arquivos estáticos unificados (Portal /, Presença /presenca, Triagem /triagem)
const publicPath = path.join(__dirname, '..', 'public');

app.get('/presenca', (req, res, next) => {
  if (!req.originalUrl.split('?')[0].endsWith('/')) {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, '/presenca/' + qs);
  }
  next();
});

app.get('/triagem', (req, res, next) => {
  if (!req.originalUrl.split('?')[0].endsWith('/')) {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, '/triagem/' + qs);
  }
  next();
});

app.use(express.static(publicPath));

app.use('/presenca', (req, res) => {
  res.sendFile(path.join(publicPath, 'presenca', 'index.html'));
});

app.use('/triagem', (req, res) => {
  res.sendFile(path.join(publicPath, 'triagem', 'index.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

module.exports = app;
