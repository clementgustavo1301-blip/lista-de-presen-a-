const express = require('express');
const router = express.Router();
const db = require('../db');

// Obter configurações atuais (Clínica + Evento)
router.get('/', async (req, res) => {
  try {
    const row = await db.get(
      'SELECT clinica, unidade, url, modo, evento_titulo FROM configuracoes WHERE id = ?',
      ['geral']
    );
    if (!row) {
      return res.json({
        clinica: 'EcoSafety & EcoClinic — Saúde Ocupacional',
        unidade: 'Matriz',
        url: '',
        modo: 'link',
        evento_titulo: 'Lista de Presença — Massoterapia',
      });
    }
    res.json(row);
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ error: 'Erro ao carregar configurações.' });
  }
});

// Atualizar configurações
router.put('/', async (req, res) => {
  try {
    const { clinica, unidade, url, modo, evento_titulo } = req.body;
    const atual = await db.get('SELECT evento_titulo FROM configuracoes WHERE id = ?', ['geral']);

    const clinicaNome = (clinica || 'EcoSafety & EcoClinic — Saúde Ocupacional').slice(0, 80);
    const unidadeNome = (unidade || '').slice(0, 50);
    const urlSistema = (url || '').slice(0, 255);
    const modoQR = modo === 'link' ? 'link' : 'texto';
    const tituloEvento = (evento_titulo || (atual && atual.evento_titulo) || 'Lista de Presença — Massoterapia').slice(0, 120);

    await db.run(
      `INSERT INTO configuracoes (id, clinica, unidade, url, modo, evento_titulo, updated_at)
       VALUES ('geral', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         clinica = excluded.clinica,
         unidade = excluded.unidade,
         url = excluded.url,
         modo = excluded.modo,
         evento_titulo = excluded.evento_titulo,
         updated_at = CURRENT_TIMESTAMP`,
      [clinicaNome, unidadeNome, urlSistema, modoQR, tituloEvento]
    );

    res.json({
      success: true,
      config: {
        clinica: clinicaNome,
        unidade: unidadeNome,
        url: urlSistema,
        modo: modoQR,
        evento_titulo: tituloEvento,
      },
    });
  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

module.exports = router;
