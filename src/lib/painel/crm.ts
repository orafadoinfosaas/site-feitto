/**
 * O quadro de leads: uma coluna por status, cartões que se arrastam entre
 * elas e uma ficha que abre ao clicar.
 *
 * Arrastar é atalho. A mesma mudança está no seletor da ficha, que é o que
 * funciona no celular e no teclado.
 */

import { el } from '../dom';
import type { Api, Lead, Status } from './api';
import { cartao, COLUNAS, ficha } from './lead';

/** Enquanto algum lead estiver com a IA lendo, o quadro se atualiza sozinho. */
const INTERVALO_PENDENTE = 5000;

export function montarCrm(raiz: HTMLElement, dialogo: HTMLDialogElement, api: Api) {
  let leads: Lead[] = [];
  let mostrarTestes = false;
  let busca = '';
  let abertoId: string | null = null;
  let relogio: number | undefined;

  const contador = el('span', { class: 'crm__contador' });
  const campoBusca = el('input', { type: 'search', placeholder: 'Buscar por nome, e-mail ou resposta', 'aria-label': 'Buscar' });
  const testes = el('input', { type: 'checkbox', id: 'crm-testes' });
  const quadro = el('div', { class: 'quadro' });

  raiz.replaceChildren(
    el(
      'div',
      { class: 'barra' },
      campoBusca,
      el('label', { class: 'barra__check', for: 'crm-testes' }, testes, 'Mostrar testes'),
      contador,
    ),
    quadro,
  );

  campoBusca.addEventListener('input', () => {
    busca = campoBusca.value.trim().toLowerCase();
    desenhar();
  });
  testes.addEventListener('change', () => {
    mostrarTestes = testes.checked;
    carregar();
  });

  function visiveis(): Lead[] {
    if (!busca) return leads;
    return leads.filter((l) =>
      [l.nome, l.email, l.whatsapp, l.observacao_interna ?? '', ...l.respostas.map((r) => r.valor)]
        .join(' ')
        .toLowerCase()
        .includes(busca),
    );
  }

  function desenhar() {
    const lista = visiveis();
    contador.textContent = `${lista.length} ${lista.length === 1 ? 'lead' : 'leads'}`;

    quadro.replaceChildren(
      ...COLUNAS.map(({ status, nome }) => {
        const daColuna = lista.filter((l) => l.status === status);
        const corpo = el('div', { class: 'coluna__corpo' }, ...daColuna.map(cartao));
        if (!daColuna.length) corpo.append(el('p', { class: 'coluna__vazia' }, 'Nenhum'));
        const coluna = el(
          'section',
          { class: 'coluna', 'data-status': status },
          el('h3', { class: 'coluna__nome' }, nome, el('span', {}, String(daColuna.length))),
          corpo,
        );
        return coluna;
      }),
    );
  }

  /* --------------------------------------------------------------- *
   * arrastar
   * --------------------------------------------------------------- */

  quadro.addEventListener('dragstart', (e) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>('.cartao');
    if (!alvo || !e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', alvo.dataset.id!);
    e.dataTransfer.effectAllowed = 'move';
    alvo.classList.add('is-arrastando');
  });
  quadro.addEventListener('dragend', (e) => {
    (e.target as HTMLElement).classList?.remove('is-arrastando');
    quadro.querySelectorAll('.is-alvo').forEach((c) => c.classList.remove('is-alvo'));
  });
  quadro.addEventListener('dragover', (e) => {
    const coluna = (e.target as HTMLElement).closest<HTMLElement>('.coluna');
    if (!coluna) return;
    e.preventDefault();
    quadro.querySelectorAll('.is-alvo').forEach((c) => c !== coluna && c.classList.remove('is-alvo'));
    coluna.classList.add('is-alvo');
  });
  quadro.addEventListener('drop', async (e) => {
    const coluna = (e.target as HTMLElement).closest<HTMLElement>('.coluna');
    const id = e.dataTransfer?.getData('text/plain');
    if (!coluna || !id) return;
    e.preventDefault();
    const status = coluna.dataset.status as Status;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;

    // muda na tela na hora; se o servidor recusar, volta
    const anterior = lead.status;
    lead.status = status;
    desenhar();
    try {
      await api.chamar('lead.atualizar', { id, status });
    } catch (erro) {
      lead.status = anterior;
      desenhar();
      alert(`Não consegui mover: ${(erro as Error).message}`);
    }
  });

  /* --------------------------------------------------------------- *
   * ficha
   * --------------------------------------------------------------- */

  quadro.addEventListener('click', (e) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>('.cartao');
    if (alvo) abrir(alvo.dataset.id!);
  });

  function abrir(id: string) {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    abertoId = id;
    const fechar = el('button', { type: 'button', class: 'dialogo__fechar', 'aria-label': 'Fechar' }, '×');
    fechar.addEventListener('click', () => dialogo.close());
    dialogo.replaceChildren(
      fechar,
      ficha(lead, {
        api,
        aoMudar(novo) {
          if (!novo) {
            leads = leads.filter((l) => l.id !== id);
            dialogo.close();
          } else {
            leads = leads.map((l) => (l.id === id ? novo : l));
            if (novo.pre_status !== lead.pre_status || novo.pre_gerado_em !== lead.pre_gerado_em) {
              abrir(id);
            }
          }
          desenhar();
          vigiar();
        },
      }),
    );
    if (!dialogo.open) dialogo.showModal();
  }

  dialogo.addEventListener('close', () => (abertoId = null));

  /* --------------------------------------------------------------- *
   * dados
   * --------------------------------------------------------------- */

  async function carregar() {
    try {
      const r = await api.chamar<{ leads: Lead[] }>('leads.listar', { testes: mostrarTestes });
      const antes = new Map(leads.map((l) => [l.id, l]));
      leads = r.leads;
      desenhar();

      // a ficha aberta acompanha o lead quando a IA termina de ler
      if (abertoId) {
        const velho = antes.get(abertoId);
        const novo = leads.find((l) => l.id === abertoId);
        if (novo && velho && novo.pre_status !== velho.pre_status) abrir(abertoId);
      }
    } catch (erro) {
      contador.textContent = `Não consegui carregar: ${(erro as Error).message}`;
    }
    vigiar();
  }

  function vigiar() {
    clearTimeout(relogio);
    if (leads.some((l) => l.pre_status === 'pendente')) {
      relogio = window.setTimeout(carregar, INTERVALO_PENDENTE);
    }
  }

  return {
    carregar,
    /** para a área de teste mandar ver o lead que acabou de criar */
    mostrarTestes() {
      testes.checked = true;
      mostrarTestes = true;
      return carregar();
    },
    abrir,
  };
}
