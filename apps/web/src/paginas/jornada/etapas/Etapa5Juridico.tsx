/**
 * Etapa 5 — Controle jurídico e publicação: checklist e conclusão do parecer (art. 53, perfil jurídico),
 * publicação no PNCP e no DOU pela fila do servidor e data mínima de abertura das propostas (art. 55, RN-15).
 */
import { useId, useState, type FormEvent } from 'react';
import { Lock, RotateCcw, Save, Send } from 'lucide-react';
import { dataMinimaAberturaPropostas, diasEntre, formatarData, hojeISO } from '@agora/dominio';
import { rotaDiretaPelaModalidade } from '../../rotas-contratacao/componentes';
import { usePublicarProcesso, useSalvarParecer, type ItemParecer } from '../../../api/jornada';
import { Alerta, AreaTexto, Botao, ConfirmarAcao, Etiqueta, GrupoOpcoes, ListaDefinicoes, useAvisos } from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { calcular, ErroOperacao, mesmoConteudo, Requisitos, textoOuNulo, type Requisito } from '../comum';
import { DocumentosEtapa } from '../Documentos';
import { CONCLUSOES_PARECER, CRITERIOS_JULGAMENTO, REGIMES_EXECUCAO, SITUACOES_PUBLICACAO, TIPOS_OBJETO, type ConclusaoParecer } from '../rotulos';
import type { PropsEtapa } from './tipos';
import EnviosPncp from './EnviosPncp';

type SituacaoItem = 'atendido' | 'nao_atendido' | 'nao_verificado';

const OPCOES_ITEM: readonly { valor: SituacaoItem; rotulo: string }[] = [
  { valor: 'atendido', rotulo: 'Atendido' },
  { valor: 'nao_atendido', rotulo: 'Não atendido' },
  { valor: 'nao_verificado', rotulo: 'Não verificado' },
];

const LISTA_CONCLUSOES: readonly ConclusaoParecer[] = ['favoravel', 'favoravel_com_ressalvas', 'desfavoravel'];

function situacaoItem(atendido: boolean | null): SituacaoItem {
  if (atendido === null) return 'nao_verificado';
  return atendido ? 'atendido' : 'nao_atendido';
}

function valorItem(situacao: SituacaoItem): boolean | null {
  if (situacao === 'nao_verificado') return null;
  return situacao === 'atendido';
}

