import { useId } from 'react';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router';
import { regrasPorTela, type RegraCatalogo } from '@agora/dominio';

export const NOMES_TIPOS_REGRA: Record<RegraCatalogo['tipo'], string> = {
  RF: 'Requisito funcional',
  RN: 'Regra de negócio',
  RIA: 'Requisito de IA (sinal)',
  RNF: 'Requisito não funcional',
};

export function CartaoRegra({ regra, nivelTitulo = 3 }: { regra: RegraCatalogo; nivelTitulo?: 3 | 4 }) {
  const Titulo = nivelTitulo === 3 ? 'h3' : 'h4';
  return (
    <article className="regra" id={`regra-${regra.id}`}>
      <div className="regra__topo">
        <span className={`regra__id regra__id--${regra.tipo.toLowerCase()}`}>{regra.id}</span>
        <span className="regra__tipo">{NOMES_TIPOS_REGRA[regra.tipo]}</span>
        {regra.etapa !== null ? <span className="regra__etapa">Etapa {regra.etapa}</span> : null}
      </div>
      <Titulo className="regra__titulo">{regra.titulo}</Titulo>
      <p className="regra__descricao">{regra.descricao}</p>
      <dl className="regra__metadados">
        <div>
          <dt>Fundamento</dt>
          <dd>{regra.fundamento}</dd>
        </div>
        <div>
          <dt>Implementação</dt>
          <dd>
            <code>{regra.implementacao}</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

/** Painel do Modo Especificação Técnica: regras do catálogo (`regrasPorTela`) aplicadas à tela atual. */
export function PainelRegras({ tela }: { tela: string }) {
  const idTitulo = useId();
  const regras = regrasPorTela(tela);
  return (
    <section className="painel-regras" aria-labelledby={idTitulo}>
      <div className="painel-regras__cabecalho">
        <BookOpen size={18} aria-hidden="true" />
        <h2 id={idTitulo} className="painel-regras__titulo">
          Especificação técnica desta tela
        </h2>
        <span className="painel-regras__tela">
          Tela <code>{tela}</code>
        </span>
      </div>
      {regras.length === 0 ? (
        <p className="texto-secundario">Nenhuma regra do catálogo está associada a esta tela.</p>
      ) : (
        <div className="painel-regras__lista">
          {regras.map((r) => (
            <CartaoRegra key={r.id} regra={r} />
          ))}
        </div>
      )}
      <p className="painel-regras__rodape">
        Catálogo completo no <Link to="/regras">Caderno de regras</Link>. As referências legais devem ser validadas pela área técnica e pela
        consultoria jurídica.
      </p>
    </section>
  );
}
