const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');

function sameLocalDay(isoA, isoB) {
  if (!isoA || !isoB) return false;
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function mapPresencaRow(row, triagemMap) {
  const linkedTriagem =
    (row.triagem_id && triagemMap.get(row.triagem_id)) ||
    triagemMap.get(`pres:${row.id}`) ||
    null;

  return {
    id: String(row.id),
    name: row.nome,
    phone: row.celular || '',
    company: row.empresa || '',
    services: db.parseArray(row.servicos),
    notes: row.observacoes || '',
    statusFluxo: linkedTriagem ? 'triagem_concluida' : (row.status_fluxo || 'registrado'),
    triagemId: linkedTriagem ? linkedTriagem.id : (row.triagem_id || null),
    codigoTriagem: linkedTriagem ? linkedTriagem.codigo_acesso : null,
    triagemRealizada: Boolean(linkedTriagem || row.triagem_id),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

async function fetchFullPresencaState() {
  const [cfg, servicosRows, presencasRows, triagensRows] = await Promise.all([
    db.get('SELECT evento_titulo, clinica, unidade FROM configuracoes WHERE id = ?', ['geral']),
    db.query('SELECT nome FROM servicos_evento WHERE ativo = TRUE ORDER BY ordem ASC, created_at ASC'),
    db.query('SELECT * FROM presencas_evento ORDER BY created_at DESC'),
    db.query('SELECT id, codigo_acesso, presenca_id, nome_paciente, data_hora FROM triagens WHERE excluido = FALSE'),
  ]);

  const triagemMap = new Map();
  for (const t of triagensRows) {
    triagemMap.set(String(t.id), t);
    if (t.presenca_id) {
      triagemMap.set(`pres:${t.presenca_id}`, t);
    }
  }

  const services =
    servicosRows.length > 0
      ? servicosRows.map((s) => s.nome)
      : [...db.DEFAULT_SERVICES];

  const records = presencasRows.map((r) => mapPresencaRow(r, triagemMap));

  return {
    eventTitle: (cfg && cfg.evento_titulo) || 'Lista de Presença — Massoterapia',
    clinica: (cfg && cfg.clinica) || 'EcoSafety & EcoClinic',
    services,
    records,
  };
}

// GET /api/presencas — Lista completa de presença + catálogo + vínculos com triagem
router.get('/', async (req, res) => {
  try {
    const state = await fetchFullPresencaState();
    res.json(state);
  } catch (error) {
    console.error('Erro ao listar presenças:', error);
    res.status(500).json({ error: 'Erro ao carregar registros de presença.' });
  }
});

// GET /api/presencas/pendentes-triagem — Participantes da presença que ainda não passaram pela triagem
router.get('/pendentes-triagem', async (req, res) => {
  try {
    const state = await fetchFullPresencaState();
    const pendentes = state.records.filter((r) => !r.triagemRealizada);
    res.json({
      total: pendentes.length,
      items: pendentes.slice(0, 50),
    });
  } catch (error) {
    console.error('Erro ao listar pendentes de triagem:', error);
    res.status(500).json({ error: 'Erro ao consultar fila da presença.' });
  }
});

// PUT /api/presencas/evento — Atualiza título do evento
router.put('/evento', async (req, res) => {
  try {
    const titulo = String(req.body.eventTitle || 'Lista de Presença — Massoterapia').trim().slice(0, 120);
    await db.run(
      `INSERT INTO configuracoes (id, evento_titulo, updated_at)
       VALUES ('geral', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET evento_titulo = excluded.evento_titulo, updated_at = CURRENT_TIMESTAMP`,
      [titulo]
    );
    res.json({ ok: true, eventTitle: titulo });
  } catch (error) {
    console.error('Erro ao atualizar título do evento:', error);
    res.status(500).json({ error: 'Erro ao salvar nome do evento.' });
  }
});

// POST /api/presencas/servicos — Adiciona procedimento ao catálogo
router.post('/servicos', async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim().slice(0, 80);
    if (!nome) return res.status(400).json({ error: 'Informe o nome do procedimento.' });

    const existente = await db.get('SELECT id, nome FROM servicos_evento WHERE LOWER(TRIM(nome)) = LOWER(?)', [nome]);
    if (existente) {
      await db.run('UPDATE servicos_evento SET ativo = ? WHERE id = ?', [db.bool(true), existente.id]);
      return res.json({ ok: true, nome: existente.nome });
    }

    const countRow = await db.get('SELECT COUNT(*) as total FROM servicos_evento');
    const ordem = Number(countRow ? countRow.total : 0) + 1;
    await db.run(
      'INSERT INTO servicos_evento (id, nome, categoria, ativo, ordem) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), nome, 'bem_estar', db.bool(true), ordem]
    );
    res.status(201).json({ ok: true, nome });
  } catch (error) {
    console.error('Erro ao criar serviço:', error);
    res.status(500).json({ error: 'Erro ao adicionar procedimento.' });
  }
});

// DELETE /api/presencas/servicos/:nome — Remove procedimento customizado
router.delete('/servicos/:nome', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome || '').trim();
    await db.run('DELETE FROM servicos_evento WHERE LOWER(TRIM(nome)) = LOWER(?)', [nome]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao remover serviço:', error);
    res.status(500).json({ error: 'Erro ao remover procedimento.' });
  }
});

