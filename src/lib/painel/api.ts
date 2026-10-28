/**
 * Conversa com a Edge Function `painel`. Guarda o token do login e avisa
 * quando ele vence, para a tela voltar ao login sem perder o contexto.
 */

import type { PerguntaPublica } from '../formulario';

export interface Pergunta extends PerguntaPublica {
  id: string;
  etapa_id: string;
  ordem: number;
}

export interface Etapa {
  id: string;
  ordem: number;
  nome: string;
  titulo: string;
  perguntas: Pergunta[];
}

export type Status = 'novo' | 'lido' | 'com_fit' | 'sem_fit' | 'arquivado';

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

export interface Lead {
  id: string;
  criado_em: string;
  nome: string;
  whatsapp: string;
  email: string;
  respostas: { chave: string; etapa: string; rotulo: string; tipo: string; valor: string }[];
  status: Status;
  observacao_interna: string | null;
  teste: boolean;
  movido_em: string | null;
  pre_status: 'pendente' | 'pronto' | 'erro' | 'sem_ia';
  pre_diagnostico: PreDiagnostico | null;
  pre_erro: string | null;
  pre_gerado_em: string | null;
  pre_modelo: string | null;
  pre_versao_id: string | null;
}

export interface VersaoIa {
  id: string;
  criado_em: string;
  instrucoes: string;
  modelo: string;
  nota: string | null;
  ativa: boolean;
}

export interface Documento {
  id: string;
  criado_em: string;
  nome: string;
  bytes: number;
}

const CHAVE_TOKEN = 'feitto.painel.token';

export class ErroApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
  }
}

export function criarApi(endpoint: string, aoExpirar: () => void) {
  let token: string | null = lerToken();

  function lerToken(): string | null {
    try {
      const bruto = localStorage.getItem(CHAVE_TOKEN);
      if (!bruto) return null;
      const { token, expira } = JSON.parse(bruto) as { token: string; expira: number };
      return expira > Date.now() ? token : null;
    } catch {
      return null;
    }
  }

  function guardar(novo: { token: string; expira: number } | null) {
    token = novo?.token ?? null;
    try {
      if (novo) localStorage.setItem(CHAVE_TOKEN, JSON.stringify(novo));
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch {
      /* sem storage: a sessão dura enquanto a aba estiver aberta */
    }
  }

  async function chamar<T>(acao: string, dados: Record<string, unknown> = {}, corpo?: FormData): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...(corpo ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: corpo ?? JSON.stringify({ acao, ...dados }),
      });
    } catch {
      throw new ErroApi('sem conexão com o servidor', 0);
    }
    const json = await resposta.json().catch(() => null);
    if (resposta.status === 401 && acao !== 'login') {
      guardar(null);
      aoExpirar();
    }
    if (!resposta.ok) throw new ErroApi(json?.erro ?? `erro ${resposta.status}`, resposta.status);
    return json as T;
  }

  return {
    get token() {
      return token;
    },
    logado: () => token !== null,
    async entrar(senha: string) {
      guardar(await chamar<{ token: string; expira: number }>('login', { senha }));
    },
    sair: () => guardar(null),
    chamar,
    enviarPdf(arquivo: File) {
      const corpo = new FormData();
      corpo.append('acao', 'documento.enviar');
      corpo.append('arquivo', arquivo);
      return chamar<{ documento: Documento }>('documento.enviar', {}, corpo);
    },
  };
}

export type Api = ReturnType<typeof criarApi>;