export default function Etapa5Juridico({ processo, atual }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const { temPermissao } = useSessao();
  const encerrado = processo.contratoGerado !== null;
  const juridico = atual && !encerrado && temPermissao('jornada:aprovar_juridico');
  // Com o edital na fila de publicação ou publicado, o parecer fica imutável (o servidor responde 409).
  const parecerTravado = processo.publicacao.pncp !== 'nao_publicado';
  const podeParecer = juridico && !parecerTravado;
  const podePublicar = atual && !encerrado && temPermissao('jornada:publicar');
  const salvarParecer = useSalvarParecer(processo.id);
  const publicar = usePublicarProcesso(processo.id);
  // Rotas diretas (RF-34) não publicam edital: o aviso ou o ato de autorização ficam no painel da rota.
  const rotaDireta = rotaDiretaPelaModalidade(processo.modalidadePrevista);
  const [itens, definirItens] = useState<ItemParecer[]>(() => processo.parecer.itens);
  const [conclusao, definirConclusao] = useState<ConclusaoParecer | null>(processo.parecer.conclusao);
  const [confirmarPublicacao, definirConfirmarPublicacao] = useState(false);

  const original = { itens: processo.parecer.itens, conclusao: processo.parecer.conclusao };
  const alterado = !mesmoConteudo({ itens, conclusao }, original);
  const naoAtendidos = itens.filter((i) => i.atendido === false).length;
  const naoVerificados = itens.filter((i) => i.atendido === null).length;
  const favoravelSalvo = processo.parecer.conclusao === 'favoravel' || processo.parecer.conclusao === 'favoravel_com_ressalvas';

  const hoje = hojeISO(new Date());
  const pub = processo.publicacao;
  const edital = processo.parametrosEdital;
  const previa = calcular(() =>
    dataMinimaAberturaPropostas(hoje, { objeto: processo.dfd.tipoObjeto, criterio: edital.criterioJulgamento, regime: edital.regimeExecucao }),
  );
  const prazoCumprido = pub.dataMinimaPropostas !== null && hoje >= pub.dataMinimaPropostas;

  const requisitos: Requisito[] = [
    { id: 'parecer', rotulo: 'Parecer jurídico favorável ou favorável com ressalvas registrado (art. 53)', atendido: favoravelSalvo },
    { id: 'pncp', rotulo: 'Edital publicado no PNCP', atendido: pub.pncp === 'publicado', detalhe: ` — ${SITUACOES_PUBLICACAO[pub.pncp].rotulo.toLowerCase()}` },
    {
      id: 'prazo',
      rotulo: 'Prazo mínimo para apresentação de propostas cumprido (RN-15, art. 55)',
      atendido: prazoCumprido,
      detalhe: pub.dataMinimaPropostas ? ` — a partir de ${formatarData(pub.dataMinimaPropostas)}` : ' — depende da publicação',
    },
  ].filter((r) => !rotaDireta || r.id === 'parecer');

  const alterarItem = (id: string, mudanca: Partial<ItemParecer>) => definirItens((lista) => lista.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvarParecer.mutate(
      { itens: itens.map((i) => ({ ...i, observacao: textoOuNulo(i.observacao ?? '') })), conclusao },
      {
        onSuccess: (atualizado) => {
          definirItens(atualizado.parecer.itens);
          definirConclusao(atualizado.parecer.conclusao);
          avisar({ tipo: 'sucesso', titulo: 'Parecer registrado', mensagem: 'O checklist e a conclusão foram salvos no processo.' });
        },
      },
    );
  };

  return (
    <div className="pilha pilha--ampla">
      <section className="secao jornada-subsecao" aria-labelledby={`${base}-parecer`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-parecer`} className="secao__titulo">
              Parecer jurídico
            </h3>
            <p className="secao__descricao">
              Controle prévio de legalidade pelo órgão de assessoramento jurídico (Lei 14.133/2021, art. 53). A conclusão é ato privativo do
              parecerista: a Ágora não sugere conclusão e a IA nunca preenche este campo.
            </p>
          </div>
          {processo.parecer.conclusao ? (
            <Etiqueta tom={CONCLUSOES_PARECER[processo.parecer.conclusao].tom}>{CONCLUSOES_PARECER[processo.parecer.conclusao].rotulo}</Etiqueta>
          ) : (
            <Etiqueta>Sem conclusão</Etiqueta>
          )}
        </div>
        <p className="texto-pequeno texto-secundario">Parecerista: {processo.parecer.parecerista?.nome ?? 'ainda não registrado'}</p>

        {itens.length === 0 ? (
          <p className="texto-secundario">O checklist do parecer ainda não foi montado para este processo.</p>
        ) : podeParecer ? (
          <form className="formulario" onSubmit={enviar} noValidate>
            <ol className="jornada-checklist">
              {itens.map((item, i) => {
                const idTexto = `${base}-item-${i}`;
                return (
                  <li key={item.id} className="jornada-checklist__item">
                    <div className="pilha pilha--compacta" role="group" aria-labelledby={idTexto}>
                      <p id={idTexto} className="texto-forte">
                        {i + 1}. {item.texto}
                      </p>
                      <GrupoOpcoes
                        legenda="Situação"
                        nome={`${base}-situacao-${item.id}`}
                        horizontal
                        opcoes={OPCOES_ITEM}
                        valor={situacaoItem(item.atendido)}
                        aoMudar={(v) => alterarItem(item.id, { atendido: valorItem(v) })}
                      />
                      <AreaTexto
                        rotulo="Observação"
                        rows={2}
                        value={item.observacao ?? ''}
                        onChange={(e) => alterarItem(item.id, { observacao: e.target.value })}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            <GrupoOpcoes
              legenda="Conclusão do parecer (art. 53)"
              nome={`${base}-conclusao`}
              opcoes={LISTA_CONCLUSOES.map((c) => ({ valor: c, rotulo: CONCLUSOES_PARECER[c].rotulo }))}
              valor={conclusao}
              aoMudar={definirConclusao}
            />
            <div aria-live="polite">
              {conclusao === 'favoravel' && naoAtendidos > 0 ? (
                <Alerta tipo="aviso" compacto>
                  <p>
                    {naoAtendidos === 1 ? 'Há 1 item não atendido' : `Há ${naoAtendidos} itens não atendidos`} no checklist. Confirme se a conclusão
                    não deveria ser “favorável com ressalvas” ou “desfavorável”.
                  </p>
                </Alerta>
              ) : null}
              {conclusao !== null && conclusao !== 'desfavoravel' && naoVerificados > 0 ? (
                <Alerta tipo="info" compacto>
                  <p>{naoVerificados === 1 ? '1 item do checklist está sem verificação.' : `${naoVerificados} itens do checklist estão sem verificação.`}</p>
                </Alerta>
              ) : null}
            </div>
            <ErroOperacao erro={salvarParecer.error} titulo="Não foi possível salvar o parecer" />
            <div className="jornada-barra-acoes">
              <p className="texto-pequeno texto-secundario" aria-live="polite">
                {alterado ? 'Há alterações não salvas no parecer.' : 'Sem alterações pendentes.'}
              </p>
              <div className="linha">
                <Botao
                  variante="terciario"
                  icone={RotateCcw}
                  disabled={!alterado || salvarParecer.isPending}
                  onClick={() => {
                    definirItens(processo.parecer.itens);
                    definirConclusao(processo.parecer.conclusao);
                    salvarParecer.reset();
                  }}
                >
                  Descartar alterações
                </Botao>
                <Botao variante="primario" type="submit" icone={Save} carregando={salvarParecer.isPending} disabled={!alterado}>
                  Salvar parecer
                </Botao>
              </div>
            </div>
          </form>
        ) : (
          <>
            {parecerTravado ? (
              <div className="jornada-consulta" role="note">
                <Lock size={16} aria-hidden="true" />
                <p>
                  <strong>Parecer travado pela publicação.</strong> O parecer não pode ser alterado após a publicação; registre nova manifestação
                  jurídica no SEI.
                </p>
              </div>
            ) : atual && !encerrado ? (
              <p className="texto-pequeno texto-secundario">O preenchimento do checklist e da conclusão é restrito ao perfil jurídico.</p>
            ) : null}
            <ol className="jornada-checklist">
              {processo.parecer.itens.map((item, i) => {
                const s = situacaoItem(item.atendido);
                return (
                  <li key={item.id} className="jornada-checklist__item">
                    <p className="linha linha--entre">
                      <span>
                        {i + 1}. {item.texto}
                      </span>
                      <Etiqueta tom={s === 'atendido' ? 'sucesso' : s === 'nao_atendido' ? 'erro' : 'neutro'} compacta>
                        {OPCOES_ITEM.find((o) => o.valor === s)?.rotulo}
                      </Etiqueta>
                    </p>
                    {item.observacao ? <p className="texto-pequeno">{item.observacao}</p> : null}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {rotaDireta ? null : (
      <section className="secao jornada-subsecao" aria-labelledby={`${base}-publicacao`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-publicacao`} className="secao__titulo">
              Publicação do edital
            </h3>
            <p className="secao__descricao">
              PNCP e Diário Oficial da União. O envio é feito pela fila do servidor, com nova tentativa automática se o serviço estiver
              indisponível. O edital fica acessível a qualquer interessado, sem cadastro prévio (art. 25, § 3º — RN-07).
            </p>
          </div>
          {podePublicar && pub.pncp === 'nao_publicado' ? (
            <Botao
              variante="primario"
              icone={Send}
              disabled={!favoravelSalvo}
              onClick={() => {
                publicar.reset();
                definirConfirmarPublicacao(true);
              }}
            >
              Publicar
            </Botao>
          ) : null}
        </div>
        {podePublicar && pub.pncp === 'nao_publicado' && !favoravelSalvo ? (
          <p className="texto-pequeno texto-secundario">A publicação é liberada após o registro de parecer favorável ou favorável com ressalvas.</p>
        ) : null}
        <ListaDefinicoes
          colunas={2}
          itens={[
            {
              termo: 'PNCP',
              valor: (
                <Etiqueta tom={SITUACOES_PUBLICACAO[pub.pncp].tom} compacta>
                  {SITUACOES_PUBLICACAO[pub.pncp].rotulo}
                </Etiqueta>
              ),
            },
            {
              termo: 'Diário Oficial da União',
              valor: (
                <Etiqueta tom={SITUACOES_PUBLICACAO[pub.dou].tom} compacta>
                  {SITUACOES_PUBLICACAO[pub.dou].rotulo}
                </Etiqueta>
              ),
            },
            { termo: 'Publicado em', valor: pub.publicadoEm ? <span className="numero">{formatarData(pub.publicadoEm)}</span> : 'Não publicado' },
            { termo: 'Identificador PNCP', valor: pub.idPncp ? <span className="mono">{pub.idPncp}</span> : 'Atribuído após a publicação' },
          ]}
        />
        <EnviosPncp processo={processo} />
        <div className="jornada-prazo" aria-live="polite">
          {pub.dataMinimaPropostas ? (
            <>
              <p className="jornada-prazo__data">
                Propostas a partir de <strong className="numero">{formatarData(pub.dataMinimaPropostas)}</strong>
              </p>
              <Etiqueta tom={prazoCumprido ? 'sucesso' : 'aviso'} compacta>
                {prazoCumprido
                  ? 'Prazo mínimo cumprido'
                  : `Faltam ${diasEntre(hoje, pub.dataMinimaPropostas)} dia${diasEntre(hoje, pub.dataMinimaPropostas) === 1 ? '' : 's'} corridos`}
              </Etiqueta>
            </>
          ) : previa.ok ? (
            <p>
              Se publicado hoje: propostas a partir de <strong className="numero">{formatarData(previa.valor.data)}</strong> ({previa.valor.diasUteis}{' '}
              dias úteis — {previa.valor.fundamento}), considerando {TIPOS_OBJETO[processo.dfd.tipoObjeto].toLowerCase()}, critério{' '}
              {CRITERIOS_JULGAMENTO[edital.criterioJulgamento].toLowerCase()}
              {edital.regimeExecucao === 'outro' ? '' : ` e ${REGIMES_EXECUCAO[edital.regimeExecucao].toLowerCase()}`}, conforme os parâmetros do
              edital.
            </p>
          ) : (
            <p className="texto-secundario">{previa.mensagem}</p>
          )}
          <p className="texto-pequeno texto-secundario">
            Prazo mínimo entre a divulgação do edital e a apresentação das propostas, contado em dias úteis (arts. 55 e 183).
          </p>
        </div>
      </section>
      )}

      <DocumentosEtapa
        processo={processo}
        tipos={['parecer_checklist']}
        editavel={juridico}
        titulo="Documento do controle jurídico"
        descricao={
          juridico
            ? 'Checklist do art. 53 consolidado em documento, para juntada ao processo SEI. Gere uma nova versão depois de salvar o parecer, revise e aprove.'
            : 'Checklist do art. 53 consolidado em documento, para juntada ao processo SEI. A geração e a aprovação são da assessoria jurídica.'
        }
      />

      {atual && !encerrado ? <Requisitos titulo="Condições para avançar à etapa 6" itens={requisitos} /> : null}

      <ConfirmarAcao
        aberto={confirmarPublicacao}
        aoFechar={() => definirConfirmarPublicacao(false)}
        titulo="Publicar o edital"
        largura="media"
        descricao={
          <>
            <p>
              Envia o edital e os anexos aprovados para a fila de publicação no PNCP e o aviso de licitação para o DOU. Depois de publicado, o
              prazo mínimo para propostas passa a correr.
            </p>
            <p>Confira antes se os documentos não expõem dados pessoais nem o orçamento sigiloso, se houver (RIA-05, art. 13).</p>
          </>
        }
        rotuloConfirmar="Publicar"
        aoConfirmar={() =>
          publicar.mutate(undefined, {
            onSuccess: (atualizado) => {
              avisar({
                tipo: 'sucesso',
                titulo: 'Publicação enviada',
                mensagem: atualizado.publicacao.dataMinimaPropostas
                  ? `Propostas a partir de ${formatarData(atualizado.publicacao.dataMinimaPropostas)}.`
                  : 'O edital entrou na fila de publicação.',
              });
              definirConfirmarPublicacao(false);
            },
          })
        }
        processando={publicar.isPending}
        erro={publicar.error}
      />
    </div>
  );
}
