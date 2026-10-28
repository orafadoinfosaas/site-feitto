/**
 * Como um lead aparece: o cartão no quadro e a ficha completa.
 *
 * A ficha é a mesma no CRM e na área de teste — o teste mostra exatamente o
 * que vai chegar.
 */

import { el } from '../dom';
import type { Api, Lead, Status } from './api';

export const COLUNAS: { status: Status; nome: string }[] = [
  { status: 'novo', nome: 'Novo' },
  { status: 'lido', nome: 'Lido' },
  { status: 'com_fit', nome: 'Com fit' },
  { status: 'sem_fit', nome: 'Sem fit' },
  { status: 'arquivado', nome: 'Arquivado' },
];

const ENCAIXE = { alto: 'Encaixe alto', medio: 'Encaixe médio', baixo: 'Encaixe baixo' } as const;

export function quando(iso: string): string {
  const data = new Date(iso);
  const dias = Math.floor((Date.now() - data.getTime()) / 86_400_000);
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dias === 0 && new Date().getDate() === data.getDate()) return `hoje, ${hora}`;
  if (dias <= 1) return `ontem, ${hora}`;
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** wa.me pede só dígitos, com o código do país. Número brasileiro sem 55 ganha o 55. */
export function linkWhatsapp(numero: string, texto?: string): string {
  let digitos = numero.replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

function resposta(lead: Lead, chave: string): string | undefined {
  return lead.respostas.find((r) => r.chave === chave)?.valor;
}

export function selo(lead: Lead): HTMLElement | null {
  if (lead.pre_status === 'pendente') return el('span', { class: 'selo selo--pendente' }, 'Lendo…');
  if (lead.pre_status === 'erro') return el('span', { class: 'selo selo--erro' }, 'IA falhou');
  if (lead.pre_status === 'pronto' && lead.pre_diagnostico) {
    const e = lead.pre_diagnostico.encaixe;
    return el('span', { class: `selo selo--${e}` }, ENCAIXE[e]);
  }
  return null;
}

export function cartao(lead: Lead): HTMLElement {
  const empresa = resposta(lead, 'empresa');
  const resumo = lead.pre_diagnostico?.resumo;
  return el(
    'button',
    { type: 'button', class: 'cartao', 'data-id': lead.id, draggable: 'true' },
    el(
      'span',
      { class: 'cartao__topo' },
      el('span', { class: 'cartao__nome' }, lead.nome),
      lead.teste && el('span', { class: 'selo selo--teste' }, 'Teste'),
    ),
    empresa && el('span', { class: 'cartao__empresa' }, empresa),
    resumo && el('span', { class: 'cartao__resumo' }, resumo),
    el('span', { class: 'cartao__rodape' }, el('span', {}, quando(lead.criado_em)), selo(lead)),
  );
}

function lista(titulo: string, itens: string[]): HTMLElement | null {
  if (!itens.length) return null;
  return el(
    'div',
    { class: 'pre__bloco' },
    el('h4', {}, titulo),
    el('ul', {}, ...itens.map((i) => el('li', {}, i))),
  );
}

function paragrafo(titulo: string, texto: string): HTMLElement | null {
  if (!texto) return null;
  return el('div', { class: 'pre__bloco' }, el('h4', {}, titulo), el('p', {}, texto));
}

function blocoPre(lead: Lead, aoRegenerar: () => void): HTMLElement {
  const sec = el('section', { class: 'ficha__sec pre' }, el('h3', {}, 'Pré-diagnóstico'));
  const regenerar = el('button', { type: 'button', class: 'link' }, 'Gerar de novo');
  regenerar.addEventListener('click', () => {
    regenerar.disabled = true;
    regenerar.textContent = 'Gerando…';
    aoRegenerar();
  });

  if (lead.pre_status === 'pendente') {
    sec.append(el('p', { class: 'aviso' }, 'A IA está lendo este caso. A ficha atualiza sozinha.'));
    return sec;
  }
  if (lead.pre_status === 'sem_ia') {
    sec.append(
      el('p', { class: 'aviso' }, 'Sem leitura da IA: a chave da OpenAI ou as instruções não estavam configuradas quando este lead chegou.'),
      regenerar,
    );
    return sec;
  }
  if (lead.pre_status === 'erro' || !lead.pre_diagnostico) {
    sec.append(el('p', { class: 'aviso aviso--erro' }, `A IA não conseguiu ler: ${lead.pre_erro ?? 'erro desconhecido'}`), regenerar);
    return sec;
  }

  const p = lead.pre_diagnostico;
  const mensagem = el('div', { class: 'pre__bloco pre__mensagem' }, el('h4', {}, 'Rascunho de mensagem'));
  const texto = el('textarea', { rows: '5' });
  texto.value = p.rascunho_mensagem;
  const copiar = el('button', { type: 'button', class: 'link' }, 'Copiar');
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto.value);
      copiar.textContent = 'Copiado';
    } catch {
      texto.select();
    }
  });
  const abrir = el('a', { class: 'link', target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp');
  const atualizarLink = () => (abrir.href = linkWhatsapp(lead.whatsapp, texto.value));
  texto.addEventListener('input', atualizarLink);
  atualizarLink();
  mensagem.append(texto, el('div', { class: 'acoes' }, copiar, abrir));

  sec.append(
    el(
      'p',
      { class: 'pre__encaixe' },
      el('span', { class: `selo selo--${p.encaixe}` }, ENCAIXE[p.encaixe]),
      ' ',
      p.porque_do_encaixe,
    ),
    paragrafo('Resumo', p.resumo) ?? '',
    lista('Dores', p.dores) ?? '',
    lista('Sinais positivos', p.sinais_positivos) ?? '',
    lista('Pontos de atenção', p.pontos_de_atencao) ?? '',
    paragrafo('Recomendação', p.recomendacao) ?? '',
    lista('Perguntas para a conversa', p.perguntas_para_conversa) ?? '',
    mensagem,
    el(
      'p',
      { class: 'pre__meta' },
      `Gerado ${lead.pre_gerado_em ? quando(lead.pre_gerado_em) : ''} com ${lead.pre_modelo ?? '—'}. `,
      regenerar,
    ),
  );
  return sec;
}

function blocoRespostas(lead: Lead): HTMLElement {
  const sec = el('section', { class: 'ficha__sec' }, el('h3', {}, 'Respostas'));
  let etapa = '';
  let dl: HTMLDListElement | null = null;
  for (const r of lead.respostas) {
    if (r.etapa !== etapa) {
      etapa = r.etapa;
      sec.append(el('h4', { class: 'respostas__etapa' }, etapa));
      dl = el('dl', { class: 'respostas' });
      sec.append(dl);
    }
    dl!.append(el('dt', {}, r.rotulo), el('dd', {}, r.valor));
  }
  return sec;
}

export interface AcoesFicha {
  api: Api;
  /** depois de qualquer mudança, para o quadro se redesenhar */
  aoMudar(lead: Lead | null): void;
}

/** A ficha completa do lead, com o que dá para fazer nela. */
export function ficha(lead: Lead, { api, aoMudar }: AcoesFicha): HTMLElement {
  const raiz = el('article', { class: 'ficha' });

  const status = el('select', { 'aria-label': 'Coluna' });
  for (const c of COLUNAS) {
    const o = el('option', { value: c.status }, c.nome);
    o.selected = c.status === lead.status;
    status.append(o);
  }
  status.addEventListener('change', async () => {
    await api.chamar('lead.atualizar', { id: lead.id, status: status.value });
    aoMudar({ ...lead, status: status.value as Status });
  });

  raiz.append(
    el(
      'header',
      { class: 'ficha__cabeca' },
      el(
        'div',
        {},
        el('h2', {}, lead.nome, lead.teste ? el('span', { class: 'selo selo--teste' }, 'Teste') : null),
        el('p', { class: 'ficha__data' }, `Chegou ${quando(lead.criado_em)}`),
      ),
      status,
    ),
    el(
      'p',
      { class: 'ficha__contato' },
      el('a', { href: linkWhatsapp(lead.whatsapp), target: '_blank', rel: 'noopener' }, lead.whatsapp),
      el('a', { href: `mailto:${lead.email}` }, lead.email),
    ),
  );

  raiz.append(
    blocoPre(lead, async () => {
      const { lead: novo } = await api.chamar<{ lead: Lead }>('lead.rediagnosticar', { id: lead.id });
      aoMudar(novo);
    }),
  );

  // observação: grava ao sair do campo
  const obs = el('textarea', { rows: '3', placeholder: 'Só você vê. Ex.: liguei terça, pediu proposta.' });
  obs.value = lead.observacao_interna ?? '';
  const salvo = el('span', { class: 'salvo', 'aria-live': 'polite' });
  obs.addEventListener('change', async () => {
    salvo.textContent = 'Salvando…';
    await api.chamar('lead.atualizar', { id: lead.id, observacao_interna: obs.value });
    salvo.textContent = 'Salvo';
    aoMudar({ ...lead, observacao_interna: obs.value });
  });
  raiz.append(
    el('section', { class: 'ficha__sec' }, el('h3', {}, 'Observação interna'), obs, salvo),
    blocoRespostas(lead),
  );

  const excluir = el('button', { type: 'button', class: 'link link--perigo' }, 'Excluir este lead');
  excluir.addEventListener('click', async () => {
    if (!confirm(`Excluir ${lead.nome} de vez? Use quando a pessoa pedir a exclusão dos dados ou para limpar um teste. Não tem volta.`)) return;
    await api.chamar('lead.excluir', { id: lead.id });
    aoMudar(null);
  });
  raiz.append(el('footer', { class: 'ficha__rodape' }, excluir));

  return raiz;
}
