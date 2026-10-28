/**
 * Editor do formulário: etapas e perguntas.
 *
 * Toda ação grava na hora e recarrega do servidor — com um formulário deste
 * tamanho, é mais simples e mais seguro do que manter estado local
 * sincronizado. O site passa a mostrar a mudança em até um minuto.
 *
 * Condições ("só aparece quando…") ainda não são criadas aqui. As que vieram
 * do formulário original aparecem na pergunta e podem ser removidas.
 */

import { el } from '../dom';
import type { Api, Etapa, Pergunta } from './api';

const TIPOS = {
  escolha: 'Múltipla escolha',
  texto: 'Texto curto',
  longo: 'Texto longo',
} as const;

type Tipo = keyof typeof TIPOS;

const SISTEMA = {
  nome: 'Nome do lead no CRM',
  whatsapp: 'WhatsApp do lead no CRM',
  email: 'E-mail do lead no CRM',
} as const;

export function montarEditor(raiz: HTMLElement, dialogo: HTMLDialogElement, api: Api) {
  let etapas: Etapa[] = [];
  const todas = () => etapas.flatMap((e) => e.perguntas);

  async function carregar() {
    try {
      etapas = (await api.chamar<{ etapas: Etapa[] }>('formulario.ler')).etapas;
      desenhar();
    } catch (erro) {
      raiz.replaceChildren(el('p', { class: 'aviso aviso--erro' }, `Não consegui carregar: ${(erro as Error).message}`));
    }
  }

  /** Executa, avisa se der errado, e recarrega do servidor de qualquer jeito. */
  async function agir(acao: string, dados: Record<string, unknown>) {
    try {
      await api.chamar(acao, dados);
    } catch (erro) {
      alert((erro as Error).message);
    }
    await carregar();
  }

  function trocar<T>(lista: T[], i: number, j: number): T[] {
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    return nova;
  }

  function botao(rotulo: string, titulo: string, acao: () => void, desligado = false) {
    const b = el('button', { type: 'button', class: 'icone', title: titulo, 'aria-label': titulo }, rotulo);
    b.disabled = desligado;
    b.addEventListener('click', acao);
    return b;
  }

  /* --------------------------------------------------------------- *
   * lista
   * --------------------------------------------------------------- */

  function descricaoCondicao(p: Pergunta): HTMLElement | null {
    if (!p.mostrar_se) return null;
    const origem = todas().find((q) => q.chave === p.mostrar_se!.chave);
    if (!origem) return null;
    const quebrada = !origem.opcoes.includes(p.mostrar_se.valor);
    return el(
      'p',
      { class: quebrada ? 'pergunta__condicao is-quebrada' : 'pergunta__condicao' },
      quebrada
        ? `Condição quebrada: depende da opção “${p.mostrar_se.valor}”, que não existe mais em “${origem.rotulo}”. Esta pergunta nunca aparece.`
        : `Só aparece quando “${origem.rotulo}” = “${p.mostrar_se.valor}”`,
    );
  }

  function linhaPergunta(p: Pergunta, etapa: Etapa, i: number): HTMLElement {
    const ids = etapa.perguntas.map((q) => q.id);
    return el(
      'li',
      { class: 'pergunta' },
      el(
        'div',
        { class: 'pergunta__texto' },
        el(
          'p',
          { class: 'pergunta__meta' },
          TIPOS[p.tipo],
          p.obrigatoria ? ' · obrigatória' : '',
          p.tipo === 'escolha' ? ` · ${p.opcoes.length} opções` : '',
          p.sistema ? ` · ${SISTEMA[p.sistema]}` : '',
        ),
        el('p', { class: 'pergunta__rotulo' }, p.rotulo),
        descricaoCondicao(p),
      ),
      el(
        'div',
        { class: 'pergunta__acoes' },
        botao('↑', 'Subir', () => agir('perguntas.ordenar', { ids: trocar(ids, i, i - 1) }), i === 0),
        botao('↓', 'Descer', () => agir('perguntas.ordenar', { ids: trocar(ids, i, i + 1) }), i === ids.length - 1),
        botao('Editar', 'Editar pergunta', () => editarPergunta(p, etapa.id)),
        p.sistema ? null : botao('Excluir', 'Excluir pergunta', () => excluirPergunta(p)),
      ),
    );
  }

  function blocoEtapa(etapa: Etapa, i: number): HTMLElement {
    const ids = etapas.map((e) => e.id);
    const nome = el('input', { type: 'text', value: etapa.nome, maxlength: '80', 'aria-label': 'Nome curto da etapa' });
    const titulo = el('input', { type: 'text', value: etapa.titulo, maxlength: '200', 'aria-label': 'Título da etapa' });
    const salvar = el('button', { type: 'button', class: 'btn btn--solid btn--mini' }, 'Salvar');
    salvar.hidden = true;
    const mudou = () => (salvar.hidden = nome.value === etapa.nome && titulo.value === etapa.titulo);
    nome.addEventListener('input', mudou);
    titulo.addEventListener('input', mudou);
    salvar.addEventListener('click', () => agir('etapa.salvar', { id: etapa.id, nome: nome.value, titulo: titulo.value }));

    const novaPergunta = el('button', { type: 'button', class: 'link' }, '+ Nova pergunta nesta etapa');
    novaPergunta.addEventListener('click', () => editarPergunta(null, etapa.id));

    return el(
      'section',
      { class: 'etapa-ed' },
      el(
        'header',
        { class: 'etapa-ed__cabeca' },
        el('span', { class: 'etapa-ed__num' }, String(i + 1).padStart(2, '0')),
        el(
          'div',
          { class: 'etapa-ed__campos' },
          el('label', {}, el('span', {}, 'Nome no progresso'), nome),
          el('label', {}, el('span', {}, 'Título da etapa'), titulo),
          salvar,
        ),
        el(
          'div',
          { class: 'pergunta__acoes' },
          botao('↑', 'Subir etapa', () => agir('etapas.ordenar', { ids: trocar(ids, i, i - 1) }), i === 0),
          botao('↓', 'Descer etapa', () => agir('etapas.ordenar', { ids: trocar(ids, i, i + 1) }), i === ids.length - 1),
          botao('Excluir', 'Excluir etapa', () => excluirEtapa(etapa)),
        ),
      ),
      etapa.perguntas.length
        ? el('ol', { class: 'perguntas' }, ...etapa.perguntas.map((p, j) => linhaPergunta(p, etapa, j)))
        : el('p', { class: 'aviso' }, 'Etapa sem perguntas: não aparece no site.'),
      novaPergunta,
    );
  }

  function desenhar() {
    const novaEtapa = el('button', { type: 'button', class: 'btn btn--ghost' }, '+ Nova etapa');
    novaEtapa.addEventListener('click', async () => {
      const nome = prompt('Nome curto da etapa (aparece no progresso):');
      if (!nome?.trim()) return;
      const titulo = prompt('Título da etapa (a frase grande do topo):', nome) ?? nome;
      await agir('etapa.criar', { nome, titulo: titulo.trim() || nome });
    });

    raiz.replaceChildren(
      el(
        'p',
        { class: 'nota-painel' },
        'Cada mudança grava na hora e aparece no site em até um minuto. Os leads que já chegaram guardam o texto das perguntas como estava quando responderam.',
      ),
      ...etapas.map(blocoEtapa),
      novaEtapa,
    );
  }

  /* --------------------------------------------------------------- *
   * exclusões
   * --------------------------------------------------------------- */

  function dependentes(chaves: string[]): Pergunta[] {
    return todas().filter((q) => q.mostrar_se && chaves.includes(q.mostrar_se.chave));
  }

  function avisoDependentes(chaves: string[]): string {
    const d = dependentes(chaves);
    if (!d.length) return '';
    return `\n\nEstas perguntas dependem dela e vão passar a aparecer sempre:\n${d.map((q) => `• ${q.rotulo}`).join('\n')}`;
  }

  async function excluirPergunta(p: Pergunta) {
    if (!confirm(`Excluir a pergunta “${p.rotulo}”?${avisoDependentes([p.chave])}`)) return;
    await agir('pergunta.excluir', { id: p.id });
  }

  async function excluirEtapa(etapa: Etapa) {
    const n = etapa.perguntas.length;
    const aviso = n ? ` As ${n} perguntas dela também serão excluídas.` : '';
    if (!confirm(`Excluir a etapa “${etapa.nome}”?${aviso}${avisoDependentes(etapa.perguntas.map((p) => p.chave))}`)) return;
    await agir('etapa.excluir', { id: etapa.id });
  }

  /* --------------------------------------------------------------- *
   * edição de uma pergunta
   * --------------------------------------------------------------- */

  function editarPergunta(p: Pergunta | null, etapaId: string) {
    const sistema = p?.sistema ?? null;
    let tipo: Tipo = p?.tipo ?? 'escolha';
    let opcoes = p?.opcoes.length ? [...p.opcoes] : ['', ''];

    const form = el('form', { class: 'ed-pergunta', method: 'dialog' });

    // tipo
    const tipos = el('fieldset', { class: 'ed-tipos' }, el('legend', {}, 'Tipo de resposta'));
    for (const [valor, nome] of Object.entries(TIPOS)) {
      const r = el('input', { type: 'radio', name: 'tipo', value: valor });
      r.checked = valor === tipo;
      r.disabled = sistema !== null;
      r.addEventListener('change', () => {
        tipo = valor as Tipo;
        mostrarPorTipo();
      });
      tipos.append(el('label', { class: 'ed-tipo' }, r, nome));
    }

    const rotulo = el('textarea', { rows: '3', maxlength: '600', required: '' });
    rotulo.value = p?.rotulo ?? '';
    const ajuda = el('input', { type: 'text', maxlength: '400', placeholder: 'Opcional. Uma linha de contexto abaixo da pergunta.' });
    ajuda.value = p?.ajuda ?? '';

    // opções
    const listaOpcoes = el('ol', { class: 'ed-opcoes' });
    const blocoOpcoes = el('div', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Opções'), listaOpcoes);
    const maisOpcao = el('button', { type: 'button', class: 'link' }, '+ Opção');
    maisOpcao.addEventListener('click', () => {
      opcoes.push('');
      desenharOpcoes();
      listaOpcoes.querySelector<HTMLInputElement>('li:last-child input')?.focus();
    });
    blocoOpcoes.append(maisOpcao);

    function desenharOpcoes() {
      listaOpcoes.replaceChildren(
        ...opcoes.map((o, i) => {
          const input = el('input', { type: 'text', maxlength: '300', 'aria-label': `Opção ${i + 1}` });
          input.value = o;
          input.addEventListener('input', () => (opcoes[i] = input.value));
          return el(
            'li',
            {},
            input,
            botao('↑', 'Subir opção', () => {
              opcoes = trocar(opcoes, i, i - 1);
              desenharOpcoes();
            }, i === 0),
            botao('↓', 'Descer opção', () => {
              opcoes = trocar(opcoes, i, i + 1);
              desenharOpcoes();
            }, i === opcoes.length - 1),
            botao('×', 'Remover opção', () => {
              opcoes.splice(i, 1);
              desenharOpcoes();
            }, opcoes.length <= 2),
          );
        }),
      );
    }

    // aviso: renomear uma opção da qual outra pergunta depende quebra a condição
    const dependem = p ? dependentes([p.chave]) : [];
    const avisoOpcoes = dependem.length
      ? el(
          'p',
          { class: 'aviso' },
          `Atenção: ${dependem.map((d) => `“${d.rotulo}”`).join(', ')} só aparece conforme a opção escolhida aqui. Mudar o texto de uma opção desliga essa condição.`,
        )
      : null;

    const obrigatoria = el('input', { type: 'checkbox' });
    obrigatoria.checked = sistema ? true : (p?.obrigatoria ?? false);
    obrigatoria.disabled = sistema !== null;

    const meia = el('input', { type: 'checkbox' });
    meia.checked = p?.meia ?? false;
    const blocoMeia = el('label', { class: 'ed-check' }, meia, 'Meia largura (fica ao lado da vizinha em telas grandes)');

    const etapaSel = el('select', {});
    for (const e of etapas) {
      const o = el('option', { value: e.id }, e.nome);
      o.selected = e.id === etapaId;
      etapaSel.append(o);
    }

    // condição: só leitura e remoção
    let condicao: HTMLElement | null = null;
    if (p?.mostrar_se) {
      const remover = el('button', { type: 'button', class: 'link' }, 'Remover condição');
      remover.addEventListener('click', async () => {
        if (!confirm('Sem a condição, esta pergunta passa a aparecer para todo mundo. Remover?')) return;
        dialogo.close();
        await agir('pergunta.removerCondicao', { id: p.id });
      });
      condicao = el('div', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Condição'), descricaoCondicao(p) ?? '', remover);
    }

    function mostrarPorTipo() {
      blocoOpcoes.hidden = tipo !== 'escolha';
      if (avisoOpcoes) avisoOpcoes.hidden = tipo !== 'escolha';
      blocoMeia.hidden = tipo !== 'texto';
    }

    const erro = el('p', { class: 'aviso aviso--erro' });
    erro.hidden = true;
    const salvar = el('button', { type: 'submit', class: 'btn btn--solid' }, p ? 'Salvar pergunta' : 'Criar pergunta');
    const cancelar = el('button', { type: 'button', class: 'link' }, 'Cancelar');
    cancelar.addEventListener('click', () => dialogo.close());

    form.append(
      el('h2', {}, p ? 'Editar pergunta' : 'Nova pergunta'),
      sistema
        ? el('p', { class: 'aviso' }, `${SISTEMA[sistema]}: dá para mudar o texto e a posição, mas não o tipo nem apagar.`)
        : '',
      tipos,
      el('label', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Pergunta'), rotulo),
      el('label', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Texto de ajuda'), ajuda),
      blocoOpcoes,
      avisoOpcoes ?? '',
      el('label', { class: 'ed-check' }, obrigatoria, 'Resposta obrigatória'),
      blocoMeia,
      el('label', { class: 'ed-campo' }, el('span', { class: 'ed-rotulo' }, 'Etapa'), etapaSel),
      condicao ?? '',
      erro,
      el('div', { class: 'acoes' }, salvar, cancelar),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limpas = opcoes.map((o) => o.trim()).filter(Boolean);
      if (tipo === 'escolha' && new Set(limpas).size < 2) {
        erro.textContent = 'Múltipla escolha precisa de pelo menos duas opções diferentes.';
        erro.hidden = false;
        return;
      }
      const dados = {
        tipo,
        rotulo: rotulo.value,
        ajuda: ajuda.value,
        opcoes: limpas,
        obrigatoria: obrigatoria.checked,
        meia: meia.checked,
        etapa_id: etapaSel.value,
      };
      salvar.disabled = true;
      try {
        if (p) await api.chamar('pergunta.salvar', { id: p.id, ...dados });
        else await api.chamar('pergunta.criar', dados);
        dialogo.close();
        await carregar();
      } catch (falha) {
        erro.textContent = (falha as Error).message;
        erro.hidden = false;
        salvar.disabled = false;
      }
    });

    desenharOpcoes();
    mostrarPorTipo();
    dialogo.replaceChildren(form);
    dialogo.showModal();
    rotulo.focus();
  }

  return { carregar };
}
