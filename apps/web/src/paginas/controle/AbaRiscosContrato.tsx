/**
 * Aba "Matriz de riscos" do contrato (RN-29): matriz vigente, situação da revisão trimestral pelas linhas de defesa,
 * histórico de revisões e registro de nova revisão com a matriz atualizada. Mostra também as medidas do controle
 * externo sobre o contrato (RN-30). O servidor decide quem revisa e grava a revisão na trilha.
 */
import { useState, type FormEvent } from 'react';
import { ClipboardCheck, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ContratoDetalhe, MatrizRiscosContrato, RiscoMatriz } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useMatrizRiscosContrato, useMedidasControle, useRevisarRiscosContrato } from '../../api/controle';
import { Alerta, AreaTexto, Botao, ConteudoConsulta, Dialogo, EstadoVazio, Etiqueta, ListaDefinicoes, Secao, Selecao, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao, novoId } from '../jornada/comum';
import { ALOCACOES, ehEscala, ESCALA, IMPACTOS, NIVEIS_RISCO, nivelRisco, PROBABILIDADES, type Alocacao } from '../jornada/rotulos';
import { EtiquetaRevisao, ListaMedidas } from './comum';

const MINIMO_OBSERVACAO = 20;
const MINIMO_TEXTO_RISCO = 5;
const LISTA_ALOCACOES: readonly Alocacao[] = ['contratante', 'contratada', 'compartilhado'];
const ORIGEM: Record<MatrizRiscosContrato['origem'], string> = {
  revisao: 'Última revisão trimestral',
  processo: 'Matriz do processo da jornada que gerou o contrato',
  sem_matriz: 'Sem matriz registrada',
};