// GET /api/presencas/:id — Obtém um participante específico (usado na integração com Triagem)
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM presencas_evento WHERE id = ?', [req.params.id]);
    if (!row) {
      return res.status(404).json({ error: 'Participante não encontrado na lista de presença.' });
    }
    let tri = null;
    if (row.triagem_id) {
      tri = await db.get('SELECT id, codigo_acesso FROM triagens WHERE id = ? AND excluido = FALSE', [row.triagem_id]);
    } else {
      tri = await db.get('SELECT id, codigo_acesso FROM triagens WHERE presenca_id = ? AND excluido = FALSE', [row.id]);
    }
    const map = new Map();
    if (tri) map.set(String(tri.id), tri);
    if (tri) map.set(`pres:${row.id}`, tri);

    res.json(mapPresencaRow(row, map));
  } catch (error) {
    console.error('Erro ao buscar presença por ID:', error);
    res.status(500).json({ error: 'Erro ao buscar participante.' });
  }
});

// POST /api/presencas — Registra novo participante na presença (e vincula com triagem se existir)
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || body.nome || '').trim();
    const phone = String(body.phone || body.celular || '').trim();
    const company = String(body.company || body.empresa || '').trim();
    const notes = String(body.notes || body.observacoes || '').trim();
    const services = Array.isArray(body.services || body.servicos) ? (body.services || body.servicos) : [];

    if (!name || !company) {
      return res.status(400).json({ error: 'Nome e empresa são obrigatórios.' });
    }
    if (services.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um procedimento.' });
    }

    const id = db.ensureId(body.id);
    const nowIso = body.createdAt || new Date().toISOString();
    const cfg = await db.get('SELECT evento_titulo FROM configuracoes WHERE id = ?', ['geral']);
    const eventoNome = (cfg && cfg.evento_titulo) || 'Lista de Presença — Massoterapia';

    await db.ensureEmpresa(company);

    // Verifica se já há triagem vinculada ou feita no mesmo dia para o mesmo colaborador
    let triagemId = body.triagemId || body.triagem_id || null;
    let codigoTriagem = null;

    if (triagemId) {
      const t = await db.get('SELECT id, codigo_acesso FROM triagens WHERE id = ? AND excluido = FALSE', [triagemId]);
      if (t) {
        triagemId = t.id;
        codigoTriagem = t.codigo_acesso;
      } else {
        triagemId = null;
      }
    }

    if (!triagemId) {
      const candidatas = await db.query(
        'SELECT id, codigo_acesso, data_hora FROM triagens WHERE LOWER(TRIM(nome_paciente)) = LOWER(?) AND excluido = FALSE ORDER BY ts DESC LIMIT 5',
        [name]
      );
      const doDia = candidatas.find((c) => sameLocalDay(c.data_hora, nowIso));
      if (doDia) {
        triagemId = doDia.id;
        codigoTriagem = doDia.codigo_acesso;
      }
    }

    const statusFluxo = triagemId
      ? 'triagem_concluida'
      : services.some((s) => s.toLowerCase().includes('triagem'))
      ? 'encaminhado_triagem'
      : 'registrado';

    await db.run(
      `INSERT INTO presencas_evento (
        id, nome, celular, empresa, servicos, observacoes, evento_nome, triagem_id, status_fluxo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        phone,
        company,
        db.serializeArray(services),
        notes,
        eventoNome,
        triagemId,
        statusFluxo,
        nowIso,
        nowIso,
      ]
    );

    if (triagemId) {
      await db.run('UPDATE triagens SET presenca_id = ? WHERE id = ?', [id, triagemId]);
    }

    res.status(201).json({
      ok: true,
      record: {
        id,
        name,
        phone,
        company,
        services,
        notes,
        statusFluxo,
        triagemId,
        codigoTriagem,
        triagemRealizada: Boolean(triagemId),
        createdAt: nowIso,
      },
    });
  } catch (error) {
    console.error('Erro ao criar presença:', error);
    res.status(500).json({ error: 'Erro ao registrar presença.' });
  }
});

// PUT /api/presencas/:id — Atualiza registro de presença
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const atual = await db.get('SELECT * FROM presencas_evento WHERE id = ?', [id]);
    if (!atual) {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    const body = req.body || {};
    const name = body.name !== undefined ? String(body.name).trim() : atual.nome;
    const phone = body.phone !== undefined ? String(body.phone).trim() : atual.celular;
    const company = body.company !== undefined ? String(body.company).trim() : atual.empresa;
    const notes = body.notes !== undefined ? String(body.notes).trim() : (atual.observacoes || '');
    const services = body.services !== undefined ? body.services : db.parseArray(atual.servicos);
    const statusFluxo = body.statusFluxo || atual.status_fluxo || 'registrado';
    const updatedAt = new Date().toISOString();

    await db.ensureEmpresa(company);

    await db.run(
      `UPDATE presencas_evento
       SET nome = ?, celular = ?, empresa = ?, servicos = ?, observacoes = ?, status_fluxo = ?, updated_at = ?
       WHERE id = ?`,
      [name, phone, company, db.serializeArray(services), notes, statusFluxo, updatedAt, id]
    );

    res.json({ ok: true, updatedAt });
  } catch (error) {
    console.error('Erro ao atualizar presença:', error);
    res.status(500).json({ error: 'Erro ao salvar alterações.' });
  }
});

// DELETE /api/presencas/:id — Exclui um participante
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.run('UPDATE triagens SET presenca_id = NULL WHERE presenca_id = ?', [id]);
    await db.run('DELETE FROM presencas_evento WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir presença:', error);
    res.status(500).json({ error: 'Erro ao excluir registro.' });
  }
});

// DELETE /api/presencas — Limpa toda a lista de presença (novo evento)
router.delete('/', async (req, res) => {
  try {
    await db.run('UPDATE triagens SET presenca_id = NULL WHERE presenca_id IS NOT NULL');
    await db.run('DELETE FROM presencas_evento');
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao limpar lista de presença:', error);
    res.status(500).json({ error: 'Erro ao limpar registros.' });
  }
});

// Handler compatível com /api/state (sincronização em lote / restauração de backup JSON)
async function legacyStateHandler(req, res) {
  try {
    if (req.method === 'GET') {
      const state = await fetchFullPresencaState();
      return res.json(state);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.eventTitle) {
        const titulo = String(body.eventTitle).trim().slice(0, 120);
        await db.run(
          `INSERT INTO configuracoes (id, evento_titulo, updated_at)
           VALUES ('geral', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET evento_titulo = excluded.evento_titulo, updated_at = CURRENT_TIMESTAMP`,
          [titulo]
        );
      }

      if (Array.isArray(body.services) && body.services.length > 0) {
        for (let i = 0; i < body.services.length; i++) {
          const srv = String(body.services[i] || '').trim();
          if (!srv) continue;
          const ex = await db.get('SELECT id FROM servicos_evento WHERE LOWER(TRIM(nome)) = LOWER(?)', [srv]);
          if (!ex) {
            await db.run(
              'INSERT INTO servicos_evento (id, nome, categoria, ativo, ordem) VALUES (?, ?, ?, ?, ?)',
              [crypto.randomUUID(), srv, 'bem_estar', db.bool(true), i + 1]
            );
          }
        }
      }

      if (Array.isArray(body.records)) {
        if (body.replaceAll === true) {
          await db.run('UPDATE triagens SET presenca_id = NULL WHERE presenca_id IS NOT NULL');
          await db.run('DELETE FROM presencas_evento');
        }

        const eventoTitulo = String(body.eventTitle || 'Lista de Presença — Massoterapia').trim();
        for (const r of body.records) {
          if (!r || !r.name) continue;
          const id = db.ensureId(r.id);
          const existing = await db.get('SELECT id FROM presencas_evento WHERE id = ?', [id]);
          const createdAt = r.createdAt || new Date().toISOString();
          const updatedAt = r.updatedAt || createdAt;
          const srvs = Array.isArray(r.services) ? r.services : [];

          if (existing) {
            await db.run(
              `UPDATE presencas_evento
               SET nome = ?, celular = ?, empresa = ?, servicos = ?, observacoes = ?, updated_at = ?
               WHERE id = ?`,
              [
                String(r.name).trim(),
                String(r.phone || '').trim(),
                String(r.company || 'EcoSafety').trim(),
                db.serializeArray(srvs),
                String(r.notes || '').trim(),
                updatedAt,
                id,
              ]
            );
          } else {
            await db.run(
              `INSERT INTO presencas_evento (
                id, nome, celular, empresa, servicos, observacoes, evento_nome, status_fluxo, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'registrado', ?, ?)`,
              [
                id,
                String(r.name).trim(),
                String(r.phone || '').trim(),
                String(r.company || 'EcoSafety').trim(),
                db.serializeArray(srvs),
                String(r.notes || '').trim(),
                eventoTitulo,
                createdAt,
                updatedAt,
              ]
            );
          }
        }
      }

      const updatedState = await fetchFullPresencaState();
      return res.json({ ok: true, state: updatedState });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Erro em /api/state:', error);
    res.status(500).json({ error: 'Erro ao sincronizar estado.' });
  }
}

module.exports = router;
module.exports.legacyStateHandler = legacyStateHandler;
module.exports.fetchFullPresencaState = fetchFullPresencaState;
