import { Link, useParams } from 'react-router';
import { Banknote, CircleDollarSign, ListTodo, Package, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { ContratoDetalhe as DadosContrato, ItemContrato } from '@agora/contratos';
import { classificarVigencia, formatarData, formatarMoeda, formatarMoedaCompacta, hojeISO } from '@agora/dominio';
import {
  useContrato,
  useEmpenhosContrato,
  useHistoricoContrato,
  useItensContrato,
  usePagamentosContrato,
  useTarefasContrato,
} from '../../api/contratos';
import {
  Abas,
  Alerta,
  BarraProgresso,
  BotaoCopiar,
  ConteudoConsulta,
  EsqueletoDetalhe,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  EtiquetaSituacao,
  Indicador,
  LinhaDoTempo,
  LinkBotao,
  LinkExterno,
  ListaDefinicoes,
  Pagina,
  Proveniencia,
  Secao,
  Semaforo,
  Tabela,
  TextoLongo,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { COLUNAS_EMPENHO, COLUNAS_PAGAMENTO, semColunas } from '../compartilhado/colunasFinanceiro';
import { Historico } from '../compartilhado/Historico';
import { PlanoGestao } from '../compartilhado/PlanoGestao';
import { ORIGENS_CONTRATO } from '../compartilhado/rotulos';
import { AbaAlteracoes } from './alteracoes/AbaAlteracoes';
import { BotaoNotificar } from '../notificacoes/DialogoNotificar';
import { AbaRiscosContrato } from '../controle/AbaRiscosContrato';
import { AbaImrContrato } from './AbaImrContrato';
import { AbaAvaliacoesContrato } from '../desempenho/AbaAvaliacoesContrato';
import { AbaOcorrenciasContrato } from '../desempenho/AbaOcorrenciasContrato';

const DIVULGACAO: Record<DadosContrato['divulgacaoPncp']['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  divulgado_no_prazo: { rotulo: 'Divulgado no prazo', tom: 'sucesso' },
  divulgado_fora_do_prazo: { rotulo: 'Divulgado fora do prazo', tom: 'aviso' },
  pendente_no_prazo: { rotulo: 'Pendente, dentro do prazo', tom: 'info' },
  pendente_vencido: { rotulo: 'Pendente, prazo vencido', tom: 'erro' },
};

const SINAL_QUEIMA: Record<DadosContrato['queimaSaldo']['sinal'], { rotulo: string; tom: TomEtiqueta }> = {
  acelerado: { rotulo: 'Ritmo acelerado', tom: 'erro' },
  lento: { rotulo: 'Ritmo lento', tom: 'aviso' },
  normal: { rotulo: 'Ritmo compatível com o prazo', tom: 'sucesso' },
};

const COLUNAS_ITENS: ColunaTabela<ItemContrato>[] = [
  { id: 'numero', cabecalho: 'Item', identificadora: true, fixa: true, ordenavel: true, valorOrdenacao: (i) => i.numero, celula: (i) => <span className="numero">{i.numero}</span> },
  { id: 'descricao', cabecalho: 'Descrição', prioritaria: true, larguraMinima: '16rem', celula: (i) => <TextoLongo texto={i.descricao} /> },
  { id: 'unidade', cabecalho: 'Unidade', celula: (i) => i.unidadeFornecimento },
  { id: 'quantidade', cabecalho: 'Quantidade', alinhamento: 'fim', ordenavel: true, valorOrdenacao: (i) => i.quantidade, celula: (i) => <span className="numero">{formatarNumero(i.quantidade)}</span> },
  {
    id: 'valorUnitario',
    cabecalho: 'Valor unitário',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (i) => i.valorUnitario,
    celula: (i) => <span className="numero">{formatarMoeda(i.valorUnitario)}</span>,
  },
  {
    id: 'valorTotal',
    cabecalho: 'Valor total',
    alinhamento: 'fim',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (i) => i.valorTotal,
    celula: (i) => <span className="numero">{formatarMoeda(i.valorTotal)}</span>,
  },
  {
    id: 'empenhada',
    cabecalho: 'Qtd. empenhada',
    alinhamento: 'fim',
    valorOrdenacao: (i) => i.quantidadeEmpenhada,
    celula: (i) => <span className="numero">{formatarNumero(i.quantidadeEmpenhada)}</span>,
  },
  {
    id: 'recebimento',
    cabecalho: 'Recebimento',
    prioritaria: true,
    larguraMinima: '10rem',
    ordenavel: true,
    valorOrdenacao: (i) => (i.quantidade > 0 ? i.quantidadeRecebida / i.quantidade : 0),
    celula: (i) => (
      <BarraProgresso
        valor={i.quantidade > 0 ? (i.quantidadeRecebida / i.quantidade) * 100 : 0}
        rotulo={`Quantidade recebida do item ${i.numero}`}
        textoValor={`${formatarNumero(i.quantidadeRecebida)} de ${formatarNumero(i.quantidade)}`}
        tom="info"
      />
    ),
  },
];

function AbaPlano({ id }: { id: string }) {
  return <PlanoGestao consulta={useTarefasContrato(id)} />;
}

function AbaHistorico({ id }: { id: string }) {
  return <Historico consulta={useHistoricoContrato(id)} />;
}

function AbaItens({ id }: { id: string }) {
  const consulta = useItensContrato(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela />} rotuloCarregando="Carregando itens do contrato">
      {(itens) => (
        <Tabela
          id="contrato-itens"
          legenda="Itens do contrato"
          colunas={COLUNAS_ITENS}
          linhas={itens}
          chave={(i) => i.id}
          ordenacaoInicial={{ por: 'numero', ordem: 'asc' }}
          vazio={<EstadoVazio icone={Package} titulo="O contrato não tem itens cadastrados" />}
        />
      )}
    </ConteudoConsulta>
  );
}

function AbaEmpenhos({ id }: { id: string }) {
  const consulta = useEmpenhosContrato(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela />} rotuloCarregando="Carregando empenhos do contrato">
      {(empenhos) => (
        <Tabela
          id="contrato-empenhos"
          legenda="Notas de empenho do contrato"
          colunas={semColunas(COLUNAS_EMPENHO, ['contrato'])}
          linhas={empenhos}
          chave={(e) => e.id}
          ordenacaoInicial={{ por: 'emissaoEm', ordem: 'desc' }}
          vazio={
            <EstadoVazio
              icone={Wallet}
              titulo="Nenhum empenho vinculado"
              descricao="Empenhos emitidos sem contrato podem ser vinculados a este contrato na tela Vínculos."
              acao={
                <LinkBotao to="/vinculos?aba=empenhos-sem-contrato" variante="secundario">
                  Ir para Vínculos
                </LinkBotao>
              }
            />
          }
        />
      )}
    </ConteudoConsulta>
  );
}

