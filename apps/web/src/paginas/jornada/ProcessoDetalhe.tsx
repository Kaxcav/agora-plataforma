/**
 * `/jornada/:id` — processo de contratação: stepper das 7 etapas, painel da etapa selecionada (só a etapa
 * atual é editável), coluna lateral com árvore SEI, bloqueios e sinais, "Avançar etapa" e dossiê imprimível.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileStack, GitCompareArrows, Printer, X } from 'lucide-react';
import type { EtapaJornada, ProcessoDetalhe as DadosProcesso } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { ErroApi } from '../../api/cliente';
import { chaveProcesso, regrasBloqueantes, useAvancarEtapa, useProcesso, type RegraBloqueante } from '../../api/jornada';
import {
  Alerta,
  Botao,
  BotaoCopiar,
  Carregando,
  ConfirmarAcao,
  ConteudoConsulta,
  Esqueleto,
  EsqueletoTexto,
  Etiqueta,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  useAvisos,
} from '../../componentes';
import { useModoEspecificacao } from '../../layout/ModoEspecificacao';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { AvisoSomenteConsulta, ListaRegras, type MotivoSomenteConsulta } from './comum';
import type { PropsEtapa } from './etapas/tipos';
import { ArvoreSei, ListaBloqueios, ListaSinais } from './Lateral';
import { ehEtapa, ORGAOS, TOTAL_ETAPAS, tituloEtapa } from './rotulos';
import { TrilhaEtapas } from './TrilhaEtapas';

const PAINEIS: Record<EtapaJornada, LazyExoticComponent<ComponentType<PropsEtapa>>> = {
  1: lazy(() => import('./etapas/Etapa1Demanda')),
  2: lazy(() => import('./etapas/Etapa2Equipe')),
  3: lazy(() => import('./etapas/Etapa3Planejamento')),
  4: lazy(() => import('./etapas/Etapa4Documentos')),
  5: lazy(() => import('./etapas/Etapa5Juridico')),
  6: lazy(() => import('./etapas/Etapa6Selecao')),
  7: lazy(() => import('./etapas/Etapa7Contrato')),
};

/** Catálogo de regras e dossiê só são baixados quando usados. */
const RegrasEtapa = lazy(() => import('./RegrasEtapa'));
const Dossie = lazy(() => import('./Dossie'));

interface FalhaAvanco {
  etapa: EtapaJornada;
  mensagem: string;
  regras: RegraBloqueante[];
  idRequisicao: string | null;
}

function EsqueletoProcesso() {
  return (
    <div className="pilha pilha--ampla" aria-hidden="true">
      <div className="cartao">
        <div className="grade grade--3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="pilha pilha--compacta">
              <Esqueleto largura="40%" />
              <Esqueleto largura="75%" />
            </div>
          ))}
        </div>
      </div>
      <div className="jornada-trilha__esqueleto">
        {Array.from({ length: TOTAL_ETAPAS }, (_, i) => (
          <Esqueleto key={i} altura="3.5rem" />
        ))}
      </div>
      <div className="detalhe-grade">
        <div className="cartao">
          <EsqueletoTexto linhas={10} />
        </div>
        <div className="cartao">
          <EsqueletoTexto linhas={6} />
        </div>
      </div>
    </div>
  );
}

function ResultadoAvanco({ falha, aoFechar }: { falha: FalhaAvanco; aoFechar: () => void }) {
  const referencia = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Depois do diálogo devolver o foco a quem o abriu.
    const quadro = window.requestAnimationFrame(() => referencia.current?.focus());
    return () => window.cancelAnimationFrame(quadro);
  }, [falha]);
  return (
    <div ref={referencia} tabIndex={-1} className="jornada-foco">
      <Alerta
        tipo="erro"
        anunciar
        titulo={
          falha.regras.length > 0
            ? `O processo permanece na etapa ${falha.etapa}: ${contar(falha.regras.length, 'regra impede', 'regras impedem')} o avanço`
            : `O processo permanece na etapa ${falha.etapa}`
        }
        acoes={
          <Botao variante="terciario" tamanho="compacto" icone={X} onClick={aoFechar}>
            Fechar aviso
          </Botao>
        }
      >
        {falha.regras.length > 0 ? <ListaRegras regras={falha.regras} /> : <p>{falha.mensagem}</p>}
        <p>Resolva os bloqueios no painel da etapa e tente avançar novamente.</p>
        {falha.idRequisicao ? (
          <p className="texto-pequeno">
            Código para o suporte: <code className="selecionavel">{falha.idRequisicao}</code>
          </p>
        ) : null}
      </Alerta>
    </div>
  );
}

