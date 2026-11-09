import { Link } from 'react-router';
import type { EditalPublico } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useEditaisPublicos } from '../../api/publico';
import { BarraFiltros, Botao, CampoBusca, EstadoVazio, FalhaConsulta, LinkExterno, Pagina, Paginacao, Tabela, TextoLongo, type ColunaTabela } from '../../componentes';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';

const COLUNAS: ColunaTabela<EditalPublico>[] = [
  {
    id: 'objeto',
    cabecalho: 'Edital',
    identificadora: true,
    fixa: true,
    larguraMinima: '18rem',
    celula: (e) => (
      <span className="pilha pilha--compacta">
        <Link to={`/transparencia/editais/${e.id}`}>
          <TextoLongo texto={e.objeto} />
        </Link>
        <span className="texto-pequeno texto-secundario mono">Processo {e.numeroSei}</span>
      </span>
    ),
  },
  { id: 'orgao', cabecalho: 'Órgão requisitante', prioritaria: true, celula: (e) => e.orgaoRequisitante },
  { id: 'publicacao', cabecalho: 'Publicado em', prioritaria: true, celula: (e) => <span className="numero sem-quebra">{formatarData(e.publicadoEm)}</span> },
  {
    id: 'propostas',
    cabecalho: 'Propostas a partir de',
    celula: (e) => (e.dataMinimaPropostas ? <span className="numero sem-quebra">{formatarData(e.dataMinimaPropostas)}</span> : '—'),
  },
  { id: 'documentos', cabecalho: 'Documentos', alinhamento: 'fim', celula: (e) => <span className="numero">{e.documentos.length}</span> },
  {
    id: 'homologacao',
    cabecalho: 'Homologação',
    celula: (e) =>
      e.homologadoEm ? (
        <span className="pilha pilha--compacta">
          <span className="numero sem-quebra">{formatarData(e.homologadoEm)}</span>
          <span className="texto-pequeno texto-secundario">
            {e.documentosPreparatorios.length} {e.documentosPreparatorios.length === 1 ? 'documento preparatório' : 'documentos preparatórios'}
          </span>
        </span>
      ) : (
        <span className="texto-secundario">Não homologado</span>
      ),
  },
  {
    id: 'pncp',
    cabecalho: 'PNCP',
    celula: (e) => (e.linkPncp ? <LinkExterno href={e.linkPncp}>Ver no PNCP</LinkExterno> : <span className="texto-secundario">Inteiro teor nesta página</span>),
  },
];

export default function TransparenciaEditais() {
  const p = useParametrosUrl();
  const parametros = { busca: p.texto('busca'), pagina: p.pagina, tamanhoPagina: p.tamanhoPagina };
  const consulta = useEditaisPublicos(parametros);
  const filtrosAtivos = p.algumAtivo(['busca']);

  return (
    <Pagina
      titulo="Transparência: editais publicados"
      tituloDocumento="Editais publicados"
      subtitulo="Inteiro teor do edital e dos anexos, sem cadastro nem login (Lei 14.133/2021, art. 25, § 3º, e art. 54)."
      trilha={[{ rotulo: 'Transparência', para: '/transparencia' }]}
      tela="transparencia"
    >
      <p className="texto-secundario">
        Os documentos são a última versão aprovada, em PDF, com os dados pessoais tarjados. Depois da homologação, os documentos da fase
        preparatória também ficam disponíveis no edital (art. 54, § 3º). Os contratos assinados estão em{' '}
        <Link to="/transparencia">Transparência: contratos</Link> e os pagamentos mensais em{' '}
        <Link to="/ordem-cronologica">Ordem cronológica dos pagamentos</Link>.
      </p>
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <div className="pilha">
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['edital', 'editais']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={() => p.limpar(['busca'])}
            rotulo="Busca de editais"
          >
            <CampoBusca rotulo="Buscar editais" placeholder="Objeto ou número do processo" valor={parametros.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
          </BarraFiltros>
          <Tabela
            id="transparencia-editais"
            legenda="Editais publicados"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(e) => e.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum edital atende à busca' : 'Nenhum edital publicado'}
                descricao={filtrosAtivos ? 'Revise o termo buscado ou limpe a busca.' : 'Os editais aparecem aqui depois da publicação, na etapa 5 da jornada da contratação.'}
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={() => p.limpar(['busca'])}>
                      Limpar busca
                    </Botao>
                  ) : null
                }
              />
            }
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={parametros.pagina}
                  tamanhoPagina={parametros.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos editais"
                />
              ) : null
            }
          />
        </div>
      )}
    </Pagina>
  );
}
