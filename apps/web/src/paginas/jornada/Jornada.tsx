/**
 * `/jornada` — processos de contratação com filtros por órgão requisitante e etapa, busca, paginação,
 * progresso compacto e bloqueios; "Novo processo" para quem edita a jornada.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CircleCheck, FilePlus, OctagonAlert, Route } from 'lucide-react';
import type { OrgaoRequisitante, ProcessoResumo } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { useCriarProcesso, useProcessos, type FiltroProcessos } from '../../api/jornada';
import {
  BarraFiltros,
  Botao,
  CampoBusca,
  CampoTexto,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ErroOperacao, MiniProgresso } from './comum';
import { LISTA_ORGAOS, NUMEROS_ETAPAS, ORGAOS, tituloEtapa } from './rotulos';

const FILTROS = ['busca', 'orgao', 'etapa'] as const;
const MINIMO_TITULO = 10;
const ETAPAS_TEXTO = NUMEROS_ETAPAS.map(String);

const COLUNAS: ColunaTabela<ProcessoResumo>[] = [
  {
    id: 'titulo',
    cabecalho: 'Processo',
    identificadora: true,
    fixa: true,
    larguraMinima: '18rem',
    celula: (p) => (
      <span className="pilha pilha--compacta">
        <Link to={`/jornada/${encodeURIComponent(p.id)}`}>{p.titulo}</Link>
        <span className="mono texto-pequeno texto-secundario">{p.numeroSei}</span>
      </span>
    ),
  },
  {
    id: 'orgao',
    cabecalho: 'Órgão',
    prioritaria: true,
    celula: (p) => (
      <abbr title={ORGAOS[p.orgao].nome} className="jornada-sigla">
        {p.orgao}
      </abbr>
    ),
  },
  { id: 'etapa', cabecalho: 'Etapa', prioritaria: true, larguraMinima: '13rem', celula: (p) => <MiniProgresso etapa={p.etapaAtual} /> },
  {
    id: 'bloqueios',
    cabecalho: 'Bloqueios',
    prioritaria: true,
    celula: (p) =>
      p.bloqueios > 0 ? (
        <Etiqueta tom="erro" icone={OctagonAlert} compacta>
          {contar(p.bloqueios, 'bloqueio', 'bloqueios')}
        </Etiqueta>
      ) : (
        <Etiqueta tom="sucesso" icone={CircleCheck} compacta>
          Sem bloqueios
        </Etiqueta>
      ),
  },
  {
    id: 'valorEstimado',
    cabecalho: 'Valor estimado',
    alinhamento: 'fim',
    celula: (p) => (p.valorEstimado !== null ? <span className="numero">{formatarMoeda(p.valorEstimado)}</span> : <span className="texto-secundario">A estimar</span>),
  },
  { id: 'modalidade', cabecalho: 'Modalidade prevista', ocultaPorPadrao: true, celula: (p) => p.modalidadePrevista ?? <span className="texto-secundario">A definir</span> },
  { id: 'responsavel', cabecalho: 'Responsável', celula: (p) => p.responsavel?.nome ?? <span className="texto-secundario">Sem responsável</span> },
  { id: 'atualizadoEm', cabecalho: 'Atualizado em', celula: (p) => <span className="numero">{formatarInstante(p.atualizadoEm)}</span> },
];

function DialogoNovoProcesso({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const criar = useCriarProcesso();
  const [titulo, definirTitulo] = useState('');
  const [orgao, definirOrgao] = useState<OrgaoRequisitante | ''>('');
  const [tentou, definirTentou] = useState(false);

  const erroTitulo = titulo.trim().length < MINIMO_TITULO ? `Descreva o objeto com pelo menos ${MINIMO_TITULO} caracteres.` : null;
  const erroOrgao = orgao === '' ? 'Selecione o órgão requisitante.' : null;

  const fechar = () => {
    definirTitulo('');
    definirOrgao('');
    definirTentou(false);
    criar.reset();
    aoFechar();
  };

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    definirTentou(true);
    if (erroTitulo || orgao === '') {
      const formulario = evento.currentTarget;
      window.requestAnimationFrame(() => formulario.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    criar.mutate(
      { titulo: titulo.trim(), orgao },
      {
        onSuccess: (processo) => {
          avisar({ tipo: 'sucesso', titulo: 'Processo criado', mensagem: `${processo.numeroSei} — etapa 1, ${tituloEtapa(1)}.` });
          fechar();
          void navegar(`/jornada/${encodeURIComponent(processo.id)}`);
        },
      },
    );
  };

  const idFormulario = 'formulario-novo-processo';
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={criar.isPending ? () => undefined : fechar}
      titulo="Novo processo de contratação"
      descricao={<p>O processo começa na etapa 1 (Demanda e PCA) com número SEI gerado pela Ágora. Os demais dados são preenchidos no DFD.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={criar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={criar.isPending}>
            Criar processo
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto
          rotulo="Objeto (título do processo)"
          obrigatorio
          maxLength={200}
          value={titulo}
          erro={tentou ? erroTitulo : null}
          onChange={(e) => definirTitulo(e.target.value)}
          ajuda="Ex.: Aquisição de viaturas caracterizadas para o policiamento rodoviário."
        />
        <Selecao
          rotulo="Órgão requisitante"
          obrigatorio
          opcaoVazia="Selecione…"
          opcoes={LISTA_ORGAOS.map((o) => ({ valor: o, rotulo: `${o} — ${ORGAOS[o].nome}` }))}
          value={orgao}
          erro={tentou ? erroOrgao : null}
          onChange={(e) => {
            const valor = e.target.value;
            definirOrgao(LISTA_ORGAOS.find((o) => o === valor) ?? '');
          }}
        />
        <ErroOperacao erro={criar.error} titulo="Não foi possível criar o processo" />
      </form>
    </Dialogo>
  );
}

export default function Jornada() {
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const [novoAberto, definirNovoAberto] = useState(false);
  const etapaTexto = p.opcao('etapa', ETAPAS_TEXTO);
  const filtro: FiltroProcessos = {
    busca: p.texto('busca'),
    orgao: p.opcao('orgao', LISTA_ORGAOS),
    etapa: NUMEROS_ETAPAS.find((e) => String(e) === etapaTexto),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useProcessos(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);
  const podeCriar = temPermissao('jornada:editar');

  return (
    <Pagina
      titulo="Jornada da contratação"
      subtitulo="Processos do MJSP e das unidades vinculadas, da demanda ao contrato, com as regras da Lei 14.133/2021 verificadas em cada etapa."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="jornada"
      acoes={
        podeCriar ? (
          <Botao variante="primario" icone={FilePlus} onClick={() => definirNovoAberto(true)}>
            Novo processo
          </Botao>
        ) : null
      }
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar os processos" />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['processo', 'processos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de processos"
          >
            <CampoBusca rotulo="Buscar" placeholder="Objeto ou número SEI" valor={filtro.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
            <Selecao
              rotulo="Órgão requisitante"
              opcaoVazia="Todos"
              opcoes={LISTA_ORGAOS.map((o) => ({ valor: o, rotulo: `${o} — ${ORGAOS[o].nome}` }))}
              value={filtro.orgao ?? ''}
              onChange={(e) => p.atualizar({ orgao: e.target.value })}
            />
            <Selecao
              rotulo="Etapa"
              opcaoVazia="Todas"
              opcoes={NUMEROS_ETAPAS.map((e) => ({ valor: String(e), rotulo: `${e} — ${tituloEtapa(e)}` }))}
              value={etapaTexto ?? ''}
              onChange={(e) => p.atualizar({ etapa: e.target.value })}
            />
          </BarraFiltros>

          <Tabela
            id="jornada-processos"
            legenda="Processos de contratação"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(processo) => processo.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            vazio={
              <EstadoVazio
                icone={Route}
                titulo={filtrosAtivos ? 'Nenhum processo atende aos filtros' : 'Nenhum processo no seu escopo'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os processos.'
                    : 'Os processos de contratação das UASGs do seu escopo aparecem aqui a partir do registro da demanda.'
                }
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={limpar}>
                      Limpar filtros
                    </Botao>
                  ) : podeCriar ? (
                    <Botao variante="primario" icone={FilePlus} onClick={() => definirNovoAberto(true)}>
                      Novo processo
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
                  rotulo="Paginação dos processos"
                />
              ) : null
            }
          />
        </>
      )}
      {podeCriar ? <DialogoNovoProcesso aberto={novoAberto} aoFechar={() => definirNovoAberto(false)} /> : null}
    </Pagina>
  );
}