function motivoConsulta(
  processo: DadosProcesso,
  etapa: EtapaJornada,
  podeEditar: boolean,
  podeAtuarNaEtapa5: boolean,
  podeAtuarNaEtapa6 = false,
): MotivoSomenteConsulta | null {
  if (processo.contratoGerado !== null) return 'encerrado';
  if (etapa < processo.etapaAtual) return 'concluida';
  if (etapa > processo.etapaAtual) return 'futura';
  if (podeEditar || (etapa === 5 && podeAtuarNaEtapa5) || (etapa === 6 && podeAtuarNaEtapa6)) return null;
  return 'sem_permissao';
}

interface PropsConteudo {
  processo: DadosProcesso;
  etapa: EtapaJornada;
  endereco: (etapa: EtapaJornada) => string;
  falha: FalhaAvanco | null;
  aoFecharFalha: () => void;
  focoPainel: number;
}

function ConteudoProcesso({ processo, etapa, endereco, falha, aoFecharFalha, focoPainel }: PropsConteudo) {
  const { temPermissao, usuario } = useSessao();
  const { ativo: modoEspecificacao } = useModoEspecificacao();
  const tituloPainel = useRef<HTMLHeadingElement>(null);
  const encerrado = processo.contratoGerado !== null;
  const podeEditar = temPermissao('jornada:editar');
  const atual = etapa === processo.etapaAtual && !encerrado;
  // Na etapa 6, a autoridade competente designada decide recursos, adjudica e homologa (jornada:homologar).
  const autoridadeDesignada = processo.equipe.some((e) => e.papel === 'autoridade_competente' && e.usuario.id === usuario?.id);
  const motivo = motivoConsulta(
    processo,
    etapa,
    podeEditar,
    temPermissao(['jornada:aprovar_juridico', 'jornada:publicar']),
    temPermissao('jornada:homologar') && autoridadeDesignada,
  );
  const Painel = PAINEIS[etapa];
  const situacao = encerrado || etapa < processo.etapaAtual ? 'Concluída' : etapa === processo.etapaAtual ? 'Etapa atual' : 'Não iniciada';

  useEffect(() => {
    if (focoPainel === 0) return;
    const quadro = window.requestAnimationFrame(() => tituloPainel.current?.focus());
    return () => window.cancelAnimationFrame(quadro);
  }, [focoPainel]);

  return (
    <div className="pilha pilha--ampla jornada-processo">
      {falha ? <ResultadoAvanco falha={falha} aoFechar={aoFecharFalha} /> : null}
      <section className="cartao" aria-label="Dados do processo">
        <ListaDefinicoes
          itens={[
            { termo: 'Processo SEI', valor: <BotaoCopiar valor={processo.numeroSei} rotulo="número do processo SEI" /> },
            {
              termo: 'Órgão requisitante',
              valor: (
                <>
                  {ORGAOS[processo.orgao].nome} <span className="texto-secundario">({processo.orgao})</span>
                </>
              ),
            },
            { termo: 'Responsável', valor: processo.responsavel?.nome ?? 'Sem responsável designado' },
            {
              termo: 'Valor estimado',
              valor:
                processo.valorEstimado !== null ? (
                  <span className="numero">
                    {formatarMoeda(processo.valorEstimado)}
                    {processo.cestaPrecos.orcamentoSigiloso ? ' (sigiloso — art. 24)' : ''}
                  </span>
                ) : (
                  'Definido após a pesquisa de preços'
                ),
            },
            { termo: 'Modalidade prevista', valor: processo.modalidadePrevista ?? 'A definir' },
            { termo: 'Atualizado em', valor: <span className="numero">{formatarInstante(processo.atualizadoEm)}</span> },
          ]}
        />
      </section>

      <TrilhaEtapas etapaAtual={processo.etapaAtual} selecionada={etapa} bloqueios={processo.bloqueios} encerrado={encerrado} endereco={endereco} />

      <div className="detalhe-grade jornada-grade">
        <section className="cartao jornada-painel" aria-labelledby="jornada-painel-titulo">
          <div className="jornada-painel__cabecalho">
            <div>
              <p className="jornada-painel__sobretitulo">
                Etapa {etapa} de {TOTAL_ETAPAS}
              </p>
              <h2 id="jornada-painel-titulo" ref={tituloPainel} tabIndex={-1} className="jornada-painel__titulo">
                {tituloEtapa(etapa)}
              </h2>
            </div>
            <Etiqueta tom={situacao === 'Concluída' ? 'sucesso' : situacao === 'Etapa atual' ? 'info' : 'neutro'}>{situacao}</Etiqueta>
          </div>
          {motivo ? <AvisoSomenteConsulta motivo={motivo} /> : null}
          {modoEspecificacao ? (
            <Suspense
              fallback={
                <div className="painel-regras" aria-busy="true">
                  <EsqueletoTexto linhas={4} />
                </div>
              }
            >
              <RegrasEtapa etapa={etapa} />
            </Suspense>
          ) : null}
          <Suspense
            fallback={
              <Carregando rotulo={`Carregando a etapa ${etapa}`}>
                <EsqueletoTexto linhas={8} />
              </Carregando>
            }
          >
            <Painel key={`${processo.id}-${etapa}`} processo={processo} atual={atual} editavel={atual && podeEditar} />
          </Suspense>
        </section>
        <div className="detalhe-grade__lateral">
          <ArvoreSei
            processo={processo}
            podeAssinar={(doc) => {
              if (encerrado) return false;
              const tipo = processo.documentos.find((d) => d.numeroSei === doc.numero)?.tipo;
              return temPermissao(tipo === 'parecer_checklist' ? 'jornada:aprovar_juridico' : 'jornada:editar');
            }}
          />
          <ListaBloqueios processo={processo} />
          <ListaSinais processo={processo} />
        </div>
      </div>
    </div>
  );
}

