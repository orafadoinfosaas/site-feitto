/**
 * Teste do fluxo de consentimento, num navegador de verdade.
 *
 * Roda contra o `dist/` servido, ou seja, contra o que o visitante realmente
 * recebe. Toda requisição que sair para fora do site é registrada: é assim
 * que se prova que nada de terceiro sobe antes do aceite.
 *
 *   npm run build && npm run test:consent
 */

import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const PORTA = 4399;
const CHAVE = 'feitto.consent.v1';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

let passou = 0;
let falhou = 0;

function ok(descricao: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    passou++;
    console.log(`  \x1b[32m✓\x1b[0m ${descricao}`);
  } else {
    falhou++;
    console.log(`  \x1b[31m✗\x1b[0m ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Servidor mínimo para o dist, sem depender de `astro preview`. */
function servir() {
  return createServer(async (req, res) => {
    try {
      let caminho = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
      const info = await stat(caminho).catch(() => null);
      if (!info || info.isDirectory()) caminho = join(caminho, 'index.html');
      const corpo = await readFile(caminho);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(caminho)] ?? 'application/octet-stream' });
      res.end(corpo);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  }).listen(PORTA);
}

interface Sessao {
  page: Page;
  /** tudo que o navegador tentou buscar fora do próprio site */
  externos: string[];
}

async function abrir(
  browser: Browser,
  rota: string,
  registroInicial?: unknown,
): Promise<Sessao> {
  const contexto = await browser.newContext();
  const externos: string[] = [];

  // bloqueia e registra qualquer coisa que não venha do próprio site
  await contexto.route('**/*', (rota) => {
    const url = rota.request().url();
    if (!url.startsWith(`http://localhost:${PORTA}`)) {
      externos.push(url);
      return rota.abort();
    }
    return rota.continue();
  });

  if (registroInicial !== undefined) {
    await contexto.addInitScript(
      ([chave, valor]) => localStorage.setItem(chave as string, valor as string),
      [CHAVE, JSON.stringify(registroInicial)] as const,
    );
  }

  const page = await contexto.newPage();
  await page.goto(`http://localhost:${PORTA}/${rota}`, { waitUntil: 'networkidle' });
  return { page, externos };
}

const registro = (page: Page) =>
  page.evaluate((c) => {
    const v = localStorage.getItem(c);
    return v ? JSON.parse(v) : null;
  }, CHAVE);

const consentMode = (page: Page, tipo: 'default' | 'update') =>
  page.evaluate((t) => {
    const dl = (window as any).dataLayer ?? [];
    const achado = [...dl].reverse().find((e: any) => e?.[0] === 'consent' && e?.[1] === t);
    return achado?.[2] ?? null;
  }, tipo);

const visivel = (page: Page, seletor: string) => page.locator(seletor).isVisible();

/** `#consent` é o invólucro: seus filhos são position:fixed, então ele mede
 *  zero. Quem aparece para o visitante é o banner. */
const BANNER = '.consent__banner';

/* ------------------------------------------------------------------ */

const servidor = servir();
const browser = await chromium.launch();

console.log('\nFluxo de consentimento — navegador real, contra o site construído\n');

