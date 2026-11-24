-- ============================================================================
-- ECOSAFETY — SISTEMA DE LISTA DE PRESENÇA & MASSOTERAPIA
-- Script SQL completo para o Supabase (SQL Editor)
-- ============================================================================

-- 1. TABELA DE CATÁLOGO DE SERVIÇOS (Massoterapia, Ventosaterapia, etc.)
create table if not exists public.servicos_evento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (char_length(trim(nome)) > 0),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

-- Inserir os serviços padrão do evento (ignora se já existirem)
insert into public.servicos_evento (nome, ordem)
values
  ('Massoterapia', 1),
  ('Ventosaterapia', 2),
  ('Quick Massage', 3),
  ('Liberação Miofascial', 4),
  ('Auriculoterapia', 5),
  ('Alongamento / Relaxamento', 6)
on conflict (nome) do nothing;


-- 2. TABELA PRINCIPAL DE LISTA DE PRESENÇA E ATENDIMENTOS
create table if not exists public.presencas_evento (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) > 0),
  celular text not null check (char_length(trim(celular)) > 0),
  empresa text not null check (char_length(trim(empresa)) > 0),
  servicos text[] not null default '{}',
  observacoes text,
  evento_nome text not null default 'Lista de Presença & Massoterapia — EcoSafety',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- 3. ÍNDICES DE PERFORMANCE
-- Ordenação rápida pelos cadastros mais recentes
create index if not exists idx_presencas_evento_created_at
  on public.presencas_evento (created_at desc);

-- Busca e agrupamento por empresa
create index if not exists idx_presencas_evento_empresa
  on public.presencas_evento (empresa);

-- Índice GIN para filtrar rapidamente quem fez determinado serviço (ex: 'Ventosaterapia')
create index if not exists idx_presencas_evento_servicos_gin
  on public.presencas_evento using gin (servicos);


-- 4. TRIGGER AUTOMÁTICA PARA ATUALIZAR updated_at
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

drop trigger if exists trg_presencas_evento_updated_at on public.presencas_evento;
create trigger trg_presencas_evento_updated_at
  before update on public.presencas_evento
  for each row
  execute function public.handle_updated_at();


-- 5. VIEWS DE RELATÓRIO E DASHBOARD (com security_invoker = true)

-- Resumo geral: Total de participantes, empresas únicas e procedimentos realizados
create or replace view public.vw_resumo_evento
with (security_invoker = true)
as
select
  count(*)::integer as total_participantes,
  count(distinct lower(trim(empresa)))::integer as total_empresas,
  coalesce(sum(coalesce(array_length(servicos, 1), 0)), 0)::integer as total_procedimentos
from public.presencas_evento;

-- Contagem de atendimentos por tipo de serviço (Massoterapia, Ventosa, etc.)
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


-- 6. PERMISSÕES DA DATA API & ROW LEVEL SECURITY (RLS)
alter table public.servicos_evento enable row level security;
alter table public.presencas_evento enable row level security;

-- Garantir acesso via API REST (PostgREST) do Supabase
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.servicos_evento to anon, authenticated;
grant select, insert, update, delete on table public.presencas_evento to anon, authenticated;
grant select on table public.vw_resumo_evento to anon, authenticated;
grant select on table public.vw_resumo_por_servico to anon, authenticated;

-- Políticas RLS para operação rápida no evento (permite leitura e gravação via chave pública/autenticada)
drop policy if exists "Permitir leitura de servicos no evento" on public.servicos_evento;
create policy "Permitir leitura de servicos no evento"
  on public.servicos_evento
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Permitir cadastro de novos servicos no evento" on public.servicos_evento;
create policy "Permitir cadastro de novos servicos no evento"
  on public.servicos_evento
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Permitir exclusao de servicos no evento" on public.servicos_evento;
create policy "Permitir exclusao de servicos no evento"
  on public.servicos_evento
  for delete
  to anon, authenticated
  using (true);

drop policy if exists "Permitir leitura da lista de presenca" on public.presencas_evento;
create policy "Permitir leitura da lista de presenca"
  on public.presencas_evento
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Permitir registro de presenca" on public.presencas_evento;
create policy "Permitir registro de presenca"
  on public.presencas_evento
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Permitir atualizacao de presenca e servicos" on public.presencas_evento;
create policy "Permitir atualizacao de presenca e servicos"
  on public.presencas_evento
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Permitir exclusao de presenca" on public.presencas_evento;
create policy "Permitir exclusao de presenca"
  on public.presencas_evento
  for delete
  to anon, authenticated
  using (true);


-- 7. HABILITAR REALTIME (Sincronização ao vivo entre vários celulares)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'presencas_evento'
  ) then
    alter publication supabase_realtime add table public.presencas_evento;
  end if;
end $$;
