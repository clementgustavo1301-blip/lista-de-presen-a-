const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jsStore = require('./jsStore');

let mode = 'uninitialized'; // 'postgres' | 'sqlite' | 'memory'
let pgPool = null;
let sqliteDb = null;
let memData = null;
let initPromise = null;

const ROOT_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SQLITE_FILE = path.join(DATA_DIR, 'triagem.db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_SERVICES = [
  'Massoterapia',
  'Ventosaterapia',
  'Quick Massage',
  'Liberação Miofascial',
  'Auriculoterapia',
  'Alongamento / Relaxamento',
  'Triagem de Enfermagem',
];

async function init() {
  if (initPromise) return initPromise;
  initPromise = doInit();
  return initPromise;
}

async function doInit() {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  // 1. PostgreSQL / Supabase (Produção na Vercel ou local com DATABASE_URL)
  if (dbUrl && dbUrl.startsWith('postgres')) {
    mode = 'postgres';
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl:
        process.env.NODE_ENV === 'production' ||
        process.env.VERCEL ||
        dbUrl.includes('supabase')
          ? { rejectUnauthorized: false }
          : false,
    });
    console.log('✅ [Database] Conectado ao PostgreSQL / Supabase.');
    return;
  }

  // 2. Em ambiente Vercel Serverless sem DATABASE_URL (ou Node < 22.5 sem node:sqlite),
  // usa motor JS puro em /tmp + memória (zero dependência de binários/módulos experimentais)
  if (process.env.VERCEL) {
    mode = 'memory';
    memData = jsStore.loadStore(DEFAULT_SERVICES);
    console.log('✅ [Database] Modo Serverless (/tmp JSON) inicializado.');
    return;
  }

  // 3. Ambiente Local: Tenta SQLite nativo (Node 22.5+), com fallback automático para jsStore
  try {
    const sqliteModuleName = 'node:' + 'sqlite';
    const { DatabaseSync } = require(sqliteModuleName);
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    sqliteDb = new DatabaseSync(SQLITE_FILE);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    initSqliteSchema();
    mode = 'sqlite';
    console.log(`✅ [Database] SQLite unificado inicializado em: ${SQLITE_FILE}`);
  } catch (err) {
    mode = 'memory';
    memData = jsStore.loadStore(DEFAULT_SERVICES);
    console.log('✅ [Database] Fallback JS inicializado (node:sqlite indisponível nesta versão do Node).');
  }
}

