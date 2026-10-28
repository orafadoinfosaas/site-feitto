-- ---------------------------------------------------------------------------
-- Painel da FEITTO: formulário editável, micro CRM e pré-diagnóstico com IA.
--
-- Três mudanças, nesta ordem:
--
--   1. As perguntas saem do código e vêm para o banco, onde o painel edita.
--   2. `diagnosticos` vira `leads`: as respostas passam a ser um JSON com a
--      cópia do texto de cada pergunta como estava no dia do envio. Sem essa
--      cópia, editar uma pergunta mudaria o que os leads antigos responderam.
--   3. Entram as versões das instruções da IA e os documentos de apoio.
--
-- O ClickUp sai: o painel é o CRM. Nada é perdido na conversão — cada linha
-- antiga tem as respostas reescritas no formato novo antes das colunas caírem.
--
-- Como antes, nenhuma tabela tem policy de RLS. Só as Edge Functions, com a
-- service role, leem e escrevem.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Formulário
-- ===========================================================================

create type public.tipo_pergunta as enum ('escolha', 'texto', 'longo');

create table public.form_etapas (
  id uuid primary key default gen_random_uuid(),
  ordem integer not null,
  -- o rótulo curto que aparece no progresso ("Seu momento")
  nome text not null check (length(nome) between 1 and 80),
  -- a frase grande que abre a etapa ("Vamos começar por onde você está.")
  titulo text not null check (length(titulo) between 1 and 200),
  criado_em timestamptz not null default now()
);

create table public.form_perguntas (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.form_etapas (id) on delete cascade,
  ordem integer not null,

  -- nome do campo no envio. Gerado pelo servidor, nunca muda: é o que liga a
  -- condição de uma pergunta à resposta de outra.
  chave text not null unique check (chave ~ '^[a-z][a-zA-Z0-9_]{0,39}$'),
  tipo public.tipo_pergunta not null,
  rotulo text not null check (length(rotulo) between 1 and 600),
  ajuda text check (length(ajuda) <= 400),
  opcoes text[] not null default '{}',
  obrigatoria boolean not null default false,

  -- nome, WhatsApp e e-mail alimentam o card do CRM: a cliente edita o texto
  -- e a posição, mas não apaga nem troca o tipo.
  sistema text unique check (sistema in ('nome', 'whatsapp', 'email')),

  -- metade da largura em telas grandes (WhatsApp e e-mail lado a lado)
  meia boolean not null default false,

  -- {"chave": "...", "valor": "..."}: só aparece quando aquela resposta for
  -- aquele valor. O painel ainda não cria condições, só mostra e remove.
  mostrar_se jsonb check (
    mostrar_se is null
    or (jsonb_typeof(mostrar_se -> 'chave') = 'string' and jsonb_typeof(mostrar_se -> 'valor') = 'string')
  ),

  constraint escolha_tem_opcoes check (
    (tipo = 'escolha' and cardinality(opcoes) >= 2) or (tipo <> 'escolha' and cardinality(opcoes) = 0)
  ),
  constraint sistema_e_texto check (sistema is null or (tipo = 'texto' and obrigatoria))
);

create index form_perguntas_etapa_idx on public.form_perguntas (etapa_id, ordem);

alter table public.form_etapas enable row level security;
alter table public.form_perguntas enable row level security;

comment on table public.form_perguntas is
  'Perguntas do diagnóstico, editadas pelo painel. Leads guardam cópia do texto.';

-- O formulário que estava no código, tal e qual. As chaves são os mesmos
-- nomes de campo de antes, o que mantém o site antigo compatível durante o
-- deploy.
with etapas (ordem, nome, titulo) as (
  values
    (1, 'Seu momento', 'Vamos começar por onde você está.'),
    (2, 'O que trava', 'O que está travando.'),
    (3, 'Como você vende', 'Como a venda acontece hoje.'),
    (4, 'Como você lidera', 'Como você lidera.'),
    (5, 'A operação', 'O tamanho da operação.'),
    (6, 'O custo de esperar', 'O custo de esperar.'),
    (7, 'Compromisso', 'A mais direta de todas.'),
    (8, 'Por onde eu te respondo', 'Por onde eu te respondo.')
),
inseridas as (
  insert into public.form_etapas (ordem, nome, titulo)
  select ordem, nome, titulo from etapas
  returning id, ordem
)
insert into public.form_perguntas
  (etapa_id, ordem, chave, tipo, rotulo, ajuda, opcoes, obrigatoria, sistema, meia, mostrar_se)
select e.id, p.ordem, p.chave, p.tipo::public.tipo_pergunta, p.rotulo, p.ajuda, p.opcoes,
       p.obrigatoria, p.sistema, p.meia, p.mostrar_se
