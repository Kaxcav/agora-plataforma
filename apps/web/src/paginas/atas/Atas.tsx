import { Link } from 'react-router';
import type { AtaAMontar, AtaResumo, FiltroAtas } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useAtas, useAtasAMontar } from '../../api/atas';
import {
  Abas,
  BarraFiltros,
  BarraProgresso,
  Botao,
  CaixaSelecao,
  CampoBusca,
  EstadoVazio,
  FalhaConsulta,
  EtiquetaPrioridade,
  EtiquetaSituacao,
  Pagina,
  Paginacao,
  Selecao,
  Semaforo,
  Tabela,
  TextoLongo,
  BotaoCopiar,
  type ColunaTabela,
} from '../../componentes';
import { formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { chavesDe, opcoesDe, PRIORIDADES, SITUACOES_INSTRUMENTO } from '../compartilhado/rotulos';

const FILTROS = ['busca', 'situacao', 'criticidade', 'uasg', 'minhas'] as const;

const COLUNAS: ColunaTabela<AtaResumo>[] = [
  {
    id: 'numero',
    cabecalho: 'Ata',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    celula: (a) => <Link to={`/atas/${a.id}`}>Ata {a.numero}</Link>,
  },
  {
    id: 'objeto',
    cabecalho: 'Objeto',
    prioritaria: true,
    larguraMinima: '16rem',
    celula: (a) => <TextoLongo texto={a.objeto} />,
  },
  {
    id: 'uasg',
    cabecalho: 'UASG gerenciadora',
    ordenavel: true,
    celula: (a) => (
      <span title={a.uasgGerenciadora.nome}>
        {a.uasgGerenciadora.sigla} <span className="texto-secundario numero">{a.uasgGerenciadora.codigo}</span>
      </span>
    ),
  },
  {
    id: 'fornecedores',
    cabecalho: 'Fornecedores',
    ocultaPorPadrao: true,
    celula: (a) =>
      a.fornecedores.length === 0 ? '—' : a.fornecedores.length === 1 ? a.fornecedores[0] : `${a.fornecedores[0]} e mais ${a.fornecedores.length - 1}`,
  },
  {
    id: 'vigenciaFim',
    cabecalho: 'Vigência',
    ordenavel: true,
    prioritaria: true,
    celula: (a) => (
      <div className="pilha pilha--compacta">
        <span className="numero">até {formatarData(a.vigenciaFim)}</span>
        <Semaforo valor={a.semaforo} vigenciaFim={a.vigenciaFim} />
      </div>
    ),
  },
  {
    id: 'percentualConsumido',
    cabecalho: 'Consumo',
    ordenavel: true,
    prioritaria: true,
    larguraMinima: '10rem',
    celula: (a) => <BarraProgresso valor={a.percentualConsumido} rotulo={`Consumo da ata ${a.numero}`} />,
  },
  {
    id: 'valorRegistrado',
    cabecalho: 'Valor registrado',
    ordenavel: true,
    alinhamento: 'fim',
    celula: (a) => <span className="numero">{formatarMoeda(a.valorRegistrado)}</span>,
  },
  {
    id: 'valorContratado',
    cabecalho: 'Valor contratado',
    alinhamento: 'fim',
    ocultaPorPadrao: true,
    celula: (a) => <span className="numero">{formatarMoeda(a.valorContratado)}</span>,
  },
  {
    id: 'itensEmRisco',
    cabecalho: 'Itens em risco',
    alinhamento: 'fim',
    celula: (a) => (
      <span className="numero">
        {a.itensEmRisco > 0 ? <strong>{formatarNumero(a.itensEmRisco)}</strong> : '0'} de {formatarNumero(a.quantidadeItens)}
      </span>
    ),
  },
  {
    id: 'criticidade',
    cabecalho: 'Criticidade',
    ordenavel: true,
    celula: (a) => <EtiquetaPrioridade valor={a.criticidade} />,
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    ocultaPorPadrao: true,
    celula: (a) => <EtiquetaSituacao valor={a.situacao} />,
  },
  {
    id: 'gestor',
    cabecalho: 'Gestor',
    celula: (a) => a.gestor?.nome ?? <span className="texto-secundario">Sem gestor</span>,
  },
];

function AtasRegistradas() {
  const p = useParametrosUrl();
  const filtro: FiltroAtas = {
    busca: p.texto('busca'),
    situacao: p.opcao('situacao', chavesDe(SITUACOES_INSTRUMENTO)),
    criticidade: p.opcao('criticidade', chavesDe(PRIORIDADES)),
    uasg: p.texto('uasg'),
    gestor: p.booleano('minhas') ? 'eu' : undefined,
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    ordenarPor: p.ordenacao?.por,
    ordem: p.ordenacao?.ordem,
  };
  const consulta = useAtas(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;

  return (
    <div className="pilha">
      <BarraFiltros
        total={consulta.data?.total}
        substantivo={['ata', 'atas']}
        feminino
        filtrosAtivos={filtrosAtivos}
        aoLimpar={limpar}
        rotulo="Filtros de atas"
      >
        <CampoBusca
          rotulo="Buscar"
          placeholder="Número, objeto ou fornecedor"
          valor={filtro.busca ?? ''}
          aoMudar={(v) => p.atualizar({ busca: v })}
        />
        <Selecao
          rotulo="Situação"
          opcaoVazia="Todas"
          opcoes={opcoesDe(SITUACOES_INSTRUMENTO)}
          value={filtro.situacao ?? ''}
          onChange={(e) => p.atualizar({ situacao: e.target.value })}
        />
        <Selecao
          rotulo="Criticidade"
          opcaoVazia="Todas"
          opcoes={opcoesDe(PRIORIDADES)}
          value={filtro.criticidade ?? ''}
          onChange={(e) => p.atualizar({ criticidade: e.target.value })}
        />
        <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
        <CaixaSelecao rotulo="Sob minha gestão" checked={filtro.gestor === 'eu'} onChange={(e) => p.atualizar({ minhas: e.target.checked })} />
      </BarraFiltros>

      <Tabela
        id="atas"
        legenda="Atas de registro de preços"
        colunas={COLUNAS}
        linhas={consulta.data?.itens}
        chave={(a) => a.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        ordenacao={p.ordenacao}
        aoOrdenar={p.definirOrdenacao}
        destaque={(a) => (a.semaforo === 'vencido' || a.semaforo === 'critico' ? 'erro' : a.semaforo === 'atencao' ? 'aviso' : undefined)}
        vazio={
          <EstadoVazio
            titulo={filtrosAtivos ? 'Nenhuma ata atende aos filtros' : 'Nenhuma ata registrada no seu escopo'}
            descricao={
              filtrosAtivos
                ? 'Revise os critérios ou limpe os filtros para ver todas as atas.'
                : 'As atas aparecem aqui após a sincronização com o PNCP ou a montagem a partir de pregões homologados.'
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
              rotulo="Paginação das atas"
            />
          ) : null
        }
      />
    </div>
  );
}

const COLUNAS_A_MONTAR: ColunaTabela<AtaAMontar>[] = [
  { id: 'numeroCompra', cabecalho: 'Compra', identificadora: true, fixa: true, celula: (a) => <span className="numero">{a.numeroCompra}</span> },
  { id: 'objeto', cabecalho: 'Objeto', prioritaria: true, larguraMinima: '16rem', celula: (a) => <TextoLongo texto={a.objeto} /> },
  { id: 'modalidade', cabecalho: 'Modalidade', celula: (a) => a.modalidade },
  {
    id: 'uasg',
    cabecalho: 'UASG',
    celula: (a) => (
      <span title={a.uasg.nome}>
        {a.uasg.sigla} <span className="texto-secundario numero">{a.uasg.codigo}</span>
      </span>
    ),
  },
  { id: 'homologadaEm', cabecalho: 'Homologada em', prioritaria: true, celula: (a) => <span className="numero">{formatarData(a.homologadaEm)}</span> },
  { id: 'quantidadeItens', cabecalho: 'Itens', alinhamento: 'fim', celula: (a) => <span className="numero">{formatarNumero(a.quantidadeItens)}</span> },
  {
    id: 'valorHomologado',
    cabecalho: 'Valor homologado',
    alinhamento: 'fim',
    prioritaria: true,
    celula: (a) => <span className="numero">{formatarMoeda(a.valorHomologado)}</span>,
  },
  { id: 'idPncp', cabecalho: 'Identificador PNCP', celula: (a) => <BotaoCopiar valor={a.idPncp} rotulo="identificador PNCP" /> },
];

function AtasAMontar() {
  const p = useParametrosUrl('m');
  const parametros = { busca: p.texto('busca'), pagina: p.pagina, tamanhoPagina: p.tamanhoPagina };
  const consulta = useAtasAMontar(parametros);
  const filtrosAtivos = p.algumAtivo(['busca']);

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;

  return (
    <div className="pilha">
      <p className="texto-secundario">
        Pregões homologados (fonte: PNCP) cujos resultados ainda não foram registrados em ata na Ágora. A montagem da ata é feita pela equipe
        de gestão a partir destes dados.
      </p>
      <BarraFiltros
        total={consulta.data?.total}
        substantivo={['pregão homologado', 'pregões homologados']}
        filtrosAtivos={filtrosAtivos}
        aoLimpar={() => p.limpar(['busca'])}
        rotulo="Filtros de atas a montar"
      >
        <CampoBusca rotulo="Buscar" placeholder="Número da compra ou objeto" valor={parametros.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
      </BarraFiltros>
      <Tabela
        id="atas-a-montar"
        legenda="Atas a montar (pregões homologados)"
        colunas={COLUNAS_A_MONTAR}
        linhas={consulta.data?.itens}
        chave={(a) => a.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        vazio={
          <EstadoVazio
            titulo={filtrosAtivos ? 'Nenhum pregão atende à busca' : 'Nenhuma ata pendente de montagem'}
            descricao={filtrosAtivos ? 'Revise o termo buscado.' : 'Todos os pregões homologados já têm ata registrada.'}
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
              rotulo="Paginação das atas a montar"
            />
          ) : null
        }
      />
    </div>
  );
}

export default function Atas() {
  return (
    <Pagina
      titulo="Atas de registro de preços"
      subtitulo="Vigência, consumo e criticidade das atas sob gestão do órgão."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="atas"
    >
      <Abas
        rotulo="Situação de registro"
        abas={[
          { id: 'registradas', rotulo: 'Registradas', conteudo: () => <AtasRegistradas /> },
          { id: 'a-montar', rotulo: 'A montar', conteudo: () => <AtasAMontar /> },
        ]}
      />
    </Pagina>
  );
}
