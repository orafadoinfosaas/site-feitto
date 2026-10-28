/**
 * API do painel.
 *
 * Um endpoint só, com `acao` no corpo. Tudo exige o token emitido no login,
 * menos o próprio login. A upload de PDF chega em multipart; o resto, JSON.
 *
 * As tabelas continuam sem policy de RLS: o navegador nunca fala com o banco,
 * só com esta função, que usa a service role depois de conferir o token.
 */

import {
  contarRecentes,
  cors,
  hashIp,
  json,
  origemLiberada,
  registrarTentativa,
  supabase,
} from '../_shared/http.ts';
import { carregarFormulario, type Tipo } from '../_shared/formulario.ts';
import {
  apagarArquivo,
  enviarArquivo,
  gerarPreDiagnostico,
  iaConfigurada,
  listarModelos,
} from '../_shared/prediagnostico.ts';
import { emitirToken, painelConfigurado, senhaConfere, tokenValido } from '../_shared/sessao.ts';

/** Tentativas erradas de senha por IP, a cada 15 minutos. */
const LIMITE_LOGIN = 10;

const TIPOS: Tipo[] = ['escolha', 'texto', 'longo'];
const STATUS = ['novo', 'lido', 'com_fit', 'sem_fit', 'arquivado'];

/** A OpenAI aceita até ~32 MB de arquivos por chamada; cada PDF fica bem abaixo. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;

class Recusa extends Error {
  constructor(mensagem: string, readonly status = 400) {
    super(mensagem);
  }
}

type Dados = Record<string, unknown>;

/* -------------------------------------------------------------------------- *
 * leitura e saneamento da entrada
 * -------------------------------------------------------------------------- */

function str(d: Dados, campo: string, max: number, obrigatorio = true): string | null {
  const v = d[campo];
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw new Recusa(`${campo} é obrigatório`);
    return null;
  }
  if (typeof v !== 'string') throw new Recusa(`${campo} inválido`);
  const limpo = v.trim();
  if (!limpo && obrigatorio) throw new Recusa(`${campo} é obrigatório`);
  if (limpo.length > max) throw new Recusa(`${campo} passa de ${max} caracteres`);
  return limpo || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(d: Dados, campo = 'id'): string {
  const v = d[campo];
  if (typeof v !== 'string' || !UUID.test(v)) throw new Recusa(`${campo} inválido`);
  return v;
}

function listaDeIds(d: Dados): string[] {
  const v = d.ids;
  if (!Array.isArray(v) || !v.every((id) => typeof id === 'string' && UUID.test(id))) {
    throw new Recusa('ids inválidos');
  }
  return v as string[];
}

/** Opções sem espaço sobrando, sem vazias e sem repetidas. */
function opcoes(d: Dados): string[] {
  const v = d.opcoes;
  if (!Array.isArray(v)) return [];
  const limpas = v
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const o of limpas) if (o.length > 300) throw new Recusa('opção passa de 300 caracteres');
  return [...new Set(limpas)];
}

function checar<T>(r: { data: T; error: unknown }): T {
  if (r.error) {
    console.error(r.error);
    throw new Recusa('o banco recusou a operação', 500);
  }
  return r.data;
}

function novaChave(): string {
  const aleatorio = crypto.getRandomValues(new Uint8Array(6));
  return 'p' + [...aleatorio].map((b) => (b % 36).toString(36)).join('');
}

/* -------------------------------------------------------------------------- *
 * formulário
 * -------------------------------------------------------------------------- */

async function proximaOrdem(tabela: string, filtro?: [string, string]): Promise<number> {
  let consulta = supabase.from(tabela).select('ordem').order('ordem', { ascending: false }).limit(1);
  if (filtro) consulta = consulta.eq(filtro[0], filtro[1]);
  const linhas = checar(await consulta) as { ordem: number }[];
  return (linhas[0]?.ordem ?? 0) + 1;
}

async function ordenar(tabela: string, ids: string[]): Promise<void> {
  const resultados = await Promise.all(
    ids.map((id, i) => supabase.from(tabela).update({ ordem: i + 1 }).eq('id', id)),
  );
  for (const r of resultados) checar(r);
}

