/**
 * Aba "IMR e medições" do contrato (RF-29): indicadores do instrumento de medição de resultado com meta, forma de
 * cálculo, periodicidade, fonte e faixas de glosa; medições por competência, com evidência e memória de cálculo; e a
 * situação da nota fiscal de cada competência (RN-36). O servidor calcula e decide; a tela mostra e coleta.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Ban, Gauge, PencilLine, Plus, Ruler, Trash2 } from 'lucide-react';
import type {
  ContratoDetalhe,
  EntradaIndicadorImr,
  FaixaAjusteImr,
  FormaCalculoImr,
  ImrContrato,
  IndicadorImrContrato,
  MedicaoImr,
  PeriodicidadeImr,
  SentidoMetaImr,
} from '@agora/contratos';
import { useEncerrarIndicadorImr, useImrContrato, useIncluirIndicadorImr, useAlterarIndicadorImr, useRegistrarMedicaoImr } from '../../api/imr';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  ListaDefinicoes,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarCompetencia, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { SITUACOES_CONFERENCIA } from '../financeiro/rotulosImr';
import '../financeiro/imr.css';

const PERIODICIDADES: Record<PeriodicidadeImr, string> = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral' };
const LISTA_PERIODICIDADES: readonly PeriodicidadeImr[] = ['mensal', 'bimestral', 'trimestral', 'semestral'];

function unidadeDe(i: { unidade: string }): string {
  return i.unidade === '%' ? '%' : ` ${i.unidade}`;
}

function descreverMeta(i: Pick<IndicadorImrContrato, 'sentidoMeta' | 'meta' | 'unidade'>): string {
  return `${i.sentidoMeta === 'maior_igual' ? 'Pelo menos' : 'No máximo'} ${formatarNumero(i.meta)}${unidadeDe(i)}`;
}

function descreverFaixa(i: Pick<IndicadorImrContrato, 'sentidoMeta' | 'unidade'>, f: FaixaAjusteImr): string {
  const condicao = `${i.sentidoMeta === 'maior_igual' ? 'Abaixo de' : 'Acima de'} ${formatarNumero(f.limite)}${unidadeDe(i)}`;
  const partes: string[] = [];
  if (f.percentualGlosa > 0) partes.push(`glosa de ${formatarNumero(f.percentualGlosa)}%`);
  if (f.percentualPorUnidade > 0) partes.push(`${formatarNumero(f.percentualPorUnidade)}% por unidade além do limite`);
  if (f.encaminharSancionatorio) partes.push('encaminhamento para avaliar processo sancionatório');
  return `${condicao}: ${partes.join(' + ')}`;
}

function descreverResultado(m: MedicaoImr): string {
  return `${formatarNumero(m.resultado)}${m.indicador.unidade === '%' ? '%' : ` ${m.indicador.unidade}`}`;
}

/** Número digitado em pt-BR ("97,5") ou null se inválido. */
function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

