/**
 * Etapa 6 — Seleção do fornecedor: licitantes escolhidos no cadastro de fornecedores (o nome e o porte ME/EPP
 * vêm do cadastro), propostas, critérios de desempate do art. 60, classificação e desempate passo a passo
 * (RN-08, `aplicarDesempate`) e sinal de vínculo societário entre licitantes (RIA-06).
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Gavel, ListOrdered, Plus, RotateCcw, Save, Trash2, Trophy } from 'lucide-react';
import type { EntradaLicitanteDisputa, FornecedorResumo, LicitanteDisputa } from '@agora/contratos';
import { aplicarDesempate, formatarMoeda, type Licitante } from '@agora/dominio';
import { useFornecedores } from '../../../api/fornecedores';
import { ehResultadoDesempate, useSalvarDisputa, type ResultadoDesempate } from '../../../api/jornada';
import { Alerta, Botao, CampoBusca, CampoMoeda, Etiqueta, LinkBotao, Selecao, useAvisos } from '../../../componentes';
import { PORTES } from '../../compartilhado/rotulos';
import { calcular, EntradaMoeda, ErroOperacao, mesmoConteudo, Requisitos, type Requisito } from '../comum';
import { AtosSelecao } from './AtosSelecao';
import type { PropsEtapa } from './tipos';

type CriterioBooleano = 'acoesEquidadeGenero' | 'programaIntegridade' | 'empresaBrasileira' | 'investePesquisaDesenvolvimentoNoPais' | 'praticaMitigacaoClimatica';

/** Critérios declaratórios do art. 60 (III, IV e § 1º, II a IV), na ordem de aplicação. */
const CRITERIOS_ART60: readonly { campo: CriterioBooleano; rotulo: string; curto: string; fundamento: string }[] = [
  { campo: 'acoesEquidadeGenero', rotulo: 'Ações de equidade entre homens e mulheres no trabalho', curto: 'equidade de gênero', fundamento: 'art. 60, III' },
  { campo: 'programaIntegridade', rotulo: 'Programa de integridade', curto: 'programa de integridade', fundamento: 'art. 60, IV' },
  { campo: 'empresaBrasileira', rotulo: 'Empresa brasileira', curto: 'empresa brasileira', fundamento: 'art. 60, § 1º, II' },
  {
    campo: 'investePesquisaDesenvolvimentoNoPais',
    rotulo: 'Investe em pesquisa e desenvolvimento de tecnologia no País',
    curto: 'P&D no País',
    fundamento: 'art. 60, § 1º, III',
  },
  { campo: 'praticaMitigacaoClimatica', rotulo: 'Comprova prática de mitigação climática', curto: 'mitigação climática', fundamento: 'art. 60, § 1º, IV' },
];

type Declaracao = 'nao_informado' | 'sim' | 'nao';
const OPCOES_DECLARACAO: readonly { valor: Declaracao; rotulo: string }[] = [
  { valor: 'nao_informado', rotulo: 'Não informado' },
  { valor: 'sim', rotulo: 'Sim' },
  { valor: 'nao', rotulo: 'Não' },
];

function declaracao(valor: boolean | null): Declaracao {
  if (valor === null) return 'nao_informado';
  return valor ? 'sim' : 'nao';
}

function lerDeclaracao(valor: string): boolean | null {
  if (valor === 'sim') return true;
  if (valor === 'nao') return false;
  return null;
}

/** Critérios do art. 60 informados para o licitante (lance final e declarações). */
function criteriosInformados(l: LicitanteDisputa): string[] {
  const lista: string[] = [];
  if (l.lanceDisputaFinal !== null) lista.push(`lance final de ${formatarMoeda(l.lanceDisputaFinal)}`);
  for (const c of CRITERIOS_ART60) {
    const valor = l[c.campo];
    if (valor !== null) lista.push(`${c.curto}: ${valor ? 'sim' : 'não'}`);
  }
  return lista;
}

