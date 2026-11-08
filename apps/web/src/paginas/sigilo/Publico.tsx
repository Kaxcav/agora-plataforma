/**
 * Peças do sigilo (RN-40) usadas pelas telas públicas e pela publicação no PNCP: aviso de registro mínimo, documentos
 * retidos, orçamento sigiloso (art. 24) e documentos que não vão ao PNCP. O servidor já retirou o conteúdo sigiloso;
 * estas peças só explicam a ausência.
 */
import { Lock } from 'lucide-react';
import type { DocumentoRetidoPorSigilo, EditalPublico } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { Alerta, Etiqueta, ListaDefinicoes, Secao } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';

export function SigiloEditalPublico({ edital }: { edital: EditalPublico }) {
  const s = edital.sigilo;
  if (!s) return null;
  const o = s.orcamento;
  return (
    <>
      {s.mensagem ? (
        <Alerta tipo={s.registroMinimo ? 'aviso' : 'info'} titulo={s.registroMinimo ? 'Contratação sigilosa: registro mínimo' : 'Documentos sigilosos não divulgados'}>
          <p>{s.mensagem}</p>
        </Alerta>
      ) : null}
      <Secao titulo="Orçamento estimado" id="orcamento-edital-publico" descricao="O orçamento pode ser sigiloso até a fase de lances ou o julgamento; os quantitativos são sempre públicos (Lei 14.133/2021, art. 24).">
        <ListaDefinicoes
          itens={[
            {
              termo: 'Situação',
              valor:
                o.situacao === 'sigiloso' ? (
                  <Etiqueta tom="alerta" compacta icone={Lock}>
                    Sigiloso até a fase de lances ou o julgamento
                  </Etiqueta>
                ) : o.situacao === 'divulgado' ? (
                  'Divulgado após a fase de lances ou o julgamento'
                ) : (
                  'Público'
                ),
            },
            { termo: 'Valor total estimado', valor: o.valorEstimado !== null ? <span className="numero">{formatarMoeda(o.valorEstimado)}</span> : '—' },
            ...(o.divulgadoEm ? [{ termo: 'Divulgado em', valor: formatarInstante(o.divulgadoEm) }] : []),
          ]}
        />
      </Secao>
    </>
  );
}

export function RetidosPorSigilo({ retidos }: { retidos: readonly DocumentoRetidoPorSigilo[] | undefined }) {
  if (!retidos || retidos.length === 0) return null;
  return (
    <div className="pilha pilha--compacta">
      <p className="texto-pequeno">
        <strong>Retidos por sigilo, não enviados ao PNCP:</strong>
      </p>
      <ul className="lista-simples texto-pequeno">
        {retidos.map((r) => (
          <li key={r.documento}>
            <Etiqueta tom="alerta" compacta icone={Lock}>
              {r.titulo}
            </Etiqueta>{' '}
            {r.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}
