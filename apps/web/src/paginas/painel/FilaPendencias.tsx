import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, Inbox, RotateCcw } from 'lucide-react';
import type { FiltroPendencias, Pendencia } from '@agora/contratos';
import { formatarData, hojeISO } from '@agora/dominio';
import { usePendencias, useReabrirPendencia, useResolverPendencia } from '../../api/painel';
import {
  AreaTexto,
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  ConfirmarAcao,
  EstadoVazio,
  Etiqueta,
  EtiquetaPrioridade,
  FalhaConsulta,
  Paginacao,
  Secao,
  Selecao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { chavesDe, opcoesDe, PRIORIDADES, TIPOS_PENDENCIA } from '../compartilhado/rotulos';

const FILTROS = ['busca', 'tipo', 'prioridade', 'situacao', 'minhas'] as const;
const SITUACOES = { aberta: 'Abertas', resolvida: 'Resolvidas', todas: 'Todas' } as const;
const ORDENACOES = ['prioridade', 'prazo', 'uasg'] as const;
const MINIMO_OBSERVACAO = 5;
const MAXIMO_OBSERVACAO = 500;

function caminhoInstrumento(p: Pendencia): string {
  return p.instrumento.tipo === 'ata' ? `/atas/${p.instrumento.id}` : `/contratos/${p.instrumento.id}`;
}

function colunas(hoje: string): ColunaTabela<Pendencia>[] {
  return [
    {
      id: 'instrumento',
      cabecalho: 'Instrumento',
      identificadora: true,
      fixa: true,
      celula: (p) => <Link to={caminhoInstrumento(p)}>{p.instrumento.identificador}</Link>,
    },
    { id: 'prioridade', cabecalho: 'Prioridade', ordenavel: true, prioritaria: true, celula: (p) => <EtiquetaPrioridade valor={p.prioridade} /> },
    { id: 'tipo', cabecalho: 'Tipo', celula: (p) => TIPOS_PENDENCIA[p.tipo] },
    {
      id: 'motivo',
      cabecalho: 'Motivo',
      prioritaria: true,
      larguraMinima: '16rem',
      celula: (p) => (
        <div className="pilha pilha--compacta">
          <TextoLongo texto={p.motivo} />
          {p.situacao === 'resolvida' && p.observacaoResolucao ? (
            <span className="texto-pequeno texto-secundario">
              Resolvida{p.resolvidaPor ? ` por ${p.resolvidaPor.nome}` : ''}
              {p.resolvidaEm ? ` em ${formatarInstante(p.resolvidaEm)}` : ''}: “{p.observacaoResolucao}”
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'objeto',
      cabecalho: 'Objeto',
      ocultaPorPadrao: true,
      larguraMinima: '14rem',
      celula: (p) => (
        <div className="pilha pilha--compacta">
          <TextoLongo texto={p.objeto} />
          {p.fornecedor ? <span className="texto-pequeno texto-secundario">{p.fornecedor}</span> : null}
        </div>
      ),
    },
    {
      id: 'prazo',
      cabecalho: 'Prazo',
      ordenavel: true,
      prioritaria: true,
      celula: (p) =>
        p.prazo ? (
          <span className="pilha pilha--compacta">
            <span className="numero">{formatarData(p.prazo)}</span>
            {p.situacao === 'aberta' && p.prazo < hoje ? (
              <Etiqueta tom="erro" compacta>
                Prazo vencido
              </Etiqueta>
            ) : null}
          </span>
        ) : (
          <span className="texto-secundario">Sem prazo</span>
        ),
    },
    { id: 'uasg', cabecalho: 'UASG', ordenavel: true, celula: (p) => <span className="numero">{p.uasg}</span> },
    { id: 'responsavel', cabecalho: 'Responsável', celula: (p) => p.responsavel?.nome ?? <span className="texto-secundario">Não atribuída</span> },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      // O filtro "Situação" já informa o recorte; a coluna pode ser ligada no seletor de colunas.
      ocultaPorPadrao: true,
      celula: (p) =>
        p.situacao === 'aberta' ? (
          <Etiqueta tom="aviso" compacta>
            Aberta
          </Etiqueta>
        ) : (
          <Etiqueta tom="sucesso" compacta>
            Resolvida
          </Etiqueta>
        ),
    },
  ];
}

/**
 * Fila de pendências do painel: filtros na URL, ordenação no servidor, "Resolver" com observação
 * obrigatória e confirmação; o aviso de sucesso oferece "Desfazer" (POST /pendencias/:id/reabrir).
 */
export function FilaPendencias({ uasg }: { uasg: string | undefined }) {
  const hoje = hojeISO(new Date());
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const resolver = useResolverPendencia();
  const reabrir = useReabrirPendencia();
  const podeResolver = temPermissao('pendencias:resolver');

  const situacaoUrl = p.opcao('situacao', chavesDe(SITUACOES)) ?? 'aberta';
  const ordenacao = p.ordenacao && (ORDENACOES as readonly string[]).includes(p.ordenacao.por) ? p.ordenacao : undefined;
  const filtro: FiltroPendencias = {
    busca: p.texto('busca'),
    tipo: p.opcao('tipo', chavesDe(TIPOS_PENDENCIA)),
    prioridade: p.opcao('prioridade', chavesDe(PRIORIDADES)),
    situacao: situacaoUrl === 'todas' ? undefined : situacaoUrl,
    uasg,
    responsavel: p.booleano('minhas') ? 'eu' : 'todos',
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    ordenarPor: ordenacao?.por,
    ordem: ordenacao?.ordem,
  };
  const consulta = usePendencias(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  const [alvoResolver, definirAlvoResolver] = useState<Pendencia | null>(null);
  const [alvoReabrir, definirAlvoReabrir] = useState<Pendencia | null>(null);
  const [observacao, definirObservacao] = useState('');
  const [tentou, definirTentou] = useState(false);
  const tamanhoObs = observacao.trim().length;
  const erroObservacao = tentou && tamanhoObs < MINIMO_OBSERVACAO ? `Descreva a resolução com pelo menos ${MINIMO_OBSERVACAO} caracteres.` : null;

  const abrirResolver = (pendencia: Pendencia) => {
    resolver.reset();
    definirObservacao('');
    definirTentou(false);
    definirAlvoResolver(pendencia);
  };

  const confirmarResolver = () => {
    definirTentou(true);
    if (!alvoResolver || tamanhoObs < MINIMO_OBSERVACAO) return;
    const alvo = alvoResolver;
    resolver.mutate(
      { id: alvo.id, entrada: { observacao: observacao.trim() } },
      {
        onSuccess: () => {
          definirAlvoResolver(null);
          avisar({
            tipo: 'sucesso',
            titulo: 'Pendência resolvida',
            mensagem: `${TIPOS_PENDENCIA[alvo.tipo]} — ${alvo.instrumento.identificador}.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await reabrir.mutateAsync(alvo.id);
                avisar({ tipo: 'info', mensagem: `Pendência de ${alvo.instrumento.identificador} reaberta.` });
              },
            },
          });
        },
      },
    );
  };

  const confirmarReabrir = () => {
    if (!alvoReabrir) return;
    const alvo = alvoReabrir;
    reabrir.mutate(alvo.id, {
      onSuccess: () => {
        definirAlvoReabrir(null);
        avisar({ tipo: 'sucesso', mensagem: `Pendência de ${alvo.instrumento.identificador} reaberta.` });
      },
    });
  };

  return (
    <Secao
      id="fila-pendencias"
      titulo="Fila de pendências"
      descricao="O que exige ação na carteira. Resolver registra a observação na trilha de auditoria."
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar a fila de pendências" />
      ) : (
        <div className="pilha">
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['pendência', 'pendências']}
            feminino
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros da fila de pendências"
          >
            <CampoBusca rotulo="Buscar" placeholder="Instrumento, objeto ou fornecedor" valor={filtro.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
            <Selecao
              rotulo="Tipo"
              opcaoVazia="Todos"
              opcoes={opcoesDe(TIPOS_PENDENCIA)}
              value={filtro.tipo ?? ''}
              onChange={(e) => p.atualizar({ tipo: e.target.value })}
            />
            <Selecao
              rotulo="Prioridade"
              opcaoVazia="Todas"
              opcoes={opcoesDe(PRIORIDADES)}
              value={filtro.prioridade ?? ''}
              onChange={(e) => p.atualizar({ prioridade: e.target.value })}
            />
            <Selecao
              rotulo="Situação"
              opcoes={opcoesDe(SITUACOES)}
              value={situacaoUrl}
              onChange={(e) => p.atualizar({ situacao: e.target.value === 'aberta' ? undefined : e.target.value })}
            />
            <CaixaSelecao rotulo="Somente as minhas" checked={filtro.responsavel === 'eu'} onChange={(e) => p.atualizar({ minhas: e.target.checked })} />
          </BarraFiltros>

          <Tabela
            id="pendencias"
            legenda="Fila de pendências"
            colunas={colunas(hoje)}
            linhas={consulta.data?.itens}
            chave={(x) => x.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            ordenacao={ordenacao}
            aoOrdenar={p.definirOrdenacao}
            destaque={(x) => (x.situacao === 'aberta' && x.prazo !== null && x.prazo < hoje ? 'erro' : undefined)}
            acoes={
              podeResolver
                ? {
                    cabecalho: 'Ações',
                    celula: (x) =>
                      x.situacao === 'aberta' ? (
                        <Botao variante="secundario" tamanho="compacto" icone={CircleCheck} onClick={() => abrirResolver(x)} aria-label={`Resolver pendência de ${x.instrumento.identificador}`}>
                          Resolver
                        </Botao>
                      ) : (
                        <Botao
                          variante="terciario"
                          tamanho="compacto"
                          icone={RotateCcw}
                          onClick={() => {
                            reabrir.reset();
                            definirAlvoReabrir(x);
                          }}
                          aria-label={`Reabrir pendência de ${x.instrumento.identificador}`}
                        >
                          Reabrir
                        </Botao>
                      ),
                  }
                : undefined
            }
            vazio={
              <EstadoVazio
                icone={filtrosAtivos ? undefined : Inbox}
                titulo={filtrosAtivos ? 'Nenhuma pendência atende aos filtros' : 'Nenhuma pendência aberta'}
                descricao={filtrosAtivos ? 'Revise os critérios ou limpe os filtros.' : 'A carteira está em dia. Novas pendências aparecem aqui automaticamente.'}
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
                  rotulo="Paginação da fila de pendências"
                />
              ) : null
            }
          />
        </div>
      )}

      <ConfirmarAcao
        aberto={alvoResolver !== null}
        aoFechar={() => definirAlvoResolver(null)}
        titulo="Resolver pendência"
        descricao={
          alvoResolver ? (
            <p>
              <strong>{alvoResolver.instrumento.identificador}</strong> — {TIPOS_PENDENCIA[alvoResolver.tipo]}: {alvoResolver.motivo}
            </p>
          ) : null
        }
        rotuloConfirmar="Resolver pendência"
        aoConfirmar={confirmarResolver}
        processando={resolver.isPending}
        erro={resolver.error}
        largura="media"
      >
        <AreaTexto
          rotulo="Observação da resolução"
          obrigatorio
          rows={4}
          maxLength={MAXIMO_OBSERVACAO}
          contador
          value={observacao}
          onChange={(e) => definirObservacao(e.target.value)}
          erro={erroObservacao}
          ajuda="Explique o que foi feito (ex.: “Termo aditivo de prorrogação assinado em 05/11”)."
        />
      </ConfirmarAcao>

      <ConfirmarAcao
        aberto={alvoReabrir !== null}
        aoFechar={() => definirAlvoReabrir(null)}
        titulo="Reabrir pendência"
        descricao={
          alvoReabrir ? (
            <p>
              A pendência de <strong>{alvoReabrir.instrumento.identificador}</strong> voltará para a fila como aberta. A reabertura fica registrada na
              trilha de auditoria.
            </p>
          ) : null
        }
        rotuloConfirmar="Reabrir pendência"
        aoConfirmar={confirmarReabrir}
        processando={reabrir.isPending}
        erro={reabrir.error}
      />
    </Secao>
  );
}