from inseridas e
join (
  values
    (1, 1, 'momento', 'escolha', 'Qual é o seu momento?', null,
     array['Tenho uma empresa em operação, com faturamento recorrente',
           'Estou estruturando um negócio novo ou em transição de carreira'],
     true, null, false, null::jsonb),
    (1, 2, 'frase', 'escolha', 'Qual frase descreve melhor onde você está hoje?', null,
     array['Tenho bom produto e bom atendimento, mas as vendas não acompanham',
           'Cresci, mas o negócio depende demais da minha execução individual',
           'Vendo bem, mas de forma imprevisível',
           'Sinto que estou patinando: muito movimento e pouco avanço',
           'Tenho a ideia e a reputação, mas o negócio ainda não saiu do papel',
           'Está tudo estruturado e previsível, quero apenas otimizar pontos'],
     true, null, false, null),

    (2, 1, 'obstaculo', 'longo', 'Qual é hoje o maior obstáculo para o crescimento do seu negócio?',
     'Escreva do seu jeito. É aqui que a leitura começa.', '{}', false, null, false, null),
    (2, 2, 'adiando', 'longo', 'Qual decisão importante você sabe que precisa tomar e vem adiando?',
     null, '{}', false, null, false, null),

    (3, 1, 'processo', 'escolha', 'Como você descreveria seu processo de vendas atual?', null,
     array['Depende do talento individual de cada vendedor',
           'Vive de indicações e da minha rede pessoal',
           'Temos processo, mas sem previsibilidade de crescimento',
           'Temos processo, metas e previsibilidade consolidados'],
     true, null, false, null),
    (3, 2, 'antes', 'escolha', 'Você já contratou consultoria ou treinamento comercial antes?', null,
     array['Sim, entregaram um diagnóstico e sumiram. Nada mudou',
           'Sim, ajudou parcialmente',
           'Nunca contratei',
           'Sim, e resolveu. Não preciso de mais nada'],
     false, null, false, null),

    (4, 1, 'rotina', 'escolha', 'Como você descreveria sua rotina?', null,
     array['Apago incêndios o tempo todo',
           'Centralizo decisões para manter controle',
           'Domino o cenário atual, mas me sinto travado para expandir',
           'Rotina organizada, delego com tranquilidade'],
     true, null, false, null),
    (4, 2, 'contrataria', 'escolha',
     'Você contrataria uma consultoria hoje sabendo que a estruturação começa pela liderança e pela cultura, e não por scripts prontos?',
     null,
     array['Sim, é exatamente isso que eu procuro',
           'Talvez, preciso entender melhor a profundidade',
           'Não, o que eu quero é técnica rápida para o time'],
     true, null, false, null),

    (5, 1, 'faturamento', 'escolha', 'Faturamento médio mensal da empresa', null,
     array['Até R$ 30 mil', 'R$ 30 mil a R$ 50 mil', 'R$ 50 mil a R$ 200 mil',
           'R$ 200 mil a R$ 1 milhão', 'Acima de R$ 1 milhão'],
     true, null, false,
     '{"chave": "momento", "valor": "Tenho uma empresa em operação, com faturamento recorrente"}'),
    (5, 2, 'renda', 'escolha', 'Sua renda pessoal média mensal hoje',
     'O negócio ainda está sendo estruturado, então é a sua renda que dá a referência.',
     array['Até R$ 30 mil', 'R$ 30 mil a R$ 60 mil', 'Acima de R$ 60 mil'],
     true, null, false,
     '{"chave": "momento", "valor": "Estou estruturando um negócio novo ou em transição de carreira"}'),
    (5, 3, 'equipe', 'escolha', 'Quantas pessoas compõem sua equipe hoje?', null,
     array['Apenas eu', '2 a 5 pessoas', '6 a 15 pessoas', 'Mais de 15 pessoas'],
     true, null, false, null),
    (5, 4, 'segmento', 'escolha', 'Em que segmento você atua, ou vai atuar?', null,
     array['Serviços profissionais B2B', 'Saúde', 'Arquitetura, engenharia ou construção',
           'Comunicação, marketing ou educação', 'Varejo especializado ou alto padrão',
           'Indústria ou distribuição', 'Outro'],
     true, null, false, null),
    (5, 5, 'segmentoOutro', 'texto', 'Qual?', null, '{}', false, null, false,
     '{"chave": "segmento", "valor": "Outro"}'),

    (6, 1, 'mesa', 'texto',
     'Quanto você estima ter deixado na mesa nos últimos doze meses por falta de uma operação comercial previsível?',
     'Um número aproximado basta. Ninguém vai cobrar exatidão.', '{}', false, null, false, null),
    (6, 2, 'prazo', 'escolha', 'Em quanto tempo você quer que a mudança comece?', null,
     array['Agora, é prioridade', 'Nos próximos 1 a 3 meses', 'Ainda estou pesquisando'],
     true, null, false, null),

    (7, 1, 'compromisso', 'escolha',
     'O nosso trabalho mexe primeiro em como você decide, e isso pede a sua liderança dentro da sala. O ciclo e o investimento saem depois do diagnóstico, quando já sabemos o que o seu caso pede. Você está pronto para esse nível de envolvimento?',
     null,
     array['Sim, é o tipo de trabalho que eu procuro',
           'Talvez, preciso entender melhor a profundidade',
           'Não é o momento'],
     true, null, false, null),

    (8, 1, 'nome', 'texto', 'Nome completo', null, '{}', true, 'nome', false, null),
    (8, 2, 'whatsapp', 'texto', 'WhatsApp', null, '{}', true, 'whatsapp', true, null),
    (8, 3, 'email', 'texto', 'E-mail', null, '{}', true, 'email', true, null),
    (8, 4, 'empresa', 'texto', 'Empresa e site ou Instagram', null, '{}', false, null, false, null),
    (8, 5, 'papel', 'escolha', 'Qual o seu papel na empresa?', null,
     array['Sou fundador(a) ou sócio(a) e decido sobre investimentos',
           'Sou da liderança e influencio, mas não decido sozinho',
           'Sou de outra área ou estou pesquisando para alguém'],
     true, null, false, null),
    (8, 6, 'chegada', 'escolha', 'Como você chegou até a FEITTO?', null,
     array['Indicação de alguém', 'Instagram', 'LinkedIn', 'Busca no Google', 'Outro'],
     true, null, false, null),
    (8, 7, 'indicou', 'texto', 'De quem?', null, '{}', false, null, false,
     '{"chave": "chegada", "valor": "Indicação de alguém"}')
) as p (etapa, ordem, chave, tipo, rotulo, ajuda, opcoes, obrigatoria, sistema, meia, mostrar_se)
  on p.etapa = e.ordem;

