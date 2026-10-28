/**
 * Acesso ao painel: uma senha, guardada em PAINEL_SENHA.
 *
 * Quem acerta recebe um token assinado com HMAC que vale por algumas horas.
 * A chave do HMAC deriva da própria senha, então trocar a senha derruba todas
 * as sessões abertas — sem tabela de sessão nem segredo a mais para guardar.
 */

const SENHA = Deno.env.get('PAINEL_SENHA') ?? '';
const DURACAO_MS = 12 * 3_600_000;

const codificador = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function chave(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    codificador.encode(`feitto-painel:${SENHA}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function assinar(texto: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await chave(), codificador.encode(texto));
  return base64url(new Uint8Array(sig));
}

/** Compara sem vazar, pelo tempo de resposta, quantos caracteres batem. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export function painelConfigurado(): boolean {
  return SENHA.length >= 8;
}

/** Compara pelo HMAC, e não direto: os dois lados ficam com o mesmo tamanho. */
export async function senhaConfere(tentativa: string): Promise<boolean> {
  if (!painelConfigurado()) return false;
  return iguais(await assinar(`senha:${tentativa}`), await assinar(`senha:${SENHA}`));
}

export async function emitirToken(): Promise<{ token: string; expira: number }> {
  const expira = Date.now() + DURACAO_MS;
  const corpo = base64url(codificador.encode(JSON.stringify({ exp: expira })));
  return { token: `${corpo}.${await assinar(corpo)}`, expira };
}

export async function tokenValido(req: Request): Promise<boolean> {
  if (!painelConfigurado()) return false;

  const bruto = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const [corpo, sig] = bruto.split('.');
  if (!corpo || !sig) return false;
  if (!iguais(sig, await assinar(corpo))) return false;

  try {
    const texto = atob(corpo.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(texto) as { exp: number };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}
