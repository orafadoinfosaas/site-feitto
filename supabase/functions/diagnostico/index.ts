/**
 * Recebe o diagnóstico do site.
 *
 * Ordem das prioridades: o lead nunca se perde. Grava no Postgres primeiro e
 * só então tenta o ClickUp — se o CRM estiver fora do ar, a resposta ainda é
 * sucesso e a linha fica marcada para reenvio. O contrário perderia o lead
 * por causa de um serviço de terceiro.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validar } from './validacao.ts';
import { criarCard } from './clickup.ts';

const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? '';
const CLICKUP_TOKEN = Deno.env.get('CLICKUP_TOKEN') ?? '';
const CLICKUP_LIST_ID = Deno.env.get('CLICKUP_LIST_ID') ?? '';
const RATE_LIMIT_SALT = Deno.env.get('RATE_LIMIT_SALT') ?? '';
const POLITICA_VERSAO = Deno.env.get('POLITICA_VERSAO') ?? '2026-09-20';

/** Quantos envios o mesmo IP pode fazer por hora. */
const LIMITE_POR_HORA = 3;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/** Só o site responde por este formulário; em dev, o localhost do Astro. */
function origensPermitidas(): string[] {
  return [SITE_ORIGIN, 'http://localhost:4321', 'http://127.0.0.1:4321'].filter(Boolean);
}

function cors(origem: string | null): Record<string, string> {
  const permitidas = origensPermitidas();
  const liberada = origem && permitidas.includes(origem) ? origem : permitidas[0] ?? '';
  return {
    'Access-Control-Allow-Origin': liberada,
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(corpo: unknown, status: number, origem: string | null): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origem) },
  });
}

/** Guarda o hash, nunca o IP. Serve para conter enxurrada e nada mais. */
async function hashIp(ip: string): Promise<string> {
  const dados = new TextEncoder().encode(`${RATE_LIMIT_SALT}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function excedeuLimite(ipHash: string): Promise<boolean> {
  const umaHoraAtras = new Date(Date.now() - 3_600_000).toISOString();

  const { count, error } = await supabase
    .from('envio_limite')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('criado_em', umaHoraAtras);

  // falha na checagem não pode barrar um lead legítimo
  if (error) return false;
  return (count ?? 0) >= LIMITE_POR_HORA;
}

Deno.serve(async (req) => {
  const origem = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origem) });
  }
  if (req.method !== 'POST') {
    return json({ erro: 'método não permitido' }, 405, origem);
  }
  if (origem && !origensPermitidas().includes(origem)) {
    return json({ erro: 'origem não permitida' }, 403, origem);
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: 'json inválido' }, 400, origem);
  }

  // armadilha: o campo fica escondido no formulário e só robô preenche.
  // Responde 200 para o robô não descobrir que foi barrado.
  const c = corpo as Record<string, unknown>;
  if (typeof c?.sobrenome === 'string' && c.sobrenome.trim() !== '') {
    return json({ ok: true }, 200, origem);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
  const ipHash = await hashIp(ip);

  if (await excedeuLimite(ipHash)) {
    return json(
      { erro: 'muitos envios seguidos deste mesmo acesso. Tente de novo daqui a pouco.' },
      429,
      origem,
    );
  }

  const resultado = validar(corpo, POLITICA_VERSAO);
  if (!resultado.ok) {
    return json({ erro: 'respostas incompletas', campos: resultado.erros }, 422, origem);
  }

  // 1. o lead entra em casa antes de qualquer integração
  const { data, error } = await supabase
    .from('diagnosticos')
    .insert(resultado.dados)
    .select('id')
    .single();

  if (error || !data) {
    console.error('falha ao gravar diagnóstico', error);
    return json({ erro: 'não consegui registrar agora' }, 500, origem);
  }

  await supabase.from('envio_limite').insert({ ip_hash: ipHash });

  // 2. o CRM é consequência: se falhar, a linha fica marcada para reenvio
  if (CLICKUP_TOKEN && CLICKUP_LIST_ID) {
    try {
      const card = await criarCard(resultado.dados, data.id, {
        token: CLICKUP_TOKEN,
        listId: CLICKUP_LIST_ID,
      });
      await supabase
        .from('diagnosticos')
        .update({
          clickup_task_id: card.id,
          clickup_url: card.url,
          clickup_sincronizado_em: new Date().toISOString(),
          clickup_erro: null,
        })
        .eq('id', data.id);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error('ClickUp indisponível', motivo);
      await supabase
        .from('diagnosticos')
        .update({ clickup_erro: motivo.slice(0, 500) })
        .eq('id', data.id);
    }
  }

  // faxina barata: uma vez a cada vinte envios, sem cron
  if (Math.random() < 0.05) {
    await supabase.rpc('limpar_envio_limite');
  }

  return json({ ok: true, id: data.id }, 200, origem);
});
