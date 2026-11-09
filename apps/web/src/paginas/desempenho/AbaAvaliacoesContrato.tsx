/**
 * Aba "Avaliação de desempenho" do contrato (RN-37, RF-30; art. 88, § 3º): o gestor ou o fiscal designado emite a
 * avaliação ao final de uma etapa ou na conclusão, com os indicadores aferidos (a nota é calculada no servidor),
 * registra a manifestação do contratado e a analisa. A avaliação definitiva entra no registro cadastral do fornecedor.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck, FileText, MessageSquareText, Scale } from 'lucide-react';
import type { AvaliacaoDesempenho, AvaliadorContrato, ContratoDetalhe, SituacaoAvaliacaoDesempenho } from '@agora/contratos';
import { formatarData, hojeISO } from '@agora/dominio';
import {
  urlDocumentoAvaliacao,
  useAnalisarManifestacao,
  useAvaliacoesContrato,
  useEmitirAvaliacao,
  usePreviaAvaliacao,
  useRegistrarManifestacao,
} from '../../api/desempenho';
import { Alerta, AreaTexto, Botao, CampoTexto, ConteudoConsulta, Dialogo, EstadoVazio, Etiqueta, GrupoOpcoes, LinkExterno, ListaDefinicoes, type TomEtiqueta, useAvisos } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { FAIXAS_IDC } from '../compartilhado/rotulos';
import { formatarNotaIdc } from '../fornecedores/idc';
import { ErroOperacao } from '../jornada/comum';

const SITUACOES: Record<SituacaoAvaliacaoDesempenho, { rotulo: string; tom: TomEtiqueta }> = {
  em_manifestacao: { rotulo: 'Em prazo de manifestação', tom: 'aviso' },
  manifestada: { rotulo: 'Manifestação a analisar', tom: 'alerta' },
  definitiva: { rotulo: 'Definitiva', tom: 'sucesso' },
};
const MINIMO_MOTIVACAO = 50;

function inteiro(texto: string): number | null {
  if (!/^\d+$/.test(texto.trim())) return null;
  return Number(texto.trim());
}

interface Contagens {
  entregasNoPrazo: string;
  entregasTotal: string;
  recebimentosAprovados: string;
  recebimentosTotal: string;
}

function erroContagens(c: Contagens): string | null {
  const v = [c.entregasNoPrazo, c.entregasTotal, c.recebimentosAprovados, c.recebimentosTotal].map(inteiro);
  if (v.some((x) => x === null)) return 'Informe as quatro contagens com números inteiros (0 ou mais).';
  const [a, b, d, e] = v as number[];
  if ((a ?? 0) > (b ?? 0)) return 'As entregas no prazo não podem passar do total de entregas.';
  if ((d ?? 0) > (e ?? 0)) return 'Os recebimentos sem ressalva não podem passar do total de recebimentos.';
  if ((b ?? 0) + (e ?? 0) === 0) return 'Sem entrega nem recebimento aferido não há indicador objetivo para avaliar.';
  return null;
}

function CamposContagens({ valores, aoMudar, base }: { valores: Contagens; aoMudar: (c: Contagens) => void; base: string }) {
  const campo = (nome: keyof Contagens, rotulo: string) => (
    <CampoTexto id={`${base}-${nome}`} rotulo={rotulo} inputMode="numeric" value={valores[nome]} onChange={(e) => aoMudar({ ...valores, [nome]: e.target.value })} />
  );
  return (
    <>
      <div className="formulario__linha">
        {campo('entregasNoPrazo', 'Entregas no prazo')}
        {campo('entregasTotal', 'Total de entregas')}
      </div>
      <div className="formulario__linha">
        {campo('recebimentosAprovados', 'Recebimentos definitivos sem ressalva')}
        {campo('recebimentosTotal', 'Total de recebimentos')}
      </div>
    </>
  );
}

function DialogoEmitir({ contrato, aberto, aoFechar }: { contrato: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const base = useId();
  const { avisar } = useAvisos();
  const emitir = useEmitirAvaliacao(contrato.id);
  const hoje = hojeISO(new Date());
  const [tipo, definirTipo] = useState<'parcial' | 'final'>('parcial');
  const [inicio, definirInicio] = useState(contrato.vigenciaInicio);
  const [fim, definirFim] = useState(hoje < contrato.vigenciaFim ? hoje : contrato.vigenciaFim);
  const [contagens, definirContagens] = useState<Contagens>({ entregasNoPrazo: '', entregasTotal: '', recebimentosAprovados: '', recebimentosTotal: '' });
  const [evidencias, definirEvidencias] = useState('');
  const [motivacao, definirMotivacao] = useState('');
  const [tentou, definirTentou] = useState(false);
  const periodoValido = /^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim) && inicio <= fim;
  const previa = usePreviaAvaliacao(contrato.id, periodoValido ? { periodoInicio: inicio, periodoFim: fim } : null);
  const idFormulario = `${base}-formulario`;

  // As contagens vêm dos termos de recebimento da fiscalização; ao mudar o período, são recarregadas uma vez (o agente pode ajustá-las depois).
  const periodoAplicado = useRef('');
  useEffect(() => {
    const dados = previa.data;
    if (!dados) return;
    const chave = `${dados.periodoInicio}|${dados.periodoFim}`;
    if (periodoAplicado.current === chave) return;
    periodoAplicado.current = chave;
    definirContagens({
      entregasNoPrazo: String(dados.entregas.noPrazo),
      entregasTotal: String(dados.entregas.total),
      recebimentosAprovados: String(dados.recebimentos.aprovados),
      recebimentosTotal: String(dados.recebimentos.total),
    });
  }, [previa.data]);

  const erroPeriodo = !periodoValido ? 'Informe o início e o fim do período, com o fim igual ou posterior ao início.' : null;
  const erroQtd = erroContagens(contagens);
  const erroEvidencias = evidencias.trim().length < 10 ? 'Indique os documentos que comprovam as contagens (ao menos 10 caracteres).' : null;
  const erroMotivacao = motivacao.trim().length < MINIMO_MOTIVACAO ? `Registre a avaliação motivada com ao menos ${MINIMO_MOTIVACAO} caracteres.` : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (erroPeriodo || erroQtd || erroEvidencias || erroMotivacao) return;
    emitir.mutate(
      {
        tipo,
        periodoInicio: inicio,
        periodoFim: fim,
        entregasNoPrazo: Number(contagens.entregasNoPrazo),
        entregasTotal: Number(contagens.entregasTotal),
        recebimentosAprovados: Number(contagens.recebimentosAprovados),
        recebimentosTotal: Number(contagens.recebimentosTotal),
        evidencias: evidencias.trim(),
        motivacao: motivacao.trim(),
      },
      {
        onSuccess: (a) => {
          avisar({ tipo: 'sucesso', titulo: 'Avaliação emitida', mensagem: `Nota ${formatarNotaIdc(a.nota)} — protocolo ${a.protocolo}. O contratado pode se manifestar até ${formatarData(a.prazoManifestacao)}.` });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      largura="ampla"
      titulo={`Avaliação de desempenho — Contrato ${contrato.numero}`}
      descricao={
        <p>
          Informe o período e as contagens aferidas nos termos de recebimento. As ocorrências e as sanções do período vêm dos registros da Ágora, e a nota é
          calculada pelo servidor com os indicadores do IDC (art. 88, § 3º). A motivação explica os fatos e não altera a nota.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={emitir.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={emitir.isPending}>
            Emitir avaliação
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="Momento da avaliação"
          nome={`${base}-tipo`}
          horizontal
          valor={tipo}
          aoMudar={definirTipo}
          opcoes={[
            { valor: 'parcial', rotulo: 'Final de etapa da execução (parcial)' },
            { valor: 'final', rotulo: 'Conclusão do contrato (final)' },
          ]}
        />
        <div className="formulario__linha">
          <CampoTexto id={`${base}-inicio`} rotulo="Início do período avaliado" type="date" value={inicio} onChange={(e) => definirInicio(e.target.value)} erro={tentou ? erroPeriodo : null} />
          <CampoTexto id={`${base}-fim`} rotulo="Fim do período avaliado" type="date" value={fim} onChange={(e) => definirFim(e.target.value)} />
        </div>
        {previa.data ? (
          <Alerta tipo="info" compacto titulo="Dados do período registrados na Ágora">
            <p>
              Ocorrências da fiscalização: {previa.data.ocorrencias.total} ({previa.data.ocorrencias.resolvidasNoPrazo} resolvida(s) no prazo, {previa.data.ocorrencias.abertas} em
              aberto). Sanções aplicadas no período: {previa.data.sancoesNoPeriodo.length === 0 ? 'nenhuma' : previa.data.sancoesNoPeriodo.length}.
              {` Entregas no prazo: ${previa.data.entregas.noPrazo}/${previa.data.entregas.total}.`}
              {` Recebimentos sem ressalva: ${previa.data.recebimentos.aprovados}/${previa.data.recebimentos.total}.`}
            </p>
          </Alerta>
        ) : null}
        <CamposContagens valores={contagens} aoMudar={definirContagens} base={base} />
        {tentou && erroQtd ? (
          <p className="campo__erro" role="alert">
            {erroQtd}
          </p>
        ) : null}
        <AreaTexto
          rotulo="Evidências (documentos que comprovam as contagens)"
          obrigatorio
          rows={2}
          maxLength={2000}
          value={evidencias}
          erro={tentou ? erroEvidencias : null}
          onChange={(e) => definirEvidencias(e.target.value)}
        />
        <AreaTexto
          rotulo="Avaliação motivada"
          obrigatorio
          rows={4}
          maxLength={5000}
          contador
          value={motivacao}
          erro={tentou ? erroMotivacao : null}
          ajuda="Descreva os fatos do período que explicam os indicadores (atrasos, falhas, correções)."
          onChange={(e) => definirMotivacao(e.target.value)}
        />
        <ErroOperacao erro={emitir.error} titulo="A avaliação não foi emitida" />
      </form>
    </Dialogo>
  );
}

interface PropsDialogoAvaliacao {
  contratoId: string;
  avaliacao: AvaliacaoDesempenho;
  aberto: boolean;
  aoFechar: () => void;
  /** Depois do sucesso: o botão que abriu o diálogo some, e o foco vai para o título do cartão. */
  aoConcluir: () => void;
}

