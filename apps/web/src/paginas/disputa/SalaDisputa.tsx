/**
 * `/jornada/:id/disputa` — sala de disputa do processo (RF-22): lista as sessões, cria uma nova (simulação ou
 * acompanhamento da sessão oficial) e abre a sala da sessão escolhida (`?sessao=`).
 */
import { useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { SessaoDisputa } from '@agora/contratos';
import { useSessaoDisputa, useSessoesDisputa } from '../../api/disputa';
import { useProcesso } from '../../api/jornada';
import { Alerta, Botao, ConteudoConsulta, Etiqueta, LinkBotao, Pagina, Secao } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { NovaSessao } from './NovaSessao';
import { PainelSessao } from './PainelSessao';
import { ROTULOS_CRITERIO, ROTULOS_FASE, ROTULOS_MODO, ROTULOS_USO, TOM_FASE } from './rotulos';
import '../../design/paginas-disputa.css';

function ListaSessoes({ processoId, aoAbrir }: { processoId: string; aoAbrir: (id: string) => void }) {
  const consulta = useSessoesDisputa(processoId);
  return (
    <Secao titulo="Sessões deste processo" id="sessoes">
      <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando as sessões">
        {(sessoes) =>
          sessoes.length === 0 ? (
            <p className="texto-secundario">Nenhuma sessão de disputa criada para este processo.</p>
          ) : (
            <div className="tabela-rolagem" role="region" aria-labelledby="legenda-sessoes" tabIndex={0}>
              <table className="tabela tabela--compacta">
                <caption id="legenda-sessoes" className="tabela__legenda">
                  Sessões de disputa
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Criada em</th>
                    <th scope="col">Uso</th>
                    <th scope="col">Critério e modo</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="tabela__alinhar--fim">
                      Lances
                    </th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessoes.map((s) => (
                    <tr key={s.id}>
                      <td>{formatarInstante(s.criadaEm)}</td>
                      <td>{ROTULOS_USO[s.uso]}</td>
                      <td>
                        {ROTULOS_CRITERIO[s.criterio]} · {ROTULOS_MODO[s.modo]}
                      </td>
                      <td>
                        <Etiqueta tom={TOM_FASE[s.fase]} compacta>
                          {ROTULOS_FASE[s.fase]}
                        </Etiqueta>
                      </td>
                      <td className="tabela__alinhar--fim numero">{s.lances}</td>
                      <td>
                        <Botao tamanho="compacto" aria-label={`Entrar na sessão criada em ${formatarInstante(s.criadaEm)}`} onClick={() => aoAbrir(s.id)}>
                          Entrar na sala
                        </Botao>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ConteudoConsulta>
    </Secao>
  );
}

function SalaDaSessao({ id }: { id: string }) {
  const consulta = useSessaoDisputa(id);
  return (
    <ConteudoConsulta
      consulta={consulta}
      rotuloCarregando="Carregando a sala de disputa"
      naoEncontrado={{ titulo: 'Sessão não encontrada', descricao: 'A sessão não existe ou está fora das UASGs do seu escopo.' }}
    >
      {(sessao: SessaoDisputa) => <PainelSessao sessao={sessao} recebidaEm={consulta.dataUpdatedAt} />}
    </ConteudoConsulta>
  );
}

export default function SalaDisputa() {
  const { id = '' } = useParams();
  const [parametros, definirParametros] = useSearchParams();
  const sessaoId = parametros.get('sessao');
  const processo = useProcesso(id);
  const { temPermissao } = useSessao();
  const dados = processo.data;
  const podeCriar = temPermissao('disputa:conduzir') && dados?.etapaAtual === 6;

  const abrirSessao = (novo: string | null) => {
    definirParametros(novo ? { sessao: novo } : {});
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('h1')?.focus());
  };

  return (
    <Pagina
      titulo="Sala de disputa"
      tituloDocumento={dados ? `Sala de disputa — ${dados.numeroSei}` : 'Sala de disputa'}
      subtitulo={dados ? `${dados.numeroSei} · ${dados.titulo}` : undefined}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Jornada da contratação', para: '/jornada' },
        { rotulo: dados ? `Processo ${dados.numeroSei}` : 'Processo', para: `/jornada/${id}?etapa=6` },
      ]}
      tela="jornada.disputa"
      acoes={
        sessaoId ? (
          <Botao icone={ArrowLeft} onClick={() => abrirSessao(null)}>
            Todas as sessões
          </Botao>
        ) : (
          <LinkBotao to={`/jornada/${id}?etapa=6`} icone={ArrowLeft}>
            Voltar ao processo
          </LinkBotao>
        )
      }
    >
      <div className="pilha pilha--ampla">
        <Alerta tipo="info" compacto>
          <p>
            Para a administração federal, a sessão pública oficial acontece no Compras.gov.br. Aqui você simula a sessão, para treino e prova de conceito,
            ou acompanha a sessão oficial com os dados abertos consultados pelo servidor da Ágora.
          </p>
        </Alerta>
        <ConteudoConsulta consulta={processo} rotuloCarregando="Carregando o processo" naoEncontrado={{ titulo: 'Processo não encontrado' }}>
          {(p) =>
            sessaoId ? (
              <SalaDaSessao key={sessaoId} id={sessaoId} />
            ) : (
              <>
                <ListaSessoes processoId={p.id} aoAbrir={abrirSessao} />
                {podeCriar ? (
                  <NovaSessao processo={p} aoCriar={(s) => abrirSessao(s.id)} />
                ) : (
                  <p className="texto-secundario">
                    {p.etapaAtual !== 6
                      ? `Novas sessões são criadas na etapa 6 (Seleção do fornecedor); o processo está na etapa ${p.etapaAtual}.`
                      : 'Só o agente de contratação cria e conduz sessões de disputa.'}
                  </p>
                )}
              </>
            )
          }
        </ConteudoConsulta>
      </div>
    </Pagina>
  );
}
