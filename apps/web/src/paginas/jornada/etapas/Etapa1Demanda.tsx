/**
 * Etapa 1 — Demanda e PCA: formulário do DFD com itens editáveis, catálogo padronizado (RN-02),
 * sinal de artigo de luxo ao digitar (RN-01) e referência de dispensa por valor/fracionamento (RN-14).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus, RotateCcw, Save, Trash2, TriangleAlert } from 'lucide-react';
import type { ItemDemanda } from '@agora/contratos';
import { avaliarFracionamento, formatarMoeda, hojeISO, sinalizarArtigoLuxo, type Centavos } from '@agora/dominio';
import { useSalvarDfd, type DadosDfd } from '../../../api/jornada';
import { Alerta, Alternador, AreaTexto, Botao, Etiqueta, Selecao, useAvisos, type TomEtiqueta } from '../../../componentes';
import { formatarNumero, formatarPercentual } from '../../../utilitarios/formatacao';
import { opcoesDe } from '../../compartilhado/rotulos';
import { calcular, EntradaMoeda, ErroOperacao, mesmoConteudo, Requisitos, textoOuNulo, type Requisito } from '../comum';
import { DocumentosEtapa } from '../Documentos';
import { ehTipoObjeto, TIPOS_OBJETO } from '../rotulos';
import PlanejamentoDfd from './PlanejamentoDfd';
import { MINIMO_TEXTO, textoSuficiente, type PropsEtapa } from './tipos';

const SINAL_FRACIONAMENTO: Record<'sem_risco' | 'atencao' | 'risco', { rotulo: string; tom: TomEtiqueta; leitura: string }> = {
  sem_risco: {
    rotulo: 'Abaixo de 80% do limite',
    tom: 'sucesso',
    leitura: 'O valor estimado desta demanda está abaixo de 80% do limite de dispensa por valor.',
  },
  atencao: {
    rotulo: 'Entre 80% e 100% do limite',
    tom: 'aviso',
    leitura: 'Atenção às demais contratações de mesma natureza no exercício: somadas, podem ultrapassar o limite de dispensa por valor.',
  },
  risco: {
    rotulo: 'Acima do limite de dispensa',
    tom: 'erro',
    leitura:
      'O valor supera o limite de dispensa por valor: a contratação exige licitação ou outro fundamento legal, e não pode ser dividida para se enquadrar em dispensa.',
  },
};

function totalItem(item: ItemDemanda): Centavos {
  return Math.round(item.quantidade * item.valorUnitarioEstimado);
}

function itemNovo(): ItemDemanda {
  return { catmat: null, descricao: '', unidade: 'unidade', quantidade: 1, valorUnitarioEstimado: 0 };
}

function TabelaItensLeitura({ itens }: { itens: readonly ItemDemanda[] }) {
  return (
    <div className="tabela-rolagem" role="region" aria-label="Itens da demanda" tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption className="tabela__legenda">Itens da demanda</caption>
        <thead>
          <tr>
            <th scope="col">Nº</th>
            <th scope="col">CATMAT/CATSER</th>
            <th scope="col">Descrição</th>
            <th scope="col">Unidade</th>
            <th scope="col" className="tabela__alinhar--fim">
              Quantidade
            </th>
            <th scope="col" className="tabela__alinhar--fim">
              Valor unitário estimado
            </th>
            <th scope="col" className="tabela__alinhar--fim">
              Valor total
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 ? (
            <tr>
              <td colSpan={7} className="texto-secundario">
                Nenhum item registrado.
              </td>
            </tr>
          ) : (
            itens.map((item, i) => (
              <tr key={i}>
                <th scope="row" className="numero">
                  {i + 1}
                </th>
                <td className="mono">{item.catmat ?? '—'}</td>
                <td>{item.descricao}</td>
                <td>{item.unidade}</td>
                <td className="tabela__alinhar--fim numero">{formatarNumero(item.quantidade)}</td>
                <td className="tabela__alinhar--fim numero">{formatarMoeda(item.valorUnitarioEstimado)}</td>
                <td className="tabela__alinhar--fim numero">{formatarMoeda(totalItem(item))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Etapa1Demanda({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarDfd(processo.id);
  const [dfd, definirDfd] = useState<DadosDfd>(() => processo.dfd);
  const [anuncio, definirAnuncio] = useState('');
  const [errosItens, definirErrosItens] = useState<Record<number, string>>({});
  const focarItem = useRef<number | null>(null);
  const botaoAdicionar = useRef<HTMLButtonElement>(null);
  const alterado = !mesmoConteudo(dfd, processo.dfd);

  useEffect(() => {
    if (focarItem.current === null) return;
    document.getElementById(`${base}-item-${focarItem.current}-descricao`)?.focus();
    focarItem.current = null;
  }, [dfd.itens.length, base]);

  const alterar = <K extends keyof DadosDfd>(campo: K, valor: DadosDfd[K]) => definirDfd((d) => ({ ...d, [campo]: valor }));

  const alterarItem = (indice: number, mudanca: Partial<ItemDemanda>) =>
    definirDfd((d) => ({ ...d, itens: d.itens.map((item, i) => (i === indice ? { ...item, ...mudanca } : item)) }));

  const adicionarItem = () => {
    focarItem.current = dfd.itens.length;
    definirDfd((d) => ({ ...d, itens: [...d.itens, itemNovo()] }));
    definirAnuncio(`Item ${dfd.itens.length + 1} adicionado.`);
  };

  const removerItem = (indice: number) => {
    definirDfd((d) => ({ ...d, itens: d.itens.filter((_, i) => i !== indice) }));
    definirErrosItens({});
    definirAnuncio(`Item ${indice + 1} removido.`);
    botaoAdicionar.current?.focus();
  };

  // Sinais instantâneos (as mesmas regras do domínio que o servidor aplica).
  const indiciosLuxo = dfd.itens
    .map((item, indice) => ({ indice, resultado: sinalizarArtigoLuxo(item.descricao) }))
    .filter((x) => x.resultado.sinal === 'possivel_artigo_luxo');
  const valorTotal = dfd.itens.reduce((soma, item) => soma + totalItem(item), 0);
  const tipoDispensa = dfd.tipoObjeto.startsWith('obras') ? 'obras_servicos_engenharia' : 'demais';
  const fracionamento = calcular(() =>
    avaliarFracionamento({ data: hojeISO(new Date()), tipo: tipoDispensa, contratacoesMesmaNaturezaNoExercicio: [], novaContratacao: valorTotal }),
  );
  const sinaisServidor = processo.sinais.filter((s) => s.regra === 'RN-14' || s.regra === 'RIA-01');

  const requisitos: Requisito[] = [
    {
      id: 'necessidade',
      rotulo: `Descrição da necessidade com pelo menos ${MINIMO_TEXTO} caracteres`,
      atendido: textoSuficiente(dfd.descricaoNecessidade),
    },
    { id: 'justificativa', rotulo: `Justificativa com pelo menos ${MINIMO_TEXTO} caracteres`, atendido: textoSuficiente(dfd.justificativa) },
    {
      id: 'itens',
      rotulo: 'Ao menos um item com quantidade e valor unitário maiores que zero',
      atendido: dfd.itens.some((i) => i.quantidade > 0 && i.valorUnitarioEstimado > 0),
    },
    {
      id: 'catalogo',
      rotulo: 'Catálogo padronizado utilizado ou não utilização justificada (RN-02, art. 19, § 2º)',
      atendido: dfd.usaCatalogoPadronizado || textoSuficiente(dfd.justificativaNaoPadronizacao),
    },
    {
      id: 'luxo',
      rotulo: 'Sem indício de artigo de luxo, ou indício justificado (RN-01, art. 20)',
      atendido: indiciosLuxo.length === 0 || textoSuficiente(dfd.justificativaArtigoLuxo),
    },
  ];

  const validarItens = (): boolean => {
    const erros: Record<number, string> = {};
    dfd.itens.forEach((item, i) => {
      if (item.descricao.trim() === '') erros[i] = 'Descreva o item ou remova a linha.';
      else if (item.unidade.trim() === '') erros[i] = 'Informe a unidade de fornecimento.';
      else if (!Number.isFinite(item.quantidade) || item.quantidade < 0) erros[i] = 'A quantidade não pode ser negativa.';
      else if (item.valorUnitarioEstimado < 0) erros[i] = 'O valor unitário não pode ser negativo.';
    });
    definirErrosItens(erros);
    const primeiro = Object.keys(erros)[0];
    if (primeiro !== undefined) document.getElementById(`${base}-item-${primeiro}-descricao`)?.focus();
    return primeiro === undefined;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!validarItens()) return;
    const normalizado: DadosDfd = {
      ...dfd,
      descricaoNecessidade: dfd.descricaoNecessidade.trim(),
      justificativa: dfd.justificativa.trim(),
      itens: dfd.itens.map((i) => ({ ...i, catmat: i.catmat === null ? null : textoOuNulo(i.catmat), descricao: i.descricao.trim(), unidade: i.unidade.trim() })),
      justificativaNaoPadronizacao: dfd.usaCatalogoPadronizado ? null : textoOuNulo(dfd.justificativaNaoPadronizacao ?? ''),
      justificativaArtigoLuxo: textoOuNulo(dfd.justificativaArtigoLuxo ?? ''),
    };
    salvar.mutate(normalizado, {
      onSuccess: (atualizado) => {
        definirDfd(atualizado.dfd);
        avisar({ tipo: 'sucesso', titulo: 'DFD salvo', mensagem: 'Os dados da demanda foram registrados no processo.' });
      },
    });
  };

  const descartar = () => {
    definirDfd(processo.dfd);
    definirErrosItens({});
    salvar.reset();
    definirAnuncio('Alterações descartadas.');
  };

  return (
    <div className="pilha pilha--ampla">
      <form className="formulario" onSubmit={enviar} noValidate aria-describedby={editavel ? `${base}-estado` : undefined}>
        <fieldset className="grupo-campos" disabled={!editavel}>
          <legend>Necessidade e justificativa</legend>
          <AreaTexto
            rotulo="Descrição da necessidade"
            obrigatorio
            contador
            maxLength={4000}
            rows={4}
            ajuda={`Problema a resolver e resultado esperado, sem indicar marca ou fornecedor. Mínimo de ${MINIMO_TEXTO} caracteres.`}
            value={dfd.descricaoNecessidade}
            onChange={(e) => alterar('descricaoNecessidade', e.target.value)}
          />
          <AreaTexto
            rotulo="Justificativa da contratação"
            obrigatorio
            contador
            maxLength={4000}
            rows={4}
            ajuda={`Interesse público atendido e consequência de não contratar. Mínimo de ${MINIMO_TEXTO} caracteres.`}
            value={dfd.justificativa}
            onChange={(e) => alterar('justificativa', e.target.value)}
          />
          <div className="formulario__linha">
            <Selecao
              rotulo="Natureza do objeto"
              obrigatorio
              opcoes={opcoesDe(TIPOS_OBJETO)}
              value={dfd.tipoObjeto}
              onChange={(e) => {
                const valor = e.target.value;
                if (ehTipoObjeto(valor)) alterar('tipoObjeto', valor);
              }}
              ajuda="Define o limite de dispensa por valor (art. 75) e o prazo mínimo de propostas (art. 55)."
            />
          </div>
          <Alternador
            rotulo="Demanda prevista no Plano de Contratações Anual (PCA)"
            ligado={dfd.previstoNoPca}
            aoMudar={(v) => alterar('previstoNoPca', v)}
            desabilitado={!editavel}
            ajuda="Lei 14.133/2021, art. 12, VII; Decreto 10.947/2022."
          />
          {!dfd.previstoNoPca ? (
            <Alerta tipo="aviso" compacto titulo="Demanda fora do PCA">
              <p>Sinal de atenção, não bloqueio: registre no processo por que a demanda não constava do PCA e avalie sua inclusão na revisão do plano.</p>
            </Alerta>
          ) : null}
        </fieldset>

        <fieldset className="grupo-campos" disabled={!editavel}>
          <legend>Itens da demanda</legend>
          {editavel ? (
            <>
              <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-legenda-itens`} tabIndex={0}>
                <table className="tabela tabela--compacta jornada-tabela-edicao">
                  <caption id={`${base}-legenda-itens`} className="tabela__legenda">
                    Itens da demanda (editáveis)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Nº</th>
                      <th scope="col">CATMAT/CATSER</th>
                      <th scope="col">Descrição</th>
                      <th scope="col">Unidade</th>
                      <th scope="col" className="tabela__alinhar--fim">
                        Quantidade
                      </th>
                      <th scope="col" className="tabela__alinhar--fim">
                        Valor unitário
                      </th>
                      <th scope="col">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dfd.itens.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="texto-secundario">
                          Nenhum item. Use “Adicionar item” para incluir o primeiro.
                        </td>
                      </tr>
                    ) : (
                      dfd.itens.map((item, i) => {
                        const n = i + 1;
                        const luxo = indiciosLuxo.find((x) => x.indice === i);
                        const idSinal = `${base}-item-${i}-sinal`;
                        const idErro = `${base}-item-${i}-erro`;
                        const erro = errosItens[i];
                        const descritores = [luxo ? idSinal : '', erro ? idErro : ''].filter(Boolean).join(' ') || undefined;
                        return (
                          <tr key={i}>
                            <th scope="row" className="numero">
                              {n}
                            </th>
                            <td>
                              <input
                                className="campo__controle jornada-entrada-curta mono"
                                aria-label={`Código CATMAT/CATSER do item ${n}`}
                                value={item.catmat ?? ''}
                                onChange={(e) => alterarItem(i, { catmat: e.target.value === '' ? null : e.target.value })}
                              />
                            </td>
                            <td>
                              <textarea
                                id={`${base}-item-${i}-descricao`}
                                rows={2}
                                className="campo__controle jornada-entrada-longa jornada-entrada-texto"
                                aria-label={`Descrição do item ${n}`}
                                aria-invalid={erro ? true : undefined}
                                aria-describedby={descritores}
                                value={item.descricao}
                                onChange={(e) => alterarItem(i, { descricao: e.target.value })}
                              />
                              {luxo ? (
                                <span id={idSinal} className="jornada-sinal-campo">
                                  <TriangleAlert size={14} aria-hidden="true" />
                                  Indício de artigo de luxo: {luxo.resultado.termosEncontrados.join(', ')}
                                </span>
                              ) : null}
                              {erro ? (
                                <span id={idErro} className="campo__erro">
                                  {erro}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <input
                                className="campo__controle jornada-entrada-curta"
                                aria-label={`Unidade de fornecimento do item ${n}`}
                                value={item.unidade}
                                onChange={(e) => alterarItem(i, { unidade: e.target.value })}
                              />
                            </td>
                            <td className="tabela__alinhar--fim">
                              <input
                                className="campo__controle jornada-entrada-numero numero"
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                placeholder="0"
                                aria-label={`Quantidade do item ${n}`}
                                value={item.quantidade === 0 ? '' : String(item.quantidade)}
                                onChange={(e) => alterarItem(i, { quantidade: e.target.value === '' ? 0 : e.target.valueAsNumber })}
                              />
                            </td>
                            <td className="tabela__alinhar--fim">
                              <EntradaMoeda
                                rotulo={`Valor unitário estimado do item ${n}`}
                                valor={item.valorUnitarioEstimado}
                                aoMudar={(v) => alterarItem(i, { valorUnitarioEstimado: v ?? 0 })}
                              />
                              <span className="jornada-total-linha numero">Total {formatarMoeda(totalItem(item))}</span>
                            </td>
                            <td>
                              <Botao
                                variante="terciario"
                                tamanho="compacto"
                                somenteIcone
                                icone={Trash2}
                                aria-label={`Remover item ${n}${item.descricao ? ` — ${item.descricao}` : ''}`}
                                onClick={() => removerItem(i)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={5} className="tabela__alinhar--fim">
                        Valor total estimado
                      </th>
                      <td className="tabela__alinhar--fim numero texto-forte">{formatarMoeda(valorTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div>
                <Botao ref={botaoAdicionar} icone={Plus} onClick={adicionarItem}>
                  Adicionar item
                </Botao>
              </div>
            </>
          ) : (
            <>
              <TabelaItensLeitura itens={dfd.itens} />
              <p className="linha linha--fim">
                Valor total estimado: <strong className="numero">{formatarMoeda(valorTotal)}</strong>
              </p>
            </>
          )}

          <Alternador
            rotulo="Itens identificados no catálogo padronizado (CATMAT/CATSER)"
            ligado={dfd.usaCatalogoPadronizado}
            aoMudar={(v) => alterar('usaCatalogoPadronizado', v)}
            desabilitado={!editavel}
            ajuda="Desmarcar exige justificativa escrita anexada ao processo (Lei 14.133/2021, art. 19, § 2º — RN-02)."
          />
          {!dfd.usaCatalogoPadronizado ? (
            <AreaTexto
              rotulo="Justificativa da não utilização do catálogo padronizado (RN-02)"
              obrigatorio
              rows={3}
              ajuda={`Por que os itens não constam do catálogo eletrônico de padronização. Mínimo de ${MINIMO_TEXTO} caracteres.`}
              value={dfd.justificativaNaoPadronizacao ?? ''}
              onChange={(e) => alterar('justificativaNaoPadronizacao', e.target.value)}
            />
          ) : null}

          <div aria-live="polite">
            {indiciosLuxo.length > 0 ? (
              <Alerta tipo="aviso" titulo={`Indício de artigo de luxo em ${indiciosLuxo.length === 1 ? '1 item' : `${indiciosLuxo.length} itens`} (RN-01)`}>
                <ul>
                  {indiciosLuxo.map((x) => (
                    <li key={x.indice}>
                      Item {x.indice + 1}: termos “{x.resultado.termosEncontrados.join('”, “')}”
                    </li>
                  ))}
                </ul>
                <p>{indiciosLuxo[0]?.resultado.orientacao}</p>
                <p className="texto-pequeno">{indiciosLuxo[0]?.resultado.fundamento}</p>
              </Alerta>
            ) : null}
          </div>
          {indiciosLuxo.length > 0 || (dfd.justificativaArtigoLuxo ?? '') !== '' ? (
            <AreaTexto
              rotulo="Justificativa — bem de qualidade comum ou exceção do Decreto 10.818/2021 (RN-01)"
              obrigatorio={indiciosLuxo.length > 0}
              rows={3}
              ajuda={`Demonstre que a qualidade não supera a necessária para a finalidade. Mínimo de ${MINIMO_TEXTO} caracteres.`}
              value={dfd.justificativaArtigoLuxo ?? ''}
              onChange={(e) => alterar('justificativaArtigoLuxo', e.target.value)}
            />
          ) : null}
        </fieldset>

        <section className="jornada-referencia" aria-labelledby={`${base}-fracionamento`}>
          <h3 id={`${base}-fracionamento`} className="jornada-requisitos__titulo">
            Dispensa por valor e fracionamento (RN-14)
          </h3>
          {fracionamento.ok ? (
            <>
              <p className="linha">
                <Etiqueta tom={SINAL_FRACIONAMENTO[fracionamento.valor.sinal].tom} compacta>
                  {SINAL_FRACIONAMENTO[fracionamento.valor.sinal].rotulo}
                </Etiqueta>
                <span>
                  Valor da demanda <span className="numero">{formatarMoeda(valorTotal)}</span> · limite de dispensa por valor{' '}
                  <span className="numero">{formatarMoeda(fracionamento.valor.limite)}</span>
                  {fracionamento.valor.sinal === 'risco' ? '' : ` (${formatarPercentual(fracionamento.valor.percentualDoLimite)} do limite)`}
                </span>
              </p>
              <p>{SINAL_FRACIONAMENTO[fracionamento.valor.sinal].leitura}</p>
              <p className="texto-pequeno texto-secundario">
                Prévia com o valor desta demanda. O servidor soma as dispensas de mesma natureza da UASG no exercício e registra o sinal
                consolidado em “Sinais”. {fracionamento.valor.fundamento}.
              </p>
            </>
          ) : (
            <p className="texto-secundario">{fracionamento.mensagem}</p>
          )}
          {sinaisServidor.map((s, i) => (
            <Alerta key={`${s.regra}-${i}`} tipo={s.nivel === 'risco' ? 'erro' : s.nivel === 'atencao' ? 'aviso' : 'info'} compacto titulo={`Sinal do servidor (${s.regra})`}>
              <p>{s.mensagem}</p>
            </Alerta>
          ))}
        </section>

        {editavel ? (
          <>
            <Requisitos titulo="Condições para avançar à etapa 2" itens={requisitos} />
            <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar o DFD" />
            <div className="jornada-barra-acoes">
              <p id={`${base}-estado`} className="texto-pequeno texto-secundario" aria-live="polite">
                {alterado ? 'Há alterações não salvas.' : 'Sem alterações pendentes.'}
              </p>
              <div className="linha">
                <Botao variante="terciario" icone={RotateCcw} onClick={descartar} disabled={!alterado || salvar.isPending}>
                  Descartar alterações
                </Botao>
                <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
                  Salvar DFD
                </Botao>
              </div>
            </div>
          </>
        ) : null}
        <p className="sr-only" role="status">
          {anuncio}
        </p>
      </form>

      <PlanejamentoDfd processo={processo} editavel={editavel} formularioAlterado={alterado} aoAtualizarDfd={definirDfd} />

      <DocumentosEtapa
        processo={processo}
        tipos={['dfd']}
        editavel={editavel}
        titulo="Formalização"
        descricao="Gere o DFD a partir dos dados salvos. Após revisão e aprovação, ele entra na árvore do processo SEI para assinatura na etapa 2."
      />
    </div>
  );
}