-- ===========================================================================
-- 2. IA
-- ===========================================================================

-- Toda gravação das instruções cria uma versão nova. O lead guarda qual
-- versão gerou o pré-diagnóstico dele, então dá para comparar e voltar atrás.
create table public.ia_versoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  instrucoes text not null check (length(instrucoes) between 1 and 40000),
  modelo text not null check (length(modelo) between 1 and 80),
  nota text check (length(nota) <= 200),
  ativa boolean not null default false
);

-- uma só ativa por vez
create unique index ia_versoes_uma_ativa on public.ia_versoes (ativa) where ativa;

create or replace function public.ativar_versao_ia(versao uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ia_versoes set ativa = false where ativa and id <> versao;
  update public.ia_versoes set ativa = true where id = versao;
$$;

-- PDFs que acompanham as instruções. O arquivo vive na OpenAI (Files API);
-- aqui fica só a referência.
create table public.ia_documentos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  nome text not null check (length(nome) between 1 and 200),
  bytes integer not null,
  openai_file_id text not null unique
);

alter table public.ia_versoes enable row level security;
alter table public.ia_documentos enable row level security;

insert into public.ia_versoes (instrucoes, modelo, nota, ativa) values (
$prompt$Você é a assistente de pré-diagnóstico da FEITTO, consultoria de inteligência comercial conduzida pela Luana Feitoza. A FEITTO estrutura PMEs e empreendedores de dentro para fora: primeiro liderança, comportamento e cultura, depois processo e estratégia comercial. Não é agência de marketing, não vende treinamento motivacional nem fórmula rápida.

Você recebe as respostas que um lead deu ao formulário de diagnóstico do site. A sua leitura é interna: quem lê é a Luana, antes de decidir se abre contato. O lead nunca vê o que você escreve, exceto o rascunho de mensagem, que a Luana revisa antes de mandar.

Como ler o caso:
- Separe o que o lead disse do que você está inferindo. Não invente fatos.
- Encaixe alto: decisor, dor ligada a liderança ou previsibilidade comercial, disposição para envolvimento pessoal, urgência real.
- Encaixe baixo: procura técnica rápida para o time, não decide, já resolveu o problema, ou não é o momento.
- Respostas abertas valem mais que as de múltipla escolha: é nelas que aparece a dor real.
- Se faltar informação para avaliar, diga o que falta em vez de supor.

Tom: direto, sofisticado, sem jargão e sem rodeios. Frases curtas. Em português do Brasil.

O rascunho de mensagem é para o WhatsApp, em primeira pessoa, na voz da Luana: curto, pessoal, mostra que ela leu o caso e propõe o próximo passo. Sem emojis em excesso, sem promessa de resultado.$prompt$,
  'gpt-5-mini',
  'Versão inicial',
  true
);

