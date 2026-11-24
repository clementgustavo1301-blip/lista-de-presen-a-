const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_FILE = path.join('/tmp', 'ecosafety-unified-store.json');

let memoryStore = null;

function createInitialStore(defaultServices) {
  const authService = require('../services/authService');
  const clinicaService = require('../services/clinicaService');
  const now = Date.now();

  const usuarios = [
    {
      id: 'u1',
      nome: 'Dra. Patrícia Mendes',
      email: 'admin@ecoclinic.com.br',
      senha_hash: authService.hashSenha('admin123'),
      cargo: 'administrador',
      registro_conselho: 'CRM-RN 4.321',
      ativo: true,
      created_at: new Date(now).toISOString(),
    },
    {
      id: 'u2',
      nome: 'Enf. Maria Eduarda Silveira',
      email: 'enfermeiro@ecoclinic.com.br',
      senha_hash: authService.hashSenha('enf123'),
      cargo: 'enfermeiro',
      registro_conselho: 'COREN-RN 102.345',
      ativo: true,
      created_at: new Date(now).toISOString(),
    },
    {
      id: 'u3',
      nome: 'Dr. Roberto Albuquerque',
      email: 'medico@ecoclinic.com.br',
      senha_hash: authService.hashSenha('medico123'),
      cargo: 'medico_trabalho',
      registro_conselho: 'CRM-RN 5.432',
      ativo: true,
      created_at: new Date(now).toISOString(),
    },
  ];

  const empresas = [
    { id: 'emp0', razao_social: 'EcoSafety Saúde e Segurança do Trabalho Ltda', nome_fantasia: 'EcoSafety', ativo: true },
    { id: 'emp1', razao_social: 'Salineira do Litoral Ltda', nome_fantasia: 'Salineira Exemplo', ativo: true },
    { id: 'emp2', razao_social: 'Construtora e Obras Nordeste S/A', nome_fantasia: 'Construtora Exemplo', ativo: true },
    { id: 'emp3', razao_social: 'Distribuidora e Revenda de GLP Potiguar', nome_fantasia: 'Revenda de GLP Exemplo', ativo: true },
    { id: 'emp4', razao_social: 'Indústria Têxtil de Mossoró Ltda', nome_fantasia: 'Indústria Exemplo', ativo: true },
    { id: 'emp5', razao_social: 'Prestadora de Serviços e Logística Eireli', nome_fantasia: 'Prestadora de Serviços Exemplo', ativo: true },
  ];

  const servicos_evento = defaultServices.map((nome, idx) => ({
    id: `srv_${idx + 1}`,
    nome,
    categoria: nome.toLowerCase().includes('triagem') ? 'triagem' : 'bem_estar',
    ativo: true,
    ordem: idx + 1,
    created_at: new Date(now).toISOString(),
  }));

  const demoSpecs = [
    { cod: 'EX001', minAtras: 15, n: 'Carlos Eduardo da Silva', dn: '1985-04-12', sx: 'M', emp: 'Salineira Exemplo', tipo: 'Periódico', pas: 120, pad: 80, fc: 72, kg: 78.5, cm: 175.0, obs: 'Paciente assintomático. Sem queixas no momento.', enf: 'Enf. Maria Eduarda Silveira' },
    { cod: 'EX002', minAtras: 42, n: 'Ana Paula de Souza', dn: '1992-09-24', sx: 'F', emp: 'Salineira Exemplo', tipo: 'Admissional', pas: 110, pad: 70, fc: 68, kg: 62.0, cm: 164.0, obs: 'Triagem admissional sem particularidades.', enf: 'Enf. Maria Eduarda Silveira' },
    { cod: 'EX003', minAtras: 80, n: 'Francisco Valdemir Oliveira', dn: '1974-11-03', sx: 'M', emp: 'Construtora Exemplo', tipo: 'Periódico', pas: 148, pad: 94, fc: 84, kg: 89.2, cm: 170.0, obs: 'PA alterada na 1ª medida. Repousou 10 minutos.', enf: 'Enf. Maria Eduarda Silveira' },
    { cod: 'EX004', minAtras: 115, n: 'Mariana Beatriz Fernandes', dn: '2001-02-18', sx: 'F', emp: 'Revenda de GLP Exemplo', tipo: 'Admissional', pas: 118, pad: 76, fc: 75, kg: 54.0, cm: 158.0, obs: '', enf: 'Enf. Maria Eduarda Silveira' },
    { cod: 'EX005', minAtras: 140, n: 'Antônio José dos Santos', dn: '1968-07-30', sx: 'M', emp: 'Indústria Exemplo', tipo: 'Retorno ao trabalho', pas: 182, pad: 112, fc: 92, kg: 96.0, cm: 168.0, obs: 'Pressão muito elevada. Comunicado ao médico examinador.', enf: 'Enf. Maria Eduarda Silveira' },
  ];

  const triagens = demoSpecs.map((d) => {
    const id = crypto.randomUUID();
    const ts = now - d.minAtras * 60000;
    const iso = new Date(ts).toISOString();
    const imc = clinicaService.calcIMC(d.kg, d.cm);
    const codPA = clinicaService.classPA(d.pas, d.pad);
    const codIMC = clinicaService.classIMC(imc);
    const codFC = clinicaService.classFC(d.fc);
    const alerta = clinicaService.alertaPAGrave(d.pas, d.pad);
    const token = clinicaService.gerarTokenFicha(
      {
        id, codigo_acesso: d.cod, nome_paciente: d.n, data_nascimento_paciente: d.dn,
        sexo_paciente: d.sx, peso_kg: d.kg, altura_cm: d.cm, pa_sistolica: d.pas, pa_diastolica: d.pad,
        freq_cardiaca: d.fc, nome_profissional: d.enf, nome_empresa: d.emp, tipo_exame: d.tipo,
        observacoes: d.obs, data_hora: iso,
      },
      'EcoSafety & EcoClinic'
    );

    return {
      id,
      codigo_acesso: d.cod,
      presenca_id: null,
      ts,
      data_hora: iso,
      nome_paciente: d.n,
      data_nascimento: d.dn,
      sexo: d.sx,
      empresa: d.emp,
      tipo_exame: d.tipo,
      pa_sistolica: d.pas,
      pa_diastolica: d.pad,
      freq_cardiaca: d.fc,
      peso_kg: d.kg,
      altura_cm: d.cm,
      imc,
      classificacao_pa: clinicaService.PA_TABELA[codPA].l,
      codigo_classificacao_pa: codPA,
      classificacao_imc: clinicaService.IMC_TABELA[codIMC].l,
      codigo_classificacao_imc: codIMC,
      classificacao_fc: clinicaService.FC_TABELA[codFC].l,
      codigo_classificacao_fc: codFC,
      alerta_pa_grave: alerta,
      observacoes: d.obs,
      nome_profissional: d.enf,
      token_qrcode: token,
      status: 'aguardando_medico',
      excluido: false,
      editado_em: 0,
      created_at: iso,
    };
  });

  return {
    configuracoes: {
      id: 'geral',
      clinica: 'EcoSafety & EcoClinic — Saúde Ocupacional',
      unidade: 'Matriz',
      url: '',
      modo: 'link',
      evento_titulo: 'Lista de Presença — Massoterapia',
      ativo: true,
      updated_at: new Date(now).toISOString(),
    },
    usuarios,
    empresas,
    servicos_evento,
    presencas_evento: [],
    triagens,
  };
}

