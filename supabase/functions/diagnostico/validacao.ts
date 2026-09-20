/**
 * Validação do lado do servidor.
 *
 * O formulário já valida no navegador, mas nada do que chega aqui é confiável:
 * a função é pública e qualquer um pode postar direto nela. As listas abaixo
 * repetem, de propósito, as opções do formulário — se o texto mudar lá, muda
 * aqui, e a divergência aparece como erro em vez de virar lixo no banco.
 */

export const EM_OPERACAO = 'Tenho uma empresa em operação, com faturamento recorrente';
export const ESTRUTURANDO = 'Estou estruturando um negócio novo ou em transição de carreira';

const FRASES = [
  'Tenho bom produto e bom atendimento, mas as vendas não acompanham',
  'Cresci, mas o negócio depende demais da minha execução individual',
  'Vendo bem, mas de forma imprevisível',
  'Sinto que estou patinando: muito movimento e pouco avanço',
  'Tenho a ideia e a reputação, mas o negócio ainda não saiu do papel',
  'Está tudo estruturado e previsível, quero apenas otimizar pontos',
];

const PROCESSOS = [
  'Depende do talento individual de cada vendedor',
  'Vive de indicações e da minha rede pessoal',
  'Temos processo, mas sem previsibilidade de crescimento',
  'Temos processo, metas e previsibilidade consolidados',
];

const ANTES = [
  'Sim, entregaram um diagnóstico e sumiram. Nada mudou',
  'Sim, ajudou parcialmente',
  'Nunca contratei',
  'Sim, e resolveu. Não preciso de mais nada',
];

const ROTINAS = [
  'Apago incêndios o tempo todo',
  'Centralizo decisões para manter controle',
  'Domino o cenário atual, mas me sinto travado para expandir',
  'Rotina organizada, delego com tranquilidade',
];

const CONTRATARIA = [
  'Sim, é exatamente isso que eu procuro',
  'Talvez, preciso entender melhor a profundidade',
  'Não, o que eu quero é técnica rápida para o time',
];

const FATURAMENTO = [
  'Até R$ 30 mil',
  'R$ 30 mil a R$ 50 mil',
  'R$ 50 mil a R$ 200 mil',
  'R$ 200 mil a R$ 1 milhão',
  'Acima de R$ 1 milhão',
];

const RENDA = ['Até R$ 30 mil', 'R$ 30 mil a R$ 60 mil', 'Acima de R$ 60 mil'];

const EQUIPE = ['Apenas eu', '2 a 5 pessoas', '6 a 15 pessoas', 'Mais de 15 pessoas'];

const SEGMENTOS = [
  'Serviços profissionais B2B',
  'Saúde',
  'Arquitetura, engenharia ou construção',
  'Comunicação, marketing ou educação',
  'Varejo especializado ou alto padrão',
  'Indústria ou distribuição',
  'Outro',
];

const PRAZOS = ['Agora, é prioridade', 'Nos próximos 1 a 3 meses', 'Ainda estou pesquisando'];

const COMPROMISSOS = [
  'Sim, é o tipo de trabalho que eu procuro',
  'Talvez, preciso entender melhor a profundidade',
  'Não é o momento',
];

const PAPEIS = [
  'Sou fundador(a) ou sócio(a) e decido sobre investimentos',
  'Sou da liderança e influencio, mas não decido sozinho',
  'Sou de outra área ou estou pesquisando para alguém',
];

const CHEGADAS = ['Indicação de alguém', 'Instagram', 'LinkedIn', 'Busca no Google', 'Outro'];

export interface Diagnostico {
  nome: string;
  whatsapp: string;
  email: string;
  empresa: string | null;
  papel: string;
  chegada: string;
  indicou: string | null;
  momento: 'em_operacao' | 'estruturando';
  frase: string;
  obstaculo: string | null;
  adiando: string | null;
  processo: string;
  consultoria_antes: string | null;
  rotina: string;
  contrataria: string;
  faturamento: string | null;
  renda_pessoal: string | null;
  equipe: string;
  segmento: string;
  segmento_outro: string | null;
  deixou_na_mesa: string | null;
  prazo: string;
  compromisso: string;
  consentimento: true;
  politica_versao: string;
}

export type Resultado =
  | { ok: true; dados: Diagnostico }
  | { ok: false; erros: string[] };