function AbaPagamentos({ id }: { id: string }) {
  const consulta = usePagamentosContrato(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela />} rotuloCarregando="Carregando pagamentos do contrato">
      {(pagamentos) => (
        <div className="pilha">
          <p className="texto-secundario">
            A coluna “Ordem” indica a posição de cada parcela na fila de pagamentos por fonte de recurso (Lei 14.133/2021, art. 141). O atesto é
            feito na tela <Link to="/financeiro/pagamentos">Pagamentos</Link>.
          </p>
          <Tabela
            id="contrato-pagamentos"
            legenda="Pagamentos do contrato"
            colunas={semColunas(COLUNAS_PAGAMENTO, ['contrato', 'fornecedor'])}
            linhas={pagamentos}
            chave={(p) => p.id}
            ordenacaoInicial={{ por: 'vencimento', ordem: 'asc' }}
            destaque={(p) => (p.situacao === 'atrasado' ? 'erro' : undefined)}
            vazio={<EstadoVazio icone={Receipt} titulo="Nenhum pagamento registrado" descricao="As parcelas previstas e pagas aparecerão aqui." />}
          />
        </div>
      )}
    </ConteudoConsulta>
  );
}

function CartaoDivulgacao({ contrato }: { contrato: DadosContrato }) {
  const d = contrato.divulgacaoPncp;
  const def = DIVULGACAO[d.situacao];
  return (
    <Secao titulo="Divulgação no PNCP" id="divulgacao-pncp" nivel={2}>
      <div>
        <Etiqueta tom={def.tom}>{def.rotulo}</Etiqueta>
      </div>
      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Prazo limite', valor: <span className="numero">{formatarData(d.limite)}</span> },
          {
            termo: 'Divulgado em',
            valor: contrato.divulgacaoPncpEm ? <span className="numero">{formatarData(contrato.divulgacaoPncpEm)}</span> : 'Ainda não divulgado',
          },
        ]}
      />
      <p>{d.explicacao}</p>
      <p className="texto-pequeno texto-secundario">
        Fundamento: Lei 14.133/2021, art. 94 — a divulgação no PNCP é condição de eficácia do contrato (20 dias úteis após a assinatura para
        licitação; 10 para contratação direta).
      </p>
    </Secao>
  );
}

