/**
 * Espelho do lead no ClickUp.
 *
 * Cada diagnóstico vira um card com as respostas já organizadas na ordem em
 * que a Luana lê: primeiro quem é e como chegou, depois o que trava, depois a
 * qualificação. É o pré-atendimento em forma de texto — quando o agente de IA
 * entrar, ele substitui a seção "Leitura" e o resto continua igual.
 */

import type { Diagnostico } from './validacao.ts';

const API = 'https://api.clickup.com/api/v2';

export interface CardCriado {
  id: string;
  url: string;
}

/** Sinaliza o que já dá para ver sem ler o card inteiro. */
function etiquetas(d: Diagnostico): string[] {
  const tags = [d.momento === 'em_operacao' ? 'consolidação' : 'fundação'];

  if (d.prazo === 'Agora, é prioridade') tags.push('urgente');
  if (d.papel.startsWith('Sou fundador')) tags.push('decisor');
  if (d.compromisso.startsWith('Sim')) tags.push('pronto');
  if (d.compromisso.startsWith('Não')) tags.push('sem-momento');
  if (d.chegada === 'Indicação de alguém') tags.push('indicação');

  return tags;
}

/**
 * Prioridade do ClickUp: 1 urgente, 2 alta, 3 normal, 4 baixa.
 * O critério é o mesmo do filtro — decisor, pronto para se envolver e com
 * pressa sobe; quem disse que não é o momento desce.
 */
function prioridade(d: Diagnostico): number {
  if (d.compromisso.startsWith('Não')) return 4;

  const decisor = d.papel.startsWith('Sou fundador');
  const pronto = d.compromisso.startsWith('Sim');
  const agora = d.prazo === 'Agora, é prioridade';

  if (decisor && pronto && agora) return 1;
  if (decisor && pronto) return 2;
  return 3;
}

function linha(rotulo: string, valor: string | null): string {
  return valor ? `**${rotulo}**  \n${valor}\n\n` : '';
}

function descricao(d: Diagnostico, id: string): string {
  const porte = d.momento === 'em_operacao'
    ? linha('Faturamento mensal', d.faturamento)
    : linha('Renda pessoal mensal', d.renda_pessoal);

  const segmento = d.segmento === 'Outro' && d.segmento_outro
    ? `${d.segmento}: ${d.segmento_outro}`
    : d.segmento;

  return [
    `## Contato\n`,
    linha('WhatsApp', d.whatsapp),
    linha('E-mail', d.email),
    linha('Empresa', d.empresa),
    linha('Papel', d.papel),
    linha('Chegou por', d.indicou ? `${d.chegada} — ${d.indicou}` : d.chegada),

    `\n## O que ela contou\n`,
    linha('Momento', d.momento === 'em_operacao' ? 'Empresa em operação' : 'Estruturando o negócio'),
    linha('Como se descreve', d.frase),
    linha('Maior obstáculo', d.obstaculo),
    linha('Decisão que vem adiando', d.adiando),

    `\n## Qualificação\n`,
    porte,
    linha('Equipe', d.equipe),
    linha('Segmento', segmento),
    linha('Processo de vendas', d.processo),
    linha('Consultoria antes', d.consultoria_antes),
    linha('Rotina como líder', d.rotina),
    linha('Aceita começar pela liderança', d.contrataria),
    linha('Deixou na mesa em 12 meses', d.deixou_na_mesa),
    linha('Quer começar', d.prazo),
    linha('Compromisso', d.compromisso),

    `\n---\n`,
    `Consentimento registrado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    ` · política ${d.politica_versao} · registro \`${id}\``,
  ].join('');
}

export async function criarCard(
  d: Diagnostico,
  id: string,
  opcoes: { token: string; listId: string },
): Promise<CardCriado> {
  const resposta = await fetch(`${API}/list/${opcoes.listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: opcoes.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: d.empresa ? `${d.nome} · ${d.empresa}` : d.nome,
      markdown_description: descricao(d, id),
      tags: etiquetas(d),
      priority: prioridade(d),
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new Error(`ClickUp ${resposta.status}: ${corpo.slice(0, 300)}`);
  }

  const card = await resposta.json() as { id: string; url: string };
  return { id: card.id, url: card.url };
}
