import { useState, type FormEvent } from 'react';
import { CalendarClock, FileCheck2, PackageCheck, PackagePlus } from 'lucide-react';
import type {
  ContratoDetalhe,
  EntradaParametrosExecucao,
  ExecucaoContrato,
  ParametrosExecucaoContrato,
  RecebimentoContrato,
  ResultadoTermoRecebimento,
  TipoTermoRecebimento,
} from '@agora/contratos';
import { formatarData, formatarMoeda, validarDataISO, type Centavos } from '@agora/dominio';
import { useExecucaoContrato, useLavrarTermo, useRegistrarEntrega, useSalvarParametrosExecucao, urlTermoRecebimento } from '../../../api/execucao';
import {
  AreaTexto,
  Botao,
  CampoMoeda,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  LinkExterno,
  ListaDefinicoes,
  Secao,
  Selecao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
} from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { formatarCompetencia } from '../../../utilitarios/formatacao';
import { ErroFormulario, hoje, RESULTADOS_TERMO, SITUACOES_RECEBIMENTO, TOM_PRAZO } from './comum';

/**
 * Aba Recebimentos (art. 140; RN-34): prazos do contrato, entregas da contratada e termos de recebimento provisório
 * e definitivo, cada um com o seu PDF. O definitivo aceito atesta a nota fiscal ligada e inicia o prazo de pagamento.
 */

const MINIMO_OBSERVACAO = 30;

const PARAMETROS_VAZIOS: EntradaParametrosExecucao = {
  prazoProvisorioDiasUteis: 5,
  prazoDefinitivoDiasUteis: 15,
  prazoCorrecaoDiasUteis: 10,
  prazoLiquidacaoDiasUteis: 5,
  prazoPagamentoDias: 30,
  marcoPagamento: 'recebimento_definitivo',
  indiceAtualizacao: 'IPCA',
  jurosMoraMensal: 0,
  garantiaObjetoMeses: 0,
};

function paraEntrada(p: ParametrosExecucaoContrato | null): EntradaParametrosExecucao {
  if (!p) return PARAMETROS_VAZIOS;
  const { atualizadoEm: _atualizadoEm, atualizadoPor: _atualizadoPor, ...entrada } = p;
  return entrada;
}