/** O que a pergunta precisa ter para o tipo dela, já validado. */
function camposDaPergunta(d: Dados, tipo: Tipo) {
  const lista = tipo === 'escolha' ? opcoes(d) : [];
  if (tipo === 'escolha' && lista.length < 2) {
    throw new Recusa('múltipla escolha precisa de pelo menos duas opções');
  }
  return {
    tipo,
    rotulo: str(d, 'rotulo', 600)!,
    ajuda: str(d, 'ajuda', 400, false),
    opcoes: lista,
    obrigatoria: d.obrigatoria === true,
    meia: tipo === 'texto' && d.meia === true,
  };
}

function tipo(d: Dados): Tipo {
  if (!TIPOS.includes(d.tipo as Tipo)) throw new Recusa('tipo de pergunta inválido');
  return d.tipo as Tipo;
}

const acoesFormulario = {
  async 'formulario.ler'() {
    return { etapas: await carregarFormulario() };
  },

  async 'etapa.criar'(d: Dados) {
    const etapa = checar(
      await supabase
        .from('form_etapas')
        .insert({
          nome: str(d, 'nome', 80),
          titulo: str(d, 'titulo', 200),
          ordem: await proximaOrdem('form_etapas'),
        })
        .select()
        .single(),
    );
    return { etapa };
  },

  async 'etapa.salvar'(d: Dados) {
    checar(
      await supabase
        .from('form_etapas')
        .update({ nome: str(d, 'nome', 80), titulo: str(d, 'titulo', 200) })
        .eq('id', uuid(d)),
    );
    return {};
  },

  async 'etapa.excluir'(d: Dados) {
    const id = uuid(d);
    const protegidas = checar(
      await supabase.from('form_perguntas').select('id').eq('etapa_id', id).not('sistema', 'is', null),
    ) as unknown[];
    if (protegidas.length) {
      throw new Recusa('esta etapa tem nome, WhatsApp ou e-mail. Mova essas perguntas antes.');
    }
    const total = checar(await supabase.from('form_etapas').select('id')) as unknown[];
    if (total.length <= 1) throw new Recusa('o formulário precisa de pelo menos uma etapa');

    await soltarDependentesDaEtapa(id);
    checar(await supabase.from('form_etapas').delete().eq('id', id));
    return {};
  },

  async 'etapas.ordenar'(d: Dados) {
    await ordenar('form_etapas', listaDeIds(d));
    return {};
  },

  async 'pergunta.criar'(d: Dados) {
    const etapaId = uuid(d, 'etapa_id');
    const pergunta = checar(
      await supabase
        .from('form_perguntas')
        .insert({
          ...camposDaPergunta(d, tipo(d)),
          etapa_id: etapaId,
          chave: novaChave(),
          ordem: await proximaOrdem('form_perguntas', ['etapa_id', etapaId]),
        })
        .select()
        .single(),
    );
    return { pergunta };
  },

  async 'pergunta.salvar'(d: Dados) {
    const id = uuid(d);
    const atual = checar(
      await supabase.from('form_perguntas').select('sistema, etapa_id').eq('id', id).single(),
    ) as { sistema: string | null; etapa_id: string };

    // nome, WhatsApp e e-mail: texto e posição mudam; tipo e obrigatoriedade, não
    const campos = atual.sistema
      ? { rotulo: str(d, 'rotulo', 600)!, ajuda: str(d, 'ajuda', 400, false), meia: d.meia === true }
      : camposDaPergunta(d, tipo(d));

    const mudancas: Dados = { ...campos };
    if (typeof d.etapa_id === 'string' && d.etapa_id !== atual.etapa_id) {
      const destino = uuid(d, 'etapa_id');
      mudancas.etapa_id = destino;
      mudancas.ordem = await proximaOrdem('form_perguntas', ['etapa_id', destino]);
    }

    checar(await supabase.from('form_perguntas').update(mudancas).eq('id', id));
    return {};
  },

  async 'pergunta.excluir'(d: Dados) {
    const id = uuid(d);
    const p = checar(
      await supabase.from('form_perguntas').select('chave, sistema').eq('id', id).single(),
    ) as { chave: string; sistema: string | null };
    if (p.sistema) throw new Recusa('nome, WhatsApp e e-mail não podem ser excluídos');

    await soltarDependentes([p.chave]);
    checar(await supabase.from('form_perguntas').delete().eq('id', id));
    return {};
  },

  async 'pergunta.removerCondicao'(d: Dados) {
    checar(await supabase.from('form_perguntas').update({ mostrar_se: null }).eq('id', uuid(d)));
    return {};
  },

  async 'perguntas.ordenar'(d: Dados) {
    await ordenar('form_perguntas', listaDeIds(d));
    return {};
  },
};

