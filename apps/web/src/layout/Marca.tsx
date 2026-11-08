/**
 * Marca da Ágora: monograma próprio (pórtico estilizado) + wordmark textual.
 * Não usa logotipo gov.br nem brasões — a Ágora é um produto ofertado ao órgão.
 */
export function Monograma({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="marca__monograma">
      <rect width="32" height="32" rx="7" className="marca__fundo" />
      <path d="M6 12.5 16 6.5l10 6" className="marca__traco" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 14.5v8.5M16 14.5v8.5M22.5 14.5v8.5" className="marca__traco" fill="none" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.5 25.5h19" className="marca__traco marca__traco--base" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Marca() {
  return (
    <span className="marca">
      <Monograma />
      <span className="marca__textos">
        <span className="marca__nome">Ágora</span>
        <span className="marca__sub">Contratações Públicas</span>
      </span>
    </span>
  );
}