export default function ProcessoDetalhe() {
  const { id = '' } = useParams();
  const consulta = useProcesso(id);
  const processo = consulta.data;
  const [params, definirParams] = useSearchParams();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const cliente = useQueryClient();
  const avancar = useAvancarEtapa(id);
  const [confirmandoAvanco, definirConfirmandoAvanco] = useState(false);
  const [falha, definirFalha] = useState<FalhaAvanco | null>(null);
  const [focoPainel, definirFocoPainel] = useState(0);
  const botaoImprimir = useRef<HTMLButtonElement>(null);

  const dossie = params.get('visao') === 'dossie';
  const etapaUrl = Number(params.get('etapa'));
  const etapa: EtapaJornada | null = processo ? (ehEtapa(etapaUrl) ? etapaUrl : processo.etapaAtual) : null;
  const encerrado = processo !== undefined && processo.contratoGerado !== null;
  const podeAvancar = processo !== undefined && !encerrado && processo.etapaAtual < TOTAL_ETAPAS && temPermissao('jornada:editar');
  const proxima = processo && processo.etapaAtual < TOTAL_ETAPAS ? processo.etapaAtual + 1 : null;

  useEffect(() => {
    if (dossie && processo) botaoImprimir.current?.focus();
  }, [dossie, processo]);

  const endereco = (alvo: EtapaJornada) => {
    const novo = new URLSearchParams(params);
    novo.delete('visao');
    if (processo && alvo === processo.etapaAtual) novo.delete('etapa');
    else novo.set('etapa', String(alvo));
    const texto = novo.toString();
    return texto ? `?${texto}` : '?';
  };

  const confirmarAvanco = () => {
    if (!processo) return;
    const etapaOrigem = processo.etapaAtual;
    avancar.mutate(undefined, {
      onSuccess: (atualizado) => {
        definirConfirmandoAvanco(false);
        definirFalha(null);
        definirParams(
          (anterior) => {
            const novo = new URLSearchParams(anterior);
            novo.delete('etapa');
            return novo;
          },
          { replace: true },
        );
        avisar({
          tipo: 'sucesso',
          titulo: 'Etapa concluída',
          mensagem: `O processo avançou para a etapa ${atualizado.etapaAtual} — ${tituloEtapa(atualizado.etapaAtual)}.`,
        });
        definirFocoPainel((n) => n + 1);
      },
      onError: (erro) => {
        const regras = regrasBloqueantes(erro);
        if (regras === null) return;
        definirConfirmandoAvanco(false);
        definirFalha({
          etapa: etapaOrigem,
          mensagem: erro instanceof ErroApi ? erro.mensagem : 'A operação não atende a uma regra de negócio.',
          regras,
          idRequisicao: erro instanceof ErroApi ? erro.idRequisicao : null,
        });
        void cliente.invalidateQueries({ queryKey: chaveProcesso(id) });
      },
    });
  };

  const titulo = processo ? (dossie ? `Dossiê — ${processo.titulo}` : processo.titulo) : 'Processo';

  return (
    <Pagina
      titulo={titulo}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Jornada da contratação', para: '/jornada' },
      ]}
      tela={dossie ? undefined : 'jornada.detalhe'}
      subtitulo={
        processo ? (
          <span className="linha">
            <span className="mono">{processo.numeroSei}</span>
            <span aria-hidden="true">·</span>
            <span>{ORGAOS[processo.orgao].nome}</span>
          </span>
        ) : undefined
      }
      marcadores={
        processo && !dossie ? (
          <>
            {encerrado ? (
              <Etiqueta tom="sucesso">Contrato gerado</Etiqueta>
            ) : (
              <Etiqueta tom="info">
                Etapa {processo.etapaAtual} de {TOTAL_ETAPAS}
              </Etiqueta>
            )}
            {!encerrado && processo.bloqueios > 0 ? <Etiqueta tom="erro">{contar(processo.bloqueios, 'bloqueio', 'bloqueios')}</Etiqueta> : null}
          </>
        ) : null
      }
      acoes={
        processo ? (
          dossie ? (
            <>
              <LinkBotao to={`/jornada/${encodeURIComponent(processo.id)}`} icone={ArrowLeft}>
                Voltar ao processo
              </LinkBotao>
              <Botao ref={botaoImprimir} variante="primario" icone={Printer} onClick={() => window.print()}>
                Imprimir ou salvar em PDF
              </Botao>
            </>
          ) : (
            <>
              <LinkBotao to="?visao=dossie" icone={Printer}>
                Exportar dossiê
              </LinkBotao>
              {temPermissao('documentos:ler') ? (
                <LinkBotao to={`/jornada/${encodeURIComponent(processo.id)}/documentos`} icone={FileStack}>
                  Documentos e habilitação
                </LinkBotao>
              ) : null}
              <LinkBotao to={`/jornada/${encodeURIComponent(processo.id)}/conferencia`} icone={GitCompareArrows}>
                Conferir documentos
              </LinkBotao>
              {podeAvancar && proxima ? (
                <Botao
                  variante="avanco"
                  iconeFim={ArrowRight}
                  onClick={() => {
                    avancar.reset();
                    definirConfirmandoAvanco(true);
                  }}
                >
                  Avançar para a etapa {proxima}
                </Botao>
              ) : null}
            </>
          )
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoProcesso />}
        rotuloCarregando="Carregando o processo"
        naoEncontrado={{
          titulo: 'Processo não encontrado',
          descricao: 'O processo não existe ou está fora das UASGs do seu escopo.',
          acao: (
            <LinkBotao to="/jornada" variante="primario">
              Voltar para a jornada
            </LinkBotao>
          ),
        }}
      >
        {(dados) =>
          dossie ? (
            <Suspense
              fallback={
                <Carregando rotulo="Montando o dossiê">
                  <EsqueletoTexto linhas={12} />
                </Carregando>
              }
            >
              <Dossie processo={dados} />
            </Suspense>
          ) : (
            <ConteudoProcesso
              processo={dados}
              etapa={etapa ?? dados.etapaAtual}
              endereco={endereco}
              falha={falha}
              aoFecharFalha={() => definirFalha(null)}
              focoPainel={focoPainel}
            />
          )
        }
      </ConteudoConsulta>

      {processo && proxima ? (
        <ConfirmarAcao
          aberto={confirmandoAvanco}
          aoFechar={() => definirConfirmandoAvanco(false)}
          titulo={`Avançar para a etapa ${proxima} — ${tituloEtapa(proxima)}`}
          largura="media"
          variante="avanco"
          descricao={
            <p>
              O servidor verifica todas as regras da etapa {processo.etapaAtual} — {tituloEtapa(processo.etapaAtual)}. Se alguma não for atendida,
              o processo permanece na etapa atual e as regras são listadas.
            </p>
          }
          rotuloConfirmar="Avançar etapa"
          aoConfirmar={confirmarAvanco}
          processando={avancar.isPending}
          erro={regrasBloqueantes(avancar.error) === null ? avancar.error : null}
        >
          {processo.bloqueios > 0 ? (
            <Alerta tipo="aviso" compacto titulo={`${contar(processo.bloqueios, 'bloqueio registrado', 'bloqueios registrados')} na etapa atual`}>
              <p>Confirme para que o servidor verifique novamente, ou resolva os bloqueios antes de avançar.</p>
            </Alerta>
          ) : null}
        </ConfirmarAcao>
      ) : null}
    </Pagina>
  );
}
