# Backend do diagnóstico e do painel

Um Postgres e duas Edge Functions:

| Função | Quem chama | O que faz |
|---|---|---|
| `diagnostico` | o site, sem login | `GET` devolve o formulário; `POST` grava o lead e pede o pré-diagnóstico |
| `painel` | `/painel`, com senha | CRM, editor do formulário, instruções e PDFs da IA, área de teste |

Código comum em `functions/_shared/`.

## A ordem importa

O lead é gravado **antes** de qualquer chamada à OpenAI. O pré-diagnóstico
roda depois da resposta ao navegador (`EdgeRuntime.waitUntil`). Se a OpenAI
falhar, o lead fica com `pre_status = 'erro'` e o motivo em `pre_erro`, e o
painel oferece "Gerar de novo".

## Subir

```bash
npx supabase login
npx supabase link --project-ref ixhkxejqqeinhpvobtsx
npx supabase db push

npx supabase secrets set \
  PAINEL_SENHA='uma-senha-longa' \
  OPENAI_API_KEY=sk-... \
  SITE_ORIGIN=https://feitto.com.br \
  RATE_LIMIT_SALT="$(openssl rand -hex 16)" \
  POLITICA_VERSAO=2026-10-28

npx supabase secrets unset CLICKUP_TOKEN CLICKUP_LIST_ID

npx supabase functions deploy diagnostico
npx supabase functions deploy painel
```

`RATE_LIMIT_SALT` já existe em produção: só gere outro se quiser zerar o
limite por IP. `SITE_ORIGIN` aceita vários endereços separados por vírgula,
com `*` no pedaço que a hospedagem gera (ver `_shared/http.ts`).

## A senha do painel

`PAINEL_SENHA` precisa ter pelo menos 8 caracteres; abaixo disso o login
fica desligado. Trocar a senha derruba todas as sessões abertas, porque o
token é assinado com uma chave derivada dela. A sessão dura 12 horas. Dez
senhas erradas do mesmo IP em 15 minutos travam o login por esse tempo.

## A IA

- **Instruções e modelo**: editados no painel, aba IA. Cada gravação vira uma
  versão nova; o lead guarda qual versão o leu.
- **PDFs**: enviados pelo painel para a Files API da OpenAI (`purpose:
  user_data`) e anexados inteiros a cada chamada. Sem busca vetorial: com
  poucos documentos de instrução, mandar o PDF inteiro é mais previsível.
- **Formato da resposta**: fixo, em `_shared/prediagnostico.ts` (Structured
  Outputs com `strict`). Mudar os campos exige mexer ali e em
  `src/lib/painel/lead.ts`.
- **O que vai para a OpenAI**: só as respostas. Nome, WhatsApp e e-mail
  ficam de fora. A chamada usa `store: false`.

Sem `OPENAI_API_KEY`, tudo funciona, mas os leads chegam com `pre_status =
'sem_ia'`.

## O formulário no banco

`form_etapas` e `form_perguntas`. Cada pergunta tem uma `chave` fixa, gerada
pelo servidor, que é o nome do campo no envio. Nome, WhatsApp e e-mail têm
`sistema` preenchido: dá para mudar o texto e a posição, não o tipo nem
apagar.

Os leads guardam em `respostas` uma cópia do texto de cada pergunta como
estava no dia do envio. Editar o formulário não muda o que um lead antigo
respondeu.

Condições ("só aparece quando…") estão em `mostrar_se`. O painel ainda não
cria condições, só mostra e remove as três que vieram do formulário original.
Apagar uma pergunta da qual outra depende solta a dependente, que passa a
aparecer sempre.

## Proteções

| Camada | O que faz |
|---|---|
| CORS | só o domínio do site e o localhost do Astro chamam as funções |
| Honeypot | campo `sobrenome`, escondido; preenchido, responde 200 e descarta |
| Limite por IP | 3 envios por hora e 10 senhas erradas a cada 15 min, pelo hash do IP |
| Validação | toda resposta é conferida contra as perguntas e opções vigentes |
| Token | toda ação do painel, menos o login, exige o token assinado |
| RLS | nenhuma tabela tem policy: anon e authenticated não leem nada |

## Testes

```bash
npm run test:funcoes   # tipos das funções + validação do envio
npm run test:painel    # formulário e painel num Chromium, com backend simulado
```

A migração foi testada num Postgres em memória (PGlite) com leads no formato
antigo: as respostas são reescritas com o texto das perguntas, e status e
observação interna são mantidos.
