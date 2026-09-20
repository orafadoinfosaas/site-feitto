# Backend do diagnóstico

Um Postgres para guardar o lead e uma Edge Function para receber o formulário
e espelhar no ClickUp.

## A ordem importa

A função grava no banco **antes** de chamar o ClickUp. Se o CRM estiver fora
do ar, a resposta ainda é sucesso e a linha fica com `clickup_erro`
preenchido, pronta para reenvio. O inverso perderia o lead por causa de um
serviço de terceiro.

## Subir

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push

npx supabase secrets set \
  CLICKUP_TOKEN=pk_xxx \
  CLICKUP_LIST_ID=901234567890 \
  SITE_ORIGIN=https://feitto.com.br \
  RATE_LIMIT_SALT="$(openssl rand -hex 16)" \
  POLITICA_VERSAO=2026-09-20

npx supabase functions deploy diagnostico
```

Depois é só apontar `PUBLIC_DIAGNOSTICO_ENDPOINT` no `.env` do site para
`https://<ref>.supabase.co/functions/v1/diagnostico`.

## Onde pegar cada coisa no ClickUp

- **Token**: foto de perfil → Settings → Apps → API Token
- **List ID**: abra a lista, o id é o número na URL
  (`app.clickup.com/9017166972/v/li/`**`901234567890`**)

## Proteções

| Camada | O que faz |
|---|---|
| CORS | só o domínio do site e o localhost do Astro postam |
| Honeypot | campo `sobrenome`, escondido; preenchido, responde 200 e descarta |
| Limite por IP | 3 envios por hora, pelo hash do IP, expurgado em 24 h |
| Validação | toda resposta de múltipla escolha é conferida contra a lista |
| RLS | tabela sem policies: anon e authenticated não leem nada |

O IP nunca é gravado — só o SHA-256 dele com um salt, e some sozinho em 24 h.

## Reenviar o que falhou

```sql
select id, nome, email, clickup_erro
from diagnosticos
where clickup_task_id is null
order by criado_em desc;
```

## Depois: o agente de leitura

O card do ClickUp já sai organizado na ordem em que a Luana lê. Quando o
agente entrar, ele substitui a seção "Leitura" do card com a análise do caso
— o resto da estrutura continua igual, e nada no formulário muda.
