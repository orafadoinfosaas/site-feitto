/**
 * A validação do envio contra o formulário do banco.
 *
 *   npx deno test --allow-env supabase/functions/_shared/
 */

import { assertEquals } from 'jsr:@std/assert@1';

// o módulo cria o cliente do Supabase na importação; aqui ele nunca é usado
Deno.env.set('SUPABASE_URL', 'http://localhost');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'teste');
const { validar } = await import('./formulario.ts');
type Etapa = import('./formulario.ts').Etapa;
type Pergunta = import('./formulario.ts').Pergunta;

let n = 0;
function p(campos: Partial<Pergunta> & Pick<Pergunta, 'chave' | 'tipo'>): Pergunta {
  return {
    id: String(++n),
    etapa_id: 'e',
    ordem: n,
    rotulo: campos.chave,
    ajuda: null,
    opcoes: [],
    obrigatoria: false,
    sistema: null,
    meia: false,
    mostrar_se: null,
    ...campos,
  };
}

const FORM: Etapa[] = [
  {
    id: 'e1',
    ordem: 1,
    nome: 'Momento',
    titulo: '',
    perguntas: [
      p({ chave: 'momento', tipo: 'escolha', opcoes: ['Opera', 'Funda'], obrigatoria: true }),
      p({
        chave: 'faturamento',
        tipo: 'escolha',
        opcoes: ['Pouco', 'Muito'],
        obrigatoria: true,
        mostrar_se: { chave: 'momento', valor: 'Opera' },
      }),
      p({ chave: 'dor', tipo: 'longo' }),
    ],
  },
  {
    id: 'e2',
    ordem: 2,
    nome: 'Contato',
    titulo: '',
    perguntas: [
      p({ chave: 'nome', tipo: 'texto', obrigatoria: true, sistema: 'nome' }),
      p({ chave: 'whatsapp', tipo: 'texto', obrigatoria: true, sistema: 'whatsapp' }),
      p({ chave: 'email', tipo: 'texto', obrigatoria: true, sistema: 'email' }),
    ],
  },
];

const BASE = {
  momento: 'Opera',
  faturamento: 'Muito',
  nome: ' Ana ',
  whatsapp: '(11) 99999-9999',
  email: 'ANA@X.COM',
  lgpd: 'on',
};

Deno.test('envio completo vira lead com cópia do texto das perguntas', () => {
  const r = validar(FORM, { ...BASE, dor: 'vendas' });
  if (!r.ok) throw new Error(r.erros.join());
  assertEquals(r.envio.nome, 'Ana');
  assertEquals(r.envio.email, 'ana@x.com');
  assertEquals(r.envio.respostas.map((x) => x.chave), [
    'momento',
    'faturamento',
    'dor',
    'nome',
    'whatsapp',
    'email',
  ]);
  assertEquals(r.envio.respostas[0], {
    chave: 'momento',
    etapa: 'Momento',
    rotulo: 'momento',
    tipo: 'escolha',
    valor: 'Opera',
  });
});

Deno.test('opção que não existe conta como não respondida', () => {
  const r = validar(FORM, { ...BASE, momento: 'Inventada' });
  assertEquals(r.ok ? [] : r.erros, ['momento']);
});

Deno.test('pergunta escondida por condição é descartada e não é exigida', () => {
  const r = validar(FORM, { ...BASE, momento: 'Funda', faturamento: 'Muito' });
  if (!r.ok) throw new Error(r.erros.join());
  assertEquals(r.envio.respostas.some((x) => x.chave === 'faturamento'), false);

  const semFat = validar(FORM, { ...BASE, faturamento: undefined });
  assertEquals(semFat.ok ? [] : semFat.erros, ['faturamento']);
});

Deno.test('condição que aponta para pergunta apagada deixa a pergunta sempre visível', () => {
  const semMomento: Etapa[] = [
    { ...FORM[0], perguntas: FORM[0].perguntas.filter((x) => x.chave !== 'momento') },
    FORM[1],
  ];
  const r = validar(semMomento, { ...BASE, momento: undefined, faturamento: undefined });
  assertEquals(r.ok ? [] : r.erros, ['faturamento']);
});

Deno.test('contato e consentimento são conferidos', () => {
  const r = validar(FORM, { ...BASE, email: 'ana', whatsapp: '123', lgpd: undefined });
  assertEquals(r.ok ? [] : r.erros, ['whatsapp', 'email', 'consentimento']);
});

Deno.test('campos que não são perguntas não entram nas respostas', () => {
  const r = validar(FORM, { ...BASE, invasor: 'x', __teste: true });
  if (!r.ok) throw new Error(r.erros.join());
  assertEquals(r.envio.respostas.length, 5);
});