function textoNumero(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

// ───────────────────────── medição ─────────────────────────

function DialogoMedicao({ imr, aberto, aoFechar }: { imr: ImrContrato; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarMedicaoImr(imr.contrato.id);
  const opcoes = imr.competencias.flatMap((c) => c.pendentes.map((p) => ({ valor: `${p.id}|${c.competencia}`, rotulo: `${p.codigo} — ${p.nome} — ${formatarCompetencia(c.competencia)}` })));
  const [escolha, definirEscolha] = useState(opcoes[0]?.valor ?? '');
  const [numerador, definirNumerador] = useState('');
  const [denominador, definirDenominador] = useState('');
  const [valor, definirValor] = useState('');
  const [evidencia, definirEvidencia] = useState('');
  const [referencia, definirReferencia] = useState('');
  const [observacao, definirObservacao] = useState('');
  const [tentou, definirTentou] = useState(false);
  const [indicadorId, competencia] = escolha.split('|');
  const indicador = imr.indicadores.find((i) => i.id === indicadorId);
  const percentual = indicador?.formaCalculo === 'percentual_razao';
  const erros = {
    escolha: escolha === '' ? 'Escolha a medição pendente.' : null,
    numerador: percentual && lerNumero(numerador) === null ? 'Informe o numerador.' : null,
    denominador: percentual && (lerNumero(denominador) ?? 0) <= 0 ? 'Informe o denominador, maior que zero.' : null,
    valor: !percentual && lerNumero(valor) === null ? 'Informe o valor medido.' : null,
    evidencia: evidencia.trim().length < 10 ? 'Descreva a evidência com pelo menos 10 caracteres.' : null,
  };
  const idFormulario = 'formulario-medicao-imr';

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (Object.values(erros).some(Boolean) || !indicadorId || !competencia) return;
    registrar.mutate(
      {
        indicadorId,
        competencia,
        numerador: percentual ? lerNumero(numerador) : null,
        denominador: percentual ? lerNumero(denominador) : null,
        valor: percentual ? null : lerNumero(valor),
        evidencia: evidencia.trim(),
        referenciaEvidencia: referencia.trim() || null,
        observacao: observacao.trim() || null,
      },
      {
        onSuccess: (r) => {
          const m = r.medicao;
          avisar({
            tipo: m.atingiuMeta ? 'sucesso' : 'aviso',
            titulo: 'Medição registrada',
            mensagem: m.atingiuMeta
              ? `${m.indicador.codigo} em ${formatarCompetencia(m.competencia)}: ${descreverResultado(m)}, meta atingida.`
              : `${m.indicador.codigo} em ${formatarCompetencia(m.competencia)}: ${descreverResultado(m)}, glosa de ${formatarNumero(m.percentualGlosa)}%${r.pendenciaAberta ? '. Pendência aberta para o gestor avaliar o encaminhamento sancionatório' : ''}.`,
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
      titulo={`Registrar medição do IMR — Contrato ${imr.contrato.numero}`}
      largura="ampla"
      descricao={<p>A Ágora calcula o resultado e a glosa pelas faixas do indicador e grava a memória de cálculo na trilha de auditoria.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar medição
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <Selecao rotulo="Medição pendente" obrigatorio opcoes={opcoes} value={escolha} erro={tentou ? erros.escolha : null} onChange={(e) => definirEscolha(e.target.value)} />
        {indicador ? (
          <p className="texto-pequeno texto-secundario">
            Meta: {descreverMeta(indicador)}. Cálculo: {indicador.descricaoCalculo} Fonte: {indicador.fonteMedicao}.
          </p>
        ) : null}
        {percentual ? (
          <div className="formulario__linha">
            <CampoTexto
              rotulo={indicador?.rotuloNumerador ?? 'Numerador'}
              obrigatorio
              inputMode="decimal"
              value={numerador}
              erro={tentou ? erros.numerador : null}
              onChange={(e) => definirNumerador(e.target.value)}
            />
            <CampoTexto
              rotulo={indicador?.rotuloDenominador ?? 'Denominador'}
              obrigatorio
              inputMode="decimal"
              value={denominador}
              erro={tentou ? erros.denominador : null}
              onChange={(e) => definirDenominador(e.target.value)}
            />
          </div>
        ) : (
          <CampoTexto rotulo={`Valor medido (${indicador?.unidade ?? ''})`} obrigatorio inputMode="decimal" value={valor} erro={tentou ? erros.valor : null} onChange={(e) => definirValor(e.target.value)} />
        )}
        <AreaTexto
          rotulo="Evidência da medição"
          obrigatorio
          rows={3}
          maxLength={2000}
          contador
          value={evidencia}
          erro={tentou ? erros.evidencia : null}
          onChange={(e) => definirEvidencia(e.target.value)}
          ajuda="De onde vêm os números: relatório, sistema, registro de ocorrências ou vistoria."
        />
        <CampoTexto rotulo="Referência do documento (opcional)" maxLength={200} value={referencia} onChange={(e) => definirReferencia(e.target.value)} ajuda="Por exemplo, o número do documento no SEI." />
        <AreaTexto rotulo="Observação (opcional)" rows={2} maxLength={2000} value={observacao} onChange={(e) => definirObservacao(e.target.value)} />
        <ErroOperacao erro={registrar.error} titulo="A medição não foi registrada" />
      </form>
    </Dialogo>
  );
}

// ───────────────────────── configuração de indicador ─────────────────────────

interface RascunhoFaixa {
  chave: number;
  limite: string;
  percentualGlosa: string;
  percentualPorUnidade: string;
  encaminharSancionatorio: boolean;
}

function DialogoIndicador({ imr, indicador, aberto, aoFechar }: { imr: ImrContrato; indicador: IndicadorImrContrato | null; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const incluir = useIncluirIndicadorImr(imr.contrato.id);
  const alterar = useAlterarIndicadorImr(imr.contrato.id);
  const operacao = indicador ? alterar : incluir;
  const proximoCodigo = `IND-${String(imr.indicadores.length + 1).padStart(2, '0')}`;
  const [codigo, definirCodigo] = useState(indicador?.codigo ?? proximoCodigo);
  const [nome, definirNome] = useState(indicador?.nome ?? '');
  const [forma, definirForma] = useState<FormaCalculoImr>(indicador?.formaCalculo ?? 'percentual_razao');
  const [descricao, definirDescricao] = useState(indicador?.descricaoCalculo ?? '');
  const [rotuloNumerador, definirRotuloNumerador] = useState(indicador?.rotuloNumerador ?? '');
  const [rotuloDenominador, definirRotuloDenominador] = useState(indicador?.rotuloDenominador ?? '');
  const [unidade, definirUnidade] = useState(indicador && indicador.unidade !== '%' ? indicador.unidade : '');
  const [sentido, definirSentido] = useState<SentidoMetaImr>(indicador?.sentidoMeta ?? 'maior_igual');
  const [meta, definirMeta] = useState(textoNumero(indicador?.meta));
  const [periodicidade, definirPeriodicidade] = useState<PeriodicidadeImr>(indicador?.periodicidade ?? 'mensal');
  const [inicio, definirInicio] = useState(indicador?.inicioCompetencia ?? '');
  const [fonte, definirFonte] = useState(indicador?.fonteMedicao ?? '');
  const [itens, definirItens] = useState<string[]>(indicador?.itensAlcancados.map((i) => i.id) ?? []);
  const [teto, definirTeto] = useState(textoNumero(indicador?.tetoPercentual));
  const [faixas, definirFaixas] = useState<RascunhoFaixa[]>(
    indicador?.faixas.map((f, n) => ({
      chave: n,
      limite: textoNumero(f.limite),
      percentualGlosa: textoNumero(f.percentualGlosa),
      percentualPorUnidade: textoNumero(f.percentualPorUnidade),
      encaminharSancionatorio: f.encaminharSancionatorio,
    })) ?? [{ chave: 0, limite: '', percentualGlosa: '', percentualPorUnidade: '0', encaminharSancionatorio: false }],
  );
  const [tentou, definirTentou] = useState(false);
  const idFormulario = 'formulario-indicador-imr';
  const percentual = forma === 'percentual_razao';

  const faixasLidas = faixas.map((f) => ({
    limite: lerNumero(f.limite),
    percentualGlosa: lerNumero(f.percentualGlosa) ?? 0,
    percentualPorUnidade: lerNumero(f.percentualPorUnidade) ?? 0,
    encaminharSancionatorio: f.encaminharSancionatorio,
  }));
  const erros = {
    codigo: codigo.trim() === '' ? 'Informe o código.' : null,
    nome: nome.trim().length < 3 ? 'Informe o nome do indicador.' : null,
    descricao: descricao.trim().length < 10 ? 'Descreva o mecanismo de cálculo (pelo menos 10 caracteres).' : null,
    rotuloNumerador: percentual && rotuloNumerador.trim().length < 2 ? 'Diga o que é o numerador.' : null,
    rotuloDenominador: percentual && rotuloDenominador.trim().length < 2 ? 'Diga o que é o denominador.' : null,
    unidade: !percentual && unidade.trim() === '' ? 'Informe a unidade (ex.: horas).' : null,
    meta: lerNumero(meta) === null ? 'Informe a meta.' : null,
    inicio: !/^\d{4}-\d{2}$/.test(inicio) ? 'Informe a primeira competência medida.' : null,
    fonte: fonte.trim().length < 5 ? 'Informe a fonte da medição.' : null,
    faixas: faixasLidas.some((f) => f.limite === null) ? 'Informe o limite de cada faixa.' : null,
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (Object.values(erros).some(Boolean)) return;
    const entrada: EntradaIndicadorImr = {
      codigo: codigo.trim(),
      nome: nome.trim(),
      formaCalculo: forma,
      descricaoCalculo: descricao.trim(),
      rotuloNumerador: percentual ? rotuloNumerador.trim() : null,
      rotuloDenominador: percentual ? rotuloDenominador.trim() : null,
      unidade: percentual ? '%' : unidade.trim(),
      sentidoMeta: sentido,
      meta: lerNumero(meta) ?? 0,
      periodicidade,
      inicioCompetencia: inicio,
      fonteMedicao: fonte.trim(),
      itensAlcancados: itens,
      faixas: faixasLidas.map((f) => ({ ...f, limite: f.limite ?? 0 })),
      tetoPercentual: lerNumero(teto),
    };
    const sucesso = () => {
      avisar({ tipo: 'sucesso', titulo: indicador ? 'Indicador alterado' : 'Indicador incluído', mensagem: `${entrada.codigo} — ${entrada.nome}. A alteração fica na trilha de auditoria.` });
      aoFechar();
    };
    if (indicador) alterar.mutate({ indicadorId: indicador.id, entrada }, { onSuccess: sucesso });
    else incluir.mutate(entrada, { onSuccess: sucesso });
  };

  const mudarFaixa = (chave: number, mudanca: Partial<RascunhoFaixa>) => definirFaixas((lista) => lista.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f)));

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={indicador ? `Alterar indicador ${indicador.codigo}` : `Incluir indicador no IMR — Contrato ${imr.contrato.numero}`}
      largura="ampla"
      descricao={<p>Use a estrutura prevista no termo de referência do contrato: meta, forma de cálculo, periodicidade, fonte e faixas de ajuste do pagamento.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={operacao.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={operacao.isPending}>
            {indicador ? 'Salvar indicador' : 'Incluir indicador'}
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <div className="formulario__linha">
          <CampoTexto rotulo="Código" obrigatorio maxLength={20} value={codigo} erro={tentou ? erros.codigo : null} onChange={(e) => definirCodigo(e.target.value)} />
          <CampoTexto rotulo="Nome do indicador" obrigatorio maxLength={200} value={nome} erro={tentou ? erros.nome : null} onChange={(e) => definirNome(e.target.value)} />
        </div>
        <GrupoOpcoes
          legenda="Forma de cálculo"
          nome="forma-calculo-imr"
          horizontal
          valor={forma}
          aoMudar={definirForma}
          opcoes={[
            { valor: 'percentual_razao', rotulo: 'Percentual (numerador ÷ denominador × 100)' },
            { valor: 'valor_medido', rotulo: 'Valor medido (horas, ocorrências...)' },
          ]}
        />
        {percentual ? (
          <div className="formulario__linha">
            <CampoTexto rotulo="O que é o numerador" obrigatorio maxLength={120} value={rotuloNumerador} erro={tentou ? erros.rotuloNumerador : null} onChange={(e) => definirRotuloNumerador(e.target.value)} />
            <CampoTexto rotulo="O que é o denominador" obrigatorio maxLength={120} value={rotuloDenominador} erro={tentou ? erros.rotuloDenominador : null} onChange={(e) => definirRotuloDenominador(e.target.value)} />
          </div>
        ) : (
          <CampoTexto rotulo="Unidade do resultado" obrigatorio maxLength={30} value={unidade} erro={tentou ? erros.unidade : null} onChange={(e) => definirUnidade(e.target.value)} />
        )}
        <AreaTexto rotulo="Mecanismo de cálculo" obrigatorio rows={2} maxLength={1000} value={descricao} erro={tentou ? erros.descricao : null} onChange={(e) => definirDescricao(e.target.value)} />
        <GrupoOpcoes
          legenda="A meta é atingida quando o resultado é"
          nome="sentido-meta-imr"
          horizontal
          valor={sentido}
          aoMudar={definirSentido}
          opcoes={[
            { valor: 'maior_igual', rotulo: 'Igual ou maior que a meta' },
            { valor: 'menor_igual', rotulo: 'Igual ou menor que a meta' },
          ]}
        />
        <div className="formulario__linha">
          <CampoTexto rotulo={`Meta${percentual ? ' (%)' : ''}`} obrigatorio inputMode="decimal" value={meta} erro={tentou ? erros.meta : null} onChange={(e) => definirMeta(e.target.value)} />
          <Selecao
            rotulo="Periodicidade"
            obrigatorio
            opcoes={LISTA_PERIODICIDADES.map((p) => ({ valor: p, rotulo: PERIODICIDADES[p] }))}
            value={periodicidade}
            onChange={(e) => {
              const p = LISTA_PERIODICIDADES.find((x) => x === e.target.value);
              if (p) definirPeriodicidade(p);
            }}
          />
          <CampoTexto rotulo="Primeira competência medida" obrigatorio type="month" value={inicio} erro={tentou ? erros.inicio : null} onChange={(e) => definirInicio(e.target.value)} />
        </div>
        <CampoTexto rotulo="Fonte da medição" obrigatorio maxLength={500} value={fonte} erro={tentou ? erros.fonte : null} onChange={(e) => definirFonte(e.target.value)} />
        <fieldset className="imr-faixa pilha pilha--compacta">
          <legend>Itens que formam a base da glosa</legend>
          <p className="texto-pequeno texto-secundario">Sem marcação, a glosa incide sobre todos os itens da nota.</p>
          {imr.itensContrato.map((i) => (
            <CaixaSelecao
              key={i.id}
              rotulo={`Item ${i.numero} — ${i.descricao}`}
              checked={itens.includes(i.id)}
              onChange={(e) => definirItens((lista) => (e.target.checked ? [...lista, i.id] : lista.filter((x) => x !== i.id)))}
            />
          ))}
        </fieldset>
        {faixas.map((f, n) => (
          <fieldset key={f.chave} className="imr-faixa pilha pilha--compacta">
            <legend>Faixa de ajuste {n + 1}</legend>
            <div className="formulario__linha">
              <CampoTexto
                rotulo={`Vale ${sentido === 'maior_igual' ? 'abaixo de' : 'acima de'}`}
                obrigatorio
                inputMode="decimal"
                value={f.limite}
                erro={tentou && lerNumero(f.limite) === null ? 'Informe o limite.' : null}
                onChange={(e) => mudarFaixa(f.chave, { limite: e.target.value })}
              />
              <CampoTexto rotulo="Glosa fixa (%)" inputMode="decimal" value={f.percentualGlosa} onChange={(e) => mudarFaixa(f.chave, { percentualGlosa: e.target.value })} />
              <CampoTexto rotulo="Glosa por unidade além do limite (%)" inputMode="decimal" value={f.percentualPorUnidade} onChange={(e) => mudarFaixa(f.chave, { percentualPorUnidade: e.target.value })} />
            </div>
            <CaixaSelecao
              rotulo="Encaminhar para avaliar a abertura de processo sancionatório"
              ajuda="Só abre pendência para o gestor: a decisão é da autoridade competente."
              checked={f.encaminharSancionatorio}
              onChange={(e) => mudarFaixa(f.chave, { encaminharSancionatorio: e.target.checked })}
            />
            {faixas.length > 1 ? (
              <div className="linha linha--fim">
                <Botao variante="terciario" tamanho="compacto" icone={Trash2} onClick={() => definirFaixas((lista) => lista.filter((x) => x.chave !== f.chave))}>
                  Remover faixa {n + 1}
                </Botao>
              </div>
            ) : null}
          </fieldset>
        ))}
        <div className="linha">
          <Botao
            icone={Plus}
            onClick={() =>
              definirFaixas((lista) => [...lista, { chave: Math.max(0, ...lista.map((x) => x.chave)) + 1, limite: '', percentualGlosa: '', percentualPorUnidade: '0', encaminharSancionatorio: false }])
            }
          >
            Incluir faixa
          </Botao>
        </div>
        {tentou && erros.faixas ? (
          <p className="campo__erro" role="alert">
            {erros.faixas}
          </p>
        ) : null}
        <CampoTexto rotulo="Teto da glosa do indicador (%, opcional)" inputMode="decimal" value={teto} onChange={(e) => definirTeto(e.target.value)} />
        <ErroOperacao erro={operacao.error} titulo="O indicador não foi salvo" />
      </form>
    </Dialogo>
  );
}

function DialogoEncerrar({ imr, indicador, aoFechar }: { imr: ImrContrato; indicador: IndicadorImrContrato | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const encerrar = useEncerrarIndicadorImr(imr.contrato.id);
  const [ultima, definirUltima] = useState('');
  const [justificativa, definirJustificativa] = useState('');
  const [tentou, definirTentou] = useState(false);
  const erros = {
    ultima: !/^\d{4}-\d{2}$/.test(ultima) ? 'Informe a última competência em que o indicador vale.' : null,
    justificativa: justificativa.trim().length < 20 ? 'Justifique com pelo menos 20 caracteres.' : null,
  };
  const idFormulario = 'formulario-encerrar-imr';
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (!indicador || erros.ultima || erros.justificativa) return;
    encerrar.mutate(
      { indicadorId: indicador.id, entrada: { ultimaCompetencia: ultima, justificativa: justificativa.trim() } },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Indicador encerrado', mensagem: `${indicador.codigo} vale até ${formatarCompetencia(ultima)}.` });
          aoFechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={indicador !== null}
      aoFechar={aoFechar}
      titulo={`Encerrar indicador ${indicador?.codigo ?? ''}`}
      descricao={<p>As medições já registradas continuam valendo. Alterar o IMR depende do que o contrato prevê ou de termo aditivo.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={encerrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="perigo" type="submit" form={idFormulario} carregando={encerrar.isPending}>
            Encerrar indicador
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto rotulo="Última competência em que vale" obrigatorio type="month" value={ultima} erro={tentou ? erros.ultima : null} onChange={(e) => definirUltima(e.target.value)} />
        <AreaTexto rotulo="Justificativa" obrigatorio rows={3} maxLength={2000} value={justificativa} erro={tentou ? erros.justificativa : null} onChange={(e) => definirJustificativa(e.target.value)} />
        <ErroOperacao erro={encerrar.error} titulo="O indicador não foi encerrado" />
      </form>
    </Dialogo>
  );
}

// ───────────────────────── listas ─────────────────────────

const COLUNAS_MEDICOES: ColunaTabela<MedicaoImr>[] = [
  { id: 'competencia', cabecalho: 'Competência', identificadora: true, fixa: true, ordenavel: true, valorOrdenacao: (m) => m.competencia, celula: (m) => formatarCompetencia(m.competencia) },
  { id: 'indicador', cabecalho: 'Indicador', prioritaria: true, celula: (m) => `${m.indicador.codigo} — ${m.indicador.nome}` },
  { id: 'resultado', cabecalho: 'Resultado', alinhamento: 'fim', prioritaria: true, celula: (m) => <span className="numero">{descreverResultado(m)}</span> },
  {
    id: 'ajuste',
    cabecalho: 'Ajuste do pagamento',
    prioritaria: true,
    celula: (m) =>
      m.atingiuMeta ? (
        <Etiqueta tom="sucesso" compacta>
          Meta atingida
        </Etiqueta>
      ) : m.percentualGlosa > 0 ? (
        <Etiqueta tom={m.encaminharSancionatorio ? 'erro' : 'aviso'} compacta>
          {`Glosa de ${formatarNumero(m.percentualGlosa)}%${m.faixa ? ` (faixa ${m.faixa})` : ''}`}
        </Etiqueta>
      ) : (
        <Etiqueta tom="info" compacta>
          Fora da meta, sem glosa
        </Etiqueta>
      ),
  },
  { id: 'evidencia', cabecalho: 'Evidência', larguraMinima: '14rem', celula: (m) => `${m.evidencia}${m.referenciaEvidencia ? ` (${m.referenciaEvidencia})` : ''}` },
  {
    id: 'memoria',
    cabecalho: 'Memória de cálculo',
    larguraMinima: '12rem',
    celula: (m) => (
      <details className="imr-memoria">
        <summary>Ver cálculo</summary>
        <ol className="texto-pequeno">
          {m.memoriaCalculo.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </details>
    ),
  },
  { id: 'registrada', cabecalho: 'Registrada', celula: (m) => `${m.registradaPor?.nome ?? 'Sistema'}, ${formatarInstante(m.registradaEm)}` },
];

type CompetenciaLinha = ImrContrato['competencias'][number];

const COLUNAS_COMPETENCIAS: ColunaTabela<CompetenciaLinha>[] = [
  { id: 'competencia', cabecalho: 'Competência', identificadora: true, fixa: true, celula: (c) => formatarCompetencia(c.competencia) },
  {
    id: 'medicoes',
    cabecalho: 'Medições',
    prioritaria: true,
    celula: (c) =>
      c.pendentes.length > 0 ? (
        <Etiqueta tom="erro" compacta>{`${c.pendentes.length} pendente(s): ${c.pendentes.map((p) => p.codigo).join(', ')}`}</Etiqueta>
      ) : (
        <Etiqueta tom="sucesso" compacta>{`${c.medicoes} registrada(s)`}</Etiqueta>
      ),
  },
  { id: 'glosa', cabecalho: 'Glosa somada', alinhamento: 'fim', celula: (c) => <span className="numero">{formatarNumero(c.percentualGlosaSomado)}%</span> },
  {
    id: 'nota',
    cabecalho: 'Nota fiscal',
    prioritaria: true,
    celula: (c) =>
      c.pagamento ? (
        <Link to={`/financeiro/pagamentos/${c.pagamento.id}/conferencia`} aria-label={`Conferência da nota fiscal ${c.pagamento.notaFiscal} da competência ${formatarCompetencia(c.competencia)}`}>
          {c.pagamento.notaFiscal}
        </Link>
      ) : (
        <span className="texto-secundario">Sem parcela</span>
      ),
  },
  {
    id: 'conferencia',
    cabecalho: 'Conferência',
    celula: (c) =>
      c.conferencia ? (
        <Etiqueta tom={SITUACOES_CONFERENCIA[c.conferencia.situacao].tom} compacta>
          {SITUACOES_CONFERENCIA[c.conferencia.situacao].rotulo}
        </Etiqueta>
      ) : (
        <span className="texto-secundario">Não registrada</span>
      ),
  },
];

function CartaoIndicador({ indicador, podeConfigurar, aoAlterar, aoEncerrar }: { indicador: IndicadorImrContrato; podeConfigurar: boolean; aoAlterar: () => void; aoEncerrar: () => void }) {
  return (
    <Secao
      titulo={`${indicador.codigo} — ${indicador.nome}`}
      nivel={3}
      acoes={
        <>
          <Etiqueta tom={indicador.situacao === 'ativo' ? 'sucesso' : 'neutro'} compacta>
            {indicador.situacao === 'ativo' ? 'Ativo' : `Encerrado após ${formatarCompetencia(indicador.encerradoApos ?? '')}`}
          </Etiqueta>
          {podeConfigurar && indicador.situacao === 'ativo' && !indicador.temMedicoes ? (
            <Botao variante="secundario" tamanho="compacto" icone={PencilLine} onClick={aoAlterar} aria-label={`Alterar o indicador ${indicador.codigo}`}>
              Alterar
            </Botao>
          ) : null}
          {podeConfigurar && indicador.situacao === 'ativo' ? (
            <Botao variante="secundario" tamanho="compacto" icone={Ban} onClick={aoEncerrar} aria-label={`Encerrar o indicador ${indicador.codigo}`}>
              Encerrar
            </Botao>
          ) : null}
        </>
      }
    >
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: 'Meta', valor: descreverMeta(indicador) },
          { termo: 'Periodicidade', valor: `${PERIODICIDADES[indicador.periodicidade]}, desde ${formatarCompetencia(indicador.inicioCompetencia)}` },
          { termo: 'Teto da glosa', valor: indicador.tetoPercentual === null ? 'Sem teto próprio' : `${formatarNumero(indicador.tetoPercentual)}%` },
          {
            termo: 'Mecanismo de cálculo',
            valor:
              indicador.formaCalculo === 'percentual_razao'
                ? `${indicador.descricaoCalculo} (${indicador.rotuloNumerador ?? 'numerador'} ÷ ${indicador.rotuloDenominador ?? 'denominador'} × 100)`
                : indicador.descricaoCalculo,
            largo: true,
          },
          { termo: 'Fonte da medição', valor: indicador.fonteMedicao, largo: true },
          {
            termo: 'Base da glosa',
            valor: indicador.itensAlcancados.length === 0 ? 'Todos os itens da nota' : indicador.itensAlcancados.map((i) => `Item ${i.numero}`).join(', '),
            largo: true,
          },
        ]}
      />
      <ul className="imr-lista" aria-label={`Faixas de ajuste do pagamento do indicador ${indicador.codigo}`}>
        {indicador.faixas.map((f, n) => (
          <li key={`${f.limite}-${n}`}>
            <span className="imr-lista__titulo">Faixa {n + 1}</span>
            {f.encaminharSancionatorio ? (
              <Etiqueta tom="erro" compacta>
                Encaminhamento
              </Etiqueta>
            ) : (
              <span />
            )}
            <span className="imr-lista__descricao">{descreverFaixa(indicador, f)}</span>
          </li>
        ))}
      </ul>
      {indicador.justificativaEncerramento ? <p className="texto-pequeno texto-secundario">Encerramento: {indicador.justificativaEncerramento}</p> : null}
    </Secao>
  );
}

function ConteudoImr({ imr }: { imr: ImrContrato }) {
  const { temPermissao } = useSessao();
  const podeConfigurar = temPermissao('imr:configurar');
  const podeMedir = temPermissao('imr:medir');
  const [medindo, definirMedindo] = useState(false);
  const [configurando, definirConfigurando] = useState<{ indicador: IndicadorImrContrato | null } | null>(null);
  const [encerrando, definirEncerrando] = useState<IndicadorImrContrato | null>(null);
  const [aberturas, definirAberturas] = useState(0);
  const pendentes = imr.competencias.reduce((s, c) => s + c.pendentes.length, 0);
  const abrirMedicao = () => {
    definirAberturas((n) => n + 1);
    definirMedindo(true);
  };
  const abrirConfiguracao = (indicador: IndicadorImrContrato | null) => {
    definirAberturas((n) => n + 1);
    definirConfigurando({ indicador });
  };

  return (
    <div className="pilha">
      <Alerta
        tipo={pendentes > 0 ? 'aviso' : 'info'}
        titulo={pendentes > 0 ? `${pendentes} medição(ões) pendente(s)` : 'Instrumento de medição de resultado (IMR)'}
        acoes={
          <>
            {podeMedir && pendentes > 0 ? (
              <Botao variante="primario" icone={Ruler} onClick={abrirMedicao}>
                Registrar medição
              </Botao>
            ) : null}
            {podeConfigurar ? (
              <Botao variante="secundario" icone={Plus} onClick={() => abrirConfiguracao(null)}>
                Incluir indicador
              </Botao>
            ) : null}
          </>
        }
      >
        <p>{imr.aviso}</p>
        <p className="texto-pequeno texto-secundario">Fundamento: {imr.fundamento}.</p>
      </Alerta>
      {imr.indicadores.length === 0 ? (
        <EstadoVazio icone={Gauge} titulo="O contrato não tem IMR configurado" descricao="Inclua os indicadores previstos no termo de referência, com as metas e as faixas de ajuste do pagamento." />
      ) : (
        <>
          <ListaDefinicoes
            colunas={4}
            itens={[
              { termo: 'Medições registradas', valor: <span className="numero">{imr.resumo.medicoes}</span> },
              { termo: 'Na meta', valor: <span className="numero">{imr.resumo.naMeta}</span> },
              { termo: 'Com glosa', valor: <span className="numero">{imr.resumo.comGlosa}</span> },
              { termo: 'Cumprimento das metas', valor: imr.resumo.percentualNaMeta === null ? 'Sem medições' : `${formatarNumero(imr.resumo.percentualNaMeta)}%` },
            ]}
          />
          <Secao titulo="Indicadores" simples nivel={3}>
            <div className="pilha">
              {imr.indicadores.map((i) => (
                <CartaoIndicador key={i.id} indicador={i} podeConfigurar={podeConfigurar} aoAlterar={() => abrirConfiguracao(i)} aoEncerrar={() => definirEncerrando(i)} />
              ))}
            </div>
          </Secao>
          <Tabela
            id="imr-competencias"
            legenda="Competências do IMR e notas fiscais"
            colunas={COLUNAS_COMPETENCIAS}
            linhas={imr.competencias}
            chave={(c) => c.competencia}
            semFerramentas
            destaque={(c) => (c.pendentes.length > 0 ? 'aviso' : undefined)}
            vazio={<EstadoVazio titulo="Nenhuma competência encerrada desde o início da medição" />}
          />
          <Tabela
            id="imr-medicoes"
            legenda="Medições registradas"
            colunas={COLUNAS_MEDICOES}
            linhas={imr.medicoes}
            chave={(m) => m.id}
            ordenacaoInicial={{ por: 'competencia', ordem: 'desc' }}
            vazio={<EstadoVazio titulo="Nenhuma medição registrada" />}
          />
        </>
      )}
      {podeMedir ? <DialogoMedicao key={`medicao-${aberturas}`} imr={imr} aberto={medindo} aoFechar={() => definirMedindo(false)} /> : null}
      {podeConfigurar ? (
        <>
          <DialogoIndicador key={`indicador-${aberturas}`} imr={imr} indicador={configurando?.indicador ?? null} aberto={configurando !== null} aoFechar={() => definirConfigurando(null)} />
          <DialogoEncerrar key={`encerrar-${encerrando?.id ?? ''}`} imr={imr} indicador={encerrando} aoFechar={() => definirEncerrando(null)} />
        </>
      ) : null}
    </div>
  );
}

export function AbaImrContrato({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useImrContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o IMR do contrato">
      {(imr) => <ConteudoImr imr={imr} />}
    </ConteudoConsulta>
  );
}