function loadStore(defaultServices) {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.triagens)) {
        memoryStore = parsed;
        return memoryStore;
      }
    }
  } catch {
    // continua com estado inicial em memória
  }
  memoryStore = createInitialStore(defaultServices);
  saveStore();
  return memoryStore;
}

function saveStore() {
  if (!memoryStore) return;
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryStore), 'utf8');
  } catch {
    // tolerante a filesystem somente-leitura
  }
}

function normSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function executeQuery(store, sql, params = []) {
  const s = normSql(sql);

  // configuracoes
  if (s.includes('from configuracoes')) {
    return [store.configuracoes];
  }

  // usuarios
  if (s.includes('from usuarios')) {
    if (s.includes('lower(email) = ?')) {
      const email = String(params[0] || '').toLowerCase().trim();
      return store.usuarios.filter((u) => u.email.toLowerCase() === email && Boolean(u.ativo));
    }
    if (s.includes('where id = ?')) {
      return store.usuarios.filter((u) => String(u.id) === String(params[0]));
    }
    return [...store.usuarios].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // empresas
  if (s.includes('from empresas')) {
    if (s.includes('lower(trim(coalesce(nome_fantasia, razao_social))) = lower(?)')) {
      const target = String(params[0] || '').toLowerCase().trim();
      return store.empresas.filter(
        (e) =>
          String(e.nome_fantasia || e.razao_social || '').toLowerCase().trim() === target ||
          String(e.razao_social || '').toLowerCase().trim() === target
      );
    }
    return store.empresas
      .filter((e) => Boolean(e.ativo))
      .map((e) => ({ nome: e.nome_fantasia || e.razao_social }));
  }

  // servicos_evento
  if (s.includes('from servicos_evento')) {
    if (s.includes('count(*)')) {
      return [{ total: store.servicos_evento.length }];
    }
    if (s.includes('lower(trim(nome)) = lower(?)')) {
      const nome = String(params[0] || '').toLowerCase().trim();
      return store.servicos_evento.filter((srv) => srv.nome.toLowerCase().trim() === nome);
    }
    return store.servicos_evento
      .filter((srv) => Boolean(srv.ativo))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }

  // presencas_evento
  if (s.includes('from presencas_evento')) {
    if (s.includes('select distinct empresa as nome')) {
      const uniq = Array.from(new Set(store.presencas_evento.map((p) => p.empresa).filter(Boolean)));
      return uniq.map((nome) => ({ nome }));
    }
    if (s.includes('where id = ?')) {
      return store.presencas_evento.filter((p) => String(p.id) === String(params[0]));
    }
    if (s.includes('lower(trim(nome)) = lower(?)')) {
      const n = String(params[0] || '').toLowerCase().trim();
      return store.presencas_evento
        .filter((p) => String(p.nome || '').toLowerCase().trim() === n)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5);
    }
    return [...store.presencas_evento].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // triagens
  if (s.includes('from triagens')) {
    let list = store.triagens.filter((t) => !t.excluido);

    if (s.includes('select distinct empresa as nome')) {
      const uniq = Array.from(new Set(list.map((t) => t.empresa).filter(Boolean)));
      return uniq.map((nome) => ({ nome }));
    }
    if (s.includes('where id = ?')) {
      return list.filter((t) => String(t.id) === String(params[0]));
    }
    if (s.includes('where presenca_id = ?')) {
      return list.filter((t) => String(t.presenca_id) === String(params[0]));
    }
    if (s.includes('where codigo_acesso = ?')) {
      const cod = String(params[0] || '').toUpperCase().trim();
      return list.filter((t) => String(t.codigo_acesso || '').toUpperCase() === cod);
    }
    if (s.includes('lower(trim(nome_paciente)) = lower(?)')) {
      const n = String(params[0] || '').toLowerCase().trim();
      return list
        .filter((t) => String(t.nome_paciente || '').toLowerCase().trim() === n)
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, 5);
    }

    // Filtros dinâmicos (triagens.js e painel.js)
    let pIdx = 0;
    if (s.includes('lower(nome_paciente) like lower(?)')) {
      const likeRaw = String(params[pIdx++] || '').replace(/%/g, '').toLowerCase();
      const exactCod = String(params[pIdx++] || '').toLowerCase();
      list = list.filter(
        (t) =>
          String(t.nome_paciente || '').toLowerCase().includes(likeRaw) ||
          String(t.codigo_acesso || '').toLowerCase() === exactCod
      );
    } else {
      if (s.includes('and empresa = ?')) {
        const emp = params[pIdx++];
        list = list.filter((t) => t.empresa === emp);
      }
      if (s.includes('and tipo_exame = ?')) {
        const tipo = params[pIdx++];
        list = list.filter((t) => t.tipo_exame === tipo);
      }
      if (s.includes('and sexo = ?')) {
        const sx = params[pIdx++];
        list = list.filter((t) => t.sexo === sx);
      }
      if (s.includes('ts >= ?')) {
        const tsIni = Number(params[pIdx++]);
        list = list.filter((t) => Number(t.ts) >= tsIni);
      }
      if (s.includes('ts <= ?')) {
        const tsFim = Number(params[pIdx++]);
        list = list.filter((t) => Number(t.ts) <= tsFim);
      }
    }

    if (s.includes('order by ts asc')) {
      list.sort((a, b) => Number(a.ts) - Number(b.ts));
    } else {
      list.sort((a, b) => Number(b.ts) - Number(a.ts));
    }

    if (s.includes('limit 300')) list = list.slice(0, 300);
    return list;
  }

  return [];
}

