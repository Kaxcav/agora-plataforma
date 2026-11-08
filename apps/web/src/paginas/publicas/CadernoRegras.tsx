import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { ETAPAS_JORNADA } from '@agora/contratos';
import { CATALOGO_REGRAS, type RegraCatalogo, type TipoRegra } from '@agora/dominio';
import { useConfiguracaoPublica } from '../../api/sessao';
import { Alerta, Botao, CampoBusca, CartaoRegra, EstadoVazio, NOMES_TIPOS_REGRA, Pagina, Selecao } from '../../componentes';
import { contar } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';

const ORDEM_TIPOS: readonly TipoRegra[] = ['RN', 'RIA', 'RF', 'RNF'];

const DESCRICOES_TIPOS: Record<TipoRegra, string> = {
  RN: 'Regras da Lei 14.133/2021 aplicadas pela plataforma (prazos, limites, vedações).',
  RIA: 'Inteligência assistiva: produz sinais e rascunhos para análise humana, nunca decisões.',
  RF: 'O que cada tela de operação entrega ao usuário.',
  RNF: 'Soberania, segurança, LGPD, acessibilidade e auditoria.',
};

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tituloEtapa(etapa: RegraCatalogo['etapa']): string {
  if (etapa === null) return 'Transversais (todas as etapas)';
  const def = ETAPAS_JORNADA.find((e) => e.etapa === etapa);
  return `Etapa ${etapa}${def ? ` — ${def.titulo}` : ''}`;
}

interface GrupoTipo {
  tipo: TipoRegra;
  etapas: { chave: string; titulo: string; regras: RegraCatalogo[] }[];
  total: number;
}

function agrupar(regras: readonly RegraCatalogo[]): GrupoTipo[] {
  return ORDEM_TIPOS.map((tipo) => {
    const doTipo = regras.filter((r) => r.tipo === tipo);
    const chavesEtapa = [...new Set(doTipo.map((r) => r.etapa))].sort((a, b) => (a ?? 99) - (b ?? 99));
    return {
      tipo,
      total: doTipo.length,
      etapas: chavesEtapa.map((etapa) => ({
        chave: etapa === null ? 'transversal' : String(etapa),
        titulo: tituloEtapa(etapa),
        regras: doTipo.filter((r) => r.etapa === etapa),
      })),
    };
  }).filter((g) => g.total > 0);
}

/** Caderno de Regras: catálogo completo (`CATALOGO_REGRAS`), agrupado por tipo e etapa, pronto para impressão. */
export default function CadernoRegras() {
  const { data: config } = useConfiguracaoPublica();
  const p = useParametrosUrl();
  const tipo = p.opcao('tipo', ORDEM_TIPOS);
  const busca = p.texto('busca') ?? '';

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return CATALOGO_REGRAS.filter(
      (r) =>
        (!tipo || r.tipo === tipo) &&
        (!termo || normalizar(`${r.id} ${r.titulo} ${r.descricao} ${r.fundamento}`).includes(termo)),
    );
  }, [tipo, busca]);

  const grupos = agrupar(filtradas);
  const filtrosAtivos = Boolean(tipo || busca);

  return (
    <Pagina
      titulo="Caderno de regras"
      subtitulo="Regras de negócio, requisitos e salvaguardas implementados pela Ágora, com o fundamento legal de cada um."
      acoes={
        <Botao variante="secundario" icone={Printer} onClick={() => window.print()}>
          Imprimir caderno
        </Botao>
      }
    >
      <div className="so-impressao">
        <p>
          {config ? `${config.produto} — versão ${config.versao}. ` : ''}
          {contar(CATALOGO_REGRAS.length, 'regra catalogada', 'regras catalogadas')}.
        </p>
      </div>

      <Alerta tipo="info" compacto>
        As referências legais devem ser validadas pela área técnica e pela consultoria jurídica do órgão antes da adoção. O mesmo catálogo alimenta o
        “Modo especificação técnica”, que mostra em cada tela as regras aplicadas a ela.
      </Alerta>

      <div className="barra-filtros nao-imprimir">
        <div className="barra-filtros__campos">
          <CampoBusca rotulo="Buscar regra" placeholder="Ex.: RN-11, PNCP, art. 125" valor={busca} aoMudar={(v) => p.atualizar({ busca: v })} />
          <Selecao
            rotulo="Tipo"
            opcaoVazia="Todos os tipos"
            opcoes={ORDEM_TIPOS.map((t) => ({ valor: t, rotulo: `${t} — ${NOMES_TIPOS_REGRA[t]}` }))}
            value={tipo ?? ''}
            onChange={(e) => p.atualizar({ tipo: e.target.value })}
          />
        </div>
        <div className="barra-filtros__rodape">
          <p className="barra-filtros__contagem" aria-live="polite" aria-atomic="true">
            {filtradas.length === 0 ? 'Nenhuma regra encontrada' : `${contar(filtradas.length, 'regra exibida', 'regras exibidas')}`}
          </p>
          {filtrosAtivos ? (
            <Botao variante="terciario" tamanho="compacto" onClick={() => p.limpar(['tipo', 'busca'])}>
              Limpar filtros
            </Botao>
          ) : null}
        </div>
      </div>

      {grupos.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma regra atende aos filtros"
          descricao="Revise o termo buscado ou o tipo selecionado."
          acao={
            <Botao variante="secundario" onClick={() => p.limpar(['tipo', 'busca'])}>
              Limpar filtros
            </Botao>
          }
        />
      ) : (
        <>
          <nav aria-labelledby="titulo-sumario" className="cartao">
            <h2 id="titulo-sumario" className="secao__titulo">
              Sumário
            </h2>
            <ul className="caderno__sumario">
              {grupos.map((g) => (
                <li key={g.tipo}>
                  <a href={`#tipo-${g.tipo}`}>
                    {NOMES_TIPOS_REGRA[g.tipo]} ({g.tipo})
                  </a>{' '}
                  <span className="texto-secundario">— {contar(g.total, 'regra', 'regras')}</span>
                </li>
              ))}
            </ul>
          </nav>

          {grupos.map((g) => (
            <section key={g.tipo} id={`tipo-${g.tipo}`} className="caderno__grupo" aria-labelledby={`titulo-tipo-${g.tipo}`}>
              <div>
                <h2 id={`titulo-tipo-${g.tipo}`}>
                  {NOMES_TIPOS_REGRA[g.tipo]} <span className="texto-secundario">({g.tipo})</span>
                </h2>
                <p className="texto-secundario">{DESCRICOES_TIPOS[g.tipo]}</p>
              </div>
              {g.etapas.map((e) => (
                <section key={e.chave} className="caderno__etapa" aria-labelledby={`titulo-${g.tipo}-${e.chave}`}>
                  <h3 id={`titulo-${g.tipo}-${e.chave}`}>{e.titulo}</h3>
                  <div className="caderno__regras">
                    {e.regras.map((r) => (
                      <CartaoRegra key={r.id} regra={r} nivelTitulo={4} />
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ))}
        </>
      )}
    </Pagina>
  );
}
