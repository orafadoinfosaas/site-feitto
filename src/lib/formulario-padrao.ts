import type { EtapaPublica } from './formulario';

/**
 * O formulário como saiu do código para o banco.
 *
 * Só entra em cena quando o endpoint não responde: é o que mantém o site
 * funcionando no intervalo entre o deploy dele e o do Supabase, e numa queda
 * do banco. As chaves são as mesmas do banco, então um envio feito com esta
 * cópia ainda valida — enquanto ninguém editar as perguntas no painel.
 */

const EM_OPERACAO = 'Tenho uma empresa em operação, com faturamento recorrente';
const ESTRUTURANDO = 'Estou estruturando um negócio novo ou em transição de carreira';

type Atalho = Partial<EtapaPublica['perguntas'][number]> &
  Pick<EtapaPublica['perguntas'][number], 'chave' | 'tipo' | 'rotulo'>;

const q = (p: Atalho) => ({
  ajuda: null,
  opcoes: [],
  obrigatoria: false,
  sistema: null,
  meia: false,
  mostrar_se: null,
  ...p,
});

export const formularioPadrao: EtapaPublica[] = [
  {
    nome: 'Seu momento',
    titulo: 'Vamos começar por onde você está.',
    perguntas: [
      q({
        chave: 'momento',
        tipo: 'escolha',
        rotulo: 'Qual é o seu momento?',
        opcoes: [EM_OPERACAO, ESTRUTURANDO],
        obrigatoria: true,
      }),
      q({
        chave: 'frase',
        tipo: 'escolha',
        rotulo: 'Qual frase descreve melhor onde você está hoje?',
        opcoes: [
          'Tenho bom produto e bom atendimento, mas as vendas não acompanham',
          'Cresci, mas o negócio depende demais da minha execução individual',
          'Vendo bem, mas de forma imprevisível',
          'Sinto que estou patinando: muito movimento e pouco avanço',
          'Tenho a ideia e a reputação, mas o negócio ainda não saiu do papel',
          'Está tudo estruturado e previsível, quero apenas otimizar pontos',
        ],
        obrigatoria: true,
      }),
    ],
  },
  {
    nome: 'O que trava',
    titulo: 'O que está travando.',
    perguntas: [
      q({
        chave: 'obstaculo',
        tipo: 'longo',
        rotulo: 'Qual é hoje o maior obstáculo para o crescimento do seu negócio?',
        ajuda: 'Escreva do seu jeito. É aqui que a leitura começa.',
      }),
      q({
        chave: 'adiando',
        tipo: 'longo',
        rotulo: 'Qual decisão importante você sabe que precisa tomar e vem adiando?',
      }),
    ],
  },
  {
    nome: 'Como você vende',
    titulo: 'Como a venda acontece hoje.',
    perguntas: [
      q({
        chave: 'processo',
        tipo: 'escolha',
        rotulo: 'Como você descreveria seu processo de vendas atual?',
        opcoes: [
          'Depende do talento individual de cada vendedor',
          'Vive de indicações e da minha rede pessoal',
          'Temos processo, mas sem previsibilidade de crescimento',
          'Temos processo, metas e previsibilidade consolidados',
        ],
        obrigatoria: true,
      }),
      q({
        chave: 'antes',
        tipo: 'escolha',
        rotulo: 'Você já contratou consultoria ou treinamento comercial antes?',
        opcoes: [
          'Sim, entregaram um diagnóstico e sumiram. Nada mudou',
          'Sim, ajudou parcialmente',
          'Nunca contratei',
          'Sim, e resolveu. Não preciso de mais nada',
        ],
      }),
    ],
  },
  {
    nome: 'Como você lidera',
    titulo: 'Como você lidera.',
    perguntas: [
      q({
        chave: 'rotina',
        tipo: 'escolha',
        rotulo: 'Como você descreveria sua rotina?',
        opcoes: [
          'Apago incêndios o tempo todo',
          'Centralizo decisões para manter controle',
          'Domino o cenário atual, mas me sinto travado para expandir',
          'Rotina organizada, delego com tranquilidade',
        ],
        obrigatoria: true,
      }),
      q({
        chave: 'contrataria',
        tipo: 'escolha',
        rotulo:
          'Você contrataria uma consultoria hoje sabendo que a estruturação começa pela liderança e pela cultura, e não por scripts prontos?',
        opcoes: [
          'Sim, é exatamente isso que eu procuro',
          'Talvez, preciso entender melhor a profundidade',
          'Não, o que eu quero é técnica rápida para o time',
        ],
        obrigatoria: true,
      }),
    ],
  },
  {
    nome: 'A operação',
    titulo: 'O tamanho da operação.',
    perguntas: [
      q({
        chave: 'faturamento',
        tipo: 'escolha',
        rotulo: 'Faturamento médio mensal da empresa',
        opcoes: [
          'Até R$ 30 mil',
          'R$ 30 mil a R$ 50 mil',
          'R$ 50 mil a R$ 200 mil',
          'R$ 200 mil a R$ 1 milhão',
          'Acima de R$ 1 milhão',
        ],
        obrigatoria: true,
        mostrar_se: { chave: 'momento', valor: EM_OPERACAO },
      }),
      q({
        chave: 'renda',
        tipo: 'escolha',
        rotulo: 'Sua renda pessoal média mensal hoje',
        ajuda: 'O negócio ainda está sendo estruturado, então é a sua renda que dá a referência.',
        opcoes: ['Até R$ 30 mil', 'R$ 30 mil a R$ 60 mil', 'Acima de R$ 60 mil'],
        obrigatoria: true,
        mostrar_se: { chave: 'momento', valor: ESTRUTURANDO },
      }),
      q({
        chave: 'equipe',
        tipo: 'escolha',
        rotulo: 'Quantas pessoas compõem sua equipe hoje?',
        opcoes: ['Apenas eu', '2 a 5 pessoas', '6 a 15 pessoas', 'Mais de 15 pessoas'],
        obrigatoria: true,
      }),
      q({
        chave: 'segmento',
        tipo: 'escolha',
        rotulo: 'Em que segmento você atua, ou vai atuar?',
        opcoes: [
          'Serviços profissionais B2B',
          'Saúde',
          'Arquitetura, engenharia ou construção',
          'Comunicação, marketing ou educação',
          'Varejo especializado ou alto padrão',
          'Indústria ou distribuição',
          'Outro',
        ],
        obrigatoria: true,
      }),
      q({
        chave: 'segmentoOutro',
        tipo: 'texto',
        rotulo: 'Qual?',
        mostrar_se: { chave: 'segmento', valor: 'Outro' },
      }),
    ],
  },
  {
    nome: 'O custo de esperar',
    titulo: 'O custo de esperar.',
    perguntas: [
      q({
        chave: 'mesa',
        tipo: 'texto',
        rotulo:
          'Quanto você estima ter deixado na mesa nos últimos doze meses por falta de uma operação comercial previsível?',
        ajuda: 'Um número aproximado basta. Ninguém vai cobrar exatidão.',
      }),
      q({
        chave: 'prazo',
        tipo: 'escolha',
        rotulo: 'Em quanto tempo você quer que a mudança comece?',
        opcoes: ['Agora, é prioridade', 'Nos próximos 1 a 3 meses', 'Ainda estou pesquisando'],
        obrigatoria: true,
      }),
    ],
  },
  {
    nome: 'Compromisso',
    titulo: 'A mais direta de todas.',
    perguntas: [
      q({
        chave: 'compromisso',
        tipo: 'escolha',
        rotulo:
          'O nosso trabalho mexe primeiro em como você decide, e isso pede a sua liderança dentro da sala. O ciclo e o investimento saem depois do diagnóstico, quando já sabemos o que o seu caso pede. Você está pronto para esse nível de envolvimento?',
        opcoes: [
          'Sim, é o tipo de trabalho que eu procuro',
          'Talvez, preciso entender melhor a profundidade',
          'Não é o momento',
        ],
        obrigatoria: true,
      }),
    ],
  },
  {
    nome: 'Por onde eu te respondo',
    titulo: 'Por onde eu te respondo.',
    perguntas: [
      q({ chave: 'nome', tipo: 'texto', rotulo: 'Nome completo', obrigatoria: true, sistema: 'nome' }),
      q({
        chave: 'whatsapp',
        tipo: 'texto',
        rotulo: 'WhatsApp',
        obrigatoria: true,
        sistema: 'whatsapp',
        meia: true,
      }),
      q({
        chave: 'email',
        tipo: 'texto',
        rotulo: 'E-mail',
        obrigatoria: true,
        sistema: 'email',
        meia: true,
      }),
      q({ chave: 'empresa', tipo: 'texto', rotulo: 'Empresa e site ou Instagram' }),
      q({
        chave: 'papel',
        tipo: 'escolha',
        rotulo: 'Qual o seu papel na empresa?',
        opcoes: [
          'Sou fundador(a) ou sócio(a) e decido sobre investimentos',
          'Sou da liderança e influencio, mas não decido sozinho',
          'Sou de outra área ou estou pesquisando para alguém',
        ],
        obrigatoria: true,
      }),
      q({
        chave: 'chegada',
        tipo: 'escolha',
        rotulo: 'Como você chegou até a FEITTO?',
        opcoes: ['Indicação de alguém', 'Instagram', 'LinkedIn', 'Busca no Google', 'Outro'],
        obrigatoria: true,
      }),
      q({
        chave: 'indicou',
        tipo: 'texto',
        rotulo: 'De quem?',
        mostrar_se: { chave: 'chegada', valor: 'Indicação de alguém' },
      }),
    ],
  },
];