const LIMITE_TEXTO = 4000;
const LIMITE_CURTO = 200;

function texto(valor: unknown, limite = LIMITE_CURTO): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().slice(0, limite);
  return limpo.length ? limpo : null;
}

function umaDe(valor: unknown, opcoes: readonly string[]): string | null {
  const t = texto(valor, 300);
  return t && opcoes.includes(t) ? t : null;
}

/** Checagem de formato, não de existência: quem erra o e-mail perde o retorno. */
function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
}

/** Aceita o que a pessoa digitou; só exige dígitos suficientes para discar. */
function whatsappValido(valor: string): boolean {
  return (valor.match(/\d/g) ?? []).length >= 10;
}

export function validar(corpo: unknown, politicaVersao: string): Resultado {
  const erros: string[] = [];
  if (typeof corpo !== 'object' || corpo === null) {
    return { ok: false, erros: ['corpo ausente'] };
  }
  const c = corpo as Record<string, unknown>;

  const nome = texto(c.nome, 160);
  if (!nome) erros.push('nome');

  const whatsapp = texto(c.whatsapp, 40);
  if (!whatsapp || !whatsappValido(whatsapp)) erros.push('whatsapp');

  const email = texto(c.email, 254)?.toLowerCase() ?? null;
  if (!email || !emailValido(email)) erros.push('email');

  const papel = umaDe(c.papel, PAPEIS);
  if (!papel) erros.push('papel');

  const chegada = umaDe(c.chegada, CHEGADAS);
  if (!chegada) erros.push('chegada');

  const momentoBruto = umaDe(c.momento, [EM_OPERACAO, ESTRUTURANDO]);
  if (!momentoBruto) erros.push('momento');

  const frase = umaDe(c.frase, FRASES);
  if (!frase) erros.push('frase');

  const processo = umaDe(c.processo, PROCESSOS);
  if (!processo) erros.push('processo');

  const rotina = umaDe(c.rotina, ROTINAS);
  if (!rotina) erros.push('rotina');

  const contrataria = umaDe(c.contrataria, CONTRATARIA);
  if (!contrataria) erros.push('contrataria');

  const equipe = umaDe(c.equipe, EQUIPE);
  if (!equipe) erros.push('equipe');

  const segmento = umaDe(c.segmento, SEGMENTOS);
  if (!segmento) erros.push('segmento');

  const prazo = umaDe(c.prazo, PRAZOS);
  if (!prazo) erros.push('prazo');

  const compromisso = umaDe(c.compromisso, COMPROMISSOS);
  if (!compromisso) erros.push('compromisso');

  // o consentimento não tem caminho alternativo: sem ele não há tratamento
  const consentiu = c.lgpd === 'on' || c.lgpd === true || c.consentimento === true;
  if (!consentiu) erros.push('consentimento');

  // a bifurcação: cada jornada informa o seu porte, e só o seu
  const emOperacao = momentoBruto === EM_OPERACAO;
  const faturamento = emOperacao ? umaDe(c.faturamento, FATURAMENTO) : null;
  const renda = emOperacao ? null : umaDe(c.renda, RENDA);

  if (emOperacao && !faturamento) erros.push('faturamento');
  if (!emOperacao && momentoBruto && !renda) erros.push('renda');

  if (erros.length) return { ok: false, erros };

  return {
    ok: true,
    dados: {
      nome: nome!,
      whatsapp: whatsapp!,
      email: email!,
      empresa: texto(c.empresa, 300),
      papel: papel!,
      chegada: chegada!,
      indicou: chegada === 'Indicação de alguém' ? texto(c.indicou, 160) : null,
      momento: emOperacao ? 'em_operacao' : 'estruturando',
      frase: frase!,
      obstaculo: texto(c.obstaculo, LIMITE_TEXTO),
      adiando: texto(c.adiando, LIMITE_TEXTO),
      processo: processo!,
      consultoria_antes: umaDe(c.antes, ANTES),
      rotina: rotina!,
      contrataria: contrataria!,
      faturamento,
      renda_pessoal: renda,
      equipe: equipe!,
      segmento: segmento!,
      segmento_outro: segmento === 'Outro' ? texto(c.segmentoOutro, 160) : null,
      deixou_na_mesa: texto(c.mesa, 120),
      prazo: prazo!,
      compromisso: compromisso!,
      consentimento: true,
      politica_versao: politicaVersao,
    },
  };
}
