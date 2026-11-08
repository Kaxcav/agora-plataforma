/**
 * Preferências de INTERFACE (densidade, colunas, menu recolhido, modo especificação) em `sessionStorage`.
 * Dados de negócio nunca são gravados no armazenamento do navegador.
 */
const PREFIXO = 'agora:pref:';

export function lerPreferencia(chave: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIXO + chave);
  } catch {
    // Armazenamento indisponível (navegação privativa restrita): segue com o padrão.
    return null;
  }
}

export function gravarPreferencia(chave: string, valor: string | null): void {
  try {
    if (valor === null) window.sessionStorage.removeItem(PREFIXO + chave);
    else window.sessionStorage.setItem(PREFIXO + chave, valor);
  } catch {
    // Sem armazenamento a preferência vale só até recarregar a página.
    return;
  }
}

export function lerListaPreferencia(chave: string): string[] {
  const bruto = lerPreferencia(chave);
  if (!bruto) return [];
  return bruto.split(',').filter((v) => v.length > 0);
}
