/**
 * Cria um elemento com atributos e filhos. Texto entra sempre como nó de
 * texto, nunca como HTML: o que vem do banco foi digitado por alguém.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  atributos: Record<string, string> = {},
  ...filhos: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const no = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) no.setAttribute(k, v);
  for (const f of filhos) if (f) no.append(f);
  return no;
}