function novoLicitante(f: FornecedorResumo): LicitanteDisputa {
  return {
    id: f.id,
    nome: f.razaoSocial,
    valorProposta: 0,
    meEpp: f.porte === 'ME' || f.porte === 'EPP',
    notaDesempenhoPrevio: null,
    lanceDisputaFinal: null,
    acoesEquidadeGenero: null,
    programaIntegridade: null,
    empresaBrasileira: null,
    investePesquisaDesenvolvimentoNoPais: null,
    praticaMitigacaoClimatica: null,
  };
}

/** Prévia com as mesmas regras do servidor: critérios não informados ficam de fora. */
function paraDominio(licitantes: readonly LicitanteDisputa[]): Licitante[] {
  return licitantes.map((l) => {
    const licitante: Licitante = { id: l.id, nome: l.nome, valorProposta: l.valorProposta, meEpp: l.meEpp };
    if (l.notaDesempenhoPrevio !== null) licitante.notaDesempenhoPrevio = l.notaDesempenhoPrevio;
    if (l.lanceDisputaFinal !== null) licitante.lanceDisputaFinal = l.lanceDisputaFinal;
    for (const c of CRITERIOS_ART60) {
      const valor = l[c.campo];
      if (valor !== null) licitante[c.campo] = valor;
    }
    return licitante;
  });
}

function paraEntrada(l: LicitanteDisputa): EntradaLicitanteDisputa {
  return {
    id: l.id,
    valorProposta: l.valorProposta,
    notaDesempenhoPrevio: l.notaDesempenhoPrevio,
    lanceDisputaFinal: l.lanceDisputaFinal,
    acoesEquidadeGenero: l.acoesEquidadeGenero,
    programaIntegridade: l.programaIntegridade,
    empresaBrasileira: l.empresaBrasileira,
    investePesquisaDesenvolvimentoNoPais: l.investePesquisaDesenvolvimentoNoPais,
    praticaMitigacaoClimatica: l.praticaMitigacaoClimatica,
  };
}

