require('dotenv').config();
const os = require('os');
const app = require('./server/app');
const db = require('./server/db');

const PORT = parseInt(process.env.PORT, 10) || 3000;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function start() {
  try {
    await db.init();

    app.listen(PORT, '0.0.0.0', () => {
      const localIp = getLocalIp();
      console.log('==============================================================');
      console.log('  ECOSAFETY & ECOCLINIC — PLATAFORMA INTEGRADA INICIADA');
      console.log('==============================================================');
      console.log(`  Portal Central:       http://localhost:${PORT}`);
      console.log(`  Lista de Presença:    http://localhost:${PORT}/presenca/`);
      console.log(`  Triagem Clínica:      http://localhost:${PORT}/triagem/`);
      console.log(`  Rede / Wi-Fi Local:   http://${localIp}:${PORT}`);
      console.log(`  Banco de Dados:       ${db.isPostgres ? 'PostgreSQL / Supabase' : 'SQLite Local (data/triagem.db)'}`);
      console.log('==============================================================');
    });
  } catch (error) {
    console.error('❌ Falha fatal ao iniciar o servidor:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = app;
