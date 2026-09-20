/** Dados reais pendentes — a Luana envia. Trocar aqui reflete no site todo. */
export const site = {
  name: 'FEITTO',
  assinatura: 'Clareza é a nova estratégia.',
  fecho: 'Da visão à realização.',
  categoria: 'Inteligência Comercial',
  email: 'contato@feitto.com.br',
  // [PENDENTE] confirmar com a Luana
  whatsapp: '',
  instagram: '',
  linkedin: '',
} as const;

/**
 * Edge Function que recebe o diagnóstico.
 *
 * Não é segredo: esta URL aparece no JavaScript de qualquer visitante. Por
 * isso o valor real fica aqui, e não num build argument que, esquecido, faz
 * o formulário parar de enviar sem dizer nada. A variável de ambiente ainda
 * sobrescreve, para apontar a um projeto de teste quando precisar.
 */
export const diagnosticoEndpoint =
  import.meta.env.PUBLIC_DIAGNOSTICO_ENDPOINT ||
  'https://ixhkxejqqeinhpvobtsx.supabase.co/functions/v1/diagnostico';

export const nav = [
  { href: '/metodo', label: 'O método' },
  { href: '/quem-conduz', label: 'Quem conduz' },
  { href: '/casos', label: 'Casos' },
] as const;
