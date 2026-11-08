import { useParams } from 'react-router';
import { CalendarClock, CircleDollarSign, Package, PiggyBank, TriangleAlert } from 'lucide-react';
import type { AtaDetalhe as DadosAta, InfoReajuste, ItemAta } from '@agora/contratos';
import { formatarData, formatarMoeda, formatarMoedaCompacta } from '@agora/dominio';
import { useAta, useContratosDaAta, useHistoricoAta, useItensAta, useReajusteAta, useTarefasAta } from '../../api/atas';
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
  EtiquetaPrioridade,
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
} from '../../componentes';
import { formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { COLUNAS_CONTRATO } from '../compartilhado/colunasContrato';
import { Historico } from '../compartilhado/Historico';
import { PlanoGestao } from '../compartilhado/PlanoGestao';
import { BotaoNotificar } from '../notificacoes/DialogoNotificar';

const COLUNAS_ITENS: ColunaTabela<ItemAta>[] = [
  { id: 'numero', cabecalho: 'Item', identificadora: true, fixa: true, ordenavel: true, valorOrdenacao: (i) => i.numero, celula: (i) => <span className="numero">{i.numero}</span> },
  { id: 'descricao', cabecalho: 'Descrição', prioritaria: true, larguraMinima: '16rem', celula: (i) => <TextoLongo texto={i.descricao} /> },
  { id: 'catmat', cabecalho: 'CATMAT/CATSER', ocultaPorPadrao: true, celula: (i) => (i.catmat ? <span className="mono">{i.catmat}</span> : '—') },
  { id: 'fornecedor', cabecalho: 'Fornecedor', ordenavel: true, valorOrdenacao: (i) => i.fornecedor, celula: (i) => i.fornecedor },
  { id: 'unidade', cabecalho: 'Unidade', celula: (i) => i.unidadeFornecimento },
  {
    id: 'valorUnitario',
    cabecalho: 'Valor unitário',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (i) => i.valorUnitario,
    celula: (i) => <span className="numero">{formatarMoeda(i.valorUnitario)}</span>,
  },
  {
    id: 'quantidades',
    cabecalho: 'Registrada / contratada / empenhada',
    alinhamento: 'fim',
    celula: (i) => (
      <span className="numero">
        {formatarNumero(i.quantidadeRegistrada)} / {formatarNumero(i.quantidadeContratada)} / {formatarNumero(i.quantidadeEmpenhada)}
      </span>
    ),
  },
  {
    id: 'consumo',
    cabecalho: 'Consumo',
    prioritaria: true,
    ordenavel: true,
    larguraMinima: '10rem',
    valorOrdenacao: (i) => i.percentualConsumido,
    celula: (i) => <BarraProgresso valor={i.percentualConsumido} rotulo={`Consumo do item ${i.numero}`} />,
  },
  {
    id: 'risco',
    cabecalho: 'Risco',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (i) => (i.emRisco ? 1 : 0),
    celula: (i) =>
      i.emRisco ? (
        <Etiqueta tom="erro" compacta>
          Em risco
        </Etiqueta>
      ) : (
        <Etiqueta tom="sucesso" compacta>
          Com saldo
        </Etiqueta>
      ),
  },
];

function AbaItens({ id }: { id: string }) {
  const consulta = useItensAta(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela />} rotuloCarregando="Carregando itens">
      {(itens) => (
        <Tabela
          id="ata-itens"
          legenda="Itens registrados na ata"
          colunas={COLUNAS_ITENS}
          linhas={itens}
          chave={(i) => i.id}
          ordenacaoInicial={{ por: 'numero', ordem: 'asc' }}
          destaque={(i) => (i.emRisco ? 'erro' : undefined)}
          vazio={<EstadoVazio icone={Package} titulo="A ata não tem itens registrados" />}
        />
      )}
    </ConteudoConsulta>
  );
}

