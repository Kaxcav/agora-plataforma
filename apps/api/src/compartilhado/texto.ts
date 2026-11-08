/**
 * Normalização para busca textual: minúsculas, sem acentos e com espaços simples.
 * `unaccent` não existe no PGlite, então a coluna `busca_normalizada` é gravada já normalizada pelo aplicativo.
 */
export function normalizarBusca(...partes: readonly (string | null | undefined)[]): string {
  return partes
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Padrão `LIKE` (com `ESCAPE '\'`) para "contém", escapando curingas digitados pelo usuário. */
export function padraoContem(busca: string): string {
  const normalizada = normalizarBusca(busca).replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${normalizada}%`;
}

/** Identificador legível de instrumento: "Contrato 45/2025", "Ata 12/2025". */
export function identificadorInstrumento(tipo: 'ata' | 'contrato', numero: string): string {
  return `${tipo === 'ata' ? 'Ata' : 'Contrato'} ${numero}`;
}

/** Palavras significativas (≥ 4 letras, sem acento) para comparação simples de objetos. */
export function palavrasSignificativas(texto: string): Set<string> {
  return new Set(
    normalizarBusca(texto)
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 4),
  );
}