/**
 * Quem dependia de uma pergunta apagada passa a aparecer sempre. Melhor do
 * que ficar escondido para sempre por uma condição que não existe mais.
 */
async function soltarDependentes(chaves: string[]): Promise<void> {
  if (!chaves.length) return;
  checar(
    await supabase
      .from('form_perguntas')
      .update({ mostrar_se: null })
      .in('mostrar_se->>chave', chaves),
  );
}

async function soltarDependentesDaEtapa(etapaId: string): Promise<void> {
  const linhas = checar(
    await supabase.from('form_perguntas').select('chave').eq('etapa_id', etapaId),
  ) as { chave: string }[];
  await soltarDependentes(linhas.map((l) => l.chave));
}

/* -------------------------------------------------------------------------- *
 * leads
 * -------------------------------------------------------------------------- */

const CAMPOS_LEAD =
  'id, criado_em, nome, whatsapp, email, respostas, status, observacao_interna, teste, movido_em, ' +
  'pre_status, pre_diagnostico, pre_erro, pre_gerado_em, pre_modelo, pre_versao_id';

async function lerLead(id: string) {
  return checar(await supabase.from('leads').select(CAMPOS_LEAD).eq('id', id).single());
}

const acoesLeads = {
  async 'leads.listar'(d: Dados) {
    let consulta = supabase
      .from('leads')
      .select(CAMPOS_LEAD)
      .order('criado_em', { ascending: false })
      .limit(1000);
    if (d.testes !== true) consulta = consulta.eq('teste', false);
    return { leads: checar(await consulta) };
  },

  async 'lead.ler'(d: Dados) {
    return { lead: await lerLead(uuid(d)) };
  },

  async 'lead.atualizar'(d: Dados) {
    const mudancas: Dados = {};
    if (d.status !== undefined) {
      if (!STATUS.includes(d.status as string)) throw new Recusa('status inválido');
      mudancas.status = d.status;
      mudancas.movido_em = new Date().toISOString();
    }
    if (d.observacao_interna !== undefined) {
      mudancas.observacao_interna = str(d, 'observacao_interna', 4000, false);
    }
    checar(await supabase.from('leads').update(mudancas).eq('id', uuid(d)));
    return {};
  },

  /** Pedido de exclusão (LGPD, art. 18, VI) ou limpeza de teste. */
  async 'lead.excluir'(d: Dados) {
    checar(await supabase.from('leads').delete().eq('id', uuid(d)));
    return {};
  },

  async 'leads.excluirTestes'() {
    checar(await supabase.from('leads').delete().eq('teste', true));
    return {};
  },

  /** Síncrono, de propósito: o painel espera e já mostra o resultado. */
  async 'lead.rediagnosticar'(d: Dados) {
    const id = uuid(d);
    await gerarPreDiagnostico(id);
    return { lead: await lerLead(id) };
  },
};

/* -------------------------------------------------------------------------- *
 * IA
 * -------------------------------------------------------------------------- */