function CartaoQueima({ contrato }: { contrato: DadosContrato }) {
  const q = contrato.queimaSaldo;
  const sinal = SINAL_QUEIMA[q.sinal];
  return (
    <Secao titulo="Queima de saldo" id="queima-saldo" descricao="Projeção do ritmo de execução (RIA-07)">
      <div>
        <Etiqueta tom={sinal.tom} icone={q.sinal === 'acelerado' ? TrendingUp : q.sinal === 'lento' ? TrendingDown : undefined}>
          {sinal.rotulo}
        </Etiqueta>
      </div>
      <div className="medidor">
        <div className="medidor__linha">
          <span className="medidor__rotulo">Valor executado</span>
          <BarraProgresso valor={q.percentualExecutado} rotulo="Percentual do valor do contrato já executado" />
        </div>
        <div className="medidor__linha">
          <span className="medidor__rotulo">Vigência decorrida</span>
          <BarraProgresso valor={q.percentualTempoDecorrido} rotulo="Percentual do prazo de vigência já decorrido" tom="info" />
        </div>
      </div>
      <ListaDefinicoes
        colunas={2}
        itens={[
          {
            termo: 'Esgotamento projetado',
            valor: q.dataEsgotamentoProjetada ? (
              <span className="numero">{formatarData(q.dataEsgotamentoProjetada)}</span>
            ) : (
              'Sem projeção (nenhuma execução registrada)'
            ),
          },
          { termo: 'Fim da vigência', valor: <span className="numero">{formatarData(contrato.vigenciaFim)}</span> },
        ]}
      />
      {q.esgotaAntesDoFim ? (
        <Alerta tipo="aviso" compacto titulo="O saldo pode acabar antes do fim da vigência">
          Avalie com antecedência aditivo de acréscimo (art. 125) ou nova contratação.
        </Alerta>
      ) : null}
      <p>{q.explicacao}</p>
      <p className="texto-pequeno texto-secundario">Sinal para análise da equipe de gestão; não constitui decisão.</p>
    </Secao>
  );
}

function CartaoGarantia({ contrato }: { contrato: DadosContrato }) {
  const g = contrato.garantia;
  if (!g) {
    return (
      <Secao titulo="Garantia contratual" id="garantia">
        <p className="texto-secundario">Sem garantia registrada para este contrato.</p>
      </Secao>
    );
  }
  const vigencia = classificarVigencia(g.validaAte, hojeISO(new Date()));
  const tom: TomEtiqueta = vigencia.diasRestantes < 0 ? 'erro' : vigencia.diasRestantes <= 30 ? 'aviso' : 'sucesso';
  return (
    <Secao titulo="Garantia contratual" id="garantia">
      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Modalidade', valor: g.tipo },
          { termo: 'Valor', valor: <span className="numero">{formatarMoeda(g.valor)}</span> },
          {
            termo: 'Válida até',
            valor: (
              <span className="pilha pilha--compacta">
                <span className="numero">{formatarData(g.validaAte)}</span>
                <Etiqueta tom={tom} compacta>
                  {vigencia.rotulo}
                </Etiqueta>
              </span>
            ),
            largo: true,
          },
        ]}
      />
    </Secao>
  );
}

