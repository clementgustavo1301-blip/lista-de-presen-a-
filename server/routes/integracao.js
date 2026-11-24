const express = require('express');
const router = express.Router();
const db = require('../db');
const { fetchFullPresencaState } = require('./presencas');

// GET /api/integracao/resumo — Indicadores agregados ao vivo (Portal e barras de navegação, sem dados sensíveis LGPD)
router.get('/resumo', async (req, res) => {
  try {
    const now = new Date();
    const inicioHoje = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();

    const [presState, triagensRows, cfg] = await Promise.all([
      fetchFullPresencaState(),
      db.query('SELECT id, codigo_acesso, presenca_id, ts, data_hora, nome_paciente, empresa FROM triagens WHERE excluido = FALSE ORDER BY ts DESC'),
      db.get('SELECT clinica, unidade, evento_titulo FROM configuracoes WHERE id = ?', ['geral']),
    ]);

    const records = presState.records || [];
    let totalProcedimentos = 0;
    const empresasSet = new Set();

    for (const r of records) {
      totalProcedimentos += Array.isArray(r.services) ? r.services.length : 0;
      if (r.company) empresasSet.add(r.company.trim().toLowerCase());
    }
    for (const t of triagensRows) {
      if (t.empresa) empresasSet.add(String(t.empresa).trim().toLowerCase());
    }

    const comTriagem = records.filter((r) => r.triagemRealizada).length;
    const aguardandoTriagem = records.length - comTriagem;
    const triagensHoje = triagensRows.filter((t) => Number(t.ts) >= inicioHoje).length;

    // Jornada operacional recente (apenas status de fluxo, sem sinais vitais para respeitar a LGPD)
    const presIdsUsados = new Set();
    const jornada = [];

    for (const r of records.slice(0, 15)) {
      presIdsUsados.add(r.id);
      jornada.push({
        presencaId: r.id,
        triagemId: r.triagemId || null,
        codigoTriagem: r.codigoTriagem || null,
        nome: r.name,
        empresa: r.company || 'Não informada',
        servicos: r.services || [],
        passouPresenca: true,
        passouTriagem: Boolean(r.triagemRealizada),
        horario: r.createdAt,
      });
    }

    for (const t of triagensRows.slice(0, 10)) {
      if (t.presenca_id && presIdsUsados.has(String(t.presenca_id))) continue;
      const jaListado = jornada.some((j) => j.triagemId && String(j.triagemId) === String(t.id));
      if (jaListado) continue;

      jornada.push({
        presencaId: t.presenca_id || null,
        triagemId: String(t.id),
        codigoTriagem: t.codigo_acesso,
        nome: t.nome_paciente,
        empresa: t.empresa || 'Não informada',
        servicos: [],
        passouPresenca: Boolean(t.presenca_id),
        passouTriagem: true,
        horario: new Date(Number(t.ts) || t.data_hora).toISOString(),
      });
    }

    jornada.sort((a, b) => new Date(b.horario) - new Date(a.horario));

    res.json({
      clinica: (cfg && cfg.clinica) || 'EcoSafety & EcoClinic — Saúde Ocupacional',
      unidade: (cfg && cfg.unidade) || 'Matriz',
      eventoTitulo: presState.eventTitle,
      presenca: {
        totalParticipantes: records.length,
        totalProcedimentos,
        comTriagem,
        aguardandoTriagem,
      },
      triagem: {
        totalTriagens: triagensRows.length,
        triagensHoje,
      },
      totalEmpresasAtendidas: empresasSet.size,
      jornadaRecente: jornada.slice(0, 12),
    });
  } catch (error) {
    console.error('Erro em /api/integracao/resumo:', error);
    res.status(500).json({ error: 'Erro ao carregar resumo integrado.' });
  }
});

// GET /api/integracao/empresas — Catálogo compartilhado de empresas entre Presença e Triagem
router.get('/empresas', async (req, res) => {
  try {
    const [cadEmp, presEmp, triEmp] = await Promise.all([
      db.query('SELECT COALESCE(nome_fantasia, razao_social) AS nome FROM empresas WHERE ativo = TRUE'),
      db.query('SELECT DISTINCT empresa AS nome FROM presencas_evento WHERE empresa IS NOT NULL'),
      db.query('SELECT DISTINCT empresa AS nome FROM triagens WHERE excluido = FALSE AND empresa IS NOT NULL'),
    ]);

    const map = new Map();
    for (const row of [...cadEmp, ...presEmp, ...triEmp]) {
      const n = String(row.nome || '').trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (!map.has(key)) map.set(key, n);
    }

    const empresas = Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    res.json({ empresas });
  } catch (error) {
    console.error('Erro em /api/integracao/empresas:', error);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// POST /api/integracao/vincular — Vincula explicitamente uma triagem a um registro de presença
router.post('/vincular', async (req, res) => {
  try {
    const { presencaId, triagemId } = req.body || {};
    if (!presencaId || !triagemId) {
      return res.status(400).json({ error: 'Informe presencaId e triagemId.' });
    }

    await db.run(
      `UPDATE presencas_evento SET triagem_id = ?, status_fluxo = 'triagem_concluida', updated_at = ? WHERE id = ?`,
      [triagemId, new Date().toISOString(), presencaId]
    );
    await db.run('UPDATE triagens SET presenca_id = ? WHERE id = ?', [presencaId, triagemId]);

    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao vincular registros:', error);
    res.status(500).json({ error: 'Erro ao vincular presença e triagem.' });
  }
});

module.exports = router;
