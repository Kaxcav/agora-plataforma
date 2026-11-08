/**
 * Matriz de riscos (art. 22): mapa de calor 5 × 5 acessível (cada célula com quantidade e nível em texto,
 * filtrável por teclado), lista de riscos e formulário de inclusão/edição.
 */
import { useId, useState, type FormEvent } from 'react';
import { FunnelX, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSalvarRiscos, type RiscoProcesso } from '../../../api/jornada';
import { AreaTexto, Botao, ConfirmarAcao, Dialogo, Etiqueta, GrupoOpcoes, Selecao, useAvisos } from '../../../componentes';
import { contar } from '../../../utilitarios/formatacao';
import { ErroOperacao, novoId } from '../comum';
import { ALOCACOES, ehEscala, ESCALA, IMPACTOS, NIVEIS_RISCO, nivelRisco, PROBABILIDADES, type Alocacao, type Escala, type NivelRisco } from '../rotulos';
import type { PropsEtapa } from './tipos';

const ESCALA_DECRESCENTE: readonly Escala[] = [...ESCALA].reverse();
const ORDEM_NIVEIS: readonly NivelRisco[] = ['baixo', 'moderado', 'alto', 'critico'];
const FAIXAS: Record<NivelRisco, string> = { baixo: 'P × I até 4', moderado: 'P × I de 5 a 9', alto: 'P × I de 10 a 14', critico: 'P × I de 15 a 25' };
const MINIMO_DESCRICAO = 10;
const LISTA_ALOCACOES: readonly Alocacao[] = ['contratante', 'contratada', 'compartilhado'];

interface Celula {
  probabilidade: Escala;
  impacto: Escala;
}

interface Rascunho {
  id: string | null;
  descricao: string;
  probabilidade: Escala;
  impacto: Escala;
  alocacao: Alocacao;
  mitigacao: string;
}

const RASCUNHO_VAZIO: Rascunho = { id: null, descricao: '', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: '' };

function opcoesEscala(rotulos: Record<Escala, string>) {
  return ESCALA.map((v) => ({ valor: String(v), rotulo: `${v} — ${rotulos[v]}` }));
}