function ConteudoContrato({ contrato }: { contrato: DadosContrato }) {
  const percentualEmpenhado = contrato.valorGlobal > 0 ? (contrato.valorEmpenhado / contrato.valorGlobal) * 100 : 0;
  return (
    <>
      <div className="grade grade--kpi">
        <Indicador
          rotulo="Valor global"
          icone={CircleDollarSign}
          tom="info"
          valor={formatarMoedaCompacta(contrato.valorGlobal)}
          valorAcessivel={formatarMoeda(contrato.valorGlobal)}
          detalhe={`Inicial ${formatarMoedaCompacta(contrato.valorInicial)} + aditivos`}
        />
        <Indicador
          rotulo="Empenhado"
          icone={Wallet}
          tom="info"
          valor={formatarMoedaCompacta(contrato.valorEmpenhado)}
          valorAcessivel={formatarMoeda(contrato.valorEmpenhado)}
          detalhe={`${formatarPercentual(percentualEmpenhado)} do valor global`}
        />
        <Indicador
          rotulo="Pago"
          icone={Banknote}
          tom={contrato.percentualExecutado >= 90 ? 'aviso' : 'sucesso'}
          valor={formatarMoedaCompacta(contrato.valorPago)}
          valorAcessivel={formatarMoeda(contrato.valorPago)}
          detalhe={<BarraProgresso valor={contrato.percentualExecutado} rotulo="Execução financeira do contrato" compacta />}
        />
        <Indicador
          rotulo="Pendências abertas"
          icone={ListTodo}
          tom={contrato.pendenciasAbertas > 0 ? 'erro' : 'sucesso'}
          valor={formatarNumero(contrato.pendenciasAbertas)}
          detalhe={contrato.pendenciasAbertas > 0 ? 'Veja a fila no Início' : 'Nenhuma pendência'}
          para={contrato.pendenciasAbertas > 0 ? `/?busca=${encodeURIComponent(contrato.numero)}` : undefined}
        />
      </div>

      <div className="detalhe-grade">
        <div className="pilha pilha--ampla">
          <Secao titulo="Resumo do contrato" id="resumo-contrato">
            <ListaDefinicoes
              itens={[
                { termo: 'Processo SEI', valor: <BotaoCopiar valor={contrato.processoSei} rotulo="número do processo" /> },
                { termo: 'Origem', valor: ORIGENS_CONTRATO[contrato.origem] },
                { termo: 'Modalidade', valor: contrato.modalidade },
                {
                  termo: 'Fornecedor',
                  valor: (
                    <span className="pilha pilha--compacta">
                      <Link to={`/fornecedores/${contrato.fornecedor.id}`}>{contrato.fornecedor.razaoSocial}</Link>
                      <span className="mono texto-pequeno">{contrato.fornecedor.documento}</span>
                    </span>
                  ),
                },
                {
                  termo: 'UASG',
                  valor: (
                    <>
                      {contrato.uasg.nome} <span className="texto-secundario numero">({contrato.uasg.codigo})</span>
                    </>
                  ),
                },
                { termo: 'Vigência', valor: `${formatarData(contrato.vigenciaInicio)} a ${formatarData(contrato.vigenciaFim)}` },
                { termo: 'Assinatura', valor: formatarData(contrato.assinaturaEm) },
                { termo: 'Valor inicial', valor: <span className="numero">{formatarMoeda(contrato.valorInicial)}</span> },
                { termo: 'Acréscimos', valor: <span className="numero">{formatarMoeda(contrato.acrescimos)}</span> },
                { termo: 'Supressões', valor: <span className="numero">{formatarMoeda(contrato.supressoes)}</span> },
                { termo: 'Gestor', valor: contrato.gestor?.nome ?? 'Sem gestor designado' },
                { termo: 'Fiscal', valor: contrato.fiscal?.nome ?? 'Sem fiscal designado' },
                {
                  termo: 'Ata de origem',
                  valor: contrato.ataOrigem ? <Link to={`/atas/${contrato.ataOrigem.id}`}>Ata {contrato.ataOrigem.numero}</Link> : 'Sem ata',
                },
                {
                  termo: 'Identificador PNCP',
                  valor: contrato.idPncp ? <BotaoCopiar valor={contrato.idPncp} rotulo="identificador PNCP" /> : 'Não divulgado',
                },
              ]}
            />
            <Proveniencia dados={contrato.proveniencia} />
          </Secao>
          <Secao titulo="Linha do tempo" id="linha-tempo-contrato">
            <LinhaDoTempo eventos={contrato.linhaDoTempo} titulo="Linha do tempo do contrato" />
          </Secao>
        </div>
        <div className="detalhe-grade__lateral">
          <CartaoDivulgacao contrato={contrato} />
          <CartaoQueima contrato={contrato} />
          <CartaoGarantia contrato={contrato} />
        </div>
      </div>

      <Abas
        rotulo="Informações do contrato"
        abas={[
          { id: 'plano', rotulo: 'Plano de gestão', conteudo: () => <AbaPlano id={contrato.id} /> },
          { id: 'itens', rotulo: 'Itens', conteudo: () => <AbaItens id={contrato.id} /> },
          { id: 'empenhos', rotulo: 'Empenhos', conteudo: () => <AbaEmpenhos id={contrato.id} /> },
          { id: 'pagamentos', rotulo: 'Pagamentos', conteudo: () => <AbaPagamentos id={contrato.id} /> },
          { id: 'alteracoes', rotulo: 'Alterações', conteudo: () => <AbaAlteracoes contrato={contrato} /> },
          { id: 'historico', rotulo: 'Histórico', conteudo: () => <AbaHistorico id={contrato.id} /> },
          { id: 'riscos', rotulo: 'Matriz de riscos', conteudo: () => <AbaRiscosContrato contrato={contrato} /> },
          { id: 'imr', rotulo: 'IMR e medições', conteudo: () => <AbaImrContrato contrato={contrato} /> },
          { id: 'avaliacao-desempenho', rotulo: 'Avaliação de desempenho', conteudo: () => <AbaAvaliacoesContrato contrato={contrato} /> },
          { id: 'ocorrencias-execucao', rotulo: 'Ocorrências da execução', conteudo: () => <AbaOcorrenciasContrato contrato={contrato} /> },
        ]}
      />
    </>
  );
}

