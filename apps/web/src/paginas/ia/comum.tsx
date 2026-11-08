/**
 * Peças comuns da IA ancorada: etiqueta da situação de cada citação, lista de citações apontadas, origem da base
 * normativa e o aviso de que tudo é sinal para revisão humana.
 */
import type { CitacaoLegalConferida, ProvenienciaBaseNormativa, SituacaoCitacaoLegal } from '@agora/contratos';
import { Etiqueta, ListaDefinicoes, type TomEtiqueta } from '../../componentes';
import { abreviarHash, formatarInstante } from '../../utilitarios/formatacao';
import './ia.css';

export const SITUACOES_CITACAO: Record<SituacaoCitacaoLegal, { rotulo: string; tom: TomEtiqueta }> = {
  confere: { rotulo: 'Confere', tom: 'sucesso' },
  inexistente: { rotulo: 'Dispositivo inexistente', tom: 'erro' },
  sem_efeito: { rotulo: 'Vetado ou revogado', tom: 'erro' },
  suspeita: { rotulo: 'Assunto não confere', tom: 'aviso' },
  outra_norma: { rotulo: 'Outra norma (não conferida)', tom: 'neutro' },
};

export function EtiquetaCitacao({ situacao }: { situacao: SituacaoCitacaoLegal }) {
  const def = SITUACOES_CITACAO[situacao];
  return (
    <Etiqueta tom={def.tom} compacta>
      {def.rotulo}
    </Etiqueta>
  );
}

/** Citações apontadas, com o trecho, o motivo, a sugestão e a frase em que aparecem. */
export function ListaCitacoesApontadas({ citacoes }: { citacoes: readonly CitacaoLegalConferida[] }) {
  return (
    <ul className="lista-sinais">
      {citacoes.map((c) => (
        <li key={`${c.posicao}-${c.trecho}`}>
          <span className="lista-sinais__titulo mono">{c.trecho}</span>
          <EtiquetaCitacao situacao={c.situacao} />
          <div className="lista-sinais__corpo">
            <p>{c.motivo}</p>
            {c.sugestao ? <p className="texto-pequeno">{c.sugestao}</p> : null}
            <p className="trecho-citado texto-pequeno texto-secundario">Trecho: “{c.contexto}”</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProvenienciaBase({ norma, proveniencia }: { norma: string; proveniencia: ProvenienciaBaseNormativa }) {
  return (
    <ListaDefinicoes
      colunas={2}
      itens={[
        { termo: 'Norma', valor: norma },
        { termo: 'Fonte oficial', valor: proveniencia.fonte },
        { termo: 'Obtida em', valor: formatarInstante(proveniencia.obtidoEm) },
        { termo: 'Formato', valor: proveniencia.formato },
        { termo: 'SHA-256 do arquivo', valor: <span className="mono">{abreviarHash(proveniencia.sha256Arquivo, 12, 8)}</span> },
        { termo: 'SHA-256 do texto', valor: <span className="mono">{abreviarHash(proveniencia.sha256Texto, 12, 8)}</span> },
        { termo: 'Endereço', valor: <span className="mono">{proveniencia.url}</span>, largo: true },
        { termo: 'Observação', valor: proveniencia.observacao, largo: true },
      ]}
    />
  );
}

/** Premissas, fontes e o aviso de revisão humana de um resultado gerado pelo servidor. */
export function ApoioResultado({ premissas, fontes, aviso, geradoEm }: { premissas: readonly string[]; fontes?: readonly string[]; aviso: string; geradoEm?: string }) {
  return (
    <div className="pilha pilha--compacta texto-pequeno">
      <p className="texto-forte">{aviso}</p>
      <p className="texto-secundario">Premissas:</p>
      <ul>
        {premissas.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {fontes && fontes.length > 0 ? (
        <>
          <p className="texto-secundario">Fontes:</p>
          <ul>
            {fontes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      ) : null}
      {geradoEm ? <p className="texto-secundario">Calculado pelo servidor em {formatarInstante(geradoEm)}.</p> : null}
    </div>
  );
}
