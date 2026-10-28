/**
 * O formulário público do diagnóstico.
 *
 *   GET   devolve as etapas e perguntas, como o painel deixou
 *   POST  recebe as respostas
 *
 * Ordem das prioridades: o lead nunca se perde. Grava no Postgres primeiro e
 * só depois, em segundo plano, pede o pré-diagnóstico à IA — se a OpenAI
 * estiver fora do ar, a resposta ainda é sucesso e o card mostra o erro.
 *
 * A área de teste do painel posta aqui também, com o token do painel: o lead
 * entra marcado como teste e escapa do limite por IP.
 */

import {
  contarRecentes,
  cors,
  emSegundoPlano,
  hashIp,
  json,
  origemLiberada,
  registrarTentativa,
  supabase,
} from '../_shared/http.ts';
import { carregarFormulario, publico, validar } from '../_shared/formulario.ts';
import { gerarPreDiagnostico, iaConfigurada } from '../_shared/prediagnostico.ts';
import { tokenValido } from '../_shared/sessao.ts';

const POLITICA_VERSAO = Deno.env.get('POLITICA_VERSAO') ?? '2026-10-28';

/** Quantos envios o mesmo IP pode fazer por hora. */
const LIMITE_POR_HORA = 3;

Deno.serve(async (req) => {
  const origem = req.headers.get('origin');
  const cabecalhos = cors(origem, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cabecalhos });
  }
  if (origem && !origemLiberada(origem)) {
    return json({ erro: 'origem não permitida' }, 403, cabecalhos);
  }

  if (req.method === 'GET') {
    try {
      const etapas = await carregarFormulario();
      // curto: uma edição no painel aparece no site em menos de um minuto
      return json({ etapas: publico(etapas) }, 200, {
        ...cabecalhos,
        'Cache-Control': 'public, max-age=30',
      });
    } catch (e) {
      console.error('falha ao ler o formulário', e);
      return json({ erro: 'não consegui carregar o formulário' }, 500, cabecalhos);
    }
  }

  if (req.method !== 'POST') {
    return json({ erro: 'método não permitido' }, 405, cabecalhos);
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: 'json inválido' }, 400, cabecalhos);
  }

  // armadilha: o campo fica escondido no formulário e só robô preenche.
  // Responde 200 para o robô não descobrir que foi barrado.
  const c = corpo as Record<string, unknown>;
  if (typeof c?.sobrenome === 'string' && c.sobrenome.trim() !== '') {
    return json({ ok: true }, 200, cabecalhos);
  }

  const teste = c?.__teste === true && (await tokenValido(req));
  const ipHash = await hashIp(req);

  if (!teste && (await contarRecentes(ipHash, 3_600_000)) >= LIMITE_POR_HORA) {
    return json(
      { erro: 'muitos envios seguidos deste mesmo acesso. Tente de novo daqui a pouco.' },
      429,
      cabecalhos,
    );
  }

  let etapas;
  try {
    etapas = await carregarFormulario();
  } catch (e) {
    console.error('falha ao ler o formulário', e);
    return json({ erro: 'não consegui registrar agora' }, 500, cabecalhos);
  }

  const resultado = validar(etapas, corpo);
  if (!resultado.ok) {
    return json({ erro: 'respostas incompletas', campos: resultado.erros }, 422, cabecalhos);
  }

  // 1. o lead entra em casa antes de qualquer integração
  const { data, error } = await supabase
    .from('leads')
    .insert({
      ...resultado.envio,
      consentimento: true,
      politica_versao: POLITICA_VERSAO,
      teste,
      pre_status: iaConfigurada() ? 'pendente' : 'sem_ia',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('falha ao gravar lead', error);
    return json({ erro: 'não consegui registrar agora' }, 500, cabecalhos);
  }

  if (!teste) await registrarTentativa(ipHash);

  // 2. a leitura da IA é consequência: roda depois da resposta
  if (iaConfigurada()) emSegundoPlano(gerarPreDiagnostico(data.id));

  return json({ ok: true, id: data.id }, 200, cabecalhos);
});
