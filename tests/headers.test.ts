/**
 * Confere a configuração do nginx antes dela ir para o servidor.
 *
 * Lê os cabeçalhos direto de `docker/nginx.conf`, sobe o `dist/` aplicando
 * exatamente aqueles valores e abre cada página num Chromium, ouvindo
 * violações de CSP e erros de console. É o jeito de descobrir que a política
 * bloqueia um script próprio aqui, e não depois do deploy.
 *
 *   npm run build && npm run test:headers
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync as lerSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const DIST = join(RAIZ, 'dist');
const PORTA = 4400;

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
const ok = (d: string, c: boolean, extra = '') => {
  c ? passou++ : falhou++;
  console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${d}${extra && !c ? ` — ${extra}` : ''}`);
};

/** Extrai os add_header do nginx.conf: a config real é a fonte da verdade. */
function cabecalhosDoNginx(): Record<string, string> {
  const conf = lerSync(join(RAIZ, 'docker', 'nginx.conf'), 'utf8');
  const headers: Record<string, string> = {};
  for (const m of conf.matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]*)"\s+always;/gm)) {
    // os de cache são por rota; aqui interessam os globais
    if (m[1].toLowerCase() === 'cache-control') continue;
    headers[m[1]] = m[2];
  }
  return headers;
}

const HEADERS = cabecalhosDoNginx();

const servidor = createServer(async (req, res) => {
  try {
    let caminho = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
    const info = await stat(caminho).catch(() => null);
    if (!info || info.isDirectory()) caminho = join(caminho, 'index.html');
    const corpo = await readFile(caminho);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(caminho)] ?? 'application/octet-stream',
      ...HEADERS,
    });
    res.end(corpo);
  } catch {
    res.writeHead(404, HEADERS).end('não encontrado');
  }
}).listen(PORTA);

const ROTAS = ['', 'metodo', 'quem-conduz', 'casos', 'diagnostico', 'links',
               'politica-de-privacidade', 'termos-de-uso', '404.html'];

console.log('\nCabeçalhos do nginx, aplicados a um navegador real\n');
console.log('Lidos de docker/nginx.conf');
for (const [k, v] of Object.entries(HEADERS)) {
  console.log(`  ${k}: ${v.length > 76 ? v.slice(0, 76) + '…' : v}`);
}

const browser = await chromium.launch();

try {
  console.log('\nNenhuma página viola a própria política');
  for (const rota of ROTAS) {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    const violacoes: string[] = [];
    const erros: string[] = [];

    page.on('console', (msg) => {
      const t = msg.text();
      if (/content security policy|refused to/i.test(t)) violacoes.push(t);
      else if (msg.type() === 'error' && !/favicon|net::ERR/i.test(t)) erros.push(t);
    });
    page.on('pageerror', (e) => erros.push(e.message));

    await page.goto(`http://localhost:${PORTA}/${rota}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);

    ok(
      `/${rota || ''} sem violação de CSP`,
      violacoes.length === 0,
      violacoes[0]?.slice(0, 160),
    );
    if (erros.length) ok(`/${rota || ''} sem erro de script`, false, erros[0]?.slice(0, 160));

    await contexto.close();
  }

  console.log('\nO que a política precisa permitir');
  {
    const csp = HEADERS['Content-Security-Policy'] ?? '';
    ok("as fontes vêm só do próprio site (font-src 'self')", /font-src 'self'(;|$)/.test(csp));
    ok('o formulário alcança o Supabase', csp.includes('https://*.supabase.co'));
    ok('o GA4 pode subir depois do aceite', csp.includes('googletagmanager.com'));
    ok('o Pixel pode subir depois do aceite', csp.includes('connect.facebook.net'));
    ok("nada de plugin (object-src 'none')", csp.includes("object-src 'none'"));
    ok("formulário não posta para fora (form-action 'self')", csp.includes("form-action 'self'"));
    ok('sem embed de terceiros (frame-ancestors)', csp.includes('frame-ancestors'));
  }

  console.log('\nO estático continua funcionando por trás dos cabeçalhos');
  {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    const violacoes: string[] = [];
    page.on('console', (m) => {
      if (/content security policy|refused to/i.test(m.text())) violacoes.push(m.text());
    });

    await page.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });

    ok('a Author carregou', await page.evaluate(() => document.fonts.check('200 16px Author')));
    ok('a Outfit carregou', await page.evaluate(() => document.fonts.check('300 16px Outfit')));
    ok('o banner de cookies apareceu', await page.locator('.consent__banner').isVisible());
    ok('a foto do hero apareceu', await page.locator('.hero__media img').isVisible());

    await page.locator('[data-consent-accept]').first().click();
    await page.waitForTimeout(400);
    ok('aceitar cookies não gera violação', violacoes.length === 0, violacoes[0]?.slice(0, 160));
    ok(
      'a escolha foi gravada mesmo com a CSP ativa',
      await page.evaluate(() => localStorage.getItem('feitto.consent.v1') !== null),
    );
    await contexto.close();
  }

  console.log('\nRotas e erro');
  {
    const r = await fetch(`http://localhost:${PORTA}/metodo`);
    ok('/metodo resolve sem barra final', r.ok);

    const r404 = await fetch(`http://localhost:${PORTA}/nao-existe`);
    ok('rota inexistente devolve 404', r404.status === 404);

    const html404 = await readFile(join(DIST, '404.html'), 'utf8');
    ok('existe página de erro na identidade', html404.includes('Esta página não'));
  }
} finally {
  await browser.close();
  servidor.close();
}

console.log(`\n${passou} passaram, ${falhou} ${falhou === 1 ? 'falhou' : 'falharam'}\n`);
process.exit(falhou ? 1 : 0);
