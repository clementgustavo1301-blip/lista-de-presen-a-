const express = require('express');
const router = express.Router();
const db = require('../db');
const clinicaService = require('../services/clinicaService');
const { requireAuth } = require('../services/authService');

const FAIXAS_ETARIAS = [
  { min: 0, max: 29, rotulo: 'Até 29 anos' },
  { min: 30, max: 39, rotulo: '30 a 39 anos' },
  { min: 40, max: 49, rotulo: '40 a 49 anos' },
  { min: 50, max: 59, rotulo: '50 a 59 anos' },
  { min: 60, max: 150, rotulo: '60 anos ou mais' },
];

function obterFaixaEtaria(dn, dataRef) {
  const dnStr = dn ? String(dn).slice(0, 10) : '';
  const idade = clinicaService.calcularIdade(dnStr, dataRef);
  if (idade == null) return 'Idade não informada';
  const f = FAIXAS_ETARIAS.find((x) => idade >= x.min && idade <= x.max);
  return f ? f.rotulo : '60 anos ou mais';
}

router.get('/estatisticas', requireAuth, async (req, res) => {
  try {
    const { periodo, de, ate, empresa, tipo, sexo, dimensao = 'emp' } = req.query;

    let sql = 'SELECT * FROM triagens WHERE excluido = FALSE';
    const params = [];

    if (empresa) {
      sql += ' AND empresa = ?';
      params.push(empresa);
    }
    if (tipo) {
      sql += ' AND tipo_exame = ?';
      params.push(tipo);
    }
    if (sexo) {
      sql += ' AND sexo = ?';
      params.push(sexo);
    }

    const agora = Date.now();
    let tsInicio = 0;
    let tsFim = agora;

    if (periodo === '30') tsInicio = agora - 30 * 86400000;
    else if (periodo === '90') tsInicio = agora - 90 * 86400000;
    else if (periodo === '365') tsInicio = agora - 365 * 86400000;
    else if (periodo === 'ano') {
      const d = new Date();
      tsInicio = new Date(d.getFullYear(), 0, 1).getTime();
    } else if (periodo === 'custom') {
      if (de) tsInicio = new Date(`${de}T00:00:00`).getTime();
      if (ate) tsFim = new Date(`${ate}T23:59:59.999`).getTime();
    }

    if (tsInicio > 0) {
      sql += ' AND ts >= ?';
      params.push(tsInicio);
    }
    if (tsFim < agora) {
      sql += ' AND ts <= ?';
      params.push(tsFim);
    }

    sql += ' ORDER BY ts DESC';
    const rows = await db.query(sql, params);

    if (!rows.length) {
      return res.json({
        total_triagens: 0,
        total_pessoas: 0,
        vazio: true,
      });
    }

    const mapaPessoas = new Map();
    for (const r of rows) {
      const dnStr = r.data_nascimento ? String(r.data_nascimento).slice(0, 10) : '';
      const chave = `${r.nome_paciente.toLowerCase().trim()}|${dnStr}`;
      if (!mapaPessoas.has(chave)) {
        mapaPessoas.set(chave, r);
      }
    }
    const pessoas = Array.from(mapaPessoas.values());
    const n = pessoas.length;

    let sPas = 0, sPad = 0, sFc = 0, sImc = 0, sKg = 0, sCm = 0;
    const contPA = { baixa: 0, normal: 0, pre: 0, e1: 0, e2: 0, e3: 0 };
    const contIMC = { baixo: 0, ok: 0, sobre: 0, ob1: 0, ob2: 0, ob3: 0 };
    const contFC = { baixa: 0, ok: 0, alta: 0 };

    for (const p of pessoas) {
      sPas += Number(p.pa_sistolica);
      sPad += Number(p.pa_diastolica);
      sFc += Number(p.freq_cardiaca);
      sImc += Number(p.imc);
      sKg += Number(p.peso_kg);
      sCm += Number(p.altura_cm);

      if (contPA[p.codigo_classificacao_pa] !== undefined) contPA[p.codigo_classificacao_pa]++;
      if (contIMC[p.codigo_classificacao_imc] !== undefined) contIMC[p.codigo_classificacao_imc]++;
      if (contFC[p.codigo_classificacao_fc] !== undefined) contFC[p.codigo_classificacao_fc]++;
    }

    const qtdHip = contPA.e1 + contPA.e2 + contPA.e3;
    const qtdAcimaPeso = contIMC.sobre + contIMC.ob1 + contIMC.ob2 + contIMC.ob3;
    const qtdObesidade = contIMC.ob1 + contIMC.ob2 + contIMC.ob3;
    const qtdFcFora = contFC.baixa + contFC.alta;

    const pc = (val, total) => (total ? Math.round((val / total) * 100) : 0);

    const mapaMeses = new Map();
    const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    for (const r of rows) {
      const d = new Date(Number(r.ts));
      const chaveMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rotulo = `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

      if (!mapaMeses.has(chaveMes)) {
        mapaMeses.set(chaveMes, { chave: chaveMes, rotulo, n: 0, hip: 0, acima: 0 });
      }
      const item = mapaMeses.get(chaveMes);
      item.n++;
      if (Number(r.pa_sistolica) >= 140 || Number(r.pa_diastolica) >= 90) item.hip++;
      if (Number(r.imc) >= 25.0) item.acima++;
    }

    const serieMensal = Array.from(mapaMeses.values())
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .slice(-24);

    const mapaRecortes = new Map();
    for (const p of pessoas) {
      let grupo = 'Não informado';
      if (dimensao === 'emp') grupo = p.empresa || 'Não informada';
      else if (dimensao === 'sx') grupo = p.sexo === 'M' ? 'Masculino' : p.sexo === 'F' ? 'Feminino' : 'Não informado';
      else if (dimensao === 'tipo') grupo = p.tipo_exame || 'Não informado';
      else if (dimensao === 'idade') grupo = obterFaixaEtaria(p.data_nascimento, p.data_hora);

      if (!mapaRecortes.has(grupo)) {
        mapaRecortes.set(grupo, []);
      }
      mapaRecortes.get(grupo).push(p);
    }

    const recortes = Array.from(mapaRecortes.entries()).map(([grupo, lista]) => {
      const qtd = lista.length;
      if (qtd < 5) {
        return {
          grupo,
          total: qtd,
          oculto: true,
          msg_lgpd: 'Menos de 5 pessoas: indicadores ocultos (LGPD)',
        };
      }
      const hip = lista.filter((x) => Number(x.pa_sistolica) >= 140 || Number(x.pa_diastolica) >= 90).length;
      const pre = lista.filter(
        (x) =>
          (Number(x.pa_sistolica) >= 120 && Number(x.pa_sistolica) <= 139) ||
          (Number(x.pa_diastolica) >= 80 && Number(x.pa_diastolica) <= 89)
      ).length;
      const sobre = lista.filter((x) => Number(x.imc) >= 25.0).length;
      const obes = lista.filter((x) => Number(x.imc) >= 30.0).length;
      const fcMedia = Math.round(lista.reduce((acc, cur) => acc + Number(cur.freq_cardiaca), 0) / qtd);

      return {
        grupo,
        total: qtd,
        oculto: false,
        perc_hipertensao: pc(hip, qtd),
        perc_pre_hipertensao: pc(pre, qtd),
        perc_sobrepeso: pc(sobre, qtd),
        perc_obesidade: pc(obes, qtd),
        fc_media: fcMedia,
      };
    });

    if (dimensao === 'idade') {
      recortes.sort((a, b) => {
        const iA = FAIXAS_ETARIAS.findIndex((f) => f.rotulo === a.grupo);
        const iB = FAIXAS_ETARIAS.findIndex((f) => f.rotulo === b.grupo);
        return iA - iB;
      });
    } else {
      recortes.sort((a, b) => b.total - a.total);
    }

    res.json({
      vazio: false,
      total_triagens: rows.length,
      total_pessoas: n,
      medias: {
        pas: Math.round(sPas / n),
        pad: Math.round(sPad / n),
        fc: Math.round(sFc / n),
        imc: (sImc / n).toFixed(1),
        peso: (sKg / n).toFixed(1),
        altura: (sCm / n / 100).toFixed(2),
      },
      indicadores: {
        hipertensao_pct: pc(qtdHip, n),
        pre_hipertensao_pct: pc(contPA.pre, n),
        acima_peso_pct: pc(qtdAcimaPeso, n),
        obesidade_pct: pc(qtdObesidade, n),
        fc_fora_pct: pc(qtdFcFora, n),
      },
      distribuicoes: {
        pa: contPA,
        imc: contIMC,
        fc: contFC,
      },
      serie_mensal: serieMensal,
      recortes: recortes.slice(0, 20),
    });
  } catch (error) {
    console.error('Erro ao gerar estatísticas do painel:', error);
    res.status(500).json({ error: 'Erro ao gerar dados estatísticos.' });
  }
});

module.exports = router;
