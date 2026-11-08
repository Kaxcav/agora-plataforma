import type { FornecedorResumo } from '@agora/contratos';
import { DadoPessoal } from '../../componentes/DadoPessoal';
import { Etiqueta } from '../../componentes/Etiqueta';
import { FAIXAS_IDC } from '../compartilhado/rotulos';

export function formatarNotaIdc(nota: number): string {
  return nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** IDC resumido: nota + faixa; sem histórico não é penalizado (aparece como tal). */
export function ResumoIdc({ idc, impedido }: { idc: FornecedorResumo['idc']; impedido?: boolean }) {
  if (idc === null) {
    return (
      <span className="idc-resumo">
        <span className="texto-secundario">—</span>
        {impedido ? (
          <Etiqueta tom="erro" compacta>
            Impedido
          </Etiqueta>
        ) : null}
      </span>
    );
  }
  if (idc.semHistorico) {
    return (
      <span className="idc-resumo">
        <Etiqueta tom="neutro" compacta>
          Sem histórico
        </Etiqueta>
        {impedido ? (
          <Etiqueta tom="erro" compacta>
            Impedido
          </Etiqueta>
        ) : null}
      </span>
    );
  }
  const faixa = FAIXAS_IDC[idc.faixa];
  return (
    <span className="idc-resumo">
      <strong className="numero">{formatarNotaIdc(idc.nota)}</strong>
      <Etiqueta tom={faixa.tom} compacta>
        {faixa.rotulo}
      </Etiqueta>
      {impedido ? (
        <Etiqueta tom="erro" compacta>
          Impedido
        </Etiqueta>
      ) : null}
    </span>
  );
}

export function DocumentoFornecedor({ fornecedor }: { fornecedor: Pick<FornecedorResumo, 'id' | 'documento' | 'tipoPessoa'> }) {
  if (fornecedor.tipoPessoa === 'PF' && fornecedor.documento.includes('*')) {
    return <DadoPessoal valor={fornecedor.documento} recurso="fornecedor" id={fornecedor.id} campo="documento" descricao="CPF do fornecedor" />;
  }
  return <span className="mono">{fornecedor.documento}</span>;
}
