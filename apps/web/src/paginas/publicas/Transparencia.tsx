import { Link } from 'react-router';
import type { ContratoPublico } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useContratosPublicos } from '../../api/publico';
import {
  BarraFiltros,
  BarraProgresso,
  Botao,
  CampoBusca,
  EstadoVazio,
  FalhaConsulta,
  LinkExterno,
  Pagina,
  Paginacao,
  Tabela,
  TextoLongo,
  type ColunaTabela,
} from '../../componentes';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';

const COLUNAS: ColunaTabela<ContratoPublico>[] = [
  {
    id: 'numero',
    cabecalho: 'Contrato',
    identificadora: true,
    fixa: true,
    celula: (c) => <Link to={`/transparencia/contratos/${c.id}`}>Contrato {c.numero}</Link>,
  },
  { id: 'objeto', cabecalho: 'Objeto', prioritaria: true, larguraMinima: '16rem', celula: (c) => <TextoLongo texto={c.objeto} /> },
  {
    id: 'fornecedor',
    cabecalho: 'Fornecedor',
    prioritaria: true,
    celula: (c) => (
      <span className="pilha pilha--compacta">
        <span>{c.fornecedor}</span>
        <span className="texto-pequeno texto-secundario mono">{c.documentoFornecedor}</span>
      </span>
    ),
  },
  {
    id: 'orgao',
    cabecalho: 'Órgão / UASG',
    celula: (c) => (
      <span className="pilha pilha--compacta">
        <span>{c.orgao}</span>
        <span className="texto-pequeno texto-secundario numero">UASG {c.uasg}</span>
      </span>
    ),
  },
  {
    id: 'vigencia',
    cabecalho: 'Vigência',
    prioritaria: true,
    celula: (c) => (
      <span className="numero sem-quebra">
        {formatarData(c.vigenciaInicio)} a {formatarData(c.vigenciaFim)}
      </span>
    ),
  },
  { id: 'valorGlobal', cabecalho: 'Valor global', alinhamento: 'fim', prioritaria: true, celula: (c) => <span className="numero">{formatarMoeda(c.valorGlobal)}</span> },
  {
    id: 'execucao',
    cabecalho: 'Pago',
    larguraMinima: '10rem',
    celula: (c) => (
      <BarraProgresso
        valor={c.valorGlobal > 0 ? (c.valorPago / c.valorGlobal) * 100 : 0}
        rotulo={`Valor pago do contrato ${c.numero}`}
        textoValor={formatarMoeda(c.valorPago)}
        tom="sucesso"
      />
    ),
  },
  {
    id: 'pncp',
    cabecalho: 'PNCP',
    celula: (c) => (c.linkPncp ? <LinkExterno href={c.linkPncp}>Ver no PNCP</LinkExterno> : <span className="texto-secundario">Não divulgado</span>),
  },
];

export default function Transparencia() {
  const p = useParametrosUrl();
  const parametros = { busca: p.texto('busca'), pagina: p.pagina, tamanhoPagina: p.tamanhoPagina };
  const consulta = useContratosPublicos(parametros);
  const filtrosAtivos = p.algumAtivo(['busca']);

  return (
    <Pagina
      titulo="Transparência: contratos"
      tituloDocumento="Transparência"
      subtitulo="Consulta pública aos contratos do órgão, sem necessidade de cadastro (Lei 12.527/2011 e Lei 14.133/2021, art. 174)."
      tela="transparencia"
    >
      <p className="texto-secundario">
        Os dados pessoais de fornecedores pessoa física aparecem mascarados. A fonte oficial de divulgação das contratações é o Portal Nacional de
        Contratações Públicas (PNCP); o link de cada contrato leva ao registro correspondente. O inteiro teor dos editais está em{' '}
        <Link to="/transparencia/editais">Transparência: editais publicados</Link>.
      </p>
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <div className="pilha">
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['contrato', 'contratos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={() => p.limpar(['busca'])}
            rotulo="Busca de contratos"
          >
            <CampoBusca rotulo="Buscar contratos" placeholder="Número, objeto ou fornecedor" valor={parametros.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
          </BarraFiltros>
          <Tabela
            id="transparencia"
            legenda="Contratos publicados"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(c) => c.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum contrato atende à busca' : 'Nenhum contrato publicado'}
                descricao={filtrosAtivos ? 'Revise o termo buscado ou limpe a busca.' : 'Os contratos aparecem aqui após a assinatura e o cadastro na Ágora.'}
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
                  rotulo="Paginação dos contratos"
                />
              ) : null
            }
          />
        </div>
      )}
    </Pagina>
  );
}
