const express = require('express');
const router = express.Router();
const db = require('../db');
const clinicaService = require('../services/clinicaService');

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

// Listar triagens com filtros
router.get('/', async (req, res) => {
  try {
    const { data, q } = req.query;
    let sql = 'SELECT * FROM triagens WHERE excluido = FALSE';
    const params = [];

    if (q) {
      const termo = `%${q.trim()}%`;
      sql += ' AND (LOWER(nome_paciente) LIKE LOWER(?) OR LOWER(codigo_acesso) = LOWER(?))';
      params.push(termo, q.trim());
    } else if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const ini = new Date(`${data}T00:00:00`).getTime();
      const fim = new Date(`${data}T23:59:59.999`).getTime();
      sql += ' AND ts >= ? AND ts <= ?';
      params.push(ini, fim);
    }

    sql += ' ORDER BY ts DESC LIMIT 300';
    const rows = await db.query(sql, params);

    const resultado = rows.map((r) => ({
      id: String(r.id),
      codigo: r.codigo_acesso,
      presenca_id: r.presenca_id || null,
      ts: Number(r.ts),
      data_hora: r.data_hora,
      n: r.nome_paciente,
      dn: r.data_nascimento ? String(r.data_nascimento).slice(0, 10) : '',
      sx: r.sexo || '',
      emp: r.empresa || '',
      tipo: r.tipo_exame || '',
      pas: Number(r.pa_sistolica),
      pad: Number(r.pa_diastolica),
      fc: Number(r.freq_cardiaca),
      kg: Number(r.peso_kg),
      cm: Number(r.altura_cm),
      imc: Number(r.imc),
      classPA: r.codigo_classificacao_pa,
      classIMC: r.codigo_classificacao_imc,
      classFC: r.codigo_classificacao_fc,
      labelPA: r.classificacao_pa,
      labelIMC: r.classificacao_imc,
      labelFC: r.classificacao_fc,
      alerta_grave: Boolean(r.alerta_pa_grave),
      obs: r.observacoes || '',
      enf: r.nome_profissional || '',
      token: r.token_qrcode || '',
      status: r.status,
      ed: Number(r.editado_em || 0),
    }));

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao listar triagens:', error);
    res.status(500).json({ error: 'Erro ao listar atendimentos.' });
  }
});

// Buscar triagem por código de acesso (QR Code e busca direta)
router.get('/codigo/:codigo', async (req, res) => {
  try {
    const codigo = req.params.codigo.trim().toUpperCase();
    const r = await db.get('SELECT * FROM triagens WHERE codigo_acesso = ? AND excluido = FALSE', [codigo]);
    if (!r) {
      return res.status(404).json({ error: 'Triagem não encontrada.' });
    }
    res.json(r);
  } catch (error) {
    console.error('Erro ao buscar triagem:', error);
    res.status(500).json({ error: 'Erro ao buscar triagem.' });
  }
});

