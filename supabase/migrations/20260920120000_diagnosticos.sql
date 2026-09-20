-- ---------------------------------------------------------------------------
-- Diagnósticos de entrada do site.
--
-- Nada aqui é lido pelo navegador: a tabela fica com RLS ligado e sem nenhuma
-- policy, então anon e authenticated não enxergam linha alguma. Só a Edge
-- Function, que usa a service role, escreve. É o bastante para atender ao
-- princípio de acesso mínimo do art. 46 da LGPD.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create type public.momento_negocio as enum ('em_operacao', 'estruturando');

create type public.status_leitura as enum (
  'novo',        -- recebido, ainda não lido
  'lido',        -- a Luana leu
  'com_fit',     -- contato aberto
  'sem_fit',     -- devolvido com clareza
  'arquivado'
);

create table public.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  -- etapa 08 · contato
  nome text not null,
  whatsapp text not null,
  email text not null,
  empresa text,
  papel text not null,
  chegada text not null,
  indicou text,

  -- etapa 01 · momento
  momento public.momento_negocio not null,
  frase text not null,

  -- etapa 02 · o que trava
  obstaculo text,
  adiando text,

  -- etapas 03 e 04 · comercial e liderança
  processo text not null,
  consultoria_antes text,
  rotina text not null,
  contrataria text not null,

  -- etapa 05 · operação (faturamento e renda são mutuamente exclusivos)
  faturamento text,
  renda_pessoal text,
  equipe text not null,
  segmento text not null,
  segmento_outro text,

  -- etapa 06 · custo e urgência
  deixou_na_mesa text,
  prazo text not null,

  -- etapa 07 · compromisso
  compromisso text not null,

  -- prova de consentimento (art. 8º, §1º)
  consentimento boolean not null,
  consentimento_em timestamptz not null default now(),
  politica_versao text not null,

  -- acompanhamento
  status public.status_leitura not null default 'novo',
  observacao_interna text,

  -- espelho no CRM
  clickup_task_id text,
  clickup_url text,
  clickup_sincronizado_em timestamptz,
  clickup_erro text,

  constraint consentimento_obrigatorio check (consentimento is true),

  -- a bifurcação do formulário vale também no banco: quem opera informa
  -- faturamento, quem está fundando informa renda. Nunca os dois.
  constraint porte_coerente_com_momento check (
    (momento = 'em_operacao' and faturamento is not null and renda_pessoal is null)
    or
    (momento = 'estruturando' and renda_pessoal is not null and faturamento is null)
  )
);

create index diagnosticos_criado_em_idx on public.diagnosticos (criado_em desc);
create index diagnosticos_status_idx on public.diagnosticos (status) where status = 'novo';
create index diagnosticos_pendente_crm_idx on public.diagnosticos (criado_em)
  where clickup_task_id is null;

alter table public.diagnosticos enable row level security;
-- sem policies, de propósito: ninguém alcança esta tabela com a chave pública.

comment on table public.diagnosticos is
  'Respostas do filtro de entrada. Sem policies de RLS: acesso só pela service role.';
comment on column public.diagnosticos.renda_pessoal is
  'Só para a Jornada de Fundação. Faixa, nunca valor exato.';
comment on column public.diagnosticos.politica_versao is
  'Versão da Política de Privacidade vigente no momento do aceite.';

-- ---------------------------------------------------------------------------
-- Controle de abuso.
--
-- Guarda o hash do IP, e não o IP. Serve para segurar enxurrada de envios e
-- some sozinho em 24 h — o mínimo necessário, pelo tempo mínimo necessário.
-- ---------------------------------------------------------------------------

create table public.envio_limite (
  ip_hash text not null,
  criado_em timestamptz not null default now()
);

create index envio_limite_busca_idx on public.envio_limite (ip_hash, criado_em desc);

alter table public.envio_limite enable row level security;

comment on table public.envio_limite is
  'Hash de IP para limitar envios. Expurgada a cada 24 h pela própria função.';

create or replace function public.limpar_envio_limite()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.envio_limite where criado_em < now() - interval '24 hours';
$$;