try {
  /* ---------------------------------------------------------------- */
  console.log('Primeira visita');
  {
    const { page, externos } = await abrir(browser, '');
    ok('o banner aparece sozinho', await visivel(page, BANNER));
    ok('nada de terceiro é carregado antes da escolha', externos.length === 0, externos.join(', '));
    ok('recusar tem o mesmo peso de aceitar', (await page.locator('.consent__equal').count()) === 2);
    ok(
      'nenhuma caixa vem pré-marcada',
      !(await page.locator('[data-consent-toggle]:checked').count()),
    );

    const inicial = await consentMode(page, 'default');
    ok('o Consent Mode declarou o padrão', inicial !== null);
    for (const sinal of ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization']) {
      ok(`  ${sinal} nasce denied`, inicial?.[sinal] === 'denied');
    }
    ok('  security_storage segue granted', inicial?.security_storage === 'granted');
    await page.context().close();
  }

  /* ---------------------------------------------------------------- */
  console.log('\nRecusar todos');
  {
    const { page, externos } = await abrir(browser, '');
    await page.locator('[data-consent-reject]').first().click();

    const r = await registro(page);
    ok('a escolha fica registrada', r !== null);
    ok('análise negada', r?.analise === false);
    ok('marketing negado', r?.marketing === false);
    ok('guarda a versão da política', typeof r?.policy === 'string' && r.policy.length > 0);
    ok('guarda data e hora', typeof r?.at === 'string' && !Number.isNaN(Date.parse(r.at)));
    ok('o identificador é anônimo', !JSON.stringify(r).includes('@'));
    ok('o banner some', !(await visivel(page, BANNER)));

    const u = await consentMode(page, 'update');
    ok('o Consent Mode recebeu o update', u !== null);
    ok('  analytics_storage = denied', u?.analytics_storage === 'denied');
    ok('  ad_storage = denied', u?.ad_storage === 'denied');
    ok('continua sem carregar terceiros', externos.length === 0, externos.join(', '));
    await page.context().close();
  }

  /* ---------------------------------------------------------------- */
  console.log('\nAceitar todos');
  {
    const { page, externos } = await abrir(browser, '');
    await page.locator('[data-consent-accept]').first().click();

    const r = await registro(page);
    ok('análise liberada', r?.analise === true);
    ok('marketing liberado', r?.marketing === true);

    const u = await consentMode(page, 'update');
    ok('  analytics_storage = granted', u?.analytics_storage === 'granted');
    ok('  ad_storage = granted', u?.ad_storage === 'granted');
    ok('  ad_user_data = granted', u?.ad_user_data === 'granted');
    ok('  ad_personalization = granted', u?.ad_personalization === 'granted');
    ok(
      'sem os IDs configurados, nenhum script sobe mesmo com tudo aceito',
      externos.length === 0,
      externos.join(', '),
    );
    await page.context().close();
  }

  /* ---------------------------------------------------------------- */
  console.log('\nPainel de preferências');
  {
    const { page } = await abrir(browser, '');
    await page.locator('[data-consent-open-panel]').click();
    ok('o painel abre', await visivel(page, '[data-consent-panel]'));
    ok(
      'necessários não pode ser desligado',
      await page.locator('#c-necessarios').isDisabled(),
    );

    await page.locator('#c-analise').check();
    await page.locator('[data-consent-save]').click();

    const r = await registro(page);
    ok('salva só o que foi marcado — análise sim', r?.analise === true);
    ok('salva só o que foi marcado — marketing não', r?.marketing === false);
    await page.context().close();
  }

  /* ---------------------------------------------------------------- */
  console.log('\nQuem já escolheu não é perguntado de novo');
  {
    const { page } = await abrir(browser, '', {
      id: 'x',
      policy: '2026-09-20',
      at: new Date().toISOString(),
      analise: true,
      marketing: false,
    });
    ok('o banner não reaparece', !(await visivel(page, BANNER)));
    await page.context().close();
  }

  /* ---------------------------------------------------------------- */
  console.log('\nEscolha vencida ou política nova voltam a perguntar');
  {
    const casos = [
      [
        'consentimento de 200 dias atrás',
        {
          id: 'x',
          policy: '2026-09-20',
          at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
          analise: true,
          marketing: true,
        },
      ],
      [
        'política diferente da vigente',
        { id: 'x', policy: '2020-01-01', at: new Date().toISOString(), analise: true, marketing: true },
      ],
    ] as const;

    for (const [caso, reg] of casos) {
      const { page } = await abrir(browser, '', reg);
      ok(`pergunta de novo: ${caso}`, await visivel(page, BANNER));
      await page.context().close();
    }
  }

  /* ---------------------------------------------------------------- */
  console.log('\nO banner alcança todas as páginas');
  {
    const rotas = ['', 'metodo', 'quem-conduz', 'casos', 'diagnostico', 'links',
                   'politica-de-privacidade', 'termos-de-uso'];
    for (const rota of rotas) {
      const { page } = await abrir(browser, rota);
      ok(`/${rota} mostra o banner`, await visivel(page, BANNER));
      await page.context().close();
    }
  }

  /* ---------------------------------------------------------------- */
  console.log('\nDá para voltar atrás depois de recusar');
  {
    const { page } = await abrir(browser, 'metodo');
    await page.locator('[data-consent-reject]').first().click();
    ok('o banner saiu', !(await visivel(page, BANNER)));

    await page.locator('[data-open-consent]').first().click();
    ok('o link do rodapé reabre o painel', await visivel(page, '[data-consent-panel]'));

    await page.locator('#c-marketing').check();
    await page.locator('[data-consent-save]').click();
    const r = await registro(page);
    ok('a escolha nova substitui a anterior', r?.marketing === true);
    await page.context().close();
  }
} finally {
  await browser.close();
  servidor.close();
}

console.log(
  `\n${passou} passaram, ${falhou} ${falhou === 1 ? 'falhou' : 'falharam'}\n`,
);
process.exit(falhou ? 1 : 0);