// Criar nova triagem (com vínculo automático ou explícito à Lista de Presença)
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};

    const nome = String(body.n || body.nome_paciente || '').trim();
    const dnRaw = String(body.dn || body.data_nascimento_paciente || body.data_nascimento || '').trim();
    const dn = /^\d{4}-\d{2}-\d{2}$/.test(dnRaw) ? dnRaw : null;
    const sx = String(body.sx || body.sexo || '').toUpperCase().trim();
    const emp = String(body.emp || body.empresa || '').trim();
    const tipo = String(body.tipo || body.tipo_exame || '').trim();
    const enf = String(body.enf || body.nome_profissional || '').trim() || 'Enfermagem';
    const obs = String(body.obs || body.observacoes || '').trim();

    let pas = parseInt(body.pas || body.pa_sistolica, 10);
    let pad = parseInt(body.pad || body.pa_diastolica, 10);
    let fc = parseInt(body.fc || body.freq_cardiaca, 10);
    let kg = parseFloat(String(body.kg || body.peso_kg).replace(',', '.'));
    let cm = parseFloat(String(body.cm || body.altura_cm).replace(',', '.'));

    if (pas > 0 && pas < 31) pas *= 10;
    if (pad > 0 && pad < 21) pad *= 10;
    if (cm > 0 && cm <= 3) cm *= 100;

    if (!nome || nome.length < 5 || nome.indexOf(' ') < 0) {
      return res.status(400).json({ error: 'Informe nome e sobrenome completo.' });
    }
    if (!(pas >= 60 && pas <= 300)) return res.status(400).json({ error: 'Pressão sistólica inválida (60-300).' });
    if (!(pad >= 30 && pad <= 200)) return res.status(400).json({ error: 'Pressão diastólica inválida (30-200).' });
    if (pad >= pas) return res.status(400).json({ error: 'A pressão diastólica deve ser menor que a sistólica.' });
    if (!(fc >= 30 && fc <= 250)) return res.status(400).json({ error: 'Frequência cardíaca inválida (30-250).' });
    if (!(kg >= 20 && kg <= 350)) return res.status(400).json({ error: 'Peso inválido (20-350 kg).' });
    if (!(cm >= 100 && cm <= 250)) return res.status(400).json({ error: 'Altura inválida (100-250 cm).' });

    const now = Date.now();
    const isoDate = new Date(now).toISOString();
    const id = db.ensureId(body.isNew ? null : body.id);
    const codigoAcesso = clinicaService.gerarCodigoTriagem();

    const imc = clinicaService.calcIMC(kg, cm);
    const codPA = clinicaService.classPA(pas, pad);
    const codIMC = clinicaService.classIMC(imc);
    const codFC = clinicaService.classFC(fc);
    const alertaGrave = clinicaService.alertaPAGrave(pas, pad);

    const labelPA = clinicaService.PA_TABELA[codPA].l;
    const labelIMC = clinicaService.IMC_TABELA[codIMC].l;
    const labelFC = clinicaService.FC_TABELA[codFC].l;

    await db.ensureEmpresa(emp);

    // Localiza registro de presença (explícito via presenca_id ou automático no mesmo dia pelo nome)
    let presencaId = body.presenca_id || body.presencaId || null;
    if (presencaId && !db.isValidId(presencaId)) {
      presencaId = null;
    }
    if (presencaId) {
      const pRow = await db.get('SELECT id FROM presencas_evento WHERE id = ?', [presencaId]);
      if (!pRow) presencaId = null;
    }
    if (!presencaId) {
      const presRows = await db.query(
        'SELECT id, created_at FROM presencas_evento WHERE LOWER(TRIM(nome)) = LOWER(?) ORDER BY created_at DESC LIMIT 5',
        [nome]
      );
      const matchDia = presRows.find((p) => sameLocalDay(p.created_at, isoDate));
      if (matchDia) presencaId = matchDia.id;
    }

    const cfg = await db.get('SELECT clinica FROM configuracoes WHERE id = ?', ['geral']);
    const clinicaNome = cfg ? cfg.clinica : 'EcoSafety & EcoClinic';

    const tokenQR = clinicaService.gerarTokenFicha(
      {
        id,
        codigo_acesso: codigoAcesso,
        nome_paciente: nome,
        data_nascimento_paciente: dn || '',
        sexo_paciente: sx,
        peso_kg: kg,
        altura_cm: cm,
        pa_sistolica: pas,
        pa_diastolica: pad,
        freq_cardiaca: fc,
        nome_profissional: enf,
        nome_empresa: emp,
        tipo_exame: tipo,
        observacoes: obs,
        data_hora: isoDate,
      },
      clinicaNome
    );

    await db.run(
      `INSERT INTO triagens (
        id, codigo_acesso, presenca_id, ts, data_hora, nome_paciente, data_nascimento, sexo,
        empresa, tipo_exame, pa_sistolica, pa_diastolica, freq_cardiaca,
        peso_kg, altura_cm, imc, classificacao_pa, codigo_classificacao_pa,
        classificacao_imc, codigo_classificacao_imc, classificacao_fc,
        codigo_classificacao_fc, alerta_pa_grave, observacoes, nome_profissional,
        token_qrcode, status, excluido, editado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_medico', ?, 0)`,
      [
        id,
        codigoAcesso,
        presencaId,
        now,
        isoDate,
        nome,
        dn,
        sx || null,
        emp || null,
        tipo || null,
        pas,
        pad,
        fc,
        kg,
        cm,
        imc,
        labelPA,
        codPA,
        labelIMC,
        codIMC,
        labelFC,
        codFC,
        db.bool(alertaGrave),
        obs || null,
        enf,
        tokenQR,
        db.bool(false),
      ]
    );

    // Sincroniza status da Lista de Presença se vinculado
    if (presencaId) {
      await db.run(
        `UPDATE presencas_evento
         SET triagem_id = ?, status_fluxo = 'triagem_concluida', updated_at = ?
         WHERE id = ?`,
        [id, isoDate, presencaId]
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id,
        codigo: codigoAcesso,
        presenca_id: presencaId,
        ts: now,
        data_hora: isoDate,
        n: nome,
        dn: dn || '',
        sx,
        emp,
        tipo,
        pas,
        pad,
        fc,
        kg,
        cm,
        imc,
        classPA: codPA,
        labelPA,
        classIMC: codIMC,
        labelIMC,
        classFC: codFC,
        labelFC,
        alerta_grave: Boolean(alertaGrave),
        obs,
        enf,
        token: tokenQR,
      },
    });
  } catch (error) {
    console.error('Erro ao salvar triagem:', error);
    res.status(500).json({ error: 'Não foi possível salvar o atendimento. Verifique os dados.' });
  }
});

