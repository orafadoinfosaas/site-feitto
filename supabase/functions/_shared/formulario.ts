/**
 * O formulário como está no banco, e a validação de um envio contra ele.
 *
 * O navegador já valida, mas nada do que chega aqui é confiável: a função é
 * pública e qualquer um pode postar direto nela. Cada resposta de múltipla
 * escolha é conferida contra as opções vigentes, e o que não estava visível
 * para a pessoa (por condição) é descartado.
 */

import { supabase } from './http.ts';

export type Tipo = 'escolha' | 'texto' | 'longo';
export type Sistema = 'nome' | 'whatsapp' | 'email';

export interface Pergunta {
  id: string;
  etapa_id: string;
  ordem: number;
  chave: string;
  tipo: Tipo;
  rotulo: string;
  ajuda: string | null;
  opcoes: string[];
  obrigatoria: boolean;
  sistema: Sistema | null;
  meia: boolean;
  mostrar_se: { chave: string; valor: string } | null;
}

export interface Etapa {
  id: string;
  ordem: number;
  nome: string;
  titulo: string;
  perguntas: Pergunta[];
}

/** Uma resposta como fica no lead: com a cópia do texto da pergunta. */
export interface Resposta {
  chave: string;
  etapa: string;
  rotulo: string;
  tipo: Tipo;
  valor: string;
}

export interface Envio {
  nome: string;
  whatsapp: string;
  email: string;
  respostas: Resposta[];
}

export type Resultado = { ok: true; envio: Envio } | { ok: false; erros: string[] };

export async function carregarFormulario(): Promise<Etapa[]> {
  const [etapas, perguntas] = await Promise.all([
    supabase.from('form_etapas').select('id, ordem, nome, titulo').order('ordem'),
    supabase.from('form_perguntas').select('*').order('ordem'),
  ]);
  if (etapas.error) throw etapas.error;
  if (perguntas.error) throw perguntas.error;

  return (etapas.data as Omit<Etapa, 'perguntas'>[]).map((e) => ({
    ...e,
    perguntas: (perguntas.data as Pergunta[]).filter((p) => p.etapa_id === e.id),
  }));
}

const LIMITE = { texto: 300, longo: 4000 } as const;

function texto(valor: unknown, limite: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, limite) : '';
}

/** Checagem de formato, não de existência: quem erra o e-mail perde o retorno. */
export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
}

/** Aceita o que a pessoa digitou; só exige dígitos suficientes para discar. */
export function whatsappValido(valor: string): boolean {
  return (valor.match(/\d/g) ?? []).length >= 10;
}

/**
 * Uma pergunta condicional aparece quando a resposta da outra bate. Se a
 * outra pergunta foi apagada, a condição não tem mais a que se referir e a
 * pergunta passa a aparecer sempre — que é também o que o navegador faz.
 */
function visivel(p: Pergunta, valores: Map<string, string>, chaves: Set<string>): boolean {
  if (!p.mostrar_se) return true;
  if (!chaves.has(p.mostrar_se.chave)) return true;
  return valores.get(p.mostrar_se.chave) === p.mostrar_se.valor;
}

export function validar(etapas: Etapa[], corpo: unknown): Resultado {
  if (typeof corpo !== 'object' || corpo === null) return { ok: false, erros: ['corpo ausente'] };
  const c = corpo as Record<string, unknown>;

  const todas = etapas.flatMap((e) => e.perguntas.map((p) => ({ p, etapa: e.nome })));
  const chaves = new Set(todas.map(({ p }) => p.chave));

  // primeiro lê tudo, depois decide o que estava visível
  const valores = new Map<string, string>();
  for (const { p } of todas) {
    const bruto = texto(c[p.chave], p.tipo === 'longo' ? LIMITE.longo : LIMITE.texto);
    if (!bruto) continue;
    if (p.tipo === 'escolha' && !p.opcoes.includes(bruto)) continue;
    valores.set(p.chave, p.sistema === 'email' ? bruto.toLowerCase() : bruto);
  }

  const erros: string[] = [];
  const respostas: Resposta[] = [];

  for (const { p, etapa } of todas) {
    if (!visivel(p, valores, chaves)) continue;
    const valor = valores.get(p.chave) ?? '';

    if (!valor) {
      if (p.obrigatoria) erros.push(p.chave);
      continue;
    }
    if (p.sistema === 'email' && !emailValido(valor)) erros.push(p.chave);
    if (p.sistema === 'whatsapp' && !whatsappValido(valor)) erros.push(p.chave);

    respostas.push({ chave: p.chave, etapa, rotulo: p.rotulo, tipo: p.tipo, valor });
  }

  // o consentimento não tem caminho alternativo: sem ele não há tratamento
  const consentiu = c.lgpd === 'on' || c.lgpd === true || c.consentimento === true;
  if (!consentiu) erros.push('consentimento');

  if (erros.length) return { ok: false, erros };

  const doSistema = (s: Sistema) =>
    respostas.find((r) => todas.find(({ p }) => p.chave === r.chave)?.p.sistema === s)?.valor ?? '';

  return {
    ok: true,
    envio: {
      nome: doSistema('nome'),
      whatsapp: doSistema('whatsapp'),
      email: doSistema('email'),
      respostas,
    },
  };
}

/** O que o navegador precisa para desenhar o formulário, e nada além. */
export function publico(etapas: Etapa[]) {
  return etapas.map((e) => ({
    nome: e.nome,
    titulo: e.titulo,
    perguntas: e.perguntas.map((p) => ({
      chave: p.chave,
      tipo: p.tipo,
      rotulo: p.rotulo,
      ajuda: p.ajuda,
      opcoes: p.opcoes,
      obrigatoria: p.obrigatoria,
      sistema: p.sistema,
      meia: p.meia,
      mostrar_se: p.mostrar_se,
    })),
  }));
}