function hasSqliteColumn(tableName, columnName) {
  const cols = sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

function initSqliteSchema() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS configuracoes (
      id TEXT PRIMARY KEY DEFAULT 'geral',
      clinica TEXT NOT NULL DEFAULT 'EcoSafety & EcoClinic — Saúde Ocupacional',
      unidade TEXT DEFAULT 'Matriz',
      url TEXT DEFAULT '',
      modo TEXT DEFAULT 'texto',
      evento_titulo TEXT DEFAULT 'Lista de Presença — Massoterapia',
      ativo INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      cargo TEXT NOT NULL DEFAULT 'enfermeiro',
      registro_conselho TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

    CREATE TABLE IF NOT EXISTS empresas (
      id TEXT PRIMARY KEY,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profissionais (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      registro TEXT,
      cargo TEXT DEFAULT 'enfermeiro',
      ativo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS servicos_evento (
      id TEXT PRIMARY KEY,
      nome TEXT UNIQUE NOT NULL,
      categoria TEXT DEFAULT 'bem_estar',
      ativo INTEGER DEFAULT 1,
      ordem INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS presencas_evento (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      celular TEXT NOT NULL DEFAULT '',
      empresa TEXT NOT NULL,
      servicos TEXT NOT NULL DEFAULT '[]',
      observacoes TEXT DEFAULT '',
      evento_nome TEXT DEFAULT 'Lista de Presença — Massoterapia',
      triagem_id TEXT,
      status_fluxo TEXT DEFAULT 'registrado',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_presencas_created ON presencas_evento(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_presencas_empresa ON presencas_evento(empresa);
    CREATE INDEX IF NOT EXISTS idx_presencas_triagem ON presencas_evento(triagem_id);

    CREATE TABLE IF NOT EXISTS triagens (
      id TEXT PRIMARY KEY,
      codigo_acesso TEXT UNIQUE NOT NULL,
      presenca_id TEXT,
      ts INTEGER NOT NULL,
      data_hora TEXT NOT NULL,
      nome_paciente TEXT NOT NULL,
      data_nascimento TEXT,
      sexo TEXT,
      empresa TEXT,
      tipo_exame TEXT,
      pa_sistolica INTEGER NOT NULL,
      pa_diastolica INTEGER NOT NULL,
      freq_cardiaca INTEGER NOT NULL,
      peso_kg REAL NOT NULL,
      altura_cm REAL NOT NULL,
      imc REAL NOT NULL,
      classificacao_pa TEXT NOT NULL,
      codigo_classificacao_pa TEXT NOT NULL,
      classificacao_imc TEXT NOT NULL,
      codigo_classificacao_imc TEXT NOT NULL,
      classificacao_fc TEXT NOT NULL,
      codigo_classificacao_fc TEXT NOT NULL,
      alerta_pa_grave INTEGER DEFAULT 0,
      observacoes TEXT,
      nome_profissional TEXT NOT NULL,
      token_qrcode TEXT,
      status TEXT DEFAULT 'aguardando_medico',
      excluido INTEGER DEFAULT 0,
      editado_em INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_triagens_ts ON triagens(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_triagens_codigo ON triagens(codigo_acesso);
    CREATE INDEX IF NOT EXISTS idx_triagens_paciente ON triagens(nome_paciente);
    CREATE INDEX IF NOT EXISTS idx_triagens_ativas ON triagens(ts DESC) WHERE excluido = 0;
  `);

  if (!hasSqliteColumn('configuracoes', 'evento_titulo')) {
    sqliteDb.exec(`ALTER TABLE configuracoes ADD COLUMN evento_titulo TEXT DEFAULT 'Lista de Presença — Massoterapia';`);
  }
  if (!hasSqliteColumn('configuracoes', 'ativo')) {
    sqliteDb.exec(`ALTER TABLE configuracoes ADD COLUMN ativo INTEGER DEFAULT 1;`);
  }
  if (!hasSqliteColumn('triagens', 'presenca_id')) {
    sqliteDb.exec(`ALTER TABLE triagens ADD COLUMN presenca_id TEXT;`);
  }
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_triagens_presenca ON triagens(presenca_id);`);

  const cfg = sqliteDb.prepare('SELECT id, evento_titulo FROM configuracoes WHERE id = ?').get('geral');
  const seedEventTitle = 'Lista de Presença — Massoterapia';

  if (!cfg) {
    sqliteDb.prepare(`
      INSERT INTO configuracoes (id, clinica, unidade, url, modo, evento_titulo, ativo)
      VALUES ('geral', 'EcoSafety & EcoClinic — Saúde Ocupacional', 'Matriz', '', 'link', ?, 1)
    `).run(seedEventTitle);
  } else if (!cfg.evento_titulo) {
    sqliteDb.prepare(`UPDATE configuracoes SET evento_titulo = ? WHERE id = 'geral'`).run(seedEventTitle);
  }

  const srvCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM servicos_evento').get();
  if (srvCount.count === 0) {
    const insertSrv = sqliteDb.prepare(`
      INSERT OR IGNORE INTO servicos_evento (id, nome, categoria, ativo, ordem)
      VALUES (?, ?, ?, 1, ?)
    `);
    DEFAULT_SERVICES.forEach((srv, idx) => {
      const cat = srv.toLowerCase().includes('triagem') ? 'triagem' : 'bem_estar';
      insertSrv.run(crypto.randomUUID(), srv, cat, idx + 1);
    });
  }

  const empCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM empresas').get();
  if (empCount.count === 0) {
    const insertEmp = sqliteDb.prepare('INSERT INTO empresas (id, razao_social, nome_fantasia) VALUES (?, ?, ?)');
    insertEmp.run(crypto.randomUUID(), 'EcoSafety Saúde e Segurança do Trabalho Ltda', 'EcoSafety');
  }
}

function toPgSql(sql) {
  let idx = 1;
  return sql.replace(/\?/g, () => `$${idx++}`);
}

async function query(sql, params = []) {
  await init();
  if (mode === 'postgres') {
    const res = await pgPool.query(toPgSql(sql), params);
    return res.rows;
  }
  if (mode === 'memory') {
    return jsStore.executeQuery(memData, sql, params);
  }
  const stmt = sqliteDb.prepare(sql);
  return stmt.all(...params);
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  await init();
  if (mode === 'postgres') {
    const res = await pgPool.query(toPgSql(sql), params);
    return { changes: res.rowCount };
  }
  if (mode === 'memory') {
    return jsStore.executeRun(memData, sql, params);
  }
  const stmt = sqliteDb.prepare(sql);
  return stmt.run(...params);
}

function bool(val) {
  return mode === 'sqlite' ? (val ? 1 : 0) : Boolean(val);
}

function serializeArray(arr) {
  const safe = Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
  return mode === 'sqlite' ? JSON.stringify(safe) : safe;
}

function parseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function ensureId(rawId) {
  const str = String(rawId || '').trim();
  if (!str) return crypto.randomUUID();
  if (mode === 'postgres' && !UUID_RE.test(str)) {
    return crypto.randomUUID();
  }
  return str;
}

function isValidId(rawId) {
  const str = String(rawId || '').trim();
  if (!str) return false;
  if (mode === 'postgres') return UUID_RE.test(str);
  return true;
}

async function ensureEmpresa(nomeEmpresa) {
  const limpo = String(nomeEmpresa || '').trim();
  if (!limpo) return;
  try {
    const existente = await get(
      'SELECT id FROM empresas WHERE LOWER(TRIM(COALESCE(nome_fantasia, razao_social))) = LOWER(?) OR LOWER(TRIM(razao_social)) = LOWER(?) LIMIT 1',
      [limpo, limpo]
    );
    if (!existente) {
      await run(
        'INSERT INTO empresas (id, razao_social, nome_fantasia, ativo) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), limpo, limpo, bool(true)]
      );
    }
  } catch {
    // tolerante a concorrência
  }
}

module.exports = {
  init,
  query,
  get,
  run,
  bool,
  serializeArray,
  parseArray,
  ensureId,
  isValidId,
  ensureEmpresa,
  DEFAULT_SERVICES,
  get isPostgres() {
    return mode === 'postgres';
  },
  get mode() {
    return mode;
  },
};