function AbaContratos({ id }: { id: string }) {
  const consulta = useContratosDaAta(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela />} rotuloCarregando="Carregando contratos vinculados">
      {(contratos) => (
        <Tabela
          id="ata-contratos"
          legenda="Contratos firmados a partir desta ata"
          colunas={COLUNAS_CONTRATO}
          linhas={contratos}
          chave={(c) => c.id}
          ordenacaoInicial={{ por: 'vigenciaFim', ordem: 'asc' }}
          vazio={
            <EstadoVazio
              titulo="Nenhum contrato vinculado"
              descricao="Contratos sem ata podem ser vinculados a esta ata na tela Vínculos."
              acao={
                <LinkBotao to="/vinculos" variante="secundario">
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

function ConteudoReajuste({ reajuste }: { reajuste: InfoReajuste }) {
  return (
    <div className="pilha">
      <ListaDefinicoes
        itens={[
          { termo: 'Índice', valor: reajuste.indice },
          { termo: 'Data-base', valor: formatarData(reajuste.dataBase) },
          { termo: 'Próximo reajuste possível em', valor: <strong>{formatarData(reajuste.proximoReajustePossivelEm)}</strong> },
        ]}
      />
      <Alerta tipo="info" compacto>
        O reajuste em sentido estrito só pode ocorrer após 12 meses da data-base do orçamento (Lei 14.133/2021, art. 25, § 7º, e art. 92, §
        3º). {reajuste.observacao}
      </Alerta>
      <Tabela
        id="ata-reajustes"
        legenda="Ciclos de reajuste"
        semFerramentas
        linhas={reajuste.ciclos}
        chave={(c) => `${c.inicio}-${c.fim}`}
        colunas={[
          { id: 'periodo', cabecalho: 'Período', identificadora: true, fixa: true, celula: (c) => `${formatarData(c.inicio)} a ${formatarData(c.fim)}` },
          { id: 'percentual', cabecalho: 'Variação do índice', alinhamento: 'fim', prioritaria: true, celula: (c) => <span className="numero">{formatarPercentual(c.percentual, 2)}</span> },
          {
            id: 'aplicado',
            cabecalho: 'Aplicação',
            prioritaria: true,
            celula: (c) =>
              c.aplicadoEm ? (
                <Etiqueta tom="sucesso" compacta>
                  Aplicado em {formatarData(c.aplicadoEm)}
                </Etiqueta>
              ) : (
                <Etiqueta tom="aviso" compacta>
                  Não aplicado
                </Etiqueta>
              ),
          },
        ]}
        vazio={<EstadoVazio icone={CalendarClock} titulo="Nenhum ciclo de reajuste completado" descricao="O primeiro ciclo se completa 12 meses após a data-base." />}
      />
    </div>
  );
}

function AbaReajuste({ id }: { id: string }) {
  const consulta = useReajusteAta(id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={3} />} rotuloCarregando="Carregando reajuste">
      {(reajuste) => <ConteudoReajuste reajuste={reajuste} />}
    </ConteudoConsulta>
  );
}

function ConteudoAta({ ata }: { ata: DadosAta }) {
  const saldoPercentual = ata.valorRegistrado > 0 ? (ata.saldoContratavel / ata.valorRegistrado) * 100 : 0;
  return (
    <>
      <div className="grade grade--kpi">
        <Indicador
          rotulo="Valor registrado"
          icone={CircleDollarSign}
          tom="info"
          valor={formatarMoedaCompacta(ata.valorRegistrado)}
          valorAcessivel={formatarMoeda(ata.valorRegistrado)}
          detalhe={`${formatarNumero(ata.quantidadeItens)} itens`}
        />
        <Indicador
          rotulo="Saldo contratável"
          icone={PiggyBank}
          tom={saldoPercentual < 10 ? 'erro' : saldoPercentual < 25 ? 'aviso' : 'sucesso'}
          valor={formatarMoedaCompacta(ata.saldoContratavel)}
          valorAcessivel={formatarMoeda(ata.saldoContratavel)}
          detalhe={`${formatarPercentual(saldoPercentual)} do valor registrado`}
        />
        <Indicador
          rotulo="Consumo"
          icone={Package}
          tom={ata.percentualConsumido >= 90 ? 'erro' : ata.percentualConsumido >= 75 ? 'aviso' : 'info'}
          valor={formatarPercentual(ata.percentualConsumido)}
          detalhe={<BarraProgresso valor={ata.percentualConsumido} rotulo="Consumo da ata" mostrarValor={false} compacta />}
        />
        <Indicador
          rotulo="Itens em risco"
          icone={TriangleAlert}
          tom={ata.itensEmRisco > 0 ? 'erro' : 'sucesso'}
          valor={formatarNumero(ata.itensEmRisco)}
          detalhe="consumo ≥ 90% ou sem saldo"
        />
      </div>

      <div className="detalhe-grade">
        <Secao titulo="Dados da ata" id="dados-ata">
          <ListaDefinicoes
            itens={[
              { termo: 'Processo SEI', valor: <BotaoCopiar valor={ata.processoSei} rotulo="número do processo" /> },
              { termo: 'Modalidade', valor: ata.modalidade },
              { termo: 'Compra', valor: <span className="numero">{ata.numeroCompra}</span> },
              {
                termo: 'UASG gerenciadora',
                valor: (
                  <>
                    {ata.uasgGerenciadora.nome} <span className="texto-secundario numero">({ata.uasgGerenciadora.codigo})</span>
                  </>
                ),
              },
              { termo: 'Vigência', valor: `${formatarData(ata.vigenciaInicio)} a ${formatarData(ata.vigenciaFim)}` },
              { termo: 'Assinatura', valor: formatarData(ata.assinaturaEm) },
              {
                termo: 'Divulgação no PNCP',
                valor: ata.divulgacaoPncpEm ? (
                  formatarData(ata.divulgacaoPncpEm)
                ) : (
                  <Etiqueta tom="aviso" compacta>
                    Não divulgada
                  </Etiqueta>
                ),
              },
              { termo: 'Aceita adesão', valor: ata.aceitaAdesao ? 'Sim' : 'Não' },
              { termo: 'Criticidade', valor: <EtiquetaPrioridade valor={ata.criticidade} /> },
              { termo: 'Gestor', valor: ata.gestor?.nome ?? 'Sem gestor designado' },
              { termo: 'Identificador PNCP', valor: <BotaoCopiar valor={ata.idPncp} rotulo="identificador PNCP" /> },
              { termo: 'Fornecedores', valor: ata.fornecedores.join('; ') || '—', largo: true },
            ]}
          />
          <Proveniencia dados={ata.proveniencia} />
        </Secao>
        <div className="detalhe-grade__lateral">
          <Secao titulo="Linha do tempo" id="linha-tempo-ata">
            <LinhaDoTempo eventos={ata.linhaDoTempo} titulo="Linha do tempo da ata" />
          </Secao>
        </div>
      </div>

      <Abas
        rotulo="Informações da ata"
        abas={[
          { id: 'plano', rotulo: 'Plano de gestão', conteudo: () => <AbaPlano id={ata.id} /> },
          { id: 'itens', rotulo: 'Itens', contador: ata.quantidadeItens, conteudo: () => <AbaItens id={ata.id} /> },
          { id: 'contratos', rotulo: 'Contratos vinculados', conteudo: () => <AbaContratos id={ata.id} /> },
          { id: 'reajuste', rotulo: 'Reajuste', conteudo: () => <AbaReajuste id={ata.id} /> },
          { id: 'historico', rotulo: 'Histórico', conteudo: () => <AbaHistorico id={ata.id} /> },
        ]}
      />
    </>
  );
}

function AbaPlano({ id }: { id: string }) {
  return <PlanoGestao consulta={useTarefasAta(id)} />;
}

function AbaHistorico({ id }: { id: string }) {
  return <Historico consulta={useHistoricoAta(id)} />;
}

export default function AtaDetalhe() {
  const { id = '' } = useParams();
  const consulta = useAta(id);
  const ata = consulta.data;

  return (
    <Pagina
      titulo={ata ? `Ata ${ata.numero}` : 'Ata de registro de preços'}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Atas', para: '/atas' },
      ]}
      tela="atas.detalhe"
      subtitulo={ata ? ata.objeto : undefined}
      marcadores={
        ata ? (
          <>
            <EtiquetaSituacao valor={ata.situacao} />
            <Semaforo valor={ata.semaforo} vigenciaFim={ata.vigenciaFim} />
          </>
        ) : null
      }
      acoes={
        ata ? (
          <>
            <BotaoNotificar
              instrumento={{ tipo: 'ata', id: ata.id, identificador: `Ata ${ata.numero}`, gestor: ata.gestor, contratada: ata.fornecedores.join(', ') || 'fornecedoras registradas' }}
            />
            <LinkExterno href={ata.linkPncp} comoBotao="secundario">
              Abrir no PNCP
            </LinkExterno>
          </>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando a ata"
        naoEncontrado={{
          titulo: 'Ata não encontrada',
          descricao: 'A ata não existe ou está fora das UASGs do seu escopo.',
          acao: (
            <LinkBotao to="/atas" variante="primario">
              Voltar para atas
            </LinkBotao>
          ),
        }}
      >
        {(dados) => <ConteudoAta ata={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
