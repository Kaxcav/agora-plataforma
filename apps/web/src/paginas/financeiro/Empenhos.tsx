import { Banknote, FileCheck, PiggyBank, Wallet } from 'lucide-react';
import type { FiltroEmpenhos } from '@agora/contratos';
import { formatarMoeda, formatarMoedaCompacta } from '@agora/dominio';
import { useEmpenhos } from '../../api/financeiro';
import {
  BarraFiltros,
  Botao,
  CampoBusca,
  EstadoVazio,
  FalhaConsulta,
  Indicador,
  Pagina,
  Paginacao,
  Proveniencia,
  Selecao,
  Tabela,
} from '../../componentes';
import { formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { COLUNAS_EMPENHO } from '../compartilhado/colunasFinanceiro';

const FILTROS = ['busca', 'saldo', 'restosAPagar', 'ano', 'uasg'] as const;
const SALDOS = ['com', 'sem'] as const;

export default function Empenhos() {
  const p = useParametrosUrl();
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);
  const anoUrl = p.numero('ano');
  const filtro: FiltroEmpenhos = {
    busca: p.texto('busca'),
    saldo: p.opcao('saldo', SALDOS),
    restosAPagar: p.booleano('restosAPagar'),
    ano: anoUrl !== undefined && anos.includes(anoUrl) ? anoUrl : undefined,
    uasg: p.texto('uasg'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useEmpenhos(filtro);
  const dados = consulta.data;
  const totais = dados?.totais;
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);
  const carregando = totais === undefined;

  return (
    <Pagina
      titulo="Empenhos"
      subtitulo="Notas de empenho, liquidação, pagamento e saldo, com origem no SIAFI."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="empenhos"
    >
      {consulta.isError && dados === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <section aria-label="Totais dos empenhos filtrados" className="pilha">
            <div className="grade grade--kpi">
              <Indicador
                rotulo="Empenhado"
                icone={Wallet}
                tom="info"
                carregando={carregando}
                valor={totais ? formatarMoedaCompacta(totais.empenhado) : null}
                valorAcessivel={totais ? formatarMoeda(totais.empenhado) : undefined}
                detalhe="Total dos empenhos filtrados"
              />
              <Indicador
                rotulo="Liquidado"
                icone={FileCheck}
                tom="info"
                carregando={carregando}
                valor={totais ? formatarMoedaCompacta(totais.liquidado) : null}
                valorAcessivel={totais ? formatarMoeda(totais.liquidado) : undefined}
                detalhe={totais && totais.empenhado > 0 ? `${formatarPercentual((totais.liquidado / totais.empenhado) * 100)} do empenhado` : 'Despesa reconhecida'}
              />
              <Indicador
                rotulo="Pago"
                icone={Banknote}
                tom="sucesso"
                carregando={carregando}
                valor={totais ? formatarMoedaCompacta(totais.pago) : null}
                valorAcessivel={totais ? formatarMoeda(totais.pago) : undefined}
                detalhe={totais && totais.empenhado > 0 ? `${formatarPercentual((totais.pago / totais.empenhado) * 100)} do empenhado` : 'Ordens bancárias emitidas'}
              />
              <Indicador
                rotulo="Saldo"
                icone={PiggyBank}
                tom="aviso"
                carregando={carregando}
                valor={totais ? formatarMoedaCompacta(totais.saldo) : null}
                valorAcessivel={totais ? formatarMoeda(totais.saldo) : undefined}
                detalhe="Empenhado ainda não pago"
              />
            </div>
            {dados ? <Proveniencia dados={dados.proveniencia} titulo="Proveniência dos dados financeiros (SIAFI)" /> : null}
          </section>

          <BarraFiltros
            total={dados?.total}
            substantivo={['empenho', 'empenhos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de empenhos"
          >
            <CampoBusca
              rotulo="Buscar"
              placeholder="Número, credor ou contrato"
              valor={filtro.busca ?? ''}
              aoMudar={(v) => p.atualizar({ busca: v })}
            />
            <Selecao
              rotulo="Saldo"
              opcaoVazia="Todos"
              opcoes={[
                { valor: 'com', rotulo: 'Com saldo' },
                { valor: 'sem', rotulo: 'Sem saldo' },
              ]}
              value={filtro.saldo ?? ''}
              onChange={(e) => p.atualizar({ saldo: e.target.value })}
            />
            <Selecao
              rotulo="Restos a pagar"
              opcaoVazia="Todos"
              opcoes={[
                { valor: 'true', rotulo: 'Somente restos a pagar' },
                { valor: 'false', rotulo: 'Somente do exercício' },
              ]}
              value={filtro.restosAPagar === undefined ? '' : String(filtro.restosAPagar)}
              onChange={(e) => p.atualizar({ restosAPagar: e.target.value })}
            />
            <Selecao
              rotulo="Ano de emissão"
              opcaoVazia="Todos"
              opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
              value={filtro.ano === undefined ? '' : String(filtro.ano)}
              onChange={(e) => p.atualizar({ ano: e.target.value })}
            />
            <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
          </BarraFiltros>

          <Tabela
            id="empenhos"
            legenda="Notas de empenho"
            colunas={COLUNAS_EMPENHO}
            linhas={dados?.itens}
            chave={(e) => e.id}
            atualizando={consulta.isFetching && dados !== undefined}
            destaque={(e) => (e.contrato === null ? 'aviso' : undefined)}
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum empenho atende aos filtros' : 'Nenhum empenho no seu escopo'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os empenhos.'
                    : 'Os empenhos aparecem aqui após a sincronização com o SIAFI.'
                }
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={limpar}>
                      Limpar filtros
                    </Botao>
                  ) : null
                }
              />
            }
            rodape={
              dados && dados.total > 0 ? (
                <Paginacao
                  pagina={p.pagina}
                  tamanhoPagina={p.tamanhoPagina}
                  total={dados.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos empenhos"
                />
              ) : null
            }
          />
        </>
      )}
    </Pagina>
  );
}
