/**
 * Instruções, modelo e documentos da IA do pré-diagnóstico.
 *
 * Cada gravação vira uma versão nova e passa a valer para os próximos leads.
 * As anteriores ficam no histórico: dá para reler e voltar a qualquer uma.
 */

import { el } from '../dom';
import type { Api, Documento, VersaoIa } from './api';
import { quando } from './lead';

const PADRAO_MODELO = 'gpt-5-mini';

function tamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function montarIa(raiz: HTMLElement, api: Api) {
  let versoes: VersaoIa[] = [];
  let documentos: Documento[] = [];
  let chaveConfigurada = false;

  const instrucoes = el('textarea', { rows: '18', maxlength: '40000', class: 'ia__instrucoes' });
  const modelo = el('input', { type: 'text', list: 'ia-modelos', maxlength: '80' });
  const modelos = el('datalist', { id: 'ia-modelos' });
  const nota = el('input', { type: 'text', maxlength: '200', placeholder: 'O que mudou? Ex.: mais rigor com quem não decide' });
  const salvar = el('button', { type: 'button', class: 'btn btn--solid' }, 'Salvar e usar esta versão');
  const salvo = el('span', { class: 'salvo', 'aria-live': 'polite' });
  const historico = el('ol', { class: 'versoes' });
  const listaDocs = el('ul', { class: 'docs' });
  const aviso = el('div', {});
  const arquivo = el('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'ia-pdf' });
  const enviando = el('span', { class: 'salvo', 'aria-live': 'polite' });

  raiz.replaceChildren(
    aviso,
    el(
      'section',
      { class: 'painel-sec' },
      el('h2', {}, 'Instruções'),
      el(
        'p',
        { class: 'nota-painel' },
        'É o que a IA lê antes de cada caso: quem é a FEITTO, como avaliar o encaixe e em que tom escrever. A resposta sempre volta nos mesmos campos do card (encaixe, resumo, dores, sinais, pontos de atenção, recomendação, perguntas e rascunho de mensagem). Nome, WhatsApp e e-mail do lead nunca são enviados à OpenAI.',
      ),
      instrucoes,
      el(
        'div',
        { class: 'ia__linha' },
        el('label', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Modelo'), modelo, modelos),
        el('label', { class: 'ed-campo ia__nota' }, el('span', { class: 'ed-rotulo' }, 'Nota desta versão'), nota),
      ),
      el('div', { class: 'acoes' }, salvar, salvo),
    ),
    el(
      'section',
      { class: 'painel-sec' },
      el('h2', {}, 'Documentos de apoio'),
      el(
        'p',
        { class: 'nota-painel' },
        'PDFs que a IA lê inteiros junto com as instruções, em todo caso: método, perfil de cliente ideal, exemplos de boas leituras. Poucos e enxutos funcionam melhor — cada página entra no custo de cada lead. Até 10 MB por arquivo.',
      ),
      listaDocs,
      el('div', { class: 'acoes' }, el('label', { class: 'btn btn--ghost', for: 'ia-pdf' }, 'Enviar PDF'), arquivo, enviando),
    ),
    el('section', { class: 'painel-sec' }, el('h2', {}, 'Versões anteriores'), historico),
  );
  arquivo.classList.add('visually-hidden');

  function desenhar() {
    aviso.replaceChildren(
      chaveConfigurada
        ? ''
        : el(
            'p',
            { class: 'aviso aviso--erro' },
            'A chave da OpenAI ainda não está configurada no servidor (OPENAI_API_KEY). Os leads chegam normalmente, mas sem pré-diagnóstico, e não dá para enviar PDFs.',
          ),
    );

    const ativa = versoes.find((v) => v.ativa);
    if (document.activeElement !== instrucoes) instrucoes.value = ativa?.instrucoes ?? '';
    if (document.activeElement !== modelo) modelo.value = ativa?.modelo ?? PADRAO_MODELO;

    historico.replaceChildren(
      ...versoes.map((v) => {
        const ver = el('button', { type: 'button', class: 'link' }, 'Carregar no editor');
        ver.addEventListener('click', () => {
          instrucoes.value = v.instrucoes;
          modelo.value = v.modelo;
          nota.value = `Volta à versão de ${quando(v.criado_em)}`;
          instrucoes.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const usar = el('button', { type: 'button', class: 'link' }, 'Usar esta');
        usar.addEventListener('click', async () => {
          await api.chamar('ia.ativar', { id: v.id });
          await carregar();
        });
        return el(
          'li',
          { class: v.ativa ? 'versao is-ativa' : 'versao' },
          el(
            'p',
            {},
            el('strong', {}, quando(v.criado_em)),
            ` · ${v.modelo}`,
            v.ativa ? el('span', { class: 'selo selo--alto' }, 'Em uso') : null,
          ),
          v.nota ? el('p', { class: 'versao__nota' }, v.nota) : null,
          el('div', { class: 'acoes' }, ver, v.ativa ? null : usar),
        );
      }),
    );

    listaDocs.replaceChildren(
      ...documentos.map((d) => {
        const excluir = el('button', { type: 'button', class: 'link link--perigo' }, 'Excluir');
        excluir.addEventListener('click', async () => {
          if (!confirm(`Excluir “${d.nome}”? A IA deixa de ler este documento nos próximos leads.`)) return;
          try {
            await api.chamar('documento.excluir', { id: d.id });
          } catch (erro) {
            alert((erro as Error).message);
          }
          await carregar();
        });
        return el('li', {}, el('span', {}, d.nome), el('span', { class: 'docs__meta' }, `${tamanho(d.bytes)} · ${quando(d.criado_em)}`), excluir);
      }),
    );
    if (!documentos.length) listaDocs.append(el('li', { class: 'docs__vazio' }, 'Nenhum documento. A IA usa só as instruções.'));
    arquivo.disabled = !chaveConfigurada;
  }

  salvar.addEventListener('click', async () => {
    if (!instrucoes.value.trim() || !modelo.value.trim()) {
      salvo.textContent = 'Instruções e modelo são obrigatórios.';
      return;
    }
    salvar.disabled = true;
    salvo.textContent = 'Salvando…';
    try {
      await api.chamar('ia.salvar', { instrucoes: instrucoes.value, modelo: modelo.value, nota: nota.value });
      nota.value = '';
      salvo.textContent = 'Salvo. Vale a partir do próximo lead.';
      instrucoes.blur();
      await carregar();
    } catch (erro) {
      salvo.textContent = (erro as Error).message;
    }
    salvar.disabled = false;
  });

  arquivo.addEventListener('change', async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    enviando.textContent = `Enviando ${f.name}…`;
    try {
      await api.enviarPdf(f);
      enviando.textContent = 'Enviado.';
    } catch (erro) {
      enviando.textContent = `Não foi: ${(erro as Error).message}`;
    }
    arquivo.value = '';
    await carregar();
  });

  async function carregar() {
    try {
      const r = await api.chamar<{ chaveConfigurada: boolean; versoes: VersaoIa[]; documentos: Documento[] }>('ia.ler');
      ({ versoes, documentos, chaveConfigurada } = r);
      desenhar();
    } catch (erro) {
      aviso.replaceChildren(el('p', { class: 'aviso aviso--erro' }, `Não consegui carregar: ${(erro as Error).message}`));
    }
  }

  // a lista de modelos vem da própria chave: é o que ela de fato alcança
  async function carregarModelos() {
    try {
      const { modelos: ids } = await api.chamar<{ modelos: string[] }>('ia.modelos');
      modelos.replaceChildren(...ids.map((id) => el('option', { value: id })));
    } catch {
      /* sem lista, o campo continua aceitando o nome digitado */
    }
  }

  return {
    async carregar() {
      await carregar();
      carregarModelos();
    },
  };
}
