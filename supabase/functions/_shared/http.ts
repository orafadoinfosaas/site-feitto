/**
 * O que as duas funções têm em comum: o cliente do banco, o CORS e a forma
 * de responder.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? '';

/**
 * Só o site conversa com estas funções.
 *
 * SITE_ORIGIN é uma lista separada por vírgula. Cada entrada é uma origem
 * exata, ou uma com `*` no lugar do sufixo que a hospedagem gera sozinha.
 *
 *   https://feitto.com.br
 *   https://site-feitto-*.easypanel.host
 *
 * O `*` casa apenas com letras, números e hífen: não atravessa ponto nem
 * barra. Então `site-feitto-x.easypanel.host` passa e `site-feitto-x.outro.com`
 * não — que é a diferença entre liberar este projeto e liberar a plataforma
 * inteira.
 */
function paraRegex(padrao: string): RegExp {
  const escapado = padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapado.replace(/\\\*/g, '[a-z0-9-]+')}$`);
}

const PERMITIDAS = [
  ...SITE_ORIGIN.split(',').map((o) => o.trim()),
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]
  // o navegador manda a origem sem barra final; uma barra a mais no secret
  // faria o match falhar em silêncio, e o formulário voltaria 403 sem pista
  .map((o) => o.replace(/\/+$/, ''))
  .filter(Boolean)
  .map(paraRegex);

export function origemLiberada(origem: string | null): boolean {
  return origem !== null && PERMITIDAS.some((r) => r.test(origem));
}

/** Para o cabeçalho: devolve a origem que pediu, se ela puder. */
function origemEco(origem: string | null): string {
  if (origemLiberada(origem)) return origem!;
  return SITE_ORIGIN.split(',')[0]?.trim().replace(/\/+$/, '') ?? '';
}

export function cors(origem: string | null, metodos: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origemEco(origem),
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
    'Access-Control-Allow-Methods': metodos,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(
  corpo: unknown,
  status: number,
  cabecalhos: Record<string, string>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
  });
}

/** Guarda o hash, nunca o IP. Serve para conter enxurrada e nada mais. */
export async function hashIp(req: Request, prefixo = ''): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? '';
  const dados = new TextEncoder().encode(`${salt}:${prefixo}${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Quantas vezes este hash apareceu na janela. Falha na checagem conta zero. */
export async function contarRecentes(ipHash: string, janelaMs: number): Promise<number> {
  const desde = new Date(Date.now() - janelaMs).toISOString();
  const { count, error } = await supabase
    .from('envio_limite')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('criado_em', desde);
  return error ? 0 : (count ?? 0);
}

export async function registrarTentativa(ipHash: string): Promise<void> {
  await supabase.from('envio_limite').insert({ ip_hash: ipHash });
  // faxina barata: uma vez a cada vinte registros, sem cron
  if (Math.random() < 0.05) await supabase.rpc('limpar_envio_limite');
}

/** Trabalho que continua depois da resposta, enquanto a função estiver viva. */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export function emSegundoPlano(tarefa: Promise<unknown>): void {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa);
}
