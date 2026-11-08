import { Link } from 'react-router';
import type { Empenho, Pagamento } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { DadoPessoal } from '../../componentes/DadoPessoal';
import { Etiqueta } from '../../componentes/Etiqueta';
import type { ColunaTabela } from '../../componentes/Tabela';
import { formatarCompetencia } from '../../utilitarios/formatacao';
import { SITUACOES_PAGAMENTO } from './rotulos';

/** Documento do credor: mascarado (PF) com "Revelar"; CNPJ exibido normalmente. */
export function DocumentoCredor({ empenho }: { empenho: Empenho }) {
  if (empenho.credor.documento.includes('*')) {
    return (
      <DadoPessoal
        valor={empenho.credor.documento}
        recurso="credor_empenho"
        id={empenho.id}
        campo="documento"
        descricao="documento do credor"
      />
    );
  }
  return <span className="mono texto-pequeno">{empenho.credor.documento}</span>;
}

/** Colunas de empenho: lista financeira e aba de empenhos do contrato. */
export const COLUNAS_EMPENHO: ColunaTabela<Empenho>[] = [
  {
    id: 'numero',
    cabecalho: 'Empenho',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (e) => e.numero,
    celula: (e) => <span className="mono">{e.numero}</span>,
  },
  {
    id: 'credor',
    cabecalho: 'Credor',
    prioritaria: true,
    ordenavel: true,
    larguraMinima: '14rem',
    valorOrdenacao: (e) => e.credor.nome,
    celula: (e) => (
      <span className="pilha pilha--compacta">
        <span>{e.credor.nome}</span>
        <DocumentoCredor empenho={e} />
      </span>
    ),
  },
  {
    id: 'contrato',
    cabecalho: 'Contrato',
    prioritaria: true,
    celula: (e) =>
      e.contrato ? (
        <Link to={`/contratos/${e.contrato.id}`}>Contrato {e.contrato.numero}</Link>
      ) : (
        <Etiqueta tom="aviso" compacta>
          Sem contrato
        </Etiqueta>
      ),
  },
  { id: 'uasg', cabecalho: 'UASG', ocultaPorPadrao: true, celula: (e) => <span className="numero">{e.uasg}</span> },
  {
    id: 'emissaoEm',
    cabecalho: 'Emissão',
    ordenavel: true,
    valorOrdenacao: (e) => e.emissaoEm,
    celula: (e) => <span className="numero">{formatarData(e.emissaoEm)}</span>,
  },
  { id: 'naturezaDespesa', cabecalho: 'Natureza', ocultaPorPadrao: true, celula: (e) => <span className="mono">{e.naturezaDespesa}</span> },
  {
    id: 'valorEmpenhado',
    cabecalho: 'Empenhado',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (e) => e.valorEmpenhado,
    celula: (e) => <span className="numero">{formatarMoeda(e.valorEmpenhado)}</span>,
  },
  {
    id: 'valorLiquidado',
    cabecalho: 'Liquidado',
    alinhamento: 'fim',
    ocultaPorPadrao: true,
    valorOrdenacao: (e) => e.valorLiquidado,
    celula: (e) => <span className="numero">{formatarMoeda(e.valorLiquidado)}</span>,
  },
  {
    id: 'valorPago',
    cabecalho: 'Pago',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (e) => e.valorPago,
    celula: (e) => <span className="numero">{formatarMoeda(e.valorPago)}</span>,
  },
  {
    id: 'saldo',
    cabecalho: 'Saldo',
    alinhamento: 'fim',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (e) => e.saldo,
    celula: (e) => <span className="numero texto-forte">{formatarMoeda(e.saldo)}</span>,
  },
  {
    id: 'restosAPagar',
    cabecalho: 'Exercício',
    celula: (e) =>
      e.restosAPagar ? (
        <Etiqueta tom="aviso" compacta>
          Restos a pagar
        </Etiqueta>
      ) : (
        <Etiqueta tom="neutro" icone={null} compacta>
          {e.ano}
        </Etiqueta>
      ),
  },
];

/** Colunas de pagamento: ordem cronológica (art. 141) e aba de pagamentos do contrato. */
export const COLUNAS_PAGAMENTO: ColunaTabela<Pagamento>[] = [
  {
    id: 'posicaoOrdemCronologica',
    cabecalho: 'Ordem',
    ordenavel: true,
    alinhamento: 'centro',
    valorOrdenacao: (p) => p.posicaoOrdemCronologica,
    celula: (p) =>
      p.posicaoOrdemCronologica !== null ? (
        <span className="numero texto-forte">{p.posicaoOrdemCronologica}º</span>
      ) : (
        <span className="texto-secundario" title="Pagamento já realizado: fora da fila">
          —
        </span>
      ),
  },
  {
    id: 'notaFiscal',
    cabecalho: 'Nota fiscal',
    identificadora: true,
    fixa: true,
    valorOrdenacao: (p) => p.notaFiscal,
    celula: (p) => <span className="mono">NF {p.notaFiscal}</span>,
  },
  {
    id: 'contrato',
    cabecalho: 'Contrato',
    prioritaria: true,
    celula: (p) => <Link to={`/contratos/${p.contrato.id}`}>Contrato {p.contrato.numero}</Link>,
  },
  { id: 'fornecedor', cabecalho: 'Fornecedor', ordenavel: true, valorOrdenacao: (p) => p.fornecedor, celula: (p) => p.fornecedor },
  {
    id: 'competencia',
    cabecalho: 'Competência',
    ordenavel: true,
    valorOrdenacao: (p) => p.competencia,
    celula: (p) => <span className="numero">{formatarCompetencia(p.competencia)}</span>,
  },
  {
    id: 'valor',
    cabecalho: 'Valor',
    alinhamento: 'fim',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (p) => p.valor,
    celula: (p) => <span className="numero">{formatarMoeda(p.valor)}</span>,
  },
  {
    id: 'vencimento',
    cabecalho: 'Vencimento',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (p) => p.vencimento,
    celula: (p) => <span className="numero">{formatarData(p.vencimento)}</span>,
  },
  {
    id: 'pagoEm',
    cabecalho: 'Pago em',
    ocultaPorPadrao: true,
    valorOrdenacao: (p) => p.pagoEm,
    celula: (p) => (p.pagoEm ? <span className="numero">{formatarData(p.pagoEm)}</span> : <span className="texto-secundario">—</span>),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (p) => p.situacao,
    celula: (p) => {
      const s = SITUACOES_PAGAMENTO[p.situacao];
      return (
        <Etiqueta tom={s.tom} compacta>
          {s.rotulo}
        </Etiqueta>
      );
    },
  },
  {
    id: 'atestadoPor',
    cabecalho: 'Atestado por',
    ocultaPorPadrao: true,
    celula: (p) => p.atestadoPor?.nome ?? <span className="texto-secundario">—</span>,
  },
];

export function semColunas<T>(colunas: readonly ColunaTabela<T>[], ids: readonly string[]): ColunaTabela<T>[] {
  return colunas.filter((c) => !ids.includes(c.id));
}
