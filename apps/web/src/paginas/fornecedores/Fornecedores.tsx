import { Link } from 'react-router';
import type { FornecedorResumo } from '@agora/contratos';
import { useFornecedores, type FiltroFornecedores } from '../../api/fornecedores';
import {
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  type ColunaTabela,
} from '../../componentes';
import { formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { chavesDe, FAIXAS_IDC, opcoesDe, PORTES } from '../compartilhado/rotulos';
import { DocumentoFornecedor, ResumoIdc } from './idc';

const FILTROS = ['busca', 'faixa', 'comSancao'] as const;

const COLUNAS: ColunaTabela<FornecedorResumo>[] = [
  {
    id: 'razaoSocial',
    cabecalho: 'Fornecedor',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    celula: (f) => <Link to={`/fornecedores/${f.id}`}>{f.razaoSocial}</Link>,
  },
  {
    id: 'documento',
    cabecalho: 'CNPJ/CPF',
    prioritaria: true,
    celula: (f) => <DocumentoFornecedor fornecedor={f} />,
  },
  {
    id: 'tipoPessoa',
    cabecalho: 'Tipo',
    ocultaPorPadrao: true,
    celula: (f) => (f.tipoPessoa === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'),
  },
  {
    id: 'porte',
    cabecalho: 'Porte',
    celula: (f) => (f.porte ? PORTES[f.porte] : <span className="texto-secundario">Não informado</span>),
  },
  {
    id: 'uf',
    cabecalho: 'UF',
    celula: (f) => f.uf ?? <span className="texto-secundario">—</span>,
  },
  {
    id: 'idc',
    cabecalho: 'IDC',
    ordenavel: true,
    prioritaria: true,
    celula: (f) => <ResumoIdc idc={f.idc} />,
  },
  {
    id: 'sancoesVigentes',
    cabecalho: 'Sanções vigentes',
    ordenavel: true,
    alinhamento: 'fim',
    prioritaria: true,
    celula: (f) =>
      f.sancoesVigentes > 0 ? (
        <Etiqueta tom="erro" compacta>
          {formatarNumero(f.sancoesVigentes)} {f.sancoesVigentes === 1 ? 'vigente' : 'vigentes'}
        </Etiqueta>
      ) : (
        <span className="numero texto-secundario">0</span>
      ),
  },
];

export default function Fornecedores() {
  const p = useParametrosUrl();
  const filtro: FiltroFornecedores = {
    busca: p.texto('busca'),
    faixa: p.opcao('faixa', chavesDe(FAIXAS_IDC)),
    comSancao: p.booleano('comSancao') ? true : undefined,
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    ordenarPor: p.ordenacao?.por,
    ordem: p.ordenacao?.ordem,
  };
  const consulta = useFornecedores(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  return (
    <Pagina
      titulo="Fornecedores"
      subtitulo="Desempenho (IDC), sanções e regularidade dos fornecedores com contratos e atas no órgão."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="fornecedores"
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['fornecedor', 'fornecedores']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de fornecedores"
          >
            <CampoBusca
              rotulo="Buscar"
              placeholder="Razão social, nome ou CNPJ"
              valor={filtro.busca ?? ''}
              aoMudar={(v) => p.atualizar({ busca: v })}
            />
            <Selecao
              rotulo="Faixa do IDC"
              opcaoVazia="Todas"
              opcoes={opcoesDe(FAIXAS_IDC)}
              value={filtro.faixa ?? ''}
              onChange={(e) => p.atualizar({ faixa: e.target.value })}
            />
            <CaixaSelecao rotulo="Com sanção vigente" checked={filtro.comSancao === true} onChange={(e) => p.atualizar({ comSancao: e.target.checked })} />
          </BarraFiltros>

          <Tabela
            id="fornecedores"
            legenda="Fornecedores"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(f) => f.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            ordenacao={p.ordenacao}
            aoOrdenar={p.definirOrdenacao}
            destaque={(f) => (f.sancoesVigentes > 0 ? 'erro' : undefined)}
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum fornecedor atende aos filtros' : 'Nenhum fornecedor cadastrado no seu escopo'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os fornecedores.'
                    : 'Os fornecedores são incorporados a partir dos contratos e atas sincronizados.'
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
                  pagina={filtro.pagina ?? 1}
                  tamanhoPagina={filtro.tamanhoPagina ?? 25}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos fornecedores"
                />
              ) : null
            }
          />
          <p className="texto-pequeno texto-secundario">
            O IDC (Índice de Desempenho do Contratado) é um indicador objetivo calculado a partir de entregas, recebimentos e ocorrências
            de fiscalização (Lei 14.133/2021, art. 88, §§ 3º e 4º). É apoio à gestão: não constitui sanção nem impede a participação em
            licitações.
          </p>
        </>
      )}
    </Pagina>
  );
}
