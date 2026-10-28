/**
 * O formulário dinâmico e o painel, num navegador de verdade.
 *
 * As duas Edge Functions são substituídas por um backend em memória que fala
 * o mesmo protocolo. O que este teste garante é o lado do navegador: que o
 * formulário se desenha a partir do banco, que a reserva entra quando o
 * banco cai, e que cada aba do painel funciona sem erro de script. A lógica
 * do servidor tem testes próprios em supabase/functions/_shared/.
 *
 *   npm run build && npm run test:painel
 */

import { chromium, type Page, type Route } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { formularioPadrao } from '../src/lib/formulario-padrao.ts';

const DIST = join(import.meta.dirname, '..', 'dist');
/** Com FOTOS=<pasta>, guarda uma captura de cada tela para conferência visual. */
const FOTOS = process.env.FOTOS;
const foto = async (page: Page, nome: string) => {
  if (FOTOS) await page.screenshot({ path: join(FOTOS, `${nome}.png`), fullPage: true });
};
const PORTA = 4401;
const SENHA = 'senha-de-teste';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

let passou = 0;
let falhou = 0;
const ok = (d: string, c: boolean, extra = '') => {
  c ? passou++ : falhou++;
  console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${d}${extra && !c ? ` — ${extra}` : ''}`);
};

const servidor = createServer(async (req, res) => {
  try {
    let caminho = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
    const info = await stat(caminho).catch(() => null);
    if (!info || info.isDirectory()) caminho = join(caminho, 'index.html');
    res.writeHead(200, { 'Content-Type': TIPOS[extname(caminho)] ?? 'application/octet-stream' });
    res.end(await readFile(caminho));
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORTA);

/* -------------------------------------------------------------------------- *
 * backend em memória
 * -------------------------------------------------------------------------- */

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function novoBanco() {
  const etapas = formularioPadrao.map((e, i) => {
    const id = uuid();
    return {
      id,
      ordem: i + 1,
      nome: e.nome,
      titulo: e.titulo,
      perguntas: e.perguntas.map((p, j) => ({ ...p, id: uuid(), etapa_id: id, ordem: j + 1 })),
    };
  });
  const pre = {
    encaixe: 'alto',
    porque_do_encaixe: 'Decisora com dor de previsibilidade.',
    resumo: 'Clínica em operação, cresce por indicação.',
    dores: ['Depende da fundadora para vender'],
    sinais_positivos: ['Decide sozinha'],
    pontos_de_atencao: [],
    recomendacao: 'Abrir conversa esta semana.',
    perguntas_para_conversa: ['Quem vende hoje além de você?'],
    rascunho_mensagem: 'Oi, Ana. Li o seu diagnóstico.',
  };
  return {
    etapas,
    leads: [
      {
        id: uuid(),
        criado_em: new Date().toISOString(),
        nome: 'Ana Real',
        whatsapp: '11999999999',
        email: 'ana@x.com',
        respostas: [{ chave: 'empresa', etapa: 'Contato', rotulo: 'Empresa', tipo: 'texto', valor: 'Clínica Ana' }],
        status: 'novo',
        observacao_interna: null,
        teste: false,
        movido_em: null,
        pre_status: 'pronto',
        pre_diagnostico: pre,
        pre_erro: null,
        pre_gerado_em: new Date().toISOString(),
        pre_modelo: 'gpt-5-mini',
        pre_versao_id: null,
      },
    ] as Record<string, unknown>[],
    versoes: [
      { id: uuid(), criado_em: new Date().toISOString(), instrucoes: 'Você é a assistente…', modelo: 'gpt-5-mini', nota: 'Versão inicial', ativa: true },
    ],
    documentos: [] as Record<string, unknown>[],
    envios: [] as Record<string, unknown>[],
    pre,
  };
}

let banco = novoBanco();
let formularioFora = false;

async function responder(route: Route, corpo: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(corpo),
  });
}

async function diagnostico(route: Route) {
  const req = route.request();
  if (req.method() === 'GET') {
    if (formularioFora) return route.abort();
    return responder(route, { etapas: banco.etapas });
  }
  const dados = req.postDataJSON() as Record<string, string | boolean>;
  banco.envios.push(dados);
  const teste = dados.__teste === true && req.headers()['authorization'] === 'Bearer tok';
  const id = uuid();
  banco.leads.unshift({
    ...banco.leads[0],
    id,
    nome: String(dados.nome),
    teste,
    status: 'novo',
    pre_status: 'pendente',
    pre_diagnostico: null,
  });
  // a "IA" termina de ler pouco depois
  setTimeout(() => {
    const l = banco.leads.find((x) => x.id === id);
    if (l) Object.assign(l, { pre_status: 'pronto', pre_diagnostico: banco.pre });
  }, 1500);
  return responder(route, { ok: true, id });
}

async function painel(route: Route) {
  const req = route.request();
  const d = (req.postDataJSON() ?? {}) as Record<string, unknown>;
  if (d.acao === 'login') {
    return d.senha === SENHA
      ? responder(route, { token: 'tok', expira: Date.now() + 3_600_000 })
      : responder(route, { erro: 'senha incorreta' }, 401);
  }
  if (req.headers()['authorization'] !== 'Bearer tok') return responder(route, { erro: 'sessão expirada' }, 401);

  const lead = () => banco.leads.find((l) => l.id === d.id)!;
  const pergunta = () => banco.etapas.flatMap((e) => e.perguntas).find((p) => p.id === d.id)!;

  switch (d.acao) {
    case 'leads.listar':
      return responder(route, { leads: banco.leads.filter((l) => d.testes || !l.teste) });
    case 'lead.ler':
      return responder(route, { lead: lead() });
    case 'lead.atualizar':
      if (d.status) lead().status = d.status;
      if (d.observacao_interna !== undefined) lead().observacao_interna = d.observacao_interna;
      return responder(route, {});
    case 'lead.rediagnosticar':
      return responder(route, { lead: lead() });
    case 'lead.excluir':
      banco.leads = banco.leads.filter((l) => l.id !== d.id);
      return responder(route, {});
    case 'leads.excluirTestes':
      banco.leads = banco.leads.filter((l) => !l.teste);
      return responder(route, {});
    case 'formulario.ler':
      return responder(route, { etapas: banco.etapas });
    case 'pergunta.salvar':
      Object.assign(pergunta(), { rotulo: d.rotulo, opcoes: d.opcoes, tipo: d.tipo, obrigatoria: d.obrigatoria });
      return responder(route, {});
    case 'pergunta.criar': {
      const etapa = banco.etapas.find((e) => e.id === d.etapa_id)!;
      etapa.perguntas.push({
        id: uuid(), etapa_id: etapa.id, ordem: 99, chave: `p${seq}`, tipo: d.tipo as 'texto',
        rotulo: String(d.rotulo), ajuda: null, opcoes: d.opcoes as string[], obrigatoria: !!d.obrigatoria,
        sistema: null, meia: false, mostrar_se: null,
      });
      return responder(route, {});
    }
    case 'pergunta.excluir':
      for (const e of banco.etapas) e.perguntas = e.perguntas.filter((p) => p.id !== d.id);
      return responder(route, {});
    case 'perguntas.ordenar': {
      const ids = d.ids as string[];
      for (const e of banco.etapas) {
        if (e.perguntas.some((p) => p.id === ids[0])) {
          e.perguntas.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        }
      }
      return responder(route, {});
    }
    case 'ia.ler':
      return responder(route, { chaveConfigurada: true, versoes: banco.versoes, documentos: banco.documentos });
    case 'ia.modelos':
      return responder(route, { modelos: ['gpt-5', 'gpt-5-mini'] });
    case 'ia.salvar':
      banco.versoes.forEach((v) => (v.ativa = false));
      banco.versoes.unshift({ id: uuid(), criado_em: new Date().toISOString(), instrucoes: String(d.instrucoes), modelo: String(d.modelo), nota: String(d.nota ?? ''), ativa: true });
      return responder(route, {});
    default:
      return responder(route, { erro: `ação não simulada: ${d.acao}` }, 404);
  }
}

/* -------------------------------------------------------------------------- *
 * roteiro
 * -------------------------------------------------------------------------- */

async function pagina(): Promise<{ page: Page; erros: string[]; fechar: () => Promise<void> }> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/i.test(m.text())) erros.push(m.text());
  });
  page.on('dialog', (d) => d.accept());
  await page.route(/functions\/v1\/diagnostico/, diagnostico);
  await page.route(/functions\/v1\/painel/, painel);
  return { page, erros, fechar: () => contexto.close() };
}

/** Escolhe a opção visível de cada pergunta e preenche o texto, etapa por etapa. */
async function responderTudo(page: Page, raiz: string, nome: string) {
  for (let i = 0; i < 12; i++) {
    const etapa = page.locator(`${raiz} .etapa:not([hidden])`);
    for (const grupo of await etapa.locator('.campo:visible .opcoes').all()) {
      await grupo.locator('.opcao').first().click();
    }
    for (const input of await etapa.locator('.campo:visible input[type=text], .campo:visible input[type=tel], .campo:visible input[type=email]').all()) {
      const tipo = await input.getAttribute('type');
      const nomeCampo = await input.getAttribute('name');
      await input.fill(tipo === 'email' ? 'lead@x.com' : tipo === 'tel' ? '11988887777' : nomeCampo === 'nome' ? nome : 'algo');
    }
    const lgpd = etapa.locator('input[name=lgpd]');
    if (await lgpd.count()) {
      await lgpd.check();
      await page.locator(`${raiz} button[type=submit]:visible`).click();
      return;
    }
    await page.locator(`${raiz} .controles button:has-text("Continuar")`).click();
  }
}

const browser = await chromium.launch();

try {
  console.log('\nFormulário público, desenhado a partir do banco');
  {
    const { page, erros, fechar } = await pagina();
    await page.goto(`http://localhost:${PORTA}/diagnostico`);
    await page.locator('#diagnostico .etapa').first().waitFor();

    ok('as oito etapas foram desenhadas', (await page.locator('#diagnostico .etapa').count()) === 8);
    ok('o progresso mostra 01 / 08', (await page.locator('.progresso__texto').innerText()).includes('08'));

    // condição: faturamento só para quem opera
    await page.locator('[data-comecar]').click();
    // responde cada etapa com a primeira opção ("em operação") até chegar à do porte
    while (!(await page.locator('#diagnostico .etapa:not([hidden])[data-nome="A operação"]').count())) {
      for (const grupo of await page.locator('#diagnostico .etapa:not([hidden]) .campo:visible .opcoes').all()) {
        await grupo.locator('.opcao').first().click();
      }
      await page.locator('#diagnostico .controles button:has-text("Continuar")').click();
    }
    ok('quem opera vê faturamento', await page.locator('input[name=faturamento]').first().isVisible());
    ok('quem opera não vê renda', !(await page.locator('input[name=renda]').first().isVisible()));
    await fechar();

    const s = await pagina();
    await s.page.goto(`http://localhost:${PORTA}/diagnostico`);
    await s.page.locator('#diagnostico .etapa').first().waitFor();
    await s.page.locator('[data-comecar]').click();
    banco = novoBanco();
    await responderTudo(s.page, '#diagnostico', 'Lead do Site');
    await s.page.locator('#confirmacao').waitFor({ state: 'visible' });
    const envio = banco.envios.at(-1) ?? {};
    ok('o envio chega com as chaves do banco', envio.momento !== undefined && envio.nome === 'Lead do Site');
    ok('o envio do site não se marca como teste', envio.__teste === undefined);
    ok('a confirmação aparece', await s.page.locator('#confirmacao').isVisible());
    ok('sem erro de script', s.erros.length === 0, s.erros[0]);
    await s.fechar();
  }

  console.log('\nBanco fora do ar: entra a cópia de reserva');
  {
    formularioFora = true;
    const { page, erros, fechar } = await pagina();
    await page.goto(`http://localhost:${PORTA}/diagnostico`);
    await page.locator('#diagnostico .etapa').first().waitFor({ timeout: 10_000 });
    ok('o formulário de reserva aparece', (await page.locator('#diagnostico .etapa').count()) === 8);
    ok('sem erro de script', erros.length === 0, erros[0]);
    formularioFora = false;
    await fechar();
  }

  console.log('\nPainel');
  {
    banco = novoBanco();
    const { page, erros, fechar } = await pagina();
    await page.goto(`http://localhost:${PORTA}/painel`);

    await page.fill('#form-entrada input', 'errada');
    await page.click('#form-entrada button');
    await page.locator('#erro-entrada:visible').waitFor();
    ok('senha errada é recusada', (await page.locator('#erro-entrada').innerText()).includes('incorreta'));

    await page.fill('#form-entrada input', SENHA);
    await page.click('#form-entrada button');
    await page.locator('.cartao').first().waitFor();
    ok('o quadro tem cinco colunas', (await page.locator('.coluna').count()) === 5);
    await foto(page, '1-crm');
    ok('o cartão mostra o encaixe da IA', (await page.locator('.cartao .selo--alto').count()) === 1);

    await page.locator('.cartao').first().click();
    await page.locator('#dialogo-lead .ficha').waitFor();
    await foto(page, '2-ficha');
    ok('a ficha mostra o pré-diagnóstico', (await page.locator('#dialogo-lead .pre__encaixe').innerText()).includes('Decisora'));
    const wa = await page.locator('#dialogo-lead .pre__mensagem a').getAttribute('href');
    ok('o rascunho abre no WhatsApp com DDI', wa?.startsWith('https://wa.me/5511999999999?text=') ?? false, wa ?? '');
    await page.selectOption('#dialogo-lead .ficha__cabeca select', 'com_fit');
    await page.waitForTimeout(150);
    ok('mudar a coluna na ficha grava', banco.leads[0].status === 'com_fit');
    await page.locator('#dialogo-lead .dialogo__fechar').click();
    ok('o cartão foi para Com fit', (await page.locator('.coluna[data-status=com_fit] .cartao').count()) === 1);

    await page.locator('.cartao').first().dragTo(page.locator('.coluna[data-status=lido]'));
    await page.waitForTimeout(150);
    ok('arrastar para Lido grava', banco.leads[0].status === 'lido', String(banco.leads[0].status));

    // formulário
    await page.click('[data-aba=formulario]');
    await page.locator('.etapa-ed').first().waitFor();
    await foto(page, '3-formulario');
    ok('o editor lista as oito etapas', (await page.locator('.etapa-ed').count()) === 8);
    ok('a condição original aparece', (await page.locator('.pergunta__condicao').count()) === 4);
    ok('nome, WhatsApp e e-mail não têm Excluir', (await page.locator('.etapa-ed').last().locator('.pergunta').nth(0).locator('button:has-text("Excluir")').count()) === 0);

    await page.locator('.etapa-ed').first().locator('button:has-text("+ Nova pergunta")').click();
    await page.locator('#dialogo-pergunta .ed-pergunta').waitFor();
    await page.fill('#dialogo-pergunta textarea', 'Pergunta nova?');
    await page.locator('#dialogo-pergunta .ed-opcoes input').nth(0).fill('Sim');
    await page.locator('#dialogo-pergunta .ed-opcoes input').nth(1).fill('Não');
    await page.click('#dialogo-pergunta button:has-text("+ Opção")');
    await page.locator('#dialogo-pergunta .ed-opcoes input').nth(2).fill('Talvez');
    await foto(page, '4-pergunta');
    await page.click('#dialogo-pergunta button[type=submit]');
    await page.locator('.pergunta__rotulo:has-text("Pergunta nova?")').waitFor();
    const criada = banco.etapas[0].perguntas.at(-1)!;
    ok('a pergunta nova foi criada com três opções', criada.opcoes.length === 3 && criada.tipo === 'escolha');

    await page.locator('.etapa-ed').first().locator('.pergunta').last().locator('button[title=Subir]').click();
    await page.waitForTimeout(150);
    ok('subir reordena', banco.etapas[0].perguntas[1].rotulo === 'Pergunta nova?');

    await page.locator('.etapa-ed').first().locator('.pergunta').nth(1).locator('button:has-text("Excluir")').click();
    await page.waitForTimeout(150);
    ok('excluir remove', !banco.etapas[0].perguntas.some((p) => p.rotulo === 'Pergunta nova?'));

    // IA
    await page.click('[data-aba=ia]');
    await page.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>('.ia__instrucoes')?.value ?? '') !== '');
    await foto(page, '5-ia');
    ok('as instruções em uso aparecem', (await page.inputValue('.ia__instrucoes')).startsWith('Você é'));
    await page.fill('.ia__instrucoes', 'Instruções novas');
    await page.click('button:has-text("Salvar e usar esta versão")');
    await page.locator('.versao').nth(1).waitFor();
    ok('salvar cria versão nova e ativa', banco.versoes[0].instrucoes === 'Instruções novas' && banco.versoes[0].ativa);

    // teste
    await page.click('[data-aba=teste]');
    await page.locator('.teste__form .etapa').first().waitFor();
    await responderTudo(page, '.teste__form', 'Lead de Teste');
    await page.locator('.teste__ficha .ficha').waitFor();
    ok('o envio de teste vai com o token', banco.envios.at(-1)?.__teste === true);
    ok('a ficha mostra a IA lendo', (await page.locator('.teste__ficha').innerText()).includes('lendo'));
    await page.locator('.teste__ficha .pre__encaixe').waitFor({ timeout: 8000 });
    ok('a ficha se atualiza quando a IA termina', true);

    await page.click('button:has-text("Ver no CRM")');
    await page.locator('#dialogo-lead .ficha').waitFor();
    ok('ver no CRM abre a ficha com os testes à mostra', (await page.locator('#dialogo-lead h2').innerText()).includes('Lead de Teste'));

    ok('sem erro de script no painel', erros.length === 0, erros[0]);

    await foto(page, '6-ficha-teste');
    await fechar();
  }
} finally {
  await browser.close();
  servidor.close();
}

console.log(`\n${passou} passaram, ${falhou} ${falhou === 1 ? 'falhou' : 'falharam'}\n`);
process.exit(falhou ? 1 : 0);