/** Busca no cadastro de fornecedores (GET /fornecedores?busca=) para incluir licitantes. */
function SeletorFornecedor({ incluidos, aoIncluir }: { incluidos: ReadonlySet<string>; aoIncluir: (fornecedor: FornecedorResumo) => void }) {
  const idTitulo = useId();
  const [busca, definirBusca] = useState('');
  const termo = busca.trim();
  const buscando = termo.length >= 2;
  const consulta = useFornecedores({ busca: termo, tamanhoPagina: 8 }, buscando);
  const resultados = buscando ? (consulta.data?.itens ?? []) : [];
  const total = buscando ? (consulta.data?.total ?? 0) : 0;

  let situacao = 'Digite ao menos 2 caracteres da razão social ou do CNPJ.';
  if (buscando && consulta.isPending) situacao = 'Buscando fornecedores…';
  else if (buscando && consulta.isError) situacao = 'Não foi possível consultar o cadastro de fornecedores. Tente novamente.';
  else if (buscando && total === 0) situacao = `Nenhum fornecedor encontrado para “${termo}”.`;
  else if (buscando) {
    situacao =
      total > resultados.length
        ? `${total} fornecedores encontrados; exibindo os ${resultados.length} primeiros. Refine a busca se necessário.`
        : `${total === 1 ? '1 fornecedor encontrado' : `${total} fornecedores encontrados`}.`;
  }

  return (
    <section className="jornada-seletor" aria-labelledby={idTitulo}>
      <h4 id={idTitulo} className="jornada-seletor__titulo">
        Incluir licitante do cadastro de fornecedores
      </h4>
      <p className="texto-pequeno texto-secundario">
        A razão social e o porte (ME/EPP, para o empate ficto da LC 123/2006) vêm do cadastro. Sanções vigentes são verificadas pelo servidor ao
        avançar e ao contratar (CEIS/CNEP).
      </p>
      <CampoBusca rotulo="Buscar fornecedor por razão social ou CNPJ" valor={busca} aoMudar={definirBusca} atraso={300} placeholder="Ex.: Escudo Forte" />
      <p className="texto-pequeno texto-secundario" role="status" aria-live="polite" aria-atomic="true">
        {situacao}
      </p>
      {resultados.length > 0 ? (
        <ul className="jornada-seletor__lista" aria-label="Fornecedores encontrados">
          {resultados.map((f) => {
            const incluido = incluidos.has(f.id);
            return (
              <li key={f.id} className="jornada-seletor__item">
                <div className="jornada-seletor__dados">
                  <span className="texto-forte">{f.razaoSocial}</span>
                  <span className="linha texto-pequeno texto-secundario">
                    <span className="mono">{f.documento}</span>
                    {f.uf ? <span>{f.uf}</span> : null}
                    {f.porte ? (
                      <Etiqueta tom={f.porte === 'DEMAIS' ? 'neutro' : 'info'} compacta>
                        {f.porte === 'DEMAIS' ? 'Demais portes' : `${f.porte} — ${PORTES[f.porte]}`}
                      </Etiqueta>
                    ) : null}
                    {f.sancoesVigentes > 0 ? (
                      <Etiqueta tom="erro" compacta>
                        {f.sancoesVigentes === 1 ? '1 sanção vigente' : `${f.sancoesVigentes} sanções vigentes`}
                      </Etiqueta>
                    ) : null}
                  </span>
                </div>
                <Botao
                  tamanho="compacto"
                  icone={Plus}
                  disabled={incluido}
                  aria-label={incluido ? `Incluído: ${f.razaoSocial} já consta da disputa` : `Incluir ${f.razaoSocial} como licitante`}
                  onClick={() => aoIncluir(f)}
                >
                  {incluido ? 'Incluído' : 'Incluir'}
                </Botao>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** Critérios do art. 60 de um licitante (só pesam entre empatados no primeiro lugar). */
function CriteriosLicitante({
  licitante,
  posicao,
  aoAlterar,
}: {
  licitante: LicitanteDisputa;
  posicao: number;
  aoAlterar: (mudanca: Partial<LicitanteDisputa>) => void;
}) {
  const informados = criteriosInformados(licitante);
  // Aberto de início só se já houver critério informado; depois, quem abre e fecha é o usuário
  // (o atributo não muda a cada alteração, para o painel não fechar com o foco dentro dele).
  const [abertoInicialmente] = useState(() => informados.length > 0);
  const alterarDeclaracao = (campo: CriterioBooleano, valor: boolean | null) => {
    const mudanca: Partial<LicitanteDisputa> = {};
    mudanca[campo] = valor;
    aoAlterar(mudanca);
  };
  return (
    <details className="jornada-criterios" open={abertoInicialmente || undefined}>
      <summary className="jornada-criterios__resumo">
        <ChevronDown className="jornada-criterios__seta" size={16} aria-hidden="true" />
        <span className="jornada-criterios__textos">
          <span className="texto-forte">
            {posicao}. {licitante.nome}
          </span>
          <span className="texto-pequeno texto-secundario">
            {informados.length === 0 ? 'nenhum critério informado' : informados.length === 1 ? '1 critério informado' : `${informados.length} critérios informados`}
          </span>
        </span>
      </summary>
      <fieldset className="jornada-criterios__grade">
        <legend className="sr-only">Critérios do art. 60 — {licitante.nome}</legend>
        <CampoMoeda
          rotulo="Lance na disputa final"
          ajuda="Art. 60, I. Em branco: sem novo lance."
          valor={licitante.lanceDisputaFinal}
          aoMudar={(v) => aoAlterar({ lanceDisputaFinal: v })}
        />
        {CRITERIOS_ART60.map((c) => (
          <Selecao
            key={c.campo}
            rotulo={c.rotulo}
            ajuda={`Lei 14.133/2021, ${c.fundamento}.`}
            opcoes={OPCOES_DECLARACAO}
            value={declaracao(licitante[c.campo])}
            onChange={(e) => alterarDeclaracao(c.campo, lerDeclaracao(e.target.value))}
          />
        ))}
      </fieldset>
    </details>
  );
}

function PassoAPasso({ resultado }: { resultado: ResultadoDesempate }) {
  const passos = [...resultado.passos].sort((a, b) => a.ordem - b.ordem);
  const [ate, definirAte] = useState<number | null>(null);
  const visiveis = ate === null ? passos : passos.slice(0, ate + 1);
  const atual = ate === null ? null : passos[ate];

  if (passos.length === 0) return <p className="texto-secundario">Sem empate no primeiro lugar: nenhum critério de desempate foi necessário.</p>;

  return (
    <div className="pilha">
      <div className="linha" role="group" aria-label="Navegação pelos passos do desempate">
        <Botao tamanho="compacto" icone={ChevronLeft} disabled={ate === null || ate === 0} onClick={() => definirAte((v) => (v === null || v === 0 ? v : v - 1))}>
          Passo anterior
        </Botao>
        <Botao
          tamanho="compacto"
          iconeFim={ChevronRight}
          disabled={ate !== null && ate >= passos.length - 1}
          onClick={() => definirAte((v) => (v === null ? 0 : Math.min(passos.length - 1, v + 1)))}
        >
          {ate === null ? 'Ver passo a passo' : 'Próximo passo'}
        </Botao>
        {ate !== null ? (
          <Botao tamanho="compacto" variante="terciario" icone={ListOrdered} onClick={() => definirAte(null)}>
            Mostrar todos
          </Botao>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {atual ? `Passo ${(ate ?? 0) + 1} de ${passos.length}: ${atual.criterio}. ${atual.resultado}` : ''}
      </p>
      <ol className="jornada-passos" aria-label="Critérios de desempate aplicados">
        {visiveis.map((p, i) => {
          // `aplicarDesempate` registra o critério decisivo como "<critério> (<fundamento>)".
          const decisivo = resultado.criterioDecisivo === `${p.criterio} (${p.fundamento})` || resultado.criterioDecisivo === p.criterio;
          return (
            <li key={`${p.ordem}-${i}`} className={['jornada-passos__item', decisivo ? 'jornada-passos__item--decisivo' : '', ate === i ? 'jornada-passos__item--atual' : ''].filter(Boolean).join(' ')}>
              <span className="jornada-passos__ordem numero" aria-hidden="true">
                {p.ordem}
              </span>
              <div className="jornada-passos__corpo">
                <p className="linha">
                  <strong>{p.criterio}</strong>
                  {decisivo ? (
                    <Etiqueta tom="sucesso" compacta>
                      Critério decisivo
                    </Etiqueta>
                  ) : null}
                </p>
                <p>{p.resultado}</p>
                <p className="texto-pequeno texto-secundario">{p.fundamento}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Etapa6Selecao({ processo, atual, editavel }: PropsEtapa) {
  const base = useId();
  // Depois do primeiro ato da seleção, o resultado da disputa fica fixo (o servidor recusa a alteração).
  const selecao = processo.selecao;
  const disputaEditavel = editavel && selecao.provasConceito.length === 0 && selecao.habilitacoes.length === 0 && selecao.faseRecursal === null && selecao.adjudicacao === null;
  const { avisar } = useAvisos();
  const salvar = useSalvarDisputa(processo.id);
  const [licitantes, definirLicitantes] = useState<LicitanteDisputa[]>(() => processo.disputa.licitantes);
  const [erroLista, definirErroLista] = useState<string | null>(null);
  const [anuncio, definirAnuncio] = useState('');
  const tituloTabela = useRef<HTMLHeadingElement>(null);
  const alterado = !mesmoConteudo(licitantes, processo.disputa.licitantes);
  const idValor = (fornecedorId: string) => `${base}-${fornecedorId}-valor`;

  const resultadoServidor = ehResultadoDesempate(processo.disputa.resultado) ? processo.disputa.resultado : null;
  // A prévia só considera quem já tem valor de proposta (uma linha recém-incluída não "vence" com R$ 0,00).
  const comValor = licitantes.filter((l) => l.valorProposta > 0);
  const semValorNaPrevia = licitantes.length - comValor.length;
  const previa = comValor.length > 0 ? calcular(() => aplicarDesempate(paraDominio(comValor), { empateFictoMeEpp: true })) : null;
  const usarPrevia = alterado || resultadoServidor === null;
  const resultado = usarPrevia ? (previa?.ok ? previa.valor : null) : resultadoServidor;
  const sinaisVinculo = processo.sinais.filter((s) => s.regra === 'RIA-06');
  const incluidos = new Set(licitantes.map((l) => l.id));

  const alterar = (id: string, mudanca: Partial<LicitanteDisputa>) => definirLicitantes((ls) => ls.map((l) => (l.id === id ? { ...l, ...mudanca } : l)));

  const incluir = (fornecedor: FornecedorResumo) => {
    if (incluidos.has(fornecedor.id)) return;
    definirLicitantes((ls) => [...ls, novoLicitante(fornecedor)]);
    definirErroLista(null);
    definirAnuncio(`${fornecedor.razaoSocial} incluído como licitante ${licitantes.length + 1}. Informe o valor da proposta.`);
    window.requestAnimationFrame(() => document.getElementById(idValor(fornecedor.id))?.focus());
  };

  const remover = (l: LicitanteDisputa, posicao: number) => {
    definirLicitantes((ls) => ls.filter((x) => x.id !== l.id));
    definirAnuncio(`Licitante ${posicao} — ${l.nome} removido.`);
    tituloTabela.current?.focus();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (licitantes.length === 0) {
      definirErroLista('Inclua ao menos um licitante do cadastro de fornecedores.');
      return;
    }
    const semValor = licitantes.find((l) => l.valorProposta <= 0);
    if (semValor) {
      definirErroLista(`Informe o valor da proposta de ${semValor.nome}.`);
      document.getElementById(idValor(semValor.id))?.focus();
      return;
    }
    if (previa && !previa.ok) {
      definirErroLista(previa.mensagem);
      return;
    }
    definirErroLista(null);
    salvar.mutate(
      { licitantes: licitantes.map(paraEntrada) },
      {
        onSuccess: (atualizado) => {
          definirLicitantes(atualizado.disputa.licitantes);
          const r = ehResultadoDesempate(atualizado.disputa.resultado) ? atualizado.disputa.resultado : null;
          const primeiro = r?.classificacao.find((c) => c.posicao === 1);
          avisar({
            tipo: 'sucesso',
            titulo: 'Propostas registradas',
            mensagem: primeiro
              ? `Classificação calculada pelo servidor: primeiro colocado ${primeiro.nome}${r?.sorteioNecessario ? ' (empate persistente)' : ''}.`
              : 'A classificação e o desempate foram calculados pelo servidor.',
          });
        },
      },
    );
  };

  const requisitos: Requisito[] = [
    { id: 'resultado', rotulo: 'Resultado da disputa registrado no processo', atendido: resultadoServidor !== null },
    {
      id: 'sorteio',
      rotulo: 'Sem empate pendente de sorteio (art. 60)',
      atendido: resultadoServidor !== null && !resultadoServidor.sorteioNecessario,
    },
    {
      id: 'atos',
      rotulo: 'Prova de conceito (se exigida), habilitação, recursos exauridos, adjudicação e homologação (RN-20, RN-22, RF-18)',
      atendido: processo.selecao.proximoAto === 'concluida',
    },
  ];
  const vencedor = resultado?.classificacao.find((c) => c.posicao === 1) ?? null;

  return (
    <div className="pilha pilha--ampla">
      <div className="linha">
        <LinkBotao to={`/jornada/${processo.id}/disputa`} icone={Gavel}>
          Abrir sala de disputa
        </LinkBotao>
        <span className="texto-pequeno texto-secundario">Simule a sessão de lances ou acompanhe a sessão oficial do Compras.gov.br (RF-22).</span>
      </div>
      <form className="secao jornada-subsecao" onSubmit={enviar} noValidate aria-labelledby={`${base}-titulo`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-titulo`} ref={tituloTabela} tabIndex={-1} className="secao__titulo">
              Propostas dos licitantes
            </h3>
            <p className="secao__descricao">
              Valores finais após a fase de lances, por menor preço. Cada licitante é um fornecedor do cadastro: inclua-o pela busca abaixo.
            </p>
          </div>
        </div>
        <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-legenda`} tabIndex={0}>
          <table className="tabela tabela--compacta jornada-tabela-edicao">
            <caption id={`${base}-legenda`} className="tabela__legenda">
              Licitantes e propostas
            </caption>
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col">Licitante (cadastro)</th>
                <th scope="col" className="tabela__alinhar--fim">
                  Valor da proposta
                </th>
                <th scope="col" className="tabela__alinhar--centro">
                  ME/EPP
                </th>
                <th scope="col" className="tabela__alinhar--fim">
                  Desempenho prévio (0–100)
                </th>
                {disputaEditavel ? (
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : (
                  <th scope="col">Outros critérios (art. 60)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {licitantes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="texto-secundario">
                    {disputaEditavel ? 'Nenhum licitante. Busque o fornecedor no cadastro e use “Incluir”.' : 'Nenhuma proposta registrada.'}
                  </td>
                </tr>
              ) : (
                licitantes.map((l, i) => (
                  <tr key={l.id}>
                    <th scope="row" className="numero">
                      {i + 1}
                    </th>
                    <td>{l.nome}</td>
                    {disputaEditavel ? (
                      <>
                        <td className="tabela__alinhar--fim">
                          <EntradaMoeda
                            id={idValor(l.id)}
                            rotulo={`Valor da proposta — ${l.nome}`}
                            valor={l.valorProposta === 0 ? null : l.valorProposta}
                            aoMudar={(v) => alterar(l.id, { valorProposta: v ?? 0 })}
                          />
                        </td>
                        <td className="tabela__alinhar--centro">{l.meEpp ? 'Sim' : 'Não'}</td>
                        <td className="tabela__alinhar--fim">
                          <input
                            className="campo__controle jornada-entrada-numero numero"
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            inputMode="decimal"
                            aria-label={`Nota de desempenho prévio — ${l.nome} (opcional, art. 60, II)`}
                            value={l.notaDesempenhoPrevio === null ? '' : String(l.notaDesempenhoPrevio)}
                            onChange={(e) => alterar(l.id, { notaDesempenhoPrevio: e.target.value === '' || Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber })}
                          />
                        </td>
                        <td>
                          <Botao variante="terciario" tamanho="compacto" somenteIcone icone={Trash2} aria-label={`Remover licitante ${i + 1} — ${l.nome}`} onClick={() => remover(l, i + 1)} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="tabela__alinhar--fim numero">{formatarMoeda(l.valorProposta)}</td>
                        <td className="tabela__alinhar--centro">{l.meEpp ? 'Sim' : 'Não'}</td>
                        <td className="tabela__alinhar--fim numero">{l.notaDesempenhoPrevio ?? '—'}</td>
                        <td className="texto-pequeno">{criteriosInformados(l).join('; ') || '—'}</td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {disputaEditavel ? (
          <>
            <SeletorFornecedor incluidos={incluidos} aoIncluir={incluir} />
            {licitantes.length > 0 ? (
              <section className="pilha pilha--compacta" aria-labelledby={`${base}-criterios`}>
                <h4 id={`${base}-criterios`} className="jornada-seletor__titulo">
                  Critérios de desempate do art. 60 (opcional)
                </h4>
                <p className="texto-pequeno texto-secundario">
                  Só são aplicados entre os empatados no primeiro lugar, nesta ordem: disputa final (I), desempenho prévio (II), equidade de gênero
                  (III), integridade (IV) e as preferências do § 1º. “Não informado” deixa o critério de fora.
                </p>
                {licitantes.map((l, i) => (
                  <CriteriosLicitante key={l.id} licitante={l} posicao={i + 1} aoAlterar={(mudanca) => alterar(l.id, mudanca)} />
                ))}
              </section>
            ) : null}
            {erroLista ? (
              <Alerta tipo="erro" anunciar compacto>
                <p>{erroLista}</p>
              </Alerta>
            ) : null}
            <ErroOperacao erro={salvar.error} titulo="Não foi possível registrar as propostas" />
            <div className="jornada-barra-acoes">
              <p className="texto-pequeno texto-secundario" aria-live="polite">
                {alterado ? 'Há alterações não salvas: a classificação abaixo é uma prévia.' : 'Sem alterações pendentes.'}
              </p>
              <div className="linha">
                <Botao
                  variante="terciario"
                  icone={RotateCcw}
                  disabled={!alterado || salvar.isPending}
                  onClick={() => {
                    definirLicitantes(processo.disputa.licitantes);
                    definirErroLista(null);
                    salvar.reset();
                    definirAnuncio('Alterações descartadas.');
                  }}
                >
                  Descartar alterações
                </Botao>
                <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
                  Registrar propostas
                </Botao>
              </div>
            </div>
          </>
        ) : null}
        <p className="sr-only" role="status">
          {anuncio}
        </p>
      </form>

      <section className="secao jornada-subsecao" aria-labelledby={`${base}-desempate`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-desempate`} className="secao__titulo">
              Classificação e desempate (RN-08)
            </h3>
            <p className="secao__descricao">
              Empatadas as melhores propostas, os critérios do art. 60 são aplicados em ordem, só entre os empatados; o empate ficto de ME/EPP
              (LC 123/2006, arts. 44 e 45) é registrado como passo informativo.
            </p>
          </div>
          {resultado ? (
            <Etiqueta tom={usarPrevia ? 'neutro' : 'info'} compacta>
              {usarPrevia ? 'Prévia calculada neste navegador' : 'Resultado registrado no processo'}
            </Etiqueta>
          ) : null}
        </div>
        {usarPrevia && semValorNaPrevia > 0 ? (
          <p className="texto-pequeno texto-secundario">
            {semValorNaPrevia === 1 ? '1 licitante sem valor de proposta fica' : `${semValorNaPrevia} licitantes sem valor de proposta ficam`} fora desta prévia.
          </p>
        ) : null}
        {previa && !previa.ok && usarPrevia ? (
          <Alerta tipo="aviso" compacto>
            <p>{previa.mensagem}</p>
          </Alerta>
        ) : null}
        {resultado ? (
          <>
            {vencedor ? (
              <p className="jornada-vencedor">
                <Trophy size={18} aria-hidden="true" />
                <span>
                  Primeiro colocado: <strong>{vencedor.nome}</strong> — <span className="numero">{formatarMoeda(vencedor.valorConsiderado)}</span>
                  {resultado.sorteioNecessario ? ' (empate não resolvido pelos critérios legais)' : ''}
                </span>
              </p>
            ) : null}
            <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-classificacao`} tabIndex={0}>
              <table className="tabela tabela--compacta">
                <caption id={`${base}-classificacao`} className="tabela__legenda">
                  Classificação
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Posição</th>
                    <th scope="col">Licitante</th>
                    <th scope="col" className="tabela__alinhar--fim">
                      Valor considerado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...resultado.classificacao]
                    .sort((a, b) => a.posicao - b.posicao)
                    .map((c) => (
                      <tr key={c.id} className={c.posicao === 1 ? 'tabela__linha--sucesso' : undefined}>
                        <th scope="row" className="numero">
                          {c.posicao}º
                        </th>
                        <td>{c.nome}</td>
                        <td className="tabela__alinhar--fim numero">{formatarMoeda(c.valorConsiderado)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {resultado.empateDetectado ? <p className="texto-forte">Empate detectado no primeiro lugar. Critérios aplicados:</p> : null}
            <PassoAPasso key={JSON.stringify(resultado.passos)} resultado={resultado} />
            {resultado.sorteioNecessario ? (
              <Alerta tipo="aviso" titulo="Empate persistente">
                <p>
                  Nenhum critério do art. 60 desfez o empate. Informe os critérios que faltam (por exemplo, o lance na disputa final) ou registre
                  o resultado do procedimento previsto no edital antes de avançar à etapa 7.
                </p>
              </Alerta>
            ) : null}
          </>
        ) : (
          <p className="texto-secundario">A classificação aparece após a inclusão dos licitantes e dos valores das propostas.</p>
        )}
        {sinaisVinculo.map((s, i) => (
          <Alerta key={`${s.regra}-${i}`} tipo="aviso" titulo={`Sinal para análise (${s.regra})`}>
            <p>{s.mensagem}</p>
            <p className="texto-pequeno">{s.fundamento}. Indício para apuração; não constitui acusação nem decisão.</p>
          </Alerta>
        ))}
      </section>

      <AtosSelecao processo={processo} atual={atual} editavel={editavel} />

      {atual && processo.contratoGerado === null ? (
        <>
          <Requisitos titulo="Condições para avançar à etapa 7" itens={requisitos} />
          <p className="texto-pequeno texto-secundario">
            Ao avançar, o servidor também confirma que o vencedor não tem sanção impeditiva vigente (CEIS/CNEP).
          </p>
        </>
      ) : null}
    </div>
  );
}