const acoesIa = {
  async 'ia.ler'() {
    const [versoes, documentos] = await Promise.all([
      supabase
        .from('ia_versoes')
        .select('id, criado_em, instrucoes, modelo, nota, ativa')
        .order('criado_em', { ascending: false })
        .limit(30),
      supabase.from('ia_documentos').select('id, criado_em, nome, bytes').order('criado_em'),
    ]);
    return {
      chaveConfigurada: iaConfigurada(),
      versoes: checar(versoes),
      documentos: checar(documentos),
    };
  },

  async 'ia.modelos'() {
    return { modelos: iaConfigurada() ? await listarModelos() : [] };
  },

  async 'ia.salvar'(d: Dados) {
    const versao = checar(
      await supabase
        .from('ia_versoes')
        .insert({
          instrucoes: str(d, 'instrucoes', 40000),
          modelo: str(d, 'modelo', 80),
          nota: str(d, 'nota', 200, false),
        })
        .select('id')
        .single(),
    ) as { id: string };
    checar(await supabase.rpc('ativar_versao_ia', { versao: versao.id }));
    return { id: versao.id };
  },

  async 'ia.ativar'(d: Dados) {
    checar(await supabase.rpc('ativar_versao_ia', { versao: uuid(d) }));
    return {};
  },

  async 'documento.excluir'(d: Dados) {
    const id = uuid(d);
    const doc = checar(
      await supabase.from('ia_documentos').select('openai_file_id').eq('id', id).single(),
    ) as { openai_file_id: string };
    if (iaConfigurada()) await apagarArquivo(doc.openai_file_id);
    checar(await supabase.from('ia_documentos').delete().eq('id', id));
    return {};
  },
};

async function enviarDocumento(form: FormData) {
  if (!iaConfigurada()) throw new Recusa('a chave da OpenAI ainda não foi configurada');

  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) throw new Recusa('arquivo ausente');
  if (arquivo.type !== 'application/pdf' && !arquivo.name.toLowerCase().endsWith('.pdf')) {
    throw new Recusa('só PDF');
  }
  if (arquivo.size > PDF_MAX_BYTES) throw new Recusa('o PDF passa de 10 MB');

  const fileId = await enviarArquivo(arquivo);
  const doc = checar(
    await supabase
      .from('ia_documentos')
      .insert({ nome: arquivo.name.slice(0, 200), bytes: arquivo.size, openai_file_id: fileId })
      .select('id, criado_em, nome, bytes')
      .single(),
  );
  return { documento: doc };
}

/* -------------------------------------------------------------------------- *
 * entrada
 * -------------------------------------------------------------------------- */

const ACOES: Record<string, (d: Dados) => Promise<unknown>> = {
  ...acoesFormulario,
  ...acoesLeads,
  ...acoesIa,
};

async function login(req: Request, d: Dados): Promise<unknown> {
  if (!painelConfigurado()) {
    throw new Recusa('o painel ainda não tem senha configurada (PAINEL_SENHA)', 503);
  }
  const ipHash = await hashIp(req, 'login:');
  if ((await contarRecentes(ipHash, 15 * 60_000)) >= LIMITE_LOGIN) {
    throw new Recusa('muitas tentativas. Espere quinze minutos.', 429);
  }
  const senha = typeof d.senha === 'string' ? d.senha : '';
  if (!(await senhaConfere(senha))) {
    await registrarTentativa(ipHash);
    throw new Recusa('senha incorreta', 401);
  }
  return emitirToken();
}

Deno.serve(async (req) => {
  const origem = req.headers.get('origin');
  const cabecalhos = cors(origem, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cabecalhos });
  }
  if (req.method !== 'POST') {
    return json({ erro: 'método não permitido' }, 405, cabecalhos);
  }
  if (origem && !origemLiberada(origem)) {
    return json({ erro: 'origem não permitida' }, 403, cabecalhos);
  }

  try {
    const multipart = req.headers.get('content-type')?.startsWith('multipart/form-data');
    const form = multipart ? await req.formData() : null;
    const d: Dados = form
      ? { acao: form.get('acao') }
      : await req.json().catch(() => {
          throw new Recusa('json inválido');
        });

    if (d.acao === 'login') return json(await login(req, d), 200, cabecalhos);

    if (!(await tokenValido(req))) throw new Recusa('sessão expirada', 401);

    if (form && d.acao === 'documento.enviar') {
      return json(await enviarDocumento(form), 200, cabecalhos);
    }

    const acao = ACOES[d.acao as string];
    if (!acao) throw new Recusa('ação desconhecida', 404);
    return json(await acao(d), 200, cabecalhos);
  } catch (e) {
    if (e instanceof Recusa) return json({ erro: e.message }, e.status, cabecalhos);
    console.error('painel', e);
    const motivo = e instanceof Error ? e.message : 'erro inesperado';
    return json({ erro: motivo }, 500, cabecalhos);
  }
});
