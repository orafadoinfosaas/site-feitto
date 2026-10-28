/**
 * Pré-diagnóstico: a primeira leitura do caso, feita pela IA com a chave da
 * OpenAI da própria FEITTO.
 *
 * Roda depois que o lead já está gravado. Se a OpenAI falhar, o lead não se
 * perde: o card fica com o erro e um botão para tentar de novo.
 *
 * Por que sem busca vetorial: são poucos PDFs, que servem mais para instruir
 * do que para consultar. Eles vão inteiros em cada chamada (input_file), o
 * que é mais previsível que uma busca escolhendo trechos — e não exige
 * vector store para manter.
 *
 * O que vai para a OpenAI: só as respostas. Nome, WhatsApp e e-mail ficam de
 * fora, porque a leitura não precisa deles (LGPD, art. 6º, III).
 */

import { supabase } from './http.ts';
import type { Resposta } from './formulario.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const API = 'https://api.openai.com/v1';

export function iaConfigurada(): boolean {
  return OPENAI_API_KEY.length > 0;
}

/** O formato do card. Strict: a OpenAI garante que a resposta segue isto. */
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'encaixe',
    'porque_do_encaixe',
    'resumo',
    'dores',
    'sinais_positivos',
    'pontos_de_atencao',
    'recomendacao',
    'perguntas_para_conversa',
    'rascunho_mensagem',
  ],
  properties: {
    encaixe: { type: 'string', enum: ['alto', 'medio', 'baixo'] },
    porque_do_encaixe: { type: 'string', description: 'Uma ou duas frases.' },
    resumo: { type: 'string', description: 'Quem é e em que momento está, em até 4 frases.' },
    dores: { type: 'array', items: { type: 'string' } },
    sinais_positivos: { type: 'array', items: { type: 'string' } },
    pontos_de_atencao: { type: 'array', items: { type: 'string' } },
    recomendacao: { type: 'string', description: 'O próximo passo sugerido para a Luana.' },
    perguntas_para_conversa: { type: 'array', items: { type: 'string' } },
    rascunho_mensagem: { type: 'string', description: 'Primeira mensagem de WhatsApp.' },
  },
} as const;

export interface PreDiagnostico {
  encaixe: 'alto' | 'medio' | 'baixo';
  porque_do_encaixe: string;
  resumo: string;
  dores: string[];
  sinais_positivos: string[];
  pontos_de_atencao: string[];
  recomendacao: string;
  perguntas_para_conversa: string[];
  rascunho_mensagem: string;
}

interface Versao {
  id: string;
  instrucoes: string;
  modelo: string;
}

const CONTATO = new Set(['nome', 'whatsapp', 'email']);

/** As respostas como a IA lê: agrupadas por etapa, sem os dados de contato. */
export function montarCaso(respostas: Resposta[], sistemas: Set<string>): string {
  const linhas: string[] = ['Respostas do lead ao formulário de diagnóstico.', ''];
  let etapa = '';
  for (const r of respostas) {
    if (sistemas.has(r.chave) || CONTATO.has(r.chave)) continue;
    if (r.etapa !== etapa) {
      etapa = r.etapa;
      linhas.push(`## ${etapa}`, '');
    }
    linhas.push(`Pergunta: ${r.rotulo}`, `Resposta: ${r.valor}`, '');
  }
  return linhas.join('\n');
}