// Atualizar/Corrigir triagem existente
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!db.isValidId(id)) {
      return res.status(404).json({ error: 'Triagem não encontrada para edição.' });
    }
    const body = req.body || {};

    const triagemAtual = await db.get('SELECT * FROM triagens WHERE id = ? AND excluido = FALSE', [id]);
    if (!triagemAtual) {
      return res.status(404).json({ error: 'Triagem não encontrada para edição.' });
    }

    const nome = String(body.n || body.nome_paciente || triagemAtual.nome_paciente).trim();
    const dnRaw = String(
      body.dn !== undefined ? body.dn : (body.data_nascimento !== undefined ? body.data_nascimento : (triagemAtual.data_nascimento || ''))
    ).trim();
    const dn = /^\d{4}-\d{2}-\d{2}$/.test(dnRaw) ? dnRaw : null;
    const sx = String(body.sx !== undefined ? body.sx : (triagemAtual.sexo || '')).toUpperCase().trim();
    const emp = String(body.emp !== undefined ? body.emp : (triagemAtual.empresa || '')).trim();
    const tipo = String(body.tipo !== undefined ? body.tipo : (triagemAtual.tipo_exame || '')).trim();
    const enf = String(body.enf !== undefined ? body.enf : (triagemAtual.nome_profissional || '')).trim() || 'Enfermagem';
    const obs = String(body.obs !== undefined ? body.obs : (triagemAtual.observacoes || '')).trim();

    let pas = parseInt(body.pas || body.pa_sistolica || triagemAtual.pa_sistolica, 10);
    let pad = parseInt(body.pad || body.pa_diastolica || triagemAtual.pa_diastolica, 10);
    let fc = parseInt(body.fc || body.freq_cardiaca || triagemAtual.freq_cardiaca, 10);
    let kg = parseFloat(String(body.kg || body.peso_kg || triagemAtual.peso_kg).replace(',', '.'));
    let cm = parseFloat(String(body.cm || body.altura_cm || triagemAtual.altura_cm).replace(',', '.'));

    const imc = clinicaService.calcIMC(kg, cm);
    const codPA = clinicaService.classPA(pas, pad);
    const codIMC = clinicaService.classIMC(imc);
    const codFC = clinicaService.classFC(fc);
    const alertaGrave = clinicaService.alertaPAGrave(pas, pad);
    const now = Date.now();

    await db.ensureEmpresa(emp);

    await db.run(
      `UPDATE triagens SET
        nome_paciente = ?, data_nascimento = ?, sexo = ?, empresa = ?, tipo_exame = ?,
        pa_sistolica = ?, pa_diastolica = ?, freq_cardiaca = ?, peso_kg = ?, altura_cm = ?,
        imc = ?, classificacao_pa = ?, codigo_classificacao_pa = ?, classificacao_imc = ?,
        codigo_classificacao_imc = ?, classificacao_fc = ?, codigo_classificacao_fc = ?,
        alerta_pa_grave = ?, observacoes = ?, nome_profissional = ?, editado_em = ?
      WHERE id = ?`,
      [
        nome,
        dn,
        sx || null,
        emp || null,
        tipo || null,
        pas,
        pad,
        fc,
        kg,
        cm,
        imc,
        clinicaService.PA_TABELA[codPA].l,
        codPA,
        clinicaService.IMC_TABELA[codIMC].l,
        codIMC,
        clinicaService.FC_TABELA[codFC].l,
        codFC,
        db.bool(alertaGrave),
        obs || null,
        enf,
        now,
        id,
      ]
    );

    res.json({ success: true, message: 'Triagem retificada com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar triagem:', error);
    res.status(500).json({ error: 'Erro ao salvar retificação.' });
  }
});

// Excluir triagem (Soft Delete + desfaz vínculo ativo na presença)
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!db.isValidId(id)) {
      return res.status(404).json({ error: 'Triagem não encontrada.' });
    }
    const now = Date.now();
    await db.run('UPDATE triagens SET excluido = ?, editado_em = ? WHERE id = ?', [db.bool(true), now, id]);
    await db.run(
      `UPDATE presencas_evento SET triagem_id = NULL, status_fluxo = 'registrado', updated_at = ? WHERE triagem_id = ?`,
      [new Date().toISOString(), id]
    );
    res.json({ success: true, message: 'Triagem excluída com sucesso.' });
  } catch (error) {
    console.error('Erro ao excluir triagem:', error);
    res.status(500).json({ error: 'Erro ao excluir atendimento.' });
  }
});

module.exports = router;
