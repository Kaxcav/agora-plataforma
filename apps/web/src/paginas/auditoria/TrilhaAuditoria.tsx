import { useMemo, useState } from 'react';
import { Check, Copy, History, ShieldCheck } from 'lucide-react';
import type { EventoAuditoria } from '@agora/contratos';
import { useAuditoria, useVerificacaoAuditoria, type FiltroAuditoria } from '../../api/auditoria';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import {
  Alerta,
  BarraFiltros,
  Botao,
  CampoBusca,
  CampoTexto,
  EstadoVazio,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { abreviarHash, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { AncoragemTrilha } from './AncoragemTrilha';

const FILTROS = ['busca', 'acao', 'recurso', 'usuario', 'de', 'ate'] as const;

/** Hash abreviado + botão compacto de copiar o valor completo. */
function HashEvento({ evento }: { evento: EventoAuditoria }) {
  const { avisar } = useAvisos();
  const [copiado, definirCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(evento.hash);
      definirCopiado(true);
      avisar({ tipo: 'info', mensagem: `Hash do evento ${evento.sequencia} copiado.`, duracao: 3500 });
      window.setTimeout(() => definirCopiado(false), 2000);
    } catch {
      avisar({ tipo: 'erro', mensagem: 'Não foi possível copiar o hash. Selecione o texto e copie manualmente.' });
    }
  };
  return (
    <span className="hash-evento">
      <code title={evento.hash}>{abreviarHash(evento.hash)}</code>
      <button
        type="button"
        className="hash-evento__copiar"
        onClick={() => void copiar()}
        aria-label={`Copiar hash completo do evento ${evento.sequencia}`}
        title="Copiar hash completo"
      >
        {copiado ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </span>
  );
}

const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehUuid(valor: string | undefined): boolean {
  return valor !== undefined && PADRAO_UUID.test(valor);
}

const COLUNAS: ColunaTabela<EventoAuditoria>[] = [
  {
    id: 'sequencia',
    cabecalho: 'Sequência',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (e) => e.sequencia,
    celula: (e) => <span className="numero">#{formatarNumero(e.sequencia)}</span>,
  },
  {
    id: 'ocorridoEm',
    cabecalho: 'Ocorrido em',
    ordenavel: true,
    valorOrdenacao: (e) => e.ocorridoEm,
    prioritaria: true,
    celula: (e) => (
      <time dateTime={e.ocorridoEm} className="numero sem-quebra">
        {formatarInstante(e.ocorridoEm)}
      </time>
    ),
  },
  {
    id: 'usuario',
    cabecalho: 'Usuário',
    prioritaria: true,
    celula: (e) => e.usuario?.nome ?? <span className="texto-secundario">Sistema (integração)</span>,
  },
  {
    id: 'acao',
    cabecalho: 'Ação',
    ordenavel: true,
    valorOrdenacao: (e) => e.acao,
    prioritaria: true,
    celula: (e) => <code>{e.acao}</code>,
  },
  {
    id: 'recurso',
    cabecalho: 'Recurso',
    celula: (e) => (
      <span className="pilha pilha--compacta">
        <span>{e.recurso}</span>
        {e.recursoId ? (
          <span className="texto-pequeno texto-secundario mono" title={e.recursoId}>
            {abreviarHash(e.recursoId, 8, 4)}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'resumo',
    cabecalho: 'Resumo',
    larguraMinima: '16rem',
    prioritaria: true,
    celula: (e) => <TextoLongo texto={e.resumo} />,
  },
  {
    id: 'hash',
    cabecalho: 'Hash (SHA-256)',
    celula: (e) => <HashEvento evento={e} />,
  },
  {
    id: 'hashAnterior',
    cabecalho: 'Hash anterior',
    ocultaPorPadrao: true,
    celula: (e) => <code title={e.hashAnterior}>{abreviarHash(e.hashAnterior)}</code>,
  },
];

function ResultadoVerificacao({ solicitada }: { solicitada: number }) {
  const consulta = useVerificacaoAuditoria(solicitada > 0);
  if (solicitada === 0) return null;
  if (consulta.isFetching && consulta.data === undefined) {
    return (
      <Alerta tipo="info" anunciar>
        Verificando a cadeia de eventos… a verificação recalcula todos os hashes e pode levar alguns segundos.
      </Alerta>
    );
  }
  if (consulta.isError) {
    const id = consulta.error instanceof ErroApi ? consulta.error.idRequisicao : null;
    return (
      <Alerta tipo="erro" anunciar titulo="Não foi possível verificar a cadeia">
        <p>{mensagemDeErro(consulta.error)}</p>
        {id ? (
          <p className="texto-pequeno">
            Código para o suporte: <code>{id}</code>
          </p>
        ) : null}
      </Alerta>
    );
  }
  const v = consulta.data;
  if (!v) return null;
  if (v.integra) {
    return (
      <Alerta tipo="sucesso" anunciar titulo="Cadeia íntegra">
        <p>
          {formatarNumero(v.eventosVerificados)} eventos verificados em {formatarInstante(v.verificadoEm)}. Nenhum evento foi alterado ou
          removido.
        </p>
      </Alerta>
    );
  }
  return (
    <Alerta tipo="erro" anunciar titulo="Cadeia de auditoria rompida">
      <p>
        {formatarNumero(v.eventosVerificados)} eventos verificados em {formatarInstante(v.verificadoEm)}.
        {v.primeiraFalha ? (
          <>
            {' '}
            Primeira falha no evento <strong>#{formatarNumero(v.primeiraFalha.sequencia)}</strong>: {v.primeiraFalha.motivo}
          </>
        ) : null}
      </p>
      <p>Preserve as evidências e acione a equipe de segurança da informação do órgão.</p>
    </Alerta>
  );
}

export default function TrilhaAuditoria() {
  const p = useParametrosUrl();
  const [solicitada, definirSolicitada] = useState(0);
  const verificacao = useVerificacaoAuditoria(solicitada > 0);
  const filtro: FiltroAuditoria = {
    busca: p.texto('busca'),
    acao: p.texto('acao'),
    recurso: p.texto('recurso'),
    usuario: ehUuid(p.texto('usuario')) ? p.texto('usuario') : undefined,
    de: p.texto('de'),
    ate: p.texto('ate'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useAuditoria(filtro);
  const nomeUsuarioFiltrado = consulta.data?.itens.find((e) => e.usuario?.id === filtro.usuario)?.usuario?.nome;
  const { atualizar } = p;
  const colunas = useMemo(
    () =>
      COLUNAS.map((c) =>
        c.id === 'usuario'
          ? {
              ...c,
              celula: (e: EventoAuditoria) =>
                e.usuario ? (
                  <button
                    type="button"
                    className="texto-longo__alternar"
                    title="Filtrar a trilha por este usuário"
                    onClick={() => atualizar({ usuario: e.usuario?.id })}
                  >
                    {e.usuario.nome}
                    <span className="sr-only"> — filtrar a trilha por este usuário</span>
                  </button>
                ) : (
                  <span className="texto-secundario">Sistema (integração)</span>
                ),
            }
          : c,
      ),
    [atualizar],
  );
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  const verificar = () => {
    if (solicitada > 0) void verificacao.refetch();
    definirSolicitada((n) => n + 1);
  };

  return (
    <Pagina
      titulo="Trilha de auditoria"
      subtitulo="Registro imutável de todas as escritas, acessos e sincronizações, encadeado por hash."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="auditoria"
      acoes={
        <Botao variante="secundario" icone={ShieldCheck} onClick={verificar} carregando={verificacao.isFetching}>
          Verificar integridade da cadeia
        </Botao>
      }
    >
      <p className="texto-secundario">
        Cada evento guarda o hash SHA-256 do evento anterior; alterar ou excluir qualquer registro rompe a cadeia a partir dali (RNF-03). A
        verificação recalcula a cadeia inteira no servidor e aponta o primeiro evento divergente.
      </p>
      <ResultadoVerificacao solicitada={solicitada} />
      <AncoragemTrilha />

      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <div className="pilha trilha-auditoria">
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['evento', 'eventos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros da trilha de auditoria"
          >
            <CampoBusca rotulo="Buscar no resumo" placeholder="Ex.: resolveu pendência" valor={filtro.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
            <CampoBusca rotulo="Ação" placeholder="Ex.: pendencia.resolver" valor={filtro.acao ?? ''} aoMudar={(v) => p.atualizar({ acao: v })} />
            <CampoBusca rotulo="Recurso" placeholder="Ex.: contrato" valor={filtro.recurso ?? ''} aoMudar={(v) => p.atualizar({ recurso: v })} />
            <CampoTexto rotulo="De" type="date" value={filtro.de ?? ''} max={filtro.ate} onChange={(e) => p.atualizar({ de: e.target.value })} />
            <CampoTexto rotulo="Até" type="date" value={filtro.ate ?? ''} min={filtro.de} onChange={(e) => p.atualizar({ ate: e.target.value })} />
          </BarraFiltros>

          {filtro.usuario ? (
            <Alerta tipo="info" compacto acoes={<Botao variante="terciario" tamanho="compacto" onClick={() => p.atualizar({ usuario: undefined })}>Remover filtro de usuário</Botao>}>
              Exibindo apenas os eventos de <strong>{nomeUsuarioFiltrado ?? 'um usuário específico'}</strong>.
            </Alerta>
          ) : null}

          <Tabela
            id="auditoria"
            legenda="Eventos da trilha de auditoria"
            colunas={colunas}
            linhas={consulta.data?.itens}
            chave={(e) => e.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            vazio={
              <EstadoVazio
                icone={History}
                titulo={filtrosAtivos ? 'Nenhum evento atende aos filtros' : 'Nenhum evento registrado'}
                descricao={
                  filtrosAtivos ? 'Revise os critérios ou limpe os filtros para ver toda a trilha.' : 'Os eventos aparecem aqui a partir do primeiro acesso.'
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
                  rotulo="Paginação da trilha de auditoria"
                />
              ) : null
            }
          />
        </div>
      )}
    </Pagina>
  );
}
