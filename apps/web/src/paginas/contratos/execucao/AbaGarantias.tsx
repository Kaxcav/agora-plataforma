import { useState, type FormEvent } from 'react';
import { BadgeDollarSign, ShieldCheck, ShieldPlus } from 'lucide-react';
import type {
  ContratoDetalhe,
  EntradaDecisaoAutoridade,
  ExecucaoContrato,
  FinalidadeGarantia,
  GarantiaContrato,
  ModalidadeGarantia,
  MotivoExecucaoGarantia,
  MultaContrato,
} from '@agora/contratos';
import { formatarData, formatarMoeda, planejarDescontoMulta, validarDataISO, type Centavos } from '@agora/dominio';
import { useAcaoGarantia, useDescontarMulta, useExecucaoContrato, useExigirGarantia } from '../../../api/execucao';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoMoeda,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  ListaDefinicoes,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { ErroFormulario, hoje, MODALIDADES, TOM_GARANTIA } from './comum';

/**
 * Aba Garantias (arts. 96 a 102; RN-35): exigência, apresentação, renovação, liberação e execução da garantia e o
 * desconto de multa aplicada (art. 156, § 8º), sempre por decisão registrada da autoridade competente.
 */

const MINIMO_JUSTIFICATIVA = 50;

const MOTIVOS_EXECUCAO: Record<MotivoExecucaoGarantia, string> = {
  ressarcimento_prejuizos: 'Ressarcimento de prejuízos à Administração',
  verbas_trabalhistas: 'Verbas trabalhistas, fundiárias e previdenciárias',
  retomada_seguradora: 'Retomada da execução pela seguradora (cláusula de retomada)',
};

type Acao = 'apresentacao' | 'renovacao' | 'liberacao' | 'execucao';

/** Campos da decisão da autoridade competente (quem, ato, data e justificativa). */
function CamposDecisao({ valores, aoMudar, erro }: { valores: EntradaDecisaoAutoridade; aoMudar: (v: EntradaDecisaoAutoridade) => void; erro?: string }) {
  return (
    <>
      <CampoTexto rotulo="Autoridade competente (nome e cargo)" obrigatorio maxLength={200} value={valores.autoridade} onChange={(e) => aoMudar({ ...valores, autoridade: e.target.value })} />
      <CampoTexto rotulo="Ato da decisão" obrigatorio maxLength={200} value={valores.ato} onChange={(e) => aoMudar({ ...valores, ato: e.target.value })} ajuda="Ex.: despacho no processo SEI." />
      <CampoTexto rotulo="Data da decisão" type="date" obrigatorio value={valores.decididaEm} max={hoje()} onChange={(e) => aoMudar({ ...valores, decididaEm: e.target.value })} />
      <AreaTexto
        rotulo="Justificativa"
        obrigatorio
        rows={3}
        maxLength={5000}
        contador
        value={valores.justificativa}
        onChange={(e) => aoMudar({ ...valores, justificativa: e.target.value })}
        erro={erro}
      />
    </>
  );
}

function decisaoValida(d: EntradaDecisaoAutoridade): string | undefined {
  if (d.autoridade.trim().length < 5 || d.ato.trim().length < 3 || !validarDataISO(d.decididaEm)) return 'Informe a autoridade, o ato e a data da decisão.';
  if (d.justificativa.trim().length < MINIMO_JUSTIFICATIVA) return `Registre a justificativa com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`;
  return undefined;
}

const DECISAO_VAZIA = (): EntradaDecisaoAutoridade => ({ autoridade: '', ato: '', decididaEm: hoje(), justificativa: '' });

