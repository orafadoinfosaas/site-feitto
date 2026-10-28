/**
 * O formulário do diagnóstico, desenhado a partir do que o painel deixou no
 * banco.
 *
 * O mesmo código serve ao site e à área de teste do painel — é o que garante
 * que o teste é exatamente o que o lead vê. A diferença está nas opções: o
 * teste manda o token do painel e não guarda rascunho.
 *
 * Os estilos estão em src/styles/formulario.css, escopados em `.form-diag`.
 */

import { el } from './dom';

export interface PerguntaPublica {
  chave: string;
  tipo: 'escolha' | 'texto' | 'longo';
  rotulo: string;
  ajuda: string | null;
  opcoes: string[];
  obrigatoria: boolean;
  sistema: 'nome' | 'whatsapp' | 'email' | null;
  meia: boolean;
  mostrar_se: { chave: string; valor: string } | null;
}

export interface EtapaPublica {
  nome: string;
  titulo: string;
  perguntas: PerguntaPublica[];
}

export interface Opcoes {
  endpoint: string;
  /** chave no localStorage; null desliga o rascunho */
  rascunho: string | null;
  /** token do painel: o envio entra como lead de teste */
  token?: string;
  aoEnviar(id: string | undefined): void;
}

/** Erro que o servidor explicou, como o limite de envios. */
class Respondeu extends Error {
  constructor(
    readonly status: number,
    readonly mensagem?: string,
  ) {
    super(mensagem ?? String(status));
  }
}

const RASCUNHO_DIAS = 7;

/** Busca o formulário vigente. Sem resposta em poucos segundos, usa a reserva. */
export async function carregarDefinicao(
  endpoint: string,
  reserva: EtapaPublica[],
): Promise<EtapaPublica[]> {
  if (!endpoint) return reserva;
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(String(r.status));
    const { etapas } = (await r.json()) as { etapas: EtapaPublica[] };
    return etapas.filter((e) => e.perguntas.length).length ? etapas : reserva;
  } catch (e) {
    console.warn('[diagnóstico] formulário de reserva em uso:', e);
    return reserva;
  }
}

/* -------------------------------------------------------------------------- *
 * desenho
 * -------------------------------------------------------------------------- */

const dois = (n: number) => String(n).padStart(2, '0');

