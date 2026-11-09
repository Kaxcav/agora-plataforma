/**
 * Conferência da nota fiscal (RN-36, RF-29): registra número, data, valor e itens da nota, com a quantidade recebida;
 * mostra o valor da nota ao lado do valor devido (preço contratado × quantidade recebida, menos a glosa do IMR da
 * competência), as divergências e a memória de cálculo. Divergência exige correção ou justificativa antes do atesto.
 * O servidor calcula tudo e decide se o atesto está liberado; a tela só mostra.
 */
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { CircleDollarSign, ClipboardCheck, FileCheck2, Receipt, Scale } from 'lucide-react';
import type { ContextoConferenciaNota, ConferenciaNotaFiscal, EntradaConferenciaNota } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO } from '@agora/dominio';
import { useConferenciaNota, useJustificarConferencia, useRegistrarConferencia } from '../../api/imr';
import {
  Alerta,
  AreaTexto,
  Botao,
  CampoMoeda,
  CampoTexto,
  ConteudoConsulta,
  EsqueletoDetalhe,
  EstadoVazio,
  Etiqueta,
  Indicador,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarCompetencia, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { SITUACOES_PAGAMENTO } from '../compartilhado/rotulos';
import './imr.css';
import { SITUACOES_CONFERENCIA } from './rotulosImr';

const MINIMO_JUSTIFICATIVA = 20;

type ItemConferido = ConferenciaNotaFiscal['itens'][number];

const COLUNAS_ITENS: ColunaTabela<ItemConferido>[] = [
  { id: 'numero', cabecalho: 'Item', identificadora: true, fixa: true, celula: (i) => <span className="numero">{i.numero}</span> },
  { id: 'descricao', cabecalho: 'Descrição', prioritaria: true, larguraMinima: '14rem', celula: (i) => i.descricao },
  { id: 'recebida', cabecalho: 'Qtd. recebida', alinhamento: 'fim', celula: (i) => <span className="numero">{formatarNumero(i.quantidadeRecebida)}</span> },
  { id: 'faturada', cabecalho: 'Qtd. cobrada', alinhamento: 'fim', celula: (i) => <span className="numero">{formatarNumero(i.quantidadeFaturada)}</span> },
  { id: 'precoContratado', cabecalho: 'Preço contratado', alinhamento: 'fim', celula: (i) => <span className="numero">{formatarMoeda(i.valorUnitarioContratado)}</span> },
  {
    id: 'precoCobrado',
    cabecalho: 'Preço cobrado',
    alinhamento: 'fim',
    celula: (i) => (
      <span className={['numero', i.valorUnitarioFaturado > i.valorUnitarioContratado ? 'imr-acima-contratado' : ''].filter(Boolean).join(' ')}>{formatarMoeda(i.valorUnitarioFaturado)}</span>
    ),
  },
  { id: 'devido', cabecalho: 'Devido (antes do IMR)', alinhamento: 'fim', prioritaria: true, celula: (i) => <span className="numero">{formatarMoeda(i.valorDevido)}</span> },
  { id: 'cobrado', cabecalho: 'Cobrado', alinhamento: 'fim', prioritaria: true, celula: (i) => <span className="numero">{formatarMoeda(i.valorFaturado)}</span> },
];

interface RascunhoItem {
  quantidadeRecebida: string;
  quantidadeFaturada: string;
  valorUnitarioFaturado: number | null;
}

function inteiroOuNulo(texto: string): number | null {
  if (texto.trim() === '') return 0;
  const n = Number(texto);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function FormularioNota({ contexto }: { contexto: ContextoConferenciaNota }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarConferencia(contexto.pagamento.id);
  const atual = contexto.conferencia;
  const [numero, definirNumero] = useState(atual?.numeroNota ?? contexto.pagamento.notaFiscal);
  const [emitidaEm, definirEmitidaEm] = useState(atual?.emitidaEm ?? '');
  const [valorNota, definirValorNota] = useState<number | null>(atual?.valorNota ?? null);
  const [itens, definirItens] = useState<Record<string, RascunhoItem>>(() =>
    Object.fromEntries(
      contexto.itensContrato.map((i) => {
        const conferido = atual?.itens.find((x) => x.itemContratoId === i.id);
        // A quantidade recebida vem do termo definitivo (por item, ou do total quando o contrato tem um só item).
        // A quantidade faturada nunca é preenchida: sai da nota fiscal, e é ela que a conferência compara com a recebida.
        const itemDef = contexto.recebimentoDefinitivo?.itens?.find((x) => x.itemContratoId === i.id);
        const qtdDef = itemDef ? itemDef.quantidadeRecebida : contexto.itensContrato.length === 1 ? (contexto.recebimentoDefinitivo?.quantidadeRecebida ?? 0) : 0;
        return [
          i.id,
          {
            quantidadeRecebida: String(conferido?.quantidadeRecebida ?? qtdDef),
            quantidadeFaturada: String(conferido?.quantidadeFaturada ?? 0),
            valorUnitarioFaturado: conferido?.valorUnitarioFaturado ?? i.valorUnitario,
          },
        ];
      }),
    ),
  );
  const [tentou, definirTentou] = useState(false);
  const hoje = hojeISO(new Date());
  const idFormulario = 'formulario-conferencia-nota';

  const alterar = (id: string, mudanca: Partial<RascunhoItem>) => definirItens((anterior) => ({ ...anterior, [id]: { ...anterior[id], ...mudanca } as RascunhoItem }));
  const linhas = contexto.itensContrato.map((i) => {
    const r = itens[i.id];
    return {
      item: i,
      recebida: inteiroOuNulo(r?.quantidadeRecebida ?? ''),
      faturada: inteiroOuNulo(r?.quantidadeFaturada ?? ''),
      preco: r?.valorUnitarioFaturado ?? null,
    };
  });
  const informadas = linhas.filter((l) => (l.recebida ?? 0) > 0 || (l.faturada ?? 0) > 0);
  const somaItens = informadas.reduce((s, l) => s + (l.preco ?? 0) * (l.faturada ?? 0), 0);
  const erros = {
    numero: numero.trim() === '' ? 'Informe o número da nota fiscal.' : null,
    emitidaEm: emitidaEm === '' ? 'Informe a data de emissão.' : emitidaEm > hoje ? 'A data de emissão não pode ser futura.' : null,
    valorNota: valorNota === null ? 'Informe o valor total da nota.' : null,
    itens: informadas.length === 0 ? 'Informe a quantidade recebida e a cobrada de ao menos um item.' : null,
  };
  const itemInvalido = linhas.some((l) => l.recebida === null || l.faturada === null || l.preco === null);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (Object.values(erros).some(Boolean) || itemInvalido || valorNota === null) return;
    const entrada: EntradaConferenciaNota = {
      numeroNota: numero.trim(),
      emitidaEm,
      valorNota,
      itens: informadas.map((l) => ({
        itemContratoId: l.item.id,
        quantidadeRecebida: l.recebida ?? 0,
        quantidadeFaturada: l.faturada ?? 0,
        valorUnitarioFaturado: l.preco ?? 0,
      })),
    };
    registrar.mutate(entrada, {
      onSuccess: (r) => {
        const c = r.conferencia;
        avisar(
          c?.situacao === 'conforme'
            ? { tipo: 'sucesso', titulo: 'Conferência registrada', mensagem: `NF ${entrada.numeroNota} conforme: valor da nota igual ao valor devido.` }
            : {
                tipo: 'aviso',
                titulo: 'Conferência registrada com divergência',
                mensagem: `NF ${entrada.numeroNota}: ${c?.divergencias.length ?? 0} divergência(s). Corrija a nota ou registre a justificativa antes do atesto.`,
              },
        );
      },
    });
  };

  return (
    <Secao
      titulo={atual ? 'Corrigir a nota fiscal' : 'Registrar a nota fiscal'}
      id="registrar-nota"
      descricao="Informe os dados da nota e, para cada item, a quantidade recebida no período (termo de recebimento), a quantidade e o preço cobrados."
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <div className="formulario__linha">
          <CampoTexto rotulo="Número da nota fiscal" obrigatorio maxLength={60} value={numero} erro={tentou ? erros.numero : null} onChange={(e) => definirNumero(e.target.value)} />
          <CampoTexto rotulo="Data de emissão" obrigatorio type="date" max={hoje} value={emitidaEm} erro={tentou ? erros.emitidaEm : null} onChange={(e) => definirEmitidaEm(e.target.value)} />
          <CampoMoeda rotulo="Valor total da nota" obrigatorio valor={valorNota} aoMudar={definirValorNota} erro={tentou ? erros.valorNota : null} />
        </div>
        {contexto.itensContrato.map((i, n) => {
          const r = itens[i.id];
          const linha = linhas[n];
          return (
            <fieldset key={i.id} className="imr-item-nota pilha pilha--compacta">
              <legend>
                Item {i.numero} — {i.descricao}
              </legend>
              <p className="texto-pequeno texto-secundario">
                Preço contratado {formatarMoeda(i.valorUnitario)} por {i.unidade}; saldo do item: {formatarNumero(i.saldoQuantidade)} de {formatarNumero(i.quantidade)}.
              </p>
              <div className="formulario__linha">
                <CampoTexto
                  rotulo={`Quantidade recebida do item ${i.numero}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={r?.quantidadeRecebida ?? '0'}
                  erro={tentou && linha?.recebida === null ? 'Use um número inteiro, zero ou maior.' : null}
                  onChange={(e) => alterar(i.id, { quantidadeRecebida: e.target.value })}
                />
                <CampoTexto
                  rotulo={`Quantidade cobrada do item ${i.numero}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={r?.quantidadeFaturada ?? '0'}
                  erro={tentou && linha?.faturada === null ? 'Use um número inteiro, zero ou maior.' : null}
                  onChange={(e) => alterar(i.id, { quantidadeFaturada: e.target.value })}
                />
                <CampoMoeda
                  rotulo={`Preço unitário cobrado do item ${i.numero}`}
                  valor={r?.valorUnitarioFaturado ?? null}
                  aoMudar={(v) => alterar(i.id, { valorUnitarioFaturado: v })}
                  erro={tentou && linha?.preco === null ? 'Informe o preço cobrado.' : null}
                />
              </div>
            </fieldset>
          );
        })}
        <p className="texto-secundario" aria-live="polite">
          Soma dos itens cobrados: <strong className="numero">{formatarMoeda(somaItens)}</strong>
        </p>
        {tentou && erros.itens ? (
          <p className="campo__erro" role="alert">
            {erros.itens}
          </p>
        ) : null}
        <ErroOperacao erro={registrar.error} titulo="A conferência não foi registrada" />
        <div className="linha">
          <Botao variante="primario" type="submit" icone={ClipboardCheck} carregando={registrar.isPending}>
            {atual ? 'Registrar a correção da nota' : 'Registrar a conferência'}
          </Botao>
        </div>
      </form>
    </Secao>
  );
}

function FormularioJustificativa({ pagamentoId }: { pagamentoId: string }) {
  const { avisar } = useAvisos();
  const justificar = useJustificarConferencia(pagamentoId);
  const [texto, definirTexto] = useState('');
  const [tentou, definirTentou] = useState(false);
  const erro = texto.trim().length < MINIMO_JUSTIFICATIVA ? `Escreva a justificativa com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.` : null;
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (erro) return;
    justificar.mutate(
      { justificativa: texto.trim() },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Justificativa registrada', mensagem: 'A divergência foi justificada e o atesto está liberado.' }) },
    );
  };
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <AreaTexto
        rotulo="Justificativa da divergência"
        obrigatorio
        rows={3}
        maxLength={2000}
        contador
        value={texto}
        erro={tentou ? erro : null}
        onChange={(e) => definirTexto(e.target.value)}
        ajuda="Explique por que a nota pode ser atestada assim (por exemplo, glosa comunicada e descontada na liquidação). A justificativa fica na trilha de auditoria."
      />
      <ErroOperacao erro={justificar.error} titulo="A justificativa não foi registrada" />
      <div className="linha">
        <Botao variante="primario" type="submit" icone={FileCheck2} carregando={justificar.isPending}>
          Registrar justificativa
        </Botao>
      </div>
    </form>
  );
}

