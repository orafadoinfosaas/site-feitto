# Site FEITTO

Site institucional da FEITTO, em Astro. Estático, sem framework de UI e sem
dependência de runtime além do `motion` (ainda não usado; a revelação de
blocos roda com `IntersectionObserver` e CSS).

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # gera dist/
npm run check    # tipos e diagnósticos do Astro
npm run test     # build + consentimento + cabeçalhos, em navegador real
```

## Rotas

| Rota | Arquivo | O que é |
|---|---|---|
| `/` | `src/pages/index.astro` | Início, onze seções |
| `/metodo` | `src/pages/metodo.astro` | Fases, ciclos, Janela de Alinhamento, fit, perguntas |
| `/quem-conduz` | `src/pages/quem-conduz.astro` | Luana, em primeira pessoa |
| `/casos` | `src/pages/casos.astro` | Os cinco casos |
| `/diagnostico` | `src/pages/diagnostico.astro` | Filtro de entrada, sete blocos |
| `/links` | `src/pages/links.astro` | Página de bio, fora do layout padrão |
| `/politica-de-privacidade` | `src/pages/politica-de-privacidade.astro` | Minuta LGPD |
| `/termos-de-uso` | `src/pages/termos-de-uso.astro` | Minuta |

`/diagnostico` e as duas páginas legais usam `bare` no layout: navegação
reduzida, sem menu completo, porque são destinos e não pontos de passagem.

## O sistema

`src/styles/global.css` é a fonte de verdade. Tudo é token.

**Paleta** — os seis tons do brandboard, mais um derivado: `--drift-ink`
(`#6B615B`). Driftwood puro sobre White Alyssum rende 3,2:1 e reprova em AA
para texto corrido; o derivado rende 4,8:1 e cobre todo texto pequeno.
Driftwood original fica nos numerais, filetes e faixas de marca.

**Tipografia** — as três famílias do brandboard:

- **Author** (Indian Type Foundry, Fontshare, licença livre) nos títulos.
  Os arquivos estão em `public/fonts/`, pesos 200, 300 e 400.
- **Outfit** no corpo e **Noto Serif Display** itálico nos destaques, via
  Google Fonts.

A Author tem altura de maiúscula curta (594/1000). Os tamanhos de título já
vêm compensados em ~8% em relação a uma grotesca comum — ao trocar a fonte,
recalibrar.

O serif entra em três lugares e em mais nenhum: a palavra que vira o sentido
do título (`<em class="key">`), a citação de cliente e a pergunta da seção da
solidão.

**O gesto** — toda seção abre com número, filete de 1px e rótulo em caixa
alta (`SectionRule.astro`). É a gramática de um relatório, e é o que faz o
site parecer o trabalho que a FEITTO entrega.

**Movimento** — opacidade 0→1 com y 18→0, 620ms, curva `(0.16, 1, 0.3, 1)`,
cascata de 70ms via `data-reveal-step`. Uma vez só, no primeiro encontro com
o bloco. `prefers-reduced-motion` desliga tudo, e `.no-js` garante que nada
fique invisível sem JavaScript.

**Limites** — sem card com sombra, sem canto arredondado grande, sem grade de
ícones, sem emoji. Gradiente só como máscara de legibilidade sobre fotografia.
Um bloco escuro por página, guardado para a virada do argumento.

## Backend do diagnóstico

Postgres para guardar o lead, Edge Function para receber o formulário e
espelhar no ClickUp. Detalhes e comandos em [`supabase/README.md`](supabase/README.md).

A função grava no banco **antes** de chamar o ClickUp. Se o CRM cair, a
resposta ainda é sucesso e a linha fica com `clickup_erro` preenchido, pronta
para reenvio — o inverso perderia o lead por causa de um serviço de terceiro.

Proteções: CORS restrito ao domínio, honeypot, limite de 3 envios por hora
por hash de IP, validação de toda múltipla escolha contra a lista de opções, e
RLS sem policies (anon e authenticated não leem nada). O IP nunca é gravado.

O `astro check` ignora `supabase/`: aquele código roda em Deno. Para verificar:

```bash
cd supabase/functions/diagnostico && npx deno@2 check *.ts
```

## MCP do Supabase

O `.mcp.json` sobe o servidor em `--read-only` e escopado a um único projeto.
Antes de abrir o Claude Code, exporte as duas variáveis:

```bash
export SUPABASE_PROJECT_REF=...     # ref do projeto
export SUPABASE_ACCESS_TOKEN=...    # supabase.com/dashboard/account/tokens
```

Veja `.env.example` para a lista completa do que precisa ser preenchido.

## Publicar

Imagem Docker em dois estágios: Node constrói, nginx serve. O runtime é o
`nginx-unprivileged`, que não roda como root e escuta na **8080**.

```bash
docker compose up --build   # confere em http://localhost:8080
```

### No EasyPanel

**1. App → Source**: este repositório, branch `main`, Dockerfile na raiz.

**2. Build Arguments** — e não variáveis de ambiente:

```
PUBLIC_DIAGNOSTICO_ENDPOINT = https://<ref>.supabase.co/functions/v1/diagnostico
PUBLIC_NOINDEX              = true
```

O Astro resolve as `PUBLIC_*` **durante o build**, porque o site é estático e
o valor entra no JavaScript gerado. Passar como variável de ambiente do
contêiner não surtiria efeito nenhum — o bundle já estaria pronto. Mudou o
endpoint, tem que reconstruir.