function DialogoPrazos({ contrato, atuais, aberto, aoFechar }: { contrato: ContratoDetalhe; atuais: ParametrosExecucaoContrato | null; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const salvar = useSalvarParametrosExecucao(contrato.id);
  const [valores, definirValores] = useState<EntradaParametrosExecucao>(() => paraEntrada(atuais));
  const numero = (campo: keyof EntradaParametrosExecucao, rotulo: string, ajuda: string, minimo = 1) => (
    <CampoTexto
      rotulo={rotulo}
      type="number"
      inputMode="numeric"
      min={minimo}
      obrigatorio
      value={String(valores[campo])}
      onChange={(e) => definirValores((v) => ({ ...v, [campo]: Number(e.target.value) }))}
      ajuda={ajuda}
    />
  );
  const fechar = () => {
    salvar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(valores, {
      onSuccess: () => {
        avisar({ tipo: 'sucesso', titulo: 'Prazos do contrato registrados', mensagem: 'Os novos prazos valem para as próximas entregas e parcelas.' });
        fechar();
      },
    });
  };
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={salvar.isPending ? () => undefined : fechar}
      titulo="Prazos de recebimento e pagamento"
      largura="media"
      descricao={<p>Registre os prazos previstos no contrato (art. 92, VI e VII, e art. 140, § 3º). Dias úteis seguem o art. 183.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={salvar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-prazos-execucao" carregando={salvar.isPending}>
            Salvar prazos
          </Botao>
        </>
      }
    >
      <form id="formulario-prazos-execucao" className="formulario" onSubmit={enviar} noValidate>
        {numero('prazoProvisorioDiasUteis', 'Recebimento provisório (dias úteis)', 'Contados da entrega pela contratada.')}
        {numero('prazoDefinitivoDiasUteis', 'Recebimento definitivo (dias úteis)', 'Contados do recebimento provisório aceito.')}
        {numero('prazoCorrecaoDiasUteis', 'Correção ou substituição (dias úteis)', 'Prazo da contratada quando há ressalva ou rejeição.')}
        {numero('prazoLiquidacaoDiasUteis', 'Liquidação (dias úteis)', 'Contados do recebimento definitivo.')}
        {numero('prazoPagamentoDias', 'Pagamento (dias corridos)', 'Vencendo em dia sem expediente, passa ao dia útil seguinte.')}
        <GrupoOpcoes
          legenda="O prazo de pagamento conta a partir"
          nome="marco-pagamento"
          valor={valores.marcoPagamento}
          aoMudar={(v) => definirValores((atual) => ({ ...atual, marcoPagamento: v }))}
          opcoes={[
            { valor: 'recebimento_definitivo', rotulo: 'do recebimento definitivo' },
            { valor: 'liquidacao', rotulo: 'da liquidação' },
          ]}
        />
        <CampoTexto rotulo="Índice de atualização monetária" obrigatorio value={valores.indiceAtualizacao} maxLength={40} onChange={(e) => definirValores((v) => ({ ...v, indiceAtualizacao: e.target.value }))} />
        <CampoTexto
          rotulo="Juros de mora (% ao mês)"
          type="number"
          step="0.1"
          min={0}
          max={2}
          value={String(valores.jurosMoraMensal)}
          onChange={(e) => definirValores((v) => ({ ...v, jurosMoraMensal: Number(e.target.value) }))}
          ajuda="Use zero se o contrato não prevê juros por atraso imputável à Administração."
        />
        {numero('garantiaObjetoMeses', 'Garantia técnica do objeto (meses)', 'Contada do recebimento definitivo; zero se não houver.', 0)}
        <ErroFormulario erro={salvar.error} titulo="Os prazos não foram salvos" />
      </form>
    </Dialogo>
  );
}

function DialogoEntrega({ contrato, execucao, aberto, aoFechar }: { contrato: ContratoDetalhe; execucao: ExecucaoContrato; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarEntrega(contrato.id);
  const [descricao, definirDescricao] = useState('');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [entregueEm, definirEntregueEm] = useState(hoje());
  const [pagamentoId, definirPagamento] = useState('');
  const [erros, definirErros] = useState<{ descricao?: string; valor?: string; data?: string }>({});
  const fechar = () => {
    definirDescricao('');
    definirValor(null);
    definirPagamento('');
    definirErros({});
    registrar.reset();
    aoFechar();
  };
  const escolherNota = (id: string) => {
    definirPagamento(id);
    const nota = execucao.notasDisponiveis.find((n) => n.pagamentoId === id);
    if (nota && valor === null) definirValor(nota.valor);
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: typeof erros = {};
    if (descricao.trim().length < 5) novos.descricao = 'Descreva a entrega.';
    if (valor === null) novos.valor = 'Informe o valor da parcela entregue.';
    if (!validarDataISO(entregueEm) || entregueEm > hoje()) novos.data = 'Informe a data da entrega (não pode ser futura).';
    definirErros(novos);
    if (Object.keys(novos).length > 0 || valor === null) return;
    registrar.mutate(
      { descricao: descricao.trim(), valor, entregueEm, pagamentoId: pagamentoId || null },
      {
        onSuccess: (r) => {
          avisar({
            tipo: 'sucesso',
            titulo: `Entrega nº ${r.numero} registrada`,
            mensagem: r.prazoAtual ? `Recebimento provisório até ${formatarData(r.prazoAtual)}.` : 'Entrega registrada.',
          });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Registrar entrega"
      largura="media"
      descricao={<p>Registre o que a contratada entregou. O prazo do recebimento provisório começa na data da entrega.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-entrega" carregando={registrar.isPending}>
            Registrar entrega
          </Botao>
        </>
      }
    >
      <form id="formulario-entrega" className="formulario" onSubmit={enviar} noValidate>
        <AreaTexto rotulo="Descrição da entrega" obrigatorio rows={2} maxLength={500} value={descricao} onChange={(e) => definirDescricao(e.target.value)} erro={erros.descricao} />
        <Selecao
          rotulo="Nota fiscal"
          value={pagamentoId}
          onChange={(e) => escolherNota(e.target.value)}
          opcaoVazia="Sem nota fiscal ainda"
          opcoes={execucao.notasDisponiveis.map((n) => ({ valor: n.pagamentoId, rotulo: `${n.notaFiscal} — ${formatarCompetencia(n.competencia)} — ${formatarMoeda(n.valor)}` }))}
          ajuda="A nota ligada só é atestada com o recebimento definitivo da entrega."
        />
        <CampoMoeda rotulo="Valor da parcela" obrigatorio valor={valor} aoMudar={definirValor} erro={erros.valor} />
        <CampoTexto rotulo="Entregue em" type="date" obrigatorio value={entregueEm} max={hoje()} onChange={(e) => definirEntregueEm(e.target.value)} erro={erros.data} />
        <ErroFormulario erro={registrar.error} titulo="A entrega não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoTermo({ alvo, aoFechar }: { alvo: { recebimento: RecebimentoContrato; tipo: TipoTermoRecebimento } | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const lavrar = useLavrarTermo();
  const [resultado, definirResultado] = useState<ResultadoTermoRecebimento>('aceito');
  const [data, definirData] = useState(hoje());
  const [observacoes, definirObservacoes] = useState('');
  const [erro, definirErro] = useState<string | undefined>();
  const tipo = alvo?.tipo ?? 'provisorio';
  const titulo = tipo === 'provisorio' ? 'Termo de recebimento provisório' : 'Termo de recebimento definitivo';
  const fechar = () => {
    definirResultado('aceito');
    definirObservacoes('');
    definirErro(undefined);
    lavrar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!alvo) return;
    if (resultado !== 'aceito' && observacoes.trim().length < MINIMO_OBSERVACAO) {
      definirErro(`Descreva com pelo menos ${MINIMO_OBSERVACAO} caracteres o que está em desacordo com o contrato.`);
      return;
    }
    lavrar.mutate(
      { id: alvo.recebimento.id, entrada: { tipo, resultado, data, observacoes: observacoes.trim() || null } },
      {
        onSuccess: (r) => {
          const partes = [
            r.atesto ? `Nota fiscal ${r.atesto.notaFiscal} atestada${r.atesto.regular ? '' : ' com ressalva de regularidade'}.` : null,
            r.limitePagamento ? `Pagamento até ${formatarData(r.limitePagamento)}.` : null,
            r.notificacaoId ? 'A contratada foi notificada do prazo de correção.' : null,
            ...r.avisos,
          ].filter(Boolean);
          avisar({ tipo: resultado === 'aceito' ? 'sucesso' : 'aviso', titulo: `${titulo} registrado`, mensagem: partes.join(' ') || 'O termo em PDF está disponível na lista de entregas.' });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={alvo !== null}
      aoFechar={lavrar.isPending ? () => undefined : fechar}
      titulo={titulo}
      largura="media"
      descricao={
        alvo ? (
          <p>
            Entrega nº {alvo.recebimento.numero}: {alvo.recebimento.descricao}.{' '}
            {tipo === 'provisorio'
              ? 'O fiscal confere a entrega (art. 140, I, "a"); nas compras, o recebimento provisório é sumário.'
              : 'Quem recebe definitivamente confere o atendimento das exigências do contrato (art. 140, I, "b") e não pode ser quem lavrou o provisório. Aceito, o termo atesta a nota fiscal ligada e libera a liquidação.'}
          </p>
        ) : null
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={lavrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-termo" carregando={lavrar.isPending}>
            Registrar termo
          </Botao>
        </>
      }
    >
      <form id="formulario-termo" className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="Resultado"
          nome="resultado-termo"
          obrigatorio
          valor={resultado}
          aoMudar={definirResultado}
          opcoes={(Object.keys(RESULTADOS_TERMO) as ResultadoTermoRecebimento[]).map((r) => ({ valor: r, rotulo: RESULTADOS_TERMO[r] }))}
        />
        <CampoTexto rotulo="Data do termo" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
        <AreaTexto
          rotulo="Observações"
          obrigatorio={resultado !== 'aceito'}
          rows={4}
          maxLength={5000}
          contador
          value={observacoes}
          onChange={(e) => definirObservacoes(e.target.value)}
          erro={erro}
          ajuda={resultado === 'aceito' ? 'Opcional.' : 'Descreva o que está em desacordo; a contratada recebe o prazo para corrigir ou substituir.'}
        />
        <ErroFormulario erro={lavrar.error} titulo="O termo não foi registrado" />
      </form>
    </Dialogo>
  );
}

function proximoTermo(r: RecebimentoContrato): TipoTermoRecebimento | null {
  if (r.situacao === 'recebido') return null;
  if (r.situacao === 'aguardando_provisorio') return 'provisorio';
  if (r.situacao === 'aguardando_definitivo') return 'definitivo';
  return r.etapaCorrecao ?? 'provisorio';
}

function ConteudoRecebimentos({ contrato, execucao }: { contrato: ContratoDetalhe; execucao: ExecucaoContrato }) {
  const { temPermissao } = useSessao();
  const [editandoPrazos, definirEditandoPrazos] = useState(false);
  const [registrando, definirRegistrando] = useState(false);
  const [termo, definirTermo] = useState<{ recebimento: RecebimentoContrato; tipo: TipoTermoRecebimento } | null>(null);
  const podeDefinirPrazos = temPermissao('fiscalizacao:designar');
  const designado = execucao.meusPapeis.length > 0;
  const podeRegistrar = temPermissao('recebimentos:registrar') && designado && execucao.parametros !== null;
  const p = execucao.parametros;

  const colunas: ColunaTabela<RecebimentoContrato>[] = [
    { id: 'numero', cabecalho: 'Nº', identificadora: true, celula: (r) => <span className="numero">{r.numero}</span> },
    { id: 'descricao', cabecalho: 'Entrega', prioritaria: true, larguraMinima: '14rem', celula: (r) => <TextoLongo texto={r.descricao} /> },
    { id: 'valor', cabecalho: 'Valor', alinhamento: 'fim', celula: (r) => <span className="numero">{formatarMoeda(r.valor)}</span> },
    { id: 'entregue', cabecalho: 'Entregue em', celula: (r) => <span className="numero">{formatarData(r.entregueEm)}</span> },
    { id: 'nota', cabecalho: 'Nota fiscal', celula: (r) => (r.notaFiscal ? <span className="mono">{r.notaFiscal.numero}</span> : <span className="texto-secundario">—</span>) },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      larguraMinima: '12rem',
      celula: (r) => (
        <span className="pilha pilha--compacta">
          <Etiqueta tom={SITUACOES_RECEBIMENTO[r.situacao].tom} compacta>
            {SITUACOES_RECEBIMENTO[r.situacao].rotulo}
          </Etiqueta>
          {r.prazoAtual && r.situacaoPrazo ? (
            <span className="texto-pequeno">
              <Etiqueta tom={TOM_PRAZO[r.situacaoPrazo]} compacta icone={null}>
                {r.situacao === 'em_correcao' ? 'Novo exame' : 'Prazo'} até {formatarData(r.prazoAtual)}
              </Etiqueta>
            </span>
          ) : null}
          {r.prazoCorrecao && r.situacao === 'em_correcao' ? <span className="texto-pequeno">Correção até {formatarData(r.prazoCorrecao)}</span> : null}
          {r.definitivoEm ? <span className="texto-pequeno">Definitivo em {formatarData(r.definitivoEm)}</span> : null}
          {r.garantiaObjetoAte ? <span className="texto-pequeno">Garantia do objeto até {formatarData(r.garantiaObjetoAte)}</span> : null}
        </span>
      ),
    },
    {
      id: 'termos',
      cabecalho: 'Termos',
      larguraMinima: '12rem',
      celula: (r) =>
        r.termos.length === 0 ? (
          <span className="texto-secundario">—</span>
        ) : (
          <ul className="lista-simples">
            {r.termos.map((t) => (
              <li key={t.id}>
                <LinkExterno href={urlTermoRecebimento(t.id)}>
                  {t.tipo === 'provisorio' ? 'Provisório' : 'Definitivo'} de {formatarData(t.data)} (PDF)
                </LinkExterno>
                <span className="texto-pequeno texto-secundario"> {RESULTADOS_TERMO[t.resultado]} — {t.responsavel.nome}</span>
              </li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="pilha pilha--ampla">
      <Secao
        titulo="Prazos do contrato"
        id="prazos-execucao"
        nivel={3}
        descricao={<p>Prazos de recebimento, liquidação e pagamento previstos no contrato (art. 92, VI e VII; art. 140, § 3º).</p>}
        acoes={
          podeDefinirPrazos ? (
            <Botao variante="secundario" icone={CalendarClock} onClick={() => definirEditandoPrazos(true)}>
              {p ? 'Alterar prazos' : 'Definir prazos'}
            </Botao>
          ) : null
        }
      >
        {p ? (
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Recebimento provisório', valor: `${p.prazoProvisorioDiasUteis} dias úteis da entrega` },
              { termo: 'Recebimento definitivo', valor: `${p.prazoDefinitivoDiasUteis} dias úteis do provisório` },
              { termo: 'Correção ou substituição', valor: `${p.prazoCorrecaoDiasUteis} dias úteis` },
              { termo: 'Liquidação', valor: `${p.prazoLiquidacaoDiasUteis} dias úteis do definitivo` },
              {
                termo: 'Pagamento',
                valor: `${p.prazoPagamentoDias} dias ${p.marcoPagamento === 'recebimento_definitivo' ? 'do recebimento definitivo' : 'da liquidação'}`,
              },
              { termo: 'Atualização por atraso', valor: `${p.indiceAtualizacao}${p.jurosMoraMensal > 0 ? ` e juros de ${p.jurosMoraMensal}% ao mês` : ', sem juros'}` },
              { termo: 'Garantia técnica do objeto', valor: p.garantiaObjetoMeses > 0 ? `${p.garantiaObjetoMeses} meses do definitivo` : 'Não prevista' },
            ]}
          />
        ) : (
          <p className="texto-secundario">Os prazos ainda não foram registrados. Sem eles, as entregas não podem ser recebidas na Ágora.</p>
        )}
      </Secao>

      <Secao
        titulo="Entregas e termos de recebimento"
        id="recebimentos-contrato"
        nivel={3}
        descricao={<p>Recebimento provisório pelo fiscal e definitivo pelo gestor ou pela comissão (RN-34). O definitivo aceito atesta a nota fiscal ligada.</p>}
        acoes={
          podeRegistrar ? (
            <Botao variante="primario" icone={PackagePlus} onClick={() => definirRegistrando(true)}>
              Registrar entrega
            </Botao>
          ) : null
        }
      >
        {temPermissao('recebimentos:registrar') && !designado ? (
          <p className="texto-secundario">Você não está designado neste contrato: só gestor, fiscais e comissão de recebimento lavram os termos.</p>
        ) : null}
        <Tabela
          id="contrato-recebimentos"
          legenda="Entregas e termos de recebimento"
          colunas={colunas}
          linhas={execucao.recebimentos}
          chave={(r) => r.id}
          semFerramentas
          destaque={(r) => (r.situacaoPrazo === 'vencido' ? 'erro' : r.situacao === 'em_correcao' ? 'aviso' : undefined)}
          vazio={<EstadoVazio icone={PackageCheck} titulo="Nenhuma entrega registrada" />}
          acoes={
            temPermissao('recebimentos:registrar') && designado
              ? {
                  cabecalho: 'Ações',
                  celula: (r) => {
                    const tipo = proximoTermo(r);
                    if (!tipo) return <span className="texto-pequeno texto-secundario">—</span>;
                    return (
                      <Botao
                        tamanho="compacto"
                        variante="secundario"
                        icone={FileCheck2}
                        aria-label={`Lavrar o termo ${tipo === 'provisorio' ? 'provisório' : 'definitivo'} da entrega nº ${r.numero}`}
                        onClick={() => definirTermo({ recebimento: r, tipo })}
                      >
                        {tipo === 'provisorio' ? 'Termo provisório' : 'Termo definitivo'}
                      </Botao>
                    );
                  },
                }
              : undefined
          }
        />
      </Secao>

      {podeDefinirPrazos ? <DialogoPrazos key={p?.atualizadoEm ?? 'novo'} contrato={contrato} atuais={p} aberto={editandoPrazos} aoFechar={() => definirEditandoPrazos(false)} /> : null}
      {podeRegistrar ? <DialogoEntrega contrato={contrato} execucao={execucao} aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
      <DialogoTermo alvo={termo} aoFechar={() => definirTermo(null)} />
    </div>
  );
}

export function AbaRecebimentos({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useExecucaoContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} />} rotuloCarregando="Carregando os recebimentos do contrato">
      {(execucao) => <ConteudoRecebimentos contrato={contrato} execucao={execucao} />}
    </ConteudoConsulta>
  );
}
