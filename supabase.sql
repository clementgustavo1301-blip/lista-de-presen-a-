-- ============================================================================
-- ECOSAFETY & ECOCLINIC — PLATAFORMA INTEGRADA DE PRESENÇA, BEM-ESTAR E TRIAGEM
-- Script SQL Completo e Unificado para PostgreSQL / Supabase (SQL Editor)
-- Módulos Integrados:
--   1. Controle de Presença & Massoterapia / Bem-Estar (EcoSafety)
--   2. Triagem Clínica & Medicina do Trabalho — DBHA 2025, OMS, NR-7, LGPD (EcoClinic)
--   3. Cadastro Unificado de Empresas, Colaboradores/Pacientes e Jornada Integrada
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSÕES NECESSÁRIAS
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ----------------------------------------------------------------------------
-- 2. TIPOS ENUMERADOS (IDEMPOTENTES)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_sexo') then
    create type public.tipo_sexo as enum ('M', 'F', 'O');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_exame_ocupacional') then
    create type public.tipo_exame_ocupacional as enum (
      'Admissional',
      'Periódico',
      'Retorno ao trabalho',
      'Mudança de riscos ocupacionais',
      'Demissional'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'modo_qrcode') then
    create type public.modo_qrcode as enum ('texto', 'link');
  end if;

  if not exists (select 1 from pg_type where typname = 'status_triagem') then
    create type public.status_triagem as enum (
      'aguardando_medico',
      'em_consulta',
      'finalizado',
      'cancelado'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'cargo_profissional') then
    create type public.cargo_profissional as enum (
      'enfermeiro',
      'tecnico_enfermagem',
      'medico_trabalho',
      'medico_examinador',
      'massoterapeuta',
      'fisioterapeuta',
      'recepcao',
      'administrador'
    );
  end if;
end $$;

-- Garantir novos valores caso os enums já existissem da versão anterior
alter type public.tipo_exame_ocupacional add value if not exists 'Outro';
alter type public.cargo_profissional add value if not exists 'massoterapeuta';
alter type public.cargo_profissional add value if not exists 'fisioterapeuta';
alter type public.cargo_profissional add value if not exists 'recepcao';

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES UTILITÁRIAS E CLASSIFICAÇÕES CLÍNICAS (SECURITY INVOKER)
-- ----------------------------------------------------------------------------

-- Atualização automática de coluna updated_at
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Cálculo do IMC (kg / m²)
create or replace function public.fn_calcular_imc(peso_kg numeric, altura_cm numeric)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if peso_kg is null or altura_cm is null or peso_kg <= 0 or altura_cm <= 0 then
    return null;
  end if;
  return round(peso_kg / ((altura_cm / 100.0) * (altura_cm / 100.0)), 1);
end;
$$;

-- Classificação da Pressão Arterial (Diretriz Brasileira de Hipertensão Arterial 2025)
create or replace function public.fn_classificar_pa(pas integer, pad integer)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if pas is null or pad is null then
    return 'Aguardando medida';
  elsif pas >= 180 or pad >= 110 then
    return 'Hipertensão estágio 3';
  elsif pas >= 160 or pad >= 100 then
    return 'Hipertensão estágio 2';
  elsif pas >= 140 or pad >= 90 then
    return 'Hipertensão estágio 1';
  elsif pas >= 120 or pad >= 80 then
    return 'Pré-hipertensão';
  elsif pas < 90 or pad < 60 then
    return 'Abaixo de 90/60';
  else
    return 'Normal';
  end if;
end;
$$;

-- Código curto da Pressão Arterial ('baixa', 'normal', 'pre', 'e1', 'e2', 'e3')
create or replace function public.fn_codigo_classificacao_pa(pas integer, pad integer)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if pas is null or pad is null then
    return 'normal';
  elsif pas >= 180 or pad >= 110 then
    return 'e3';
  elsif pas >= 160 or pad >= 100 then
    return 'e2';
  elsif pas >= 140 or pad >= 90 then
    return 'e1';
  elsif pas >= 120 or pad >= 80 then
    return 'pre';
  elsif pas < 90 or pad < 60 then
    return 'baixa';
  else
    return 'normal';
  end if;
end;
$$;

-- Classificação do IMC (OMS Adultos)
create or replace function public.fn_classificar_imc(imc numeric)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if imc is null or imc <= 0 then
    return 'Aguardando medida';
  elsif imc < 18.5 then
    return 'Baixo peso';
  elsif imc < 25.0 then
    return 'Peso adequado';
  elsif imc < 30.0 then
    return 'Sobrepeso';
  elsif imc < 35.0 then
    return 'Obesidade grau I';
  elsif imc < 40.0 then
    return 'Obesidade grau II';
  else
    return 'Obesidade grau III';
  end if;
end;
$$;

-- Código curto do IMC ('baixo', 'ok', 'sobre', 'ob1', 'ob2', 'ob3')
create or replace function public.fn_codigo_classificacao_imc(imc numeric)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if imc is null or imc <= 0 then
    return 'ok';
  elsif imc < 18.5 then
    return 'baixo';
  elsif imc < 25.0 then
    return 'ok';
  elsif imc < 30.0 then
    return 'sobre';
  elsif imc < 35.0 then
    return 'ob1';
  elsif imc < 40.0 then
    return 'ob2';
  else
    return 'ob3';
  end if;
end;
$$;

-- Classificação de Frequência Cardíaca em Repouso
create or replace function public.fn_classificar_fc(fc integer)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if fc is null or fc <= 0 then
    return 'Aguardando medida';
  elsif fc < 60 then
    return 'Abaixo de 60 bpm';
  elsif fc <= 100 then
    return '60 a 100 bpm';
  else
    return 'Acima de 100 bpm';
  end if;
end;
$$;

-- Código curto de Frequência Cardíaca ('baixa', 'ok', 'alta')
create or replace function public.fn_codigo_classificacao_fc(fc integer)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if fc is null or fc <= 0 then
    return 'ok';
  elsif fc < 60 then
    return 'baixa';
  elsif fc <= 100 then
    return 'ok';
  else
    return 'alta';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. TABELAS COMPARTILHADAS (CONFIGURAÇÕES, AUTENTICAÇÃO, EMPRESAS E PACIENTES)
-- ----------------------------------------------------------------------------

-- 4.1 Configurações Unificadas (Clínica, QR Code e Evento de Presença)
create table if not exists public.configuracoes (
  id text primary key default 'geral',
  clinica text not null default 'EcoSafety & EcoClinic — Saúde Ocupacional',
  unidade text not null default 'Matriz',
  url text not null default '',
  modo text not null default 'texto' check (modo in ('texto', 'link')),
  evento_titulo text not null default 'Lista de Presença — Massoterapia',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.configuracoes add column if not exists evento_titulo text not null default 'Lista de Presença — Massoterapia';
alter table public.configuracoes add column if not exists ativo boolean not null default true;

-- 4.2 Usuários de Autenticação (Equipe Clínica e Administração)
create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) > 0),
  email text not null unique check (position('@' in email) > 1),
  senha_hash text not null,
  cargo public.cargo_profissional not null default 'enfermeiro',
  registro_conselho text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4.3 Profissionais de Saúde e Bem-Estar (Enfermagem, Médicos e Massoterapeutas)