function ResultadoConferencia({ contexto, conferencia, podeConferir }: { contexto: ContextoConferenciaNota; conferencia: ConferenciaNotaFiscal; podeConferir: boolean }) {
  const situacao = SITUACOES_CONFERENCIA[conferencia.situacao];
  return (
    <Secao
      titulo="Valor da nota × valor devido"
      id="resultado-conferencia"
      descricao={`Conferência ${conferencia.versao > 1 ? `(versão ${conferencia.versao}) ` : ''}registrada por ${conferencia.conferidaPor?.nome ?? 'Sistema'} em ${formatarInstante(conferencia.conferidaEm)}.`}
      acoes={<Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>}
    >
      <div className="grade grade--kpi">
        <Indicador rotulo="Valor da nota" icone={Receipt} tom="info" valor={formatarMoeda(conferencia.valorNota)} detalhe={`NF ${conferencia.numeroNota}, emitida em ${formatarData(conferencia.emitidaEm)}`} />
        <Indicador
          rotulo="Valor devido"
          icone={Scale}
          tom="info"
          valor={formatarMoeda(conferencia.valorDevido)}
          detalhe={conferencia.glosaImr > 0 ? `Bruto ${formatarMoeda(conferencia.valorBruto)} − glosa do IMR ${formatarMoeda(conferencia.glosaImr)}` : `Bruto ${formatarMoeda(conferencia.valorBruto)}, sem glosa`}
        />
        <Indicador
          rotulo="Diferença"
          icone={CircleDollarSign}
          tom={conferencia.diferenca === 0 ? 'sucesso' : 'erro'}
          valor={formatarMoeda(conferencia.diferenca)}
          detalhe={conferencia.diferenca > 0 ? 'A nota cobra a mais' : conferencia.diferenca < 0 ? 'A nota cobra a menos' : 'Nota igual ao devido'}
        />
        <Indicador rotulo="Valor a liquidar" icone={FileCheck2} tom="sucesso" valor={formatarMoeda(conferencia.valorALiquidar)} detalhe="O menor entre a nota e o valor devido" />
      </div>
      <Tabela id="conferencia-itens" legenda="Itens da nota fiscal conferidos" colunas={COLUNAS_ITENS} linhas={conferencia.itens} chave={(i) => i.itemContratoId} semFerramentas />
      {conferencia.glosas.length > 0 ? (
        <Secao titulo="Glosa do IMR na competência" simples nivel={3}>
          <ul className="imr-lista">
            {conferencia.glosas.map((g) => (
              <li key={g.codigo}>
                <span className="imr-lista__titulo">
                  {g.codigo} — {g.nome}
                </span>
                <span className="imr-lista__descricao numero">
                  {formatarNumero(g.percentual)}% de {formatarMoeda(g.base)} = {formatarMoeda(g.valor)}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}
      {conferencia.divergencias.length > 0 ? (
        <Alerta tipo={conferencia.situacao === 'justificada' ? 'aviso' : 'erro'} titulo={`${conferencia.divergencias.length} divergência(s) na nota`}>
          <ul>
            {conferencia.divergencias.map((d) => (
              <li key={`${d.tipo}-${d.itemContratoId ?? ''}`}>{d.mensagem}</li>
            ))}
          </ul>
        </Alerta>
      ) : (
        <Alerta tipo="sucesso" titulo="Nota conforme">
          <p>{conferencia.aviso}</p>
        </Alerta>
      )}
      {conferencia.situacao === 'justificada' ? (
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Justificativa', valor: conferencia.justificativa ?? '', largo: true },
            { termo: 'Justificada por', valor: conferencia.justificadaPor?.nome ?? '—' },
            { termo: 'Em', valor: conferencia.justificadaEm ? formatarInstante(conferencia.justificadaEm) : '—' },
          ]}
        />
      ) : null}
      {conferencia.situacao === 'divergente' && podeConferir && contexto.atesto.parcelaEmAberto ? (
        <FormularioJustificativa pagamentoId={contexto.pagamento.id} />
      ) : null}
      <details className="imr-memoria">
        <summary>Memória de cálculo</summary>
        <ol className="texto-pequeno">
          {conferencia.memoriaCalculo.map((linha) => (
            <li key={linha}>{linha}</li>
          ))}
        </ol>
        <p className="texto-pequeno texto-secundario">Fundamento: {conferencia.fundamento}.</p>
      </details>
    </Secao>
  );
}

function ConteudoConferencia({ contexto }: { contexto: ContextoConferenciaNota }) {
  const { temPermissao } = useSessao();
  const podeConferir = temPermissao('pagamentos:conferir');
  const { pagamento, contrato, imr, conferencia, atesto } = contexto;
  const emAberto = atesto.parcelaEmAberto;
  return (
    <div className="pilha pilha--ampla">
      {emAberto ? (
        <Alerta
          tipo={atesto.liberado ? 'sucesso' : 'aviso'}
          titulo={atesto.liberado ? 'Atesto liberado pela conferência' : 'Atesto bloqueado'}
          acoes={
            atesto.liberado && temPermissao('pagamentos:atestar') ? (
              <LinkBotao to={`/financeiro/pagamentos?busca=${encodeURIComponent(pagamento.notaFiscal)}`} variante="secundario">
                Ir para o atesto
              </LinkBotao>
            ) : null
          }
        >
          <p>
            {atesto.motivo ??
              'A conferência não impede o atesto. No atesto, a Ágora consulta de novo a regularidade do contratado (RN-23) e a parcela segue pelo valor a liquidar.'}
          </p>
        </Alerta>
      ) : (
        <Alerta tipo="info" titulo="Parcela já atestada">
          <p>A conferência fica registrada para consulta e auditoria e não pode mais ser alterada.</p>
        </Alerta>
      )}
      <Secao titulo="Parcela" id="parcela">
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Contrato', valor: <Link to={`/contratos/${contrato.id}`}>Contrato {contrato.numero}</Link> },
            { termo: 'Fornecedor', valor: pagamento.fornecedor },
            { termo: 'Competência', valor: formatarCompetencia(pagamento.competencia) },
            { termo: 'Nota fiscal', valor: <span className="mono">{pagamento.notaFiscal}</span> },
            { termo: 'Vencimento', valor: <span className="numero">{formatarData(pagamento.vencimento)}</span> },
            { termo: 'Situação', valor: <Etiqueta tom={SITUACOES_PAGAMENTO[pagamento.situacao].tom}>{SITUACOES_PAGAMENTO[pagamento.situacao].rotulo}</Etiqueta> },
            { termo: 'Objeto', valor: contrato.objeto, largo: true },
          ]}
        />
      </Secao>
      <Secao
        titulo="IMR da competência"
        id="imr-competencia"
        descricao={contrato.temImr ? `Medições de ${formatarCompetencia(imr.competencia)} que ajustam o valor devido.` : 'O contrato não tem instrumento de medição de resultado nesta competência.'}
        acoes={
          contrato.temImr ? (
            <LinkBotao to={`/contratos/${contrato.id}?aba=imr`} variante="secundario">
              Ver o IMR do contrato
            </LinkBotao>
          ) : null
        }
      >
        {!contrato.temImr ? (
          <p className="texto-secundario">Sem glosa: o valor devido é o preço contratado vezes a quantidade recebida.</p>
        ) : (
          <ul className="imr-lista">
            {imr.glosas.map((g) => (
              <li key={g.codigo}>
                <span className="imr-lista__titulo">
                  {g.codigo} — {g.nome}
                </span>
                <Etiqueta tom="aviso" compacta>
                  Glosa de {formatarNumero(g.percentual)}%
                </Etiqueta>
              </li>
            ))}
            {imr.pendentes.map((p) => (
              <li key={p.codigo}>
                <span className="imr-lista__titulo">
                  {p.codigo} — {p.nome}
                </span>
                <Etiqueta tom="erro" compacta>
                  Medição pendente
                </Etiqueta>
              </li>
            ))}
            {imr.glosas.length === 0 && imr.pendentes.length === 0 ? <li>Todas as medições da competência estão dentro da meta: sem glosa.</li> : null}
          </ul>
        )}
      </Secao>
      {conferencia ? (
        <ResultadoConferencia contexto={contexto} conferencia={conferencia} podeConferir={podeConferir} />
      ) : (
        <EstadoVazio icone={Receipt} titulo="Nota fiscal ainda não conferida" descricao={contrato.temImr ? 'Neste contrato, o atesto exige a conferência da nota.' : 'A conferência é recomendada antes do atesto.'} />
      )}
      {podeConferir && emAberto ? <FormularioNota key={conferencia?.versao ?? 0} contexto={contexto} /> : null}
      {contexto.recebimentoDefinitivo ? (
        <Alerta tipo="info" titulo="Termo de recebimento definitivo vinculado">
          <p>
            Entrega nº {contexto.recebimentoDefinitivo.numero} com termo definitivo aceito em {formatarData(contexto.recebimentoDefinitivo.data)}.
            Quantidade recebida pré-carregada do recebimento ({contexto.recebimentoDefinitivo.quantidadeRecebida}).
          </p>
        </Alerta>
      ) : (
        <p className="texto-pequeno texto-secundario">
          A quantidade recebida pode ser informada manualmente ou vinculada ao termo de recebimento definitivo (art. 140).
        </p>
      )}
    </div>
  );
}

export default function ConferenciaNota() {
  const { id = '' } = useParams();
  const consulta = useConferenciaNota(id);
  const dados = consulta.data;
  return (
    <Pagina
      titulo="Conferência da nota fiscal"
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Pagamentos', para: '/financeiro/pagamentos' },
      ]}
      tela="pagamentos.conferencia"
      subtitulo={dados ? `Contrato ${dados.contrato.numero} — competência ${formatarCompetencia(dados.pagamento.competencia)}` : undefined}
      marcadores={dados?.conferencia ? <Etiqueta tom={SITUACOES_CONFERENCIA[dados.conferencia.situacao].tom}>{SITUACOES_CONFERENCIA[dados.conferencia.situacao].rotulo}</Etiqueta> : null}
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando a conferência da nota fiscal"
        naoEncontrado={{
          titulo: 'Pagamento não encontrado',
          descricao: 'A parcela não existe ou está fora das UASGs do seu escopo.',
          acao: (
            <LinkBotao to="/financeiro/pagamentos" variante="primario">
              Voltar para pagamentos
            </LinkBotao>
          ),
        }}
      >
        {(contexto) => <ConteudoConferencia contexto={contexto} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
