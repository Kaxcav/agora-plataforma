import { useState } from 'react';
import { CircleCheck, CircleX, Database, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import type { FonteDados, Sincronizacao } from '@agora/contratos';
import { useExecutarSincronizacao, useSincronizacoes } from '../../api/admin';
import {
  Alerta,
  Botao,
  ConfirmarAcao,
  ConteudoConsulta,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  Indicador,
  NOMES_FONTES,
  Pagina,
  Secao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { abreviarHash, contar, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';

const SITUACOES: Record<Sincronizacao['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  ok: { rotulo: 'Concluída', tom: 'sucesso' },
  executando: { rotulo: 'Executando…', tom: 'info' },
  falhou: { rotulo: 'Falhou', tom: 'erro' },
  nunca_executado: { rotulo: 'Nunca executada', tom: 'neutro' },
};

function Instante({ valor, vazio }: { valor: string | null; vazio: string }) {
  return valor ? (
    <time dateTime={valor} className="numero">
      {formatarInstante(valor)}
    </time>
  ) : (
    <span className="texto-secundario">{vazio}</span>
  );
}

const COLUNAS: ColunaTabela<Sincronizacao>[] = [
  {
    id: 'conjunto',
    cabecalho: 'Fonte e conjunto',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (s) => `${NOMES_FONTES[s.fonte]} ${s.conjunto}`,
    celula: (s) => (
      <span className="pilha pilha--compacta">
        <span>{s.conjunto}</span>
        <span className="texto-pequeno texto-secundario">{NOMES_FONTES[s.fonte]}</span>
      </span>
    ),
  },
  {
    id: 'modo',
    cabecalho: 'Modo',
    celula: (s) =>
      s.modo === 'online' ? (
        <Etiqueta tom="info" compacta>
          Online
        </Etiqueta>
      ) : (
        <Etiqueta tom="neutro" compacta>
          Offline (dados sintéticos)
        </Etiqueta>
      ),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (s) => SITUACOES[s.situacao].rotulo,
    celula: (s) => (
      <Etiqueta tom={SITUACOES[s.situacao].tom} icone={s.situacao === 'executando' ? LoaderCircle : undefined} compacta>
        {SITUACOES[s.situacao].rotulo}
      </Etiqueta>
    ),
  },
  {
    id: 'ultimaExecucao',
    cabecalho: 'Última execução',
    ordenavel: true,
    valorOrdenacao: (s) => s.ultimaExecucaoEm,
    celula: (s) => <Instante valor={s.ultimaExecucaoEm} vazio="Nunca executada" />,
  },
  {
    id: 'ultimoSucesso',
    cabecalho: 'Último sucesso',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (s) => s.ultimoSucessoEm,
    celula: (s) => <Instante valor={s.ultimoSucessoEm} vazio="Sem sucesso registrado" />,
  },
  {
    id: 'registros',
    cabecalho: 'Registros processados',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (s) => s.registrosProcessados,
    celula: (s) => <span className="numero">{formatarNumero(s.registrosProcessados)}</span>,
  },
  {
    id: 'mensagem',
    cabecalho: 'Mensagem',
    larguraMinima: '14rem',
    celula: (s) => (s.mensagem ? <TextoLongo texto={s.mensagem} /> : <span className="texto-secundario">—</span>),
  },
  {
    id: 'hash',
    cabecalho: 'Hash do conteúdo (SHA-256)',
    ocultaPorPadrao: true,
    celula: (s) =>
      s.hashConteudo ? (
        <code title={s.hashConteudo}>
          <span aria-hidden="true">{abreviarHash(s.hashConteudo)}</span>
          <span className="sr-only">{s.hashConteudo}</span>
        </code>
      ) : (
        <span className="texto-secundario">—</span>
      ),
  },
];

function fontesDistintas(sincronizacoes: readonly Sincronizacao[]): FonteDados[] {
  const fontes: FonteDados[] = [];
  for (const s of sincronizacoes) if (!fontes.includes(s.fonte)) fontes.push(s.fonte);
  return fontes;
}

export default function Integracoes() {
  const consulta = useSincronizacoes();
  const executar = useExecutarSincronizacao();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const podeExecutar = temPermissao('integracoes:executar');
  const [alvo, definirAlvo] = useState<FonteDados | null>(null);

  const confirmar = () => {
    if (!alvo) return;
    const fonte = alvo;
    executar.mutate(fonte, {
      onSuccess: (resultado) => {
        definirAlvo(null);
        const nome = NOMES_FONTES[fonte];
        if (resultado.situacao === 'falhou') {
          avisar({ tipo: 'erro', titulo: `Sincronização com ${nome} falhou`, mensagem: resultado.mensagem ?? 'Consulte os detalhes na tabela.' });
        } else if (resultado.situacao === 'executando') {
          avisar({ tipo: 'info', mensagem: `Sincronização com ${nome} iniciada. A situação é atualizada automaticamente.` });
        } else {
          avisar({
            tipo: 'sucesso',
            mensagem: `Sincronização com ${nome} concluída: ${contar(resultado.registrosProcessados, 'registro processado', 'registros processados')}.`,
          });
        }
      },
    });
  };

  return (
    <Pagina
      titulo="Integrações"
      subtitulo="Sincronizações com PNCP, Compras.gov.br, Contratos.gov.br e SIAFI, com proveniência de cada conjunto de dados."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Administração' }]}
      tela="admin"
    >
      <Alerta tipo="info" titulo="Soberania dos dados (RNF-01)">
        <p>
          As sincronizações rodam no servidor da Ágora, na infraestrutura do órgão. O navegador nunca chama APIs externas: cada execução registra
          a fonte, o horário, a quantidade de registros e o hash SHA-256 do conteúdo recebido, além de um evento na trilha de auditoria.
        </p>
      </Alerta>
      {podeExecutar ? null : (
        <Alerta tipo="info" compacto titulo="Consulta somente leitura">
          <p>Somente perfis com permissão para executar integrações (administrador e financeiro) podem disparar sincronizações.</p>
        </Alerta>
      )}
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela colunas={6} />} rotuloCarregando="Carregando sincronizações">
        {(sincronizacoes) => {
          if (sincronizacoes.length === 0) {
            return <EstadoVazio icone={Database} titulo="Nenhuma integração configurada" descricao="Os conjuntos sincronizados aparecerão aqui." />;
          }
          const ordenadas = [...sincronizacoes].sort(
            (a, b) => NOMES_FONTES[a.fonte].localeCompare(NOMES_FONTES[b.fonte], 'pt-BR') || a.conjunto.localeCompare(b.conjunto, 'pt-BR'),
          );
          const ok = sincronizacoes.filter((s) => s.situacao === 'ok').length;
          const falhas = sincronizacoes.filter((s) => s.situacao === 'falhou').length;
          const emExecucao = sincronizacoes.filter((s) => s.situacao === 'executando').length;
          return (
            <div className="pilha pilha--ampla">
              <div className="grade grade--kpi">
                <Indicador rotulo="Conjuntos sincronizados" icone={CircleCheck} tom="sucesso" valor={`${formatarNumero(ok)} de ${formatarNumero(sincronizacoes.length)}`} />
                <Indicador rotulo="Com falha" icone={CircleX} tom={falhas > 0 ? 'erro' : 'neutro'} valor={formatarNumero(falhas)} />
                <Indicador rotulo="Em execução" icone={RefreshCw} tom={emExecucao > 0 ? 'info' : 'neutro'} valor={formatarNumero(emExecucao)} />
              </div>
              {podeExecutar ? (
                <Secao
                  titulo="Executar sincronização"
                  id="executar-sincronizacao"
                  descricao="Executa agora todos os conjuntos da fonte escolhida. Fora disso, as sincronizações seguem o agendamento do servidor."
                >
                  <div className="botoes-fontes">
                    {fontesDistintas(ordenadas).map((fonte) => (
                      <Botao
                        key={fonte}
                        variante="secundario"
                        icone={Play}
                        carregando={executar.isPending && executar.variables === fonte}
                        disabled={executar.isPending}
                        onClick={() => {
                          executar.reset();
                          definirAlvo(fonte);
                        }}
                      >
                        Executar agora — {NOMES_FONTES[fonte]}
                      </Botao>
                    ))}
                  </div>
                </Secao>
              ) : null}
              <Tabela
                id="admin-integracoes"
                legenda="Situação das sincronizações por fonte e conjunto"
                colunas={COLUNAS}
                linhas={ordenadas}
                chave={(s) => `${s.fonte}-${s.conjunto}`}
                atualizando={consulta.isFetching}
                destaque={(s) => (s.situacao === 'falhou' ? 'erro' : s.situacao === 'nunca_executado' ? 'aviso' : undefined)}
                vazio={<EstadoVazio icone={Database} titulo="Nenhuma sincronização registrada" />}
              />
            </div>
          );
        }}
      </ConteudoConsulta>
      {podeExecutar ? (
        <ConfirmarAcao
          aberto={alvo !== null}
          aoFechar={() => definirAlvo(null)}
          titulo="Executar sincronização"
          descricao={
            <>
              <p>
                Executar agora a sincronização com <strong>{alvo ? NOMES_FONTES[alvo] : ''}</strong>?
              </p>
              <p>
                A coleta é feita pelo servidor da Ágora (o navegador não acessa o sistema externo). Dados editados por usuários não são
                sobrescritos, e a execução fica registrada com proveniência e na trilha de auditoria.
              </p>
            </>
          }
          rotuloConfirmar="Executar agora"
          aoConfirmar={confirmar}
          processando={executar.isPending}
          erro={executar.error}
        />
      ) : null}
    </Pagina>
  );
}