`PUBLIC_NOINDEX=true` põe `noindex, nofollow` em todas as páginas. Tirar
quando o domínio final entrar no ar.

**3. Porta**: o contêiner escuta em **80**, 8080 e 3000. O EasyPanel encaminha
para a 80 por padrão, então não há nada a configurar.

A imagem de runtime é o `nginx` oficial, e não o `nginx-unprivileged`: a 80 é
justamente a porta que um processo sem privilégio não consegue abrir. Só o
master roda como root, o tempo de fazer o bind; os workers descem para o
usuário `nginx`. Se preferir o contêiner inteiro sem root, troque a imagem
por `nginxinc/nginx-unprivileged` e aponte o domínio para a 8080.

**4. Liberar o domínio no CORS da Edge Function:**

```bash
npx supabase secrets set --project-ref <ref> \
  SITE_ORIGIN="https://feitto.com.br,https://<o-domínio-do-easypanel>"
```

Sem isso o formulário responde **403** fora de `feitto.com.br`. A lista aceita
`*` no lugar do sufixo que a hospedagem gera sozinha
(`https://site-feitto-*.dominio.com`); o curinga casa só com letras, números e
hífen, então não atravessa ponto nem barra.

### O que o nginx entrega

Cabeçalhos de segurança, CSP, compressão e cache imutável para fontes e
assets versionados estão em `docker/nginx.conf`. O HTML vai com
`must-revalidate`, senão uma correção demoraria a aparecer.

A CSP libera de antemão os domínios do GA4 e do Pixel: eles só sobem depois
do aceite, mas a política precisa permiti-los, senão o consentimento não
teria efeito prático.

Os cabeçalhos de segurança ficam em `docker/security-headers.conf` e são
incluídos em **cada** `location` que declara `add_header`. Não é redundância:
no nginx, um bloco que declara qualquer `add_header` para de herdar os de
cima. Um `location` com `Cache-Control` e sem o include perde toda a
segurança em silêncio — `npm run test:headers` falha se isso acontecer.

## Escrita

A antítese curta — afirma uma coisa, nega a outra, ponto final — é a digital
mais óbvia de texto gerado por máquina, e a copy v2.1 tinha dezessete
ocorrências dela. Todas foram desfeitas sem mexer em argumento, número ou
depoimento.

O texto usa conectivo no lugar do ponto final, "a gente", "só que",
"acontece que", e hesitação honesta ("quase nunca", "costuma ser").
Depoimentos são falas reais autorizadas e não se editam.

## LGPD

`src/lib/consent.ts` e `src/components/CookieConsent.astro`.

Nenhuma tag de terceiro existe no HTML. GA4 e Meta Pixel são injetados só
depois do aceite da categoria, e os cookies saem na hora quando o aceite é
revogado. Consent Mode v2 nasce com os quatro sinais em `denied`.

"Recusar todos" tem o mesmo peso visual de "Aceitar todos". Nenhuma caixa vem
marcada e fechar não vale como consentimento. O registro guarda id anônimo,
data, categorias e a versão da política; vale seis meses, e política nova
invalida a escolha antiga.

O link do rodapé (`data-open-consent`) reabre o painel em qualquer página,
inclusive na `/links`, que não usa o layout padrão.

**As fontes são servidas pelo próprio domínio.** Google Fonts por CDN
entregaria o IP de cada visitante a um terceiro antes de qualquer
consentimento, o que não se sustenta sob a LGPD. O `unicode-range` faz o
navegador buscar só o subset necessário: em português, `latin-ext` nunca desce.

**O fluxo é testado, não presumido.** `tests/consentimento.test.ts` sobe o
`dist/` num servidor, abre num Chromium real e bloqueia toda requisição que
não seja do próprio site — é assim que se prova que nada de terceiro carrega
antes do aceite. São 46 verificações: padrão negado, aceitar, recusar, editar
no painel, escolha vencida, política nova, as oito rotas e o retorno pelo
rodapé.

## Pendências

**Trava a publicação**

- [ ] Dados reais em `src/lib/site.ts`: WhatsApp, Instagram, LinkedIn, domínio
- [ ] `GA4_ID` e `META_PIXEL_ID` em `src/lib/consent.ts`
- [ ] `PUBLIC_DIAGNOSTICO_ENDPOINT` no `.env` — sem ele o envio completa o
      fluxo na tela sem sair do navegador
- [ ] Secrets da Edge Function: `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`,
      `SITE_ORIGIN`, `RATE_LIMIT_SALT`
- [ ] Colchetes das minutas legais: razão social, CNPJ, endereço, encarregado,
      comarca, prazo de retenção — e a revisão do advogado
- [ ] `POLICY_VERSION` em `consent.ts` ao publicar a política final

**Ativos**

- [ ] Logotipos reais nas faixas (`LogoWall.astro`). As marcas são fictícias,
      em estilos deliberadamente diferentes para mostrar o comportamento da
      faixa. Precisam de vetorização e normalização na mesma altura óptica.

**Depois**

- [ ] Agente que lê o formulário e escreve a análise no card do ClickUp. O
      card já sai organizado na ordem em que a Luana lê; o agente substitui a
      seção "Leitura" e nada no formulário muda
- [ ] Seção de conteúdo. Fora do menu, e a palavra "blog" foi vetada
- [ ] Nova assinatura da marca, se sair antes da publicação

## Direção de design

O comp de referência, com as treze pranchas:
https://claude.ai/artifact/7GGk9YiZujwnc5QsLPBNtU
