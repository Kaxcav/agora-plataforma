import { Link } from 'react-router';
import type { ContratoResumo } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { BarraProgresso } from '../../componentes/Indicadores';
import { EtiquetaSituacao, Semaforo } from '../../componentes/Etiqueta';
import type { ColunaTabela } from '../../componentes/Tabela';
import { TextoLongo } from '../../componentes/TextoLongo';
import { formatarNumero } from '../../utilitarios/formatacao';

/** Colunas de contrato usadas na carteira, no detalhe da ata e no detalhe do fornecedor. */
export const COLUNAS_CONTRATO: ColunaTabela<ContratoResumo>[] = [
  {
    id: 'numero',
    cabecalho: 'Contrato',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (c) => c.numero,
    celula: (c) => <Link to={`/contratos/${c.id}`}>Contrato {c.numero}</Link>,
  },
  {
    id: 'objeto',
    cabecalho: 'Objeto',
    prioritaria: true,
    larguraMinima: '16rem',
    celula: (c) => <TextoLongo texto={c.objeto} />,
  },
  {
    id: 'fornecedor',
    cabecalho: 'Fornecedor',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (c) => c.fornecedor.razaoSocial,
    celula: (c) => (
      <span className="pilha pilha--compacta">
        <Link to={`/fornecedores/${c.fornecedor.id}`}>{c.fornecedor.razaoSocial}</Link>
        <span className="texto-pequeno texto-secundario mono">{c.fornecedor.documento}</span>
      </span>
    ),
  },
  {
    id: 'uasg',
    cabecalho: 'UASG',
    celula: (c) => (
      <span title={c.uasg.nome}>
        {c.uasg.sigla} <span className="texto-secundario numero">{c.uasg.codigo}</span>
      </span>
    ),
  },
  {
    id: 'vigenciaFim',
    cabecalho: 'Vigência',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (c) => c.vigenciaFim,
    celula: (c) => (
      <div className="pilha pilha--compacta">
        <span className="numero">até {formatarData(c.vigenciaFim)}</span>
        <Semaforo valor={c.semaforo} vigenciaFim={c.vigenciaFim} />
      </div>
    ),
  },
  {
    id: 'valorGlobal',
    cabecalho: 'Valor global',
    ordenavel: true,
    alinhamento: 'fim',
    valorOrdenacao: (c) => c.valorGlobal,
    celula: (c) => <span className="numero">{formatarMoeda(c.valorGlobal)}</span>,
  },
  {
    id: 'percentualExecutado',
    cabecalho: 'Execução',
    ordenavel: true,
    prioritaria: true,
    larguraMinima: '10rem',
    valorOrdenacao: (c) => c.percentualExecutado,
    celula: (c) => <BarraProgresso valor={c.percentualExecutado} rotulo={`Execução financeira do contrato ${c.numero}`} />,
  },
  {
    id: 'valorEmpenhado',
    cabecalho: 'Empenhado',
    alinhamento: 'fim',
    ocultaPorPadrao: true,
    valorOrdenacao: (c) => c.valorEmpenhado,
    celula: (c) => <span className="numero">{formatarMoeda(c.valorEmpenhado)}</span>,
  },
  {
    id: 'valorPago',
    cabecalho: 'Pago',
    alinhamento: 'fim',
    ocultaPorPadrao: true,
    valorOrdenacao: (c) => c.valorPago,
    celula: (c) => <span className="numero">{formatarMoeda(c.valorPago)}</span>,
  },
  {
    id: 'pendenciasAbertas',
    cabecalho: 'Pendências',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (c) => c.pendenciasAbertas,
    celula: (c) => <span className="numero">{c.pendenciasAbertas > 0 ? <strong>{formatarNumero(c.pendenciasAbertas)}</strong> : '0'}</span>,
  },
  {
    id: 'ata',
    cabecalho: 'Ata de origem',
    ocultaPorPadrao: true,
    celula: (c) => (c.ataOrigem ? <Link to={`/atas/${c.ataOrigem.id}`}>Ata {c.ataOrigem.numero}</Link> : <span className="texto-secundario">Sem ata</span>),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    ocultaPorPadrao: true,
    celula: (c) => <EtiquetaSituacao valor={c.situacao} />,
  },
  {
    id: 'gestor',
    cabecalho: 'Gestor',
    celula: (c) => c.gestor?.nome ?? <span className="texto-secundario">Sem gestor</span>,
  },
];