function TabelaRiscos({ riscos, legenda }: { riscos: readonly RiscoMatriz[]; legenda: string }) {
  return (
    <div className="tabela-rolagem" role="region" aria-label={legenda} tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption className="tabela__legenda">{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Risco</th>
            <th scope="col" className="tabela__alinhar--centro">
              Probabilidade
            </th>
            <th scope="col" className="tabela__alinhar--centro">
              Impacto
            </th>
            <th scope="col">Nível</th>
            <th scope="col">Alocação</th>
            <th scope="col">Tratamento</th>
          </tr>
        </thead>
        <tbody>
          {riscos.map((r) => {
            const nivel = NIVEIS_RISCO[nivelRisco(r.probabilidade, r.impacto)];
            return (
              <tr key={r.id}>
                <th scope="row" className="jornada-celula-texto">
                  {r.descricao}
                </th>
                <td className="tabela__alinhar--centro numero">{r.probabilidade}</td>
                <td className="tabela__alinhar--centro numero">{r.impacto}</td>
                <td>
                  <Etiqueta tom={nivel.tom} compacta>
                    {nivel.rotulo}
                  </Etiqueta>
                </td>
                <td>{ALOCACOES[r.alocacao]}</td>
                <td className="jornada-celula-texto">{r.mitigacao}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RascunhoRisco {
  id: string;
  descricao: string;
  probabilidade: RiscoMatriz['probabilidade'];
  impacto: RiscoMatriz['impacto'];
  alocacao: Alocacao;
  mitigacao: string;
}

function DialogoRevisao({ contratoId, numero, riscosAtuais, aberto, aoFechar }: { contratoId: string; numero: string; riscosAtuais: readonly RiscoMatriz[]; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const revisar = useRevisarRiscosContrato(contratoId);
  const [riscos, definirRiscos] = useState<RascunhoRisco[]>(() => riscosAtuais.map((r) => ({ ...r })));
  const [observacao, definirObservacao] = useState('');
  const [tentou, definirTentou] = useState(false);
  const idFormulario = 'formulario-revisao-riscos';

  const alterar = (id: string, mudanca: Partial<RascunhoRisco>) => definirRiscos((lista) => lista.map((r) => (r.id === id ? { ...r, ...mudanca } : r)));
  const incluir = () =>
    definirRiscos((lista) => [...lista, { id: novoId(), descricao: '', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: '' }]);
  const remover = (id: string) => definirRiscos((lista) => lista.filter((r) => r.id !== id));

  const invalidos = riscos.filter((r) => r.descricao.trim().length < MINIMO_TEXTO_RISCO || r.mitigacao.trim().length < MINIMO_TEXTO_RISCO);
  const erroObservacao = observacao.trim().length < MINIMO_OBSERVACAO ? `Registre a observação da revisão com pelo menos ${MINIMO_OBSERVACAO} caracteres.` : null;
  const erroLista = riscos.length === 0 ? 'A matriz revisada precisa de ao menos um risco.' : null;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (erroObservacao || erroLista || invalidos.length > 0) return;
    revisar.mutate(
      {
        riscos: riscos.map((r) => ({ id: r.id, descricao: r.descricao.trim(), probabilidade: r.probabilidade, impacto: r.impacto, alocacao: r.alocacao, mitigacao: r.mitigacao.trim() })),
        observacao: observacao.trim(),
      },
      {
        onSuccess: (matriz) => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Revisão registrada',
            mensagem: matriz.revisao.proximaRevisao ? `Próxima revisão até ${formatarData(matriz.revisao.proximaRevisao)}.` : 'Revisão gravada na trilha de auditoria.',
          });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={`Revisão trimestral da matriz de riscos — Contrato ${numero}`}
      largura="ampla"
      descricao={<p>Confira cada risco, ajuste probabilidade, impacto, alocação e tratamento, e registre a observação. A revisão entra na trilha de auditoria (RN-29).</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={revisar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={revisar.isPending}>
            Registrar revisão
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        {riscos.map((r, n) => (
          <fieldset key={r.id} className="revisao-risco pilha pilha--compacta">
            <legend>Risco {n + 1}</legend>
            <AreaTexto
              rotulo="Descrição do risco"
              obrigatorio
              rows={2}
              value={r.descricao}
              erro={tentou && r.descricao.trim().length < MINIMO_TEXTO_RISCO ? 'Descreva o risco.' : null}
              onChange={(e) => alterar(r.id, { descricao: e.target.value })}
            />
            <div className="formulario__linha">
              <Selecao
                rotulo="Probabilidade"
                opcoes={ESCALA.map((v) => ({ valor: String(v), rotulo: `${v} — ${PROBABILIDADES[v]}` }))}
                value={String(r.probabilidade)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (ehEscala(v)) alterar(r.id, { probabilidade: v });
                }}
              />
              <Selecao
                rotulo="Impacto"
                opcoes={ESCALA.map((v) => ({ valor: String(v), rotulo: `${v} — ${IMPACTOS[v]}` }))}
                value={String(r.impacto)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (ehEscala(v)) alterar(r.id, { impacto: v });
                }}
              />
              <Selecao
                rotulo="Alocação"
                opcoes={LISTA_ALOCACOES.map((a) => ({ valor: a, rotulo: ALOCACOES[a] }))}
                value={r.alocacao}
                onChange={(e) => {
                  const a = LISTA_ALOCACOES.find((x) => x === e.target.value);
                  if (a) alterar(r.id, { alocacao: a });
                }}
              />
            </div>
            <AreaTexto
              rotulo="Tratamento (prevenção, mitigação ou resposta)"
              obrigatorio
              rows={2}
              value={r.mitigacao}
              erro={tentou && r.mitigacao.trim().length < MINIMO_TEXTO_RISCO ? 'Informe o tratamento.' : null}
              onChange={(e) => alterar(r.id, { mitigacao: e.target.value })}
            />
            <div className="linha linha--fim">
              <Botao variante="terciario" tamanho="compacto" icone={Trash2} onClick={() => remover(r.id)}>
                Remover risco {n + 1}
              </Botao>
            </div>
          </fieldset>
        ))}
        <div className="linha">
          <Botao icone={Plus} onClick={incluir}>
            Incluir risco
          </Botao>
        </div>
        {tentou && erroLista ? (
          <p className="campo__erro" role="alert">
            {erroLista}
          </p>
        ) : null}
        <AreaTexto
          rotulo="Observação da revisão"
          obrigatorio
          rows={3}
          maxLength={2000}
          contador
          value={observacao}
          erro={tentou ? erroObservacao : null}
          onChange={(e) => definirObservacao(e.target.value)}
          ajuda="O que mudou na matriz e por quê, ou a confirmação de que os riscos seguem os mesmos."
        />
        <ErroOperacao erro={revisar.error} titulo="A revisão não foi registrada" />
      </form>
    </Dialogo>
  );
}

function ConteudoRiscos({ contrato, matriz }: { contrato: ContratoDetalhe; matriz: MatrizRiscosContrato }) {
  const { temPermissao } = useSessao();
  const podeRevisar = temPermissao('riscos:revisar');
  const [revisando, definirRevisando] = useState(false);
  const [aberturas, definirAberturas] = useState(0);
  const abrir = () => {
    definirAberturas((n) => n + 1);
    definirRevisando(true);
  };
  const r = matriz.revisao;
  const tipoAlerta = r.situacao === 'vencida' ? 'erro' : r.situacao === 'a_vencer' ? 'aviso' : 'info';

  return (
    <div className="pilha">
      <Alerta
        tipo={tipoAlerta}
        titulo={r.situacao === 'vencida' ? 'Revisão trimestral vencida' : r.situacao === 'a_vencer' ? 'Revisão trimestral a vencer' : 'Revisão trimestral'}
        acoes={
          podeRevisar && r.situacao !== 'encerrado' ? (
            <Botao variante="primario" icone={ClipboardCheck} onClick={abrir}>
              Registrar revisão trimestral
            </Botao>
          ) : null
        }
      >
        <p>{r.explicacao}</p>
      </Alerta>
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: 'Situação', valor: <EtiquetaRevisao situacao={r.situacao} /> },
          { termo: 'Próxima revisão', valor: r.proximaRevisao ? <span className="numero">{formatarData(r.proximaRevisao)}</span> : 'Não se aplica' },
          {
            termo: 'Origem da matriz',
            valor: matriz.processo && matriz.origem === 'processo' ? `${ORIGEM.processo} (${matriz.processo.numeroSei})` : ORIGEM[matriz.origem],
          },
          { termo: 'Fundamento', valor: r.fundamento, largo: true },
        ]}
      />
      {matriz.riscos.length === 0 ? (
        <EstadoVazio
          icone={ShieldCheck}
          titulo="Sem matriz de riscos registrada"
          descricao="O contrato não veio de um processo da jornada com matriz. A primeira revisão trimestral registra a matriz do contrato."
        />
      ) : (
        <TabelaRiscos riscos={matriz.riscos} legenda={`Matriz de riscos vigente do contrato ${contrato.numero}`} />
      )}
      <Secao titulo="Histórico de revisões" simples nivel={3}>
        {matriz.revisoes.length === 0 ? (
          <p className="texto-secundario">Nenhuma revisão registrada.</p>
        ) : (
          <ul className="lista-controle">
            {matriz.revisoes.map((v) => (
              <li key={v.id}>
                <span className="lista-controle__titulo">Revisão de {formatarData(v.revisadaEm)}</span>
                <Etiqueta tom="info" compacta>
                  {v.linha === 'segunda' ? '2ª linha — controle interno' : '1ª linha — gestão e fiscalização'}
                </Etiqueta>
                <span className="lista-controle__descricao">{v.observacao}</span>
                <span className="lista-controle__explicacao texto-pequeno texto-secundario">
                  {v.riscos.length} risco(s) · {v.revisadaPor?.nome ?? 'Sistema'} · registrada em {formatarInstante(v.registradaEm)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>
      {temPermissao('controle_externo:ler') ? <MedidasDoContrato id={contrato.id} /> : null}
      {podeRevisar ? (
        <DialogoRevisao key={aberturas} contratoId={contrato.id} numero={contrato.numero} riscosAtuais={matriz.riscos} aberto={revisando} aoFechar={() => definirRevisando(false)} />
      ) : null}
    </div>
  );
}

function MedidasDoContrato({ id }: { id: string }) {
  const consulta = useMedidasControle({ alvo: 'contrato', alvoId: id, tamanhoPagina: 100 });
  const medidas = consulta.data?.itens ?? [];
  return (
    <Secao titulo="Medidas do controle externo sobre o contrato" simples nivel={3}>
      {medidas.some((m) => m.bloqueia) ? (
        <Alerta tipo="erro" titulo="Suspensão cautelar em vigor (RN-30)">
          <p>A assinatura de termos aditivos e prorrogações deste contrato fica bloqueada até a revogação.</p>
        </Alerta>
      ) : null}
      {consulta.isPending ? (
        <p className="texto-secundario" role="status">
          Carregando medidas…
        </p>
      ) : medidas.length === 0 ? (
        <p className="texto-secundario">Nenhuma medida do TCU ou da CGU registrada para este contrato.</p>
      ) : (
        <ListaMedidas medidas={medidas} />
      )}
    </Secao>
  );
}

export function AbaRiscosContrato({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useMatrizRiscosContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando a matriz de riscos">
      {(matriz) => <ConteudoRiscos contrato={contrato} matriz={matriz} />}
    </ConteudoConsulta>
  );
}
