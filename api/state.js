const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(process.cwd(), 'data.json');
const RUNTIME_FILE = process.env.VERCEL
  ? path.join('/tmp', 'ecosafety-data.json')
  : SEED_FILE;

let memoryState = {
  eventTitle: 'Lista de Presença — Massoterapia',
  services: [
    'Massoterapia',
    'Ventosaterapia',
    'Quick Massage',
    'Liberação Miofascial',
    'Auriculoterapia',
    'Alongamento / Relaxamento',
  ],
  records: [],
};

function readStoredState() {
  try {
    if (fs.existsSync(RUNTIME_FILE)) {
      const raw = fs.readFileSync(RUNTIME_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        memoryState = parsed;
        return memoryState;
      }
    }
    if (fs.existsSync(SEED_FILE)) {
      const raw = fs.readFileSync(SEED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        memoryState = parsed;
        return memoryState;
      }
    }
  } catch {
    // Fallback to in-memory state
  }
  return memoryState;
}

function writeStoredState(newState) {
  memoryState = newState;
  try {
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(newState, null, 2), 'utf8');
  } catch {
    // Read-only filesystem fallback stays in memoryState
  }
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const data = readStoredState();
    res.statusCode = 200;
    res.end(JSON.stringify(data));
    return;
  }

  if (req.method === 'POST') {
    if (req.body && typeof req.body === 'object') {
      writeStoredState(req.body);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : JSON.parse(body);
        writeStoredState(parsed);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
};
