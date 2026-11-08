import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { FiltroPagamentos, Pagamento } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useAtestarPagamento, usePagamentos } from '../../api/financeiro';
import {
  Alerta,
  BarraFiltros,
  Botao,
  CampoBusca,
  ConfirmarAcao,
  EstadoVazio,
  FalhaConsulta,
  ListaDefinicoes,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarCompetencia } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { COLUNAS_PAGAMENTO } from '../compartilhado/colunasFinanceiro';
import { chavesDe, opcoesDe, SITUACOES_PAGAMENTO } from '../compartilhado/rotulos';

const FILTROS = ['busca', 'situacao', 'uasg'] as const;

export default function Pagamentos() {
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const atestar = useAtestarPagamento();
  const [alvo, definirAlvo] = useState<Pagamento | null>(null);
  const podeAtestar = temPermissao('pagamentos:atestar');

  const filtro: FiltroPagamentos = {
    busca: p.texto('busca'),
    situacao: p.opcao('situacao', chavesDe(SITUACOES_PAGAMENTO)),
    uasg: p.texto('uasg'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = usePagamentos(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  const confirmar = () => {
    if (!alvo) return;
    const nota = alvo.notaFiscal;
    atestar.mutate(alvo.id, {
      onSuccess: () => {
        definirAlvo(null);
        avisar({
          tipo: 'sucesso',
          titulo: 'Pagamento atestado',
          mensagem: `NF ${nota} atestada. A atestação fica registrada na trilha de auditoria.`,
        });
      },
    });
  };

  return (
    <Pagina
      titulo="Pagamentos"
      subtitulo="Fila de pagamentos em ordem cronológica de exigibilidade, por fonte de recurso."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="pagamentos"
    >
      <Alerta tipo="info" titulo="Ordem cronológica de pagamentos (Lei 14.133/2021, art. 141)">
        <p>
          Os pagamentos devem observar a ordem cronológica de exigibilidade para cada fonte de recurso. A coluna “Ordem” mostra a posição de
          cada parcela na fila; alterar a ordem exige justificativa da autoridade competente e comunicação ao controle (art. 141, § 1º).
        </p>
      </Alerta>

      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['pagamento', 'pagamentos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de pagamentos"
          >
            <CampoBusca
              rotulo="Buscar"
              placeholder="Nota fiscal, contrato ou fornecedor"
              valor={filtro.busca ?? ''}
              aoMudar={(v) => p.atualizar({ busca: v })}
            />
            <Selecao
              rotulo="Situação"
              opcaoVazia="Todas"
              opcoes={opcoesDe(SITUACOES_PAGAMENTO)}
              value={filtro.situacao ?? ''}
              onChange={(e) => p.atualizar({ situacao: e.target.value })}
            />
            <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
          </BarraFiltros>

          <Tabela
            id="pagamentos"
            legenda="Pagamentos em ordem cronológica"
            colunas={COLUNAS_PAGAMENTO}
            linhas={consulta.data?.itens}
            chave={(pg) => pg.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            destaque={(pg) => (pg.situacao === 'atrasado' ? 'erro' : undefined)}
            acoes={
              podeAtestar
                ? {
                    cabecalho: 'Ações',
                    celula: (pg) =>
                      pg.situacao === 'previsto' ? (
                        <Botao
                          variante="secundario"
                          tamanho="compacto"
                          icone={ClipboardCheck}
                          aria-label={`Atestar nota fiscal ${pg.notaFiscal} do contrato ${pg.contrato.numero}`}
                          onClick={() => {
                            atestar.reset();
                            definirAlvo(pg);
                          }}
                        >
                          Atestar
                        </Botao>
                      ) : (
                        <span className="texto-pequeno texto-secundario">—</span>
                      ),
                  }
                : undefined
            }
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum pagamento atende aos filtros' : 'Nenhum pagamento no seu escopo'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver toda a fila.'
                    : 'As parcelas previstas e pagas dos contratos aparecerão aqui.'
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
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={p.pagina}
                  tamanhoPagina={p.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos pagamentos"
                />
              ) : null
            }
          />
        </>
      )}

      <ConfirmarAcao
        aberto={alvo !== null}
        aoFechar={() => definirAlvo(null)}
        titulo="Atestar pagamento"
        descricao={
          <p>
            Ao atestar, você confirma que o objeto correspondente foi entregue ou executado conforme o contrato (Lei 14.133/2021, art. 140) e
            a parcela passa a seguir a ordem cronológica de pagamento (art. 141). A atestação fica registrada na trilha de auditoria e não
            pode ser desfeita por esta tela.
          </p>
        }
        rotuloConfirmar="Atestar pagamento"
        aoConfirmar={confirmar}
        processando={atestar.isPending}
        erro={atestar.error}
      >
        {alvo ? (
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Nota fiscal', valor: <span className="mono">{alvo.notaFiscal}</span> },
              { termo: 'Contrato', valor: `Contrato ${alvo.contrato.numero}` },
              { termo: 'Fornecedor', valor: alvo.fornecedor, largo: true },
              { termo: 'Competência', valor: formatarCompetencia(alvo.competencia) },
              { termo: 'Vencimento', valor: formatarData(alvo.vencimento) },
              { termo: 'Valor', valor: <strong className="numero">{formatarMoeda(alvo.valor)}</strong> },
            ]}
          />
        ) : null}
      </ConfirmarAcao>
    </Pagina>
  );
}
