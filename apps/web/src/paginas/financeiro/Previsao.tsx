import { Link } from 'react-router';
import { Banknote, CalendarRange, ChartColumn, Percent } from 'lucide-react';
import type { PrevisaoPagamentos } from '@agora/contratos';
import { formatarMoeda, formatarMoedaCompacta } from '@agora/dominio';
import { usePrevisaoPagamentos } from '../../api/financeiro';
import {
  BarraProgresso,
  ConteudoConsulta,
  EsqueletoCartoes,
  EsqueletoTabela,
  EstadoVazio,
  GraficoBarras,
  Indicador,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  type ColunaTabela,
} from '../../componentes';
import { formatarMesCurto, formatarMesLongo, formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';

type LinhaContrato = PrevisaoPagamentos['porContrato'][number];

function percentualRealizado(previsto: number, realizado: number): number {
  return previsto > 0 ? (realizado / previsto) * 100 : 0;
}

const COLUNAS_CONTRATO: ColunaTabela<LinhaContrato>[] = [
  {
    id: 'contrato',
    cabecalho: 'Contrato',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (l) => l.contrato.numero,
    celula: (l) => <Link to={`/contratos/${l.contrato.id}`}>Contrato {l.contrato.numero}</Link>,
  },
  { id: 'fornecedor', cabecalho: 'Fornecedor', prioritaria: true, ordenavel: true, valorOrdenacao: (l) => l.fornecedor, celula: (l) => l.fornecedor },
  {
    id: 'previsto',
    cabecalho: 'Previsto no ano',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (l) => l.previstoAno,
    celula: (l) => <span className="numero">{formatarMoeda(l.previstoAno)}</span>,
  },
  {
    id: 'realizado',
    cabecalho: 'Realizado no ano',
    alinhamento: 'fim',
    ordenavel: true,
    prioritaria: true,
    valorOrdenacao: (l) => l.realizadoAno,
    celula: (l) => <span className="numero">{formatarMoeda(l.realizadoAno)}</span>,
  },
  {
    id: 'percentual',
    cabecalho: 'Realização',
    ordenavel: true,
    prioritaria: true,
    larguraMinima: '10rem',
    valorOrdenacao: (l) => percentualRealizado(l.previstoAno, l.realizadoAno),
    celula: (l) => (
      <BarraProgresso
        valor={percentualRealizado(l.previstoAno, l.realizadoAno)}
        rotulo={`Percentual realizado do contrato ${l.contrato.numero}`}
        tom="info"
      />
    ),
  },
];

function ConteudoPrevisao({ previsao }: { previsao: PrevisaoPagamentos }) {
  const totalPrevisto = previsao.meses.reduce((s, m) => s + m.previsto, 0);
  const totalRealizado = previsao.meses.reduce((s, m) => s + m.realizado, 0);
  const percentual = percentualRealizado(totalPrevisto, totalRealizado);

  return (
    <>
      <div className="grade grade--kpi">
        <Indicador
          rotulo={`Previsto em ${previsao.ano}`}
          icone={CalendarRange}
          tom="info"
          valor={formatarMoedaCompacta(totalPrevisto)}
          valorAcessivel={formatarMoeda(totalPrevisto)}
          detalhe="Soma das parcelas previstas"
        />
        <Indicador
          rotulo={`Realizado em ${previsao.ano}`}
          icone={Banknote}
          tom="sucesso"
          valor={formatarMoedaCompacta(totalRealizado)}
          valorAcessivel={formatarMoeda(totalRealizado)}
          detalhe="Pagamentos efetivados"
        />
        <Indicador
          rotulo="Realização"
          icone={Percent}
          tom={percentual >= 75 ? 'sucesso' : percentual >= 40 ? 'aviso' : 'erro'}
          valor={formatarPercentual(percentual)}
          detalhe={<BarraProgresso valor={percentual} rotulo="Percentual realizado do previsto no ano" mostrarValor={false} tom="info" compacta />}
        />
      </div>

      <Secao
        titulo="Previsto × realizado por mês"
        id="previsto-realizado"
        descricao="Barras contornadas: valor previsto; barras cheias: valor efetivamente pago."
      >
        {previsao.meses.length === 0 ? (
          <EstadoVazio icone={ChartColumn} titulo={`Sem previsão de pagamentos para ${previsao.ano}`} />
        ) : (
          <GraficoBarras
            titulo={`Pagamentos previstos e realizados por mês em ${previsao.ano}`}
            descricao={`Total previsto ${formatarMoeda(totalPrevisto)}; total realizado ${formatarMoeda(totalRealizado)} (${formatarPercentual(percentual)}).`}
            series={[
              { id: 'previsto', rotulo: 'Previsto', estilo: 'contorno' },
              { id: 'realizado', rotulo: 'Realizado', estilo: 'solido' },
            ]}
            categorias={previsao.meses.map((m) => ({
              id: m.mes,
              rotulo: formatarMesCurto(m.mes),
              rotuloCompleto: formatarMesLongo(m.mes),
              valores: { previsto: m.previsto, realizado: m.realizado },
            }))}
            formatarValor={formatarMoeda}
            formatarEixo={formatarMoedaCompacta}
            rotuloCategoria="Mês"
          />
        )}
      </Secao>

      <Tabela
        id="previsao-contratos"
        legenda={`Previsão por contrato em ${previsao.ano}`}
        colunas={COLUNAS_CONTRATO}
        linhas={previsao.porContrato}
        chave={(l) => l.contrato.id}
        ordenacaoInicial={{ por: 'previsto', ordem: 'desc' }}
        vazio={<EstadoVazio titulo="Nenhum contrato com pagamentos previstos neste ano" />}
      />
    </>
  );
}

export default function Previsao() {
  const p = useParametrosUrl();
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1];
  const anoUrl = p.numero('ano');
  const ano = anoUrl !== undefined && anos.includes(anoUrl) ? anoUrl : anoAtual;
  const consulta = usePrevisaoPagamentos(ano);

  return (
    <Pagina
      titulo="Previsão de pagamentos"
      subtitulo="Comparação mensal entre o previsto nos cronogramas e o efetivamente pago."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="previsao"
      acoes={
        <Selecao
          rotulo="Exercício"
          className="previsao__ano"
          opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
          value={String(ano)}
          onChange={(e) => {
            const valor = Number(e.target.value);
            p.atualizar({ ano: valor === anoAtual ? undefined : valor });
          }}
        />
      }
    >
      {consulta.isFetching && consulta.data !== undefined && consulta.data.ano !== ano ? (
        <p className="texto-secundario" role="status">
          Atualizando para {ano}…
        </p>
      ) : null}
      <ConteudoConsulta
        consulta={consulta}
        rotuloCarregando="Carregando a previsão de pagamentos"
        carregando={
          <div className="pilha pilha--ampla">
            <EsqueletoCartoes quantidade={3} />
            <EsqueletoTabela linhas={6} colunas={4} />
          </div>
        }
      >
        {(previsao) => <ConteudoPrevisao previsao={previsao} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