function MapaCalor({ riscos, selecionada, aoSelecionar }: { riscos: readonly RiscoProcesso[]; selecionada: Celula | null; aoSelecionar: (c: Celula | null) => void }) {
  const idLegenda = useId();
  return (
    <div className="jornada-calor">
      <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
        <table className="jornada-calor__tabela">
          <caption id={idLegenda} className="tabela__legenda">
            Mapa de calor — quantidade de riscos por probabilidade (colunas) e impacto (linhas)
          </caption>
          <thead>
            <tr>
              <td className="jornada-calor__canto">
                <span className="sr-only">Impacto × probabilidade</span>
              </td>
              {ESCALA.map((p) => (
                <th key={p} scope="col">
                  <span className="numero">P{p}</span>
                  <span className="jornada-calor__eixo">{PROBABILIDADES[p]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ESCALA_DECRESCENTE.map((i) => (
              <tr key={i}>
                <th scope="row">
                  <span className="numero">I{i}</span>
                  <span className="jornada-calor__eixo">{IMPACTOS[i]}</span>
                </th>
                {ESCALA.map((p) => {
                  const quantidade = riscos.filter((r) => r.probabilidade === p && r.impacto === i).length;
                  const nivel = nivelRisco(p, i);
                  const ativa = selecionada?.probabilidade === p && selecionada.impacto === i;
                  return (
                    <td key={p} className={`jornada-calor__celula jornada-calor__celula--${nivel}${quantidade > 0 ? ' jornada-calor__celula--ocupada' : ''}`}>
                      <button
                        type="button"
                        className="jornada-calor__botao"
                        aria-pressed={ativa}
                        disabled={quantidade === 0}
                        aria-label={`${quantidade} ${NIVEIS_RISCO[nivel].rotulo} — ${contar(quantidade, 'risco', 'riscos')} com probabilidade ${p} (${PROBABILIDADES[p]}) e impacto ${i} (${IMPACTOS[i]})`}
                        onClick={() => aoSelecionar(ativa ? null : { probabilidade: p, impacto: i })}
                      >
                        {/* O nome acessível começa pelo texto visível ("1 Moderado"), como pede a WCAG 2.5.3. */}
                        <span className="jornada-calor__contagem numero">{quantidade}</span>{' '}
                        <span className="jornada-calor__nivel">{NIVEIS_RISCO[nivel].rotulo}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="jornada-calor__legenda" aria-label="Legenda dos níveis de risco">
        {ORDEM_NIVEIS.map((n) => (
          <li key={n}>
            <span className={`jornada-calor__amostra jornada-calor__celula--${n}`} aria-hidden="true" />
            <span>
              <strong>{NIVEIS_RISCO[n].rotulo}</strong> ({FAIXAS[n]})
            </span>
          </li>
        ))}
      </ul>
      <p className="texto-pequeno texto-secundario">
        Classificação de referência pelo produto probabilidade × impacto; o órgão pode adotar metodologia própria de gestão de riscos.
      </p>
    </div>
  );
}

export function SecaoRiscos({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarRiscos(processo.id);
  const [celula, definirCelula] = useState<Celula | null>(null);
  const [rascunho, definirRascunho] = useState<Rascunho | null>(null);
  const [tentou, definirTentou] = useState(false);
  const [remover, definirRemover] = useState<RiscoProcesso | null>(null);
  const riscos = processo.riscos;
  const visiveis = celula ? riscos.filter((r) => r.probabilidade === celula.probabilidade && r.impacto === celula.impacto) : riscos;

  const abrir = (risco: RiscoProcesso | null) => {
    salvar.reset();
    definirTentou(false);
    definirRascunho(
      risco
        ? { id: risco.id, descricao: risco.descricao, probabilidade: risco.probabilidade, impacto: risco.impacto, alocacao: risco.alocacao, mitigacao: risco.mitigacao }
        : RASCUNHO_VAZIO,
    );
  };

  const erroDescricao = rascunho && rascunho.descricao.trim().length < MINIMO_DESCRICAO ? `Descreva o risco com pelo menos ${MINIMO_DESCRICAO} caracteres.` : null;
  const erroMitigacao = rascunho && rascunho.mitigacao.trim() === '' ? 'Informe a medida de prevenção, mitigação ou resposta.' : null;

  const gravar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (!rascunho || erroDescricao || erroMitigacao) return;
    const risco: RiscoProcesso = {
      id: rascunho.id ?? novoId(),
      descricao: rascunho.descricao.trim(),
      probabilidade: rascunho.probabilidade,
      impacto: rascunho.impacto,
      alocacao: rascunho.alocacao,
      mitigacao: rascunho.mitigacao.trim(),
    };
    const lista = rascunho.id ? riscos.map((r) => (r.id === rascunho.id ? risco : r)) : [...riscos, risco];
    salvar.mutate(lista, {
      onSuccess: () => {
        avisar({ tipo: 'sucesso', titulo: rascunho.id ? 'Risco atualizado' : 'Risco incluído', mensagem: 'A matriz de riscos foi registrada no processo.' });
        definirRascunho(null);
      },
    });
  };

  const nivelRascunho = rascunho ? nivelRisco(rascunho.probabilidade, rascunho.impacto) : null;
  const idFormulario = `${base}-formulario`;

  return (
    <section className="secao jornada-subsecao" id="etapa3-riscos" aria-labelledby={`${base}-titulo`}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Matriz de riscos
          </h3>
          <p className="secao__descricao">
            Lei 14.133/2021, art. 22: riscos com probabilidade, impacto, alocação entre as partes e medidas de tratamento.
          </p>
        </div>
        {editavel ? (
          <Botao icone={Plus} onClick={() => abrir(null)}>
            Incluir risco
          </Botao>
        ) : null}
      </div>

      <MapaCalor riscos={riscos} selecionada={celula} aoSelecionar={definirCelula} />

      <div className="linha linha--entre">
        <p className="texto-forte" aria-live="polite">
          {celula
            ? `${contar(visiveis.length, 'risco', 'riscos')} com probabilidade ${celula.probabilidade} e impacto ${celula.impacto}`
            : `${contar(riscos.length, 'risco registrado', 'riscos registrados')}`}
        </p>
        {celula ? (
          <Botao variante="terciario" tamanho="compacto" icone={FunnelX} onClick={() => definirCelula(null)}>
            Mostrar todos os riscos
          </Botao>
        ) : null}
      </div>

      {riscos.length === 0 ? (
        <p className="texto-secundario">Nenhum risco registrado. A matriz precisa de ao menos um risco para avançar à etapa 4.</p>
      ) : (
        <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-legenda`} tabIndex={0}>
          <table className="tabela tabela--compacta">
            <caption id={`${base}-legenda`} className="tabela__legenda">
              Riscos da contratação
            </caption>
            <thead>
              <tr>
                <th scope="col">Risco</th>
                <th scope="col" className="tabela__alinhar--centro">
                  P
                </th>
                <th scope="col" className="tabela__alinhar--centro">
                  I
                </th>
                <th scope="col">Nível</th>
                <th scope="col">Alocação</th>
                <th scope="col">Tratamento</th>
                {editavel ? (
                  <th scope="col" className="tabela__alinhar--fim">
                    Ações
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => {
                const nivel = NIVEIS_RISCO[nivelRisco(r.probabilidade, r.impacto)];
                return (
                  <tr key={r.id}>
                    <th scope="row" className="jornada-celula-texto">
                      {r.descricao}
                    </th>
                    <td className="tabela__alinhar--centro numero" title={PROBABILIDADES[r.probabilidade]}>
                      {r.probabilidade}
                    </td>
                    <td className="tabela__alinhar--centro numero" title={IMPACTOS[r.impacto]}>
                      {r.impacto}
                    </td>
                    <td>
                      <Etiqueta tom={nivel.tom} compacta>
                        {nivel.rotulo}
                      </Etiqueta>
                    </td>
                    <td>{ALOCACOES[r.alocacao]}</td>
                    <td className="jornada-celula-texto">{r.mitigacao}</td>
                    {editavel ? (
                      <td className="tabela__celula--acoes tabela__alinhar--fim">
                        <Botao variante="terciario" tamanho="compacto" somenteIcone icone={Pencil} aria-label={`Editar risco: ${r.descricao}`} onClick={() => abrir(r)} />
                        <Botao
                          variante="terciario"
                          tamanho="compacto"
                          somenteIcone
                          icone={Trash2}
                          aria-label={`Remover risco: ${r.descricao}`}
                          onClick={() => {
                            salvar.reset();
                            definirRemover(r);
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialogo
        aberto={rascunho !== null}
        aoFechar={() => definirRascunho(null)}
        titulo={rascunho?.id ? 'Editar risco' : 'Incluir risco'}
        largura="ampla"
        descricao={<p>O risco é gravado na matriz do processo ao confirmar.</p>}
        rodape={
          <>
            <Botao variante="secundario" onClick={() => definirRascunho(null)} disabled={salvar.isPending}>
              Cancelar
            </Botao>
            <Botao variante="primario" type="submit" form={idFormulario} carregando={salvar.isPending}>
              {rascunho?.id ? 'Salvar risco' : 'Incluir risco'}
            </Botao>
          </>
        }
      >
        {rascunho ? (
          <form id={idFormulario} className="formulario" onSubmit={gravar} noValidate>
            <AreaTexto
              rotulo="Descrição do risco"
              obrigatorio
              rows={3}
              value={rascunho.descricao}
              erro={tentou ? erroDescricao : null}
              onChange={(e) => definirRascunho({ ...rascunho, descricao: e.target.value })}
              ajuda="Evento incerto, causa e consequência para a contratação."
            />
            <div className="formulario__linha">
              <Selecao
                rotulo="Probabilidade"
                obrigatorio
                opcoes={opcoesEscala(PROBABILIDADES)}
                value={String(rascunho.probabilidade)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (ehEscala(v)) definirRascunho({ ...rascunho, probabilidade: v });
                }}
              />
              <Selecao
                rotulo="Impacto"
                obrigatorio
                opcoes={opcoesEscala(IMPACTOS)}
                value={String(rascunho.impacto)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (ehEscala(v)) definirRascunho({ ...rascunho, impacto: v });
                }}
              />
            </div>
            {nivelRascunho ? (
              <p className="linha" aria-live="polite">
                Nível resultante:
                <Etiqueta tom={NIVEIS_RISCO[nivelRascunho].tom} compacta>
                  {NIVEIS_RISCO[nivelRascunho].rotulo}
                </Etiqueta>
                <span className="texto-secundario numero">
                  (P × I = {rascunho.probabilidade * rascunho.impacto})
                </span>
              </p>
            ) : null}
            <GrupoOpcoes
              legenda="Alocação do risco"
              nome={`${base}-alocacao`}
              obrigatorio
              horizontal
              opcoes={LISTA_ALOCACOES.map((v) => ({ valor: v, rotulo: ALOCACOES[v] }))}
              valor={rascunho.alocacao}
              aoMudar={(v) => definirRascunho({ ...rascunho, alocacao: v })}
            />
            <AreaTexto
              rotulo="Tratamento (prevenção, mitigação ou resposta)"
              obrigatorio
              rows={3}
              value={rascunho.mitigacao}
              erro={tentou ? erroMitigacao : null}
              onChange={(e) => definirRascunho({ ...rascunho, mitigacao: e.target.value })}
            />
            <ErroOperacao erro={salvar.error} titulo="Não foi possível gravar a matriz de riscos" />
          </form>
        ) : null}
      </Dialogo>

      <ConfirmarAcao
        aberto={remover !== null}
        aoFechar={() => definirRemover(null)}
        titulo="Remover risco"
        variante="perigo"
        descricao={remover ? <p>Remove da matriz o risco “{remover.descricao}”. A alteração fica registrada na trilha de auditoria.</p> : null}
        rotuloConfirmar="Remover risco"
        aoConfirmar={() => {
          if (!remover) return;
          const alvo = remover.id;
          salvar.mutate(
            riscos.filter((r) => r.id !== alvo),
            {
              onSuccess: () => {
                avisar({ tipo: 'sucesso', titulo: 'Risco removido', mensagem: 'A matriz de riscos foi atualizada.' });
                definirRemover(null);
              },
            },
          );
        }}
        processando={salvar.isPending}
        erro={salvar.error}
      />
    </section>
  );
}
