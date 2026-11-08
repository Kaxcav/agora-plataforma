import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BellRing, RefreshCw, Send } from 'lucide-react';
import type {
  EnvioNotificacao,
  FaixaVencimento,
  FiltroNotificacoes,
  NotificacaoDetalhe,
  NotificacaoResumo,
  PreferenciaNotificacao,
  TipoNotificacao,
} from '@agora/contratos';
import {
  useEstadoNotificacoes,
  useExecutarVarredura,
  useNotificacao,
  useNotificacoes,
  usePreferenciasNotificacao,
  useReenviarEnvio,
  useSalvarPreferencias,
} from '../../api/notificacoes';
import { mensagemDeErro } from '../../api/cliente';
import {
  Abas,
  Alerta,
  BarraFiltros,
  Botao,
  CaixaSelecao,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EsqueletoTexto,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  ListaDefinicoes,
  Pagina,
  Paginacao,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { chavesDe, opcoesDe } from '../compartilhado/rotulos';
import {
  CANAIS_CURTOS,
  FAIXAS_VENCIMENTO,
  MODOS_CANAL,
  ORIGENS_NOTIFICACAO,
  PAPEIS_DESTINATARIO,
  SITUACOES_ENVIO,
  TIPOS_NOTIFICACAO,
} from './rotulos';
import '../../design/paginas-notificacoes.css';

const FILTROS = ['tipo', 'origem', 'situacao', 'faixa', 'minhas'] as const;
const FAIXAS = ['30', '60', '90', '120'] as const;

function Instante({ valor }: { valor: string | null }) {
  return valor ? (
    <time dateTime={valor} className="numero">
      {formatarInstante(valor)}
    </time>
  ) : (
    <span className="texto-secundario">—</span>
  );
}

function EtiquetaTipo({ n }: { n: Pick<NotificacaoResumo, 'tipo' | 'faixa' | 'obrigatoria'> }) {
  const def = TIPOS_NOTIFICACAO[n.tipo];
  return (
    <span className="notificacao-etiquetas">
      <Etiqueta tom={def.tom} compacta>
        {n.tipo === 'vencimento' && n.faixa !== null ? `${def.rotulo} · ${n.faixa} dias` : def.rotulo}
      </Etiqueta>
      {n.obrigatoria ? (
        <Etiqueta tom="neutro" icone={null} compacta titulo="Aviso legal obrigatório: chega mesmo com a preferência desligada">
          Obrigatório
        </Etiqueta>
      ) : null}
    </span>
  );
}

function ResumoEnvios({ n }: { n: NotificacaoResumo }) {
  const c = n.contagem;
  return (
    <span className="notificacao-etiquetas">
      {c.enviados > 0 ? (
        <Etiqueta tom="sucesso" compacta>
          {contar(c.enviados, 'enviado', 'enviados')}
        </Etiqueta>
      ) : null}
      {c.pendentes > 0 ? (
        <Etiqueta tom="info" compacta>
          {c.pendentes} na fila
        </Etiqueta>
      ) : null}
      {c.falhas > 0 ? (
        <Etiqueta tom="erro" compacta>
          {contar(c.falhas, 'falha', 'falhas')}
        </Etiqueta>
      ) : null}
      {c.suprimidos > 0 ? (
        <Etiqueta tom="neutro" compacta>
          {c.suprimidos} não enviado{c.suprimidos === 1 ? '' : 's'}
        </Etiqueta>
      ) : null}
      {c.total === 0 ? <span className="texto-secundario">Sem destinatário</span> : null}
    </span>
  );
}

function caminhoInstrumento(i: NotificacaoResumo['instrumento']): string {
  return `/${i.tipo === 'ata' ? 'atas' : 'contratos'}/${i.id}`;
}

// ───────────────────────── Detalhe: envios, situação e reenvio ─────────────────────────

function TabelaEnvios({ notificacao }: { notificacao: NotificacaoDetalhe }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const reenviar = useReenviarEnvio();
  const podeReenviar = temPermissao('notificacoes:enviar');
  const substituidos = new Set(notificacao.envios.flatMap((e) => (e.reenvioDe ? [e.reenvioDe] : [])));

  const colunas: ColunaTabela<EnvioNotificacao>[] = [
    {
      id: 'destinatario',
      cabecalho: 'Destinatário',
      identificadora: true,
      fixa: true,
      prioritaria: true,
      celula: (e) => (
        <span className="pilha pilha--compacta">
          <span>{e.destinatario}</span>
          <span className="texto-pequeno texto-secundario">{PAPEIS_DESTINATARIO[e.papel]}</span>
        </span>
      ),
    },
    {
      id: 'canal',
      cabecalho: 'Canal e endereço',
      prioritaria: true,
      celula: (e) => (
        <span className="pilha pilha--compacta">
          <span>{CANAIS_CURTOS[e.canal]}</span>
          {e.endereco ? <span className="texto-pequeno texto-secundario numero">{e.endereco}</span> : null}
        </span>
      ),
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      celula: (e) => (
        <span className="pilha pilha--compacta">
          <span className="notificacao-etiquetas">
            <Etiqueta tom={SITUACOES_ENVIO[e.situacao].tom} compacta>
              {SITUACOES_ENVIO[e.situacao].rotulo}
            </Etiqueta>
            {e.modo === 'simulado' ? (
              <Etiqueta tom="aviso" compacta titulo="Driver simulado: a mensagem foi registrada, mas não saiu do servidor">
                Simulado
              </Etiqueta>
            ) : null}
            {substituidos.has(e.id) ? (
              <Etiqueta tom="neutro" icone={null} compacta>
                Substituído por reenvio
              </Etiqueta>
            ) : null}
          </span>
          {e.situacao === 'suprimido' && e.motivoSupressao ? <span className="texto-pequeno texto-secundario">{e.motivoSupressao}</span> : null}
          {e.ultimoErro && e.situacao !== 'enviado' ? <span className="texto-pequeno notificacao-erro">{e.ultimoErro}</span> : null}
          {e.situacao === 'pendente' && e.proximaTentativaEm && e.tentativas > 0 ? (
            <span className="texto-pequeno texto-secundario">
              Nova tentativa em <Instante valor={e.proximaTentativaEm} />
            </span>
          ) : null}
          {e.protocolo ? <span className="texto-pequeno texto-secundario notificacao-protocolo">Protocolo: {e.protocolo}</span> : null}
        </span>
      ),
    },
    {
      id: 'tentativas',
      cabecalho: 'Tentativas',
      alinhamento: 'fim',
      celula: (e) => (
        <span className="numero">
          {e.tentativas} de {e.maxTentativas}
        </span>
      ),
    },
    { id: 'enviado', cabecalho: 'Enviado em', celula: (e) => <Instante valor={e.enviadoEm} /> },
  ];
  const basesLegais = [...new Set(notificacao.envios.map((e) => e.baseLegal))];

  return (
    <>
      <Tabela
        id="notificacao-envios"
        legenda="Envios do aviso"
        colunas={colunas}
        linhas={notificacao.envios}
        chave={(e) => e.id}
        semFerramentas
        destaque={(e) => (e.situacao === 'falhou' && !substituidos.has(e.id) ? 'erro' : undefined)}
        acoes={
          podeReenviar
            ? {
                cabecalho: 'Ações',
                celula: (e) =>
                  (e.situacao === 'falhou' || e.situacao === 'enviado') && !substituidos.has(e.id) ? (
                    <Botao
                      tamanho="compacto"
                      variante="secundario"
                      icone={Send}
                      carregando={reenviar.isPending && reenviar.variables === e.id}
                      aria-label={`Reenviar para ${e.destinatario} por ${CANAIS_CURTOS[e.canal]}`}
                      onClick={() =>
                        reenviar.mutate(e.id, {
                          onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Reenvio registrado', mensagem: `Novo envio para ${e.destinatario} por ${CANAIS_CURTOS[e.canal]}.` }),
                        })
                      }
                    >
                      Reenviar
                    </Botao>
                  ) : null,
              }
            : undefined
        }
      />
      {reenviar.isError ? (
        <Alerta tipo="erro" anunciar compacto>
          {mensagemDeErro(reenviar.error)}
        </Alerta>
      ) : null}
      {basesLegais.length > 0 ? (
        <div className="pilha pilha--compacta">
          <h3 className="texto-pequeno notificacao-subtitulo">Base legal do tratamento do contato (LGPD)</h3>
          <ul className="texto-pequeno texto-secundario notificacao-bases">
            {basesLegais.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function DialogoDetalhe({ id, aoFechar }: { id: string | null; aoFechar: () => void }) {
  const consulta = useNotificacao(id);
  return (
    <Dialogo aberto={id !== null} aoFechar={aoFechar} titulo="Envios do aviso" largura="ampla">
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando o aviso">
        {(n) => (
          <div className="pilha">
            <p className="notificacao-assunto">{n.assunto}</p>
            <ListaDefinicoes
              colunas={3}
              itens={[
                { termo: 'Tipo', valor: <EtiquetaTipo n={n} /> },
                { termo: 'Instrumento', valor: <Link to={caminhoInstrumento(n.instrumento)}>{n.instrumento.identificador}</Link> },
                {
                  termo: 'Origem',
                  valor: n.criadaPor ? `Manual — ${n.criadaPor.nome}` : 'Automática (varredura diária)',
                },
                { termo: 'Registrado em', valor: <Instante valor={n.criadaEm} /> },
                { termo: 'UASG', valor: <span className="numero">{n.uasg}</span> },
                { termo: 'Fundamento', valor: n.fundamento, largo: true },
              ]}
            />
            <details className="notificacao-corpo">
              <summary>Texto da mensagem</summary>
              <pre>{n.corpo}</pre>
            </details>
            <TabelaEnvios notificacao={n} />
          </div>
        )}
      </ConteudoConsulta>
    </Dialogo>
  );
}

// ───────────────────────── Canais e fila ─────────────────────────

function CanaisEFila() {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consulta = useEstadoNotificacoes();
  const varredura = useExecutarVarredura();
  const estado = consulta.data;
  return (
    <Secao
      id="canais"
      titulo="Canais e fila de envio"
      descricao="Os avisos saem do servidor da Ágora por uma fila com novas tentativas (1, 5, 15 e 60 minutos). O navegador não fala com os serviços de envio."
      acoes={
        temPermissao('notificacoes:administrar') ? (
          <Botao
            variante="secundario"
            icone={RefreshCw}
            carregando={varredura.isPending}
            onClick={() =>
              varredura.mutate(undefined, {
                onSuccess: (r) =>
                  avisar({
                    tipo: 'sucesso',
                    titulo: 'Varredura concluída',
                    mensagem: `${contar(r.notificacoesCriadas, 'aviso novo', 'avisos novos')}; ${contar(r.enviosProcessados, 'envio processado', 'envios processados')}.`,
                  }),
                onError: (erro) => avisar({ tipo: 'erro', titulo: 'Varredura não executada', mensagem: mensagemDeErro(erro) }),
              })
            }
          >
            Executar varredura agora
          </Botao>
        ) : null
      }
    >
      {consulta.isError ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar os canais" />
      ) : !estado ? (
        <div aria-busy="true">
          <EsqueletoTexto linhas={3} />
        </div>
      ) : (
        <ListaDefinicoes
          colunas={3}
          itens={[
            ...estado.canais.map((c) => ({
              termo: CANAIS_CURTOS[c.canal],
              valor: (
                <span className="pilha pilha--compacta notificacao-canal">
                  <Etiqueta tom={MODOS_CANAL[c.modo].tom} compacta>
                    {MODOS_CANAL[c.modo].rotulo}
                  </Etiqueta>
                  <span className="texto-pequeno texto-secundario">{c.descricao}</span>
                </span>
              ),
            })),
            {
              termo: 'Fila',
              valor: `${contar(estado.fila.pendentes, 'envio na fila', 'envios na fila')} · ${contar(estado.fila.falhas, 'falha', 'falhas')} · ${contar(
                estado.fila.enviadosHoje,
                'enviado hoje',
                'enviados hoje',
              )}`,
            },
            {
              termo: 'Última varredura diária',
              valor: estado.ultimaVarredura ? (
                <span>
                  <Instante valor={estado.ultimaVarredura.executadaEm} /> · {contar(estado.ultimaVarredura.notificacoesCriadas, 'aviso gerado', 'avisos gerados')}
                </span>
              ) : (
                'Ainda não executada'
              ),
            },
            {
              termo: 'Agendador',
              valor: estado.agendador === 'api' ? 'No servidor da Ágora (varredura diária e fila a cada minuto)' : 'Processo à parte no servidor',
            },
          ]}
        />
      )}
    </Secao>
  );
}

// ───────────────────────── Lista de avisos ─────────────────────────

function ListaAvisos() {
  const p = useParametrosUrl();
  const [aberta, definirAberta] = useState<string | null>(null);
  const faixa = p.opcao('faixa', FAIXAS);
  const filtro: FiltroNotificacoes = {
    tipo: p.opcao('tipo', chavesDe(TIPOS_NOTIFICACAO)),
    origem: p.opcao('origem', chavesDe(ORIGENS_NOTIFICACAO)),
    situacao: p.opcao('situacao', chavesDe(SITUACOES_ENVIO)),
    faixa: faixa === undefined ? undefined : (Number(faixa) as FaixaVencimento),
    minhas: p.booleano('minhas'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useNotificacoes(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  const colunas: ColunaTabela<NotificacaoResumo>[] = [
    {
      id: 'assunto',
      cabecalho: 'Aviso',
      identificadora: true,
      fixa: true,
      prioritaria: true,
      larguraMinima: '18rem',
      celula: (n) => (
        <button type="button" className="notificacao-abrir" onClick={() => definirAberta(n.id)}>
          {n.assunto}
        </button>
      ),
    },
    { id: 'tipo', cabecalho: 'Tipo', prioritaria: true, celula: (n) => <EtiquetaTipo n={n} /> },
    {
      id: 'instrumento',
      cabecalho: 'Instrumento',
      celula: (n) => (
        <span className="pilha pilha--compacta">
          <Link to={caminhoInstrumento(n.instrumento)}>{n.instrumento.identificador}</Link>
          <span className="texto-pequeno texto-secundario">
            UASG <span className="numero">{n.uasg}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'origem',
      cabecalho: 'Origem',
      celula: (n) => (n.criadaPor ? <span>Manual · {n.criadaPor.nome}</span> : <span>Automática</span>),
    },
    { id: 'envios', cabecalho: 'Envios', prioritaria: true, celula: (n) => <ResumoEnvios n={n} /> },
    { id: 'criada', cabecalho: 'Registrado em', celula: (n) => <Instante valor={n.criadaEm} /> },
  ];

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;
  return (
    <>
      <BarraFiltros total={consulta.data?.total} substantivo={['aviso', 'avisos']} filtrosAtivos={filtrosAtivos} aoLimpar={limpar} rotulo="Filtros de avisos">
        <Selecao rotulo="Tipo" opcaoVazia="Todos" opcoes={opcoesDe(TIPOS_NOTIFICACAO)} value={filtro.tipo ?? ''} onChange={(e) => p.atualizar({ tipo: e.target.value })} />
        <Selecao
          rotulo="Faixa de vencimento"
          opcaoVazia="Todas"
          opcoes={FAIXAS.map((f) => ({ valor: f, rotulo: FAIXAS_VENCIMENTO[f] }))}
          value={faixa ?? ''}
          onChange={(e) => p.atualizar({ faixa: e.target.value })}
        />
        <Selecao
          rotulo="Situação do envio"
          opcaoVazia="Todas"
          opcoes={opcoesDe(SITUACOES_ENVIO).filter((o) => o.valor !== 'enviando')}
          value={filtro.situacao ?? ''}
          onChange={(e) => p.atualizar({ situacao: e.target.value })}
        />
        <Selecao rotulo="Origem" opcaoVazia="Todas" opcoes={opcoesDe(ORIGENS_NOTIFICACAO)} value={filtro.origem ?? ''} onChange={(e) => p.atualizar({ origem: e.target.value })} />
        <CaixaSelecao rotulo="Só os destinados a mim" checked={filtro.minhas === true} onChange={(e) => p.atualizar({ minhas: e.target.checked ? 'true' : undefined })} />
      </BarraFiltros>
      <Tabela
        id="notificacoes"
        legenda="Avisos registrados"
        colunas={colunas}
        linhas={consulta.data?.itens}
        chave={(n) => n.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        destaque={(n) => (n.contagem.falhas > 0 ? 'erro' : n.contagem.pendentes > 0 ? 'aviso' : undefined)}
        acoes={{
          cabecalho: 'Ações',
          celula: (n) => (
            <Botao tamanho="compacto" variante="terciario" onClick={() => definirAberta(n.id)} aria-label={`Ver envios: ${n.assunto}`}>
              Ver envios
            </Botao>
          ),
        }}
        vazio={
          <EstadoVazio
            icone={BellRing}
            titulo={filtrosAtivos ? 'Nenhum aviso atende aos filtros' : 'Nenhum aviso registrado'}
            descricao={
              filtrosAtivos
                ? 'Revise os critérios ou limpe os filtros.'
                : 'Os avisos automáticos aparecem depois da varredura diária; os manuais, depois do botão "Notificar" no contrato ou na ata.'
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
              rotulo="Paginação dos avisos"
            />
          ) : null
        }
      />
      <DialogoDetalhe id={aberta} aoFechar={() => definirAberta(null)} />
    </>
  );
}

// ───────────────────────── Preferências ─────────────────────────

function Preferencias() {
  const consulta = usePreferenciasNotificacao();
  const salvar = useSalvarPreferencias();
  const { avisar } = useAvisos();
  const [rascunho, definirRascunho] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (consulta.data) definirRascunho(Object.fromEntries(consulta.data.map((p) => [`${p.tipo}:${p.canal}`, p.ativo])));
  }, [consulta.data]);

  const tipos = Object.keys(TIPOS_NOTIFICACAO) as TipoNotificacao[];
  const alterado = (consulta.data ?? []).some((p) => rascunho[`${p.tipo}:${p.canal}`] !== p.ativo);

  const gravar = () => {
    salvar.mutate(
      {
        preferencias: (consulta.data ?? []).map((p: PreferenciaNotificacao) => ({ tipo: p.tipo, canal: p.canal, ativo: rascunho[`${p.tipo}:${p.canal}`] ?? p.ativo })),
      },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Preferências salvas', mensagem: 'Os próximos avisos seguirão as suas escolhas.' }) },
    );
  };

  return (
    <Secao
      id="preferencias"
      titulo="Minhas preferências de notificação"
      descricao="Escolha os avisos que quer receber em seu nome. Os avisos legais obrigatórios chegam por e-mail mesmo desligados; o registro no processo SEI não depende de preferência."
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={5} colunas={3} />} rotuloCarregando="Carregando as preferências">
        {(preferencias) => (
          <div className="pilha">
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta notificacao-preferencias">
                <caption className="sr-only">Avisos recebidos por tipo e canal</caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo de aviso</th>
                    <th scope="col">E-mail institucional</th>
                    <th scope="col">gov.br</th>
                  </tr>
                </thead>
                <tbody>
                  {tipos.map((tipo) => {
                    const email = preferencias.find((p) => p.tipo === tipo && p.canal === 'email');
                    return (
                      <tr key={tipo}>
                        <th scope="row">
                          <span className="pilha pilha--compacta">
                            <span>{TIPOS_NOTIFICACAO[tipo].rotulo}</span>
                            {email?.obrigatorios ? <span className="texto-pequeno texto-secundario">{email.obrigatorios}</span> : null}
                          </span>
                        </th>
                        {(['email', 'govbr'] as const).map((canal) => (
                          <td key={canal}>
                            <CaixaSelecao
                              rotulo={<span className="sr-only">{`Receber avisos de ${TIPOS_NOTIFICACAO[tipo].rotulo.toLowerCase()} por ${canal === 'email' ? 'e-mail' : 'gov.br'}`}</span>}
                              checked={rascunho[`${tipo}:${canal}`] ?? false}
                              onChange={(e) => definirRascunho((r) => ({ ...r, [`${tipo}:${canal}`]: e.target.checked }))}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="texto-pequeno texto-secundario">
              O gov.br entrega na caixa postal do aplicativo gov.br do servidor, identificado pelo CPF cadastrado; fica desligado até você aderir.
            </p>
            <div className="linha">
              <Botao variante="primario" onClick={gravar} carregando={salvar.isPending} disabled={!alterado}>
                Salvar preferências
              </Botao>
            </div>
            {salvar.isError ? (
              <Alerta tipo="erro" anunciar compacto>
                {mensagemDeErro(salvar.error)}
              </Alerta>
            ) : null}
          </div>
        )}
      </ConteudoConsulta>
    </Secao>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function Notificacoes() {
  return (
    <Pagina
      titulo="Notificações"
      subtitulo="Avisos a gestores, fiscais e contratadas sobre vencimentos (30, 60, 90 e 120 dias), reajustes, garantias, pendências e ocorrências, com a situação de cada envio."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="notificacoes"
    >
      <CanaisEFila />
      <Abas
        rotulo="Central de notificações"
        abas={[
          { id: 'avisos', rotulo: 'Avisos', conteudo: () => <ListaAvisos /> },
          { id: 'preferencias', rotulo: 'Minhas preferências', conteudo: () => <Preferencias /> },
        ]}
      />
    </Pagina>
  );
}
