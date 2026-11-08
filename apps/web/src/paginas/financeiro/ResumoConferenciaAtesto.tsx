/**
 * Na janela de atesto: "valor da nota × valor devido" da conferência (RN-36). Divergência sem justificativa ou, em
 * contrato com IMR, nota não conferida bloqueia o atesto; o servidor recusa de qualquer modo (422).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ContextoConferenciaNota } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { Alerta, Etiqueta, ListaDefinicoes } from '../../componentes';
import { SITUACOES_CONFERENCIA } from './rotulosImr';

export function ResumoConferenciaAtesto({ consulta }: { consulta: UseQueryResult<ContextoConferenciaNota> }) {
  const dados = consulta.data;
  if (consulta.isPending) {
    return (
      <p className="texto-pequeno texto-secundario" role="status">
        Carregando a conferência da nota fiscal…
      </p>
    );
  }
  if (!dados) return null;
  const c = dados.conferencia;
  const link = (
    <Link to={`/financeiro/pagamentos/${dados.pagamento.id}/conferencia`}>{c ? 'Abrir a conferência da nota' : 'Conferir a nota fiscal'}</Link>
  );
  return (
    <section className="pilha pilha--compacta" aria-labelledby={`conferencia-atesto-${dados.pagamento.id}`}>
      <h3 className="secao__titulo" id={`conferencia-atesto-${dados.pagamento.id}`}>
        Conferência da nota fiscal
      </h3>
      {c ? (
        <>
          <div>
            <Etiqueta tom={SITUACOES_CONFERENCIA[c.situacao].tom}>{SITUACOES_CONFERENCIA[c.situacao].rotulo}</Etiqueta>
          </div>
          <ListaDefinicoes
            colunas={3}
            itens={[
              { termo: 'Valor da nota', valor: <span className="numero">{formatarMoeda(c.valorNota)}</span> },
              { termo: 'Valor devido', valor: <span className="numero">{formatarMoeda(c.valorDevido)}</span> },
              { termo: 'Valor a liquidar', valor: <strong className="numero">{formatarMoeda(c.valorALiquidar)}</strong> },
            ]}
          />
        </>
      ) : null}
      {dados.atesto.liberado ? (
        <p className="texto-pequeno">
          {c ? 'A conferência libera o atesto; a parcela segue pelo valor a liquidar.' : 'Nota ainda não conferida. A conferência é recomendada antes do atesto.'} {link}
        </p>
      ) : (
        <Alerta tipo="erro" titulo="Atesto bloqueado (RN-36)">
          <p>
            {dados.atesto.motivo} {link}
          </p>
        </Alerta>
      )}
    </section>
  );
}
