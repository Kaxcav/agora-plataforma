/**
 * Peças comuns das telas de controle (linhas de defesa, controle externo e matriz de riscos do contrato):
 * rótulos em pt-BR, etiquetas de situação (sempre ícone + texto) e a lista de medidas de controle.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { MedidaControle, OrgaoControle, SemaforoPrazoControle, SituacaoMedidaControle, SituacaoRevisaoRiscos, TipoMedidaControle } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { Etiqueta, type TomEtiqueta } from '../../componentes';
import './controle.css';

export const ORGAOS_CONTROLE: Record<OrgaoControle, string> = {
  TCU: 'TCU — Tribunal de Contas da União',
  CGU: 'CGU — Controladoria-Geral da União',
};

export const TIPOS_MEDIDA: Record<TipoMedidaControle, string> = {
  cautelar: 'Medida cautelar',
  determinacao: 'Determinação',
  diligencia: 'Diligência',
  recomendacao: 'Recomendação',
};

export const SITUACOES_MEDIDA: Record<SituacaoMedidaControle, string> = {
  aguardando_resposta: 'Aguardando resposta',
  resposta_vencida: 'Resposta com prazo vencido',
  respondida: 'Respondida',
  revogada: 'Revogada',
};

const TOM_SEMAFORO: Record<SemaforoPrazoControle, TomEtiqueta> = {
  vencido: 'erro',
  critico: 'critico',
  atencao: 'aviso',
  regular: 'sucesso',
  concluido: 'neutro',
};

const REVISAO: Record<SituacaoRevisaoRiscos['situacao'], { tom: TomEtiqueta; rotulo: string }> = {
  vencida: { tom: 'erro', rotulo: 'Revisão vencida' },
  a_vencer: { tom: 'aviso', rotulo: 'Revisão a vencer' },
  em_dia: { tom: 'sucesso', rotulo: 'Revisão em dia' },
  encerrado: { tom: 'neutro', rotulo: 'Vigência encerrada' },
};

export function EtiquetaRevisao({ situacao }: { situacao: SituacaoRevisaoRiscos['situacao'] }) {
  const def = REVISAO[situacao];
  return (
    <Etiqueta tom={def.tom} compacta>
      {def.rotulo}
    </Etiqueta>
  );
}

export function EtiquetaMedida({ medida }: { medida: MedidaControle }) {
  return (
    <span className="linha">
      <Etiqueta tom={TOM_SEMAFORO[medida.semaforo]} compacta>
        {SITUACOES_MEDIDA[medida.situacao]}
      </Etiqueta>
      {medida.bloqueia ? (
        <Etiqueta tom="critico" compacta>
          Suspensão em vigor
        </Etiqueta>
      ) : null}
    </span>
  );
}

export function prazoEfetivo(m: MedidaControle): string {
  return m.prorrogacao?.ate ?? m.prazoResposta;
}

/** Lista compacta de medidas (painéis e aba do contrato). `acao` permite abrir o detalhe na tela de controle externo. */
export function ListaMedidas({ medidas, acao }: { medidas: readonly MedidaControle[]; acao?: (m: MedidaControle) => ReactNode }) {
  return (
    <ul className="lista-controle">
      {medidas.map((m) => (
        <li key={m.id}>
          <span className="lista-controle__titulo">
            {TIPOS_MEDIDA[m.tipo]} do {m.orgao} nº {m.numero}
          </span>
          <EtiquetaMedida medida={m} />
          <span className="lista-controle__descricao">
            <Link to={m.alvo.caminho}>{m.alvo.identificador}</Link> — {m.objeto}
          </span>
          <span className="texto-pequeno texto-secundario">
            Ciência em <span className="numero">{formatarData(m.cienciaEm)}</span> · resposta até{' '}
            <span className="numero">{formatarData(prazoEfetivo(m))}</span>
            {m.prorrogacao ? ' (prorrogado)' : ''} · UASG <span className="numero">{m.uasg}</span>
          </span>
          <span className="lista-controle__explicacao texto-pequeno">{m.explicacao}</span>
          {acao ? <span className="lista-controle__acao">{acao(m)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