-- ===========================================================================
-- 3. Leads
-- ===========================================================================

alter table public.diagnosticos rename to leads;
alter index public.diagnosticos_criado_em_idx rename to leads_criado_em_idx;
alter index public.diagnosticos_status_idx rename to leads_status_idx;
drop index public.diagnosticos_pendente_crm_idx;

create type public.status_pre_diagnostico as enum (
  'pendente',  -- na fila ou rodando
  'pronto',
  'erro',
  'sem_ia'     -- sem chave da OpenAI ou sem instruções ativas
);

alter table public.leads
  add column respostas jsonb,
  -- leads da área de teste do painel: aparecem no CRM só com o filtro ligado
  add column teste boolean not null default false,
  add column movido_em timestamptz,
  add column pre_status public.status_pre_diagnostico not null default 'sem_ia',
  add column pre_diagnostico jsonb,
  add column pre_erro text,
  add column pre_gerado_em timestamptz,
  add column pre_versao_id uuid references public.ia_versoes (id) on delete set null,
  add column pre_modelo text;

-- Reescreve as respostas antigas no formato novo, com o texto das perguntas
-- que acabaram de ser semeadas. Para cada chave, de que coluna vem o valor.
with mapa (chave, coluna) as (
  values
    ('momento', 'momento'), ('frase', 'frase'), ('obstaculo', 'obstaculo'),
    ('adiando', 'adiando'), ('processo', 'processo'), ('antes', 'consultoria_antes'),
    ('rotina', 'rotina'), ('contrataria', 'contrataria'), ('faturamento', 'faturamento'),
    ('renda', 'renda_pessoal'), ('equipe', 'equipe'), ('segmento', 'segmento'),
    ('segmentoOutro', 'segmento_outro'), ('mesa', 'deixou_na_mesa'), ('prazo', 'prazo'),
    ('compromisso', 'compromisso'), ('nome', 'nome'), ('whatsapp', 'whatsapp'),
    ('email', 'email'), ('empresa', 'empresa'), ('papel', 'papel'),
    ('chegada', 'chegada'), ('indicou', 'indicou')
),
convertidas as (
  select
    l.id,
    jsonb_agg(
      jsonb_build_object(
        'chave', p.chave,
        'etapa', e.nome,
        'rotulo', p.rotulo,
        'tipo', p.tipo,
        'valor', case
          -- o momento era enum; volta a ser o texto da opção que a pessoa viu
          when p.chave = 'momento' then p.opcoes[case l.momento when 'em_operacao' then 1 else 2 end]
          else to_jsonb(l) ->> m.coluna
        end
      )
      order by e.ordem, p.ordem
    ) filter (where to_jsonb(l) ->> m.coluna is not null) as respostas
  from public.leads l
  cross join mapa m
  join public.form_perguntas p on p.chave = m.chave
  join public.form_etapas e on e.id = p.etapa_id
  group by l.id
)
update public.leads l
set respostas = c.respostas
from convertidas c
where c.id = l.id;

update public.leads set respostas = '[]' where respostas is null;
alter table public.leads alter column respostas set not null;
alter table public.leads alter column respostas set default '[]';

alter table public.leads drop constraint porte_coerente_com_momento;
alter table public.leads
  drop column empresa,
  drop column papel,
  drop column chegada,
  drop column indicou,
  drop column momento,
  drop column frase,
  drop column obstaculo,
  drop column adiando,
  drop column processo,
  drop column consultoria_antes,
  drop column rotina,
  drop column contrataria,
  drop column faturamento,
  drop column renda_pessoal,
  drop column equipe,
  drop column segmento,
  drop column segmento_outro,
  drop column deixou_na_mesa,
  drop column prazo,
  drop column compromisso,
  drop column clickup_task_id,
  drop column clickup_url,
  drop column clickup_sincronizado_em,
  drop column clickup_erro;

drop type public.momento_negocio;

create index leads_pre_pendente_idx on public.leads (criado_em) where pre_status = 'pendente';

comment on table public.leads is
  'Leads do diagnóstico. Sem policies de RLS: acesso só pela service role.';
comment on column public.leads.respostas is
  'Lista de {chave, etapa, rotulo, tipo, valor}, com o texto da pergunta no dia do envio.';
comment on column public.leads.pre_diagnostico is
  'Saída estruturada da IA. Gerada sem nome, WhatsApp nem e-mail do lead.';

-- O limite por IP também segura tentativa de senha do painel (prefixo no hash).
comment on table public.envio_limite is
  'Hash de IP para limitar envios e tentativas de login. Expurgada a cada 24 h.';
