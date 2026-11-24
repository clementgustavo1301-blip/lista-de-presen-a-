const express = require('express');
const router = express.Router();
const db = require('../db');
const clinicaService = require('../services/clinicaService');
const { requireAuth } = require('../services/authService');

function escapeCSV(val) {
  let str = String(val == null ? '' : val);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (/[";\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// GET /api/exportar/csv — Exportação de Triagens (Completa ou Anonimizada LGPD)
router.get('/csv', requireAuth, async (req, res) => {
  try {
    const anon = req.query.anon === 'true' || req.query.anon === '1';

    const rows = await db.query('SELECT * FROM triagens WHERE excluido = FALSE ORDER BY ts ASC');

    const formatarData = (ts) => {
      const d = new Date(Number(ts));
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    };

    const formatarHora = (ts) => {
      const d = new Date(Number(ts));
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const formatarDn = (dn) => {
      const str = dn ? String(dn).slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return `${str.slice(8)}/${str.slice(5, 7)}/${str.slice(0, 4)}`;
      }
      return '';
    };

    const cabecalho = anon
      ? ['codigo', 'data', 'hora', 'idade', 'sexo', 'empresa', 'tipo_exame', 'peso_kg', 'altura_cm', 'imc', 'pa_sistolica', 'pa_diastolica', 'classificacao_pa', 'freq_cardiaca']
      : ['codigo', 'data', 'hora', 'nome', 'nascimento', 'idade', 'sexo', 'empresa', 'tipo_exame', 'peso_kg', 'altura_cm', 'imc', 'pa_sistolica', 'pa_diastolica', 'classificacao_pa', 'freq_cardiaca', 'passou_presenca', 'observacoes', 'profissional'];

    const linhas = rows.map((r) => {
      const dnStr = r.data_nascimento ? String(r.data_nascimento).slice(0, 10) : '';
      const idade = clinicaService.calcularIdade(dnStr, r.data_hora);
      const pesoStr = String(r.peso_kg).replace('.', ',');
      const altStr = String(r.altura_cm).replace('.', ',');
      const imcStr = String(r.imc).replace('.', ',');

      const base = [r.codigo_acesso, formatarData(r.ts), formatarHora(r.ts)];
      const medidas = [
        idade != null ? idade : '',
        r.sexo || '',
        r.empresa || '',
        r.tipo_exame || '',
        pesoStr,
        altStr,
        imcStr,
        r.pa_sistolica,
        r.pa_diastolica,
        r.classificacao_pa,
        r.freq_cardiaca,
      ];

      if (anon) {
        return base.concat(medidas).map(escapeCSV).join(';');
      }
      return base
        .concat(
          [r.nome_paciente, formatarDn(dnStr)],
          medidas,
          [r.presenca_id ? 'Sim' : 'Não', r.observacoes || '', r.nome_profissional || '']
        )
        .map(escapeCSV)
        .join(';');
    });

    const csvContent = '\uFEFF' + cabecalho.join(';') + '\r\n' + linhas.join('\r\n') + '\r\n';
    const dataHoje = new Date().toISOString().slice(0, 10);
    const filename = `triagens-ecosafety-${anon ? 'sem-identificacao-' : ''}${dataHoje}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Erro ao exportar CSV:', error);
    res.status(500).json({ error: 'Erro ao gerar planilha CSV.' });
  }
});

module.exports = router;