async function chamarOpenAI(
  versao: Versao,
  caso: string,
  arquivos: string[],
): Promise<PreDiagnostico> {
  const resposta = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: versao.modelo,
      instructions: versao.instrucoes,
      input: [
        {
          role: 'user',
          content: [
            ...arquivos.map((file_id) => ({ type: 'input_file', file_id })),
            { type: 'input_text', text: caso },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'pre_diagnostico', strict: true, schema: ESQUEMA },
      },
      // a conversa não fica guardada na OpenAI além do necessário
      store: false,
    }),
    signal: AbortSignal.timeout(150_000),
  });

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(corpo?.error?.message ?? `OpenAI respondeu ${resposta.status}`);
  }
  if (corpo?.status === 'incomplete') {
    throw new Error(`resposta incompleta: ${corpo?.incomplete_details?.reason ?? 'sem motivo'}`);
  }

  const conteudo = (corpo?.output ?? [])
    .filter((item: { type: string }) => item.type === 'message')
    .flatMap((item: { content: { type: string; text?: string; refusal?: string }[] }) => item.content);

  const recusa = conteudo.find((c: { type: string }) => c.type === 'refusal');
  if (recusa) throw new Error(`a IA recusou: ${recusa.refusal}`);

  const texto = conteudo.find((c: { type: string }) => c.type === 'output_text')?.text;
  if (!texto) throw new Error('a OpenAI não devolveu texto');
  return JSON.parse(texto) as PreDiagnostico;
}

/**
 * Gera e grava o pré-diagnóstico de um lead. Nunca lança: o resultado, bom
 * ou ruim, fica no próprio lead.
 */
export async function gerarPreDiagnostico(leadId: string): Promise<void> {
  const [lead, versao, docs, sistemas] = await Promise.all([
    supabase.from('leads').select('respostas').eq('id', leadId).single(),
    supabase.from('ia_versoes').select('id, instrucoes, modelo').eq('ativa', true).maybeSingle(),
    supabase.from('ia_documentos').select('openai_file_id').order('criado_em'),
    supabase.from('form_perguntas').select('chave').not('sistema', 'is', null),
  ]);

  if (lead.error || !lead.data) {
    console.error('pré-diagnóstico: lead não encontrado', leadId, lead.error);
    return;
  }

  if (!iaConfigurada() || !versao.data) {
    await supabase.from('leads').update({ pre_status: 'sem_ia', pre_erro: null }).eq('id', leadId);
    return;
  }

  await supabase.from('leads').update({ pre_status: 'pendente', pre_erro: null }).eq('id', leadId);

  try {
    const caso = montarCaso(
      lead.data.respostas as Resposta[],
      new Set((sistemas.data ?? []).map((s) => s.chave as string)),
    );
    const resultado = await chamarOpenAI(
      versao.data as Versao,
      caso,
      (docs.data ?? []).map((d) => d.openai_file_id as string),
    );

    await supabase
      .from('leads')
      .update({
        pre_status: 'pronto',
        pre_diagnostico: resultado,
        pre_erro: null,
        pre_gerado_em: new Date().toISOString(),
        pre_versao_id: versao.data.id,
        pre_modelo: versao.data.modelo,
      })
      .eq('id', leadId);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error('pré-diagnóstico falhou', leadId, motivo);
    await supabase
      .from('leads')
      .update({ pre_status: 'erro', pre_erro: motivo.slice(0, 500) })
      .eq('id', leadId);
  }
}

/* -------------------------------------------------------------------------- *
 * Arquivos e modelos, para o painel
 * -------------------------------------------------------------------------- */

export async function enviarArquivo(arquivo: File): Promise<string> {
  const corpo = new FormData();
  corpo.append('purpose', 'user_data');
  corpo.append('file', arquivo, arquivo.name);

  const resposta = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: corpo,
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new Error(dados?.error?.message ?? `OpenAI respondeu ${resposta.status}`);
  return dados.id as string;
}

export async function apagarArquivo(fileId: string): Promise<void> {
  const resposta = await fetch(`${API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  // já apagado do lado de lá também serve
  if (!resposta.ok && resposta.status !== 404) {
    const dados = await resposta.json().catch(() => null);
    throw new Error(dados?.error?.message ?? `OpenAI respondeu ${resposta.status}`);
  }
}

/** Os modelos de texto que esta chave alcança, para o painel sugerir. */
export async function listarModelos(): Promise<string[]> {
  const resposta = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  if (!resposta.ok) return [];
  const dados = await resposta.json().catch(() => null);
  return ((dados?.data ?? []) as { id: string }[])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id))
    .filter((id) => !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(id))
    .sort();
}
