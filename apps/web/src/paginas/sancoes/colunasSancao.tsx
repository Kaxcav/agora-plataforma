import { Link } from 'react-router';
import type { Sancao } from '@agora/contratos';
import { formatarData, formatarMoeda, INFRACOES_ART_155 } from '@agora/dominio';
import { Etiqueta } from '../../componentes/Etiqueta';
import type { ColunaTabela } from '../../componentes/Tabela';
import { SITUACOES_SANCAO, TIPOS_SANCAO } from '../compartilhado/rotulos';

export function descricaoInciso(inciso: string): string | undefined {
  return INFRACOES_ART_155.find((i) => i.inciso === inciso)?.descricao;
}

/** Colunas de processo sancionatório (lista de sanções e detalhe do fornecedor). */
export function colunasSancao({ comFornecedor }: { comFornecedor: boolean }): ColunaTabela<Sancao>[] {
  const colunas: ColunaTabela<Sancao>[] = [
    {
      id: 'fornecedor',
      cabecalho: 'Fornecedor',
      identificadora: true,
      fixa: true,
      ordenavel: true,
      valorOrdenacao: (s) => s.fornecedor.razaoSocial,
      celula: (s) => (
        <span className="pilha pilha--compacta">
          <Link to={`/fornecedores/${s.fornecedor.id}`}>{s.fornecedor.razaoSocial}</Link>
          <span className="texto-pequeno texto-secundario mono">{s.fornecedor.documento}</span>
        </span>
      ),
    },
    {
      id: 'contrato',
      cabecalho: 'Contrato',
      celula: (s) => (s.contrato ? <Link to={`/contratos/${s.contrato.id}`}>Contrato {s.contrato.numero}</Link> : <span className="texto-secundario">—</span>),
    },
    {
      id: 'inciso',
      cabecalho: 'Infração (art. 155)',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (s) => s.incisoInfracao,
      celula: (s) => {
        const descricao = descricaoInciso(s.incisoInfracao);
        return (
          <span className="pilha pilha--compacta" title={descricao}>
            <span>Inciso {s.incisoInfracao}</span>
            {descricao ? <span className="texto-pequeno texto-secundario sancao__inciso">{descricao}</span> : null}
          </span>
        );
      },
    },
    {
      id: 'tipo',
      cabecalho: 'Sanção',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (s) => TIPOS_SANCAO[s.tipo],
      celula: (s) => TIPOS_SANCAO[s.tipo],
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (s) => SITUACOES_SANCAO[s.situacao].rotulo,
      celula: (s) => {
        const def = SITUACOES_SANCAO[s.situacao];
        return (
          <Etiqueta tom={def.tom} compacta>
            {def.rotulo}
          </Etiqueta>
        );
      },
    },
    {
      id: 'valorMulta',
      cabecalho: 'Multa',
      alinhamento: 'fim',
      ordenavel: true,
      valorOrdenacao: (s) => s.valorMulta,
      celula: (s) => (s.valorMulta === null ? <span className="texto-secundario">—</span> : <span className="numero">{formatarMoeda(s.valorMulta)}</span>),
    },
    {
      id: 'vigencia',
      cabecalho: 'Vigência da sanção',
      ocultaPorPadrao: true,
      celula: (s) =>
        s.inicioVigencia ? (
          <span className="numero">
            {formatarData(s.inicioVigencia)}
            {s.fimVigencia ? ` a ${formatarData(s.fimVigencia)}` : ''}
          </span>
        ) : (
          <span className="texto-secundario">—</span>
        ),
    },
    {
      id: 'prazoDefesa',
      cabecalho: 'Prazo de defesa',
      ordenavel: true,
      valorOrdenacao: (s) => s.prazoDefesa,
      celula: (s) => (s.prazoDefesa ? <span className="numero">{formatarData(s.prazoDefesa)}</span> : <span className="texto-secundario">—</span>),
    },
    {
      id: 'ceisCnep',
      cabecalho: 'Registro CEIS/CNEP',
      celula: (s) =>
        s.registradaCeisCnep ? (
          <Etiqueta tom="sucesso" compacta>
            Registrada
          </Etiqueta>
        ) : s.prazoRegistroCeisCnep ? (
          <span className="pilha pilha--compacta">
            <Etiqueta tom="aviso" compacta>
              Pendente
            </Etiqueta>
            <span className="texto-pequeno texto-secundario numero">até {formatarData(s.prazoRegistroCeisCnep)}</span>
          </span>
        ) : (
          <span className="texto-secundario">Não se aplica</span>
        ),
    },
    {
      id: 'instauradaEm',
      cabecalho: 'Instaurada em',
      ordenavel: true,
      valorOrdenacao: (s) => s.instauradaEm,
      celula: (s) => <span className="numero">{formatarData(s.instauradaEm)}</span>,
    },
  ];
  if (comFornecedor) return colunas;
  // No detalhe do fornecedor, a própria sanção identifica a linha.
  const restantes = colunas.filter((c) => c.id !== 'fornecedor' && c.id !== 'tipo');
  const tipo = colunas.find((c) => c.id === 'tipo');
  return tipo ? [{ ...tipo, identificadora: true, fixa: true }, ...restantes] : restantes;
}