create table if not exists public.profissionais (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  nome text not null check (char_length(trim(nome)) > 0),
  registro_conselho text,
  cargo public.cargo_profissional not null default 'tecnico_enfermagem',
  email text unique,
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profissionais add column if not exists usuario_id uuid references public.usuarios(id) on delete set null;

-- 4.4 Empresas Clientes (Compartilhadas entre Presença e Triagem)
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null check (char_length(trim(razao_social)) > 0),
  nome_fantasia text,
  cnpj text unique,
  setor_atividade text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4.5 Cadastro Mestre de Colaboradores / Pacientes (Unifica Presença + Triagem)
create table if not exists public.pacientes (
  id uuid primary key default gen_random_uuid(),
  nome_completo text not null check (char_length(trim(nome_completo)) >= 2),
  celular text,
  cpf text unique,
  data_nascimento date check (
    data_nascimento is null or
    (data_nascimento >= '1900-01-01'::date and data_nascimento <= current_date)
  ),
  sexo public.tipo_sexo,
  empresa_id uuid references public.empresas(id) on delete set null,
  nome_empresa text,
  funcao_cargo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pacientes add column if not exists celular text;
alter table public.pacientes add column if not exists nome_empresa text;

-- ----------------------------------------------------------------------------
-- 5. MÓDULO 1: CONTROLE DE PRESENÇA, EVENTOS & MASSOTERAPIA (ECOSAFETY)
-- ----------------------------------------------------------------------------

-- 5.1 Eventos / Ações de Saúde (SIPAT, Ações In-Company, Campanhas)
create table if not exists public.eventos_saude (
  id uuid primary key default gen_random_uuid(),
  titulo text not null default 'Lista de Presença — Massoterapia',
  data_evento date not null default current_date,
  empresa_id uuid references public.empresas(id) on delete set null,
  local_evento text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5.2 Catálogo de Procedimentos e Serviços do Evento
create table if not exists public.servicos_evento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (char_length(trim(nome)) > 0),
  categoria text not null default 'bem_estar' check (categoria in ('bem_estar', 'triagem', 'ocupacional', 'outro')),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.servicos_evento add column if not exists categoria text not null default 'bem_estar';

-- 5.3 Lista de Presença e Atendimentos (Integrada à Triagem Clínica)
create table if not exists public.presencas_evento (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid references public.eventos_saude(id) on delete set null,
  paciente_id uuid references public.pacientes(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete set null,
  triagem_id uuid,
  nome text not null check (char_length(trim(nome)) > 0),
  celular text not null default '',
  empresa text not null check (char_length(trim(empresa)) > 0),
  servicos text[] not null default '{}',
  observacoes text,
  evento_nome text not null default 'Lista de Presença — Massoterapia',
  status_fluxo text not null default 'registrado' check (
    status_fluxo in ('registrado', 'encaminhado_triagem', 'triagem_concluida', 'atendimento_concluido')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.presencas_evento add column if not exists evento_id uuid references public.eventos_saude(id) on delete set null;
alter table public.presencas_evento add column if not exists paciente_id uuid references public.pacientes(id) on delete set null;
alter table public.presencas_evento add column if not exists empresa_id uuid references public.empresas(id) on delete set null;
alter table public.presencas_evento add column if not exists triagem_id uuid;
alter table public.presencas_evento add column if not exists status_fluxo text not null default 'registrado';

-- ----------------------------------------------------------------------------
-- 6. MÓDULO 2: TRIAGEM CLÍNICA & MEDICINA DO TRABALHO (ECOCLINIC)
-- ----------------------------------------------------------------------------

-- 6.1 Triagens Clínicas (Integrada à Presença, Pacientes e Empresas)
create table if not exists public.triagens (
  id uuid primary key default gen_random_uuid(),
  codigo_acesso text not null unique,
  presenca_id uuid references public.presencas_evento(id) on delete set null,
  paciente_id uuid references public.pacientes(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete set null,
  profissional_id uuid references public.profissionais(id) on delete set null,

  -- Carimbo temporal em epoch ms (compatibilidade de alta velocidade com filtros) e timestamptz
  ts bigint not null default (extract(epoch from now()) * 1000)::bigint,
  data_hora timestamptz not null default now(),

  -- Dados de identificação (snapshot histórico do prontuário)
  nome_paciente text not null,
  data_nascimento date,
  sexo text check (sexo is null or sexo in ('M', 'F', 'O', '')),
  empresa text,
  tipo_exame text,

  -- Sinais vitais e antropometria
  pa_sistolica integer not null check (pa_sistolica between 60 and 300),
  pa_diastolica integer not null check (pa_diastolica between 30 and 200),
  freq_cardiaca integer not null check (freq_cardiaca between 30 and 250),
  peso_kg numeric(5,2) not null check (peso_kg between 20.00 and 350.00),
  altura_cm numeric(5,2) not null check (altura_cm between 100.00 and 250.00),

  -- Indicadores e classificações calculados automaticamente via trigger (ou enviados pela API)
  imc numeric(5,2) not null,
  classificacao_pa text not null,
  codigo_classificacao_pa text not null,
  classificacao_imc text not null,
  codigo_classificacao_imc text not null,
  classificacao_fc text not null,
  codigo_classificacao_fc text not null,
  alerta_pa_grave boolean not null default false,

  -- Registro complementar e QR Code da ficha
  observacoes text,
  nome_profissional text not null default 'Enfermagem',
  token_qrcode text unique,

  -- Controle operacional e auditoria
  status public.status_triagem not null default 'aguardando_medico',
  excluido boolean not null default false,
  editado_em bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_triagem_nome check (
    char_length(trim(nome_paciente)) >= 5 and position(' ' in trim(nome_paciente)) > 0
  ),
  constraint chk_triagem_pa_coerencia check (pa_diastolica < pa_sistolica)
);

alter table public.triagens add column if not exists presenca_id uuid references public.presencas_evento(id) on delete set null;
alter table public.triagens add column if not exists ts bigint not null default (extract(epoch from now()) * 1000)::bigint;
alter table public.triagens add column if not exists data_nascimento date;
alter table public.triagens add column if not exists sexo text;
alter table public.triagens add column if not exists empresa text;
alter table public.triagens add column if not exists classificacao_pa text;
alter table public.triagens add column if not exists codigo_classificacao_pa text;
alter table public.triagens add column if not exists classificacao_imc text;
alter table public.triagens add column if not exists codigo_classificacao_imc text;
alter table public.triagens add column if not exists classificacao_fc text;
alter table public.triagens add column if not exists codigo_classificacao_fc text;

-- Fechamento da chave estrangeira cruzada entre presencas_evento.triagem_id -> triagens.id
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_presencas_evento_triagem'
  ) then
    alter table public.presencas_evento
      add constraint fk_presencas_evento_triagem
      foreign key (triagem_id) references public.triagens(id) on delete set null;
  end if;
end $$;

-- 6.2 Consultas Médicas Ocupacionais / Emissão de ASO
create table if not exists public.consultas_medicas (
  id uuid primary key default gen_random_uuid(),
  triagem_id uuid not null unique references public.triagens(id) on delete restrict,
  medico_id uuid not null references public.profissionais(id) on delete restrict,
  parecer_aptidao text not null check (parecer_aptidao in ('Apto', 'Inapto', 'Apto com Restrição')),
  numero_aso text,
  observacoes_medicas text,
  data_hora_consulta timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 6.3 Auditoria de Alterações e Rastreabilidade LGPD
create table if not exists public.auditoria_triagens (
  id bigint generated always as identity primary key,
  triagem_id uuid not null references public.triagens(id) on delete cascade,
  acao text not null,
  usuario text,
  dados_anteriores jsonb,
  dados_novos jsonb,
  ip_origem inet,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. ÍNDICES DE PERFORMANCE E CHAVES ESTRANGEIRAS (POSTGRES BEST PRACTICES)
-- ----------------------------------------------------------------------------

-- Índices em todas as Foreign Keys (evita table scans em JOINs e ON DELETE SET NULL)
create index if not exists idx_profissionais_usuario_id on public.profissionais (usuario_id);
create index if not exists idx_pacientes_empresa_id on public.pacientes (empresa_id);
create index if not exists idx_eventos_saude_empresa_id on public.eventos_saude (empresa_id);
create index if not exists idx_presencas_evento_evento_id on public.presencas_evento (evento_id);
create index if not exists idx_presencas_evento_paciente_id on public.presencas_evento (paciente_id);
create index if not exists idx_presencas_evento_empresa_id on public.presencas_evento (empresa_id);
create index if not exists idx_presencas_evento_triagem_id on public.presencas_evento (triagem_id);
create index if not exists idx_triagens_presenca_id on public.triagens (presenca_id);
create index if not exists idx_triagens_paciente_id on public.triagens (paciente_id);
create index if not exists idx_triagens_empresa_id on public.triagens (empresa_id);
create index if not exists idx_triagens_profissional_id on public.triagens (profissional_id);
create index if not exists idx_consultas_triagem_id on public.consultas_medicas (triagem_id);
create index if not exists idx_consultas_medico_id on public.consultas_medicas (medico_id);
create index if not exists idx_auditoria_triagem_id on public.auditoria_triagens (triagem_id);

-- Índices operacionais de Presença
create index if not exists idx_presencas_evento_created_at on public.presencas_evento (created_at desc);
create index if not exists idx_presencas_evento_empresa on public.presencas_evento (empresa);
create index if not exists idx_presencas_evento_status on public.presencas_evento (status_fluxo);
create index if not exists idx_presencas_evento_servicos_gin on public.presencas_evento using gin (servicos);
create index if not exists idx_presencas_evento_nome_trgm on public.presencas_evento using gin (nome gin_trgm_ops);

-- Índices operacionais de Triagem e Usuários
create index if not exists idx_usuarios_email_lower on public.usuarios (lower(email));
create unique index if not exists ux_empresas_razao_social_lower on public.empresas (lower(trim(razao_social)));
create index if not exists idx_empresas_nome_lower on public.empresas (lower(coalesce(nome_fantasia, razao_social)));
create index if not exists idx_pacientes_nome_trgm on public.pacientes using gin (nome_completo gin_trgm_ops);
create index if not exists idx_triagens_ts_desc on public.triagens (ts desc) where not excluido;
create index if not exists idx_triagens_data_hora_desc on public.triagens (data_hora desc) where not excluido;
create index if not exists idx_triagens_codigo_acesso on public.triagens (codigo_acesso);
create index if not exists idx_triagens_token_qrcode on public.triagens (token_qrcode) where token_qrcode is not null;
create index if not exists idx_triagens_nome_trgm on public.triagens using gin (nome_paciente gin_trgm_ops);
create index if not exists idx_triagens_painel_filtros on public.triagens (empresa, tipo_exame, sexo, ts desc) where not excluido;

-- ----------------------------------------------------------------------------
-- 8. TRIGGERS DE AUTOMAÇÃO, CÁLCULOS CLÍNICOS E INTEGRAÇÃO BIDIRECIONAL
-- ----------------------------------------------------------------------------

-- 8.1 Auxiliar para localizar ou criar Empresa pelo nome
create or replace function public.fn_obter_ou_criar_empresa(p_nome_empresa text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_limpo text := trim(coalesce(p_nome_empresa, ''));
begin
  if v_limpo = '' then
    return null;
  end if;

  select id into v_id
  from public.empresas
  where lower(trim(coalesce(nome_fantasia, ''))) = lower(v_limpo)
     or lower(trim(razao_social)) = lower(v_limpo)
  limit 1;

  if v_id is null then
    insert into public.empresas (razao_social, nome_fantasia)
    values (v_limpo, v_limpo)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- 8.2 Trigger BEFORE INSERT OR UPDATE em presencas_evento (vincula Empresa, Paciente e Triagem do dia)
create or replace function public.fn_trg_integrar_presenca()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_triagem_id uuid;
begin
  if new.empresa_id is null and trim(coalesce(new.empresa, '')) <> '' then
    new.empresa_id := public.fn_obter_ou_criar_empresa(new.empresa);
  end if;

  if new.paciente_id is null and trim(coalesce(new.nome, '')) <> '' then
    select id into new.paciente_id
    from public.pacientes
    where lower(trim(nome_completo)) = lower(trim(new.nome))
    order by updated_at desc
    limit 1;

    if new.paciente_id is null then
      insert into public.pacientes (nome_completo, celular, empresa_id, nome_empresa)
      values (trim(new.nome), nullif(trim(new.celular), ''), new.empresa_id, trim(new.empresa))
      returning id into new.paciente_id;
    elsif trim(coalesce(new.celular, '')) <> '' then
      update public.pacientes
      set celular = coalesce(nullif(trim(new.celular), ''), celular),
          empresa_id = coalesce(new.empresa_id, empresa_id),
          nome_empresa = coalesce(nullif(trim(new.empresa), ''), nome_empresa)
      where id = new.paciente_id;
    end if;
  end if;

  -- Se o colaborador já fez triagem hoje e ainda não está vinculado, conecta automaticamente
  if new.triagem_id is null and trim(coalesce(new.nome, '')) <> '' then
    select t.id into v_triagem_id
    from public.triagens t
    where not t.excluido
      and lower(trim(t.nome_paciente)) = lower(trim(new.nome))
      and (t.data_hora at time zone 'UTC')::date = (coalesce(new.created_at, now()) at time zone 'UTC')::date
    order by t.ts desc
    limit 1;

    if v_triagem_id is not null then
      new.triagem_id := v_triagem_id;
      if new.status_fluxo = 'registrado' then
        new.status_fluxo := 'triagem_concluida';
      end if;
    end if;
  elsif new.triagem_id is not null and new.status_fluxo in ('registrado', 'encaminhado_triagem') then
    new.status_fluxo := 'triagem_concluida';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_integrar_presenca on public.presencas_evento;
create trigger trg_integrar_presenca
  before insert or update on public.presencas_evento
  for each row
  execute function public.fn_trg_integrar_presenca();

-- 8.3 Trigger AFTER INSERT em presencas_evento (propaga vínculo reverso se já encontrou triagem)
create or replace function public.fn_trg_pos_presenca()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_trigger_depth() <= 1 and new.triagem_id is not null then
    update public.triagens
    set presenca_id = new.id
    where id = new.triagem_id
      and presenca_id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pos_presenca on public.presencas_evento;
create trigger trg_pos_presenca
  after insert or update on public.presencas_evento
  for each row
  execute function public.fn_trg_pos_presenca();

-- 8.4 Trigger BEFORE INSERT OR UPDATE em triagens (código, cálculos clínicos e vínculos)
create or replace function public.fn_trg_preparar_triagem()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tentativas integer := 0;
  v_sexo_enum public.tipo_sexo;
begin
  -- Código curto de 5 caracteres
  if new.codigo_acesso is null or trim(new.codigo_acesso) = '' then
    loop
      tentativas := tentativas + 1;
      new.codigo_acesso := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 5));
      exit when not exists (select 1 from public.triagens where codigo_acesso = new.codigo_acesso);
      exit when tentativas > 50;
    end loop;
  end if;

  -- Timestamp em milissegundos sincronizado com data_hora
  if new.data_hora is null then
    new.data_hora := now();
  end if;
  if new.ts is null or new.ts <= 0 then
    new.ts := (extract(epoch from new.data_hora) * 1000)::bigint;
  end if;

  -- Cálculos automáticos de IMC, PA e FC
  new.imc := coalesce(public.fn_calcular_imc(new.peso_kg, new.altura_cm), 0);
  new.codigo_classificacao_pa := public.fn_codigo_classificacao_pa(new.pa_sistolica, new.pa_diastolica);
  new.classificacao_pa := public.fn_classificar_pa(new.pa_sistolica, new.pa_diastolica);
  new.codigo_classificacao_imc := public.fn_codigo_classificacao_imc(new.imc);
  new.classificacao_imc := public.fn_classificar_imc(new.imc);
  new.codigo_classificacao_fc := public.fn_codigo_classificacao_fc(new.freq_cardiaca);
  new.classificacao_fc := public.fn_classificar_fc(new.freq_cardiaca);
  new.alerta_pa_grave := (new.pa_sistolica >= 180 or new.pa_diastolica >= 110);

  -- Vínculo com Empresa
  if new.empresa_id is null and trim(coalesce(new.empresa, '')) <> '' then
    new.empresa_id := public.fn_obter_ou_criar_empresa(new.empresa);
  end if;

  -- Vínculo com Cadastro Mestre de Colaboradores / Pacientes
  v_sexo_enum := case
    when upper(coalesce(new.sexo, '')) in ('M', 'F', 'O') then upper(new.sexo)::public.tipo_sexo
    else null
  end;

  if new.paciente_id is null and trim(coalesce(new.nome_paciente, '')) <> '' then
    select id into new.paciente_id
    from public.pacientes
    where lower(trim(nome_completo)) = lower(trim(new.nome_paciente))
    order by updated_at desc
    limit 1;

    if new.paciente_id is null then
      insert into public.pacientes (nome_completo, data_nascimento, sexo, empresa_id, nome_empresa)
      values (trim(new.nome_paciente), new.data_nascimento, v_sexo_enum, new.empresa_id, nullif(trim(new.empresa), ''))
      returning id into new.paciente_id;
    else
      update public.pacientes
      set data_nascimento = coalesce(new.data_nascimento, data_nascimento),
          sexo = coalesce(v_sexo_enum, sexo),
          empresa_id = coalesce(new.empresa_id, empresa_id),
          nome_empresa = coalesce(nullif(trim(new.empresa), ''), nome_empresa)
      where id = new.paciente_id;
    end if;
  end if;

  -- Vínculo automático com Presença do mesmo dia caso presenca_id não tenha sido enviado
  if new.presenca_id is null and not new.excluido then
    select p.id into new.presenca_id
    from public.presencas_evento p
    where lower(trim(p.nome)) = lower(trim(new.nome_paciente))
      and (p.created_at at time zone 'UTC')::date = (new.data_hora at time zone 'UTC')::date
    order by p.created_at desc
    limit 1;
  end if;

  -- Carimbo de retificação em edições clínicas
  if tg_op = 'UPDATE' then
    if (
      new.pa_sistolica is distinct from old.pa_sistolica or
      new.pa_diastolica is distinct from old.pa_diastolica or
      new.freq_cardiaca is distinct from old.freq_cardiaca or
      new.peso_kg is distinct from old.peso_kg or
      new.altura_cm is distinct from old.altura_cm
    ) and coalesce(new.editado_em, 0) = coalesce(old.editado_em, 0) then
      new.editado_em := (extract(epoch from now()) * 1000)::bigint;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preparar_triagem on public.triagens;
create trigger trg_preparar_triagem
  before insert or update on public.triagens
  for each row
  execute function public.fn_trg_preparar_triagem();

-- 8.5 Trigger AFTER INSERT OR UPDATE em triagens (sincroniza Presença e grava Auditoria LGPD)
create or replace function public.fn_trg_pos_triagem_e_auditoria()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Sincroniza o registro de presença vinculado
  if pg_trigger_depth() <= 1 and new.presenca_id is not null and not new.excluido then
    update public.presencas_evento
    set triagem_id = new.id,
        status_fluxo = 'triagem_concluida'
    where id = new.presenca_id
      and (triagem_id is distinct from new.id or status_fluxo <> 'triagem_concluida');
  end if;

  -- Registra auditoria LGPD (AFTER garante que a FK triagem_id já existe na tabela triagens)
  if tg_op = 'INSERT' then
    insert into public.auditoria_triagens (triagem_id, acao, usuario, dados_novos)
    values (new.id, 'INSERT', new.nome_profissional, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into public.auditoria_triagens (triagem_id, acao, usuario, dados_anteriores, dados_novos)
    values (
      new.id,
      case when new.excluido and not old.excluido then 'SOFT_DELETE' else 'UPDATE' end,
      new.nome_profissional,
      to_jsonb(old),
      to_jsonb(new)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pos_triagem_e_auditoria on public.triagens;
create trigger trg_pos_triagem_e_auditoria
  after insert or update on public.triagens
  for each row
  execute function public.fn_trg_pos_triagem_e_auditoria();

-- 8.6 Triggers de updated_at em todas as tabelas mutáveis
drop trigger if exists trg_configuracoes_updated_at on public.configuracoes;
create trigger trg_configuracoes_updated_at
  before update on public.configuracoes
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_usuarios_updated_at on public.usuarios;
create trigger trg_usuarios_updated_at
  before update on public.usuarios
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_profissionais_updated_at on public.profissionais;
create trigger trg_profissionais_updated_at
  before update on public.profissionais
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_empresas_updated_at on public.empresas;
create trigger trg_empresas_updated_at
  before update on public.empresas
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_pacientes_updated_at on public.pacientes;
create trigger trg_pacientes_updated_at
  before update on public.pacientes
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_eventos_saude_updated_at on public.eventos_saude;
create trigger trg_eventos_saude_updated_at
  before update on public.eventos_saude
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_presencas_evento_updated_at on public.presencas_evento;
create trigger trg_presencas_evento_updated_at
  before update on public.presencas_evento
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_triagens_updated_at on public.triagens;
create trigger trg_triagens_updated_at
  before update on public.triagens
  for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 9. VIEWS DE RELATÓRIO, PAINEL CLÍNICO E INTEGRAÇÃO (SECURITY INVOKER = TRUE)
-- ----------------------------------------------------------------------------

-- 9.1 Resumo geral da Lista de Presença & Massoterapia
create or replace view public.vw_resumo_evento
with (security_invoker = true)
as
select
  count(*)::integer as total_participantes,
  count(distinct lower(trim(empresa)))::integer as total_empresas,
  coalesce(sum(coalesce(array_length(servicos, 1), 0)), 0)::integer as total_procedimentos,
  count(*) filter (where triagem_id is not null)::integer as total_com_triagem
from public.presencas_evento;

-- 9.2 Contagem de atendimentos por procedimento de bem-estar
create or replace view public.vw_resumo_por_servico
with (security_invoker = true)
as
select
  servico,
  count(*)::integer as total_atendimentos
from public.presencas_evento,
  unnest(servicos) as servico
group by servico
order by total_atendimentos desc, servico asc;

-- 9.3 View detalhada de Triagens com classificações clínicas
create or replace view public.vw_triagens_detalhadas
with (security_invoker = true)
as
select
  t.id,
  t.codigo_acesso,
  t.presenca_id,
  t.paciente_id,
  t.empresa_id,
  t.ts,
  t.data_hora,
  (t.data_hora at time zone 'America/Fortaleza')::date as data_atendimento,
  to_char(t.data_hora at time zone 'America/Fortaleza', 'HH24:MI') as hora_atendimento,
  t.nome_paciente,
  t.data_nascimento,
  case
    when t.data_nascimento is not null then
      date_part('year', age(t.data_hora, t.data_nascimento))::integer
    else null
  end as idade,
  t.sexo,
  coalesce(nullif(trim(t.empresa), ''), e.nome_fantasia, e.razao_social, 'Não informada') as empresa,
  t.tipo_exame,
  t.pa_sistolica,
  t.pa_diastolica,
  t.classificacao_pa,
  t.codigo_classificacao_pa,
  t.freq_cardiaca,
  t.classificacao_fc,
  t.codigo_classificacao_fc,
  t.peso_kg,
  t.altura_cm,
  t.imc,
  t.classificacao_imc,
  t.codigo_classificacao_imc,
  t.alerta_pa_grave,
  t.observacoes,
  t.nome_profissional as profissional_responsavel,
  t.token_qrcode,
  t.status,
  t.excluido,
  t.editado_em,
  t.created_at
from public.triagens t
left join public.empresas e on e.id = t.empresa_id;

-- 9.4 Fila de Atendimentos de Triagem de Hoje
create or replace view public.vw_fila_atendimentos_hoje
with (security_invoker = true)
as
select
  v.id,
  v.codigo_acesso,
  v.presenca_id,
  v.data_hora,
  v.hora_atendimento,
  v.nome_paciente,
  v.idade,
  v.sexo,
  v.empresa,
  v.tipo_exame,
  v.pa_sistolica,
  v.pa_diastolica,
  v.classificacao_pa,
  v.codigo_classificacao_pa,
  v.freq_cardiaca,
  v.classificacao_fc,
  v.codigo_classificacao_fc,
  v.peso_kg,
  v.altura_cm,
  v.imc,
  v.classificacao_imc,
  v.codigo_classificacao_imc,
  v.alerta_pa_grave,
  v.observacoes,
  v.profissional_responsavel,
  v.status
from public.vw_triagens_detalhadas v
where v.data_atendimento = (now() at time zone 'America/Fortaleza')::date
  and not v.excluido
order by v.ts desc;

-- 9.5 Última Triagem por Pessoa (Regra Epidemiológica: cada trabalhador conta 1 vez)
create or replace view public.vw_painel_ultimas_triagens_por_paciente
with (security_invoker = true)
as
select distinct on (
  lower(trim(t.nome_paciente)),
  coalesce(t.data_nascimento, '1900-01-01'::date)
)
  t.*,
  case
    when t.data_nascimento is not null then
      date_part('year', age(t.data_hora, t.data_nascimento))::integer
    else null
  end as idade,
  case
    when t.data_nascimento is null then 'Idade não informada'
    when date_part('year', age(t.data_hora, t.data_nascimento)) < 30 then 'Até 29 anos'
    when date_part('year', age(t.data_hora, t.data_nascimento)) between 30 and 39 then '30 a 39 anos'
    when date_part('year', age(t.data_hora, t.data_nascimento)) between 40 and 49 then '40 a 49 anos'
    when date_part('year', age(t.data_hora, t.data_nascimento)) between 50 and 59 then '50 a 59 anos'
    else '60 anos ou mais'
  end as faixa_etaria
from public.triagens t
where not t.excluido
order by
  lower(trim(t.nome_paciente)),
  coalesce(t.data_nascimento, '1900-01-01'::date),
  t.ts desc;

-- 9.6 Indicadores Clínicos Gerais do Painel
create or replace view public.vw_painel_indicadores_gerais
with (security_invoker = true)
as
select
  count(*)::integer as total_pessoas_avaliadas,
  round(avg(pa_sistolica), 0) as pa_sistolica_media,
  round(avg(pa_diastolica), 0) as pa_diastolica_media,
  round(avg(freq_cardiaca), 0) as freq_cardiaca_media,
  round(avg(imc), 1) as imc_medio,
  round(avg(peso_kg), 1) as peso_medio_kg,
  round(avg(altura_cm) / 100.0, 2) as altura_media_m,
  round(count(*) filter (where pa_sistolica >= 140 or pa_diastolica >= 90)::numeric / nullif(count(*), 0) * 100, 1) as perc_hipertensao,
  round(count(*) filter (where (pa_sistolica between 120 and 139) or (pa_diastolica between 80 and 89))::numeric / nullif(count(*), 0) * 100, 1) as perc_pre_hipertensao,
  round(count(*) filter (where imc >= 25.0)::numeric / nullif(count(*), 0) * 100, 1) as perc_acima_do_peso,
  round(count(*) filter (where imc >= 30.0)::numeric / nullif(count(*), 0) * 100, 1) as perc_obesidade,
  round(count(*) filter (where freq_cardiaca < 60 or freq_cardiaca > 100)::numeric / nullif(count(*), 0) * 100, 1) as perc_fc_fora_faixa
from public.vw_painel_ultimas_triagens_por_paciente;

-- 9.7 Série Mensal de Triagens e Indicadores
create or replace view public.vw_painel_serie_mensal
with (security_invoker = true)
as
select
  to_char(date_trunc('month', data_hora), 'YYYY-MM') as ano_mes,
  to_char(date_trunc('month', data_hora), 'Mon/YY') as rotulo_mes,
  count(*)::integer as total_triagens,
  count(distinct lower(trim(nome_paciente)) || '|' || coalesce(data_nascimento::text, ''))::integer as total_pessoas,
  count(*) filter (where pa_sistolica >= 140 or pa_diastolica >= 90)::integer as qtd_hipertensao,
  round(count(*) filter (where pa_sistolica >= 140 or pa_diastolica >= 90)::numeric / nullif(count(*), 0) * 100, 1) as perc_hipertensao,
  count(*) filter (where imc >= 25.0)::integer as qtd_sobrepeso_obesidade,
  round(count(*) filter (where imc >= 25.0)::numeric / nullif(count(*), 0) * 100, 1) as perc_sobrepeso_obesidade
from public.triagens
where not excluido
group by date_trunc('month', data_hora)
order by date_trunc('month', data_hora) asc;

-- 9.8 Recortes por Empresa com Regra de Corte LGPD (< 5 pessoas oculta indicadores)
create or replace view public.vw_painel_recortes_empresa
with (security_invoker = true)
as
select
  coalesce(nullif(trim(empresa), ''), 'Não informada') as grupo,
  count(*)::integer as total_pessoas,
  case when count(*) >= 5 then
    round(count(*) filter (where pa_sistolica >= 140 or pa_diastolica >= 90)::numeric / count(*) * 100, 1)
  else null end as perc_hipertensao,
  case when count(*) >= 5 then
    round(count(*) filter (where (pa_sistolica between 120 and 139) or (pa_diastolica between 80 and 89))::numeric / count(*) * 100, 1)
  else null end as perc_pre_hipertensao,
  case when count(*) >= 5 then
    round(count(*) filter (where imc >= 25.0)::numeric / count(*) * 100, 1)
  else null end as perc_sobrepeso,
  case when count(*) >= 5 then
    round(count(*) filter (where imc >= 30.0)::numeric / count(*) * 100, 1)
  else null end as perc_obesidade,
  case when count(*) >= 5 then
    round(avg(freq_cardiaca), 0)
  else null end as fc_media,
  (count(*) < 5) as indicadores_ocultos_lgpd
from public.vw_painel_ultimas_triagens_por_paciente
group by coalesce(nullif(trim(empresa), ''), 'Não informada')
order by count(*) desc;

-- 9.9 Exportações CSV (Anonimizada LGPD e Completa)
create or replace view public.vw_exportacao_anonimizada
with (security_invoker = true)
as
select
  codigo_acesso as codigo,
  to_char(data_hora at time zone 'America/Fortaleza', 'DD/MM/YYYY') as data,
  to_char(data_hora at time zone 'America/Fortaleza', 'HH24:MI') as hora,
  idade,
  sexo,
  empresa,
  tipo_exame,
  replace(round(peso_kg, 1)::text, '.', ',') as peso_kg,
  replace(round(altura_cm, 1)::text, '.', ',') as altura_cm,
  replace(round(imc, 1)::text, '.', ',') as imc,
  pa_sistolica,
  pa_diastolica,
  classificacao_pa,
  freq_cardiaca
from public.vw_triagens_detalhadas
where not excluido
order by ts asc;

create or replace view public.vw_exportacao_completa
with (security_invoker = true)
as
select
  codigo_acesso as codigo,
  to_char(data_hora at time zone 'America/Fortaleza', 'DD/MM/YYYY') as data,
  to_char(data_hora at time zone 'America/Fortaleza', 'HH24:MI') as hora,
  nome_paciente as nome,
  coalesce(to_char(data_nascimento, 'DD/MM/YYYY'), '') as nascimento,
  idade,
  sexo,
  empresa,
  tipo_exame,
  replace(round(peso_kg, 1)::text, '.', ',') as peso_kg,
  replace(round(altura_cm, 1)::text, '.', ',') as altura_cm,
  replace(round(imc, 1)::text, '.', ',') as imc,
  pa_sistolica,
  pa_diastolica,
  classificacao_pa,
  freq_cardiaca,
  observacoes,
  profissional_responsavel as profissional
from public.vw_triagens_detalhadas
where not excluido
order by ts asc;

-- 9.10 VIEW INTEGRADA: Jornada Unificada do Colaborador (Presença + Massoterapia + Triagem)
create or replace view public.vw_jornada_integrada
with (security_invoker = true)
as
select
  coalesce(p.id, t.id) as referencia_id,
  p.id as presenca_id,
  t.id as triagem_id,
  t.codigo_acesso as codigo_triagem,
  coalesce(p.nome, t.nome_paciente) as nome_colaborador,
  coalesce(nullif(p.celular, ''), pac.celular, '') as celular,
  coalesce(p.empresa, t.empresa, 'Não informada') as empresa,
  coalesce(p.servicos, '{}'::text[]) as procedimentos_bem_estar,
  (p.id is not null) as passou_presenca,
  (t.id is not null and not coalesce(t.excluido, false)) as passou_triagem,
  coalesce(p.status_fluxo, case when t.id is not null then 'triagem_concluida' else 'registrado' end) as status_jornada,
  t.status as status_medico,
  coalesce(t.alerta_pa_grave, false) as alerta_pa_grave,
  coalesce(p.created_at, t.data_hora) as primeiro_registro_em,
  greatest(coalesce(p.updated_at, p.created_at), coalesce(t.updated_at, t.data_hora)) as ultima_atualizacao_em
from public.presencas_evento p
full outer join public.triagens t
  on (t.id = p.triagem_id or p.id = t.presenca_id) and not coalesce(t.excluido, false)
left join public.pacientes pac
  on pac.id = coalesce(p.paciente_id, t.paciente_id)
order by greatest(coalesce(p.updated_at, p.created_at), coalesce(t.updated_at, t.data_hora)) desc;

-- 9.11 VIEW INTEGRADA: Resumo Executivo por Empresa (Presença + Bem-Estar + Triagem LGPD)
create or replace view public.vw_painel_integrado_empresas
with (security_invoker = true)
as
with pres_emp as (
  select
    lower(trim(empresa)) as chave_emp,
    max(trim(empresa)) as nome_empresa,
    count(*)::integer as participantes_presenca,
    coalesce(sum(coalesce(array_length(servicos, 1), 0)), 0)::integer as procedimentos_realizados
  from public.presencas_evento
  group by lower(trim(empresa))
),
tri_emp as (
  select
    lower(trim(coalesce(nullif(empresa, ''), 'Não informada'))) as chave_emp,
    max(coalesce(nullif(trim(empresa), ''), 'Não informada')) as nome_empresa,
    count(*)::integer as pessoas_triadas,
    case when count(*) >= 5 then
      round(count(*) filter (where pa_sistolica >= 140 or pa_diastolica >= 90)::numeric / count(*) * 100, 1)
    else null end as perc_hipertensao,
    case when count(*) >= 5 then
      round(count(*) filter (where imc >= 25.0)::numeric / count(*) * 100, 1)
    else null end as perc_acima_peso
  from public.vw_painel_ultimas_triagens_por_paciente
  group by lower(trim(coalesce(nullif(empresa, ''), 'Não informada')))
)
select
  coalesce(p.nome_empresa, t.nome_empresa) as empresa,
  coalesce(p.participantes_presenca, 0) as participantes_presenca,
  coalesce(p.procedimentos_realizados, 0) as procedimentos_bem_estar,
  coalesce(t.pessoas_triadas, 0) as pessoas_triadas,
  t.perc_hipertensao,
  t.perc_acima_peso,
  (coalesce(t.pessoas_triadas, 0) > 0 and coalesce(t.pessoas_triadas, 0) < 5) as indicadores_ocultos_lgpd
from pres_emp p
full outer join tri_emp t on t.chave_emp = p.chave_emp
order by (coalesce(p.participantes_presenca, 0) + coalesce(t.pessoas_triadas, 0)) desc;

-- ----------------------------------------------------------------------------
-- 10. PERMISSÕES DA DATA API & ROW LEVEL SECURITY (RLS EM TODAS AS TABELAS)
-- ----------------------------------------------------------------------------

alter table public.configuracoes enable row level security;
alter table public.usuarios enable row level security;
alter table public.profissionais enable row level security;
alter table public.empresas enable row level security;
alter table public.pacientes enable row level security;
alter table public.eventos_saude enable row level security;
alter table public.servicos_evento enable row level security;
alter table public.presencas_evento enable row level security;
alter table public.triagens enable row level security;
alter table public.consultas_medicas enable row level security;
alter table public.auditoria_triagens enable row level security;

-- Permissões no schema public para PostgREST / Supabase Data API
grant usage on schema public to anon, authenticated;

-- Tabelas de recepção rápida de eventos (acesso público/autenticado controlado por RLS)
grant select, insert, update, delete on table public.servicos_evento to anon, authenticated;
grant select, insert, update, delete on table public.presencas_evento to anon, authenticated;
grant select, insert, update on table public.eventos_saude to anon, authenticated;
grant select, insert on table public.empresas to anon, authenticated;
grant select on table public.configuracoes to anon, authenticated;
grant update on table public.configuracoes to authenticated;

-- Tabelas clínicas sensíveis (LGPD: restritas a profissionais autenticados; usuarios nunca exposto ao anon)
revoke all on table public.usuarios from anon, authenticated;
grant select, insert, update on table public.pacientes to authenticated;
grant select, insert, update on table public.profissionais to authenticated;
grant select on table public.triagens to anon, authenticated;
grant insert, update on table public.triagens to authenticated;
grant select, insert, update on table public.consultas_medicas to authenticated;
grant select, insert on table public.auditoria_triagens to authenticated;

-- Permissões de leitura nas Views (protegidas pelo security_invoker = true das tabelas base)
grant select on table public.vw_resumo_evento to anon, authenticated;
grant select on table public.vw_resumo_por_servico to anon, authenticated;
grant select on table public.vw_triagens_detalhadas to authenticated;
grant select on table public.vw_fila_atendimentos_hoje to authenticated;
grant select on table public.vw_painel_ultimas_triagens_por_paciente to authenticated;
grant select on table public.vw_painel_indicadores_gerais to authenticated;
grant select on table public.vw_painel_serie_mensal to authenticated;
grant select on table public.vw_painel_recortes_empresa to authenticated;
grant select on table public.vw_exportacao_anonimizada to authenticated;
grant select on table public.vw_exportacao_completa to authenticated;
grant select on table public.vw_jornada_integrada to authenticated;
grant select on table public.vw_painel_integrado_empresas to authenticated;

-- 10.1 Políticas RLS: configuracoes
drop policy if exists "rls_configuracoes_select" on public.configuracoes;
create policy "rls_configuracoes_select"
  on public.configuracoes for select
  to anon, authenticated
  using (ativo = true);

drop policy if exists "rls_configuracoes_update_admin" on public.configuracoes;
create policy "rls_configuracoes_update_admin"
  on public.configuracoes for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'administrador')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'administrador');

-- 10.2 Políticas RLS: servicos_evento, eventos_saude e presencas_evento (operação ágil em eventos)
drop policy if exists "Permitir leitura de servicos no evento" on public.servicos_evento;
create policy "Permitir leitura de servicos no evento"
  on public.servicos_evento for select
  to anon, authenticated
  using (true);

drop policy if exists "Permitir cadastro de novos servicos no evento" on public.servicos_evento;
create policy "Permitir cadastro de novos servicos no evento"
  on public.servicos_evento for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Permitir atualizacao de servicos no evento" on public.servicos_evento;
create policy "Permitir atualizacao de servicos no evento"
  on public.servicos_evento for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Permitir exclusao de servicos no evento" on public.servicos_evento;
create policy "Permitir exclusao de servicos no evento"
  on public.servicos_evento for delete
  to anon, authenticated
  using (true);

drop policy if exists "rls_eventos_saude_select" on public.eventos_saude;
create policy "rls_eventos_saude_select"
  on public.eventos_saude for select
  to anon, authenticated
  using (true);

drop policy if exists "rls_eventos_saude_write" on public.eventos_saude;
create policy "rls_eventos_saude_write"
  on public.eventos_saude for insert
  to anon, authenticated
  with check (true);

drop policy if exists "rls_eventos_saude_update" on public.eventos_saude;
create policy "rls_eventos_saude_update"
  on public.eventos_saude for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Permitir leitura da lista de presenca" on public.presencas_evento;
create policy "Permitir leitura da lista de presenca"
  on public.presencas_evento for select
  to anon, authenticated
  using (true);

drop policy if exists "Permitir registro de presenca" on public.presencas_evento;
create policy "Permitir registro de presenca"
  on public.presencas_evento for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Permitir atualizacao de presenca e servicos" on public.presencas_evento;
create policy "Permitir atualizacao de presenca e servicos"
  on public.presencas_evento for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Permitir exclusao de presenca" on public.presencas_evento;
create policy "Permitir exclusao de presenca"
  on public.presencas_evento for delete
  to anon, authenticated
  using (true);

-- 10.3 Políticas RLS: empresas (compartilhada entre recepção de eventos e clínica)
drop policy if exists "rls_empresas_select" on public.empresas;
create policy "rls_empresas_select"
  on public.empresas for select
  to anon, authenticated
  using (ativo = true);

drop policy if exists "rls_empresas_insert" on public.empresas;
create policy "rls_empresas_insert"
  on public.empresas for insert
  to anon, authenticated
  with check (char_length(trim(razao_social)) > 0);

drop policy if exists "rls_empresas_update" on public.empresas;
create policy "rls_empresas_update"
  on public.empresas for update
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- 10.4 Políticas RLS: pacientes, profissionais, triagens, consultas_medicas e auditoria (LGPD)
drop policy if exists "rls_pacientes_equipe_select" on public.pacientes;
create policy "rls_pacientes_equipe_select"
  on public.pacientes for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "rls_pacientes_equipe_insert" on public.pacientes;
create policy "rls_pacientes_equipe_insert"
  on public.pacientes for insert
  to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "rls_pacientes_equipe_update" on public.pacientes;
create policy "rls_pacientes_equipe_update"
  on public.pacientes for update
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "rls_profissionais_equipe_select" on public.profissionais;
create policy "rls_profissionais_equipe_select"
  on public.profissionais for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "rls_profissionais_admin_write" on public.profissionais;
create policy "rls_profissionais_admin_write"
  on public.profissionais for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'administrador')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'administrador');

drop policy if exists "rls_triagens_qrcode_anon" on public.triagens;
create policy "rls_triagens_qrcode_anon"
  on public.triagens for select
  to anon
  using (
    not excluido
    and codigo_acesso = coalesce((select current_setting('request.headers', true)::json ->> 'x-codigo-triagem'), '')
  );

drop policy if exists "rls_triagens_profissionais_select" on public.triagens;
create policy "rls_triagens_profissionais_select"
  on public.triagens for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "rls_triagens_profissionais_insert" on public.triagens;
create policy "rls_triagens_profissionais_insert"
  on public.triagens for insert
  to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "rls_triagens_profissionais_update" on public.triagens;
create policy "rls_triagens_profissionais_update"
  on public.triagens for update
  to authenticated
  using ((select auth.uid()) is not null and not excluido)
  with check ((select auth.uid()) is not null);

drop policy if exists "rls_consultas_medicas_equipe" on public.consultas_medicas;
create policy "rls_consultas_medicas_equipe"
  on public.consultas_medicas for all
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "rls_auditoria_triagens_select" on public.auditoria_triagens;
create policy "rls_auditoria_triagens_select"
  on public.auditoria_triagens for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "rls_auditoria_triagens_insert" on public.auditoria_triagens;
create policy "rls_auditoria_triagens_insert"
  on public.auditoria_triagens for insert
  to authenticated
  with check ((select auth.uid()) is not null);

-- ----------------------------------------------------------------------------
-- 11. REALTIME SUPABASE (SINCRONIZAÇÃO AO VIVO ENTRE DISPOSITIVOS)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presencas_evento'
    ) then
      alter publication supabase_realtime add table public.presencas_evento;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'triagens'
    ) then
      alter publication supabase_realtime add table public.triagens;
    end if;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 12. CARGA INICIAL (SEED DATA UNIFICADO)
-- ----------------------------------------------------------------------------

-- 12.1 Configuração Geral
insert into public.configuracoes (id, clinica, unidade, url, modo, evento_titulo)
values (
  'geral',
  'EcoSafety & EcoClinic — Saúde Ocupacional',
  'Matriz',
  '',
  'link',
  'Lista de Presença — Massoterapia'
)
on conflict (id) do nothing;

-- 12.2 Catálogo de Procedimentos e Serviços
insert into public.servicos_evento (nome, categoria, ordem)
values
  ('Massoterapia', 'bem_estar', 1),
  ('Ventosaterapia', 'bem_estar', 2),
  ('Quick Massage', 'bem_estar', 3),
  ('Liberação Miofascial', 'bem_estar', 4),
  ('Auriculoterapia', 'bem_estar', 5),
  ('Alongamento / Relaxamento', 'bem_estar', 6),
  ('Triagem de Enfermagem', 'triagem', 7)
on conflict (nome) do nothing;

-- 12.3 Empresa Padrão (idempotente com ux_empresas_razao_social_lower)
insert into public.empresas (razao_social, nome_fantasia, setor_atividade)
select 'EcoSafety Saúde e Segurança do Trabalho Ltda', 'EcoSafety', 'SST e Bem-Estar'
where not exists (
  select 1 from public.empresas
  where lower(trim(razao_social)) = lower('EcoSafety Saúde e Segurança do Trabalho Ltda')
);

-- Limpeza automática de eventuais registros fictícios de demonstração anteriores
delete from public.triagens where codigo_acesso in ('EX001', 'EX002', 'EX003', 'EX004', 'EX005');
delete from public.empresas where nome_fantasia in (
  'Salineira Exemplo',
  'Construtora Exemplo',
  'Revenda de GLP Exemplo',
  'Indústria Exemplo',
  'Prestadora de Serviços Exemplo'
);
delete from public.profissionais where email in ('enfermeiro@ecoclinic.com.br', 'medico@ecoclinic.com.br');
delete from public.usuarios where email in ('admin@ecoclinic.com.br', 'enfermeiro@ecoclinic.com.br', 'medico@ecoclinic.com.br');

-- ============================================================================
-- FIM DO SCRIPT SQL UNIFICADO ECOSAFETY & ECOCLINIC
-- ============================================================================
