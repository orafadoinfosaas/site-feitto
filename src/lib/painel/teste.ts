/**
 * Área de teste: o formulário exatamente como o lead vê, e a ficha
 * exatamente como chega no CRM.
 *
 * Usa o mesmo desenho do site (src/lib/formulario.ts) e o mesmo endpoint. A
 * única diferença é o token do painel no envio: o lead entra marcado como
 * teste, fica fora do quadro principal e não conta no limite por IP.
 */

import { el } from '../dom';
import { carregarDefinicao, montarFormulario } from '../formulario';
import type { Api, Lead } from './api';
import { ficha } from './lead';

const INTERVALO = 3000;

export function montarTeste(
  raiz: HTMLElement,
  api: Api,
  endpointFormulario: string,
  verNoCrm: (id: string) => void,
) {
  const area = el('div', { class: 'teste' });
  const limpar = el('button', { type: 'button', class: 'link link--perigo' }, 'Excluir todos os leads de teste');
  limpar.addEventListener('click', async () => {
    if (!confirm('Excluir todos os leads marcados como teste?')) return;
    await api.chamar('leads.excluirTestes');
    limpar.textContent = 'Testes excluídos';
  });

  raiz.replaceChildren(
    el(
      'p',
      { class: 'nota-painel' },
      'Responda como um lead. O envio passa pelo mesmo caminho do site, gera o pré-diagnóstico com as instruções em uso e aparece no CRM marcado como teste.',
    ),
    area,
    el('p', { class: 'teste__rodape' }, limpar),
  );

  let relogio: number | undefined;

  async function formulario() {
    clearTimeout(relogio);
    const form = el('form', { class: 'teste__form' });
    area.replaceChildren(el('p', { class: 'aviso' }, 'Carregando as perguntas…'));

    // sem a cópia de reserva: aqui, se o banco não responde, é isso que importa ver
    const definicao = await carregarDefinicao(`${endpointFormulario}?t=${Date.now()}`, []);
    if (!definicao.length) {
      area.replaceChildren(el('p', { class: 'aviso aviso--erro' }, 'Não consegui carregar o formulário do banco.'));
      return;
    }

    area.replaceChildren(form);
    montarFormulario(form, definicao, {
      endpoint: endpointFormulario,
      rascunho: null,
      token: api.token ?? undefined,
      aoEnviar(id) {
        if (id) acompanhar(id);
      },
    });
  }

  async function acompanhar(id: string) {
    clearTimeout(relogio);
    let lead: Lead;
    try {
      lead = (await api.chamar<{ lead: Lead }>('lead.ler', { id })).lead;
    } catch (erro) {
      area.replaceChildren(el('p', { class: 'aviso aviso--erro' }, (erro as Error).message));
      return;
    }

    const denovo = el('button', { type: 'button', class: 'btn btn--solid' }, 'Testar de novo');
    denovo.addEventListener('click', formulario);
    const crm = el('button', { type: 'button', class: 'btn btn--ghost' }, 'Ver no CRM');
    crm.addEventListener('click', () => verNoCrm(id));

    area.replaceChildren(
      el(
        'div',
        { class: 'teste__resultado' },
        el('p', { class: 'teste__ok' }, 'Lead de teste recebido. É assim que ele chega no CRM:'),
        el('div', { class: 'teste__ficha' }, ficha(lead, {
          api,
          aoMudar(novo) {
            if (novo) acompanhar(novo.id);
            else formulario();
          },
        })),
        el('div', { class: 'acoes' }, denovo, crm),
      ),
    );

    if (lead.pre_status === 'pendente') relogio = window.setTimeout(() => acompanhar(id), INTERVALO);
  }

  return { carregar: formulario };
}
