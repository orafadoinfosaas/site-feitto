# Site FEITTO

Site institucional da FEITTO, em Astro. Estático, sem framework de UI e sem
dependência de runtime além do `motion` (ainda não usado; a revelação de
blocos roda com `IntersectionObserver` e CSS).

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # gera dist/
npm run check    # tipos e diagnósticos do Astro
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

O link do rodapé (`data-open-consent`) reabre o painel em qualquer página.

## Pendências

**Trava a publicação**

- [ ] Dados reais em `src/lib/site.ts`: WhatsApp, Instagram, LinkedIn, domínio
- [ ] `GA4_ID` e `META_PIXEL_ID` em `src/lib/consent.ts`
- [ ] `ENDPOINT` em `src/pages/diagnostico.astro` — hoje o envio completa o
      fluxo na tela sem sair do navegador
- [ ] Colchetes das minutas legais: razão social, CNPJ, endereço, encarregado,
      comarca, prazo de retenção — e a revisão do advogado
- [ ] `POLICY_VERSION` em `consent.ts` ao publicar a política final

**Ativos**

- [ ] Logotipos reais nas faixas (`LogoWall.astro`). As marcas são fictícias,
      em estilos deliberadamente diferentes para mostrar o comportamento da
      faixa. Precisam de vetorização e normalização na mesma altura óptica.

**Depois**

- [ ] CRM (ClickUp) e o agente que lê o formulário e gera o pré-release no card
- [ ] Seção de conteúdo. Fora do menu, e a palavra "blog" foi vetada
- [ ] Nova assinatura da marca, se sair antes da publicação

## Direção de design

O comp de referência, com as treze pranchas:
https://claude.ai/artifact/7GGk9YiZujwnc5QsLPBNtU
