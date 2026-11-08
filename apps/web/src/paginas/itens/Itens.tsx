import { Link } from 'react-router';
import { Download } from 'lucide-react';
import type { FiltroItens, ItemCarteira } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { urlExportarItens, useItens } from '../../api/financeiro';
import {
  BarraFiltros,
  BarraProgresso,
  Botao,
  CampoBusca,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  TextoLongo,
  type ColunaTabela,
} from '../../componentes';
import { formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';

const FILTROS = ['busca', 'uasg', 'alocacao', 'empenho'] as const;
const ALOCACOES = ['alocado', 'nao_alocado'] as const;
const EMPENHOS = ['empenhado', 'nao_empenhado'] as const;

const COLUNAS: ColunaTabela<ItemCarteira>[] = [
  {
    id: 'ata',
    cabecalho: 'Item',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    celula: (i) => (
      <span className="pilha pilha--compacta">
        <span>Item {i.numero}</span>
        <Link to={`/atas/${i.ata.id}?aba=itens`} className="texto-pequeno">
          Ata {i.ata.numero}
        </Link>
      </span>
    ),
  },
  {
    id: 'descricao',
    cabecalho: 'Descrição',
    prioritaria: true,
    ordenavel: true,
    larguraMinima: '16rem',
    celula: (i) => <TextoLongo texto={i.descricao} />,
  },
  { id: 'uasg', cabecalho: 'UASG', ordenavel: true, celula: (i) => <span className="numero">{i.uasg}</span> },
  { id: 'fornecedor', cabecalho: 'Fornecedor', celula: (i) => i.fornecedor },
  {
    id: 'valorUnitario',
    cabecalho: 'Valor unitário',
    alinhamento: 'fim',
    ordenavel: true,
    celula: (i) => <span className="numero">{formatarMoeda(i.valorUnitario)}</span>,
  },
  {
    id: 'quantidades',
    cabecalho: 'Registrada / contratada / empenhada',
    alinhamento: 'fim',
    celula: (i) => (
      <span className="numero">
        {formatarNumero(i.quantidadeRegistrada)} / {formatarNumero(i.quantidadeContratada)} / {formatarNumero(i.quantidadeEmpenhada)}
      </span>
    ),
  },
  {
    id: 'percentualConsumido',
    cabecalho: 'Consumo',
    prioritaria: true,
    larguraMinima: '10rem',
    celula: (i) => <BarraProgresso valor={i.percentualConsumido} rotulo={`Consumo do item ${i.numero} da ata ${i.ata.numero}`} />,
  },
  {
    id: 'situacao',
    cabecalho: 'Alocação e empenho',
    prioritaria: true,
    celula: (i) => (
      <span className="linha">
        {i.alocado ? (
          <Etiqueta tom="sucesso" compacta>
            Alocado
          </Etiqueta>
        ) : (
          <Etiqueta tom="neutro" compacta>
            Não alocado
          </Etiqueta>
        )}
        {i.empenhado ? (
          <Etiqueta tom="sucesso" compacta>
            Empenhado
          </Etiqueta>
        ) : (
          <Etiqueta tom="aviso" compacta>
            Sem empenho
          </Etiqueta>
        )}
      </span>
    ),
  },
];

export default function Itens() {
  const p = useParametrosUrl();
  const filtro: FiltroItens = {
    busca: p.texto('busca'),
    uasg: p.texto('uasg'),
    alocacao: p.opcao('alocacao', ALOCACOES),
    empenho: p.opcao('empenho', EMPENHOS),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    ordenarPor: p.ordenacao?.por,
    ordem: p.ordenacao?.ordem,
  };
  const consulta = useItens(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  return (
    <Pagina
      titulo="Itens"
      subtitulo="Carteira de itens registrados em ata: consumo, alocação em contratos e empenho."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="itens"
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['item', 'itens']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de itens"
          >
            <CampoBusca
              rotulo="Buscar"
              placeholder="Descrição, CATMAT, fornecedor ou ata"
              valor={filtro.busca ?? ''}
              aoMudar={(v) => p.atualizar({ busca: v })}
            />
            <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
            <Selecao
              rotulo="Alocação em contrato"
              opcaoVazia="Todos"
              opcoes={[
                { valor: 'alocado', rotulo: 'Alocados' },
                { valor: 'nao_alocado', rotulo: 'Não alocados' },
              ]}
              value={filtro.alocacao ?? ''}
              onChange={(e) => p.atualizar({ alocacao: e.target.value })}
            />
            <Selecao
              rotulo="Empenho"
              opcaoVazia="Todos"
              opcoes={[
                { valor: 'empenhado', rotulo: 'Empenhados' },
                { valor: 'nao_empenhado', rotulo: 'Sem empenho' },
              ]}
              value={filtro.empenho ?? ''}
              onChange={(e) => p.atualizar({ empenho: e.target.value })}
            />
          </BarraFiltros>

          <Tabela
            id="itens"
            legenda="Carteira de itens"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(i) => i.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            ordenacao={p.ordenacao}
            aoOrdenar={p.definirOrdenacao}
            destaque={(i) => (i.percentualConsumido >= 90 ? 'erro' : undefined)}
            ferramentas={
              <a className="botao botao--secundario botao--compacto" href={urlExportarItens(filtro)} download>
                <Download size={16} aria-hidden="true" />
                <span>
                  Exportar CSV<span className="sr-only"> dos itens filtrados</span>
                </span>
              </a>
            }
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum item atende aos filtros' : 'Nenhum item na carteira'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os itens.'
                    : 'Os itens aparecem aqui quando há atas registradas no seu escopo.'
                }
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={limpar}>
                      Limpar filtros
                    </Botao>
                  ) : null
                }
              />
            }
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={p.pagina}
                  tamanhoPagina={p.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos itens"
                />
              ) : null
            }
          />
        </>
      )}
    </Pagina>
  );
}