export default function ContratoDetalhe() {
  const { id = '' } = useParams();
  const consulta = useContrato(id);
  const contrato = consulta.data;

  return (
    <Pagina
      titulo={contrato ? `Contrato ${contrato.numero}` : 'Contrato'}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Contratos', para: '/contratos' },
      ]}
      tela="contratos.detalhe"
      subtitulo={contrato ? contrato.objeto : undefined}
      marcadores={
        contrato ? (
          <>
            <EtiquetaSituacao valor={contrato.situacao} />
            <Semaforo valor={contrato.semaforo} vigenciaFim={contrato.vigenciaFim} />
          </>
        ) : null
      }
      acoes={
        contrato ? (
          <>
            <BotaoNotificar
              instrumento={{
                tipo: 'contrato',
                id: contrato.id,
                identificador: `Contrato ${contrato.numero}`,
                gestor: contrato.gestor,
                fiscal: contrato.fiscal,
                contratada: contrato.fornecedor.razaoSocial,
                temGarantia: contrato.garantia !== null,
              }}
            />
            {contrato.linkPncp ? (
              <LinkExterno href={contrato.linkPncp} comoBotao="secundario">
                Abrir no PNCP
              </LinkExterno>
            ) : null}
          </>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando o contrato"
        naoEncontrado={{
          titulo: 'Contrato não encontrado',
          descricao: 'O contrato não existe ou está fora das UASGs do seu escopo.',
          acao: (
            <LinkBotao to="/contratos" variante="primario">
              Voltar para contratos
            </LinkBotao>
          ),
        }}
      >
        {(dados) => <ConteudoContrato contrato={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