function DialogoExigencia({ contrato, execucao, aberto, aoFechar }: { contrato: ContratoDetalhe; execucao: ExecucaoContrato; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const exigir = useExigirGarantia(contrato.id);
  const [finalidade, definirFinalidade] = useState<FinalidadeGarantia>('execucao');
  const [percentual, definirPercentual] = useState('5');
  const [valorBase, definirValorBase] = useState<Centavos | null>(null);
  const [justificativa, definirJustificativa] = useState('');
  const [grandeVulto, definirGrandeVulto] = useState(false);
  const [retomada, definirRetomada] = useState(false);
  const [modalidade, definirModalidade] = useState<ModalidadeGarantia | ''>('');
  const [prazo, definirPrazo] = useState(hoje());
  const [erro, definirErro] = useState<string | undefined>();
  const numero = Number(percentual.replace(',', '.'));
  const base = finalidade === 'execucao' ? execucao.baseGarantia.valorBase : (valorBase ?? 0);
  const fechar = () => {
    definirJustificativa('');
    definirErro(undefined);
    exigir.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!Number.isFinite(numero) || numero <= 0) {
      definirErro('Informe o percentual da garantia.');
      return;
    }
    if (finalidade === 'antecipacao' && !valorBase) {
      definirErro('Informe o valor antecipado.');
      return;
    }
    definirErro(undefined);
    exigir.mutate(
      {
        finalidade,
        percentual: numero,
        valorBase: finalidade === 'antecipacao' ? valorBase : null,
        justificativa: justificativa.trim() || null,
        grandeVultoEngenharia: grandeVulto,
        clausulaRetomada: retomada,
        modalidadeExigida: modalidade || null,
        prazoApresentacao: prazo,
      },
      {
        onSuccess: (r) => {
          avisar({ tipo: 'sucesso', titulo: 'Garantia exigida', mensagem: `${formatarMoeda(r.garantia.valorExigido)} até ${formatarData(prazo)}. A contratada foi notificada.` });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={exigir.isPending ? () => undefined : fechar}
      titulo="Exigir garantia"
      largura="media"
      descricao={
        <p>
          Até 5% do valor inicial; até 10% com justificativa da complexidade técnica e dos riscos; até 30% só em obra ou serviço de engenharia de
          grande vulto, em seguro-garantia com cláusula de retomada (arts. 98, 99 e 102). A modalidade é escolhida pela contratada.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={exigir.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-exigencia" carregando={exigir.isPending}>
            Exigir garantia
          </Botao>
        </>
      }
    >
      <form id="formulario-exigencia" className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="Finalidade"
          nome="finalidade-garantia"
          valor={finalidade}
          aoMudar={definirFinalidade}
          opcoes={[
            { valor: 'execucao', rotulo: 'Garantia de execução do contrato', ajuda: execucao.baseGarantia.fundamento },
            { valor: 'antecipacao', rotulo: 'Garantia adicional de pagamento antecipado (art. 145, § 2º)' },
          ]}
        />
        {finalidade === 'antecipacao' ? <CampoMoeda rotulo="Valor antecipado" obrigatorio valor={valorBase} aoMudar={definirValorBase} /> : null}
        <CampoTexto
          rotulo="Percentual (%)"
          type="number"
          step="0.1"
          min={0.1}
          max={finalidade === 'antecipacao' ? 100 : 30}
          obrigatorio
          value={percentual}
          onChange={(e) => definirPercentual(e.target.value)}
          ajuda={base > 0 && Number.isFinite(numero) ? `Valor exigido: ${formatarMoeda(Math.round((base * numero) / 100))} sobre ${formatarMoeda(base)}.` : undefined}
        />
        <AreaTexto rotulo="Justificativa do percentual" rows={3} maxLength={3000} value={justificativa} onChange={(e) => definirJustificativa(e.target.value)} ajuda="Obrigatória acima de 5%." />
        <CaixaSelecao rotulo="Obra ou serviço de engenharia de grande vulto" checked={grandeVulto} onChange={(e) => definirGrandeVulto(e.target.checked)} />
        <CaixaSelecao rotulo="Seguro-garantia com cláusula de retomada pela seguradora (art. 102)" checked={retomada} onChange={(e) => definirRetomada(e.target.checked)} />
        <Selecao
          rotulo="Modalidade exigida"
          value={modalidade}
          opcaoVazia="À escolha da contratada"
          onChange={(e) => definirModalidade(e.target.value as ModalidadeGarantia | '')}
          opcoes={[{ valor: 'seguro_garantia', rotulo: 'Seguro-garantia (obrigatório acima de 10%)' }]}
        />
        <CampoTexto rotulo="Prazo de apresentação" type="date" obrigatorio value={prazo} onChange={(e) => definirPrazo(e.target.value)} ajuda="No seguro-garantia, o edital dá ao menos 1 mês a partir da homologação (art. 96, § 3º)." />
        {erro ? (
          <Alerta tipo="erro" anunciar compacto>
            {erro}
          </Alerta>
        ) : null}
        <ErroFormulario erro={exigir.error} titulo="A garantia não foi exigida" />
      </form>
    </Dialogo>
  );
}

function DialogoAcaoGarantia({ alvo, aoFechar }: { alvo: { garantia: GarantiaContrato; acao: Acao } | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const executar = useAcaoGarantia();
  const g = alvo?.garantia;
  const [modalidade, definirModalidade] = useState<ModalidadeGarantia>('seguro_garantia');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [data, definirData] = useState(hoje());
  const [validaAte, definirValidaAte] = useState('');
  const [emissor, definirEmissor] = useState('');
  const [documento, definirDocumento] = useState('');
  const [culpaAdministracao, definirCulpa] = useState(false);
  const [observacao, definirObservacao] = useState('');
  const [motivo, definirMotivo] = useState<MotivoExecucaoGarantia>('ressarcimento_prejuizos');
  const [decisao, definirDecisao] = useState<EntradaDecisaoAutoridade>(DECISAO_VAZIA);
  const [erro, definirErro] = useState<string | undefined>();
  const titulos: Record<Acao, string> = {
    apresentacao: 'Registrar apresentação da garantia',
    renovacao: 'Registrar renovação da garantia',
    liberacao: 'Liberar a garantia',
    execucao: 'Executar a garantia',
  };
  const fechar = () => {
    definirValor(null);
    definirValidaAte('');
    definirEmissor('');
    definirDocumento('');
    definirObservacao('');
    definirDecisao(DECISAO_VAZIA());
    definirErro(undefined);
    executar.reset();
    aoFechar();
  };
  const sucesso = (titulo: string) => (r: { avisos: string[]; notificacaoId: string | null }) => {
    avisar({
      tipo: r.avisos.length > 0 ? 'aviso' : 'sucesso',
      titulo,
      mensagem: [...r.avisos, r.notificacaoId ? 'Aviso registrado na central de notificações.' : ''].filter(Boolean).join(' ') || 'Registro feito na trilha de auditoria.',
    });
    fechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!alvo || !g) return;
    if (alvo.acao === 'apresentacao') {
      if (valor === null || !validarDataISO(validaAte)) return definirErro('Informe o valor e a validade da garantia apresentada.');
      executar.mutate(
        { acao: 'apresentacao', id: g.id, entrada: { modalidade, valor, apresentadaEm: data, validaAte, emissor: emissor.trim() || null, documento: documento.trim() || null } },
        { onSuccess: sucesso('Apresentação da garantia registrada') },
      );
    } else if (alvo.acao === 'renovacao') {
      if (!validarDataISO(validaAte)) return definirErro('Informe a nova validade.');
      executar.mutate({ acao: 'renovacao', id: g.id, entrada: { data, validaAte, documento: documento.trim() || null, valor } }, { onSuccess: sucesso('Renovação registrada') });
    } else if (alvo.acao === 'liberacao') {
      if (observacao.trim().length < 10) return definirErro('Descreva a liberação com pelo menos 10 caracteres.');
      executar.mutate({ acao: 'liberacao', id: g.id, entrada: { data, extincaoCulpaAdministracao: culpaAdministracao, observacao: observacao.trim() } }, { onSuccess: sucesso('Garantia liberada') });
    } else {
      const problema = valor === null ? 'Informe o valor a executar.' : decisaoValida(decisao);
      if (problema || valor === null) return definirErro(problema);
      executar.mutate({ acao: 'execucao', id: g.id, entrada: { ...decisao, motivo, valor } }, { onSuccess: sucesso('Execução da garantia registrada') });
    }
    definirErro(undefined);
  };
  return (
    <Dialogo
      aberto={alvo !== null}
      aoFechar={executar.isPending ? () => undefined : fechar}
      titulo={alvo ? titulos[alvo.acao] : 'Garantia'}
      largura="media"
      descricao={
        g ? (
          <p>
            Garantia {g.finalidade === 'execucao' ? 'de execução' : 'adicional da antecipação'} de {formatarMoeda(g.valorExigido)} ({g.percentual}%).
            {alvo?.acao === 'liberacao' ? ' A liberação exige a fiel execução, sem entrega pendente nem multa por descontar; a caução em dinheiro é restituída com atualização (art. 100).' : ''}
            {alvo?.acao === 'execucao' ? ' A execução é decisão da autoridade competente (art. 139, III); a contratada é notificada para recompor a garantia.' : ''}
          </p>
        ) : null
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={executar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-acao-garantia" carregando={executar.isPending}>
            {alvo ? titulos[alvo.acao] : 'Confirmar'}
          </Botao>
        </>
      }
    >
      <form id="formulario-acao-garantia" className="formulario" onSubmit={enviar} noValidate>
        {alvo?.acao === 'apresentacao' ? (
          <>
            <Selecao
              rotulo="Modalidade escolhida pela contratada"
              obrigatorio
              value={modalidade}
              onChange={(e) => definirModalidade(e.target.value as ModalidadeGarantia)}
              opcoes={(Object.keys(MODALIDADES) as ModalidadeGarantia[]).map((m) => ({ valor: m, rotulo: MODALIDADES[m] }))}
            />
            <CampoMoeda rotulo="Valor da garantia" obrigatorio valor={valor} aoMudar={definirValor} ajuda={g ? `Exigido: ${formatarMoeda(g.valorExigido)}.` : undefined} />
            <CampoTexto rotulo="Apresentada em" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
            <CampoTexto rotulo="Válida até" type="date" obrigatorio value={validaAte} onChange={(e) => definirValidaAte(e.target.value)} />
            {modalidade !== 'caucao_dinheiro' ? (
              <>
                <CampoTexto rotulo="Emissor (seguradora, banco ou sociedade de capitalização)" maxLength={200} value={emissor} onChange={(e) => definirEmissor(e.target.value)} />
                <CampoTexto rotulo="Número da apólice, carta de fiança, título ou custódia" maxLength={120} value={documento} onChange={(e) => definirDocumento(e.target.value)} />
              </>
            ) : null}
          </>
        ) : null}
        {alvo?.acao === 'renovacao' ? (
          <>
            <CampoTexto rotulo="Data da renovação" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
            <CampoTexto rotulo="Nova validade" type="date" obrigatorio value={validaAte} min={g?.validaAte ?? undefined} onChange={(e) => definirValidaAte(e.target.value)} />
            <CampoTexto rotulo="Endosso ou novo documento" maxLength={120} value={documento} onChange={(e) => definirDocumento(e.target.value)} />
            <CampoMoeda rotulo="Complementação (recomposição)" valor={valor} aoMudar={definirValor} ajuda="Opcional: valor acrescentado para recompor o saldo." />
          </>
        ) : null}
        {alvo?.acao === 'liberacao' ? (
          <>
            <CampoTexto rotulo="Data da liberação" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
            <CaixaSelecao rotulo="Contrato extinto por culpa exclusiva da Administração" checked={culpaAdministracao} onChange={(e) => definirCulpa(e.target.checked)} />
            <AreaTexto rotulo="Observação" obrigatorio rows={2} maxLength={2000} value={observacao} onChange={(e) => definirObservacao(e.target.value)} />
          </>
        ) : null}
        {alvo?.acao === 'execucao' ? (
          <>
            <Selecao
              rotulo="Motivo"
              value={motivo}
              onChange={(e) => definirMotivo(e.target.value as MotivoExecucaoGarantia)}
              opcoes={(Object.keys(MOTIVOS_EXECUCAO) as MotivoExecucaoGarantia[]).map((m) => ({ valor: m, rotulo: MOTIVOS_EXECUCAO[m] }))}
            />
            <CampoMoeda rotulo="Valor a executar" obrigatorio valor={valor} aoMudar={definirValor} ajuda={g ? `Saldo: ${formatarMoeda(g.saldo)}.` : undefined} />
            <CamposDecisao valores={decisao} aoMudar={definirDecisao} />
          </>
        ) : null}
        {erro ? (
          <Alerta tipo="erro" anunciar compacto>
            {erro}
          </Alerta>
        ) : null}
        <ErroFormulario erro={executar.error} titulo="O registro não foi feito" />
      </form>
    </Dialogo>
  );
}

function DialogoDesconto({ execucao, multa, aoFechar }: { execucao: ExecucaoContrato; multa: MultaContrato | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const descontar = useDescontarMulta();
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [decisao, definirDecisao] = useState<EntradaDecisaoAutoridade>(DECISAO_VAZIA);
  const [erro, definirErro] = useState<string | undefined>();
  const saldoGarantia = execucao.garantias.filter((g) => g.finalidade === 'execucao' && (g.situacao === 'vigente' || g.situacao === 'vence_em_breve' || g.situacao === 'vencida')).reduce((t, g) => t + g.saldo, 0);
  const valorDecidido = valor ?? multa?.saldo ?? 0;
  const plano =
    multa && multa.saldo > 0 && valorDecidido > 0 && valorDecidido <= multa.saldo
      ? planejarDescontoMulta({
          saldoMulta: multa.saldo,
          pagamentosDevidos: execucao.pagamentosDevidos.map((p) => ({ id: p.pagamentoId, disponivel: p.disponivel })),
          saldoGarantia,
          valorDecidido,
        })
      : null;
  const fechar = () => {
    definirValor(null);
    definirDecisao(DECISAO_VAZIA());
    definirErro(undefined);
    descontar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!multa) return;
    const problema = decisaoValida(decisao);
    if (problema) return definirErro(problema);
    definirErro(undefined);
    descontar.mutate(
      { sancaoId: multa.sancaoId, entrada: { ...decisao, valor: valorDecidido } },
      {
        onSuccess: (r) => {
          const pagamentos = r.plano.pagamentos.reduce((t, p) => t + p.valor, 0);
          avisar({
            tipo: 'sucesso',
            titulo: 'Desconto de multa registrado',
            mensagem: `${formatarMoeda(pagamentos)} dos pagamentos devidos e ${formatarMoeda(r.plano.garantia)} da garantia. A contratada foi notificada.`,
          });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={multa !== null}
      aoFechar={descontar.isPending ? () => undefined : fechar}
      titulo="Descontar multa"
      largura="ampla"
      descricao={
        <p>
          A multa aplicada é descontada primeiro dos pagamentos devidos à contratada e, se não bastarem, da garantia; o restante é cobrado
          judicialmente (art. 156, § 8º). Registre a decisão da autoridade competente.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={descontar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-desconto" carregando={descontar.isPending}>
            Registrar desconto
          </Botao>
        </>
      }
    >
      <form id="formulario-desconto" className="formulario" onSubmit={enviar} noValidate>
        {multa ? (
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Multa aplicada', valor: <span className="numero">{formatarMoeda(multa.valorMulta)}</span> },
              { termo: 'Saldo a descontar', valor: <span className="numero">{formatarMoeda(multa.saldo)}</span> },
            ]}
          />
        ) : null}
        <CampoMoeda rotulo="Valor a descontar agora" valor={valor ?? multa?.saldo ?? null} aoMudar={definirValor} ajuda="Até o saldo da multa." />
        {plano ? (
          <section aria-labelledby="plano-desconto-titulo" className="pilha pilha--compacta">
            <h3 id="plano-desconto-titulo" className="secao__titulo">
              Como o desconto será feito
            </h3>
            <ul className="lista-simples">
              {plano.memoria.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <CamposDecisao valores={decisao} aoMudar={definirDecisao} />
        {erro ? (
          <Alerta tipo="erro" anunciar compacto>
            {erro}
          </Alerta>
        ) : null}
        <ErroFormulario erro={descontar.error} titulo="O desconto não foi registrado" />
      </form>
    </Dialogo>
  );
}

function CartaoGarantiaContrato({
  garantia,
  podeRegistrar,
  podeExecutar,
  aoAgir,
}: {
  garantia: GarantiaContrato;
  podeRegistrar: boolean;
  podeExecutar: boolean;
  aoAgir: (acao: Acao) => void;
}) {
  const g = garantia;
  const ativa = g.situacao !== 'liberada' && g.situacao !== 'executada' && g.situacao !== 'aguardando_apresentacao' && g.situacao !== 'apresentacao_vencida';
  const titulo = g.finalidade === 'execucao' ? 'Garantia de execução' : 'Garantia adicional da antecipação';
  return (
    <Secao
      titulo={titulo}
      id={`garantia-${g.id}`}
      nivel={3}
      acoes={
        <div className="linha">
          {podeRegistrar && (g.situacao === 'aguardando_apresentacao' || g.situacao === 'apresentacao_vencida') ? (
            <Botao variante="primario" tamanho="compacto" onClick={() => aoAgir('apresentacao')}>
              Registrar apresentação
            </Botao>
          ) : null}
          {podeRegistrar && ativa ? (
            <>
              <Botao variante="secundario" tamanho="compacto" onClick={() => aoAgir('renovacao')}>
                Renovar
              </Botao>
              <Botao variante="secundario" tamanho="compacto" onClick={() => aoAgir('liberacao')}>
                Liberar
              </Botao>
            </>
          ) : null}
          {podeExecutar && ativa ? (
            <Botao variante="secundario" tamanho="compacto" onClick={() => aoAgir('execucao')}>
              Executar
            </Botao>
          ) : null}
        </div>
      }
    >
      <div>
        <Etiqueta tom={TOM_GARANTIA[g.situacao]}>{g.rotuloSituacao}</Etiqueta>
      </div>
      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Exigida', valor: <span className="numero">{`${formatarMoeda(g.valorExigido)} (${g.percentual}% de ${formatarMoeda(g.valorBase)}${g.baseAnual ? ', valor anual' : ''})`}</span> },
          { termo: 'Prazo de apresentação', valor: g.prazoApresentacao ? formatarData(g.prazoApresentacao) : '—' },
          { termo: 'Modalidade', valor: g.modalidade ? MODALIDADES[g.modalidade] : 'Ainda não apresentada' },
          { termo: 'Saldo', valor: <span className="numero">{formatarMoeda(g.saldo)}</span> },
          { termo: 'Válida até', valor: g.validaAte ? `${formatarData(g.validaAte)}${g.diasParaVencer !== null && g.diasParaVencer >= 0 ? ` (${g.diasParaVencer} dias)` : ''}` : '—' },
          { termo: 'Documento', valor: [g.emissor, g.documento].filter(Boolean).join(' — ') || '—' },
          ...(g.valorRestituido !== null ? [{ termo: 'Valor restituído', valor: <span className="numero">{formatarMoeda(g.valorRestituido)}</span> }] : []),
        ]}
      />
      {g.alertas.length > 0 ? (
        <Alerta tipo="aviso" compacto>
          <ul className="lista-simples">
            {g.alertas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      <details>
        <summary>Movimentos da garantia ({g.movimentos.length})</summary>
        <ul className="lista-simples">
          {g.movimentos.map((m) => (
            <li key={m.id}>
              <span className="numero">{formatarData(m.data)}</span> — {m.descricao}
              {m.valor !== null ? <span className="numero"> ({formatarMoeda(m.valor)})</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </Secao>
  );
}

function ConteudoGarantias({ contrato, execucao }: { contrato: ContratoDetalhe; execucao: ExecucaoContrato }) {
  const { temPermissao } = useSessao();
  const [exigindo, definirExigindo] = useState(false);
  const [acao, definirAcao] = useState<{ garantia: GarantiaContrato; acao: Acao } | null>(null);
  const [descontando, definirDescontando] = useState<MultaContrato | null>(null);
  const podeRegistrar = temPermissao('garantias:registrar');
  const podeExecutar = temPermissao('garantias:executar');

  const colunasMultas: ColunaTabela<MultaContrato>[] = [
    { id: 'inciso', cabecalho: 'Infração (art. 155)', identificadora: true, celula: (m) => `Inciso ${m.incisoInfracao}` },
    { id: 'aplicada', cabecalho: 'Aplicada em', celula: (m) => (m.aplicadaEm ? formatarData(m.aplicadaEm) : '—') },
    { id: 'valor', cabecalho: 'Valor da multa', alinhamento: 'fim', prioritaria: true, celula: (m) => <span className="numero">{formatarMoeda(m.valorMulta)}</span> },
    { id: 'descontado', cabecalho: 'Descontado', alinhamento: 'fim', celula: (m) => <span className="numero">{formatarMoeda(m.descontado)}</span> },
    { id: 'saldo', cabecalho: 'Saldo', alinhamento: 'fim', prioritaria: true, celula: (m) => <span className="numero">{formatarMoeda(m.saldo)}</span> },
  ];

  return (
    <div className="pilha pilha--ampla">
      <Secao
        titulo="Garantias contratuais"
        id="garantias-contrato"
        nivel={3}
        descricao={<p>Exigência, apresentação, validade, renovação, liberação e execução (Lei 14.133/2021, arts. 96 a 102; RN-35).</p>}
        acoes={
          podeRegistrar ? (
            <Botao variante="primario" icone={ShieldPlus} onClick={() => definirExigindo(true)}>
              Exigir garantia
            </Botao>
          ) : null
        }
      >
        {execucao.garantias.length === 0 ? <EstadoVazio icone={ShieldCheck} titulo="Nenhuma garantia registrada" /> : null}
      </Secao>
      {execucao.garantias.map((g) => (
        <CartaoGarantiaContrato key={g.id} garantia={g} podeRegistrar={podeRegistrar} podeExecutar={podeExecutar} aoAgir={(a) => definirAcao({ garantia: g, acao: a })} />
      ))}

      {execucao.multas.length > 0 ? (
        <Secao titulo="Multas aplicadas" id="multas-contrato" nivel={3} descricao={<p>Desconto dos pagamentos devidos e da garantia (art. 156, § 8º).</p>}>
          <Tabela
            id="contrato-multas"
            legenda="Multas aplicadas no contrato"
            colunas={colunasMultas}
            linhas={execucao.multas}
            chave={(m) => m.sancaoId}
            semFerramentas
            acoes={
              podeExecutar
                ? {
                    cabecalho: 'Ações',
                    celula: (m) =>
                      m.saldo > 0 ? (
                        <Botao tamanho="compacto" variante="secundario" icone={BadgeDollarSign} aria-label={`Descontar a multa do inciso ${m.incisoInfracao}`} onClick={() => definirDescontando(m)}>
                          Descontar
                        </Botao>
                      ) : (
                        <span className="texto-pequeno texto-secundario">Quitada</span>
                      ),
                  }
                : undefined
            }
          />
        </Secao>
      ) : null}

      {podeRegistrar ? <DialogoExigencia contrato={contrato} execucao={execucao} aberto={exigindo} aoFechar={() => definirExigindo(false)} /> : null}
      <DialogoAcaoGarantia alvo={acao} aoFechar={() => definirAcao(null)} />
      {podeExecutar ? <DialogoDesconto execucao={execucao} multa={descontando} aoFechar={() => definirDescontando(null)} /> : null}
    </div>
  );
}

export function AbaGarantias({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useExecucaoContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} />} rotuloCarregando="Carregando as garantias do contrato">
      {(execucao) => <ConteudoGarantias contrato={contrato} execucao={execucao} />}
    </ConteudoConsulta>
  );
}