function DialogoManifestacao({ contratoId, avaliacao, aberto, aoFechar, aoConcluir }: PropsDialogoAvaliacao) {
  const base = useId();
  const { avisar } = useAvisos();
  const registrar = useRegistrarManifestacao(contratoId);
  const [texto, definirTexto] = useState('');
  const [recebidaEm, definirRecebidaEm] = useState(hojeISO(new Date()));
  const [concorda, definirConcorda] = useState<'sim' | 'nao' | null>(null);
  const [tentou, definirTentou] = useState(false);
  const idFormulario = `${base}-formulario`;
  const erroTexto = texto.trim().length < 10 ? 'Transcreva a manifestação do contratado (ao menos 10 caracteres).' : null;
  const erroConcorda = concorda === null ? 'Informe se o contratado concorda com a avaliação.' : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (erroTexto || erroConcorda) return;
    registrar.mutate(
      { id: avaliacao.id, entrada: { texto: texto.trim(), recebidaEm, concorda: concorda === 'sim' } },
      {
        onSuccess: (a) => {
          avisar({ tipo: 'sucesso', titulo: 'Manifestação registrada', mensagem: a.explicacaoSituacao });
          aoConcluir();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={`Manifestação do contratado — ${avaliacao.protocolo}`}
      descricao={<p>Registre a manifestação recebida por SEI, e-mail ou ofício até {formatarData(avaliacao.prazoManifestacao)}.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar manifestação
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="O contratado concorda com a avaliação?"
          nome={`${base}-concorda`}
          horizontal
          obrigatorio
          valor={concorda}
          aoMudar={definirConcorda}
          erro={tentou ? erroConcorda : null}
          opcoes={[
            { valor: 'sim', rotulo: 'Concorda' },
            { valor: 'nao', rotulo: 'Discorda' },
          ]}
        />
        <CampoTexto id={`${base}-recebida`} rotulo="Recebida em" type="date" value={recebidaEm} onChange={(e) => definirRecebidaEm(e.target.value)} />
        <AreaTexto rotulo="Manifestação do contratado" obrigatorio rows={3} maxLength={5000} value={texto} erro={tentou ? erroTexto : null} onChange={(e) => definirTexto(e.target.value)} />
        <ErroOperacao erro={registrar.error} titulo="A manifestação não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoAnalise({ contratoId, avaliacao, aberto, aoFechar, aoConcluir }: PropsDialogoAvaliacao) {
  const base = useId();
  const { avisar } = useAvisos();
  const analisar = useAnalisarManifestacao(contratoId);
  const [decisao, definirDecisao] = useState<'mantida' | 'revista' | null>(null);
  const [motivacao, definirMotivacao] = useState('');
  const [contagens, definirContagens] = useState<Contagens>({
    entregasNoPrazo: String(avaliacao.indicadores.entregasNoPrazo),
    entregasTotal: String(avaliacao.indicadores.entregasTotal),
    recebimentosAprovados: String(avaliacao.indicadores.recebimentosAprovados),
    recebimentosTotal: String(avaliacao.indicadores.recebimentosTotal),
  });
  const [tentou, definirTentou] = useState(false);
  const idFormulario = `${base}-formulario`;
  const erroDecisao = decisao === null ? 'Escolha manter ou revisar a avaliação.' : null;
  const erroMotivacao = motivacao.trim().length < MINIMO_MOTIVACAO ? `Motive a análise com ao menos ${MINIMO_MOTIVACAO} caracteres.` : null;
  const erroQtd = decisao === 'revista' ? erroContagens(contagens) : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (erroDecisao || erroMotivacao || erroQtd || decisao === null) return;
    analisar.mutate(
      {
        id: avaliacao.id,
        entrada:
          decisao === 'revista'
            ? {
                decisao,
                motivacao: motivacao.trim(),
                entregasNoPrazo: Number(contagens.entregasNoPrazo),
                entregasTotal: Number(contagens.entregasTotal),
                recebimentosAprovados: Number(contagens.recebimentosAprovados),
                recebimentosTotal: Number(contagens.recebimentosTotal),
              }
            : { decisao, motivacao: motivacao.trim() },
      },
      {
        onSuccess: (a) => {
          avisar({ tipo: 'sucesso', titulo: 'Análise registrada', mensagem: `Nota ${formatarNotaIdc(a.nota)} — avaliação definitiva.` });
          aoConcluir();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      largura="ampla"
      titulo={`Análise da manifestação — ${avaliacao.protocolo}`}
      descricao={<p>Mantenha a avaliação ou revise as contagens aferidas; a nota é recalculada pelo servidor.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={analisar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={analisar.isPending}>
            Registrar análise
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        {avaliacao.manifestacao ? (
          <Alerta tipo="info" compacto titulo={`Manifestação recebida em ${formatarData(avaliacao.manifestacao.recebidaEm)}`}>
            <p>{avaliacao.manifestacao.texto}</p>
          </Alerta>
        ) : null}
        <GrupoOpcoes
          legenda="Decisão"
          nome={`${base}-decisao`}
          horizontal
          obrigatorio
          valor={decisao}
          aoMudar={definirDecisao}
          erro={tentou ? erroDecisao : null}
          opcoes={[
            { valor: 'mantida', rotulo: 'Manter a avaliação' },
            { valor: 'revista', rotulo: 'Revisar as contagens' },
          ]}
        />
        {decisao === 'revista' ? <CamposContagens valores={contagens} aoMudar={definirContagens} base={base} /> : null}
        {tentou && erroQtd ? (
          <p className="campo__erro" role="alert">
            {erroQtd}
          </p>
        ) : null}
        <AreaTexto rotulo="Motivação da análise" obrigatorio rows={3} maxLength={5000} value={motivacao} erro={tentou ? erroMotivacao : null} onChange={(e) => definirMotivacao(e.target.value)} />
        <ErroOperacao erro={analisar.error} titulo="A análise não foi registrada" />
      </form>
    </Dialogo>
  );
}

function CartaoAvaliacao({ contratoId, avaliacao, avaliador }: { contratoId: string; avaliacao: AvaliacaoDesempenho; avaliador: AvaliadorContrato }) {
  const base = useId();
  const [dialogo, definirDialogo] = useState<'manifestacao' | 'analise' | null>(null);
  const [aberturas, definirAberturas] = useState(0);
  const abrir = (qual: 'manifestacao' | 'analise') => {
    definirAberturas((n) => n + 1);
    definirDialogo(qual);
  };
  const titulo = useRef<HTMLHeadingElement>(null);
  const concluir = () => {
    definirDialogo(null);
    window.requestAnimationFrame(() => titulo.current?.focus());
  };
  const situacao = SITUACOES[avaliacao.situacao];
  const faixa = FAIXAS_IDC[avaliacao.faixa];
  return (
    <article className="pilha pilha--compacta jornada-referencia" aria-labelledby={`${base}-titulo`}>
      <h4 id={`${base}-titulo`} ref={titulo} tabIndex={-1} className="jornada-requisitos__titulo">
        Avaliação {avaliacao.tipo === 'final' ? 'final' : 'parcial'} — {formatarData(avaliacao.periodoInicio)} a {formatarData(avaliacao.periodoFim)}
      </h4>
      <p className="linha">
        <span className="texto-forte numero">Nota {formatarNotaIdc(avaliacao.nota)}</span>
        <Etiqueta tom={faixa.tom} compacta>
          Faixa {faixa.rotulo.toLowerCase()}
        </Etiqueta>
        <Etiqueta tom={situacao.tom} compacta>
          {situacao.rotulo}
        </Etiqueta>
        {avaliacao.versao > 1 ? (
          <Etiqueta tom="info" compacta>
            Versão {avaliacao.versao}
          </Etiqueta>
        ) : null}
      </p>
      <p className="texto-pequeno">{avaliacao.explicacaoSituacao}</p>
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: 'Protocolo do registro', valor: <span className="mono">{avaliacao.protocolo}</span> },
          { termo: 'Avaliador', valor: `${avaliacao.avaliador.nome} (${avaliacao.avaliador.papel === 'gestor' ? 'gestor' : 'fiscal'})` },
          { termo: 'Emitida em', valor: formatarInstante(avaliacao.emitidaEm) },
          { termo: 'Entregas no prazo', valor: `${avaliacao.indicadores.entregasNoPrazo} de ${avaliacao.indicadores.entregasTotal}` },
          { termo: 'Recebimentos sem ressalva', valor: `${avaliacao.indicadores.recebimentosAprovados} de ${avaliacao.indicadores.recebimentosTotal}` },
          { termo: 'Ocorrências resolvidas no prazo', valor: `${avaliacao.indicadores.ocorrenciasResolvidasNoPrazo} de ${avaliacao.indicadores.ocorrenciasFiscalizacao}` },
          { termo: 'Motivação', valor: avaliacao.motivacao, largo: true },
          { termo: 'Cadastro de atesto do PNCP', valor: avaliacao.envioCadastro.explicacao, largo: true },
        ]}
      />
      {avaliacao.manifestacao ? (
        <p className="texto-pequeno">
          Manifestação do contratado em {formatarData(avaliacao.manifestacao.recebidaEm)} ({avaliacao.manifestacao.concorda ? 'concorda' : 'discorda'}): {avaliacao.manifestacao.texto}
        </p>
      ) : null}
      {avaliacao.analise ? (
        <p className="texto-pequeno">
          Análise ({avaliacao.analise.decisao === 'revista' ? 'avaliação revista' : 'avaliação mantida'}) por {avaliacao.analise.por.nome}: {avaliacao.analise.motivacao}
        </p>
      ) : null}
      <div className="linha">
        <LinkExterno href={urlDocumentoAvaliacao(avaliacao.id)}>
          <FileText size={16} aria-hidden="true" /> Documento da avaliação (PDF)
        </LinkExterno>
        {avaliador.podeAvaliar && avaliacao.situacao === 'em_manifestacao' ? (
          <Botao tamanho="compacto" icone={MessageSquareText} onClick={() => abrir('manifestacao')}>
            Registrar manifestação do contratado
          </Botao>
        ) : null}
        {avaliador.podeAvaliar && avaliacao.situacao === 'manifestada' ? (
          <Botao tamanho="compacto" icone={Scale} onClick={() => abrir('analise')}>
            Analisar manifestação
          </Botao>
        ) : null}
      </div>
      {dialogo === 'manifestacao' ? (
        <DialogoManifestacao key={aberturas} contratoId={contratoId} avaliacao={avaliacao} aberto aoFechar={() => definirDialogo(null)} aoConcluir={concluir} />
      ) : null}
      {dialogo === 'analise' ? <DialogoAnalise key={aberturas} contratoId={contratoId} avaliacao={avaliacao} aberto aoFechar={() => definirDialogo(null)} aoConcluir={concluir} /> : null}
    </article>
  );
}

export function AbaAvaliacoesContrato({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useAvaliacoesContrato(contrato.id);
  const [emitindo, definirEmitindo] = useState(false);
  const [aberturas, definirAberturas] = useState(0);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando as avaliações de desempenho">
      {(dados) => (
        <div className="pilha">
          <Alerta
            tipo="info"
            titulo="Avaliação de desempenho do contratado (art. 88, § 3º)"
            acoes={
              dados.avaliador.podeAvaliar ? (
                <Botao
                  variante="primario"
                  icone={ClipboardCheck}
                  onClick={() => {
                    definirAberturas((n) => n + 1);
                    definirEmitindo(true);
                  }}
                >
                  Emitir avaliação de desempenho
                </Botao>
              ) : null
            }
          >
            <p>
              Ao final de cada etapa ou na conclusão, o gestor ou o fiscal designado avalia o contratado com indicadores objetivos. A avaliação definitiva
              passa a constar do registro cadastral do fornecedor e é usada no desempate (art. 60, II) e, quando o edital prevê, na pontuação técnica.
            </p>
            {dados.avaliador.motivo ? <p className="texto-pequeno texto-secundario">{dados.avaliador.motivo}</p> : null}
          </Alerta>
          {dados.avaliacoes.length === 0 ? (
            <EstadoVazio icone={ClipboardCheck} titulo="Nenhuma avaliação emitida" descricao="As avaliações de desempenho deste contrato aparecem aqui." />
          ) : (
            dados.avaliacoes.map((a) => <CartaoAvaliacao key={a.id} contratoId={contrato.id} avaliacao={a} avaliador={dados.avaliador} />)
          )}
          {emitindo ? <DialogoEmitir key={aberturas} contrato={contrato} aberto aoFechar={() => definirEmitindo(false)} /> : null}
        </div>
      )}
    </ConteudoConsulta>
  );
}
