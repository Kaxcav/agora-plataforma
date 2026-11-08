/**
 * Fila de integrações (RNF-07): publicações no PNCP e sincronizações passam por uma fila no servidor, executada pelo
 * serviço trabalhador. Falhas transitórias são repetidas sozinhas; o que esgota as tentativas ou é recusado vai para a
 * fila de erro, de onde pode ser reprocessado (com registro na trilha de auditoria).
 */
import { useState } from 'react';
import { CircleCheck, Inbox, OctagonAlert, RotateCcw, Server } from 'lucide-react';
import type { SituacaoTarefaFila, TarefaFila } from '@agora/contratos';
import { useReprocessarTarefa, useResumoFila, useTarefasFila } from '../../api/fila';
import {
  Botao,
  ConfirmarAcao,
  ConteudoConsulta,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  Indicador,
  Paginacao,
  Secao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';

const SITUACOES: Record<SituacaoTarefaFila, { rotulo: string; tom: TomEtiqueta }> = {
  pendente: { rotulo: 'Na fila', tom: 'info' },
  executando: { rotulo: 'Executando', tom: 'info' },
  concluida: { rotulo: 'Concluída', tom: 'sucesso' },
  erro: { rotulo: 'Na fila de erro', tom: 'erro' },
};

type Filtro = 'erro' | 'pendente' | 'todas';
const FILTROS: readonly { valor: Filtro; rotulo: string }[] = [
  { valor: 'erro', rotulo: 'Fila de erro' },
  { valor: 'pendente', rotulo: 'Na fila' },
  { valor: 'todas', rotulo: 'Todas' },
];

function rotuloSituacao(t: TarefaFila): { rotulo: string; tom: TomEtiqueta } {
  if (t.situacao === 'pendente' && t.tentativas > 0) return { rotulo: 'Aguardando nova tentativa', tom: 'aviso' };
  return SITUACOES[t.situacao];
}

const COLUNAS: ColunaTabela<TarefaFila>[] = [
  {
    id: 'descricao',
    cabecalho: 'Tarefa',
    identificadora: true,
    fixa: true,
    larguraMinima: '16rem',
    celula: (t) => <span>{t.descricao}</span>,
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    celula: (t) => {
      const s = rotuloSituacao(t);
      return (
        <Etiqueta tom={s.tom} compacta>
          {s.rotulo}
        </Etiqueta>
      );
    },
  },
  {
    id: 'tentativas',
    cabecalho: 'Tentativas',
    alinhamento: 'fim',
    celula: (t) => <span className="numero">{`${t.tentativas} de ${t.maximoTentativas}`}</span>,
  },
  {
    id: 'quando',
    cabecalho: 'Próxima tentativa ou última atualização',
    celula: (t) => {
      const instante = t.proximaTentativaEm ?? t.atualizadaEm;
      return (
        <time dateTime={instante} className="numero">
          {formatarInstante(instante)}
        </time>
      );
    },
  },
  {
    id: 'erro',
    cabecalho: 'Último erro',
    larguraMinima: '16rem',
    celula: (t) => (t.ultimoErro ? <TextoLongo texto={t.ultimoErro} /> : <span className="texto-secundario">—</span>),
  },
  {
    id: 'chave',
    cabecalho: 'Chave de idempotência',
    ocultaPorPadrao: true,
    celula: (t) => <code className="mono">{t.chaveIdempotencia}</code>,
  },
];

export default function FilaIntegracoes({ podeExecutar }: { podeExecutar: boolean }) {
  const { avisar } = useAvisos();
  const [filtro, definirFiltro] = useState<Filtro>('erro');
  const [pagina, definirPagina] = useState(1);
  const [tamanhoPagina, definirTamanhoPagina] = useState(10);
  const resumo = useResumoFila();
  const tarefas = useTarefasFila(filtro === 'todas' ? null : filtro, pagina, tamanhoPagina);
  const reprocessar = useReprocessarTarefa();
  const [alvo, definirAlvo] = useState<TarefaFila | null>(null);

  const confirmar = () => {
    if (!alvo) return;
    reprocessar.mutate(alvo.id, {
      onSuccess: (tarefa) => {
        definirAlvo(null);
        if (tarefa.situacao === 'concluida') avisar({ tipo: 'sucesso', mensagem: `Reprocessada e concluída: ${tarefa.descricao}.` });
        else if (tarefa.situacao === 'erro') avisar({ tipo: 'erro', titulo: 'A tarefa voltou para a fila de erro', mensagem: tarefa.ultimoErro ?? tarefa.descricao });
        else avisar({ tipo: 'info', mensagem: `Tarefa devolvida à fila: ${tarefa.descricao}. O serviço trabalhador executa em seguida.` });
      },
    });
  };

  return (
    <Secao
      titulo="Fila de integrações"
      id="fila-integracoes"
      descricao="Publicações no PNCP e sincronizações passam por uma fila no servidor. Se o sistema externo estiver fora do ar, o envio é repetido sozinho, com intervalos crescentes; o que for recusado ou esgotar as tentativas fica na fila de erro."
    >
      <div className="pilha pilha--ampla">
        <ConteudoConsulta consulta={resumo} carregando={<EsqueletoTabela colunas={4} />} rotuloCarregando="Carregando a fila de integrações">
          {(r) => (
            <div className="grade grade--kpi">
              <Indicador
                rotulo="Transporte da fila"
                icone={Server}
                tom="neutro"
                valor={r.transporte === 'rabbitmq' ? 'RabbitMQ' : 'PostgreSQL'}
                detalhe={r.trabalhador === 'embutido' ? 'Trabalhador embutido na API' : 'Serviço trabalhador separado'}
              />
              <Indicador rotulo="Na fila" icone={Inbox} tom={r.pendentes + r.executando > 0 ? 'info' : 'neutro'} valor={formatarNumero(r.pendentes + r.executando)} />
              <Indicador rotulo="Na fila de erro" icone={OctagonAlert} tom={r.comErro > 0 ? 'erro' : 'neutro'} valor={formatarNumero(r.comErro)} />
              <Indicador rotulo="Concluídas em 24 horas" icone={CircleCheck} tom="sucesso" valor={formatarNumero(r.concluidasUltimas24h)} />
            </div>
          )}
        </ConteudoConsulta>
        <GrupoOpcoes
          legenda="Mostrar"
          nome="filtro-fila"
          horizontal
          opcoes={FILTROS}
          valor={filtro}
          aoMudar={(valor) => {
            definirFiltro(valor);
            definirPagina(1);
          }}
        />
        <ConteudoConsulta consulta={tarefas} carregando={<EsqueletoTabela colunas={5} />} rotuloCarregando="Carregando as tarefas da fila">
          {(lista) => (
            <>
              <Tabela
                id="admin-fila-integracoes"
                legenda="Tarefas da fila de integrações"
                colunas={COLUNAS}
                linhas={lista.itens}
                chave={(t) => t.id}
                atualizando={tarefas.isFetching}
                destaque={(t) => (t.situacao === 'erro' ? 'erro' : undefined)}
                vazio={
                  <EstadoVazio
                    icone={CircleCheck}
                    titulo={filtro === 'erro' ? 'Nenhuma tarefa na fila de erro' : 'Nenhuma tarefa'}
                    descricao="As tarefas aparecem aqui quando uma publicação ou sincronização é pedida."
                  />
                }
                acoes={
                  podeExecutar
                    ? {
                        cabecalho: 'Ações',
                        celula: (t) =>
                          t.situacao === 'erro' ? (
                            <Botao
                              variante="secundario"
                              tamanho="compacto"
                              icone={RotateCcw}
                              aria-label={`Reprocessar: ${t.descricao}`}
                              onClick={() => {
                                reprocessar.reset();
                                definirAlvo(t);
                              }}
                            >
                              Reprocessar
                            </Botao>
                          ) : null,
                      }
                    : undefined
                }
              />
              <Paginacao
                pagina={pagina}
                tamanhoPagina={tamanhoPagina}
                total={lista.total}
                aoMudarPagina={definirPagina}
                aoMudarTamanho={(tamanho) => {
                  definirTamanhoPagina(tamanho);
                  definirPagina(1);
                }}
                rotulo="Paginação da fila de integrações"
              />
            </>
          )}
        </ConteudoConsulta>
      </div>
      {podeExecutar ? (
        <ConfirmarAcao
          aberto={alvo !== null}
          aoFechar={() => definirAlvo(null)}
          titulo="Reprocessar tarefa"
          descricao={
            <>
              <p>
                Devolver à fila <strong>{alvo?.descricao}</strong>? As tentativas recomeçam do zero e o serviço trabalhador executa em seguida.
              </p>
              {alvo?.ultimoErro ? <p>Último erro: {alvo.ultimoErro}</p> : null}
              <p>Antes, confira se a causa foi resolvida (por exemplo, o cadastro recusado pelo PNCP). O reprocessamento fica na trilha de auditoria.</p>
            </>
          }
          rotuloConfirmar="Reprocessar"
          aoConfirmar={confirmar}
          processando={reprocessar.isPending}
          erro={reprocessar.error}
        />
      ) : null}
    </Secao>
  );
}