function executeRun(store, sql, params = []) {
  const s = normSql(sql);

  // configuracoes
  if (s.startsWith('insert into configuracoes')) {
    if (params.length === 1) {
      store.configuracoes.evento_titulo = params[0];
    } else if (params.length >= 5) {
      store.configuracoes.clinica = params[0];
      store.configuracoes.unidade = params[1];
      store.configuracoes.url = params[2];
      store.configuracoes.modo = params[3];
      store.configuracoes.evento_titulo = params[4];
    }
    store.configuracoes.updated_at = new Date().toISOString();
    saveStore();
    return { changes: 1 };
  }

  // empresas
  if (s.startsWith('insert into empresas')) {
    store.empresas.push({
      id: params[0],
      razao_social: params[1],
      nome_fantasia: params[2],
      ativo: Boolean(params[3]),
    });
    saveStore();
    return { changes: 1 };
  }

  // servicos_evento
  if (s.startsWith('insert into servicos_evento')) {
    store.servicos_evento.push({
      id: params[0],
      nome: params[1],
      categoria: params[2],
      ativo: Boolean(params[3]),
      ordem: Number(params[4] || 0),
      created_at: new Date().toISOString(),
    });
    saveStore();
    return { changes: 1 };
  }
  if (s.startsWith('update servicos_evento set ativo = ?')) {
    const item = store.servicos_evento.find((x) => String(x.id) === String(params[1]));
    if (item) item.ativo = Boolean(params[0]);
    saveStore();
    return { changes: item ? 1 : 0 };
  }
  if (s.startsWith('delete from servicos_evento')) {
    const nome = String(params[0] || '').toLowerCase().trim();
    const before = store.servicos_evento.length;
    store.servicos_evento = store.servicos_evento.filter((x) => x.nome.toLowerCase().trim() !== nome);
    saveStore();
    return { changes: before - store.servicos_evento.length };
  }

  // presencas_evento
  if (s.startsWith('insert into presencas_evento')) {
    if (params.length === 11) {
      store.presencas_evento.push({
        id: params[0],
        nome: params[1],
        celular: params[2],
        empresa: params[3],
        servicos: params[4],
        observacoes: params[5],
        evento_nome: params[6],
        triagem_id: params[7],
        status_fluxo: params[8],
        created_at: params[9],
        updated_at: params[10],
      });
    } else {
      store.presencas_evento.push({
        id: params[0],
        nome: params[1],
        celular: params[2],
        empresa: params[3],
        servicos: params[4],
        observacoes: params[5],
        evento_nome: params[6],
        triagem_id: null,
        status_fluxo: 'registrado',
        created_at: params[7],
        updated_at: params[8],
      });
    }
    saveStore();
    return { changes: 1 };
  }

  if (s.startsWith('update presencas_evento')) {
    if (s.includes('where triagem_id = ?')) {
      let changes = 0;
      for (const p of store.presencas_evento) {
        if (String(p.triagem_id) === String(params[1])) {
          p.triagem_id = null;
          p.status_fluxo = 'registrado';
          p.updated_at = params[0];
          changes++;
        }
      }
      saveStore();
      return { changes };
    }
    if (s.includes('set triagem_id = ?')) {
      const p = store.presencas_evento.find((x) => String(x.id) === String(params[2]));
      if (p) {
        p.triagem_id = params[0];
        p.status_fluxo = 'triagem_concluida';
        p.updated_at = params[1];
      }
      saveStore();
      return { changes: p ? 1 : 0 };
    }
    if (params.length === 8) {
      const p = store.presencas_evento.find((x) => String(x.id) === String(params[7]));
      if (p) {
        p.nome = params[0];
        p.celular = params[1];
        p.empresa = params[2];
        p.servicos = params[3];
        p.observacoes = params[4];
        p.status_fluxo = params[5];
        p.updated_at = params[6];
      }
      saveStore();
      return { changes: p ? 1 : 0 };
    }
    if (params.length === 7) {
      const p = store.presencas_evento.find((x) => String(x.id) === String(params[6]));
      if (p) {
        p.nome = params[0];
        p.celular = params[1];
        p.empresa = params[2];
        p.servicos = params[3];
        p.observacoes = params[4];
        p.updated_at = params[5];
      }
      saveStore();
      return { changes: p ? 1 : 0 };
    }
  }

  if (s.startsWith('delete from presencas_evento')) {
    if (s.includes('where id = ?')) {
      const before = store.presencas_evento.length;
      store.presencas_evento = store.presencas_evento.filter((x) => String(x.id) !== String(params[0]));
      saveStore();
      return { changes: before - store.presencas_evento.length };
    }
    const count = store.presencas_evento.length;
    store.presencas_evento = [];
    saveStore();
    return { changes: count };
  }

  // triagens
  if (s.startsWith('insert into triagens')) {
    store.triagens.push({
      id: params[0],
      codigo_acesso: params[1],
      presenca_id: params[2],
      ts: Number(params[3]),
      data_hora: params[4],
      nome_paciente: params[5],
      data_nascimento: params[6],
      sexo: params[7],
      empresa: params[8],
      tipo_exame: params[9],
      pa_sistolica: Number(params[10]),
      pa_diastolica: Number(params[11]),
      freq_cardiaca: Number(params[12]),
      peso_kg: Number(params[13]),
      altura_cm: Number(params[14]),
      imc: Number(params[15]),
      classificacao_pa: params[16],
      codigo_classificacao_pa: params[17],
      classificacao_imc: params[18],
      codigo_classificacao_imc: params[19],
      classificacao_fc: params[20],
      codigo_classificacao_fc: params[21],
      alerta_pa_grave: Boolean(params[22]),
      observacoes: params[23],
      nome_profissional: params[24],
      token_qrcode: params[25],
      status: 'aguardando_medico',
      excluido: Boolean(params[26]),
      editado_em: 0,
      created_at: params[4],
    });
    saveStore();
    return { changes: 1 };
  }

  if (s.startsWith('update triagens')) {
    if (s.includes('set presenca_id = null where presenca_id is not null')) {
      for (const t of store.triagens) t.presenca_id = null;
      saveStore();
      return { changes: 1 };
    }
    if (s.includes('set presenca_id = null where presenca_id = ?')) {
      for (const t of store.triagens) {
        if (String(t.presenca_id) === String(params[0])) t.presenca_id = null;
      }
      saveStore();
      return { changes: 1 };
    }
    if (s.includes('set presenca_id = ? where id = ?')) {
      const t = store.triagens.find((x) => String(x.id) === String(params[1]));
      if (t) t.presenca_id = params[0];
      saveStore();
      return { changes: t ? 1 : 0 };
    }
    if (s.includes('set excluido = ?')) {
      const t = store.triagens.find((x) => String(x.id) === String(params[2]));
      if (t) {
        t.excluido = Boolean(params[0]);
        t.editado_em = Number(params[1]);
      }
      saveStore();
      return { changes: t ? 1 : 0 };
    }
    // Retificação completa
    const t = store.triagens.find((x) => String(x.id) === String(params[21]));
    if (t) {
      t.nome_paciente = params[0];
      t.data_nascimento = params[1];
      t.sexo = params[2];
      t.empresa = params[3];
      t.tipo_exame = params[4];
      t.pa_sistolica = Number(params[5]);
      t.pa_diastolica = Number(params[6]);
      t.freq_cardiaca = Number(params[7]);
      t.peso_kg = Number(params[8]);
      t.altura_cm = Number(params[9]);
      t.imc = Number(params[10]);
      t.classificacao_pa = params[11];
      t.codigo_classificacao_pa = params[12];
      t.classificacao_imc = params[13];
      t.codigo_classificacao_imc = params[14];
      t.classificacao_fc = params[15];
      t.codigo_classificacao_fc = params[16];
      t.alerta_pa_grave = Boolean(params[17]);
      t.observacoes = params[18];
      t.nome_profissional = params[19];
      t.editado_em = Number(params[20]);
    }
    saveStore();
    return { changes: t ? 1 : 0 };
  }

  if (s.startsWith('delete from triagens')) {
    const before = store.triagens.length;
    store.triagens = store.triagens.filter((x) => String(x.id) !== String(params[0]));
    saveStore();
    return { changes: before - store.triagens.length };
  }

  return { changes: 0 };
}

module.exports = {
  loadStore,
  executeQuery,
  executeRun,
};
