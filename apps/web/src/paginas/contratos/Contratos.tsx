import type { FiltroContratos } from '@agora/contratos';
import { useContratos } from '../../api/contratos';
import {
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  EstadoVazio,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
} from '../../componentes';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { COLUNAS_CONTRATO } from '../compartilhado/colunasContrato';
import { chavesDe, opcoesDe, SITUACOES_INSTRUMENTO } from '../compartilhado/rotulos';

const FILTROS = ['busca', 'situacao', 'uasg', 'minhas', 'semAta'] as const;

export default function Contratos() {
  const p = useParametrosUrl();
  const filtro: FiltroContratos = {
    busca: p.texto('busca'),
    situacao: p.opcao('situacao', chavesDe(SITUACOES_INSTRUMENTO)),
    uasg: p.texto('uasg'),
    gestor: p.booleano('minhas') ? 'eu' : undefined,
    semAta: p.booleano('semAta') ? true : undefined,
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    ordenarPor: p.ordenacao?.por,
    ordem: p.ordenacao?.ordem,
  };
  const consulta = useContratos(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  return (
    <Pagina
      titulo="Contratos"
      subtitulo="Vigência, execução financeira e pendências dos contratos sob gestão do órgão."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="contratos"
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['contrato', 'contratos']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de contratos"
          >
            <CampoBusca
              rotulo="Buscar"
              placeholder="Número, objeto, fornecedor ou CNPJ"
              valor={filtro.busca ?? ''}
              aoMudar={(v) => p.atualizar({ busca: v })}
            />
            <Selecao
              rotulo="Situação"
              opcaoVazia="Todas"
              opcoes={opcoesDe(SITUACOES_INSTRUMENTO)}
              value={filtro.situacao ?? ''}
              onChange={(e) => p.atualizar({ situacao: e.target.value })}
            />
            <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
            <CaixaSelecao rotulo="Sob minha gestão" checked={filtro.gestor === 'eu'} onChange={(e) => p.atualizar({ minhas: e.target.checked })} />
            <CaixaSelecao
              rotulo="Sem ata de origem"
              checked={filtro.semAta === true}
              onChange={(e) => p.atualizar({ semAta: e.target.checked })}
            />
          </BarraFiltros>

          <Tabela
            id="contratos"
            legenda="Contratos"
            colunas={COLUNAS_CONTRATO}
            linhas={consulta.data?.itens}
            chave={(c) => c.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            ordenacao={p.ordenacao}
            aoOrdenar={p.definirOrdenacao}
            destaque={(c) => (c.semaforo === 'vencido' || c.semaforo === 'critico' ? 'erro' : c.semaforo === 'atencao' ? 'aviso' : undefined)}
            vazio={
              <EstadoVazio
                titulo={filtrosAtivos ? 'Nenhum contrato atende aos filtros' : 'Nenhum contrato no seu escopo'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os contratos.'
                    : 'Os contratos aparecem aqui após a sincronização com o Contratos.gov.br ou a conclusão de uma contratação na Ágora.'
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
                  rotulo="Paginação dos contratos"
                />
              ) : null
            }
          />
        </>
      )}
    </Pagina>
  );
}
