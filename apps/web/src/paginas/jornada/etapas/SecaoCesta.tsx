/**
 * Cesta de preços (art. 23 e IN SEGES/ME 65/2021): cotações, estatísticas de `analisarCestaPrecos`,
 * expurgos sugeridos para aceite humano com justificativa (RIA-03) e orçamento sigiloso com motivo (art. 24).
 */
import { useId, useState, type FormEvent } from 'react';
import { CheckCheck, FileSpreadsheet, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { ProcessoDetalhe } from '@agora/contratos';
import { analisarCestaPrecos, diasEntre, formatarData, formatarMoeda, hojeISO, validarDataISO, type Centavos, type Cotacao, type FonteCotacao } from '@agora/dominio';
import { ehAnaliseCesta, useAceitarExpurgos, useSalvarCestaPrecos, type AnaliseCesta, type CotacaoProcesso } from '../../../api/jornada';
import {
  Alerta,
  Alternador,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoMoeda,
  CampoTexto,
  ConfirmarAcao,
  Dialogo,
  Etiqueta,
  Selecao,
  useAvisos,
} from '../../../componentes';
import { formatarNumero, formatarPercentual } from '../../../utilitarios/formatacao';
import { calcular, ErroOperacao, novoId, textoOuNulo } from '../comum';
import { ehFonteCotacao, FONTES_COTACAO, MOTIVOS_EXPURGO, rotuloFonte } from '../rotulos';
import { ImportarCesta } from './ImportarCesta';
import { MINIMO_TEXTO, textoSuficiente, type PropsEtapa } from './tipos';

const LISTA_FONTES = Object.keys(FONTES_COTACAO).filter(ehFonteCotacao);

export interface ResultadoAnalise {
  analise: AnaliseCesta;
  origem: 'servidor' | 'previa';
}

/** Análise registrada pelo servidor; na falta dela, prévia com as cotações válidas (não expurgadas). */
export function analiseDaCesta(cesta: ProcessoDetalhe['cestaPrecos']): ResultadoAnalise | null {
  if (ehAnaliseCesta(cesta.analise)) return { analise: cesta.analise, origem: 'servidor' };
  const cotacoes: Cotacao[] = cesta.cotacoes.flatMap((c) =>
    !c.expurgada && ehFonteCotacao(c.fonte)
      ? [{ id: c.id, fonte: c.fonte, descricaoFonte: c.descricaoFonte, valorUnitario: c.valorUnitario, dataCotacao: c.dataCotacao, justificativaEscolhaFornecedor: c.justificativaEscolhaFornecedor }]
      : [],
  );
  if (cotacoes.length === 0) return null;
  const previa = calcular(() => analisarCestaPrecos(cotacoes, { dataReferencia: hojeISO(new Date()) }));
  return previa.ok ? { analise: previa.valor, origem: 'previa' } : null;
}

function idade(data: string, hoje: string): string {
  if (!validarDataISO(data)) return '';
  const dias = diasEntre(data, hoje);
  if (dias < 0) return 'data futura';
  if (dias < 31) return `há ${dias} dia${dias === 1 ? '' : 's'}`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}

function TabelaEstatisticas({ analise }: { analise: AnaliseCesta }) {
  const b = analise.estatisticas;
  const s = analise.estatisticasSaneadas;
  const linhas: { rotulo: string; bruto: string; saneado: string }[] = [
    { rotulo: 'Preços considerados', bruto: formatarNumero(b.n), saneado: formatarNumero(s.n) },
    { rotulo: 'Média', bruto: formatarMoeda(b.media), saneado: formatarMoeda(s.media) },
    { rotulo: 'Mediana', bruto: formatarMoeda(b.mediana), saneado: formatarMoeda(s.mediana) },
    { rotulo: 'Menor preço', bruto: formatarMoeda(b.menor), saneado: formatarMoeda(s.menor) },
    { rotulo: 'Maior preço', bruto: formatarMoeda(b.maior), saneado: '—' },
    { rotulo: 'Desvio padrão', bruto: formatarMoeda(b.desvioPadrao), saneado: '—' },
    { rotulo: 'Coeficiente de variação', bruto: formatarPercentual(b.coeficienteVariacao), saneado: formatarPercentual(s.coeficienteVariacao) },
  ];
  return (
    <div className="tabela-rolagem" role="region" aria-label="Estatísticas da cesta de preços" tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption className="tabela__legenda">Estatísticas da cesta (valores unitários)</caption>
        <thead>
          <tr>
            <th scope="col">Estatística</th>
            <th scope="col" className="tabela__alinhar--fim">
              Todas as cotações
            </th>
            <th scope="col" className="tabela__alinhar--fim">
              Após saneamento
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <th scope="row">{l.rotulo}</th>
              <td className="tabela__alinhar--fim numero">{l.bruto}</td>
              <td className="tabela__alinhar--fim numero">{l.saneado}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RascunhoCotacao {
  id: string | null;
  fonte: FonteCotacao | '';
  descricaoFonte: string;
  valorUnitario: Centavos | null;
  dataCotacao: string;
  justificativa: string;
}

const COTACAO_VAZIA: RascunhoCotacao = { id: null, fonte: '', descricaoFonte: '', valorUnitario: null, dataCotacao: '', justificativa: '' };

export function SecaoCesta({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarCestaPrecos(processo.id);
  const expurgar = useAceitarExpurgos(processo.id);
  const cesta = processo.cestaPrecos;
  const hoje = hojeISO(new Date());
  const resultado = analiseDaCesta(cesta);
  const validas = cesta.cotacoes.filter((c) => !c.expurgada);
  const sugestoes = (resultado?.analise.sugeridasExpurgo ?? []).filter((s) => validas.some((c) => c.id === s.id));

  const [importando, definirImportando] = useState(false);
  const [rascunho, definirRascunho] = useState<RascunhoCotacao | null>(null);
  const [tentou, definirTentou] = useState(false);
  const [remover, definirRemover] = useState<CotacaoProcesso | null>(null);
  const [aceitas, definirAceitas] = useState<string[]>([]);
  const [justificativaExpurgo, definirJustificativaExpurgo] = useState('');
  const [tentouExpurgo, definirTentouExpurgo] = useState(false);
  const [confirmarExpurgo, definirConfirmarExpurgo] = useState(false);
  const [sigiloso, definirSigiloso] = useState(cesta.orcamentoSigiloso);
  const [motivoSigilo, definirMotivoSigilo] = useState(cesta.motivoSigilo ?? '');
  const [tentouSigilo, definirTentouSigilo] = useState(false);
  const sigiloAlterado = sigiloso !== cesta.orcamentoSigiloso || (sigiloso && motivoSigilo.trim() !== (cesta.motivoSigilo ?? ''));

  const gravarCotacoes = (cotacoes: CotacaoProcesso[], aoConcluir: () => void, mensagem: string) =>
    salvar.mutate(
      { cotacoes, orcamentoSigiloso: cesta.orcamentoSigiloso, motivoSigilo: cesta.motivoSigilo },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Cesta de preços atualizada', mensagem });
          aoConcluir();
        },
      },
    );

  const abrir = (c: CotacaoProcesso | null) => {
    salvar.reset();
    definirTentou(false);
    definirRascunho(
      c
        ? {
            id: c.id,
            fonte: ehFonteCotacao(c.fonte) ? c.fonte : '',
            descricaoFonte: c.descricaoFonte,
            valorUnitario: c.valorUnitario,
            dataCotacao: c.dataCotacao,
            justificativa: c.justificativaEscolhaFornecedor ?? '',
          }
        : COTACAO_VAZIA,
    );
  };

  const errosCotacao = rascunho
    ? {
        fonte: rascunho.fonte === '' ? 'Selecione a fonte do preço.' : null,
        descricaoFonte: rascunho.descricaoFonte.trim() === '' ? 'Identifique a fonte (contratação, fornecedor ou publicação).' : null,
        valorUnitario: rascunho.valorUnitario === null || rascunho.valorUnitario <= 0 ? 'Informe um valor unitário maior que zero.' : null,
        dataCotacao: !validarDataISO(rascunho.dataCotacao)
          ? 'Informe a data da cotação.'
          : rascunho.dataCotacao > hoje
            ? 'A data da cotação não pode ser futura.'
            : null,
        justificativa:
          rascunho.fonte === 'fornecedor_direto' && rascunho.justificativa.trim() === ''
            ? 'Pesquisa direta exige justificativa da escolha do fornecedor (art. 23, § 1º, IV).'
            : null,
      }
    : null;

  const gravarCotacao = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (!rascunho || !errosCotacao || Object.values(errosCotacao).some(Boolean)) return;
    if (rascunho.fonte === '' || rascunho.valorUnitario === null) return;
    const anterior = rascunho.id ? cesta.cotacoes.find((c) => c.id === rascunho.id) : undefined;
    const justificativa = textoOuNulo(rascunho.justificativa);
    const cotacao: CotacaoProcesso = {
      id: rascunho.id ?? novoId(),
      fonte: rascunho.fonte,
      descricaoFonte: rascunho.descricaoFonte.trim(),
      valorUnitario: rascunho.valorUnitario,
      dataCotacao: rascunho.dataCotacao,
      ...(justificativa ? { justificativaEscolhaFornecedor: justificativa } : {}),
      expurgada: anterior?.expurgada ?? false,
      motivoExpurgo: anterior?.motivoExpurgo ?? null,
    };
    const lista = rascunho.id ? cesta.cotacoes.map((c) => (c.id === rascunho.id ? cotacao : c)) : [...cesta.cotacoes, cotacao];
    gravarCotacoes(lista, () => definirRascunho(null), rascunho.id ? 'Cotação atualizada; a análise foi recalculada.' : 'Cotação incluída; a análise foi recalculada.');
  };

  const erroJustificativaExpurgo = textoSuficiente(justificativaExpurgo) ? null : `Justifique a exclusão com pelo menos ${MINIMO_TEXTO} caracteres.`;
  const erroMotivoSigilo = sigiloso && !textoSuficiente(motivoSigilo) ? `Informe o motivo do sigilo com pelo menos ${MINIMO_TEXTO} caracteres.` : null;
  const avisoIdade =
    rascunho && validarDataISO(rascunho.dataCotacao) && rascunho.fonte !== ''
      ? (() => {
          const dias = diasEntre(rascunho.dataCotacao, hoje);
          if (rascunho.fonte === 'contratacao_similar' && dias > 365) return 'Contratação similar com mais de 1 ano (art. 23, § 1º, II).';
          if ((rascunho.fonte === 'fornecedor_direto' || rascunho.fonte === 'midia_especializada') && dias > 180) return 'Cotação com mais de 6 meses (art. 23, § 1º, III e IV).';
          return null;
        })()
      : null;
  const idFormulario = `${base}-cotacao`;

  return (
    <section className="secao jornada-subsecao" id="etapa3-cesta" aria-labelledby={`${base}-titulo`}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Cesta de preços
          </h3>
          <p className="secao__descricao">Lei 14.133/2021, art. 23, § 1º; IN SEGES/ME 65/2021. Mínimo de 3 preços válidos após os expurgos.</p>
        </div>
        {editavel ? (
          <div className="secao__acoes">
            <Botao icone={FileSpreadsheet} variante="terciario" onClick={() => definirImportando(true)}>
              Importar planilha
            </Botao>
            <Botao icone={Plus} onClick={() => abrir(null)}>
              Incluir cotação
            </Botao>
          </div>
        ) : null}
      </div>
      {editavel ? (
        <ImportarCesta processoId={processo.id} aberto={importando} aoFechar={() => definirImportando(false)} cotacoesAtuais={cesta.cotacoes.length} />
      ) : null}

      {cesta.cotacoes.length === 0 ? (
        <p className="texto-secundario">Nenhuma cotação registrada.</p>
      ) : (
        <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-legenda`} tabIndex={0}>
          <table className="tabela tabela--compacta">
            <caption id={`${base}-legenda`} className="tabela__legenda">
              Cotações ({formatarNumero(validas.length)} válidas de {formatarNumero(cesta.cotacoes.length)})
            </caption>
            <thead>
              <tr>
                <th scope="col">Fonte</th>
                <th scope="col">Identificação</th>
                <th scope="col" className="tabela__alinhar--fim">
                  Valor unitário
                </th>
                <th scope="col">Data</th>
                <th scope="col">Situação</th>
                {editavel ? (
                  <th scope="col" className="tabela__alinhar--fim">
                    Ações
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {cesta.cotacoes.map((c) => {
                const sugerida = sugestoes.find((s) => s.id === c.id);
                return (
                  <tr key={c.id} className={c.expurgada ? 'jornada-linha-expurgada' : sugerida ? 'tabela__linha--aviso' : undefined}>
                    <th scope="row">
                      <span className="pilha pilha--compacta">
                        <span>{rotuloFonte(c.fonte, true)}</span>
                        <span className="texto-pequeno texto-secundario">{ehFonteCotacao(c.fonte) ? FONTES_COTACAO[c.fonte].fundamento : ''}</span>
                      </span>
                    </th>
                    <td className="jornada-celula-texto">
                      {c.descricaoFonte}
                      {c.justificativaEscolhaFornecedor ? (
                        <span className="texto-pequeno texto-secundario jornada-bloco">Justificativa: {c.justificativaEscolhaFornecedor}</span>
                      ) : c.fonte === 'fornecedor_direto' ? (
                        <span className="campo__erro">Sem justificativa da escolha do fornecedor</span>
                      ) : null}
                    </td>
                    <td className="tabela__alinhar--fim numero">{formatarMoeda(c.valorUnitario)}</td>
                    <td>
                      <span className="pilha pilha--compacta">
                        <span className="numero">{validarDataISO(c.dataCotacao) ? formatarData(c.dataCotacao) : c.dataCotacao}</span>
                        <span className="texto-pequeno texto-secundario">{idade(c.dataCotacao, hoje)}</span>
                      </span>
                    </td>
                    <td>
                      {c.expurgada ? (
                        <span className="pilha pilha--compacta">
                          <Etiqueta tom="neutro" compacta>
                            Expurgada
                          </Etiqueta>
                          {c.motivoExpurgo ? <span className="texto-pequeno">{c.motivoExpurgo}</span> : null}
                        </span>
                      ) : sugerida ? (
                        <Etiqueta tom="aviso" compacta>
                          Expurgo sugerido
                        </Etiqueta>
                      ) : (
                        <Etiqueta tom="sucesso" compacta>
                          Válida
                        </Etiqueta>
                      )}
                    </td>
                    {editavel ? (
                      <td className="tabela__celula--acoes tabela__alinhar--fim">
                        {c.expurgada ? null : (
                          <>
                            <Botao
                              variante="terciario"
                              tamanho="compacto"
                              somenteIcone
                              icone={Pencil}
                              aria-label={`Editar cotação: ${c.descricaoFonte}`}
                              onClick={() => abrir(c)}
                            />
                            <Botao
                              variante="terciario"
                              tamanho="compacto"
                              somenteIcone
                              icone={Trash2}
                              aria-label={`Remover cotação: ${c.descricaoFonte}`}
                              onClick={() => {
                                salvar.reset();
                                definirRemover(c);
                              }}
                            />
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resultado ? (
        <div className="pilha" aria-live="polite">
          <p className="linha">
            <Etiqueta tom={resultado.origem === 'servidor' ? 'info' : 'neutro'} compacta>
              {resultado.origem === 'servidor' ? 'Análise registrada no processo' : 'Prévia calculada neste navegador'}
            </Etiqueta>
            <span>
              Metodologia recomendada: <strong>{resultado.analise.metodologiaRecomendada === 'media' ? 'média' : 'mediana'}</strong> (CV saneado{' '}
              {resultado.analise.metodologiaRecomendada === 'media' ? 'até' : 'acima de'} 25%) · valor unitário estimado{' '}
              <strong className="numero">{cesta.orcamentoSigiloso ? `${formatarMoeda(resultado.analise.valorEstimado)} (sigiloso)` : formatarMoeda(resultado.analise.valorEstimado)}</strong>
            </span>
          </p>
          <TabelaEstatisticas analise={resultado.analise} />
          {resultado.analise.alertas.length > 0 ? (
            <Alerta tipo="aviso" titulo="Alertas da pesquisa de preços (RN-05)">
              <ul>
                {resultado.analise.alertas.map((a, i) => (
                  <li key={`${a.codigo}-${i}`}>
                    {a.mensagem} <span className="texto-pequeno">({a.fundamento})</span>
                  </li>
                ))}
              </ul>
            </Alerta>
          ) : null}
          <p className="texto-pequeno texto-secundario">{resultado.analise.aviso}</p>
        </div>
      ) : (
        <p className="texto-secundario">A análise estatística aparece após a inclusão de cotações válidas.</p>
      )}

      {sugestoes.length > 0 ? (
        <fieldset className="grupo-campos" disabled={!editavel}>
          <legend>Expurgos sugeridos (RIA-03)</legend>
          {editavel && sugestoes.length > 1 ? (
            <div>
              <Botao
                variante="terciario"
                tamanho="compacto"
                icone={CheckCheck}
                disabled={sugestoes.every((s) => aceitas.includes(s.id))}
                onClick={() => definirAceitas(sugestoes.map((s) => s.id))}
              >
                Marcar todas as sugestões
              </Botao>
            </div>
          ) : null}
          {sugestoes.map((s) => {
            const cotacao = validas.find((c) => c.id === s.id);
            return (
              <CaixaSelecao
                key={s.id}
                rotulo={`${cotacao ? `${rotuloFonte(cotacao.fonte)} — ${formatarMoeda(cotacao.valorUnitario)}` : s.id}: ${MOTIVOS_EXPURGO[s.motivo]}`}
                ajuda={s.explicacao}
                checked={aceitas.includes(s.id)}
                onChange={(e) => definirAceitas((atuais) => (e.target.checked ? [...atuais, s.id] : atuais.filter((id) => id !== s.id)))}
              />
            );
          })}
          {editavel ? (
            <>
              <AreaTexto
                rotulo="Justificativa da exclusão"
                obrigatorio
                rows={3}
                value={justificativaExpurgo}
                erro={tentouExpurgo ? erroJustificativaExpurgo : null}
                onChange={(e) => definirJustificativaExpurgo(e.target.value)}
                ajuda="Por que os preços selecionados não refletem o mercado (inexequíveis ou excessivamente elevados)."
              />
              <div>
                <Botao
                  variante="secundario"
                  disabled={aceitas.length === 0}
                  onClick={() => {
                    definirTentouExpurgo(true);
                    if (erroJustificativaExpurgo) return;
                    expurgar.reset();
                    definirConfirmarExpurgo(true);
                  }}
                >
                  Aceitar {aceitas.length === 0 ? 'expurgos selecionados' : aceitas.length === 1 ? '1 expurgo' : `${aceitas.length} expurgos`}
                </Botao>
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="grupo-campos" disabled={!editavel}>
        <legend>Orçamento sigiloso (art. 24)</legend>
        <Alternador
          rotulo="Manter o orçamento estimado em sigilo"
          ligado={sigiloso}
          aoMudar={definirSigiloso}
          desabilitado={!editavel}
          ajuda="O sigilo não alcança os órgãos de controle e não impede a divulgação dos quantitativos e das demais informações para elaborar propostas."
        />
        {sigiloso ? (
          <AreaTexto
            rotulo="Motivo do sigilo"
            obrigatorio
            rows={3}
            value={motivoSigilo}
            erro={tentouSigilo ? erroMotivoSigilo : null}
            onChange={(e) => definirMotivoSigilo(e.target.value)}
          />
        ) : null}
        {editavel ? (
          <div>
            <Botao
              icone={Save}
              disabled={!sigiloAlterado}
              carregando={salvar.isPending && rascunho === null && remover === null}
              onClick={() => {
                definirTentouSigilo(true);
                if (erroMotivoSigilo) return;
                salvar.mutate(
                  { cotacoes: cesta.cotacoes, orcamentoSigiloso: sigiloso, motivoSigilo: sigiloso ? textoOuNulo(motivoSigilo) : null },
                  { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Sigilo do orçamento atualizado', mensagem: sigiloso ? 'O orçamento estimado é sigiloso.' : 'O orçamento estimado é público.' }) },
                );
              }}
            >
              Salvar opção de sigilo
            </Botao>
          </div>
        ) : null}
        {rascunho === null && remover === null ? <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar a cesta de preços" /> : null}
      </fieldset>

      <Dialogo
        aberto={rascunho !== null}
        aoFechar={() => definirRascunho(null)}
        titulo={rascunho?.id ? 'Editar cotação' : 'Incluir cotação'}
        largura="ampla"
        descricao={<p>A cotação é gravada na cesta e a análise estatística é recalculada.</p>}
        rodape={
          <>
            <Botao variante="secundario" onClick={() => definirRascunho(null)} disabled={salvar.isPending}>
              Cancelar
            </Botao>
            <Botao variante="primario" type="submit" form={idFormulario} carregando={salvar.isPending}>
              {rascunho?.id ? 'Salvar cotação' : 'Incluir cotação'}
            </Botao>
          </>
        }
      >
        {rascunho && errosCotacao ? (
          <form id={idFormulario} className="formulario" onSubmit={gravarCotacao} noValidate>
            <Selecao
              rotulo="Fonte do preço"
              obrigatorio
              opcaoVazia="Selecione…"
              opcoes={LISTA_FONTES.map((f) => ({ valor: f, rotulo: `${FONTES_COTACAO[f].rotulo} (${FONTES_COTACAO[f].fundamento})` }))}
              value={rascunho.fonte}
              erro={tentou ? errosCotacao.fonte : null}
              onChange={(e) => {
                const v = e.target.value;
                definirRascunho({ ...rascunho, fonte: ehFonteCotacao(v) ? v : '' });
              }}
            />
            <CampoTexto
              rotulo="Identificação da fonte"
              obrigatorio
              value={rascunho.descricaoFonte}
              erro={tentou ? errosCotacao.descricaoFonte : null}
              onChange={(e) => definirRascunho({ ...rascunho, descricaoFonte: e.target.value })}
              ajuda="Ex.: contrato e UASG da contratação similar; razão social do fornecedor; publicação e data e hora de acesso."
            />
            <div className="formulario__linha">
              <CampoMoeda
                rotulo="Valor unitário"
                obrigatorio
                valor={rascunho.valorUnitario}
                erro={tentou ? errosCotacao.valorUnitario : null}
                aoMudar={(v) => definirRascunho({ ...rascunho, valorUnitario: v })}
              />
              <CampoTexto
                rotulo="Data da cotação"
                obrigatorio
                type="date"
                max={hoje}
                value={rascunho.dataCotacao}
                erro={tentou ? errosCotacao.dataCotacao : null}
                onChange={(e) => definirRascunho({ ...rascunho, dataCotacao: e.target.value })}
              />
            </div>
            {avisoIdade ? (
              <Alerta tipo="aviso" compacto>
                <p>{avisoIdade}</p>
              </Alerta>
            ) : null}
            <AreaTexto
              rotulo="Justificativa da escolha do fornecedor"
              obrigatorio={rascunho.fonte === 'fornecedor_direto'}
              rows={3}
              value={rascunho.justificativa}
              erro={tentou ? errosCotacao.justificativa : null}
              onChange={(e) => definirRascunho({ ...rascunho, justificativa: e.target.value })}
              ajuda="Obrigatória na pesquisa direta com fornecedores (art. 23, § 1º, IV)."
            />
            <ErroOperacao erro={salvar.error} titulo="Não foi possível gravar a cotação" />
          </form>
        ) : null}
      </Dialogo>

      <ConfirmarAcao
        aberto={remover !== null}
        aoFechar={() => definirRemover(null)}
        titulo="Remover cotação"
        variante="perigo"
        descricao={
          remover ? (
            <p>
              Remove da cesta a cotação de {formatarMoeda(remover.valorUnitario)} ({remover.descricaoFonte}). Para afastar um preço discrepante
              mantendo o registro, prefira o expurgo justificado.
            </p>
          ) : null
        }
        rotuloConfirmar="Remover cotação"
        aoConfirmar={() => {
          if (!remover) return;
          const alvo = remover.id;
          gravarCotacoes(
            cesta.cotacoes.filter((c) => c.id !== alvo),
            () => definirRemover(null),
            'Cotação removida; a análise foi recalculada.',
          );
        }}
        processando={salvar.isPending}
        erro={salvar.error}
      />

      <ConfirmarAcao
        aberto={confirmarExpurgo}
        aoFechar={() => definirConfirmarExpurgo(false)}
        titulo="Confirmar expurgo de preços"
        descricao={
          <p>
            Exclui da cesta {aceitas.length === 1 ? '1 preço sugerido' : `${aceitas.length} preços sugeridos`} pela análise estatística. A
            justificativa fica registrada no processo e na trilha de auditoria.
          </p>
        }
        rotuloConfirmar="Confirmar expurgo"
        aoConfirmar={() =>
          expurgar.mutate(
            { aceitar: aceitas, justificativa: justificativaExpurgo.trim() },
            {
              onSuccess: () => {
                avisar({ tipo: 'sucesso', titulo: 'Expurgo registrado', mensagem: 'Os preços foram excluídos e a análise foi recalculada.' });
                definirConfirmarExpurgo(false);
                definirAceitas([]);
                definirJustificativaExpurgo('');
                definirTentouExpurgo(false);
              },
            },
          )
        }
        processando={expurgar.isPending}
        erro={expurgar.error}
      />
    </section>
  );
}
