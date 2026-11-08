/**
 * Gerência de foco na troca de rota: o layout marca a navegação; o `<h1>` da próxima página consome a marca
 * e recebe o foco (anunciado pelo leitor de tela). Na primeira carga o foco não é movido (o link de salto
 * continua sendo o primeiro elemento focável).
 */
let focoPendente = false;

export function solicitarFocoTitulo(): void {
  focoPendente = true;
}

export function consumirFocoTitulo(): boolean {
  const pendente = focoPendente;
  focoPendente = false;
  return pendente;
}

export const NOME_PRODUTO = 'Ágora';

export function definirTituloDocumento(titulo: string): void {
  document.title = titulo ? `${titulo} — ${NOME_PRODUTO}` : NOME_PRODUTO;
}
