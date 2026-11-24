const crypto = require('crypto');

const SAL = 'ecoclinic-triagem-2026';

const PA_TABELA = {
  baixa:  { l: 'Abaixo de 90/60',        c: 'low',     f: '< 90 ou < 60' },
  normal: { l: 'Normal',                 c: 'good',    f: '< 120 e < 80' },
  pre:    { l: 'Pré-hipertensão',        c: 'warn',    f: '120–139 e/ou 80–89' },
  e1:     { l: 'Hipertensão estágio 1',  c: 'serious', f: '140–159 e/ou 90–99' },
  e2:     { l: 'Hipertensão estágio 2',  c: 'crit',    f: '160–179 e/ou 100–109' },
  e3:     { l: 'Hipertensão estágio 3',  c: 'crit2',   f: '≥ 180 e/ou ≥ 110' }
};

const IMC_TABELA = {
  baixo: { l: 'Baixo peso',          c: 'low',     f: '< 18,5' },
  ok:    { l: 'Peso adequado',       c: 'good',    f: '18,5–24,9' },
  sobre: { l: 'Sobrepeso',           c: 'warn',    f: '25–29,9' },
  ob1:   { l: 'Obesidade grau I',    c: 'serious', f: '30–34,9' },
  ob2:   { l: 'Obesidade grau II',   c: 'crit',    f: '35–39,9' },
  ob3:   { l: 'Obesidade grau III',  c: 'crit2',   f: '≥ 40' }
};

const FC_TABELA = {
  baixa: { l: 'Abaixo de 60 bpm', c: 'low',     f: '< 60' },
  ok:    { l: '60 a 100 bpm',     c: 'good',    f: '60–100' },
  alta:  { l: 'Acima de 100 bpm', c: 'serious', f: '> 100' }
};

function calcIMC(kg, cm) {
  if (!kg || !cm || kg <= 0 || cm <= 0) return 0;
  const imc = kg / Math.pow(cm / 100, 2);
  return Math.round(imc * 10) / 10;
}

function classPA(pas, pad) {
  if (pas >= 180 || pad >= 110) return 'e3';
  if (pas >= 160 || pad >= 100) return 'e2';
  if (pas >= 140 || pad >= 90) return 'e1';
  if (pas >= 120 || pad >= 80) return 'pre';
  if (pas < 90 || pad < 60) return 'baixa';
  return 'normal';
}

function classIMC(imc) {
  if (imc < 18.5) return 'baixo';
  if (imc < 25.0) return 'ok';
  if (imc < 30.0) return 'sobre';
  if (imc < 35.0) return 'ob1';
  if (imc < 40.0) return 'ob2';
  return 'ob3';
}

function classFC(fc) {
  if (fc < 60) return 'baixa';
  if (fc <= 100) return 'ok';
  return 'alta';
}

function alertaPAGrave(pas, pad) {
  return pas >= 180 || pad >= 110;
}

function calcularIdade(dataNascimento, dataReferencia = new Date()) {
  if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) return null;
  const [y, m, d] = dataNascimento.split('-').map(Number);
  const ref = new Date(dataReferencia);
  let idade = ref.getFullYear() - y;
  if (ref.getMonth() + 1 < m || (ref.getMonth() + 1 === m && ref.getDate() < d)) {
    idade--;
  }
  return (idade >= 0 && idade < 130) ? idade : null;
}

function gerarCodigoTriagem() {
  return crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function gerarTokenFicha(rec, clinicaNome = 'EcoClinic') {
  const p = [
    1,
    rec.codigo_acesso || rec.id.slice(-5).toUpperCase(),
    rec.nome_paciente || rec.n,
    rec.data_nascimento_paciente || rec.dn || '',
    rec.sexo_paciente || rec.sx || '',
    rec.peso_kg || rec.kg,
    rec.altura_cm || rec.cm,
    rec.pa_sistolica || rec.pas,
    rec.pa_diastolica || rec.pad,
    rec.freq_cardiaca || rec.fc,
    Math.floor((rec.data_hora ? new Date(rec.data_hora).getTime() : rec.ts || Date.now()) / 60000),
    rec.nome_profissional || rec.enf || '',
    clinicaNome,
    rec.nome_empresa || rec.emp || '',
    rec.tipo_exame || rec.tipo || '',
    (rec.observacoes || rec.obs || '').slice(0, 120)
  ];
  const jsonStr = JSON.stringify(p);
  const b64 = Buffer.from(jsonStr).toString('base64url');
  return `f.${b64}.${fnv(b64 + SAL)}`;
}

module.exports = {
  PA_TABELA,
  IMC_TABELA,
  FC_TABELA,
  calcIMC,
  classPA,
  classIMC,
  classFC,
  alertaPAGrave,
  calcularIdade,
  gerarCodigoTriagem,
  gerarTokenFicha
};