function asterisco(p: PerguntaPublica) {
  return p.obrigatoria ? el('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null;
}

function ajuda(p: PerguntaPublica, solta = false) {
  return p.ajuda
    ? el('p', { class: solta ? 'campo__ajuda campo__ajuda--solta' : 'campo__ajuda' }, p.ajuda)
    : null;
}

function desenharCampo(p: PerguntaPublica, prefixo: string): HTMLElement {
  const id = `${prefixo}${p.chave}`;
  const bloco = el('div', { class: p.tipo === 'texto' && p.meia ? 'campo campo--meia' : 'campo' });
  if (p.mostrar_se) {
    bloco.dataset.seCampo = p.mostrar_se.chave;
    bloco.dataset.seValor = p.mostrar_se.valor;
  }
  if (p.obrigatoria) bloco.dataset.req = 'sim';

  if (p.tipo === 'escolha') {
    const grupo = el('fieldset', { class: 'escolha' }, el('legend', {}, p.rotulo, asterisco(p)));
    grupo.append(ajuda(p, true) ?? '');
    const opcoes = el('div', { class: 'opcoes' });
    p.opcoes.forEach((opcao, j) => {
      const input = el('input', { id: `${id}-${j}`, type: 'radio', name: p.chave, value: opcao });
      input.required = p.obrigatoria && !p.mostrar_se && j === 0;
      opcoes.append(el('label', { class: 'opcao', for: `${id}-${j}` }, input, el('span', {}, opcao)));
    });
    grupo.append(opcoes);
    bloco.append(grupo);
    return bloco;
  }

  bloco.append(el('label', { for: id }, p.rotulo, asterisco(p)));
  bloco.append(ajuda(p) ?? '');

  if (p.tipo === 'longo') {
    const area = el('textarea', { id, name: p.chave, rows: '3', maxlength: '4000' });
    area.required = p.obrigatoria && !p.mostrar_se;
    bloco.append(area);
    return bloco;
  }

  const tipo = p.sistema === 'email' ? 'email' : p.sistema === 'whatsapp' ? 'tel' : 'text';
  const autocomplete =
    p.sistema === 'nome' ? 'name' : p.sistema === 'email' ? 'email' : p.sistema === 'whatsapp' ? 'tel' : 'off';
  const input = el('input', { id, name: p.chave, type: tipo, autocomplete, maxlength: '300' });
  input.required = p.obrigatoria && !p.mostrar_se;
  bloco.append(input);
  return bloco;
}

/* -------------------------------------------------------------------------- *
 * montagem
 * -------------------------------------------------------------------------- */

export interface Controle {
  /** mostra a primeira etapa e rola até ela */
  comecar(): void;
}

export function montarFormulario(
  form: HTMLFormElement,
  definicao: EtapaPublica[],
  opcoes: Opcoes,
): Controle {
  const prefixo = opcoes.token ? 'teste-' : '';
  const ativas = definicao.filter((e) => e.perguntas.length);
  const total = ativas.length;

  form.replaceChildren();
  form.classList.add('form-diag', 'is-stepped');
  form.noValidate = true;

  // progresso: o mesmo filete de 1px que abre as seções do site
  const barra = el('span', { class: 'progresso__feito' });
  const passoNum = el('span', {}, '01');
  const passoNome = el('span', {}, ativas[0]?.nome ?? '');
  const progresso = el(
    'div',
    { class: 'progresso' },
    el('div', { class: 'progresso__barra' }, barra),
    el(
      'p',
      { class: 'progresso__texto' },
      passoNum,
      ' ',
      el('span', { 'aria-hidden': 'true' }, '/'),
      ` ${dois(total)}`,
      el('span', { class: 'progresso__sep', 'aria-hidden': 'true' }, '·'),
      passoNome,
    ),
  );
  form.append(progresso);

  const etapas = ativas.map((etapa, idx) => {
    const fs = el('fieldset', { class: 'etapa' });
    fs.dataset.nome = etapa.nome;
    fs.dataset.num = dois(idx + 1);
    // uma pergunta de escolha sozinha na etapa pesa mais, como a de compromisso
    if (etapa.perguntas.length === 1 && etapa.perguntas[0].tipo === 'escolha') fs.dataset.unica = '';

    fs.append(el('legend', { class: 'visually-hidden' }, `Etapa ${dois(idx + 1)}: ${etapa.nome}`));
    fs.append(
      el(
        'div',
        { class: 'etapa__head' },
        el('p', { class: 'etapa__titulo' }, etapa.titulo),
      ),
    );

    const campos = el('div', { class: 'campos' });
    for (const p of etapa.perguntas) campos.append(desenharCampo(p, prefixo));

    // o consentimento fecha a última etapa, ao lado dos dados de contato
    if (idx === ativas.length - 1) {
      const caixa = el('input', { id: `${prefixo}lgpd`, name: 'lgpd', type: 'checkbox' });
      caixa.required = true;
      const politica = el('a', { href: '/politica-de-privacidade', target: '_blank' }, 'Política de Privacidade');
      campos.append(
        el(
          'div',
          { class: 'lgpd' },
          caixa,
          el(
            'label',
            { for: `${prefixo}lgpd` },
            'Autorizo a FEITTO a tratar os dados acima para analisar o meu caso e entrar em contato, conforme a ',
            politica,
            '. Posso pedir a exclusão a qualquer momento.',
          ),
        ),
      );
    }

    fs.append(campos);
    form.append(fs);
    return fs;
  });

  // armadilha: invisível para gente, irresistível para robô
  form.append(
    el(
      'div',
      { class: 'armadilha', 'aria-hidden': 'true' },
      el('label', { for: `${prefixo}sobrenome` }, 'Não preencha este campo'),
      el('input', { id: `${prefixo}sobrenome`, name: 'sobrenome', type: 'text', tabindex: '-1', autocomplete: 'off' }),
    ),
  );

  const erro = el('p', { class: 'erro', role: 'alert' });
  erro.hidden = true;
  form.append(erro);

  const btnVoltar = el(
    'button',
    { type: 'button', class: 'voltar' },
    el('span', { 'aria-hidden': 'true' }, '←'),
    ' Voltar',
  );
  const btnAvancar = el('button', { type: 'button', class: 'btn btn--solid' }, 'Continuar');
  const btnEnviar = el('button', { type: 'submit', class: 'btn btn--solid' }, 'Enviar minhas respostas');
  form.append(el('div', { class: 'controles' }, btnVoltar, btnAvancar, btnEnviar));

  const condicionais = [...form.querySelectorAll<HTMLElement>('[data-se-campo]')];
  const chaves = new Set(ativas.flatMap((e) => e.perguntas.map((p) => p.chave)));
  const ultima = etapas.length - 1;
  let atual = 0;

  /* ------------------------------------------------------------------ *
   * campos condicionais
   * ------------------------------------------------------------------ */

  /**
   * Um campo escondido por condição fica disabled: fora da validação, fora
   * do Tab e fora do FormData. Sem isso, o required de uma pergunta que a
   * pessoa nunca viu trava o envio com uma mensagem invisível.
   *
   * Condição que aponta para pergunta que não existe mais é ignorada — o
   * servidor faz o mesmo.
   */
  function aplicarCondicoes() {
    for (const bloco of condicionais) {
      const nome = bloco.dataset.seCampo!;
      const esperado = bloco.dataset.seValor!;
      const marcado = form.querySelector<HTMLInputElement>(`[name="${CSS.escape(nome)}"]:checked`);
      const valor =
        marcado?.value ?? (form.elements.namedItem(nome) as HTMLInputElement | null)?.value;
      const mostrar = !chaves.has(nome) || valor === esperado;
      const exigido = bloco.dataset.req === 'sim';

      bloco.toggleAttribute('data-ativo', mostrar);

      const campos = [...bloco.querySelectorAll<HTMLInputElement>('input, textarea')];
      campos.forEach((campo, i) => {
        campo.disabled = !mostrar;
        // num grupo de rádios basta o primeiro carregar o required
        if (exigido) campo.required = mostrar && (campo.type !== 'radio' || i === 0);
      });
    }
  }

  form.addEventListener('change', () => {
    aplicarCondicoes();
    salvar();
  });
  form.addEventListener('input', salvar);

  /* ------------------------------------------------------------------ *
   * rascunho
   * ------------------------------------------------------------------ */

  function salvar() {
    if (!opcoes.rascunho) return;
    try {
      const dados = coletar();
      localStorage.setItem(opcoes.rascunho, JSON.stringify({ at: Date.now(), passo: atual, dados }));
    } catch {
      /* storage bloqueado: o formulário segue, só não guarda rascunho */
    }
  }

  function restaurar() {
    if (!opcoes.rascunho) return;
    try {
      const bruto = localStorage.getItem(opcoes.rascunho);
      if (!bruto) return;

      const { at, dados } = JSON.parse(bruto) as { at: number; dados: Record<string, string> };
      if (!at || (Date.now() - at) / 86_400_000 > RASCUNHO_DIAS) {
        localStorage.removeItem(opcoes.rascunho);
        return;
      }

      for (const [nome, valor] of Object.entries(dados)) {
        if (!valor) continue;
        const campos = form.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(nome)}"]`);
        for (const campo of campos) {
          if (campo.type === 'radio') campo.checked = campo.value === valor;
          else if (campo.type === 'checkbox') campo.checked = valor === 'on';
          else campo.value = valor;
        }
      }
    } catch {
      /* rascunho corrompido: começa do zero */
    }
  }

  function limparRascunho() {
    if (!opcoes.rascunho) return;
    try {
      localStorage.removeItem(opcoes.rascunho);
    } catch {
      /* nada a fazer */
    }
  }

  /** As etapas fora de cena estão disabled, então FormData viria vazia. */
  function coletar(): Record<string, string> {
    const travadas = etapas.map((e) => e.disabled);
    for (const etapa of etapas) etapa.disabled = false;
    aplicarCondicoes(); // condicionais escondidas continuam de fora

    const dados = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;

    etapas.forEach((etapa, i) => (etapa.disabled = travadas[i]));
    return dados;
  }

  /* ------------------------------------------------------------------ *
   * navegação
   * ------------------------------------------------------------------ */

  function mostrar(indice: number, rolar = true) {
    atual = Math.max(0, Math.min(indice, ultima));

    etapas.forEach((etapa, i) => {
      etapa.hidden = i !== atual;
      etapa.disabled = i !== atual;
    });
    aplicarCondicoes();

    const etapa = etapas[atual];
    passoNum.textContent = etapa.dataset.num ?? '';
    passoNome.textContent = etapa.dataset.nome ?? '';
    barra.style.width = `${((atual + 1) / etapas.length) * 100}%`;

    btnVoltar.hidden = atual === 0;
    btnAvancar.hidden = atual === ultima;
    btnEnviar.hidden = atual !== ultima;
    erro.hidden = true;

    if (rolar) progresso.scrollIntoView({ behavior: 'smooth', block: 'start' });
    etapa
      .querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])')
      ?.focus({ preventScroll: true });
  }

  /** Valida só a etapa visível. As outras estão disabled e ficam de fora. */
  function etapaValida(): boolean {
    const campos = [...etapas[atual].querySelectorAll<HTMLInputElement>('input, textarea')];
    for (const campo of campos) {
      if (campo.disabled) continue;
      if (!campo.checkValidity()) {
        campo.reportValidity();
        campo.focus({ preventScroll: true });
        return false;
      }
    }
    return true;
  }

  btnAvancar.addEventListener('click', () => {
    if (etapaValida()) {
      salvar();
      mostrar(atual + 1);
    }
  });

  btnVoltar.addEventListener('click', () => mostrar(atual - 1));

  // Enter avança em vez de enviar, exceto na última etapa
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (atual !== ultima) {
      event.preventDefault();
      if (etapaValida()) mostrar(atual + 1);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    erro.hidden = true;
    if (!etapaValida()) return;

    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando…';
    const dados: Record<string, unknown> = coletar();
    if (opcoes.token) dados.__teste = true;

    try {
      let id: string | undefined;
      if (opcoes.endpoint) {
        const resposta = await fetch(opcoes.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
          },
          body: JSON.stringify(dados),
        });
        const corpo = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Respondeu(resposta.status, corpo?.erro);
        id = corpo?.id;
      } else {
        console.info('[diagnóstico] endpoint ainda não configurado. Respostas:', dados);
      }

      limparRascunho();
      opcoes.aoEnviar(id);
    } catch (e) {
      btnEnviar.disabled = false;
      btnEnviar.textContent = 'Enviar minhas respostas';
      erro.hidden = false;
      erro.textContent =
        e instanceof Respondeu && e.mensagem
          ? `${e.mensagem}${opcoes.rascunho ? ' Suas respostas ficaram guardadas neste navegador.' : ''}`
          : opcoes.rascunho
            ? 'Não consegui enviar agora. Suas respostas ficaram guardadas neste navegador. Tente de novo em instantes ou me escreva em contato@feitto.com.br que eu leio do mesmo jeito.'
            : 'Não consegui enviar agora.';
    }
  });

  restaurar();
  aplicarCondicoes();
  mostrar(0, false);

  return { comecar: () => mostrar(0) };
}
